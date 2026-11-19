/**
 * State for the Najaf emails page: the NKERP list, which envelopes are chosen, the page's settings, and a
 * send run that streams its outcome. Lives at the app level so a run keeps going while you change tabs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NkerpSyncState } from './useNkerpSync';
import { loadKey, loadLocal, scopeOptions, storeLocal, SyncHttpError, type SyncScope } from '../services/nkerpSync';
import {
  type EmailEvent, type EmailList, type EmailRequestItem, type EmailResult, type EmailRunSummary, emailApi, envKey,
  type NajafStay, type Recipient,
} from '../services/najafEmails';
import type { Notify } from './useNkerpSync';

export type Audience = 'operator' | 'zaereen' | 'both';

export interface EmailSettings {
  /** Who the bulk "select" buttons choose for. Each tour can still be ticked one by one. */
  audience: Audience;
  /** Which Najaf check-in dates the page shows: everything from today, one date or a range. */
  scope: SyncScope;
  /** Bulk selection includes tours only partly allotted in NKERP. */
  includePartial: boolean;
  /** Bulk selection includes emails NKERP already shows as sent (they are sent again). */
  includeSent: boolean;
}

export interface EmailRun {
  running: boolean;
  stopping: boolean;
  total: number;
  /** envKey -> outcome so far. */
  results: Record<string, EmailResult>;
  /** The envelope being sent now. */
  current: string | null;
  queue: string[];
  events: EmailEvent[];
  summary: EmailRunSummary | null;
  error: string | null;
  finishedAt: string | null;
}

export interface NajafEmailsState {
  list: EmailList | null;
  loading: boolean;
  error: string | null;
  settings: EmailSettings;
  setSettings: (patch: Partial<EmailSettings>) => void;
  /** Days shown under the current date setting. */
  days: EmailList['days'];
  selected: Set<string>;
  isSelected: (stay: string, to: Recipient) => boolean;
  toggle: (stay: NajafStay, to: Recipient) => void;
  /** Envelopes a bulk select would choose in these stays under the current settings. */
  eligible: (stays: NajafStay[], to?: Recipient) => string[];
  setMany: (keys: string[], on: boolean) => void;
  clear: () => void;
  selectedItems: (EmailRequestItem & { ref: string; date: string; partial: boolean })[];
  run: EmailRun;
  refresh: () => Promise<void>;
  send: () => Promise<void>;
  stop: () => void;
  dismissRun: () => void;
}

const EMPTY_RUN: EmailRun = { running: false, stopping: false, total: 0, results: {}, current: null, queue: [], events: [],
  summary: null, error: null, finishedAt: null };

const DEFAULT_SETTINGS: EmailSettings = {
  audience: 'both', scope: { mode: 'all', day: '', from: '', to: '' }, includePartial: false, includeSent: false,
};

export const isSent = (s: NajafStay, to: Recipient) => (to === 'operator' ? s.operatorSent : s.zaereenSent);
export const canSend = (s: NajafStay) => s.allotment !== 'none';

export function useNajafEmails(sync: NkerpSyncState, notify: Notify = () => {}): NajafEmailsState {
  const [list, setList] = useState<EmailList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<EmailSettings>(() => ({ ...DEFAULT_SETTINGS, ...loadLocal<Partial<EmailSettings>>('email-settings', {}) }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<EmailRun>(EMPTY_RUN);
  const abort = useRef<AbortController | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const setSettings = useCallback((patch: Partial<EmailSettings>) => {
    setSettingsState((cur) => {
      const next = { ...cur, ...patch };
      storeLocal('email-settings', next);
      return next;
    });
  }, []);

  const keyOrAsk = useCallback((): string | null => {
    const s = syncRef.current;
    if (s.config?.keySource === 'env' && !loadKey()) {
      s.requestKey();
      setError('Enter the sync access key to use the emails page.');
      return null;
    }
    return loadKey();
  }, []);

  const refresh = useCallback(async () => {
    const key = keyOrAsk();
    if (key === null) return;
    setLoading(true);
    setError(null);
    try {
      const l = await emailApi.list(key);
      setList(l);
      // Drop choices that no longer exist.
      const valid = new Set(l.days.flatMap((d) => d.stays.filter(canSend).flatMap((s) => [envKey(s.key, 'operator'), envKey(s.key, 'zaereen')])));
      setSelected((cur) => new Set([...cur].filter((k) => valid.has(k))));
    } catch (err) {
      if (err instanceof SyncHttpError && err.status === 401) syncRef.current.requestKey();
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [keyOrAsk]);

  const stayIndex = useMemo(() => {
    const m = new Map<string, NajafStay>();
    for (const d of list?.days ?? []) for (const s of d.stays) m.set(s.key, s);
    return m;
  }, [list]);

  const days = useMemo(() => {
    const all = list?.days ?? [];
    const o = scopeOptions(settings.scope);
    if (!o || (!o.from && !o.to)) return o ? all : [];
    return all.filter((d) => d.date >= o.from! && d.date <= o.to!);
  }, [list, settings.scope]);

  const eligible = useCallback((stays: NajafStay[], to?: Recipient) => {
    const who: Recipient[] = to ? [to] : settings.audience === 'both' ? ['operator', 'zaereen'] : [settings.audience];
    const out: string[] = [];
    for (const s of stays) {
      if (!canSend(s)) continue;
      if (s.allotment === 'partial' && !settings.includePartial) continue;
      for (const r of who) if (!isSent(s, r) || settings.includeSent) out.push(envKey(s.key, r));
    }
    return out;
  }, [settings.audience, settings.includePartial, settings.includeSent]);

  const isSelected = useCallback((stay: string, to: Recipient) => selected.has(envKey(stay, to)), [selected]);

  const toggle = useCallback((s: NajafStay, to: Recipient) => {
    if (!canSend(s)) return;
    const k = envKey(s.key, to);
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const setMany = useCallback((keys: string[], on: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const selectedItems = useMemo(() => [...selected].flatMap((k) => {
    const [stay, to] = k.split('#') as [string, Recipient];
    const s = stayIndex.get(stay);
    if (!s || !canSend(s)) return [];
    return [{ stay, to, ...(isSent(s, to) ? { resend: true } : {}), ref: s.ref, date: s.najafStart, partial: s.allotment === 'partial' }];
  }).sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : a.to === 'operator' ? -1 : 1)),
  [selected, stayIndex]);

  const send = useCallback(async () => {
    if (run.running || !selectedItems.length) return;
    const key = keyOrAsk();
    if (key === null) return;
    const items = selectedItems.map(({ stay, to, resend }) => ({ stay, to, ...(resend ? { resend } : {}) }));
    const controller = new AbortController();
    abort.current = controller;
    const queue = items.map((i) => envKey(i.stay, i.to));
    setRun({ ...EMPTY_RUN, running: true, total: items.length, queue, current: queue[0] ?? null });
    let finished = false;
    try {
      await emailApi.send(key, items, (line) => {
        if (line.type === 'event') {
          setRun((cur) => {
            const results = { ...cur.results };
            let current = cur.current;
            if (line.event.result) {
              const k = envKey(line.event.result.stay, line.event.result.to);
              results[k] = line.event.result;
              current = cur.queue.find((q) => !results[q]) ?? null;
            }
            return { ...cur, results, current, events: [...cur.events, line.event].slice(-300) };
          });
        } else if (line.type === 'done') {
          finished = true;
          const results: Record<string, EmailResult> = {};
          for (const r of line.results) results[envKey(r.stay, r.to)] = r;
          setRun((cur) => ({ ...cur, running: false, stopping: false, current: null, results: { ...cur.results, ...results },
            summary: line.summary, error: line.error ?? null, finishedAt: new Date().toISOString() }));
          // The bar on the emails page shows the outcome; a toast only when something needs a look.
          const s = line.summary;
          if (line.error) notifyRef.current(`Emails: ${line.error}`, 'error');
          else if (s && s.refused + s.uncertain) {
            notifyRef.current(`${s.confirmed + s.sent} sent, ${s.refused + s.uncertain} need a look on the Najaf emails page.`, 'info');
          }
          // The sent ones leave the selection; anything that did not go stays chosen for another try.
          const gone = new Set(line.results.filter((r) => r.outcome === 'confirmed' || r.outcome === 'sent').map((r) => envKey(r.stay, r.to)));
          setSelected((cur) => new Set([...cur].filter((k) => !gone.has(k))));
        }
      }, controller.signal);
    } catch (err) {
      setRun((cur) => ({ ...cur, running: false, stopping: false, current: null, error: (err as Error).message, finishedAt: new Date().toISOString() }));
      if (err instanceof SyncHttpError && err.status === 401) syncRef.current.requestKey();
      notifyRef.current((err as Error).message, 'error');
      finished = true;
    } finally {
      abort.current = null;
    }
    if (!finished) {
      setRun((cur) => ({ ...cur, running: false, stopping: false, current: null, finishedAt: new Date().toISOString(),
        error: controller.signal.aborted
          ? 'Stopped from this page. The email being sent finished; no new ones started.'
          : 'Lost the connection while sending. The server stops before its next email; refresh to see what went out.' }));
    }
    void refresh();
  }, [keyOrAsk, refresh, run.running, selectedItems]);

  const stop = useCallback(() => {
    if (abort.current) {
      setRun((cur) => ({ ...cur, stopping: true }));
      abort.current.abort();
    }
  }, []);

  const dismissRun = useCallback(() => setRun(EMPTY_RUN), []);

  // Warn before leaving the page mid-run.
  useEffect(() => {
    if (!run.running) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [run.running]);

  return {
    list, loading, error, settings, setSettings, days, selected, isSelected, toggle, eligible, setMany, clear,
    selectedItems, run, refresh, send, stop, dismissRun,
  };
}
