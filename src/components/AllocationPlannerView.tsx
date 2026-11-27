import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BedDouble, Brain, Check, CheckCircle2, ChevronDown, ChevronRight, Info, Loader2, Lock,
  LogOut, MessageSquare, Minus, Plus, RefreshCw, Search, Send, ShieldCheck, Sparkles, Split, Star, Trash2, Users, X,
} from 'lucide-react';
import type { Reservation, Room, UserRole } from '../types';
import {
  type AllocationPlan, type PlannerOptions, type PlanUnit, type RoomOption,
  baghdadToday, collectUnits, DEFAULT_PLANNER_OPTIONS, LEFT_EMPTY, learnPatterns, memberIds, nightlyLoad, planAllocation,
  planEmptyBeds, planSummary, refreshPlan, revalidatePlan, roomKey, roomOptionsFor, roomTier, shiftedOut, splitIntoMembers, STARRED_BUILDING,
} from '../services/allocationPlanner';
import { btn, PageHeader } from './ui';
import { RoomDraftsPanel } from './RoomDraftsPanel';
import type { DraftTour } from '../services/roomDrafts';
import { describeRoomCapacity } from '../services/storage';
import {
  APPROVAL_BUILDING, APPROVAL_ROOMS, AMATULLAH_VENUES, INSTRUCTION_EXAMPLES, KUN_HR_BUILDING, KUN_HR_GROUP_ROOMS, KUN_HR_SMALL_ROOMS,
  type PlannerInstruction, type PlannerRules, genderRooms, parseInstruction,
} from '../services/allocationRules';

export interface PlanAllocationItem {
  reservationId: string;
  /** The zair this record belongs to; a zair listed twice on a tour has two records. */
  personId: string;
  building: string;
  roomNumber: string;
}

interface Props {
  reservations: Reservation[];
  rooms: Room[];
  userRole: UserRole;
  onApplyPlan: (items: PlanAllocationItem[]) => { applied: number; skipped: number };
  /** Shift these records A→B: they move to an external hotel. */
  onShiftToB: (reservationIds: string[]) => void;
  onOpenSync: () => void;
  /** Standing rules and chat-box instructions, shared through the app settings. */
  rules: PlannerRules;
  onSaveRules: (next: PlannerRules) => Promise<boolean>;
}

interface Draft {
  plan: AllocationPlan;
  excluded: string[];
  /** Manual changes since the plan was last generated or refreshed. */
  changes?: number;
}

const OPTIONS_KEY = 'najaf-ai-planner-options-v1';
// v2: plans group households by HOF ID and group ID; older drafts grouped by family number only.
const DRAFT_KEY = 'najaf-ai-planner-draft-v2';

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function store(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Drafts are a convenience; the page works without them. */
  }
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const shortDate = (d: string) => {
  const date = new Date(d + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const tourLabel = (ref: string) => ref.replace(/^NKERP\/TOUR\//i, '');

/** Drops members who got a room elsewhere, shifted A→B or left, so an old draft never overwrites newer work. */
function freshen(plan: AllocationPlan, reservations: Reservation[]): AllocationPlan {
  const open = new Map(reservations.filter((r) => !String(r.roomNumber || '').trim() && !shiftedOut(r)).map((r) => [r.id, r]));
  const units: PlanUnit[] = [];
  for (const u of plan.units) {
    const members = u.members.filter((m) => open.has(m.id));
    if (!members.length) continue;
    units.push(members.length === u.members.length ? u : { ...u, members, pax: members.filter((m) => !m.infant).length });
  }
  const keys = new Set(units.map((u) => u.key));
  const pick = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => keys.has(k)));
  return { ...plan, units, assignments: pick(plan.assignments), unplaced: pick(plan.unplaced) };
}

export const AllocationPlannerView: React.FC<Props> = ({ reservations, rooms, userRole, onApplyPlan, onShiftToB, onOpenSync, rules, onSaveRules }) => {
  const today = baghdadToday();
  const [options, setOptions] = useState<PlannerOptions>(() => {
    const saved = load<PlannerOptions>(OPTIONS_KEY);
    const base = DEFAULT_PLANNER_OPTIONS(today);
    if (!saved) return base;
    // Keep the saved choices, but never start the range in the past.
    const { mixTours: _dropped, ...rest } = saved as PlannerOptions & { mixTours?: boolean };
    const merged = { ...base, ...rest };
    if (merged.fromDate < today) merged.fromDate = today;
    if (merged.toDate < merged.fromDate) merged.toDate = base.toDate;
    return merged;
  });
  const [draft, setDraft] = useState<Draft | null>(() => load<Draft>(DRAFT_KEY));
  const [busy, setBusy] = useState(false);
  const [showLearned, setShowLearned] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'attention' | 'starred'>('all');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ applied: number; skipped: number } | null>(null);

  useEffect(() => store(OPTIONS_KEY, options), [options]);
  useEffect(() => store(DRAFT_KEY, draft), [draft]);

  const patterns = useMemo(() => learnPatterns(reservations, rooms), [reservations, rooms]);
  const waitingUnits = useMemo(() => collectUnits(reservations, options, today), [reservations, options, today]);
  const waitingPeople = waitingUnits.reduce((s, u) => s + u.members.length, 0);
  const waitingTours = new Set(waitingUnits.map((u) => u.tourRefNo)).size;
  const buildings = useMemo(() => [...new Set(rooms.map((r) => r.building))].sort(), [rooms]);
  const roomByKey = useMemo(() => new Map(rooms.map((r) => [roomKey(r.building, r.roomNumber), r])), [rooms]);

  // The draft, minus anyone who has a room by now, with warnings checked against today's data.
  const plan = useMemo(() => {
    if (!draft) return null;
    return revalidatePlan(freshen(draft.plan, reservations), reservations, rooms, patterns);
  }, [draft, reservations, rooms, patterns]);
  const excluded = useMemo(() => new Set(draft?.excluded || []), [draft]);
  const summary = useMemo(() => (plan ? planSummary(plan) : null), [plan]);
  const emptyBeds = useMemo(() => (plan ? planEmptyBeds(plan, rooms, reservations) : 0), [plan, rooms, reservations]);
  const nightly = useMemo(() => {
    if (!plan) return [];
    const first = plan.units.reduce((m, u) => (u.arrivalDate < m ? u.arrivalDate : m), plan.options.fromDate);
    const start = first < today ? today : first;
    const end = plan.units.reduce((m, u) => (u.departureDate > m ? u.departureDate : m), plan.options.toDate);
    return nightlyLoad(plan, reservations, rooms, start, end);
  }, [plan, reservations, rooms, today]);

  const tours = useMemo(() => {
    if (!plan) return [];
    const groups = new Map<string, PlanUnit[]>();
    for (const u of plan.units) groups.set(u.tourRefNo, [...(groups.get(u.tourRefNo) || []), u]);
    const q = search.trim().toLowerCase();
    return [...groups.entries()]
      .map(([ref, units]) => {
        const people = units.reduce((s, u) => s + u.members.length, 0);
        const without = units.filter((u) => !plan.assignments[u.key]).reduce((s, u) => s + u.members.length, 0);
        const warned = units.filter((u) => plan.assignments[u.key]?.warnings.length).length;
        const starred = units.reduce((s, u) => s + u.members.filter((m) => m.starred).length, 0);
        const byBuilding: Record<string, number> = {};
        const roomSet = new Set<string>();
        for (const u of units) {
          const a = plan.assignments[u.key];
          if (!a) continue;
          byBuilding[a.building] = (byBuilding[a.building] || 0) + u.members.length;
          roomSet.add(roomKey(a.building, a.roomNumber));
        }
        const first = units[0];
        return { ref, units, people, without, warned, starred, byBuilding, rooms: roomSet.size, first };
      })
      .filter((t) => {
        if (filter === 'attention' && !t.without && !t.warned) return false;
        if (filter === 'starred' && !t.starred) return false;
        if (!q) return true;
        return [t.ref, t.first.officeName, t.first.groupLeadName].some((v) => v.toLowerCase().includes(q)) ||
          t.units.some((u) => u.members.some((m) => m.name.toLowerCase().includes(q) || m.itsId.includes(q)));
      });
  }, [plan, filter, search]);

  const included = useMemo(() => {
    if (!plan) return { units: [] as PlanUnit[], people: 0, rooms: 0, warned: 0 };
    const units = plan.units.filter((u) => plan.assignments[u.key] && !excluded.has(u.tourRefNo));
    return {
      units,
      people: units.reduce((s, u) => s + u.members.length, 0),
      rooms: new Set(units.map((u) => roomKey(plan.assignments[u.key]!.building, plan.assignments[u.key]!.roomNumber))).size,
      warned: units.filter((u) => plan.assignments[u.key]!.warnings.length).length,
    };
  }, [plan, excluded]);

  /**
   * refresh: keep every manual change and re-fit everyone else around them.
   * `with` applies rules saved a moment ago, or a reserved room just approved.
   */
  const generate = (refresh: boolean, withRules?: { rules?: PlannerRules; approve?: string }) => {
    setBusy(true);
    setResult(null);
    setConfirming(false);
    setPicking(null);
    const approved = refresh && plan ? plan.options.approvedRooms || [] : [];
    const effective: PlannerOptions = {
      ...options,
      rules: withRules?.rules || rules,
      approvedRooms: withRules?.approve ? [...new Set([...approved, withRules.approve])] : approved,
    };
    // Let the button show its spinner before the planner takes the main thread.
    window.setTimeout(() => {
      try {
        const next = refresh && plan
          ? refreshPlan({ ...plan, options: effective }, { reservations, rooms, options: effective, patterns, today })
          : planAllocation({ reservations, rooms, options: effective, patterns, today });
        setDraft({ plan: next, excluded: refresh ? draft?.excluded || [] : [], changes: 0 });
        const attention = new Set(next.units.filter((u) => !next.assignments[u.key] || next.assignments[u.key]!.warnings.length).map((u) => u.tourRefNo));
        setExpanded(attention);
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const updatePlan = (fn: (p: AllocationPlan) => AllocationPlan) => {
    if (!draft || !plan) return;
    setDraft({ ...draft, plan: fn(plan), changes: (draft.changes || 0) + 1 });
  };

  const chooseRoom = (unit: PlanUnit, room: Room | null, approval = false) => {
    if (room && approval && !window.confirm(
      `${room.building} ${room.roomNumber} is kept unallocated by default and is used only when required.\n\nApprove allocating it to ${unit.family} (${plural(unit.members.length, 'zair', 'zaereen')})?`,
    )) return;
    updatePlan((p) => {
      const unplaced = { ...p.unplaced };
      const assignments = { ...p.assignments };
      if (room) {
        delete unplaced[unit.key];
        assignments[unit.key] = { building: room.building, roomNumber: room.roomNumber, reasons: [approval ? 'Approved by you (reserved room)' : 'Chosen by you'], warnings: [], locked: true };
        if (approval) {
          const k = roomKey(room.building, room.roomNumber);
          return { ...p, assignments, unplaced, options: { ...p.options, approvedRooms: [...new Set([...(p.options.approvedRooms || []), k])] } };
        }
      } else {
        assignments[unit.key] = null;
        unplaced[unit.key] = LEFT_EMPTY;
      }
      return { ...p, assignments, unplaced };
    });
    setPicking(null);
  };

  const splitFamily = (unit: PlanUnit) => {
    updatePlan((p) => {
      const parts = splitIntoMembers(unit);
      const assignments = { ...p.assignments };
      const unplaced = { ...p.unplaced };
      const a = assignments[unit.key];
      delete assignments[unit.key];
      delete unplaced[unit.key];
      for (const part of parts) {
        assignments[part.key] = a ? { ...a, reasons: ['Split from the family by you'], locked: a.locked } : null;
        if (!a) unplaced[part.key] = p.unplaced[unit.key] || 'No room yet';
      }
      const units = p.units.flatMap((u) => (u.key === unit.key ? parts : [u]));
      return { ...p, units, assignments, unplaced };
    });
  };

  const toggleTour = (ref: string) => {
    if (!draft) return;
    const next = new Set(excluded);
    if (next.has(ref)) next.delete(ref);
    else next.add(ref);
    setDraft({ ...draft, excluded: [...next] });
  };

  const apply = () => {
    if (!plan) return;
    const items: PlanAllocationItem[] = included.units.flatMap((u) => u.members.flatMap((m) =>
      [m.id, ...(m.alsoIds || [])].map((id) => ({
        reservationId: id, personId: m.id, building: plan.assignments[u.key]!.building, roomNumber: plan.assignments[u.key]!.roomNumber,
      }))));
    const outcome = onApplyPlan(items);
    setConfirming(false);
    setResult(outcome);
  };

  const approveRoom = (building: string, roomNumber: string, people: number) => {
    if (!window.confirm(`${building} ${roomNumber} is kept unallocated by default and is used only when required.\n\nApprove using it for zaereen who have no room (up to ${plural(people, 'zair', 'zaereen')} fit)?`)) return;
    generate(true, { approve: roomKey(building, roomNumber) });
  };

  const shiftToB = (unit: PlanUnit) => {
    onShiftToB(memberIds(unit));
    // They leave the plan on the next render: zaereen shifted A→B are not planned.
  };

  const isAdmin = userRole === 'admin';
  /** Open drafted tours in the planner below to change their rooms, then allocate as usual. */
  const editDrafts = (list: DraftTour[]) => {
    const units = list.flatMap((t) => t.units);
    if (!units.length) return;
    const from = units.reduce((m, u) => (u.arrivalDate < m ? u.arrivalDate : m), units[0].arrivalDate);
    const to = units.reduce((m, u) => (u.arrivalDate > m ? u.arrivalDate : m), units[0].arrivalDate);
    setDraft({ plan: { generatedAt: new Date().toISOString(), options: { ...options, rules, fromDate: from < today ? today : from, toDate: to },
      units, assignments: Object.assign({}, ...list.map((t) => t.assignments)), unplaced: Object.assign({}, ...list.map((t) => t.unplaced)) },
      excluded: [], changes: 0 });
    setExpanded(new Set(list.map((t) => t.tourRef)));
    setResult(null);
  };
  const changes = draft?.changes || 0;
  const setOpt = <K extends keyof PlannerOptions>(key: K, value: PlannerOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const peak = nightly.length ? Math.max(...nightly.map((d) => Math.max(d.beds, d.saved + d.planned + d.waiting))) : 1;
  const overflowNights = nightly.filter((d) => d.waiting > 0 && d.saved + d.planned + d.waiting > d.beds);

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title={<span className="inline-flex items-center gap-2.5"><Sparkles className="w-6 h-6 text-gold-600" />AI Planner</span>}
        description="Plans rooms for zaereen who don't have one yet, using patterns learned from your current and past allocations. Review the plan, change anything, then allocate everything in one go."
        actions={plan && (
          <>
            <button type="button" className={changes ? btn.primary : btn.secondary} onClick={() => generate(true)} disabled={busy}
              title="Keep your changes, re-fit everyone else around them and fill the space that is free">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Refresh plan
            </button>
            <button type="button" className={btn.ghost} onClick={() => { setDraft(null); setResult(null); }} disabled={busy}>
              <Trash2 className="w-4 h-4" />Discard plan
            </button>
          </>
        )}
      />

      {/* Scope */}
      <section className="rounded-2xl bg-white border border-stone-200 shadow-2xs p-4 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
            <label className="block">
              <span className="block text-xs font-medium text-stone-500 mb-1">Arrivals from</span>
              <input type="date" value={options.fromDate} min={today} onChange={(e) => e.target.value && setOpt('fromDate', e.target.value)}
                className="h-9 w-full rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-800" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-stone-500 mb-1">to</span>
              <input type="date" value={options.toDate} min={options.fromDate} onChange={(e) => e.target.value && setOpt('toDate', e.target.value)}
                className="h-9 w-full rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-800" />
            </label>
          </div>
          <div className="flex-1 min-w-0">
            <span className="block text-xs font-medium text-stone-500 mb-1">Buildings</span>
            <div className="flex flex-wrap gap-1.5">
              {buildings.map((b) => {
                const on = !options.buildings.length || options.buildings.includes(b);
                return (
                  <button key={b} type="button" aria-pressed={on}
                    onClick={() => {
                      const current = options.buildings.length ? options.buildings : buildings;
                      const next = on ? current.filter((x) => x !== b) : [...current, b];
                      setOpt('buildings', next.length === buildings.length ? [] : next);
                    }}
                    className={`h-9 px-3 rounded-lg text-[13px] font-medium ring-1 ring-inset transition cursor-pointer ${on ? 'bg-brand-50 text-brand-800 ring-brand-100' : 'bg-white text-stone-400 ring-stone-200 line-through'}`}>
                    {b}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="button" className={`${btn.primary} h-10 px-4`} onClick={() => generate(false)} disabled={busy || !waitingUnits.length}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {plan ? 'Plan again from scratch' : 'Generate plan'}
          </button>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-stone-700">
          {([
            ['allowBuffer', 'Use buffer beds'],
            ['keepTourTogether', 'Keep each tour in one building'],
            ['followOfficeHabits', 'Follow learned habits'],
            ['includeArrived', 'Include zaereen already arrived'],
          ] as const).map(([key, label]) => (
            <label key={key} className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={options[key]} onChange={(e) => setOpt(key, e.target.checked)} className="w-4 h-4 accent-brand-700" />
              {label}
            </label>
          ))}
        </div>
        <p className="text-xs text-stone-500">
          {waitingUnits.length
            ? <>{plural(waitingPeople, 'zair', 'zaereen')} in {plural(waitingTours, 'tour')} need a room for arrivals {shortDate(options.fromDate)} – {shortDate(options.toDate)}.</>
            : <>Nobody arriving {shortDate(options.fromDate)} – {shortDate(options.toDate)} is waiting for a room.</>}
        </p>
      </section>

      <RoomDraftsPanel reservations={reservations} canApply={isAdmin} onApply={onApplyPlan} onEdit={editDrafts} />

      <RulesPanel rooms={rooms} reservations={reservations} rules={rules} isAdmin={userRole === 'admin'}
        onSave={async (next) => {
          const ok = await onSaveRules(next);
          // Apply the new rules to the plan on screen straight away.
          if (plan) generate(true, { rules: next });
          return ok;
        }} />

      {/* What it learned */}
      <section className="rounded-2xl bg-white border border-stone-200 shadow-2xs overflow-hidden">
        <button type="button" onClick={() => setShowLearned((v) => !v)} aria-expanded={showLearned}
          className="w-full flex items-center gap-2.5 px-4 py-3 text-left cursor-pointer hover:bg-stone-50">
          <Brain className="w-4 h-4 text-brand-700" />
          <span className="text-sm font-semibold text-stone-900">What the planner learned</span>
          <span className="text-xs text-stone-500">from {plural(patterns.allocatedStays, 'allocated stay')} in {plural(patterns.tours, 'tour')}</span>
          {showLearned ? <ChevronDown className="w-4 h-4 ml-auto text-stone-400" /> : <ChevronRight className="w-4 h-4 ml-auto text-stone-400" />}
        </button>
        {showLearned && (
          <div className="px-4 pb-4 grid gap-4 md:grid-cols-2 text-[13px] text-stone-700">
            <ul className="space-y-1.5">
              <Learned>Only one family (F-1, F-2 …) shares a room. Putting different families together is your call: pick a room marked "Share with" in the room list.</Learned>
              <Learned>Families stay together in one room ({patterns.familiesTogetherPct}% of families). Bigger families are split by gender, with children staying with the women.</Learned>
              <Learned>Starred zaereen always stay in {STARRED_BUILDING} and are placed first. Their remarks decide the exact room, so check them.</Learned>
              <Learned>Each tour stays in one building ({patterns.toursOneBuildingPct}% of tours) and close together on the same floors.</Learned>
              <Learned>Buffer beds are used when that keeps a family together ({patterns.bufferUsePct}% of rooms). Infants under 3 don't take a bed.</Learned>
              <Learned>Everyone in these hotels is Category A. Zaereen already shifted A→B are in external hotels and are left out. Anyone who doesn't fit is the one to shift A→B.</Learned>
              <Learned>Same-day turnovers where the last guests leave after the new guests arrive are avoided.</Learned>
            </ul>
            <div className="space-y-3">
              {patterns.sizeHabits.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-stone-500 mb-1">Room by family size</div>
                  <div className="flex flex-wrap gap-1.5">
                    {patterns.sizeHabits.map((h) => (
                      <span key={h.size} className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-xs">
                        <Users className="w-3 h-3 text-stone-500" />{h.size} → {h.capacity}-bed {h.building} <span className="text-stone-400">{h.pct}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {patterns.officeTop.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-stone-500 mb-1">Office habits</div>
                  <ul className="space-y-0.5 text-xs">
                    {patterns.officeTop.slice(0, 8).map((o) => (
                      <li key={o.office} className="flex justify-between gap-3">
                        <span className="truncate">{o.office}</span>
                        <span className="shrink-0 text-stone-500">{o.bucket.replace('|', ' · ')} rooms <span className="text-stone-400">{o.pct}%</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {result && (
        <section role="status" className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
          <div className="flex-1 text-sm text-emerald-900">
            <span className="font-semibold">Allocated {plural(result.applied, 'zair', 'zaereen')}.</span>{' '}
            {result.skipped > 0 && <>{plural(result.skipped, 'zair', 'zaereen')} already had a room and kept it. </>}
            The rooms are saved in the app. To book them on the portal, run <span className="font-medium">Sync to NKERP</span>.
          </div>
          <button type="button" className={btn.primary} onClick={onOpenSync}>Open NKERP sync<ArrowRight className="w-4 h-4" /></button>
        </section>
      )}

      {!plan && !result && (
        <section className="rounded-2xl bg-white border border-dashed border-stone-300 p-8 text-center">
          <Sparkles className="w-8 h-8 mx-auto text-gold-600" />
          <h2 className="mt-3 text-base font-semibold text-stone-900">No plan yet</h2>
          <p className="mt-1 text-sm text-stone-500 max-w-md mx-auto">
            Choose the arrival dates and press <span className="font-medium text-stone-700">Generate plan</span>. Nothing is saved until you allocate.
          </p>
        </section>
      )}

      {plan && summary && (
        <>
          {/* Summary */}
          <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <Stat label="Zaereen planned" value={`${summary.placed}/${summary.zaereen}`} />
            <Stat label="Rooms used" value={summary.rooms} />
            <Stat label="Empty beds" value={emptyBeds} />
            <Stat label="Tours" value={summary.tours} />
            <Stat label="No room: shift A→B" value={summary.unplaced} tone={summary.unplaced ? 'rose' : undefined} />
            <Stat label="Need a look" value={summary.warnings} tone={summary.warnings ? 'amber' : undefined} />
            <Stat label="Starred to review" value={summary.starred} tone={summary.starred ? 'gold' : undefined} />
          </section>

          {plan.approvalNeeded && plan.approvalNeeded.length > 0 && (
            <section className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 space-y-2">
              <p className="text-sm text-amber-950 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
                <span>
                  Some zaereen still have no room. {APPROVAL_BUILDING} {APPROVAL_ROOMS.join(', ')} are kept unallocated by default and are used only after approval.
                </span>
              </p>
              <div className="flex flex-wrap gap-2 pl-6">
                {plan.approvalNeeded.map((a) => (
                  <button key={`${a.building}-${a.roomNumber}`} type="button" className={`${btn.secondary} h-8 px-2.5 text-xs`} disabled={busy || !isAdmin}
                    onClick={() => approveRoom(a.building, a.roomNumber, a.people)}
                    title={isAdmin ? 'Asks for your approval, then re-plans with this room' : 'Only an administrator can approve reserved rooms'}>
                    <ShieldCheck className="w-3.5 h-3.5" />Approve {a.building} {a.roomNumber}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Nightly load */}
          {nightly.length > 0 && (
            <section className="rounded-2xl bg-white border border-stone-200 shadow-2xs p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
                <h2 className="text-sm font-semibold text-stone-900 flex items-center gap-2"><BedDouble className="w-4 h-4 text-stone-500" />Beds per night</h2>
                <Legend cls="bg-stone-300" label="Already allocated" />
                <Legend cls="bg-brand-600" label="This plan" />
                <Legend cls="bg-rose-400" label="Still without a room" />
                <span className="text-xs text-stone-500 ml-auto">Line: {nightly[0].beds} beds (without buffer)</span>
              </div>
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1 h-28 min-w-max relative">
                  {nightly.map((d) => {
                    const total = d.saved + d.planned + d.waiting;
                    const h = (n: number) => `${(n / peak) * 100}%`;
                    return (
                      <div key={d.date} className="w-7 h-full flex flex-col justify-end relative"
                        title={`${shortDate(d.date)}: ${d.saved} allocated + ${d.planned} planned${d.waiting ? ` + ${d.waiting} without a room` : ''} = ${total} of ${d.beds} beds`}>
                        <div className="absolute left-0 right-0 border-t border-dashed border-stone-400" style={{ bottom: h(d.beds) }} />
                        {d.waiting > 0 && <div className="bg-rose-400 rounded-t-sm" style={{ height: h(d.waiting) }} />}
                        {d.planned > 0 && <div className={`bg-brand-600 ${d.waiting ? '' : 'rounded-t-sm'}`} style={{ height: h(d.planned) }} />}
                        {d.saved > 0 && <div className={`bg-stone-300 ${d.planned || d.waiting ? '' : 'rounded-t-sm'}`} style={{ height: h(d.saved) }} />}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-1 min-w-max mt-1">
                  {nightly.map((d) => (
                    <div key={d.date} className="w-7 text-center text-[10px] leading-tight text-stone-500 tabular-nums whitespace-pre-line">{shortDate(d.date).replace(' ', '\n')}</div>
                  ))}
                </div>
              </div>
              {overflowNights.length > 0 && (
                <p className="mt-3 text-xs text-rose-700 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Not enough beds on {overflowNights.map((d) => shortDate(d.date)).join(', ')}. Up to {Math.max(...overflowNights.map((d) => d.saved + d.planned + d.waiting - d.beds))} more beds are needed. Zaereen who don't fit need to shift A→B to an external hotel.
                </p>
              )}
            </section>
          )}

          {changes > 0 && (
            <section className="rounded-2xl bg-brand-50 border border-brand-100 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Info className="w-4 h-4 text-brand-700 shrink-0" />
              <p className="flex-1 text-sm text-brand-800">
                You made {plural(changes, 'change')}. <b>Refresh plan</b> keeps them and re-fits everyone else around them, filling any space they freed.
              </p>
              <button type="button" className={btn.primary} onClick={() => generate(true)} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Refresh plan
              </button>
            </section>
          )}

          {/* Filters */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tour, office, name or ITS"
                className="h-9 w-full rounded-lg border border-stone-200 bg-white pl-9 pr-3 text-sm" />
            </div>
            <div className="flex gap-1.5">
              {([['all', 'All tours'], ['attention', 'Needs a look'], ['starred', 'Starred']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                  className={`h-9 px-3 rounded-lg text-[13px] font-medium ring-1 ring-inset cursor-pointer transition ${filter === key ? 'bg-stone-900 text-white ring-stone-900' : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'}`}>
                  {label}
                </button>
              ))}
              <button type="button" className={btn.ghost}
                onClick={() => setExpanded((e) => (e.size >= tours.length ? new Set() : new Set(tours.map((t) => t.ref))))}>
                {expanded.size >= tours.length && tours.length ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>

          {/* Tours */}
          <div className="space-y-2">
            {tours.length === 0 && <p className="text-sm text-stone-500 py-6 text-center">No tours match.</p>}
            {tours.map((t) => {
              const open = expanded.has(t.ref);
              const on = !excluded.has(t.ref);
              return (
                <section key={t.ref} className={`rounded-2xl bg-white border shadow-2xs overflow-hidden ${on ? 'border-stone-200' : 'border-stone-200 opacity-60'}`}>
                  <div className="flex items-start gap-3 px-3 sm:px-4 py-3">
                    <input type="checkbox" checked={on} onChange={() => toggleTour(t.ref)} aria-label={`Include tour ${tourLabel(t.ref)} when allocating`}
                      className="mt-1 w-4 h-4 accent-brand-700 cursor-pointer" />
                    <button type="button" onClick={() => setExpanded((e) => { const n = new Set(e); if (n.has(t.ref)) n.delete(t.ref); else n.add(t.ref); return n; })}
                      aria-expanded={open} className="flex-1 min-w-0 text-left cursor-pointer">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {open ? <ChevronDown className="w-4 h-4 text-stone-400" /> : <ChevronRight className="w-4 h-4 text-stone-400" />}
                        <span className="font-semibold text-stone-900 tabular-nums">{tourLabel(t.ref)}</span>
                        <span className="text-sm text-stone-600 truncate max-w-[16rem]">{t.first.officeName}</span>
                        {t.without > 0 && <Chip tone="rose">{t.without} without room</Chip>}
                        {t.warned > 0 && <Chip tone="amber">{plural(t.warned, 'warning')}</Chip>}
                        {t.starred > 0 && <Chip tone="gold"><Star className="w-3 h-3 fill-current" />{t.starred}</Chip>}
                        {!t.without && !t.warned && <Chip tone="emerald"><Check className="w-3 h-3" />Ready</Chip>}
                      </div>
                      <div className="mt-1 pl-6 text-xs text-stone-500 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>{t.first.groupLeadName}</span>
                        <span className="tabular-nums">{shortDate(t.first.arrivalDate)} → {shortDate(t.first.departureDate)}</span>
                        <span>{plural(t.people, 'zair', 'zaereen')} · {plural(t.rooms, 'room')}</span>
                        {Object.entries(t.byBuilding).map(([b, n]) => <span key={b} className="text-stone-600">{b} {n}</span>)}
                      </div>
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-stone-100 divide-y divide-stone-100">
                      {t.units.map((u) => (
                        <UnitRow key={u.key} unit={u} plan={plan} room={plan.assignments[u.key] ? roomByKey.get(roomKey(plan.assignments[u.key]!.building, plan.assignments[u.key]!.roomNumber)) : undefined}
                          picking={picking === u.key}
                          onPick={() => setPicking(picking === u.key ? null : u.key)}
                          options={picking === u.key ? roomOptionsFor(u, plan, reservations, rooms, patterns) : []}
                          onChoose={(room, approval) => chooseRoom(u, room, approval)}
                          onSplit={() => splitFamily(u)}
                          canShift={isAdmin}
                          onShiftToB={() => shiftToB(u)} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {/* Allocate bar */}
          <div className="fixed bottom-[60px] lg:bottom-0 left-0 lg:left-[var(--rail-w)] right-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur-md">
            <div className="mx-auto max-w-[1680px] px-3 sm:px-4 lg:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex-1 text-sm text-stone-700">
                {confirming ? (
                  <span>
                    Allocate <b>{plural(included.people, 'zair', 'zaereen')}</b> to <b>{plural(included.rooms, 'room')}</b>?
                    {included.warned > 0 && <span className="text-amber-700"> {plural(included.warned, 'family', 'families')} still {included.warned === 1 ? 'has a warning' : 'have warnings'}.</span>}
                    {' '}This saves the rooms in the app. Nothing is sent to NKERP yet.
                  </span>
                ) : (
                  <span>
                    <b>{plural(included.people, 'zair', 'zaereen')}</b> ready in {plural(tours.filter((t) => !excluded.has(t.ref)).length, 'tour')}
                    {excluded.size > 0 && <span className="text-stone-500"> · {excluded.size} unticked</span>}
                    {!isAdmin && <span className="text-stone-500"> · Only an administrator can allocate</span>}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {confirming ? (
                  <>
                    <button type="button" className={btn.secondary} onClick={() => setConfirming(false)}><X className="w-4 h-4" />Cancel</button>
                    <button type="button" className={btn.primary} onClick={apply}><Check className="w-4 h-4" />Yes, allocate</button>
                  </>
                ) : (
                  <button type="button" className={btn.primary} disabled={!isAdmin || !included.people} onClick={() => setConfirming(true)}>
                    <BedDouble className="w-4 h-4" />Allocate {plural(included.people, 'zair', 'zaereen')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const Learned: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex gap-2"><Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-600" /><span>{children}</span></li>
);

const Legend: React.FC<{ cls: string; label: string }> = ({ cls, label }) => (
  <span className="inline-flex items-center gap-1.5 text-xs text-stone-600"><span className={`w-2.5 h-2.5 rounded-sm ${cls}`} />{label}</span>
);

const TONES = {
  rose: 'bg-rose-50 text-rose-800 ring-rose-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  gold: 'bg-amber-50 text-amber-800 ring-amber-200',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
} as const;

const Chip: React.FC<{ tone: keyof typeof TONES; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: keyof typeof TONES }> = ({ label, value, tone }) => (
  <div className={`rounded-xl px-3 py-2.5 ring-1 ring-inset ${tone ? TONES[tone] : 'bg-white text-stone-900 ring-stone-200'}`}>
    <div className="text-xl font-semibold tabular-nums leading-tight">{value}</div>
    <div className="text-xs opacity-75">{label}</div>
  </div>
);

const UnitRow: React.FC<{
  unit: PlanUnit;
  plan: AllocationPlan;
  room?: Room;
  picking: boolean;
  options: RoomOption[];
  onPick: () => void;
  onChoose: (room: Room | null, approval?: boolean) => void;
  onSplit: () => void;
  canShift: boolean;
  onShiftToB: () => void;
}> = ({ unit, plan, room, picking, options, onPick, onChoose, onSplit, canShift, onShiftToB }) => {
  const a = plan.assignments[unit.key];
  const why = plan.unplaced[unit.key];
  const [confirmShift, setConfirmShift] = useState(false);
  return (
    <div className="px-3 sm:px-4 py-3 grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <span className="font-medium text-stone-700">{unit.family}</span>
          <span>{plural(unit.members.length, 'zair', 'zaereen')}{unit.pax !== unit.members.length ? ` · ${plural(unit.pax, 'bed')}` : ''}</span>
          {unit.splitFrom && <span className="inline-flex items-center gap-1 text-stone-500"><Split className="w-3 h-3" />part of family</span>}
        </div>
        {unit.familyNote && <div className="text-xs text-stone-500">{unit.familyNote}</div>}
        <ul className="mt-1 space-y-0.5">
          {unit.members.map((m) => (
            <li key={m.id} className="text-[13px] text-stone-800 flex items-start gap-1.5">
              {m.starred ? <Star className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gold-600 fill-gold-400" aria-label="Starred" /> : <span className="w-3.5 shrink-0" />}
              <span className="min-w-0">
                <span className="truncate">{m.name}</span>{' '}
                <span className="text-xs text-stone-500 tabular-nums">{m.gender?.[0] || ''}{m.age ? ` ${m.age}` : ''}{m.infant ? ' · infant' : ''}</span>
                {m.remarks && <span className="block text-xs text-amber-800">{m.remarks}</span>}
                {m.alsoIds?.length ? <span className="block text-xs text-stone-500">Listed {m.alsoIds.length + 1} times on this tour</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0">
        {a && room ? (
          <div className="flex items-start gap-2">
            <div className="rounded-lg bg-stone-50 ring-1 ring-inset ring-stone-200 px-2.5 py-1.5 min-w-0">
              <div className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
                {a.locked && <Lock className="w-3 h-3 text-stone-500" aria-label="Chosen by you" />}
                {room.building} {room.roomNumber}
              </div>
              <div className="text-xs text-stone-500">
                {room.floorLabel || `Floor ${room.floor}`} · {describeRoomCapacity(room)} · {roomTier(room)}
                {room.toiletType ? ` · ${room.toiletType.toLowerCase().includes('both') ? 'both toilets' : room.toiletType.toLowerCase()}` : ''}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-rose-700 flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{why || 'No room yet'}{why !== LEFT_EMPTY && <span className="block text-xs text-rose-600">Shift A→B to an external hotel, or free a room and refresh.</span>}</span>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={`${btn.secondary} h-8 px-2.5 text-xs`} onClick={onPick} aria-expanded={picking}>
            {picking ? 'Close' : a ? 'Change room' : 'Choose room'}
          </button>
          {unit.members.length > 1 && (
            <button type="button" className={`${btn.ghost} h-8 px-2.5 text-xs`} onClick={onSplit} title="Give each member their own row so they can be moved separately">
              <Split className="w-3.5 h-3.5" />Split
            </button>
          )}
          {!a && canShift && !unit.followRoom && (confirmShift ? (
            <>
              <button type="button" className={`${btn.primary} h-8 px-2.5 text-xs bg-rose-700 hover:bg-rose-800`} onClick={onShiftToB}>
                <LogOut className="w-3.5 h-3.5" />Shift {plural(unit.members.length, 'zair', 'zaereen')} A→B
              </button>
              <button type="button" className={`${btn.ghost} h-8 px-2.5 text-xs`} onClick={() => setConfirmShift(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className={`${btn.ghost} h-8 px-2.5 text-xs text-rose-700`} onClick={() => setConfirmShift(true)}
              title="Move them to an external hotel. They are added to the A→B refund slip list.">
              <LogOut className="w-3.5 h-3.5" />Shift A→B
            </button>
          ))}
        </div>
        {picking && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg ring-1 ring-stone-200 bg-white divide-y divide-stone-100">
            <button type="button" onClick={() => onChoose(null)} className="w-full text-left px-2.5 py-2 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer">
              Leave without a room
            </button>
            {options.map((o, i) => (
              <React.Fragment key={o.room.id}>
              {o.kind !== 'free' && (i === 0 || options[i - 1].kind !== o.kind) && (
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-stone-500 bg-stone-50">
                  {o.kind === 'share' ? 'Share with another family of this tour · your call' : 'Full or unsuitable · choosing one adds a warning'}
                </div>
              )}
              <button type="button" onClick={() => onChoose(o.room, o.needsApproval)} disabled={o.blocked}
                title={o.blocked ? `Not allowed: ${o.note}` : o.needsApproval ? 'Kept unallocated by default: choosing it asks for your approval' : undefined}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left text-xs ${o.blocked ? 'cursor-not-allowed text-stone-300 line-through decoration-stone-300' : `hover:bg-stone-50 cursor-pointer ${o.kind === 'unsuitable' ? 'text-stone-400' : 'text-stone-800'}`}`}>
                <span className="font-medium">{o.room.building} {o.room.roomNumber}
                  <span className="font-normal text-stone-500"> · {o.room.floorLabel || `Fl ${o.room.floor}`} · {describeRoomCapacity(o.room)} · {roomTier(o.room)}</span>
                </span>
                <span className={`text-right ${o.blocked ? 'text-stone-400 no-underline' : o.kind === 'free' ? 'text-emerald-700' : o.kind === 'share' ? 'text-brand-700' : 'text-amber-700'}`}>{o.note}</span>
              </button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 text-xs">
        {a && a.reasons.length > 0 && (
          <ul className="space-y-0.5 text-stone-600">
            {a.reasons.slice(0, 4).map((r) => <li key={r} className="flex gap-1.5"><Info className="w-3 h-3 mt-0.5 shrink-0 text-stone-400" />{r}</li>)}
          </ul>
        )}
        {a && a.warnings.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-amber-800">
            {a.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</li>)}
          </ul>
        )}
        {unit.starred && <p className="mt-1 text-amber-800">Starred: always {STARRED_BUILDING}. The remarks decide the exact room.</p>}
      </div>
    </div>
  );
};

const CHAT_KEY = 'najaf-ai-planner-chat-v1';
type ChatLine = { from: 'you' | 'planner'; text: string; ok?: boolean };

/** Standing allocation rules, the Saifee single-gender room counts, and the instructions chat box. */
const RulesPanel: React.FC<{
  rooms: Room[];
  reservations: Reservation[];
  rules: PlannerRules;
  isAdmin: boolean;
  onSave: (next: PlannerRules) => Promise<boolean>;
}> = ({ rooms, reservations, rules, isAdmin, onSave }) => {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [chat, setChat] = useState<ChatLine[]>(() => load<ChatLine[]>(CHAT_KEY) || []);
  useEffect(() => store(CHAT_KEY, chat.slice(-30)), [chat]);
  const reserved = useMemo(() => genderRooms(rooms, rules), [rooms, rules]);
  const offices = useMemo(() => [...new Set(reservations.map((r) => r.officeName).filter(Boolean))], [reservations]);
  const hasBuilding = (b: string) => rooms.some((r) => r.building.toLowerCase() === b.toLowerCase());
  const list = (rs: Room[]) => (rs.length ? rs.map((r) => r.roomNumber).join(', ') : 'none');

  const save = async (next: PlannerRules, reply: string) => {
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    setChat((c) => [...c, { from: 'planner', text: ok ? reply : `${reply} (Not saved to the app: it applies on this screen only.)`, ok }]);
  };

  const send = async () => {
    const said = text.trim();
    if (!said || saving) return;
    setText('');
    setChat((c) => [...c, { from: 'you', text: said }]);
    const parsed = parseInstruction(said, { rooms, offices });
    if (!parsed.ok) { setChat((c) => [...c, { from: 'planner', text: parsed.reply, ok: false }]); return; }
    if ('clear' in parsed) { await save({ ...rules, instructions: [] }, 'Done: every instruction is cleared.'); return; }
    if ('genderRooms' in parsed) {
      const next = { ...rules, genderRooms: { gents: parsed.genderRooms.gents ?? rules.genderRooms.gents, ladies: parsed.genderRooms.ladies ?? rules.genderRooms.ladies } };
      await save(next, `Understood. ${parsed.summary}`);
      return;
    }
    const instruction: PlannerInstruction = {
      ...parsed.instruction, id: `ins-${Date.now().toString(36)}`, text: said, createdAt: new Date().toISOString(),
    };
    await save({ ...rules, instructions: [...rules.instructions, instruction] }, `Understood. ${instruction.summary} The planner follows this until you remove it.`);
  };

  const remove = (id: string) => {
    const gone = rules.instructions.find((i) => i.id === id);
    void save({ ...rules, instructions: rules.instructions.filter((i) => i.id !== id) }, `Removed: "${gone?.text}".`);
  };

  const setCount = (key: 'gents' | 'ladies', delta: number) => {
    const n = Math.max(0, Math.min(20, rules.genderRooms[key] + delta));
    if (n === rules.genderRooms[key]) return;
    void save({ ...rules, genderRooms: { ...rules.genderRooms, [key]: n } }, `Saifee rooms kept for ${key}: ${n}.`);
  };

  return (
    <section className="rounded-2xl bg-white border border-stone-200 shadow-2xs overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left cursor-pointer hover:bg-stone-50">
        <ShieldCheck className="w-4 h-4 text-brand-700" />
        <span className="text-sm font-semibold text-stone-900">Allocation rules & instructions</span>
        <span className="text-xs text-stone-500">{plural(rules.instructions.length, 'instruction')} from you · applied automatically</span>
        {open ? <ChevronDown className="w-4 h-4 ml-auto text-stone-400" /> : <ChevronRight className="w-4 h-4 ml-auto text-stone-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid gap-4 lg:grid-cols-2">
          <ul className="space-y-2 text-[13px] text-stone-700">
            <Learned>
              <b>KUN HR</b>: the big group (20–22 pax) gets {KUN_HR_BUILDING} {KUN_HR_GROUP_ROOMS.join(', ')}; the small group (5 pax) gets {KUN_HR_BUILDING} {KUN_HR_SMALL_ROOMS.join(', ')}.
              No other office is ever given these rooms.
            </Learned>
            <Learned>
              <b>{APPROVAL_BUILDING} {APPROVAL_ROOMS.join(', ')}</b> stay unallocated. They are used only after you approve it in a prompt.
            </Learned>
            <li className="flex gap-2">
              <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-600" />
              <div className="space-y-1.5 min-w-0">
                <span><b>Saifee single-gender rooms</b> for single zaereen or one-gender family members. Different tours and families of the same gender may share; gents and ladies never mix.
                  When they are full, gents go to Mohammedi{hasBuilding('Mohammedi') ? '' : ' (no Mohammedi rooms in the inventory yet)'} and ladies to Badri.</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {(['gents', 'ladies'] as const).map((key) => (
                    <span key={key} className="inline-flex items-center gap-1.5 text-xs">
                      <span className="font-medium capitalize w-12">{key}</span>
                      <button type="button" className="w-6 h-6 rounded-md ring-1 ring-stone-200 flex items-center justify-center hover:bg-stone-50 disabled:opacity-40 cursor-pointer"
                        aria-label={`Fewer rooms for ${key}`} disabled={!isAdmin || saving || rules.genderRooms[key] === 0} onClick={() => setCount(key, -1)}><Minus className="w-3 h-3" /></button>
                      <span className="w-4 text-center tabular-nums font-semibold">{rules.genderRooms[key]}</span>
                      <button type="button" className="w-6 h-6 rounded-md ring-1 ring-stone-200 flex items-center justify-center hover:bg-stone-50 disabled:opacity-40 cursor-pointer"
                        aria-label={`More rooms for ${key}`} disabled={!isAdmin || saving} onClick={() => setCount(key, 1)}><Plus className="w-3 h-3" /></button>
                      <span className="text-stone-500">Saifee {list(key === 'gents' ? reserved.M : reserved.F)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </li>
            <Learned>
              <b>Amatullah Aai Saheba Trust</b>: {AMATULLAH_VENUES.join(' → ')}, each filled to the last bed (buffer included) before the next.
              Grouped by surname, not family number; different surnames share only to fill a room, gents with gents and ladies with ladies.
            </Learned>
            <Learned>Families stay together in one room; a family is split only as a last resort, keeping gents and ladies apart and within room capacity.</Learned>
          </ul>

          <div className="rounded-xl ring-1 ring-stone-200 bg-stone-50/60 flex flex-col min-w-0">
            <div className="px-3 py-2 border-b border-stone-200 flex items-center gap-2 text-xs font-medium text-stone-600">
              <MessageSquare className="w-3.5 h-3.5" />Tell the planner
              {chat.length > 0 && (
                <button type="button" className="ml-auto text-stone-400 hover:text-stone-700 cursor-pointer" onClick={() => setChat([])}>Clear chat</button>
              )}
            </div>
            {rules.instructions.length > 0 && (
              <ul className="px-3 pt-2 flex flex-wrap gap-1.5" aria-label="Active instructions">
                {rules.instructions.map((i) => (
                  <li key={i.id} className="inline-flex items-center gap-1 max-w-full rounded-md bg-white ring-1 ring-inset ring-brand-100 px-2 py-1 text-xs text-brand-900" title={`You said: "${i.text}"`}>
                    <span className="truncate">{i.summary}</span>
                    {isAdmin && (
                      <button type="button" className="shrink-0 text-stone-400 hover:text-rose-700 cursor-pointer" aria-label={`Remove instruction: ${i.summary}`} onClick={() => remove(i.id)} disabled={saving}>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="px-3 py-2 space-y-1.5 max-h-44 overflow-y-auto text-xs" aria-live="polite">
              {chat.length === 0 ? (
                <p className="text-stone-500">
                  Type an instruction, for example: {INSTRUCTION_EXAMPLES.slice(0, 4).map((e) => `"${e}"`).join(', ')}. Instructions are saved for everyone and the plan is refreshed with them.
                </p>
              ) : chat.map((line, idx) => (
                <div key={idx} className={`flex ${line.from === 'you' ? 'justify-end' : 'justify-start'}`}>
                  <span className={`max-w-[90%] rounded-lg px-2.5 py-1.5 ${line.from === 'you' ? 'bg-brand-700 text-white' : line.ok === false ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' : 'bg-white text-stone-800 ring-1 ring-stone-200'}`}>
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
            <form className="mt-auto flex gap-2 p-2 border-t border-stone-200" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <input value={text} onChange={(e) => setText(e.target.value)} disabled={!isAdmin}
                placeholder={isAdmin ? 'e.g. Don\'t allocate Saifee 101 and 102' : 'Only an administrator can give instructions'}
                aria-label="Instruction for the planner"
                className="h-9 flex-1 min-w-0 rounded-lg border border-stone-200 bg-white px-3 text-sm" />
              <button type="submit" className={`${btn.primary} h-9 px-3`} disabled={!isAdmin || !text.trim() || saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
