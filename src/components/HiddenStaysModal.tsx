import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { fetchHiddenStays, restoreHiddenStays, type HiddenStay } from '../services/api';
import { btnSm, modalCard, modalClose, modalHeader, modalScrim, modalTitle } from './ui';

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
    <div className={modalScrim} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="hidden-stays-title">
      <div className={`${modalCard} max-w-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h2 id="hidden-stays-title" className={modalTitle}>Deleted NKERP stays</h2>
            <p className="mt-1 text-sm text-stone-600 max-w-[60ch]">
              NKERP still lists these zaereen, but they were deleted in the app, so they are hidden. A stay comes back by
              itself when NKERP changes its dates. Restore brings it back now.
            </p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 sm:px-6 py-5">
          {error && (
            <div role="alert" className="mb-4 rounded-xl bg-rose-50 px-3.5 py-3 text-sm text-rose-700">{error}</div>
          )}
          {!stays && !error && <div className="py-6 text-center text-sm text-stone-600">Loading hidden stays…</div>}
          {stays && !stays.length && (
            <div className="py-8 text-center">
              <div className="text-[15px] font-semibold text-stone-900">Nothing is hidden</div>
              <p className="mt-1 text-sm text-stone-600">
                Every stay NKERP lists is in the app. A stay you delete on the Zaereen screen appears here while NKERP
                still lists it.
              </p>
            </div>
          )}
          <div className="divide-y divide-stone-200">
            {tours.map(([tour, list]) => (
              <section key={tour} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-stone-950 tabular-nums">{tour.replace(/^NKERP\/TOUR\//i, '')}</div>
                    <div className="text-[13px] text-stone-600">{list[0].office} · {list.length} zaereen</div>
                  </div>
                  <button type="button" disabled={busy} className={`${btnSm.secondary} max-sm:h-10`} onClick={() => restore(list.map((s) => s.key))}>
                    <RotateCcw className="w-4 h-4 text-stone-500" /> Restore tour
                  </button>
                </div>
                <ul className="mt-2 rounded-xl bg-stone-50 divide-y divide-stone-200">
                  {list.map((s) => (
                    <li key={s.key} className="flex items-center justify-between gap-3 pl-3.5 pr-2 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-stone-900">
                          {s.name} <span className="font-normal text-[13px] text-stone-600 tabular-nums">{s.its}</span>
                        </div>
                        <div className="text-[13px] text-stone-600 tabular-nums">
                          {when(s.arrival)} – {when(s.departure)}{s.deletedAt ? ` · deleted ${new Date(s.deletedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
                        </div>
                      </div>
                      <button type="button" disabled={busy} className={`${btnSm.ghost} max-sm:h-10 shrink-0`} onClick={() => restore([s.key])}>Restore</button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
