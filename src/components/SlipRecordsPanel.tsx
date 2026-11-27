import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Loader2, RefreshCw, Search } from 'lucide-react';
import { fetchSlips, type SlipRecord } from '../services/api';
import { btn } from './ui';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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
    <section className="mt-6 bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-stone-100">
        <h2 className="text-sm font-semibold text-stone-900 flex items-center gap-2"><FileText className="w-4 h-4 text-stone-400" />B→A slip records{records ? ` · ${records.length}` : ''}</h2>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-2.5 top-2.5" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Slip, tour, name or ITS" className="h-9 w-56 rounded-lg border border-stone-200 pl-8 pr-2 text-sm" />
          </label>
          <button type="button" className={btn.secondary} onClick={() => void load()} aria-label="Reload slip records"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </header>
      {error && <p className="px-4 py-3 text-sm text-rose-700">{error}</p>}
      {!records && !error && <p className="px-4 py-6 text-sm text-stone-500"><Loader2 className="inline w-4 h-4 animate-spin mr-1" />Loading…</p>}
      {records && !shown.length && <p className="px-4 py-6 text-sm text-stone-500">{records.length ? 'No slip matches.' : 'No B→A slip has been printed or downloaded yet. Each one is recorded here automatically.'}</p>}
      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500"><tr>
              <th className="w-6" /><th className="text-left font-medium px-3 py-2">Slip No.</th><th className="text-left font-medium px-3 py-2">Made</th>
              <th className="text-left font-medium px-3 py-2">Tour ID</th><th className="text-left font-medium px-3 py-2">Office</th>
              <th className="text-right font-medium px-3 py-2">Pax</th><th className="text-left font-medium px-3 py-2">Issued</th>
            </tr></thead>
            <tbody>
              {shown.map(r => (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="pl-2">{open === r.id ? <ChevronDown className="w-4 h-4 text-stone-400" /> : <ChevronRight className="w-4 h-4 text-stone-400" />}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-stone-900 whitespace-nowrap">{r.slipNo}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-stone-700">{when(r.createdAt)}</td>
                    <td className="px-3 py-2 text-stone-700">{r.tours.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-stone-700">{r.offices.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.paxCount}</td>
                    <td className="px-3 py-2 text-xs text-stone-600 whitespace-nowrap">{r.issues.length} time{r.issues.length === 1 ? '' : 's'} · last {when(r.issues[r.issues.length - 1].at)}</td>
                  </tr>
                  {open === r.id && (
                    <tr><td colSpan={7} className="bg-stone-50/60 px-4 py-3">
                      {r.amountNote && <p className="text-xs text-stone-700 mb-2"><b>Accounts note:</b> {r.amountNote}</p>}
                      <table className="min-w-full text-xs">
                        <thead className="text-stone-500"><tr>
                          <th className="text-left font-medium py-1 pr-3">Name</th><th className="text-left font-medium py-1 pr-3">ITS</th>
                          <th className="text-left font-medium py-1 pr-3">Tour</th><th className="text-left font-medium py-1 pr-3">Arrival → Departure</th>
                          <th className="text-left font-medium py-1 pr-3">Room</th><th className="text-left font-medium py-1">Money given</th>
                        </tr></thead>
                        <tbody>{r.pax.map(p => (
                          <tr key={p.reservationId} className="border-t border-stone-100">
                            <td className="py-1 pr-3">{p.name}</td><td className="py-1 pr-3 tabular-nums">{p.its}</td><td className="py-1 pr-3">{p.tour}</td>
                            <td className="py-1 pr-3 whitespace-nowrap">{p.arrival} → {p.departure}</td><td className="py-1 pr-3">{p.room || '—'}</td><td className="py-1">{p.moneyGiven}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                      <p className="mt-2 text-[11px] text-stone-500">Issued: {r.issues.map(i => `${when(i.at)} (${i.action === 'pdf' ? 'PDF' : 'print'})`).join(' · ')}. Details are as they were when the slip was made.</p>
                    </td></tr>
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
