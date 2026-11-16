/**
 * One shared, live view of the server's Sync to NKERP engine for the whole app: the button in the top bar
 * and the Sync tab read the same state. Keeps an EventSource open (with reconnect and a status resync on
 * every reconnect so no event is lost), handles the access key, and exposes the actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChatMessage, type JobDetail, type JobEvent, type JobItem, loadKey, type RunOptions, type ServerMessage, type StatusResponse,
  storeKey, type SyncConfig, SyncHttpError, syncApi,
} from '../services/nkerpSync';

export type Notify = (message: string, type?: 'success' | 'info' | 'error') => void;

const MAX_LIVE_EVENTS = 1500;

export interface NkerpSyncState {
  config: SyncConfig | null;
  status: StatusResponse | null;
  /** The running job with its live log, or null. */
  active: (JobItem & { events: JobEvent[] }) | null;
  messages: ChatMessage[];
  connected: boolean;
  /** True when an action is waiting for the access key. */
  needKey: boolean;
  keyError: string | null;
  busy: boolean;
  error: string | null;
  running: boolean;
  attentionCount: number;
  startSync: (options?: Partial<RunOptions>) => Promise<void>;
  startPreview: (options?: Partial<RunOptions>) => Promise<void>;
  cancel: () => Promise<void>;
  send: (text: string) => Promise<void>;
  confirm: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  submitKey: (key: string) => Promise<void>;
  closeKeyPrompt: () => void;
  forgetKey: () => void;
  refresh: () => Promise<void>;
  /** Full record of one run (log + report + needs-you items), or null. */
  loadJob: (id: string) => Promise<JobDetail | null>;
  /** Show the access-key prompt (e.g. to unlock the Sync tab). */
  requestKey: () => void;
  hasKey: boolean;
}

export function useNkerpSync(notify: Notify = () => {}): NkerpSyncState {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [key, setKey] = useState<string>(() => loadKey());
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [active, setActive] = useState<(JobItem & { events: JobEvent[] }) | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [needKey, setNeedKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<((k: string) => Promise<void>) | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const keyRef = useRef(key);
  keyRef.current = key;

  // ---- config (no key needed)
  useEffect(() => {
    let alive = true;
    const load = () => syncApi.config().then((c) => alive && setConfig(c)).catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const handleAuthError = useCallback((err: unknown, retry?: (k: string) => Promise<void>) => {
    if (err instanceof SyncHttpError && err.status === 401) {
      storeKey('');
      setKey('');
      pending.current = retry ?? null;
      setKeyError(keyRef.current ? 'That access key was not accepted.' : null);
      setNeedKey(true);
      return true;
    }
    return false;
  }, []);

  const refresh = useCallback(async () => {
    const k = keyRef.current;
    if (!k) return;
    try {
      const [s, m] = await Promise.all([syncApi.status(k), syncApi.messages(k)]);
      setStatus(s);
      setActive(s.active);
      setMessages(m);
      setError(null);
    } catch (err) {
      if (!handleAuthError(err)) setError((err as Error).message);
    }
  }, [handleAuthError]);

  // ---- live stream
  useEffect(() => {
    if (!key) {
      setConnected(false);
      return;
    }
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const open = () => {
      if (closed) return;
      es = new EventSource(syncApi.eventsUrl(key));
      es.onopen = () => {
        attempts = 0;
        setConnected(true);
        void refresh();                     // resync whatever happened while disconnected
      };
      es.onmessage = (e) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'event') {
          setActive((cur) => {
            if (!cur || cur.id !== msg.jobId) return cur;
            const ev = msg.event;
            const events = cur.events.length >= MAX_LIVE_EVENTS ? cur.events.slice(-MAX_LIVE_EVENTS + 1) : cur.events.slice();
            events.push(ev);
            return {
              ...cur, events, stage: ev.level !== 'debug' ? ev.stage : cur.stage,
              progress: ev.total ? { current: ev.current ?? 0, total: ev.total } : cur.progress,
            };
          });
        } else if (msg.type === 'job') {
          const job = msg.job;
          if (job.status === 'running') {
            setActive((cur) => (cur && cur.id === job.id ? { ...cur, ...job } : { ...job, events: [] }));
          } else {
            setActive((cur) => (cur && cur.id === job.id ? null : cur));
            void refresh();
            const verb = job.options.apply ? 'Sync to NKERP' : 'Preview';
            if (job.status === 'succeeded') notifyRef.current(`${verb} finished: nothing needs you.`, 'success');
            else if (job.status === 'attention') notifyRef.current(`${verb} finished: ${job.problems} item(s) need you (see Sync tab).`, 'info');
            else notifyRef.current(`${verb} ${job.status}${job.error ? `: ${job.error}` : ''}`, 'error');
          }
        } else if (msg.type === 'message') {
          setMessages((cur) => {
            const i = cur.findIndex((m) => m.id === msg.message.id);
            if (i < 0) return [...cur, msg.message];
            const next = cur.slice();
            next[i] = msg.message;
            return next;
          });
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (closed) return;
        attempts++;
        // A rejected key closes the stream immediately: check it once before hammering the server.
        if (attempts === 2) {
          syncApi.auth(key).catch((err) => handleAuthError(err));
        }
        retry = setTimeout(open, Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)));
      };
    };
    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [key, refresh, handleAuthError]);

  /** Run `fn` with the key, prompting for it first when missing or rejected. */
  const withKey = useCallback(async (fn: (k: string) => Promise<void>) => {
    const k = keyRef.current;
    if (!k) {
      pending.current = fn;
      setKeyError(null);
      setNeedKey(true);
      return;
    }
    try {
      await fn(k);
    } catch (err) {
      if (!handleAuthError(err, fn)) throw err;
    }
  }, [handleAuthError]);

  const run = useCallback(async (options: Partial<RunOptions>, source: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await withKey(async (k) => {
        try {
          const job = await syncApi.run(k, { ...options, source });
          setActive((cur) => (cur && cur.id === job.id ? cur : { ...job, events: [] }));
          setError(null);
        } catch (err) {
          if (err instanceof SyncHttpError && err.status === 409) {
            notifyRef.current('A sync is already running.', 'info');
            await refresh();
            return;
          }
          throw err;
        }
      });
    } catch (err) {
      setError((err as Error).message);
      notifyRef.current((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, withKey, refresh]);

  const startSync = useCallback((o: Partial<RunOptions> = {}) => run({ ...o, apply: true }, 'button'), [run]);
  const startPreview = useCallback((o: Partial<RunOptions> = {}) => run({ ...o, apply: false }, 'button'), [run]);

  const simple = useCallback((fn: (k: string) => Promise<unknown>) => withKey(async (k) => {
    await fn(k);
  }).catch((err) => {
    setError((err as Error).message);
    notifyRef.current((err as Error).message, 'error');
  }), [withKey]);

  const cancel = useCallback(() => simple((k) => syncApi.cancel(k)), [simple]);
  const send = useCallback((text: string) => simple(async (k) => {
    const msg = await syncApi.send(k, text);
    setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
  }), [simple]);
  const confirm = useCallback((id: string) => simple((k) => syncApi.confirm(k, id)), [simple]);
  const dismiss = useCallback((id: string) => simple((k) => syncApi.dismiss(k, id)), [simple]);

  const submitKey = useCallback(async (candidate: string) => {
    const k = candidate.trim();
    if (!k) return;
    try {
      await syncApi.auth(k);
    } catch (err) {
      setKeyError(err instanceof SyncHttpError && err.status === 401 ? 'That access key was not accepted.' : (err as Error).message);
      return;
    }
    storeKey(k);
    keyRef.current = k;
    setKey(k);
    setNeedKey(false);
    setKeyError(null);
    const next = pending.current;
    pending.current = null;
    if (next) {
      try {
        await next(k);
      } catch (err) {
        notifyRef.current((err as Error).message, 'error');
      }
    }
  }, []);

  const closeKeyPrompt = useCallback(() => {
    pending.current = null;
    setNeedKey(false);
    setKeyError(null);
  }, []);

  const forgetKey = useCallback(() => {
    storeKey('');
    setKey('');
    setStatus(null);
    setActive(null);
    setMessages([]);
  }, []);

  const loadJob = useCallback(async (id: string): Promise<JobDetail | null> => {
    const k = keyRef.current;
    if (!k) return null;
    try {
      return await syncApi.job(k, id);
    } catch (err) {
      if (!handleAuthError(err)) notifyRef.current((err as Error).message, 'error');
      return null;
    }
  }, [handleAuthError]);

  const requestKey = useCallback(() => {
    pending.current = null;
    setKeyError(null);
    setNeedKey(true);
  }, []);

  const attentionCount = useMemo(() => (status?.attention ?? []).filter((a) => a.kind !== 'note').length, [status]);

  return {
    config, status, active, messages, connected, needKey, keyError, busy, error,
    running: Boolean(active) || Boolean(config?.running && !status),
    attentionCount, startSync, startPreview, cancel, send, confirm, dismiss, submitKey, closeKeyPrompt, forgetKey,
    refresh, loadJob, requestKey, hasKey: Boolean(key),
  };
}
