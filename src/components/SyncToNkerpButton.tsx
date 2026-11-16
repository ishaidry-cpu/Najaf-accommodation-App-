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
  const { active, running, busy, config, attentionCount, status } = sync;
  const progress = active?.progress;
  const pct = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : null;
  const notConfigured = config !== null && !config.configured;
  const last = status?.latest;

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
        className={`relative overflow-hidden flex items-center gap-1.5 rounded-xl font-bold transition cursor-pointer whitespace-nowrap border shadow-2xs ${
          compact ? 'min-h-[40px] px-2 text-[11px]' : 'px-2.5 py-1.5 text-xs'
        } ${
          running
            ? 'bg-amber-50 text-amber-950 border-amber-300'
            : notConfigured
              ? 'bg-stone-100 text-stone-600 border-stone-300'
              : 'bg-[#0E3C2C] hover:bg-[#124E39] text-[#EBD59E] border-[#C5A059]/50'
        }`}
      >
        {running && pct !== null && (
          <span className="absolute inset-y-0 left-0 bg-amber-200/70 transition-all duration-500" style={{ width: `${pct}%` }} aria-hidden />
        )}
        <span className="relative flex items-center gap-1.5">
          {running || busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
          <span>{compact && !running ? 'NKERP' : label}</span>
        </span>
      </button>
      {!running && last && (
        <button
          type="button"
          onClick={onOpenSyncTab}
          title={attentionCount ? `${attentionCount} item(s) from the last sync need you` : 'Last sync: nothing needs you'}
          className={`flex items-center justify-center rounded-lg border cursor-pointer ${compact ? 'min-w-[28px] min-h-[40px]' : 'w-7 h-7'} ${
            attentionCount ? 'bg-rose-50 border-rose-300 text-rose-800' : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}
        >
          {attentionCount ? (
            <span className="flex items-center gap-0.5 text-[10px] font-extrabold"><AlertTriangle className="w-3 h-3" />{attentionCount}</span>
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
};
