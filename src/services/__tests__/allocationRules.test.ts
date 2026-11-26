/**
 * Standing allocation rules (KUN HR, Burhani reserved rooms, Saifee single-gender rooms, Amatullah Aai Saheba Trust),
 * the planner's chat-box instructions, and one row per ITS on the Zaereen page.
 *   npm run test:planner
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Reservation, Room } from '../../types';
import {
  type PlannerOptions, collectUnits, DEFAULT_PLANNER_OPTIONS, learnPatterns, memberIds, planAllocation, roomOptionsFor,
} from '../allocationPlanner';
import {
  type PlannerInstruction, type PlannerRules, checkManualRoomRules, DEFAULT_PLANNER_RULES, genderRooms, parseInstruction, surnameOf,
} from '../allocationRules';
import { oneRowPerIts } from '../../utils/deduplication';

const TODAY = '2026-11-21';
const rules = (o: Partial<PlannerRules> = {}): PlannerRules => ({ instructions: [], genderRooms: { gents: 0, ladies: 0 }, ...o });
const opts = (o: Partial<PlannerOptions> = {}): PlannerOptions => ({
  ...DEFAULT_PLANNER_OPTIONS(TODAY), toDate: '2026-12-31', followOfficeHabits: false, keepTourTogether: false, rules: rules(), ...o,
});

let n = 0;
function room(building: string, roomNumber: string, capacity: number, o: Partial<Room> = {}): Room {
  return { id: `rm-${building}-${roomNumber}`, building, roomNumber, floor: Number(String(roomNumber).replace(/\D/g, '').slice(0, 1)) || 0,
    capacity, pax: capacity, buffer: 0, category: 'Category A (Nizaam)', status: 'available', amenities: [], ...o };
}
function guest(o: Partial<Reservation> = {}): Reservation {
  n++;
  return {
    id: `g${n}`, itsId: String(50000 + n), applicantName: `Guest ${n} Testwala`, age: 40, category: 'Mumineen', gender: 'Male',
    family: `F-${n}`, idara: '', tourRefNo: 'NKERP/TOUR/2026/1', officeName: 'Office', groupLeadName: 'Lead', arrivalDate: '2026-11-22',
    departureDate: '2026-11-25', building: '', roomNumber: '', moneyGiven: 'No', isUploadedToPortal: false, createdAt: '', updatedAt: '', ...o,
  };
}
const roomOf = (plan: ReturnType<typeof planAllocation>, id: string) => {
  const unit = plan.units.find((u) => memberIds(u).includes(id));
  const a = unit && plan.assignments[unit.key];
  return a ? `${a.building} ${a.roomNumber}` : null;
};

/** Badri as in the live inventory: the KUN HR rooms plus 105, 106 and 201. */
const BADRI = [
  room('Badri', '103', 4, { buffer: 1 }), room('Badri', '104', 4, { buffer: 1 }), room('Badri', '105', 4, { buffer: 1 }),
  room('Badri', '106', 4, { buffer: 1 }), room('Badri', '107', 3), room('Badri', '201', 6, { buffer: 3 }),
  room('Badri', '203', 4, { buffer: 1 }), room('Badri', '204', 4, { buffer: 1 }), room('Badri', '205', 4, { buffer: 1 }),
];

describe('KUN HR rooms', () => {
  it('puts the big KUN HR group in Badri 103, 104, 203, 204 and 205, five to a room', () => {
    const group = Array.from({ length: 22 }, () => guest({ officeName: 'KUN HR', tourRefNo: 'NKERP/TOUR/2026/3555', family: '' }));
    const rooms = [...BADRI, room('Saifee', '301', 4), room('Burhani', '201', 4, { buffer: 1 })];
    const plan = planAllocation({ reservations: group, rooms, options: opts(), today: TODAY });
    const used = group.map((g) => roomOf(plan, g.id));
    assert.ok(used.every((r) => ['Badri 103', 'Badri 104', 'Badri 203', 'Badri 204', 'Badri 205'].includes(r!)), used.join());
    for (const r of new Set(used)) assert.ok(used.filter((x) => x === r).length <= 5);
  });

  it('puts the small KUN HR group in Badri 107 first', () => {
    const small = Array.from({ length: 3 }, () => guest({ officeName: 'KUN HR', tourRefNo: 'NKERP/TOUR/2026/3663', gender: 'Female', family: '' }));
    const plan = planAllocation({ reservations: small, rooms: [...BADRI], options: opts(), today: TODAY });
    assert.deepEqual(new Set(small.map((g) => roomOf(plan, g.id))), new Set(['Badri 107']));
  });

  it('never gives a KUN HR room to another office, even by hand', () => {
    const family = [guest({ family: 'F-1' }), guest({ family: 'F-1', gender: 'Female' }), guest({ family: 'F-1', age: 10 })];
    const kunOnly = BADRI.filter((r) => ['103', '104', '107', '203', '204', '205'].includes(r.roomNumber));
    const plan = planAllocation({ reservations: family, rooms: kunOnly, options: opts(), today: TODAY });
    assert.ok(family.every((g) => roomOf(plan, g.id) === null));
    const options = roomOptionsFor(plan.units[0], plan, family, kunOnly, learnPatterns(family, kunOnly));
    assert.ok(options.every((o) => o.blocked && /KUN HR/.test(o.note)));
    const manual = checkManualRoomRules(kunOnly[0], [family[0]], family, kunOnly);
    assert.match(manual.block!, /reserved for KUN HR/);
    assert.deepEqual(checkManualRoomRules(kunOnly[0], [guest({ officeName: 'KUN HR' })], [], kunOnly), {});
  });
});

describe('Burhani reserved rooms', () => {
  const rooms = [room('Burhani', '409', 2, { buffer: 1 }), room('Burhani', '410', 2, { buffer: 1 }), room('Burhani', 'G2', 4, { buffer: 1 })];

  it('keeps 409, 410 and G2 free and asks for approval when someone has no room', () => {
    const couple = [guest({ family: 'F-1' }), guest({ family: 'F-1', gender: 'Female' })];
    const plan = planAllocation({ reservations: couple, rooms, options: opts(), today: TODAY });
    assert.ok(couple.every((g) => roomOf(plan, g.id) === null));
    assert.deepEqual(plan.approvalNeeded!.map((a) => a.roomNumber).sort(), ['409', '410', 'G2']);
    const approved = planAllocation({ reservations: couple, rooms, options: opts({ approvedRooms: ['burhani|409'] }), today: TODAY });
    assert.equal(roomOf(approved, couple[0].id), 'Burhani 409');
  });

  it('asks before a manual allotment', () => {
    const check = checkManualRoomRules(rooms[2], [guest()], [], rooms);
    assert.match(check.approval!.title, /Approval needed: Burhani G2/);
    assert.equal(check.block, undefined);
  });
});

describe('Saifee single-gender rooms', () => {
  const saifee = [
    room('Saifee', '101', 2, { floor: 1 }), room('Saifee', '102', 2, { floor: 1 }), room('Saifee', '103', 2, { floor: 1 }),
    room('Saifee', '701', 2, { floor: 7 }), room('Saifee', '702', 2, { floor: 7 }), room('Saifee', '703', 3, { floor: 7 }),
  ];
  const withGender = rules({ genderRooms: { gents: 1, ladies: 1 } });

  it('picks 2-pax rooms on the 7th floor for gents and the 1st floor for ladies', () => {
    const r = genderRooms(saifee, { ...DEFAULT_PLANNER_RULES });
    assert.deepEqual(r.M.map((x) => x.roomNumber), ['701', '702']);
    assert.deepEqual(r.F.map((x) => x.roomNumber), ['101', '102']);
  });

  it('lets single gents from different tours share, and keeps ladies apart from gents', () => {
    const g1 = guest({ tourRefNo: 'NKERP/TOUR/2026/11' });
    const g2 = guest({ tourRefNo: 'NKERP/TOUR/2026/12' });
    const l1 = guest({ tourRefNo: 'NKERP/TOUR/2026/13', gender: 'Female' });
    const l2 = guest({ tourRefNo: 'NKERP/TOUR/2026/14', gender: 'Female' });
    const plan = planAllocation({ reservations: [g1, g2, l1, l2], rooms: saifee, options: opts({ rules: withGender }), today: TODAY });
    assert.equal(roomOf(plan, g1.id), 'Saifee 701');
    assert.equal(roomOf(plan, g2.id), 'Saifee 701');
    assert.equal(roomOf(plan, l1.id), 'Saifee 101');
    assert.equal(roomOf(plan, l2.id), 'Saifee 101');
  });

  it('never puts a mixed family in a single-gender room', () => {
    const couple = [guest({ family: 'F-1' }), guest({ family: 'F-1', gender: 'Female' })];
    const only = [saifee[0], saifee[3]];
    // With nothing else free the family is split as a last resort, gents and ladies apart.
    const plan = planAllocation({ reservations: couple, rooms: only, options: opts({ rules: withGender }), today: TODAY });
    assert.equal(roomOf(plan, couple[0].id), 'Saifee 701');
    assert.equal(roomOf(plan, couple[1].id), 'Saifee 101');
    // Together, no single-gender room can be chosen for them, even by hand.
    const unit = collectUnits(couple, opts(), TODAY)[0];
    const options = roomOptionsFor(unit, { ...plan, units: [unit], assignments: { [unit.key]: null } }, couple, only, learnPatterns(couple, only));
    assert.ok(options.every((o) => o.blocked));
    const manual = checkManualRoomRules(saifee[3], [couple[1]], [], saifee, withGender);
    assert.match(manual.block!, /kept for gents only/);
  });

  it('sends gents to Mohammedi and ladies to Badri when the Saifee rooms are full', () => {
    const gents = [1, 2, 3].map((i) => guest({ tourRefNo: `NKERP/TOUR/2026/2${i}` }));
    const ladies = [1, 2, 3].map((i) => guest({ tourRefNo: `NKERP/TOUR/2026/3${i}`, gender: 'Female' }));
    const rooms = [saifee[0], saifee[3], room('Saifee', '301', 2, { floor: 3 }), room('Mohammedi', '107', 3), room('Badri', '105', 4, { buffer: 1 })];
    const plan = planAllocation({ reservations: [...gents, ...ladies], rooms, options: opts({ rules: withGender }), today: TODAY });
    assert.equal(roomOf(plan, gents[2].id), 'Mohammedi 107');
    assert.equal(roomOf(plan, ladies[2].id), 'Badri 105');
    assert.equal(gents.filter((g) => roomOf(plan, g.id) === 'Saifee 701').length, 2);
  });
});

describe('Amatullah Aai Saheba Trust', () => {
  const office = 'Amatullah Aai Saheba Trust';
  const tour = 'NKERP/TOUR/2026/3046';
  const z = (name: string, gender: string, hofId: string, age = 40) => guest({ officeName: office, tourRefNo: tour, applicantName: name, gender, hofId, age });

  it('reads the surname past honorifics', () => {
    assert.equal(surnameOf('Hunaid bhai Mohammadhussain bhai Kitabwala'), 'Kitabwala');
    assert.equal(surnameOf('Alefiya bai Hunaid bhai Kitabwala'), 'Kitabwala');
  });

  it('fills Saifee first, groups surnames, uses buffer beds and only then moves to Badri', () => {
    const kit = [z('Hunaid bhai Kitabwala', 'Male', '1'), z('Alefiya bai Kitabwala', 'Female', '1'), z('Amatullah bai Kitabwala', 'Female', '1', 9)];
    const mhow = [z('Aliasgar bhai Mhowwala', 'Male', '2'), z('Tasneem bai Mhowwala', 'Female', '2')];
    const singles = [z('Moiz bhai Hotelwala', 'Male', '3'), z('Mohammed bhai Haveliwala', 'Male', '4'), z('Sakina bai Lokhandwala', 'Female', '5')];
    const rooms = [room('Burhani', '301', 4, { buffer: 1 }), room('Badri', '105', 4, { buffer: 1 }), room('Badri', '106', 4, { buffer: 1 }),
      room('Saifee', '303', 3), room('Saifee', '304', 2)];
    const all = [...kit, ...mhow, ...singles];
    const plan = planAllocation({ reservations: all, rooms, options: opts({ allowBuffer: false }), today: TODAY });
    assert.ok(kit.every((g) => roomOf(plan, g.id) === 'Saifee 303'));
    assert.ok(mhow.every((g) => roomOf(plan, g.id) === 'Saifee 304'));
    // Saifee is full, so the rest go to Badri and never Burhani; the two gents share, the lady has her own room.
    assert.ok(singles.every((g) => roomOf(plan, g.id)?.startsWith('Badri')));
    assert.equal(roomOf(plan, singles[0].id), roomOf(plan, singles[1].id));
    assert.notEqual(roomOf(plan, singles[0].id), roomOf(plan, singles[2].id));
    assert.ok(all.every((g) => roomOf(plan, g.id) !== 'Burhani 301'));
  });

  it('mixes surnames only to fill a room, and never gents with ladies', () => {
    const people = [z('A bhai One', 'Male', '1'), z('B bhai Two', 'Male', '2'), z('C bai Three', 'Female', '3'), z('D bai Four', 'Female', '4')];
    const rooms = [room('Saifee', '101', 2, { floor: 1 }), room('Saifee', '102', 2, { floor: 1 })];
    const plan = planAllocation({ reservations: people, rooms, options: opts(), today: TODAY });
    assert.equal(roomOf(plan, people[0].id), roomOf(plan, people[1].id));
    assert.equal(roomOf(plan, people[2].id), roomOf(plan, people[3].id));
    assert.notEqual(roomOf(plan, people[0].id), roomOf(plan, people[2].id));
  });
});

describe('planner instructions (chat box)', () => {
  const rooms = [room('Saifee', '101', 2), room('Saifee', '102', 2), room('Saifee', '301', 2, { floor: 3 }), room('Burhani', '305', 4, { floor: 3 }), room('Badri', '105', 4)];
  const ctx = { rooms, offices: ['Faiz E Husainy Kenya', 'Fayz E Husayni Trust Mumbai'] };
  const make = (text: string): PlannerInstruction => {
    const r = parseInstruction(text, ctx);
    assert.ok(r.ok && 'instruction' in r, `not understood: ${text}`);
    return { ...r.instruction, id: text, text, createdAt: '' };
  };

  it('understands room, floor, building and office instructions', () => {
    assert.deepEqual(make("Don't allocate Saifee 101, 102 and Burhani 305").rooms, [
      { building: 'Saifee', roomNumber: '101' }, { building: 'Saifee', roomNumber: '102' }, { building: 'Burhani', roomNumber: '305' },
    ]);
    assert.deepEqual(make('avoid rooms 101 to 102 in Saifee').rooms!.map((r) => r.roomNumber), ['101', '102']);
    const floor = make('Do not use the 3rd floor of Burhani');
    assert.equal(floor.kind, 'block-floor');
    assert.equal(floor.floor, 3);
    assert.equal(floor.building, 'Burhani');
    assert.equal(make("Don't use Badri").kind, 'block-building');
    const only = make('Put Faiz E Husainy Kenya only in Saifee');
    assert.equal(only.kind, 'office-only');
    assert.equal(only.office, 'Faiz E Husainy Kenya');
    assert.equal(make('Allow Burhani 305').kind, 'approve-rooms');
    assert.equal(make('Reserve Saifee 301 for Fayz E Husayni Trust Mumbai').kind, 'reserve-rooms');
    const counts = parseInstruction('Keep 3 rooms for gents and 1 for ladies', ctx);
    assert.ok(counts.ok && 'genderRooms' in counts);
    assert.deepEqual(counts.genderRooms, { gents: 3, ladies: 1 });
    assert.equal(parseInstruction('make tea', ctx).ok, false);
  });

  it('the planner follows them', () => {
    const couple = [guest({ family: 'F-1' }), guest({ family: 'F-1', gender: 'Female' })];
    const block = make("Don't allocate Saifee 101");
    const plan = planAllocation({ reservations: couple, rooms: rooms.slice(0, 2), options: opts({ rules: rules({ instructions: [block] }) }), today: TODAY });
    assert.equal(roomOf(plan, couple[0].id), 'Saifee 102');
    const kenya = [guest({ officeName: 'Faiz E Husainy Kenya', family: 'F-1' })];
    const onlySaifee = planAllocation({ reservations: kenya, rooms: [room('Burhani', '101', 1), room('Saifee', '301', 1)],
      options: opts({ rules: rules({ instructions: [make('Put Faiz E Husainy Kenya only in Saifee')] }) }), today: TODAY });
    assert.equal(roomOf(onlySaifee, kenya[0].id), 'Saifee 301');
  });
});

describe('Zaereen page: one row per ITS', () => {
  it('shows the stay covering today, else the next one, and notes the others', () => {
    const past = guest({ itsId: '700', arrivalDate: '2026-11-10', departureDate: '2026-11-15' });
    const now = guest({ itsId: '700', arrivalDate: '2026-11-20', departureDate: '2026-11-24', building: 'Burhani', roomNumber: '305' });
    const next = guest({ itsId: '700', arrivalDate: '2026-12-01', departureDate: '2026-12-05' });
    const other = guest({ itsId: '701' });
    const { rows, others } = oneRowPerIts([past, next, now, other], TODAY);
    assert.deepEqual(rows.map((r) => r.id), [now.id, other.id]);
    assert.deepEqual(others.get(now.id)!.map((r) => r.id), [past.id, next.id]);

    const upcoming = oneRowPerIts([past, next], TODAY);
    assert.deepEqual(upcoming.rows.map((r) => r.id), [next.id]);
  });
});
