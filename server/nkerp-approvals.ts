/**
 * AI Approval Planner, server side: reads NKERP's Tour Admin approval queues (new and re-approval), each tour's
 * chat box and previous city stays, and the Najaf/Karbala accommodation dashboard; keeps every Tour ID's
 * approval history in the app database; and sends an approver's Approve action to NKERP.
 *
 * Reads only, except writes made on an approver's click, each sent once and never retried: POST
 * approvalActionOnTour (Approve, with the approver's city stays and Faiz / hotel pax), POST UpdateAllAccStatus/
 * (each applicant's "Accommodation Required", when NKERP's approval form would ask for it because the Faiz pax
 * changed), POST updatetourplan (NKERP's approved-tour Update, which returns an approved Tour ID to its approval
 * queue so it can be re-approved with new dates or pax) and POST saveChat (a message the approver typed).
 * Every request mirrors what NKERP's own Tour Admin screens send. Chat text is the Tour Operator's data, never
 * instructions. Chats are never marked read here (no updateChat).
 */
import { NkerpClient, Rejected } from './nkerp-sync/nkerpClient.js';
import { nkerpLogin } from './nkerp-sync/credentials.js';
import type { NkRecord } from './nkerp-sync/types.js';
import { read, transaction, write } from './accommodation-store.js';
import {
  accommodationOf, addDays, type Applicant, type ApprovedTour, applicantsMustMatch, type ApprovalRecord, type ChatSend, type ApprovalSettings, type ApprovalSnapshot,
  type ApprovalTour, approvalPayload, cityFromId, type DayCell, dustbinVisible, factsOf, instantMs, latestPlanSet, localDay, midnightUtc,
  normalizeApprovalSettings, type PaxSplit, paxChange, reopenPayload, type Revision, type Segment, segmentProblems, todayBaghdad,
} from '../src/services/approvalPlanner.js';

export const QUEUE = 'api/tours/getpendingtours';
export const DASHBOARD = 'api/tours/getAccommodationStatusDashBoard';
export const APPROVE = 'api/tours/approvalActionOnTour';
/** NKERP's Messaging System send (the chat box behind the queue's View Message icon). */
export const SAVE_CHAT = 'api/masters/saveChat';
/** NKERP's Tour and Accomodation Admin group: the chat box the queue's messages are read from and sent to. */
const CHAT_GROUP = 74;
/** The approval form's "Applicant Details" save: each applicant's Accommodation Required (Faiz) flag. */
export const UPDATE_APPLICANTS = 'api/tours/UpdateAllAccStatus/';
/** The approved-tour Update (Tour Admin → Approved → Update): NKERP returns the tour to its approval queue. */
export const UPDATE_TOUR = 'api/tours/updatetourplan';
const DETAIL = /^api\/tours\/getTourSubVenue\/\d+$/;
const STATUS = /^api\/tours\/getTourStatus\/\d+$/;
const GENERAL = /^api\/tours\/getTourDetail\/\d+$/;
const CHAT = /^api\/masters\/retrieveChat\/\d+\/\d+\/74$/;
const APPLICANTS = /^api\/tours\/(?:getApplicants|getApplicantCount|getApplicantCountForAccommodation)\/\d+$/;
export const approvalReads = (path: string) => path === QUEUE || path === DASHBOARD || DETAIL.test(path) || STATUS.test(path) ||
  GENERAL.test(path) || CHAT.test(path) || APPLICANTS.test(path);

export type ApprovalApi = Pick<NkerpClient, 'read' | 'write' | 'readAny'>;
export const approvalClient = (allowWrite: boolean, signal?: AbortSignal): ApprovalApi =>
  new NkerpClient({ allowWrite, signal, endpoints: { reads: approvalReads, writes: [APPROVE, SAVE_CHAT, UPDATE_APPLICANTS, UPDATE_TOUR] } });

const str = (v: unknown) => String(v ?? '').trim();
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const settings = (): ApprovalSettings =>
  normalizeApprovalSettings(read<{ approvalSettings?: unknown }>('settings', {}).approvalSettings);
export const records = () => read<Record<string, ApprovalRecord>>('approval-records', {});
export const snapshot = () => read<ApprovalSnapshot>('approval-snapshot', { collectedAt: null, window: null, tours: [], dashboard: [], errors: [] });

/** Approved Tour IDs found by a search (NKERP's Approved list), and the ones opened for a change. */
export const approvedList = () => read<{ at: string | null; window: { from: string; to: string } | null; tours: ApprovalTour[] }>('approval-approved-list', { at: null, window: null, tours: [] });
export const approvedOpen = () => read<Record<string, ApprovedTour>>('approval-approved-open', {});
/** Every Tour ID the planner knows now: the queues, then the approved ones opened for a change. */
const knownTour = (id: number): ApprovalTour | undefined => snapshot().tours.find(t => t.id === id) ?? approvedOpen()[String(id)]?.tour;
const cleanName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;

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
    ...itineraryOf(row),
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

/** NKERP's fly mark: the queue row's Add/Edit Transport Itinerary icon is red when an itinerary is saved. */
export function itineraryOf(row: NkRecord): Pick<ApprovalTour, 'itinerarySaved' | 'itinerary'> {
  const list = row.TransportItinerary;
  if (!Array.isArray(list)) return { itinerarySaved: null, itinerary: null };
  const first = list[0];
  return { itinerarySaved: list.length > 0, itinerary: first ? { arrivalCode: str(first.ArrivalTransportCode),
    arrivalAt: str(first.ArrivalDateTimeZone), departureCode: str(first.DepartureTransportCode), departureAt: str(first.DepartureDateTimeZone) } : null };
}

const chatMessages = (r: NkRecord, toId: number): ApprovalTour['messages'] => (r.listChat || []).map((m: NkRecord) => ({
  text: str(m.Message), at: str(m.CreatedOn), sender: str(m.SenderName),
  fromOperator: int(m.SenderId) === toId || int(m.SenderGroupId) === 4 }));

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
        keepChats[id] = { at: now, modifiedOn: str(row.ModifiedOn), unread, messages: chatMessages(r, int(row.TOId)) };
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
    if (r.accommodation && r.accommodation.modifiedOn !== t.modifiedOn) {
      const kept = r.accommodation.paxFaiz === t.paxFaiz && r.accommodation.paxHotel === t.paxHotel;
      r.history.push({ at: stamp, kind: 'accommodation-cleared', note: kept ? 'NKERP now holds the approver\'s Faiz / hotel split.'
        : `NKERP changed the tour, so the approver's accommodation change (${r.accommodation.paxFaiz} Faiz / ${r.accommodation.paxHotel} hotel) was reset.` });
      delete r.accommodation;
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

/** NKERP's applicants for a tour, as its approval form reads them before a Faiz pax change. */
export async function readApplicants(client: ApprovalApi, id: number) {
  const [countRaw, accRaw, listRaw] = await Promise.all([
    client.readAny(`api/tours/getApplicantCount/${id}`),
    client.readAny(`api/tours/getApplicantCountForAccommodation/${id}`),
    client.read(`api/tours/getApplicants/${id}`),
  ]);
  const raw: NkRecord[] = (Array.isArray(listRaw.Applicants) ? listRaw.Applicants : []).filter((a: NkRecord) => a && !a.IsCancellation);
  const applicants: Applicant[] = raw.map(a => ({
    id: int(a.Id), its: str(a.User?.ITSId ?? a.ITSId), age: a.Age == null ? null : int(a.Age), infant: Boolean(a.IsInfant),
    name: [a.User?.Title, a.User?.FirstName, a.User?.MiddleName, a.User?.LastName].map(str).filter(Boolean).join(' ') || str(a.FullName || a.Name),
    faiz: int(a.AccomodationOptionId) === 2, counted: a.IsActive === true && a.IsInfant === false && a.IsDummy === false,
  }));
  return {
    raw, applicants,
    // The form's own tests: any answer from getApplicantCount means applicants are added; the accommodation count is a number.
    hasApplicants: Boolean(countRaw), accommodationCount: typeof accRaw === 'number' ? accRaw : Number.NaN,
    faizApplicants: raw.filter(a => int(a.AccomodationOptionId) === 2).length,
  };
}
export type ApplicantInfo = Awaited<ReturnType<typeof readApplicants>>;

/** What the planner shows before a Faiz pax change: the applicants, and whether NKERP needs them chosen. */
export async function applicantChoice(client: ApprovalApi, input: { id: number; paxFaiz: number }) {
  const id = int(input.id);
  const tour = knownTour(id);
  if (!tour) throw new ApprovalError('This Tour ID is not in the planner. Refresh and try again.', 404);
  const info = await readApplicants(client, id);
  const mustMatch = applicantsMustMatch({ muwafiqaState: tour.muwafiqaState, muwafiqaLocked: tour.muwafiqaLocked, hasApplicants: info.hasApplicants,
    accommodationCount: info.accommodationCount, faizApplicants: info.faizApplicants, newFaiz: int(input.paxFaiz) });
  return { applicants: info.applicants, mustMatch, hasApplicants: info.hasApplicants };
}

/**
 * The applicants' list NKERP's "Applicant Details" save sends: every applicant, each marked Accommodation Required
 * (Faiz) or not. The approver's choice must give exactly the new Faiz pax among active, non-infant applicants.
 */
export function applicantUpdate(info: ApplicantInfo, faizIds: number[] | undefined, newFaiz: number): NkRecord[] {
  if (!Array.isArray(faizIds)) throw new ApprovalError(`NKERP needs to know which applicants get Faiz accommodation: choose ${newFaiz} applicant${newFaiz === 1 ? '' : 's'}.`, 409);
  const chosen = new Set(faizIds.map(int));
  for (const x of chosen) if (!info.raw.some(a => int(a.Id) === x)) throw new ApprovalError('An applicant chosen for Faiz accommodation is no longer on the tour. Reload the applicants.', 409);
  const list: NkRecord[] = info.raw.map(a => ({ ...a, IsAccRequired: chosen.has(int(a.Id)), AccomodationOptionId: chosen.has(int(a.Id)) ? 2 : 3 }));
  const counted = list.filter(a => a.IsAccRequired === true && a.IsActive === true && a.IsInfant === false && a.IsDummy === false).length;
  if (counted !== newFaiz) throw new ApprovalError(`You need to select ${newFaiz} pax for Faiz accommodation (${counted} selected; infants are not counted).`, 409);
  return list;
}

type ApprovalJournal = (state: NonNullable<ApprovalRecord['approval']>['state'], message?: string) => ApprovalRecord;

/**
 * The approval itself: the applicants' Faiz flags first when NKERP's form would ask for them, then one Approve.
 * Each write is journaled before it is sent and never repeated; a refusal or a lost answer stops here.
 */
async function sendApproval(client: ApprovalApi, tour: ApprovalTour, detail: NkRecord, segments: Segment[], pax: PaxSplit | null,
  faizIds: number[] | undefined, journal: ApprovalJournal) {
  const id = int(detail.Id);
  const general = await client.read(`api/tours/getTourDetail/${id}`);
  const exact = [general.Tour, general.TourDetailForAddApplicant].filter(x => x && int(x.Id) === id);
  if (!exact.length) throw new ApprovalError('NKERP did not return the tour\'s link details.', 502);
  const problems = segmentProblems(segments, localDay(detail.StartDate), localDay(detail.EndDate));
  if (problems.length) throw new ApprovalError(problems.join(' '));
  let payload: Record<string, unknown>;
  let change: PaxSplit | null;
  try {
    change = paxChange(detail, pax);
    payload = approvalPayload(detail, segments, { linkedTourId: int(exact[0].LinkTourId), pax: change });
  } catch (err) { throw new ApprovalError(err instanceof Error ? err.message : 'This tour cannot be approved from the planner.'); }
  let applicants: NkRecord[] | null = null;
  if (change) {
    const info = await readApplicants(client, id);
    const must = applicantsMustMatch({ muwafiqaState: tour.muwafiqaState, muwafiqaLocked: Boolean(detail.IsMuwaficaLocked ?? tour.muwafiqaLocked),
      hasApplicants: info.hasApplicants, accommodationCount: info.accommodationCount, faizApplicants: info.faizApplicants, newFaiz: change.faiz });
    if (must) applicants = applicantUpdate(info, faizIds, change.faiz);
  }
  journal('attempting', applicants ? 'Updating the applicants\' Faiz accommodation, then approving.' : undefined);
  if (applicants) {
    try {
      const r = await client.write(UPDATE_APPLICANTS, applicants);
      if (r.ReturnStatus === false) return journal('api_rejected', `NKERP did not accept the applicants' Faiz accommodation: ${str(r.ReturnMessage) || 'no reason given'}. Nothing was approved.`);
    } catch (err) {
      if (err instanceof Rejected) return journal('api_rejected', `NKERP did not accept the applicants' Faiz accommodation (${err.message}). Nothing was approved.`);
      return journal('uncertain_no_retry', `No answer from NKERP to the applicants' Faiz accommodation update, so the approval was not sent. Check the applicants in NKERP. (${err instanceof Error ? err.message : 'no response'})`);
    }
  }
  try {
    const response = await client.write(APPROVE, payload);
    const ok = response.ReturnStatus === true;
    return journal(ok ? 'api_reported_approved' : 'api_rejected', ok ? undefined
      : `${str(response.ReturnMessage) || 'NKERP did not accept the approval.'}${applicants ? ' (The applicants\' Faiz accommodation was already updated in NKERP.)' : ''}`);
  } catch (err) {
    if (err instanceof Rejected) return journal('api_rejected', err.message);
    return journal('uncertain_no_retry', err instanceof Error ? err.message : 'No response from NKERP.');
  }
}

const statusLabel = (r?: ApprovalRecord) => (!r ? 'New' : r.status === 'approved' ? 'Approved' : r.status === 're-approved' ? 'Re-approved'
  : r.status === 'reapproval-pending' ? 'Re-approval pending' : r.status === 'reapproval-reviewed' ? 'Re-approval reviewed'
  : r.status === 'left-queue' ? 'Left the queue' : 'Awaiting approval');
const addRevision = (rec: ApprovalRecord, rev: Revision) => { rec.revisions = [...(rec.revisions ?? []), rev].slice(-60); };
const blankRecord = (tour: ApprovalTour, stamp: string): ApprovalRecord => ({ id: tour.id, ref: tour.ref, office: tour.office,
  status: tour.reapproval ? 'reapproval-pending' : 'new', firstSeenAt: stamp, lastSeenAt: stamp, history: [] });

/**
 * Send one Approve action for an approver-reviewed Tour ID. The tour's detail is read first so the request
 * carries NKERP's current form values; if NKERP changed the tour since the approver looked, nothing is sent.
 * The approver's saved Faiz / hotel split (if any) goes with it, as NKERP's approval form sends it.
 */
export async function approveTour(client: ApprovalApi, input: { id: number; segments: Segment[]; modifiedOn: string; faizApplicants?: number[]; by?: string }, now = Date.now()) {
  const id = int(input.id);
  const stamp = new Date(now).toISOString();
  const by = cleanName(input.by);
  const current = records()[String(id)];
  const tour = snapshot().tours.find(t => t.id === id);
  if (!tour) throw new ApprovalError('This Tour ID is not in the latest approval queues. Refresh and try again.', 404);
  // The one rule that blocks approval: NKERP's fly mark must be red (the itinerary is saved).
  if (tour.itinerarySaved !== true) {
    throw new ApprovalError(tour.itinerarySaved === false
      ? 'The itinerary is not saved in NKERP (the fly mark is not red). Approval is blocked until the Tour Operator saves it.'
      : 'NKERP has not said whether the itinerary is saved. Refresh from NKERP and try again.', 409);
  }
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
  const acc = accommodationOf(tour, current);
  const pax = acc ? { faiz: acc.paxFaiz, hotel: acc.paxHotel } : null;
  const previousStatus = statusLabel(current);
  const journal: ApprovalJournal = (state, message) => transaction(() => {
    const all = records();
    const rec: ApprovalRecord = all[String(id)] ?? blankRecord(tour, stamp);
    const at = new Date().toISOString();
    rec.approval = { state, at, message, segments, reapproval: tour.reapproval };
    rec.history = [...rec.history, { at, kind: `approval-${state}`, note: message, ...(by ? { by } : {}) }];
    if (state === 'api_reported_approved') {
      const approvedTour = pax ? { ...tour, paxFaiz: pax.faiz, paxHotel: pax.hotel } : tour;
      rec.approvedFacts = factsOf(approvedTour, segments);
      rec.approvedAt = at;
      rec.status = tour.reapproval ? 're-approved' : 'approved';
    }
    if (state !== 'attempting') {
      addRevision(rec, { at, by, kind: 'approval',
        original: { segments: tour.previousPlans, paxFaiz: tour.paxFaiz, paxHotel: tour.paxHotel },
        revised: { segments, paxFaiz: pax?.faiz ?? tour.paxFaiz, paxHotel: pax?.hotel ?? tour.paxHotel },
        previousStatus, latestStatus: state === 'api_reported_approved' ? (tour.reapproval ? 'Re-approved' : 'Approved') : state === 'api_rejected' ? 'Refused by NKERP' : 'Sent, answer unknown',
        ...(message ? { note: message } : {}) });
    }
    all[String(id)] = rec;
    write('approval-records', all);
    return rec;
  });
  return sendApproval(client, tour, detail, segments, pax, input.faizApplicants, journal);
}

/** Save (or with null, reset) the approver's city dates for a Tour ID in the queues or an opened approved one. */
export function saveEdit(input: { id: number; segments: Segment[] | null; modifiedOn: string; by?: string; confirmed?: boolean }) {
  return transaction(() => {
    const all = records();
    const id = String(int(input.id));
    const tour = knownTour(int(input.id));
    if (!tour) throw new ApprovalError('This Tour ID is not in the latest approval queues.', 404);
    const stamp = new Date().toISOString();
    const by = cleanName(input.by);
    const rec: ApprovalRecord = all[id] ?? blankRecord(tour, stamp);
    const before = rec.edits?.modifiedOn === tour.modifiedOn ? rec.edits.segments : null;
    if (input.segments) {
      const segments = input.segments.filter(s => s && (s.city === 'NAJAF' || s.city === 'KARBALA'))
        .map(s => ({ city: s.city, start: str(s.start), end: str(s.end) }));
      rec.edits = { segments, at: stamp, modifiedOn: tour.modifiedOn };
      rec.history = [...rec.history, { at: stamp, kind: input.confirmed ? 'dates-confirmed' : 'dates-edited',
        note: segments.map(s => `${s.city} ${s.start}–${s.end}`).join(', '), ...(by ? { by } : {}) }];
      addRevision(rec, { at: stamp, by, kind: 'dates', original: { segments: before ?? tour.previousPlans, paxFaiz: tour.paxFaiz, paxHotel: tour.paxHotel },
        revised: { segments, paxFaiz: tour.paxFaiz, paxHotel: tour.paxHotel }, previousStatus: statusLabel(all[id]), latestStatus: statusLabel(rec),
        note: input.confirmed ? 'The AI\'s chat dates were confirmed.' : 'City dates changed.' });
    } else {
      delete rec.edits;
      rec.history = [...rec.history, { at: stamp, kind: 'dates-reset', ...(by ? { by } : {}) }];
    }
    all[id] = rec;
    write('approval-records', all);
    return rec;
  });
}

/**
 * Save (or with null, reset) the approver's accommodation requirement: how many of the tour's pax get Faiz
 * accommodation and how many go to hotels. NKERP's own figures are kept beside it; NKERP is updated with the approval.
 */
export function saveAccommodation(input: { id: number; paxFaiz: number | null; paxHotel: number | null; by?: string }) {
  return transaction(() => {
    const all = records();
    const id = String(int(input.id));
    const tour = knownTour(int(input.id));
    if (!tour) throw new ApprovalError('This Tour ID is not in the planner. Refresh and try again.', 404);
    const stamp = new Date().toISOString();
    const by = cleanName(input.by);
    const rec: ApprovalRecord = all[id] ?? blankRecord(tour, stamp);
    const before = accommodationOf(tour, rec);
    if (input.paxFaiz === null || input.paxHotel === null) {
      delete rec.accommodation;
      rec.history = [...rec.history, { at: stamp, kind: 'accommodation-reset', note: `Back to NKERP's ${tour.paxFaiz} Faiz / ${tour.paxHotel} hotel.`, ...(by ? { by } : {}) }];
    } else {
      const faiz = Number(input.paxFaiz), hotel = Number(input.paxHotel);
      if (!Number.isInteger(faiz) || !Number.isInteger(hotel) || faiz < 0 || hotel < 0) throw new ApprovalError('Enter whole numbers of Faiz and hotel pax.');
      if (faiz + hotel !== tour.paxTotal) throw new ApprovalError(`Faiz and hotel pax must add up to the tour's ${tour.paxTotal} pax (now ${faiz} + ${hotel}).`);
      if (tour.option === 1) throw new ApprovalError('Accommodation option is "Preferred": confirm Required or Not Required in NKERP first.');
      if (faiz === tour.paxFaiz && hotel === tour.paxHotel) delete rec.accommodation;
      else rec.accommodation = { paxFaiz: faiz, paxHotel: hotel, at: stamp, ...(by ? { by } : {}), modifiedOn: tour.modifiedOn, nkerp: { faiz: tour.paxFaiz, hotel: tour.paxHotel } };
      rec.history = [...rec.history, { at: stamp, kind: 'accommodation-changed', note: `${faiz} Faiz / ${hotel} hotel (NKERP has ${tour.paxFaiz} / ${tour.paxHotel}).`, ...(by ? { by } : {}) }];
      addRevision(rec, { at: stamp, by, kind: 'accommodation',
        original: { segments: tour.previousPlans, paxFaiz: before?.paxFaiz ?? tour.paxFaiz, paxHotel: before?.paxHotel ?? tour.paxHotel },
        revised: { segments: tour.previousPlans, paxFaiz: faiz, paxHotel: hotel }, previousStatus: statusLabel(all[id]), latestStatus: statusLabel(rec),
        note: `NKERP has ${tour.paxFaiz} Faiz / ${tour.paxHotel} hotel; NKERP is updated when the Tour ID is approved.` });
    }
    all[id] = rec;
    write('approval-records', all);
    return rec;
  });
}

// ------------------------------------------------------------------------------------------------ approved Tour IDs

/** NKERP's Approved list (Tour Admin, state 2) for arrivals in a window: read only. */
export async function readApproved(client: ApprovalApi, from: string, to: string) {
  const rows: NkRecord[] = [];
  const seen = new Set<number>();
  for (let page = 1; page < 50; page++) {
    const r = await client.read(QUEUE, {
      itemsPerPage: 1000, maxSize: 10, currentPage: page, clientTimeZoneOffset: -180, Action: 2, StateId: 2,
      sortBy: 'StartDate', reverse: false, totalItems: 0, group: '7', venueSearchId: 2, FromDateFromSearch: from, FromDateToSearch: to,
    });
    const chunk = r.Tours;
    if (!Array.isArray(chunk)) throw new Error('NKERP approved list returned no Tours list');
    for (const t of chunk) if (!seen.has(int(t.Id))) { seen.add(int(t.Id)); rows.push(t); }
    if (rows.length >= int(r.TotalRows) || !chunk.length) return rows;
  }
  return rows;
}

/** Search approved Tour IDs (NKERP's Approved list, arrivals from 30 days ago to 150 days ahead) by Tour ID or office. */
export async function searchApproved(client: ApprovalApi, input: { q?: string; refresh?: boolean }, now = Date.now()) {
  const today = todayBaghdad(now);
  const from = addDays(today, -30), to = addDays(today, 150);
  let list = approvedList();
  if (input.refresh || !list.at || now - Date.parse(list.at) > 10 * 60_000) {
    const rows = await readApproved(client, from, to);
    list = { at: new Date(now).toISOString(), window: { from, to },
      tours: rows.filter(r => int(r.CurrentStatusId ?? 2) === 2).map(r => mapTour(r, [], latestPlanSet(r.TourSubvenuePlan || []))) };
    write('approval-approved-list', list);
  }
  return list;
}

/**
 * Open an approved Tour ID to change it: NKERP's current detail (approved city stays, pax, ModifiedOn) and chat.
 * Kept in the app so its dates and accommodation can be edited and its capacity impact planned.
 */
export async function openApproved(client: ApprovalApi, input: { id: number }, now = Date.now()) {
  const id = int(input.id);
  const row = approvedList().tours.find(t => t.id === id) ?? approvedOpen()[String(id)]?.tour;
  if (!row) throw new ApprovalError('Search the approved Tour IDs first, then open this one.', 404);
  const r = await client.read(`api/tours/getTourSubVenue/${id}`);
  const d = r.TourPlan;
  if (!d || int(d.Id) !== id) throw new ApprovalError('NKERP did not return this tour.', 502);
  let messages = row.messages;
  try { messages = chatMessages(await client.read(`api/masters/retrieveChat/${row.toId}/${id}/74`), row.toId); } catch { /* the chat can be reloaded later */ }
  const segments = latestPlanSet(d.TourSubvenuePlan || []);
  const tour: ApprovalTour = { ...row, arrivalAt: str(d.StartDate) || row.arrivalAt, departureAt: str(d.EndDate) || row.departureAt,
    paxTotal: int(d.PaxCount ?? row.paxTotal), paxFaiz: int(d.PaxRequiredAcc ?? row.paxFaiz), paxHotel: int(d.PaxNotRequiredAcc ?? row.paxHotel),
    option: int(d.AccomodationOptionId ?? row.option), modifiedOn: str(d.ModifiedOn) || row.modifiedOn, messages, previousPlans: segments,
    ...(Array.isArray(d.TransportItinerary) ? itineraryOf(d) : {}), reapproval: true, approvedEdit: true };
  const opened: ApprovedTour = { tour, segments, statusId: int(d.CurrentStatusId), readAt: new Date(now).toISOString() };
  transaction(() => {
    const all = approvedOpen();
    // Keep the last 30 opened.
    const kept = Object.entries({ ...all, [String(id)]: opened }).sort((a, b) => b[1].readAt.localeCompare(a[1].readAt)).slice(0, 30);
    write('approval-approved-open', Object.fromEntries(kept));
  });
  return opened;
}

/**
 * Re-approve an approved Tour ID with the approver's changes, from the app: (1) NKERP's approved-tour Update with
 * nothing changed, which returns the Tour ID to the approval queue; (2) once NKERP shows it pending, the applicants'
 * Faiz flags if the Faiz pax change needs them; (3) one Approve with the new city stays and Faiz / hotel pax.
 * Every step is journaled before it is sent and none is repeated; a refusal or a lost answer stops the chain.
 */
export async function reapproveApproved(client: ApprovalApi, input: { id: number; segments: Segment[]; modifiedOn: string; faizApplicants?: number[]; by?: string }, now = Date.now()) {
  const id = int(input.id);
  const stamp = new Date(now).toISOString();
  const by = cleanName(input.by);
  const opened = approvedOpen()[String(id)];
  if (!opened) throw new ApprovalError('Open this approved Tour ID again from the search, then try again.', 404);
  const tour = opened.tour;
  const current = records()[String(id)];
  const flow = current?.reopen;
  if (flow && flow.modifiedOn === str(input.modifiedOn) && ['sending', 'uncertain'].includes(flow.state)) {
    throw new ApprovalError('This Tour ID was already sent to NKERP to reopen and the answer is unknown. Check it in NKERP; it is not sent twice.', 409);
  }
  const segments = (input.segments || []).map(s => ({ city: s.city, start: str(s.start), end: str(s.end) }));
  const status = (await client.read(`api/tours/getTourStatus/${id}`)).TourPlan;
  if (!status || int(status.Id) !== id) throw new ApprovalError('NKERP did not return this tour.', 502);
  if (str(status.ModifiedOn) !== str(input.modifiedOn)) throw new ApprovalError('NKERP changed this tour after you opened it. Open it again and check it.', 409);
  if (!Array.isArray(status.TransportItinerary) && tour.itinerarySaved !== true) {
    throw new ApprovalError('The itinerary is not saved in NKERP (the fly mark is not red), so the Tour ID cannot be re-approved.', 409);
  }
  const general = await client.read(`api/tours/getTourDetail/${id}`);
  const exact = [general.Tour, general.TourDetailForAddApplicant].filter(x => x && int(x.Id) === id);
  if (!exact.length) throw new ApprovalError('NKERP did not return the tour\'s link details.', 502);
  const problems = segmentProblems(segments, localDay(status.StartDate), localDay(status.EndDate));
  if (problems.length) throw new ApprovalError(problems.join(' '));
  let reopen: Record<string, unknown>;
  try { reopen = reopenPayload(status, { linkedTourId: int(exact[0].LinkTourId) }); }
  catch (err) { throw new ApprovalError(err instanceof Error ? err.message : 'This tour cannot be reopened from the planner.'); }
  const acc = accommodationOf(tour, current);
  const pax = acc ? { faiz: acc.paxFaiz, hotel: acc.paxHotel } : null;
  try { paxChange(status, pax); } catch (err) { throw new ApprovalError(err instanceof Error ? err.message : 'The Faiz / hotel pax do not fit the tour.'); }

  const original = { segments: opened.segments, paxFaiz: tour.paxFaiz, paxHotel: tour.paxHotel };
  const revised = { segments, paxFaiz: pax?.faiz ?? tour.paxFaiz, paxHotel: pax?.hotel ?? tour.paxHotel };
  const save = (fn: (rec: ApprovalRecord) => void) => transaction(() => {
    const all = records();
    const rec: ApprovalRecord = all[String(id)] ?? { ...blankRecord(tour, stamp), status: 'approved' };
    fn(rec);
    all[String(id)] = rec;
    write('approval-records', all);
    return rec;
  });
  const reopenState = (state: NonNullable<ApprovalRecord['reopen']>['state'], message?: string) => save(rec => {
    const at = new Date().toISOString();
    rec.reopen = { state, at, modifiedOn: str(input.modifiedOn), ...(message ? { message } : {}) };
    rec.history = [...rec.history, { at, kind: `reopen-${state}`, note: message, ...(by ? { by } : {}) }];
    if (state !== 'sending' && state !== 'sent') {
      addRevision(rec, { at, by, kind: 'approved-edit', original, revised, previousStatus: 'Approved',
        latestStatus: state === 'refused' ? 'Approved (NKERP refused the change)' : 'Unknown: check NKERP', ...(message ? { note: message } : {}) });
    }
  });
  reopenState('sending');
  try {
    const r = await client.write(UPDATE_TOUR, reopen);
    if (r.ReturnStatus === false) return reopenState('refused', str(r.ReturnMessage) || 'NKERP did not accept the update.');
  } catch (err) {
    if (err instanceof Rejected) return reopenState('refused', err.message);
    return reopenState('uncertain', err instanceof Error ? err.message : 'No response from NKERP.');
  }
  reopenState('sent');
  // NKERP should now show the Tour ID pending (re-)approval; approve it with the approver's changes.
  let detail: NkRecord | undefined;
  try { detail = (await client.read(`api/tours/getTourSubVenue/${id}`)).TourPlan; } catch { /* reported below */ }
  if (!detail || int(detail.Id) !== id || int(detail.CurrentStatusId) !== 23) {
    return save(rec => {
      const at = new Date().toISOString();
      const note = 'NKERP accepted the update, but the Tour ID is not showing as pending approval yet. Refresh from NKERP and approve it from Re-approvals.';
      rec.history = [...rec.history, { at, kind: 'reopened-not-pending', note, ...(by ? { by } : {}) }];
      addRevision(rec, { at, by, kind: 'approved-edit', original, revised, previousStatus: 'Approved', latestStatus: 'Back in NKERP\'s approval queue', note });
    });
  }
  const pending: ApprovalTour = { ...tour, reapproval: true, modifiedOn: str(detail.ModifiedOn) };
  // The saved accommodation change now applies to the reopened tour.
  if (acc) save(rec => { if (rec.accommodation) rec.accommodation = { ...rec.accommodation, modifiedOn: str(detail!.ModifiedOn) }; });
  const journal: ApprovalJournal = (state, message) => save(rec => {
    const at = new Date().toISOString();
    rec.approval = { state, at, message, segments, reapproval: true };
    rec.history = [...rec.history, { at, kind: `approval-${state}`, note: message, ...(by ? { by } : {}) }];
    if (state === 'api_reported_approved') {
      rec.approvedFacts = factsOf({ ...pending, paxFaiz: revised.paxFaiz, paxHotel: revised.paxHotel }, segments);
      rec.approvedAt = at;
      rec.status = 're-approved';
    }
    if (state !== 'attempting') {
      addRevision(rec, { at, by, kind: 'approved-edit', original, revised, previousStatus: 'Approved',
        latestStatus: state === 'api_reported_approved' ? 'Re-approved' : state === 'api_rejected' ? 'Pending re-approval (NKERP refused the approval)' : 'Pending re-approval (answer unknown)',
        ...(message ? { note: message } : {}) });
    }
  });
  try {
    return await sendApproval(client, pending, detail, segments, pax, input.faizApplicants, journal);
  } catch (err) {
    // A check before the approval stopped it: the Tour ID stays in NKERP's approval queue.
    const message = `Reopened in NKERP, but not approved: ${err instanceof Error ? err.message : 'the approval could not be sent'} Approve it from Re-approvals after a refresh.`;
    return save(rec => {
      const at = new Date().toISOString();
      rec.history = [...rec.history, { at, kind: 'reopened-not-approved', note: message, ...(by ? { by } : {}) }];
      addRevision(rec, { at, by, kind: 'approved-edit', original, revised, previousStatus: 'Approved', latestStatus: 'Back in NKERP\'s approval queue', note: message });
    });
  }
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

/** The approver's remarks on a Tour ID, for the awaiting-approvals report shared with the Idara. Empty text clears them. */
export function saveRemarks(input: { id: number; remarks: string; by?: string }) {
  return transaction(() => {
    const all = records();
    const id = String(int(input.id));
    const tour = snapshot().tours.find(t => String(t.id) === id);
    if (!tour && !all[id]) throw new ApprovalError('This Tour ID is not in the latest approval queues. Refresh and try again.', 404);
    const text = String(input.remarks ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
    const by = typeof input.by === 'string' && input.by.trim() ? input.by.trim().slice(0, 80) : undefined;
    const stamp = new Date().toISOString();
    const rec: ApprovalRecord = all[id] ?? { id: tour!.id, ref: tour!.ref, office: tour!.office, status: tour!.reapproval ? 'reapproval-pending' : 'new',
      firstSeenAt: stamp, lastSeenAt: stamp, history: [], ...(tour!.reapproval ? { reapprovalSince: stamp } : {}) };
    if ((rec.remarks?.text ?? '') === text) return rec;
    if (text) rec.remarks = { text, at: stamp, ...(by ? { by } : {}) };
    else delete rec.remarks;
    rec.history = [...rec.history, { at: stamp, kind: text ? 'remarks' : 'remarks-cleared', ...(text ? { note: text } : {}), ...(by ? { by } : {}) }];
    all[id] = rec;
    write('approval-records', all);
    return rec;
  });
}

const normText = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Read one Tour ID's NKERP chat box again and keep it in the snapshot and the chat cache. */
export async function reloadChat(client: ApprovalApi, id: number, now = Date.now()) {
  const tour = knownTour(int(id));
  if (!tour) throw new ApprovalError('This Tour ID is not in the latest approval queues. Refresh and try again.', 404);
  const r = await client.read(`api/masters/retrieveChat/${tour.toId}/${tour.id}/74`);
  const messages = chatMessages(r, tour.toId);
  transaction(() => {
    const snap = snapshot();
    write('approval-snapshot', { ...snap, tours: snap.tours.map(t => (t.id === tour.id ? { ...t, messages } : t)) });
    const open = approvedOpen();
    if (open[String(tour.id)]) write('approval-approved-open', { ...open, [String(tour.id)]: { ...open[String(tour.id)], tour: { ...open[String(tour.id)].tour, messages } } });
    const cache = read<ChatCache>('approval-chat-cache', {});
    const prev = cache[String(tour.id)];
    write('approval-chat-cache', { ...cache, [String(tour.id)]: { at: now, modifiedOn: prev?.modifiedOn ?? tour.modifiedOn, unread: prev?.unread ?? tour.unread, messages } });
  });
  return messages;
}

/**
 * Send the approver's message to the Tour ID's chat box in NKERP (the same request as NKERP's Messaging System
 * Send button), then read the chat again so the history shows it. Sent once; a lost answer is never resent.
 */
export async function sendChat(client: ApprovalApi, input: { id: number; message: string; by?: string }, now = Date.now()) {
  const id = int(input.id);
  const text = String(input.message ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new ApprovalError('Type a message first.');
  if (text.length > 2000) throw new ApprovalError('The message is too long for the NKERP chat box (2000 characters at most).');
  const tour = knownTour(id);
  if (!tour) throw new ApprovalError('This Tour ID is not in the latest approval queues. Refresh and try again.', 404);
  if (!tour.toId) throw new ApprovalError('NKERP did not name the Tour Operator for this Tour ID, so the message has no recipient.', 409);
  const earlier = records()[String(id)]?.chats ?? [];
  const same = earlier.filter(c => normText(c.text) === normText(text) && now - Date.parse(c.at) < 10 * 60_000);
  if (same.some(c => c.state === 'sent' || c.state === 'sending' || c.state === 'uncertain')) {
    throw new ApprovalError(same.some(c => c.state === 'sent')
      ? 'This message was already sent to the NKERP chat box a few minutes ago.'
      : 'This message was already sent and NKERP\'s answer is unknown. Check the chat box before sending it again.', 409);
  }
  // Read the chat box first: it signs in (a failed sign-in sends nothing) and shows the latest messages.
  await reloadChat(client, id, now);
  const at = new Date(now).toISOString();
  const journal = (state: ChatSend['state'], message?: string) => transaction(() => {
    const all = records();
    const rec: ApprovalRecord = all[String(id)] ?? { id, ref: tour.ref, office: tour.office, status: tour.reapproval ? 'reapproval-pending' : 'new',
      firstSeenAt: at, lastSeenAt: at, history: [] };
    const chats = (rec.chats ?? []).filter(c => !(c.at === at && normText(c.text) === normText(text)));
    const by = cleanName(input.by);
    rec.chats = [...chats, { at, text, state, ...(message ? { message } : {}), ...(by ? { by } : {}) }].slice(-50);
    if (state !== 'sending') rec.history = [...rec.history, { at: new Date().toISOString(), kind: `chat-${state}`, note: message ?? text.slice(0, 120), ...(by ? { by } : {}) }];
    all[String(id)] = rec;
    write('approval-records', all);
    return rec;
  });
  journal('sending');
  let response: NkRecord;
  try {
    response = await client.write(SAVE_CHAT, { Message: text, RecieverId: tour.toId, TourId: tour.id, group: CHAT_GROUP });
  } catch (err) {
    if (err instanceof Rejected) {
      journal('refused', err.message);
      throw new ApprovalError(`NKERP did not accept the message: ${err.message}`, 502);
    }
    journal('uncertain', err instanceof Error ? err.message : 'No response from NKERP.');
    await reloadChat(client, id, now).catch(() => {});
    throw new ApprovalError('NKERP did not answer, so it is not known whether the message was sent. Check the chat box before sending it again.', 502);
  }
  if (response.ReturnStatus === false) {
    const why = str(response.ReturnMessage) || 'NKERP did not accept the message.';
    journal('refused', why);
    throw new ApprovalError(why, 502);
  }
  const record = journal('sent');
  let messages: ApprovalTour['messages'] | null = null;
  try { messages = await reloadChat(client, id, now); } catch { /* the history updates on the next refresh */ }
  return { record, visible: messages ? messages.some(m => normText(m.text) === normText(text)) : null };
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
