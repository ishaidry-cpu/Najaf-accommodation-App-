import React from 'react';
import type { SyncScope } from '../services/nkerpSync';

const MODES: { mode: SyncScope['mode']; label: string }[] = [
  { mode: 'all', label: 'Everything' },
  { mode: 'day', label: 'One date' },
  { mode: 'range', label: 'Date range' },
];

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The app's segmented control: a few choices side by side, the chosen one on a white thumb that slides to it.
 * 40px tall so it lines up with buttons and fields. Generic so the emails page can reuse it.
 */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label}
      className={`relative grid rounded-lg bg-stone-100 px-1 ring-1 ring-inset ring-stone-200 ${size === 'sm' ? 'h-10 sm:h-9' : 'h-10'}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span aria-hidden className="absolute top-1 bottom-1 left-1 rounded-md bg-white shadow-xs ring-1 ring-stone-300 transition-transform duration-200 ease-out"
        style={{ width: `calc((100% - 8px) / ${options.length})`, transform: `translateX(${i * 100}%)` }} />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={`relative z-10 px-2 rounded-md text-[13px] whitespace-nowrap cursor-pointer ${
            o.value === value ? 'font-semibold text-stone-950' : 'font-medium text-stone-600 hover:text-stone-950'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* A date field at the shared field height; its width comes from the layout (fixed inline, stretched when stacked). */
const dateInput = 'h-10 min-w-0 rounded-lg border bg-white px-2.5 text-sm text-stone-900 tabular-nums disabled:bg-stone-100 disabled:text-stone-500';
const quickDay = 'h-10 px-3 rounded-lg text-[13px] font-medium whitespace-nowrap cursor-pointer transition disabled:cursor-not-allowed';

/** Choose which arrivals a sync covers: everything, one arrival date, or a date range. */
export const SyncScopePicker: React.FC<{
  scope: SyncScope;
  onChange: (s: SyncScope) => void;
  today: string;
  layout?: 'stack' | 'inline';
  disabled?: boolean;
  /** Earliest date allowed (default: 21 days back, the sync's lookback). */
  min?: string;
  legend?: string;
  allLabel?: string;
  idPrefix?: string;
}> = ({ scope, onChange, today, layout = 'stack', disabled, min: minProp, legend = 'Which arrivals to sync', allLabel = 'Everything', idPrefix = 'sync-scope' }) => {
  const min = minProp ?? addDaysIso(today, -21);
  const id = (k: string) => `${idPrefix}-${k}`;
  const set = (patch: Partial<SyncScope>) => onChange({ ...scope, ...patch });
  const choose = (mode: SyncScope['mode']) => {
    if (mode === 'day' && !scope.day) set({ mode, day: today });
    else if (mode === 'range' && (!scope.from || !scope.to)) set({ mode, from: scope.from || today, to: scope.to || addDaysIso(today, 6) });
    else set({ mode });
  };
  const reversed = scope.mode === 'range' && scope.from && scope.to && scope.from > scope.to;
  const inline = layout === 'inline';
  const dateWidth = inline ? 'flex-1 sm:flex-none sm:w-40' : 'flex-1';
  return (
    <fieldset disabled={disabled} className={`min-w-0 ${inline ? 'flex flex-wrap items-start gap-x-3 gap-y-2' : 'space-y-2.5'} ${disabled ? 'opacity-60' : ''}`}>
      <legend className="sr-only">{legend}</legend>
      <div className={inline ? 'w-full sm:w-[21rem]' : ''}>
        <Segmented label={legend} value={scope.mode} onChange={choose}
          options={MODES.map((m) => ({ value: m.mode, label: m.mode === 'all' ? allLabel : m.label }))} />
      </div>
      {scope.mode === 'day' && (
        <div key="day" className={`flex items-center gap-1.5 animate-in fade-in slide-in-from-top-2 duration-200 ${inline ? 'w-full sm:w-auto' : ''}`}>
          <label className="sr-only" htmlFor={id('day')}>Date</label>
          <input id={id('day')} type="date" value={scope.day} min={min} onChange={(e) => set({ day: e.target.value })}
            className={`${dateInput} border-stone-300 ${dateWidth}`} />
          {[{ label: 'Today', iso: today }, { label: 'Tomorrow', iso: addDaysIso(today, 1) }].map((q) => (
            <button key={q.label} type="button" onClick={() => set({ day: q.iso })} aria-pressed={scope.day === q.iso}
              className={`${quickDay} ${scope.day === q.iso
                ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-950'}`}>
              {q.label}
            </button>
          ))}
        </div>
      )}
      {scope.mode === 'range' && (
        <div key="range" className={`animate-in fade-in slide-in-from-top-2 duration-200 ${inline ? 'w-full sm:w-auto' : ''}`}>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={id('from')}>First date</label>
            <input id={id('from')} type="date" value={scope.from} min={min} onChange={(e) => set({ from: e.target.value })}
              className={`${dateInput} border-stone-300 ${dateWidth}`} />
            <span className="text-[13px] text-stone-500" aria-hidden>to</span>
            <label className="sr-only" htmlFor={id('to')}>Last date</label>
            <input id={id('to')} type="date" value={scope.to} min={scope.from || min} onChange={(e) => set({ to: e.target.value })}
              aria-invalid={reversed ? true : undefined}
              className={`${dateInput} ${dateWidth} ${reversed ? 'border-rose-500' : 'border-stone-300'}`} />
          </div>
          {reversed && <p className="mt-1.5 text-[13px] text-rose-700">The range ends before it starts.</p>}
        </div>
      )}
    </fieldset>
  );
};
