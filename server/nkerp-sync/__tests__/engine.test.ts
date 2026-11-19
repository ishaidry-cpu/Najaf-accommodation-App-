/**
 * Offline tests for the sync engine: no network, Sheet or NKERP. A line-for-line port of the skill's
 * scripts/test_najaf_alloc.py, plus tests for the parts that only exist in the app (cancellation,
 * concurrency, cookie jar, JWT signing, credentials).
 *   npm run test:sync
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { credentialStatus, googleServiceAccount } from '../credentials';
import { commit, runSync } from '../engine';
import { signAssertion } from '../googleAuth';
import { CookieJar, NkerpClient } from '../nkerpClient';
import { allocNeed, allocPayload, capacityProblems } from '../payloads';
import { plan } from '../planner';
import { memory, parseSheet, SheetError } from '../sheets';
import { familyNo, parseArrival, pyRepr, tuple } from '../util';
import { app, FakeNKERP, FakeTab, FILL, go, hist, nights, placed, row, T1, T2 } from './fakes';

describe('parsing', () => {
  it('reads every documented ARRIVAL format, day first', () => {
    for (const text of ['2026-11-26', '26-11-2026', '26/11/2026', '26-Nov-2026', '26 November 2026', '2026-11-26 10:00']) {
      assert.equal(parseArrival(text), '2026-11-26', text);
    }
    assert.equal(parseArrival('anything', 46352), '2026-11-26');   // Sheets serial number
    assert.equal(parseArrival('next week'), null);
    assert.equal(parseArrival(''), null);
  });

  it('rejects impossible dates and month-first text like strptime does', () => {
    assert.equal(parseArrival('31-02-2026'), null);
    assert.equal(parseArrival('11/26/2026'), null);
    assert.equal(parseArrival('nov 26, 2026'), '2026-11-26');
    assert.equal(parseArrival('1-1-2026'), '2026-01-01');
  });

  it('normalises family numbers', () => {
    for (const text of ['F-7', 'f7', 'F - 07', '7']) assert.equal(familyNo(text), 'F-7');
    assert.equal(familyNo(null), '');
    assert.equal(familyNo('SELF'), '');
  });

  it('accepts the header alias and serial dates', () => {
    const shown = [['ITS', 'Name', 'Family', 'Tour ID', 'Building', 'Room Allotment', 'Arrival'],
      ['111', 'A', 'F-1', T1, 'Saifee', '107', '26-11-2026'],
      ['222', 'B', 'F-1', T1, 'Saifee', '107', '11/26/2026']];
    const raw = [shown[0], shown[1], ['222', 'B', 'F-1', T1, 'Saifee', 107, 46352]];
    assert.deepEqual(parseSheet(shown, raw).map((r) => r.arrival), ['2026-11-26', '2026-11-26']);
  });

  it('refuses a changed header', () => {
    assert.throws(() => parseSheet([['ITS', 'NAME']], []), (e: Error) =>
      e instanceof SheetError && e.message === "Sheet header changed; missing ['FAMILY', 'TOUR ID', 'BUILDING', 'ROOM ALLOTTMENT', 'ARRIVAL']");
  });
});

describe('planning', () => {
  it('places by ITS and family, skips duplicates and incomplete rows', () => {
    const sheet = [row(2, '111', T1), row(3, '222', T1, 'SAIFEE', '108', '2026-11-20', 'F-2'),
      row(4, '222', T1, 'SAIFEE', '109', '2026-11-20', 'F-2'),
      row(5, '', T1), row(6, '444', T1, 'SAIFEE', ''),
      row(7, '555', T1, 'SAIFEE', '107', 'later'),
      row(8, '666', T1, 'SAIFEE', '107', '2026-11-01')];
    const apps = [app(1, T1, '111', 'F-1'), app(2, T1, '999', 'F-1'), app(3, T1, '222', 'F-2'), app(4, T1, '888', null)];
    const { items, notes, skipped } = plan(sheet, apps, '2026-11-16');
    const got = Object.fromEntries(items.map((it) => [it.app.ApplicantinTourId, [it.room, it.how]]));
    assert.deepEqual(got, { 1: ['107', 'ITS'], 2: ['107', 'family F-1'] });
    assert.ok('duplicate ITS with different rooms (skipped)' in notes);
    assert.ok('unreadable ARRIVAL date in the Sheet (row skipped)' in notes);
    assert.equal(skipped['no ITS in the Sheet'], 1);
    assert.equal(skipped['no building/room yet in the Sheet'], 1);
  });

  it('reports a family split', () => {
    const { items, notes } = plan([row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T1, 'SAIFEE', '108')],
      [app(1, T1, '333', 'F-1')], '2026-11-16');
    assert.deepEqual(items, []);
    assert.ok('family split across rooms in the Sheet and person not listed by ITS (skipped)' in notes);
  });

  it('counts tours already fully allocated', () => {
    assert.equal(plan([row(2, '111', T2)], [], '2026-11-16').skipped['tours already fully allocated in NKERP'], 1);
  });

  it('allows a first-night turnover but blocks an overlap', () => {
    const room = (occupied: string[]) => ({ Id: 1, RoomNumber: '107', TotalCapacity: 2,
      AccomodationRoomAllocatedDatesNew: occupied.map((d) => ({ OccupiedDate: `${d}T00:00:00`, IsActive: true,
        RoomAllocatedDates_Current: [{ ApplicantId: 90, IsInfant: false, TourReferenceNo: T2 },
          { ApplicantId: 91, IsInfant: false, TourReferenceNo: T2 }] })) });
    const body = allocPayload({ Id: 1, TotalCapacity: 2 }, [{ app: app(1, T1, '111'), dates: nights('2026-11-20', '2026-11-22'),
      arrival: '', ref: T1, building: '', room: '', how: '' }]);
    const need = allocNeed(body);
    assert.deepEqual(capacityProblems(room(['2026-11-19', '2026-11-20']), need), []);
    assert.ok(capacityProblems(room(['2026-11-20', '2026-11-21']), need).length);
  });

  it('infants take no bed', () => {
    const body = allocPayload({ Id: 1, TotalCapacity: 2 }, [
      { app: app(1, T1, '111'), dates: nights('2026-11-20', '2026-11-20'), arrival: '', ref: T1, building: '', room: '', how: '' },
      { app: app(2, T1, '112', null, '2026-11-20', '2026-11-20', true), dates: nights('2026-11-20', '2026-11-20'),
        arrival: '', ref: T1, building: '', room: '', how: '' }]);
    assert.deepEqual(allocNeed(body), [['2026-11-20', 1]]);
    assert.equal(body.lstAccomodationRoomAllocatedDates[0].RoomAllocatedDates_Current.length, 2);
  });
});

describe('allocating', () => {
  const sheet = [row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T2, 'SAIFEE', '108')];
  const apps = () => [app(1, T1, '111'), app(2, T2, '222')];

  it('applies and logs', async () => {
    const { rep, tab } = await go(sheet, new FakeNKERP({ apps: apps() }));
    assert.deepEqual([rep.done.length, rep.problems, rep.stopped], [2, [], undefined]);
    assert.deepEqual(tab.appended.map((h) => [h.Action, h.Result]), [['ALLOCATE', 'done'], ['ALLOCATE', 'done']]);
    assert.match(tab.appended[0]['Run ID'], /^\d{8}-\d{6}$/);
  });

  it('confirms a timeout that landed by readback', async () => {
    const { rep } = await go(sheet, new FakeNKERP({ apps: apps(), mode: ['timeout_landed', 'ok'] }));
    assert.equal(rep.done.length, 2);
    assert.match(rep.done[0].warning!, /TimeoutError/);
  });

  it('stops the run on a timeout that did not land', async () => {
    const fake = new FakeNKERP({ apps: apps(), mode: ['timeout_lost', 'ok'] });
    const { rep } = await go(sheet, fake);
    assert.equal(fake.writes.length, 1);
    assert.ok(rep.stopped);
  });

  it('reports a plain refusal and continues', async () => {
    const fake = new FakeNKERP({ apps: apps(), mode: ['refused', 'ok'] });
    const { rep } = await go(sheet, fake);
    assert.deepEqual([fake.writes.length, rep.done.length, rep.problems.length, rep.stopped], [2, 1, 1, undefined]);
  });

  it('dry run counts rooms it already planned', async () => {
    const s = [row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T2, 'SAIFEE', '107'), row(4, '333', T1, 'SAIFEE', '107')];
    const a = [app(1, T1, '111'), app(2, T2, '222'), app(3, T1, '333')];
    const { rep } = await go(s, new FakeNKERP({ apps: a, capacity: 2 }), { apply: false });
    assert.equal(rep.planned.length, 1);
    assert.match(rep.problems[0].reason, /another tour planned in this run/);
  });

  it('dry run never writes NKERP or history', async () => {
    const fake = new FakeNKERP({ apps: apps() });
    const tab = new FakeTab();
    const { rep } = await go(sheet, fake, { apply: false, tab });
    assert.deepEqual([fake.writes, tab.appended], [[], []]);
    assert.deepEqual(rep.history, { rows_planned: 2 });
  });

  it('limit does only the first N groups, smallest first', async () => {
    const s = [row(2, '111', T1, 'SAIFEE', '107'), row(3, '112', T1, 'SAIFEE', '107'), row(4, '222', T2, 'SAIFEE', '108')];
    const fake = new FakeNKERP({ apps: [app(1, T1, '111'), app(3, T1, '112'), app(2, T2, '222')] });
    const { rep } = await go(s, fake, { limit: 1 });
    assert.equal(fake.writes.length, 1);
    assert.deepEqual(rep.done[0].people, ['P2']);
  });
});

describe('reallocating', () => {
  it('moves a person to the Sheet room', async () => {
    const fake = new FakeNKERP({ occ: placed('BURHANI', '201', '2026-11-20', '2026-11-22', 7, '111', T1) });
    const { rep, tab } = await go([row(2, '111', T1, 'SAIFEE', '107')], fake);
    assert.deepEqual(rep.done.map((e) => [e.action, e.group]), [['reallocate', `${T1} Saifee 107`]]);
    assert.deepEqual(new Set(fake.occ.map((o) => `${o[0]} ${o[1]}`)), new Set(['SAIFEE 107']));
    const h = tab.appended[0];
    assert.deepEqual([h.Action, h.Result, h['NKERP Before'], h['NKERP After']], ['REALLOCATE', 'done', 'Burhani 201', 'Saifee 107']);
  });

  it('mid-stay moves only tonight onward', async () => {
    const fake = new FakeNKERP({ occ: placed('BURHANI', '201', '2026-11-20', '2026-11-22', 7, '111', T1) });
    await go([row(2, '111', T1, 'SAIFEE', '107')], fake, { today: '2026-11-21' });
    assert.deepEqual(fake.occ.map((o) => [o[0], o[2]]).sort(),
      [['BURHANI', '2026-11-20'], ['SAIFEE', '2026-11-21'], ['SAIFEE', '2026-11-22']]);
  });

  it('builds the payload like the reallocation screen', async () => {
    const fake = new FakeNKERP({ occ: [...placed('BURHANI', '201', '2026-11-20', '2026-11-21', 7, '111', T1),
      ...placed('BURHANI', '201', '2026-11-20', '2026-11-21', 8, '222', T1)] });
    await go([row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T1, 'SAIFEE', '107')], fake);
    assert.equal(fake.writes.length, 1);
    const [kind, body] = fake.writes[0];
    assert.deepEqual([kind, body.EmailOption, body.DeallocateList.length], ['reallocate', 0, 2]);
    const e = body.DeallocateList[0];
    assert.deepEqual([e.RoomDetailId, e.AssignedCapacity, e.RoomNumber], [1, 0, '107']);
    assert.deepEqual(e.RoomAllocatedDates_Current.map((x: any) => x.ApplicantId), [7, 8]);
    assert.ok(!('AssignedCapacity' in e.RoomAllocatedDates_Current[0]));
    assert.equal(e.RoomAllocatedDates_Current[1].AssignedCapacity, 0);
    assert.ok('PrevRoomAllocatedDatesId' in e.RoomAllocatedDates_Current[0]);
  });

  it('leaves someone already in the right room alone (first run remembers it)', async () => {
    const fake = new FakeNKERP({ occ: placed('SAIFEE', '107', '2026-11-20', '2026-11-22', 7, '111', T1) });
    const { rep, tab } = await go([row(2, '111', T1, 'SAIFEE', '107')], fake);
    assert.deepEqual([fake.writes, rep.done], [[], []]);
    assert.deepEqual(tab.appended.map((h) => h.Action), ['SEEN']);
  });

  it('writes no SEEN row when memory already matches', async () => {
    const fake = new FakeNKERP({ occ: placed('SAIFEE', '107', '2026-11-20', '2026-11-22', 7, '111', T1) });
    const { tab } = await go([row(2, '111', T1, 'SAIFEE', '107')], fake, { tab: new FakeTab([hist('SEEN', 'recorded', T1, '111')]) });
    assert.deepEqual(tab.appended, []);
  });

  it('reports a full target room with the occupying tour', async () => {
    const fake = new FakeNKERP({ capacity: 1, occ: [...placed('BURHANI', '201', '2026-11-20', '2026-11-22', 7, '111', T1),
      ...placed('SAIFEE', '107', '2026-11-19', '2026-11-23', 90, '999', T2)] });
    const { rep } = await go([row(2, '111', T1, 'SAIFEE', '107')], fake);
    assert.deepEqual(fake.writes, []);
    assert.ok(rep.problems[0].reason.includes(T2));
  });

  it('allow over capacity lets the move through and reports the overflow', async () => {
    const fake = new FakeNKERP({ capacity: 1, occ: [...placed('BURHANI', '201', '2026-11-20', '2026-11-22', 7, '111', T1),
      ...placed('SAIFEE', '107', '2026-11-19', '2026-11-23', 90, '999', T2)] });
    const { rep } = await go([row(2, '111', T1, 'SAIFEE', '107')], fake, { allowOverCapacity: true });
    assert.equal(fake.writes.length, 1);
    assert.equal(rep.done[0].over_capacity!.length, 3);
  });

  it('an unconfirmed reallocation stops further writes', async () => {
    const fake = new FakeNKERP({ mode: ['timeout_lost', 'ok'], occ: [
      ...placed('BURHANI', '201', '2026-11-20', '2026-11-22', 7, '111', T1),
      ...placed('BURHANI', '201', '2026-11-20', '2026-11-22', 8, '222', T2)] });
    const { rep } = await go([row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T2, 'SAIFEE', '108')], fake);
    assert.equal(fake.writes.length, 1);
    assert.ok(rep.stopped);
  });
});

describe('deallocating', () => {
  const occ = () => placed('SAIFEE', '107', '2026-11-20', '2026-11-22', 7, '111', T1);

  it('deallocates a previously synced person whose row is now blank', async () => {
    const fake = new FakeNKERP({ occ: occ() });
    const { tab } = await go([row(2, '111', T1, 'SAIFEE', ''), ...FILL], fake, { tab: new FakeTab([hist('SEEN', 'recorded', T1, '111')]) });
    assert.deepEqual(fake.occ, []);
    assert.equal(fake.writes.length, 1);
    const [kind, body] = fake.writes[0];
    assert.deepEqual([kind, body.EmailOption], ['deallocate', 0]);
    assert.ok(body.DeallocateList.every((e: any) => e.RoomAllocatedDates_Current.every((x: any) => x.Checkbox)));
    const h = tab.appended[0];
    assert.deepEqual([h.Action, h.Result, h['Sheet Room'], h['NKERP Before']], ['DEALLOCATE', 'done', '', 'Saifee 107']);
    assert.equal(memory([...tab.rows, ...tab.appended], '2026-11-01').get(JSON.stringify([T1, '111']))!.room, '');
  });

  it('a deleted row counts as blank', async () => {
    const fake = new FakeNKERP({ occ: occ() });
    await go([row(9, '555', T2), ...FILL], fake, { tab: new FakeTab([hist('ALLOCATE', 'done', T1, '111')]) });
    assert.deepEqual(fake.occ, []);
  });

  it('never deallocates someone no run has seen', async () => {
    const fake = new FakeNKERP({ occ: occ() });
    const { tab } = await go([row(2, '111', T1, 'SAIFEE', ''), ...FILL], fake);
    assert.deepEqual([fake.writes, tab.appended], [[], []]);
  });

  it('holds deallocation when the Sheet shows almost no rooms', async () => {
    const fake = new FakeNKERP({ occ: occ() });
    const { rep } = await go([row(2, '111', T1, 'SAIFEE', '')], fake, { tab: new FakeTab([hist('SEEN', 'recorded', T1, '111')]) });
    assert.deepEqual(fake.writes, []);
    assert.match(rep.problems[0].reason, /fewer than 10/);
  });

  it('removes only tonight onward', async () => {
    const fake = new FakeNKERP({ occ: occ() });
    await go([row(2, '111', T1, 'SAIFEE', ''), ...FILL], fake, { today: '2026-11-21', tab: new FakeTab([hist('SEEN', 'recorded', T1, '111')]) });
    assert.deepEqual(fake.occ.map((o) => o[2]), ['2026-11-20']);
  });

  it('leaves alone and forgets someone moved by hand', async () => {
    const fake = new FakeNKERP({ occ: placed('BURHANI', '201', '2026-11-20', '2026-11-22', 7, '111', T1) });
    const { rep, tab } = await go([row(2, '111', T1, 'SAIFEE', ''), ...FILL], fake, { tab: new FakeTab([hist('SEEN', 'recorded', T1, '111')]) });
    assert.deepEqual(fake.writes, []);
    assert.deepEqual(tab.appended.map((h) => [h.Action, h.Result]), [['CLEARED', 'recorded']]);
    assert.ok('Sheet cleared but NKERP room differs from last sync (left alone)' in rep.notes);
  });

  it('holds all deallocations when there are too many', async () => {
    const o: ReturnType<typeof placed> = [];
    const mem = [];
    for (let i = 0; i < 3; i++) {
      o.push(...placed('SAIFEE', '107', '2026-11-20', '2026-11-22', 70 + i, String(500 + i), T1));
      mem.push(hist('SEEN', 'recorded', T1, String(500 + i)));
    }
    const fake = new FakeNKERP({ occ: o });
    const { rep, tab } = await go(Array(12).fill(row(2, '999', T2)), fake, { tab: new FakeTab(mem), maxDeallocations: 2 });
    assert.deepEqual(fake.writes, []);
    assert.equal(rep.problems.filter((p) => p.action === 'deallocate').length, 3);
    assert.equal(memory([...mem, ...tab.appended], '2026-11-01').get(JSON.stringify([T1, '500']))!.room, '107');
  });

  it('mass deallocation goes through only with the explicit override', async () => {
    const o: ReturnType<typeof placed> = [];
    const mem = [];
    for (let i = 0; i < 3; i++) {
      o.push(...placed('SAIFEE', '107', '2026-11-20', '2026-11-22', 70 + i, String(500 + i), T1));
      mem.push(hist('SEEN', 'recorded', T1, String(500 + i)));
    }
    const fake = new FakeNKERP({ occ: o });
    await go(Array(12).fill(row(2, '999', T2)), fake, { tab: new FakeTab(mem), maxDeallocations: 2, allowMassDeallocation: true });
    assert.equal(fake.writes.length, 3);
  });

  it('retries a refused deallocation next run', async () => {
    const fake = new FakeNKERP({ mode: 'refused', occ: occ() });
    const { rep, tab } = await go([row(2, '111', T1, 'SAIFEE', ''), ...FILL], fake, { tab: new FakeTab([hist('SEEN', 'recorded', T1, '111')]) });
    assert.deepEqual([rep.problems.length, rep.stopped], [1, undefined]);
    const mem = memory([hist('SEEN', 'recorded', T1, '111'), ...tab.appended], '2026-11-01');
    assert.equal(mem.get(JSON.stringify([T1, '111']))!.room, '107');
  });

  it('holds deallocation but still allocates when history is not writable', async () => {
    const fake = new FakeNKERP({ apps: [app(2, T2, '222')], occ: occ() });
    const tab = new FakeTab([hist('SEEN', 'recorded', T1, '111')], 'view only');
    const { rep } = await go([row(2, '111', T1, 'SAIFEE', ''), row(3, '222', T2, 'SAIFEE', '108'), ...FILL], fake, { tab });
    assert.deepEqual(fake.writes.map(([k]) => k), ['allocate']);
    assert.deepEqual(tab.appended, []);
    assert.deepEqual(rep.history, { error: 'view only' });
  });

  it('only runs the requested actions', async () => {
    const fake = new FakeNKERP({ apps: [app(2, T2, '222')], occ: occ() });
    await go([row(2, '111', T1, 'SAIFEE', ''), row(3, '222', T2, 'SAIFEE', '108'), ...FILL], fake,
      { tab: new FakeTab([hist('SEEN', 'recorded', T1, '111')]), only: ['allocate'] });
    assert.deepEqual(fake.writes.map(([k]) => k), ['allocate']);
  });
});

describe('memory', () => {
  it('latest stateful row wins; older stays are dropped', () => {
    const rows = [hist('SEEN', 'recorded', T1, '111', 'Saifee', '107'), hist('REALLOCATE', 'held', T1, '111', 'Saifee', '108'),
      hist('DEALLOCATE', 'refused', T1, '111', '', ''), hist('SEEN', 'recorded', T1, '222', 'Saifee', '107', '2026-10-01')];
    const mem = memory(rows, '2026-11-01');
    assert.equal(mem.get(JSON.stringify([T1, '111']))!.room, '108');
    assert.ok(!mem.has(JSON.stringify([T1, '222'])));
  });
});

describe('NKERP client', () => {
  const client = (pages: any[]) => {
    const c = new NkerpClient();
    let i = 0;
    (c as any).read = async () => pages[i++];
    return c;
  };

  it('a repeated page raises', async () => {
    const a = { ApplicantinTourId: 1, TourID: 1 };
    await assert.rejects(client([{ lstAllocationApllicationDetails: [a], TotalRows: 5 },
      { lstAllocationApllicationDetails: [{ ...a }], TotalRows: 5 }]).pending(), /repeated a page/);
  });

  it('a short list raises', async () => {
    await assert.rejects(client([{ lstAllocationApllicationDetails: [{ ApplicantinTourId: 1, TourID: 1 }], TotalRows: 3 },
      { lstAllocationApllicationDetails: [], TotalRows: 3 }]).pending(), /stopped at 1 of 3/);
  });

  it('a complete list pages through', async () => {
    const c = client([{ lstAllocationApllicationDetails: [1, 2].map((i) => ({ ApplicantinTourId: i, TourID: 1 })), TotalRows: 3 },
      { lstAllocationApllicationDetails: [{ ApplicantinTourId: 3, TourID: 1 }], TotalRows: 3 }]);
    assert.equal((await c.pending()).length, 3);
  });

  it('refuses writes in a dry run and unknown endpoints', async () => {
    const c = new NkerpClient();
    await assert.rejects(c.deallocate({}), /write disabled/);
    await assert.rejects(c.write('api/property/UpdateRoomStatus', {}), /not a write endpoint/);
    await assert.rejects(c.read('api/Property/getRoomDetailsforReallocation', {}), /not a read endpoint/);
  });

  it('cookie jar keeps, replaces and expires cookies', () => {
    const jar = new CookieJar();
    const h = new Headers();
    h.append('set-cookie', 'ASP.NET_SessionId=abc; path=/; HttpOnly');
    h.append('set-cookie', 'old=1; Max-Age=0');
    jar.set('old', 'x');
    jar.absorb(h);
    jar.set('GroupId', '74');
    assert.equal(jar.header(), 'ASP.NET_SessionId=abc; GroupId=74');
  });
});

describe('commit', () => {
  it('classifies outcomes', async () => {
    assert.deepEqual(await commit(async () => ({ ReturnStatus: true }), async () => [[], 2]), ['done', null]);
    assert.deepEqual(await commit(async () => ({ ReturnStatus: false, ReturnMessage: 'locked' }), async () => [[tuple('P1', '2026-11-20')], 0]),
      ['refused', 'NKERP refused the save: save answered ReturnStatus false: locked']);
    assert.deepEqual(await commit(async () => ({ ReturnStatus: true }), async () => [[tuple('P1', '2026-11-20')], 1]),
      ['unconfirmed', "saved but readback is missing [('P1', '2026-11-20')]"]);
    const [status, detail] = await commit(async () => ({}), async () => { throw new Error('boom'); });
    assert.deepEqual([status, detail], ['unconfirmed', 'saved; readback failed (boom)']);
  });

  it('prints Python reprs', () => {
    assert.equal(pyRepr([tuple("O'Neil", '2026-11-20'), tuple('a', 'b')]), `[("O'Neil", '2026-11-20'), ('a', 'b')]`);
    assert.equal(pyRepr(['2026-11-20']), "['2026-11-20']");
  });
});

describe('app-only behaviour', () => {
  it('cancel stops before the next save and still logs what was done', async () => {
    const controller = new AbortController();
    const fake = new FakeNKERP({ apps: [app(1, T1, '111'), app(2, T2, '222')] });
    const origSave = fake.save.bind(fake);
    fake.save = async (body: any) => {
      const r = await origSave(body);
      controller.abort();          // the user presses Cancel while the first save is in flight
      return r;
    };
    const tab = new FakeTab();
    const { report } = await runSync({ apply: true, today: '2026-11-16' }, { nkerp: fake, history: tab,
      readSheet: async () => [row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T2, 'SAIFEE', '108')], signal: controller.signal });
    assert.equal(fake.writes.length, 1);
    assert.equal(report.done.length, 1);
    assert.ok(report.cancelled);
    assert.ok(tab.appended.some((h) => h.Action === 'ALLOCATE' && h.Result === 'done'));
  });

  it('a failing tour read fails the whole run before any write', async () => {
    const fake = new FakeNKERP({ apps: [app(1, T1, '111')], occ: placed('SAIFEE', '107', '2026-11-20', '2026-11-22', 7, '333', T2) });
    fake.current = async () => { throw new Error('NKERP HTTP 500 on api/Property/getRoomDetailsforDeallocation'); };
    await assert.rejects(runSync({ apply: true, today: '2026-11-16' }, { nkerp: fake, history: new FakeTab(),
      readSheet: async () => [row(2, '111', T1, 'SAIFEE', '107'), row(3, '333', T2)] }), /HTTP 500/);
    assert.deepEqual(fake.writes, []);
  });

  it('progress events describe the run', async () => {
    const events: string[] = [];
    await runSync({ apply: false, today: '2026-11-16' }, { nkerp: new FakeNKERP({ apps: [app(1, T1, '111')] }), history: new FakeTab(),
      readSheet: async () => [row(2, '111', T1, 'SAIFEE', '107')], progress: (e) => events.push(e.stage) });
    for (const stage of ['start', 'read-sheet', 'read-history', 'read-pending', 'read-tours', 'plan', 'allocate']) {
      assert.ok(events.includes(stage), stage);
    }
  });
});

describe('credentials and Google auth', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const key = { client_email: 'svc@example.iam.gserviceaccount.com', private_key: pem, private_key_id: 'kid1' };

  it('signs a verifiable RS256 JWT assertion', async () => {
    const jwt = await signAssertion(key, 'https://www.googleapis.com/auth/spreadsheets', 1_800_000_000);
    const [h, c, s] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    assert.deepEqual(header, { alg: 'RS256', typ: 'JWT', kid: 'kid1' });
    assert.deepEqual(claims, { iss: key.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600 });
    assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
  });

  it('reads the key from JSON, base64 or escaped newlines; never exposes it', () => {
    const json = JSON.stringify(key);
    assert.equal(googleServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: json }).client_email, key.client_email);
    assert.equal(googleServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(json).toString('base64') }).private_key, pem);
    const escaped = JSON.stringify({ ...key, private_key: pem.replace(/\n/g, '\\n') });
    assert.equal(googleServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: escaped }).private_key, pem);
    assert.throws(() => googleServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...key, private_key: 'x' }) }),
      /no usable private_key/);
    const status = credentialStatus({ GOOGLE_SERVICE_ACCOUNT_JSON: json });
    assert.deepEqual([status.nkerp, status.google, status.googleAccount], [false, true, key.client_email]);
    assert.ok(!JSON.stringify(status).includes('PRIVATE KEY'));
  });
});
