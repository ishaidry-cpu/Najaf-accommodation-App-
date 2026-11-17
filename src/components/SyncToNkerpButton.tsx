import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import type { NkerpSyncState } from '../hooks/useNkerpSync';

interface Props {
  sync: NkerpSyncState;
  /** Open the Sync tab (for the attention badge, setup problems and while running). */
  onOpenSyncTab: () => void;
  compact?: boolean;
}

/** The one button: runs the full Najaf accommodation sync (Sheet -> NKERP) on the app's server. */
export const SyncToNkerpButton: React.FC<Props> = ({ sync, onOpenSyncTab, compact = false }) => {
  const { active, running, busy, config, attentionCount, last } = sync;
  const progress = active?.progress;
  const pct = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : null;
  const notConfigured = config !== null && !config.configured;

  const onClick = () => {
    if (running) {
      onOpenSyncTab();
      return;
    }
    if (notConfigured) {
      onOpenSyncTab();
      return;
    }
    void sync.startSync();
  };

  const label = running
    ? `Syncing${pct !== null && active?.stage === 'read-tours' ? ` ${pct}%` : '…'}`
    : 'Sync to NKERP';
  const title = running
    ? `Sync running: ${active?.stage ?? ''}. Click to watch it in the Sync tab.`
    : notConfigured
      ? `Sync is not configured on the server: ${config?.problem ?? ''}`
      : 'Run the Najaf accommodation sync now: deallocate, reallocate and allocate in NKERP from the Google Sheet';

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={busy && !running}
        title={title}
        aria-label={label}
        className={`relative overflow-hidden flex items-center gap-1.5 rounded-lg font-medium transition cursor-pointer whitespace-nowrap ${
          compact ? 'h-9 px-2.5 text-[13px]' : 'h-9 px-3 text-[13px]'
        } ${
          running
            ? 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200'
            : notConfigured
              ? 'bg-stone-100 text-stone-600'
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
            <RefreshCcw className={`w-4 h-4 ${notConfigured ? '' : 'text-gold-200'}`} />
          )}
          <span>{compact && !running ? 'NKERP' : label}</span>
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
    </div>
  );
};
