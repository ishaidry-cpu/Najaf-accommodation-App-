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
 *    cut-off, flag for urgent follow-up with the Tour Operator inside it. The cut-off is a setting (15 or 30
 *    days). The dustbin sign is a warning only: the approver may still approve.
 *  - Capacity: Najaf 290 and Karbala 400 Faiz pax at a time, keeping a buffer for unsubmitted tours.
 *  - A re-approval is never a new approval: it is compared with what was approved before and goes to the
 *    admin's review list, but review is not required before approving.
 *  - The only rule that blocks approval is an unsaved itinerary: NKERP's fly mark (Add/Edit Transport
 *    Itinerary icon) is red once the itinerary is saved. Re-approval status, awaiting status, pending chat
 *    details, the dustbin sign and capacity are warnings. (A request NKERP cannot accept from the planner,
 *    such as missing or invalid city dates, a Preferred option, a linked or package tour, still cannot be sent.)
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
  /**
   * NKERP's fly mark (Add/Edit Transport Itinerary icon) is red: the queue row has a saved TransportItinerary.
   * null when NKERP did not say (an older snapshot): treated as not saved until the next refresh.
   */
  itinerarySaved?: boolean | null;
  /** The first saved itinerary leg, as NKERP's queue shows it. */
  itinerary?: { arrivalCode: string; arrivalAt: string; departureCode: string; departureAt: string } | null;
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
  /** An approved Tour ID opened from the planner to change it (not in the approval queues). */
  approvedEdit?: boolean;
}

/** An approved Tour ID opened from the planner to change it: NKERP's tour, its approved city stays and status. */
export interface ApprovedTour { tour: ApprovalTour; segments: Segment[]; statusId: number; readAt: string }

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
  /** Messages the approver sent to the Tour ID's NKERP chat box from the planner (latest last). */
  chats?: ChatSend[];
  /**
   * The approver's accommodation requirement (Faiz / hotel pax), kept until NKERP changes the tour. NKERP's own
   * figures at the time are kept beside it, so the original and the revised requirement are both on record.
   */
  accommodation?: AccommodationChange;
  /** Every change made from the planner: the original and revised details, who, when, and the approval status. */
  revisions?: Revision[];
  /** An approved Tour ID sent back to NKERP's approval queue from the planner (approved-tour Update), never sent twice. */
  reopen?: { state: 'sending' | 'sent' | 'refused' | 'uncertain'; at: string; modifiedOn: string; message?: string };
  /** The approver's remarks and observations, printed on the awaiting-approvals report for the Idara. */
  remarks?: { text: string; at: string; by?: string };
  history: { at: string; kind: string; note?: string; by?: string }[];
}
export interface PaxSplit { faiz: number; hotel: number }
export interface AccommodationChange { paxFaiz: number; paxHotel: number; at: string; by?: string; modifiedOn: string; nkerp: PaxSplit }
export interface Revision {
  at: string;
  by?: string;
  /** What was changed: the planner's dates or accommodation, a re-approval of an approved Tour ID, or an approval. */
  kind: 'dates' | 'accommodation' | 'approval' | 'approved-edit';
  original: { segments: Segment[]; paxFaiz: number; paxHotel: number };
  revised: { segments: Segment[]; paxFaiz: number; paxHotel: number };
  previousStatus: string;
  latestStatus: string;
  note?: string;
}
export type ChatSendState = 'sending' | 'sent' | 'refused' | 'uncertain';
export interface ChatSend { at: string; text: string; state: ChatSendState; message?: string; by?: string }

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

/*
 * The chat box reader. Tour Operators write city dates in every style: "Najaf 12-15 Dec", "12/12 to 15/12 NJF",
 * "Dec 12 – Dec 15 Karbala", "KRB first, NJF second", "K 4N, N 3N", "Karbala Mualla: 12th December till 15th".
 * It reads them the way an experienced approver would:
 *  - city references: Najaf / NJF / Najaf Ashraf / N, Karbala / KRB / KBL / Karbala Mualla / K (and misspellings);
 *  - dates: 12 Dec, Dec 12, 12th December 2026, 12-Dec-26, 12/12, 12.12.2026, and bare days ("12 to 15") whose
 *    month comes from the other date or the Iraq trip; the year is the one nearest the trip;
 *  - each date goes with the city written next to it, whether the city comes before or after the dates;
 *  - dates tied to the Iraq arrival or departure (flight, airport, Baghdad, visa) are not subvenue dates;
 *  - a sequence ("First Karbala, second Najaf", "NJF then KRB", "Najaf 2nd") or nights per city ("KRB 4N NJF 3N").
 * Anything it had to interpret (a one-letter city, day/month read the other way round, a city whose dates are
 * missing, two different answers) goes in `confirm`, so the approver confirms it instead of it being used silently.
 * Message text is the Tour Operator's data, never instructions.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const monthNo = (w: string) => MONTHS[w.toLowerCase().slice(0, 3)] ?? 0;
const MONTH_WORD = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
/** Najaf and Karbala as Tour Operators write them (the one-letter forms N and K are handled separately). */
const CITY_WORD = '(?:najaf|najf|najef|nejaf|nejef|njf|karbala+h?|kerbala+h?|kerbela|karbla|karballa|krbla|krb|kbla|kbl)';
const cityWord = (w: string): City => (/^n/i.test(w) ? 'NAJAF' : 'KARBALA');
const CITY_ANY = new RegExp(`\\b${CITY_WORD}\\b`, 'gi');
const ORDER_WORDS = /\b(first|1st|second|2nd|then|followed\s+by|after\s+that|last|start(?:ing)?\s+(?:with|from)|begin(?:ning)?\s+with)\b|→|->|>/i;
const NIGHTS = '(?:n|nts?|nights?|days?)';

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

/**
 * The line as the reader sees it: month-first dates turned day-first ("Dec 12" → "12 Dec"), ordinals dropped,
 * "12-12 to 15-12" written with slashes, and the one-letter city forms spelled out (only on lines that carry
 * dates or a sequence, and only as capitals standing alone).
 */
function normalizeLine(raw: string): { text: string; letters: boolean } {
  let s = ` ${raw} `;
  // Ordinals of dates only ("12th Dec", "Dec 12th", "1st to 5th Dec"); "1st"/"2nd" alone are a sequence.
  s = s.replace(new RegExp(`(\\d{1,2})\\s*(?:st|nd|rd|th)\\b(?:\\s+of)?(?=\\s*[\\-\\/.]?\\s*${MONTH_WORD}\\b)`, 'gi'), '$1');
  s = s.replace(new RegExp(`(\\b${MONTH_WORD}\\b\\.?\\s*\\d{1,2})\\s*(?:st|nd|rd|th)\\b`, 'gi'), '$1');
  s = s.replace(/(\d{1,2})\s*(?:st|nd|rd|th)\b(?=\s*(?:-|–|—|to|till|until|upto)\s*\d)/gi, '$1');
  // "Dec 12-15" / "Dec 12 to 15": the month belongs to both days.
  s = s.replace(new RegExp(`(?<![\\d][\\s\\-\\/.]*)\\b(${MONTH_WORD})\\b\\.?\\s*(\\d{1,2})\\s*(-|–|—|to|till|until|upto)\\s*(\\d{1,2})\\b(?!\\s*[\\/.:]\\d)(?!\\s*${MONTH_WORD}\\b)`, 'gi'),
    (_m, mon, a, sep, b) => `${a} ${mon} ${sep} ${b} ${mon}`);
  // "Dec 12, 2026" → "12 Dec 2026" (not when a day already stands before the month: "12 Dec 15 Dec").
  s = s.replace(new RegExp(`(?<![\\d][\\s\\-\\/.]*)\\b(${MONTH_WORD})\\b\\.?\\s*(\\d{1,2})\\b(?!\\s*[\\/.:]\\d)(?:,?\\s*(\\d{4})\\b)?`, 'gi'),
    (_m, mon, d, y) => `${d} ${mon}${y ? ' ' + y : ''}`);
  // "12-12 to 15-12" and "12-12-2026": numeric dates written with dashes.
  s = s.replace(/\b(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})\b/g, '$1/$2/$3');
  s = s.replace(/\b(\d{1,2})-(\d{1,2})(\s*(?:to|till|until|upto|–|—)\s*)(\d{1,2})-(\d{1,2})\b/gi, '$1/$2$3$4/$5');
  let letters = false;
  const datedOrOrdered = /\d/.test(s) || ORDER_WORDS.test(s);
  if (datedOrOrdered) {
    s = s.replace(/(?<![A-Za-z0-9'’])([NK])(?![A-Za-z0-9'’]|\/[A-Za-z])/g, (_m, c) => { letters = true; return c === 'N' ? 'Najaf' : 'Karbala'; });
  }
  return { text: s, letters };
}

type Tok =
  | { kind: 'date'; day: number; month: number | null; year?: string; alt?: { day: number; month: number }; num: boolean }
  | { kind: 'bare'; day: number }
  | { kind: 'sep' }
  | { kind: 'city'; city: City }
  | { kind: 'iraq' }
  | { kind: 'role'; role: 'start' | 'end' };

const TOKEN_RE = new RegExp([
  // 12 Dec, 12-Dec-26, 12 December 2026
  `(?<dmD>\\b\\d{1,2})[\\s\\-\\/.]*(?<dmM>${MONTH_WORD})\\b\\.?(?:[\\s,\\-\\/.']*(?<dmY>\\d{4})(?!\\d)|['\\-\\/.](?<dmY2>\\d{2})(?!\\d)(?!\\s*${MONTH_WORD}\\b))?`,
  // 12/12, 12.12.2026
  `(?<nD>\\b\\d{1,2})(?<nS>[\\/.])(?<nM>\\d{1,2})(?:\\k<nS>(?<nY>\\d{4}|\\d{2}))?(?!\\d)(?!\\s*(?:am|pm|hrs?|hours)\\b)`,
  `(?<city>\\b${CITY_WORD}\\b)`,
  `(?<iraq>\\b(?:iraq|baghdad|bgw|flights?|airport|landing|visa)\\b)`,
  `(?<roleS>\\b(?:from|arriv\\w*|check\\s*-?\\s*in|reach\\w*|start\\w*)\\b)`,
  `(?<roleE>\\b(?:depart\\w*|check\\s*-?\\s*out|leav\\w*|vacat\\w*)\\b)`,
  `(?<sep>\\b(?:to|till|until|upto|up\\s+to|thru|through|and)\\b|–|—|-|~|&)`,
  `(?<bare>\\b\\d{1,2}\\b)(?!\\s*(?:pax|nights?|nts?|days?|n|d|people|persons|members|adults?|kids|child(?:ren)?|infants?|am|pm|hrs?|hours)\\b)(?![:.]\\d)`,
].join('|'), 'gi');

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const g = m.groups!;
    if (g.dmD) out.push({ kind: 'date', day: Number(g.dmD), month: monthNo(g.dmM), year: g.dmY || g.dmY2, num: false });
    else if (g.nD) {
      const a = Number(g.nD), b = Number(g.nM);
      out.push({ kind: 'date', day: a, month: b, year: g.nY, num: true, alt: a <= 12 && b <= 31 && a !== b ? { day: b, month: a } : undefined });
    } else if (g.city) out.push({ kind: 'city', city: cityWord(g.city) });
    else if (g.iraq) out.push({ kind: 'iraq' });
    else if (g.roleS) out.push({ kind: 'role', role: 'start' });
    else if (g.roleE) out.push({ kind: 'role', role: 'end' });
    else if (g.sep) out.push({ kind: 'sep' });
    else if (g.bare) out.push({ kind: 'bare', day: Number(g.bare) });
  }
  return out;
}

const within = (d: string, trip: { start: string; end: string }) => !trip.start || !trip.end || (d >= addDays(trip.start, -1) && d <= addDays(trip.end, 1));
const pad2 = (n: number) => String(n).padStart(2, '0');
const validDay = (s: string) => /^\d{4}-\d\d-\d\d$/.test(s) && iso(Date.parse(s + 'T00:00:00Z')) === s;
/** Day `day` of the month `k` months after the month of `d`. */
function monthDay(d: string, k: number, day: number): string | null {
  const [y, mo] = d.split('-').map(Number);
  const idx = mo - 1 + k;
  const s = `${y + Math.floor(idx / 12)}-${pad2(((idx % 12) + 12) % 12 + 1)}-${pad2(day)}`;
  return validDay(s) ? s : null;
}

/** A full date from a token, the year nearest the trip. */
function resolveDate(t: Tok, around: string, trip: { start: string; end: string }, flags: Set<string>): string | null {
  if (t.kind !== 'date' || !t.month) return null;
  const direct = pickYear(t.month, t.day, around, t.year);
  if (t.num && t.alt) {
    // 12/15 can only be December 15; 03/12 is normally 3 December, and is read 12 March only if the trip says so.
    const swapped = pickYear(t.alt.month, t.alt.day, around, t.year);
    if ((!direct || !within(direct, trip)) && swapped && within(swapped, trip)) {
      if (direct) flags.add('swapped');
      return swapped;
    }
  }
  return direct;
}
/** A bare day ("12" in "12 to 15") in the trip: the month that puts it inside the trip, else the nearest. */
function bareInTrip(day: number, trip: { start: string; end: string }, around: string): string | null {
  const base = trip.start || around;
  const opts = [-1, 0, 1, 2].map(k => monthDay(base, k, day)).filter((x): x is string => Boolean(x));
  const inside = opts.filter(d => within(d, trip));
  const pool = inside.length ? inside : opts;
  pool.sort((a, b) => Math.abs(daysBetween(base, a)) - Math.abs(daysBetween(base, b)));
  return pool[0] ?? null;
}
/** The end day of a range written with a bare day ("12 Dec to 15"): the same month, else the next. */
const endAfter = (start: string, day: number) => (day > Number(start.slice(8)) ? monthDay(start, 0, day) : null) ?? monthDay(start, 1, day);
/** The start day of a range written with a bare day ("12 to 15 Dec"): the same month, else the one before. */
const startBefore = (end: string, day: number) => (day < Number(end.slice(8)) ? monthDay(end, 0, day) : null) ?? monthDay(end, -1, day);

interface Item { start?: string; end?: string; role?: 'start' | 'end'; at: number }
interface Found { city: City; start?: string; end?: string; at: string; line: string }

/** The city stays one line states, each date with the city written beside it. */
function readLine(text: string, trip: { start: string; end: string }, around: string, flags: Set<string>): { city: City; start?: string; end?: string }[] {
  const toks = tokenize(text);
  const items: Item[] = [];
  const isDate = (t?: Tok) => t?.kind === 'date' || t?.kind === 'bare';
  /** "arrival 12 Dec", "12 Dec (departure)": the nearest role word beside the date, not past a city. */
  const roleAt = (i: number): 'start' | 'end' | undefined => {
    const stop = (t: Tok) => t.kind === 'city' || t.kind === 'date' || t.kind === 'bare';
    for (let j = i - 1; j >= Math.max(0, i - 2); j--) { const t = toks[j]; if (t.kind === 'role') return t.role; if (stop(t)) break; }
    for (let j = i + 1; j <= Math.min(toks.length - 1, i + 3); j++) { const t = toks[j]; if (t.kind === 'role') return t.role; if (stop(t)) break; }
    return undefined;
  };
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i];
    if (!isDate(a)) continue;
    if (toks[i + 1]?.kind === 'sep' && isDate(toks[i + 2])) {
      const b = toks[i + 2];
      let end = b.kind === 'date' ? resolveDate(b, around, trip, flags) : null;
      let start = a.kind === 'date' ? resolveDate(a, end ?? around, trip, flags) : null;
      if (!end && start && b.kind === 'bare') end = endAfter(start, b.day);
      if (!start && end && a.kind === 'bare') start = startBefore(end, a.day);
      if (!start && !end && a.kind === 'bare' && b.kind === 'bare') {
        start = bareInTrip(a.day, trip, around);
        end = start ? endAfter(start, b.day) : null;
        if (start && end) flags.add('month');
      }
      if (start && end && end > start) items.push({ start, end, at: i });
      i += 2;
      continue;
    }
    if (a.kind !== 'date') continue;
    const d = resolveDate(a, around, trip, flags);
    if (d) items.push({ start: d, role: roleAt(i), at: i });
  }
  if (!items.length) return [];
  const cities = toks.map((t, i) => (t.kind === 'city' ? { city: t.city, at: i } : null)).filter((x): x is { city: City; at: number } => Boolean(x));
  if (!cities.length) return [];
  /** A date written beside a flight, airport, Baghdad, Iraq or visa word is the Iraq arrival/departure, not a stay. */
  const iraqDate = (at: number) => {
    for (let j = at - 1; j >= Math.max(0, at - 4); j--) { if (toks[j].kind === 'city') break; if (toks[j].kind === 'iraq') return true; }
    for (let j = at + 1; j <= Math.min(toks.length - 1, at + 3); j++) { if (toks[j].kind === 'city' || toks[j].kind === 'date') break; if (toks[j].kind === 'iraq') return true; }
    return false;
  };
  const iraqAt = toks.map((t, i) => (t.kind === 'iraq' ? i : -1)).filter(i => i >= 0);
  const between = (a: number, b: number) => iraqAt.some(x => x > Math.min(a, b) && x < Math.max(a, b));
  // The city stands before its dates ("Najaf 12-15 Dec, Karbala 15-18 Dec") or after them ("12-15 Dec Najaf").
  const cityFirst = cities[0].at < items[0].at;
  const owner = (it: Item) => {
    if (iraqDate(it.at)) return null;
    if (new Set(cities.map(c => c.city)).size === 1) {
      const c = cities.reduce((m, x) => (Math.abs(x.at - it.at) < Math.abs(m.at - it.at) ? x : m), cities[0]);
      return between(c.at, it.at) ? null : c;
    }
    const before = [...cities].reverse().find(c => c.at < it.at);
    const after = cities.find(c => c.at > it.at);
    const c = cityFirst ? before : after ?? before;
    if (!c) return null;
    return between(c.at, it.at) ? null : c;
  };
  const byCity = new Map<City, Item[]>();
  for (const it of items) {
    const c = owner(it);
    if (!c) continue;
    byCity.set(c.city, [...(byCity.get(c.city) ?? []), it]);
  }
  const out: { city: City; start?: string; end?: string }[] = [];
  // Cities in the order they stand on the line (a repeated visit on one line keeps its own dates).
  for (const [city, list] of byCity) {
    const ranges = list.filter(x => x.end);
    const singles = list.filter(x => !x.end);
    let start = ranges.length ? ranges.map(x => x.start!).sort()[0] : undefined;
    let end = ranges.length ? ranges.map(x => x.end!).sort().slice(-1)[0] : undefined;
    for (const s of singles) {
      const d = s.start!;
      if (s.role === 'end') end = !end || d > end ? d : end;
      else if (s.role === 'start') start = !start || d < start ? d : start;
      else if (!start) start = d;
      else if (!end && d > start) end = d;
      else if (d < start) start = d;
      else if (end && d > end) end = d;
    }
    if (start && end && end <= start) { if (end === start) end = undefined; else [start, end] = [end, start]; }
    out.push({ city, start, end });
  }
  return out.sort((a, b) => (a.start ?? a.end ?? '').localeCompare(b.start ?? b.end ?? ''));
}

/** "KRB 4N NJF 3N", "4 nights Karbala and 3 nights Najaf": nights per city in the order written. */
function readNights(text: string): { city: City; nights: number }[] {
  const re = new RegExp(`\\b(${CITY_WORD})\\b\\s*[:\\-–(]?\\s*(\\d{1,2})\\s*${NIGHTS}\\b|\\b(\\d{1,2})\\s*${NIGHTS}\\b\\s*(?:in\\s+|at\\s+|of\\s+)?(${CITY_WORD})\\b`, 'gi');
  return [...text.matchAll(re)].map(m => ({ city: cityWord(m[1] || m[4]), nights: Number(m[2] || m[3]) }));
}

/** A sequence in words: "Karbala first", "first NJF", "Najaf then Karbala", "Najaf second", "start with KRB". */
function readOrder(text: string): City | null {
  const C = `(${CITY_WORD})`;
  const tests: [RegExp, (m: RegExpExecArray) => City][] = [
    [new RegExp(`\\b${C}\\b\\s*[:\\-–]?\\s*(?:first|1st|1)\\b(?!\\s*(?:${MONTH_WORD}|\\/|-\\d))`, 'i'), m => cityWord(m[1])],
    [new RegExp(`\\b(?:first|1st)\\b\\s*(?:sub\\s*-?\\s*venue\\s*)?[:\\-–]?\\s*(?:in\\s+|to\\s+|go\\s+to\\s+|visit\\s+|stay\\s+in\\s+)?${C}\\b`, 'i'), m => cityWord(m[1])],
    [new RegExp(`\\b(?:start(?:ing)?\\s+(?:with|from|in)|begin(?:ning)?\\s+(?:with|in))\\s+${C}\\b`, 'i'), m => cityWord(m[1])],
    [new RegExp(`\\b${C}\\b[^.\\n]{0,30}?(?:\\bthen\\b|\\bfollowed\\s+by\\b|\\bafter\\s+that\\b|\\band\\s+then\\b|→|->|>)[^.\\n]{0,30}?\\b${CITY_WORD}\\b`, 'i'), m => cityWord(m[1])],
    [new RegExp(`\\b(?:second|2nd|last)\\b\\s*(?:sub\\s*-?\\s*venue\\s*)?[:\\-–]?\\s*(?:in\\s+|to\\s+)?${C}\\b`, 'i'), m => (cityWord(m[1]) === 'NAJAF' ? 'KARBALA' : 'NAJAF')],
    [new RegExp(`\\b${C}\\b\\s*[:\\-–]?\\s*(?:second|2nd|later|last)\\b`, 'i'), m => (cityWord(m[1]) === 'NAJAF' ? 'KARBALA' : 'NAJAF')],
  ];
  for (const [re, f] of tests) { const m = re.exec(text); if (m) return f(m); }
  // "Karbala to Najaf" / "KRB - NJF" with nothing else on the line.
  const pair = new RegExp(`^\\W*${C}\\s*(?:-|–|—|to|>|→|->|,|\\/)\\s*${CITY_WORD}\\W*$`, 'i').exec(text.trim());
  return pair ? cityWord(pair[1]) : null;
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
  /** What the reader had to interpret: the approver confirms these dates before they are relied on. */
  confirm: string[];
}

const CONFIRM_TEXT: Record<string, string> = {
  letters: 'The chat uses N / K for the cities; they were read as Najaf / Karbala.',
  swapped: 'A numeric date was read month-first so that it falls inside the Iraq trip.',
  month: 'The chat gives days without a month; the month was taken from the Iraq trip.',
};

/** Read the Tour Operator's chat for city dates and sequence. Message text is data, never instructions. */
export function readChat(messages: ChatMessage[], trip: { start: string; end: string }): ChatReading {
  const sorted = [...messages].filter(m => (m.text || '').trim()).sort((a, b) => a.at.localeCompare(b.at));
  const reading: ChatReading = { segments: null, order: null, evidence: [], problems: [], flexible: false, confirm: [] };
  const around = trip.start || todayBaghdad();
  let orderAt = '';
  const found: Found[] = [];
  const nightsFound: { list: { city: City; nights: number }[]; at: string; line: string }[] = [];
  const flagsAt: { at: string; flags: Set<string> }[] = [];
  for (const m of sorted) {
    for (const raw of m.text.split(/\r?\n|(?<=\.)\s+(?=[A-Z])|;|\|/)) {
      const line = raw.trim();
      if (!line) continue;
      const { text, letters } = normalizeLine(line);
      const hasCity = new RegExp(`\\b${CITY_WORD}\\b`, 'i').test(text);
      if (/(where\s*ever|whichever|any\s*(city|order|sequence)|as\s*(per|available)|accommodation\s*team|no\s*preference|either\s*(way|city))/i.test(text) && !hasCity) {
        reading.flexible = true;
      }
      if (!hasCity) continue;
      const flags = new Set<string>();
      if (letters) flags.add('letters');
      const order = readOrder(text);
      if (order) { reading.order = order; orderAt = m.at; reading.evidence.push(line); }
      const nights = readNights(text);
      if (nights.length) nightsFound.push({ list: nights, at: m.at, line });
      const stays = readLine(text, trip, around, flags);
      for (const s of stays) found.push({ ...s, at: m.at, line });
      if (stays.length || order || nights.length) flagsAt.push({ at: m.at, flags });
    }
  }

  const latestOf = (list: { at: string }[]) => list.length ? list[list.length - 1].at : '';
  const near = (a: string, b: string) => Math.abs(instantMs(a) - instantMs(b)) <= 6 * 3_600_000;
  let latest = '';
  if (found.length) {
    // The latest set: the last dated message and the dated messages sent shortly before it.
    latest = latestOf(found);
    const cluster = found.filter(f => near(latest, f.at));
    const full = cluster.filter(f => f.start && f.end);
    const partial = cluster.filter(f => !(f.start && f.end));
    // The same city with two different answers in one set: the later one stands, and the approver confirms.
    const unique = new Map<string, Found>();
    for (const f of full) {
      const clash = [...unique.values()].find(u => u.city === f.city && u.start !== f.start && u.end !== f.end &&
        !(u.end! <= f.start! || f.end! <= u.start!));
      if (clash) {
        unique.delete(`${clash.city}|${clash.start}`);
        reading.confirm.push(`The chat gives ${CITY_NAME[f.city]} twice (${fmtDay(clash.start!)}–${fmtDay(clash.end!)} and ${fmtDay(f.start!)}–${fmtDay(f.end!)}); the later message was used.`);
      }
      const same = unique.get(`${f.city}|${f.start}`);
      if (same && same.end !== f.end) {
        reading.confirm.push(`The chat gives ${CITY_NAME[f.city]} twice (${fmtDay(same.start!)}–${fmtDay(same.end!)} and ${fmtDay(f.start!)}–${fmtDay(f.end!)}); the later message was used.`);
      }
      unique.set(`${f.city}|${f.start}`, f);
    }
    const segs = [...unique.values()].sort((a, b) => a.start!.localeCompare(b.start!));
    // "2 to 4 Dec Karbala, 5 to 7 Dec Najaf": NKERP needs one shared transfer date, so the later date is it.
    const chained: Segment[] = [];
    for (const f of segs) {
      const seg: Segment = { city: f.city, start: f.start!, end: f.end! };
      const prev = chained[chained.length - 1];
      if (prev && prev.city === seg.city && prev.end >= seg.start) { prev.end = seg.end > prev.end ? seg.end : prev.end; continue; }
      if (prev && daysBetween(prev.end, seg.start) === 1) {
        reading.problems.push(`Chat leaves a day between ${CITY_NAME[prev.city]} (until ${fmtDay(prev.end)}) and ${CITY_NAME[seg.city]} (from ${fmtDay(seg.start)}); the transfer is taken as ${fmtDay(seg.start)}.`);
        reading.confirm.push(`The transfer day between ${CITY_NAME[prev.city]} and ${CITY_NAME[seg.city]} is not stated; ${fmtDay(seg.start)} was used.`);
        prev.end = seg.start;
      }
      chained.push(seg);
    }
    // One date for a city ("Najaf from 15 Dec", "departure from Karbala 18 Dec"): the stay runs to the next stay or
    // the trip's end (from the previous stay or the trip's start). Absorbed silently when it agrees with a range.
    for (const f of partial) {
      const d = (f.start ?? f.end)!;
      const same = chained.find(s => s.city === f.city && s.start <= d && d <= s.end);
      if (same) continue;
      if (f.start) {
        const next = chained.find(s => s.start >= f.start!);
        const end = next ? next.start : trip.end;
        if (end && end > f.start) {
          chained.push({ city: f.city, start: f.start, end });
          reading.confirm.push(`The chat gives only the ${CITY_NAME[f.city]} arrival (${fmtDay(f.start)}); its departure was taken as ${fmtDay(end)}.`);
        }
      } else if (f.end) {
        const prev = [...chained].reverse().find(s => s.end <= f.end!);
        const start = prev ? prev.end : trip.start;
        if (start && start < f.end) {
          chained.push({ city: f.city, start, end: f.end });
          reading.confirm.push(`The chat gives only the ${CITY_NAME[f.city]} departure (${fmtDay(f.end)}); its arrival was taken as ${fmtDay(start)}.`);
        }
      }
      chained.sort((a, b) => a.start.localeCompare(b.start));
    }
    // A city the chat leaves out: the rest of the trip, when the stated stays start or end with the trip.
    if (chained.length && trip.start && trip.end) {
      const cities = new Set(chained.map(s => s.city));
      const first = chained[0], last = chained[chained.length - 1];
      if (cities.size === 1) {
        const other: City = first.city === 'NAJAF' ? 'KARBALA' : 'NAJAF';
        if (first.start === trip.start && last.end < trip.end) {
          chained.push({ city: other, start: last.end, end: trip.end });
          reading.confirm.push(`The chat gives only ${CITY_NAME[first.city]}; ${CITY_NAME[other]} was taken as the rest of the trip (${fmtDay(last.end)}–${fmtDay(trip.end)}).`);
        } else if (last.end === trip.end && first.start > trip.start) {
          chained.unshift({ city: other, start: trip.start, end: first.start });
          reading.confirm.push(`The chat gives only ${CITY_NAME[first.city]}; ${CITY_NAME[other]} was taken as the start of the trip (${fmtDay(trip.start)}–${fmtDay(first.start)}).`);
        }
      }
    }
    if (chained.length) {
      reading.segments = chained;
      reading.evidence.push(...cluster.map(s => s.line).filter(l => !reading.evidence.includes(l)));
      const chatOrder = chained[0].city;
      // Dated stays decide the sequence, unless a later message asked for another order.
      if (reading.order && reading.order !== chatOrder) {
        if (orderAt > latest && !near(orderAt, latest)) {
          reading.confirm.push(`A later message asks for ${CITY_NAME[reading.order]} first, unlike the dated stays (${fmtSegments(chained)}).`);
        } else {
          reading.confirm.push(`The chat asks for ${CITY_NAME[reading.order]} first, but its dates put ${CITY_NAME[chatOrder]} first; the dates were used.`);
          reading.order = chatOrder;
        }
      } else reading.order = chatOrder;
      if (trip.start && trip.end) {
        const p = segmentProblems(chained, trip.start, trip.end);
        if (p.length) reading.problems.push(`Chat dates ${fmtSegments(chained)} do not match the Iraq trip ${fmtDay(trip.start)}–${fmtDay(trip.end)}.`);
      }
    }
  }
  // Nights per city with no dates: exact stays when they add up to the trip, else only the sequence.
  if (!reading.segments && nightsFound.length && trip.start && trip.end) {
    const n = nightsFound[nightsFound.length - 1];
    const cities = n.list.map(x => x.city);
    if (new Set(cities).size === cities.length && (!orderAt || n.at >= orderAt)) {
      const total = n.list.reduce((s, x) => s + x.nights, 0);
      const tripNights = daysBetween(trip.start, trip.end);
      reading.evidence.push(n.line);
      if (total === tripNights && n.list.length <= 2) {
        let d = trip.start;
        reading.segments = n.list.map(x => { const s = { city: x.city, start: d, end: addDays(d, x.nights) }; d = s.end; return s; });
        reading.order = n.list[0].city;
        latest = n.at;
      } else {
        reading.order = n.list[0].city;
        orderAt = n.at;
        reading.confirm.push(`The chat gives ${n.list.map(x => `${CITY_NAME[x.city]} ${x.nights}`).join(' + ')} nights, but the Iraq trip has ${tripNights}; only the sequence (${CITY_NAME[n.list[0].city]} first) was used.`);
      }
    }
  }
  const usedAt = latest || orderAt;
  const flags = new Set(flagsAt.filter(f => usedAt && near(usedAt, f.at)).flatMap(f => [...f.flags]));
  // N / K and days without a month are normal ways of writing; they need confirming only when the result is in doubt.
  const doubtful = !reading.segments || reading.problems.length > 0 || reading.confirm.length > 0 ||
    (trip.start && trip.end ? segmentProblems(reading.segments, trip.start, trip.end).length > 0 : true);
  for (const k of ['swapped', ...(doubtful ? ['letters', 'month'] : [])]) if (flags.has(k)) reading.confirm.push(CONFIRM_TEXT[k]);
  if (reading.order) reading.flexible = false;
  reading.confirm = [...new Set(reading.confirm)];
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
export const emptyLoad = (): Load => ({ NAJAF: {}, KARBALA: {} });
export function addLoad(load: Load, segments: Segment[], pax: number) {
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
export type Recommendation = 'approve' | 'confirm-dates' | 'hold-capacity' | 'wait' | 'follow-up' | 'needs-chat' | 'needs-itinerary' | 'resolve' | 'review-changes' | 'done';
export type SegmentSource = 'edited' | 'chat-dates' | 'chat-order' | 'balanced' | 'previous' | 'none';

/** One city-day a tour touches. `present`: approved in NKERP now; `before`/`after`: the expected count without/with this tour. */
export interface DayImpact { city: City; date: string; present: number; before: number; after: number; limit: number }
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
  /** Everything that needs the approver's attention (warnings and blockers). */
  problems: string[];
  /** The part of `problems` that stops the approval being sent: an unsaved itinerary, or a request NKERP can't take. */
  blockers: string[];
  /** The approver may select and approve this Tour ID now (it may still carry warnings). */
  approvable: boolean;
  /** Dustbin sign inside the cut-off: flagged for urgent follow-up with the Tour Operator. */
  urgent: boolean;
  /** What the AI interpreted in the chat box: the approver confirms these dates (warnings, never a block). */
  confirm: string[];
  /** NKERP's own Faiz / hotel pax when the approver changed the accommodation requirement (`tour` has the revised). */
  nkerpPax?: PaxSplit;
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
  /** Approved in NKERP now (the dashboard's count, as NKERP shows it). */
  present: number;
  /** What the day could reach: approved + pending approval + buffer for unsubmitted tours. */
  expected: number;
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
    urgent: number; itineraryMissing: number; approvable: number;
  };
  settings: ApprovalSettings;
  today: string;
}

export const ITINERARY_MISSING = 'Itinerary not saved in NKERP (the fly mark is not red): approval stays blocked until it is saved.';
export const ITINERARY_UNKNOWN = 'NKERP has not said whether the itinerary is saved (fly mark): refresh from NKERP before approving.';
/** An approval for this Tour ID (and this round of approval) was sent already; it is never sent twice. */
const sentAlready = (p: Pick<TourPlan, 'tour' | 'record'>) => Boolean(p.record?.approval &&
  ['api_reported_approved', 'attempting', 'uncertain_no_retry'].includes(p.record.approval.state) && p.record.approval.reapproval === p.tour.reapproval);

const kindOf = (t: ApprovalTour, revised = false): TourPlan['kind'] =>
  t.option === 1 ? 'preferred' : t.option === 3 && !revised ? 'hotel' : t.paxHotel > 0 && t.paxFaiz > 0 ? 'mixed' : t.paxFaiz > 0 ? 'faiz' : 'hotel';

/** The approver's accommodation change, while it still applies to the tour as NKERP holds it. */
export const accommodationOf = (t: Pick<ApprovalTour, 'modifiedOn' | 'paxTotal' | 'paxFaiz' | 'paxHotel'>, record?: ApprovalRecord): AccommodationChange | null => {
  const a = record?.accommodation;
  if (!a || a.modifiedOn !== t.modifiedOn || a.paxFaiz + a.paxHotel !== t.paxTotal) return null;
  return a.paxFaiz === t.paxFaiz && a.paxHotel === t.paxHotel ? null : a;
};

function impactOf(segments: Segment[], pax: number, base: Load, limits: Record<City, number>, present: Load = emptyLoad()): { impact: DayImpact[]; over: DayImpact[] } {
  const add = emptyLoad();
  addLoad(add, segments, pax);
  const impact: DayImpact[] = [];
  for (const city of CITIES) for (const date of Object.keys(add[city]).sort()) {
    const before = Math.round(at(base, city, date));
    impact.push({ city, date, present: Math.round(at(present, city, date)), before, after: before + add[city][date], limit: limits[city] });
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
  const present = emptyLoad();
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
    present[cell.city][cell.date] = cell.approved;
    hotelApproved[cell.city][cell.date] = cell.hotel;
  }

  // Buffer: Faiz pax of tours still missing submissions, kept free on their dates.
  const buffer = emptyLoad();
  const hotelPending = emptyLoad();
  const plans: TourPlan[] = [];
  for (const nk of tours) {
    const start = tripStart(nk), end = tripEnd(nk);
    const record = records[String(nk.id)];
    // The approver's Faiz / hotel split replaces NKERP's in the plan (capacity, kind, approval); NKERP's stays on record.
    const acc = accommodationOf(nk, record);
    const t: ApprovalTour = acc ? { ...nk, paxFaiz: acc.paxFaiz, paxHotel: acc.paxHotel } : nk;
    const chat = readChat(t.messages, { start, end });
    const kind = kindOf(t, Boolean(acc));
    const wasFaiz = Boolean(acc) && nk.paxFaiz > 0 && t.paxFaiz === 0;
    const submission = submissionState(t, settings.cutoffDays, today);
    const problems: string[] = [];
    /** Problems NKERP cannot accept from the planner (a subset of problems). */
    const hard: string[] = [];
    const notes: string[] = [];
    // The approver's edits stand until NKERP changes the tour.
    const edit = record?.edits && record.edits.modifiedOn === t.modifiedOn ? record.edits.segments : null;
    let suggested: Segment[] = [];
    let suggestedSource: SegmentSource = 'none';
    let flexible = false;
    const chatOk = chat.segments && !segmentProblems(chat.segments, start, end).length;
    // An approved Tour ID being changed starts from what NKERP approved; the approver edits from there.
    if (t.approvedEdit && t.previousPlans.length && !segmentProblems(t.previousPlans, start, end).length) { suggested = t.previousPlans; suggestedSource = 'previous'; }
    else if (chatOk) { suggested = chat.segments!; suggestedSource = 'chat-dates'; }
    else if (chat.order) { suggested = splitInOrder(start, end, chat.order); suggestedSource = 'chat-order'; }
    else if (kind === 'hotel' && !wasFaiz) {
      if (edit) notes.push('Chat box has no city dates or sequence: the city dates were entered by the approver.');
      else problems.push('Chat box has no city dates or sequence: hotel stays are approved only on the dates the Tour Operator gives.');
    } else if (t.reapproval && t.previousPlans.length && !segmentProblems(t.previousPlans, start, end).length) {
      suggested = t.previousPlans; suggestedSource = 'previous';
      notes.push('Keeps the previously approved city stays (they still fit the trip).');
    } else { suggested = splitInOrder(start, end, 'KARBALA'); suggestedSource = 'balanced'; flexible = true; }
    // Hotel stays need the exact dates; a Faiz tour can follow the requested sequence instead.
    if (chat.segments && !chatOk && (kind === 'hotel' || !chat.order) && !edit) problems.push(...chat.problems);
    else if (chat.problems.length) notes.push(...chat.problems);
    if (chat.flexible) notes.push('Tour Operator leaves the city order to the accommodation team.');
    if (acc) notes.push(`Accommodation changed by ${acc.by || 'the approver'}: ${acc.paxFaiz} Faiz / ${acc.paxHotel} hotel (NKERP has ${nk.paxFaiz} / ${nk.paxHotel}).`);
    if (t.itinerarySaved !== true) hard.push(t.itinerarySaved === false ? ITINERARY_MISSING : ITINERARY_UNKNOWN);
    if (kind === 'preferred') hard.push('Accommodation option is "Preferred": confirm Required or Not Required in NKERP before approving.');
    if (t.linkedTourId) hard.push(`Linked to tour ${t.linkedTourId}: approve it in NKERP so the link is kept.`);
    if (t.packageId) hard.push('Package tour: approve it in NKERP so the package rules are kept.');
    if (t.paxFaiz + t.paxHotel !== t.paxTotal) hard.push(`Pax do not add up (${t.paxFaiz} Faiz + ${t.paxHotel} hotel ≠ ${t.paxTotal}).`);
    if (daysBetween(start, end) < 1) hard.push('The Iraq arrival and departure fall on the same day.');
    if (kind === 'hotel' && !t.unread && !t.reapproval) notes.push('No unread (red) message in NKERP for this hotel tour.');

    const segments = edit ?? suggested;
    const source: SegmentSource = edit ? 'edited' : suggestedSource;
    if (edit) flexible = false;
    // What the AI read from the chat (or chose for a group moved from Faiz to hotel) waits for the approver's confirmation.
    const confirm = edit ? [] : [
      ...(source === 'chat-dates' || source === 'chat-order' ? chat.confirm : []),
      ...(wasFaiz && source !== 'chat-dates' ? ['Moved from Faiz to hotel: the chat box gives no hotel dates, so the AI\'s split is used. Confirm the dates.'] : []),
    ];
    const segProblems = segments.length ? segmentProblems(segments, start, end) : [];
    hard.push(...segProblems);
    problems.unshift(...hard);

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
      blockers: hard, approvable: false, urgent: false, confirm, ...(acc ? { nkerpPax: { faiz: nk.paxFaiz, hotel: nk.paxHotel } } : {}),
      category: 'awaiting', recommendation: 'resolve', fits: true, over: [], impact: [], original, originalSource, changes,
      oldFaiz: oldFaiz.get(t.id) ?? [],
      priority: (t.reapproval ? 0 : 2) + (isFaizOffice(t.office) ? 0 : 1),
    });
  }

  for (const p of plans) {
    const t = p.tour;
    if (p.submission.state === 'complete' && !t.reapproval) continue;
    if (t.reapproval) continue;
    const pax = p.nkerpPax ? t.paxFaiz : t.option === 3 ? 0 : t.paxFaiz || (t.option === 1 ? t.paxTotal : 0);
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
    const done = sentAlready(p);
    // Capacity is checked for every resolvable plan: an unsaved itinerary blocks the approval, not the planning.
    if (p.segments.length && !p.problems.some(x => x !== ITINERARY_MISSING && x !== ITINERARY_UNKNOWN)) {
      const b = base();
      const pax = t.paxFaiz;
      let { impact, over } = impactOf(p.segments, pax, b, limits, present);
      if (p.flexible && pax) {
        const other = splitInOrder(tripStart(t), tripEnd(t), firstCity(p.segments) === 'KARBALA' ? 'NAJAF' : 'KARBALA');
        if (other.length && other.map(s => s.city).join() !== p.segments.map(s => s.city).join()) {
          const alt = impactOf(other, pax, b, limits, present);
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
        const alt = impactOf(other, pax, b, limits, present);
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
    p.category = t.reapproval ? 'reapproval' : !blocked && p.fits && !p.confirm.length ? 'ready' : 'awaiting';
    const reviewed = p.record?.status === 'reapproval-reviewed' && p.record.reviewedModifiedOn === t.modifiedOn;
    p.recommendation = done ? 'done'
      : t.itinerarySaved !== true ? 'needs-itinerary'
      : !p.segments.length && p.kind === 'hotel' ? 'needs-chat'
      : blocked ? 'resolve'
      : !p.fits ? 'hold-capacity'
      : p.confirm.length ? 'confirm-dates'
      : t.reapproval && p.changes.length && !reviewed ? 'review-changes'
      : 'approve';
  }
  for (const p of plans) if (p.submission.state !== 'complete' && !p.tour.reapproval) {
    p.category = 'pending-submission';
    p.recommendation = sentAlready(p) ? 'done' : p.submission.state === 'follow-up' ? 'follow-up' : 'wait';
    // Show where the tour would land, without reserving it.
    if (p.segments.length && !segmentProblems(p.segments, tripStart(p.tour), tripEnd(p.tour)).length) {
      const r = impactOf(p.segments, p.tour.paxFaiz, base(), limits, present);
      p.impact = r.impact; p.over = r.over; p.fits = !r.over.length;
    }
  }

  // Only an unsaved itinerary (or a request NKERP can't take) stops an approval; the rest are warnings.
  for (const p of plans) {
    const done = sentAlready(p);
    if (!p.segments.length) {
      p.blockers.push(p.kind === 'hotel' ? 'Enter the Karbala and Najaf dates the Tour Operator gives to approve.' : 'No city stays yet.');
    }
    p.approvable = !done && !p.blockers.length;
    p.urgent = !done && p.tour.dustbin && p.submission.state === 'follow-up';
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
      const flipCheck = impactOf(flipped, m.tour.paxFaiz, trial, limits, present);
      if (flipCheck.over.length) continue;
      addLoad(trial, flipped, m.tour.paxFaiz);
      const options = h.flexible ? [h.segments, splitInOrder(tripStart(h.tour), tripEnd(h.tour), firstCity(h.segments) === 'KARBALA' ? 'NAJAF' : 'KARBALA')] : [h.segments];
      const fit = options.map(segs => ({ segs, r: impactOf(segs, h.tour.paxFaiz, trial, limits, present) })).find(o => !o.r.over.length);
      if (!fit) continue;
      const days = new Set([...m.segments, ...flipped].flatMap(s => dayRange(s.start, s.end)));
      const impact: DayImpact[] = [];
      const now = base();
      for (const city of CITIES) for (const d of [...days].sort()) {
        const before = Math.round(at(now, city, d));
        const after = Math.round(at(trial, city, d));
        if (before !== after) impact.push({ city, date: d, present: Math.round(at(present, city, d)), before, after, limit: limits[city] });
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
    const expected = ap + pend + buf;
    const available = limits[city] - expected;
    capacity.push({ date, city, limit: limits[city], approved: ap, pendingApproval: pend, buffer: buf, available,
      present: Math.round(at(present, city, date)), expected,
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
    urgent: plans.filter(p => p.urgent).length,
    itineraryMissing: plans.filter(p => p.tour.itinerarySaved !== true && !sentAlready(p)).length,
    approvable: plans.filter(p => p.approvable).length,
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
export function approvalPayload(detail: Record<string, any>, segments: Segment[], opts: { linkedTourId?: number; pax?: PaxSplit | null } = {}) {
  const t = detail;
  if (t.CurrentStatusId !== 23 || !t.IsActive || t.TimeZone !== 3) throw new Error('The tour is no longer pending approval in NKERP.');
  if (![2, 3].includes(t.AccomodationOptionId)) throw new Error('Accommodation option "Preferred" must be resolved in NKERP first.');
  for (const k of ['PaxCount', 'PaxRequiredAcc', 'PaxNotRequiredAcc']) {
    if (!Number.isInteger(t[k]) || t[k] < 0) throw new Error('NKERP pax figures are missing.');
  }
  if (t.PaxCount <= 0 || t.PaxRequiredAcc + t.PaxNotRequiredAcc !== t.PaxCount) throw new Error('Pax breakup does not add up in NKERP.');
  const pax = paxChange(t, opts.pax);
  if (!pax && ((t.AccomodationOptionId === 2 && t.PaxRequiredAcc === 0) || (t.AccomodationOptionId === 3 && t.PaxRequiredAcc !== 0))) {
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
  // The approver changed the Faiz / hotel split: NKERP's approval form sends the new pax figures, and switches
  // Mawaid on when there are Faiz pax and off when there are none (the form's own rule for the Faiz pax field).
  if (pax) Object.assign(body, { PaxRequiredAcc: pax.faiz, PaxNotRequiredAcc: pax.hotel, IsMawaidRequired: pax.faiz > 0, IsApprovedWithAccommodation: pax.faiz > 0 });
  return body;
}

/** The approver's Faiz / hotel split when it differs from NKERP's, checked against NKERP's total pax. */
export function paxChange(detail: Record<string, any>, pax?: PaxSplit | null): PaxSplit | null {
  if (!pax) return null;
  const faiz = Number(pax.faiz), hotel = Number(pax.hotel);
  if (!Number.isInteger(faiz) || !Number.isInteger(hotel) || faiz < 0 || hotel < 0) throw new Error('Enter whole numbers of Faiz and hotel pax.');
  if (faiz + hotel !== detail.PaxCount) throw new Error(`Faiz and hotel pax must add up to the tour's ${detail.PaxCount} pax (now ${faiz} + ${hotel}).`);
  return faiz === detail.PaxRequiredAcc && hotel === detail.PaxNotRequiredAcc ? null : { faiz, hotel };
}

/** An NKERP applicant as the approval form's "Applicant Details" list shows it. */
export interface Applicant { id: number; its: string; name: string; age: number | null; faiz: boolean; counted: boolean; infant: boolean }

/**
 * Whether NKERP's approval form asks for each applicant's "Accommodation Required" before approving a new Faiz
 * pax count (the form's own rule): once applicants are added, the applicants marked for accommodation must match
 * the new Faiz pax, except while the Muwafiqa is in states 29, 30, 38 or (unlocked) 31.
 */
export function applicantsMustMatch(o: { muwafiqaState: number | null; muwafiqaLocked: boolean; hasApplicants: boolean;
  accommodationCount: number; faizApplicants: number; newFaiz: number }): boolean {
  const { muwafiqaState: pt, muwafiqaLocked, hasApplicants, accommodationCount: wt, faizApplicants: ki, newFaiz } = o;
  if (!hasApplicants) return false;
  if (muwafiqaLocked && pt === 31) return wt !== newFaiz && ki !== newFaiz;
  if (pt === 38 || pt === 31 || pt === 29 || pt === 30) return false;
  if (newFaiz > 0 && wt !== newFaiz) return ki !== newFaiz;
  if (newFaiz === 0 && wt > 0) return ki > 0;
  if (newFaiz > 0 && wt === 0) return ki === 0;
  return false;
}

/** NKERP's Hv: an itinerary time after the tour time, or more than a day from it, makes NKERP ask for an itinerary update. */
const itineraryOff = (a: string, b: string) => {
  const x = Date.parse(a.slice(0, 16) + ':00Z'), y = Date.parse(b.slice(0, 16) + ':00Z');
  return Number.isFinite(x) && Number.isFinite(y) && (x > y || Math.abs(x - y) > 86_400_000);
};
/** Baghdad wall-clock time of an NKERP instant, as "YYYY-MM-DDTHH:mm". */
const localStamp = (v: string) => { const ms = instantMs(v); return Number.isFinite(ms) ? new Date(ms + OFFSET).toISOString().slice(0, 16) : ''; };

/**
 * NKERP's approved-tour Update request (Tour Admin → Approved → Update), with nothing changed: it returns the
 * Tour ID to NKERP's approval queue, where the planner then approves it again with the new dates and pax.
 * Built like the Update form: the form's values (less the fields the form drops, ModifiedOn among them), the
 * trip instants as they are, no reset of Ziyarat, transport, accommodation or Mawaid, and the current city stays.
 */
export function reopenPayload(status: Record<string, any>, opts: { linkedTourId?: number } = {}) {
  const t = status;
  if (t.CurrentStatusId !== 2 || !t.IsActive || t.TimeZone !== 3) throw new Error('The tour is not approved in NKERP (or no longer active), so it cannot be reopened from the planner.');
  if (opts.linkedTourId || t.LinkTourId) throw new Error('Linked tour: change it in NKERP so the link is kept.');
  if (t.PackageId) throw new Error('Package tour: change it in NKERP so the package rules are kept.');
  if (![2, 3].includes(t.AccomodationOptionId)) throw new Error('Accommodation option "Preferred" must be resolved in NKERP first.');
  for (const k of ['PaxCount', 'PaxRequiredAcc', 'PaxNotRequiredAcc']) if (!Number.isInteger(t[k]) || t[k] < 0) throw new Error('NKERP pax figures are missing.');
  const start = instantMs(t.StartDate), end = instantMs(t.EndDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('NKERP trip dates are missing.');
  const itinerary = Array.isArray(t.TransportItinerary) ? t.TransportItinerary : null;
  if (itinerary && !itinerary.length) throw new Error('The itinerary is not saved in NKERP (the fly mark is not red).');
  const leg = itinerary?.[0];
  if (leg && (itineraryOff(str0(leg.ArrivalDateTimeZone), localStamp(t.StartDate)) || itineraryOff(localStamp(t.EndDate), str0(leg.DepartureDateTimeZone)))) {
    throw new Error('NKERP would ask for the transport itinerary to be updated first (its times do not match the tour dates). Update it in NKERP, then try again.');
  }
  const body: Record<string, unknown> = {};
  for (const k of ['NoOfDays', 'PaxRequiredAcc', 'PaxNotRequiredAcc', 'IsMawaidRequired', 'IsPublic', 'IsMuwafiqaRequired',
    'IsArrDepTransportRequired', 'IsSubVenueTransportRequired', 'IsOtherTransportRequired', 'Remarks', 'EntryPortId', 'ExitPortId']) body[k] = t[k];
  Object.assign(body, {
    StartDate: new Date(start).toISOString(), EndDate: new Date(end).toISOString(),
    CountryId: Number(t.CountryId) > 0 ? t.CountryId : -1, CityId: Number(t.CityId) > 0 ? t.CityId : -1,
    IsTourConverted: 0, PackageId: 0, TourId: t.Id, LinkTourId: 0, AccomodationOptionId: t.AccomodationOptionId,
    IsZiyaratCreated: false, IsTransportChanged: false, IsZiyaratGroupReset: false, IsAccommodationChanged: false, IsMawaidChanged: false,
    TimeZone: 3, IsApprovedWithAccommodation: t.AccomodationOptionId === 2 ? true : t.PaxRequiredAcc > 0, IsTransportRequired: t.IsTransportRequired,
  });
  const plans = Array.isArray(t.TourSubvenuePlan) ? t.TourSubvenuePlan : [];
  if (plans.length) body.TourSubvenuePlan = plans.map((r: Record<string, unknown>) => ({ ...r, planEndDate: r.EndDate }));
  return body;
}
const str0 = (v: unknown) => String(v ?? '');

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
  date: string; limit: number; present: number; expected: number; headroom: number; arrivingPax: number;
  arrivals: { id: number; ref: string; pax: number; office: string }[];
}
/** Najaf-only daily report: projected Faiz occupancy and the proposal's Najaf arrivals (Faiz pax only). */
export function najafReport(plan: ApprovalPlan, include: (p: TourPlan) => boolean = inProposal): NajafReportRow[] {
  return plan.days.map(date => {
    const row = plan.capacity.find(c => c.date === date && c.city === 'NAJAF');
    const present = row?.present ?? 0;
    const expected = row?.expected ?? present;
    const arrivals = plan.plans.filter(p => include(p) && p.tour.paxFaiz > 0)
      .filter(p => p.segments.some(s => s.city === 'NAJAF' && s.start === date))
      .map(p => ({ id: p.tour.id, ref: p.tour.ref, pax: p.tour.paxFaiz, office: p.tour.office }));
    const limit = row?.limit ?? plan.settings.limits.NAJAF;
    return { date, limit, present, expected, headroom: limit - expected, arrivingPax: arrivals.reduce((s, a) => s + a.pax, 0), arrivals };
  });
}

/** The issue and a practical next step for a Tour ID that is not in the proposal. */
export function suggestion(p: TourPlan, plan?: ApprovalPlan): { issue: string; next: string } {
  const s = p.submission;
  const shift = plan?.shifts.find(x => x.admits.tour.id === p.tour.id);
  switch (p.recommendation) {
    case 'follow-up': return { issue: `Urgent: dustbin sign, submission incomplete, ${s.daysToArrival} days to arrival (cut-off ${s.cutoffDays}).`,
      next: `Contact the Tour Operator now (NKERP chat or WhatsApp) to complete the pending details.${p.approvable ? ' You can still approve if required.' : ''}` };
    case 'wait': return { issue: `Dustbin sign: submission incomplete, ${s.daysToArrival} days to arrival.`,
      next: `Wait for the Tour Operator; follow up from ${fmtDay(addDays(tripStart(p.tour), -s.cutoffDays))} if still incomplete.` };
    case 'needs-itinerary': return { issue: p.blockers[0] ?? ITINERARY_MISSING,
      next: p.tour.itinerarySaved === false ? 'Ask the Tour Operator to save the transport itinerary in NKERP (NKERP chat or WhatsApp).' : 'Refresh from NKERP.' };
    case 'needs-chat': return { issue: 'No city dates or sequence in the chat box.', next: 'Ask the Tour Operator for the Karbala and Najaf dates in the chat box.' };
    case 'hold-capacity': return { issue: p.problems.find(x => x.startsWith('Over the')) ?? 'Does not fit capacity.',
      next: shift ? `Shift the whole of ${shift.move.tour.ref} to ${CITY_NAME[shift.to[0].city]} first, then approve.`
        : p.alternative?.fits ? `Ask the Tour Operator to accept ${fmtSegments(p.alternative.segments)} (fits).`
        : 'Hold on the waitlist until space frees on those dates; do not split the group.' };
    case 'confirm-dates': return { issue: p.confirm[0] ?? 'The AI interpreted the chat dates.', next: 'Check the chat box, then press Confirm dates (or correct them) and approve.' };
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

/**
 * Tour IDs whose Tour Operator should be chased now: dustbin inside the cut-off, or, inside the cut-off, a hotel
 * tour with no chat dates or a tour whose itinerary is not saved.
 */
export const needsFollowUp = (p: TourPlan) => p.recommendation === 'follow-up' ||
  ((p.recommendation === 'needs-chat' || (p.recommendation === 'needs-itinerary' && p.tour.itinerarySaved === false)) &&
    p.submission.daysToArrival <= p.submission.cutoffDays);

/** What the approver should know before approving: shown in the confirmation, never a reason to refuse. */
export function approvalWarnings(p: TourPlan): string[] {
  const out: string[] = [];
  const s = p.submission;
  if (p.tour.dustbin) out.push(p.urgent
    ? `Dustbin sign: some details are still pending, ${s.daysToArrival} days to arrival (inside the ${s.cutoffDays}-day cut-off).`
    : `Dustbin sign: some details are still pending; arrival is ${s.daysToArrival} days away, beyond the ${s.cutoffDays}-day cut-off, so the Tour Operator normally still has time.`);
  if (p.tour.reapproval && p.changes.length && reapprovalStatus(p) === 'Pending') out.push(`Re-approval: ${p.changes.length} change${p.changes.length === 1 ? '' : 's'} not marked reviewed yet.`);
  if (!p.fits) {
    const worst = p.over.reduce((m, o) => (o.after - o.limit > m.after - m.limit ? o : m), p.over[0]);
    out.push(worst ? `Over the ${CITY_NAME[worst.city]} limit on ${fmtDay(worst.date)} (${worst.after}/${worst.limit}).` : 'Does not fit capacity.');
  }
  if (p.source === 'edited' && !p.chat.segments && p.kind === 'hotel') out.push('Hotel stay on the approver\'s dates: the chat box has none.');
  for (const x of p.confirm) out.push(`Dates not confirmed yet: ${x}`);
  if (p.nkerpPax) out.push(`Accommodation changed: ${p.tour.paxFaiz} Faiz / ${p.tour.paxHotel} hotel instead of NKERP's ${p.nkerpPax.faiz} / ${p.nkerpPax.hotel}; NKERP's figures are updated with the approval.`);
  for (const x of p.problems) if (!p.blockers.includes(x) && !/^Over the /.test(x) && !out.includes(x)) out.push(x);
  if (p.tour.unread) out.push('Unread message from the Tour Operator in the NKERP chat box.');
  return out;
}

const DATES_ITEM = 'Karbala and Najaf dates are not in the NKERP chat box';
const needsDates = (p: TourPlan) => !p.segments.length || p.recommendation === 'needs-chat';
/** How to write the city dates, shown once under the pending items. */
const DATES_EXAMPLE = ['*Example:*', '• First Subvenue: *10 October to 15 October (Najaf)*', '• Second Subvenue: *15 October to 21 October (Karbala)*'];
const ITINERARY_ITEM = 'Transport itinerary (flight details) is not saved in NKERP';
function pendingItems(p: TourPlan): string[] {
  const items: string[] = [];
  if (p.tour.dustbin) items.push('Red-click itinerary and zaereen details are not fully submitted in NKERP');
  if (p.tour.itinerarySaved === false && !sentAlready(p)) items.push(ITINERARY_ITEM);
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
    'Salaam Jameel',
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
      'Salaam Jameel', '', `*${office}*: the following Tour IDs still have pending submissions:`, '', ...lines, '',
      ...(tours.some(needsDates) ? [...DATES_EXAMPLE, ''] : []),
      `Submissions are due ${cutoff} days before arrival in Iraq. Kindly complete them at the earliest so the accommodation can be approved.`, '', 'Shukran',
    ].join('\n') };
  }).sort((a, b) => a.tours[0].tour.arrivalAt.localeCompare(b.tours[0].tour.arrivalAt));
}

// ------------------------------------------------------------------------------------------------ NKERP chat

/** WhatsApp bold marks removed: NKERP's chat box shows plain text. */
export const plainText = (text: string) => text.replace(/\*/g, '');

/** Ready-made follow-ups for the Tour ID's NKERP chat box: the full list of pending items, then each on its own. */
export function chatTemplates(p: TourPlan): { label: string; text: string }[] {
  const t = p.tour;
  const head = `Salaam Jameel\n\nTour ID: ${t.ref}\nIraq arrival: ${fmtDay(tripStart(t), true)} · ${t.paxTotal} pax\n\n`;
  const tail = `\n\n${dueLine(p)} Kindly complete it at the earliest so the accommodation can be approved.\n\nShukran`;
  const out: { label: string; text: string }[] = [];
  const items = pendingItems(p);
  if (items.length) out.push({ label: 'All pending details', text: plainText(followUpMessage(p)) });
  if (t.itinerarySaved === false) out.push({ label: 'Itinerary', text: `${head}Kindly save the transport itinerary (arrival and departure flight details) for this Tour ID in NKERP. The accommodation can be approved only once it is saved.${tail}` });
  if (needsDates(p)) out.push({ label: 'Subvenue dates', text: `${head}Kindly send the Karbala and Najaf dates in this chat box.\n\n${plainText(DATES_EXAMPLE.join('\n'))}${tail}` });
  if (t.option === 1) out.push({ label: 'Accommodation', text: `${head}Kindly confirm whether Faiz accommodation is Required or Not Required for this Tour ID.${tail}` });
  if (t.dustbin) out.push({ label: 'Submission', text: `${head}The red-click itinerary and zaereen details are not fully submitted in NKERP yet. Kindly complete them.${tail}` });
  return out;
}
