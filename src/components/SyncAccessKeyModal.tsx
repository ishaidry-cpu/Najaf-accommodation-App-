import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { NkerpSyncState } from '../hooks/useNkerpSync';
import { btn, field, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle } from './ui';

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
    <div className={modalScrim} style={{ zIndex: 60 }} role="dialog" aria-modal="true" aria-labelledby="sync-key-title">
      <form onSubmit={submit} className={`${modalCard} max-w-sm`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h2 id="sync-key-title" className={modalTitle}>Sync to NKERP access</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-600">
              Enter the sync access key to run the NKERP sync from this device.
            </p>
          </div>
          <button type="button" onClick={sync.closeKeyPrompt} className={modalClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 sm:px-6 py-5">
          <label htmlFor="sync-key-input" className={fieldLabel}>Access key</label>
          <input
            id="sync-key-input"
            ref={input}
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={sync.keyError ? true : undefined}
            aria-describedby="sync-key-help"
            className={sync.keyError ? field.replace('border-stone-300', 'border-rose-500') : field}
            placeholder="Access key"
          />
          <div id="sync-key-help">
            {sync.keyError && <p role="alert" className="mt-1.5 text-[13px] font-medium text-rose-700">{sync.keyError}</p>}
            <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500">
              It is remembered on this device until you sign it out from the Sync tab.
            </p>
          </div>
        </div>
        <div className={modalFooter}>
          <button type="button" onClick={sync.closeKeyPrompt} className={btn.secondary}>Cancel</button>
          <button type="submit" disabled={!value.trim() || checking} className={btn.primary}>
            {checking ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
};
