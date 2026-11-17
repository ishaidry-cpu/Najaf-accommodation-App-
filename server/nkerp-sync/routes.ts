/**
 * HTTP API for the "Sync to NKERP" button and the Sync tab, mounted at /api/nkerp-sync.
 *
 *   GET  /config                 what is configured (booleans + the service-account address); no auth
 *   POST /auth                   check an access key
 *   GET  /status                 running job (with its log), latest job, "needs you" items
 *   GET  /jobs, /jobs/:id        run history
 *   POST /run                    start a sync (the button) or a preview
 *   POST /cancel                 cooperative cancel
 *   GET  /events?key=            Server-Sent Events: job state, log lines, conversation messages
 *   GET  /messages               the Sync tab conversation
 *   POST /messages               send an instruction; it is interpreted and (when safe) carried out
 *   POST /messages/:id/confirm   carry out a proposal that needed confirmation
 *   POST /messages/:id/dismiss
 *
 * Every route except /config needs the access key (header x-sync-key, or ?key= for EventSource):
 * NKERP_SYNC_ACCESS_KEY when set, otherwise the app's admin PIN.
 */
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { credentialStatus } from './credentials';
import { attention } from './guidance';
import { geminiConfigured, interpret, type Proposal } from './instructions';
import { JobBusy, JobManager, listItem, type ManagerMessage, type SyncJob } from './jobManager';
import { realDeps, sheetId } from './service';
import type { RunOptions, SyncAction } from './types';
import { ALL_ACTIONS } from './types';
import { errorMessage, parseArrival, todayIn } from './util';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  jobId?: string;
  source?: 'rules' | 'gemini';
  proposal?: Proposal & { status: 'pending' | 'executed' | 'dismissed' | 'expired' | 'failed' };
}

const MAX_MESSAGES = 300;

class Conversation {
  private messages: ChatMessage[] = [];
  constructor(private readonly file: string) {
    try {
      this.messages = JSON.parse(fs.readFileSync(file, 'utf8'));
      // A proposal left pending across a restart must be re-confirmed against fresh state.
      for (const m of this.messages) if (m.proposal?.status === 'pending') m.proposal.status = 'expired';
    } catch {
      this.messages = [];
    }
  }

  all(): ChatMessage[] {
    return this.messages;
  }

  get(id: string): ChatMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  add(m: Omit<ChatMessage, 'id' | 'at'>): ChatMessage {
    const msg: ChatMessage = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), ...m };
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this.save();
    return msg;
  }

  save(): void {
    try {
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.messages), 'utf8');
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      console.error('[nkerp-sync] could not save conversation', errorMessage(err));
    }
  }
}

/** Strictly validate run options coming from a client. Throws a message for the user on anything off. */
export function validateOptions(body: any): RunOptions {
  const o: RunOptions = { apply: body?.apply === undefined ? true : body.apply === true };
  if (body?.apply !== undefined && typeof body.apply !== 'boolean') throw new Error('apply must be true or false');
  if (body?.only !== undefined) {
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

function digest(s: string): Buffer {
  return crypto.createHash('sha256').update(s).digest();
}

export interface RouterOptions {
  dataDir: string;
  adminPin: () => string | undefined;
  /** Test seams: the run dependencies and the "is the server configured" check. */
  depsFactory?: ConstructorParameters<typeof JobManager>[1];
  credentials?: typeof credentialStatus;
}

export function createNkerpSyncRouter(opts: RouterOptions): { router: express.Router; manager: JobManager } {
  const creds = opts.credentials ?? credentialStatus;
  const router = express.Router();
  const dir = path.join(opts.dataDir, 'nkerp-sync');
  fs.mkdirSync(dir, { recursive: true });
  const manager = new JobManager(opts.dataDir, opts.depsFactory ?? realDeps);
  const convo = new Conversation(path.join(dir, 'messages.json'));
  const clients = new Set<express.Response>();
  const failures = new Map<string, { count: number; resetAt: number }>();

  const accessKey = (): { key: string; source: 'env' | 'admin-pin' } | null => {
    const env = process.env.NKERP_SYNC_ACCESS_KEY?.trim();
    if (env) return { key: env, source: 'env' };
    const pin = opts.adminPin()?.trim();
    return pin ? { key: pin, source: 'admin-pin' } : null;
  };

  const auth: express.RequestHandler = (req, res, next) => {
    const ip = req.ip || 'unknown';
    const f = failures.get(ip);
    if (f && f.resetAt > Date.now() && f.count >= 10) {
      res.status(429).json({ error: 'Too many wrong access keys; try again in 15 minutes' });
      return;
    }
    const expected = accessKey();
    const given = String(req.get('x-sync-key') ?? req.query.key ?? '');
    if (!expected) {
      res.status(503).json({ error: 'No access key is configured (set NKERP_SYNC_ACCESS_KEY or an admin PIN)' });
      return;
    }
    if (given && crypto.timingSafeEqual(digest(given), digest(expected.key))) {
      failures.delete(ip);
      next();
      return;
    }
    const entry = f && f.resetAt > Date.now() ? f : { count: 0, resetAt: Date.now() + 15 * 60_000 };
    if (given) entry.count++;
    failures.set(ip, entry);
    res.status(401).json({ error: given ? 'Wrong access key' : 'Access key required' });
  };

  const send = (payload: unknown) => {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const c of clients) {
      try {
        c.write(line);
      } catch {
        clients.delete(c);
      }
    }
  };

  const account = () => creds().googleAccount;

  // Job events -> SSE, and conversation follow-ups when a job started from an instruction finishes.
  manager.subscribe((m: ManagerMessage) => {
    send(m);
    if (m.type === 'job' && m.job.status !== 'running' && m.job.trigger.source === 'instruction') {
      const job = manager.get(m.job.id);
      if (job) addAssistant(finishedText(job), { jobId: job.id });
    }
  });

  function addAssistant(text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    const msg = convo.add({ role: 'assistant', text, ...extra });
    send({ type: 'message', message: msg });
    return msg;
  }

  function finishedText(job: SyncJob): string {
    if (job.status === 'failed') return `The ${job.options.apply ? 'sync' : 'preview'} failed: ${job.error}`;
    if (!job.report) return `The run ended (${job.status}). ${job.error ?? ''}`.trim();
    const items = attention(job.report, account());
    const s = job.summary!;
    const c = job.options.apply ? s.done : s.planned;
    const head = `${job.options.apply ? 'Sync finished' : 'Preview finished (nothing was saved)'}: `
      + `${c.deallocate} deallocated, ${c.reallocate} reallocated, ${c.allocate} allocated${job.options.apply ? '' : ' would be done'}.`;
    if (!items.length) return `${head} Nothing needs you.`;
    return `${head} ${items.length} item${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} you; the top ones:\n`
      + items.slice(0, 4).map((it) => `- ${it.title}: ${it.hint}`).join('\n');
  }

  function startJob(options: RunOptions, trigger: SyncJob['trigger']): SyncJob {
    return manager.start(options, trigger);
  }

  function statusText(): string {
    const j = manager.activeJob;
    if (!j) {
      const last = manager.list(1)[0];
      return last ? `Nothing is running. The last run (${last.options.apply ? 'sync' : 'preview'}) ended ${last.status} at ${last.finishedAt ?? last.startedAt}.`
        : 'Nothing is running and there are no runs yet.';
    }
    const p = j.progress ? ` (${j.progress.current}/${j.progress.total})` : '';
    const last = j.events.filter((e) => e.level !== 'debug').slice(-1)[0];
    return `A ${j.options.apply ? 'sync' : 'preview'} is running: ${j.stage}${p}. ${last ? `Latest: ${last.message}` : ''}`.trim();
  }

  /** The user instruction a proposal answers (the latest user message before it). */
  function instructionFor(msg: ChatMessage): string | undefined {
    const all = convo.all();
    const i = all.indexOf(msg);
    return all.slice(0, i < 0 ? all.length : i).filter((m) => m.role === 'user').slice(-1)[0]?.text;
  }

  function execute(msg: ChatMessage, instruction = instructionFor(msg)): void {
    const p = msg.proposal!;
    try {
      const job = startJob(p.options!, { source: 'instruction', instruction });
      p.status = 'executed';
      msg.jobId = job.id;
      convo.save();
      send({ type: 'message', message: msg });
      addAssistant(`Started the ${p.options!.apply ? 'sync' : 'preview'}. Progress is shown above; I'll report back here when it finishes.`, { jobId: job.id });
    } catch (err) {
      p.status = 'failed';
      convo.save();
      send({ type: 'message', message: msg });
      addAssistant(err instanceof JobBusy ? 'A sync is already running. Say "status" to follow it, or "stop" to cancel it.'
        : `Could not start: ${errorMessage(err)}`);
    }
  }

  router.get('/config', (_req, res) => {
    const c = creds();
    const key = accessKey();
    const id = sheetId();
    res.json({
      configured: c.nkerp && c.google, nkerp: c.nkerp, google: c.google,
      googleAccount: c.googleAccount, problem: c.problem, sheetId: id,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, gemini: geminiConfigured(),
      keySource: key?.source ?? null, today: todayIn(), running: Boolean(manager.activeJob),
    });
  });

  router.post('/auth', auth, (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/status', auth, (_req, res) => {
    const active = manager.activeJob;
    const latest = manager.latestWithReport();
    const lastId = manager.list(2).find((j) => j.status !== 'running')?.id;
    const last = lastId ? manager.get(lastId) : null;
    res.json({
      active: active ? { ...listItem(active), events: active.events.slice(-400) } : null,
      // the most recent finished run, whatever happened to it (a failed run has no report)
      last: last ? { ...listItem(last), report: last.report, events: last.events.slice(-400) } : null,
      // the most recent run that produced a report: the source of the "needs you" list
      latest: latest ? { ...listItem(latest), report: latest.report, events: latest.events.slice(-400) } : null,
      attention: attention(latest?.report ?? null, account()),
      jobs: manager.list(20),
    });
  });

  router.get('/jobs', auth, (_req, res) => {
    res.json(manager.list(60));
  });

  router.get('/jobs/:id', auth, (req, res) => {
    const job = manager.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'No such run' });
      return;
    }
    res.json({ ...job, attention: attention(job.report, account()) });
  });

  router.post('/run', auth, (req, res) => {
    let options: RunOptions;
    try {
      options = validateOptions(req.body ?? {});
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
      return;
    }
    const c = creds();
    if (!c.nkerp || !c.google) {
      res.status(503).json({ error: `Sync is not configured on the server: ${c.problem}` });
      return;
    }
    try {
      const job = startJob(options, { source: req.body?.source === 'button' ? 'button' : 'api' });
      res.status(202).json(listItem(job));
    } catch (err) {
      if (err instanceof JobBusy) {
        res.status(409).json({ error: 'A sync is already running', jobId: err.jobId });
        return;
      }
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  router.post('/cancel', auth, (_req, res) => {
    const job = manager.cancel();
    res.json({ cancelled: Boolean(job), jobId: job?.id ?? null });
  });

  router.get('/events', auth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'hello', running: Boolean(manager.activeJob) })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* closed */
      }
    }, 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });

  router.get('/messages', auth, (_req, res) => {
    res.json(convo.all().slice(-150));
  });

  router.post('/messages', auth, async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 2000) : '';
    if (!text) {
      res.status(400).json({ error: 'Type an instruction' });
      return;
    }
    const userMsg = convo.add({ role: 'user', text });
    send({ type: 'message', message: userMsg });
    res.status(202).json(userMsg);
    const latest = manager.latestWithReport();
    let proposal: Proposal;
    try {
      proposal = await interpret(text, { today: todayIn(), running: Boolean(manager.activeJob), report: latest?.report ?? null,
        account: account() });
    } catch (err) {
      addAssistant(`I couldn't process that: ${errorMessage(err)}`);
      return;
    }
    switch (proposal.intent) {
      case 'cancel': {
        const job = manager.cancel();
        addAssistant(job ? proposal.reply : 'Nothing is running.', { source: proposal.source });
        return;
      }
      case 'status':
        addAssistant(statusText(), { source: proposal.source });
        return;
      case 'help':
      case 'explain':
      case 'unsupported':
        addAssistant(proposal.reply, { source: proposal.source });
        return;
      default: {
        const c = creds();
        if (!c.nkerp || !c.google) {
          addAssistant(`I can't run it: the sync is not configured on the server (${c.problem}).`);
          return;
        }
        if (manager.activeJob) {
          addAssistant('A sync is already running. Say "status" to follow it, or "stop" to cancel it, then ask again.');
          return;
        }
        const msg = addAssistant(proposal.needsConfirmation
          ? `${proposal.reply}.\nThis needs your confirmation before it runs.`
          : `${proposal.reply}.`, { source: proposal.source, proposal: { ...proposal, status: 'pending' } });
        if (!proposal.needsConfirmation) execute(msg, text);
      }
    }
  });

  router.post('/messages/:id/confirm', auth, (req, res) => {
    const msg = convo.get(req.params.id);
    if (!msg?.proposal || msg.proposal.status !== 'pending') {
      res.status(409).json({ error: 'That proposal is no longer pending' });
      return;
    }
    if (Date.now() - Date.parse(msg.at) > 30 * 60_000) {
      msg.proposal.status = 'expired';
      convo.save();
      send({ type: 'message', message: msg });
      res.status(409).json({ error: 'That proposal expired; ask again' });
      return;
    }
    execute(msg);
    res.json({ ok: true, jobId: msg.jobId ?? null });
  });

  router.post('/messages/:id/dismiss', auth, (req, res) => {
    const msg = convo.get(req.params.id);
    if (msg?.proposal && msg.proposal.status === 'pending') {
      msg.proposal.status = 'dismissed';
      convo.save();
      send({ type: 'message', message: msg });
    }
    res.json({ ok: true });
  });

  return { router, manager };
}
