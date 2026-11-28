/**
 * Awaiting Tour ID approvals, exported for the Idara: an Excel workbook officials can filter and annotate, and an
 * A4 PDF to read, share and print. Both carry the same rows, the generation time, and each city's capacity
 * against its limit (Najaf 290, Karbala 400 by default) if the exported Tour IDs are approved.
 */
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import {
  addLoad, type ApprovalPlan, CITIES, CITY_NAME, type City, emptyLoad, fmtDay, fmtSegments, localDay, localTime, reapprovalStatus,
  suggestion, toSubvenueDates, type TourPlan, tripEnd, tripStart,
} from './approvalPlanner';

/** Every Tour ID still waiting for an approval from the planner: new approvals and re-approvals not yet sent. */
export const awaitingApproval = (plan: ApprovalPlan) => plan.plans.filter(p => p.recommendation !== 'done' && !p.tour.approvedEdit);

const STAGE: Record<TourPlan['category'], string> = {
  ready: 'Ready to approve', awaiting: 'Awaiting', 'pending-submission': 'Pending submission', reapproval: 'Re-approval',
};
const REC_LABEL: Record<TourPlan['recommendation'], string> = {
  approve: 'Approve', 'confirm-dates': 'Confirm dates, then approve', 'review-changes': 'Review the changes, then approve',
  'hold-capacity': 'Hold: over capacity', wait: 'Wait for the Tour Operator', 'follow-up': 'Follow up now', 'needs-chat': 'Needs chat dates',
  'needs-itinerary': 'Blocked: itinerary not saved', resolve: 'Resolve first', done: 'Sent to NKERP',
};

export interface ExportRow {
  no: number;
  id: number;
  tourId: string;
  isReapproval: boolean;
  /** "New approval" or "Re-approval". */
  type: string;
  /** "Awaiting approval", "Re-approval pending" or "Re-approval reviewed". */
  status: string;
  /** Where the planner has it: Ready to approve, Awaiting, Pending submission, Re-approval. */
  stage: string;
  office: string;
  iraqArrival: string;
  iraqArrivalTime: string;
  iraqDeparture: string;
  iraqDepartureTime: string;
  karbalaArrival: string;
  karbalaDeparture: string;
  najafArrival: string;
  najafDeparture: string;
  /** The city-stay sequence, e.g. "Najaf 20 Nov–23 Nov, then Karbala 23 Nov–27 Nov". */
  sequence: string;
  paxTotal: number;
  paxFaiz: number;
  paxHotel: number;
  accommodation: string;
  /** The planner's recommendation in a few words. */
  recommendation: string;
  /** The practical next step behind it. */
  nextStep: string;
  /** What holds it, or what to check. */
  issue: string;
  /** For re-approvals: what changed since the last approval. */
  changes: string;
  adminRemarks: string;
  remarksBy: string;
}

const sequenceOf = (p: TourPlan) => p.segments.map(s => `${CITY_NAME[s.city]} ${fmtDay(s.start)}–${fmtDay(s.end)}`).join(', then ');

export function exportRows(plans: TourPlan[], plan?: ApprovalPlan): ExportRow[] {
  return plans.map((p, i) => {
    const t = p.tour;
    const d = toSubvenueDates(p.segments);
    const s = suggestion(p, plan);
    const status = t.reapproval ? `Re-approval ${reapprovalStatus(p).toLowerCase()}` : 'Awaiting approval';
    const approveAs = p.segments.length ? ` as ${fmtSegments(p.segments)}` : '';
    const nextStep = p.recommendation === 'approve' ? `Approve${approveAs}.`
      : p.recommendation === 'review-changes' ? `Check the changes, then approve${approveAs}.`
      : s.next;
    const issue = s.issue || (p.problems.length ? p.problems.join(' ') : '');
    return {
      no: i + 1, id: t.id, tourId: t.ref, isReapproval: t.reapproval,
      type: t.reapproval ? 'Re-approval' : 'New approval', status, stage: STAGE[p.category], office: t.office,
      iraqArrival: tripStart(t), iraqArrivalTime: t.arrivalAt ? localTime(t.arrivalAt) : '',
      iraqDeparture: tripEnd(t), iraqDepartureTime: t.departureAt ? localTime(t.departureAt) : '',
      karbalaArrival: d.karbalaArrival, karbalaDeparture: d.karbalaDeparture, najafArrival: d.najafArrival, najafDeparture: d.najafDeparture,
      sequence: sequenceOf(p), paxTotal: t.paxTotal, paxFaiz: t.paxFaiz, paxHotel: t.paxHotel,
      accommodation: t.optionLabel || (t.option === 1 ? 'Preferred' : t.option === 2 ? 'Required' : t.option === 3 ? 'Not required' : ''),
      recommendation: REC_LABEL[p.recommendation], nextStep, issue,
      changes: p.changes.map(c => `${c.field} was ${c.before || '—'}, now ${c.after || '—'}`).join('; '),
      adminRemarks: p.record?.remarks?.text ?? '', remarksBy: p.record?.remarks?.by ?? '',
    };
  });
}

// ------------------------------------------------------------------------------------------------ capacity

export interface ExportCapacityCell {
  limit: number;
  /** Faiz pax NKERP has approved for the day (less what Tour IDs being re-approved held before). */
  approved: number;
  /** Faiz pax of the exported Tour IDs on the day, with the planner's city stays. */
  these: number;
  /** Free if the exported Tour IDs are approved: limit − approved − these. */
  free: number;
  /** The planner's own available figure: limit − (approved + every pending approval + buffer). */
  available: number;
}
export interface ExportCapacityRow { date: string; cities: Record<City, ExportCapacityCell> }

/** Day-by-day capacity over the days the exported Tour IDs stay, against each city's limit. */
export function exportCapacity(plan: ApprovalPlan, plans: TourPlan[]): ExportCapacityRow[] {
  const load = emptyLoad();
  for (const p of plans) addLoad(load, p.segments, p.tour.paxFaiz);
  const days = new Set<string>();
  for (const city of CITIES) for (const d of Object.keys(load[city])) days.add(d);
  return [...days].filter(d => d >= plan.today).sort().map(date => {
    const cities = {} as Record<City, ExportCapacityCell>;
    for (const city of CITIES) {
      const row = plan.capacity.find(c => c.date === date && c.city === city);
      const limit = row?.limit ?? plan.settings.limits[city];
      const approved = row?.approved ?? 0;
      const these = Math.round(load[city][date] ?? 0);
      cities[city] = { limit, approved, these, free: limit - approved - these, available: row?.available ?? limit - approved };
    }
    return { date, cities };
  });
}

/** The busiest day per city if the exported Tour IDs are approved. */
export function busiestDays(rows: ExportCapacityRow[]) {
  const out = {} as Record<City, ExportCapacityRow | null>;
  for (const city of CITIES) {
    out[city] = rows.reduce<ExportCapacityRow | null>((m, r) => (!m || r.cities[city].free < m.cities[city].free ? r : m), null);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ shared

export interface ExportInput {
  plan: ApprovalPlan;
  plans: TourPlan[];
  /** When NKERP was last read. */
  readAt: string | null;
  generatedAt?: Date;
  /** Who prepared the report (the approver's name), if given. */
  preparedBy?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "28 Nov 2026, 2:30 PM" in the viewer's own clock. */
export const stamp = (d: Date) => {
  const h = d.getHours() % 12 || 12;
  return `${fmtDay(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, true)}, ${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};
const fileStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
export const exportFileName = (ext: 'xlsx' | 'pdf', d = new Date()) => `Awaiting Tour ID approvals ${fileStamp(d)}.${ext}`;
const readLine = (readAt: string | null) => (readAt ? `${fmtDay(localDay(readAt), true)}, ${localTime(readAt)} (Iraq time)` : 'not read yet');

function totals(rows: ExportRow[]) {
  return {
    tours: rows.length, fresh: rows.filter(r => !r.isReapproval).length, re: rows.filter(r => r.isReapproval).length,
    pax: rows.reduce((n, r) => n + r.paxTotal, 0), faiz: rows.reduce((n, r) => n + r.paxFaiz, 0), hotel: rows.reduce((n, r) => n + r.paxHotel, 0),
  };
}
const busiestLine = (cap: ExportCapacityRow[], city: City) => {
  const r = busiestDays(cap)[city];
  if (!r) return `${CITY_NAME[city]}: no Faiz stays among these Tour IDs.`;
  const c = r.cities[city];
  return `${CITY_NAME[city]} busiest day ${fmtDay(r.date, true)}: ${c.approved + c.these} of ${c.limit} (${c.free < 0 ? `${-c.free} over the limit` : `${c.free} free`})`;
};

// ------------------------------------------------------------------------------------------------ Excel

/** Excel date cell (a local calendar day, so it does not shift with the time zone). */
const xlDate = (d: string) => {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
};

export function awaitingWorkbook(input: ExportInput): XLSX.WorkBook {
  const { plan, plans } = input;
  const at = input.generatedAt ?? new Date();
  const rows = exportRows(plans, plan);
  const cap = exportCapacity(plan, plans);
  const sum = totals(rows);
  const limits = plan.settings.limits;

  const head = [
    'No.', 'Tour ID', 'Type', 'Approval status', 'Planner stage', 'Office name', 'Iraq arrival', 'Arrival time', 'Iraq departure', 'Departure time',
    'Karbala arrival', 'Karbala departure', 'Najaf arrival', 'Najaf departure', 'City sequence', 'Total pax', 'Faiz required (pax)',
    'Hotel required (pax)', 'Accommodation in Faiz', 'AI recommendation', 'Next step', 'Issue / observation', 'Changes since last approval',
    'Admin remarks', 'Remarks by', 'Idara recommendation (Approve / Hold / Change)', 'Idara comments', 'Reviewed by', 'Review date',
  ];
  const top: (string | number | Date)[][] = [
    ['Faiz-e-Husaini · Awaiting Tour ID approvals'],
    [`Generated ${stamp(at)}${input.preparedBy ? ` by ${input.preparedBy}` : ''} · NKERP read ${readLine(input.readAt)}`],
    [`${sum.tours} Tour IDs (${sum.fresh} new approval${sum.fresh === 1 ? '' : 's'}, ${sum.re} re-approval${sum.re === 1 ? '' : 's'}) · ${sum.pax} pax: ${sum.faiz} Faiz, ${sum.hotel} hotel`],
    [`Capacity limits: Najaf ${limits.NAJAF} · Karbala ${limits.KARBALA} Faiz pax a day. ${busiestLine(cap, 'NAJAF')}. ${busiestLine(cap, 'KARBALA')}.`],
    ['Idara officials: write your recommendation and comments in the last four columns against each Tour ID, then return the file.'],
    [],
  ];
  const body = rows.map(r => [
    r.no, r.tourId, r.type, r.status, r.stage, r.office, xlDate(r.iraqArrival), r.iraqArrivalTime, xlDate(r.iraqDeparture), r.iraqDepartureTime,
    xlDate(r.karbalaArrival), xlDate(r.karbalaDeparture), xlDate(r.najafArrival), xlDate(r.najafDeparture), r.sequence, r.paxTotal, r.paxFaiz,
    r.paxHotel, r.accommodation, r.recommendation, r.nextStep, r.issue, r.changes, r.adminRemarks, r.remarksBy, '', '', '', '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([...top, head, ...body], { cellDates: true, dateNF: 'dd mmm yyyy' });
  for (const [ref, cell] of Object.entries(ws)) if (!ref.startsWith('!') && (cell as XLSX.CellObject).t === 'd') (cell as XLSX.CellObject).z = 'dd mmm yyyy';
  const headerRow = top.length;
  const lastCol = head.length - 1;
  ws['!merges'] = top.slice(0, 5).map((_, r) => ({ s: { r, c: 0 }, e: { r, c: lastCol } }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow + Math.max(body.length, 1), c: lastCol } }) };
  ws['!cols'] = [5, 14, 12, 19, 18, 26, 12, 10, 12, 10, 13, 13, 13, 13, 40, 8, 10, 10, 14, 26, 46, 46, 40, 40, 14, 22, 40, 16, 12].map(wch => ({ wch }));

  // Capacity against the limits, day by day.
  const capHead = ['Date', 'Najaf limit', 'Najaf approved', 'Najaf: these Tour IDs', 'Najaf free if approved', 'Najaf available (planner)',
    'Karbala limit', 'Karbala approved', 'Karbala: these Tour IDs', 'Karbala free if approved', 'Karbala available (planner)', 'Over the limit'];
  const capBody = cap.map(r => {
    const n = r.cities.NAJAF, k = r.cities.KARBALA;
    const over = CITIES.filter(c => r.cities[c].free < 0).map(c => CITY_NAME[c]).join(', ');
    return [xlDate(r.date), n.limit, n.approved, n.these, n.free, n.available, k.limit, k.approved, k.these, k.free, k.available, over];
  });
  const capTop = [
    ['Capacity against the limits (Faiz pax a day)'],
    [`Najaf ${limits.NAJAF} · Karbala ${limits.KARBALA}. Approved is what NKERP holds now. "Free if approved" assumes every Tour ID in this report is approved with the planner's city stays. Available (planner) also keeps room for the rest of the queue and the buffer for unsubmitted tours. Transfer days count in both cities.`],
    [],
  ];
  const cws = XLSX.utils.aoa_to_sheet([...capTop, capHead, ...capBody], { cellDates: true, dateNF: 'dd mmm yyyy' });
  for (const [ref, cell] of Object.entries(cws)) if (!ref.startsWith('!') && (cell as XLSX.CellObject).t === 'd') (cell as XLSX.CellObject).z = 'dd mmm yyyy';
  cws['!merges'] = [0, 1].map(r => ({ s: { r, c: 0 }, e: { r, c: capHead.length - 1 } }));
  cws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: capTop.length, c: 0 }, e: { r: capTop.length + Math.max(capBody.length, 1), c: capHead.length - 1 } }) };
  cws['!cols'] = [13, 11, 14, 18, 18, 20, 12, 15, 19, 19, 21, 16].map(wch => ({ wch }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, 'Awaiting approvals');
  XLSX.utils.book_append_sheet(book, cws, 'Capacity');
  book.Props = { Title: 'Awaiting Tour ID approvals', Subject: 'Faiz-e-Husaini Najaf and Karbala approvals', CreatedDate: at };
  return book;
}

export function downloadAwaitingExcel(input: ExportInput) {
  XLSX.writeFile(awaitingWorkbook(input), exportFileName('xlsx', input.generatedAt));
}

// ------------------------------------------------------------------------------------------------ PDF

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  brand: [11, 57, 43], gold: [185, 143, 52], ink: [28, 26, 21], text: [59, 55, 47], meta: [101, 95, 82], line: [211, 203, 186],
  head: [243, 239, 231], amberBg: [252, 246, 232], amberInk: [105, 63, 24], blueBg: [238, 243, 248], blueInk: [35, 61, 88],
  roseBg: [251, 240, 238], roseInk: [127, 42, 36], okInk: [17, 69, 51],
};
/** The standard PDF fonts cover Latin-1 only: keep what they can draw. */
const pdfText = (s: string) => s.replace(/→/g, '>').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF\n–—•…]/g, '');
const range = (a: string, b: string) => (a || b ? `${a ? fmtDay(a) : '?'} – ${b ? fmtDay(b) : '?'}` : '—');

async function crest(): Promise<string | null> {
  try {
    const res = await fetch('/crest-192.jpg');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export function awaitingPdf(input: ExportInput & { crest?: string | null }): jsPDF {
  const { plan, plans } = input;
  const at = input.generatedAt ?? new Date();
  const rows = exportRows(plans, plan);
  const cap = exportCapacity(plan, plans);
  const sum = totals(rows);
  const limits = plan.settings.limits;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  doc.setProperties({ title: 'Awaiting Tour ID approvals', subject: 'Faiz-e-Husaini Najaf and Karbala approvals' });

  // Header band.
  doc.setFillColor(...C.brand); doc.rect(0, 0, W, 62, 'F');
  doc.setFillColor(...C.gold); doc.rect(0, 62, W, 2.5, 'F');
  let x = M;
  if (input.crest) { try { doc.addImage(input.crest, 'JPEG', M, 11, 40, 40); x = M + 52; } catch { /* no crest */ } }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Awaiting Tour ID approvals', x, 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.setTextColor(215, 234, 223);
  doc.text('Faiz-e-Husaini · Najaf and Karbala accommodation · for review by Idara officials', x, 45);
  doc.setFontSize(8.5);
  doc.text(pdfText(`Generated ${stamp(at)}${input.preparedBy ? ` by ${input.preparedBy}` : ''}`), W - M, 28, { align: 'right' });
  doc.text(pdfText(`NKERP read ${readLine(input.readAt)}`), W - M, 41, { align: 'right' });

  // Summary.
  doc.setTextColor(...C.ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.text(`${sum.tours} Tour ID${sum.tours === 1 ? '' : 's'} · ${sum.fresh} new approval${sum.fresh === 1 ? '' : 's'} · ${sum.re} re-approval${sum.re === 1 ? '' : 's'} · ${sum.pax} pax (${sum.faiz} Faiz, ${sum.hotel} hotel)`, M, 84);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.text);
  doc.text(pdfText(`Capacity limits: Najaf ${limits.NAJAF}, Karbala ${limits.KARBALA} Faiz pax a day. If all of these are approved: ${busiestLine(cap, 'NAJAF')}; ${busiestLine(cap, 'KARBALA')}.`), M, 97, { maxWidth: W - 2 * M });

  autoTable(doc, {
    startY: 108,
    margin: { left: M, right: M, top: 36, bottom: 34 },
    head: [['#', 'Tour ID · office', 'Iraq trip', 'Karbala', 'Najaf', 'Pax\ntotal / Faiz / hotel', 'Status', 'AI recommendation', 'Admin remarks', 'Idara remarks and recommendation']],
    body: rows.map(r => [
      String(r.no),
      pdfText(`${r.tourId}\n${r.office}`),
      pdfText(`${range(r.iraqArrival, r.iraqDeparture)}${r.iraqArrivalTime ? `\n${r.iraqArrivalTime} – ${r.iraqDepartureTime}` : ''}`),
      pdfText(range(r.karbalaArrival, r.karbalaDeparture)),
      pdfText(range(r.najafArrival, r.najafDeparture)),
      `${r.paxTotal} / ${r.paxFaiz} / ${r.paxHotel}`,
      pdfText(`${r.type}\n${r.isReapproval ? (/reviewed/.test(r.status) ? 'Changes reviewed' : 'Changes not reviewed yet') : r.stage}`),
      pdfText(`${r.recommendation}. ${r.nextStep}${r.issue && r.issue !== r.nextStep ? `\n${r.issue}` : ''}${r.changes ? `\nChanges: ${r.changes}` : ''}`),
      pdfText(r.adminRemarks ? `${r.adminRemarks}${r.remarksBy ? `\n— ${r.remarksBy}` : ''}` : ''),
      '',
    ]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 4, textColor: C.text, lineColor: C.line, lineWidth: 0.5, valign: 'top', overflow: 'linebreak', minCellHeight: 40 },
    headStyles: { fillColor: C.head, textColor: C.ink, fontStyle: 'bold', fontSize: 7.5, minCellHeight: 0, valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 18, halign: 'right' }, 1: { cellWidth: 106 }, 2: { cellWidth: 62 }, 3: { cellWidth: 56 }, 4: { cellWidth: 56 },
      5: { cellWidth: 46, halign: 'center' }, 6: { cellWidth: 62 }, 7: { cellWidth: 156 }, 8: { cellWidth: 96 }, 9: { cellWidth: 'auto' },
    },
    didParseCell: data => {
      if (data.section !== 'body') return;
      const r = rows[data.row.index];
      if (data.column.index === 1) data.cell.styles.fontStyle = 'bold';
      if (data.column.index === 6) {
        data.cell.styles.fillColor = r.isReapproval ? C.amberBg : C.blueBg;
        data.cell.styles.textColor = r.isReapproval ? C.amberInk : C.blueInk;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.column.index === 7 && /^(Hold|Blocked|Follow up|Resolve)/.test(r.recommendation)) data.cell.styles.textColor = C.roseInk;
    },
  });

  // Capacity, day by day.
  if (cap.length) {
    const prev = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 108;
    let y = prev + 26;
    if (y > H - 120) { doc.addPage(); y = 50; }
    doc.setTextColor(...C.ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Capacity against the limits (Faiz pax a day)', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.meta);
    doc.text('Approved: what NKERP holds now. These: the Tour IDs in this report, with the planner\'s city stays. Free: if all of them are approved. Transfer days count in both cities.', M, y + 12, { maxWidth: W - 2 * M });
    autoTable(doc, {
      startY: y + 20,
      margin: { left: M, right: M, top: 36, bottom: 34 },
      head: [
        [{ content: 'Date', rowSpan: 2 }, { content: `Najaf (limit ${limits.NAJAF})`, colSpan: 4 }, { content: `Karbala (limit ${limits.KARBALA})`, colSpan: 4 }],
        ['Limit', 'Approved', 'These', 'Free', 'Limit', 'Approved', 'These', 'Free'],
      ],
      body: cap.map(r => [fmtDay(r.date, true), ...CITIES.flatMap(c => {
        const v = r.cities[c];
        return [String(v.limit), String(v.approved), String(v.these), String(v.free)];
      })]),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3, textColor: C.text, lineColor: C.line, lineWidth: 0.5, halign: 'right' },
      headStyles: { fillColor: C.head, textColor: C.ink, fontStyle: 'bold', halign: 'center' },
      columnStyles: { 0: { halign: 'left', cellWidth: 80 } },
      didParseCell: data => {
        if (data.section !== 'body' || (data.column.index !== 4 && data.column.index !== 8)) return;
        const city: City = data.column.index === 4 ? 'NAJAF' : 'KARBALA';
        const v = cap[data.row.index].cities[city];
        data.cell.styles.fontStyle = 'bold';
        if (v.free < 0) { data.cell.styles.fillColor = C.roseBg; data.cell.styles.textColor = C.roseInk; }
        else if (v.free < v.limit * 0.1) { data.cell.styles.fillColor = C.amberBg; data.cell.styles.textColor = C.amberInk; }
        else data.cell.styles.textColor = C.okInk;
      },
    });
  }

  // Sign-off for the officials who reviewed it.
  {
    const prev = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 108;
    let y = prev + 30;
    if (y > H - 90) { doc.addPage(); y = 56; }
    doc.setTextColor(...C.ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Reviewed by Idara officials', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.meta);
    const colW = (W - 2 * M) / 3;
    for (let i = 0; i < 3; i++) {
      const lx = M + i * colW;
      doc.setDrawColor(...C.line); doc.setLineWidth(0.6);
      doc.line(lx, y + 34, lx + colW - 24, y + 34);
      doc.text('Name, signature and date', lx, y + 45);
    }
  }

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.meta);
    doc.text(pdfText(`Faiz-e-Husaini · Awaiting Tour ID approvals · generated ${stamp(at)}`), M, H - 16);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 16, { align: 'right' });
  }
  return doc;
}

export async function downloadAwaitingPdf(input: ExportInput) {
  const doc = awaitingPdf({ ...input, crest: await crest() });
  doc.save(exportFileName('pdf', input.generatedAt));
}
