/**
 * AI Approval Planner rules: chat dates and sequence, the odd-day rule, the dustbin sign and cut-off, capacity with a
 * buffer for unsubmitted tours, whole-tour shifts, re-approval comparison and NKERP's approval request.
 *   npm run test:planner
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ApprovalSnapshot, type ApprovalTour, approvalPayload, compareWithOriginal, DEFAULT_APPROVAL_SETTINGS, dustbinVisible,
  followUpMessage, fromSubvenueDates, latestPlanSet, needsFollowUp, officeFollowUps, najafReport, normalizeApprovalSettings, planApprovals, readChat, splitInOrder,
  submissionState, suggestion, toSubvenueDates, approvalWarnings, chatTemplates, ITINERARY_MISSING, ITINERARY_UNKNOWN,
} from '../approvalPlanner';

const TODAY = '2026-11-27';
let nextId = 1;
const tour = (o: Partial<ApprovalTour> = {}): ApprovalTour => ({
  id: nextId++, ref: `NKERP/TOUR/2026/${9000 + nextId}`, office: 'Test Travels', toName: 'TO', toId: 7, reapproval: false,
  arrivalAt: '2026-12-10T05:00:00', departureAt: '2026-12-17T05:00:00', paxTotal: 10, paxFaiz: 10, paxHotel: 0,
  option: 2, optionLabel: 'Required', venue: 'IRAQ', unread: false, dustbin: false, muwafiqaState: 31, locked: false,
  muwafiqaLocked: true, itinerarySaved: true, packageId: 0, linkedTourId: 0, modifiedOn: '2026-11-20T10:00:00', entryPort: 'Najaf Airport',
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
    assert.equal(row.present, 280, 'present is what NKERP has approved');
    assert.equal(row.expected, 288, 'expected adds pending approvals and the buffer');
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
    // The old 10 pax are taken out before the new 12 are added; present still shows NKERP's 110.
    const k10 = plan.capacity.find(c => c.city === 'KARBALA' && c.date === '2026-12-10')!;
    assert.equal(k10.approved, 100);
    assert.equal(k10.present, 110);
    assert.ok(p.impact.length);
    for (const i of p.impact) assert.equal(i.present, plan.capacity.find(c => c.city === i.city && c.date === i.date)?.present ?? 0);
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

describe('WhatsApp follow-ups', () => {
  it('drafts one message per office for tours inside the cut-off', () => {
    const a = tour({ office: 'Kerai Tours', dustbin: true, arrivalAt: '2026-12-05T05:00:00', departureAt: '2026-12-09T05:00:00' });
    const b = tour({ office: 'Kerai Tours', option: 3, paxFaiz: 0, paxHotel: 3, paxTotal: 3, arrivalAt: '2026-12-06T05:00:00', departureAt: '2026-12-09T05:00:00' });
    const far = tour({ office: 'Other', dustbin: true, arrivalAt: '2027-01-20T05:00:00', departureAt: '2027-01-25T05:00:00' });
    const plan = planApprovals(snap([a, b, far]), {}, settings(), TODAY);
    assert.deepEqual(plan.plans.filter(needsFollowUp).map(p => p.tour.id).sort(), [a.id, b.id].sort());
    const msg = followUpMessage(plan.plans.find(p => p.tour.id === a.id)!);
    assert.match(msg, new RegExp(a.ref.replace(/\//g, '\\/')));
    assert.match(msg, /Red-click itinerary/);
    assert.match(msg, /due 15 days before arrival/);
    const groups = officeFollowUps(plan.plans);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].tours.length, 2);
    assert.match(groups[0].message, /Karbala and Najaf dates/);
    assert.equal(groups[0].message.match(/First Subvenue/g)?.length, 1, 'the example appears once per message');
    const hotel = followUpMessage(plan.plans.find(p => p.tour.id === b.id)!);
    assert.match(hotel, /• Karbala and Najaf dates are not in the NKERP chat box\n\n\*Example:\*\n• First Subvenue: \*10 October to 15 October \(Najaf\)\*\n• Second Subvenue: \*15 October to 21 October \(Karbala\)\*/);
    assert.doesNotMatch(hotel, /DD Mon/);
    assert.ok(hotel.startsWith('Salaam Jameel\n'));
    assert.ok(groups[0].message.startsWith('Salaam Jameel\n'));
  });
  it('reads replies written like the example', () => {
    const r = readChat([msg('First Subvenue: 29 November to 1 December (Najaf)'), msg('Second Subvenue: 1 December to 2 December (Karbala)')],
      { start: '2026-11-29', end: '2026-12-02' });
    assert.deepEqual(r.segments, [{ city: 'NAJAF', start: '2026-11-29', end: '2026-12-01' }, { city: 'KARBALA', start: '2026-12-01', end: '2026-12-02' }]);
  });
});

describe('approval authority: warnings, not restrictions', () => {
  const one = (t: ApprovalTour, records = {}, o: Partial<typeof DEFAULT_APPROVAL_SETTINGS> = {}) =>
    planApprovals(snap([t]), records, settings(o), TODAY).plans[0];

  it('flags a dustbin tour inside the cut-off for urgent follow-up and still lets the approver approve it', () => {
    const p = one(tour({ dustbin: true, arrivalAt: '2026-12-05T05:00:00', departureAt: '2026-12-09T05:00:00' })); // 8 days away
    assert.equal(p.recommendation, 'follow-up');
    assert.equal(p.urgent, true);
    assert.equal(p.approvable, true);
    assert.deepEqual(p.blockers, []);
    assert.ok(needsFollowUp(p));
    assert.match(approvalWarnings(p)[0], /inside the 15-day cut-off/);
    assert.match(suggestion(p).next, /still approve/);
  });
  it('waits outside the cut-off without blocking, and follows the 30-day setting in rush periods', () => {
    const t = tour({ dustbin: true, arrivalAt: '2026-12-17T05:00:00', departureAt: '2026-12-21T05:00:00' }); // 20 days away
    const p = one(t);
    assert.equal(p.recommendation, 'wait');
    assert.equal(p.urgent, false);
    assert.equal(p.approvable, true);
    assert.match(approvalWarnings(p)[0], /beyond the 15-day cut-off/);
    const rush = one(t, {}, { cutoffDays: 30 });
    assert.equal(rush.recommendation, 'follow-up');
    assert.equal(rush.urgent, true);
    assert.equal(rush.approvable, true);
  });
  it('moves a tour into the normal approval once the dustbin sign disappears', () => {
    const p = one(tour({ dustbin: false, arrivalAt: '2026-12-05T05:00:00', departureAt: '2026-12-09T05:00:00' }));
    assert.equal(p.category, 'ready');
    assert.equal(p.recommendation, 'approve');
    assert.equal(p.urgent, false);
  });
  it('blocks approval only when the itinerary is not saved (fly mark not red)', () => {
    const p = one(tour({ itinerarySaved: false }));
    assert.equal(p.approvable, false);
    assert.deepEqual(p.blockers, [ITINERARY_MISSING]);
    assert.equal(p.recommendation, 'needs-itinerary');
    assert.equal(p.category, 'awaiting');
    assert.ok(p.impact.length, 'capacity is still worked out so the approver sees where it lands');
    assert.equal(one(tour({ itinerarySaved: undefined })).blockers[0], ITINERARY_UNKNOWN);
    // A dustbin tour without an itinerary is followed up and stays blocked.
    const d = one(tour({ itinerarySaved: false, dustbin: true, arrivalAt: '2026-12-05T05:00:00', departureAt: '2026-12-09T05:00:00' }));
    assert.equal(d.recommendation, 'follow-up');
    assert.equal(d.approvable, false);
    // Inside the cut-off, a missing itinerary is followed up on its own too.
    const near = one(tour({ itinerarySaved: false, arrivalAt: '2026-12-05T05:00:00', departureAt: '2026-12-09T05:00:00' }));
    assert.ok(needsFollowUp(near));
    assert.match(followUpMessage(near), /Transport itinerary/);
  });
  it('lets a re-approval, an over-capacity tour and an awaiting tour be approved with warnings', () => {
    const previous = splitInOrder('2026-12-10', '2026-12-17', 'KARBALA');
    const re = one(tour({ reapproval: true, paxFaiz: 12, paxTotal: 12, departureAt: '2026-12-18T05:00:00', previousPlans: previous }));
    assert.equal(re.recommendation, 'review-changes');
    assert.equal(re.approvable, true);
    assert.ok(approvalWarnings(re).some(w => /not marked reviewed/.test(w)));

    const dashboard = ['2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17']
      .flatMap(date => [{ date, city: 'NAJAF' as const, approved: 289, hotel: 0, occupants: [] }, { date, city: 'KARBALA' as const, approved: 399, hotel: 0, occupants: [] }]);
    const full = planApprovals(snap([tour()], dashboard), {}, settings(), TODAY).plans[0];
    assert.equal(full.recommendation, 'hold-capacity');
    assert.equal(full.category, 'awaiting');
    assert.equal(full.approvable, true);
    assert.ok(approvalWarnings(full).some(w => /Over the/.test(w)));
  });
  it('lets the approver enter a hotel tour\'s dates when the chat box has none, then approve', () => {
    const t = tour({ option: 3, optionLabel: 'Not Required', paxFaiz: 0, paxHotel: 4, paxTotal: 4 });
    const before = one(t);
    assert.equal(before.recommendation, 'needs-chat');
    assert.equal(before.approvable, false, 'there are no dates to send yet');
    const segments = splitInOrder('2026-12-10', '2026-12-17', 'NAJAF');
    const after = one(t, { [t.id]: { id: t.id, ref: t.ref, office: '', status: 'new', firstSeenAt: '', lastSeenAt: '', history: [],
      edits: { segments, at: '', modifiedOn: t.modifiedOn } } });
    assert.equal(after.approvable, true);
    assert.equal(after.recommendation, 'approve');
    assert.ok(approvalWarnings(after).some(w => /approver's dates/.test(w)));
  });
  it('still refuses what NKERP cannot take from the planner, and never resends', () => {
    assert.equal(one(tour({ option: 1, optionLabel: 'Preferred' })).approvable, false);
    const t = tour();
    const sent = one(t, { [t.id]: { id: t.id, ref: t.ref, office: '', status: 'approved', firstSeenAt: '', lastSeenAt: '', history: [],
      approval: { state: 'api_reported_approved', at: '', segments: [], reapproval: false } } });
    assert.equal(sent.recommendation, 'done');
    assert.equal(sent.approvable, false);
  });
  it('drafts plain-text follow-ups for the NKERP chat box', () => {
    const p = one(tour({ itinerarySaved: false, dustbin: true, option: 3, paxFaiz: 0, paxHotel: 10, arrivalAt: '2026-12-05T05:00:00', departureAt: '2026-12-09T05:00:00' }));
    const list = chatTemplates(p);
    assert.deepEqual(list.map(x => x.label), ['All pending details', 'Itinerary', 'Subvenue dates', 'Submission']);
    for (const x of list) {
      assert.ok(!x.text.includes('*'), 'no WhatsApp bold marks in NKERP');
      assert.match(x.text, new RegExp(p.tour.ref));
    }
    assert.match(list[0].text, /Transport itinerary/);
    assert.equal(chatTemplates(one(tour())).length, 0);
  });
});
