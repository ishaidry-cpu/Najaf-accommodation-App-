import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BedDouble, CheckCircle2, ChevronDown, ChevronRight, Loader2, Pencil, RefreshCw, Repeat2, Undo2, X } from 'lucide-react';
import type { Reservation } from '../types';
import { dismissRoomDraft, fetchRoomDrafts, refreshRoomDrafts, restoreRoomDraft, saveRoomDraftSettings, type DraftTour, type RoomDrafts } from '../services/api';
import { draftItems } from '../services/roomDrafts';
import type { PlanAllocationItem } from './AllocationPlannerView';
import { btn } from './ui';

const fmt = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
const plural = (n: number, w: string, many = w + 's') => `${n} ${n === 1 ? w : many}`;

/**
 * Rooms drafted automatically for approved Najaf stays arriving in the next few days. A tour's draft is only
 * re-planned when that tour changes; the latest change and its reason show on the tour.
 */
export const RoomDraftsPanel: React.FC<{
  reservations: Reservation[];
  canApply: boolean;
  onApply: (items: PlanAllocationItem[]) => { applied: number; skipped: number };
  onEdit: (tours: DraftTour[]) => void;
}> = ({ reservations, canApply, onApply, onEdit }) => {
  const [drafts, setDrafts] = useState<RoomDrafts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (fn: () => Promise<RoomDrafts>) => {
    setBusy(true);
    try { setDrafts(await fn()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Room drafts could not be loaded.'); }
    finally { setBusy(false); }
  };
  // Reload when the saved reservations change (an NKERP pull, or rooms just allocated).
  useEffect(() => { void run(fetchRoomDrafts); }, [reservations]);

  const tours = useMemo(() => Object.values(drafts?.tours ?? {}).sort((a, b) => a.arrival.localeCompare(b.arrival) || a.tourRef.localeCompare(b.tourRef)), [drafts]);
  const dismissed = Object.keys(drafts?.dismissed ?? {});
  const people = tours.reduce((s, t) => s + t.people, 0);
  const replanned = tours.filter(t => t.status === 'replanned').length;

  const apply = (list: DraftTour[]) => {
    const outcome = onApply(draftItems(list));
    setMessage(`Allocated ${plural(outcome.applied, 'zair', 'zaereen')}${outcome.skipped ? `; ${outcome.skipped} already had a room` : ''}. Run Sync to NKERP to send them.`);
  };

  if (!drafts && !error) return <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500"><Loader2 className="inline w-4 h-4 animate-spin mr-1" />Loading room drafts…</div>;
  return (
    <section className="rounded-2xl border border-emerald-200 bg-white shadow-2xs overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-emerald-50/50 border-b border-emerald-100">
        <button type="button" className="flex items-center gap-2 text-left cursor-pointer" onClick={() => setCollapsed(c => !c)}>
          {collapsed ? <ChevronRight className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
          <span>
            <span className="block text-sm font-semibold text-stone-900 flex items-center gap-1.5"><BedDouble className="w-4 h-4 text-emerald-700" />Drafted rooms for approved Najaf arrivals</span>
            <span className="block text-xs text-stone-600">{drafts?.settings.enabled ? `${plural(tours.length, 'tour')} · ${plural(people, 'zair', 'zaereen')} arriving by ${drafts.window ? fmt(drafts.window.to) : ''} (and anyone already here without a room)${replanned ? ` · ${replanned} re-planned after a change` : ''}` : 'Automatic drafts are off'}</span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
          {drafts && (
            <>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={drafts.settings.enabled} onChange={e => void run(() => saveRoomDraftSettings({ ...drafts.settings, enabled: e.target.checked }))} />Draft automatically</label>
              <label className="flex items-center gap-1.5">Days before arrival
                <input type="number" min={0} max={30} value={drafts.settings.daysAhead} onChange={e => void run(() => saveRoomDraftSettings({ ...drafts.settings, daysAhead: Number(e.target.value) }))}
                  className="w-14 h-8 rounded-lg border border-stone-200 px-2 text-sm" /></label>
            </>
          )}
          <button type="button" className={btn.secondary} onClick={() => void run(refreshRoomDrafts)} disabled={busy} title="Re-check the drafts now">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}</button>
          {canApply && tours.length > 0 && <button type="button" className={btn.primary} onClick={() => apply(tours)} disabled={busy}><CheckCircle2 className="w-4 h-4" />Apply all</button>}
        </div>
      </header>
      {!collapsed && (
        <div>
          {error && <p className="px-4 py-2 text-sm text-rose-700">{error}</p>}
          {message && <p className="px-4 py-2 text-sm text-emerald-800 bg-emerald-50 flex items-center gap-2">{message}<button type="button" className="ml-auto" onClick={() => setMessage(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button></p>}
          <p className="px-4 py-2 text-xs text-stone-600 border-b border-stone-100">Made {drafts?.settings.daysAhead ?? 3} days before arrival, so rooms stay free for better use until then. A draft only changes when NKERP changes that tour (dates, zaereen) or its room is taken. Nothing is allocated until you apply it.</p>
          {!tours.length && drafts?.settings.enabled && <p className="px-4 py-5 text-sm text-stone-500">Every approved Najaf arrival in the window already has rooms.</p>}
          <ul className="divide-y divide-stone-100">
            {tours.map(t => {
              const unplaced = t.units.filter(u => !t.assignments[u.key]).reduce((s, u) => s + u.members.length, 0);
              const warned = t.units.filter(u => t.assignments[u.key]?.warnings.length).length;
              const last = t.changes[t.changes.length - 1];
              const isOpen = open === t.tourRef;
              return (
                <li key={t.tourRef} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button type="button" className="flex items-center gap-1.5 text-left cursor-pointer" onClick={() => setOpen(isOpen ? null : t.tourRef)}>
                      {isOpen ? <ChevronDown className="w-4 h-4 text-stone-400" /> : <ChevronRight className="w-4 h-4 text-stone-400" />}
                      <span className="font-semibold text-sm text-stone-900">{t.tourRef.replace(/^NKERP\/TOUR\//, '')}</span>
                    </button>
                    <span className="text-xs text-stone-600">{t.office} · {fmt(t.arrival)} → {fmt(t.departure)} · {plural(t.people, 'zair', 'zaereen')}</span>
                    {t.status === 'replanned' && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-900 ring-1 ring-amber-200 px-2 py-0.5 text-[11px] font-semibold"><Repeat2 className="w-3 h-3" />Re-planned</span>}
                    {unplaced > 0 && <span className="rounded-full bg-rose-50 text-rose-800 ring-1 ring-rose-200 px-2 py-0.5 text-[11px] font-semibold">{unplaced} without a room</span>}
                    {warned > 0 && <span className="rounded-full bg-amber-50 text-amber-900 ring-1 ring-amber-200 px-2 py-0.5 text-[11px] font-semibold">{plural(warned, 'warning')}</span>}
                    <span className="ml-auto flex gap-1.5">
                      {canApply && <button type="button" className={btn.secondary} onClick={() => apply([t])} disabled={busy}><CheckCircle2 className="w-4 h-4" />Apply</button>}
                      <button type="button" className={btn.ghost} onClick={() => onEdit([t])} title="Open this tour in the planner below to change rooms"><Pencil className="w-4 h-4" />Edit</button>
                      <button type="button" className={btn.ghost} onClick={() => void run(() => dismissRoomDraft(t.tourRef, t.basis))} title="Set aside: no draft for this tour until NKERP changes it"><X className="w-4 h-4" /></button>
                    </span>
                  </div>
                  {last && <p className="mt-1 ml-6 text-xs text-amber-900">{last.reason} ({new Date(last.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})</p>}
                  {isOpen && (
                    <div className="mt-2 ml-6 grid gap-3 md:grid-cols-2">
                      <table className="text-xs">
                        <thead className="text-stone-500"><tr><th className="text-left font-medium pr-3 py-1">Family</th><th className="text-left font-medium pr-3 py-1">Zaereen</th><th className="text-left font-medium py-1">Room</th></tr></thead>
                        <tbody>{t.units.map(u => {
                          const a = t.assignments[u.key];
                          return <tr key={u.key} className="border-t border-stone-100 align-top">
                            <td className="pr-3 py-1 whitespace-nowrap">{u.family}</td>
                            <td className="pr-3 py-1">{u.members.map(m => m.name).join(', ')}</td>
                            <td className={`py-1 whitespace-nowrap ${a ? 'text-stone-900' : 'text-rose-700'}`}>{a ? `${a.building} ${a.roomNumber}` : t.unplaced[u.key] || 'No room yet'}{a?.warnings.length ? <span className="block text-amber-800">{a.warnings.join('; ')}</span> : null}</td>
                          </tr>;
                        })}</tbody>
                      </table>
                      {last && (
                        <div className="text-xs">
                          <p className="font-medium text-stone-700 mb-1">What changed</p>
                          <ul className="space-y-0.5">
                            {[...new Set([...last.before, ...last.after].map(l => l.family))].map(f => {
                              const b = last.before.find(l => l.family === f);
                              const a = last.after.find(l => l.family === f);
                              const same = b?.room === a?.room && b?.people === a?.people;
                              return <li key={f} className={same ? 'text-stone-500' : 'text-stone-900'}>{f}: {b ? `${b.room} (${b.people})` : '—'} <ArrowRight className="inline w-3 h-3" /> <b>{a ? `${a.room} (${a.people})` : 'removed'}</b></li>;
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {dismissed.length > 0 && (
            <p className="px-4 py-2 text-xs text-stone-500 border-t border-stone-100 flex flex-wrap items-center gap-2">Set aside: {dismissed.map(ref => (
              <button key={ref} type="button" className="inline-flex items-center gap-1 underline cursor-pointer" onClick={() => void run(() => restoreRoomDraft(ref))}><Undo2 className="w-3 h-3" />{ref.replace(/^NKERP\/TOUR\//, '')}</button>
            ))}</p>
          )}
        </div>
      )}
    </section>
  );
};
