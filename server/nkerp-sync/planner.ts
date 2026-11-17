/**
 * Who goes where, and what has to change. Pure functions: no I/O, fully covered by offline tests.
 *
 * The Sheet's room for one NKERP person, per tour:
 *   1. their ITS on a Sheet row of that tour with building + room -> that room;
 *   2. else their NKERP family number: if every Sheet row of that tour + family with a room points to one
 *      room -> that room (a family split across rooms places only members listed by ITS);
 *   3. the same ITS twice in one tour with different rooms is a duplicate: reported, nobody touched;
 *   4. otherwise the Sheet gives no room.
 */
import type {
  AllocItem, Cleared, MemoryEntry, Move, NkRecord, Notes, Person, Removal, Resolution, SheetIndex, SheetRow,
  Skipped, StateEntry,
} from './types.js';
import { day, familyNo, groupBy, norm, parseTupleKey, place, sortBy, sortedStrings, tupleKey } from './util.js';

/** Ordered multi-map used for notes (keeps Python defaultdict(list) insertion order). */
export function addNote(notes: Notes, key: string, value: string): void {
  (notes[key] ??= []).push(value);
}

function bump(skipped: Skipped, key: string): void {
  skipped[key] = (skipped[key] ?? 0) + 1;
}

/** One tour's Sheet rows -> ITS rooms, duplicate ITS, and family rooms (rows with ITS + building + room). */
export function sheetIndex(rows: SheetRow[]): SheetIndex {
  const usable = rows.filter((r) => r.its && r.room && r.building);
  const itsRoom = new Map<string, [string, string]>();
  const dupes = new Set<string>();
  for (const r of usable) {
    const k = norm(r.its);
    const prev = itsRoom.get(k);
    if (prev && (prev[0] !== r.building || prev[1] !== r.room)) dupes.add(k);
    if (!prev) itsRoom.set(k, [r.building, r.room]);
  }
  for (const k of dupes) itsRoom.delete(k);
  const famRooms = new Map<string, Map<string, [string, string]>>();
  for (const r of usable) {
    if (!r.family) continue;
    let rooms = famRooms.get(r.family);
    if (!rooms) famRooms.set(r.family, (rooms = new Map()));
    rooms.set(tupleKey(r.building, r.room), [r.building, r.room]);
  }
  return { its_room: itsRoom, dupes, fam_rooms: famRooms };
}

export const EMPTY_INDEX: SheetIndex = sheetIndex([]);

/** The Sheet's room for one NKERP person. */
export function resolve(ix: SheetIndex, its: string, fam: string): Resolution {
  if (ix.dupes.has(its)) return { kind: 'dupe', target: null, how: 'duplicate ITS with different rooms' };
  const own = ix.its_room.get(its);
  if (own) return { kind: 'room', target: own, how: 'ITS' };
  const rooms = fam ? ix.fam_rooms.get(fam) : undefined;
  if (rooms && rooms.size === 1) return { kind: 'room', target: rooms.values().next().value as [string, string], how: `family ${fam}` };
  if (rooms && rooms.size > 1) return { kind: 'split', target: null, how: 'family split across rooms' };
  return { kind: 'none', target: null, how: '' };
}

/** Unallocated Najaf dates of the stay that arrives on the Sheet's arrival day; null when ambiguous. */
export function stayDates(app: NkRecord, arrival: string): NkRecord[] | null {
  const allStays: NkRecord[] = app.TourIternaryDates || [];
  let stays = allStays.filter((s) => day(s.ArrivalDate) === arrival);
  if (!stays.length && allStays.length === 1) stays = allStays;   // one Najaf stay only: NKERP's dates win
  if (stays.length !== 1) return null;
  const lo = day(stays[0].ArrivalDate);
  const hi = day(stays[0].DepartureDate);
  return (app.lstSubVenueDates || []).filter((d: NkRecord) =>
    lo <= day(d.ArrivalDate) && day(d.ArrivalDate) <= hi && !d.isPreviousAssigned && !d.isFull);
}

/** Allocation: match Sheet rows to pending NKERP applicants. */
export function plan(sheet: SheetRow[], apps: NkRecord[], today: string):
  { items: AllocItem[]; notes: Notes; skipped: Skipped } {
  const notes: Notes = {};
  const skipped: Skipped = {};
  const rows: SheetRow[] = [];
  for (const r of sheet) {
    if (!r.ref) continue;
    if (r.arrival === null) {
      if (r.arrival_text) {
        addNote(notes, 'unreadable ARRIVAL date in the Sheet (row skipped)', `row ${r.row} ${r.ref} '${r.arrival_text}'`);
      } else {
        bump(skipped, 'no ARRIVAL date');
      }
      continue;
    }
    if (r.arrival >= today) rows.push(r);
  }
  const byRef = groupBy(apps, (a) => norm(a.TourRefenceNO));
  const groups = groupBy(rows, (r) => tupleKey(r.arrival, r.ref));
  const out: AllocItem[] = [];
  for (const gk of sortBy(groups.keys(), (k) => parseTupleKey<[string, string]>(k))) {
    const [arrival, ref] = parseTupleKey<[string, string]>(gk);
    const rs = groups.get(gk)!;
    for (const r of rs) {
      if (!r.its) bump(skipped, 'no ITS in the Sheet');
      else if (!(r.room && r.building)) bump(skipped, 'no building/room yet in the Sheet');
    }
    const ix = sheetIndex(rs);
    if (!ix.its_room.size && !ix.dupes.size) continue;
    for (const k of sortedStrings(ix.dupes)) addNote(notes, 'duplicate ITS with different rooms (skipped)', `${ref} ITS ${k}`);
    const cands = byRef.get(ref) ?? [];
    if (!cands.length) {
      bump(skipped, 'tours already fully allocated in NKERP');
      continue;
    }
    const matched = new Set<string>();
    for (const a of cands) {
      const its = norm(a.ITSId);
      const res = resolve(ix, its, familyNo(a.FamilyName));
      if (res.kind === 'split') {
        addNote(notes, 'family split across rooms in the Sheet and person not listed by ITS (skipped)',
          `${ref} ${familyNo(a.FamilyName)} ${String(a.ApplicantName).trim()}`);
      }
      if (res.kind !== 'room') continue;
      const dates = stayDates(a, arrival);
      if (dates === null) {
        addNote(notes, 'arrival date differs from NKERP stay', `${ref} ${String(a.ApplicantName).trim()} (Sheet ${arrival})`);
        continue;
      }
      if (!dates.length) continue;
      let how = res.how;
      const nk = day(dates[0].ArrivalDate);
      if (!(a.TourIternaryDates || []).some((s: NkRecord) => day(s.ArrivalDate) === arrival)) {
        how += ` (Sheet arrival ${arrival}, NKERP ${nk} used)`;
      }
      matched.add(its);
      out.push({ arrival, ref, building: res.target[0], room: res.target[1], how, app: a, dates });
    }
    const candIts = new Set(cands.map((a) => norm(a.ITSId)));
    for (const k of ix.its_room.keys()) {
      if (!matched.has(k) && !candIts.has(k)) bump(skipped, 'Sheet people already allocated in NKERP');
    }
  }
  return { items: out, notes, skipped };
}

/** A tour's NKERP room-nights -> {ITS: person with nights [{day, building, room, row, entry}]}. */
export function peopleOnTour(rows: NkRecord[], ref: string): Map<string, Person> {
  const out = new Map<string, Person>();
  for (const r of rows) {
    if (r.IsActive === false || !r.OccupiedDate) continue;
    for (const x of r.RoomAllocatedDates_Current || []) {
      if (x.IsActive === false) continue;
      if (x.TourReferenceNo && norm(x.TourReferenceNo) !== ref) continue;   // another tour sharing the room
      const its = norm(x.AppicantITSId);
      if (!its) continue;
      let p = out.get(its);
      if (!p) {
        p = { its, aid: x.ApplicantId ?? null, ref, tour_id: x.TourId ?? null, name: String(x.ApplicantName ?? '').trim(),
          family: familyNo(x.Family), nights: [] };
        out.set(its, p);
      }
      p.nights.push({ day: day(r.OccupiedDate), building: norm(r.PropertyName), room: norm(r.RoomNo), row: r, entry: x });
    }
  }
  for (const p of out.values()) p.nights = sortBy(p.nights, (n) => n.day);
  return out;
}

export interface SyncPlan {
  moves: Move[];
  removals: Removal[];
  cleared: Cleared[];
  /** tupleKey(ref, its) -> the Sheet's room for everyone the Sheet places (for SEEN rows). */
  state: Map<string, StateEntry>;
  notes: Notes;
}

/**
 * Reallocations, deallocations and the Sheet state for history.
 * current: TOUR ID -> (ITS -> person) from NKERP; mem: memory(); apps: the unallocated list.
 */
export function planSync(sheet: SheetRow[], current: Map<string, Map<string, Person>>, apps: NkRecord[],
  mem: Map<string, MemoryEntry>, today: string): SyncPlan {
  const notes: Notes = {};
  const byRef = groupBy(sheet.filter((r) => r.ref && r.its), (r) => r.ref);
  const idx = new Map<string, SheetIndex>();
  for (const [ref, rs] of byRef) idx.set(ref, sheetIndex(rs));
  const arrival = new Map<string, string>();
  for (const r of sheet) {
    if (r.ref && r.its && r.arrival) arrival.set(tupleKey(r.ref, norm(r.its)), r.arrival);
  }
  const moves: Move[] = [];
  const removals: Removal[] = [];
  const cleared: Cleared[] = [];
  const state = new Map<string, StateEntry>();

  const remember = (ref: string, its: string, name: string, target: [string, string], how: string, firstDay: string) => {
    state.set(tupleKey(ref, its), {
      building: target[0], room: target[1], how, name, arrival: arrival.get(tupleKey(ref, its)) || firstDay || '',
    });
  };

  for (const ref of sortedStrings(current.keys())) {
    const people = current.get(ref)!;
    const ix = idx.get(ref) ?? EMPTY_INDEX;
    for (const its of sortedStrings(people.keys())) {
      const p = people.get(its)!;
      const res = resolve(ix, its, p.family);
      if (res.kind !== 'room') continue;
      const target = res.target;
      remember(ref, its, p.name, target, res.how, p.nights.length ? p.nights[0].day : '');
      const wrong = p.nights.filter((n) => n.day >= today && (n.building !== target[0] || n.room !== target[1]));
      if (wrong.length) {
        moves.push({ ref, person: p, building: target[0], room: target[1], how: res.how, nights: wrong,
          from: sortedStrings(wrong.map((n) => place(n.building, n.room))) });
      }
    }
  }
  for (const a of apps) {
    const ref = norm(a.TourRefenceNO);
    const its = norm(a.ITSId);
    const ix = idx.get(ref);
    if (ix && !state.has(tupleKey(ref, its))) {
      const res = resolve(ix, its, familyNo(a.FamilyName));
      if (res.kind === 'room') {
        const first = ((a.TourIternaryDates || [{}])[0] || {}).ArrivalDate || '';
        remember(ref, its, String(a.ApplicantName).trim(), res.target, res.how, first ? day(first) : '');
      }
    }
  }
  for (const key of sortBy(mem.keys(), (k) => parseTupleKey<[string, string]>(k))) {
    const m = mem.get(key)!;
    const [ref, its] = parseTupleKey<[string, string]>(key);
    if (!m.room) continue;
    const p = current.get(ref)?.get(its);
    const res = resolve(idx.get(ref) ?? EMPTY_INDEX, its, p ? p.family : '');
    if (res.kind === 'room') continue;          // still has a room in the Sheet; reallocation handles any change
    if (res.kind !== 'none') {
      addNote(notes, 'Sheet unclear for a previously synced person (left alone)', `${ref} ITS ${its}: ${res.how}`);
      continue;
    }
    const was: [string, string] = [m.building, m.room];
    const future = (p ? p.nights : []).filter((n) => n.day >= today);
    const mine = future.filter((n) => n.building === was[0] && n.room === was[1]);
    const base = { ref, its, name: p?.name || m.name, arrival: m.arrival, was };
    if (!future.length) {
      cleared.push({ ...base, details: 'Sheet cleared; NKERP has no Najaf nights from today' });
    } else if (!mine.length) {
      const here = sortedStrings(future.map((n) => place(n.building, n.room))).join(', ');
      cleared.push({ ...base, details: `Sheet cleared; NKERP has them in ${here}, not the last synced room; left alone` });
      addNote(notes, 'Sheet cleared but NKERP room differs from last sync (left alone)',
        `${ref} ${base.name} (ITS ${its}): NKERP ${here}, last synced ${place(...was)}`);
    } else {
      if (mine.length < future.length) {
        addNote(notes, 'deallocated only the last synced room; other NKERP nights left', `${ref} ${base.name} (ITS ${its})`);
      }
      removals.push({ ...base, person: p, nights: mine });
    }
  }
  return { moves, removals, cleared, state, notes };
}
