/**
 * Approval → rooms chain. NKERP lists a Najaf stay for room allocation once its accommodation is approved; a few
 * days before it arrives (not earlier, so the rooms can still be used better), the AI Planner drafts rooms for it.
 * A tour's draft stays as it is until something about that tour changes: NKERP moves its dates, zaereen are added
 * or removed, or another allocation takes a room it was drafted into. Then only that tour is re-planned and the
 * change (before → after rooms, and why) is recorded. Drafts are never allocated on their own: someone applies
 * them from the AI Planner, and Sync to NKERP sends them as usual.
 */
import type { Reservation, Room } from '../types';
import {
  addDays, type AllocationPlan, collectUnits, DEFAULT_PLANNER_OPTIONS, learnPatterns, memberIds, type PlanAssignment,
  planAllocation, type PlannerOptions, type PlanUnit, revalidatePlan,
} from './allocationPlanner';
import type { PlannerRules } from './allocationRules';

export interface RoomDraftSettings { enabled: boolean; daysAhead: number }
export const DEFAULT_ROOM_DRAFT_SETTINGS: RoomDraftSettings = { enabled: true, daysAhead: 3 };
export function normalizeRoomDraftSettings(input: unknown): RoomDraftSettings {
  const x = (input && typeof input === 'object' ? input : {}) as Partial<RoomDraftSettings>;
  const days = Math.round(Number(x.daysAhead));
  return { enabled: x.enabled !== false, daysAhead: Number.isFinite(days) && days >= 0 && days <= 30 ? days : DEFAULT_ROOM_DRAFT_SETTINGS.daysAhead };
}

export interface RoomLine { family: string; people: number; room: string }
export interface DraftChange { at: string; reason: string; before: RoomLine[]; after: RoomLine[] }
export interface DraftTour {
  tourRef: string;
  office: string;
  arrival: string;
  departure: string;
  people: number;
  /** What the draft was made for; a different basis means the tour changed. */
  basis: string;
  dates: string;
  memberCount: number;
  units: PlanUnit[];
  assignments: Record<string, PlanAssignment | null>;
  unplaced: Record<string, string>;
  draftedAt: string;
  updatedAt: string;
  status: 'new' | 'replanned';
  /** Room warnings when drafted: more later means another allocation took a drafted room. */
  warningsAtDraft: number;
  changes: DraftChange[];
}
export interface RoomDrafts {
  generatedAt: string | null;
  settings: RoomDraftSettings;
  window: { from: string; to: string } | null;
  tours: Record<string, DraftTour>;
  /** Tours someone set aside, with the basis they were set aside at (a change brings them back). */
  dismissed: Record<string, string>;
  log: { at: string; tourRef: string; reason: string }[];
  /** Fingerprint of the data the drafts were made from (server side, to skip unchanged refreshes). */
  signature?: string;
}
export const EMPTY_DRAFTS: RoomDrafts = { generatedAt: null, settings: DEFAULT_ROOM_DRAFT_SETTINGS, window: null, tours: {}, dismissed: {}, log: [] };

const tourKey = (ref: string) => ref.trim().toUpperCase();
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const dateSpan = (units: PlanUnit[]) => {
  const a = units.map(u => u.arrivalDate).sort()[0] ?? '';
  const d = units.map(u => u.departureDate).sort().slice(-1)[0] ?? '';
  return { arrival: a, departure: d };
};
const basisOf = (units: PlanUnit[]) => hash(JSON.stringify(units.map(u =>
  [u.key, u.arrivalDate, u.departureDate, u.arrivalTime ?? '', u.departureTime ?? '', u.pax, memberIds(u).sort()]).sort()));
function roomLines(units: PlanUnit[], assignments: Record<string, PlanAssignment | null>): RoomLine[] {
  return units.map(u => {
    const a = assignments[u.key];
    return { family: u.family, people: u.members.length, room: a ? `${a.building} ${a.roomNumber}` : 'No room yet' };
  }).sort((x, y) => x.family.localeCompare(y.family, undefined, { numeric: true }));
}
const warnings = (units: PlanUnit[], assignments: Record<string, PlanAssignment | null>) =>
  units.reduce((n, u) => n + (assignments[u.key]?.warnings.length ?? 0), 0);

function whyChanged(prev: DraftTour, units: PlanUnit[]): string {
  const span = dateSpan(units);
  const people = units.reduce((s, u) => s + u.members.length, 0);
  if (span.arrival !== prev.arrival || span.departure !== prev.departure) {
    return `NKERP moved the stay from ${prev.arrival}–${prev.departure} to ${span.arrival}–${span.departure}`;
  }
  if (people !== prev.people) return `Zaereen changed: ${prev.people} → ${people}`;
  return 'Arrival or departure times, or the families, changed in NKERP';
}

export interface DraftInput {
  reservations: Reservation[];
  rooms: Room[];
  rules?: PlannerRules;
  settings: RoomDraftSettings;
  today: string;
  now?: number;
}

/** Bring the drafts up to date: keep unchanged tours, draft new ones, re-plan only the tours that changed. */
export function updateDrafts(prev: RoomDrafts | null, input: DraftInput): RoomDrafts {
  const stamp = new Date(input.now ?? Date.now()).toISOString();
  const base = prev ?? EMPTY_DRAFTS;
  const settings = input.settings;
  if (!settings.enabled) return { ...base, settings, generatedAt: stamp, tours: {}, window: null };
  const options: PlannerOptions = { ...DEFAULT_PLANNER_OPTIONS(input.today), fromDate: input.today,
    toDate: addDays(input.today, settings.daysAhead), includeArrived: true, rules: input.rules };
  const units = collectUnits(input.reservations, options, input.today);
  const byTour = new Map<string, PlanUnit[]>();
  for (const u of units) byTour.set(tourKey(u.tourRefNo), [...(byTour.get(tourKey(u.tourRefNo)) ?? []), u]);

  const dismissed: Record<string, string> = {};
  const keep = new Map<string, DraftTour>();
  const plan = new Map<string, { reason?: string; prev?: DraftTour }>();
  const patterns = learnPatterns(input.reservations, input.rooms);
  for (const [ref, list] of byTour) {
    const basis = basisOf(list);
    if (base.dismissed[ref] === basis) { dismissed[ref] = basis; continue; }
    const old = base.tours[ref];
    if (old && old.basis === basis) keep.set(ref, old);
    else plan.set(ref, old ? { prev: old, reason: whyChanged(old, list) } : {});
  }
  // A kept draft whose room has since been taken by another allocation is re-planned too.
  if (keep.size) {
    const keptUnits = [...keep.values()].flatMap(d => byTour.get(tourKey(d.tourRef))!);
    const trial: AllocationPlan = { generatedAt: stamp, options, units: keptUnits, unplaced: {},
      assignments: Object.fromEntries(keptUnits.map(u => [u.key, keep.get(tourKey(u.tourRefNo))!.assignments[u.key] ?? null])) };
    const checked = revalidatePlan(trial, input.reservations, input.rooms, patterns);
    for (const [ref, d] of keep) {
      const list = byTour.get(ref)!;
      if (warnings(list, checked.assignments) > d.warningsAtDraft) {
        keep.delete(ref);
        plan.set(ref, { prev: d, reason: 'Another allocation took a room this tour was drafted into' });
      }
    }
  }

  const tours: Record<string, DraftTour> = {};
  const log = [...base.log];
  if (plan.size) {
    const locked: Record<string, PlanAssignment> = {};
    const keptUnits: PlanUnit[] = [];
    for (const [ref, d] of keep) for (const u of byTour.get(ref)!) {
      const a = d.assignments[u.key];
      if (a) { locked[u.key] = { ...a, locked: true }; keptUnits.push(u); }
    }
    const fresh = [...plan.keys()].flatMap(ref => byTour.get(ref)!);
    const result = planAllocation({ reservations: input.reservations, rooms: input.rooms, options, patterns,
      units: [...keptUnits, ...fresh], locked, today: input.today });
    for (const [ref, why] of plan) {
      const list = byTour.get(ref)!;
      const assignments = Object.fromEntries(list.map(u => [u.key, result.assignments[u.key] ?? null]));
      const unplaced = Object.fromEntries(list.filter(u => result.unplaced[u.key]).map(u => [u.key, result.unplaced[u.key]]));
      const span = dateSpan(list);
      const draft: DraftTour = {
        tourRef: list[0].tourRefNo, office: list[0].officeName, ...span, people: list.reduce((s, u) => s + u.members.length, 0),
        basis: basisOf(list), dates: `${span.arrival}|${span.departure}`, memberCount: list.reduce((s, u) => s + memberIds(u).length, 0),
        units: list, assignments, unplaced, draftedAt: why.prev?.draftedAt ?? stamp, updatedAt: stamp,
        status: why.prev ? 'replanned' : 'new', warningsAtDraft: warnings(list, assignments),
        changes: why.prev ? [...why.prev.changes, { at: stamp, reason: why.reason!, before: roomLines(why.prev.units, why.prev.assignments), after: roomLines(list, assignments) }].slice(-10) : [],
      };
      tours[ref] = draft;
      log.push({ at: stamp, tourRef: draft.tourRef, reason: why.prev ? `Re-planned: ${why.reason}` : `Drafted ${draft.people} zaereen` });
    }
  }
  for (const [ref, d] of keep) {
    // Units can be the same with different member details (names, remarks); keep the latest.
    tours[ref] = { ...d, units: byTour.get(ref)! };
  }
  for (const [ref, d] of Object.entries(base.tours)) {
    if (!tours[ref] && !dismissed[ref] && !byTour.has(ref)) log.push({ at: stamp, tourRef: d.tourRef, reason: 'Left the drafts (rooms allocated, or no longer arriving in the window)' });
  }
  return { generatedAt: stamp, settings, window: { from: options.fromDate, to: options.toDate }, tours, dismissed, log: log.slice(-200) };
}

/** Allocation items for the AI Planner's apply, for some draft tours. */
export function draftItems(drafts: DraftTour[]) {
  return drafts.flatMap(d => d.units.flatMap(u => {
    const a = d.assignments[u.key];
    if (!a) return [];
    return u.members.flatMap(m => [m.id, ...(m.alsoIds || [])].map(id => ({ reservationId: id, personId: m.id, building: a.building, roomNumber: a.roomNumber })));
  }));
}
