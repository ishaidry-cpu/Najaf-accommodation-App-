import { createHash } from 'node:crypto';
import { normalizeBuildingName, normalizeRoomNumber } from '../src/services/storage.js';
import type { Reservation } from '../src/types/index.js';
import { nkerpLogin } from './nkerp-sync/credentials.js';
import { NkerpClient } from './nkerp-sync/nkerpClient.js';
import { NkerpEmailClient } from './nkerp-sync/emails.js';
import { peopleOnTour } from './nkerp-sync/planner.js';
import { addDays, day, norm, todayIn } from './nkerp-sync/util.js';
import type { NkRecord } from './nkerp-sync/types.js';
import { expiry, guests, identityHash, read, rooms, stayKey, write, transaction, prune } from './accommodation-store.js';

export interface StoredReservation extends Reservation {
  nkerpBaseline?: { building: string; roomNumber: string };
  localFields?: string[];
  allocationObservedOnly?: boolean;
}

export const removalKey = (stay: Reservation) => identityHash(stayKey(stay));
const str = (v: unknown) => String(v ?? '').trim();
const dateTime = (v: unknown) => ({
  date: /^\d{4}-\d\d-\d\d/.test(str(v)) ? day(v) : '',
  time: /T(\d\d:\d\d)/.exec(str(v))?.[1] || '',
});

function mapStay(a: NkRecord, start: unknown, end: unknown, nkRoom?: {building:string; room:string}): StoredReservation {
  const arrival = dateTime(start);
  const departure = dateTime(end);
  const itsId = str(a.ITSId ?? a.AppicantITSId);
  const tourRefNo = str(a.TourRefenceNO ?? a.TourReferenceNo);
  const family = str(a.FamilyName ?? a.Family);
  const groupLeadName = str(a.GroupLeadFullName);
  const id = 'nkerp-' + createHash('sha256').update(JSON.stringify([norm(tourRefNo), itsId, arrival.date])).digest('hex').slice(0, 24);
  const building = normalizeBuildingName(nkRoom?.building || '');
  const roomNumber = normalizeRoomNumber(nkRoom?.room || '');
  return {
    id, tourRefNo, tourId: tourRefNo, itsId, applicantName: str(a.ApplicantName),
    age: str(a.Age), gender: str(a.GenderName), category: str(a.Category), family, familyNo: family,
    jamaat: str(a.Jamaat), rotationId: str(a.RotationId), idara: str(a.Idara), hofId: str(a.HOFID),
    officeName: str(a.OfficeName), groupLeadName, guestLeaderName: groupLeadName,
    arrivalDate: arrival.date, arrivalTime: arrival.time, rawArrivalStr: str(start),
    departureDate: departure.date, departureTime: departure.time, rawDepartureStr: str(end),
    arrivalDateTime: str(start), departureDateTime: str(end),
    building, roomNumber, nkerpBaseline: {building, roomNumber},
    isUploadedToPortal: Boolean(nkRoom), moneyGiven: 'No', paxCount: 1,
    createdAt: '', updatedAt: '',
  };
}

const profileFields = ['itsId','applicantName','age','gender','category','family','familyNo','jamaat','rotationId',
  'idara','hofId','officeName','groupLeadName','guestLeaderName','arrivalDate','arrivalTime','rawArrivalStr',
  'departureDate','departureTime','rawDepartureStr','arrivalDateTime','departureDateTime'] as const;

export function reconcileNkerp(incoming: StoredReservation[], now = Date.now()) {
  return transaction(() => {
    const history = new Set(read<Record<string,string>[]>('history',[]).map(row => JSON.stringify([norm(row['Tour ID']),str(row.ITS)])));
    const current = new Map(guests().map(r => [r.itsId && r.tourRefNo && r.arrivalDate ? stayKey(r) : r.id, r as StoredReservation]));
    const removed = read<Record<string,number>>('removed-stays', {});
    const inventory = rooms();
    const byTourGuest = (r: Reservation) => JSON.stringify([norm(r.tourRefNo), str(r.itsId)]);
    const storedByPerson = new Map<string,StoredReservation[]>();
    const receivedByPerson = new Map<string,number>();
    for (const r of current.values()) {
      const identity = byTourGuest(r);
      const personStays = storedByPerson.get(identity) || [];
      personStays.push(r);
      storedByPerson.set(identity,personStays);
    }
    for (const r of incoming) {
      const identity = byTourGuest(r);
      receivedByPerson.set(identity,(receivedByPerson.get(identity) || 0)+1);
    }
    const stamp = new Date(now).toISOString();
    let changed = 0;
    for (const source of incoming) {
      if (!source.tourRefNo || !source.itsId || !source.arrivalDate || !source.departureDate ||
          expiry(source) <= now || removed[removalKey(source)] > now) continue;
      const key = stayKey(source);
      const person = byTourGuest(source);
      const candidates = storedByPerson.get(person) || [];
      const [alternate] = candidates;
      // A changed date on a single overlapping stay is a correction, while another tour or
      // a separate stay on the same tour gets its own reservation.
      const previous = current.get(key) ?? (receivedByPerson.get(person) === 1 && candidates.length === 1 &&
        alternate.arrivalDate < source.departureDate && source.arrivalDate < alternate.departureDate ? alternate : undefined);
      const merged: StoredReservation = previous ? {...previous} : {...source, allocationObservedOnly: true, createdAt: stamp};
      if (previous) {
        for (const field of profileFields) {
          const value = source[field];
          if (value !== '' && value !== undefined && !previous.localFields?.includes(field)) Object.assign(merged, {[field]:value});
        }
        const canFollowNkerp = previous.allocationObservedOnly || previous.id.startsWith('nkerp-') ||
          (!previous.roomNumber && !history.has(person));
        if (canFollowNkerp && !previous.localFields?.includes('roomNumber') && !previous.localFields?.includes('building')) {
          merged.building = source.building;
          merged.roomNumber = source.roomNumber;
          merged.allocationObservedOnly = true;
        }
        if (!previous.localFields?.includes('isUploadedToPortal')) merged.isUploadedToPortal = Boolean(source.roomNumber && merged.roomNumber === source.roomNumber && merged.building === source.building);
      }
      merged.nkerpBaseline = source.nkerpBaseline;
      merged.category ||= 'Mumineen';
      merged.groupLeadName ||= merged.applicantName;
      merged.guestLeaderName ||= merged.groupLeadName;
      merged.roomId = inventory.find(r => r.building === merged.building && r.roomNumber === merged.roomNumber)?.id;
      if (JSON.stringify(previous) !== JSON.stringify(merged)) {
        merged.updatedAt = stamp;
        if (previous) current.delete(stayKey(previous));
        current.set(stayKey(merged), merged);
        changed++;
      }
    }
    if (changed) {
      write('reservations', [...current.values()]);
      const settings = read<{categories:string[]}>('settings',{categories:[]});
      const categories = [...new Set([...settings.categories, ...incoming.map(r=>r.category).filter(Boolean)])];
      if (categories.length !== settings.categories.length) write('settings',{...settings,categories});
    }
    return { received: incoming.length, changed, expired: prune(now) };
  });
}

export async function collectNkerp(client: Pick<NkerpClient,'pending'|'currentForTours'>, tours: Pick<NkerpEmailClient,'tourList'>, today = todayIn(), now = Date.now()) {
  const [pending, tourRows] = await Promise.all([client.pending(), tours.tourList(addDays(today,-45))]);
  const result = new Map<string,StoredReservation>();
  for (const a of pending) {
    // The search is scoped to Najaf. NKERP uses zero as an unspecified row sub-venue.
    if (a.SubVenueID != null && ![0,3].includes(Number(a.SubVenueID))) continue;
    for (const s of a.TourIternaryDates || []) {
      const item = mapStay(a, s.ArrivalDate, s.DepartureDate);
      if (expiry(item) > now) result.set(stayKey(item), item);
    }
  }

  const byTour = new Map<string, {tour:NkRecord; plan:NkRecord}[]>();
  for (const tour of tourRows) {
    const ref = norm(tour.TourReferenceId);
    if (!ref || tour.IsActive === false) continue;
    for (const plan of tour.TourSubvenuePlan || []) {
      if (Number(plan.SubvenueId) !== 3 || plan.IsRemoved === true || !norm(plan.SubvenueName).includes('NAJAF')) continue;
      const date = dateTime(plan.EndDateTimeZone);
      if (!date.date || expiry({ departureDate:date.date, departureTime:date.time }) <= now) continue;
      const list = byTour.get(ref) || [];
      list.push({tour,plan});
      byTour.set(ref,list);
    }
  }

  const allocated = [...byTour].filter(([,plans]) => plans.some(({plan}) => [1,2].includes(Number(plan.AccomudationStatusID))));
  const allocations = await client.currentForTours(allocated.map(([ref]) => ref), addDays(today,-4));
  const rowsByRef = new Map<string,NkRecord[]>();
  for (const row of allocations) {
    const entries = row.RoomAllocatedDates_Current || [];
    for (const ref of new Set<string>(entries.map((e: NkRecord) => norm(e.TourReferenceNo)))) {
      if (!byTour.has(ref)) continue;
      const list = rowsByRef.get(ref) || [];
      list.push({...row, RoomAllocatedDates_Current: entries.filter((e: NkRecord) => norm(e.TourReferenceNo) === ref)});
      rowsByRef.set(ref,list);
    }
  }
  const allocatedByTour = new Map([...rowsByRef].map(([ref,rows]) => [ref,peopleOnTour(rows,ref)]));
  for (const [ref, plans] of byTour) {
    for (const {tour,plan} of plans) {
      const start = day(plan.StartDateTimeZone);
      const end = day(plan.EndDateTimeZone);
      const base = { TourRefenceNO: ref, OfficeName: tour.OfficeName || tour.PartnerOfficeName };
      for (const person of allocatedByTour.get(ref)?.values() || []) {
        const nights = person.nights.filter(n => start <= n.day && n.day <= end);
        if (!nights.length) continue;
        const night = nights.find(n => n.day >= today) || nights[nights.length-1];
        const item = mapStay({...base, ...night.entry},plan.StartDateTimeZone,plan.EndDateTimeZone,night);
        const key = stayKey(item);
        const previous = result.get(key);
        result.set(key, previous ? {...item, ...previous, building:item.building, roomNumber:item.roomNumber,
          nkerpBaseline:item.nkerpBaseline, isUploadedToPortal:true} : item);
      }
      for (const applicant of tour.ApplicantList || []) {
        const item = mapStay({...base,...applicant},plan.StartDateTimeZone,plan.EndDateTimeZone);
        const key = stayKey(item);
        if (!result.has(key)) result.set(key,item);
      }
    }
  }
  return [...result.values()];
}

export function createPull(onChange: () => void) {
  let running: Promise<ReturnType<typeof reconcileNkerp>> | undefined;
  const status = { running:false, lastSyncedAt: null as string | null, error: null as string | null };
  function pull() {
    if (running) return running;
    status.running = true;
    running = (async () => {
      nkerpLogin();
      const signal = AbortSignal.timeout(55_000);
      const client = new NkerpClient({signal});
      const tours = new NkerpEmailClient({signal});
      const incoming = await collectNkerp(client,tours);
      const outcome = reconcileNkerp(incoming);
      status.lastSyncedAt = new Date().toISOString();
      status.error = null;
      if (outcome.changed || outcome.expired) onChange();
      return outcome;
    })().catch(err => {
      status.error = err instanceof Error ? err.message : 'NKERP pull failed.';
      throw err;
    }).finally(() => { status.running = false; running = undefined; });
    return running;
  }
  return { pull, status };
}
