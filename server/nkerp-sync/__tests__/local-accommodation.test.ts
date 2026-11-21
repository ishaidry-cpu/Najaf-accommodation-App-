import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Reservation } from '../../../src/types/index.js';
import { isDuplicateReservation } from '../../../src/utils/deduplication.js';

process.env.NAJAF_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'najaf-local-test-'));
const { expiry, guests, prune, rooms, setup, write, read, transaction, localStore } = await import('../../local-store.js');
const { withStore } = await import('../../accommodation-store.js');
const { collectNkerp, reconcileNkerp, removalKey } = await import('../../nkerp-pull.js');
const { travelRequests, readTravel, reconcileTravel } = await import('../../nkerp-travel.js');

const now = Date.parse('2026-11-21T10:00:00+03:00');
const source = (ref: string, arrivalDate = '2026-11-20'): Reservation => ({
  id: ref+arrivalDate, tourRefNo: ref, itsId: '1234', applicantName: 'Example', age: 38, category: 'Mumineen',
  gender:'Female', family:'F-1', idara:'', officeName:'Test', groupLeadName:'Example',
  building:'', roomNumber:'', moneyGiven:'No', isUploadedToPortal:false, arrivalDate,
  departureDate:'2026-11-22', departureTime:'9:00 AM', createdAt:'', updatedAt:'',
});

test('preserves room inventory, allocates persistent local records, and keeps repeated trips separate', () => withStore(localStore, () => {
  setup();
  assert.deepEqual(rooms().reduce<Record<string,number>>((out,r) => {
    out[r.building] = (out[r.building] || 0)+1; return out;
  },{}),{Saifee:70,Burhani:44,Badri:6});
  const first = {...source('A'), building:'Burhani', roomNumber:'101', isSpecialGuest:true, localFields:['roomNumber','building']};
  const second = source('B');
  assert.equal(isDuplicateReservation(first,second),false);
  assert.equal(isDuplicateReservation(first,{...first,id:'new',roomNumber:'102'}),true);
  write('reservations',[first]);
  assert.equal(reconcileNkerp([source('A','2026-11-19'),second],now).changed,2);
  assert.equal(guests().length,2);
  assert.deepEqual(guests().find(r=>r.tourRefNo==='A')?.roomNumber,'101');
  assert.equal(guests().find(r=>r.tourRefNo==='A')?.arrivalDate,'2026-11-19');
  assert.equal(guests().find(r=>r.tourRefNo==='A')?.isSpecialGuest,true);
  const removed = guests().find(r=>r.tourRefNo==='B')!;
  write('reservations',guests().filter(r=>r.id!==removed.id));
  write('removed-stays',{[removalKey(removed)]:expiry(removed)});
  assert.equal(reconcileNkerp([second],now).changed,0);
}));

test('expires the guest and their local sync history exactly 72 hours after Baghdad departure', () => withStore(localStore, () => {
  const first = source('EXPIRY');
  write('reservations',[first]);
  write('history',[{'Tour ID':first.tourRefNo, ITS:first.itsId, Arrival:first.arrivalDate, 'Run At':'2026-11-24 12:00'}]);
  const cutoff = Date.parse('2026-11-25T09:00:00+03:00');
  assert.equal(expiry(first),cutoff);
  assert.equal(transaction(() => prune(cutoff-1)),0);
  assert.equal(read<unknown[]>('history',[]).length,1);
  assert.equal(transaction(() => prune(cutoff)),1);
  assert.deepEqual(read('history',[]),[]);
  assert.equal(rooms().length,120);
}));

test('uses the scoped pending search and joins allocated nights to the correct Najaf tour and stay', async () => {
  const start = '2026-11-20T11:00:00';
  const end = '2026-11-22T09:00:00';
  const ref = 'A';
  const records = await collectNkerp({
    pending: async () => [{ITSId:1234, ApplicantName:'Example', TourRefenceNO:ref, SubVenueID:0, Age:42,
      TourIternaryDates:[{ArrivalDate:start,DepartureDate:end}]},
        {ITSId:9999,TourRefenceNO:'K',SubVenueID:4,TourIternaryDates:[{ArrivalDate:start,DepartureDate:end}]}],
    currentForTours: async refs => {
      assert.deepEqual(refs,[ref]);
      return [{ OccupiedDate:'2026-11-21',PropertyName:'BURHANI',RoomNo:'101',RoomAllocatedDates_Current:[
        { AppicantITSId:1234,ApplicantName:'Example',TourReferenceNo:ref },
        { AppicantITSId:8765,ApplicantName:'Other tour',TourReferenceNo:'K' },
      ]}];
    },
  },{
    tourList: async () => [{TourReferenceId:ref,TourSubvenuePlan:[
      {SubvenueId:3,SubvenueName:'Najaf',StartDateTimeZone:start,EndDateTimeZone:end,AccomudationStatusID:2},
    ]}],
  },'2026-11-21',now);
  assert.equal(records.length,1);
  assert.deepEqual([records[0].age,records[0].building,records[0].roomNumber],['42','Burhani','101']);
});

test('adds Najaf flight, Saffan and SBVN travel to the correct saved stay without altering the accommodation', async () => {
  const flight = { ...source('FLIGHT'), building: 'Burhani', roomNumber: '101' };
  const otherVisit = { ...source('FLIGHT','2026-11-23'), departureDate: '2026-11-26' };
  const transfer = source('TRANSFER');
  const stays = [flight, otherVisit, transfer];
  const signal = new AbortController().signal;
  const arrival = { TourReferenceNo: 'flight', SubVenue: 'NAJAF', FlightCode: 'TK 302', ArrivalPort: 'Baghdad Airport',
    ArrivalTime: '2026-11-19T21:35:00', ArrivalTimeWithTimeZone: '2026-11-20T00:35:00' };
  const requests = travelRequests(stays, now);
  assert.equal(requests.filter(request => request.date === '2026-11-20' && request.list === 'arrival').length, 1);
  const travel = await readTravel({
    read: async (path, data) => {
      const query = data as { Date: string; SubVenueId: number };
      assert.equal(query.SubVenueId, 3);
      const date = query.Date.slice(0, 10);
      if (path.endsWith('getArrivals')) return { ReturnStatus: true, arrivalRequest: date === '2026-11-20' ?
        [arrival, arrival, { ...arrival, SubVenue: 'KARBALA', FlightCode: 'NOT NAJAF' }] : [] };
      if (path.endsWith('getDepartures')) return { ReturnStatus: true, departureRequest: date === '2026-11-22' ?
        [{ TourReferenceNo: 'FLIGHT', SubVenue: 'NAJAF', FlightCode: 'NA 10 AM', DeparturePort: 'Saffan',
          DepartureTimeWithTimeZone: '2026-11-22T10:00:00' }] : [] };
      return { ReturnStatus: true, subVenueTransferRequest: date === '2026-11-20' ?
        [{ TourReferenceNo:'TRANSFER', SubVenueFrom:'KARBALA', SubVenueTo:'NAJAF',
          DepartureTime:'2026-11-20T00:00:00', ArrivalDepartureTime:'2026-11-20T11:00:00' }] : date === '2026-11-22' ?
        [{ TourReferenceNo:'TRANSFER', SubVenueFrom:'NAJAF', SubVenueTo:'KARBALA', DepartureTime:'2026-11-22T00:00:00' }] : [] };
    },
  }, requests, signal);
  withStore(localStore, () => {
    write('reservations', stays);
    assert.deepEqual(reconcileTravel(travel.results, travel.failed, now), { changed: 2, checked: requests.length, pending: 0, failed: 0 });
    const [booked, repeated, fromSubvenue] = guests();
    assert.deepEqual(booked.arrivalTravel, [{ kind:'flight', serviceDate:'2026-11-20', location:'Baghdad Airport',
      localTime:'2026-11-20T00:35', flightCode:'TK 302' }]);
    assert.deepEqual(booked.departureTravel, [{ kind:'saffan', serviceDate:'2026-11-22', location:'Saffan', localTime:'2026-11-22T10:00' }]);
    assert.equal(repeated.arrivalTravel, undefined);
    assert.equal(fromSubvenue.arrivalTravel?.[0]?.localTime, '2026-11-20T11:00');
    assert.equal(fromSubvenue.departureTravel?.[0]?.location, 'KARBALA');
    assert.equal(fromSubvenue.departureTravel?.[0]?.localTime, undefined);
    assert.equal(booked.roomNumber, '101');
    assert.equal(booked.departureTime, flight.departureTime);
    assert.equal(booked.updatedAt, flight.updatedAt);
    assert.equal(reconcileTravel(new Map(), 1, now).changed, 0);
    assert.deepEqual(guests()[0].arrivalTravel, booked.arrivalTravel);
    assert.equal(reconcileTravel(new Map([['2026-11-20/arrival', new Map()]]), 0, now).changed, 1);
    assert.equal(guests()[0].arrivalTravel, undefined);
    assert.deepEqual(guests()[0].departureTravel, booked.departureTravel);
  });
});
