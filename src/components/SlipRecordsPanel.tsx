import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Loader2, RefreshCw, Search } from 'lucide-react';
import { fetchSlips, type SlipRecord } from '../services/api';
import { btn, card, chip, field } from './ui';

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
/** Shows a stored `2026-11-22…` date as `22 Nov`; anything else is shown as it was saved. */
const day = (value: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!m) return value || '—';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** Every B→A slip made in the app: when, which slip number, which tours and zaereen, and each reprint. */
export const SlipRecordsPanel: React.FC<{ refreshKey?: unknown }> = ({ refreshKey }) => {
  const [records, setRecords] = useState<SlipRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const load = () => fetchSlips().then(r => { setRecords(r); setError(null); }, e => setError(e instanceof Error ? e.message : 'Slip records could not be loaded.'));
  useEffect(() => { void load(); }, [refreshKey]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (records ?? []).filter(r => !needle || [r.slipNo, ...r.tours, ...r.offices, ...r.pax.flatMap(p => [p.name, p.its])].join(' ').toLowerCase().includes(needle));
  }, [records, q]);

  return (
    <section className={`mt-6 ${card} overflow-hidden`}>
      <header className="flex flex-col gap-3 px-4 sm:px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-snug text-stone-950">B→A slip records</h2>
          <p className="mt-0.5 text-[13px] text-stone-600">
            {records ? `${records.length} ${records.length === 1 ? 'slip' : 'slips'} printed or downloaded` : 'Every slip printed or downloaded from the app'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative flex-1 sm:flex-none">
            <span className="sr-only">Search slip records</span>
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Slip, tour, name or ITS" className={`${field} pl-9 sm:w-64`} />
          </label>
          <button type="button" className={`${btn.secondary} w-10 !px-0 shrink-0`} onClick={() => void load()} aria-label="Reload slip records" title="Reload slip records">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>
      {error && <p role="alert" className="px-4 sm:px-5 py-3 text-sm text-rose-700 border-t border-stone-200">{error}</p>}
      {!records && !error && (
        <p className="px-4 sm:px-5 py-6 text-sm text-stone-600 border-t border-stone-200 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading slip records…</p>
      )}
      {records && !shown.length && (
        <div className="px-4 sm:px-5 py-8 border-t border-stone-200 flex items-start gap-3">
          <FileText className="w-5 h-5 mt-0.5 shrink-0 text-stone-400" />
          {records.length ? (
            <p className="text-sm text-stone-600">No slip matches “{q.trim()}”. Try a slip number, Tour ID, name or ITS.</p>
          ) : (
            <div className="text-sm">
              <p className="font-medium text-stone-900">No B→A slip has been printed or downloaded yet.</p>
              <p className="mt-0.5 text-stone-600">Open a slip with Request slip or All B→A slips and print or download it. Each one is recorded here automatically.</p>
            </div>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <div className="overflow-x-auto border-t border-stone-200">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs font-semibold text-stone-600">
              <tr>
                <th className="w-9" />
                <th className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">Slip no.</th>
                <th className="text-left font-semibold px-3 py-2.5">Made</th>
                <th className="text-left font-semibold px-3 py-2.5">Tour ID</th>
                <th className="text-left font-semibold px-3 py-2.5">Office</th>
                <th className="text-right font-semibold px-3 py-2.5">Pax</th>
                <th className="text-left font-semibold px-3 py-2.5">Issued</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <React.Fragment key={r.id}>
                  <tr className={`border-t border-stone-200 hover:bg-stone-50 cursor-pointer ${open === r.id ? 'bg-stone-50' : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="pl-3 h-11">
                      <button type="button" className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-500 cursor-pointer" aria-expanded={open === r.id}
                        aria-label={`${open === r.id ? 'Hide' : 'Show'} the zaereen on slip ${r.slipNo}`}>
                        {open === r.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-stone-950 tabular-nums whitespace-nowrap">{r.slipNo}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-stone-700 tabular-nums">{when(r.createdAt)}</td>
                    <td className="px-3 py-2.5 text-stone-700 tabular-nums">{r.tours.join(', ') || '—'}</td>
                    <td className="px-3 py-2.5 text-stone-700">{r.offices.join(', ') || '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-900">{r.paxCount}</td>
                    <td className="px-3 py-2.5 text-[13px] text-stone-600 whitespace-nowrap tabular-nums">{r.issues.length} time{r.issues.length === 1 ? '' : 's'} · last {when(r.issues[r.issues.length - 1].at)}</td>
                  </tr>
                  {open === r.id && (
                    <tr className="border-t border-stone-200">
                      <td colSpan={7} className="bg-stone-50 px-4 sm:px-5 py-4">
                        {r.amountNote && <p className="text-[13px] text-stone-700 mb-3"><span className="font-semibold text-stone-900">Accounts note:</span> {r.amountNote}</p>}
                        <table className="min-w-full text-[13px]">
                          <thead className="text-xs text-stone-600">
                            <tr>
                              <th className="text-left font-semibold pb-1.5 pr-3">Name</th>
                              <th className="text-left font-semibold pb-1.5 pr-3">ITS</th>
                              <th className="text-left font-semibold pb-1.5 pr-3">Tour</th>
                              <th className="text-left font-semibold pb-1.5 pr-3">Stay</th>
                              <th className="text-left font-semibold pb-1.5 pr-3">Room</th>
                              <th className="text-left font-semibold pb-1.5">Money given</th>
                            </tr>
                          </thead>
                          <tbody>{r.pax.map(p => (
                            <tr key={p.reservationId} className="border-t border-stone-200">
                              <td className="py-2 pr-3 font-medium text-stone-900">{p.name}</td>
                              <td className="py-2 pr-3 tabular-nums text-stone-700">{p.its}</td>
                              <td className="py-2 pr-3 tabular-nums text-stone-700">{p.tour}</td>
                              <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-stone-700">{day(p.arrival)} → {day(p.departure)}</td>
                              <td className="py-2 pr-3 tabular-nums text-stone-700">{p.room || '—'}</td>
                              <td className="py-2">
                                {p.moneyGiven === 'Yes' ? <span className={chip('ok')}>Paid</span> : p.moneyGiven === 'No' ? <span className={chip('wait')}>Pending</span> : <span className="text-stone-700">{p.moneyGiven}</span>}
                              </td>
                            </tr>
                          ))}</tbody>
                        </table>
                        <p className="mt-3 text-xs text-stone-500 tabular-nums">Issued: {r.issues.map(i => `${when(i.at)} (${i.action === 'pdf' ? 'PDF' : 'print'})`).join(' · ')}. Details are as they were when the slip was made.</p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
