/**
 * Browser client for the Sync to NKERP API (/api/nkerp-sync). The engine runs on the server (a Vercel
 * Function, or the app's own server); the browser starts runs, reads their live log from the streamed
 * response, and sends instructions.
 */

export type SyncAction = 'allocate' | 'reallocate' | 'deallocate';
export type JobStatus = 'running' | 'succeeded' | 'attention' | 'stopped' | 'failed' | 'cancelled';
export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface RunOptions {
  apply: boolean;
  today?: string;
  /** Only stays whose app arrival is from `from` to `to` (inclusive). One date: both the same. */
  from?: string;
  to?: string;
  only?: SyncAction[];
  allowOverCapacity?: boolean;
  maxDeallocations?: number;
  allowMassDeallocation?: boolean;
  limit?: number | null;
}

export interface SyncConfig {
  configured: boolean;
  nkerp: boolean;
  problem: string | null;
  /** 'env': an access key is required; null: the sync is open (no key set on the server). */
  keySource: 'env' | null;
  today: string;
  running: boolean;
  /** The host's time limit for one run in seconds (0 = none). */
  maxSeconds: number;
}

export interface JobEvent {
  seq: number;
  at: string;
  level: LogLevel;
  stage: string;
  message: string;
  current?: number;
  total?: number;
}

export interface ReportEntry {
  action: SyncAction;
  group: string;
  people: string[];
  dates: string[];
  by: string[];
  from?: string[];
  over_capacity?: string[];
  warning?: string;
}

export interface SyncReport {
  today: string;
  mode: 'apply' | 'dry-run';
  scope?: { from: string; to: string };
  done: ReportEntry[];
  planned: ReportEntry[];
  problems: { action: string; group: string; people: string[]; reason: string }[];
  notes: Record<string, string[]>;
  skipped: Record<string, number>;
  stopped?: string;
  cancelled?: string;
  history?: { rows_written?: number; rows_planned?: number; error?: string };
}

export interface JobSummary {
  done: Record<string, number>;
  planned: Record<string, number>;
  problems: number;
  notes: number;
  historyRows: number | null;
}

export interface AttentionItem {
  id: string;
  kind: 'stopped' | 'cancelled' | 'history' | 'problem' | 'note';
  severity: 'critical' | 'warning' | 'info';
  action: string;
  title: string;
  people: string[];
  detail: string;
  hint: string;
  suggestion: string | null;
}

export interface RunStats {
  sheetRows: number; sheetRooms: number; historyRows: number; remembered: number; pending: number;
  toursRead: number; peopleInNkerp: number;
}

/** One run as the page knows it: live while running, then with its report. */
export interface SyncJob {
  id: string;
  options: RunOptions;
  trigger: { source: 'button' | 'instruction' | 'api'; instruction?: string };
  status: JobStatus;
  stage: string;
  progress: { current: number; total: number } | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  report: SyncReport | null;
  stats: RunStats | null;
  summary: JobSummary | null;
  attention: AttentionItem[];
  error: string | null;
  events: JobEvent[];
}

/** An applied run, read back from the Sheet's Sync History tab. */
export interface HistoryRun {
  runId: string;
  runAt: string;
  people: number;
  done: Record<string, number>;
  problems: number;
  seen: number;
  cleared: number;
}

export interface Proposal {
  intent: 'sync' | 'preview' | 'cancel' | 'status' | 'explain' | 'help' | 'unsupported';
  options?: RunOptions;
  reply: string;
  overrides: string[];
  cautions?: string[];
  needsConfirmation: boolean;
  source: 'rules' | 'gemini';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  jobId?: string;
  source?: 'rules' | 'gemini';
  proposal?: Proposal & { status: 'pending' | 'executed' | 'dismissed' | 'expired' | 'failed' };
}

/** Lines of the run endpoint's NDJSON stream. */
export type RunStreamLine =
  | { type: 'start'; job: Omit<SyncJob, 'events' | 'stage' | 'progress'> }
  | { type: 'event'; event: JobEvent }
  | { type: 'ping' }
  | { type: 'done'; job: Omit<SyncJob, 'events' | 'stage' | 'progress'> };

/** Which arrivals a run covers: everything from today, one arrival date, or a range of arrival dates. */
export interface SyncScope {
  mode: 'all' | 'day' | 'range';
  day: string;
  from: string;
  to: string;
}

/** The run options for a scope, or null when the scope is incomplete (a missing or reversed date). */
export function scopeOptions(scope: SyncScope): Pick<RunOptions, 'from' | 'to'> | null {
  if (scope.mode === 'all') return {};
  if (scope.mode === 'day') return scope.day ? { from: scope.day, to: scope.day } : null;
  if (!scope.from || !scope.to || scope.from > scope.to) return null;
  return { from: scope.from, to: scope.to };
}

export function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, opts);
}

/** Plain words for a run's scope: "every arrival from today", "arrivals on Tue 25 Nov", "arrivals 20–25 Nov". */
export function scopeText(o: Pick<RunOptions, 'from' | 'to'> | null | undefined): string {
  if (!o || (!o.from && !o.to)) return 'every arrival from today';
  if (o.from && o.to && o.from === o.to) return `arrivals on ${fmtDay(o.from)}`;
  if (o.from && o.to) return `arrivals ${fmtDay(o.from, { day: 'numeric', month: 'short' })} – ${fmtDay(o.to, { day: 'numeric', month: 'short' })}`;
  return o.from ? `arrivals from ${fmtDay(o.from)}` : `arrivals up to ${fmtDay(o.to!)}`;
}

const KEY_STORAGE = 'nkerp-sync-access-key';
const BASE = '/api/nkerp-sync';

export class SyncHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: any) {
    super(message);
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadKey(): string {
  return storage()?.getItem(KEY_STORAGE) || '';
}

export function storeKey(key: string): void {
  try {
    if (key) storage()?.setItem(KEY_STORAGE, key);
    else storage()?.removeItem(KEY_STORAGE);
  } catch {
    /* private mode: the key lives for this page only */
  }
}

/** Small JSON values kept on this device (last run, conversation). */
export function loadLocal<T>(name: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(`nkerp-sync-${name}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function storeLocal(name: string, value: unknown): void {
  try {
    storage()?.setItem(`nkerp-sync-${name}`, JSON.stringify(value));
  } catch {
    /* quota or private mode: not kept */
  }
}

function headers(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(key ? { 'x-sync-key': key } : {}) };
}

async function call<T>(path: string, key: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: headers(key),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new SyncHttpError('The app server is not reachable', 0, null);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON (e.g. a host's own 404 page) */
  }
  if (!res.ok) throw new SyncHttpError(body?.error || `Request failed (${res.status})`, res.status, body);
  return body as T;
}

export const syncApi = {
  config: () => call<SyncConfig>('/config', ''),
  auth: (key: string) => call<{ ok: true }>('/auth', key, { method: 'POST', body: {} }),
  history: (key: string) => call<{ runs: HistoryRun[]; error?: string }>('/history', key),
  interpret: (key: string, body: { text: string; report: SyncReport | null; running: boolean }) =>
    call<Proposal>('/interpret', key, { body }),

  /**
   * Start a run and read its streamed log. Calls onLine for every line; resolves when the stream ends.
   * Throws SyncHttpError when the server refuses to start (bad key, already running, not configured).
   */
  async run(key: string, options: Partial<RunOptions> & { source?: string; instruction?: string; confirmOverrides?: boolean },
    onLine: (line: RunStreamLine) => void, signal: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/run`, { method: 'POST', headers: headers(key), body: JSON.stringify(options), signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      throw new SyncHttpError('The app server is not reachable', 0, null);
    }
    if (!res.ok || !res.body) {
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        /* not JSON */
      }
      throw new SyncHttpError(body?.error || `Request failed (${res.status})`, res.status, body);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            onLine(JSON.parse(line));
          } catch {
            /* a partial or foreign line: skip */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') throw err;
    }
  },
};
