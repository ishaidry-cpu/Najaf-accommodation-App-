/**
 * Najaf Accommodation Sync: Sheet room allotments -> NKERP (allocate, reallocate, deallocate), API only.
 *
 * The Sheet is the latest word; NKERP is brought in line with it. In order:
 *   1. deallocate: people an earlier run saw in the Sheet with a room, whose row is now blank or gone, and
 *      whom NKERP still has in that room (nights from today on only);
 *   2. reallocate: people NKERP has in a different building/room than the Sheet gives (nights from today on);
 *   3. allocate:   people NKERP still lists as unallocated (Manage Room Allocation).
 * Each room group / person is one save, confirmed by a fresh read, never retried. An applied run appends what
 * it saw and did to the Sheet's 'Sync History' tab, which is also the memory of earlier runs. Nothing else in
 * the Sheet is edited, and no emails go out (EmailOption 0).
 *
 * Port of the `najaf-accommodation-allocation` skill's najaf_alloc.py; see __tests__/parity.test.ts.
 */
import { Rejected, type NkerpApi } from './nkerpClient';
import {
  allocNeed, allocPayload, capacityProblems, deallocPayload, persisted, reallocPayload, type PlannedLoad,
} from './payloads';
import { peopleOnTour, plan, planSync } from './planner';
import { memory, type HistoryStore } from './sheets';
import type {
  AllocItem, HistoryRow, Move, NkRecord, Person, ProgressSink, Removal, ReportEntry, RunOptions, SheetRow, StateEntry,
  SyncAction, SyncReport,
} from './types';
import { ALL_ACTIONS } from './types';
import {
  addDays, day, errorMessage, errorTypeName, groupBy, norm, parseTupleKey, place, pyRepr, pyTitle, sortBy,
  sortedStrings, stampsIn, todayIn, tuple, tupleKey,
} from './util';

export const LOOKBACK_DAYS = 21;     // stays that arrived up to this long ago can still be reallocated / deallocated
export const MAX_DEALLOC = 20;       // more people than this to deallocate in one run -> hold them all and report
export const MIN_SHEET_ROOMS = 10;   // fewer rooms than this in the Sheet -> hold deallocation (Sheet read went wrong?)

type Status = 'done' | 'refused' | 'unconfirmed';

/**
 * One write, never retried, then a fresh read. -> [status, detail]; status is 'done', 'refused' (NKERP plainly
 * refused and nothing landed) or 'unconfirmed' (stop all further writes).
 */
export async function commit(send: () => Promise<unknown>, check: () => Promise<[unknown[], number]>):
  Promise<[Status, string | null]> {
  let refused = false;
  let err: string | null = null;
  try {
    const resp = await send();
    if (resp && typeof resp === 'object' && !Array.isArray(resp) && (resp as NkRecord).ReturnStatus === false) {
      const msg = (resp as NkRecord).ReturnMessage;
      err = `save answered ReturnStatus false: ${msg === undefined || msg === null ? 'None' : msg}`;
    }
  } catch (exc) {
    if (exc instanceof Rejected) {
      refused = true;
      err = exc.message;
    } else {
      err = `${errorTypeName(exc)} during save`;   // timeout / dropped connection: may or may not have landed
    }
  }
  let missing: unknown[];
  let present: number;
  try {
    [missing, present] = await check();
  } catch (exc) {
    return ['unconfirmed', `${err || 'saved'}; readback failed (${errorMessage(exc)})`];
  }
  if (!missing.length) return ['done', err ? `${err} (but readback confirms every person on every night)` : null];
  if (present === 0 && (refused || (err && err.includes('ReturnStatus false')))) {
    return ['refused', `NKERP refused the save: ${err}`];
  }
  return ['unconfirmed', `${err || 'saved'} but readback is missing ${pyRepr(missing.slice(0, 5))}`];
}

interface LogArgs {
  ref: string;
  its: string;
  name: string;
  arrival: string;
  sheet?: [string, string] | null;
  before?: string;
  after?: string;
  nights?: string[];
}

export class Run {
  readonly report: SyncReport;
  readonly hist: HistoryRow[] = [];
  readonly acted = new Set<string>();
  private readonly bcache = new Map<string, Record<string, unknown>>();
  private readonly rcache = new Map<string, Record<string, NkRecord>>();
  private props: Record<string, unknown> | null = null;
  /** dry run: room Id -> {(day, applicant): infant} */
  private readonly plannedLoad = new Map<unknown, PlannedLoad>();

  constructor(private readonly c: NkerpApi, private readonly apply: boolean, readonly today: string,
    private readonly allowOver: boolean, private readonly limit: number | null | undefined,
    private readonly progress: ProgressSink = () => {}, private readonly signal?: AbortSignal) {
    this.report = { today, mode: apply ? 'apply' : 'dry-run', done: [], planned: [], problems: [], notes: {}, skipped: {} };
  }

  // -- bookkeeping
  full(): boolean {
    return Boolean(this.limit) && this.report.done.length + this.report.planned.length >= (this.limit as number);
  }

  stopped(): boolean {
    if (!this.report.cancelled && this.signal?.aborted) {
      this.report.cancelled = 'cancelled by the user; no further saves were started (saves already sent were confirmed)';
      this.progress({ level: 'warn', stage: 'cancel', message: 'Cancel requested: finishing the current save, starting no new ones' });
    }
    return 'stopped' in this.report || Boolean(this.report.cancelled);
  }

  log(action: string, result: string, a: LogArgs, details: string | null = ''): void {
    const sheet = a.sheet || ['', ''];
    const nights = a.nights ?? [];
    this.hist.push({
      Action: action, Result: result, 'Tour ID': a.ref, ITS: a.its, Name: a.name, Arrival: a.arrival || '',
      'Sheet Building': pyTitle(sheet[0]), 'Sheet Room': sheet[1], 'NKERP Before': a.before ?? '',
      'NKERP After': a.after ?? '', Nights: nights.length ? `${nights[0]} to ${nights[nights.length - 1]}` : '',
      Details: details || '',
    });
    if (action === 'ALLOCATE' || action === 'REALLOCATE') this.acted.add(tupleKey(a.ref, a.its));
  }

  /** Record one write's outcome in the report and history. */
  outcome(entry: ReportEntry, status: Status, detail: string | null, rows: [string, LogArgs][]): void {
    if (status === 'done') {
      if (detail) entry.warning = detail;
      this.report.done.push(entry);
      this.progress({ level: detail ? 'warn' : 'success', stage: entry.action,
        message: `${verb(entry.action)} ${entry.group}: ${entry.people.join(', ')}${detail ? ` (${detail})` : ''}`,
        data: { entry } });
    } else {
      const reason = (detail ?? '') + (status === 'refused' ? '' : '. Check this in NKERP before running again.');
      this.report.problems.push({ action: entry.action, group: entry.group, people: entry.people, reason });
      if (status === 'unconfirmed') {
        this.report.stopped = `unconfirmed ${entry.action} (${entry.group}); stopped further saves`;
      }
      this.progress({ level: 'error', stage: entry.action, message: `${entry.action} ${entry.group} ${status}: ${reason}`,
        data: { entry, status } });
    }
    for (const [action, kw] of rows) this.log(action, status, kw, status === 'done' ? null : detail);
  }

  problem(action: SyncAction, group: string, people: string[], reason: string, rows: [string, LogArgs][] = []): void {
    this.report.problems.push({ action, group, people, reason });
    this.progress({ level: 'warn', stage: action, message: `${action} held for ${group}: ${reason}`,
      data: { group, people, reason } });
    for (const [act, kw] of rows) this.log(act, 'held', kw, reason);
  }

  async room(pid: unknown, tids: unknown[], dates: string[], rno: string): Promise<NkRecord> {
    const key = JSON.stringify([pid, tids, dates]);
    if (!this.rcache.has(key)) this.rcache.set(key, await this.c.rooms(pid, [...tids], [...dates]));
    const room = this.rcache.get(key)![rno];
    if (!room) throw new Error(`room ${rno} not found in NKERP`);
    if (room.IsBlocked || room.IsActive === false) throw new Error(`room ${rno} is blocked/inactive in NKERP`);
    return room;
  }

  private load(room: NkRecord): PlannedLoad {
    let l = this.plannedLoad.get(room.Id);
    if (!l) this.plannedLoad.set(room.Id, (l = new Map()));
    return l;
  }

  checkCapacity(room: NkRecord, need: [string, number][]): string[] {
    const over = capacityProblems(room, need, this.apply ? undefined : this.load(room));
    if (over.length && !this.allowOver) {
      const clash = new Set(over.map((o) => o.split(':')[0]));
      const there = sortedStrings((room.AccomodationRoomAllocatedDatesNew || []).flatMap((e: NkRecord) =>
        clash.has(day(e.OccupiedDate))
          ? (e.RoomAllocatedDates_Current || []).filter((x: NkRecord) => x.TourReferenceNo).map((x: NkRecord) => String(x.TourReferenceNo))
          : []));
      if (!this.apply && [...this.load(room).keys()].some((k) => clash.has(JSON.parse(k)[0]))) {
        there.push('another tour planned in this run');
      }
      throw new Error(`room already occupied by ${there.join(', ') || 'others'}: ${over.join('; ')}`);
    }
    return over;
  }

  planLoad(room: NkRecord, pairs: [string, unknown, unknown][]): void {
    const l = this.load(room);
    for (const [d, aid, infant] of pairs) l.set(JSON.stringify([d, aid]), Boolean(infant));
  }

  invalidateRooms(): void {
    this.rcache.clear();
  }

  // -- 1. deallocate
  async deallocate(removals: Removal[], heldReason: string | null): Promise<void> {
    for (const rm of removals) {
      if (this.stopped() || this.full()) return;
      const nights = rm.nights;
      const days = nights.map((n) => n.day);
      const label = `${rm.ref} ${rm.name} (ITS ${rm.its}) ${place(...rm.was)}`;
      const kw: LogArgs = { ref: rm.ref, its: rm.its, name: rm.name, arrival: rm.arrival, sheet: null,
        before: place(...rm.was), nights: days };
      const entry: ReportEntry = { action: 'deallocate', group: label, people: [rm.name], dates: days,
        by: ['Sheet row now blank or deleted'] };
      if (heldReason) {
        this.problem('deallocate', label, [rm.name], heldReason, [['DEALLOCATE', kw]]);
        continue;
      }
      if (!this.apply) {
        this.report.planned.push(entry);
        this.progress({ level: 'info', stage: 'deallocate', message: `would deallocate ${label}`, data: { entry } });
        continue;
      }
      this.progress({ level: 'info', stage: 'deallocate', message: `deallocating ${label} (${days[0]} to ${days[days.length - 1]})` });
      const body = deallocPayload(nights);
      const want = new Set(days);
      const check = async (): Promise<[unknown[], number]> => {
        const fresh = peopleOnTour(await this.c.current(rm.ref), rm.ref).get(rm.its);
        const left = (fresh ? fresh.nights : []).filter((n) => want.has(n.day) && n.building === rm.was[0] && n.room === rm.was[1])
          .map((n) => n.day);
        return [left, want.size - left.length];
      };
      const [status, detail] = await commit(() => this.c.deallocate(body), check);
      this.invalidateRooms();
      this.outcome(entry, status, detail, [['DEALLOCATE', { ...kw, after: status === 'done' ? '' : place(...rm.was) }]]);
    }
  }

  // -- 2. reallocate
  async reallocate(moves: Move[], state: Map<string, StateEntry>): Promise<void> {
    const groups = groupBy(moves, (mv) => tupleKey(mv.ref, mv.building, mv.room));
    const order = sortBy(groups.keys(), (k) => this.limit
      ? [groups.get(k)!.length, parseTupleKey<string[]>(k)]
      : parseTupleKey<string[]>(k));
    for (const gk of order) {
      if (this.stopped() || this.full()) return;
      const [ref, bname, rno] = parseTupleKey<[string, string, string]>(gk);
      const mvs = groups.get(gk)!;
      const label = `${ref} ${place(bname, rno)}`;
      const names = mvs.map((mv) => mv.person.name);
      const days = sortedStrings(mvs.flatMap((mv) => mv.nights.map((n) => n.day)));
      const rows: [string, LogArgs][] = mvs.map((mv) => ['REALLOCATE', {
        ref, its: mv.person.its, name: mv.person.name, arrival: state.get(tupleKey(ref, mv.person.its))?.arrival ?? '',
        sheet: [bname, rno], before: mv.from.join(', '), nights: mv.nights.map((n) => n.day),
      }]);
      let body: ReturnType<typeof reallocPayload>;
      let over: string[];
      let room: NkRecord;
      try {
        if (this.props === null) this.props = await this.c.properties();
        if (!(bname in this.props)) throw new Error(`building ${pyTitle(bname)} not found in NKERP Najaf properties`);
        const pid = this.props[bname];
        const tids = sortBy(new Set(mvs.map((mv) => mv.person.tour_id).filter((t) => t !== null && t !== undefined)),
          (t) => t as number);
        const dates = days.map((d) => `${d}T00:00:00`);
        room = await this.room(pid, tids, dates, rno);
        const need = new Map<string, number>();
        for (const mv of mvs) {
          for (const n of mv.nights) need.set(n.day, (need.get(n.day) ?? 0) + (n.entry.IsInfant ? 0 : 1));
        }
        over = this.checkCapacity(room, days.map((d) => [d, need.get(d) ?? 0]));
        body = reallocPayload(room, bname, mvs);
      } catch (exc) {
        this.problem('reallocate', label, names, errorMessage(exc), rows.map(([a, kw]) => [a, { ...kw, after: kw.before }]));
        continue;
      }
      const entry: ReportEntry = { action: 'reallocate', group: label, people: names, dates: days,
        from: sortedStrings(mvs.flatMap((mv) => mv.from)), by: sortedStrings(mvs.map((mv) => mv.how)), over_capacity: over };
      if (!this.apply) {
        this.planLoad(room, mvs.flatMap((mv) => mv.nights.map((n) => [n.day, mv.person.aid, n.entry.IsInfant] as [string, unknown, unknown])));
        this.report.planned.push(entry);
        this.progress({ level: 'info', stage: 'reallocate', message: `would move ${names.join(', ')} to ${label} (from ${entry.from!.join(', ')})`, data: { entry } });
        continue;
      }
      this.progress({ level: 'info', stage: 'reallocate', message: `moving ${names.join(', ')} to ${label} (from ${entry.from!.join(', ')})` });
      const want = mvs.flatMap((mv) => mv.nights.map((n) => tuple(mv.person.its, n.day)));
      const check = async (): Promise<[unknown[], number]> => {
        const fresh = peopleOnTour(await this.c.current(ref), ref);
        const at = new Set<string>();
        for (const [its, p] of fresh) {
          for (const n of p.nights) if (n.building === bname && n.room === rno) at.add(tupleKey(its, n.day));
        }
        const missing = want.filter(([its, d]) => !at.has(tupleKey(its, d)));
        return [missing, want.length - missing.length];
      };
      const [status, detail] = await commit(() => this.c.reallocate(body), check);
      this.invalidateRooms();
      this.outcome(entry, status, detail, rows.map(([a, kw]) => [a, { ...kw, after: status === 'done' ? place(bname, rno) : '' }]));
    }
  }

  // -- 3. allocate
  async allocate(items: AllocItem[]): Promise<void> {
    const groups = groupBy(items, (it) => tupleKey(it.arrival, it.ref, it.building, it.room));
    let order = sortBy(groups.keys(), (k) => parseTupleKey<string[]>(k));
    if (this.limit) order = sortBy(order, (k) => groups.get(k)!.length);   // smallest groups first for a trial
    for (const gk of order) {
      if (this.stopped() || this.full()) return;
      const [arrival, ref, bname, rno] = parseTupleKey<[string, string, string, string]>(gk);
      const its = groups.get(gk)!;
      const label = `${arrival} ${ref} ${place(bname, rno)}`;
      const names = its.map((it) => String(it.app.ApplicantName).trim());
      const tids = sortBy(new Set(its.map((it) => it.app.TourID)), (t) => t as number);
      const dates = sortedStrings(its.flatMap((it) => it.dates.map((d) => String(d.ArrivalDate))));
      const rows: [string, LogArgs][] = its.map((it) => ['ALLOCATE', {
        ref, its: norm(it.app.ITSId), name: String(it.app.ApplicantName).trim(), arrival, sheet: [bname, rno],
        nights: it.dates.map((d) => day(d.ArrivalDate)),
      }]);
      let body: ReturnType<typeof allocPayload>;
      let over: string[];
      let room: NkRecord;
      let pid: unknown;
      try {
        const key = JSON.stringify([tids, dates]);
        if (!this.bcache.has(key)) this.bcache.set(key, await this.c.buildings(tids, dates));
        const offered = this.bcache.get(key)!;
        if (!(bname in offered)) throw new Error(`building ${pyTitle(bname)} not offered in NKERP for this tour`);
        pid = offered[bname];
        room = await this.room(pid, tids, dates, rno);
        body = allocPayload(room, its);
        over = this.checkCapacity(room, allocNeed(body));
      } catch (exc) {
        this.problem('allocate', label, names, errorMessage(exc), rows);
        continue;
      }
      const entry: ReportEntry = { action: 'allocate', group: label, people: names, dates: dates.map((d) => day(d)),
        by: sortedStrings(its.map((it) => it.how)), over_capacity: over };
      if (!this.apply) {
        this.planLoad(room, its.flatMap((it) => it.dates.map((d) => [day(d.ArrivalDate), it.app.ApplicantinTourId, it.app.IsInfant] as [string, unknown, unknown])));
        this.report.planned.push(entry);
        this.progress({ level: 'info', stage: 'allocate', message: `would allocate ${names.join(', ')} to ${label}`, data: { entry } });
        continue;
      }
      this.progress({ level: 'info', stage: 'allocate', message: `allocating ${names.join(', ')} to ${label}` });
      const [status, detail] = await commit(() => this.c.save(body), () => persisted(this.c, pid, tids, dates, rno, its));
      this.invalidateRooms();
      this.outcome(entry, status, detail, rows.map(([a, kw]) => [a, { ...kw, after: status === 'done' ? place(bname, rno) : '' }]));
    }
  }
}

function verb(action: SyncAction): string {
  return action === 'allocate' ? 'allocated' : action === 'reallocate' ? 'reallocated' : 'deallocated';
}

/** Everything the run reads from or writes to; real implementations in service.ts, fakes in tests. */
export interface RunDeps {
  nkerp: NkerpApi;
  readSheet: () => Promise<SheetRow[]>;
  history: HistoryStore;
  progress?: ProgressSink;
  signal?: AbortSignal;
  /** Parallel NKERP tour reads (default 4). */
  concurrency?: number;
  now?: () => Date;
}

export interface RunStats {
  sheetRows: number;
  sheetRooms: number;
  historyRows: number;
  remembered: number;
  pending: number;
  toursRead: number;
  peopleInNkerp: number;
}

/** Read N tours with bounded concurrency; results keyed in input order. Fails fast. */
async function readTours(nkerp: NkerpApi, refs: string[], concurrency: number, progress: ProgressSink,
  signal?: AbortSignal): Promise<Map<string, Map<string, Person>>> {
  const results: (Map<string, Person> | undefined)[] = new Array(refs.length);
  let next = 0;
  let done = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (failed === null) {
      const i = next++;
      if (i >= refs.length) return;
      if (signal?.aborted) throw new Error('cancelled while reading NKERP tours');
      try {
        results[i] = peopleOnTour(await nkerp.current(refs[i]), refs[i]);
      } catch (err) {
        failed ??= err;
        throw err;
      }
      done++;
      if (done === refs.length || done % 5 === 0) {
        progress({ level: 'debug', stage: 'read-tours', message: `read ${done} of ${refs.length} tours from NKERP`,
          current: done, total: refs.length });
      }
    }
  };
  const pool = Array.from({ length: Math.max(1, Math.min(concurrency, refs.length)) }, worker);
  const settled = await Promise.allSettled(pool);
  if (failed !== null) throw failed;
  const rejected = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
  if (rejected) throw rejected.reason;
  const out = new Map<string, Map<string, Person>>();
  refs.forEach((ref, i) => out.set(ref, results[i]!));
  return out;
}

/** One full run. Returns the report plus run statistics. Throws on configuration / read failures. */
export async function runSync(opts: RunOptions, deps: RunDeps): Promise<{ report: SyncReport; stats: RunStats }> {
  const progress = deps.progress ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const apply = Boolean(opts.apply);
  const today = opts.today || todayIn('Asia/Baghdad', now());
  const since = addDays(today, -LOOKBACK_DAYS);
  const only = new Set<SyncAction>(opts.only && opts.only.length ? opts.only : ALL_ACTIONS);
  const maxDealloc = opts.maxDeallocations ?? MAX_DEALLOC;

  progress({ level: 'info', stage: 'start', message: `${apply ? 'Sync' : 'Preview (dry run)'} for ${today}; actions: ${[...only].join(', ')}` });
  progress({ level: 'info', stage: 'read-sheet', message: 'Reading the Zaereen Lodging & Room Allotment Grid' });
  const sheet = await deps.readSheet();
  const sheetRooms = sheet.filter((r) => r.its && r.room).length;
  progress({ level: 'info', stage: 'read-sheet', message: `Sheet: ${sheet.length} rows, ${sheetRooms} with ITS and a room` });

  const histRows = await deps.history.read();
  const mem = memory(histRows, since);
  progress({ level: 'info', stage: 'read-history', message: `Sync History: ${histRows.length} rows, remembering ${mem.size} people since ${since}` });
  const histError = apply ? await deps.history.ensureWritable() : null;
  if (histError) progress({ level: 'error', stage: 'read-history', message: histError });

  progress({ level: 'info', stage: 'read-pending', message: 'Reading NKERP unallocated Najaf applicants' });
  const apps = await deps.nkerp.pending();
  progress({ level: 'info', stage: 'read-pending', message: `NKERP: ${apps.length} applicants still have unallocated Najaf nights` });

  const R = new Run(deps.nkerp, apply, today, Boolean(opts.allowOverCapacity), opts.limit, progress, deps.signal);
  const rep = R.report;

  const { items, notes, skipped } = plan(sheet, apps, today);
  const refs = sortedStrings([
    ...sheet.filter((r) => r.ref && r.arrival && r.arrival >= since).map((r) => r.ref),
    ...[...mem.keys()].map((k) => parseTupleKey<[string, string]>(k)[0]),
  ]);
  progress({ level: 'info', stage: 'read-tours', message: `Reading who is where for ${refs.length} tours`, current: 0, total: refs.length });
  const current = await readTours(deps.nkerp, refs, deps.concurrency ?? 4, progress, deps.signal);
  const sync = planSync(sheet, current, apps, mem, today);
  for (const [k, v] of Object.entries(sync.notes)) (notes[k] ??= []).push(...v);
  rep.notes = notes;
  rep.skipped = skipped;
  const peopleInNkerp = [...current.values()].reduce((n, m) => n + m.size, 0);
  progress({ level: 'info', stage: 'plan', message:
    `Plan: ${sync.removals.length} to deallocate, ${sync.moves.length} to reallocate, ${items.length} to allocate` });

  let held: string | null = null;
  const removalPeople = new Set(sync.removals.map((rm) => tupleKey(rm.ref, rm.its))).size;
  if (histError) {
    held = `deallocation needs the Sync History tab: ${histError}`;
    rep.problems.push({ action: 'history', group: 'Sync History', people: [], reason: histError });
  } else if (removalPeople > maxDealloc && !opts.allowMassDeallocation) {
    held = `${sync.removals.length} people to deallocate is more than ${maxDealloc} in one run; held all. `
      + "Check the Sheet wasn't cleared by mistake, then rerun with --allow-mass-deallocation if it is right.";
  } else if (sheetRooms < MIN_SHEET_ROOMS && sync.removals.length) {
    held = 'the Sheet shows almost no rooms (fewer than 10); deallocation held in case the Sheet read went wrong';
  }

  if (only.has('deallocate')) {
    await R.deallocate(sync.removals, held);
    for (const cl of sync.cleared) {
      R.log('CLEARED', 'recorded', { ref: cl.ref, its: cl.its, name: cl.name, arrival: cl.arrival, sheet: null,
        before: place(...cl.was) }, cl.details);
    }
  }
  if (only.has('reallocate')) await R.reallocate(sync.moves, sync.state);
  if (only.has('allocate')) await R.allocate(items);

  // people whose Sheet room changed since the last run and who weren't acted on: remember what the Sheet says
  for (const key of sortBy(sync.state.keys(), (k) => parseTupleKey<[string, string]>(k))) {
    const st = sync.state.get(key)!;
    const [ref, its] = parseTupleKey<[string, string]>(key);
    const m = mem.get(key);
    if (st.arrival && st.arrival < since) continue;          // stays older than the lookback aren't remembered
    if (!R.acted.has(key) && (!m || m.building !== st.building || m.room !== st.room)) {
      R.log('SEEN', 'recorded', { ref, its, name: st.name, arrival: st.arrival, sheet: [st.building, st.room] },
        `Sheet room by ${st.how}`);
    }
  }
  if (apply && !histError) {
    const { runAt, runId } = stampsIn('Asia/Baghdad', now());
    for (const h of R.hist) {
      h['Run At'] = runAt;
      h['Run ID'] = runId;
    }
    try {
      rep.history = { rows_written: await deps.history.append(R.hist) };
      progress({ level: 'success', stage: 'history', message: `Logged ${rep.history.rows_written} rows to Sync History (run ${runId})` });
    } catch (exc) {
      rep.history = { error: `could not append to Sync History (${errorMessage(exc)})` };
      rep.problems.push({ action: 'history', group: 'Sync History', people: [], reason: rep.history.error! });
      progress({ level: 'error', stage: 'history', message: rep.history.error! });
    }
  } else {
    rep.history = histError ? { error: histError } : { rows_planned: R.hist.length };
  }
  const stats: RunStats = { sheetRows: sheet.length, sheetRooms, historyRows: histRows.length, remembered: mem.size,
    pending: apps.length, toursRead: refs.length, peopleInNkerp };
  return { report: rep, stats };
}

export { Run as SyncRun };
