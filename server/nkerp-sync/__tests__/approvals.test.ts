/** Approval queues collection, Tour ID history and the one-shot Approve action, against a fake NKERP. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withStore, type StorageDriver } from '../../accommodation-store.js';
import { approveTour, collectApprovals, mergeRecords, records, type ApprovalApi, APPROVE, approvalReads } from '../../nkerp-approvals.js';
import { Rejected } from '../nkerpClient.js';
import type { NkRecord } from '../types.js';

function memory(): StorageDriver {
  const m = new Map<string, string>();
  return { read: (k, f) => (m.has(k) ? JSON.parse(m.get(k)!) : f), write: (k, v) => { m.set(k, JSON.stringify(v)); },
    remove: k => { m.delete(k); }, transaction: fn => fn() };
}
const row = (o: NkRecord = {}): NkRecord => ({
  Id: 101, ReferenceNo: 'NKERP/TOUR/2026/101', PartnerOfficeName: 'Faiz E Husaini UAE', TOId: 9, TOName: 'TO', IsReApproval: false,
  StartDate: '2026-12-10T05:00:00', EndDate: '2026-12-14T05:00:00', PaxCount: 4, PaxRequiredAcc: 4, PaxNotRequiredAcc: 0,
  AccomodationOptionId: 2, Option: 'Required', VenueName: 'IRAQ', IsRead: false, IsActive: true, IsLocked: false,
  IsMuwaficaLocked: true, MuwaficaStateId: 31, ModifiedOn: '2026-11-20T10:00:00', CurrentStatusId: 23, TimeZone: 3,
  TourEventHistory: [], ...o,
});

class FakeNkerp implements ApprovalApi {
  calls: string[] = [];
  writes: unknown[] = [];
  queues: Record<'new' | 're', NkRecord[]> = { new: [row()], re: [] };
  detail: NkRecord = { ...row(), NoOfDays: 5, Remarks: '', PackageId: null, EntryPortId: 1, ExitPortId: 1, TourSubvenuePlan: [] };
  answer: () => NkRecord = () => ({ ReturnStatus: true });
  async read(path: string, body?: NkRecord): Promise<NkRecord> {
    assert.ok(approvalReads(path), `unexpected read ${path}`);
    this.calls.push(path);
    if (path === 'api/tours/getpendingtours') {
      const list = body!.IsReApprovedTours ? this.queues.re : this.queues.new;
      return { Tours: list, TotalRows: list.length };
    }
    if (path === 'api/tours/getAccommodationStatusDashBoard') return { AccommodationStatusSubVenueDetails: [] };
    if (path.startsWith('api/masters/retrieveChat/')) return { listChat: [{ Message: 'Najaf first please', CreatedOn: '2026-11-20T10:00:00', SenderGroupId: 4 }] };
    if (path.startsWith('api/tours/getTourSubVenue/')) return { TourPlan: this.detail };
    if (path.startsWith('api/tours/getTourDetail/')) return { Tour: { Id: this.detail.Id, LinkTourId: 0 } };
    throw new Error('unknown');
  }
  async write(path: string, body: unknown): Promise<NkRecord> {
    assert.equal(path, APPROVE);
    this.writes.push(body);
    return this.answer();
  }
}

const now = Date.parse('2026-11-27T10:00:00+03:00');

test('collects the queues and chats, then approves once with the approver\'s dates', () => withStore(memory(), async () => {
  const nk = new FakeNkerp();
  const snap = await collectApprovals(nk, now);
  assert.equal(snap.tours.length, 1);
  assert.equal(snap.tours[0].messages[0].text, 'Najaf first please');
  assert.equal(snap.tours[0].dustbin, false);
  assert.equal(records()['101'].status, 'new');

  // A second refresh reuses the cached chat when nothing changed and it is read.
  nk.queues.new = [row({ IsRead: true })];
  await collectApprovals(nk, now + 60_000);
  const chatsBefore = nk.calls.filter(c => c.startsWith('api/masters')).length;
  await collectApprovals(nk, now + 120_000);
  assert.equal(nk.calls.filter(c => c.startsWith('api/masters')).length, chatsBefore);

  const segments = [{ city: 'NAJAF' as const, start: '2026-12-10', end: '2026-12-12' }, { city: 'KARBALA' as const, start: '2026-12-12', end: '2026-12-14' }];
  await assert.rejects(approveTour(nk, { id: 101, segments, modifiedOn: 'older' }, now), /changed this tour/);
  assert.equal(nk.writes.length, 0);
  const rec = await approveTour(nk, { id: 101, segments, modifiedOn: '2026-11-20T10:00:00' }, now);
  assert.equal(rec.approval?.state, 'api_reported_approved');
  assert.equal(rec.status, 'approved');
  assert.equal(nk.writes.length, 1);
  const body = nk.writes[0] as NkRecord;
  assert.equal(body.TourSubvenuePlan.length, 2);
  assert.equal(body.TourSubvenuePlan[0].SubvenueName, 'NAJAF');
  // Never sent twice.
  await assert.rejects(approveTour(nk, { id: 101, segments, modifiedOn: '2026-11-20T10:00:00' }, now), /already accepted/);
  assert.equal(nk.writes.length, 1);
}));

test('records a refusal and an unknown result; an unknown result is never resent', () => withStore(memory(), async () => {
  const nk = new FakeNkerp();
  await collectApprovals(nk, now);
  const segments = [{ city: 'KARBALA' as const, start: '2026-12-10', end: '2026-12-12' }, { city: 'NAJAF' as const, start: '2026-12-12', end: '2026-12-14' }];
  nk.answer = () => ({ ReturnStatus: false, ReturnMessage: 'Capacity full' });
  assert.equal((await approveTour(nk, { id: 101, segments, modifiedOn: '2026-11-20T10:00:00' }, now)).approval?.state, 'api_rejected');
  nk.answer = () => { throw new Rejected('NKERP refused: bad'); };
  assert.equal((await approveTour(nk, { id: 101, segments, modifiedOn: '2026-11-20T10:00:00' }, now)).approval?.state, 'api_rejected');
  nk.answer = () => { throw new Error('socket hang up'); };
  assert.equal((await approveTour(nk, { id: 101, segments, modifiedOn: '2026-11-20T10:00:00' }, now)).approval?.state, 'uncertain_no_retry');
  await assert.rejects(approveTour(nk, { id: 101, segments, modifiedOn: '2026-11-20T10:00:00' }, now), /not sent twice/);
  assert.equal(nk.writes.length, 3);
}));

test('a Tour ID that returns for re-approval keeps its earlier details as the original', () => {
  const stamp = '2026-11-20T10:00:00.000Z';
  const tour = (o: Partial<Parameters<typeof mergeRecords>[1][number]> = {}) => ({
    id: 5, ref: 'R5', office: 'O', toName: '', toId: 1, reapproval: false, arrivalAt: '2026-12-10T05:00:00', departureAt: '2026-12-14T05:00:00',
    paxTotal: 4, paxFaiz: 4, paxHotel: 0, option: 2, optionLabel: '', venue: 'IRAQ', unread: false, dustbin: false, muwafiqaState: 31,
    locked: false, muwafiqaLocked: true, packageId: 0, linkedTourId: 0, modifiedOn: 'm1', entryPort: '', exitPort: '', mawaid: false,
    transport: false, cutOffDays: 15, remarks: '', events: [], messages: [], previousPlans: [], ...o,
  });
  let r = mergeRecords({}, [tour()], stamp);
  assert.equal(r['5'].status, 'new');
  r = mergeRecords(r, [], '2026-11-21T10:00:00.000Z');
  assert.equal(r['5'].status, 'left-queue');
  r = mergeRecords(r, [tour({ reapproval: true, paxFaiz: 6, paxTotal: 6, modifiedOn: 'm2' })], '2026-11-22T10:00:00.000Z');
  assert.equal(r['5'].status, 'reapproval-pending');
  assert.equal(r['5'].approvedFacts?.paxFaiz, 4);
  r['5'] = { ...r['5'], status: 'reapproval-reviewed', reviewedModifiedOn: 'm2' };
  r = mergeRecords(r, [tour({ reapproval: true, modifiedOn: 'm3' })], '2026-11-23T10:00:00.000Z');
  assert.equal(r['5'].status, 'reapproval-pending', 'a change after review needs a new review');
});

test('records each B→A slip once and counts reprints', async () => {
  const { recordSlip, slips, SlipError } = await import('../../slips.js');
  const { write } = await import('../../accommodation-store.js');
  withStore(memory(), () => {
    write('reservations', [{ id: 'a', itsId: '1', applicantName: 'One', tourRefNo: 'T1', officeName: 'O', arrivalDate: '2026-12-01', departureDate: '2026-12-03', building: 'Saifee', roomNumber: '101', category: 'B to A', moneyGiven: 'Yes' },
      { id: 'b', itsId: '2', applicantName: 'Two', tourRefNo: 'T1', officeName: 'O', arrivalDate: '2026-12-01', departureDate: '2026-12-03' }]);
    const first = recordSlip({ slipNo: 'SLIP-1', reservationIds: ['a', 'b'], action: 'print' }, now);
    assert.equal(first.paxCount, 2);
    assert.equal(first.pax[0].room, 'Saifee 101');
    recordSlip({ slipNo: 'SLIP-1', reservationIds: ['b', 'a'], action: 'pdf' }, now + 1000);
    assert.equal(slips().length, 1);
    assert.equal(slips()[0].issues.length, 2);
    recordSlip({ slipNo: 'SLIP-2', reservationIds: ['a'], action: 'pdf' }, now + 2000);
    assert.deepEqual(slips().map(s => s.slipNo), ['SLIP-2', 'SLIP-1']);
    assert.throws(() => recordSlip({ slipNo: 'X', reservationIds: ['zzz'] }), SlipError);
    assert.throws(() => recordSlip({ slipNo: '', reservationIds: ['a'] }), SlipError);
  });
});
