/**
 * AI Approval Planner, server side: reads NKERP's Tour Admin approval queues (new and re-approval), each tour's
 * chat box and previous city stays, and the Najaf/Karbala accommodation dashboard; keeps every Tour ID's
 * approval history in the app database; and sends an approver's Approve action to NKERP.
 *
 * Reads only, except POST approvalActionOnTour, which is sent once per approver click and never retried.
 * Chat text is the Tour Operator's data, never instructions. Chats are never marked read here.
 */
import { NkerpClient, Rejected } from './nkerp-sync/nkerpClient.js';
import { nkerpLogin } from './nkerp-sync/credentials.js';
import type { NkRecord } from './nkerp-sync/types.js';
import { read, transaction, write } from './accommodation-store.js';
import {
  addDays, type ApprovalRecord, type ApprovalSettings, type ApprovalSnapshot, type ApprovalTour, approvalPayload, cityFromId,
  type DayCell, dustbinVisible, factsOf, latestPlanSet, localDay, midnightUtc, normalizeApprovalSettings, type Segment,
  segmentProblems, todayBaghdad,
} from '../src/services/approvalPlanner.js';

export const QUEUE = 'api/tours/getpendingtours';
export const DASHBOARD = 'api/tours/getAccommodationStatusDashBoard';
export const APPROVE = 'api/tours/approvalActionOnTour';
const DETAIL = /^api\/tours\/getTourSubVenue\/\d+$/;
const GENERAL = /^api\/tours\/getTourDetail\/\d+$/;
const CHAT = /^api\/masters\/retrieveChat\/\d+\/\d+\/74$/;
export const approvalReads = (path: string) => path === QUEUE || path === DASHBOARD || DETAIL.test(path) || GENERAL.test(path) || CHAT.test(path);

export type ApprovalApi = Pick<NkerpClient, 'read' | 'write'>;
export const approvalClient = (allowWrite: boolean, signal?: AbortSignal): ApprovalApi =>
  new NkerpClient({ allowWrite, signal, endpoints: { reads: approvalReads, writes: [APPROVE] } });

const str = (v: unknown) => String(v ?? '').trim();
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const settings = (): ApprovalSettings =>
  normalizeApprovalSettings(read<{ approvalSettings?: unknown }>('settings', {}).approvalSettings);
export const records = () => read<Record<string, ApprovalRecord>>('approval-records', {});
export const snapshot = () => read<ApprovalSnapshot>('approval-snapshot', { collectedAt: null, window: null, tours: [], dashboard: [], errors: [] });

/** Every row of one Tour Admin queue (pending = state 23, re-approval = 200). */
export async function readQueue(client: ApprovalApi, reapproval: boolean, from: string | null, to: string | null) {
  const rows: NkRecord[] = [];
  const seen = new Set<number>();
  for (let page = 1; page < 50; page++) {
    const r = await client.read(QUEUE, {
      itemsPerPage: 1000, maxSize: 10, currentPage: page, clientTimeZoneOffset: -180, Action: 23,
      StateId: reapproval ? 200 : 23, IsReApprovedTours: reapproval, sortBy: 'StartDate', reverse: false,
      totalItems: 0, group: '7', venueSearchId: 2, FromDateFromSearch: from, FromDateToSearch: to,
    });
    const chunk = r.Tours;
    if (!Array.isArray(chunk)) throw new Error('NKERP approval queue returned no Tours list');
    for (const t of chunk) {
      if (seen.has(t.Id)) throw new Error('NKERP repeated a tour in the approval queue; not planning on a partial list');
      seen.add(t.Id);
      rows.push(t);
    }
    if (rows.length >= int(r.TotalRows)) return rows;
    if (!chunk.length) throw new Error(`NKERP approval queue stopped at ${rows.length} of ${r.TotalRows} tours`);
  }
  throw new Error('NKERP approval queue has too many pages');
}

/** Both cities' daily accommodation counts (30 days per request). Missing days are not zero. */
export async function readDashboard(client: ApprovalApi, start: string, end: string): Promise<DayCell[]> {
  const out = new Map<string, DayCell>();
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 31)) {
    const last = addDays(cursor, 30) < end ? addDays(cursor, 30) : end;
    const r = await client.read(DASHBOARD, { VenueId: 2, FromDate: midnightUtc(cursor), ToDate: midnightUtc(last), TimeZone: 3 });
    const sections = r.AccommodationStatusSubVenueDetails;
    if (!Array.isArray(sections)) throw new Error('NKERP dashboard returned no city sections');
    for (const sec of sections) {
      const city = cityFromId(sec.SubVenueId);
      if (!city) continue;
      for (const x of sec.AccommodationStatusDetails || []) {
        const date = str(x.Date).slice(0, 10);
        if (date < cursor || date > last) continue;
        out.set(`${city}|${date}`, {
          date, city, approved: int(x.TotalCountAccommodationYes),
          hotel: int(x.TotalCountAccommodationNoMawaidYes) + int(x.TotalCountAccommodationNoMawaidNo),
          occupants: (x.CapacityTours || []).map((o: NkRecord) => ({ id: int(o.TourId), ref: str(o.TourReferenceNo),
            office: str(o.OfficeName), faiz: int(o.PaxRequiredCount), hotel: int(o.PaxNotRequiredCount) })),
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.city.localeCompare(b.city));
}

export function mapTour(row: NkRecord, messages: ApprovalTour['messages'], previousPlans: Segment[]): ApprovalTour {
  return {
    id: int(row.Id), ref: str(row.ReferenceNo), office: str(row.PartnerOfficeName || row.OfficeName || row.TOName),
    toName: str(row.TOName), toId: int(row.TOId), reapproval: Boolean(row.IsReApproval),
    arrivalAt: str(row.StartDate), departureAt: str(row.EndDate),
    paxTotal: int(row.PaxCount), paxFaiz: int(row.PaxRequiredAcc), paxHotel: int(row.PaxNotRequiredAcc),
    option: int(row.AccomodationOptionId), optionLabel: str(row.Option), venue: str(row.VenueName),
    unread: row.IsRead === false || row.IsRead === 0, dustbin: dustbinVisible(row),
    muwafiqaState: row.MuwaficaStateId == null ? null : int(row.MuwaficaStateId),
    locked: Boolean(row.IsLocked), muwafiqaLocked: Boolean(row.IsMuwaficaLocked),
    packageId: int(row.PackageId), linkedTourId: int(row.LinkTourId), modifiedOn: str(row.ModifiedOn),
    entryPort: str(row.EntryPortName), exitPort: str(row.ExitPortName), mawaid: Boolean(row.IsMawaidRequired),
    transport: Boolean(row.IsTransportRequired), cutOffDays: row.CutOffDays == null ? null : int(row.CutOffDays),
    remarks: str(row.TORemarks || row.Remarks),
    events: (row.TourEventHistory || []).map((e: NkRecord) => ({ event: str(e.Event), remarks: str(e.Remarks),
      by: str(e.ActionBy), at: str(e.ActionOn) })).slice(-30),
    messages, previousPlans,
  };
}

interface ChatCache { [id: string]: { at: number; modifiedOn: string; unread: boolean; messages: ApprovalTour['messages'] } }
interface DetailCache { [id: string]: { modifiedOn: string; plans: Segment[] } }

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** One read-only pass over NKERP, merged into the app's approval history. */
export async function collectApprovals(client: ApprovalApi, now = Date.now()) {
  const conf = settings();
  const today = todayBaghdad(now);
  const from = addDays(today, -10);
  const to = addDays(today, conf.horizonDays);
  const errors: string[] = [];
  const [reRows, newRows] = await Promise.all([readQueue(client, true, null, null), readQueue(client, false, from, to)]);
  // Re-approvals of trips that are over are of no use for planning.
  const rows = [...reRows.filter(r => localDay(str(r.EndDate)) >= addDays(today, -1)),
    ...newRows.filter(r => !r.IsReApproval && localDay(str(r.StartDate)) >= from && localDay(str(r.StartDate)) <= to)];

  const chats = read<ChatCache>('approval-chat-cache', {});
  const details = read<DetailCache>('approval-detail-cache', {});
  const keepChats: ChatCache = {};
  const keepDetails: DetailCache = {};
  await pool(rows, 6, async row => {
    const id = String(row.Id);
    const cached = chats[id];
    const unread = row.IsRead === false || row.IsRead === 0;
    const fresh = cached && cached.modifiedOn === str(row.ModifiedOn) && cached.unread === unread &&
      now - cached.at < (unread ? 10 : 360) * 60_000;
    if (fresh) keepChats[id] = cached;
    else {
      try {
        const r = await client.read(`api/masters/retrieveChat/${int(row.TOId)}/${int(row.Id)}/74`);
        keepChats[id] = { at: now, modifiedOn: str(row.ModifiedOn), unread, messages: (r.listChat || []).map((m: NkRecord) => ({
          text: str(m.Message), at: str(m.CreatedOn), sender: str(m.SenderName),
          fromOperator: int(m.SenderId) === int(row.TOId) || int(m.SenderGroupId) === 4 })) };
      } catch (err) {
        if (cached) keepChats[id] = cached;
        errors.push(`${str(row.ReferenceNo)}: chat could not be read (${err instanceof Error ? err.message : 'error'})`);
      }
    }
    if (row.IsReApproval) {
      const d = details[id];
      if (d && d.modifiedOn === str(row.ModifiedOn)) keepDetails[id] = d;
      else {
        try {
          const r = await client.read(`api/tours/getTourSubVenue/${int(row.Id)}`);
          keepDetails[id] = { modifiedOn: str(row.ModifiedOn), plans: latestPlanSet(r.TourPlan?.TourSubvenuePlan || []) };
        } catch (err) {
          if (d) keepDetails[id] = d;
          errors.push(`${str(row.ReferenceNo)}: previous city stays could not be read (${err instanceof Error ? err.message : 'error'})`);
        }
      }
    }
  });
  const tours = rows.map(r => mapTour(r, keepChats[String(r.Id)]?.messages ?? [], keepDetails[String(r.Id)]?.plans ?? []));
  const lastDay = tours.reduce((m, t) => (localDay(t.departureAt) > m ? localDay(t.departureAt) : m), to);
  const dashEnd = lastDay < addDays(today, 150) ? lastDay : addDays(today, 150);
  const dashboard = await readDashboard(client, addDays(today, -1), dashEnd);
  const snap: ApprovalSnapshot = { collectedAt: new Date(now).toISOString(), window: { from, to }, tours, dashboard, errors };
  transaction(() => {
    write('approval-chat-cache', keepChats);
    write('approval-detail-cache', keepDetails);
    write('approval-snapshot', snap);
    write('approval-records', mergeRecords(records(), tours, new Date(now).toISOString()));
  });
  return snap;
}

/** Track each Tour ID across refreshes: a tour that returns for re-approval keeps its earlier history. */
export function mergeRecords(previous: Record<string, ApprovalRecord>, tours: ApprovalTour[], stamp: string) {
  const out: Record<string, ApprovalRecord> = { ...previous };
  const present = new Set<string>();
  for (const t of tours) {
    const id = String(t.id);
    present.add(id);
    const facts = factsOf(t, t.previousPlans);
    const r: ApprovalRecord = out[id] ? { ...out[id], history: [...out[id].history] } : {
      id: t.id, ref: t.ref, office: t.office, status: t.reapproval ? 'reapproval-pending' : 'new', firstSeenAt: stamp,
      lastSeenAt: stamp, history: [{ at: stamp, kind: t.reapproval ? 'reapproval-detected' : 'submitted' }],
      ...(t.reapproval ? { reapprovalSince: stamp } : {}),
    };
    const wasAway = r.status === 'left-queue' || r.status === 'approved' || r.status === 're-approved';
    if (t.reapproval) {
      if (r.status === 'new' || wasAway) {
        // It was approved before (it would not be in re-approval otherwise): what it held then is the original.
        if (r.submittedFacts && !r.approvedFacts) r.approvedFacts = r.submittedFacts;
        r.status = 'reapproval-pending';
        r.reapprovalSince = stamp;
        delete r.reviewedAt; delete r.reviewedModifiedOn;
        r.history.push({ at: stamp, kind: 'reapproval-detected' });
      } else if (r.status === 'reapproval-reviewed' && r.reviewedModifiedOn !== t.modifiedOn) {
        r.status = 'reapproval-pending';
        r.history.push({ at: stamp, kind: 'changed-after-review', note: 'NKERP changed the tour after it was reviewed.' });
      }
    } else {
      if (wasAway && r.status !== 'approved') r.history.push({ at: stamp, kind: 'back-in-queue' });
      if (r.status !== 'approved' || r.approval?.state !== 'api_reported_approved') r.status = 'new';
      r.submittedFacts = facts;
    }
    // The approver's edits apply to the tour as it was; NKERP's later changes replace them.
    if (r.edits && r.edits.modifiedOn !== t.modifiedOn) {
      r.history.push({ at: stamp, kind: 'edits-cleared', note: 'NKERP changed the tour, so the approver\'s dates were reset.' });
      delete r.edits;
    }
    Object.assign(r, { ref: t.ref, office: t.office, lastSeenAt: stamp });
    out[id] = r;
  }
  for (const [id, r] of Object.entries(out)) {
    if (present.has(id) || r.status === 'left-queue' || r.status === 'approved' || r.status === 're-approved') continue;
    const approvedHere = r.approval?.state === 'api_reported_approved';
    out[id] = { ...r, status: approvedHere ? (r.approval!.reapproval ? 're-approved' : 'approved') : 'left-queue',
      history: [...r.history, { at: stamp, kind: 'left-queue', note: approvedHere ? 'Approved from the planner.' : 'No longer in the NKERP approval queues.' }] };
  }
  // Keep history for 120 days after a tour was last seen.
  const cutoff = Date.parse(stamp) - 120 * 86_400_000;
  for (const [id, r] of Object.entries(out)) if (Date.parse(r.lastSeenAt) < cutoff) delete out[id];
  return out;
}

export class ApprovalError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/**
 * Send one Approve action for an approver-reviewed Tour ID. The tour's detail is read first so the request
 * carries NKERP's current form values; if NKERP changed the tour since the approver looked, nothing is sent.
 */
export async function approveTour(client: ApprovalApi, input: { id: number; segments: Segment[]; modifiedOn: string }, now = Date.now()) {
  const id = int(input.id);
  const stamp = new Date(now).toISOString();
  const current = records()[String(id)];
  const tour = snapshot().tours.find(t => t.id === id);
  if (!tour) throw new ApprovalError('This Tour ID is not in the latest approval queues. Refresh and try again.', 404);
  const sent = current?.approval;
  if (sent && sent.reapproval === tour.reapproval && ['attempting', 'uncertain_no_retry', 'api_reported_approved'].includes(sent.state)) {
    throw new ApprovalError(sent.state === 'api_reported_approved' ? 'NKERP already accepted this approval.'
      : 'An approval for this Tour ID was already sent and its result is unknown. Check it in NKERP; it is not sent twice.', 409);
  }
  const segments = (input.segments || []).map(s => ({ city: s.city, start: str(s.start), end: str(s.end) }));
  const r = await client.read(`api/tours/getTourSubVenue/${id}`);
  const detail = r.TourPlan;
  if (!detail || int(detail.Id) !== id) throw new ApprovalError('NKERP did not return this tour.', 502);
  if (str(detail.ModifiedOn) !== str(input.modifiedOn)) {
    throw new ApprovalError('NKERP changed this tour after you reviewed it. Refresh the planner and check it again.', 409);
  }
  const general = await client.read(`api/tours/getTourDetail/${id}`);
  const exact = [general.Tour, general.TourDetailForAddApplicant].filter(x => x && int(x.Id) === id);
  if (!exact.length) throw new ApprovalError('NKERP did not return the tour\'s link details.', 502);
  const problems = segmentProblems(segments, localDay(detail.StartDate), localDay(detail.EndDate));
  if (problems.length) throw new ApprovalError(problems.join(' '));
  let payload: Record<string, unknown>;
  try { payload = approvalPayload(detail, segments, { linkedTourId: int(exact[0].LinkTourId) }); }
  catch (err) { throw new ApprovalError(err instanceof Error ? err.message : 'This tour cannot be approved from the planner.'); }

  const journal = (state: NonNullable<ApprovalRecord['approval']>['state'], message?: string) => transaction(() => {
    const all = records();
    const rec: ApprovalRecord = all[String(id)] ?? { id, ref: tour.ref, office: tour.office, status: tour.reapproval ? 'reapproval-pending' : 'new',
      firstSeenAt: stamp, lastSeenAt: stamp, history: [] };
    rec.approval = { state, at: new Date().toISOString(), message, segments, reapproval: tour.reapproval };
    rec.history = [...rec.history, { at: new Date().toISOString(), kind: `approval-${state}`, note: message }];
    if (state === 'api_reported_approved') {
      rec.approvedFacts = factsOf(tour, segments);
      rec.approvedAt = rec.approval.at;
      rec.status = tour.reapproval ? 're-approved' : 'approved';
    }
    all[String(id)] = rec;
    write('approval-records', all);
    return rec;
  });
  journal('attempting');
  try {
    const response = await client.write(APPROVE, payload);
    const ok = response.ReturnStatus === true;
    return journal(ok ? 'api_reported_approved' : 'api_rejected', ok ? undefined : str(response.ReturnMessage) || 'NKERP did not accept the approval.');
  } catch (err) {
    if (err instanceof Rejected) return journal('api_rejected', err.message);
    return journal('uncertain_no_retry', err instanceof Error ? err.message : 'No response from NKERP.');
  }
}

export function saveEdit(input: { id: number; segments: Segment[] | null; modifiedOn: string }) {
  return transaction(() => {
    const all = records();
    const id = String(int(input.id));
    const tour = snapshot().tours.find(t => String(t.id) === id);
    if (!tour) throw new ApprovalError('This Tour ID is not in the latest approval queues.', 404);
    const stamp = new Date().toISOString();
    const rec: ApprovalRecord = all[id] ?? { id: tour.id, ref: tour.ref, office: tour.office, status: tour.reapproval ? 'reapproval-pending' : 'new',
      firstSeenAt: stamp, lastSeenAt: stamp, history: [] };
    if (input.segments) {
      const segments = input.segments.filter(s => s && (s.city === 'NAJAF' || s.city === 'KARBALA'))
        .map(s => ({ city: s.city, start: str(s.start), end: str(s.end) }));
      rec.edits = { segments, at: stamp, modifiedOn: tour.modifiedOn };
      rec.history = [...rec.history, { at: stamp, kind: 'dates-edited', note: segments.map(s => `${s.city} ${s.start}–${s.end}`).join(', ') }];
    } else {
      delete rec.edits;
      rec.history = [...rec.history, { at: stamp, kind: 'dates-reset' }];
    }
    all[id] = rec;
    write('approval-records', all);
    return rec;
  });
}

export function saveReview(input: { id: number; reviewed: boolean }) {
  return transaction(() => {
    const all = records();
    const id = String(int(input.id));
    const tour = snapshot().tours.find(t => String(t.id) === id);
    if (!tour?.reapproval) throw new ApprovalError('Only a Tour ID in re-approval can be marked reviewed.', 400);
    const stamp = new Date().toISOString();
    const rec: ApprovalRecord = all[id] ?? { id: tour.id, ref: tour.ref, office: tour.office, status: 'reapproval-pending',
      firstSeenAt: stamp, lastSeenAt: stamp, history: [], reapprovalSince: stamp };
    if (input.reviewed) Object.assign(rec, { status: 'reapproval-reviewed', reviewedAt: stamp, reviewedModifiedOn: tour.modifiedOn });
    else { rec.status = 'reapproval-pending'; delete rec.reviewedAt; delete rec.reviewedModifiedOn; }
    rec.history = [...rec.history, { at: stamp, kind: input.reviewed ? 'reviewed' : 'review-undone' }];
    all[id] = rec;
    write('approval-records', all);
    return rec;
  });
}

/** Refresh in the background at most every 15 minutes (the scheduled tick), and on demand. */
export function createApprovalRefresh() {
  let running: Promise<ApprovalSnapshot> | undefined;
  const status = { running: false, error: null as string | null };
  function refresh() {
    if (running) return running;
    status.running = true;
    running = (async () => {
      nkerpLogin();
      return collectApprovals(approvalClient(false, AbortSignal.timeout(110_000)));
    })().then(s => { status.error = null; return s; }, err => {
      status.error = err instanceof Error ? err.message : 'NKERP approval queues could not be read.';
      throw err;
    }).finally(() => { status.running = false; running = undefined; });
    return running;
  }
  const due = (now = Date.now()) => {
    const at = snapshot().collectedAt;
    return !at || now - Date.parse(at) > 15 * 60_000;
  };
  return { refresh, status, due };
}
