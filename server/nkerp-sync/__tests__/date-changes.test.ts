/**
 * NKERP date changes and deleted stays: a moved stay updates its saved record, and a deletion only hides the
 * exact stay that was deleted.   npm run test:sync
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { StoredReservation } from '../../nkerp-pull.js';

process.env.NAJAF_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'najaf-dates-test-'));
process.env.NAJAF_AUTO_PULL = 'false';
const { guests, read, setup, write, localStore } = await import('../../local-store.js');
const { withStore } = await import('../../accommodation-store.js');
const { reconcileNkerp, removalKey } = await import('../../nkerp-pull.js');
const { accommodationApi } = await import('../../accommodation-api.js');

const now = Date.parse('2026-11-21T10:00:00+03:00');
/** An NKERP stay as collectNkerp builds it. */
const nkerp = (its: string, arrival: string, departure: string, room = ''): StoredReservation => ({
  id: 'nkerp-'+its+arrival, tourRefNo: 'NKERP/TOUR/2026/3737', tourId: 'NKERP/TOUR/2026/3737', itsId: its,
  applicantName: 'Zair '+its, age: '40', gender: 'Female', category: 'Mumineen', family: 'F-1', familyNo: 'F-1',
  idara: '', officeName: 'Hakimi Tours And Travels', groupLeadName: 'Zair '+its,
  arrivalDate: arrival.slice(0,10), arrivalTime: arrival.slice(11,16), rawArrivalStr: arrival, arrivalDateTime: arrival,
  departureDate: departure.slice(0,10), departureTime: departure.slice(11,16), rawDepartureStr: departure, departureDateTime: departure,
  building: room ? 'Burhani' : '', roomNumber: room, nkerpBaseline: { building: room ? 'Burhani' : '', roomNumber: room },
  isUploadedToPortal: Boolean(room), moneyGiven: 'No', paxCount: 1, createdAt: '', updatedAt: '',
});
const reset = () => { setup(); write('reservations', []); write('removed-stays', {}); write('hidden-stays', []); };
const api = accommodationApi();
const call = (route: string, body?: unknown) => api.fetch(new Request('http://app'+route, body === undefined ? undefined :
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

test('a stay NKERP moves to dates that do not overlap updates the saved stay instead of adding a second one', () => withStore(localStore, () => {
  reset();
  reconcileNkerp([nkerp('1', '2026-11-22T11:00:00', '2026-11-24T19:00:00')], now);
  const [saved] = guests();
  write('reservations', [{ ...saved, building: 'Saifee', roomNumber: '305', allocationObservedOnly: false, localFields: ['roomNumber','building'] }]);
  assert.equal(reconcileNkerp([nkerp('1', '2026-11-28T11:00:00', '2026-12-02T19:00:00')], now).changed, 1);
  const stays = guests();
  assert.equal(stays.length, 1);
  assert.deepEqual([stays[0].id, stays[0].arrivalDate, stays[0].departureDate, stays[0].departureTime, stays[0].roomNumber],
    [saved.id, '2026-11-28', '2026-12-02', '19:00', '305']);
}));

test('an outdated copy of a moved stay is removed when NKERP lists the guest only on the new dates', () => withStore(localStore, () => {
  reset();
  const old = { ...nkerp('2', '2026-11-22T11:00:00', '2026-11-24T19:00:00'), allocationObservedOnly: true };
  const moved = { ...nkerp('2', '2026-11-28T11:00:00', '2026-12-02T19:00:00'), allocationObservedOnly: true };
  write('reservations', [old, moved]);
  reconcileNkerp([nkerp('2', '2026-11-28T11:00:00', '2026-12-02T19:00:00')], now);
  assert.deepEqual(guests().map(r => r.arrivalDate), ['2026-11-28']);
}));

test("an outdated copy keeps a room the guest's current stay doesn't have, and goes once the current stay has one", () => withStore(localStore, () => {
  reset();
  const old = { ...nkerp('7', '2026-11-22T11:00:00', '2026-11-24T19:00:00'), building: 'Burhani', roomNumber: '203',
    allocationObservedOnly: false, localFields: ['building','roomNumber'] };
  const moved = { ...nkerp('7', '2026-11-28T11:00:00', '2026-12-02T19:00:00'), allocationObservedOnly: true };
  write('reservations', [old, moved]);
  reconcileNkerp([nkerp('7', '2026-11-28T11:00:00', '2026-12-02T19:00:00')], now);
  assert.equal(guests().length, 2);
  write('reservations', [old, { ...moved, building: 'Burhani', roomNumber: '305', localFields: ['building','roomNumber'] }]);
  reconcileNkerp([nkerp('7', '2026-11-28T11:00:00', '2026-12-02T19:00:00')], now);
  assert.deepEqual(guests().map(r => r.roomNumber), ['305']);
}));

test("NKERP's new dates replace an earlier date edit in the app; an unchanged NKERP date keeps the edit", () => withStore(localStore, () => {
  reset();
  reconcileNkerp([nkerp('3', '2026-11-22T11:00:00', '2026-11-24T19:00:00')], now);
  const [saved] = guests();
  write('reservations', [{ ...saved, departureTime: '08:00', localFields: ['departureTime'] }]);
  reconcileNkerp([nkerp('3', '2026-11-22T11:00:00', '2026-11-24T19:00:00')], now);
  assert.equal(guests()[0].departureTime, '08:00');
  reconcileNkerp([nkerp('3', '2026-11-22T11:00:00', '2026-11-25T19:00:00')], now);
  assert.deepEqual([guests()[0].departureDate, guests()[0].departureTime, (guests()[0] as StoredReservation).localFields], ['2026-11-25', '19:00', []]);
}));

test('records saved before NKERP dates were tracked follow a changed NKERP day even when the dates were edited', () => withStore(localStore, () => {
  reset();
  const manual = { ...nkerp('4', '2026-11-22T11:00:00', '2026-11-24T19:00:00'), id: 'manual-4',
    localFields: ['arrivalDate','departureDate','departureTime','rawDepartureStr','departureDateTime'] };
  write('reservations', [manual]);
  reconcileNkerp([nkerp('4', '2026-11-22T11:00:00', '2026-11-26T19:00:00')], now);
  assert.deepEqual([guests().length, guests()[0].id, guests()[0].departureDate], [1, 'manual-4', '2026-11-26']);
}));

test('a deleted stay stays hidden and listed until NKERP moves it; restoring brings it straight back', async () => {
  await withStore(localStore, async () => {
    reset();
    reconcileNkerp([nkerp('5', '2026-11-22T11:00:00', '2026-11-24T19:00:00')], now);
    const [saved] = guests();
    const deleted = await call('/api/changes', { collection: 'reservations', changes: [{ id: saved.id, before: saved, after: null }] });
    assert.equal(deleted.status, 200);
    assert.equal(reconcileNkerp([nkerp('5', '2026-11-22T11:00:00', '2026-11-24T19:00:00')], now).changed, 0);
    const hidden = read<{key:string; its:string}[]>('hidden-stays', []);
    assert.deepEqual(hidden.map(h => h.its), ['5']);
    assert.equal(((await (await call('/api/status')).json()) as {hiddenStays:number}).hiddenStays, 1);
    // NKERP moves the departure: a different stay, so it comes back.
    assert.equal(reconcileNkerp([nkerp('5', '2026-11-22T11:00:00', '2026-11-25T19:00:00')], now).changed, 1);
    assert.equal(guests().length, 1);
    assert.deepEqual(read('hidden-stays', []), []);

    // Deleted again, then restored from the Zaereen page.
    const [again] = guests();
    await call('/api/changes', { collection: 'reservations', changes: [{ id: again.id, before: again, after: null }] });
    reconcileNkerp([nkerp('5', '2026-11-22T11:00:00', '2026-11-25T19:00:00')], now);
    assert.equal(guests().length, 0);
    const restore = await call('/api/hidden-stays/restore', { keys: [removalKey(again)] });
    assert.deepEqual(await restore.json(), { restored: 1 });
    assert.equal(reconcileNkerp([nkerp('5', '2026-11-22T11:00:00', '2026-11-25T19:00:00')], now).changed, 1);
    assert.equal(guests().length, 1);
  });
});

test('an older deletion (expiry only) hides the same stay but not one whose departure NKERP changed', () => withStore(localStore, () => {
  reset();
  const stay = nkerp('6', '2026-11-22T11:00:00', '2026-11-24T19:00:00');
  write('removed-stays', { [removalKey(stay)]: Date.parse('2026-11-27T19:00:00+03:00') });
  assert.equal(reconcileNkerp([stay], now).changed, 0);
  assert.equal(read<unknown[]>('hidden-stays', []).length, 1);
  assert.equal(reconcileNkerp([nkerp('6', '2026-11-22T11:00:00', '2026-11-25T19:00:00')], now).changed, 1);
  assert.equal(guests().length, 1);
}));
