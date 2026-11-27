import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { fetchHiddenStays, restoreHiddenStays, type HiddenStay } from '../services/api';
import { btn } from './ui';

const when = (v: string) => {
  const date = new Date(String(v).slice(0, 16) + 'Z');
  return Number.isNaN(date.getTime()) ? v : date.toLocaleString('en-GB', { day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
};

/**
 * Stays NKERP still lists that the app hides because someone deleted them here. Restoring brings them back on
 * the next NKERP pull, which starts straight away.
 */
export const HiddenStaysModal: React.FC<{ onClose: () => void; onRestored: (count: number) => void }> = ({ onClose, onRestored }) => {
  const [stays, setStays] = useState<HiddenStay[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchHiddenStays().then(setStays).catch((e: Error) => setError(e.message));
  }, []);
  const tours = useMemo(() => {
    const out = new Map<string, HiddenStay[]>();
    for (const s of stays || []) out.set(s.tour, [...(out.get(s.tour) || []), s]);
    return [...out];
  }, [stays]);
  const restore = async (keys: string[]) => {
    setBusy(true);
    try {
      const { restored } = await restoreHiddenStays(keys);
      setStays((list) => (list || []).filter((s) => !keys.includes(s.key)));
      onRestored(restored);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 p-5 border-b border-stone-100">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Deleted NKERP stays</h2>
            <p className="text-xs text-stone-500 mt-1">
              NKERP still lists these zaereen, but they were deleted in the app, so they are hidden. A stay comes back by
              itself when NKERP changes its dates. Restore brings it back now.
            </p>
          </div>
          <button type="button" onClick={onClose} className={btn.ghost} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          {error && <div className="text-sm text-red-700">{error}</div>}
          {!stays && !error && <div className="text-sm text-stone-500">Loading…</div>}
          {stays && !stays.length && <div className="text-sm text-stone-500">Nothing is hidden. Every stay NKERP lists is in the app.</div>}
          {tours.map(([tour, list]) => (
            <div key={tour} className="rounded-xl ring-1 ring-stone-200">
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-stone-50 rounded-t-xl">
                <div className="text-sm font-medium text-stone-900">
                  {tour.replace(/^NKERP\/TOUR\//i, '')}
                  <span className="text-stone-500 font-normal"> · {list[0].office} · {list.length} zaereen</span>
                </div>
                <button type="button" disabled={busy} className={btn.secondary} onClick={() => restore(list.map((s) => s.key))}>
                  <RotateCcw className="w-4 h-4 text-stone-500" /> Restore tour
                </button>
              </div>
              {list.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3 px-3 py-2 border-t border-stone-100 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-stone-900">{s.name} <span className="font-mono text-xs text-stone-500">{s.its}</span></div>
                    <div className="text-xs text-stone-500">
                      {when(s.arrival)} – {when(s.departure)}{s.deletedAt ? ` · deleted ${new Date(s.deletedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
                    </div>
                  </div>
                  <button type="button" disabled={busy} className={btn.ghost} onClick={() => restore([s.key])}>Restore</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
