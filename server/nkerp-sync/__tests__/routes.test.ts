/**
 * The Sync to NKERP HTTP API: the web-standard handlers the Vercel Functions call, and the same handlers
 * through the Express adapter over a real socket. The in-memory NKERP and Sync History fakes replace the
 * network.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import { runSync, type RunDeps } from '../engine';
import { dispatch, groupHistory, type HandlerDeps } from '../handlers';
import { createNkerpSyncRouter } from '../routes';
import { app as applicant, FakeNKERP, FakeTab, row, T1, T2 } from './fakes';

const KEY = 'test-access-key';
let gate: Promise<void> | null = null;          // when set, pending() waits on it (keeps a run running)
let release: (() => void) | null = null;
let lastFake: FakeNKERP;
let lastTab: FakeTab;
let applies: boolean[] = [];

const configured = () => ({ nkerp: true, problem: null });

function fakeDeps(apply: boolean, progress: RunDeps['progress'], signal: AbortSignal): RunDeps {
  applies.push(apply);
  lastFake = new FakeNKERP({ apps: [applicant(1, T1, '111'), applicant(2, T2, '222')] });
  const pending = lastFake.pending.bind(lastFake);
  lastFake.pending = async () => {
    if (gate) await gate;
    return pending();
  };
  lastTab = new FakeTab();
  return { nkerp: lastFake, history: lastTab, progress, signal,
    readSheet: async () => [row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T2, 'SAIFEE', '108')] };
}

const deps: HandlerDeps = {
  depsFactory: fakeDeps, credentials: configured, maxSeconds: 0, today: () => '2026-11-16',
  readHistory: async () => [
    { 'Run At': '2026-11-16 10:00', 'Run ID': '20261116-100000', Action: 'ALLOCATE', Result: 'done', 'Tour ID': T1, ITS: '1' },
    { 'Run At': '2026-11-16 10:00', 'Run ID': '20261116-100000', Action: 'REALLOCATE', Result: 'held', 'Tour ID': T1, ITS: '2' },
    { 'Run At': '2026-11-17 09:00', 'Run ID': '20261117-090000', Action: 'SEEN', Result: 'recorded', 'Tour ID': T2, ITS: '3' },
  ],
};

function web(path: string, init: { method?: string; body?: unknown; key?: string | null } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1' };
  if (init.key !== null) headers['x-sync-key'] = init.key ?? KEY;
  return new Request(`http://app/api/nkerp-sync/${path}`, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers,
    body: init.body ? JSON.stringify(init.body) : undefined });
}

const call = (name: string, init: Parameters<typeof web>[1] = {}) => dispatch(name, web(name, init), deps);

/** Read a run's NDJSON stream to the end. */
async function lines(res: Response): Promise<any[]> {
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  gate = null;
  release = null;
  applies = [];
  process.env.NKERP_SYNC_ACCESS_KEY = KEY;
  delete process.env.GEMINI_API_KEY;
});

after(() => {
  delete process.env.NKERP_SYNC_ACCESS_KEY;
});

describe('local sync handlers', () => {
  it('config is public, carries no secrets, and says whether a key is needed', async () => {
    const body = await (await call('config', { key: null })).json() as any;
    assert.equal(body.configured, true);
    assert.equal(body.keySource, 'env');
    assert.ok(!JSON.stringify(body).includes(KEY));
    delete process.env.NKERP_SYNC_ACCESS_KEY;
    assert.equal((await (await call('config', { key: null })).json() as {keySource:unknown}).keySource, null);
  });

  it('with a key set everything else needs it; with none set the sync is open', async () => {
    assert.equal((await call('history', { key: null })).status, 401);
    assert.equal((await call('history', { key: 'nope' })).status, 401);
    assert.equal((await call('history')).status, 200);
    delete process.env.NKERP_SYNC_ACCESS_KEY;
    assert.equal((await call('history', { key: null })).status, 200);
    assert.equal((await call('auth', { key: null, body: {} })).status, 200);
  });

  it('validates run options strictly', async () => {
    assert.equal((await call('run', { body: { today: '2026-13-01' } })).status, 400);
    assert.equal((await call('run', { body: { only: ['delete'] } })).status, 400);
    assert.equal((await call('run', { body: { limit: 0 } })).status, 400);
    const r = await call('run', { body: { allowMassDeallocation: true } });
    assert.equal(r.status, 400);
    assert.match((await r.json() as {error:string}).error, /confirmOverrides/);
  });

  it('refuses to run when the server is not configured', async () => {
    const r = await dispatch('run', web('run', { body: {} }), { ...deps,
      credentials: () => ({ nkerp: false, problem: 'NKERP login is not configured' }) });
    assert.equal(r.status, 503);
  });

  it('a run streams start, its log, and a final report', async () => {
    const res = await call('run', { body: { source: 'button' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type')!, /ndjson/);
    const out = await lines(res);
    assert.equal(out[0].type, 'start');
    assert.equal(out[0].job.status, 'running');
    assert.ok(out.some((l) => l.type === 'event' && l.event.stage === 'allocate'));
    const done = out[out.length - 1];
    assert.equal(done.type, 'done');
    assert.equal(done.job.status, 'succeeded');
    assert.equal(done.job.trigger.source, 'button');
    assert.deepEqual(done.job.summary.done, { deallocate: 0, reallocate: 0, allocate: 2 });
    assert.deepEqual(done.job.attention, []);
    assert.equal(lastFake.writes.length, 2);
    assert.equal(lastTab.appended.length, 2);
  });

  it('a preview writes nothing', async () => {
    const out = await lines(await call('run', { body: { apply: false, source: 'instruction', instruction: 'preview' } }));
    const done = out[out.length - 1].job;
    assert.deepEqual([done.options.apply, done.trigger.instruction, done.summary.planned.allocate], [false, 'preview', 2]);
    assert.deepEqual([lastFake.writes, lastTab.appended], [[], []]);
  });

  it('one run at a time', async () => {
    gate = new Promise((r) => { release = r; });
    const first = await call('run', { body: {} });
    const second = await call('run', { body: {} });
    assert.equal(second.status, 409);
    release!();
    await lines(first);
    const third = await call('run', { body: {} });
    assert.equal(third.status, 200);
    await lines(third);
  });

  it('a browser that stops reading stops the run before its next save', async () => {
    gate = new Promise((r) => { release = r; });
    const res = await call('run', { body: {} });
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    await reader.read();                    // the start line
    await reader.cancel();                  // Stop pressed / page closed
    release!();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(lastFake.writes.length, 0);
    assert.equal((await (await call('config', { key: null })).json() as {running:boolean}).running, false);
  });

  it('history groups Sync History rows into runs, newest first', async () => {
    const body = await (await call('history')).json() as any;
    assert.deepEqual(body.runs.map((r: any) => [r.runId, r.people, r.done.allocate, r.problems, r.seen]),
      [['20261117-090000', 1, 0, 0, 1], ['20261116-100000', 2, 1, 1, 0]]);
    assert.deepEqual(groupHistory([{ Action: 'SEEN' }]), []);       // rows without a Run ID are ignored
  });

  it('interpret proposes, never runs', async () => {
    const p = await (await call('interpret', { body: { text: 'the sheet is correct, sync and allow mass deallocation', report: null } })).json() as any;
    assert.equal(p.intent, 'sync');
    assert.equal(p.options.allowMassDeallocation, true);
    assert.equal(p.needsConfirmation, true);
    assert.deepEqual(applies, []);
    assert.equal((await call('interpret', { body: { text: '' } })).status, 400);
    const q = await (await call('interpret', { body: { text: 'why was 108 held?', report: {
      today: '2026-11-16', mode: 'apply', done: [], planned: [], notes: {}, skipped: {},
      problems: [{ action: 'reallocate', group: `${T1} Saifee 108`, people: ['A'], reason: `room already occupied by ${T2}: x` }] } } })).json() as any;
    assert.equal(q.intent, 'explain');
    assert.match(q.reply, /3044/);
  });

  it('locks out an address after 10 wrong keys', async () => {
    const r = (key: string) => dispatch('history', new Request('http://app/api/nkerp-sync/history', {
      headers: { 'x-sync-key': key, 'x-forwarded-for': '10.9.9.9' } }), deps);
    for (let i = 0; i < 10; i++) await r(`bad${i}`);
    assert.equal((await r(KEY)).status, 429);
  });

  it('unknown endpoints are 404', async () => {
    assert.equal((await call('jobs')).status, 404);
  });
});

describe('local sync time limit', () => {
  it('no new save starts after the deadline; the run says to sync again', async () => {
    const fake = new FakeNKERP({ apps: [applicant(1, T1, '111'), applicant(2, T2, '222')] });
    const save = fake.save.bind(fake);
    fake.save = async (b: any) => {
      await new Promise((r) => setTimeout(r, 120));
      return save(b);
    };
    const tab = new FakeTab();
    const { report } = await runSync({ apply: true, today: '2026-11-16' }, { nkerp: fake, history: tab,
      readSheet: async () => [row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T2, 'SAIFEE', '108')],
      deadline: Date.now() + 60 });
    assert.equal(fake.writes.length, 1);
    assert.equal(report.done.length, 1);
    assert.match(report.cancelled!, /time limit reached/);
    assert.ok(tab.appended.some((h) => h.Result === 'done'));          // what was done is still logged
  });

  it('a deadline that passes while reading NKERP fails the run before any save', async () => {
    const fake = new FakeNKERP({ apps: [applicant(1, T1, '111')] });
    await assert.rejects(runSync({ apply: true, today: '2026-11-16' }, { nkerp: fake, history: new FakeTab(),
      readSheet: async () => [row(2, '111', T1, 'SAIFEE', '107')], deadline: Date.now() - 1 }), /ran out of time/);
    assert.deepEqual(fake.writes, []);
  });
});

describe('Express adapter (server.ts hosts)', () => {
  let server: http.Server;
  let base: string;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/nkerp-sync', createNkerpSyncRouter(deps));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/nkerp-sync`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('serves the same API, streaming the run', async () => {
    process.env.NKERP_SYNC_ACCESS_KEY = KEY;
    assert.equal((await fetch(`${base}/config`)).status, 200);
    assert.equal((await fetch(`${base}/history`)).status, 401);
    const res = await fetch(`${base}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-key': KEY },
      body: JSON.stringify({ source: 'button' }) });
    assert.equal(res.status, 200);
    const out = await lines(res);
    assert.equal(out[out.length - 1].job.status, 'succeeded');
    assert.equal(lastFake.writes.length, 2);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});
