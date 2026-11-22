/**
 * AI allocation planner.
 *
 * Plans rooms for zaereen who do not have one yet. It works from rules learned from the
 * allocations already saved in the app (current and recent stays), and from the room inventory:
 *
 *  - only members of the same family group share a room; any other sharing is the user's own choice in the
 *    planner. A family group is the GROUP_ID when there is one, else the NKERP family number (F-1, F-2 …
 *    within a tour), else the HOF ID for tours that give every zair their own family number
 *    (see utils/familyGroups);
 *  - a family stays together in one room when a room is big enough. Only a family no room can hold is
 *    split, into the parts that leave the fewest empty beds;
 *  - the room is sized to the family so as few beds as possible stay empty: an exact fit first, then a
 *    buffer bed, and an empty bed last; habits only decide between rooms that fit equally well;
 *  - starred zaereen (personal requests) always stay in Burhani and are placed first; their remarks decide the room;
 *  - a tour is kept in one building and close together on the same floors;
 *  - each office's usual buildings and room types (as allocated before) are preferred;
 *  - infants under 3 do not take a bed;
 *  - same-day turnovers where the previous guests leave after the new guests arrive are avoided;
 *  - everyone in these hotels is Category A. Zaereen shifted A→B are in external hotels and are not planned;
 *    zaereen who do not fit are the ones to shift A→B.
 *
 * The module is pure: it never saves anything. The planner screen lets the user change the plan
 * and then allocates it through the app's normal save path.
 */
import type { Reservation, Room } from '../types';
import { checkTurnoverTimingConflict, getReservationEffectivePax, isInfant } from '../utils/turnoverTiming';
import { type FamilyGroup, familyGroups, groupOf } from '../utils/familyGroups';

export interface PlannerOptions {
  /** First arrival date to plan (YYYY-MM-DD). */
  fromDate: string;
  /** Last arrival date to plan (YYYY-MM-DD). */
  toDate: string;
  /** Use rooms' buffer beds when that keeps a family together. */
  allowBuffer: boolean;
  /** Keep each tour in one building where possible. */
  keepTourTogether: boolean;
  /** Prefer the buildings and room types each office was given before. */
  followOfficeHabits: boolean;
  /** Also plan stays that already arrived but still have no room. */
  includeArrived: boolean;
  /** Buildings the planner may use. Empty means every building. */
  buildings: string[];
}

export interface PlanMember {
  id: string;
  name: string;
  itsId: string;
  gender: string;
  age: string;
  infant: boolean;
  starred: boolean;
  remarks?: string;
  /** Other records of the same zair on this tour with overlapping dates; they get the same room. */
  alsoIds?: string[];
}

/** One group that is placed in one room: a family, or part of a family when it had to be split. */
export interface PlanUnit {
  key: string;
  tourRefNo: string;
  officeName: string;
  groupLeadName: string;
  /** Family as shown: `F-3`, or every family number of a household grouped by HOF ID or group ID. */
  family: string;
  /** Who may share the room: the family group's identity within the tour (see utils/familyGroups). */
  familyKey: string;
  /** Why several family numbers are one group, e.g. the shared HOF ID. */
  familyNote?: string;
  arrivalDate: string;
  departureDate: string;
  arrivalTime?: string;
  departureTime?: string;
  members: PlanMember[];
  /** Beds the unit needs (infants under 3 do not count). */
  pax: number;
  /** A building already chosen for these zaereen without a room number. */
  presetBuilding?: string;
  starred: boolean;
  /** Set when the family had to be split across rooms. */
  splitFrom?: string;
  /** The user split this family; refreshing keeps the split. */
  userSplit?: boolean;
  /** These zaereen already have this room on another record for the same tour. */
  followRoom?: { building: string; roomNumber: string };
}

export interface PlanAssignment {
  building: string;
  roomNumber: string;
  reasons: string[];
  warnings: string[];
  /** The user chose this room; re-planning keeps it. */
  locked?: boolean;
}

export interface AllocationPlan {
  generatedAt: string;
  options: PlannerOptions;
  units: PlanUnit[];
  /** unit key → room, or null when the unit is left without a room. */
  assignments: Record<string, PlanAssignment | null>;
  /** unit key → why no room was found. */
  unplaced: Record<string, string>;
}

export interface RoomOption {
  room: Room;
  /** free: the planner would use it; share: another family of this tour is there (your call); unsuitable: adds a warning. */
  kind: 'free' | 'share' | 'unsuitable';
  score: number;
  freeBeds: number;
  note: string;
}

export interface LearnedPatterns {
  allocatedStays: number;
  tours: number;
  familiesTogetherPct: number;
  toursOneBuildingPct: number;
  bufferUsePct: number;
  /** Rooms staff shared between different families by hand. */
  manualSharePct: number;
  starredBurhaniPct: number;
  /** family size → most used room size and building. */
  sizeHabits: { size: string; capacity: number; building: string; pct: number; samples: number }[];
  /** office → share of its guests per `building|category`. */
  officeHabits: Record<string, Record<string, number>>;
  /** bucket is `building|room type`. */
  officeTop: { office: string; bucket: string; pct: number; samples: number }[];
  /** family size label (1–4, 5+) → share of such families per building. */
  sizeBuildingHabits: Record<string, Record<string, number>>;
  globalHabits: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
const day = (v?: string) => String(v || '').slice(0, 10);
export const roomKey = (building: string, roomNumber: string) => `${lower(building)}|${lower(roomNumber)}`;
/** The room's type as labelled in the inventory. Every room in these hotels is Category A for the zaereen. */
export const roomTier = (room: Room) => (/nizaam|category a|executive/i.test(room.category) ? 'Nizaam' : 'Standard');
const bucketOf = (room: Room) => `${room.building}|${roomTier(room)}`;
export const STARRED_BUILDING = 'Burhani';
const maxBeds = (room: Room) => (room.capacity || room.pax || 2) + (room.buffer || 0);
const baseBeds = (room: Room) => room.capacity || room.pax || 2;

export function addDays(date: string, days: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Baghdad calendar date. */
export function baghdadToday(now = Date.now()) {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

/** Nights a stay occupies: [arrival, departure). A same-day stay occupies its one date. */
function nights(arrival: string, departure: string) {
  if (!arrival || !departure || departure <= arrival) return arrival ? [arrival] : [];
  const out: string[] = [];
  for (let d = arrival; d < departure && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
const covers = (a: string, d: string, night: string) => (a === d ? night === a : a <= night && night < d);
const overlaps = (a1: string, d1: string, a2: string, d2: string) => nights(a1, d1).some((n) => covers(a2, d2, n));

const ageNum = (age: unknown) => {
  const n = parseFloat(String(age ?? ''));
  return Number.isFinite(n) ? n : NaN;
};
/** Adults (12+ or unknown age); a split family keeps children with the women. */
const isAdult = (m: { age: string }) => !(ageNum(m.age) < 12);
const genderOf = (g: string) => (/^f/i.test(g) ? 'F' : /^m/i.test(g) ? 'M' : '');

/**
 * The time a zair actually arrives or leaves. NKERP fills an unknown departure with 23:59 (end of day), so the
 * travel plan's time is used when there is one, and a bare 23:59 is treated as unknown.
 */
export function stayTime(r: Reservation, kind: 'arrival' | 'departure'): string | undefined {
  const date = kind === 'arrival' ? day(r.arrivalDate) : day(r.departureDate);
  const legs = (kind === 'arrival' ? r.arrivalTravel : r.departureTravel) || [];
  const leg = legs.find((l) => l.localTime && day(l.localTime) === date);
  const fromLeg = leg?.localTime && /T(\d\d:\d\d)/.exec(leg.localTime)?.[1];
  if (fromLeg) return fromLeg;
  const raw = String((kind === 'arrival' ? r.arrivalTime : r.departureTime) || '').trim();
  if (!raw || /^(23:59|11:59\s*pm)$/i.test(raw)) return undefined;
  return raw;
}

/** Shifted A→B: the zair stays in an external hotel, so the planner leaves them out. */
export function shiftedOut(r: Reservation) {
  return r.shiftDirection === 'A_TO_B' || Boolean(r.refundSlipNo) || r.accommodationCategory === 'Category B (Standard)';
}

function sortRooms(rooms: Room[]) {
  return [...rooms].sort((a, b) =>
    a.building.localeCompare(b.building) || (a.floor ?? 0) - (b.floor ?? 0) ||
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
}

// ---------------------------------------------------------------------------------------------
// Learning from saved allocations
// ---------------------------------------------------------------------------------------------

export function learnPatterns(reservations: Reservation[], rooms: Room[]): LearnedPatterns {
  const groups = familyGroups(reservations);
  const famOf = (r: Reservation) => `${lower(r.tourRefNo)}|${groupOf(groups, r).key}`;
  const byKey = new Map(rooms.map((r) => [roomKey(r.building, r.roomNumber), r]));
  const allocated = reservations.filter((r) => r.roomNumber && byKey.has(roomKey(r.building, r.roomNumber)));
  const roomOf = (r: Reservation) => byKey.get(roomKey(r.building, r.roomNumber))!;

  const families = new Map<string, Set<string>>();
  const tours = new Map<string, Set<string>>();
  const stays = new Map<string, Reservation[]>();
  const office: Record<string, Record<string, number>> = {};
  const global: Record<string, number> = {};
  for (const r of allocated) {
    const room = roomOf(r);
    const fam = famOf(r);
    families.set(fam, (families.get(fam) || new Set()).add(roomKey(room.building, room.roomNumber)));
    tours.set(lower(r.tourRefNo), (tours.get(lower(r.tourRefNo)) || new Set()).add(room.building));
    const stayId = `${roomKey(room.building, room.roomNumber)}|${day(r.arrivalDate)}`;
    stays.set(stayId, [...(stays.get(stayId) || []), r]);
    const o = (office[r.officeName || '—'] ||= {});
    o[bucketOf(room)] = (o[bucketOf(room)] || 0) + 1;
    global[bucketOf(room)] = (global[bucketOf(room)] || 0) + 1;
  }
  const normalize = (m: Record<string, number>) => {
    const total = Object.values(m).reduce((s, v) => s + v, 0) || 1;
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / total]));
  };

  let buffer = 0, shared = 0;
  for (const [id, list] of stays) {
    const room = byKey.get(id.split('|').slice(0, 2).join('|'))!;
    const pax = list.reduce((s, r) => s + getReservationEffectivePax(r), 0);
    if (pax > baseBeds(room)) buffer++;
    const fams = new Set(list.map(famOf));
    if (fams.size > 1) shared++;
  }

  // Family size → room size actually used, when the whole family had one room.
  const famMembers = new Map<string, Reservation[]>();
  for (const r of allocated) {
    const fam = famOf(r);
    famMembers.set(fam, [...(famMembers.get(fam) || []), r]);
  }
  const sizeCounts: Record<string, Record<string, number>> = {};
  for (const [fam, list] of famMembers) {
    if (families.get(fam)!.size !== 1) continue;
    const size = Math.min(5, list.reduce((s, r) => s + getReservationEffectivePax(r), 0));
    if (!size) continue;
    const room = roomOf(list[0]);
    const label = size >= 5 ? '5+' : String(size);
    const k = `${baseBeds(room)}|${room.building}`;
    (sizeCounts[label] ||= {})[k] = ((sizeCounts[label] ||= {})[k] || 0) + 1;
  }
  const sizeHabits = Object.entries(sizeCounts).sort(([a], [b]) => a.localeCompare(b)).map(([size, m]) => {
    const total = Object.values(m).reduce((s, v) => s + v, 0);
    const [top, n] = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    const [capacity, building] = top.split('|');
    return { size, capacity: Number(capacity), building, pct: Math.round((n / total) * 100), samples: total };
  });

  const sizeBuildingHabits: Record<string, Record<string, number>> = {};
  for (const [label, m] of Object.entries(sizeCounts)) {
    const perBuilding: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) perBuilding[k.split('|')[1]] = (perBuilding[k.split('|')[1]] || 0) + v;
    sizeBuildingHabits[label] = normalize(perBuilding);
  }

  const officeHabits = Object.fromEntries(Object.entries(office).map(([k, v]) => [k, normalize(v)]));
  const officeTop = Object.entries(office)
    .map(([o, m]) => {
      const total = Object.values(m).reduce((s, v) => s + v, 0);
      const [bucket, n] = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
      return { office: o, bucket, pct: Math.round((n / total) * 100), samples: total };
    })
    .filter((x) => x.samples >= 5)
    .sort((a, b) => b.samples - a.samples);

  const starred = allocated.filter((r) => r.isSpecialGuest);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return {
    allocatedStays: allocated.length,
    tours: tours.size,
    familiesTogetherPct: pct([...families.values()].filter((s) => s.size === 1).length, families.size),
    toursOneBuildingPct: pct([...tours.values()].filter((s) => s.size === 1).length, tours.size),
    bufferUsePct: pct(buffer, stays.size),
    manualSharePct: pct(shared, stays.size),
    starredBurhaniPct: pct(starred.filter((r) => r.building === 'Burhani').length, starred.length),
    sizeHabits,
    officeHabits,
    officeTop,
    sizeBuildingHabits,
    globalHabits: normalize(global),
  };
}

// ---------------------------------------------------------------------------------------------
// Units: who needs a room
// ---------------------------------------------------------------------------------------------

export function needsRoom(r: Reservation, options: PlannerOptions, today: string) {
  if (String(r.roomNumber || '').trim() || shiftedOut(r)) return false;
  const a = day(r.arrivalDate);
  const d = day(r.departureDate) || a;
  if (!a || !r.tourRefNo) return false;
  if (d < today) return false;
  if (a > options.toDate) return false;
  if (a < options.fromDate && !(options.includeArrived && d >= today)) return false;
  return true;
}

function member(r: Reservation): PlanMember {
  return {
    id: r.id, name: r.applicantName, itsId: String(r.itsId ?? ''), gender: r.gender, age: String(r.age ?? ''),
    infant: isInfant(r), starred: Boolean(r.isSpecialGuest), remarks: r.specialRemarks || undefined,
  };
}

const personKey = (r: Reservation) => `${lower(r.tourRefNo)}|${String(r.itsId ?? '').replace(/^['’]/, '').trim()}`;
const stayStart = (r: Reservation) => day(r.arrivalDate);
const stayEnd = (r: Reservation) => day(r.departureDate) || day(r.arrivalDate);
const sameStay = (a: Reservation, b: Reservation) =>
  stayStart(a) === stayStart(b) || overlaps(stayStart(a), stayEnd(a), stayStart(b), stayEnd(b));

export function collectUnits(reservations: Reservation[], options: PlannerOptions, today = baghdadToday()): PlanUnit[] {
  const families = familyGroups(reservations);
  const fam = (r: Reservation) => groupOf(families, r);
  // NKERP sometimes lists the same zair twice on a tour (for example after an arrival date changed).
  // Such a record follows the room the other record already has, or both records are planned once.
  const byPerson = new Map<string, Reservation[]>();
  for (const r of reservations) {
    if (!String(r.itsId ?? '').trim() || !r.tourRefNo) continue;
    byPerson.set(personKey(r), [...(byPerson.get(personKey(r)) || []), r]);
  }
  const absorbed = new Set<string>();
  const twinsOf = new Map<string, Reservation[]>();
  const followers = new Map<string, { list: Reservation[]; room: Reservation }>();
  const groups = new Map<string, Reservation[]>();
  const span = new Map<string, { start: string; end: string }>();
  for (const r of reservations) {
    if (absorbed.has(r.id) || !needsRoom(r, options, today)) continue;
    const twins = (byPerson.get(personKey(r)) || []).filter((s) => s.id !== r.id && sameStay(r, s));
    const roomed = twins.find((s) => String(s.roomNumber || '').trim());
    if (roomed) {
      const k = [lower(r.tourRefNo), fam(r).key, lower(roomed.building), lower(roomed.roomNumber)].join('|');
      const entry = followers.get(k) || { list: [], room: roomed };
      entry.list.push(r);
      followers.set(k, entry);
      continue;
    }
    let primary = r;
    if (twins.length) {
      const all = [r, ...twins];
      // The record NKERP sends now is the current one; otherwise the latest arrival.
      primary = [...all].sort((a, b) => Number(b.id.startsWith('nkerp-')) - Number(a.id.startsWith('nkerp-')) ||
        stayStart(b).localeCompare(stayStart(a)))[0];
      all.forEach((x) => x.id !== primary.id && absorbed.add(x.id));
      twinsOf.set(primary.id, all.filter((x) => x.id !== primary.id));
      span.set(primary.id, {
        start: all.map(stayStart).sort()[0],
        end: all.map(stayEnd).sort().reverse()[0],
      });
    }
    const start = span.get(primary.id)?.start || stayStart(primary);
    const end = span.get(primary.id)?.end || stayEnd(primary);
    const key = [lower(primary.tourRefNo), fam(primary).key, start, end].join('|');
    groups.set(key, [...(groups.get(key) || []).filter((x) => x.id !== primary.id), primary]);
  }
  const units: PlanUnit[] = [];
  for (const [key, { list, room }] of followers) {
    const first = list[0];
    units.push({
      key: `follow|${key}`,
      tourRefNo: first.tourRefNo, officeName: first.officeName || '', groupLeadName: first.groupLeadName || '',
      ...familyFields(fam(first)),
      arrivalDate: stayStart(first), departureDate: stayEnd(first), arrivalTime: stayTime(first, 'arrival'), departureTime: stayTime(first, 'departure'),
      members: list.map(member), pax: 0, starred: list.some((r) => r.isSpecialGuest),
      followRoom: { building: room.building, roomNumber: room.roomNumber },
    });
  }
  for (const [key, list] of groups) {
    const first = list[0];
    const preset = list.flatMap((r) => [r, ...(twinsOf.get(r.id) || [])]).map((r) => String(r.building || '').trim()).find(Boolean);
    units.push({
      key,
      tourRefNo: first.tourRefNo,
      officeName: first.officeName || '',
      groupLeadName: first.groupLeadName || '',
      ...familyFields(fam(first)),
      arrivalDate: span.get(first.id)?.start || stayStart(first),
      departureDate: span.get(first.id)?.end || stayEnd(first),
      arrivalTime: stayTime(first, 'arrival'),
      departureTime: stayTime(first, 'departure'),
      members: list.map((r) => {
        const m = member(r);
        const twins = twinsOf.get(r.id);
        return twins ? { ...m, alsoIds: twins.map((t) => t.id) } : m;
      }).sort((a, b) => (ageNum(b.age) || 0) - (ageNum(a.age) || 0)),
      pax: list.reduce((s, r) => s + getReservationEffectivePax(r), 0),
      presetBuilding: preset,
      starred: list.some((r) => r.isSpecialGuest),
    });
  }
  return units;
}

const familyFields = (g: FamilyGroup) => ({ family: g.label, familyKey: g.key, ...(g.note ? { familyNote: g.note } : {}) });

/**
 * Splits a unit, keeping each gender together and children with the women. By default it splits into
 * `parts` equal halves; `firstBeds` instead gives the first part that many beds and the second the rest.
 */
export function splitUnit(unit: PlanUnit, parts = 2, firstBeds?: number): PlanUnit[] {
  if (unit.members.length < 2) return [unit];
  const ordered = [...unit.members].sort((a, b) => {
    const ga = genderOf(a.gender) === 'M' && isAdult(a) ? 1 : 0;
    const gb = genderOf(b.gender) === 'M' && isAdult(b) ? 1 : 0;
    return ga - gb || (ageNum(b.age) || 0) - (ageNum(a.age) || 0);
  });
  const beds = ordered.filter((m) => !m.infant).length;
  const size = Math.max(1, firstBeds ?? Math.ceil(beds / parts));
  const chunks: PlanMember[][] = [];
  let current: PlanMember[] = [];
  let used = 0;
  for (const m of ordered) {
    if (!m.infant && used >= size && chunks.length < parts - 1) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(m);
    if (!m.infant) used++;
  }
  chunks.push(current);
  return chunks.filter((c) => c.length).map((c, i) => ({
    ...unit,
    key: `${unit.key}#${i + 1}`,
    members: c,
    pax: c.filter((m) => !m.infant).length,
    starred: c.some((m) => m.starred),
    splitFrom: unit.splitFrom || unit.key,
  }));
}

/** Splits a unit into one unit per member, so each can be moved separately. */
export function splitIntoMembers(unit: PlanUnit): PlanUnit[] {
  return unit.members.map((m, i) => ({
    ...unit,
    key: `${unit.key}#m${i + 1}`,
    members: [m],
    pax: m.infant ? 0 : 1,
    starred: m.starred,
    splitFrom: unit.splitFrom || unit.key,
    userSplit: true,
  }));
}

// ---------------------------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------------------------

interface Stay {
  arrival: string;
  departure: string;
  arrivalTime?: string;
  departureTime?: string;
  pax: number;
  tour: string;
  family: string;
  /** Family label as shown (F-3). */
  label: string;
  unitKey?: string;
}

class Occupancy {
  private readonly byRoom = new Map<string, Stay[]>();

  /** `groups` must be worked out from every reservation, so saved relatives match the planned family. */
  static fromReservations(reservations: Reservation[], rooms: Room[], groups: Map<string, FamilyGroup>) {
    const occ = new Occupancy();
    const known = new Set(rooms.map((r) => roomKey(r.building, r.roomNumber)));
    for (const r of reservations) {
      if (!String(r.roomNumber || '').trim()) continue;
      const key = roomKey(r.building, r.roomNumber);
      if (!known.has(key)) continue;
      occ.add(key, {
        arrival: day(r.arrivalDate), departure: day(r.departureDate) || day(r.arrivalDate),
        arrivalTime: stayTime(r, 'arrival'), departureTime: stayTime(r, 'departure'),
        pax: getReservationEffectivePax(r), tour: lower(r.tourRefNo), family: groupOf(groups, r).key,
        label: groupOf(groups, r).label || r.applicantName,
      });
    }
    return occ;
  }

  add(key: string, stay: Stay) {
    this.byRoom.set(key, [...(this.byRoom.get(key) || []), stay]);
  }

  addUnit(key: string, unit: PlanUnit) {
    this.add(key, unitStay(unit));
  }

  removeUnit(key: string, unitKey: string) {
    this.byRoom.set(key, this.stays(key).filter((s) => s.unitKey !== unitKey));
  }

  stays(key: string) {
    return this.byRoom.get(key) || [];
  }
}

function unitStay(unit: PlanUnit): Stay {
  return {
    arrival: unit.arrivalDate, departure: unit.departureDate, arrivalTime: unit.arrivalTime, departureTime: unit.departureTime,
    pax: unit.pax, tour: lower(unit.tourRefNo), family: unit.familyKey, label: unit.family, unitKey: unit.key,
  };
}

// ---------------------------------------------------------------------------------------------
// Scoring one room for one unit
// ---------------------------------------------------------------------------------------------

/**
 * How strongly each preference counts; lower total score wins. An empty bed outweighs every habit put
 * together, so the planner always takes the room that leaves the fewest beds empty, and a buffer bed
 * comes before an empty one. Building, floor and office habits only decide between rooms that fit as well.
 */
const WEIGHT = {
  emptyBed: 25,
  bufferBed: 10,
  newBuilding: 5,
  sizeHabit: 5,
};

interface TourFootprint {
  buildings: Map<string, number>;
  floors: Map<string, number[]>;
}

interface Context {
  options: PlannerOptions;
  patterns: LearnedPatterns;
  occupancy: Occupancy;
  footprint: Map<string, TourFootprint>;
}

interface Evaluation {
  ok: boolean;
  score: number;
  freeBeds: number;
  /** Regular beds this room would leave empty with the unit in it. */
  emptyBeds: number;
  reasons: string[];
  warnings: string[];
  reject?: string;
}

/**
 * auto: what the planner may do on its own. manual: a room the user picks, which may also be shared with
 * another family of the same tour. force: anything, with warnings for what breaks the rules.
 */
type Mode = 'auto' | 'manual' | 'force';

function evaluate(unit: PlanUnit, room: Room, ctx: Context, mode: Mode = 'auto'): Evaluation {
  const key = roomKey(room.building, room.roomNumber);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const reject = (why: string): Evaluation => ({ ok: false, score: Infinity, freeBeds: 0, emptyBeds: 0, reasons, warnings, reject: why });
  const force = mode === 'force';

  if (room.status === 'blocked' && !force) return reject(`Room is blocked${room.blockedReason ? `: ${room.blockedReason}` : ''}`);
  if (mode === 'auto' && ctx.options.buildings.length && !ctx.options.buildings.includes(room.building)) return reject('Building not selected');
  if (unit.starred && room.building !== STARRED_BUILDING) {
    if (mode === 'auto') return reject(`Starred zaereen stay in ${STARRED_BUILDING}`);
    warnings.push(`Starred: normally ${STARRED_BUILDING}`);
  }

  const stays = ctx.occupancy.stays(key).filter((s) => s.unitKey !== unit.key);
  const sharing = stays.filter((s) => overlaps(unit.arrivalDate, unit.departureDate, s.arrival, s.departure));
  let peak = 0;
  for (const n of nights(unit.arrivalDate, unit.departureDate)) {
    peak = Math.max(peak, sharing.filter((s) => covers(s.arrival, s.departure, n)).reduce((sum, s) => sum + s.pax, 0));
  }
  const limit = ctx.options.allowBuffer ? maxBeds(room) : baseBeds(room);
  const freeBeds = Math.max(0, limit - peak);
  const after = peak + unit.pax;
  let score = 0;

  if (after > limit) {
    if (!force) return reject(peak ? `Only ${freeBeds} of ${limit} beds free` : `Room has ${limit} beds for ${unit.pax} pax`);
    warnings.push(`Over capacity: ${after} pax in ${limit} beds`);
    score += 50;
  }

  // Only one family shares a room. Sharing with another family is the user's call.
  const otherFamilies = sharing.filter((s) => !(s.tour === lower(unit.tourRefNo) && s.family === unit.familyKey));
  const sharesWith = [...new Set(otherFamilies.map((s) => s.label))].join(', ');
  if (otherFamilies.length) {
    if (otherFamilies.some((s) => s.tour !== lower(unit.tourRefNo))) {
      if (!force) return reject('Occupied by another tour');
      warnings.push('Shares with another tour');
    } else if (mode === 'auto') {
      return reject(`${sharesWith} of this tour is there`);
    }
    score += 2;
    reasons.push(`Shares with ${sharesWith} (your choice)`);
  } else if (sharing.length) {
    score -= 4;
    reasons.push('Joins the rest of the family');
  }

  // Fit: avoid empty beds, use buffer beds only when needed.
  const base = baseBeds(room);
  const emptyBeds = Math.max(0, base - after);
  if (after <= base) {
    const empty = base - after;
    score += WEIGHT.emptyBed * empty;
    if (!otherFamilies.length) reasons.push(empty === 0 ? `Exact fit: ${base} beds for ${after} pax` : `${after} pax in a ${base}-bed room`);
  } else {
    const buf = after - base;
    score += WEIGHT.bufferBed * buf;
    reasons.push(`${base}-bed room + ${buf} buffer bed${buf > 1 ? 's' : ''}`);
  }

  // Turnover timing on the arrival and departure days.
  for (const s of stays) {
    if (s.departure === unit.arrivalDate && s.departure !== s.arrival) {
      const t = checkTurnoverTimingConflict(s.departure, s.departureTime, unit.arrivalDate, unit.arrivalTime);
      if (t.isDepLaterThanArr) {
        score += 2 * t.diffHours;
        warnings.push(`Previous guests leave ${t.depTimeFormatted}, after this arrival at ${t.arrTimeFormatted}`);
      }
    }
    if (unit.departureDate === s.arrival && s.departure !== s.arrival) {
      const t = checkTurnoverTimingConflict(unit.departureDate, unit.departureTime, s.arrival, s.arrivalTime);
      if (t.isDepLaterThanArr) {
        score += 2 * t.diffHours;
        warnings.push(`Leaves ${t.depTimeFormatted}, after the next guests arrive at ${t.arrTimeFormatted}`);
      }
    }
  }

  // Building already chosen for these zaereen.
  if (unit.presetBuilding) {
    if (lower(unit.presetBuilding) === lower(room.building)) {
      score -= 10;
      reasons.push(`${room.building} was already chosen for them`);
    } else score += 4;
  }

  // Tour cohesion.
  const fp = ctx.footprint.get(lower(unit.tourRefNo));
  if (ctx.options.keepTourTogether && fp && fp.buildings.size) {
    if (fp.buildings.has(room.building)) {
      const floors = fp.floors.get(room.building) || [];
      const distance = floors.length ? Math.min(...floors.map((f) => Math.abs(f - (room.floor ?? 0)))) : 0;
      score += 0.6 * distance;
      reasons.push(distance === 0 ? `Same floor as the tour` : `Keeps the tour in ${room.building}`);
    } else {
      score += WEIGHT.newBuilding;
    }
  }

  if (unit.starred) {
    const remarks = [...new Set(unit.members.map((m) => m.remarks).filter(Boolean))].join('; ');
    reasons.push(`Starred: ${STARRED_BUILDING}${remarks ? `, check remarks: ${remarks}` : ''}`);
  }

  // Office habit learned from earlier allocations.
  if (ctx.options.followOfficeHabits) {
    const habits = ctx.patterns.officeHabits[unit.officeName];
    const source = habits || ctx.patterns.globalHabits;
    const best = Math.max(0.0001, ...Object.values(source));
    const share = source[bucketOf(room)] || 0;
    score += 8 * (1 - share / best);
    if (habits && share / best > 0.7) reasons.push(`${unit.officeName} usually stays in ${room.building} ${roomTier(room)} rooms (${Math.round(share * 100)}%)`);
    // Families of this size usually went to this building (e.g. 4–5 pax to Burhani, couples to Saifee).
    const bySize = ctx.patterns.sizeBuildingHabits[unit.pax >= 5 ? '5+' : String(Math.max(1, unit.pax))];
    if (bySize) {
      const top = Math.max(0.0001, ...Object.values(bySize));
      score += WEIGHT.sizeHabit * (1 - (bySize[room.building] || 0) / top);
    }
  }

  // Elderly guests: lower floors and western toilets.
  if (unit.members.some((m) => ageNum(m.age) >= 70)) {
    score += 0.4 * Math.max(0, room.floor ?? 0);
    if (/western/i.test(room.toiletType || '')) reasons.push('Western toilet for elderly');
    else score += 1.5;
  }

  if (unit.familyNote && !otherFamilies.length) reasons.push(unit.familyNote);
  return { ok: true, score, freeBeds, emptyBeds, reasons, warnings };
}

function footprintFrom(reservations: Reservation[], rooms: Room[]) {
  const byKey = new Map(rooms.map((r) => [roomKey(r.building, r.roomNumber), r]));
  const fp = new Map<string, TourFootprint>();
  for (const r of reservations) {
    if (!r.roomNumber) continue;
    const room = byKey.get(roomKey(r.building, r.roomNumber));
    if (room) addFootprint(fp, lower(r.tourRefNo), room);
  }
  return fp;
}
function addFootprint(fp: Map<string, TourFootprint>, tour: string, room: Room) {
  const entry = fp.get(tour) || { buildings: new Map(), floors: new Map() };
  entry.buildings.set(room.building, (entry.buildings.get(room.building) || 0) + 1);
  entry.floors.set(room.building, [...(entry.floors.get(room.building) || []), room.floor ?? 0]);
  fp.set(tour, entry);
}

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

export interface PlanInput {
  reservations: Reservation[];
  rooms: Room[];
  options: PlannerOptions;
  patterns?: LearnedPatterns;
  /** Units to plan; defaults to every stay that needs a room in the options' range. */
  units?: PlanUnit[];
  /** Units whose room the user already chose. */
  locked?: Record<string, PlanAssignment | null>;
  today?: string;
}

export function planAllocation(input: PlanInput): AllocationPlan {
  const { reservations, rooms, options } = input;
  const patterns = input.patterns || learnPatterns(reservations, rooms);
  const sorted = sortRooms(rooms);
  const inPlan = new Set<string>();
  const startUnits = input.units || collectUnits(reservations, options, input.today);
  startUnits.forEach((u) => u.members.forEach((m) => [m.id, ...(m.alsoIds || [])].forEach((id) => inPlan.add(id))));
  const existing = reservations.filter((r) => !inPlan.has(r.id));
  const ctx: Context = {
    options, patterns,
    occupancy: Occupancy.fromReservations(existing, rooms, familyGroups(reservations)),
    footprint: footprintFrom(existing, rooms),
  };
  const byKey = new Map(rooms.map((r) => [roomKey(r.building, r.roomNumber), r]));
  const assignments: Record<string, PlanAssignment | null> = {};
  const unplaced: Record<string, string> = {};
  const units: PlanUnit[] = [];

  const place = (unit: PlanUnit, room: Room, a: PlanAssignment) => {
    ctx.occupancy.addUnit(roomKey(room.building, room.roomNumber), unit);
    addFootprint(ctx.footprint, lower(unit.tourRefNo), room);
    assignments[unit.key] = a;
  };

  // The user's choices go first, exactly as chosen.
  const queue: PlanUnit[] = [];
  for (const unit of startUnits) {
    if (unit.followRoom && input.locked?.[unit.key] === undefined) {
      units.push(unit);
      const room = byKey.get(roomKey(unit.followRoom.building, unit.followRoom.roomNumber));
      if (!room) { assignments[unit.key] = null; unplaced[unit.key] = 'Their other record\'s room is no longer in the inventory'; continue; }
      place(unit, room, { building: room.building, roomNumber: room.roomNumber, reasons: ['Already has this room on another record for this tour'], warnings: [] });
      continue;
    }
    const choice = input.locked?.[unit.key];
    if (choice === undefined) { queue.push(unit); continue; }
    units.push(unit);
    if (choice === null) { assignments[unit.key] = null; unplaced[unit.key] = LEFT_EMPTY; continue; }
    const room = byKey.get(roomKey(choice.building, choice.roomNumber));
    if (!room) { assignments[unit.key] = null; unplaced[unit.key] = 'Chosen room is no longer in the inventory'; continue; }
    const ev = evaluate(unit, room, ctx, 'force');
    place(unit, room, { building: room.building, roomNumber: room.roomNumber, reasons: choice.reasons.length ? choice.reasons : ['Chosen by you'], warnings: ev.warnings, locked: true });
  }

  // Starred zaereen first, so Burhani still has room for them. Then earliest arrivals; within a day,
  // bigger tours first; within a tour, the biggest families, so smaller ones fill the remaining rooms.
  const tourSize = new Map<string, number>();
  for (const u of queue) tourSize.set(lower(u.tourRefNo), (tourSize.get(lower(u.tourRefNo)) || 0) + u.pax);
  const tourStart = new Map<string, string>();
  for (const u of queue) {
    const t = lower(u.tourRefNo);
    if (!tourStart.has(t) || u.arrivalDate < tourStart.get(t)!) tourStart.set(t, u.arrivalDate);
  }
  queue.sort((a, b) =>
    Number(b.starred) - Number(a.starred) ||
    tourStart.get(lower(a.tourRefNo))!.localeCompare(tourStart.get(lower(b.tourRefNo))!) ||
    (tourSize.get(lower(b.tourRefNo))! - tourSize.get(lower(a.tourRefNo))!) ||
    lower(a.tourRefNo).localeCompare(lower(b.tourRefNo)) ||
    b.pax - a.pax || a.arrivalDate.localeCompare(b.arrivalDate) || a.key.localeCompare(b.key));

  const roomOfUnit = new Map<string, Room>();
  const placedUnits = new Map<string, PlanUnit>();
  const userChosen = new Set(Object.keys(input.locked || {}));
  const bestRoom = (unit: PlanUnit, skip?: string) => {
    let best: { room: Room; ev: Evaluation } | null = null;
    let lastReject = '';
    for (const room of sorted) {
      if (skip && roomKey(room.building, room.roomNumber) === skip) continue;
      const ev = evaluate(unit, room, ctx);
      if (!ev.ok) { lastReject = ev.reject || lastReject; continue; }
      if (!best || ev.score < best.ev.score) best = { room, ev };
    }
    return { best, lastReject };
  };
  const placeBest = (unit: PlanUnit, room: Room, ev: Evaluation, extra: string[] = []) => {
    const reasons = [...extra, ...new Set(ev.reasons)];
    if (unit.splitFrom && !unit.userSplit) reasons.unshift('Family split: no single free room fits everyone');
    if (unit.members.some((m) => m.alsoIds?.length)) reasons.push('Listed twice on this tour: both records get this room');
    place(unit, room, { building: room.building, roomNumber: room.roomNumber, reasons, warnings: ev.warnings });
    roomOfUnit.set(unit.key, room);
    placedUnits.set(unit.key, unit);
  };
  const unplace = (unit: PlanUnit) => {
    const room = roomOfUnit.get(unit.key)!;
    ctx.occupancy.removeUnit(roomKey(room.building, room.roomNumber), unit.key);
    roomOfUnit.delete(unit.key);
    placedUnits.delete(unit.key);
    delete assignments[unit.key];
  };

  /**
   * Fill the gaps: when nothing is free for a family, move up to two families the planner placed
   * earlier to other free rooms, if that frees a room that fits. Saved allocations and the user's
   * choices never move. Limited in time so a full week can't stall the screen.
   */
  const deadline = Date.now() + 1000;
  const relocate = (unit: PlanUnit): boolean => {
    if (!unit.pax) return false;
    const candidates = sorted
      .filter((r) => r.status !== 'blocked' && (options.allowBuffer ? maxBeds(r) : baseBeds(r)) >= unit.pax)
      .filter((r) => !unit.starred || r.building === STARRED_BUILDING)
      .filter((r) => !options.buildings.length || options.buildings.includes(r.building))
      .sort((a, b) => maxBeds(a) - maxBeds(b));
    for (const room of candidates) {
      if (Date.now() > deadline) return false;
      const key = roomKey(room.building, room.roomNumber);
      const overlapping = ctx.occupancy.stays(key).filter((s) => overlaps(unit.arrivalDate, unit.departureDate, s.arrival, s.departure));
      if (!overlapping.length || overlapping.length > 2) continue;
      const blockers = overlapping.map((s) => (s.unitKey ? placedUnits.get(s.unitKey) : undefined));
      if (blockers.some((b) => !b || userChosen.has(b.key) || b.followRoom)) continue;
      const moving = blockers as PlanUnit[];
      const before = moving.map((b) => ({ unit: b, room: roomOfUnit.get(b.key)!, a: assignments[b.key]! }));
      moving.forEach(unplace);
      const fit = evaluate(unit, room, ctx);
      if (fit.ok) {
        placeBest(unit, room, fit);
        const moved: PlanUnit[] = [];
        let ok = true;
        for (const b of moving) {
          const { best } = bestRoom(b, key);
          if (!best) { ok = false; break; }
          placeBest(b, best.room, best.ev, ['Moved to make room for another family']);
          moved.push(b);
        }
        if (ok) return true;
        moved.forEach(unplace);
        unplace(unit);
      }
      for (const { unit: b, room: r, a } of before) {
        place(b, r, a);
        roomOfUnit.set(b.key, r);
        placedUnits.set(b.key, b);
      }
    }
    return false;
  };

  /**
   * Tries an even split and a split sized to each room size, places both parts as a test, and keeps the
   * split whose rooms leave the fewest empty beds (a part that finds no room counts heavily against it).
   */
  const bestSplit = (unit: PlanUnit): PlanUnit[] => {
    const beds = unit.members.filter((m) => !m.infant).length;
    const sizes = new Set<number>([Math.ceil(beds / 2)]);
    for (const r of sorted) {
      if (r.status === 'blocked') continue;
      for (const s of [baseBeds(r), options.allowBuffer ? maxBeds(r) : 0]) if (s >= 1 && s < beds) sizes.add(s);
    }
    let best: { parts: PlanUnit[]; cost: number } | null = null;
    for (const size of sizes) {
      const parts = splitUnit(unit, 2, size);
      if (parts.length < 2) continue;
      const trial: { room: string; key: string }[] = [];
      let cost = 0;
      for (const part of parts) {
        const found = bestRoom(part).best;
        if (!found) { cost += 1000 * Math.max(1, part.pax); continue; }
        cost += found.ev.score;
        const room = roomKey(found.room.building, found.room.roomNumber);
        ctx.occupancy.addUnit(room, part);
        trial.push({ room, key: part.key });
      }
      trial.forEach((t) => ctx.occupancy.removeUnit(t.room, t.key));
      if (!best || cost < best.cost) best = { parts, cost };
    }
    return best?.parts || splitUnit(unit);
  };

  const planUnit = (unit: PlanUnit, depth = 0): void => {
    const { best, lastReject } = bestRoom(unit);
    const largestRoom = Math.max(0, ...sorted.filter((r) => r.status !== 'blocked').map((r) => (options.allowBuffer ? maxBeds(r) : baseBeds(r))));
    if (!best && unit.pax <= largestRoom && relocate(unit)) { units.push(unit); return; }
    // Only a family that no free room can hold is split, into the two parts that leave the fewest empty beds.
    const tooBig = unit.pax > largestRoom;
    if ((!best || tooBig) && unit.members.filter((m) => !m.infant).length > 1 && depth < 4) {
      const from = units.length;
      for (const part of bestSplit(unit)) planUnit(part, depth + 1);
      const parts = units.slice(from);
      if (parts.some((p) => assignments[p.key])) return;
      // No part found a room: keep the family as one row, so it can be shifted A→B in one go.
      units.splice(from);
      for (const p of parts) { delete assignments[p.key]; delete unplaced[p.key]; }
      units.push(unit);
      assignments[unit.key] = null;
      unplaced[unit.key] = unit.pax > largestRoom ? `No free rooms for ${unit.pax} pax from ${unit.arrivalDate} to ${unit.departureDate}`
        : `No free room for ${unit.pax} pax from ${unit.arrivalDate} to ${unit.departureDate}`;
      return;
    }
    units.push(unit);
    if (!best) {
      assignments[unit.key] = null;
      unplaced[unit.key] = unit.pax > largestRoom
        ? `No room has ${unit.pax} beds`
        : unit.starred && lastReject.startsWith('Starred')
          ? `No free ${STARRED_BUILDING} room from ${unit.arrivalDate} to ${unit.departureDate}`
          : `No free room for ${unit.pax} pax from ${unit.arrivalDate} to ${unit.departureDate}`;
      return;
    }
    placeBest(unit, best.room, best.ev);
  };

  for (const unit of queue) planUnit(unit);
  // A unit can lose its room to a relocation and get a new one; assignments always holds the latest.
  for (const u of units) if (assignments[u.key] === undefined) { assignments[u.key] = null; unplaced[u.key] ||= 'No free room'; }
  for (const u of units) if (assignments[u.key]) delete unplaced[u.key];

  // Keep the screen order stable: by tour, then family.
  units.sort((a, b) => tourStart.get(lower(a.tourRefNo))?.localeCompare(tourStart.get(lower(b.tourRefNo)) || '') ||
    lower(a.tourRefNo).localeCompare(lower(b.tourRefNo)) ||
    a.family.localeCompare(b.family, undefined, { numeric: true }) || a.key.localeCompare(b.key));
  return { generatedAt: new Date().toISOString(), options, units, assignments, unplaced };
}

// ---------------------------------------------------------------------------------------------
// Editing support
// ---------------------------------------------------------------------------------------------

/**
 * Refresh after manual changes: keeps every room the user chose, every family left without a room on
 * purpose and every split the user made, then re-fits everyone else (including anyone new in the date
 * range) around them, using freed space as well as it can.
 */
export function refreshPlan(plan: AllocationPlan, input: Omit<PlanInput, 'units' | 'locked'>): AllocationPlan {
  const locked: Record<string, PlanAssignment | null> = {};
  const kept: PlanUnit[] = [];
  // A family already in a room the user put someone else into stays there too.
  const chosen = plan.units.filter((u) => plan.assignments[u.key]?.locked);
  const anchored = new Set(plan.units.filter((u) => {
    const a = plan.assignments[u.key];
    return a && !a.locked && chosen.some((c) => {
      const b = plan.assignments[c.key]!;
      return roomKey(a.building, a.roomNumber) === roomKey(b.building, b.roomNumber) &&
        overlaps(u.arrivalDate, u.departureDate, c.arrivalDate, c.departureDate);
    });
  }).map((u) => u.key));
  for (const u of plan.units) {
    const a = plan.assignments[u.key];
    if (a && anchored.has(u.key)) locked[u.key] = { ...a, reasons: ['Kept: you placed another family in this room'], locked: true };
    else if (a?.locked) locked[u.key] = a;
    else if (!a && plan.unplaced[u.key] === LEFT_EMPTY) locked[u.key] = null;
    else if (!u.userSplit) continue;
    kept.push(u);
  }
  const keptIds = new Set(kept.flatMap(memberIds));
  const fresh = collectUnits(input.reservations, input.options, input.today).flatMap((u) => {
    const members = u.members.filter((m) => !keptIds.has(m.id));
    if (!members.length) return [];
    return [members.length === u.members.length ? u : { ...u, members, pax: members.filter((m) => !m.infant).length }];
  });
  return planAllocation({ ...input, units: [...kept, ...fresh], locked });
}

export const LEFT_EMPTY = 'Left without a room';

export const memberIds = (unit: PlanUnit) => unit.members.flatMap((m) => [m.id, ...(m.alsoIds || [])]);

function contextWithout(plan: AllocationPlan, reservations: Reservation[], rooms: Room[], patterns: LearnedPatterns, exclude?: string): Context {
  const inPlan = new Set(plan.units.flatMap(memberIds));
  const existing = reservations.filter((r) => !inPlan.has(r.id));
  const occupancy = Occupancy.fromReservations(existing, rooms, familyGroups(reservations));
  const footprint = footprintFrom(existing, rooms);
  const byKey = new Map(rooms.map((r) => [roomKey(r.building, r.roomNumber), r]));
  for (const u of plan.units) {
    const a = plan.assignments[u.key];
    if (!a || u.key === exclude) continue;
    const room = byKey.get(roomKey(a.building, a.roomNumber));
    if (!room) continue;
    occupancy.addUnit(roomKey(room.building, room.roomNumber), u);
    addFootprint(footprint, lower(u.tourRefNo), room);
  }
  return { options: plan.options, patterns, occupancy, footprint };
}

/** Every room for one unit, best first, given the rest of the plan. */
export function roomOptionsFor(unit: PlanUnit, plan: AllocationPlan, reservations: Reservation[], rooms: Room[], patterns: LearnedPatterns): RoomOption[] {
  const ctx = contextWithout(plan, reservations, rooms, patterns, unit.key);
  const rank = { free: 0, share: 1, unsuitable: 2 } as const;
  return sortRooms(rooms)
    .map((room): RoomOption => {
      const auto = evaluate(unit, room, ctx);
      if (auto.ok) return { room, kind: 'free', score: auto.score, freeBeds: auto.freeBeds, note: `${auto.freeBeds} free` };
      const manual = evaluate(unit, room, ctx, 'manual');
      if (manual.ok && !manual.warnings.length) {
        const shared = manual.reasons.find((r) => r.startsWith('Shares with'))?.replace(' (your choice)', '').replace('Shares with', 'Share with');
        return { room, kind: 'share', score: manual.score, freeBeds: manual.freeBeds, note: shared ? `${shared} · ${manual.freeBeds} free` : `${manual.freeBeds} free` };
      }
      return { room, kind: 'unsuitable', score: auto.score, freeBeds: 0, note: manual.ok ? manual.warnings[0] : manual.reject || auto.reject || 'Not available' };
    })
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.score - b.score);
}

/** Recomputes every assigned unit's warnings against the whole plan, after the user changed it. */
export function revalidatePlan(plan: AllocationPlan, reservations: Reservation[], rooms: Room[], patterns: LearnedPatterns): AllocationPlan {
  const byKey = new Map(rooms.map((r) => [roomKey(r.building, r.roomNumber), r]));
  const ctx = contextWithout(plan, reservations, rooms, patterns);
  const assignments: Record<string, PlanAssignment | null> = {};
  for (const u of plan.units) {
    const a = plan.assignments[u.key];
    if (!a) { assignments[u.key] = a ?? null; continue; }
    // A follower is already in that room on its other record; nothing new to check.
    if (u.followRoom && a.building === u.followRoom.building && a.roomNumber === u.followRoom.roomNumber) { assignments[u.key] = a; continue; }
    const room = byKey.get(roomKey(a.building, a.roomNumber));
    if (!room) { assignments[u.key] = { ...a, warnings: ['Room is no longer in the inventory'] }; continue; }
    // evaluate() ignores the unit's own stay, so the shared context can be used as is.
    const ev = evaluate(u, room, ctx, 'force');
    const strict = evaluate(u, room, ctx, 'manual');
    const warnings = [...ev.warnings];
    if (!strict.ok && strict.reject && !warnings.length) warnings.push(strict.reject);
    assignments[u.key] = { ...a, warnings: [...new Set(warnings)] };
  }
  return { ...plan, assignments };
}

/**
 * Regular beds the plan leaves empty: for each room it uses, the beds its planned family does not fill.
 * Zaereen already saved in that room on those dates count as filling their beds.
 */
export function planEmptyBeds(plan: AllocationPlan, rooms: Room[], reservations: Reservation[] = []) {
  const byKey = new Map(rooms.map((r) => [roomKey(r.building, r.roomNumber), r]));
  const inPlan = new Set(plan.units.flatMap(memberIds));
  const stays = new Map<string, { start: string; end: string; pax: number }[]>();
  for (const u of plan.units) {
    const a = plan.assignments[u.key];
    if (!a || u.followRoom) continue;
    const k = roomKey(a.building, a.roomNumber);
    stays.set(k, [...(stays.get(k) || []), { start: u.arrivalDate, end: u.departureDate, pax: u.pax }]);
  }
  let empty = 0;
  for (const [k, list] of stays) {
    const room = byKey.get(k);
    if (!room) continue;
    const saved = reservations.filter((r) => !inPlan.has(r.id) && r.roomNumber && roomKey(r.building, r.roomNumber) === k);
    // Count each arrival night once: the planned family's first night in the room.
    for (const night of new Set(list.map((x) => x.start))) {
      const planned = list.filter((x) => covers(x.start, x.end, night)).reduce((sum, x) => sum + x.pax, 0);
      const already = saved.filter((r) => covers(day(r.arrivalDate), day(r.departureDate) || day(r.arrivalDate), night))
        .reduce((sum, r) => sum + getReservationEffectivePax(r), 0);
      empty += Math.max(0, baseBeds(room) - planned - already);
    }
  }
  return empty;
}

/** Totals for the summary row. */
export function planSummary(plan: AllocationPlan) {
  const assigned = plan.units.filter((u) => plan.assignments[u.key]);
  const rooms = new Set(assigned.map((u) => roomKey(plan.assignments[u.key]!.building, plan.assignments[u.key]!.roomNumber)));
  const zaereen = plan.units.reduce((s, u) => s + u.members.length, 0);
  const placed = assigned.reduce((s, u) => s + u.members.length, 0);
  const warnings = assigned.filter((u) => plan.assignments[u.key]!.warnings.length).length;
  const starred = plan.units.reduce((s, u) => s + u.members.filter((m) => m.starred).length, 0);
  const buildings: Record<string, number> = {};
  for (const u of assigned) buildings[plan.assignments[u.key]!.building] = (buildings[plan.assignments[u.key]!.building] || 0) + u.members.length;
  return { zaereen, placed, unplaced: zaereen - placed, rooms: rooms.size, warnings, starred, tours: new Set(plan.units.map((u) => lower(u.tourRefNo))).size, buildings };
}

/** Beds in use per night (saved allocations plus the plan) against total beds. */
export function nightlyLoad(plan: AllocationPlan, reservations: Reservation[], rooms: Room[], from: string, to: string) {
  const open = rooms.filter((r) => r.status !== 'blocked');
  const beds = open.reduce((s, r) => s + baseBeds(r), 0);
  const inPlan = new Set(plan.units.flatMap(memberIds));
  const known = new Set(rooms.map((r) => roomKey(r.building, r.roomNumber)));
  const out: { date: string; saved: number; planned: number; waiting: number; beds: number }[] = [];
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) {
    let saved = 0;
    for (const r of reservations) {
      if (inPlan.has(r.id) || !r.roomNumber || !known.has(roomKey(r.building, r.roomNumber))) continue;
      if (covers(day(r.arrivalDate), day(r.departureDate) || day(r.arrivalDate), d)) saved += getReservationEffectivePax(r);
    }
    let planned = 0;
    let waiting = 0;
    for (const u of plan.units) {
      if (!covers(u.arrivalDate, u.departureDate, d)) continue;
      if (plan.assignments[u.key]) planned += u.pax;
      else waiting += u.pax;
    }
    out.push({ date: d, saved, planned, waiting, beds });
  }
  return out;
}

export const DEFAULT_PLANNER_OPTIONS = (today = baghdadToday()): PlannerOptions => ({
  fromDate: today,
  toDate: addDays(today, 14),
  allowBuffer: true,
  keepTourTogether: true,
  followOfficeHabits: true,
  includeArrived: false,
  buildings: [],
});
