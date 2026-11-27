/**
 * AI Approval Planner rules: chat dates and sequence, the odd-day rule, the dustbin sign and cut-off, capacity with a
 * buffer for unsubmitted tours, whole-tour shifts, re-approval comparison and NKERP's approval request.
 *   npm run test:planner
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ApprovalSnapshot, type ApprovalTour, approvalPayload, compareWithOriginal, DEFAULT_APPROVAL_SETTINGS, dustbinVisible,
  fromSubvenueDates, latestPlanSet, najafReport, normalizeApprovalSettings, planApprovals, readChat, splitInOrder,
  submissionState, suggestion, toSubvenueDates,
} from '../approvalPlanner';

const TODAY = '2026-11-27';
let nextId = 1;
const tour = (o: Partial<ApprovalTour> = {}): ApprovalTour => ({
  id: nextId++, ref: `NKERP/TOUR/2026/${9000 + nextId}`, office: 'Test Travels', toName: 'TO', toId: 7, reapproval: false,
  arrivalAt: '2026-12-10T05:00:00', departureAt: '2026-12-17T05:00:00', paxTotal: 10, paxFaiz: 10, paxHotel: 0,
  option: 2, optionLabel: 'Required', venue: 'IRAQ', unread: false, dustbin: false, muwafiqaState: 31, locked: false,
  muwafiqaLocked: true, packageId: 0, linkedTourId: 0, modifiedOn: '2026-11-20T10:00:00', entryPort: 'Najaf Airport',
  exitPort: 'Najaf Airport', mawaid: true, transport: true, cutOffDays: 15, remarks: '', events: [], messages: [],
  previousPlans: [], ...o,
});
const msg = (text: string, at = '2026-11-20T10:00:00') => ({ text, at, sender: 'TO', fromOperator: true });
const snap = (tours: ApprovalTour[], dashboard: ApprovalSnapshot['dashboard'] = []): ApprovalSnapshot =>
  ({ collectedAt: '2026-11-27T08:00:00Z', window: { from: '2026-11-17', to: '2027-01-26' }, tours, dashboard, errors: [] });
const settings = (o: Partial<typeof DEFAULT_APPROVAL_SETTINGS> = {}) => ({ ...DEFAULT_APPROVAL_SETTINGS, ...o });

describe('city splits', () => {
  it('gives the odd day to Karbala in either order', () => {
    assert.deepEqual(splitInOrder('2026-12-10', '2026-12-17', 'KARBALA'),
      [{ city: 'KARBALA', start: '2026-12-10', end: '2026-12-14' }, { city: 'NAJAF', start: '2026-12-14', end: '2026-12-17' }]);
    assert.deepEqual(splitInOrder('2026-12-10', '2026-12-17', 'NAJAF'),
      [{ city: 'NAJAF', start: '2026-12-10', end: '2026-12-13' }, { city: 'KARBALA', start: '2026-12-13', end: '2026-12-17' }]);
    assert.deepEqual(splitInOrder('2026-12-10', '2026-12-14', 'NAJAF').map(s => s.end), ['2026-12-12', '2026-12-14']);
  });
  it('maps the four subvenue fields both ways', () => {
    const segs = splitInOrder('2026-12-10', '2026-12-17', 'NAJAF');
    const f = toSubvenueDates(segs);
    assert.deepEqual(f, { karbalaArrival: '2026-12-13', karbalaDeparture: '2026-12-17', najafArrival: '2026-12-10', najafDeparture: '2026-12-13' });
    assert.deepEqual(fromSubvenueDates(f), segs);
  });
});

describe('chat box', () => {
  const trip = { start: '2026-11-29', end: '2026-12-02' };
  it('reads the Tour Operator\'s dated lines exactly', () => {
    const r = readChat([msg('Request to set the Sub Venue Plan for the group as Karbala first.'), msg('29 Nov to 01 Dec – Karbala', '2026-11-20T10:00:20'),
      msg('01 Dec to 02 Dec – Najaf', '2026-11-20T10:00:40'), msg('02 Dec - departure from Najaf in the morning', '2026-11-20T10:01:00')], trip);
    assert.deepEqual(r.segments, [{ city: 'KARBALA', start: '2026-11-29', end: '2026-12-01' }, { city: 'NAJAF', start: '2026-12-01', end: '2026-12-02' }]);
    assert.equal(r.order, 'KARBALA');
    assert.deepEqual(r.problems, []);
  });
  it('reads a sequence in words', () => {
    assert.equal(readChat([msg('First Najaf, second Karbala')], trip).order, 'NAJAF');
    assert.equal(readChat([msg('Najaf then Karbala please')], trip).order, 'NAJAF');
    assert.equal(readChat([msg('Where ever he gets first accommodation as par accommodation team')], trip).flexible, true);
  });
  it('uses the latest set of dates and other date styles', () => {
    const r = readChat([msg('29/11 to 30/11 Najaf'), msg('30/11 to 2/12 Karbala'),
      msg('Karbala: 29th Nov till 1st Dec', '2026-11-25T09:00:00'), msg('1 Dec to 2 Dec Najaf', '2026-11-25T09:01:00')], trip);
    assert.deepEqual(r.segments?.map(s => s.city), ['KARBALA', 'NAJAF']);
  });
  it('flags dates that no longer match the trip', () => {
    const r = readChat([msg('19 Nov to 20 Nov - Najaf'), msg('20 Nov to 21 Nov - Karbala')], { start: '2026-12-07', end: '2026-12-15' });
    assert.equal(r.problems.length, 1);
  });
});

describe('dustbin sign and cut-off', () => {
  it('follows NKERP\'s Delete Tour icon rule', () => {
    assert.equal(dustbinVisible({ IsActive: true, IsLocked: false, IsMuwaficaLocked: false, MuwaficaStateId: 38 }), true);
    assert.equal(dustbinVisible({ IsActive: true, IsLocked: false, IsMuwaficaLocked: true, MuwaficaStateId: 31 }), false);
    assert.equal(dustbinVisible({ IsActive: true, IsLocked: false, IsMuwaficaLocked: false, MuwaficaStateId: 33 }), false);
    assert.equal(dustbinVisible({ IsActive: true, IsLocked: false, IsMuwaficaLocked: false, MuwaficaStateId: 2 }), false);
  });
  it('waits outside the cut-off and follows up inside it, using the current setting', () => {
    const t = tour({ dustbin: true, arrivalAt: '2026-12-17T05:00:00' }); // 20 days away
    assert.equal(submissionState(t, 15, TODAY).state, 'wait');
    assert.equal(submissionState(t, 30, TODAY).state, 'follow-up');
    assert.equal(submissionState({ ...t, dustbin: false }, 30, TODAY).state, 'complete');
  });
  it('clamps the editable settings', () => {
    assert.equal(normalizeApprovalSettings({ cutoffDays: 30 }).cutoffDays, 30);
    assert.equal(normalizeApprovalSettings({ cutoffDays: -4 }).cutoffDays, 15);
    assert.deepEqual(normalizeApprovalSettings({}).limits, { NAJAF: 290, KARBALA: 400 });
  });
});

describe('planning', () => {
  it('approves a hotel tour on the exact chat dates and holds one without them', () => {
    const hotel = tour({ option: 3, optionLabel: 'Not Required', paxFaiz: 0, paxHotel: 4, paxTotal: 4, unread: true,
      arrivalAt: '2026-11-29T05:00:00', departureAt: '2026-12-02T05:00:00',
      messages: [msg('29 Nov to 01 Dec – Karbala'), msg('01 Dec to 02 Dec – Najaf')] });
    const silent = tour({ option: 3, paxFaiz: 0, paxHotel: 2, paxTotal: 2 });
    const plan = planApprovals(snap([hotel, silent]), {}, settings(), TODAY);
    const a = plan.plans.find(p => p.tour.id === hotel.id)!;
    assert.equal(a.recommendation, 'approve');
    assert.equal(a.source, 'chat-dates');
    assert.equal(a.segments[1].start, '2026-12-01');
    assert.equal(plan.plans.find(p => p.tour.id === silent.id)!.recommendation, 'needs-chat');
  });
  it('follows a Faiz chat sequence and otherwise picks the order that fits, keeping the group whole', () => {
    // Najaf is nearly full on 10–13 Dec, free from 13 Dec.
    const dashboard = ['2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17']
      .flatMap(date => [{ date, city: 'NAJAF' as const, approved: date < '2026-12-14' ? 285 : 100, hotel: 0, occupants: [] },
        { date, city: 'KARBALA' as const, approved: 100, hotel: 0, occupants: [] }]);
    const flexible = tour({ paxFaiz: 10, paxTotal: 10 });
    const asked = tour({ paxFaiz: 10, paxTotal: 10, messages: [msg('Najaf first please')] });
    const plan = planApprovals(snap([flexible, asked], dashboard), {}, settings(), TODAY);
    const f = plan.plans.find(p => p.tour.id === flexible.id)!;
    assert.equal(f.segments[0].city, 'KARBALA');
    assert.equal(f.recommendation, 'approve');
    const q = plan.plans.find(p => p.tour.id === asked.id)!;
    assert.equal(q.segments[0].city, 'NAJAF');
    assert.equal(q.recommendation, 'hold-capacity');
    assert.ok(q.notes.some(n => /Karbala first would/.test(n)));
    assert.match(suggestion(q, plan).next, /accept|waitlist|Shift/);
  });
  it('keeps a buffer for tours with the dustbin sign', () => {
    const dashboard = ['2026-12-10', '2026-12-11'].flatMap(date => [{ date, city: 'NAJAF' as const, approved: 280, hotel: 0, occupants: [] },
      { date, city: 'KARBALA' as const, approved: 380, hotel: 0, occupants: [] }]);
    const unsubmitted = tour({ dustbin: true, paxFaiz: 8, paxTotal: 8, arrivalAt: '2026-12-10T05:00:00', departureAt: '2026-12-11T05:00:00', messages: [msg('Najaf first')] });
    const plan = planApprovals(snap([unsubmitted], dashboard), {}, settings(), TODAY);
    const row = plan.capacity.find(c => c.city === 'NAJAF' && c.date === '2026-12-10')!;
    assert.equal(row.buffer, 8);
    assert.equal(row.available, 2);
    assert.equal(plan.plans[0].category, 'pending-submission');
    assert.equal(planApprovals(snap([unsubmitted], dashboard), {}, settings({ bufferPercent: 0 }), TODAY)
      .capacity.find(c => c.city === 'NAJAF' && c.date === '2026-12-10')!.buffer, 0);
  });
  it('suggests shifting a whole flexible tour so a held tour fits', () => {
    const days = ['2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13', '2026-12-14'];
    const dashboard = days.flatMap(date => [{ date, city: 'NAJAF' as const, approved: 260, hotel: 0, occupants: [] },
      { date, city: 'KARBALA' as const, approved: 300, hotel: 0, occupants: [] }]);
    // The flexible Faiz-office tour is planned first and lands Karbala first (Najaf 12–13); the fixed tour
    // wants Najaf 12–14 and does not fit beside it. Flipping the whole flexible tour to Najaf first frees Najaf.
    const flexible = tour({ office: 'Faiz E Husaini UAE Travels LLC', paxFaiz: 15, paxTotal: 15, arrivalAt: '2026-12-10T05:00:00', departureAt: '2026-12-13T05:00:00' });
    const fixed = tour({ paxFaiz: 20, paxTotal: 20, arrivalAt: '2026-12-12T05:00:00', departureAt: '2026-12-14T05:00:00',
      messages: [msg('12 Dec to 14 Dec Najaf')] });
    const plan = planApprovals(snap([fixed, flexible], dashboard), {}, settings(), TODAY);
    assert.equal(plan.plans.find(p => p.tour.id === flexible.id)!.segments[0].city, 'KARBALA');
    assert.equal(plan.plans.find(p => p.tour.id === fixed.id)!.recommendation, 'hold-capacity');
    assert.equal(plan.shifts.length, 1);
    assert.equal(plan.shifts[0].move.tour.id, flexible.id);
    assert.equal(plan.shifts[0].admits.tour.id, fixed.id);
    assert.equal(plan.shifts[0].to[0].city, 'NAJAF');
    assert.equal(plan.shifts[0].to.length, 2, 'the whole tour moves, never part of it');
    assert.ok(plan.shifts[0].impact.some(i => i.city === 'NAJAF' && i.after < i.before));
  });
  it('re-approval: compares with the previous approval and never counts the group twice', () => {
    const previous = splitInOrder('2026-12-10', '2026-12-17', 'KARBALA');
    const re = tour({ reapproval: true, paxFaiz: 12, paxHotel: 2, paxTotal: 14, departureAt: '2026-12-18T05:00:00', previousPlans: previous,
      events: [{ event: 'Tour request has been approved', remarks: '', by: 'A', at: '2026-11-10T10:00:00' },
        { event: 'Applicant(s) Added in Tour', remarks: '', by: 'TO', at: '2026-11-12T10:00:00' },
        { event: 'Tour (X) is awaiting for allocation of transport.', remarks: '', by: 'TO', at: '2026-11-12T10:00:00' }] });
    const dashboard = ['2026-12-10', '2026-12-11'].map(date => ({ date, city: 'KARBALA' as const, approved: 110, hotel: 0,
      occupants: [{ id: re.id, ref: re.ref, office: '', faiz: 10, hotel: 0 }] }));
    const plan = planApprovals(snap([re], dashboard), {}, settings(), TODAY);
    const p = plan.plans[0];
    const cats = new Set(p.changes.map(c => c.category));
    assert.ok(cats.has('Departure Date'));
    assert.ok(cats.has('Faiz Accommodation'));
    assert.ok(p.changes.some(c => c.after === 'Applicant(s) Added in Tour'));
    assert.ok(!p.changes.some(c => /awaiting/.test(c.after)));
    assert.equal(p.recommendation, 'review-changes');
    // The old 10 pax are taken out before the new 12 are added.
    assert.equal(plan.capacity.find(c => c.city === 'KARBALA' && c.date === '2026-12-10')!.approved, 100);
    assert.equal(plan.counts.reapprovalPending, 1);
    const reviewed = planApprovals(snap([re], dashboard), { [re.id]: { id: re.id, ref: re.ref, office: '', status: 'reapproval-reviewed',
      firstSeenAt: '', lastSeenAt: '', history: [], reviewedModifiedOn: re.modifiedOn } }, settings(), TODAY);
    assert.equal(reviewed.plans[0].recommendation, 'approve');
    assert.equal(reviewed.counts.reapprovalReviewed, 1);
  });
  it('compareWithOriginal sees venue, hotel and subvenue changes', () => {
    const t = tour({ venue: 'IRAQ', paxHotel: 3, paxFaiz: 7 });
    const changes = compareWithOriginal(t, { venue: 'IRAN', paxHotel: 0, paxFaiz: 10, option: 2,
      segments: splitInOrder('2026-12-10', '2026-12-17', 'KARBALA') }, splitInOrder('2026-12-10', '2026-12-17', 'NAJAF'));
    assert.deepEqual([...new Set(changes.map(c => c.category))].sort(),
      ['Faiz Accommodation', 'Hotel Accommodation', 'Subvenue Change', 'Venue Change']);
  });
  it('lists proposal Najaf arrivals with Faiz pax only', () => {
    const a = tour({ paxFaiz: 6, paxHotel: 2, paxTotal: 8, messages: [msg('Najaf first')] });
    const plan = planApprovals(snap([a]), {}, settings(), TODAY);
    const row = najafReport(plan).find(r => r.date === '2026-12-10')!;
    assert.deepEqual(row.arrivals.map(x => x.pax), [6]);
  });
});

describe('NKERP approval request', () => {
  const detail = {
    Id: 77, CurrentStatusId: 23, IsActive: true, TimeZone: 3, AccomodationOptionId: 2, PaxCount: 5, PaxRequiredAcc: 5,
    PaxNotRequiredAcc: 0, StartDate: '2026-11-29T05:00:00', EndDate: '2026-12-02T05:00:00', ModifiedOn: '2026-11-26T20:33:57.38',
    NoOfDays: 4, IsMawaidRequired: true, Remarks: '', PackageId: null, EntryPortId: 1, ExitPortId: 2,
  };
  it('serializes city stays like NKERP\'s approval form', () => {
    const body = approvalPayload(detail, splitInOrder('2026-11-29', '2026-12-02', 'KARBALA'));
    assert.equal(body.ActionId, 1);
    assert.equal(body.ModifiedOn, detail.ModifiedOn);
    assert.equal(body.StartDate, detail.StartDate);
    assert.deepEqual(body.TourSubvenuePlan, [
      { TourId: 77, SubvenueId: 4, SubvenueName: 'KARBALA', StartDate: '2026-11-28T21:00:00.000Z', EndDate: '2026-11-30T20:59:59.998Z', planEndDate: '2026-12-01T21:00:00.000Z', TimeZone: 3 },
      { TourId: 77, SubvenueId: 3, SubvenueName: 'NAJAF', StartDate: '2026-11-30T21:00:00.000Z', EndDate: '2026-12-01T21:00:00.000Z', planEndDate: '2026-12-01T21:00:00.000Z', TimeZone: 3 },
    ]);
  });
  it('refuses what the planner must not approve', () => {
    assert.throws(() => approvalPayload({ ...detail, AccomodationOptionId: 1 }, splitInOrder('2026-11-29', '2026-12-02', 'KARBALA')), /Preferred/);
    assert.throws(() => approvalPayload(detail, splitInOrder('2026-11-29', '2026-12-01', 'KARBALA')), /Iraq departure/);
    assert.throws(() => approvalPayload(detail, splitInOrder('2026-11-29', '2026-12-02', 'KARBALA'), { linkedTourId: 5 }), /Linked/);
    assert.throws(() => approvalPayload({ ...detail, CurrentStatusId: 2 }, splitInOrder('2026-11-29', '2026-12-02', 'KARBALA')), /no longer pending/);
  });
  it('reads the latest city-stay set from NKERP\'s plan history', () => {
    const rows = [
      { Id: 1, SubvenueId: 4, StartDate: '2026-11-21T21:00:00', EndDate: '2026-11-25T20:59:59.997', IsActive: false },
      { Id: 2, SubvenueId: 3, StartDate: '2026-11-25T21:00:00', EndDate: '2026-11-28T21:00:00', IsActive: false },
      { Id: 3, SubvenueId: 3, StartDate: '2026-11-21T21:00:00', EndDate: '2026-11-25T20:59:59.997', IsActive: false },
      { Id: 4, SubvenueId: 4, StartDate: '2026-11-25T21:00:00', EndDate: '2026-11-28T21:00:00', IsActive: false },
    ];
    assert.deepEqual(latestPlanSet(rows), [{ city: 'NAJAF', start: '2026-11-22', end: '2026-11-26' }, { city: 'KARBALA', start: '2026-11-26', end: '2026-11-29' }]);
  });
});
