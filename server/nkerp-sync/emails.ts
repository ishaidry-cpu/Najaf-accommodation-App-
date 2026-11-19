/**
 * Najaf accommodation emails: the two envelope icons on NKERP's "View Tour Accommodation Status" screen
 * (Manage Accommodation), done through the NKERP API for Najaf stays only.
 *
 *   Envelope 1, "Send Accommodation Plan"                 -> the tour operator
 *        POST api/Property/getTourAccommodationPlan              (bundle constant SENT_ACCOMMODATION_PLAN)
 *   Envelope 2, "Send Accommodation Plan to Applicants"   -> the zaereen of the tour
 *        POST api/Property/sentAccommodationPlanToApplicants/    (SENT_ACCOMMODATION_PLAN_TO_APPLICANTS)
 *
 * Both take the sub-venue row of the tour's "Accommodation Schedule" exactly as the screen sends it:
 *   {StartDateTimeZone, SubvenueId, TourId, VenueId}
 * The list is POST api/Property/getTourAccomodationList (GET_TOUR_ACCOMMODATION_LIST); each tour row carries
 * TourSubvenuePlan[] with SubvenueId / SubvenueName, StartDateTimeZone / EndDateTimeZone, AccomudationStatusID
 * (1 full, 2 partial, 3 not assigned: the screen hides both envelopes for 3) and IsMailSentToTO /
 * IsMailSentToApplicants (the envelope turns red once sent). Checked against the live bundle
 * main.b9a44537.js on 19 Nov 2026.
 *
 * Safety:
 *   - Only Najaf (SubvenueId 3) rows are ever listed or sent; Karbala and every other sub-venue are dropped.
 *   - The browser only names (tour, Najaf start date, recipient). Every payload is rebuilt from a fresh read
 *     of NKERP just before sending, so a stale page can never send for the wrong stay.
 *   - Not-assigned stays are never sent; an already-sent email is only sent again when explicitly asked.
 *   - One send at a time, never retried. A send with no clear answer stops the run (it may have gone out).
 *   - A fresh read afterwards confirms each email by NKERP's own "sent" flag.
 */
import { NkerpClient, NAJAF, Rejected } from './nkerpClient.js';
import type { LogLevel, NkRecord } from './types.js';
import { addDays, day, errorMessage, norm } from './util.js';

export const TOUR_LIST = 'api/Property/getTourAccomodationList';
export const SEND_TO_OPERATOR = 'api/Property/getTourAccommodationPlan';
export const SEND_TO_ZAEREEN = 'api/Property/sentAccommodationPlanToApplicants/';
export const EMAIL_ENDPOINTS = { reads: [TOUR_LIST], writes: [SEND_TO_OPERATOR, SEND_TO_ZAEREEN] } as const;

/** Tours whose overall arrival is this many days back can still have a Najaf stay ahead. */
export const LIST_LOOKBACK_DAYS = 45;
export const MAX_EMAILS_PER_RUN = 400;

export type Recipient = 'operator' | 'zaereen';
export const RECIPIENTS: readonly Recipient[] = ['operator', 'zaereen'];

/** What the emails screen needs from NKERP (the real client below, or a fake in tests). */
export interface EmailApi {
  tourList(arrivalFrom: string): Promise<NkRecord[]>;
  send(to: Recipient, payload: EmailPayload): Promise<NkRecord>;
}

export interface EmailPayload {
  StartDateTimeZone: unknown;
  SubvenueId: unknown;
  TourId: unknown;
  VenueId: unknown;
}

export class NkerpEmailClient implements EmailApi {
  readonly client: NkerpClient;

  constructor(opts: { allowWrite?: boolean; signal?: AbortSignal } = {}) {
    this.client = new NkerpClient({ ...opts, endpoints: EMAIL_ENDPOINTS });
  }

  tourList(arrivalFrom: string): Promise<NkRecord[]> {
    return this.client.paged(TOUR_LIST, {
      FromDateFromSearch: `${arrivalFrom}T00:00:00`, FromDateToSearch: null, ITSNoSearch: null, IsNotArrived: '',
      ToDateFromSearch: null, ToDateToSearch: null, TourSearchRefNo: '', TOOfficeNameSearch: '', Status: '',
      clientTimeZoneOffset: -180, group: '1', sortBy: 'StartDateTimeZone', itemsPerPage: 100, maxSize: 10,
      totalItems: 0, reverse: false,
    }, 'listTourAccommotionDetails', (r) => JSON.stringify([r.TourReferenceId ?? null,
      (r.TourSubvenuePlan || []).map((p: NkRecord) => [p.TourId, p.SubvenueId, p.StartDateTimeZone])]));
  }

  send(to: Recipient, payload: EmailPayload): Promise<NkRecord> {
    return this.client.write(to === 'operator' ? SEND_TO_OPERATOR : SEND_TO_ZAEREEN, payload);
  }
}

// ------------------------------------------------------------------------------------------------ the list

export type AllotmentStatus = 'full' | 'partial' | 'none' | 'unknown';

/** One Najaf stay of one tour: one row on the emails page, with its two envelopes. */
export interface NajafStay {
  /** `${tourId}|${najafStart}`: what the browser sends back to name this stay. */
  key: string;
  tourId: string;
  ref: string;
  operator: string;
  office: string;
  pax: number | null;
  arrival: string | null;
  departure: string | null;
  najafStart: string;
  najafEnd: string | null;
  allotment: AllotmentStatus;
  operatorSent: boolean;
  zaereenSent: boolean;
}

export interface NajafDay {
  date: string;
  stays: NajafStay[];
}

export interface EmailList {
  today: string;
  days: NajafDay[];
  /** Najaf-looking rows that were left out, with why (shown so nothing disappears silently). */
  excluded: string[];
}

const STATUS: Record<number, AllotmentStatus> = { 1: 'full', 2: 'partial', 3: 'none' };

export function stayKey(tourId: unknown, start: string): string {
  return `${String(tourId)}|${start}`;
}

function isNajaf(p: NkRecord): boolean | null {
  const id = Number(p.SubvenueId);
  const name = norm(p.SubvenueName);
  if (id === NAJAF) return name && !name.includes('NAJAF') ? null : true;   // id and name disagree: unsafe
  return false;
}

/** NKERP rows -> Najaf stays starting today or later, grouped by Najaf check-in day. */
export function najafSchedule(rows: NkRecord[], today: string): EmailList {
  const excluded: string[] = [];
  const stays = new Map<string, NajafStay>();
  for (const r of rows) {
    for (const p of r.TourSubvenuePlan || []) {
      const najaf = isNajaf(p);
      const ref = String(r.TourReferenceId ?? '').trim();
      if (najaf === null) {
        excluded.push(`${ref}: sub-venue id 3 is named "${p.SubvenueName}", not Najaf; left out`);
        continue;
      }
      if (!najaf) continue;
      const start = day(p.StartDateTimeZone);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        excluded.push(`${ref}: Najaf stay without a readable start date; left out`);
        continue;
      }
      if (start < today) continue;
      if (p.TourId === undefined || p.TourId === null || p.TourId === '') {
        excluded.push(`${ref}: Najaf stay without a tour id; left out`);
        continue;
      }
      const key = stayKey(p.TourId, start);
      if (stays.has(key)) continue;
      const pax = Number(r.PaxCount);
      stays.set(key, {
        key, tourId: String(p.TourId), ref, operator: String(r.TOName ?? '').trim(), office: String(r.OfficeName ?? '').trim(),
        pax: Number.isFinite(pax) ? pax : null, arrival: r.ArrivalDate ? day(r.ArrivalDate) : null,
        departure: r.DepartureDate ? day(r.DepartureDate) : null, najafStart: start,
        najafEnd: p.EndDateTimeZone ? day(p.EndDateTimeZone) : null,
        allotment: STATUS[Number(p.AccomudationStatusID)] ?? 'unknown',
        operatorSent: p.IsMailSentToTO === true, zaereenSent: p.IsMailSentToApplicants === true,
      });
    }
  }
  const byDay = new Map<string, NajafStay[]>();
  for (const s of stays.values()) {
    const list = byDay.get(s.najafStart) ?? [];
    list.push(s);
    byDay.set(s.najafStart, list);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, stays: list.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)) }));
  return { today, days, excluded };
}

/** The live plan row behind a stay, for building its payload. */
function planIndex(rows: NkRecord[], today: string): Map<string, { plan: NkRecord; row: NkRecord }> {
  const out = new Map<string, { plan: NkRecord; row: NkRecord }>();
  for (const r of rows) {
    for (const p of r.TourSubvenuePlan || []) {
      if (isNajaf(p) !== true) continue;
      const start = day(p.StartDateTimeZone);
      if (start < today || p.TourId === undefined || p.TourId === null) continue;
      const key = stayKey(p.TourId, start);
      if (!out.has(key)) out.set(key, { plan: p, row: r });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ sending

export interface EmailRequestItem {
  stay: string;
  to: Recipient;
  /** Send even though NKERP shows this email as already sent. */
  resend?: boolean;
}

export type EmailOutcome = 'confirmed' | 'sent' | 'refused' | 'skipped' | 'uncertain' | 'not-run';

export interface EmailResult {
  stay: string;
  to: Recipient;
  ref: string;
  najafStart: string;
  outcome: EmailOutcome;
  message: string;
}

export interface EmailRunSummary {
  requested: number;
  confirmed: number;
  sent: number;
  refused: number;
  skipped: number;
  uncertain: number;
  notRun: number;
  stopped: string | null;
}

export interface EmailEvent {
  level: LogLevel;
  message: string;
  result?: EmailResult;
  current?: number;
  total?: number;
}

export interface EmailRunDeps {
  api: EmailApi;
  today: string;
  progress?: (e: EmailEvent) => void;
  signal?: AbortSignal;
  deadline?: number;
}

/** Strictly validate the browser's list of emails to send. Throws a message for the user. */
export function validateEmailRequest(body: any): EmailRequestItem[] {
  if (!body || !Array.isArray(body.items) || !body.items.length) throw new Error('Choose at least one email to send');
  if (body.items.length > MAX_EMAILS_PER_RUN) throw new Error(`At most ${MAX_EMAILS_PER_RUN} emails in one run`);
  if (body.confirm !== true) throw new Error('Sending emails needs confirm: true');
  const seen = new Set<string>();
  const out: EmailRequestItem[] = [];
  for (const it of body.items) {
    if (!it || typeof it.stay !== 'string' || !/^[^|]{1,40}\|\d{4}-\d{2}-\d{2}$/.test(it.stay)) throw new Error('Each email must name a stay');
    if (!RECIPIENTS.includes(it.to)) throw new Error('Each email must go to the operator or the zaereen');
    if (it.resend !== undefined && typeof it.resend !== 'boolean') throw new Error('resend must be true or false');
    const k = `${it.stay}|${it.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ stay: it.stay, to: it.to, ...(it.resend ? { resend: true } : {}) });
  }
  return out;
}

const RECIPIENT_LABEL: Record<Recipient, string> = { operator: 'tour operator', zaereen: 'zaereen' };

function nkMessage(resp: NkRecord | undefined): string {
  const m = resp?.ReturnMessage;
  if (Array.isArray(m)) return m.filter(Boolean).join('; ');
  return m === undefined || m === null ? '' : String(m);
}

/** Send the requested emails, one at a time, then confirm them with a fresh read. */
export async function runEmails(items: EmailRequestItem[], deps: EmailRunDeps): Promise<{ results: EmailResult[]; summary: EmailRunSummary }> {
  const progress = deps.progress ?? (() => {});
  const { api, today } = deps;
  progress({ level: 'info', message: `Reading NKERP's tour accommodation list for ${items.length} email${items.length === 1 ? '' : 's'}` });
  const live = planIndex(await api.tourList(addDays(today, -LIST_LOOKBACK_DAYS)), today);

  // Send in a stable order: by Najaf date, tour, then the operator before the zaereen.
  const ordered = [...items].sort((a, b) => {
    const [, da] = a.stay.split('|');
    const [, db] = b.stay.split('|');
    return da !== db ? (da < db ? -1 : 1) : a.stay !== b.stay ? (a.stay < b.stay ? -1 : 1) : a.to === 'operator' ? -1 : 1;
  });
  const results: EmailResult[] = [];
  let stopped: string | null = null;
  const report = (r: EmailResult, level: LogLevel) => {
    results.push(r);
    progress({ level, message: `${r.ref || r.stay} ${r.najafStart} → ${RECIPIENT_LABEL[r.to]}: ${r.message}`, result: r,
      current: results.length, total: ordered.length });
  };

  for (const it of ordered) {
    const [, start] = it.stay.split('|');
    const hit = live.get(it.stay);
    const base = { stay: it.stay, to: it.to, ref: hit ? String(hit.row.TourReferenceId ?? '') : '', najafStart: start };
    if (stopped) {
      report({ ...base, outcome: 'not-run', message: 'not sent: the run stopped before this one' }, 'warn');
      continue;
    }
    if (deps.signal?.aborted) {
      stopped = 'stopped from the page; emails already sent stay sent';
      report({ ...base, outcome: 'not-run', message: 'not sent: stopped before this one' }, 'warn');
      continue;
    }
    if (deps.deadline && Date.now() >= deps.deadline) {
      stopped = 'time limit reached; press Send again for the rest (already-sent emails are skipped)';
      report({ ...base, outcome: 'not-run', message: 'not sent: time limit reached' }, 'warn');
      continue;
    }
    if (!hit) {
      report({ ...base, outcome: 'skipped', message: 'not sent: NKERP no longer lists this Najaf stay from today' }, 'warn');
      continue;
    }
    const { plan } = hit;
    if (Number(plan.AccomudationStatusID) === 3) {
      report({ ...base, outcome: 'skipped', message: 'not sent: no rooms are assigned in NKERP yet' }, 'warn');
      continue;
    }
    const already = it.to === 'operator' ? plan.IsMailSentToTO === true : plan.IsMailSentToApplicants === true;
    if (already && !it.resend) {
      report({ ...base, outcome: 'skipped', message: 'not sent: NKERP shows it was already sent' }, 'info');
      continue;
    }
    const payload: EmailPayload = { StartDateTimeZone: plan.StartDateTimeZone, SubvenueId: plan.SubvenueId,
      TourId: plan.TourId, VenueId: plan.VenueId };
    try {
      const resp = await api.send(it.to, payload);
      if (resp && resp.ReturnStatus === false) {
        report({ ...base, outcome: 'refused', message: `NKERP refused: ${nkMessage(resp) || 'no reason given'}` }, 'error');
      } else {
        report({ ...base, outcome: 'sent', message: `sent${nkMessage(resp) ? ` (${nkMessage(resp)})` : ''}` }, 'success');
      }
    } catch (err) {
      if (err instanceof Rejected) {
        report({ ...base, outcome: 'refused', message: `NKERP refused: ${err.message}` }, 'error');
      } else {
        stopped = 'a send got no clear answer from NKERP, so no further emails were sent';
        report({ ...base, outcome: 'uncertain', message: `no clear answer (${errorMessage(err)}); it may have gone out. `
          + 'Check its envelope in NKERP before sending again' }, 'error');
      }
    }
  }

  // Confirm by NKERP's own "sent" flags.
  const sent = results.filter((r) => r.outcome === 'sent' || r.outcome === 'uncertain');
  if (sent.length) {
    progress({ level: 'info', message: 'Checking NKERP marks the emails as sent' });
    try {
      const after = planIndex(await api.tourList(addDays(today, -LIST_LOOKBACK_DAYS)), today);
      for (const r of sent) {
        const p = after.get(r.stay)?.plan;
        const flag = p && (r.to === 'operator' ? p.IsMailSentToTO === true : p.IsMailSentToApplicants === true);
        if (flag && r.outcome === 'sent') {
          r.outcome = 'confirmed';
          r.message = 'sent and confirmed by NKERP';
        } else if (flag && r.outcome === 'uncertain') {
          r.message = 'NKERP now shows it as sent (the answer was lost, but it went out)';
          r.outcome = 'confirmed';
        } else if (r.outcome === 'sent') {
          r.message = 'NKERP accepted it but does not show it as sent yet; check its envelope in NKERP';
        }
      }
    } catch (err) {
      progress({ level: 'warn', message: `Could not re-read NKERP to confirm (${errorMessage(err)}); the sends themselves were accepted` });
    }
  }
  const count = (o: EmailOutcome) => results.filter((r) => r.outcome === o).length;
  const summary: EmailRunSummary = { requested: ordered.length, confirmed: count('confirmed'), sent: count('sent'),
    refused: count('refused'), skipped: count('skipped'), uncertain: count('uncertain'), notRun: count('not-run'), stopped };
  progress({ level: summary.refused || summary.uncertain ? 'warn' : 'success', message:
    `Done: ${summary.confirmed + summary.sent} sent (${summary.confirmed} confirmed), ${summary.refused} refused, `
    + `${summary.skipped} skipped${summary.notRun ? `, ${summary.notRun} not run` : ''}` });
  return { results, summary };
}
