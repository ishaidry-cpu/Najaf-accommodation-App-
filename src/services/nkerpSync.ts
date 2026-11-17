/**
 * Browser client for the server's Sync to NKERP engine (/api/nkerp-sync). The engine itself runs on the
 * app's own server; the browser only starts runs, follows them live and sends instructions.
 */

export type SyncAction = 'allocate' | 'reallocate' | 'deallocate';
export type JobStatus = 'running' | 'succeeded' | 'attention' | 'stopped' | 'failed' | 'cancelled' | 'interrupted';
export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface RunOptions {
  apply: boolean;
  today?: string;
  only?: SyncAction[];
  allowOverCapacity?: boolean;
  maxDeallocations?: number;
  allowMassDeallocation?: boolean;
  limit?: number | null;
}

export interface SyncConfig {
  configured: boolean;
  nkerp: boolean;
  google: boolean;
  googleAccount: string | null;
  problem: string | null;
  sheetId: string;
  sheetUrl: string;
  gemini: boolean;
  /** 'env': an access key is required; null: the sync is open (no key set on the server). */
  keySource: 'env' | null;
  today: string;
  running: boolean;
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

export interface JobItem {
  id: string;
  options: RunOptions;
  trigger: { source: 'button' | 'instruction' | 'api'; instruction?: string };
  status: JobStatus;
  stage: string;
  progress: { current: number; total: number } | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  stats: { sheetRows: number; sheetRooms: number; historyRows: number; remembered: number; pending: number;
    toursRead: number; peopleInNkerp: number } | null;
  error: string | null;
  summary: JobSummary | null;
  problems: number;
}

export interface JobDetail extends JobItem {
  events: JobEvent[];
  report: SyncReport | null;
  attention?: AttentionItem[];
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

export interface StatusResponse {
  active: (JobItem & { events: JobEvent[] }) | null;
  last: (JobItem & { report: SyncReport | null; events: JobEvent[] }) | null;
  latest: (JobItem & { report: SyncReport | null; events: JobEvent[] }) | null;
  attention: AttentionItem[];
  jobs: JobItem[];
}

export interface Proposal {
  intent: 'sync' | 'preview' | 'cancel' | 'status' | 'explain' | 'help' | 'unsupported';
  options?: RunOptions;
  reply: string;
  overrides: string[];
  cautions?: string[];
  needsConfirmation: boolean;
  source: 'rules' | 'gemini';
  status: 'pending' | 'executed' | 'dismissed' | 'expired' | 'failed';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  jobId?: string;
  source?: 'rules' | 'gemini';
  proposal?: Proposal;
}

export type ServerMessage =
  | { type: 'hello'; running: boolean }
  | { type: 'job'; job: JobItem }
  | { type: 'event'; jobId: string; event: JobEvent }
  | { type: 'message'; message: ChatMessage };

const KEY_STORAGE = 'nkerp-sync-access-key';
const BASE = '/api/nkerp-sync';

export class SyncHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: any) {
    super(message);
  }
}

export function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function storeKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* private mode: the key lives for this page only */
  }
}

async function call<T>(path: string, key: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', ...(key ? { 'x-sync-key': key } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new SyncHttpError('The app server is not reachable', 0, null);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new SyncHttpError(body?.error || `Request failed (${res.status})`, res.status, body);
  return body as T;
}

export const syncApi = {
  config: () => call<SyncConfig>('/config', ''),
  auth: (key: string) => call<{ ok: true }>('/auth', key, { method: 'POST', body: {} }),
  status: (key: string) => call<StatusResponse>('/status', key),
  jobs: (key: string) => call<JobItem[]>('/jobs', key),
  job: (key: string, id: string) => call<JobDetail>(`/jobs/${encodeURIComponent(id)}`, key),
  run: (key: string, options: Partial<RunOptions> & { source?: string; confirmOverrides?: boolean }) =>
    call<JobItem>('/run', key, { body: options }),
  cancel: (key: string) => call<{ cancelled: boolean }>('/cancel', key, { body: {} }),
  messages: (key: string) => call<ChatMessage[]>('/messages', key),
  send: (key: string, text: string) => call<ChatMessage>('/messages', key, { body: { text } }),
  confirm: (key: string, id: string) => call<{ ok: true }>(`/messages/${encodeURIComponent(id)}/confirm`, key, { body: {} }),
  dismiss: (key: string, id: string) => call<{ ok: true }>(`/messages/${encodeURIComponent(id)}/dismiss`, key, { body: {} }),
  eventsUrl: (key: string) => `${BASE}/events?key=${encodeURIComponent(key)}`,
};
