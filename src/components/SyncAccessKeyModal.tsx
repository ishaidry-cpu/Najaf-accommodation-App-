import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import type { NkerpSyncState } from '../hooks/useNkerpSync';

/** Asks once for the sync access key (NKERP_SYNC_ACCESS_KEY; only when one is set), then remembers it on this device. */
export const SyncAccessKeyModal: React.FC<{ sync: NkerpSyncState }> = ({ sync }) => {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sync.needKey) {
      setValue('');
      setTimeout(() => input.current?.focus(), 50);
    }
  }, [sync.needKey]);

  if (!sync.needKey) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    try {
      await sync.submitKey(value);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/45 backdrop-blur-[2px] p-4" role="dialog" aria-modal="true"
      aria-labelledby="sync-key-title">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#f6f8f7] rounded-2xl border border-[#e2e8e5] shadow-2xl overflow-hidden">
        <div className="bg-[#0f4a37] px-4 py-3 flex items-center justify-between">
          <div id="sync-key-title" className="flex items-center gap-2 text-[#ecdcae] font-bold text-sm">
            <KeyRound className="w-4 h-4" /> Sync to NKERP access
          </div>
          <button type="button" onClick={sync.closeKeyPrompt} className="text-emerald-100 hover:text-white cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-stone-700 leading-relaxed">
            Enter the sync access key to run the NKERP sync from this device.{' '}
            It is remembered on this device until you sign it out from the Sync tab.
          </p>
          <input
            ref={input}
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f4a37]/40"
            placeholder="Access key"
            aria-label="Access key"
          />
          {sync.keyError && <p className="text-xs font-semibold text-rose-700">{sync.keyError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={sync.closeKeyPrompt}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-stone-700 hover:bg-stone-200 cursor-pointer">Cancel</button>
            <button type="submit" disabled={!value.trim() || checking}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#0f4a37] text-white disabled:opacity-50 cursor-pointer">
              {checking ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
