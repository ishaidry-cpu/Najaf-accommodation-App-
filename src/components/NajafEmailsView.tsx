import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon, AlertTriangle, Check, ChevronDown, CircleSlash, Info, Loader2, Mail, MailCheck, MailWarning, RefreshCcw,
  Send, Square, Users, X,
} from 'lucide-react';
import type { NkerpSyncState } from '../hooks/useNkerpSync';
import { type Audience, canSend, isSent, type NajafEmailsState } from '../hooks/useNajafEmails';
import { envKey, type NajafDay, type NajafStay, type Recipient } from '../services/najafEmails';
import { Segmented, SyncScopePicker } from './SyncScopePicker';
import {
  btn, card, chip, type ChipTone, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle, PageHeader,
} from './ui';

const WHO: Record<Recipient, string> = { operator: 'Tour operator', zaereen: 'Zaereen' };
const AUDIENCE: { value: Audience; label: string }[] = [
  { value: 'operator', label: 'Tour operators' },
  { value: 'zaereen', label: 'Zaereen' },
  { value: 'both', label: 'Both' },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* Buttons on the emerald send bar: the one primary action is the light button, the rest stay quiet. */
const barBtn = 'inline-flex items-center justify-center gap-1.5 h-10 rounded-lg text-sm whitespace-nowrap transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const barPrimary = `${barBtn} px-4 font-semibold bg-white text-brand-900 hover:bg-brand-50 shadow-sm`;
const barQuiet = `${barBtn} px-3 font-medium text-white/85 hover:text-white hover:bg-white/10`;
const barOutline = `${barQuiet} ring-1 ring-inset ring-white/30`;

/** A yyyy-mm-dd date as "28 Nov" or "Sat, 28 Nov" (shown only; the value itself is never changed). */
function dayLabel(iso: string, weekday = false): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { ...(weekday ? { weekday: 'short' as const } : {}), day: 'numeric', month: 'short' });
}

function relativeDay(iso: string, today: string): string {
  const diff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return `in ${diff} days`;
}

/** The tick square shared by every tick box on this page. */
const Tick: React.FC<{ state: 'on' | 'mixed' | 'off' }> = ({ state }) => (
  <span aria-hidden className={`w-[18px] h-[18px] shrink-0 rounded-[5px] flex items-center justify-center ring-1 ring-inset ${
    state === 'on' ? 'bg-brand-700 ring-brand-700 text-white' : state === 'mixed' ? 'bg-brand-50 ring-brand-600 text-brand-700' : 'bg-white ring-stone-400'}`}>
    {state === 'on' ? <Check className="w-3.5 h-3.5 tick-pop" strokeWidth={3} /> : state === 'mixed' ? <span className="w-2 h-0.5 rounded bg-current" /> : null}
  </span>
);

/** Server secret names, set apart so they can be read and copied exactly. */
const EnvName: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="rounded-md bg-white/70 px-1.5 py-0.5 text-[13px] font-medium ring-1 ring-inset ring-rose-200 whitespace-nowrap">{children}</code>
);

// ------------------------------------------------------------------------------------------------ envelope

const cell = 'w-full h-10 inline-flex items-center gap-2 rounded-lg text-[13px] font-medium';

/** One email of one tour: tick to choose it; shows NKERP's sent state and, during a run, its outcome. */
const Envelope: React.FC<{ stay: NajafStay; to: Recipient; emails: NajafEmailsState }> = ({ stay, to, emails }) => {
  const k = envKey(stay.key, to);
  const chosen = emails.selected.has(k);
  const sent = isSent(stay, to);
  const result = emails.run.results[k];
  const sending = emails.run.running && emails.run.current === k;
  const queued = emails.run.running && !result && emails.run.queue.includes(k);
  const label = `${WHO[to]} email for ${stay.ref}`;

  if (!canSend(stay)) {
    return (
      <span className={`${cell} px-3 text-stone-500`} title="NKERP has no rooms assigned for this stay yet, so it cannot send the plan">
        <CircleSlash className="w-4 h-4 text-stone-400" />No rooms
      </span>
    );
  }
  if (sending) {
    return <span className={`${cell} px-3`}><span className={chip('wait')}><Loader2 className="w-3 h-3 animate-spin" />Sending</span></span>;
  }
  if (result) {
    const look: Record<string, [ChipTone, React.ReactNode, string, string?]> = {
      confirmed: ['ok', <MailCheck key="i" className="w-3 h-3 tick-pop" />, 'Sent', 'flash-ok'],
      sent: ['ok', <Mail key="i" className="w-3 h-3" />, 'Sent, unconfirmed'],
      refused: ['bad', <MailWarning key="i" className="w-3 h-3" />, 'Refused'],
      uncertain: ['wait', <AlertTriangle key="i" className="w-3 h-3" />, 'Check NKERP'],
      skipped: ['neutral', <Info key="i" className="w-3 h-3" />, 'Skipped'],
      'not-run': ['neutral', <Info key="i" className="w-3 h-3" />, 'Not sent'],
    };
    const [tone, icon, text, extra = ''] = look[result.outcome];
    return <span className={`${cell} px-3`} title={result.message}><span className={`${chip(tone)} ${extra}`}>{icon}{text}</span></span>;
  }
  return (
    <button type="button" role="checkbox" aria-checked={chosen} aria-label={label} disabled={emails.run.running}
      onClick={() => emails.toggle(stay, to)}
      title={sent ? (chosen ? 'Will be sent again' : 'NKERP shows this was sent. Tick to send it again') : chosen ? 'Chosen' : 'Tick to send'}
      className={`${cell} px-3 cursor-pointer ring-1 ring-inset transition disabled:cursor-default ${
        queued ? 'opacity-70 ' : ''}${
        chosen && sent ? 'bg-amber-50 text-amber-900 ring-amber-300'
          : chosen ? 'bg-brand-50 text-brand-800 ring-brand-600'
            : 'bg-white text-stone-700 ring-stone-300 hover:ring-stone-400 hover:bg-stone-50'}`}>
      <Tick state={chosen ? 'on' : 'off'} />
      {chosen && sent ? 'Send again' : chosen ? (queued ? 'Waiting' : 'Chosen') : sent
        ? <span className={chip('ok')}><MailCheck className="w-3 h-3" />Sent</span> : 'Not sent'}
    </button>
  );
};

/** Choose or clear every eligible email of one recipient in a group of stays. */
const ColumnTick: React.FC<{ stays: NajafStay[]; to: Recipient; emails: NajafEmailsState }> = ({ stays, to, emails }) => {
  const keys = emails.eligible(stays, to);
  const on = keys.filter((k) => emails.selected.has(k)).length;
  const all = keys.length > 0 && on === keys.length;
  return (
    <button type="button" role="checkbox" aria-checked={all ? true : on ? 'mixed' : false} disabled={!keys.length || emails.run.running}
      aria-label={`All ${WHO[to].toLowerCase()} emails of this date`}
      onClick={() => emails.setMany(keys, !all)}
      className="w-full h-9 px-3 inline-flex items-center gap-2 rounded-lg text-[13px] font-medium text-stone-700 hover:bg-stone-200/70 disabled:opacity-50 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default">
      <Tick state={all ? 'on' : on ? 'mixed' : 'off'} />
      <span className="tabular-nums">{keys.length ? `${on} of ${keys.length}` : 'None'}</span>
    </button>
  );
};

const ALLOT: Record<string, [string, ChipTone]> = {
  full: ['All rooms assigned', 'ok'],
  partial: ['Partly assigned', 'wait'],
  none: ['No rooms yet', 'neutral'],
  unknown: ['Status unknown', 'neutral'],
};

const COLS = 'md:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem]';

const StayRow: React.FC<{ stay: NajafStay; emails: NajafEmailsState }> = ({ stay, emails }) => (
  <li className={`grid grid-cols-2 ${COLS} gap-x-3 gap-y-3 items-center px-4 sm:px-5 py-3.5 border-t border-stone-200 hover:bg-stone-50 transition-colors`}>
    <div className="col-span-2 md:col-span-1 min-w-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-sm font-semibold text-stone-950 tabular-nums">{stay.ref}</span>
        <span className={chip(ALLOT[stay.allotment][1])}>{ALLOT[stay.allotment][0]}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-stone-600">
        <span className="truncate max-w-[20rem]">{stay.operator || 'Operator not named'}{stay.office ? `, ${stay.office}` : ''}</span>
        {stay.pax !== null && <span className="inline-flex items-center gap-1.5 tabular-nums"><Users className="w-3.5 h-3.5 text-stone-400" />{plural(stay.pax, 'zair', 'zaereen')}</span>}
        <span className="tabular-nums">Najaf {dayLabel(stay.najafStart)}{stay.najafEnd && stay.najafEnd !== stay.najafStart ? ` to ${dayLabel(stay.najafEnd)}` : ''}</span>
      </div>
    </div>
    {(['operator', 'zaereen'] as const).map((to) => (
      <div key={to} className="min-w-0">
        <div className="md:hidden mb-1 text-xs font-medium text-stone-600">{WHO[to]}</div>
        <Envelope stay={stay} to={to} emails={emails} />
      </div>
    ))}
  </li>
);

const DayBlock: React.FC<{ day: NajafDay; today: string; emails: NajafEmailsState; open: boolean; onToggle: () => void }> = ({ day, today, emails, open, onToggle }) => {
  const zaereen = day.stays.reduce((n, s) => n + (s.pax ?? 0), 0);
  const chosen = day.stays.reduce((n, s) => n + (['operator', 'zaereen'] as const).filter((r) => emails.isSelected(s.key, r)).length, 0);
  return (
    <section className={`${card} overflow-hidden`}>
      <header className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-x-3 items-center px-4 sm:px-5 py-2 bg-stone-50`}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-2.5 min-w-0 min-h-10 text-left cursor-pointer group">
          <ChevronDown className={`w-4 h-4 shrink-0 text-stone-500 transition-transform duration-200 ${open ? '' : '-rotate-90'} group-hover:text-stone-900`} />
          <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 min-w-0">
            <span className="text-base font-semibold text-stone-950 tabular-nums whitespace-nowrap">{dayLabel(day.date, true)}</span>
            <span className="text-[13px] text-stone-600 whitespace-nowrap">{relativeDay(day.date, today)}</span>
            <span className="hidden sm:inline text-[13px] text-stone-600 whitespace-nowrap">{plural(day.stays.length, 'tour')}, {plural(zaereen, 'zair', 'zaereen')}</span>
            {chosen > 0 && <span className="text-[13px] font-semibold text-brand-700 whitespace-nowrap tabular-nums">{chosen} chosen</span>}
          </span>
        </button>
        <div className="hidden md:block"><ColumnTick stays={day.stays} to="operator" emails={emails} /></div>
        <div className="hidden md:block"><ColumnTick stays={day.stays} to="zaereen" emails={emails} /></div>
        <div className="md:hidden flex gap-1">
          <button type="button" disabled={emails.run.running} onClick={() => {
            const keys = emails.eligible(day.stays);
            emails.setMany(keys, !keys.every((k) => emails.selected.has(k)));
          }} className={btn.ghost}>Choose all</button>
        </div>
      </header>
      {open && (
        <ul className="animate-in fade-in duration-200">
          {day.stays.map((s) => <StayRow key={s.key} stay={s} emails={emails} />)}
        </ul>
      )}
    </section>
  );
};

// ------------------------------------------------------------------------------------------------ review

const Review: React.FC<{ emails: NajafEmailsState; onClose: () => void }> = ({ emails, onClose }) => {
  const items = emails.selectedItems;
  const byDay = useMemo(() => {
    const m = new Map<string, { operator: number; zaereen: number }>();
    for (const it of items) {
      const c = m.get(it.date) ?? { operator: 0, zaereen: 0 };
      c[it.to]++;
      m.set(it.date, c);
    }
    return [...m.entries()];
  }, [items]);
  const resends = items.filter((i) => i.resend).length;
  const partial = new Set(items.filter((i) => i.partial).map((i) => i.stay)).size;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={modalScrim} style={{ zIndex: 60 }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="email-review-title" onClick={(e) => e.stopPropagation()} className={`${modalCard} max-w-md`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h2 id="email-review-title" className={modalTitle}>Send {plural(items.length, 'email')}?</h2>
            <p className="mt-1 text-sm text-stone-600">NKERP sends them straight away. An email cannot be recalled once it goes out.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={modalClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 sm:px-6 py-4 overflow-y-auto">
          <ul className="max-h-60 overflow-y-auto rounded-xl ring-1 ring-inset ring-stone-200 divide-y divide-stone-200">
            {byDay.map(([date, c]) => (
              <li key={date} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <span className="font-semibold text-stone-950 tabular-nums whitespace-nowrap">{dayLabel(date, true)}</span>
                <span className="text-stone-600 text-[13px] text-right">
                  {c.operator > 0 && <span>{plural(c.operator, 'tour operator')}</span>}
                  {c.operator > 0 && c.zaereen > 0 && <span>, </span>}
                  {c.zaereen > 0 && <span>zaereen of {plural(c.zaereen, 'tour')}</span>}
                </span>
              </li>
            ))}
          </ul>
          {(resends > 0 || partial > 0) && (
            <div className="mt-3 space-y-1.5 rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-inset ring-amber-200">
              {resends > 0 && <p className="flex gap-2 text-[13px] text-amber-900"><AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-600" />{plural(resends, 'email')} NKERP already shows as sent will go out again.</p>}
              {partial > 0 && <p className="flex gap-2 text-[13px] text-amber-900"><AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-600" />{plural(partial, 'tour')} only partly allotted: the plan will list the rooms assigned so far.</p>}
            </div>
          )}
        </div>
        <div className={modalFooter}>
          <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
          <button type="button" onClick={() => { onClose(); void emails.send(); }} className={btn.primary}>
            <Send className="w-4 h-4" />Send {plural(items.length, 'email')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ action bar

const ActionBar: React.FC<{ emails: NajafEmailsState; onReview: () => void }> = ({ emails, onReview }) => {
  const { run } = emails;
  const items = emails.selectedItems;
  const done = Object.keys(run.results).length;
  if (!items.length && !run.running && !run.summary && !run.error) return null;
  const toOps = items.filter((i) => i.to === 'operator').length;
  const pct = run.total ? Math.round((done / run.total) * 100) : 0;
  const s = run.summary;
  return (
    <div className="fixed inset-x-3 lg:left-[calc(var(--rail-w)+0.75rem)] bottom-[4.75rem] lg:bottom-6 z-40 flex justify-center pointer-events-none">
      <div role="status" aria-live="polite" className="rise-enter pointer-events-auto w-full max-w-2xl rounded-2xl bg-brand-900 text-white shadow-xl overflow-hidden">
        {run.running && <div className="h-1 bg-white/10"><div className="h-full bg-gold-400 transition-all duration-500" style={{ width: `${pct}%` }} /></div>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3">
          {run.running ? (
            <>
              <Loader2 className="w-5 h-5 shrink-0 animate-spin text-gold-200" />
              <div className="min-w-0 flex-1 basis-48">
                <div className="text-[15px] font-semibold tabular-nums">Sending {Math.min(done + 1, run.total)} of {run.total}</div>
                <div className="text-[13px] text-brand-100">{run.stopping ? 'Stopping after this one…' : 'Keep this page open. One email at a time; none is ever sent twice by itself.'}</div>
              </div>
              <button type="button" onClick={emails.stop} disabled={run.stopping} className={`${barOutline} max-sm:basis-full`}>
                <Square className="w-4 h-4" />Stop after this one
              </button>
            </>
          ) : (s || run.error) && !items.length ? (
            <>
              {s && !s.refused && !s.uncertain && !run.error ? <MailCheck className="w-5 h-5 shrink-0 text-emerald-300" /> : <AlertTriangle className="w-5 h-5 shrink-0 text-amber-300" />}
              <div className="min-w-0 flex-1 basis-48 text-sm">
                {s ? (
                  <span><b className="font-semibold">{plural(s.confirmed + s.sent, 'email')} sent</b>
                    {s.confirmed !== s.confirmed + s.sent && <span className="text-brand-100">, {s.confirmed} confirmed by NKERP</span>}
                    {s.refused > 0 && <span className="font-medium text-rose-200">, {s.refused} refused</span>}
                    {s.uncertain > 0 && <span className="font-medium text-amber-200">, {s.uncertain} to check in NKERP</span>}
                    {s.skipped > 0 && <span className="text-brand-100">, {s.skipped} skipped</span>}
                    {s.notRun > 0 && <span className="text-brand-100">, {s.notRun} not sent</span>}.
                  </span>
                ) : null}
                {(run.error || s?.stopped) && <div className="text-[13px] text-brand-100">{run.error || s?.stopped}</div>}
              </div>
              <button type="button" onClick={emails.dismissRun} className={barOutline}>Done</button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1 basis-40">
                <div className="text-[15px] font-semibold tabular-nums">{plural(items.length, 'email')} chosen</div>
                <div className="text-[13px] text-brand-100 tabular-nums">{plural(toOps, 'to a tour operator', 'to tour operators')}, {items.length - toOps} to zaereen</div>
              </div>
              <button type="button" onClick={emails.clear} className={barQuiet}>Clear</button>
              <button type="button" onClick={onReview} className={`${barPrimary} max-sm:basis-full`}>
                <Send className="w-4 h-4" />Review and send
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ page

/* How each outcome of a send reads, on the tour row and in the list of emails to look at. */
const OUTCOME: Record<string, [ChipTone, string]> = {
  confirmed: ['ok', 'Sent'],
  sent: ['ok', 'Sent, unconfirmed'],
  refused: ['bad', 'Refused'],
  uncertain: ['wait', 'Check NKERP'],
  skipped: ['neutral', 'Skipped'],
  'not-run': ['neutral', 'Not sent'],
};

const Problems: React.FC<{ emails: NajafEmailsState }> = ({ emails }) => {
  const list = Object.values(emails.run.results).filter((r) => r.outcome !== 'confirmed');
  if (emails.run.running || !list.length) return null;
  return (
    <section className={`${card} overflow-hidden animate-in fade-in duration-200`}>
      <header className="flex items-center gap-2 min-h-14 px-4 sm:px-5 py-2.5 border-b border-stone-200">
        <AlertTriangle className="w-[18px] h-[18px] shrink-0 text-amber-600" />
        <h2 className="text-base font-semibold text-stone-950">From the last send: {plural(list.length, 'email')} to look at</h2>
      </header>
      <ul className="max-h-56 overflow-y-auto divide-y divide-stone-200">
        {list.map((r) => (
          <li key={envKey(r.stay, r.to)} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 sm:px-5 py-3 text-[13px] leading-relaxed">
            <span className={`${chip(OUTCOME[r.outcome]?.[0] ?? 'neutral')} shrink-0`}>{OUTCOME[r.outcome]?.[1] ?? r.outcome}</span>
            <span className="min-w-0 flex-1 basis-56">
              <span className="font-semibold text-stone-950 tabular-nums">{r.ref || r.stay}</span>
              <span className="text-stone-600"> ({WHO[r.to].toLowerCase()}, Najaf {dayLabel(r.najafStart)}): </span>
              <span className="text-stone-800">{r.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

const rowLabel = 'text-[13px] font-medium text-stone-700 md:h-10 md:flex md:items-center';
const formRow = 'grid gap-x-6 gap-y-1.5 md:grid-cols-[8.5rem_minmax(0,1fr)]';

export const NajafEmailsView: React.FC<{ emails: NajafEmailsState; sync: NkerpSyncState }> = ({ emails, sync }) => {
  const { list, loading, error, settings } = emails;
  const today = list?.today ?? sync.config?.today ?? new Date().toISOString().slice(0, 10);
  const [reviewing, setReviewing] = useState(false);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!list && !loading && !error) void emails.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = emails.days;
  const allStays = useMemo(() => days.flatMap((d) => d.stays), [days]);
  const matching = emails.eligible(allStays);
  const isOpen = (date: string, i: number) => openDays[date] ?? i < 3;
  const scopeBad = settings.scope.mode !== 'all' && days.length === 0 && (list?.days.length ?? 0) > 0;

  return (
    <div className="space-y-6 pb-28">
      <PageHeader
        title="Najaf emails"
        description="Send NKERP's Najaf accommodation plan to the tour operator, the zaereen, or both: for one tour, one date, or everything ahead. Karbala stays are never listed."
        actions={(
          <>
            {list && <span className="text-[13px] text-stone-600 tabular-nums">Read from NKERP at {new Date(list.readAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
            <button type="button" onClick={() => void emails.refresh()} disabled={loading || emails.run.running} className={btn.secondary}>
              <RefreshCcw className={`w-4 h-4 text-stone-500 ${loading ? 'animate-spin' : ''}`} />Refresh
            </button>
          </>
        )}
      />

      {error && (
        <div role="alert" className="flex gap-3 rounded-2xl bg-rose-50 px-4 sm:px-5 py-4 text-rose-800 ring-1 ring-inset ring-rose-200">
          <AlertOctagon className="w-5 h-5 mt-0.5 shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold break-words">{error}</p>
            {/not configured/.test(error) && (
              <p className="mt-1.5 text-[13px] leading-relaxed">
                To fix it, set <EnvName>NKERP_LOGIN_ID</EnvName> and <EnvName>NKERP_PASSWORD</EnvName> on the server (the same login Sync to NKERP uses), then refresh.
              </p>
            )}
            {/Could not read NKERP/.test(error) && <p className="mt-1.5 text-[13px] leading-relaxed">NKERP did not answer. Check it opens in the browser, then press Refresh. Nothing was sent.</p>}
          </div>
        </div>
      )}

      {/* Settings */}
      <section className={`${card} overflow-hidden`}>
        <div className="space-y-4 px-4 sm:px-5 py-4 sm:py-5">
          <div className={formRow}>
            <div className={rowLabel}>Send to</div>
            <div className="w-full sm:w-[21rem]">
              <Segmented label="Send to" value={settings.audience} onChange={(v) => settings.audience !== v && emails.setSettings({ audience: v })} options={AUDIENCE} />
            </div>
          </div>
          <div className={formRow}>
            <div className={rowLabel}>Najaf check-in</div>
            <SyncScopePicker scope={settings.scope} onChange={(scope) => emails.setSettings({ scope })} today={today} min={today}
              layout="inline" legend="Which Najaf check-in dates" allLabel="All ahead" idPrefix="emails-scope" disabled={emails.run.running} />
          </div>
          <div className={formRow}>
            <div className={rowLabel}>Also include</div>
            <div className="flex flex-wrap gap-x-6">
              {([['includePartial', 'Partly allotted tours'], ['includeSent', 'Already sent (send again)']] as const).map(([k, text]) => (
                <label key={k} className="inline-flex items-center gap-2.5 min-h-10 text-sm text-stone-800 cursor-pointer">
                  <input type="checkbox" checked={settings[k]} onChange={(e) => emails.setSettings({ [k]: e.target.checked })} className="w-4 h-4 accent-brand-700" />
                  {text}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 sm:px-5 py-3 border-t border-stone-200 bg-stone-50">
          <p className="text-sm text-stone-600 min-w-0 flex-1 basis-64">
            {!list ? (error ? 'Nothing to choose until NKERP can be read.' : 'Reading NKERP…') : <>These settings match <b className="font-semibold text-stone-950">{plural(matching.length, 'email')}</b> across {plural(days.length, 'date')}. Tick tours one by one below, or choose them all at once.</>}
          </p>
          <div className="flex gap-2">
            {emails.selected.size > 0 && (
              <button type="button" onClick={emails.clear} disabled={emails.run.running} className={btn.ghost}>Clear choices</button>
            )}
            <button type="button" onClick={() => emails.setMany(matching, true)} disabled={!matching.length || emails.run.running} className={btn.secondary}>
              <Check className="w-4 h-4 text-stone-500" />Choose all {matching.length || ''}
            </button>
          </div>
        </div>
      </section>

      <Problems emails={emails} />

      {loading && !list && (
        <div className="space-y-3" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${card} p-5 space-y-3`}>
              <div className="skeleton h-5 w-40" />
              <div className="skeleton h-10 w-full" />
              <div className="skeleton h-10 w-full" />
            </div>
          ))}
        </div>
      )}

      {list && days.length === 0 && (
        <div className={`${card} px-6 py-12 text-center`}>
          <Mail className="mx-auto w-7 h-7 text-stone-400" />
          <p className="mt-3 text-base font-semibold text-stone-950">{scopeBad ? 'No Najaf check-ins on these dates' : 'No Najaf stays ahead in NKERP'}</p>
          <p className="mt-1 text-sm text-stone-600">{scopeBad ? 'Pick other dates above, or choose All ahead.' : 'Tours appear here once NKERP schedules their Najaf stay.'}</p>
        </div>
      )}

      {days.length > 0 && (
        <div className="space-y-3">
          {/* Column labels */}
          <div className={`hidden md:grid ${COLS} gap-x-3 px-5 text-xs font-semibold text-stone-600`}>
            <span>Najaf check-in and tours</span>
            <span className="pl-3">{WHO.operator}</span>
            <span className="pl-3">{WHO.zaereen}</span>
          </div>
          {days.map((d, i) => (
            <DayBlock key={d.date} day={d} today={today} emails={emails} open={isOpen(d.date, i)}
              onToggle={() => setOpenDays((o) => ({ ...o, [d.date]: !isOpen(d.date, i) }))} />
          ))}
        </div>
      )}

      {(list && (list.excluded.length > 0 || days.length > 0)) && (
        <div className="space-y-1.5 text-[13px] leading-relaxed text-stone-500">
          {list.excluded.length > 0 && <p>Left out to stay safe: {list.excluded.join('; ')}.</p>}
          {days.length > 0 && (
            <p>Emails go out from NKERP, exactly like its two envelope buttons on View Tour Accommodation Status. Najaf only; a stay with no rooms assigned cannot be sent.</p>
          )}
        </div>
      )}

      <ActionBar emails={emails} onReview={() => setReviewing(true)} />
      {reviewing && <Review emails={emails} onClose={() => setReviewing(false)} />}
    </div>
  );
};
