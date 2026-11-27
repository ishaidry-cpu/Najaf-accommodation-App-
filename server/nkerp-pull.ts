import { createHash } from 'node:crypto';
import { normalizeBuildingName, normalizeRoomNumber } from '../src/services/storage.js';
import type { Reservation } from '../src/types/index.js';
import { nkerpLogin } from './nkerp-sync/credentials.js';
import { NkerpClient } from './nkerp-sync/nkerpClient.js';
import { NkerpEmailClient } from './nkerp-sync/emails.js';
import { peopleOnTour } from './nkerp-sync/planner.js';
import { addDays, day, norm, parseArrival, todayIn } from './nkerp-sync/util.js';
import type { NkRecord } from './nkerp-sync/types.js';
import { expiry, guests, identityHash, read, removals, removalUntil, rooms, stayDates, stayKey, write, transaction, prune, type Removal } from './accommodation-store.js';
import { photoStore, prunePhotos } from './nkerp-photos.js';
import { prioritizeTravel, readTravel, reconcileTravel, travelEndpoints, travelRequests } from './nkerp-travel.js';

export interface StoredReservation extends Reservation {
  nkerpBaseline?: { building: string; roomNumber: string };
  /** The stay's dates as NKERP last reported them (see stayDates). */
  nkerpDates?: string;
  localFields?: string[];
  allocationObservedOnly?: boolean;
}

/** A stay NKERP still lists that the app hides because someone deleted it. */
export interface HiddenStay {
  key: string; tour: string; its: string; name: string; office: string;
  arrival: string; departure: string; deletedAt: string | null;
}

export const removalKey = (stay: Reservation) => identityHash(stayKey(stay));
const str = (v: unknown) => String(v ?? '').trim();
const dateTime = (v: unknown) => ({
  date: /^\d{4}-\d\d-\d\d/.test(str(v)) ? day(v) : '',
  time: /T(\d\d:\d\d)/.exec(str(v))?.[1] || '',
});

function mapStay(a: NkRecord, start: unknown, end: unknown, nkRoom?: {building:string; room:string}): StoredReservation {
  const arrival = dateTime(start);
  const departure = dateTime(end);
  const itsId = str(a.ITSId ?? a.AppicantITSId);
  const tourRefNo = str(a.TourRefenceNO ?? a.TourReferenceNo);
  const family = str(a.FamilyName ?? a.Family);
  const groupLeadName = str(a.GroupLeadFullName);
  const id = 'nkerp-' + createHash('sha256').update(JSON.stringify([norm(tourRefNo), itsId, arrival.date])).digest('hex').slice(0, 24);
  const building = normalizeBuildingName(nkRoom?.building || '');
  const roomNumber = normalizeRoomNumber(nkRoom?.room || '');
  return {
    id, tourRefNo, tourId: tourRefNo, itsId, applicantName: str(a.ApplicantName),
    age: str(a.Age), gender: str(a.GenderName), category: str(a.Category), family, familyNo: family,
    jamaat: str(a.Jamaat), rotationId: str(a.RotationId), idara: str(a.Idara), hofId: str(a.HOFID),
    officeName: str(a.OfficeName), groupLeadName, guestLeaderName: groupLeadName,
    arrivalDate: arrival.date, arrivalTime: arrival.time, rawArrivalStr: str(start),
    departureDate: departure.date, departureTime: departure.time, rawDepartureStr: str(end),
    arrivalDateTime: str(start), departureDateTime: str(end),
    building, roomNumber, nkerpBaseline: {building, roomNumber},
    isUploadedToPortal: Boolean(nkRoom), moneyGiven: 'No', paxCount: 1,
    createdAt: '', updatedAt: '',
  };
}

const dateFields = ['arrivalDate','arrivalTime','rawArrivalStr','arrivalDateTime',
  'departureDate','departureTime','rawDepartureStr','departureDateTime'] as const;
const profileFields = ['itsId','applicantName','age','gender','category','family','familyNo','jamaat','rotationId',
  'idara','hofId','officeName','groupLeadName','guestLeaderName',...dateFields] as const;
const isDateField = (field: string) => (dateFields as readonly string[]).includes(field);

/**
 * A deleted stay stays hidden only while NKERP still reports it with the dates it had when it was deleted.
 * Once NKERP moves it, it is a different stay and comes back. Older entries hold only the expiry, which
 * follows the departure, so a changed departure brings those back too.
 */
export function isDeleted(entry: Removal | undefined, source: Reservation, now = Date.now()) {
  if (!entry || removalUntil(entry) <= now) return false;
  if (typeof entry === 'number') return entry === expiry(source);
  return entry.dates ? entry.dates === stayDates(source) : true;
}

/** NKERP changed this stay's dates since the app last saw them. */
function nkerpMoved(previous: StoredReservation, source: StoredReservation) {
  if (previous.nkerpDates) return previous.nkerpDates !== stayDates(source);
  // Saved before the app kept NKERP's dates: a different day is a move, a different time may be a local edit.
  const days = (r: Reservation) => [parseArrival(r.arrivalDate) || r.arrivalDate, parseArrival(r.departureDate) || r.departureDate].join();
  return days(previous) !== days(source);
}

/**
 * An outdated copy of a moved stay is kept only when it holds something the app would otherwise lose: a room
 * the guest's current stay doesn't have yet, a star, a B to A shift or money given.
 */
function keepOutdatedCopy(stale: StoredReservation, currentStays: StoredReservation[]) {
  if (stale.isSpecialGuest || stale.shiftToCategoryA || stale.moneyGiven === 'Yes' || stale.id.startsWith('b2a-') ||
      /b to a/i.test(stale.category || '')) return true;
  return Boolean(String(stale.roomNumber || '').trim()) && !currentStays.some(r => String(r.roomNumber || '').trim());
}

const overlaps = (a: Reservation, b: Reservation) => a.arrivalDate <= b.departureDate && b.arrivalDate <= a.departureDate;
const daysApart = (a: Reservation, b: Reservation) =>
  Math.abs(Date.parse(a.arrivalDate+'T00:00:00Z') - Date.parse(b.arrivalDate+'T00:00:00Z')) || 0;

export function reconcileNkerp(incoming: StoredReservation[], now = Date.now()) {
  return transaction(() => {
    const history = new Set(read<Record<string,string>[]>('history',[]).map(row => JSON.stringify([norm(row['Tour ID']),str(row.ITS)])));
    const current = new Map(guests().map(r => [r.itsId && r.tourRefNo && r.arrivalDate ? stayKey(r) : r.id, r as StoredReservation]));
    const removed = removals();
    const inventory = rooms();
    const byTourGuest = (r: Reservation) => JSON.stringify([norm(r.tourRefNo), str(r.itsId)]);
    const stamp = new Date(now).toISOString();
    const hidden: HiddenStay[] = [];
    const live: StoredReservation[] = [];
    for (const source of incoming) {
      if (!source.tourRefNo || !source.itsId || !source.arrivalDate || !source.departureDate || expiry(source) <= now) continue;
      const entry = removed[removalKey(source)];
      if (isDeleted(entry, source, now)) {
        hidden.push({ key: removalKey(source), tour: source.tourRefNo, its: source.itsId, name: source.applicantName,
          office: source.officeName, arrival: source.arrivalDateTime || source.arrivalDate,
          departure: source.departureDateTime || source.departureDate,
          deletedAt: typeof entry === 'object' ? entry.deletedAt ?? null : null });
      } else live.push(source);
    }

    // Match each NKERP stay to the saved stay it updates. The same arrival day is the same stay. When NKERP
    // moves a stay, the guest's saved stay on that tour that NKERP no longer reports is the one that moved,
    // overlapping or not; it keeps its room and app details and takes NKERP's new dates.
    const storedByPerson = new Map<string,StoredReservation[]>();
    for (const r of current.values()) {
      const identity = byTourGuest(r);
      storedByPerson.set(identity, [...(storedByPerson.get(identity) || []), r]);
    }
    const sourcesByPerson = new Map<string,StoredReservation[]>();
    for (const r of live) {
      const identity = byTourGuest(r);
      sourcesByPerson.set(identity, [...(sourcesByPerson.get(identity) || []), r]);
    }
    const matches: [StoredReservation, StoredReservation | undefined][] = [];
    const stale: StoredReservation[] = [];
    for (const [person, sources] of sourcesByPerson) {
      const keys = new Set(sources.map(stayKey));
      const unmatched = (storedByPerson.get(person) || []).filter(r => !keys.has(stayKey(r)));
      const moved = sources.filter(r => !current.has(stayKey(r)));
      for (const source of sources) if (current.has(stayKey(source))) matches.push([source, current.get(stayKey(source))]);
      const pairs = moved.flatMap(source => unmatched.map(stored => ({source, stored,
        rank: (overlaps(source, stored) ? 0 : 1e15) + daysApart(source, stored)})))
        .sort((a, b) => a.rank - b.rank);
      const used = new Set<StoredReservation>();
      for (const {source, stored} of pairs) {
        if (used.has(source) || used.has(stored)) continue;
        used.add(source); used.add(stored);
        matches.push([source, stored]);
      }
      for (const source of moved) if (!used.has(source)) matches.push([source, undefined]);
      // NKERP lists this guest on this tour, but not this stay: an outdated copy of a moved stay.
      for (const stored of unmatched) if (!used.has(stored)) stale.push(stored);
    }

    let changed = 0;
    for (const stored of stale) {
      const person = byTourGuest(stored);
      const stays = matches.filter(([source]) => byTourGuest(source) === person).map(([source, previous]) => previous ?? source);
      if (keepOutdatedCopy(stored, stays)) continue;
      current.delete(stayKey(stored));
      changed++;
    }
    for (const [source, previous] of matches) {
      const merged: StoredReservation = previous ? {...previous} : {...source, allocationObservedOnly: true, createdAt: stamp};
      const person = byTourGuest(source);
      if (previous) {
        // NKERP's latest dates win over an earlier edit in the app once NKERP changes them.
        const localFields = nkerpMoved(previous, source) ? previous.localFields?.filter(f => !isDateField(f)) : previous.localFields;
        if (localFields) merged.localFields = localFields;
        for (const field of profileFields) {
          const value = source[field];
          if (value !== '' && value !== undefined && !localFields?.includes(field)) Object.assign(merged, {[field]:value});
        }
        const canFollowNkerp = previous.allocationObservedOnly || previous.id.startsWith('nkerp-') ||
          (!previous.roomNumber && !history.has(person));
        if (canFollowNkerp && !localFields?.includes('roomNumber') && !localFields?.includes('building')) {
          merged.building = source.building;
          merged.roomNumber = source.roomNumber;
          merged.allocationObservedOnly = true;
        }
        if (!localFields?.includes('isUploadedToPortal')) merged.isUploadedToPortal = Boolean(source.roomNumber && merged.roomNumber === source.roomNumber && merged.building === source.building);
      }
      merged.nkerpBaseline = source.nkerpBaseline;
      merged.nkerpDates = stayDates(source);
      merged.category ||= 'Mumineen';
      merged.groupLeadName ||= merged.applicantName;
      merged.guestLeaderName ||= merged.groupLeadName;
      merged.roomId = inventory.find(r => r.building === merged.building && r.roomNumber === merged.roomNumber)?.id;
      if (JSON.stringify(previous) !== JSON.stringify(merged)) {
        merged.updatedAt = stamp;
        if (previous) current.delete(stayKey(previous));
        current.set(stayKey(merged), merged);
        changed++;
      }
    }
    if (changed) {
      write('reservations', [...current.values()]);
      const settings = read<{categories:string[]}>('settings',{categories:[]});
      const categories = [...new Set([...settings.categories, ...incoming.map(r=>r.category).filter(Boolean)])];
      if (categories.length !== settings.categories.length) write('settings',{...settings,categories});
    }
    const before = read<HiddenStay[]>('hidden-stays', []);
    if (JSON.stringify(before) !== JSON.stringify(hidden)) write('hidden-stays', hidden);
    return { received: incoming.length, changed, hidden: hidden.length, expired: prune(now) };
  });
}

export async function collectNkerp(client: Pick<NkerpClient,'pending'|'currentForTours'>, tours: Pick<NkerpEmailClient,'tourList'>, today = todayIn(), now = Date.now()) {
  const [pending, tourRows] = await Promise.all([client.pending(), tours.tourList(addDays(today,-45))]);
  const result = new Map<string,StoredReservation>();
  for (const a of pending) {
    // The search is scoped to Najaf. NKERP uses zero as an unspecified row sub-venue.
    if (a.SubVenueID != null && ![0,3].includes(Number(a.SubVenueID))) continue;
    for (const s of a.TourIternaryDates || []) {
      const item = mapStay(a, s.ArrivalDate, s.DepartureDate);
      if (expiry(item) > now) result.set(stayKey(item), item);
    }
  }

  const byTour = new Map<string, {tour:NkRecord; plan:NkRecord}[]>();
  for (const tour of tourRows) {
    const ref = norm(tour.TourReferenceId);
    if (!ref || tour.IsActive === false) continue;
    for (const plan of tour.TourSubvenuePlan || []) {
      if (Number(plan.SubvenueId) !== 3 || plan.IsRemoved === true || !norm(plan.SubvenueName).includes('NAJAF')) continue;
      const date = dateTime(plan.EndDateTimeZone);
      if (!date.date || expiry({ departureDate:date.date, departureTime:date.time }) <= now) continue;
      const list = byTour.get(ref) || [];
      list.push({tour,plan});
      byTour.set(ref,list);
    }
  }

  const allocated = [...byTour].filter(([,plans]) => plans.some(({plan}) => [1,2].includes(Number(plan.AccomudationStatusID))));
  const allocations = await client.currentForTours(allocated.map(([ref]) => ref), addDays(today,-4));
  const rowsByRef = new Map<string,NkRecord[]>();
  for (const row of allocations) {
    const entries = row.RoomAllocatedDates_Current || [];
    for (const ref of new Set<string>(entries.map((e: NkRecord) => norm(e.TourReferenceNo)))) {
      if (!byTour.has(ref)) continue;
      const list = rowsByRef.get(ref) || [];
      list.push({...row, RoomAllocatedDates_Current: entries.filter((e: NkRecord) => norm(e.TourReferenceNo) === ref)});
      rowsByRef.set(ref,list);
    }
  }
  const allocatedByTour = new Map([...rowsByRef].map(([ref,rows]) => [ref,peopleOnTour(rows,ref)]));
  for (const [ref, plans] of byTour) {
    for (const {tour,plan} of plans) {
      const start = day(plan.StartDateTimeZone);
      const end = day(plan.EndDateTimeZone);
      const base = { TourRefenceNO: ref, OfficeName: tour.OfficeName || tour.PartnerOfficeName };
      for (const person of allocatedByTour.get(ref)?.values() || []) {
        const nights = person.nights.filter(n => start <= n.day && n.day <= end);
        if (!nights.length) continue;
        const night = nights.find(n => n.day >= today) || nights[nights.length-1];
        const item = mapStay({...base, ...night.entry},plan.StartDateTimeZone,plan.EndDateTimeZone,night);
        const key = stayKey(item);
        const previous = result.get(key);
        result.set(key, previous ? {...item, ...previous, building:item.building, roomNumber:item.roomNumber,
          nkerpBaseline:item.nkerpBaseline, isUploadedToPortal:true} : item);
      }
      for (const applicant of tour.ApplicantList || []) {
        const item = mapStay({...base,...applicant},plan.StartDateTimeZone,plan.EndDateTimeZone);
        const key = stayKey(item);
        if (!result.has(key)) result.set(key,item);
      }
    }
  }
  return [...result.values()];
}

export function createPull(onChange: () => void) {
  type Outcome = ReturnType<typeof reconcileNkerp> & { travel: ReturnType<typeof reconcileTravel> };
  let running: Promise<Outcome> | undefined;
  const status = { running:false, lastSyncedAt: null as string | null, error: null as string | null };
  function pull() {
    if (running) return running;
    status.running = true;
    running = (async () => {
      nkerpLogin();
      const signal = AbortSignal.timeout(55_000);
      const photos = photoStore();
      const client = new NkerpClient({signal, onPhoto: photos.sink});
      const tours = new NkerpEmailClient({signal, onPhoto: photos.sink});
      const travelSignal = AbortSignal.timeout(48_000);
      const travelClient = new NkerpClient({ signal: travelSignal, endpoints: travelEndpoints });
      const checked = read<Record<string, number>>('travel-checked', {});
      const today = todayIn();
      const requests = prioritizeTravel(travelRequests(guests()), today, checked);
      const [accommodation, travel] = await Promise.allSettled([
        collectNkerp(client, tours, today),
        readTravel(travelClient, requests, travelSignal),
      ]);
      const outcome = accommodation.status === 'fulfilled' ? reconcileNkerp(accommodation.value) : undefined;
      const photoChanges = transaction(() => {
        const saved = photos.flush();
        // Only a complete pull decides which photos are no longer needed.
        return saved + (outcome ? prunePhotos(guests().map(r => r.itsId)) : 0);
      });
      if (travel.status === 'rejected') throw travel.reason;
      const requested = new Set(requests.map(request => request.key));
      const extra = travelRequests(guests()).filter(request => !requested.has(request.key));
      const additional = await readTravel(travelClient, prioritizeTravel(extra, today, checked), travelSignal);
      for (const [key, rows] of additional.results) travel.value.results.set(key, rows);
      const transport = reconcileTravel(travel.value.results, travel.value.failed + additional.failed);
      if (outcome?.changed || outcome?.expired || transport.changed || photoChanges) onChange();
      if (accommodation.status === 'rejected') throw accommodation.reason;
      if (!outcome) throw new Error('NKERP accommodation did not refresh.');
      status.lastSyncedAt = new Date().toISOString();
      status.error = null;
      return { ...outcome, travel: transport };
    })().catch(err => {
      status.error = err instanceof Error ? err.message : 'NKERP pull failed.';
      throw err;
    }).finally(() => { status.running = false; running = undefined; });
    return running;
  }
  return { pull, status };
}

/** Read-only: what NKERP and the app each hold for one tour, and why a stay is or isn't in the app. */
export async function explainTour(refInput: string, today = todayIn(), now = Date.now()) {
  nkerpLogin();
  const want = (v: unknown) => { const r = norm(v); return r === norm(refInput) || r.endsWith('/'+norm(refInput)); };
  const signal = AbortSignal.timeout(55_000);
  const client = new NkerpClient({signal});
  const tours = new NkerpEmailClient({signal});
  let pendingRows: NkRecord[] = [];
  let tourRows: NkRecord[] = [];
  const incoming = await collectNkerp({
    pending: async () => (pendingRows = await client.pending()),
    currentForTours: (refs, from) => client.currentForTours(refs, from),
  }, { tourList: async from => (tourRows = await tours.tourList(from)) }, today, now);
  const removed = removals();
  const brief = (r: StoredReservation) => ({ id:r.id, its:r.itsId, name:r.applicantName, arrival:r.arrivalDateTime || r.arrivalDate,
    departure:r.departureDateTime || r.departureDate, room:[r.building,r.roomNumber].filter(Boolean).join(' '),
    localFields:r.localFields, deleted: removed[removalKey(r)] ?? null,
    hiddenAsDeleted: isDeleted(removed[removalKey(r)], r, now) });
  return {
    pending: pendingRows.filter(a => want(a.TourRefenceNO)).map(a => ({ its:a.ITSId, name:a.ApplicantName, subVenue:a.SubVenueID,
      itinerary:(a.TourIternaryDates || []).map((s: NkRecord) => [s.ArrivalDate, s.DepartureDate]) })),
    tours: tourRows.filter(t => want(t.TourReferenceId)).map(t => ({ ref:t.TourReferenceId, active:t.IsActive,
      plans:(t.TourSubvenuePlan || []).map((p: NkRecord) => ({ subVenue:p.SubvenueId, name:p.SubvenueName, start:p.StartDateTimeZone,
        end:p.EndDateTimeZone, removed:p.IsRemoved, status:p.AccomudationStatusID })),
      applicants:(t.ApplicantList || []).map((a: NkRecord) => ({ its:a.ITSId ?? a.AppicantITSId, name:a.ApplicantName })) })),
    incoming: incoming.filter(r => want(r.tourRefNo)).map(brief),
    app: (guests() as StoredReservation[]).filter(r => want(r.tourRefNo)).map(brief),
  };
}
