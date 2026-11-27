import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, CircleSlash, Info, Loader2, Mail, MailCheck, MailWarning, RefreshCcw, Send, Square,
  Users, X,
} from 'lucide-react';
import type { NkerpSyncState } from '../hooks/useNkerpSync';
import { type Audience, canSend, isSent, type NajafEmailsState } from '../hooks/useNajafEmails';
import { envKey, type NajafDay, type NajafStay, type Recipient } from '../services/najafEmails';
import { fmtDay } from '../services/nkerpSync';
import { Segmented, SyncScopePicker } from './SyncScopePicker';

const WHO: Record<Recipient, string> = { operator: 'Tour operator', zaereen: 'Zaereen' };
const AUDIENCE: { value: Audience; label: string }[] = [
  { value: 'operator', label: 'Tour operators' },
  { value: 'zaereen', label: 'Zaereen' },
  { value: 'both', label: 'Both' },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function relativeDay(iso: string, today: string): string {
  const diff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return `in ${diff} days`;
}

// ------------------------------------------------------------------------------------------------ envelope

/** One email of one tour: tick to choose it; shows NKERP's sent state and, during a run, its outcome. */
const Envelope: React.FC<{ stay: NajafStay; to: Recipient; emails: NajafEmailsState }> = ({ stay, to, emails }) => {
  const k = envKey(stay.key, to);
  const chosen = emails.selected.has(k);
  const sent = isSent(stay, to);
  const result = emails.run.results[k];
  const sending = emails.run.running && emails.run.current === k;
  const queued = emails.run.running && !result && emails.run.queue.includes(k);
  const base = 'w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium';
  const label = `${WHO[to]} email for ${stay.ref}`;

  if (!canSend(stay)) {
    return (
      <span className={`${base} text-stone-400 ring-1 ring-inset ring-dashed ring-stone-200`} title="NKERP has no rooms assigned for this stay yet, so it cannot send the plan">
        <CircleSlash className="w-3.5 h-3.5" />No rooms
      </span>
    );
  }
  if (sending) {
    return <span className={`${base} bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200`}><Loader2 className="w-3.5 h-3.5 animate-spin" />Sending</span>;
  }
  if (result) {
    const look: Record<string, [string, React.ReactNode, string]> = {
      confirmed: ['bg-emerald-50 text-emerald-800 ring-emerald-200 flash-ok', <MailCheck key="i" className="w-3.5 h-3.5 tick-pop" />, 'Sent'],
      sent: ['bg-emerald-50 text-emerald-800 ring-emerald-200', <Mail key="i" className="w-3.5 h-3.5" />, 'Sent, unconfirmed'],
      refused: ['bg-rose-50 text-rose-800 ring-rose-200', <MailWarning key="i" className="w-3.5 h-3.5" />, 'Refused'],
      uncertain: ['bg-amber-50 text-amber-900 ring-amber-200', <AlertTriangle key="i" className="w-3.5 h-3.5" />, 'Check NKERP'],
      skipped: ['bg-stone-100 text-stone-600 ring-stone-200', <Info key="i" className="w-3.5 h-3.5" />, 'Skipped'],
      'not-run': ['bg-stone-100 text-stone-600 ring-stone-200', <Info key="i" className="w-3.5 h-3.5" />, 'Not sent'],
    };
    const [cls, icon, text] = look[result.outcome];
    return <span className={`${base} ring-1 ring-inset ${cls}`} title={result.message}>{icon}{text}</span>;
  }
  return (
    <button type="button" role="checkbox" aria-checked={chosen} aria-label={label} disabled={emails.run.running}
      onClick={() => emails.toggle(stay, to)}
      title={sent ? (chosen ? 'Will be sent again' : 'NKERP shows this was sent. Tick to send it again') : chosen ? 'Chosen' : 'Tick to send'}
      className={`${base} cursor-pointer ring-1 ring-inset disabled:cursor-default ${
        queued ? 'opacity-70 ' : ''}${
        chosen && sent ? 'bg-amber-50 text-amber-900 ring-amber-300'
          : chosen ? 'bg-brand-700 text-white ring-brand-700 shadow-xs'
            : sent ? 'bg-white text-emerald-700 ring-stone-200 hover:ring-stone-300'
              : 'bg-white text-stone-500 ring-stone-200 hover:ring-brand-600/40 hover:text-stone-800'}`}>
      {chosen ? <Check key="on" className="w-3.5 h-3.5 tick-pop" /> : sent ? <MailCheck className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
      {chosen && sent ? 'Send again' : chosen ? (queued ? 'Waiting' : 'Chosen') : sent ? 'Sent' : 'Not sent'}
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
      className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default">
      <span className={`w-4 h-4 rounded-[5px] flex items-center justify-center ring-1 ring-inset ${
        all ? 'bg-brand-700 ring-brand-700 text-white' : on ? 'bg-brand-50 ring-brand-600 text-brand-700' : 'bg-white ring-stone-300'}`}>
        {all ? <Check className="w-3 h-3 tick-pop" /> : on ? <span className="w-2 h-0.5 rounded bg-current" /> : null}
      </span>
      <span className="tabular-nums">{keys.length ? `${on}/${keys.length}` : '—'}</span>
    </button>
  );
};

const ALLOT: Record<string, [string, string]> = {
  full: ['All rooms assigned', 'text-emerald-800 bg-emerald-50'],
  partial: ['Partly assigned', 'text-amber-900 bg-amber-50'],
  none: ['No rooms yet', 'text-stone-500 bg-stone-100'],
  unknown: ['Status unknown', 'text-stone-500 bg-stone-100'],
};

const StayRow: React.FC<{ stay: NajafStay; emails: NajafEmailsState }> = ({ stay, emails }) => (
  <li className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem] gap-x-2 gap-y-2 items-center px-4 py-3 border-t border-stone-100 hover:bg-stone-50/60 transition-colors">
    <div className="col-span-2 md:col-span-1 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="text-[13px] font-semibold text-stone-900 tabular-nums">{stay.ref}</span>
        <span className={`px-1.5 py-px rounded text-[11px] font-medium ${ALLOT[stay.allotment][1]}`}>{ALLOT[stay.allotment][0]}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500">
        <span className="truncate max-w-[18rem]">{stay.operator || 'Operator not named'}{stay.office ? `, ${stay.office}` : ''}</span>
        {stay.pax !== null && <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{plural(stay.pax, 'zair', 'zaereen')}</span>}
        <span>Najaf {fmtDay(stay.najafStart, { day: 'numeric', month: 'short' })}{stay.najafEnd && stay.najafEnd !== stay.najafStart ? ` to ${fmtDay(stay.najafEnd, { day: 'numeric', month: 'short' })}` : ''}</span>
      </div>
    </div>
    {(['operator', 'zaereen'] as const).map((to) => (
      <div key={to} className="min-w-0">
        <div className="md:hidden mb-1 text-[11px] text-stone-500">{WHO[to]}</div>
        <Envelope stay={stay} to={to} emails={emails} />
      </div>
    ))}
  </li>
);

const DayBlock: React.FC<{ day: NajafDay; today: string; emails: NajafEmailsState; open: boolean; onToggle: () => void }> = ({ day, today, emails, open, onToggle }) => {
  const zaereen = day.stays.reduce((n, s) => n + (s.pax ?? 0), 0);
  const chosen = day.stays.reduce((n, s) => n + (['operator', 'zaereen'] as const).filter((r) => emails.isSelected(s.key, r)).length, 0);
  return (
    <section className="rounded-2xl bg-white border border-stone-200 shadow-2xs overflow-hidden">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem] gap-x-2 items-center px-4 py-2.5 bg-stone-50/70">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer group">
          <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${open ? '' : '-rotate-90'} group-hover:text-stone-700`} />
          <span className="type-display text-[19px] leading-none font-semibold text-stone-950 tabular-nums">
            {fmtDay(day.date, { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <span className="text-xs text-stone-500 whitespace-nowrap">{relativeDay(day.date, today)}</span>
          <span className="hidden sm:inline text-xs text-stone-500 whitespace-nowrap">{plural(day.stays.length, 'tour')}, {plural(zaereen, 'zair', 'zaereen')}</span>
          {chosen > 0 && <span className="text-[11px] font-semibold text-brand-700 bg-brand-50 rounded-full px-2 py-0.5 whitespace-nowrap">{chosen} chosen</span>}
        </button>
        <div className="hidden md:block"><ColumnTick stays={day.stays} to="operator" emails={emails} /></div>
        <div className="hidden md:block"><ColumnTick stays={day.stays} to="zaereen" emails={emails} /></div>
        <div className="md:hidden flex gap-1">
          <button type="button" disabled={emails.run.running} onClick={() => {
            const keys = emails.eligible(day.stays);
            emails.setMany(keys, !keys.every((k) => emails.selected.has(k)));
          }} className="h-8 px-2.5 rounded-lg text-xs font-medium text-brand-700 hover:bg-brand-50 cursor-pointer">Choose all</button>
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
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-stone-950/40 backdrop-blur-[2px] p-3 animate-in fade-in duration-150" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="email-review-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-3 duration-200">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h2 id="email-review-title" className="type-display text-[22px] leading-tight font-semibold text-stone-950">Send {plural(items.length, 'email')}?</h2>
            <p className="mt-1 text-[13px] text-stone-500">NKERP sends them straight away. An email cannot be recalled once it goes out.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <ul className="mx-5 mt-4 max-h-60 overflow-y-auto rounded-xl ring-1 ring-stone-200 divide-y divide-stone-100">
          {byDay.map(([date, c]) => (
            <li key={date} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
              <span className="font-medium text-stone-900">{fmtDay(date)}</span>
              <span className="text-stone-500 text-xs text-right">
                {c.operator > 0 && <span>{plural(c.operator, 'tour operator')}</span>}
                {c.operator > 0 && c.zaereen > 0 && <span>, </span>}
                {c.zaereen > 0 && <span>zaereen of {plural(c.zaereen, 'tour')}</span>}
              </span>
            </li>
          ))}
        </ul>
        {(resends > 0 || partial > 0) && (
          <div className="mx-5 mt-3 space-y-1.5">
            {resends > 0 && <p className="flex gap-2 text-xs text-amber-900"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />{plural(resends, 'email')} NKERP already shows as sent will go out again.</p>}
            {partial > 0 && <p className="flex gap-2 text-xs text-amber-900"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />{plural(partial, 'tour')} only partly allotted: the plan will list the rooms assigned so far.</p>}
          </div>
        )}
        <div className="flex gap-2 p-5">
          <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg text-[13px] font-medium text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 cursor-pointer">Cancel</button>
          <button type="button" onClick={() => { onClose(); void emails.send(); }}
            className="flex-[1.4] h-10 inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold bg-brand-700 hover:bg-brand-800 text-white shadow-xs cursor-pointer">
            <Send className="w-4 h-4 text-gold-200" />Send {plural(items.length, 'email')}
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
      <div role="status" aria-live="polite" className="rise-enter pointer-events-auto w-full max-w-2xl rounded-2xl bg-stone-950 text-white shadow-2xl ring-1 ring-white/10 overflow-hidden">
        {run.running && <div className="h-0.5 bg-white/10"><div className="h-full bg-gold-400 transition-all duration-500" style={{ width: `${pct}%` }} /></div>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          {run.running ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-gold-200" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">Sending {Math.min(done + 1, run.total)} of {run.total}</div>
                <div className="text-xs text-white/60 truncate">{run.stopping ? 'Stopping after this one…' : 'Keep this page open. One email at a time; none is ever sent twice by itself.'}</div>
              </div>
              <button type="button" onClick={emails.stop} disabled={run.stopping}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium bg-white/10 hover:bg-white/15 disabled:opacity-50 cursor-pointer">
                <Square className="w-3.5 h-3.5" />Stop after this one
              </button>
            </>
          ) : (s || run.error) && !items.length ? (
            <>
              {s && !s.refused && !s.uncertain && !run.error ? <MailCheck className="w-4 h-4 text-emerald-300" /> : <AlertTriangle className="w-4 h-4 text-amber-300" />}
              <div className="min-w-0 flex-1 text-[13px]">
                {s ? (
                  <span><b className="font-semibold">{plural(s.confirmed + s.sent, 'email')} sent</b>
                    {s.confirmed !== s.confirmed + s.sent && <span className="text-white/70">, {s.confirmed} confirmed by NKERP</span>}
                    {s.refused > 0 && <span className="text-rose-200">, {s.refused} refused</span>}
                    {s.uncertain > 0 && <span className="text-amber-200">, {s.uncertain} to check in NKERP</span>}
                    {s.skipped > 0 && <span className="text-white/70">, {s.skipped} skipped</span>}
                    {s.notRun > 0 && <span className="text-white/70">, {s.notRun} not sent</span>}.
                  </span>
                ) : null}
                {(run.error || s?.stopped) && <div className="text-xs text-white/70">{run.error || s?.stopped}</div>}
              </div>
              <button type="button" onClick={emails.dismissRun} className="h-9 px-3 rounded-lg text-[13px] font-medium bg-white/10 hover:bg-white/15 cursor-pointer">Done</button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{plural(items.length, 'email')} chosen</div>
                <div className="text-xs text-white/60">{plural(toOps, 'to a tour operator', 'to tour operators')}, {items.length - toOps} to zaereen</div>
              </div>
              <button type="button" onClick={emails.clear} className="h-9 px-3 rounded-lg text-[13px] font-medium text-white/80 hover:bg-white/10 cursor-pointer">Clear</button>
              <button type="button" onClick={onReview}
                className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold bg-gold-400 text-stone-950 hover:bg-gold-200 cursor-pointer">
                <Send className="w-3.5 h-3.5" />Review and send
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ page

const Problems: React.FC<{ emails: NajafEmailsState }> = ({ emails }) => {
  const list = Object.values(emails.run.results).filter((r) => r.outcome !== 'confirmed');
  if (emails.run.running || !list.length) return null;
  return (
    <section className="rounded-2xl bg-white border border-amber-200 shadow-2xs overflow-hidden animate-in fade-in duration-200">
      <header className="px-4 py-2.5 text-[13px] font-semibold text-stone-900 flex items-center gap-2 border-b border-amber-100 bg-amber-50/60">
        <AlertTriangle className="w-4 h-4 text-amber-600" />From the last send: {plural(list.length, 'email')} to look at
      </header>
      <ul className="max-h-56 overflow-y-auto divide-y divide-stone-100">
        {list.map((r) => (
          <li key={envKey(r.stay, r.to)} className="px-4 py-2 text-xs">
            <span className="font-semibold text-stone-900">{r.ref || r.stay}</span>
            <span className="text-stone-500"> ({WHO[r.to].toLowerCase()}, Najaf {fmtDay(r.najafStart, { day: 'numeric', month: 'short' })}): </span>
            <span className="text-stone-700">{r.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

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
    <div className="space-y-3 pb-28">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between pt-1 md:pt-3 pb-1">
        <div className="min-w-0">
          <h1 className="type-display text-[26px] md:text-[32px] leading-none font-semibold text-stone-950">Najaf emails</h1>
          <p className="mt-2 text-sm text-stone-500 max-w-2xl">
            Send NKERP's Najaf accommodation plan to the tour operator, the zaereen, or both: for one tour, one date, or everything ahead. Karbala stays are never listed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {list && <span className="text-xs text-stone-500">Read from NKERP at {new Date(list.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" onClick={() => void emails.refresh()} disabled={loading || emails.run.running}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium bg-white text-stone-800 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 shadow-xs disabled:opacity-50 cursor-pointer">
            <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </div>

      {/* Settings */}
      <section className="rounded-2xl bg-white border border-stone-200 shadow-2xs">
        <div className="grid gap-x-6 gap-y-3 px-4 py-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div className="text-[13px] font-medium text-stone-800">Send to</div>
          <div className="w-full max-w-sm">
            <Segmented label="Send to" value={settings.audience} onChange={(v) => settings.audience !== v && emails.setSettings({ audience: v })} options={AUDIENCE} />
          </div>
          <div className="text-[13px] font-medium text-stone-800">Najaf check-in</div>
          <SyncScopePicker scope={settings.scope} onChange={(scope) => emails.setSettings({ scope })} today={today} min={today}
            layout="inline" legend="Which Najaf check-in dates" allLabel="All ahead" idPrefix="emails-scope" disabled={emails.run.running} />
          <div className="text-[13px] font-medium text-stone-800">Also include</div>
          <div className="flex flex-wrap gap-2">
            {([['includePartial', 'Partly allotted tours'], ['includeSent', 'Already sent (send again)']] as const).map(([k, text]) => (
              <label key={k} className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] cursor-pointer ring-1 ring-inset transition-colors ${
                settings[k] ? 'bg-brand-50 text-brand-800 ring-brand-100' : 'bg-white text-stone-600 ring-stone-200 hover:ring-stone-300'}`}>
                <input type="checkbox" checked={settings[k]} onChange={(e) => emails.setSettings({ [k]: e.target.checked })} className="accent-brand-700 w-3.5 h-3.5" />
                {text}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-stone-100 bg-stone-50/60 rounded-b-2xl">
          <p className="text-xs text-stone-600">
            {!list ? (error ? 'Nothing to choose until NKERP can be read.' : 'Reading NKERP…') : <>These settings match <b className="font-semibold text-stone-900">{plural(matching.length, 'email')}</b> across {plural(days.length, 'date')}. Tick tours one by one below, or choose them all at once.</>}
          </p>
          <div className="flex gap-2">
            {emails.selected.size > 0 && (
              <button type="button" onClick={emails.clear} disabled={emails.run.running} className="h-9 px-3 rounded-lg text-[13px] font-medium text-stone-600 hover:bg-stone-200/60 cursor-pointer">Clear choices</button>
            )}
            <button type="button" onClick={() => emails.setMany(matching, true)} disabled={!matching.length || emails.run.running}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium bg-brand-700 hover:bg-brand-800 text-white shadow-xs disabled:opacity-50 cursor-pointer">
              <Check className="w-3.5 h-3.5" />Choose all {matching.length || ''}
            </button>
          </div>
        </div>
      </section>

      <Problems emails={emails} />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-900">
          <div className="font-semibold">{error}</div>
          {/not configured/.test(error) && <div className="mt-0.5 text-xs">Set NKERP_LOGIN_ID and NKERP_PASSWORD on the server (the same login Sync to NKERP uses), then refresh.</div>}
          {/Could not read NKERP/.test(error) && <div className="mt-0.5 text-xs">NKERP did not answer. Check it opens in the browser, then press Refresh. Nothing was sent.</div>}
        </div>
      )}

      {/* Column labels */}
      {days.length > 0 && (
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_8.5rem_8.5rem] gap-x-2 px-4 text-xs font-medium text-stone-500">
          <span>Najaf check-in and tours</span>
          <span className="text-center">{WHO.operator}</span>
          <span className="text-center">{WHO.zaereen}</span>
        </div>
      )}

      {loading && !list && (
        <div className="space-y-3" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl bg-white border border-stone-200 p-4 space-y-3">
              <div className="skeleton h-5 w-40" />
              <div className="skeleton h-9 w-full" />
              <div className="skeleton h-9 w-full" />
            </div>
          ))}
        </div>
      )}

      {list && days.length === 0 && (
        <div className="rounded-2xl bg-white border border-stone-200 px-6 py-10 text-center">
          <Mail className="mx-auto w-7 h-7 text-stone-300" />
          <p className="mt-3 text-[15px] font-semibold text-stone-900">{scopeBad ? 'No Najaf check-ins on these dates' : 'No Najaf stays ahead in NKERP'}</p>
          <p className="mt-1 text-[13px] text-stone-500">{scopeBad ? 'Pick other dates above, or choose All ahead.' : 'Tours appear here once NKERP schedules their Najaf stay.'}</p>
        </div>
      )}

      <div className="space-y-3">
        {days.map((d, i) => (
          <DayBlock key={d.date} day={d} today={today} emails={emails} open={isOpen(d.date, i)}
            onToggle={() => setOpenDays((o) => ({ ...o, [d.date]: !isOpen(d.date, i) }))} />
        ))}
      </div>

      {list && list.excluded.length > 0 && (
        <p className="text-xs text-stone-500">Left out to stay safe: {list.excluded.join('; ')}.</p>
      )}
      {list && days.length > 0 && (
        <p className="text-xs text-stone-500">
          Emails go out from NKERP, exactly like its two envelope buttons on View Tour Accommodation Status. Najaf only; a stay with no rooms assigned cannot be sent.
        </p>
      )}

      <ActionBar emails={emails} onReview={() => setReviewing(true)} />
      {reviewing && <Review emails={emails} onClose={() => setReviewing(false)} />}
    </div>
  );
};
