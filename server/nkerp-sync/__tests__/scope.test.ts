/**
 * Arrival scope: "sync one date" and "sync a date range". Offline, against the in-memory NKERP.
 *   npm run test:sync
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arrivalScope } from '../engine';
import { validateOptions } from '../handlers';
import { app, FakeNKERP, FakeTab, FILL, go, hist, placed, row, T1, T2 } from './fakes';

const T3 = 'NKERP/TOUR/2026/4100';

/** Two tours: T1 arrives 20 Nov, T2 arrives 25 Nov. */
const twoArrivals = () => new FakeNKERP({
  apps: [app(1, T1, '111', null, '2026-11-20', '2026-11-22'), app(2, T2, '222', null, '2026-11-25', '2026-11-27')],
});
const twoRows = () => [row(2, '111', T1, 'SAIFEE', '107', '2026-11-20'), row(3, '222', T2, 'BURHANI', '201', '2026-11-25')];

describe('arrival scope', () => {
  it('one date allocates only that arrival', async () => {
    const fake = twoArrivals();
    const { rep, tab } = await go(twoRows(), fake, { from: '2026-11-25', to: '2026-11-25' });
    assert.deepEqual(rep.done.map((e) => e.group), [`2026-11-25 ${T2} Burhani 201`]);
    assert.deepEqual(rep.scope, { from: '2026-11-25', to: '2026-11-25' });
    assert.deepEqual(tab.appended.map((h) => [h.Action, h['Tour ID']]), [['ALLOCATE', T2]]);
  });

  it('a range covers every arrival inside it, inclusive', async () => {
    const fake = twoArrivals();
    const { rep } = await go(twoRows(), fake, { from: '2026-11-20', to: '2026-11-25' });
    assert.equal(rep.done.length, 2);
    const narrow = await go(twoRows(), twoArrivals(), { from: '2026-11-21', to: '2026-11-24' });
    assert.equal(narrow.rep.done.length, 0);
  });

  it('without a scope everything runs as before', async () => {
    const { rep } = await go(twoRows(), twoArrivals());
    assert.equal(rep.done.length, 2);
    assert.equal(rep.scope, undefined);
  });

  it('reallocates only people arriving in scope', async () => {
    const fake = new FakeNKERP({ occ: [
      ...placed('BURHANI', '201', '2026-11-20', '2026-11-22', 7, '111', T1),
      ...placed('BURHANI', '201', '2026-11-25', '2026-11-27', 8, '222', T2),
    ] });
    const sheet = [row(2, '111', T1, 'SAIFEE', '107', '2026-11-20'), row(3, '222', T2, 'SAIFEE', '108', '2026-11-25')];
    const { rep, tab } = await go(sheet, fake, { from: '2026-11-25', to: '2026-11-25' });
    assert.deepEqual(rep.done.map((e) => [e.action, e.group]), [['reallocate', `${T2} Saifee 108`]]);
    // T1 (out of scope) keeps its old room and is neither moved nor remembered by this run
    assert.ok(fake.occ.filter((o) => o[4] === '111').every((o) => o[0] === 'BURHANI'));
    assert.ok(tab.appended.every((h) => h['Tour ID'] === T2));
  });

  it('deallocates only people arriving in scope and never forgets the others', async () => {
    const fake = new FakeNKERP({ occ: [
      ...placed('SAIFEE', '107', '2026-11-20', '2026-11-22', 7, '111', T1),
      ...placed('SAIFEE', '108', '2026-11-25', '2026-11-27', 8, '222', T2),
    ] });
    const tab = new FakeTab([hist('SEEN', 'recorded', T1, '111', 'Saifee', '107', '2026-11-20'),
      hist('SEEN', 'recorded', T2, '222', 'Saifee', '108', '2026-11-25')]);
    // Both rows were cleared in the Sheet.
    const sheet = [row(2, '111', T1, 'SAIFEE', '', '2026-11-20'), row(3, '222', T2, 'SAIFEE', '', '2026-11-25'), ...FILL];
    const { rep } = await go(sheet, fake, { from: '2026-11-20', to: '2026-11-20', tab });
    assert.deepEqual(rep.done.map((e) => e.action), ['deallocate']);
    assert.deepEqual(fake.occ.map((o) => o[4]).filter((v, i, a) => a.indexOf(v) === i), ['222']);
    assert.ok(tab.appended.every((h) => h['Tour ID'] === T1), 'nothing logged (no CLEARED) for the out-of-scope tour');
  });

  it('reads only the tours that arrive in scope', async () => {
    const fake = twoArrivals();
    const read: string[] = [];
    const current = fake.current.bind(fake);
    fake.current = async (ref: string) => {
      read.push(ref);
      return current(ref);
    };
    await go([...twoRows(), row(4, '333', T3, 'SAIFEE', '108', '2026-12-05')], fake, { from: '2026-11-25', to: '2026-11-25' });
    assert.deepEqual(read.filter((r, i, a) => a.indexOf(r) === i), [T2]);
  });

  it('a dry run reports the scope and saves nothing', async () => {
    const fake = twoArrivals();
    const { rep, tab } = await go(twoRows(), fake, { apply: false, from: '2026-11-20', to: '2026-11-20' });
    assert.deepEqual(rep.planned.map((e) => e.group), [`2026-11-20 ${T1} Saifee 107`]);
    assert.deepEqual([fake.writes, tab.appended], [[], []]);
  });

  it('open-ended scopes', () => {
    assert.equal(arrivalScope({}), null);
    assert.deepEqual(arrivalScope({ from: '2026-11-20' }), { from: '2026-11-20', to: '9999-12-31' });
    assert.deepEqual(arrivalScope({ to: '2026-11-20' }), { from: '0000-01-01', to: '2026-11-20' });
  });
});

describe('scope validation', () => {
  it('accepts one date and a range', () => {
    assert.deepEqual(validateOptions({ apply: false, from: '2026-11-25', to: '2026-11-25' }),
      { apply: false, from: '2026-11-25', to: '2026-11-25' });
    assert.deepEqual(validateOptions({ from: '2026-11-20', to: '2026-11-30' }), { apply: true, from: '2026-11-20', to: '2026-11-30' });
    assert.deepEqual(validateOptions({ from: '', to: null }), { apply: true });
  });

  it('refuses bad dates, a reversed range and a range over a year', () => {
    assert.throws(() => validateOptions({ from: '2026-13-01' }), /from must be a YYYY-MM-DD date/);
    assert.throws(() => validateOptions({ to: '25/11/2026' }), /to must be a YYYY-MM-DD date/);
    assert.throws(() => validateOptions({ from: '2026-11-25', to: '2026-11-20' }), /ends before it starts/);
    assert.throws(() => validateOptions({ from: '2026-01-01', to: '2027-06-01' }), /at most one year/);
  });
});
