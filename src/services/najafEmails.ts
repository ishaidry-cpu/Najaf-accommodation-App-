/**
 * Browser client for the Najaf accommodation emails (/api/nkerp-sync/emails and /emails-send). The server reads
 * NKERP's "View Tour Accommodation Status" list and sends the two accommodation-plan emails; it uses the same
 * access key as Sync to NKERP.
 */
import { SyncHttpError } from './nkerpSync';

export type Recipient = 'operator' | 'zaereen';
export type Allotment = 'full' | 'partial' | 'none' | 'unknown';

export interface NajafStay {
  key: string;
  tourId: string;
  ref: string;
  operator: string;
  office: string;
  pax: number | null;
  arrival: string | null;
  departure: string | null;
  najafStart: string;
  najafEnd: string | null;
  allotment: Allotment;
  operatorSent: boolean;
  zaereenSent: boolean;
}

export interface NajafDay {
  date: string;
  stays: NajafStay[];
}

export interface EmailList {
  today: string;
  days: NajafDay[];
  excluded: string[];
  running: boolean;
  readAt: string;
}

export type EmailOutcome = 'confirmed' | 'sent' | 'refused' | 'skipped' | 'uncertain' | 'not-run';

export interface EmailResult {
  stay: string;
  to: Recipient;
  ref: string;
  najafStart: string;
  outcome: EmailOutcome;
  message: string;
}

export interface EmailRunSummary {
  requested: number;
  confirmed: number;
  sent: number;
  refused: number;
  skipped: number;
  uncertain: number;
  notRun: number;
  stopped: string | null;
}

export interface EmailEvent {
  seq: number;
  at: string;
  level: 'debug' | 'info' | 'success' | 'warn' | 'error';
  message: string;
  result?: EmailResult;
  current?: number;
  total?: number;
}

export type EmailStreamLine =
  | { type: 'start'; total: number; startedAt: string }
  | { type: 'event'; event: EmailEvent }
  | { type: 'ping' }
  | { type: 'done'; results: EmailResult[]; summary: EmailRunSummary | null; error?: string; durationMs: number };

export interface EmailRequestItem {
  stay: string;
  to: Recipient;
  resend?: boolean;
}

/** One envelope: a stay and who it goes to. */
export const envKey = (stay: string, to: Recipient) => `${stay}#${to}`;

const BASE = '/api/nkerp-sync';

function headers(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(key ? { 'x-sync-key': key } : {}) };
}

async function errorOf(res: Response): Promise<SyncHttpError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return new SyncHttpError(body?.error || `Request failed (${res.status})`, res.status, body);
}

export const emailApi = {
  async list(key: string): Promise<EmailList> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/emails`, { headers: headers(key) });
    } catch {
      throw new SyncHttpError('The app server is not reachable', 0, null);
    }
    if (!res.ok) throw await errorOf(res);
    return res.json();
  },

  /** Send emails and follow the streamed outcome. Resolves when the stream ends. */
  async send(key: string, items: EmailRequestItem[], onLine: (l: EmailStreamLine) => void, signal: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/emails-send`, { method: 'POST', headers: headers(key), body: JSON.stringify({ confirm: true, items }), signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      throw new SyncHttpError('The app server is not reachable', 0, null);
    }
    if (!res.ok || !res.body) throw await errorOf(res);
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
            /* partial or foreign line */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') throw err;
    }
  },
};
