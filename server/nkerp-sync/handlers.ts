/**
 * The Sync to NKERP HTTP API as web-standard handlers (Request in, Response out). They need no state
 * between requests, so the same code runs as Vercel Functions (api/nkerp-sync/*) and inside the app's own
 * Express server (routes.ts adapts them):
 *
 *   GET  config     what is configured (booleans and the service-account address only); never needs the key
 *   POST auth       check an access key (the sync is open when NKERP_SYNC_ACCESS_KEY is not set)
 *   POST run        run a sync or a preview; the response streams the run as NDJSON lines:
 *                     {"type":"start","job":{...}}  {"type":"event","event":{...}}  {"type":"ping"}
 *                     {"type":"done","job":{...report, summary, attention...}}
 *   GET  history    applied runs, read back from the Sheet's Sync History tab
 *   POST interpret  turn a typed instruction into a validated proposal (runs nothing itself)
 *   GET  emails       Najaf stays from today with their two accommodation-plan emails (NKERP, read only)
 *   POST emails-send  send the chosen emails; the response streams NDJSON like run
 *
 * A run lives inside its request. On hosts with a hard time limit (Vercel: 300s by default) the engine is
 * given a deadline and starts no new save after it, so the limit can never cut a save in half.
 */
import crypto from 'crypto';
import { credentialStatus } from './credentials.js';
import {
  type EmailApi, type EmailEvent, LIST_LOOKBACK_DAYS, najafSchedule, NkerpEmailClient, runEmails, validateEmailRequest,
} from './emails.js';
import { runSync, type RunDeps, type RunStats } from './engine.js';
import { attention, type AttentionItem } from './guidance.js';
import { geminiConfigured, interpret } from './instructions.js';
import { realDeps, sheetId } from './service.js';
import { HISTORY_TAB, SheetsApi, SyncHistoryTab } from './sheets.js';
import type { HistoryRow, ProgressEvent, RunOptions, SyncAction, SyncReport } from './types.js';
import { ALL_ACTIONS } from './types.js';
import { addDays, errorMessage, parseArrival, todayIn } from './util.js';
import { googleTokens } from './service.js';

export type JobStatus = 'running' | 'succeeded' | 'attention' | 'stopped' | 'failed' | 'cancelled';

export interface JobSummaryCounts {
  done: Record<string, number>;
  planned: Record<string, number>;
  problems: number;
  notes: number;
  historyRows: number | null;
}

export interface JobResult {
  id: string;
  options: RunOptions;
  trigger: { source: 'button' | 'instruction' | 'api'; instruction?: string };
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  report: SyncReport | null;
  stats: RunStats | null;
  summary: JobSummaryCounts | null;
  attention: AttentionItem[];
  error: string | null;
}

/** Test seams. */
export interface HandlerDeps {
  depsFactory?: (apply: boolean, progress: (e: ProgressEvent) => void, signal: AbortSignal) => RunDeps;
  credentials?: typeof credentialStatus;
  readHistory?: () => Promise<HistoryRow[]>;
  /** Seconds a run may last before no new save may start (0 = no limit). */
  maxSeconds?: number;
  /** NKERP for the emails page (read only when allowWrite is false). */
  emailApi?: (allowWrite: boolean, signal?: AbortSignal) => EmailApi;
  today?: () => string;
}

// ------------------------------------------------------------------------------------------------ helpers

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const failures = new Map<string, { count: number; resetAt: number }>();

/** null = allowed; otherwise the refusal to send. Open (no key asked for) when NKERP_SYNC_ACCESS_KEY is unset. */
export function checkAccess(req: Request): Response | null {
  const expected = process.env.NKERP_SYNC_ACCESS_KEY?.trim();
  if (!expected) return null;
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const f = failures.get(ip);
  if (f && f.resetAt > Date.now() && f.count >= 10) return json({ error: 'Too many wrong access keys; try again in 15 minutes' }, 429);
  const given = req.headers.get('x-sync-key') ?? '';
  const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
  if (given && crypto.timingSafeEqual(digest(given), digest(expected))) {
    failures.delete(ip);
    return null;
  }
  const entry = f && f.resetAt > Date.now() ? f : { count: 0, resetAt: Date.now() + 15 * 60_000 };
  if (given) entry.count++;
  failures.set(ip, entry);
  return json({ error: given ? 'Wrong access key' : 'Access key required' }, 401);
}

async function readJson(req: Request, limitBytes = 2_000_000): Promise<any> {
  const text = await req.text();
  if (text.length > limitBytes) throw new Error('request too large');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('request body is not JSON');
  }
}

/** Strictly validate run options coming from a client. Throws a message for the user on anything off. */
export function validateOptions(body: any): RunOptions {
  const o: RunOptions = { apply: body?.apply === undefined ? true : body.apply === true };
  if (body?.apply !== undefined && typeof body.apply !== 'boolean') throw new Error('apply must be true or false');
  if (body?.only !== undefined && body.only !== null) {
    if (!Array.isArray(body.only) || !body.only.length || !body.only.every((a: unknown) => ALL_ACTIONS.includes(a as SyncAction))) {
      throw new Error('only must list allocate, reallocate and/or deallocate');
    }
    o.only = ALL_ACTIONS.filter((a) => body.only.includes(a));
  }
  if (body?.today !== undefined && body.today !== null && body.today !== '') {
    if (typeof body.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.today) || parseArrival(body.today) !== body.today) {
      throw new Error('today must be a YYYY-MM-DD date');
    }
    o.today = body.today;
  }
  for (const end of ['from', 'to'] as const) {
    const v = body?.[end];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || parseArrival(v) !== v) {
      throw new Error(`${end} must be a YYYY-MM-DD date`);
    }
    o[end] = v;
  }
  if (o.from && o.to && o.from > o.to) throw new Error('the date range ends before it starts');
  if (o.from && o.to && addDays(o.from, 366) < o.to) throw new Error('a date range can cover at most one year');
  if (body?.limit !== undefined && body.limit !== null) {
    if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 500) throw new Error('limit must be a whole number from 1 to 500');
    o.limit = body.limit;
  }
  if (body?.maxDeallocations !== undefined && body.maxDeallocations !== null) {
    if (!Number.isInteger(body.maxDeallocations) || body.maxDeallocations < 0 || body.maxDeallocations > 5000) {
      throw new Error('maxDeallocations must be a whole number');
    }
    o.maxDeallocations = body.maxDeallocations;
  }
  for (const flag of ['allowOverCapacity', 'allowMassDeallocation'] as const) {
    if (body?.[flag] !== undefined && typeof body[flag] !== 'boolean') throw new Error(`${flag} must be true or false`);
    if (body?.[flag] === true) o[flag] = true;
  }
  const risky = o.apply && (o.allowOverCapacity || o.allowMassDeallocation || (o.maxDeallocations ?? 0) > 20);
  if (risky && body?.confirmOverrides !== true) throw new Error('safety overrides need confirmOverrides: true');
  return o;
}

export function summarize(report: SyncReport | null): JobSummaryCounts | null {
  if (!report) return null;
  const count = (list: { action: string }[]) => {
    const out: Record<string, number> = { deallocate: 0, reallocate: 0, allocate: 0 };
    for (const e of list) out[e.action] = (out[e.action] ?? 0) + 1;
    return out;
  };
  return {
    done: count(report.done), planned: count(report.planned), problems: report.problems.length,
    notes: Object.values(report.notes).reduce((n, v) => n + v.length, 0),
    historyRows: report.history?.rows_written ?? report.history?.rows_planned ?? null,
  };
}

function finalStatus(report: SyncReport): JobStatus {
  if (report.stopped) return 'stopped';
  if (report.cancelled) return 'cancelled';
  if (report.problems.length || report.history?.error) return 'attention';
  return 'succeeded';
}

function maxSeconds(d: HandlerDeps): number {
  if (d.maxSeconds !== undefined) return d.maxSeconds;
  const env = parseInt(process.env.NKERP_SYNC_MAX_SECONDS || '', 10);
  if (Number.isFinite(env) && env >= 0) return env;
  return process.env.VERCEL ? 300 : 0;
}

/** One run per server instance at a time (NKERP saves from two runs must not interleave). */
let running: string | null = null;

// ------------------------------------------------------------------------------------------------ handlers

export function handleConfig(d: HandlerDeps = {}): Response {
  const c = (d.credentials ?? credentialStatus)();
  const id = sheetId();
  return json({
    configured: c.nkerp && c.google, nkerp: c.nkerp, google: c.google, googleAccount: c.googleAccount,
    problem: c.problem, sheetId: id, sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    gemini: geminiConfigured(), keySource: process.env.NKERP_SYNC_ACCESS_KEY?.trim() ? 'env' : null,
    today: todayIn(), running: Boolean(running), maxSeconds: maxSeconds(d),
  });
}

export function handleAuth(req: Request): Response {
  return checkAccess(req) ?? json({ ok: true });
}

export async function handleRun(req: Request, d: HandlerDeps = {}): Promise<Response> {
  const denied = checkAccess(req);
  if (denied) return denied;
  let body: any;
  let options: RunOptions;
  try {
    body = await readJson(req);
    options = validateOptions(body);
  } catch (err) {
    return json({ error: errorMessage(err) }, 400);
  }
  const c = (d.credentials ?? credentialStatus)();
  if (!c.nkerp || !c.google) return json({ error: `Sync is not configured on the server: ${c.problem}` }, 503);
  if (running) return json({ error: 'A sync is already running', jobId: running }, 409);

  const started = new Date();
  const job: JobResult = {
    id: `${started.toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${crypto.randomBytes(3).toString('hex')}`,
    options,
    trigger: { source: body?.source === 'instruction' ? 'instruction' : body?.source === 'button' ? 'button' : 'api',
      ...(typeof body?.instruction === 'string' ? { instruction: body.instruction.slice(0, 500) } : {}) },
    status: 'running', startedAt: started.toISOString(), finishedAt: null, durationMs: null, report: null, stats: null,
    summary: null, attention: [], error: null,
  };
  running = job.id;
  const controller = new AbortController();
  const limit = maxSeconds(d);
  // Leave room for the last save's readback and the Sync History append before a hard time limit.
  const deadline = limit ? started.getTime() + Math.max(30, limit - 40) * 1000 : undefined;
  const encoder = new TextEncoder();
  let streamOpen = true;
  let seq = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const write = (obj: unknown) => {
        if (!streamOpen) return;
        try {
          ctrl.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          streamOpen = false;               // the browser went away; the run itself carries on safely
        }
      };
      const ping = setInterval(() => write({ type: 'ping' }), 15_000);
      const progress = (ev: ProgressEvent) => {
        const event = { ...ev, seq: ++seq, at: new Date().toISOString() };
        const line = `[nkerp-sync ${job.id}] ${ev.level.toUpperCase()} ${ev.stage}: ${ev.message}`;
        if (ev.level === 'error') console.error(line);
        else if (ev.level !== 'debug') console.log(line);
        write({ type: 'event', event });
      };
      write({ type: 'start', job });
      (async () => {
        try {
          const deps = (d.depsFactory ?? realDeps)(options.apply, progress, controller.signal);
          if (deadline) deps.deadline = deadline;
          const { report, stats } = await runSync(options, deps);
          job.report = report;
          job.stats = stats;
          job.summary = summarize(report);
          job.status = finalStatus(report);
          job.attention = attention(report, c.googleAccount);
        } catch (err) {
          job.error = errorMessage(err);
          job.status = controller.signal.aborted ? 'cancelled' : 'failed';
          progress({ level: 'error', stage: 'finish', message: job.status === 'cancelled'
            ? 'Cancelled before any save was made' : `Run failed: ${job.error}` });
        } finally {
          job.finishedAt = new Date().toISOString();
          job.durationMs = Date.now() - started.getTime();
          running = null;
          clearInterval(ping);
          write({ type: 'done', job });
          if (streamOpen) {
            streamOpen = false;
            try {
              ctrl.close();
            } catch {
              /* already closed */
            }
          }
        }
      })();
    },
    cancel() {
      // The browser pressed Stop (or left): finish the current save, start no new ones.
      streamOpen = false;
      controller.abort();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no' },
  });
}

export interface HistoryRun {
  runId: string;
  runAt: string;
  people: number;
  done: Record<string, number>;
  problems: number;
  seen: number;
  cleared: number;
}

/** Group Sync History rows into runs, newest first. */
export function groupHistory(rows: HistoryRow[], limit = 30): HistoryRun[] {
  const runs = new Map<string, HistoryRun & { its: Set<string> }>();
  for (const r of rows) {
    const id = String(r['Run ID'] ?? '').trim();
    if (!id) continue;
    let run = runs.get(id);
    if (!run) {
      run = { runId: id, runAt: String(r['Run At'] ?? ''), people: 0, done: { deallocate: 0, reallocate: 0, allocate: 0 },
        problems: 0, seen: 0, cleared: 0, its: new Set() };
      runs.set(id, run);
    }
    const action = String(r.Action ?? '').trim().toUpperCase();
    const result = String(r.Result ?? '').trim().toLowerCase();
    run.its.add(`${r['Tour ID']}|${r.ITS}`);
    if (action === 'SEEN') run.seen++;
    else if (action === 'CLEARED') run.cleared++;
    else if (result === 'done') run.done[action.toLowerCase()] = (run.done[action.toLowerCase()] ?? 0) + 1;
    else run.problems++;
  }
  return [...runs.values()].sort((a, b) => (a.runId < b.runId ? 1 : -1)).slice(0, limit)
    .map(({ its, ...run }) => ({ ...run, people: its.size }));
}

export async function handleHistory(req: Request, d: HandlerDeps = {}): Promise<Response> {
  const denied = checkAccess(req);
  if (denied) return denied;
  const c = (d.credentials ?? credentialStatus)();
  if (!c.google && !d.readHistory) return json({ runs: [], error: 'Google service account is not configured' });
  try {
    const rows = d.readHistory ? await d.readHistory() : await new SyncHistoryTab(new SheetsApi(sheetId(), googleTokens())).read();
    return json({ runs: groupHistory(rows), tab: HISTORY_TAB });
  } catch (err) {
    return json({ runs: [], error: `Could not read Sync History: ${errorMessage(err)}` });
  }
}

export async function handleInterpret(req: Request, d: HandlerDeps = {}): Promise<Response> {
  const denied = checkAccess(req);
  if (denied) return denied;
  let body: any;
  try {
    body = await readJson(req, 4_000_000);
  } catch (err) {
    return json({ error: errorMessage(err) }, 400);
  }
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 2000) : '';
  if (!text) return json({ error: 'Type an instruction' }, 400);
  const report: SyncReport | null = body?.report && typeof body.report === 'object' && Array.isArray(body.report.problems)
    ? body.report : null;
  const c = (d.credentials ?? credentialStatus)();
  try {
    const proposal = await interpret(text, { today: todayIn(), running: Boolean(body?.running) || Boolean(running),
      report, account: c.googleAccount });
    return json(proposal);
  } catch (err) {
    return json({ error: errorMessage(err) }, 500);
  }
}

// ------------------------------------------------------------------------------------------------ emails

let emailRunning = false;

function emailApi(d: HandlerDeps, allowWrite: boolean, signal?: AbortSignal): EmailApi {
  return d.emailApi ? d.emailApi(allowWrite, signal) : new NkerpEmailClient({ allowWrite, signal });
}

/** Najaf stays from today with their email state, straight from NKERP. Reads only. */
export async function handleEmailList(req: Request, d: HandlerDeps = {}): Promise<Response> {
  const denied = checkAccess(req);
  if (denied) return denied;
  const c = (d.credentials ?? credentialStatus)();
  if (!c.nkerp && !d.emailApi) return json({ error: 'The NKERP login is not configured on the server (NKERP_LOGIN_ID, NKERP_PASSWORD)' }, 503);
  const today = (d.today ?? todayIn)();
  try {
    const rows = await emailApi(d, false).tourList(addDays(today, -LIST_LOOKBACK_DAYS));
    return json({ ...najafSchedule(rows, today), running: emailRunning, readAt: new Date().toISOString() });
  } catch (err) {
    return json({ error: `Could not read NKERP: ${errorMessage(err)}` }, 502);
  }
}

/** Send the chosen accommodation emails. Streams NDJSON: start, event..., done. */
export async function handleEmailSend(req: Request, d: HandlerDeps = {}): Promise<Response> {
  const denied = checkAccess(req);
  if (denied) return denied;
  let items;
  try {
    items = validateEmailRequest(await readJson(req));
  } catch (err) {
    return json({ error: errorMessage(err) }, 400);
  }
  const c = (d.credentials ?? credentialStatus)();
  if (!c.nkerp && !d.emailApi) return json({ error: 'The NKERP login is not configured on the server (NKERP_LOGIN_ID, NKERP_PASSWORD)' }, 503);
  if (emailRunning) return json({ error: 'Emails are already being sent' }, 409);
  emailRunning = true;
  const started = Date.now();
  const limit = maxSeconds(d);
  const deadline = limit ? started + Math.max(20, limit - 30) * 1000 : undefined;
  const controller = new AbortController();
  const encoder = new TextEncoder();
  let open = true;
  let seq = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const write = (obj: unknown) => {
        if (!open) return;
        try {
          ctrl.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => write({ type: 'ping' }), 15_000);
      write({ type: 'start', total: items.length, startedAt: new Date(started).toISOString() });
      (async () => {
        let done: unknown;
        try {
          const out = await runEmails(items, {
            api: emailApi(d, true, controller.signal), today: (d.today ?? todayIn)(), signal: controller.signal, deadline,
            progress: (ev: EmailEvent) => {
              const line = `[nkerp-emails] ${ev.level.toUpperCase()}: ${ev.message}`;
              if (ev.level === 'error') console.error(line);
              else if (ev.level !== 'debug') console.log(line);
              write({ type: 'event', event: { ...ev, seq: ++seq, at: new Date().toISOString() } });
            },
          });
          done = { type: 'done', ...out, durationMs: Date.now() - started };
        } catch (err) {
          done = { type: 'done', results: [], summary: null, error: errorMessage(err), durationMs: Date.now() - started };
        } finally {
          emailRunning = false;
          clearInterval(ping);
        }
        write(done);
        if (open) {
          open = false;
          try {
            ctrl.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
    cancel() {
      open = false;
      controller.abort();          // the current send finishes; no new one starts
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no' },
  });
}

/** Route a request under /api/nkerp-sync/<name> to its handler (used by the Express adapter). */
export async function dispatch(name: string, req: Request, d: HandlerDeps = {}): Promise<Response> {
  const m = req.method.toUpperCase();
  if (name === 'config' && m === 'GET') return handleConfig(d);
  if (name === 'auth' && m === 'POST') return handleAuth(req);
  if (name === 'run' && m === 'POST') return handleRun(req, d);
  if (name === 'history' && m === 'GET') return handleHistory(req, d);
  if (name === 'interpret' && m === 'POST') return handleInterpret(req, d);
  if (name === 'emails' && m === 'GET') return handleEmailList(req, d);
  if (name === 'emails-send' && m === 'POST') return handleEmailSend(req, d);
  return json({ error: 'Not found' }, 404);
}
