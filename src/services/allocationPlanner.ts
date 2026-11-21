/**
 * AI allocation planner.
 *
 * Plans rooms for zaereen who do not have one yet. It works from rules learned from the
 * allocations already saved in the app (current and recent stays), and from the room inventory:
 *
 *  - a family stays together in one room when a room is big enough, and is split by gender otherwise;
 *  - the room is sized to the family (4–5 pax → 4-bed rooms, 1–3 pax → 2/3-bed rooms), using buffer beds when allowed;
 *  - people from different families share only within their own tour, and only when they are the same
 *    gender or share a surname (couples and relatives are often listed as separate families);
 *  - a tour is kept in one building and close together on the same floors;
 *  - each office's usual buildings and categories (as allocated before) are preferred;
 *  - infants under 3 do not take a bed;
 *  - same-day turnovers where the previous guests leave after the new guests arrive are avoided.
 *
 * The module is pure: it never saves anything. The planner screen lets the user change the plan
 * and then allocates it through the app's normal save path.
 */
import type { Reservation, Room } from '../types';
import { checkTurnoverTimingConflict, getReservationEffectivePax, isInfant } from '../utils/turnoverTiming';

export type CategoryLetter = 'A' | 'B';

export interface PlannerOptions {
  /** First arrival date to plan (YYYY-MM-DD). */
  fromDate: string;
  /** Last arrival date to plan (YYYY-MM-DD). */
  toDate: string;
  /** Use rooms' buffer beds when that keeps a family together. */
  allowBuffer: boolean;
  /** Keep each tour in one building where possible. */
  keepTourTogether: boolean;
  /** Prefer the buildings and categories each office was given before. */
  followOfficeHabits: boolean;
  /** Also plan stays that already arrived but still have no room. */
  includeArrived: boolean;
  /** Let different tours share a room. Off by default: this almost never happens. */
  mixTours: boolean;
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
  family: string;
  arrivalDate: string;
  departureDate: string;
  arrivalTime?: string;
  departureTime?: string;
  members: PlanMember[];
  /** Beds the unit needs (infants under 3 do not count). */
  pax: number;
  /** Set when a member was shifted B→A (needs A) or A→B (needs B). */
  requiredCategory?: CategoryLetter;
  /** A building already chosen for these zaereen without a room number. */
  presetBuilding?: string;
  starred: boolean;
  /** Set when the family had to be split across rooms. */
  splitFrom?: string;
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
  ok: boolean;
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
  sharedSameGenderPct: number;
  crossTourSharePct: number;
  starredBurhaniPct: number;
  /** family size → most used room size and building. */
  sizeHabits: { size: string; capacity: number; building: string; pct: number; samples: number }[];
  /** office → share of its guests per `building|category`. */
  officeHabits: Record<string, Record<string, number>>;
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
export const categoryLetter = (room: Room): CategoryLetter => (/category a|nizaam|executive/i.test(room.category) ? 'A' : 'B');
const bucketOf = (room: Room) => `${room.building}|${categoryLetter(room)}`;
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
/** Adults (12+ or unknown age) decide whether a room can be shared across genders. */
const isAdult = (m: { age: string }) => !(ageNum(m.age) < 12);
const genderOf = (g: string) => (/^f/i.test(g) ? 'F' : /^m/i.test(g) ? 'M' : '');

/** Surname and given names used to link couples and relatives listed as separate families. */
function nameParts(name: string) {
  const words = lower(name).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !['bhai', 'bai', 'shaikh', 'mulla', 'saheb', 'sahiba'].includes(w));
  return { surname: words.length > 1 ? words[words.length - 1] : '', given: new Set(words.slice(0, -1)) };
}
function relatedByName(a: string[], b: string[]) {
  const pa = a.map(nameParts);
  const pb = b.map(nameParts);
  return pa.some((x) => x.surname && pb.some((y) => y.surname && (x.surname === y.surname)));
}

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

function requiredCategoryOf(r: Reservation): CategoryLetter | undefined {
  if (r.shiftDirection === 'A_TO_B') return 'B';
  if (r.shiftToCategoryA || r.isUpgradedFromBToA || r.shiftDirection === 'B_TO_A' || /category a|nizaam/i.test(r.accommodationCategory || '')) return 'A';
  return undefined;
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
    const fam = `${lower(r.tourRefNo)}|${lower(r.family)}`;
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

  let buffer = 0, shared = 0, sharedSame = 0, crossTour = 0;
  for (const [id, list] of stays) {
    const room = byKey.get(id.split('|').slice(0, 2).join('|'))!;
    const pax = list.reduce((s, r) => s + getReservationEffectivePax(r), 0);
    if (pax > baseBeds(room)) buffer++;
    const fams = new Set(list.map((r) => `${lower(r.tourRefNo)}|${lower(r.family)}`));
    if (fams.size > 1) {
      shared++;
      const g = new Set(list.filter((r) => !(ageNum(r.age) < 12)).map((r) => genderOf(r.gender)));
      if (g.size <= 1) sharedSame++;
    }
    if (new Set(list.map((r) => lower(r.tourRefNo))).size > 1) crossTour++;
  }

  // Family size → room size actually used, when the whole family had one room.
  const famMembers = new Map<string, Reservation[]>();
  for (const r of allocated) {
    const fam = `${lower(r.tourRefNo)}|${lower(r.family)}`;
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
    sharedSameGenderPct: pct(sharedSame, shared),
    crossTourSharePct: pct(crossTour, stays.size),
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
  if (String(r.roomNumber || '').trim()) return false;
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
      const k = [lower(r.tourRefNo), lower(r.family), lower(roomed.building), lower(roomed.roomNumber)].join('|');
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
    const key = [lower(primary.tourRefNo), lower(primary.family) || lower(primary.itsId), start, end].join('|');
    groups.set(key, [...(groups.get(key) || []).filter((x) => x.id !== primary.id), primary]);
  }
  const units: PlanUnit[] = [];
  for (const [key, { list, room }] of followers) {
    const first = list[0];
    units.push({
      key: `follow|${key}`,
      tourRefNo: first.tourRefNo, officeName: first.officeName || '', groupLeadName: first.groupLeadName || '',
      family: first.family || `ITS ${first.itsId}`,
      arrivalDate: stayStart(first), departureDate: stayEnd(first), arrivalTime: stayTime(first, 'arrival'), departureTime: stayTime(first, 'departure'),
      members: list.map(member), pax: 0, starred: list.some((r) => r.isSpecialGuest),
      followRoom: { building: room.building, roomNumber: room.roomNumber },
    });
  }
  for (const [key, list] of groups) {
    const first = list[0];
    const required = list.map(requiredCategoryOf).find(Boolean);
    const preset = list.flatMap((r) => [r, ...(twinsOf.get(r.id) || [])]).map((r) => String(r.building || '').trim()).find(Boolean);
    units.push({
      key,
      tourRefNo: first.tourRefNo,
      officeName: first.officeName || '',
      groupLeadName: first.groupLeadName || '',
      family: first.family || `ITS ${first.itsId}`,
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
      requiredCategory: required,
      presetBuilding: preset,
      starred: list.some((r) => r.isSpecialGuest),
    });
  }
  return units;
}

/** Splits a unit in two, keeping each gender together and children with the women. */
export function splitUnit(unit: PlanUnit, parts = 2): PlanUnit[] {
  if (unit.members.length < 2) return [unit];
  const ordered = [...unit.members].sort((a, b) => {
    const ga = genderOf(a.gender) === 'M' && isAdult(a) ? 1 : 0;
    const gb = genderOf(b.gender) === 'M' && isAdult(b) ? 1 : 0;
    return ga - gb || (ageNum(b.age) || 0) - (ageNum(a.age) || 0);
  });
  const beds = ordered.filter((m) => !m.infant).length;
  const size = Math.max(1, Math.ceil(beds / parts));
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
  adultGenders: Set<string>;
  names: string[];
  unitKey?: string;
}

class Occupancy {
  private readonly byRoom = new Map<string, Stay[]>();

  static fromReservations(reservations: Reservation[], rooms: Room[]) {
    const occ = new Occupancy();
    const known = new Set(rooms.map((r) => roomKey(r.building, r.roomNumber)));
    for (const r of reservations) {
      if (!String(r.roomNumber || '').trim()) continue;
      const key = roomKey(r.building, r.roomNumber);
      if (!known.has(key)) continue;
      occ.add(key, {
        arrival: day(r.arrivalDate), departure: day(r.departureDate) || day(r.arrivalDate),
        arrivalTime: stayTime(r, 'arrival'), departureTime: stayTime(r, 'departure'),
        pax: getReservationEffectivePax(r), tour: lower(r.tourRefNo), family: lower(r.family || `ITS ${r.itsId}`),
        adultGenders: new Set(!(ageNum(r.age) < 12) ? [genderOf(r.gender)].filter(Boolean) : []),
        names: [r.applicantName],
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

  stays(key: string) {
    return this.byRoom.get(key) || [];
  }
}

function unitStay(unit: PlanUnit): Stay {
  return {
    arrival: unit.arrivalDate, departure: unit.departureDate, arrivalTime: unit.arrivalTime, departureTime: unit.departureTime,
    pax: unit.pax, tour: lower(unit.tourRefNo), family: lower(unit.family),
    adultGenders: new Set(unit.members.filter((m) => isAdult(m) && !m.infant).map((m) => genderOf(m.gender)).filter(Boolean)),
    names: unit.members.map((m) => m.name), unitKey: unit.key,
  };
}

// ---------------------------------------------------------------------------------------------
// Scoring one room for one unit
// ---------------------------------------------------------------------------------------------

/** How strongly each preference counts; lower total score wins. */
const WEIGHT = {
  emptyBed: 6,
  bufferBed: 3,
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
  reasons: string[];
  warnings: string[];
  reject?: string;
}

function evaluate(unit: PlanUnit, room: Room, ctx: Context, force = false): Evaluation {
  const key = roomKey(room.building, room.roomNumber);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const reject = (why: string): Evaluation => ({ ok: false, score: Infinity, freeBeds: 0, reasons, warnings, reject: why });

  if (room.status === 'blocked' && !force) return reject(`Room is blocked${room.blockedReason ? `: ${room.blockedReason}` : ''}`);
  if (ctx.options.buildings.length && !ctx.options.buildings.includes(room.building) && !force) return reject('Building not selected');
  const cat = categoryLetter(room);
  if (unit.requiredCategory && unit.requiredCategory !== cat && !force) return reject(`Needs Category ${unit.requiredCategory}`);

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

  // Sharing with another family.
  const otherFamilies = sharing.filter((s) => !(s.tour === lower(unit.tourRefNo) && s.family === lower(unit.family)));
  if (otherFamilies.length) {
    if (!ctx.options.mixTours && otherFamilies.some((s) => s.tour !== lower(unit.tourRefNo))) {
      if (!force) return reject('Occupied by another tour');
      warnings.push('Shares with another tour');
    }
    const genders = new Set<string>([...unit.members.filter((m) => isAdult(m) && !m.infant).map((m) => genderOf(m.gender)).filter(Boolean)]);
    for (const s of otherFamilies) s.adultGenders.forEach((g) => genders.add(g));
    const related = relatedByName(unit.members.map((m) => m.name), otherFamilies.flatMap((s) => s.names));
    if (genders.size > 1 && !related) {
      if (!force) return reject('Would mix men and women from different families');
      warnings.push('Mixes men and women from different families');
    }
    score += 2;
    reasons.push(related ? 'Shares with relatives on the same tour' : `Shares with same-gender zaereen on the tour`);
  } else if (sharing.length) {
    score -= 4;
    reasons.push('Joins the rest of the family');
  }

  // Fit: avoid empty beds, use buffer beds only when needed.
  const base = baseBeds(room);
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

  // Office habit learned from earlier allocations.
  if (ctx.options.followOfficeHabits) {
    const habits = ctx.patterns.officeHabits[unit.officeName];
    const source = habits || ctx.patterns.globalHabits;
    const best = Math.max(0.0001, ...Object.values(source));
    const share = source[bucketOf(room)] || 0;
    score += 8 * (1 - share / best);
    if (habits && share / best > 0.7) reasons.push(`${unit.officeName} usually stays in ${room.building} · ${cat} (${Math.round(share * 100)}%)`);
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

  if (unit.requiredCategory) reasons.push(`Category ${unit.requiredCategory} as shifted`);
  return { ok: true, score, freeBeds, reasons, warnings };
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
    occupancy: Occupancy.fromReservations(existing, rooms),
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
    if (choice === null) { assignments[unit.key] = null; unplaced[unit.key] = 'Left without a room'; continue; }
    const room = byKey.get(roomKey(choice.building, choice.roomNumber));
    if (!room) { assignments[unit.key] = null; unplaced[unit.key] = 'Chosen room is no longer in the inventory'; continue; }
    const ev = evaluate(unit, room, ctx, true);
    place(unit, room, { building: room.building, roomNumber: room.roomNumber, reasons: ['Chosen by you'], warnings: ev.warnings, locked: true });
  }

  // Earliest arrivals first; within a day, bigger tours first; within a tour, shifted
  // zaereen, then the biggest families, so singles fill the remaining beds.
  const tourSize = new Map<string, number>();
  for (const u of queue) tourSize.set(lower(u.tourRefNo), (tourSize.get(lower(u.tourRefNo)) || 0) + u.pax);
  const tourStart = new Map<string, string>();
  for (const u of queue) {
    const t = lower(u.tourRefNo);
    if (!tourStart.has(t) || u.arrivalDate < tourStart.get(t)!) tourStart.set(t, u.arrivalDate);
  }
  queue.sort((a, b) =>
    tourStart.get(lower(a.tourRefNo))!.localeCompare(tourStart.get(lower(b.tourRefNo))!) ||
    (tourSize.get(lower(b.tourRefNo))! - tourSize.get(lower(a.tourRefNo))!) ||
    lower(a.tourRefNo).localeCompare(lower(b.tourRefNo)) ||
    Number(Boolean(b.requiredCategory)) - Number(Boolean(a.requiredCategory)) ||
    b.pax - a.pax || a.arrivalDate.localeCompare(b.arrivalDate) || a.key.localeCompare(b.key));

  const planUnit = (unit: PlanUnit, depth = 0): void => {
    let best: { room: Room; ev: Evaluation } | null = null;
    let lastReject = '';
    for (const room of sorted) {
      const ev = evaluate(unit, room, ctx);
      if (!ev.ok) { lastReject = ev.reject || lastReject; continue; }
      if (!best || ev.score < best.ev.score) best = { room, ev };
    }
    const largestRoom = Math.max(0, ...sorted.filter((r) => r.status !== 'blocked').map((r) => (options.allowBuffer ? maxBeds(r) : baseBeds(r))));
    // A family that only fits with many empty beds (or not at all) is split in two.
    const tooBig = unit.pax > largestRoom;
    if ((!best || tooBig) && unit.members.filter((m) => !m.infant).length > 1 && depth < 4) {
      for (const part of splitUnit(unit)) planUnit(part, depth + 1);
      return;
    }
    units.push(unit);
    if (!best) {
      assignments[unit.key] = null;
      unplaced[unit.key] = unit.pax > largestRoom
        ? `No room has ${unit.pax} beds`
        : `No free room for ${unit.pax} pax from ${unit.arrivalDate} to ${unit.departureDate}${lastReject ? ` (${lastReject.toLowerCase()})` : ''}`;
      return;
    }
    const reasons = [...new Set(best.ev.reasons)];
    if (unit.splitFrom) reasons.unshift('Family split: no single free room fits everyone');
    if (unit.members.some((m) => m.alsoIds?.length)) reasons.push('Listed twice on this tour: both records get this room');
    place(unit, best.room, { building: best.room.building, roomNumber: best.room.roomNumber, reasons, warnings: best.ev.warnings });
  };

  for (const unit of queue) planUnit(unit);

  // Keep the screen order stable: by tour, then family.
  units.sort((a, b) => tourStart.get(lower(a.tourRefNo))?.localeCompare(tourStart.get(lower(b.tourRefNo)) || '') ||
    lower(a.tourRefNo).localeCompare(lower(b.tourRefNo)) ||
    a.family.localeCompare(b.family, undefined, { numeric: true }) || a.key.localeCompare(b.key));
  return { generatedAt: new Date().toISOString(), options, units, assignments, unplaced };
}

// ---------------------------------------------------------------------------------------------
// Editing support
// ---------------------------------------------------------------------------------------------

export const memberIds = (unit: PlanUnit) => unit.members.flatMap((m) => [m.id, ...(m.alsoIds || [])]);

function contextWithout(plan: AllocationPlan, reservations: Reservation[], rooms: Room[], patterns: LearnedPatterns, exclude?: string): Context {
  const inPlan = new Set(plan.units.flatMap(memberIds));
  const existing = reservations.filter((r) => !inPlan.has(r.id));
  const occupancy = Occupancy.fromReservations(existing, rooms);
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
  return sortRooms(rooms)
    .map((room) => {
      const ev = evaluate(unit, room, ctx);
      return { room, ok: ev.ok, score: ev.score, freeBeds: ev.freeBeds, note: ev.ok ? `${ev.freeBeds} free` : ev.reject || 'Not available' };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.score - b.score);
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
    const ev = evaluate(u, room, ctx, true);
    const strict = evaluate(u, room, ctx);
    const warnings = [...ev.warnings];
    if (!strict.ok && strict.reject && !warnings.length) warnings.push(strict.reject);
    assignments[u.key] = { ...a, warnings: [...new Set(warnings)] };
  }
  return { ...plan, assignments };
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
  mixTours: false,
  buildings: [],
});
