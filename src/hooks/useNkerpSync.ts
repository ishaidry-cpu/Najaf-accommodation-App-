/**
 * One shared view of the Sync to NKERP engine for the whole app: the button in the top bar and the Sync tab
 * read the same state. A run is one streamed request: its log arrives line by line while it runs, and its
 * report arrives at the end. The last run and the conversation are kept on this device; applied runs are
 * also listed from the Sheet's Sync History tab, so every device sees them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChatMessage, type HistoryRun, loadKey, loadLocal, type Proposal, type RunOptions, type RunStreamLine,
  storeKey, storeLocal, type SyncConfig, SyncHttpError, type SyncJob, syncApi,
} from '../services/nkerpSync';

export type Notify = (message: string, type?: 'success' | 'info' | 'error') => void;

const MAX_LIVE_EVENTS = 1500;
const KEEP_EVENTS = 400;
const KEEP_MESSAGES = 150;
const PROPOSAL_TTL_MS = 30 * 60_000;

export interface NkerpSyncState {
  config: SyncConfig | null;
  /** The running job with its live log, or null. */
  active: SyncJob | null;
  /** The last finished run on this device (with its report), or null. */
  last: SyncJob | null;
  /** Applied runs from the Sheet's Sync History tab, newest first. */
  history: HistoryRun[];
  historyError: string | null;
  messages: ChatMessage[];
  /** True when the server answered (the sync is reachable). */
  connected: boolean;
  needKey: boolean;
  keyError: string | null;
  busy: boolean;
  stopping: boolean;
  error: string | null;
  running: boolean;
  attentionCount: number;
  startSync: (options?: Partial<RunOptions>) => Promise<void>;
  startPreview: (options?: Partial<RunOptions>) => Promise<void>;
  cancel: () => void;
  send: (text: string) => Promise<void>;
  confirm: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
  submitKey: (key: string) => Promise<void>;
  closeKeyPrompt: () => void;
  forgetKey: () => void;
  refresh: () => Promise<void>;
  requestKey: () => void;
  hasKey: boolean;
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function finishedText(job: SyncJob): string {
  const what = job.options.apply ? 'Sync' : 'Preview';
  if (job.status === 'failed') return `The ${what.toLowerCase()} failed: ${job.error}`;
  if (!job.report || !job.summary) return `The ${what.toLowerCase()} ended (${job.status}). ${job.error ?? ''}`.trim();
  const c = job.options.apply ? job.summary.done : job.summary.planned;
  const head = `${job.options.apply ? 'Sync finished' : 'Preview finished (nothing was saved)'}: `
    + `${c.deallocate} deallocated, ${c.reallocate} reallocated, ${c.allocate} allocated${job.options.apply ? '' : ' would be done'}.`
    + (job.report.cancelled ? ` ${job.report.cancelled}.` : '');
  const items = job.attention;
  if (!items.length) return `${head} Nothing needs you.`;
  return `${head} ${items.length} item${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} you; the top ones:\n`
    + items.slice(0, 4).map((it) => `- ${it.title}: ${it.hint}`).join('\n');
}

export function useNkerpSync(notify: Notify = () => {}): NkerpSyncState {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const [key, setKey] = useState<string>(() => loadKey());
  const [active, setActive] = useState<SyncJob | null>(null);
  const [last, setLast] = useState<SyncJob | null>(() => loadLocal<SyncJob | null>('last-run', null));
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadLocal<ChatMessage[]>('messages', []));
  const [needKey, setNeedKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const keyRef = useRef(key);
  keyRef.current = key;
  const configRef = useRef(config);
  configRef.current = config;
  const activeRef = useRef(active);
  activeRef.current = active;
  const lastRef = useRef(last);
  lastRef.current = last;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const runAbort = useRef<AbortController | null>(null);
  const pending = useRef<((k: string) => Promise<void>) | null>(null);
  const syncIsOpen = config?.keySource === null;

  // ---- persistence on this device
  useEffect(() => {
    storeLocal('messages', messages.slice(-KEEP_MESSAGES));
  }, [messages]);
  useEffect(() => {
    storeLocal('last-run', last ? { ...last, events: last.events.slice(-KEEP_EVENTS) } : null);
  }, [last]);

  const addMessage = useCallback((m: Omit<ChatMessage, 'id' | 'at'>): ChatMessage => {
    const msg: ChatMessage = { id: newId(), at: new Date().toISOString(), ...m };
    setMessages((cur) => [...cur, msg].slice(-KEEP_MESSAGES));
    return msg;
  }, []);

  const patchMessage = useCallback((id: string, patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((cur) => cur.map((m) => (m.id === id ? patch(m) : m)));
  }, []);

  // ---- config (never needs a key)
  const loadConfig = useCallback(async (): Promise<SyncConfig | null> => {
    try {
      const c = await syncApi.config();
      setConfig(c);
      configRef.current = c;
      setConnected(true);
      return c;
    } catch (err) {
      setConnected(false);
      if (err instanceof SyncHttpError && err.status === 404) {
        setError('Sync to NKERP is not running on this server (it answered 404). The app must be deployed with its '
          + 'api/ functions (Vercel) or run with its own server (server.ts).');
      }
      return null;
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    const t = setInterval(() => void loadConfig(), 120_000);
    return () => clearInterval(t);
  }, [loadConfig]);

  const handleAuthError = useCallback((err: unknown, retry?: (k: string) => Promise<void>) => {
    if (err instanceof SyncHttpError && err.status === 401) {
      storeKey('');
      setKey('');
      keyRef.current = '';
      pending.current = retry ?? null;
      setKeyError(retry ? null : 'That access key was not accepted.');
      setNeedKey(true);
      return true;
    }
    return false;
  }, []);

  const loadHistory = useCallback(async () => {
    const c = configRef.current;
    if (!c || (c.keySource === 'env' && !keyRef.current)) return;
    try {
      const h = await syncApi.history(keyRef.current);
      setHistory(h.runs);
      setHistoryError(h.error ?? null);
    } catch (err) {
      if (!handleAuthError(err)) setHistoryError((err as Error).message);
    }
  }, [handleAuthError]);

  // Load the Sheet's run history once the settings are known (and again when the key changes).
  const configLoaded = config !== null;
  useEffect(() => {
    if (configLoaded && (syncIsOpen || key)) void loadHistory();
  }, [configLoaded, key, loadHistory, syncIsOpen]);

  const refresh = useCallback(async () => {
    await loadConfig();
    await loadHistory();
  }, [loadConfig, loadHistory]);

  /** Run `fn` with the key, prompting for it first when one is needed and missing. */
  const withKey = useCallback(async (fn: (k: string) => Promise<void>) => {
    let c = configRef.current;
    if (!c) {
      c = await loadConfig();
      if (!c) {
        throw new Error('Sync to NKERP is not reachable on this server (check that the app was deployed with its api/ '
          + 'functions on Vercel, or with its own server running).');
      }
    }
    const k = keyRef.current;
    if (c.keySource === 'env' && !k) {
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
  }, [handleAuthError, loadConfig]);

  /** Start a run and follow its stream until it ends. */
  const run = useCallback(async (options: Partial<RunOptions>, trigger: { source: 'button' | 'instruction'; instruction?: string },
    extra: { confirmOverrides?: boolean } = {}) => {
    if (activeRef.current || busyRef.current) {
      notifyRef.current('A sync is already running.', 'info');
      return;
    }
    setBusy(true);
    busyRef.current = true;
    setError(null);
    try {
      await withKey(async (k) => {
        const controller = new AbortController();
        runAbort.current = controller;
        let job: SyncJob | null = null;
        let finished = false;
        const onLine = (line: RunStreamLine) => {
          if (line.type === 'start') {
            job = { ...line.job, events: [], stage: 'start', progress: null };
            setActive(job);
            setBusy(false);
          } else if (line.type === 'event' && job) {
            const ev = line.event;
            const cur: SyncJob = job;
            const events = cur.events.length >= MAX_LIVE_EVENTS ? cur.events.slice(-MAX_LIVE_EVENTS + 1) : cur.events.slice();
            events.push(ev);
            job = { ...cur, events, stage: ev.level !== 'debug' ? ev.stage : cur.stage,
              progress: ev.total ? { current: ev.current ?? 0, total: ev.total } : cur.progress };
            setActive(job);
          } else if (line.type === 'done') {
            finished = true;
            const done: SyncJob = { ...line.job, events: job?.events ?? [], stage: 'finish', progress: null };
            job = done;
            setActive(null);
            setLast(done);
            const verb = done.options.apply ? 'Sync to NKERP' : 'Preview';
            if (done.status === 'succeeded') notifyRef.current(`${verb} finished: nothing needs you.`, 'success');
            else if (done.status === 'attention') {
              notifyRef.current(`${verb} finished: ${done.attention.filter((a) => a.kind !== 'note').length} item(s) need you (see Sync tab).`, 'info');
            } else notifyRef.current(`${verb} ${done.status}${done.error ? `: ${done.error}` : ''}`, 'error');
            if (done.trigger.source === 'instruction') addMessage({ role: 'assistant', text: finishedText(done), jobId: done.id });
          }
        };
        try {
          await syncApi.run(k, { ...options, ...extra, source: trigger.source, instruction: trigger.instruction }, onLine, controller.signal);
        } catch (err) {
          if (err instanceof SyncHttpError && err.status === 409) {
            notifyRef.current('A sync is already running on the server.', 'info');
            return;
          }
          if (err instanceof SyncHttpError) throw err;
          // Otherwise the connection dropped mid-run: reported below.
        } finally {
          runAbort.current = null;
          setStopping(false);
        }
        if (!finished && job) {
          const j: SyncJob = job;
          const lost: SyncJob = { ...j, status: controller.signal.aborted ? 'cancelled' : 'failed', stage: 'finish',
            finishedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(j.startedAt),
            error: controller.signal.aborted
              ? 'Stopped from this page. A save that was already running finishes and is confirmed; no new saves start. '
                + 'Applied changes appear in the Sync History tab.'
              : 'Lost the connection to the sync while it was running. The server stops before its next save, '
                + 'so nothing is left half-done; check Sync History and run it again (a rerun is safe).' };
          setActive(null);
          setLast(lost);
          if (!controller.signal.aborted) notifyRef.current('Lost the connection to the sync.', 'error');
        }
        void loadHistory();
      });
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      notifyRef.current(msg, 'error');
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }, [addMessage, loadHistory, withKey]);

  const startSync = useCallback((o: Partial<RunOptions> = {}) => run({ ...o, apply: true }, { source: 'button' }), [run]);
  const startPreview = useCallback((o: Partial<RunOptions> = {}) => run({ ...o, apply: false }, { source: 'button' }), [run]);

  const cancel = useCallback(() => {
    if (runAbort.current) {
      setStopping(true);
      runAbort.current.abort();
    }
  }, []);

  const statusText = useCallback((): string => {
    const j = activeRef.current;
    if (j) {
      const p = j.progress ? ` (${j.progress.current}/${j.progress.total})` : '';
      const latest = j.events.filter((e) => e.level !== 'debug').slice(-1)[0];
      return `A ${j.options.apply ? 'sync' : 'preview'} is running: ${j.stage}${p}.${latest ? ` Latest: ${latest.message}` : ''}`;
    }
    const l = lastRef.current;
    return l ? `Nothing is running. The last ${l.options.apply ? 'sync' : 'preview'} on this device ended ${l.status} at ${new Date(l.finishedAt ?? l.startedAt).toLocaleString()}.`
      : 'Nothing is running, and no run has been made from this device yet.';
  }, []);

  const execute = useCallback(async (msg: ChatMessage, instruction: string | undefined) => {
    const p = msg.proposal!;
    patchMessage(msg.id, (m) => ({ ...m, proposal: { ...m.proposal!, status: 'executed' } }));
    await run(p.options!, { source: 'instruction', instruction }, p.needsConfirmation ? { confirmOverrides: true } : {});
  }, [patchMessage, run]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    addMessage({ role: 'user', text: t });
    try {
      await withKey(async (k) => {
        let proposal: Proposal;
        try {
          proposal = await syncApi.interpret(k, { text: t, report: lastRef.current?.report ?? null, running: Boolean(activeRef.current) });
        } catch (err) {
          if (err instanceof SyncHttpError && err.status === 401) throw err;
          addMessage({ role: 'assistant', text: `I couldn't process that: ${(err as Error).message}` });
          return;
        }
        switch (proposal.intent) {
          case 'cancel':
            if (activeRef.current) {
              cancel();
              addMessage({ role: 'assistant', text: proposal.reply, source: proposal.source });
            } else addMessage({ role: 'assistant', text: 'Nothing is running.', source: proposal.source });
            return;
          case 'status':
            addMessage({ role: 'assistant', text: statusText(), source: proposal.source });
            return;
          case 'help':
          case 'explain':
          case 'unsupported':
            addMessage({ role: 'assistant', text: proposal.reply, source: proposal.source });
            return;
          default: {
            if (activeRef.current) {
              addMessage({ role: 'assistant', text: 'A sync is already running. Say "status" to follow it, or "stop" to cancel it, then ask again.' });
              return;
            }
            const c = configRef.current;
            if (c && !c.configured) {
              addMessage({ role: 'assistant', text: `I can't run it: the sync is not configured on the server (${c.problem}).` });
              return;
            }
            const msg = addMessage({
              role: 'assistant', source: proposal.source,
              text: proposal.needsConfirmation ? `${proposal.reply}.\nThis needs your confirmation before it runs.` : `${proposal.reply}.`,
              proposal: { ...proposal, status: 'pending' },
            });
            if (!proposal.needsConfirmation) await execute(msg, t);
          }
        }
      });
    } catch (err) {
      addMessage({ role: 'assistant', text: `I couldn't process that: ${(err as Error).message}` });
    }
  }, [addMessage, cancel, execute, statusText, withKey]);

  const confirm = useCallback(async (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg?.proposal || msg.proposal.status !== 'pending') return;
    if (Date.now() - Date.parse(msg.at) > PROPOSAL_TTL_MS) {
      patchMessage(id, (m) => ({ ...m, proposal: { ...m.proposal!, status: 'expired' } }));
      addMessage({ role: 'assistant', text: 'That proposal expired; ask again so it is checked against the latest run.' });
      return;
    }
    const i = messages.indexOf(msg);
    const instruction = messages.slice(0, i).filter((m) => m.role === 'user').slice(-1)[0]?.text;
    await execute(msg, instruction);
  }, [addMessage, execute, messages, patchMessage]);

  const dismiss = useCallback((id: string) => {
    patchMessage(id, (m) => (m.proposal?.status === 'pending' ? { ...m, proposal: { ...m.proposal, status: 'dismissed' } } : m));
  }, [patchMessage]);

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
    keyRef.current = '';
    setHistory([]);
  }, []);

  const requestKey = useCallback(() => {
    pending.current = null;
    setKeyError(null);
    setNeedKey(true);
  }, []);

  const attentionCount = useMemo(() => (last?.attention ?? []).filter((a) => a.kind !== 'note').length
    + (last && !last.report && last.error && last.status !== 'cancelled' ? 1 : 0), [last]);

  return {
    config, active, last, history, historyError, messages, connected, needKey, keyError, busy, stopping, error,
    running: Boolean(active), attentionCount, startSync, startPreview, cancel, send, confirm, dismiss, submitKey,
    closeKeyPrompt, forgetKey, refresh, requestKey, hasKey: Boolean(key) || syncIsOpen,
  };
}
