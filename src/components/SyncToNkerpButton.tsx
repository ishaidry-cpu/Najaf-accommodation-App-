import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, Loader2, RefreshCcw } from 'lucide-react';
import type { NkerpSyncState } from '../hooks/useNkerpSync';
import { scopeOptions, scopeText } from '../services/nkerpSync';
import { SyncScopePicker } from './SyncScopePicker';

interface Props {
  sync: NkerpSyncState;
  /** Open the Sync tab (for the attention badge, setup problems and while running). */
  onOpenSyncTab: () => void;
  compact?: boolean;
}

/**
 * Sync to NKERP in the top bar. Opens a small panel to choose which arrivals to cover (everything, one date
 * or a date range), then Preview or Sync. While a run is going it opens the Sync tab instead.
 */
export const SyncToNkerpButton: React.FC<Props> = ({ sync, onOpenSyncTab, compact = false }) => {
  const { active, running, busy, config, attentionCount, last } = sync;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const progress = active?.progress;
  const pct = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : null;
  const notConfigured = config !== null && !config.configured;
  const today = config?.today ?? new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onClick = () => {
    if (running) {
      onOpenSyncTab();
      return;
    }
    setOpen((v) => !v);
  };

  const go = (preview: boolean) => {
    setOpen(false);
    void (preview ? sync.startPreview() : sync.startSync());
  };

  const label = running
    ? `${active?.options.apply ? 'Syncing' : 'Previewing'}${pct !== null && active?.stage === 'read-tours' ? ` ${pct}%` : '…'}`
    : 'Sync to NKERP';
  const title = running
    ? `Running: ${active?.stage ?? ''}. Click to watch it in the Sync tab.`
    : notConfigured
      ? `Sync is not configured on the server: ${config?.problem ?? ''}`
      : 'Choose the arrivals, then preview or sync Najaf rooms to NKERP';

  return (
    <div className="relative flex items-center gap-1 shrink-0" ref={ref}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy && !running}
        title={title}
        aria-label={label}
        aria-haspopup={running ? undefined : 'dialog'}
        aria-expanded={running ? undefined : open}
        className={`group relative overflow-hidden flex items-center gap-1.5 rounded-lg font-medium cursor-pointer whitespace-nowrap h-9 ${
          compact ? 'px-2.5 text-[13px]' : 'pl-3 pr-2.5 text-[13px]'
        } ${
          running
            ? 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200'
            : notConfigured
              ? 'bg-stone-100 text-stone-600'
              : open
                ? 'bg-brand-800 text-white shadow-xs'
                : 'bg-brand-700 hover:bg-brand-800 text-white shadow-xs'
        }`}
      >
        {running && pct !== null && (
          <span className="absolute inset-y-0 left-0 bg-amber-200/60 transition-all duration-500" style={{ width: `${pct}%` }} aria-hidden />
        )}
        <span className="relative flex items-center gap-1.5">
          {running || busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCcw className={`w-4 h-4 transition-transform duration-500 group-hover:-rotate-180 ${notConfigured ? '' : 'text-gold-200'}`} />
          )}
          <span>{compact && !running ? 'NKERP' : label}</span>
          {!running && !compact && (
            <ChevronDown className={`w-3.5 h-3.5 ${notConfigured ? 'text-stone-400' : 'text-white/70'} transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          )}
        </span>
      </button>
      {!running && last && (
        <button
          type="button"
          onClick={onOpenSyncTab}
          title={attentionCount ? `${attentionCount} item(s) from the last sync need you` : 'Last sync: nothing needs you'}
          aria-label={attentionCount ? `${attentionCount} sync items need you` : 'Last sync finished cleanly'}
          className={`flex items-center justify-center rounded-lg cursor-pointer h-9 ${compact ? 'min-w-8 px-1.5' : 'min-w-9 px-2'} ${
            attentionCount ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'text-emerald-700 hover:bg-emerald-50'
          }`}
        >
          {attentionCount ? (
            <span className="flex items-center gap-1 text-xs font-semibold tabular-nums"><AlertTriangle className="w-3.5 h-3.5" />{attentionCount}</span>
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
        </button>
      )}

      {open && (
        <div role="dialog" aria-label="Sync to NKERP"
          className={`pop-enter z-50 rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl ${
            compact ? 'fixed left-3 right-3 top-16' : 'absolute right-0 top-[calc(100%+8px)] w-[23rem]'}`}>
          <div className="mb-3">
            <div className="text-[15px] font-semibold text-stone-950">Sync to NKERP</div>
            <p className="mt-0.5 text-xs leading-relaxed text-stone-500">Brings Najaf rooms in NKERP in line with saved app allocations, for the arrivals you choose.</p>
          </div>
          {notConfigured && (
            <p className="mb-3 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
              The sync is not set up on the server yet. The Sync tab lists what is missing.
            </p>
          )}
          <SyncScopePicker scope={sync.scope} onChange={sync.setScope} today={today} idPrefix="sync-pop" />
          <p className="mt-3 text-xs text-stone-600" aria-live="polite">
            {sync.scopeReady
              ? <>Covers <span className="font-semibold text-stone-900">{scopeText(scopeOptions(sync.scope))}</span>.</>
              : 'Pick the dates to continue.'}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => go(true)} disabled={!sync.scopeReady || busy || notConfigured}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-medium bg-white text-stone-800 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 disabled:opacity-50 cursor-pointer">
              <Eye className="w-3.5 h-3.5" />Preview
            </button>
            <button type="button" onClick={() => go(false)} disabled={!sync.scopeReady || busy || notConfigured}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-medium bg-brand-700 hover:bg-brand-800 text-white shadow-xs disabled:opacity-50 cursor-pointer">
              <RefreshCcw className="w-3.5 h-3.5 text-gold-200" />Sync now
            </button>
          </div>
          <button type="button" onClick={() => { setOpen(false); onOpenSyncTab(); }}
            className="mt-2.5 w-full text-center text-xs font-medium text-stone-500 hover:text-brand-700 cursor-pointer">
            Open the Sync tab for the log and history
          </button>
        </div>
      )}
    </div>
  );
};
