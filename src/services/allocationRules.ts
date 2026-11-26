/**
 * Standing room-allocation rules, plus the planner instructions staff type into the AI Planner's chat box.
 *
 * Standing rules (always on, no confirmation):
 *  - KUN HR: Badri 103, 104, 203, 204 and 205 hold the big KUN HR group (20–22 pax) and Badri 107 the small one
 *    (5 pax). No other office may be given any of these rooms.
 *  - Burhani 409, 410 and G2 stay empty by default. They are used only after someone approves it in a prompt.
 *  - Saifee keeps a few 2-pax rooms for single-gender zaereen: gents (7th floor first) and ladies (1st floor
 *    first). Zaereen of the same gender from different tours or families may share them; gents and ladies never
 *    mix. When none is free, gents go to Mohammedi and ladies to Badri.
 *  - Amatullah Aai Saheba Trust: Saifee, then Badri, then Mohammedi, then Burhani; rooms filled to the last
 *    bed including buffer; grouped by surname instead of family number (see allocationPlanner).
 *
 * The module is pure, so the planner, the manual allot screens and the tests share it.
 */
import type { Reservation, Room } from '../types';

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
const norm = (v: unknown) => lower(v).replace(/\s+/g, ' ');
export const ruleRoomKey = (building: string, roomNumber: string) => `${lower(building)}|${lower(roomNumber)}`;

// ---------------------------------------------------------------------------------------------
// Fixed rules
// ---------------------------------------------------------------------------------------------

export const KUN_HR_BUILDING = 'Badri';
/** The big KUN HR group (20–22 pax). Room 102 is not part of it. */
export const KUN_HR_GROUP_ROOMS = ['103', '104', '203', '204', '205'];
/** The small KUN HR group (5 pax). */
export const KUN_HR_SMALL_ROOMS = ['107'];
export const KUN_HR_ROOMS = [...KUN_HR_GROUP_ROOMS, ...KUN_HR_SMALL_ROOMS];
/** A KUN HR tour this size or smaller is the small group. */
export const KUN_HR_SMALL_TOUR_MAX = 10;

export const APPROVAL_BUILDING = 'Burhani';
export const APPROVAL_ROOMS = ['409', '410', 'G2'];

export const AMATULLAH_VENUES = ['Saifee', 'Badri', 'Mohammedi', 'Burhani'];

export const GENDER_BUILDING = 'Saifee';
export const GENDER_OVERFLOW = { M: 'Mohammedi', F: 'Badri' } as const;
export const GENDER_PREFERRED_FLOOR = { M: 7, F: 1 } as const;
export const DEFAULT_GENDER_ROOMS = { gents: 2, ladies: 2 };

export const isKunHr = (office?: string) => /\bkun\s*-?\s*hr\b/i.test(String(office || ''));
export const isAmatullah = (office?: string) => /amatull?ah?\s+aa?i\s+saheba?\s+trust/i.test(norm(office));

const sameBuilding = (a: string, b: string) => lower(a) === lower(b);
export const isKunHrRoom = (room: Pick<Room, 'building' | 'roomNumber'>) =>
  sameBuilding(room.building, KUN_HR_BUILDING) && KUN_HR_ROOMS.includes(String(room.roomNumber).toUpperCase());
export const isApprovalRoom = (room: Pick<Room, 'building' | 'roomNumber'>) =>
  sameBuilding(room.building, APPROVAL_BUILDING) && APPROVAL_ROOMS.includes(String(room.roomNumber).toUpperCase());

/** The KUN HR rooms this tour should use first: 107 for the small group, the group rooms for the big one. */
export function kunHrPreferredRooms(tourPax: number) {
  return tourPax <= KUN_HR_SMALL_TOUR_MAX
    ? { first: KUN_HR_SMALL_ROOMS, then: KUN_HR_GROUP_ROOMS }
    : { first: KUN_HR_GROUP_ROOMS, then: KUN_HR_SMALL_ROOMS };
}

// ---------------------------------------------------------------------------------------------
// Saved rules: the counts staff can change and the chat-box instructions
// ---------------------------------------------------------------------------------------------

export type InstructionKind =
  | 'block-rooms' | 'block-building' | 'block-floor'
  | 'approve-rooms' | 'reserve-rooms'
  | 'office-only' | 'office-prefer' | 'office-avoid';

export interface PlannerInstruction {
  id: string;
  /** What was typed. */
  text: string;
  /** What the planner understood, in plain words. */
  summary: string;
  kind: InstructionKind;
  rooms?: { building: string; roomNumber: string }[];
  building?: string;
  buildings?: string[];
  floor?: number;
  office?: string;
  createdAt: string;
}

export interface PlannerRules {
  instructions: PlannerInstruction[];
  /** Saifee 2-pax rooms kept for single-gender zaereen. */
  genderRooms: { gents: number; ladies: number };
}

export const DEFAULT_PLANNER_RULES: PlannerRules = { instructions: [], genderRooms: { ...DEFAULT_GENDER_ROOMS } };

/** Accepts whatever the settings store returns and fills in the defaults. */
export function normalizeRules(value: unknown): PlannerRules {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<PlannerRules>;
  const count = (n: unknown, d: number) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(20, Math.round(Number(n)))) : d);
  return {
    instructions: Array.isArray(v.instructions) ? v.instructions.filter((i) => i && typeof i === 'object' && typeof i.kind === 'string') : [],
    genderRooms: {
      gents: count(v.genderRooms?.gents, DEFAULT_GENDER_ROOMS.gents),
      ladies: count(v.genderRooms?.ladies, DEFAULT_GENDER_ROOMS.ladies),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Saifee single-gender rooms
// ---------------------------------------------------------------------------------------------

const baseBeds = (room: Room) => room.capacity || room.pax || 2;
const byNumber = (a: Room, b: Room) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });

/** The Saifee rooms kept for gents and ladies: 2-pax rooms nearest the preferred floor. */
export function genderRooms(rooms: Room[], rules: PlannerRules = DEFAULT_PLANNER_RULES) {
  const pool = rooms.filter((r) => sameBuilding(r.building, GENDER_BUILDING) && r.status !== 'blocked' && baseBeds(r) === 2);
  const pick = (floor: number, n: number, taken: Set<string>) =>
    pool.filter((r) => !taken.has(r.id))
      .sort((a, b) => Math.abs((a.floor ?? 0) - floor) - Math.abs((b.floor ?? 0) - floor) || byNumber(a, b))
      .slice(0, n);
  const M = pick(GENDER_PREFERRED_FLOOR.M, rules.genderRooms.gents, new Set());
  const F = pick(GENDER_PREFERRED_FLOOR.F, rules.genderRooms.ladies, new Set(M.map((r) => r.id)));
  return { M, F };
}

/** 'M' or 'F' when the room is one of the Saifee single-gender rooms. */
export function genderRoomOf(room: Room, reserved: { M: Room[]; F: Room[] }): 'M' | 'F' | null {
  const k = ruleRoomKey(room.building, room.roomNumber);
  if (reserved.M.some((r) => ruleRoomKey(r.building, r.roomNumber) === k)) return 'M';
  if (reserved.F.some((r) => ruleRoomKey(r.building, r.roomNumber) === k)) return 'F';
  return null;
}

export const genderLetter = (g?: string): 'M' | 'F' | '' => (/^f|^l/i.test(String(g || '').trim()) ? 'F' : /^m|^g/i.test(String(g || '').trim()) ? 'M' : '');

// ---------------------------------------------------------------------------------------------
// Instructions from the chat box
// ---------------------------------------------------------------------------------------------

export function instructionBlocksRoom(i: PlannerInstruction, room: Room) {
  if (i.kind === 'block-rooms') return (i.rooms || []).some((r) => ruleRoomKey(r.building, r.roomNumber) === ruleRoomKey(room.building, room.roomNumber));
  if (i.kind === 'block-building') return sameBuilding(i.building || '', room.building);
  if (i.kind === 'block-floor') return (!i.building || sameBuilding(i.building, room.building)) && Math.floor(room.floor ?? 0) === i.floor;
  return false;
}
export function instructionApprovesRoom(i: PlannerInstruction, room: Room) {
  return i.kind === 'approve-rooms' && (i.rooms || []).some((r) => ruleRoomKey(r.building, r.roomNumber) === ruleRoomKey(room.building, room.roomNumber));
}
export const officeMatches = (instructionOffice: string | undefined, office: string) =>
  !!instructionOffice && norm(instructionOffice) === norm(office);

export interface ParseContext {
  rooms: Room[];
  offices: string[];
}

export type ParseResult =
  | { ok: true; instruction: Omit<PlannerInstruction, 'id' | 'createdAt' | 'text'> }
  | { ok: true; genderRooms: { gents?: number; ladies?: number }; summary: string }
  | { ok: true; clear: true; summary: string }
  | { ok: false; reply: string };

export const INSTRUCTION_EXAMPLES = [
  "Don't allocate Saifee 101, 102 and Burhani 305",
  'Avoid rooms 301 to 305 in Saifee',
  'Do not use the 3rd floor of Burhani',
  "Don't use Badri",
  'Put Faiz E Husainy Kenya only in Saifee',
  'Prefer Burhani for Faize Husaini Kuwait',
  'Reserve Saifee 610 for Fayz E Husayni Trust Mumbai',
  'Allow Burhani 409',
  'Keep 3 rooms for gents and 1 for ladies',
];

const ORDINALS: Record<string, number> = { ground: 0, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8 };

function findBuildings(text: string, buildings: string[]) {
  const out: { name: string; at: number }[] = [];
  for (const b of buildings) {
    const re = new RegExp(`\\b${b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push({ name: b, at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The office named in the text: its full name, or every significant word of it. */
function findOffice(text: string, offices: string[]) {
  const t = norm(text);
  const full = offices.filter((o) => o && t.includes(norm(o))).sort((a, b) => b.length - a.length)[0];
  if (full) return full;
  const words = (o: string) => norm(o).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['and', 'the', 'trust', 'tours', 'travels', 'llc', 'inc'].includes(w));
  const scored = offices
    .map((o) => ({ o, w: words(o) }))
    .filter(({ w }) => w.length && w.every((x) => new RegExp(`\\b${x}\\b`).test(t)))
    .sort((a, b) => b.w.length - a.w.length);
  return scored[0]?.o;
}

/** Room numbers in the text with the building each belongs to. */
function findRooms(text: string, ctx: ParseContext): { building: string; roomNumber: string }[] {
  const buildings = [...new Set(ctx.rooms.map((r) => r.building))];
  const marks = findBuildings(text, buildings);
  const tokens: { value: string; at: number; to?: string }[] = [];
  const re = /\b([gm]?\d{1,4})(?:\s*(?:-|–|to)\s*([gm]?\d{1,4}))?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Skip floor numbers ("3rd floor", "floor 3") and counts ("3 rooms").
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 8);
    const before = text.slice(Math.max(0, m.index - 7), m.index);
    if (/^\s*(st|nd|rd|th)?\s*floor/i.test(after) || /floor\s*$/i.test(before) || /^\s*(rooms?|pax|beds?)\b/i.test(after)) continue;
    tokens.push({ value: m[1].toUpperCase(), at: m.index, to: m[2]?.toUpperCase() });
  }
  const out: { building: string; roomNumber: string }[] = [];
  for (const tok of tokens) {
    // The building named just before the number, else the next one named after it.
    const prev = [...marks].reverse().find((b) => b.at < tok.at);
    const next = marks.find((b) => b.at > tok.at);
    const building = prev?.name || next?.name;
    const numbers: string[] = [];
    if (tok.to && /^\d+$/.test(tok.value) && /^\d+$/.test(tok.to) && Number(tok.to) >= Number(tok.value) && Number(tok.to) - Number(tok.value) <= 60) {
      for (let n = Number(tok.value); n <= Number(tok.to); n++) numbers.push(String(n));
    } else numbers.push(tok.value, ...(tok.to ? [tok.to] : []));
    for (const n of numbers) {
      const matches = ctx.rooms.filter((r) => r.roomNumber.toUpperCase() === n && (!building || sameBuilding(r.building, building)));
      for (const r of matches) out.push({ building: r.building, roomNumber: r.roomNumber });
    }
  }
  const seen = new Set<string>();
  return out.filter((r) => !seen.has(ruleRoomKey(r.building, r.roomNumber)) && seen.add(ruleRoomKey(r.building, r.roomNumber)));
}

const roomList = (rooms: { building: string; roomNumber: string }[]) => {
  const by = new Map<string, string[]>();
  for (const r of rooms) by.set(r.building, [...(by.get(r.building) || []), r.roomNumber]);
  return [...by.entries()].map(([b, n]) => `${b} ${n.join(', ')}`).join('; ');
};

/** Turns a typed instruction into a rule the planner applies. */
export function parseInstruction(raw: string, ctx: ParseContext): ParseResult {
  const text = ` ${raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()} `;
  if (!raw.trim()) return { ok: false, reply: 'Type an instruction first.' };

  if (/\b(clear|remove|delete|forget)\b.*\b(all|every)\b.*\b(instructions?|rules?)\b|^\s*(clear|reset)\s*$/.test(text)) {
    return { ok: true, clear: true, summary: 'Cleared every instruction.' };
  }

  // "keep 3 rooms for gents and 1 for ladies", "gents 3", "reserve 2 ladies rooms"
  const gents = /(\d+)\s*(?:rooms?\s*)?(?:for\s*)?(?:the\s*)?(?:gents|men|males?)\b|\b(?:gents|men|males?)\s*(?:rooms?)?\s*[:=]?\s*(\d+)/.exec(text);
  const ladies = /(\d+)\s*(?:rooms?\s*)?(?:for\s*)?(?:the\s*)?(?:ladies|women|females?)\b|\b(?:ladies|women|females?)\s*(?:rooms?)?\s*[:=]?\s*(\d+)/.exec(text);
  if ((gents || ladies) && /\b(reserve|keep|hold|set|gents|ladies)\b/.test(text) && !findRooms(text, ctx).length) {
    const g = gents ? Number(gents[1] ?? gents[2]) : undefined;
    const l = ladies ? Number(ladies[1] ?? ladies[2]) : undefined;
    const parts = [g !== undefined ? `${g} for gents` : '', l !== undefined ? `${l} for ladies` : ''].filter(Boolean).join(' and ');
    return { ok: true, genderRooms: { gents: g, ladies: l }, summary: `Saifee single-gender rooms: ${parts}.` };
  }

  const buildings = [...new Set(ctx.rooms.map((r) => r.building))];
  const rooms = findRooms(text, ctx);
  const marks = findBuildings(text, buildings);
  const office = findOffice(text, ctx.offices);
  const negative = /\b(don't|dont|do not|never|avoid|no|not|stop|block|skip|exclude|without|except)\b/.test(text);
  const approve = /\b(allow|approve|approved|permit|unlock|can use|may use|ok to use|okay to use|open up)\b/.test(text);
  const reserve = /\b(reserve|keep|hold|save)\b.*\bfor\b/.test(text);
  const floorMatch = /\b(\d+)\s*(?:st|nd|rd|th)?\s*floor\b|\bfloor\s*(\d+)\b|\b(ground|first|second|third|fourth|fifth|sixth|seventh|eighth)\s*floor\b/.exec(text);
  const floor = floorMatch ? Number(floorMatch[1] ?? floorMatch[2] ?? ORDINALS[floorMatch[3]]) : undefined;
  const mentionedRoomNumbers = /\b[gm]?\d{2,4}\b/i.test(text.replace(/\b\d+\s*(?:st|nd|rd|th)?\s*floor\b|\bfloor\s*\d+\b/g, ''));

  if (mentionedRoomNumbers && !rooms.length && floor === undefined) {
    return { ok: false, reply: "I couldn't find those room numbers in the room inventory. Name the building and room, e.g. \"Don't allocate Saifee 101\"." };
  }

  if (approve && !negative && rooms.length) {
    return { ok: true, instruction: { kind: 'approve-rooms', rooms, summary: `Approved for use: ${roomList(rooms)}.` } };
  }

  if (reserve && rooms.length && office) {
    return { ok: true, instruction: { kind: 'reserve-rooms', rooms, office, summary: `${roomList(rooms)} only for ${office}.` } };
  }

  if (negative && rooms.length) {
    return { ok: true, instruction: { kind: 'block-rooms', rooms, summary: `Never allocate ${roomList(rooms)}.` } };
  }

  if (negative && floor !== undefined) {
    const building = marks[0]?.name;
    const label = floor === 0 ? 'the ground floor' : `floor ${floor}`;
    return { ok: true, instruction: { kind: 'block-floor', floor, building, summary: `Never allocate ${label}${building ? ` of ${building}` : ' in any building'}.` } };
  }

  if (office && marks.length) {
    const names = [...new Set(marks.map((m) => m.name))];
    if (negative) return { ok: true, instruction: { kind: 'office-avoid', office, buildings: names, summary: `${office}: never ${names.join(' or ')}.` } };
    if (/\b(only|just|always|must)\b/.test(text)) return { ok: true, instruction: { kind: 'office-only', office, buildings: names, summary: `${office}: only ${names.join(' or ')}.` } };
    return { ok: true, instruction: { kind: 'office-prefer', office, buildings: names, summary: `${office}: ${names.join(' or ')} first.` } };
  }

  if (negative && marks.length === 1) {
    return { ok: true, instruction: { kind: 'block-building', building: marks[0].name, summary: `Never allocate rooms in ${marks[0].name}.` } };
  }

  return {
    ok: false,
    reply: `I didn't understand that one. I can follow instructions like: ${INSTRUCTION_EXAMPLES.slice(0, 5).map((e) => `"${e}"`).join(', ')}.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Manual allotment (outside the planner)
// ---------------------------------------------------------------------------------------------

export interface ManualRoomCheck {
  /** The allotment is not allowed. */
  block?: string;
  /** The allotment needs a yes in a prompt first. */
  approval?: { title: string; message: string };
}

/**
 * Checks a manual allotment of `members` to `room` against the standing rules and instructions.
 * `reservations` is everyone, used to see who else is in the room on those dates.
 */
export function checkManualRoomRules(room: Room | undefined, members: Reservation[], reservations: Reservation[], rooms: Room[], rules: PlannerRules = DEFAULT_PLANNER_RULES): ManualRoomCheck {
  if (!room || !members.length) return {};
  const offices = [...new Set(members.map((m) => m.officeName || ''))];
  const label = `${room.building} ${room.roomNumber}`;

  if (isKunHrRoom(room) && offices.some((o) => !isKunHr(o))) {
    return { block: `${label} is reserved for KUN HR. It can't be given to ${offices.filter((o) => !isKunHr(o)).join(', ') || 'another office'}.` };
  }

  const reserved = rules.instructions.find((i) => i.kind === 'reserve-rooms' && (i.rooms || []).some((r) => ruleRoomKey(r.building, r.roomNumber) === ruleRoomKey(room.building, room.roomNumber)));
  if (reserved && offices.some((o) => !officeMatches(reserved.office, o))) {
    return { block: `${label} is reserved for ${reserved.office} (planner instruction: "${reserved.text}").` };
  }

  const g = genderRoomOf(room, genderRooms(rooms, rules));
  if (g) {
    const ids = new Set(members.map((m) => m.id));
    const ignoreInfant = (r: Reservation) => !(parseFloat(String(r.age)) < 3);
    const arr = (r: Reservation) => String(r.arrivalDate || '').slice(0, 10);
    const dep = (r: Reservation) => String(r.departureDate || '').slice(0, 10) || arr(r);
    const others = reservations.filter((r) => !ids.has(r.id) && ruleRoomKey(r.building, r.roomNumber) === ruleRoomKey(room.building, room.roomNumber) &&
      members.some((m) => arr(r) < dep(m) && arr(m) < dep(r)));
    const people = [...members, ...others].filter(ignoreInfant);
    const wrong = people.filter((p) => genderLetter(p.gender) !== g);
    if (wrong.length) {
      return { block: `${label} is kept for ${g === 'M' ? 'gents' : 'ladies'} only. Gents and ladies never share it (${wrong.map((w) => w.applicantName).slice(0, 3).join(', ')}).` };
    }
  }

  if (isApprovalRoom(room) && !rules.instructions.some((i) => instructionApprovesRoom(i, room))) {
    return { approval: { title: `Approval needed: ${label}`, message: `${label} is kept unallocated by default and is used only when required. Approve allocating it to ${members.length === 1 ? members[0].applicantName : `${members.length} zaereen`}?` } };
  }

  const blocking = rules.instructions.find((i) => instructionBlocksRoom(i, room));
  if (blocking) {
    return { approval: { title: `Planner instruction: ${label}`, message: `Your planner instruction says "${blocking.text}". Allocate ${label} anyway?` } };
  }
  const avoid = rules.instructions.find((i) => (i.kind === 'office-avoid' || i.kind === 'office-only') && offices.some((o) => officeMatches(i.office, o)) &&
    (i.kind === 'office-avoid' ? (i.buildings || []).some((b) => sameBuilding(b, room.building)) : !(i.buildings || []).some((b) => sameBuilding(b, room.building))));
  if (avoid) {
    return { approval: { title: `Planner instruction: ${label}`, message: `Your planner instruction says "${avoid.text}". Allocate ${label} anyway?` } };
  }
  return {};
}

// ---------------------------------------------------------------------------------------------
// Surnames (Amatullah Aai Saheba Trust)
// ---------------------------------------------------------------------------------------------

const HONORIFICS = new Set(['bhai', 'bhaisaheb', 'bai', 'ben', 'behen', 'bahen', 'saheb', 'saheba', 'sahib', 'mulla', 'shaikh', 'sheikh', 'mr', 'mrs', 'ms']);

/** The family name: the last word of the name that isn't an honorific. */
export function surnameOf(name: string) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i].toLowerCase().replace(/[^a-z]/g, '');
    if (w && !HONORIFICS.has(w)) return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return words[words.length - 1] || '';
}
