/**
 * Runs sync jobs one at a time and keeps their record.
 *
 *   - Single flight: NKERP saves from two runs must never interleave, so a second start is refused (409).
 *   - Every job is persisted under data/nkerp-sync/jobs/<id>.json while it runs (throttled) and when it ends,
 *     so the Sync tab survives reloads and server restarts.
 *   - A job found 'running' at start-up was interrupted by a restart: it is marked 'interrupted' with a
 *     warning to check NKERP, because a save may have been in flight.
 *   - Cancel is cooperative: the current save is allowed to finish and be confirmed; no new save starts.
 *   - Listeners (SSE clients) receive every log event and every job state change.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { runSync, type RunDeps, type RunStats } from './engine';
import type { LogLevel, ProgressEvent, RunOptions, SyncReport } from './types';
import { errorMessage } from './util';

export type JobStatus = 'running' | 'succeeded' | 'attention' | 'stopped' | 'failed' | 'cancelled' | 'interrupted';

export interface JobEvent extends ProgressEvent {
  seq: number;
  at: string;
}

export interface JobTrigger {
  source: 'button' | 'instruction' | 'api';
  instruction?: string;
}

export interface SyncJob {
  id: string;
  options: RunOptions;
  trigger: JobTrigger;
  status: JobStatus;
  stage: string;
  progress: { current: number; total: number } | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  events: JobEvent[];
  report: SyncReport | null;
  stats: RunStats | null;
  error: string | null;
  summary: JobSummaryCounts | null;
}

export interface JobSummaryCounts {
  done: Record<string, number>;
  planned: Record<string, number>;
  problems: number;
  notes: number;
  historyRows: number | null;
}

export type JobListItem = Omit<SyncJob, 'events' | 'report'> & { problems: number };

export type ManagerMessage =
  | { type: 'job'; job: JobListItem }
  | { type: 'event'; jobId: string; event: JobEvent };

const MAX_EVENTS = 3000;
const KEEP_JOBS = 60;

export class JobBusy extends Error {
  constructor(readonly jobId: string) {
    super('A sync is already running');
    this.name = 'JobBusy';
  }
}

export function summarize(report: SyncReport | null): JobSummaryCounts | null {
  if (!report) return null;
  const count = (list: { action: string }[]) => {
    const out: Record<string, number> = { deallocate: 0, reallocate: 0, allocate: 0 };
    for (const e of list) out[e.action] = (out[e.action] ?? 0) + 1;
    return out;
  };
  return {
    done: count(report.done),
    planned: count(report.planned),
    problems: report.problems.length,
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

export class JobManager {
  private readonly jobsDir: string;
  private active: { job: SyncJob; controller: AbortController } | null = null;
  private readonly listeners = new Set<(m: ManagerMessage) => void>();
  private persistTimer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(dataDir: string, private readonly depsFactory: (apply: boolean, progress: (e: ProgressEvent) => void,
    signal: AbortSignal) => RunDeps) {
    this.jobsDir = path.join(dataDir, 'nkerp-sync', 'jobs');
    fs.mkdirSync(this.jobsDir, { recursive: true });
    this.recoverInterrupted();
  }

  subscribe(fn: (m: ManagerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: ManagerMessage): void {
    for (const fn of this.listeners) {
      try {
        fn(m);
      } catch {
        /* a broken listener must not break the run */
      }
    }
  }

  get activeJob(): SyncJob | null {
    return this.active?.job ?? null;
  }

  /** Start a job; resolves once it has *started* (the run continues in the background). */
  start(options: RunOptions, trigger: JobTrigger): SyncJob {
    if (this.active) throw new JobBusy(this.active.job.id);
    const controller = new AbortController();
    const now = new Date();
    const job: SyncJob = {
      id: `${now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${crypto.randomBytes(3).toString('hex')}`,
      options, trigger, status: 'running', stage: 'start', progress: null, startedAt: now.toISOString(),
      finishedAt: null, durationMs: null, events: [], report: null, stats: null, error: null, summary: null,
    };
    this.active = { job, controller };
    this.persist(job);
    this.emit({ type: 'job', job: listItem(job) });
    void this.execute(job, controller);
    return job;
  }

  cancel(): SyncJob | null {
    if (!this.active) return null;
    if (!this.active.controller.signal.aborted) {
      this.active.controller.abort();
      this.record(this.active.job, { level: 'warn', stage: 'cancel', message: 'Cancel requested by the user' });
    }
    return this.active.job;
  }

  private record(job: SyncJob, ev: ProgressEvent): void {
    const event: JobEvent = { ...ev, seq: ++this.seq, at: new Date().toISOString() };
    job.events.push(event);
    if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
    if (ev.stage && ev.level !== 'debug') job.stage = ev.stage;
    if (ev.total) job.progress = { current: ev.current ?? 0, total: ev.total };
    // Server log: one line per event, never any credential (the engine never puts one in a message).
    const line = `[nkerp-sync ${job.id}] ${ev.level.toUpperCase()} ${ev.stage}: ${ev.message}`;
    if (ev.level === 'error') console.error(line);
    else if (ev.level !== 'debug') console.log(line);
    this.emit({ type: 'event', jobId: job.id, event });
    this.schedulePersist(job);
  }

  private async execute(job: SyncJob, controller: AbortController): Promise<void> {
    const t0 = Date.now();
    const progress = (ev: ProgressEvent) => this.record(job, ev);
    try {
      const deps = this.depsFactory(Boolean(job.options.apply), progress, controller.signal);
      const { report, stats } = await runSync(job.options, deps);
      job.report = report;
      job.stats = stats;
      job.summary = summarize(report);
      job.status = finalStatus(report);
      const level: LogLevel = job.status === 'succeeded' ? 'success' : job.status === 'stopped' ? 'error' : 'warn';
      this.record(job, { level, stage: 'finish', message: finishMessage(job) });
    } catch (err) {
      job.error = errorMessage(err);
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      this.record(job, { level: 'error', stage: 'finish',
        message: job.status === 'cancelled' ? 'Cancelled before any save was made' : `Run failed: ${job.error}` });
    } finally {
      job.finishedAt = new Date().toISOString();
      job.durationMs = Date.now() - t0;
      this.active = null;
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      this.persist(job);
      this.prune();
      this.emit({ type: 'job', job: listItem(job) });
    }
  }

  private schedulePersist(job: SyncJob): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (this.active?.job === job) this.persist(job);
    }, 1500);
    this.persistTimer.unref?.();
  }

  private file(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error('bad job id');
    return path.join(this.jobsDir, `${id}.json`);
  }

  private persist(job: SyncJob): void {
    try {
      const f = this.file(job.id);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(job), 'utf8');
      fs.renameSync(`${f}.tmp`, f);
    } catch (err) {
      console.error('[nkerp-sync] could not persist job', job.id, errorMessage(err));
    }
  }

  private prune(): void {
    const files = this.jobFiles();
    for (const f of files.slice(KEEP_JOBS)) {
      try {
        fs.unlinkSync(path.join(this.jobsDir, f));
      } catch {
        /* ignore */
      }
    }
  }

  private jobFiles(): string[] {
    try {
      return fs.readdirSync(this.jobsDir).filter((f) => f.endsWith('.json')).sort().reverse();
    } catch {
      return [];
    }
  }

  private recoverInterrupted(): void {
    for (const f of this.jobFiles()) {
      const job = this.readFile(path.join(this.jobsDir, f));
      if (job && job.status === 'running') {
        job.status = 'interrupted';
        job.finishedAt = job.finishedAt ?? new Date().toISOString();
        job.error = 'The server restarted while this run was in progress. A save may have been in flight: '
          + 'check the last group in NKERP, then run the sync again (a rerun is safe).';
        this.persist(job);
      }
    }
  }

  private readFile(f: string): SyncJob | null {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8')) as SyncJob;
    } catch {
      return null;
    }
  }

  get(id: string): SyncJob | null {
    if (this.active?.job.id === id) return this.active.job;
    try {
      return this.readFile(this.file(id));
    } catch {
      return null;
    }
  }

  list(limit = 30): JobListItem[] {
    const out: JobListItem[] = [];
    for (const f of this.jobFiles().slice(0, limit)) {
      const id = f.replace(/\.json$/, '');
      const job = this.active?.job.id === id ? this.active.job : this.readFile(path.join(this.jobsDir, f));
      if (job) out.push(listItem(job));
    }
    return out;
  }

  /** The most recent finished job that has a report (the context for instructions and the "needs you" list). */
  latestWithReport(): SyncJob | null {
    for (const f of this.jobFiles()) {
      const job = this.readFile(path.join(this.jobsDir, f));
      if (job && job.report && job.status !== 'running') return job;
    }
    return null;
  }
}

export function listItem(job: SyncJob): JobListItem {
  const { events: _e, report, ...rest } = job;
  return { ...rest, problems: report?.problems.length ?? 0 };
}

function finishMessage(job: SyncJob): string {
  const s = job.summary!;
  const r = job.report!;
  const counts = job.options.apply ? s.done : s.planned;
  const verb = job.options.apply ? 'Done' : 'Would do';
  const parts = [`${verb}: ${counts.deallocate} deallocations, ${counts.reallocate} reallocations, ${counts.allocate} allocations`];
  if (s.problems) parts.push(`${s.problems} need attention`);
  if (s.notes) parts.push(`${s.notes} notes`);
  if (r.stopped) parts.push(`STOPPED: ${r.stopped}`);
  if (r.cancelled) parts.push(r.cancelled);
  return parts.join('; ');
}
