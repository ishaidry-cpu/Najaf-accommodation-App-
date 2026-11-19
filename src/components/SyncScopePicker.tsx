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
 * A three-way segmented control whose thumb slides to the choice. Generic so the emails page can reuse it.
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
      className={`relative grid rounded-lg bg-stone-100 p-0.5 ring-1 ring-inset ring-stone-200/70 ${size === 'sm' ? 'h-8' : 'h-9'}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span aria-hidden className="absolute top-0.5 bottom-0.5 left-0.5 rounded-md bg-white shadow-sm ring-1 ring-stone-200/80 transition-transform duration-300"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${i * 100}%)`, transitionTimingFunction: 'var(--ease-spring)' }} />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={`relative z-10 px-2.5 rounded-md whitespace-nowrap cursor-pointer ${size === 'sm' ? 'text-xs' : 'text-[13px]'} font-medium ${
            o.value === value ? 'text-stone-950' : 'text-stone-500 hover:text-stone-800'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const dateInput = 'h-9 w-full min-w-0 rounded-lg bg-white px-2.5 text-[13px] text-stone-900 ring-1 ring-inset ring-stone-200 hover:ring-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-600 tabular-nums';

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
  return (
    <fieldset disabled={disabled} className={`min-w-0 ${layout === 'inline' ? 'flex flex-wrap items-center gap-2' : 'space-y-2.5'}`}>
      <legend className="sr-only">{legend}</legend>
      <div className={layout === 'inline' ? 'w-[19rem] max-w-full' : ''}>
        <Segmented label={legend} value={scope.mode} onChange={choose}
          options={MODES.map((m) => ({ value: m.mode, label: m.mode === 'all' ? allLabel : m.label }))} />
      </div>
      {scope.mode === 'day' && (
        <div key="day" className="flex items-center gap-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
          <label className="sr-only" htmlFor={id('day')}>Date</label>
          <input id={id('day')} type="date" value={scope.day} min={min} onChange={(e) => set({ day: e.target.value })}
            className={`${dateInput} ${layout === 'inline' ? 'w-40' : 'flex-1'}`} />
          {[{ label: 'Today', iso: today }, { label: 'Tomorrow', iso: addDaysIso(today, 1) }].map((q) => (
            <button key={q.label} type="button" onClick={() => set({ day: q.iso })}
              className={`h-9 px-2.5 rounded-lg text-xs font-medium cursor-pointer ${scope.day === q.iso
                ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100' : 'text-stone-600 hover:bg-stone-100'}`}>
              {q.label}
            </button>
          ))}
        </div>
      )}
      {scope.mode === 'range' && (
        <div key="range" className="animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor={id('from')}>First date</label>
            <input id={id('from')} type="date" value={scope.from} min={min} onChange={(e) => set({ from: e.target.value })}
              className={`${dateInput} ${layout === 'inline' ? 'w-40' : 'flex-1'}`} />
            <span className="text-stone-400 text-xs" aria-hidden>to</span>
            <label className="sr-only" htmlFor={id('to')}>Last date</label>
            <input id={id('to')} type="date" value={scope.to} min={scope.from || min} onChange={(e) => set({ to: e.target.value })}
              className={`${dateInput} ${layout === 'inline' ? 'w-40' : 'flex-1'} ${reversed ? 'ring-rose-400' : ''}`} />
          </div>
          {reversed && <p className="mt-1 text-xs text-rose-700">The range ends before it starts.</p>}
        </div>
      )}
    </fieldset>
  );
};
