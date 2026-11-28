/**
 * Awaiting Tour ID approvals report: the rows, capacity against the limits, the Excel workbook and the PDF.
 *   npm run test:planner
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import { type ApprovalSnapshot, type ApprovalTour, DEFAULT_APPROVAL_SETTINGS, planApprovals } from '../approvalPlanner';
import { awaitingApproval, awaitingPdf, awaitingWorkbook, busiestDays, exportCapacity, exportRows } from '../approvalExport';

const TODAY = '2026-11-27';
let nextId = 500;
const tour = (o: Partial<ApprovalTour> = {}): ApprovalTour => ({
  id: nextId++, ref: `NKERP/TOUR/2026/${nextId}`, office: 'Test Travels', toName: 'TO', toId: 7, reapproval: false,
  arrivalAt: '2026-12-10T05:00:00', departureAt: '2026-12-17T05:00:00', paxTotal: 10, paxFaiz: 10, paxHotel: 0,
  option: 2, optionLabel: 'Required', venue: 'IRAQ', unread: false, dustbin: false, muwafiqaState: 31, locked: false,
  muwafiqaLocked: true, itinerarySaved: true, packageId: 0, linkedTourId: 0, modifiedOn: '2026-11-20T10:00:00', entryPort: 'Najaf Airport',
  exitPort: 'Najaf Airport', mawaid: true, transport: true, cutOffDays: 15, remarks: '', events: [], messages: [],
  previousPlans: [], ...o,
});
const msg = (text: string) => ({ text, at: '2026-11-20T10:00:00', sender: 'TO', fromOperator: true });
const snap = (tours: ApprovalTour[], dashboard: ApprovalSnapshot['dashboard'] = []): ApprovalSnapshot =>
  ({ collectedAt: '2026-11-27T08:00:00Z', window: { from: '2026-11-17', to: '2027-01-26' }, tours, dashboard, errors: [] });

const fresh = tour({ ref: 'NKERP/TOUR/2026/7001', office: 'Faiz E Husaini UAE', paxTotal: 12, paxFaiz: 10, paxHotel: 2,
  messages: [msg('10 Dec to 13 Dec Najaf, 13 Dec to 17 Dec Karbala')] });
const again = tour({ ref: 'NKERP/TOUR/2026/7002', reapproval: true, paxFaiz: 20, paxTotal: 20,
  previousPlans: [{ city: 'KARBALA', start: '2026-12-10', end: '2026-12-14' }, { city: 'NAJAF', start: '2026-12-14', end: '2026-12-17' }] });
// 280 Faiz pax already approved in Najaf on 12 Dec: the two tours push it over 290.
const dashboard: ApprovalSnapshot['dashboard'] = [{ date: '2026-12-12', city: 'NAJAF', approved: 280, hotel: 0, occupants: [] }];
const plan = planApprovals(snap([fresh, again], dashboard), {
  [String(fresh.id)]: { id: fresh.id, ref: fresh.ref, office: fresh.office, status: 'new', firstSeenAt: '', lastSeenAt: '', history: [],
    remarks: { text: 'Office asked for Najaf first → keep it.', at: '2026-11-27T09:00:00Z', by: 'Admin A' } },
}, DEFAULT_APPROVAL_SETTINGS, TODAY);

describe('awaiting approvals report', () => {
  it('lists new approvals and re-approvals with their dates, pax, recommendation and remarks', () => {
    const list = awaitingApproval(plan);
    assert.equal(list.length, 2);
    const rows = exportRows(list, plan);
    const a = rows.find(r => r.tourId === fresh.ref)!;
    assert.equal(a.type, 'New approval');
    assert.equal(a.status, 'Awaiting approval');
    assert.equal(a.office, 'Faiz E Husaini UAE');
    assert.deepEqual([a.iraqArrival, a.iraqDeparture], ['2026-12-10', '2026-12-17']);
    assert.deepEqual([a.najafArrival, a.najafDeparture, a.karbalaArrival, a.karbalaDeparture], ['2026-12-10', '2026-12-13', '2026-12-13', '2026-12-17']);
    assert.deepEqual([a.paxTotal, a.paxFaiz, a.paxHotel], [12, 10, 2]);
    assert.equal(a.adminRemarks, 'Office asked for Najaf first → keep it.');
    assert.equal(a.remarksBy, 'Admin A');
    assert.ok(a.recommendation && a.nextStep);
    const b = rows.find(r => r.tourId === again.ref)!;
    assert.equal(b.type, 'Re-approval');
    assert.equal(b.status, 'Re-approval pending');
  });

  it('works out capacity against the limits if the exported Tour IDs are approved', () => {
    const cap = exportCapacity(plan, awaitingApproval(plan));
    const d = cap.find(r => r.date === '2026-12-12')!;
    assert.equal(d.cities.NAJAF.limit, 290);
    assert.equal(d.cities.KARBALA.limit, 400);
    assert.equal(d.cities.NAJAF.approved, 280);
    assert.ok(d.cities.NAJAF.these >= 10);
    assert.equal(d.cities.NAJAF.free, 290 - 280 - d.cities.NAJAF.these);
    assert.equal(busiestDays(cap).NAJAF?.date, '2026-12-12');
    // Only the chosen Tour IDs count.
    const one = exportCapacity(plan, awaitingApproval(plan).filter(p => p.tour.id === fresh.id));
    assert.equal(one.find(r => r.date === '2026-12-12')!.cities.NAJAF.these, 10);
  });

  it('writes an Excel workbook with the rows, the officials\' columns and the capacity sheet', () => {
    const at = new Date(2026, 10, 28, 14, 30);
    const book = awaitingWorkbook({ plan, plans: awaitingApproval(plan), readAt: '2026-11-27T08:00:00', generatedAt: at, preparedBy: 'Admin A' });
    assert.deepEqual(book.SheetNames, ['Awaiting approvals', 'Capacity']);
    const back = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellDates: true });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets['Awaiting approvals'], { header: 1, defval: '' });
    assert.match(String(grid[1][0]), /^Generated 28 Nov 2026, 2:30 PM by Admin A/);
    const head = grid.findIndex(r => r[1] === 'Tour ID');
    const cols = grid[head] as string[];
    for (const c of ['Office name', 'Iraq arrival', 'Iraq departure', 'Karbala arrival', 'Najaf departure', 'Total pax', 'Faiz required (pax)',
      'Hotel required (pax)', 'Approval status', 'AI recommendation', 'Admin remarks', 'Idara comments', 'Reviewed by']) assert.ok(cols.includes(c), c);
    const first = grid[head + 1] as unknown[];
    assert.equal(first[cols.indexOf('Tour ID')] !== '', true);
    const arrival = grid.slice(head + 1).find(r => r[1] === fresh.ref)![cols.indexOf('Iraq arrival')] as Date;
    assert.ok(arrival instanceof Date);
    assert.deepEqual([arrival.getFullYear(), arrival.getMonth(), arrival.getDate()], [2026, 11, 10]);
    const cap = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets.Capacity, { header: 1, defval: '' });
    assert.ok(cap.some(r => r[0] === 'Date' && r[1] === 'Najaf limit'));
  });

  it('writes a PDF', () => {
    const doc = awaitingPdf({ plan, plans: awaitingApproval(plan), readAt: '2026-11-27T08:00:00', generatedAt: new Date(2026, 10, 28, 14, 30) });
    assert.ok(doc.getNumberOfPages() >= 1);
    assert.match(doc.output(), /^%PDF-/);
  });
});
