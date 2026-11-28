import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Loader2, Pencil, RefreshCw, Repeat2, Undo2, X } from 'lucide-react';
import type { Reservation } from '../types';
import { dismissRoomDraft, fetchRoomDrafts, refreshRoomDrafts, restoreRoomDraft, saveRoomDraftSettings, type DraftTour, type RoomDrafts } from '../services/api';
import { draftItems } from '../services/roomDrafts';
import type { PlanAllocationItem } from './AllocationPlannerView';
import { btn, btnSm, card, chip, fieldSm, panel } from './ui';

const fmt = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');
const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
const plural = (n: number, w: string, many = w + 's') => `${n} ${n === 1 ? w : many}`;
const tourLabel = (ref: string) => ref.replace(/^NKERP\/TOUR\//, '');

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

  if (!drafts && !error) {
    return (
      <div className={`${card} px-4 sm:px-5 py-4 text-sm text-stone-600 flex items-center gap-2`}>
        <Loader2 className="w-4 h-4 animate-spin text-stone-500" />Loading room drafts…
      </div>
    );
  }
  return (
    <section className={`${card} overflow-hidden`}>
      <header className="flex flex-col gap-3 px-4 sm:px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <button type="button" className="flex items-start gap-2 text-left cursor-pointer min-w-0 rounded-lg" aria-expanded={!collapsed} onClick={() => setCollapsed(c => !c)}>
          {collapsed ? <ChevronRight className="w-4 h-4 mt-1 shrink-0 text-stone-500" /> : <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-stone-500" />}
          <span className="min-w-0">
            <span className="block text-base font-semibold leading-snug text-stone-950">Drafted rooms for approved Najaf arrivals</span>
            <span className="block mt-0.5 text-[13px] leading-snug text-stone-600">
              {drafts?.settings.enabled
                ? `${plural(tours.length, 'tour')} · ${plural(people, 'zair', 'zaereen')} arriving by ${drafts.window ? fmt(drafts.window.to) : ''} (and anyone already here without a room)${replanned ? ` · ${replanned} re-planned after a change` : ''}`
                : 'Automatic drafts are off'}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-stone-700 xl:shrink-0 max-xl:pl-6">
          {drafts && (
            <>
              <label className="inline-flex items-center gap-2 min-h-10 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-brand-700" checked={drafts.settings.enabled} onChange={e => void run(() => saveRoomDraftSettings({ ...drafts.settings, enabled: e.target.checked }))} />
                Draft automatically
              </label>
              <label className="inline-flex items-center gap-2">
                Days before arrival
                <input type="number" min={0} max={30} value={drafts.settings.daysAhead} onChange={e => void run(() => saveRoomDraftSettings({ ...drafts.settings, daysAhead: Number(e.target.value) }))}
                  className={`${fieldSm} w-16 max-md:h-10 tabular-nums`} />
              </label>
            </>
          )}
          <span className="inline-flex items-center gap-2">
            <button type="button" className={`${btn.secondary} w-10 !px-0`} onClick={() => void run(refreshRoomDrafts)} disabled={busy} title="Re-check the drafts now" aria-label="Re-check the drafts now">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            {canApply && tours.length > 0 && (
              <button type="button" className={btn.primary} onClick={() => apply(tours)} disabled={busy}><CheckCircle2 className="w-4 h-4" />Apply all</button>
            )}
          </span>
        </div>
      </header>
      {!collapsed && (
        <div className="border-t border-stone-200">
          {error && <p role="alert" className="px-4 sm:px-5 py-3 text-sm text-rose-700 border-b border-stone-200">{error}</p>}
          {message && (
            <p role="status" className="px-4 sm:px-5 py-2.5 text-sm text-emerald-900 bg-emerald-50 border-b border-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
              <span className="min-w-0">{message}</span>
              <button type="button" className="ml-auto shrink-0 w-9 h-9 -my-1 rounded-lg flex items-center justify-center text-emerald-800 hover:bg-emerald-100 cursor-pointer" onClick={() => setMessage(null)} aria-label="Dismiss">
                <X className="w-4 h-4" />
              </button>
            </p>
          )}
          <p className="px-4 sm:px-5 py-3 text-[13px] leading-relaxed text-stone-600 max-w-[110ch]">
            Made {drafts?.settings.daysAhead ?? 3} days before arrival, so rooms stay free for better use until then. A draft only changes when NKERP changes that tour (dates, zaereen) or its room is taken. Nothing is allocated until you apply it.
          </p>
          {!tours.length && drafts?.settings.enabled && (
            <p className="px-4 sm:px-5 py-5 text-sm text-stone-600 border-t border-stone-200">Every approved Najaf arrival in the window already has rooms. New drafts appear here {drafts.settings.daysAhead} days before a tour arrives.</p>
          )}
          {tours.length > 0 && (
            <div className="hidden lg:grid grid-cols-[10rem_minmax(0,1fr)_8rem_6rem_13.5rem] gap-x-4 px-5 py-2 bg-stone-50 border-y border-stone-200 text-xs font-semibold text-stone-600">
              <span className="pl-6">Tour ID</span><span>Office</span><span>Stay</span><span className="text-right">Zaereen</span><span />
            </div>
          )}
          <ul className="divide-y divide-stone-200 max-lg:border-t max-lg:border-stone-200">
            {tours.map(t => {
              const unplaced = t.units.filter(u => !t.assignments[u.key]).reduce((s, u) => s + u.members.length, 0);
              const warned = t.units.filter(u => t.assignments[u.key]?.warnings.length).length;
              const last = t.changes[t.changes.length - 1];
              const isOpen = open === t.tourRef;
              const label = tourLabel(t.tourRef);
              const hasChips = t.status === 'replanned' || unplaced > 0 || warned > 0;
              return (
                <li key={t.tourRef} className={`px-4 sm:px-5 py-2 ${isOpen ? 'bg-stone-50/60' : ''}`}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center lg:grid-cols-[10rem_minmax(0,1fr)_8rem_6rem_13.5rem] lg:gap-x-4 min-h-8">
                    <button type="button" className="flex items-center gap-2 min-h-10 lg:min-h-8 text-left cursor-pointer min-w-0 rounded-lg" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.tourRef)}>
                      {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-stone-500" /> : <ChevronRight className="w-4 h-4 shrink-0 text-stone-500" />}
                      <span className="font-semibold text-sm text-stone-950 tabular-nums truncate" title={label}>{label}</span>
                    </button>
                    <span className="text-sm text-stone-700 tabular-nums text-right lg:hidden">{plural(t.people, 'zair', 'zaereen')}</span>
                    <span className="col-span-2 pl-6 pb-1 text-sm leading-snug text-stone-700 lg:hidden">
                      {t.office} <span className="text-stone-400">·</span> <span className="tabular-nums whitespace-nowrap">{fmt(t.arrival)} → {fmt(t.departure)}</span>
                    </span>
                    <span className="hidden lg:block text-sm text-stone-700 truncate" title={t.office}>{t.office}</span>
                    <span className="hidden lg:block text-sm text-stone-700 tabular-nums whitespace-nowrap">{fmt(t.arrival)} → {fmt(t.departure)}</span>
                    <span className="hidden lg:block text-sm text-stone-700 tabular-nums text-right">{t.people}</span>
                    <span className="col-span-2 lg:col-span-1 max-lg:order-last max-lg:pl-6 max-lg:pt-1.5 max-lg:pb-1 flex items-center gap-1.5 lg:justify-end">
                      {canApply && (
                        <button type="button" className={`${btnSm.secondary} max-md:h-10 max-md:px-3.5`} onClick={() => apply([t])} disabled={busy}><CheckCircle2 className="w-4 h-4" />Apply</button>
                      )}
                      <button type="button" className={`${btnSm.secondary} max-md:h-10 max-md:px-3.5`} onClick={() => onEdit([t])} title="Open this tour in the planner below to change rooms"><Pencil className="w-4 h-4" />Edit</button>
                      <button type="button" className={`${btnSm.ghost} w-8 !px-0 max-md:w-10 max-md:h-10`} onClick={() => void run(() => dismissRoomDraft(t.tourRef, t.basis))}
                        title="Set aside: no draft for this tour until NKERP changes it" aria-label={`Set aside the draft for tour ${label}`}>
                        <X className="w-4 h-4" />
                      </button>
                    </span>
                    {(hasChips || last) && (
                      <div className="col-span-full pl-6 pb-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        {unplaced > 0 && <span className={chip('bad')}>{unplaced} without a room</span>}
                        {warned > 0 && <span className={chip('wait')}>{plural(warned, 'warning')}</span>}
                        {t.status === 'replanned' && <span className={chip('wait')}><Repeat2 className="w-3 h-3" />Re-planned</span>}
                        {last && <span className="text-[13px] leading-snug text-stone-600">{last.reason} <span className="text-stone-500 whitespace-nowrap">({fmtWhen(last.at)})</span></span>}
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className={`${panel} mt-2 mb-2 lg:ml-6 p-3 sm:p-4 grid gap-5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]`}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                          <thead className="text-xs text-stone-600">
                            <tr>
                              <th className="text-left font-semibold pr-3 pb-1.5">Family</th>
                              <th className="text-left font-semibold pr-3 pb-1.5">Zaereen</th>
                              <th className="text-left font-semibold pb-1.5">Room</th>
                            </tr>
                          </thead>
                          <tbody>{t.units.map(u => {
                            const a = t.assignments[u.key];
                            return (
                              <tr key={u.key} className="border-t border-stone-200 align-top">
                                <td className="pr-3 py-1.5 whitespace-nowrap font-medium text-stone-800">{u.family}</td>
                                <td className="pr-3 py-1.5 text-stone-700 leading-snug">{u.members.map(m => m.name).join(', ')}</td>
                                <td className={`py-1.5 sm:whitespace-nowrap ${a ? 'font-semibold text-stone-950 tabular-nums' : 'text-rose-700'}`}>
                                  {a ? `${a.building} ${a.roomNumber}` : t.unplaced[u.key] || 'No room yet'}
                                  {a?.warnings.length ? <span className="block whitespace-normal font-normal text-amber-800">{a.warnings.join('; ')}</span> : null}
                                </td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </div>
                      {last && (
                        <div className="text-[13px]">
                          <p className="text-xs font-semibold text-stone-600 pb-1.5">What changed</p>
                          <ul className="border-t border-stone-200 divide-y divide-stone-200">
                            {[...new Set([...last.before, ...last.after].map(l => l.family))].map(f => {
                              const b = last.before.find(l => l.family === f);
                              const a = last.after.find(l => l.family === f);
                              const same = b?.room === a?.room && b?.people === a?.people;
                              return (
                                <li key={f} className={`py-1.5 tabular-nums ${same ? 'text-stone-500' : 'text-stone-900'}`}>
                                  {f}: {b ? `${b.room} (${b.people})` : '—'} <ArrowRight className="inline w-3 h-3" /> <span className="font-semibold">{a ? `${a.room} (${a.people})` : 'removed'}</span>
                                </li>
                              );
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
            <p className="px-4 sm:px-5 py-2.5 text-[13px] text-stone-600 border-t border-stone-200 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Set aside:</span>
              {dismissed.map(ref => (
                <button key={ref} type="button" className="inline-flex items-center gap-1 min-h-8 max-md:min-h-10 font-medium text-brand-700 hover:underline cursor-pointer tabular-nums" onClick={() => void run(() => restoreRoomDraft(ref))}
                  title="Draft this tour again">
                  <Undo2 className="w-3.5 h-3.5" />{tourLabel(ref)}
                </button>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
