/**
 * AI allocation planner rules, on small hand-made inventories.
 *   npm run test:planner
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Reservation, Room } from '../../types';
import {
  type AllocationPlan, type PlannerOptions, collectUnits, DEFAULT_PLANNER_OPTIONS, memberIds, planAllocation, refreshPlan, revalidatePlan,
  learnPatterns, roomOptionsFor, stayTime,
} from '../allocationPlanner';

const TODAY = '2026-11-21';
const T1 = 'NKERP/TOUR/2026/1001';
const T2 = 'NKERP/TOUR/2026/1002';
const opts = (o: Partial<PlannerOptions> = {}): PlannerOptions => ({ ...DEFAULT_PLANNER_OPTIONS(TODAY), toDate: '2026-12-31', followOfficeHabits: false, ...o });

let n = 0;
function room(building: string, roomNumber: string, capacity: number, o: Partial<Room> = {}): Room {
  return { id: `rm-${building}-${roomNumber}`, building, roomNumber, floor: 1, capacity, pax: capacity, buffer: 0,
    category: 'Category B (Standard)', status: 'available', amenities: [], ...o };
}
function guest(o: Partial<Reservation> = {}): Reservation {
  n++;
  return {
    id: `r${n}`, itsId: String(10000 + n), applicantName: `Guest ${n} Testwala`, age: 40, category: 'Mumineen', gender: 'Male',
    family: 'F-1', idara: '', tourRefNo: T1, officeName: 'Office', groupLeadName: 'Lead', arrivalDate: '2026-11-22',
    departureDate: '2026-11-25', building: '', roomNumber: '', moneyGiven: 'No', isUploadedToPortal: false,
    createdAt: '', updatedAt: '', ...o,
  };
}
const roomOf = (plan: ReturnType<typeof planAllocation>, id: string) => {
  const unit = plan.units.find((u) => memberIds(u).includes(id));
  const a = unit && plan.assignments[unit.key];
  return a ? `${a.building} ${a.roomNumber}` : null;
};

describe('AI allocation planner', () => {
  it('keeps a family together in the room that fits it best', () => {
    const fam = [guest({ gender: 'Male' }), guest({ gender: 'Female' }), guest({ gender: 'Female', age: 15 }), guest({ gender: 'Male', age: 12 })];
    const rooms = [room('Saifee', '101', 2), room('Saifee', '102', 3), room('Burhani', '201', 4)];
    const plan = planAllocation({ reservations: fam, rooms, options: opts(), today: TODAY });
    assert.deepEqual(new Set(fam.map((r) => roomOf(plan, r.id))), new Set(['Burhani 201']));
    assert.match(plan.assignments[plan.units[0].key]!.reasons.join(' '), /Exact fit/);
  });

  it('does not give infants under 3 a bed', () => {
    const fam = [guest(), guest({ gender: 'Female' }), guest({ age: 1 })];
    const plan = planAllocation({ reservations: fam, rooms: [room('Saifee', '101', 2), room('Saifee', '102', 3)], options: opts(), today: TODAY });
    assert.equal(roomOf(plan, fam[2].id), 'Saifee 101');
  });

  it('never puts two families in one room by itself, but offers it as a manual choice', () => {
    const a = guest({ family: 'F-1' });
    const b = guest({ family: 'F-2', applicantName: 'Same Surname Testwala' });
    const rooms = [room('Saifee', '101', 2)];
    const plan = planAllocation({ reservations: [a, b], rooms, options: opts(), today: TODAY });
    assert.equal([a, b].filter((r) => roomOf(plan, r.id)).length, 1);
    const waiting = plan.units.find((u) => !plan.assignments[u.key])!;
    const [option] = roomOptionsFor(waiting, plan, [a, b], rooms, learnPatterns([a, b], rooms));
    assert.equal(option.kind, 'share');
    assert.match(option.note, /Share with F-/i);
  });

  it('puts starred zaereen in Burhani first, and nowhere else', () => {
    const star = guest({ family: 'F-9', isSpecialGuest: true, specialRemarks: 'VIP Mumineen' });
    const plain = guest({ family: 'F-1', tourRefNo: T2 });
    const rooms = [room('Burhani', '201', 1), room('Saifee', '101', 1)];
    // The plain zair arrives first but the starred one still gets Burhani.
    const plan = planAllocation({ reservations: [plain, star], rooms, options: opts(), today: TODAY });
    assert.equal(roomOf(plan, star.id), 'Burhani 201');
    assert.match(plan.assignments[plan.units.find((u) => u.starred)!.key]!.reasons.join(' '), /VIP Mumineen/);
    const full = planAllocation({ reservations: [star], rooms: [room('Saifee', '101', 1)], options: opts(), today: TODAY });
    assert.match(Object.values(full.unplaced)[0], /No free Burhani room/);
  });

  it('never puts two tours together or overbooks a room already in use', () => {
    const staying = guest({ tourRefNo: T2, building: 'Saifee', roomNumber: '101', arrivalDate: '2026-11-21', departureDate: '2026-11-24' });
    const newcomer = guest();
    const plan = planAllocation({ reservations: [staying, newcomer], rooms: [room('Saifee', '101', 2)], options: opts(), today: TODAY });
    assert.equal(roomOf(plan, newcomer.id), null);
    assert.match(Object.values(plan.unplaced)[0], /No free room/);
    const later = guest({ arrivalDate: '2026-11-24', departureDate: '2026-11-26' });
    const turnover = planAllocation({ reservations: [staying, later], rooms: [room('Saifee', '101', 2)], options: opts(), today: TODAY });
    assert.equal(roomOf(turnover, later.id), 'Saifee 101');
  });

  it('splits a family that no room can hold, men apart from women and children', () => {
    const fam = [guest(), guest({ age: 60 }), guest({ gender: 'Female' }), guest({ gender: 'Female', age: 8 }), guest({ gender: 'Male', age: 9 })];
    const rooms = [room('Saifee', '101', 2), room('Saifee', '102', 3)];
    const plan = planAllocation({ reservations: fam, rooms, options: opts(), today: TODAY });
    assert.equal(roomOf(plan, fam[0].id), roomOf(plan, fam[1].id));
    assert.equal(roomOf(plan, fam[2].id), roomOf(plan, fam[3].id));
    assert.equal(roomOf(plan, fam[3].id), roomOf(plan, fam[4].id));
    assert.notEqual(roomOf(plan, fam[0].id), roomOf(plan, fam[2].id));
  });

  it('uses buffer beds only when allowed', () => {
    const fam = [guest(), guest({ gender: 'Female' }), guest({ age: 10 })];
    const rooms = [room('Burhani', '201', 2, { buffer: 1 })];
    assert.equal(roomOf(planAllocation({ reservations: fam, rooms, options: opts(), today: TODAY }), fam[2].id), 'Burhani 201');
    const strict = planAllocation({ reservations: fam, rooms, options: opts({ allowBuffer: false }), today: TODAY });
    assert.equal(fam.filter((r) => roomOf(strict, r.id)).length, 2);
  });

  it('leaves out zaereen shifted A→B and plans zaereen shifted B→A like everyone else', () => {
    const out = guest({ shiftDirection: 'A_TO_B', refundSlipNo: 'REF-1' });
    const inn = guest({ family: 'F-2', shiftToCategoryA: true, accommodationCategory: 'Category A (Nizaam)' });
    const plan = planAllocation({ reservations: [out, inn], rooms: [room('Burhani', '201', 1)], options: opts(), today: TODAY });
    assert.deepEqual(plan.units.flatMap(memberIds), [inn.id]);
    assert.equal(roomOf(plan, inn.id), 'Burhani 201');
  });

  it('moves an earlier family to another room when that lets a bigger family fit', () => {
    // F-1 (2 pax, preset Burhani) would take the only 4-bed room; F-2 (4 pax) then fits only if F-1 moves.
    const small = [guest({ family: 'F-1', building: 'Burhani' }), guest({ family: 'F-1', gender: 'Female', building: 'Burhani' })];
    const big = [0, 1, 2, 3].map((i) => guest({ family: 'F-2', gender: i % 2 ? 'Female' : 'Male', arrivalDate: '2026-11-23' }));
    const rooms = [room('Burhani', '201', 4), room('Saifee', '101', 2)];
    const plan = planAllocation({ reservations: [...small, ...big], rooms, options: opts(), today: TODAY });
    assert.equal(Object.keys(plan.unplaced).length, 0);
    assert.equal(roomOf(plan, big[0].id), 'Burhani 201');
    assert.equal(roomOf(plan, small[0].id), 'Saifee 101');
  });

  it('refresh keeps manual changes and fills the space they free', () => {
    // Two single women on one tour, two rooms; a third family has no room until the user puts the singles together.
    const s1 = guest({ family: 'F-1', gender: 'Female' });
    const s2 = guest({ family: 'F-2', gender: 'Female' });
    const third = guest({ family: 'F-3' });
    const rooms = [room('Saifee', '101', 2), room('Saifee', '102', 2)];
    const all = [s1, s2, third];
    const plan = planAllocation({ reservations: all, rooms, options: opts(), today: TODAY });
    assert.equal(Object.keys(plan.unplaced).length, 1);
    const u1 = plan.units.find((u) => memberIds(u).includes(s1.id))!;
    const u2 = plan.units.find((u) => memberIds(u).includes(s2.id))!;
    const target = plan.assignments[u1.key]!;
    const edited: AllocationPlan = { ...plan, assignments: { ...plan.assignments, [u2.key]: { ...target, reasons: ['Chosen by you'], locked: true } } };
    const refreshed = refreshPlan(edited, { reservations: all, rooms, options: opts(), today: TODAY });
    assert.equal(roomOf(refreshed, s2.id), roomOf(refreshed, s1.id));
    assert.ok(roomOf(refreshed, third.id));
    assert.notEqual(roomOf(refreshed, third.id), roomOf(refreshed, s1.id));
    assert.equal(Object.keys(refreshed.unplaced).length, 0);
  });

  it('plans a zair listed twice on a tour once, and follows a room their other record already has', () => {
    const old = guest({ itsId: '777', arrivalDate: '2026-11-22', building: 'Saifee' });
    const current = guest({ id: 'nkerp-777', itsId: '777', arrivalDate: '2026-11-23' });
    const units = collectUnits([old, current], opts(), TODAY);
    assert.equal(units.length, 1);
    assert.deepEqual(memberIds(units[0]).sort(), ['nkerp-777', old.id].sort());
    assert.equal(units[0].arrivalDate, '2026-11-22');

    const roomed = guest({ itsId: '888', building: 'Burhani', roomNumber: '201' });
    const twin = guest({ itsId: '888', arrivalDate: '2026-11-23' });
    const plan = planAllocation({ reservations: [roomed, twin], rooms: [room('Burhani', '201', 1)], options: opts(), today: TODAY });
    assert.equal(roomOf(plan, twin.id), 'Burhani 201');
    assert.equal(plan.units[0].pax, 0);
  });

  it('keeps rooms the user chose when planning again', () => {
    const a = guest({ family: 'F-1' });
    const b = guest({ family: 'F-2', tourRefNo: T2 });
    const rooms = [room('Saifee', '101', 1), room('Saifee', '102', 1)];
    const first = planAllocation({ reservations: [a, b], rooms, options: opts(), today: TODAY });
    const ua = first.units.find((u) => memberIds(u).includes(a.id))!;
    const other = roomOf(first, a.id) === 'Saifee 101' ? '102' : '101';
    const again = planAllocation({
      reservations: [a, b], rooms, options: opts(), today: TODAY, units: first.units,
      locked: { [ua.key]: { building: 'Saifee', roomNumber: other, reasons: [], warnings: [], locked: true } },
    });
    assert.equal(roomOf(again, a.id), `Saifee ${other}`);
    assert.notEqual(roomOf(again, b.id), `Saifee ${other}`);
  });

  it('warns when the user forces too many people into a room', () => {
    const fam = [guest(), guest({ gender: 'Female' })];
    const rooms = [room('Saifee', '101', 1), room('Saifee', '102', 2)];
    const plan = planAllocation({ reservations: fam, rooms, options: opts(), today: TODAY });
    const key = plan.units[0].key;
    const forced = { ...plan, assignments: { [key]: { building: 'Saifee', roomNumber: '101', reasons: [], warnings: [], locked: true } } };
    const checked = revalidatePlan(forced, fam, rooms, learnPatterns(fam, rooms));
    assert.match(checked.assignments[key]!.warnings.join(' '), /Over capacity/);
  });

  it('reads real travel times and ignores the 23:59 end-of-day placeholder', () => {
    assert.equal(stayTime(guest({ departureTime: '23:59' }), 'departure'), undefined);
    assert.equal(stayTime(guest({ departureTime: '23:59', departureDate: '2026-11-25',
      departureTravel: [{ kind: 'subvenue', serviceDate: '2026-11-25', location: 'KARBALA', localTime: '2026-11-25T08:00' }] }), 'departure'), '08:00');
  });

  it('only plans zaereen without a room arriving in the chosen dates', () => {
    const inRange = guest();
    const tooLate = guest({ arrivalDate: '2027-01-05', departureDate: '2027-01-08' });
    const arrived = guest({ arrivalDate: '2026-11-19', departureDate: '2026-11-23' });
    const roomed = guest({ building: 'Saifee', roomNumber: '101' });
    const ids = (o: PlannerOptions) => collectUnits([inRange, tooLate, arrived, roomed], o, TODAY).flatMap(memberIds).sort();
    assert.deepEqual(ids(opts()), [inRange.id]);
    assert.deepEqual(ids(opts({ includeArrived: true })), [inRange.id, arrived.id].sort());
  });
});
