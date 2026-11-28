import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon, AlertTriangle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronRight, Clock, Eye, Info, KeyRound,
  Loader2, LogOut, MessageSquare, RefreshCcw, Send, ShieldAlert, Square, User, Wifi, WifiOff, XCircle,
} from 'lucide-react';
import type { NkerpSyncState } from '../hooks/useNkerpSync';
import {
  type AttentionItem, type ChatMessage, type JobEvent, type JobStatus, type LogLevel, type ReportEntry, scopeOptions,
  scopeText, type SyncReport,
} from '../services/nkerpSync';
import { Segmented, SyncScopePicker } from './SyncScopePicker';
import { btn, btnDanger, btnSm, card, chip, type ChipTone, fieldLabel, PageHeader } from './ui';

const ACTIONS = ['deallocate', 'reallocate', 'allocate'] as const;
const ACTION_LABEL: Record<string, string> = { deallocate: 'Deallocated', reallocate: 'Reallocated', allocate: 'Allocated' };
const ACTION_PLANNED: Record<string, string> = { deallocate: 'Would deallocate', reallocate: 'Would reallocate', allocate: 'Would allocate' };
const STAGE_LABEL: Record<string, string> = {
  start: 'Starting', 'read-sheet': 'Reading saved reservations', 'read-history': 'Reading Sync History',
  'read-pending': 'Reading NKERP unallocated list', 'read-tours': 'Reading who is where in NKERP', plan: 'Planning',
  deallocate: 'Deallocating', reallocate: 'Reallocating', allocate: 'Allocating', history: 'Logging to Sync History',
  finish: 'Finishing', cancel: 'Cancelling',
};

const STATUS_STYLE: Record<JobStatus, { label: string; tone: ChipTone }> = {
  running: { label: 'Running', tone: 'wait' },
  succeeded: { label: 'All good', tone: 'ok' },
  attention: { label: 'Needs you', tone: 'wait' },
  stopped: { label: 'Stopped', tone: 'bad' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Stopped early', tone: 'neutral' },
};

/* Tinted message panels: one shape, the tone carries the meaning (same meanings as the chips). */
type Tone = 'ok' | 'wait' | 'bad' | 'neutral';
const TONE_PANEL: Record<Tone, string> = {
  ok: 'bg-emerald-50 ring-emerald-200 text-emerald-900',
  wait: 'bg-amber-50 ring-amber-200 text-amber-900',
  bad: 'bg-rose-50 ring-rose-200 text-rose-800',
  neutral: 'bg-stone-50 ring-stone-200 text-stone-800',
};
const TONE_ICON: Record<Tone, React.ReactNode> = {
  ok: <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />,
  wait: <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />,
  bad: <AlertOctagon className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />,
  neutral: <Info className="w-4 h-4 mt-0.5 shrink-0 text-stone-500" />,
};
const Notice: React.FC<{ tone: Tone; children: React.ReactNode; className?: string }> = ({ tone, children, className = '' }) => (
  <div className={`flex gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed ring-1 ring-inset ${TONE_PANEL[tone]} ${className}`}>
    {TONE_ICON[tone]}
    <div className="min-w-0 flex-1 break-words">{children}</div>
  </div>
);

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-stone-500', info: 'text-stone-800', success: 'text-emerald-700', warn: 'font-medium text-amber-800',
  error: 'font-medium text-rose-700',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Compact buttons grow to the 40px touch size on phones. */
const tap = (cls: string) => `${cls} max-sm:h-10 max-sm:px-3.5`;
/** A compact button whose label may run to two lines (long suggestions on a phone). */
const wrapping = (cls: string) => cls.replace(' h-8 ', ' min-h-8 py-1.5 max-sm:min-h-10 ').replace('whitespace-nowrap', 'whitespace-normal text-left');

/** The 40px send button: the primary button as a square. */
const squareBtn = btn.primary.replace('px-4', 'w-10 px-0');

/** A server secret's name, set apart so it can be read and copied exactly. */
const EnvName: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[13px] font-medium text-stone-900 ring-1 ring-inset ring-stone-200 break-all">{children}</code>
);

const dayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const clock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${dayMonth(d)}, ${clock(d)}`;
}

/** A plain yyyy-mm-dd date as "28 Nov" (shown only; the value itself is never changed). */
function fmtIsoDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : dayMonth(d);
}

/** Sync History's "Run At" (yyyy-mm-dd hh:mm, Najaf time) as "28 Nov, 2:05 PM"; anything else is shown as written. */
function fmtRunAt(runAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(runAt);
  if (!m) return runAt;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? runAt : `${dayMonth(d)}, ${clock(d)}`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function nightsLabel(dates: string[]): string {
  if (!dates.length) return '';
  return dates.length === 1 ? fmtIsoDay(dates[0]) : `${fmtIsoDay(dates[0])} – ${fmtIsoDay(dates[dates.length - 1])} (${dates.length} nights)`;
}

const StatusPill: React.FC<{ status: JobStatus }> = ({ status }) => (
  <span className={chip(STATUS_STYLE[status].tone)}>
    {status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
    {STATUS_STYLE[status].label}
  </span>
);

/** One titled card of the page. Everything inside is separated by dividers, never by another card. */
const Section: React.FC<{ title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, right, children, className = '' }) => (
  <section className={`${card} overflow-hidden ${className}`}>
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-14 px-4 sm:px-5 py-2.5 border-b border-stone-200">
      <h2 className="text-base font-semibold text-stone-950">{title}</h2>
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
    <div className="border-t border-stone-200">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-2.5">
        <h3 className="text-sm font-semibold text-stone-950">Log</h3>
        <div className="w-full sm:w-72 order-last sm:order-none">
          <Segmented size="sm" label="Which log lines to show" value={filter} onChange={setFilter}
            options={[{ value: 'all', label: 'Everything' }, { value: 'problems', label: 'Warnings and errors' }]} />
        </div>
        <label className="ml-auto inline-flex items-center gap-2 min-h-10 sm:min-h-0 text-[13px] text-stone-700 cursor-pointer">
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} className="w-4 h-4 accent-brand-700" />
          Show detail
        </label>
      </div>
      <div ref={box} onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="h-64 overflow-y-auto border-t border-stone-200 bg-stone-50 px-4 sm:px-5 py-3 text-[13px] leading-relaxed" role="log" aria-live={live ? 'polite' : 'off'}>
        {shown.length === 0 && <div className="text-stone-500">No log lines yet.</div>}
        {shown.map((e) => (
          <div key={e.seq} className="flex gap-3">
            <span className="shrink-0 tabular-nums text-stone-500">{new Date(e.at).toLocaleTimeString(undefined, { hour12: false })}</span>
            <span className={`min-w-0 whitespace-pre-wrap break-words ${LEVEL_STYLE[e.level]}`}>
              <span className="font-normal text-stone-500">[{e.stage}]</span> {e.message}
            </span>
          </div>
        ))}
        {live && <div className="mt-1 flex items-center gap-1.5 text-stone-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />Working…</div>}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ results

const EntryRow: React.FC<{ e: ReportEntry }> = ({ e }) => (
  <li className="px-4 sm:px-5 py-3 border-t border-stone-200">
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <span className="text-sm font-semibold text-stone-950">{e.group}</span>
      {e.from && e.from.length > 0 && <span className="text-[13px] text-stone-600">from {e.from.join(', ')}</span>}
    </div>
    <div className="mt-0.5 text-[13px] text-stone-700">{e.people.join(', ')}</div>
    <div className="mt-0.5 flex flex-wrap gap-x-4 text-[13px] text-stone-500">
      <span className="tabular-nums">{nightsLabel(e.dates)}</span>
      {e.by.length > 0 && <span>by {e.by.join('; ')}</span>}
    </div>
    {e.warning && (
      <div className="mt-1.5 flex gap-1.5 text-[13px] font-medium text-amber-800"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{e.warning}</div>
    )}
    {e.over_capacity && e.over_capacity.length > 0 && (
      <div className="mt-1.5 flex gap-1.5 text-[13px] font-medium text-amber-800"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />Over capacity (allowed): {e.over_capacity.join('; ')}</div>
    )}
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
          <div key={a} className="border-b border-stone-200 last:border-b-0">
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [a]: !o[a] }))} aria-expanded={open[a]}
              className="w-full flex items-center justify-between gap-3 min-h-11 px-4 sm:px-5 py-2 text-left cursor-pointer hover:bg-stone-50">
              <span className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                {open[a] ? <ChevronDown className="w-4 h-4 text-stone-500" /> : <ChevronRight className="w-4 h-4 text-stone-500" />}
                {(report.mode === 'apply' ? ACTION_LABEL : ACTION_PLANNED)[a]}
              </span>
              <span className="text-[13px] text-stone-600 tabular-nums">{entries.length} room{entries.length === 1 ? '' : 's'} · {people} {people === 1 ? 'person' : 'people'}</span>
            </button>
            {open[a] && entries.length > 0 && <ul>{entries.map((e, i) => <EntryRow key={`${a}${i}`} e={e} />)}</ul>}
          </div>
        );
      })}
      <div className="px-4 sm:px-5 py-3 text-[13px] text-stone-600 space-y-0.5 bg-stone-50 border-t border-stone-200 empty:hidden">
        {skipped.length > 0 && <div>Skipped: {skipped.map(([k, v]) => `${v} ${k}`).join(' · ')}</div>}
        {report.history?.rows_written !== undefined && <div>Sync History: {report.history.rows_written} rows logged.</div>}
        {report.history?.rows_planned !== undefined && <div>Sync History: {report.history.rows_planned} rows would be logged (preview logs nothing).</div>}
        {report.history?.error && <div className="text-rose-700 font-medium">Sync History: {report.history.error}</div>}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ needs you

const SEVERITY_ICON = {
  critical: <AlertOctagon className="w-[18px] h-[18px] mt-0.5 text-rose-600 shrink-0" aria-label="Problem" />,
  warning: <AlertTriangle className="w-[18px] h-[18px] mt-0.5 text-amber-600 shrink-0" aria-label="Needs a look" />,
  info: <Info className="w-[18px] h-[18px] mt-0.5 text-blue-600 shrink-0" aria-label="Note" />,
};

const NeedsYou: React.FC<{ items: AttentionItem[]; onSend: (t: string) => void; onAsk: (t: string) => void; disabled: boolean }> = ({ items, onSend, onAsk, disabled }) => {
  const [showNotes, setShowNotes] = useState(false);
  const main = items.filter((i) => i.kind !== 'note');
  const notes = items.filter((i) => i.kind === 'note');
  if (!items.length) {
    return (
      <div className="flex items-center gap-3 px-4 sm:px-5 py-5">
        <CheckCircle2 className="w-6 h-6 shrink-0 text-emerald-600" />
        <p className="text-sm text-stone-700">Nothing needs you from the last run.</p>
      </div>
    );
  }
  const render = (it: AttentionItem) => (
    <li key={it.id} className="flex gap-3 px-4 sm:px-5 py-4 border-t border-stone-200 first:border-t-0">
      {SEVERITY_ICON[it.severity]}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-stone-950 break-words">
          {it.action && <span className="font-normal text-stone-500 first-letter:uppercase inline-block mr-1.5">{it.action}:</span>}{it.title}
        </div>
        {it.people.length > 0 && <div className="mt-0.5 text-[13px] text-stone-700">{it.people.join(', ')}</div>}
        <p className="mt-1 text-[13px] leading-relaxed text-stone-600 break-words">{it.detail}</p>
        {it.hint && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-900 break-words">
            <span className="font-semibold">What to do: </span>{it.hint}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap gap-2">
          {it.suggestion && (
            <button type="button" disabled={disabled} onClick={() => onSend(it.suggestion!)} className={wrapping(btnSm.primary)}>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />{it.suggestion}
            </button>
          )}
          <button type="button" onClick={() => onAsk(`About "${it.title}": `)} className={tap(btnSm.secondary)}>
            <MessageSquare className="w-3.5 h-3.5 text-stone-500" />Tell the sync what to do
          </button>
        </div>
      </div>
    </li>
  );
  return (
    <div>
      {main.length > 0 ? <ul>{main.map(render)}</ul> : <div className="px-4 sm:px-5 py-4 text-sm text-stone-700">No problems; only notes.</div>}
      {notes.length > 0 && (
        <div className="border-t border-stone-200">
          <button type="button" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}
            className="w-full flex items-center gap-2 min-h-11 px-4 sm:px-5 py-2 text-sm font-semibold text-stone-900 cursor-pointer hover:bg-stone-50">
            {showNotes ? <ChevronDown className="w-4 h-4 text-stone-500" /> : <ChevronRight className="w-4 h-4 text-stone-500" />}Notes ({notes.length})
          </button>
          {showNotes && <ul className="border-t border-stone-200">{notes.map(render)}</ul>}
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ conversation

const EXAMPLES = ['Preview', 'Sync tomorrow only', 'What needs fixing?', 'Only allocations', 'Status', 'Help'];

const PROPOSAL_STATUS: Record<string, { label: string; tone: ChipTone }> = {
  executed: { label: 'Started', tone: 'ok' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'bad' },
};

const ProposalCard: React.FC<{ m: ChatMessage; onConfirm: () => void; onDismiss: () => void; running: boolean }> = ({ m, onConfirm, onDismiss, running }) => {
  const p = m.proposal!;
  const needs = p.status === 'pending' && p.needsConfirmation;
  const state = p.status === 'pending'
    ? (needs ? { label: 'Waiting for you', tone: 'wait' as ChipTone } : { label: 'Starting…', tone: 'info' as ChipTone })
    : PROPOSAL_STATUS[p.status] ?? { label: p.status, tone: 'neutral' as ChipTone };
  return (
    <div className={`mt-2.5 rounded-xl px-3 py-2.5 text-[13px] ring-1 ring-inset ${needs ? 'bg-amber-50 ring-amber-200' : 'bg-stone-50 ring-stone-200'}`}>
      {p.overrides.length > 0 && (
        <ul className="mb-2 space-y-1">
          {p.overrides.map((o) => <li key={o} className="flex gap-1.5 font-medium text-amber-900"><ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />{o}</li>)}
        </ul>
      )}
      {p.cautions && p.cautions.length > 0 && (
        <ul className="mb-2 space-y-1">{p.cautions.map((c) => <li key={c} className="flex gap-1.5 text-stone-700"><Info className="w-4 h-4 mt-0.5 shrink-0 text-stone-500" />{c}</li>)}</ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={chip(state.tone)}>{state.label}</span>
        {needs && (
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onDismiss} className={tap(btnSm.ghost)}>Dismiss</button>
            <button type="button" onClick={onConfirm} disabled={running} className={tap(btnSm.primary)}>Confirm and run</button>
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
      <div ref={box} className="max-h-[min(26rem,calc(100dvh-23rem))] min-h-32 overflow-y-auto px-4 sm:px-5 py-4 space-y-3 bg-stone-50">
        {sync.messages.length === 0 && (
          <div className="text-sm text-stone-600 leading-relaxed">
            <p>Type what should be done in plain words. Safe requests run straight away; anything that loosens a safety rule asks you to confirm first.</p>
            <p className="mt-2 text-[13px] text-stone-500">
              For example: <em>"sync 25 Nov only"</em>, <em>"preview 20-25 Nov"</em>, <em>"only allocations"</em>, <em>"why was Saifee 107 held?"</em>,
              {' '}<em>"the app allocations are correct, allow the deallocations"</em>.
            </p>
          </div>
        )}
        {sync.messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role === 'assistant' && <Bot className="w-5 h-5 text-brand-700 shrink-0 mt-1.5" />}
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === 'user'
              ? 'bg-brand-700 text-white rounded-br-md' : 'bg-white ring-1 ring-inset ring-stone-200 text-stone-800 rounded-bl-md'}`}>
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              {m.proposal && (m.proposal.intent === 'sync' || m.proposal.intent === 'preview') && (
                <ProposalCard m={m} running={sync.running} onConfirm={() => void sync.confirm(m.id)} onDismiss={() => void sync.dismiss(m.id)} />
              )}
              <div className={`mt-1 text-xs tabular-nums ${m.role === 'user' ? 'text-brand-100' : 'text-stone-500'}`}>
                {fmtTime(m.at)}{m.source === 'gemini' ? ' · Gemini' : ''}
              </div>
            </div>
            {m.role === 'user' && <User className="w-5 h-5 text-stone-500 shrink-0 mt-1.5" />}
          </div>
        ))}
      </div>
      <div className="border-t border-stone-200 px-4 sm:px-5 py-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => void submit(x)} disabled={sending} className={tap(btnSm.secondary)}>{x}</button>
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
            className="flex-1 min-w-0 resize-none rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm leading-snug text-stone-900 placeholder:text-stone-400"
          />
          <button type="submit" disabled={!draft.trim() || sending} className={`${squareBtn} shrink-0`} aria-label="Send">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ view

/** What the server still needs before a sync can run. Shown only while something is missing. */
const Setup: React.FC<{ sync: NkerpSyncState }> = ({ sync }) => {
  const c = sync.config;
  if (!c || c.configured) return null;
  const missing = c.nkerp ? 0 : 1;
  return (
    <Section
      title={<span className="flex items-center gap-2"><ShieldAlert className="w-[18px] h-[18px] text-rose-600" />Set up the sync</span>}
      right={missing > 0 ? <span className={chip('bad')}>{missing} missing</span> : undefined}
    >
      <ul className="divide-y divide-stone-200">
        <li className="flex gap-3 px-4 sm:px-5 py-4">
          {c.nkerp ? <CheckCircle2 className="w-[18px] h-[18px] mt-0.5 text-emerald-600 shrink-0" /> : <XCircle className="w-[18px] h-[18px] mt-0.5 text-rose-600 shrink-0" />}
          <div className="min-w-0 flex-1">
            {c.nkerp ? (
              <p className="text-[13px] text-stone-600"><span className="font-medium text-stone-800">NKERP login</span> is set on the server.</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-rose-700">NKERP login is missing</p>
                <p className="mt-1 text-sm leading-relaxed text-stone-700">
                  Whoever runs the server adds two server secrets, for an NKERP account with the Tour and Accomodation Admin role:
                </p>
                <ul className="mt-2 space-y-1.5 text-[13px] text-stone-600">
                  <li className="flex flex-wrap items-center gap-x-2 gap-y-1"><EnvName>NKERP_LOGIN_ID</EnvName>the account's login ID</li>
                  <li className="flex flex-wrap items-center gap-x-2 gap-y-1"><EnvName>NKERP_PASSWORD</EnvName>its password</li>
                </ul>
              </>
            )}
          </div>
        </li>
        <li className="flex gap-3 px-4 sm:px-5 py-3.5">
          <CheckCircle2 className="w-[18px] h-[18px] mt-0.5 text-emerald-600 shrink-0" />
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-stone-600">
            <span className="font-medium text-stone-800">Access key (optional)</span>{' '}
            {c.keySource === 'env'
              ? 'is set: staff enter it once per device.'
              : <>is not set, so anyone who can open the app can run the sync. To require a key, set <EnvName>NKERP_SYNC_ACCESS_KEY</EnvName>.</>}
          </p>
        </li>
      </ul>
    </Section>
  );
};

export const NkerpSyncView: React.FC<{ sync: NkerpSyncState }> = ({ sync }) => {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { config, active, last } = sync;

  const shownJob = active ?? last;
  const shownReport = active ? null : last?.report ?? null;
  const failedLast = !active && last && !last.report && last.error && last.status !== 'cancelled' ? last : null;
  const shownAttention: AttentionItem[] = failedLast
    ? [{ id: 'failed-last', kind: 'stopped', severity: 'critical', action: failedLast.options.apply ? 'sync' : 'preview',
      title: `The latest ${failedLast.options.apply ? 'sync' : 'preview'} ${failedLast.status} before planning anything`, people: [],
      detail: failedLast.error!, hint: 'Nothing was saved. See the run above for what to check, then run it again.',
      suggestion: failedLast.options.apply ? 'Sync again' : 'Preview' }]
    : active ? [] : last?.attention ?? [];

  const ask = (prefix: string) => {
    setDraft(prefix);
    setTimeout(() => inputRef.current?.focus(), 20);
  };

  const description = (
    <>
      Najaf rooms in NKERP brought in line with saved app allocations: deallocate, then reallocate, then allocate. Karbala is never touched.
      {active ? ' Keep this page open while it runs.' : ''}
    </>
  );

  if (!sync.hasKey) {
    return (
      <div className="space-y-6">
        <PageHeader title="NKERP sync" description={description} />
        <div className="max-w-xl space-y-6">
          {sync.error && <Notice tone="bad">{sync.error}</Notice>}
          {!config && (
            <div className={`${card} p-8 text-center`}>
              <div className="mx-auto w-11 h-11 rounded-full bg-stone-100 flex items-center justify-center text-stone-500">
                {sync.connected ? <Loader2 className="w-5 h-5 animate-spin" /> : <WifiOff className="w-5 h-5" />}
              </div>
              <h2 className="mt-4 text-lg font-semibold text-stone-950">
                {sync.connected ? 'Connecting to the sync…' : 'The sync server is not reachable'}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-600 max-w-sm mx-auto">
                {sync.connected
                  ? 'Loading the sync settings from the server.'
                  : 'Sync to NKERP runs on the app server. Check the internet connection, then reload this page. If it keeps happening, the server may need its NKERP settings.'}
              </p>
              <button type="button" onClick={() => window.location.reload()} className={`${btn.secondary} mt-5`}>
                <RefreshCcw className="w-4 h-4 text-stone-500" />
                Reload
              </button>
            </div>
          )}
          <Setup sync={sync} />
          {config?.keySource === 'env' && (
            <Section title="Sync to NKERP">
              <div className="px-4 sm:px-5 py-4">
                <p className="text-sm leading-relaxed text-stone-700">The sync is protected with an access key. Enter it once on this device to open the log, history and instructions.</p>
                <button type="button" onClick={sync.requestKey} className={`${btn.primary} mt-4`}>
                  <KeyRound className="w-4 h-4" />Enter access key
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>
    );
  }

  const progress = active?.progress;
  const pct = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : null;
  const summary = shownJob?.summary;
  const counts = summary ? (shownJob!.options.apply ? summary.done : summary.planned) : null;

  // Why Preview and Sync cannot be pressed, in plain words (shown beside them).
  const offReason = !config
    ? 'the sync is not reachable on the server right now'
    : !config.configured
      ? (config.nkerp ? (config.problem ?? 'the sync is not set up on the server yet') : 'the NKERP login is not set up on the server yet')
      : null;
  const cannotRun = sync.busy || !config?.configured || !sync.scopeReady;

  const problemCount = shownAttention.filter((i) => i.kind !== 'note').length;
  const noteCount = shownAttention.filter((i) => i.kind === 'note').length;

  // The finished run in one line: what ended and how.
  const what = shownJob?.options.apply ? 'Sync' : 'Preview';
  const outcome: { tone: Tone; headline: string } | null = !shownJob || active ? null
    : shownJob.status === 'succeeded' ? { tone: 'ok', headline: `${what} finished: nothing needs you.` }
      : shownJob.status === 'attention' ? { tone: 'wait', headline: problemCount ? `${what} finished: ${plural(problemCount, 'item')} need${problemCount === 1 ? 's' : ''} you, listed below.` : `${what} finished: see the notes below.` }
        : shownJob.status === 'cancelled' ? { tone: 'neutral', headline: `${what} stopped early.` }
          : { tone: 'bad', headline: `${what} ${shownJob.status}.` };

  return (
    <div className="space-y-6">
      <PageHeader
        title="NKERP sync"
        description={description}
        actions={(
          <>
            <span title={sync.connected ? 'The sync is reachable on the server' : 'The sync is not reachable on the server'}
              className={chip(sync.connected ? 'ok' : 'bad')}>
              {sync.connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {sync.connected ? 'Online' : 'Offline'}
            </span>
            {config?.keySource === 'env' && (
              <button type="button" onClick={sync.forgetKey} title="Sign this device out of the sync" className={btn.ghost} aria-label="Sign out of sync">
                <LogOut className="w-4 h-4" />Sign out
              </button>
            )}
          </>
        )}
      />

      {/* The control: which arrivals, then preview or sync */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-col gap-4 px-4 sm:px-5 py-4 sm:py-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className={fieldLabel}>Arrivals</div>
            <SyncScopePicker scope={sync.scope} onChange={sync.setScope} today={config?.today ?? new Date().toISOString().slice(0, 10)}
              layout="inline" disabled={sync.running} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sync.running ? (
              <button type="button" onClick={sync.cancel} disabled={sync.stopping} className={`${btnDanger} flex-1 lg:flex-none`}>
                {sync.stopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                {sync.stopping ? 'Stopping…' : 'Stop after current save'}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void sync.startPreview()} disabled={cannotRun} className={`${btn.secondary} flex-1 lg:flex-none`}>
                  <Eye className="w-4 h-4 text-stone-500" />Preview
                </button>
                <button type="button" onClick={() => void sync.startSync()} disabled={cannotRun} className={`${btn.primary} flex-1 lg:flex-none`}>
                  {sync.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}Sync to NKERP
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-x-6 gap-y-1.5 px-4 sm:px-5 py-3 border-t border-stone-200 bg-stone-50 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm text-stone-600" aria-live="polite">
            {sync.scopeReady
              ? <>Covers <b className="font-semibold text-stone-950">{scopeText(scopeOptions(sync.scope))}</b>.</>
              : <span className="font-medium text-amber-800">Pick the dates to preview or sync.</span>}
          </p>
          {!sync.running && offReason ? (
            <p className="flex items-start gap-1.5 text-[13px] font-medium text-rose-700">
              <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
              <span>Preview and sync are off: {offReason}.{config && !config.configured ? ' See “Set up the sync” below.' : ''}</span>
            </p>
          ) : (
            (sync.running || shownJob) && (
              <p className="text-[13px] text-stone-500">
                {sync.running ? 'A run is going. Stopping lets the save it is on finish first.' : 'Preview shows what a sync would do without saving anything.'}
              </p>
            )
          )}
        </div>
      </section>

      {sync.error && <Notice tone="bad">{sync.error}</Notice>}
      <Setup sync={sync} />

      {/* Current or last run on this device */}
      {shownJob ? (
        <Section title={active ? 'Running now' : 'Last run on this device'} right={<StatusPill status={shownJob.status} />}>
          <div className="px-4 sm:px-5 py-4 space-y-4">
            <div>
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <span className="text-[15px] font-semibold text-stone-950">{shownJob.options.apply ? 'Sync' : 'Preview (nothing saved)'}</span>
                <span className="text-sm text-stone-700">{scopeText(shownJob.options)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-stone-600">
                <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock className="w-3.5 h-3.5 text-stone-400" />{fmtTime(shownJob.startedAt)}{shownJob.durationMs ? ` · ${fmtDuration(shownJob.durationMs)}` : ''}</span>
                {shownJob.trigger.instruction && <span className="break-words">“{shownJob.trigger.instruction}”</span>}
                {shownJob.options.only && <span>only {shownJob.options.only.join(', ')}</span>}
                {shownJob.options.today && <span className="tabular-nums">from {fmtIsoDay(shownJob.options.today)}</span>}
                {shownJob.options.allowOverCapacity && <span className={chip('wait')}>Over capacity allowed</span>}
                {shownJob.options.allowMassDeallocation && <span className={chip('wait')}>Mass deallocation allowed</span>}
              </div>
            </div>
            {active && (
              <div>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-stone-950">{STAGE_LABEL[active.stage] ?? active.stage}</span>
                  {progress && <span className="tabular-nums text-stone-600">{progress.current} / {progress.total}{pct !== null ? ` · ${pct}%` : ''}</span>}
                </div>
                <div role="progressbar" aria-label={STAGE_LABEL[active.stage] ?? active.stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}
                  className="mt-2 h-2 rounded-full bg-stone-200 overflow-hidden">
                  <div className={`h-full rounded-full bg-brand-600 transition-all duration-500 ${pct === null ? 'w-1/3 animate-pulse' : ''}`} style={pct !== null ? { width: `${pct}%` } : undefined} />
                </div>
              </div>
            )}
            {(outcome || shownJob.error) && (
              <Notice tone={outcome?.tone ?? 'bad'}>
                {outcome && <div className="font-semibold">{outcome.headline}</div>}
                {shownJob.error && (
                  <>
                    <div className={outcome ? 'mt-0.5' : 'font-semibold'}>{shownJob.error}</div>
                    {/could not reach to\.najafkarbala\.com|ran out of time while reading NKERP/.test(shownJob.error) && <div className="mt-1">NKERP did not answer in time from this server. Check NKERP is up, then sync again. Nothing was saved.</div>}
                    {/NKERP login failed|role is missing/.test(shownJob.error) && <div className="mt-1">Check the NKERP login configured on the server (NKERP_LOGIN_ID / NKERP_PASSWORD) and that it has the Tour and Accomodation Admin role. Nothing was saved.</div>}
                  </>
                )}
              </Notice>
            )}
            {counts && (
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-xl bg-stone-200 ring-1 ring-stone-200">
                {ACTIONS.map((a) => (
                  <div key={a} className="bg-stone-50 px-4 py-3">
                    <dt className="text-[13px] text-stone-600">{(shownJob.options.apply ? ACTION_LABEL : ACTION_PLANNED)[a]}</dt>
                    <dd className="mt-1 type-display text-[26px] leading-none font-semibold text-stone-950 tabular-nums">{counts[a] ?? 0}</dd>
                  </div>
                ))}
                <div className="bg-stone-50 px-4 py-3">
                  <dt className="text-[13px] text-stone-600">Need you</dt>
                  <dd className={`mt-1 type-display text-[26px] leading-none font-semibold tabular-nums ${summary!.problems ? 'text-amber-700' : 'text-emerald-700'}`}>{summary!.problems}</dd>
                </div>
              </dl>
            )}
            {shownJob.stats && (
              <p className="text-[13px] leading-relaxed text-stone-600 tabular-nums">
                App {shownJob.stats.sheetRows} rows ({shownJob.stats.sheetRooms} with a room) · NKERP {shownJob.stats.pending} unallocated, {shownJob.stats.peopleInNkerp} allocated across {shownJob.stats.toursRead} tours · {shownJob.stats.remembered} remembered from Sync History
              </p>
            )}
          </div>
          <LogConsole events={shownJob.events ?? []} live={Boolean(active)} />
        </Section>
      ) : (
        <Section title="No runs on this device yet">
          <p className="px-4 sm:px-5 py-4 text-sm leading-relaxed text-stone-600">
            Choose the arrivals above, then press <b className="font-semibold text-stone-900">Sync to NKERP</b> to run it, or <b className="font-semibold text-stone-900">Preview</b> to see what it would do without saving anything.
          </p>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="contents lg:flex lg:flex-col lg:gap-6 lg:col-span-3 lg:min-w-0">
          <Section title="Needs you" className="order-1"
            right={<span className="text-[13px] text-stone-600 tabular-nums">{plural(problemCount, 'problem')} · {plural(noteCount, 'note')}</span>}>
            <NeedsYou items={shownAttention} onSend={(t) => void sync.send(t)} onAsk={ask} disabled={sync.running} />
          </Section>
          {shownReport && (
            <Section title={shownReport.mode === 'apply' ? 'What was done' : 'What would be done'} className="order-3">
              <Results report={shownReport} />
            </Section>
          )}
          <Section title="Sync history" className="@container order-4"
            right={(
              <button type="button" onClick={() => void sync.refresh()} className={tap(btnSm.ghost)}>
                <RefreshCcw className="w-3.5 h-3.5" />Refresh
              </button>
            )}>
            {sync.historyError && <p className="px-4 sm:px-5 py-3 text-[13px] font-medium text-rose-700 border-b border-stone-200">{sync.historyError}</p>}
            {!sync.historyError && sync.history.length === 0 && (
              <div className="px-5 py-10 text-center">
                <p className="text-[15px] font-semibold text-stone-950">No applied runs yet</p>
                <p className="mt-1 mx-auto max-w-md text-sm leading-relaxed text-stone-600">
                  Each run of Sync to NKERP that saves changes is listed here, from every device.
                </p>
              </div>
            )}
            {sync.history.length > 0 && (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-stone-50 text-xs text-stone-600">
                    <tr className="[&>th]:px-4 sm:[&>th]:px-5 [&>th]:py-2.5 [&>th]:font-semibold [&>th]:border-b [&>th]:border-stone-200 [&>th]:whitespace-nowrap">
                      <th scope="col">Run</th>
                      <th scope="col" className="hidden @min-[38rem]:table-cell text-right">Deallocated</th>
                      <th scope="col" className="hidden @min-[38rem]:table-cell text-right">Reallocated</th>
                      <th scope="col" className="hidden @min-[38rem]:table-cell text-right">Allocated</th>
                      <th scope="col" className="hidden @min-[38rem]:table-cell text-right">People logged</th>
                      <th scope="col" className="text-right @min-[38rem]:text-left">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {sync.history.map((h) => (
                      <tr key={h.runId} className="hover:bg-stone-50 [&>td]:px-4 sm:[&>td]:px-5 [&>td]:py-3 [&>td]:align-top @min-[38rem]:[&>td]:align-middle">
                        <td>
                          <div className="font-semibold text-stone-950 tabular-nums whitespace-nowrap">{fmtRunAt(h.runAt)}</div>
                          <div className="@min-[38rem]:hidden mt-0.5 text-[13px] text-stone-600 tabular-nums">
                            {ACTIONS.map((a) => `${h.done[a] ?? 0} ${ACTION_LABEL[a].toLowerCase()}`).join(' · ')} · {plural(h.people, 'person')} logged
                          </div>
                        </td>
                        {ACTIONS.map((a) => (
                          <td key={a} className="hidden @min-[38rem]:table-cell text-right tabular-nums text-stone-800">{h.done[a] ?? 0}</td>
                        ))}
                        <td className="hidden @min-[38rem]:table-cell text-right tabular-nums text-stone-800">{h.people}</td>
                        <td className="text-right @min-[38rem]:text-left">
                          <span className={chip(h.problems ? 'wait' : 'ok')}>{h.problems ? `${h.problems} held` : 'All good'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 sm:px-5 py-3 border-t border-stone-200 bg-stone-50 text-[13px] leading-relaxed text-stone-600">
              Previews save nothing, so they appear only on the device that ran them. Every applied run is logged in the app’s <b className="font-semibold text-stone-800">Sync History</b>, which is the sync's memory: don't edit or delete its rows.
            </p>
          </Section>
        </div>
        <div className="order-2 lg:order-none lg:col-span-2 min-w-0">
          <Section title="Tell the sync" className="lg:sticky lg:top-6" right={<span className="text-xs text-stone-500">Built-in rules</span>}>
            <Conversation sync={sync} draft={draft} setDraft={setDraft} inputRef={inputRef} />
          </Section>
        </div>
      </div>

    </div>
  );
};
