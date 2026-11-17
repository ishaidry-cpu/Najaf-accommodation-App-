import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon, AlertTriangle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronRight, Circle, ClipboardList, Clock,
  ExternalLink, Eye, FileSpreadsheet, History, Info, KeyRound, Loader2, LogOut, MessageSquare, RefreshCcw, Send,
  ShieldAlert, Square, Terminal, User, Wifi, WifiOff, XCircle,
} from 'lucide-react';
import type { NkerpSyncState } from '../hooks/useNkerpSync';
import type {
  AttentionItem, ChatMessage, JobDetail, JobEvent, JobItem, JobStatus, LogLevel, ReportEntry, SyncReport,
} from '../services/nkerpSync';

const ACTIONS = ['deallocate', 'reallocate', 'allocate'] as const;
const ACTION_LABEL: Record<string, string> = { deallocate: 'Deallocated', reallocate: 'Reallocated', allocate: 'Allocated' };
const ACTION_PLANNED: Record<string, string> = { deallocate: 'Would deallocate', reallocate: 'Would reallocate', allocate: 'Would allocate' };
const STAGE_LABEL: Record<string, string> = {
  start: 'Starting', 'read-sheet': 'Reading the Google Sheet', 'read-history': 'Reading Sync History',
  'read-pending': 'Reading NKERP unallocated list', 'read-tours': 'Reading who is where in NKERP', plan: 'Planning',
  deallocate: 'Deallocating', reallocate: 'Reallocating', allocate: 'Allocating', history: 'Logging to Sync History',
  finish: 'Finishing', cancel: 'Cancelling',
};

const STATUS_STYLE: Record<JobStatus, { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  succeeded: { label: 'All good', cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  attention: { label: 'Needs you', cls: 'bg-orange-100 text-orange-900 border-orange-300' },
  stopped: { label: 'Stopped', cls: 'bg-rose-100 text-rose-900 border-rose-300' },
  failed: { label: 'Failed', cls: 'bg-rose-100 text-rose-900 border-rose-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-stone-200 text-stone-800 border-stone-300' },
  interrupted: { label: 'Interrupted', cls: 'bg-rose-100 text-rose-900 border-rose-300' },
};

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-stone-400', info: 'text-stone-200', success: 'text-emerald-300', warn: 'text-amber-300', error: 'text-rose-300',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function nightsLabel(dates: string[]): string {
  if (!dates.length) return '';
  const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return dates.length === 1 ? f(dates[0]) : `${f(dates[0])} – ${f(dates[dates.length - 1])} (${dates.length} nights)`;
}

const StatusPill: React.FC<{ status: JobStatus }> = ({ status }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide ${STATUS_STYLE[status].cls}`}>
    {status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
    {STATUS_STYLE[status].label}
  </span>
);

const Card: React.FC<{ title: React.ReactNode; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, icon, right, children, className = '' }) => (
  <section className={`bg-white rounded-2xl border border-[#E6DFD5] shadow-2xs overflow-hidden ${className}`}>
    <header className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[#EFE9DF] bg-[#FDFBF7]">
      <h2 className="flex items-center gap-2 text-xs font-extrabold text-[#124E39] uppercase tracking-wide">{icon}{title}</h2>
      {right}
    </header>
    {children}
  </section>
);

// ------------------------------------------------------------------------------------------------ log

const LogConsole: React.FC<{ events: JobEvent[]; live: boolean }> = ({ events, live }) => {
  const [showDebug, setShowDebug] = useState(false);
  const [filter, setFilter] = useState<'all' | 'problems'>('all');
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const shown = useMemo(() => events.filter((e) => (showDebug || e.level !== 'debug')
    && (filter === 'all' || e.level === 'warn' || e.level === 'error')), [events, showDebug, filter]);

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown.length]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-[#EFE9DF]">
        {(['all', 'problems'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-2 py-0.5 rounded-lg text-[11px] font-bold cursor-pointer ${filter === f ? 'bg-[#124E39] text-white' : 'text-stone-600 hover:bg-stone-100'}`}>
            {f === 'all' ? 'Everything' : 'Warnings & errors'}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-[11px] text-stone-600 cursor-pointer">
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> detail
        </label>
      </div>
      <div ref={box} onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="bg-[#0F1F1A] font-mono text-[11px] leading-relaxed h-64 overflow-y-auto px-3 py-2" role="log" aria-live={live ? 'polite' : 'off'}>
        {shown.length === 0 && <div className="text-stone-500">No log lines yet.</div>}
        {shown.map((e) => (
          <div key={e.seq} className={`whitespace-pre-wrap break-words ${LEVEL_STYLE[e.level]}`}>
            <span className="text-stone-500">{new Date(e.at).toLocaleTimeString(undefined, { hour12: false })} </span>
            <span className="text-stone-400">[{e.stage}]</span> {e.message}
          </div>
        ))}
        {live && <div className="text-amber-300 animate-pulse">▍</div>}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ results

const EntryRow: React.FC<{ e: ReportEntry }> = ({ e }) => (
  <li className="px-3.5 py-2 border-t border-[#F3EEE6] first:border-t-0">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-xs font-bold text-stone-900">{e.group}</span>
      {e.from && e.from.length > 0 && <span className="text-[11px] text-stone-500">from {e.from.join(', ')}</span>}
    </div>
    <div className="text-[11px] text-stone-700">{e.people.join(', ')}</div>
    <div className="flex flex-wrap gap-x-3 text-[10px] text-stone-500">
      <span>{nightsLabel(e.dates)}</span>
      {e.by.length > 0 && <span>by {e.by.join('; ')}</span>}
    </div>
    {e.warning && <div className="mt-0.5 text-[10px] font-semibold text-amber-800">⚠ {e.warning}</div>}
    {e.over_capacity && e.over_capacity.length > 0 && <div className="mt-0.5 text-[10px] font-semibold text-amber-800">Over capacity (allowed): {e.over_capacity.join('; ')}</div>}
  </li>
);

const Results: React.FC<{ report: SyncReport }> = ({ report }) => {
  const list = report.mode === 'apply' ? report.done : report.planned;
  const [open, setOpen] = useState<Record<string, boolean>>({ deallocate: true, reallocate: true, allocate: true });
  const skipped = Object.entries(report.skipped);
  return (
    <div>
      {ACTIONS.map((a) => {
        const entries = list.filter((e) => e.action === a);
        const people = entries.reduce((n, e) => n + e.people.length, 0);
        return (
          <div key={a} className="border-b border-[#EFE9DF] last:border-b-0">
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [a]: !o[a] }))}
              className="w-full flex items-center justify-between px-3.5 py-2 text-left cursor-pointer hover:bg-stone-50">
              <span className="flex items-center gap-1.5 text-xs font-bold text-stone-800">
                {open[a] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {(report.mode === 'apply' ? ACTION_LABEL : ACTION_PLANNED)[a]}
              </span>
              <span className="text-[11px] text-stone-500">{entries.length} room{entries.length === 1 ? '' : 's'} · {people} {people === 1 ? 'person' : 'people'}</span>
            </button>
            {open[a] && entries.length > 0 && <ul>{entries.map((e, i) => <EntryRow key={`${a}${i}`} e={e} />)}</ul>}
          </div>
        );
      })}
      <div className="px-3.5 py-2 text-[11px] text-stone-500 space-y-0.5 bg-[#FDFBF7]">
        {skipped.length > 0 && <div>Skipped: {skipped.map(([k, v]) => `${v} ${k}`).join(' · ')}</div>}
        {report.history?.rows_written !== undefined && <div>Sync History: {report.history.rows_written} rows logged.</div>}
        {report.history?.rows_planned !== undefined && <div>Sync History: {report.history.rows_planned} rows would be logged (preview logs nothing).</div>}
        {report.history?.error && <div className="text-rose-700 font-semibold">Sync History: {report.history.error}</div>}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ needs you

const SEVERITY_ICON = {
  critical: <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" />,
  info: <Info className="w-4 h-4 text-sky-700 shrink-0" />,
};

const NeedsYou: React.FC<{ items: AttentionItem[]; onSend: (t: string) => void; onAsk: (t: string) => void; disabled: boolean }> = ({ items, onSend, onAsk, disabled }) => {
  const [showNotes, setShowNotes] = useState(false);
  const main = items.filter((i) => i.kind !== 'note');
  const notes = items.filter((i) => i.kind === 'note');
  if (!items.length) {
    return <div className="px-3.5 py-6 text-center text-xs text-stone-600 flex flex-col items-center gap-1.5">
      <CheckCircle2 className="w-6 h-6 text-emerald-600" />Nothing needs you from the last run.
    </div>;
  }
  const render = (it: AttentionItem) => (
    <li key={it.id} className="px-3.5 py-2.5 border-t border-[#F3EEE6] first:border-t-0">
      <div className="flex gap-2">
        {SEVERITY_ICON[it.severity]}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-xs font-bold text-stone-900 break-words">
            <span className="uppercase text-[10px] text-stone-500 mr-1">{it.action}</span>{it.title}
          </div>
          {it.people.length > 0 && <div className="text-[11px] text-stone-700">{it.people.join(', ')}</div>}
          <div className="text-[11px] text-stone-600 break-words">{it.detail}</div>
          {it.hint && <div className="text-[11px] text-[#124E39] bg-emerald-50/70 border border-emerald-100 rounded-lg px-2 py-1">{it.hint}</div>}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {it.suggestion && (
              <button type="button" disabled={disabled} onClick={() => onSend(it.suggestion!)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-[#124E39] text-[#EBD59E] disabled:opacity-50 cursor-pointer">
                <ArrowRight className="w-3 h-3" />{it.suggestion}
              </button>
            )}
            <button type="button" onClick={() => onAsk(`About "${it.title}": `)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold text-stone-700 border border-stone-300 hover:bg-stone-100 cursor-pointer">
              <MessageSquare className="w-3 h-3" />Tell the sync what to do
            </button>
          </div>
        </div>
      </div>
    </li>
  );
  return (
    <div>
      {main.length > 0 ? <ul>{main.map(render)}</ul> : <div className="px-3.5 py-3 text-xs text-stone-600">No problems; only notes.</div>}
      {notes.length > 0 && (
        <div className="border-t border-[#EFE9DF]">
          <button type="button" onClick={() => setShowNotes((v) => !v)} className="w-full flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-stone-700 cursor-pointer hover:bg-stone-50">
            {showNotes ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}Notes ({notes.length})
          </button>
          {showNotes && <ul>{notes.map(render)}</ul>}
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ conversation

const EXAMPLES = ['Preview', 'Sync again', 'What needs fixing?', 'Only allocations', 'Status', 'Help'];

const ProposalCard: React.FC<{ m: ChatMessage; onConfirm: () => void; onDismiss: () => void; running: boolean }> = ({ m, onConfirm, onDismiss, running }) => {
  const p = m.proposal!;
  const needs = p.status === 'pending' && p.needsConfirmation;
  return (
    <div className={`mt-1.5 rounded-xl border px-2.5 py-2 text-[11px] ${needs ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-stone-50'}`}>
      {p.overrides.length > 0 && (
        <ul className="mb-1 space-y-0.5">
          {p.overrides.map((o) => <li key={o} className="flex gap-1 text-amber-900 font-semibold"><ShieldAlert className="w-3.5 h-3.5 shrink-0" />{o}</li>)}
        </ul>
      )}
      {p.cautions && p.cautions.length > 0 && (
        <ul className="mb-1 space-y-0.5">{p.cautions.map((c) => <li key={c} className="flex gap-1 text-stone-700"><Info className="w-3.5 h-3.5 shrink-0" />{c}</li>)}</ul>
      )}
      <div className="flex items-center gap-2">
        <span className="font-bold text-stone-600 uppercase text-[10px]">
          {p.status === 'pending' ? (needs ? 'Waiting for you' : 'Starting…') : p.status === 'executed' ? 'Started' : p.status}
        </span>
        {needs && (
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={onDismiss} className="px-2 py-0.5 rounded-lg font-bold text-stone-700 hover:bg-stone-200 cursor-pointer">Dismiss</button>
            <button type="button" onClick={onConfirm} disabled={running}
              className="px-2 py-0.5 rounded-lg font-bold bg-[#124E39] text-[#EBD59E] disabled:opacity-50 cursor-pointer">Confirm and run</button>
          </span>
        )}
      </div>
    </div>
  );
};

const Conversation: React.FC<{ sync: NkerpSyncState; draft: string; setDraft: (s: string) => void; inputRef: React.RefObject<HTMLTextAreaElement | null> }> = ({ sync, draft, setDraft, inputRef }) => {
  const box = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [sync.messages.length, sync.messages[sync.messages.length - 1]?.proposal?.status]);

  const submit = async (text = draft) => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await sync.send(t);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div ref={box} className="h-80 lg:h-[26rem] overflow-y-auto px-3 py-3 space-y-2.5 bg-[#FDFBF7]">
        {sync.messages.length === 0 && (
          <div className="text-xs text-stone-600 leading-relaxed">
            Type what should be done in plain words: <em>"preview tomorrow"</em>, <em>"only allocations"</em>, <em>"why was Saifee 107 held?"</em>,
            {' '}<em>"the sheet is correct, allow the deallocations"</em>. Safe requests run straight away; anything that loosens a safety rule asks you to confirm first.
          </div>
        )}
        {sync.messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role === 'assistant' && <Bot className="w-5 h-5 text-[#124E39] shrink-0 mt-0.5" />}
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.role === 'user'
              ? 'bg-[#124E39] text-white rounded-br-sm' : 'bg-white border border-[#E6DFD5] text-stone-800 rounded-bl-sm'}`}>
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              {m.proposal && (m.proposal.intent === 'sync' || m.proposal.intent === 'preview') && (
                <ProposalCard m={m} running={sync.running} onConfirm={() => void sync.confirm(m.id)} onDismiss={() => void sync.dismiss(m.id)} />
              )}
              <div className={`mt-1 text-[9px] ${m.role === 'user' ? 'text-emerald-200' : 'text-stone-400'}`}>
                {fmtTime(m.at)}{m.source === 'gemini' ? ' · Gemini' : ''}
              </div>
            </div>
            {m.role === 'user' && <User className="w-5 h-5 text-stone-500 shrink-0 mt-0.5" />}
          </div>
        ))}
      </div>
      <div className="border-t border-[#EFE9DF] p-2.5 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => void submit(x)} disabled={sending}
              className="px-2 py-0.5 rounded-full border border-stone-300 text-[11px] font-semibold text-stone-700 hover:bg-stone-100 cursor-pointer disabled:opacity-50">{x}</button>
          ))}
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder="Tell the sync what to do…"
            aria-label="Instruction for the sync"
            className="flex-1 resize-none rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#124E39]/40"
          />
          <button type="submit" disabled={!draft.trim() || sending}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-[#124E39] text-[#EBD59E] disabled:opacity-40 cursor-pointer" aria-label="Send">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ view

const Setup: React.FC<{ sync: NkerpSyncState }> = ({ sync }) => {
  const c = sync.config;
  if (!c || c.configured) return null;
  const Row = ({ ok, label, children }: { ok: boolean; label: string; children: React.ReactNode }) => (
    <li className="flex gap-2">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-600 shrink-0" />}
      <div><span className="font-bold">{label}</span> <span className="text-stone-600">{children}</span></div>
    </li>
  );
  return (
    <Card title="Set up the sync" icon={<ShieldAlert className="w-4 h-4" />}>
      <ul className="p-3.5 space-y-2 text-xs">
        <Row ok={c.nkerp} label="NKERP login">server secrets <code>NKERP_LOGIN_ID</code> and <code>NKERP_PASSWORD</code> (an account with the Tour and Accomodation Admin role).</Row>
        <Row ok={c.google} label="Google service account">server secret <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (the key file's JSON), then share the Sheet with that account as <b>Editor</b>.</Row>
        <Row ok={c.keySource === 'env'} label="Access key">server secret <code>NKERP_SYNC_ACCESS_KEY</code> (recommended; without it the admin PIN is used).</Row>
        <Row ok={c.gemini} label="Plain-language instructions (optional)">server secret <code>GEMINI_API_KEY</code>; without it, the built-in instruction rules are used.</Row>
      </ul>
    </Card>
  );
};

export const NkerpSyncView: React.FC<{ sync: NkerpSyncState }> = ({ sync }) => {
  const [selected, setSelected] = useState<JobDetail | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { config, status, active } = sync;

  useEffect(() => {
    if (sync.hasKey) void sync.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.hasKey]);

  // When a new run starts, follow it rather than an old selection.
  useEffect(() => {
    if (active) setSelected(null);
  }, [active?.id]);

  const latest = status?.latest ?? null;
  const last = status?.last ?? latest;
  const shownJob: (JobItem & { events: JobEvent[]; report?: SyncReport | null }) | null = active ?? selected ?? last;
  const shownReport = selected ? selected.report : active ? null : last?.report ?? null;
  const attentionItems = selected ? selected.attention ?? [] : status?.attention ?? [];
  const attentionFrom = !selected && latest && last && latest.id !== last.id ? latest : null;
  const failedLast = !selected && !active && last && !last.report && last.error && last.status !== 'cancelled' ? last : null;
  const shownAttention: AttentionItem[] = failedLast
    ? [{ id: 'failed-last', kind: 'stopped', severity: 'critical', action: last!.options.apply ? 'sync' : 'preview',
      title: `The latest ${last!.options.apply ? 'sync' : 'preview'} ${last!.status} before planning anything`, people: [],
      detail: failedLast.error!, hint: 'Nothing was saved. See the run above for what to check, then run it again.',
      suggestion: last!.options.apply ? 'Sync again' : 'Preview' }, ...attentionItems]
    : attentionItems;

  const ask = (prefix: string) => {
    setDraft(prefix);
    setTimeout(() => inputRef.current?.focus(), 20);
  };

  if (!sync.hasKey) {
    return (
      <div className="max-w-xl mx-auto mt-6 space-y-3">
        <Setup sync={sync} />
        <Card title="Sync to NKERP" icon={<KeyRound className="w-4 h-4" />}>
          <div className="p-4 text-xs text-stone-700 space-y-3">
            <p>The sync log, run history and instructions are protected. Enter the access key once on this device to open them.</p>
            <button type="button" onClick={sync.requestKey}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#124E39] text-[#EBD59E] cursor-pointer">Enter access key</button>
          </div>
        </Card>
      </div>
    );
  }

  const progress = active?.progress;
  const pct = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : null;
  const summary = shownJob?.summary;
  const counts = summary ? (shownJob!.options.apply ? summary.done : summary.planned) : null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold text-[#124E39] flex items-center gap-2"><RefreshCcw className="w-5 h-5" />Sync to NKERP</h1>
          <p className="text-[11px] text-stone-600">
            Najaf rooms in NKERP brought in line with the Google Sheet: deallocate, then reallocate, then allocate. Runs on this app's server; Karbala and other tabs are never touched.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span title={sync.connected ? 'Live updates connected' : 'Live updates reconnecting'}
            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border ${sync.connected ? 'text-emerald-800 border-emerald-200 bg-emerald-50' : 'text-stone-600 border-stone-300 bg-stone-100'}`}>
            {sync.connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}{sync.connected ? 'Live' : 'Offline'}
          </span>
          {config && (
            <a href={config.sheetUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-emerald-900 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100">
              <FileSpreadsheet className="w-3.5 h-3.5" />Sheet<ExternalLink className="w-3 h-3" />
            </a>
          )}
          {sync.running ? (
            <button type="button" onClick={() => void sync.cancel()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-rose-700 hover:bg-rose-800 text-white cursor-pointer">
              <Square className="w-3.5 h-3.5" />Stop after current save
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void sync.startPreview()} disabled={sync.busy || !config?.configured}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-50 cursor-pointer">
                <Eye className="w-3.5 h-3.5" />Preview
              </button>
              <button type="button" onClick={() => void sync.startSync()} disabled={sync.busy || !config?.configured}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-[#0E3C2C] hover:bg-[#124E39] text-[#EBD59E] border border-[#C5A059]/50 disabled:opacity-50 cursor-pointer">
                {sync.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}Sync to NKERP
              </button>
            </>
          )}
          <button type="button" onClick={sync.forgetKey} title="Sign this device out of the sync"
            className="p-1.5 rounded-lg text-stone-500 hover:text-rose-700 hover:bg-stone-100 cursor-pointer" aria-label="Sign out of sync">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {sync.error && <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">{sync.error}</div>}
      <Setup sync={sync} />

      {/* Current / selected run */}
      {shownJob ? (
        <Card
          title={active ? 'Running now' : selected ? 'Selected run' : 'Last run'}
          icon={<Terminal className="w-4 h-4" />}
          right={<div className="flex items-center gap-2">
            <StatusPill status={shownJob.status} />
            {selected && <button type="button" onClick={() => setSelected(null)} className="text-[11px] font-bold text-stone-600 hover:underline cursor-pointer">Back to latest</button>}
          </div>}
        >
          <div className="px-3.5 py-2.5 space-y-2 border-b border-[#EFE9DF]">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-600">
              <span className="font-bold text-stone-800">{shownJob.options.apply ? 'Sync' : 'Preview (nothing saved)'}</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtTime(shownJob.startedAt)}{shownJob.durationMs ? ` · ${fmtDuration(shownJob.durationMs)}` : ''}</span>
              {shownJob.trigger.instruction && <span>“{shownJob.trigger.instruction}”</span>}
              {shownJob.options.only && <span>only {shownJob.options.only.join(', ')}</span>}
              {shownJob.options.today && <span>from {shownJob.options.today}</span>}
              {shownJob.options.allowOverCapacity && <span className="text-amber-800 font-bold">over capacity allowed</span>}
              {shownJob.options.allowMassDeallocation && <span className="text-amber-800 font-bold">mass deallocation allowed</span>}
            </div>
            {active && (
              <div>
                <div className="flex justify-between text-[11px] font-bold text-stone-700">
                  <span>{STAGE_LABEL[active.stage] ?? active.stage}</span>
                  {progress && <span>{progress.current} / {progress.total}</span>}
                </div>
                <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden mt-1">
                  <div className={`h-full bg-[#124E39] transition-all duration-500 ${pct === null ? 'w-1/3 animate-pulse' : ''}`} style={pct !== null ? { width: `${pct}%` } : undefined} />
                </div>
              </div>
            )}
            {counts && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ACTIONS.map((a) => (
                  <div key={a} className="rounded-xl bg-stone-50 border border-stone-200 px-2.5 py-1.5">
                    <div className="text-[10px] uppercase font-bold text-stone-500">{(shownJob.options.apply ? ACTION_LABEL : ACTION_PLANNED)[a]}</div>
                    <div className="text-lg font-extrabold text-stone-900">{counts[a] ?? 0}</div>
                  </div>
                ))}
                <div className={`rounded-xl border px-2.5 py-1.5 ${summary!.problems ? 'bg-orange-50 border-orange-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <div className="text-[10px] uppercase font-bold text-stone-500">Need you</div>
                  <div className="text-lg font-extrabold text-stone-900">{summary!.problems}</div>
                </div>
              </div>
            )}
            {shownJob.stats && (
              <div className="text-[10px] text-stone-500">
                Sheet {shownJob.stats.sheetRows} rows ({shownJob.stats.sheetRooms} with a room) · NKERP {shownJob.stats.pending} unallocated, {shownJob.stats.peopleInNkerp} allocated across {shownJob.stats.toursRead} tours · {shownJob.stats.remembered} remembered from Sync History
              </div>
            )}
            {shownJob.error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-900">
                <div className="font-bold">{shownJob.error}</div>
                {/could not reach to\.najafkarbala\.com/.test(shownJob.error) && <div>NKERP did not answer from this server. Check NKERP is up and that the server can reach to.najafkarbala.com, then sync again. Nothing was saved.</div>}
                {/sheets\.googleapis|oauth2\.googleapis|Google/.test(shownJob.error) && <div>The Google Sheet could not be read. Check the service account key and that the Sheet is shared with it. Nothing was saved.</div>}
                {/NKERP login failed|role is missing/.test(shownJob.error) && <div>Check the NKERP login configured on the server (NKERP_LOGIN_ID / NKERP_PASSWORD) and that it has the Tour and Accomodation Admin role. Nothing was saved.</div>}
              </div>
            )}
          </div>
          <LogConsole events={shownJob.events ?? []} live={Boolean(active)} />
        </Card>
      ) : (
        <Card title="No runs yet" icon={<Terminal className="w-4 h-4" />}>
          <div className="p-4 text-xs text-stone-600">Press <b>Sync to NKERP</b> to run it, or <b>Preview</b> to see what it would do without saving anything.</div>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-3">
          <Card title="Needs you" icon={<AlertTriangle className="w-4 h-4" />}
            right={<span className="text-[11px] text-stone-500">{plural(shownAttention.filter((i) => i.kind !== 'note').length, 'problem')} · {plural(shownAttention.filter((i) => i.kind === 'note').length, 'note')}</span>}>
            {attentionFrom && (
              <div className="px-3.5 py-1.5 text-[11px] text-stone-600 bg-stone-50 border-b border-[#EFE9DF]">
                From the last run that finished its checks ({fmtTime(attentionFrom.startedAt)}); the newest run ended without a report.
              </div>
            )}
            <NeedsYou items={shownAttention} onSend={(t) => void sync.send(t)} onAsk={ask} disabled={sync.running} />
          </Card>
          {shownReport && (
            <Card title={shownReport.mode === 'apply' ? 'What was done' : 'What would be done'} icon={<ClipboardList className="w-4 h-4" />}>
              <Results report={shownReport} />
            </Card>
          )}
        </div>
        <div className="lg:col-span-2 space-y-3">
          <Card title="Tell the sync" icon={<MessageSquare className="w-4 h-4" />}
            right={<span className="text-[10px] text-stone-500">{config?.gemini ? 'Gemini + rules' : 'Built-in rules'}</span>}>
            <Conversation sync={sync} draft={draft} setDraft={setDraft} inputRef={inputRef} />
          </Card>
          <Card title="Run history" icon={<History className="w-4 h-4" />}>
            <ul className="max-h-72 overflow-y-auto">
              {(status?.jobs ?? []).length === 0 && <li className="px-3.5 py-3 text-xs text-stone-500">No runs yet.</li>}
              {(status?.jobs ?? []).map((j) => (
                <li key={j.id}>
                  <button type="button" onClick={async () => {
                    if (active && j.id === active.id) return setSelected(null);
                    const d = await sync.loadJob(j.id);
                    if (d) setSelected(d);
                  }}
                  className={`w-full text-left px-3.5 py-2 border-t border-[#F3EEE6] first:border-t-0 hover:bg-stone-50 cursor-pointer ${selected?.id === j.id ? 'bg-emerald-50/60' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                        {j.options.apply ? <RefreshCcw className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {j.options.apply ? 'Sync' : 'Preview'}
                        <span className="font-normal text-stone-500">{fmtTime(j.startedAt)}</span>
                      </span>
                      <StatusPill status={j.status} />
                    </div>
                    {j.summary && (
                      <div className="text-[10px] text-stone-500 mt-0.5">
                        {ACTIONS.map((a) => `${(j.options.apply ? j.summary!.done : j.summary!.planned)[a] ?? 0} ${a}`).join(' · ')}{j.problems ? ` · ${j.problems} need you` : ''}
                      </div>
                    )}
                    {!j.summary && j.error && <div className="text-[10px] text-rose-700 mt-0.5 truncate">{j.error}</div>}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <div className="flex items-start gap-1.5 text-[10px] text-stone-500">
        <Circle className="w-2 h-2 fill-current mt-1 shrink-0" />
        <span>Every applied run is also logged in the Sheet's <b>Sync History</b> tab, which is the sync's memory: don't edit or delete its rows.</span>
      </div>
    </div>
  );
};
