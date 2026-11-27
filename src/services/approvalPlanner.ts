/**
 * AI Approval Planner: the rules for NKERP Tour ID accommodation approvals (Nizam approval), shared by the
 * server (collection, approval entry) and the browser (so edits recalculate at once).
 *
 * All dates are Baghdad dates (UTC+3, no daylight saving). NKERP instants have no zone suffix and are UTC.
 * City stays share their transfer date: Karbala 2–4 Dec, Najaf 4–5 Dec. Nights are end minus start.
 *
 * Rules (from the approvers' written procedure):
 *  - Hotel tours (Accommodation Required in Faiz = No) are approved on the exact chat dates and sequence;
 *    with only a sequence, the days are split in that order and an odd day goes to Karbala.
 *  - Faiz tours follow a chat request when there is one, otherwise the balanced split (Karbala +1 when odd),
 *    and only the order is chosen for capacity. A Tour ID always moves as a whole.
 *  - The dustbin sign (NKERP's Delete Tour icon) means the submission is incomplete: wait outside the
 *    cut-off, follow up with the Tour Operator inside it. The cut-off is a setting (15 or 30 days).
 *  - Capacity: Najaf 290 and Karbala 400 Faiz pax at a time, keeping a buffer for unsubmitted tours.
 *  - A re-approval is never a new approval: it is compared with what was approved before.
 */

export type City = 'KARBALA' | 'NAJAF';
export const CITIES: City[] = ['NAJAF', 'KARBALA'];
export const CITY_ID: Record<City, number> = { NAJAF: 3, KARBALA: 4 };
export const CITY_NAME: Record<City, string> = { NAJAF: 'Najaf', KARBALA: 'Karbala' };
export const cityFromId = (id: unknown): City | null => (Number(id) === 3 ? 'NAJAF' : Number(id) === 4 ? 'KARBALA' : null);

/** A city stay in human dates. `end` is the transfer (or departure) date the next stay starts on. */
export interface Segment { city: City; start: string; end: string }

export interface ChatMessage { text: string; at: string; sender: string; fromOperator: boolean }
export interface TourEvent { event: string; remarks: string; by: string; at: string }

/** One Tour ID as the planner sees it (collected from NKERP's Tour Admin queues). */
export interface ApprovalTour {
  id: number;
  ref: string;
  office: string;
  toName: string;
  toId: number;
  reapproval: boolean;
  /** NKERP instants (UTC, no suffix). */
  arrivalAt: string;
  departureAt: string;
  paxTotal: number;
  paxFaiz: number;
  paxHotel: number;
  /** 1 Preferred, 2 Required, 3 Not Required (Accommodation Required in Faiz). */
  option: number;
  optionLabel: string;
  venue: string;
  /** Red, flashing message icon in NKERP: the Tour Operator sent something not yet read. */
  unread: boolean;
  /** NKERP shows the Delete Tour (dustbin) icon: active, unlocked, Muwafiqa not submitted/under approval/approved. */
  dustbin: boolean;
  muwafiqaState: number | null;
  locked: boolean;
  muwafiqaLocked: boolean;
  packageId: number;
  linkedTourId: number;
  modifiedOn: string;
  entryPort: string;
  exitPort: string;
  mawaid: boolean;
  transport: boolean;
  cutOffDays: number | null;
  remarks: string;
  events: TourEvent[];
  messages: ChatMessage[];
  /** The latest set of city stays NKERP holds for the tour (the previous approval, for re-approvals). */
  previousPlans: Segment[];
}

/** A dashboard day for one city (NKERP Accommodation Status dashboard). */
export interface DayCell {
  date: string;
  city: City;
  /** A: Faiz accommodation-required pax already approved. */
  approved: number;
  /** B + C: hotel / non-Faiz pax already approved. */
  hotel: number;
  occupants: { id: number; ref: string; office: string; faiz: number; hotel: number }[];
}

export interface ApprovalSnapshot {
  collectedAt: string | null;
  window: { from: string; to: string } | null;
  tours: ApprovalTour[];
  dashboard: DayCell[];
  errors: string[];
}

export interface ApprovalSettings {
  /** Submission cut-off in days before Iraq arrival (normally 15; 30 in rush periods). */
  cutoffDays: number;
  limits: Record<City, number>;
  /** Share of unsubmitted tours' Faiz pax kept free as buffer (100 = all of it). */
  bufferPercent: number;
  /** Days ahead of today that pending tours are collected for. */
  horizonDays: number;
}
export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  cutoffDays: 15, limits: { NAJAF: 290, KARBALA: 400 }, bufferPercent: 100, horizonDays: 60,
};
export function normalizeApprovalSettings(input: unknown): ApprovalSettings {
  const x = (input && typeof input === 'object' ? input : {}) as Partial<ApprovalSettings>;
  const num = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
  };
  const d = DEFAULT_APPROVAL_SETTINGS;
  return {
    cutoffDays: num(x.cutoffDays, 1, 120, d.cutoffDays),
    limits: { NAJAF: num(x.limits?.NAJAF, 1, 5000, d.limits.NAJAF), KARBALA: num(x.limits?.KARBALA, 1, 5000, d.limits.KARBALA) },
    bufferPercent: num(x.bufferPercent, 0, 200, d.bufferPercent),
    horizonDays: num(x.horizonDays, 7, 120, d.horizonDays),
  };
}

/** The tour facts kept for comparison when a Tour ID returns for re-approval. */
export interface TourFacts {
  venue: string;
  arrivalAt: string;
  departureAt: string;
  paxTotal: number;
  paxFaiz: number;
  paxHotel: number;
  option: number;
  entryPort: string;
  exitPort: string;
  mawaid: boolean;
  segments: Segment[];
}
export const factsOf = (t: ApprovalTour, segments: Segment[] = t.previousPlans): TourFacts => ({
  venue: t.venue, arrivalAt: t.arrivalAt, departureAt: t.departureAt, paxTotal: t.paxTotal, paxFaiz: t.paxFaiz,
  paxHotel: t.paxHotel, option: t.option, entryPort: t.entryPort, exitPort: t.exitPort, mawaid: t.mawaid, segments,
});

export type RecordStatus = 'new' | 'approved' | 'reapproval-pending' | 'reapproval-reviewed' | 're-approved' | 'left-queue';
export type ApprovalState = 'attempting' | 'api_reported_approved' | 'api_rejected' | 'uncertain_no_retry';

/** What the app keeps per Tour ID: history, the approver's edits, review and approval outcomes. */
export interface ApprovalRecord {
  id: number;
  ref: string;
  office: string;
  status: RecordStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Facts as last submitted while waiting for first approval. */
  submittedFacts?: TourFacts;
  /** Facts at the last approval (from the app, or the previous approval NKERP reported). */
  approvedFacts?: TourFacts;
  approvedAt?: string;
  reapprovalSince?: string;
  reviewedAt?: string;
  /** The NKERP ModifiedOn the review covered; a later change returns the tour to Re-Approval Pending. */
  reviewedModifiedOn?: string;
  /** The approver's own city dates, kept until NKERP changes the tour. */
  edits?: { segments: Segment[]; at: string; modifiedOn: string };
  approval?: { state: ApprovalState; at: string; message?: string; segments: Segment[]; reapproval: boolean };
  history: { at: string; kind: string; note?: string }[];
}

// ------------------------------------------------------------------------------------------------ dates

const DAY = 86_400_000;
const OFFSET = 3 * 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** NKERP instant (UTC, maybe no suffix) as epoch ms. */
export function instantMs(v: string): number {
  const s = String(v || '').trim();
  if (!s) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
}
/** The Baghdad calendar date of an NKERP instant. */
export const localDay = (v: string) => { const ms = instantMs(v); return Number.isFinite(ms) ? iso(ms + OFFSET) : ''; };
export const localTime = (v: string) => {
  const ms = instantMs(v);
  return Number.isFinite(ms) ? new Date(ms + OFFSET).toISOString().slice(11, 16) : '';
};
export const addDays = (d: string, n: number) => iso(Date.parse(d + 'T00:00:00Z') + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
export function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
export const todayBaghdad = (now = Date.now()) => iso(now + OFFSET);
/** Baghdad midnight of a date as a UTC ISO instant, plus `offsetMs` (the UI's city-plan serializer). */
export const midnightUtc = (d: string, offsetMs = 0) => new Date(Date.parse(d + 'T00:00:00Z') - OFFSET + offsetMs).toISOString();
/** A city-plan row's human dates: StartDate is local midnight; EndDate is local midnight, or 2 ms before it. */
export const planStartDay = (v: string) => localDay(v);
export const planEndDay = (v: string) => { const ms = instantMs(v); return Number.isFinite(ms) ? iso(ms + 5 + OFFSET) : ''; };

export const tripStart = (t: Pick<ApprovalTour, 'arrivalAt'>) => localDay(t.arrivalAt);
export const tripEnd = (t: Pick<ApprovalTour, 'departureAt'>) => localDay(t.departureAt);
export const nightsOf = (s: Segment) => daysBetween(s.start, s.end);
export function cityNights(segments: Segment[]) {
  const out: Record<City, number> = { KARBALA: 0, NAJAF: 0 };
  for (const s of segments) out[s.city] += nightsOf(s);
  return out;
}
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (d: string, withYear = false) => {
  if (!/^\d{4}-\d\d-\d\d$/.test(d)) return d || '—';
  const [y, m, dd] = d.split('-');
  return `${Number(dd)} ${MONTH_SHORT[Number(m) - 1]}${withYear ? ' ' + y : ''}`;
};
export const fmtSegments = (segments: Segment[]) =>
  segments.length ? segments.map(s => `${CITY_NAME[s.city]} ${fmtDay(s.start)}–${fmtDay(s.end)}`).join(' → ') : '—';

// ------------------------------------------------------------------------------------------------ splits

/**
 * Two stays in the given order over the whole trip. Karbala gets the extra night when the total is odd.
 * One night goes to one city (Karbala first unless Najaf is asked for first and there is no second night).
 */
export function splitInOrder(start: string, end: string, first: City): Segment[] {
  const n = daysBetween(start, end);
  if (n <= 0) return [];
  if (n === 1) return [{ city: first === 'NAJAF' ? 'NAJAF' : 'KARBALA', start, end }];
  const karbala = Math.ceil(n / 2);
  const najaf = n - karbala;
  const mid = addDays(start, first === 'KARBALA' ? karbala : najaf);
  const second: City = first === 'KARBALA' ? 'NAJAF' : 'KARBALA';
  return [{ city: first, start, end: mid }, { city: second, start: mid, end }];
}

/** Problems that stop NKERP accepting these stays for this trip. Empty means valid. */
export function segmentProblems(segments: Segment[], start: string, end: string): string[] {
  const out: string[] = [];
  if (!segments.length) return ['No city stays yet.'];
  const valid = (d: string) => /^\d{4}-\d\d-\d\d$/.test(d);
  segments.forEach((s, i) => {
    if (!valid(s.start) || !valid(s.end)) out.push(`${CITY_NAME[s.city]}: enter both dates.`);
    else if (s.end <= s.start) out.push(`${CITY_NAME[s.city]} departure must be after its arrival.`);
    if (i && segments[i - 1].end !== s.start) out.push(`${CITY_NAME[s.city]} arrival must be the ${CITY_NAME[segments[i - 1].city]} departure date (${fmtDay(segments[i - 1].end)}).`);
    if (i && segments[i - 1].city === s.city) out.push('Two stays in a row in the same city.');
  });
  if (segments[0].start !== start) out.push(`The first stay must start on the Iraq arrival date (${fmtDay(start)}).`);
  if (segments[segments.length - 1].end !== end) out.push(`The last stay must end on the Iraq departure date (${fmtDay(end)}).`);
  return out;
}

/** The planner's four editable fields (Karbala arrival/departure, Najaf arrival/departure). */
export interface SubvenueDates { karbalaArrival: string; karbalaDeparture: string; najafArrival: string; najafDeparture: string }
export function toSubvenueDates(segments: Segment[]): SubvenueDates {
  const k = segments.filter(s => s.city === 'KARBALA');
  const n = segments.filter(s => s.city === 'NAJAF');
  return {
    karbalaArrival: k[0]?.start || '', karbalaDeparture: k[k.length - 1]?.end || '',
    najafArrival: n[0]?.start || '', najafDeparture: n[n.length - 1]?.end || '',
  };
}
/** Stays from the four fields, in date order. A city left blank is not visited. */
export function fromSubvenueDates(d: SubvenueDates): Segment[] {
  const out: Segment[] = [];
  if (d.karbalaArrival || d.karbalaDeparture) out.push({ city: 'KARBALA', start: d.karbalaArrival, end: d.karbalaDeparture });
  if (d.najafArrival || d.najafDeparture) out.push({ city: 'NAJAF', start: d.najafArrival, end: d.najafDeparture });
  return out.sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
}
export const firstCity = (segments: Segment[]): City | null => segments[0]?.city ?? null;

// ------------------------------------------------------------------------------------------------ chat

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const CITY_RE = /\b(karbala|kerbala|karbla|karballa|najaf|najf|najaf\s*e?\s*ashraf)\b/gi;
const cityWord = (w: string): City => (/^n/i.test(w) ? 'NAJAF' : 'KARBALA');
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';
// "29 Nov", "29th November 2026", "29-Nov-26", or "29/11", "29-11-2026", "29.11.26".
const DATE_SRC = `(?:(\\d{1,2})${ORD}[\\s\\-\\/.]*${MONTH_WORD}\\.?(?:[\\s,\\-\\/.]*(\\d{4}|\\d{2})(?!\\d))?|(\\d{1,2})[\\/\\-.](\\d{1,2})(?:[\\/\\-.](\\d{4}|\\d{2}))?(?!\\d))`;
const RANGE_RE = new RegExp(`(?:(\\d{1,2})${ORD}\\s*|${DATE_SRC})\\s*(?:to|till|until|upto|up\\s*to|-|–|—|&|and)\\s*${DATE_SRC}`, 'gi');

function pickYear(month: number, dayOfMonth: number, around: string, explicit?: string): string | null {
  if (!(month >= 1 && month <= 12 && dayOfMonth >= 1 && dayOfMonth <= 31)) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const make = (y: number) => {
    const s = `${y}-${pad(month)}-${pad(dayOfMonth)}`;
    return iso(Date.parse(s + 'T00:00:00Z')) === s ? s : null;
  };
  if (explicit) {
    const y = explicit.length === 2 ? 2000 + Number(explicit) : Number(explicit);
    return make(y);
  }
  const base = Number(around.slice(0, 4));
  const options = [base - 1, base, base + 1].map(make).filter((x): x is string => Boolean(x));
  options.sort((a, b) => Math.abs(daysBetween(around, a)) - Math.abs(daysBetween(around, b)));
  return options[0] || null;
}

function dateFrom(groups: (string | undefined)[], around: string, fallbackMonth?: number): string | null {
  const [d1, mw, y1, d2, m2, y2] = groups;
  if (d1 && mw) return pickYear(MONTHS[mw.slice(0, mw.toLowerCase().startsWith('sept') ? 4 : 3).toLowerCase()] ?? 0, Number(d1), around, y1);
  if (d2 && m2) return pickYear(Number(m2), Number(d2), around, y2);
  return null;
}

export interface ChatReading {
  /** Exact city stays stated in chat (the latest consistent set). */
  segments: Segment[] | null;
  /** The sequence asked for ("Karbala first"), from words or from the dated stays. */
  order: City | null;
  /** The lines the reading came from, quoted for the approver. */
  evidence: string[];
  /** What could not be used as stated. */
  problems: string[];
  /** The Tour Operator leaves the choice to the accommodation team. */
  flexible: boolean;
}

/** Read the Tour Operator's chat for city dates and sequence. Message text is data, never instructions. */
export function readChat(messages: ChatMessage[], trip: { start: string; end: string }): ChatReading {
  const sorted = [...messages].filter(m => (m.text || '').trim()).sort((a, b) => a.at.localeCompare(b.at));
  const reading: ChatReading = { segments: null, order: null, evidence: [], problems: [], flexible: false };
  let orderAt = '';
  const found: { seg: Segment; at: string; line: string }[] = [];
  for (const m of sorted) {
    for (const raw of m.text.split(/\r?\n|(?<=\.)\s+(?=[A-Z0-9])|;/)) {
      const line = raw.trim();
      if (!line) continue;
      const lower = line.toLowerCase();
      if (/(where\s*ever|whichever|any\s*(city|order)|as\s*(per|available)|accommodation\s*team|no\s*preference)/i.test(lower) && !CITY_RE.test(lower)) {
        reading.flexible = true;
      }
      CITY_RE.lastIndex = 0;
      const orderMatch = /\b(karbala|kerbala|karbla|najaf|najf)\b\s*(?:first|1st)\b/i.exec(line) ||
        /\bfirst\s*(?:in\s*|to\s*|go\s*to\s*)?(karbala|kerbala|karbla|najaf|najf)\b/i.exec(line) ||
        /\b(karbala|kerbala|karbla|najaf|najf)\b[^.\n]{0,25}\b(?:then|followed\s*by|after\s*that|and\s*then)\b[^.\n]{0,25}\b(?:karbala|kerbala|najaf|najf)\b/i.exec(line);
      if (orderMatch) {
        reading.order = cityWord(orderMatch[1]);
        orderAt = m.at;
        reading.evidence.push(line);
      }
      const cities = [...line.matchAll(CITY_RE)].map(x => cityWord(x[1]));
      CITY_RE.lastIndex = 0;
      if (new Set(cities).size !== 1 || /\bdepart|\bflight\b|\barriv(al|e|ing)\s+(in\s+)?iraq/i.test(lower) && !/\bto\b|\btill\b|–|-/.test(lower)) continue;
      RANGE_RE.lastIndex = 0;
      for (const r of line.matchAll(RANGE_RE)) {
        const g = r.slice(1);
        // g[0]: bare start day ("29 to 1 Dec"); g[1..6]: full start date; g[7..12]: end date.
        const end = dateFrom(g.slice(7, 13), trip.start || todayBaghdad());
        if (!end) continue;
        let start = dateFrom(g.slice(1, 7), end);
        if (!start && g[0]) {
          const dd = Number(g[0]);
          const sameMonth = `${end.slice(0, 8)}${String(dd).padStart(2, '0')}`;
          start = dd <= Number(end.slice(8)) ? sameMonth : pickYear(((Number(end.slice(5, 7)) + 10) % 12) + 1, dd, end);
        }
        if (!start) continue;
        found.push({ seg: { city: cities[0], start, end }, at: m.at, line });
      }
    }
  }
  if (found.length) {
    // The latest set: the last dated message and the dated messages sent shortly before it.
    const latest = found[found.length - 1].at;
    const cluster = found.filter(f => Math.abs(instantMs(latest) - instantMs(f.at)) <= 6 * 3_600_000);
    const unique = new Map<string, { seg: Segment; line: string }>();
    for (const f of cluster) unique.set(`${f.seg.city}|${f.seg.start}`, f);
    const segs = [...unique.values()].sort((a, b) => a.seg.start.localeCompare(b.seg.start));
    // "2 to 4 Dec Karbala, 5 to 7 Dec Najaf": NKERP needs one shared transfer date, so the later date is it.
    const chained: Segment[] = [];
    for (const { seg } of segs) {
      const prev = chained[chained.length - 1];
      if (prev && prev.city === seg.city && prev.end >= seg.start) { prev.end = seg.end > prev.end ? seg.end : prev.end; continue; }
      if (prev && daysBetween(prev.end, seg.start) === 1) {
        reading.problems.push(`Chat leaves a day between ${CITY_NAME[prev.city]} (until ${fmtDay(prev.end)}) and ${CITY_NAME[seg.city]} (from ${fmtDay(seg.start)}); the transfer is taken as ${fmtDay(seg.start)}.`);
        prev.end = seg.start;
      }
      chained.push({ ...seg });
    }
    reading.segments = chained;
    reading.evidence.push(...segs.map(s => s.line).filter(l => !reading.evidence.includes(l)));
    const chatOrder = chained[0]?.city ?? null;
    // Dated stays decide the sequence, unless a later message asked for another order.
    if (!reading.order || !orderAt || orderAt <= latest) reading.order = chatOrder;
    if (trip.start && trip.end) {
      const p = segmentProblems(chained, trip.start, trip.end);
      if (p.length) reading.problems.push(`Chat dates ${fmtSegments(chained)} do not match the Iraq trip ${fmtDay(trip.start)}–${fmtDay(trip.end)}.`);
    }
  }
  if (reading.order) reading.flexible = false;
  return reading;
}

// ------------------------------------------------------------------------------------------------ submission

export type SubmissionState = 'complete' | 'wait' | 'follow-up';
export function submissionState(t: Pick<ApprovalTour, 'dustbin' | 'arrivalAt'>, cutoffDays: number, today = todayBaghdad()) {
  const daysToArrival = daysBetween(today, tripStart(t));
  const state: SubmissionState = !t.dustbin ? 'complete' : daysToArrival <= cutoffDays ? 'follow-up' : 'wait';
  return { state, daysToArrival, cutoffDays };
}
/** NKERP's Delete Tour icon rule (Tour Admin queue, role 74). */
export function dustbinVisible(row: { IsActive?: unknown; IsLocked?: unknown; IsMuwaficaLocked?: unknown; MuwaficaStateId?: unknown }) {
  return row.IsActive == true && row.IsLocked == false && row.IsMuwaficaLocked == false &&
    ![32, 33, 2].includes(Number(row.MuwaficaStateId));
}

/** Faiz/Fayz Husaini offices come first (all spelling variants). */
export const isFaizOffice = (office: string) => {
  const n = office.toLowerCase().replace(/[^a-z]/g, '');
  return (n.startsWith('faiz') || n.startsWith('fayz') || n.startsWith('faize')) && n.includes('hus');
};

// ------------------------------------------------------------------------------------------------ re-approval

export type ChangeCategory = 'Venue Change' | 'Subvenue Change' | 'Departure Date' | 'Hotel Accommodation' | 'Faiz Accommodation' | 'Other Changes';
export const CHANGE_CATEGORIES: ChangeCategory[] = ['Venue Change', 'Subvenue Change', 'Departure Date', 'Hotel Accommodation', 'Faiz Accommodation', 'Other Changes'];
export interface Change { category: ChangeCategory; field: string; before: string; after: string }

const dt = (v: string) => (v ? `${fmtDay(localDay(v), true)} ${localTime(v)}` : '—');
/**
 * What changed since the previous approval. `original` may be partial: without stored facts only the previous
 * city stays (and the old Faiz pax from the dashboard) are known.
 */
export function compareWithOriginal(t: ApprovalTour, original: Partial<TourFacts>, requested: Segment[] | null,
  events: TourEvent[] = [], approvedAt?: string): Change[] {
  const out: Change[] = [];
  const push = (category: ChangeCategory, field: string, before: unknown, after: unknown) =>
    out.push({ category, field, before: String(before ?? '—'), after: String(after ?? '—') });
  if (original.venue !== undefined && original.venue !== t.venue) push('Venue Change', 'Venue', original.venue, t.venue);
  const prevSegs = original.segments ?? [];
  const prevStart = original.arrivalAt ? localDay(original.arrivalAt) : prevSegs[0]?.start;
  const prevEnd = original.departureAt ? localDay(original.departureAt) : prevSegs[prevSegs.length - 1]?.end;
  if (prevEnd && prevEnd !== tripEnd(t)) push('Departure Date', 'Iraq departure', fmtDay(prevEnd, true), fmtDay(tripEnd(t), true));
  else if (original.departureAt && localTime(original.departureAt) !== localTime(t.departureAt)) push('Departure Date', 'Departure time', dt(original.departureAt), dt(t.departureAt));
  if (prevStart && prevStart !== tripStart(t)) push('Other Changes', 'Iraq arrival', fmtDay(prevStart, true), fmtDay(tripStart(t), true));
  if (prevSegs.length && requested?.length) {
    const sameOrder = prevSegs.map(s => s.city).join() === requested.map(s => s.city).join();
    const sameDates = sameOrder && prevSegs.every((s, i) => s.start === requested[i].start && s.end === requested[i].end);
    if (!sameDates) push('Subvenue Change', sameOrder ? 'City dates' : 'City sequence', fmtSegments(prevSegs), fmtSegments(requested));
  }
  if (original.option !== undefined && original.option !== t.option) {
    const label = (o?: number) => (o === 2 ? 'Required' : o === 3 ? 'Not Required' : o === 1 ? 'Preferred' : '—');
    const cat: ChangeCategory = original.option === 2 || t.option === 2 ? 'Faiz Accommodation' : 'Hotel Accommodation';
    push(cat, 'Accommodation in Faiz', label(original.option), label(t.option));
  }
  if (original.paxFaiz !== undefined && original.paxFaiz !== t.paxFaiz) push('Faiz Accommodation', 'Faiz pax', original.paxFaiz, t.paxFaiz);
  if (original.paxHotel !== undefined && original.paxHotel !== t.paxHotel) push('Hotel Accommodation', 'Hotel pax', original.paxHotel, t.paxHotel);
  if (original.paxTotal !== undefined && original.paxTotal !== t.paxTotal) push('Other Changes', 'Total pax', original.paxTotal, t.paxTotal);
  if (original.entryPort !== undefined && original.entryPort !== t.entryPort) push('Other Changes', 'Entry port', original.entryPort, t.entryPort);
  if (original.exitPort !== undefined && original.exitPort !== t.exitPort) push('Other Changes', 'Exit port', original.exitPort, t.exitPort);
  if (original.mawaid !== undefined && original.mawaid !== t.mawaid) push('Other Changes', 'Mawaid', original.mawaid ? 'Yes' : 'No', t.mawaid ? 'Yes' : 'No');
  if (original.arrivalAt && prevStart === tripStart(t) && localTime(original.arrivalAt) !== localTime(t.arrivalAt)) push('Other Changes', 'Arrival time', dt(original.arrivalAt), dt(t.arrivalAt));
  // NKERP's tour history after the last approval names the edits the Tour Operator made.
  const approvals = events.filter(e => /approved/i.test(e.event)).map(e => e.at).sort();
  const since = approvedAt && (!approvals.length || approvedAt > approvals[approvals.length - 1]) ? approvedAt : approvals[approvals.length - 1];
  if (since) {
    // Only the Tour Operator's own edits; workflow notices (transport, Ziyarat, Muwafiqa) are not changes.
    const later = events.filter(e => e.at > since && (e.event || e.remarks).trim() && !/approv/i.test(e.event) &&
      /applicant|itinerary|tour has been updated|disintegrat|pax|date|port|accommodation option/i.test(e.event || e.remarks) &&
      !/awaiting|ziyarat|muwafiqa|locked|fee|grace/i.test(e.event || e.remarks));
    const kinds = [...new Set(later.map(e => (e.event || e.remarks).trim()))];
    for (const k of kinds.slice(0, 6)) push('Other Changes', 'NKERP history', '', k);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ capacity

export type Load = Record<City, Record<string, number>>;
const emptyLoad = (): Load => ({ NAJAF: {}, KARBALA: {} });
function addLoad(load: Load, segments: Segment[], pax: number) {
  if (!pax) return;
  // A same-city visit on the same day counts once; a transfer day counts in both cities (conservative).
  for (const city of CITIES) {
    const days = new Set(segments.filter(s => s.city === city).flatMap(s => dayRange(s.start, s.end)));
    for (const d of days) load[city][d] = (load[city][d] ?? 0) + pax;
  }
}
/** Spread a tour whose sequence is still unknown: each day gets each city's share of the nights. */
function addExpected(load: Load, start: string, end: string, pax: number) {
  const n = daysBetween(start, end);
  if (n <= 0 || !pax) return;
  const k = Math.ceil(n / 2) / n;
  for (const d of dayRange(start, end)) {
    load.KARBALA[d] = (load.KARBALA[d] ?? 0) + pax * k;
    load.NAJAF[d] = (load.NAJAF[d] ?? 0) + pax * (1 - k);
  }
}
const at = (load: Load, city: City, d: string) => load[city][d] ?? 0;

export type Category = 'ready' | 'awaiting' | 'pending-submission' | 'reapproval';
export type Recommendation = 'approve' | 'hold-capacity' | 'wait' | 'follow-up' | 'needs-chat' | 'resolve' | 'review-changes' | 'done';
export type SegmentSource = 'edited' | 'chat-dates' | 'chat-order' | 'balanced' | 'previous' | 'none';

export interface DayImpact { city: City; date: string; before: number; after: number; limit: number }
export interface Alternative { segments: Segment[]; fits: boolean; over: DayImpact[]; impact: DayImpact[]; benefit: string }

export interface TourPlan {
  tour: ApprovalTour;
  record?: ApprovalRecord;
  kind: 'faiz' | 'hotel' | 'mixed' | 'preferred';
  submission: ReturnType<typeof submissionState>;
  chat: ChatReading;
  /** The AI suggestion (before the approver's edits). */
  suggested: Segment[];
  suggestedSource: SegmentSource;
  /** What will be approved: the approver's edit, else the suggestion. */
  segments: Segment[];
  source: SegmentSource;
  /** The sequence may be chosen for capacity (Faiz tour with no chat request and no edit). */
  flexible: boolean;
  problems: string[];
  notes: string[];
  category: Category;
  recommendation: Recommendation;
  priority: number;
  fits: boolean;
  over: DayImpact[];
  impact: DayImpact[];
  alternative?: Alternative;
  original?: Partial<TourFacts>;
  originalSource?: 'app' | 'nkerp';
  changes: Change[];
  oldFaiz: { city: City; date: string; pax: number }[];
}

export interface CapacityRow {
  date: string;
  city: City;
  limit: number;
  approved: number;
  pendingApproval: number;
  buffer: number;
  available: number;
  recommended: number;
  hotelApproved: number;
  hotelPending: number;
}

export interface ShiftSuggestion {
  /** The planned Tour ID whose whole group moves to the other order. */
  move: TourPlan;
  from: Segment[];
  to: Segment[];
  /** The held Tour ID it makes room for. */
  admits: TourPlan;
  admitsWith: Segment[];
  impact: DayImpact[];
  benefit: string;
}

export interface ApprovalPlan {
  plans: TourPlan[];
  capacity: CapacityRow[];
  days: string[];
  shifts: ShiftSuggestion[];
  counts: {
    newApprovals: number; reapprovalPending: number; reapprovalReviewed: number; reApproved: number;
    ready: number; awaiting: number; pendingSubmission: number; followUp: number;
  };
  settings: ApprovalSettings;
  today: string;
}

const kindOf = (t: ApprovalTour): TourPlan['kind'] =>
  t.option === 1 ? 'preferred' : t.option === 3 ? 'hotel' : t.paxHotel > 0 && t.paxFaiz > 0 ? 'mixed' : t.paxFaiz > 0 ? 'faiz' : 'hotel';

function impactOf(segments: Segment[], pax: number, base: Load, limits: Record<City, number>): { impact: DayImpact[]; over: DayImpact[] } {
  const add = emptyLoad();
  addLoad(add, segments, pax);
  const impact: DayImpact[] = [];
  for (const city of CITIES) for (const date of Object.keys(add[city]).sort()) {
    const before = Math.round(at(base, city, date));
    impact.push({ city, date, before, after: before + add[city][date], limit: limits[city] });
  }
  impact.sort((a, b) => a.date.localeCompare(b.date) || a.city.localeCompare(b.city));
  return { impact, over: impact.filter(i => i.after > i.limit && i.after > i.before) };
}
/** Peak share of either city's limit over the touched days (lower is better balanced). */
const peak = (impact: DayImpact[]) => impact.reduce((m, i) => Math.max(m, i.after / i.limit), 0);
const najafNights = (segments: Segment[]) => cityNights(segments).NAJAF;
function describeBenefit(chosen: DayImpact[], other: DayImpact[]): string {
  const sum = (xs: DayImpact[], city: City) => xs.filter(x => x.city === city).reduce((s, x) => s + Math.max(0, x.after - x.limit), 0);
  const overN = sum(other, 'NAJAF') - sum(chosen, 'NAJAF');
  const overK = sum(other, 'KARBALA') - sum(chosen, 'KARBALA');
  const parts: string[] = [];
  if (overN > 0) parts.push(`avoids ${overN} pax-days over the Najaf limit`);
  if (overK > 0) parts.push(`avoids ${overK} pax-days over the Karbala limit`);
  if (!parts.length) parts.push(`keeps the busiest day at ${Math.round(peak(chosen) * 100)}% instead of ${Math.round(peak(other) * 100)}%`);
  return parts.join(' and ');
}

/**
 * Plan every Tour ID in the queues jointly against what NKERP has already approved, keeping a buffer for tours
 * whose submissions are still incomplete. Priority: re-approvals, then Faiz Husaini offices, then the rest,
 * each by arrival. A tour that does not fit is held, never split.
 */
export function planApprovals(snapshot: ApprovalSnapshot, records: Record<string, ApprovalRecord>,
  settings: ApprovalSettings, today = todayBaghdad()): ApprovalPlan {
  const limits = settings.limits;
  const tours = snapshot.tours;
  const underReview = new Set(tours.map(t => t.id));
  // Approved load, less what tours being (re)approved held before: they are planned again below.
  const approved = emptyLoad();
  const hotelApproved = emptyLoad();
  const oldFaiz = new Map<number, { city: City; date: string; pax: number }[]>();
  for (const cell of snapshot.dashboard) {
    let a = cell.approved;
    for (const o of cell.occupants) if (underReview.has(o.id)) {
      a -= o.faiz;
      const list = oldFaiz.get(o.id) ?? [];
      list.push({ city: cell.city, date: cell.date, pax: o.faiz });
      oldFaiz.set(o.id, list);
    }
    approved[cell.city][cell.date] = Math.max(0, a);
    hotelApproved[cell.city][cell.date] = cell.hotel;
  }

  // Buffer: Faiz pax of tours still missing submissions, kept free on their dates.
  const buffer = emptyLoad();
  const hotelPending = emptyLoad();
  const plans: TourPlan[] = [];
  for (const t of tours) {
    const start = tripStart(t), end = tripEnd(t);
    const record = records[String(t.id)];
    const chat = readChat(t.messages, { start, end });
    const kind = kindOf(t);
    const submission = submissionState(t, settings.cutoffDays, today);
    const problems: string[] = [];
    const notes: string[] = [];
    let suggested: Segment[] = [];
    let suggestedSource: SegmentSource = 'none';
    let flexible = false;
    const chatOk = chat.segments && !segmentProblems(chat.segments, start, end).length;
    if (chatOk) { suggested = chat.segments!; suggestedSource = 'chat-dates'; }
    else if (chat.order) { suggested = splitInOrder(start, end, chat.order); suggestedSource = 'chat-order'; }
    else if (kind === 'hotel') {
      problems.push('Chat box has no city dates or sequence: hotel stays are approved only on the dates the Tour Operator gives.');
    } else if (t.reapproval && t.previousPlans.length && !segmentProblems(t.previousPlans, start, end).length) {
      suggested = t.previousPlans; suggestedSource = 'previous';
      notes.push('Keeps the previously approved city stays (they still fit the trip).');
    } else { suggested = splitInOrder(start, end, 'KARBALA'); suggestedSource = 'balanced'; flexible = true; }
    // Hotel stays need the exact dates; a Faiz tour can follow the requested sequence instead.
    if (chat.segments && !chatOk && (kind === 'hotel' || !chat.order)) problems.push(...chat.problems);
    else if (chat.problems.length) notes.push(...chat.problems);
    if (chat.flexible) notes.push('Tour Operator leaves the city order to the accommodation team.');
    if (kind === 'preferred') problems.push('Accommodation option is "Preferred": confirm Required or Not Required in NKERP before approving.');
    if (t.linkedTourId) problems.push(`Linked to tour ${t.linkedTourId}: approve it in NKERP so the link is kept.`);
    if (t.packageId) problems.push('Package tour: approve it in NKERP so the package rules are kept.');
    if (t.paxFaiz + t.paxHotel !== t.paxTotal) problems.push(`Pax do not add up (${t.paxFaiz} Faiz + ${t.paxHotel} hotel ≠ ${t.paxTotal}).`);
    if (daysBetween(start, end) < 1) problems.push('The Iraq arrival and departure fall on the same day.');
    if (kind === 'hotel' && !t.unread && !t.reapproval) notes.push('No unread (red) message in NKERP for this hotel tour.');

    // The approver's edits stand until NKERP changes the tour.
    const edit = record?.edits && record.edits.modifiedOn === t.modifiedOn ? record.edits.segments : null;
    const segments = edit ?? suggested;
    const source: SegmentSource = edit ? 'edited' : suggestedSource;
    if (edit) flexible = false;
    const segProblems = segments.length ? segmentProblems(segments, start, end) : [];
    problems.push(...segProblems);

    // Original approval for re-approvals: the app's record first, else what NKERP still holds.
    let original: Partial<TourFacts> | undefined;
    let originalSource: TourPlan['originalSource'];
    if (t.reapproval) {
      const facts = record?.approvedFacts ?? record?.submittedFacts;
      if (facts) { original = { ...facts, segments: t.previousPlans.length ? t.previousPlans : facts.segments }; originalSource = 'app'; }
      else {
        original = { segments: t.previousPlans };
        const old = oldFaiz.get(t.id);
        if (old?.length) original.paxFaiz = Math.max(...old.map(o => o.pax));
        originalSource = 'nkerp';
      }
    }
    const changes = t.reapproval && original ? compareWithOriginal(t, original, chatOk ? chat.segments : segments, t.events, record?.approvedAt) : [];
    plans.push({
      tour: t, record, kind, submission, chat, suggested, suggestedSource, segments, source, flexible, problems, notes,
      category: 'awaiting', recommendation: 'resolve', fits: true, over: [], impact: [], original, originalSource, changes,
      oldFaiz: oldFaiz.get(t.id) ?? [],
      priority: (t.reapproval ? 0 : 2) + (isFaizOffice(t.office) ? 0 : 1),
    });
  }

  for (const p of plans) {
    const t = p.tour;
    if (p.submission.state === 'complete' && !t.reapproval) continue;
    if (t.reapproval) continue;
    const pax = t.option === 3 ? 0 : t.paxFaiz || (t.option === 1 ? t.paxTotal : 0);
    if (p.source === 'chat-dates' || p.source === 'chat-order' || p.source === 'edited') addLoad(buffer, p.segments, pax);
    else addExpected(buffer, tripStart(t), tripEnd(t), pax);
  }
  const scale = settings.bufferPercent / 100;
  for (const city of CITIES) for (const d of Object.keys(buffer[city])) buffer[city][d] = Math.ceil(buffer[city][d] * scale);

  // Joint plan of submitted tours, in priority order, reserving each as it is planned.
  const reserved = emptyLoad();
  const base = () => {
    const b = emptyLoad();
    for (const city of CITIES) for (const d of new Set([...Object.keys(approved[city]), ...Object.keys(buffer[city]), ...Object.keys(reserved[city])])) {
      b[city][d] = at(approved, city, d) + at(buffer, city, d) + at(reserved, city, d);
    }
    return b;
  };
  const queue = plans.filter(p => p.submission.state === 'complete' || p.tour.reapproval)
    .sort((a, b) => a.priority - b.priority || a.tour.arrivalAt.localeCompare(b.tour.arrivalAt) || a.tour.id - b.tour.id);
  for (const p of queue) {
    const t = p.tour;
    const done = p.record?.approval && ['api_reported_approved', 'attempting', 'uncertain_no_retry'].includes(p.record.approval.state) &&
      p.record.approval.reapproval === t.reapproval;
    if (p.segments.length && !p.problems.length) {
      const b = base();
      const pax = t.paxFaiz;
      let { impact, over } = impactOf(p.segments, pax, b, limits);
      if (p.flexible && pax) {
        const other = splitInOrder(tripStart(t), tripEnd(t), firstCity(p.segments) === 'KARBALA' ? 'NAJAF' : 'KARBALA');
        if (other.length && other.map(s => s.city).join() !== p.segments.map(s => s.city).join()) {
          const alt = impactOf(other, pax, b, limits);
          const better = (alt.over.length < over.length) || (alt.over.length === over.length &&
            (peak(alt.impact) < peak(impact) - 1e-9 || (Math.abs(peak(alt.impact) - peak(impact)) < 1e-9 && najafNights(other) > najafNights(p.segments))));
          if (better) {
            p.alternative = { segments: p.segments, fits: !over.length, over, impact, benefit: describeBenefit(alt.impact, impact) };
            p.notes.push(`AI chose ${CITY_NAME[other[0].city]} first: ${describeBenefit(alt.impact, impact)}.`);
            p.segments = other; p.suggested = other; impact = alt.impact; over = alt.over;
          } else {
            p.alternative = { segments: other, fits: !alt.over.length, over: alt.over, impact: alt.impact, benefit: describeBenefit(impact, alt.impact) };
          }
        }
      } else if (pax && p.segments.length === 2 && (p.source === 'chat-dates' || p.source === 'chat-order' || p.source === 'previous')) {
        const other = splitInOrder(tripStart(t), tripEnd(t), p.segments[1].city);
        const alt = impactOf(other, pax, b, limits);
        if (over.length && alt.over.length < over.length) {
          p.alternative = { segments: other, fits: !alt.over.length, over: alt.over, impact: alt.impact, benefit: describeBenefit(alt.impact, impact) };
          p.notes.push(`The requested sequence does not fit capacity; ${CITY_NAME[other[0].city]} first would (${p.alternative.benefit}). Ask the Tour Operator before changing it.`);
        }
      }
      p.impact = impact; p.over = over; p.fits = !over.length;
      if (p.fits || done) addLoad(reserved, p.segments, pax);
      if (!p.fits && !done) {
        const worst = over.reduce((m, o) => (o.after - o.limit > m.after - m.limit ? o : m), over[0]);
        p.problems.push(`Over the ${CITY_NAME[worst.city]} limit on ${fmtDay(worst.date)} by ${worst.after - worst.limit} pax (${worst.after}/${worst.limit}${worst.before >= worst.limit ? `; already ${worst.before} before this tour` : ''}).`);
      }
    }
    for (const s of p.segments) if (t.paxHotel) addLoad(hotelPending, [s], t.paxHotel);
    const blocked = p.problems.some(x => !/^Over the /.test(x));
    p.category = t.reapproval ? 'reapproval' : !blocked && p.fits ? 'ready' : 'awaiting';
    const reviewed = p.record?.status === 'reapproval-reviewed' && p.record.reviewedModifiedOn === t.modifiedOn;
    p.recommendation = done ? 'done'
      : !p.segments.length && p.kind === 'hotel' ? 'needs-chat'
      : blocked ? 'resolve'
      : !p.fits ? 'hold-capacity'
      : t.reapproval && p.changes.length && !reviewed ? 'review-changes'
      : 'approve';
  }
  for (const p of plans) if (p.submission.state !== 'complete' && !p.tour.reapproval) {
    p.category = 'pending-submission';
    p.recommendation = p.submission.state === 'follow-up' ? 'follow-up' : 'wait';
    // Show where the tour would land, without reserving it.
    if (p.segments.length && !segmentProblems(p.segments, tripStart(p.tour), tripEnd(p.tour)).length) {
      const r = impactOf(p.segments, p.tour.paxFaiz, base(), limits);
      p.impact = r.impact; p.over = r.over; p.fits = !r.over.length;
    }
  }

  // Whole-tour shifts: flip a flexible planned tour's order if that lets a held tour fit.
  const shifts: ShiftSuggestion[] = [];
  const held = queue.filter(p => p.recommendation === 'hold-capacity');
  const movable = queue.filter(p => p.fits && p.flexible && p.recommendation !== 'done' && p.tour.paxFaiz > 0);
  for (const h of held) {
    for (const m of movable) {
      const flipped = splitInOrder(tripStart(m.tour), tripEnd(m.tour), firstCity(m.segments) === 'KARBALA' ? 'NAJAF' : 'KARBALA');
      if (flipped.map(s => s.city).join() === m.segments.map(s => s.city).join()) continue;
      const trial = base();
      // Take the moving tour out, put it back flipped.
      const minus = emptyLoad(); addLoad(minus, m.segments, m.tour.paxFaiz);
      for (const city of CITIES) for (const d of Object.keys(minus[city])) trial[city][d] -= minus[city][d];
      const flipCheck = impactOf(flipped, m.tour.paxFaiz, trial, limits);
      if (flipCheck.over.length) continue;
      addLoad(trial, flipped, m.tour.paxFaiz);
      const options = h.flexible ? [h.segments, splitInOrder(tripStart(h.tour), tripEnd(h.tour), firstCity(h.segments) === 'KARBALA' ? 'NAJAF' : 'KARBALA')] : [h.segments];
      const fit = options.map(segs => ({ segs, r: impactOf(segs, h.tour.paxFaiz, trial, limits) })).find(o => !o.r.over.length);
      if (!fit) continue;
      const days = new Set([...m.segments, ...flipped].flatMap(s => dayRange(s.start, s.end)));
      const impact: DayImpact[] = [];
      const now = base();
      for (const city of CITIES) for (const d of [...days].sort()) {
        const before = Math.round(at(now, city, d));
        const after = Math.round(at(trial, city, d));
        if (before !== after) impact.push({ city, date: d, before, after, limit: limits[city] });
      }
      const freed = impact.filter(i => i.city === 'NAJAF' && i.after < i.before);
      shifts.push({ move: m, from: m.segments, to: flipped, admits: h, admitsWith: fit.segs, impact,
        benefit: `${m.tour.ref} (${m.tour.paxFaiz} pax) ${CITY_NAME[flipped[0].city]} first ${freed.length ? `frees Najaf on ${freed.map(f => fmtDay(f.date)).join(', ')}` : 'frees space'} so ${h.tour.ref} (${h.tour.paxFaiz} pax) fits.` });
      break;
    }
  }

  // Daily overview.
  const allDays = new Set<string>();
  for (const c of snapshot.dashboard) if (c.date >= today) allDays.add(c.date);
  for (const city of CITIES) for (const l of [reserved, buffer]) for (const d of Object.keys(l[city])) if (d >= today) allDays.add(d);
  const days = [...allDays].sort();
  const capacity: CapacityRow[] = [];
  for (const date of days) for (const city of CITIES) {
    const ap = Math.round(at(approved, city, date));
    const pend = Math.round(at(reserved, city, date));
    const buf = Math.round(at(buffer, city, date));
    const available = limits[city] - ap - pend - buf;
    capacity.push({ date, city, limit: limits[city], approved: ap, pendingApproval: pend, buffer: buf, available,
      recommended: Math.max(0, available), hotelApproved: Math.round(at(hotelApproved, city, date)), hotelPending: Math.round(at(hotelPending, city, date)) });
  }

  const statusOf = (p: TourPlan): RecordStatus => {
    if (!p.tour.reapproval) return 'new';
    if (p.record?.approval?.reapproval && p.record.approval.state === 'api_reported_approved') return 're-approved';
    return p.record?.status === 'reapproval-reviewed' && p.record.reviewedModifiedOn === p.tour.modifiedOn ? 'reapproval-reviewed' : 'reapproval-pending';
  };
  const inQueue = new Set(tours.map(t => String(t.id)));
  const counts = {
    newApprovals: plans.filter(p => !p.tour.reapproval && p.recommendation !== 'done').length,
    reapprovalPending: plans.filter(p => statusOf(p) === 'reapproval-pending').length,
    reapprovalReviewed: plans.filter(p => statusOf(p) === 'reapproval-reviewed').length,
    reApproved: Object.values(records).filter(r => r.status === 're-approved' || (inQueue.has(String(r.id)) && r.approval?.reapproval && r.approval.state === 'api_reported_approved')).length,
    ready: plans.filter(p => p.category === 'ready' && p.recommendation === 'approve').length,
    awaiting: plans.filter(p => p.category === 'awaiting').length,
    pendingSubmission: plans.filter(p => p.category === 'pending-submission').length,
    followUp: plans.filter(p => p.recommendation === 'follow-up').length,
  };
  plans.sort((a, b) => a.priority - b.priority || a.tour.arrivalAt.localeCompare(b.tour.arrivalAt) || a.tour.id - b.tour.id);
  return { plans, capacity, days, shifts, counts, settings, today };
}

export const reapprovalStatus = (p: TourPlan): 'Pending' | 'Reviewed' | 'Approved' =>
  p.record?.approval?.reapproval && p.record.approval.state === 'api_reported_approved' ? 'Approved'
    : p.record?.status === 'reapproval-reviewed' && p.record.reviewedModifiedOn === p.tour.modifiedOn ? 'Reviewed' : 'Pending';

// ------------------------------------------------------------------------------------------------ approval payload

/** The fields of NKERP's approval form that are sent back unchanged. */
export const FORM_FIELDS = ['NoOfDays', 'PaxRequiredAcc', 'PaxNotRequiredAcc', 'IsMawaidRequired', 'IsPublic',
  'IsMuwafiqaRequired', 'IsActive', 'IsArrDepTransportRequired', 'IsSubVenueTransportRequired', 'IsOtherTransportRequired',
  'Remarks', 'StartDate', 'EndDate', 'EntryPortId', 'ExitPortId', 'TimeZone', 'IsTransportRequired', 'AccomodationOptionId',
  'CountryId', 'CityId', 'PackageId'] as const;

/**
 * NKERP's Approve request (the UI's approval form and city-date serializer), built from the tour's current
 * detail. It keeps the trip instants and every other field as they are and only adds the city stays.
 */
export function approvalPayload(detail: Record<string, any>, segments: Segment[], opts: { linkedTourId?: number } = {}) {
  const t = detail;
  if (t.CurrentStatusId !== 23 || !t.IsActive || t.TimeZone !== 3) throw new Error('The tour is no longer pending approval in NKERP.');
  if (![2, 3].includes(t.AccomodationOptionId)) throw new Error('Accommodation option "Preferred" must be resolved in NKERP first.');
  for (const k of ['PaxCount', 'PaxRequiredAcc', 'PaxNotRequiredAcc']) {
    if (!Number.isInteger(t[k]) || t[k] < 0) throw new Error('NKERP pax figures are missing.');
  }
  if (t.PaxCount <= 0 || t.PaxRequiredAcc + t.PaxNotRequiredAcc !== t.PaxCount) throw new Error('Pax breakup does not add up in NKERP.');
  if ((t.AccomodationOptionId === 2 && t.PaxRequiredAcc === 0) || (t.AccomodationOptionId === 3 && t.PaxRequiredAcc !== 0)) {
    throw new Error('Accommodation option and Faiz pax disagree in NKERP.');
  }
  if (opts.linkedTourId) throw new Error('Linked tour: approve it in NKERP so the link is kept.');
  // NKERP's form only asks for applicant-level choices on a Muwafiqa-locked tour (state 31) when the approver
  // changes the Faiz pax; the planner always sends NKERP's own pax figures, so that branch never applies.
  if (t.PackageId) throw new Error('Package tour: approve it in NKERP so the package rules are kept.');
  const start = localDay(t.StartDate), end = localDay(t.EndDate);
  const problems = segmentProblems(segments, start, end);
  if (problems.length) throw new Error(problems.join(' '));
  const TourSubvenuePlan = segments.map((s, i) => ({
    TourId: t.Id, SubvenueId: CITY_ID[s.city], SubvenueName: s.city,
    StartDate: midnightUtc(s.start), EndDate: midnightUtc(s.end, i < segments.length - 1 ? -2 : 0),
    planEndDate: midnightUtc(end), TimeZone: 3,
  }));
  const body: Record<string, unknown> = {};
  for (const k of FORM_FIELDS) body[k] = t[k];
  Object.assign(body, {
    TourId: t.Id, ModifiedOn: t.ModifiedOn, ActionId: 1, IsTourConverted: 0, LinkTourId: 0, LinkWithTour: false,
    isDST: false, IsApprovedWithAccommodation: t.PaxRequiredAcc > 0, TourSubvenuePlan,
  });
  return body;
}

/** The latest city-stay set in an NKERP TourSubvenuePlan list (rows repeat with every earlier approval). */
export function latestPlanSet(rows: Record<string, any>[]): Segment[] {
  const usable = rows.filter(r => r && r.IsRemoved !== true && cityFromId(r.SubvenueId) && r.StartDate && r.EndDate);
  const ordered = [...usable].sort((a, b) => (Number(a.Id) || 0) - (Number(b.Id) || 0));
  const sets: Segment[][] = [];
  for (const r of ordered) {
    const seg: Segment = { city: cityFromId(r.SubvenueId)!, start: planStartDay(r.StartDate), end: planEndDay(r.EndDate) };
    const cur = sets[sets.length - 1];
    if (!cur || seg.start !== cur[cur.length - 1].end) sets.push([seg]);
    else cur.push(seg);
  }
  const active = usable.filter(r => r.IsActive === true);
  if (active.length) {
    return active.map(r => ({ city: cityFromId(r.SubvenueId)!, start: planStartDay(r.StartDate), end: planEndDay(r.EndDate) }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  return sets[sets.length - 1] ?? [];
}

// ------------------------------------------------------------------------------------------------ reports

/** Tours in the approval proposal: planned, fitting, nothing left to resolve. */
export const inProposal = (p: TourPlan) => p.recommendation === 'approve' || p.recommendation === 'review-changes';

export interface NajafReportRow {
  date: string; limit: number; projected: number; headroom: number; arrivingPax: number;
  arrivals: { id: number; ref: string; pax: number; office: string }[];
}
/** Najaf-only daily report: projected Faiz occupancy and the proposal's Najaf arrivals (Faiz pax only). */
export function najafReport(plan: ApprovalPlan, include: (p: TourPlan) => boolean = inProposal): NajafReportRow[] {
  return plan.days.map(date => {
    const row = plan.capacity.find(c => c.date === date && c.city === 'NAJAF');
    const projected = (row?.approved ?? 0) + (row?.pendingApproval ?? 0);
    const arrivals = plan.plans.filter(p => include(p) && p.tour.paxFaiz > 0)
      .filter(p => p.segments.some(s => s.city === 'NAJAF' && s.start === date))
      .map(p => ({ id: p.tour.id, ref: p.tour.ref, pax: p.tour.paxFaiz, office: p.tour.office }));
    const limit = row?.limit ?? plan.settings.limits.NAJAF;
    return { date, limit, projected, headroom: limit - projected, arrivingPax: arrivals.reduce((s, a) => s + a.pax, 0), arrivals };
  });
}

/** The issue and a practical next step for a Tour ID that is not in the proposal. */
export function suggestion(p: TourPlan, plan?: ApprovalPlan): { issue: string; next: string } {
  const s = p.submission;
  const shift = plan?.shifts.find(x => x.admits.tour.id === p.tour.id);
  switch (p.recommendation) {
    case 'follow-up': return { issue: `Dustbin sign: submission incomplete, ${s.daysToArrival} days to arrival (cut-off ${s.cutoffDays}).`,
      next: 'Contact the Tour Operator now to complete the red-click itinerary and chat box.' };
    case 'wait': return { issue: `Dustbin sign: submission incomplete, ${s.daysToArrival} days to arrival.`,
      next: `Wait for the Tour Operator; follow up from ${fmtDay(addDays(tripStart(p.tour), -s.cutoffDays))} if still incomplete.` };
    case 'needs-chat': return { issue: 'No city dates or sequence in the chat box.', next: 'Ask the Tour Operator for the Karbala and Najaf dates in the chat box.' };
    case 'hold-capacity': return { issue: p.problems.find(x => x.startsWith('Over the')) ?? 'Does not fit capacity.',
      next: shift ? `Shift the whole of ${shift.move.tour.ref} to ${CITY_NAME[shift.to[0].city]} first, then approve.`
        : p.alternative?.fits ? `Ask the Tour Operator to accept ${fmtSegments(p.alternative.segments)} (fits).`
        : 'Hold on the waitlist until space frees on those dates; do not split the group.' };
    case 'review-changes': return { issue: `${p.changes.length} change${p.changes.length === 1 ? '' : 's'} since the last approval.`, next: 'Review the highlighted changes, then approve.' };
    case 'done': return { issue: p.record?.approval?.state === 'api_reported_approved' ? 'Approved from the planner.' : 'Approval sent; NKERP\'s answer is unknown.',
      next: p.record?.approval?.state === 'api_reported_approved' ? 'Nothing.' : 'Check the tour in NKERP. It is not sent again.' };
    case 'resolve': return { issue: p.problems[0] ?? 'Needs attention.', next: p.problems.some(x => /Preferred/.test(x)) ? 'Confirm Required or Not Required with the Tour Operator.'
      : p.problems.some(x => /match the Iraq trip|stays must|must start|must end|arrival must/.test(x)) ? 'Correct the city dates (or ask the Tour Operator for current ones).'
      : 'Resolve in NKERP.' };
    default: return { issue: '', next: 'Approve.' };
  }
}

// ------------------------------------------------------------------------------------------------ follow-ups

/** Tour IDs whose Tour Operator should be chased now: dustbin inside the cut-off, or a hotel tour with no chat dates. */
export const needsFollowUp = (p: TourPlan) => p.recommendation === 'follow-up' ||
  (p.recommendation === 'needs-chat' && p.submission.daysToArrival <= p.submission.cutoffDays);

const DATES_ITEM = 'Karbala and Najaf dates are not in the NKERP chat box';
const needsDates = (p: TourPlan) => !p.segments.length || p.recommendation === 'needs-chat';
/** How to write the city dates, shown once under the pending items. */
const DATES_EXAMPLE = ['*Example:*', '• First Subvenue: *10 October to 15 October (Najaf)*', '• Second Subvenue: *15 October to 21 October (Karbala)*'];
function pendingItems(p: TourPlan): string[] {
  const items: string[] = [];
  if (p.tour.dustbin) items.push('Red-click itinerary and zaereen details are not fully submitted in NKERP');
  if (needsDates(p)) items.push(DATES_ITEM);
  if (p.tour.option === 1) items.push('Please confirm whether Faiz accommodation is Required or Not Required');
  return items;
}
function dueLine(p: TourPlan) {
  const due = addDays(tripStart(p.tour), -p.submission.cutoffDays);
  const left = p.submission.daysToArrival - p.submission.cutoffDays;
  return left < 0
    ? `Submissions were due ${p.submission.cutoffDays} days before arrival (${fmtDay(due, true)}), so this is now urgent.`
    : `Submissions are due ${p.submission.cutoffDays} days before arrival, by ${fmtDay(due, true)}.`;
}

/** A WhatsApp message to the Tour Operator for one Tour ID (to copy and paste). */
export function followUpMessage(p: TourPlan): string {
  const t = p.tour;
  return [
    'Taslimaat Janab, Salaam Jameel',
    '',
    `*Tour ID:* ${t.ref}`,
    `*Office:* ${t.office}`,
    `*Iraq arrival:* ${fmtDay(tripStart(t), true)} · ${t.paxTotal} pax`,
    '',
    'The following is still pending:',
    ...pendingItems(p).map(x => `• ${x}`),
    ...(needsDates(p) ? ['', ...DATES_EXAMPLE] : []),
    '',
    `${dueLine(p)} Kindly complete it at the earliest so the accommodation can be approved.`,
    '',
    'Shukran',
  ].join('\n');
}

/** One WhatsApp message per office covering all its Tour IDs that need chasing. */
export function officeFollowUps(plans: TourPlan[]): { office: string; tours: TourPlan[]; message: string }[] {
  const byOffice = new Map<string, TourPlan[]>();
  for (const p of plans.filter(needsFollowUp)) byOffice.set(p.tour.office || 'Unknown office', [...(byOffice.get(p.tour.office || 'Unknown office') ?? []), p]);
  return [...byOffice].map(([office, tours]) => {
    tours.sort((a, b) => a.tour.arrivalAt.localeCompare(b.tour.arrivalAt));
    if (tours.length === 1) return { office, tours, message: followUpMessage(tours[0]) };
    const lines = tours.flatMap(p => [
      `*${p.tour.ref}* · arrives ${fmtDay(tripStart(p.tour), true)} · ${p.tour.paxTotal} pax`,
      ...pendingItems(p).map(x => `   • ${x}`),
    ]);
    const cutoff = tours[0].submission.cutoffDays;
    return { office, tours, message: [
      'Taslimaat Janab, Salaam Jameel', '', `*${office}*: the following Tour IDs still have pending submissions:`, '', ...lines, '',
      ...(tours.some(needsDates) ? [...DATES_EXAMPLE, ''] : []),
      `Submissions are due ${cutoff} days before arrival in Iraq. Kindly complete them at the earliest so the accommodation can be approved.`, '', 'Shukran',
    ].join('\n') };
  }).sort((a, b) => a.tours[0].tour.arrivalAt.localeCompare(b.tours[0].tour.arrivalAt));
}
