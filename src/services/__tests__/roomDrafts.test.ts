/**
 * Approval → rooms chain: rooms drafted a few days before arrival, kept until the tour changes, and only the
 * changed tour re-planned.
 *   npm run test:planner
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Reservation, Room } from '../../types';
import { draftItems, EMPTY_DRAFTS, normalizeRoomDraftSettings, updateDrafts } from '../roomDrafts';

const TODAY = '2026-11-21';
const RULES = { instructions: [], genderRooms: { gents: 0, ladies: 0 } };
const settings = normalizeRoomDraftSettings({ daysAhead: 3 });
let n = 0;
const room = (b: string, no: string, cap: number): Room => ({ id: `rm-${b}-${no}`, building: b, roomNumber: no, floor: 1, capacity: cap, pax: cap,
  buffer: 0, category: 'Category B (Standard)', status: 'available', amenities: [] });
const guest = (o: Partial<Reservation> = {}): Reservation => {
  n++;
  return { id: `r${n}`, itsId: String(20000 + n), applicantName: `Guest ${n}`, age: 40, category: 'Mumineen', gender: 'Male', family: 'F-1',
    idara: '', tourRefNo: 'NKERP/TOUR/2026/1', officeName: 'Office', groupLeadName: 'Lead', arrivalDate: '2026-11-22',
    departureDate: '2026-11-25', building: '', roomNumber: '', moneyGiven: 'No', isUploadedToPortal: false, createdAt: '', updatedAt: '', ...o };
};
const rooms = [room('Saifee', '101', 2), room('Saifee', '102', 2), room('Saifee', '103', 2), room('Burhani', '201', 4)];
const run = (prev: typeof EMPTY_DRAFTS | null, reservations: Reservation[], now = 0) =>
  updateDrafts(prev, { reservations, rooms, rules: RULES, settings, today: TODAY, now: Date.parse('2026-11-21T08:00:00Z') + now });

describe('room drafts', () => {
  it('drafts only arrivals inside the window, and keeps unchanged tours as they were', () => {
    const a = [guest(), guest({ gender: 'Female' })];
    const b = [guest({ tourRefNo: 'NKERP/TOUR/2026/2', family: 'F-1', arrivalDate: '2026-11-23', departureDate: '2026-11-26' })];
    const later = [guest({ tourRefNo: 'NKERP/TOUR/2026/3', arrivalDate: '2026-12-10', departureDate: '2026-12-12' })];
    const first = run(null, [...a, ...b, ...later]);
    assert.deepEqual(Object.keys(first.tours).sort(), ['NKERP/TOUR/2026/1', 'NKERP/TOUR/2026/2']);
    assert.equal(first.tours['NKERP/TOUR/2026/1'].status, 'new');
    const again = run(first, [...a, ...b, ...later], 60_000);
    assert.deepEqual(again.tours['NKERP/TOUR/2026/1'].assignments, first.tours['NKERP/TOUR/2026/1'].assignments);
    assert.equal(again.tours['NKERP/TOUR/2026/1'].updatedAt, first.tours['NKERP/TOUR/2026/1'].updatedAt, 'not re-planned');
  });

  it('re-plans only the tour NKERP moved, and records why and what changed', () => {
    const a = [guest({ tourRefNo: 'T-A' }), guest({ tourRefNo: 'T-A', gender: 'Female' })];
    const b = [guest({ tourRefNo: 'T-B', family: 'F-2' })];
    const first = run(null, [...a, ...b]);
    const moved = b.map(r => ({ ...r, arrivalDate: '2026-11-23', departureDate: '2026-11-27' }));
    const next = run(first, [...a, ...moved], 60_000);
    assert.equal(next.tours['T-A'].updatedAt, first.tours['T-A'].updatedAt, 'the unchanged tour keeps its draft');
    assert.deepEqual(next.tours['T-A'].assignments, first.tours['T-A'].assignments);
    assert.equal(next.tours['T-B'].status, 'replanned');
    assert.match(next.tours['T-B'].changes[0].reason, /moved the stay from 2026-11-22–2026-11-25 to 2026-11-23–2026-11-27/);
    assert.equal(next.tours['T-B'].changes[0].before.length, 1);
    assert.ok(next.log.some(l => /Re-planned/.test(l.reason)));
  });

  it('re-plans a tour whose drafted room another allocation took', () => {
    const a = [guest({ tourRefNo: 'T-A' }), guest({ tourRefNo: 'T-A', gender: 'Female' })];
    const first = run(null, a);
    const d = first.tours['T-A'];
    const taken = Object.values(d.assignments)[0]!;
    const squatter = guest({ tourRefNo: 'T-Z', family: 'F-9', building: taken.building, roomNumber: taken.roomNumber });
    const squatter2 = guest({ tourRefNo: 'T-Z', family: 'F-9', building: taken.building, roomNumber: taken.roomNumber });
    const next = run(first, [...a, squatter, squatter2], 60_000);
    assert.equal(next.tours['T-A'].status, 'replanned');
    assert.match(next.tours['T-A'].changes[0].reason, /took a room/);
    const now = Object.values(next.tours['T-A'].assignments)[0]!;
    assert.notEqual(`${now.building} ${now.roomNumber}`, `${taken.building} ${taken.roomNumber}`);
  });

  it('drops tours that got their rooms, and a set-aside tour returns only when it changes', () => {
    const a = [guest({ tourRefNo: 'T-A' })];
    const first = run(null, a);
    const items = draftItems([first.tours['T-A']]);
    assert.equal(items.length, 1);
    const allocated = a.map(r => ({ ...r, building: items[0].building, roomNumber: items[0].roomNumber }));
    assert.deepEqual(Object.keys(run(first, allocated, 60_000).tours), []);
    const aside = { ...first, dismissed: { 'T-A': first.tours['T-A'].basis }, tours: {} };
    assert.deepEqual(Object.keys(run(aside, a, 60_000).tours), []);
    const changed = a.map(r => ({ ...r, departureDate: '2026-11-26' }));
    assert.deepEqual(Object.keys(run(aside, changed, 60_000).tours), ['T-A']);
  });

  it('can be switched off', () => {
    const off = updateDrafts(null, { reservations: [guest()], rooms, rules: RULES, settings: normalizeRoomDraftSettings({ enabled: false }), today: TODAY });
    assert.deepEqual(off.tours, {});
  });
});
