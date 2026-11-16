/**
 * HTTP-level integration tests: the real Express router, job manager and conversation, over a real socket,
 * with the in-memory NKERP and Sync History fakes in place of the network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import type { RunDeps } from '../engine';
import { JobManager } from '../jobManager';
import { createNkerpSyncRouter } from '../routes';
import { app as applicant, FakeNKERP, FakeTab, row, T1, T2 } from './fakes';

const PIN = '4321';
let dataDir: string;
let server: http.Server;
let base: string;
let gate: Promise<void> | null = null;       // when set, pending() waits on it (keeps a job running)
let release: (() => void) | null = null;
let lastFake: FakeNKERP;
let lastTab: FakeTab;
let lastOptionsSeen: boolean[] = [];

const configured = () => ({ nkerp: true, google: true, googleAccount: 'svc@example.com', problem: null });

function deps(apply: boolean, progress: RunDeps['progress'], signal: AbortSignal): RunDeps {
  lastOptionsSeen.push(apply);
  lastFake = new FakeNKERP({ apps: [applicant(1, T1, '111'), applicant(2, T2, '222')] });
  const pending = lastFake.pending.bind(lastFake);
  lastFake.pending = async () => {
    if (gate) await gate;
    return pending();
  };
  lastTab = new FakeTab();
  return { nkerp: lastFake, history: lastTab, progress, signal, today: undefined,
    readSheet: async () => [row(2, '111', T1, 'SAIFEE', '107'), row(3, '222', T2, 'SAIFEE', '108')] } as RunDeps;
}

async function req(p: string, init: { method?: string; body?: unknown; key?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.key !== null) headers['x-sync-key'] = init.key ?? PIN;
  const res = await fetch(`${base}${p}`, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers,
    body: init.body ? JSON.stringify(init.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const idle = () => waitFor(async () => !(await req('/status')).body.active);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nkerp-sync-'));
  const app = express();
  app.use(express.json());
  const { router } = createNkerpSyncRouter({ dataDir, adminPin: () => PIN, depsFactory: deps, credentials: configured });
  app.use('/api/nkerp-sync', router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/nkerp-sync`;
  delete process.env.NKERP_SYNC_ACCESS_KEY;
  delete process.env.GEMINI_API_KEY;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  gate = null;
  release = null;
  lastOptionsSeen = [];
});

describe('access', () => {
  it('config is public and carries no secrets', async () => {
    const { status, body } = await req('/config', { key: null });
    assert.equal(status, 200);
    assert.equal(body.configured, true);
    assert.equal(body.keySource, 'admin-pin');
    assert.ok(!JSON.stringify(body).includes(PIN));
  });

  it('everything else needs the key; an env key replaces the admin PIN', async () => {
    assert.equal((await req('/status', { key: null })).status, 401);
    assert.equal((await req('/status', { key: 'nope' })).status, 401);
    assert.equal((await req('/status')).status, 200);
    process.env.NKERP_SYNC_ACCESS_KEY = 'long-random-key';
    try {
      assert.equal((await req('/status')).status, 401);
      assert.equal((await req('/status', { key: 'long-random-key' })).status, 200);
    } finally {
      delete process.env.NKERP_SYNC_ACCESS_KEY;
    }
  });
});

describe('runs', () => {
  it('validates options strictly', async () => {
    assert.equal((await req('/run', { body: { today: '2026-13-01' } })).status, 400);
    assert.equal((await req('/run', { body: { only: ['delete'] } })).status, 400);
    assert.equal((await req('/run', { body: { limit: 0 } })).status, 400);
    const r = await req('/run', { body: { allowMassDeallocation: true } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /confirmOverrides/);
  });

  it('the button runs a sync, one at a time, and streams it over SSE', async () => {
    gate = new Promise((r) => { release = r; });
    const events: any[] = [];
    const ac = new AbortController();
    const stream = fetch(`${base}/events?key=${PIN}`, { signal: ac.signal }).then(async (res) => {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)));
        }
      }
    }).catch(() => {});
    await waitFor(async () => events.some((e) => e.type === 'hello'));

    const first = await req('/run', { body: { source: 'button' } });
    assert.equal(first.status, 202);
    assert.equal(first.body.status, 'running');
    const second = await req('/run', { body: {} });
    assert.equal(second.status, 409);
    assert.equal(second.body.jobId, first.body.id);
    release!();
    await idle();
    const job = (await req(`/jobs/${first.body.id}`)).body;
    assert.equal(job.status, 'succeeded');
    assert.equal(job.trigger.source, 'button');
    assert.deepEqual(job.summary.done, { deallocate: 0, reallocate: 0, allocate: 2 });
    assert.equal(lastFake.writes.length, 2);
    assert.equal(lastTab.appended.length, 2);
    await waitFor(async () => events.some((e) => e.type === 'job' && e.job.status === 'succeeded'));
    assert.ok(events.some((e) => e.type === 'event' && e.event.stage === 'allocate'));
    ac.abort();
    await stream;
    // persisted for the history list
    assert.ok((await req('/jobs')).body.some((j: any) => j.id === first.body.id));
  });

  it('cancel stops a running job', async () => {
    gate = new Promise((r) => { release = r; });
    const { body } = await req('/run', { body: {} });
    await req('/cancel', { body: {} });
    release!();
    await idle();
    const job = (await req(`/jobs/${body.id}`)).body;
    assert.ok(['cancelled'].includes(job.status), job.status);
    assert.equal(lastFake.writes.length, 0);
  });
});

describe('instructions', () => {
  it('a safe instruction runs straight away and the result is reported back', async () => {
    await req('/messages', { body: { text: 'preview only allocations' } });
    await waitFor(async () => (await req('/messages')).body.some((m: any) => /Preview finished/.test(m.text)));
    assert.deepEqual(lastOptionsSeen, [false]);
    assert.equal(lastFake.writes.length, 0);
    const msgs = (await req('/messages')).body;
    const proposal = msgs.find((m: any) => m.proposal)!.proposal;
    assert.deepEqual(proposal.options, { apply: false, only: ['allocate'] });
    assert.equal(proposal.status, 'executed');
  });

  it('a safety override waits for confirmation, then runs with it', async () => {
    await req('/messages', { body: { text: 'the sheet is correct, sync and allow mass deallocation' } });
    const pending = await waitFor(async () => (await req('/messages')).body.find((m: any) => m.proposal?.status === 'pending'));
    assert.equal(pending.proposal.options.allowMassDeallocation, true);
    assert.equal(lastOptionsSeen.length, 0);
    const conf = await req(`/messages/${pending.id}/confirm`, { body: {} });
    assert.equal(conf.status, 200);
    await idle();
    const job = (await req(`/jobs/${conf.body.jobId}`)).body;
    assert.equal(job.options.allowMassDeallocation, true);
    assert.equal(job.trigger.source, 'instruction');
    assert.match(job.trigger.instruction, /allow mass deallocation/);
    assert.equal((await req(`/messages/${pending.id}/confirm`, { body: {} })).status, 409);   // not twice
  });

  it('questions are answered from the last report; status works', async () => {
    await req('/messages', { body: { text: 'what needs fixing?' } });
    await req('/messages', { body: { text: 'status' } });
    const msgs = await waitFor(async () => {
      const m = (await req('/messages')).body;
      return m.some((x: any) => /Nothing is running/.test(x.text)) && m.some((x: any) => /^Last run/.test(x.text)) && m;
    });
    assert.ok(msgs.length);
  });
});

describe('robustness', () => {
  it('locks out an address after 10 wrong keys', async () => {
    for (let i = 0; i < 10; i++) await req('/status', { key: `bad${i}` });
    assert.equal((await req('/status', { key: PIN })).status, 429);
  });

  it('a job left running by a crash is marked interrupted on start-up', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nkerp-crash-'));
    fs.mkdirSync(path.join(dir, 'nkerp-sync', 'jobs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nkerp-sync', 'jobs', '20261116T100000-abc123.json'), JSON.stringify({
      id: '20261116T100000-abc123', status: 'running', options: { apply: true }, trigger: { source: 'button' }, events: [],
      report: null, startedAt: '2026-11-16T10:00:00Z', finishedAt: null }));
    const m = new JobManager(dir, deps);
    const job = m.get('20261116T100000-abc123')!;
    assert.equal(job.status, 'interrupted');
    assert.match(job.error!, /check the last group in NKERP/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
