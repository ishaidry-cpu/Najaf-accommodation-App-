import React, { useMemo, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, FileText, Loader2, MessageSquarePlus, Search, X } from 'lucide-react';
import {
  btn, btnSm, chip, fieldSm, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle,
} from './ui';
import { type ApprovalPlan, type ApprovalRecord, CITY_NAME, fmtDay, fmtSegments, type TourPlan } from '../services/approvalPlanner';
import { awaitingApproval, busiestDays, downloadAwaitingExcel, downloadAwaitingPdf, exportCapacity } from '../services/approvalExport';

type Kind = 'all' | 'new' | 're';
const KINDS: { id: Kind; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'new', label: 'New approvals' }, { id: 're', label: 'Re-approvals' }];
const check = 'w-4 h-4 accent-brand-700 cursor-pointer';

/**
 * Download the Tour IDs awaiting approval as Excel or PDF for Idara officials: all of them or a chosen few,
 * with the approver's remarks against each (saved with the Tour ID, so they are on the next report too).
 */
export const ApprovalExportDialog: React.FC<{
  plan: ApprovalPlan;
  readAt: string | null;
  preparedBy?: string;
  /** Tour IDs ticked on the Approvals screen: preselected when any of them are awaiting approval. */
  preselect: Set<number>;
  onSaveRemarks: (id: number, text: string) => Promise<void>;
  onClose: () => void;
}> = ({ plan, readAt, preparedBy, preselect, onSaveRemarks, onClose }) => {
  const awaiting = useMemo(() => awaitingApproval(plan), [plan]);
  const [chosen, setChosen] = useState<Set<number>>(() => {
    const pre = awaiting.filter(p => preselect.has(p.tour.id)).map(p => p.tour.id);
    return new Set(pre.length ? pre : awaiting.map(p => p.tour.id));
  });
  const [kind, setKind] = useState<Kind>('all');
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const shown = awaiting.filter(p => (kind === 'all' || (kind === 're') === p.tour.reapproval)
    && (!needle || `${p.tour.ref} ${p.tour.office}`.toLowerCase().includes(needle)));
  const allShown = shown.length > 0 && shown.every(p => chosen.has(p.tour.id));
  const setMany = (ids: number[], on: boolean) => setChosen(s => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });
  const toggle = (id: number) => setChosen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const remarksOf = (p: TourPlan) => drafts[p.tour.id] ?? p.record?.remarks?.text ?? '';
  const dirty = (p: TourPlan) => p.tour.id in drafts && drafts[p.tour.id].trim() !== (p.record?.remarks?.text ?? '');
  const save = async (p: TourPlan) => {
    if (!dirty(p)) return;
    const id = p.tour.id;
    setSaving(s => new Set(s).add(id));
    try {
      await onSaveRemarks(id, drafts[id]);
      setDrafts(d => { const n = { ...d }; delete n[id]; return n; });
    } catch (e) { setError(e instanceof Error ? e.message : 'The remarks could not be saved.'); }
    finally { setSaving(s => { const n = new Set(s); n.delete(id); return n; }); }
  };

  // Export in the queue's order, with any remarks still being typed included.
  const picked = awaiting.filter(p => chosen.has(p.tour.id)).map(p => {
    if (!(p.tour.id in drafts)) return p;
    const text = drafts[p.tour.id].trim();
    const base: ApprovalRecord = p.record ?? { id: p.tour.id, ref: p.tour.ref, office: p.tour.office, status: 'new', firstSeenAt: '', lastSeenAt: '', history: [] };
    return { ...p, record: { ...base, remarks: text ? { text, at: '', by: preparedBy } : undefined } };
  });
  const cap = useMemo(() => busiestDays(exportCapacity(plan, picked)), [plan, picked.map(p => p.tour.id).join()]);
  const counts = { fresh: picked.filter(p => !p.tour.reapproval).length, re: picked.filter(p => p.tour.reapproval).length, faiz: picked.reduce((n, p) => n + p.tour.paxFaiz, 0) };

  const download = async (ext: 'xlsx' | 'pdf') => {
    setBusy(ext); setError(null); setDone(null);
    try {
      // Keep the remarks with the Tour IDs, so the next report and other devices have them too.
      await Promise.all(awaiting.filter(dirty).map(save));
      const input = { plan, plans: picked, readAt, preparedBy, generatedAt: new Date() };
      if (ext === 'xlsx') downloadAwaitingExcel(input); else await downloadAwaitingPdf(input);
      setDone(`${ext === 'xlsx' ? 'Excel' : 'PDF'} report downloaded with ${picked.length} Tour ID${picked.length === 1 ? '' : 's'}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The report could not be made.'); }
    finally { setBusy(null); }
  };

  const capLine = (city: 'NAJAF' | 'KARBALA') => {
    const r = cap[city];
    if (!r) return `${CITY_NAME[city]}: no Faiz stays`;
    const c = r.cities[city];
    return `${CITY_NAME[city]} busiest ${fmtDay(r.date)}: ${c.approved + c.these}/${c.limit}`;
  };
  const capTone = (city: 'NAJAF' | 'KARBALA') => {
    const c = cap[city]?.cities[city];
    return !c ? 'text-stone-600' : c.free < 0 ? 'text-rose-700 font-semibold' : c.free < c.limit * 0.1 ? 'text-amber-800 font-semibold' : 'text-stone-700';
  };

  return (
    <div className={`${modalScrim} !z-[80]`} role="dialog" aria-modal="true" aria-label="Export awaiting approvals">
      <div className={`${modalCard} max-w-3xl`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h3 className={modalTitle}>Export awaiting approvals</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">A report of the Tour IDs still waiting for approval, to share with Idara officials for their comments. Excel has columns for their recommendation and comments; the PDF prints with space for remarks against each Tour ID. Both include the generation time and capacity against Najaf {plan.settings.limits.NAJAF} and Karbala {plan.settings.limits.KARBALA}.</p>
          </div>
          <button type="button" onClick={onClose} className={`${modalClose} max-md:w-10 max-md:h-10`} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 sm:px-6 py-3 border-b border-stone-200 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg bg-stone-200/70 p-0.5 self-start" role="group" aria-label="Show">
            {KINDS.map(k => {
              const n = k.id === 'all' ? awaiting.length : awaiting.filter(p => (k.id === 're') === p.tour.reapproval).length;
              return <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}
                className={`h-8 max-md:h-10 px-3 rounded-md text-[13px] font-medium tabular-nums cursor-pointer transition ${kind === k.id ? 'bg-white text-stone-950 ring-1 ring-stone-300' : 'text-stone-600 hover:text-stone-950'}`}>{k.label} {n}</button>;
            })}
          </div>
          <label className="relative block w-full sm:w-56">
            <span className="sr-only">Search by Tour ID or office</span>
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tour ID or office" className={`${fieldSm} max-md:h-10 w-full pl-9`} />
          </label>
        </div>

        <div className="overflow-y-auto min-h-0 flex-1">
          {awaiting.length === 0 ? (
            <p className="px-5 sm:px-6 py-8 text-sm text-stone-600">No Tour ID is waiting for approval. Refresh from NKERP to read the latest queues; new approvals and re-approvals appear here.</p>
          ) : (
            <>
              <label className="flex items-center gap-3 px-5 sm:px-6 py-2.5 bg-stone-50 border-b border-stone-200 text-[13px] font-medium text-stone-700 cursor-pointer">
                <input type="checkbox" className={check} checked={allShown} onChange={() => setMany(shown.map(p => p.tour.id), !allShown)} />
                {allShown ? 'Clear' : 'Select'} all {shown.length} shown
              </label>
              {shown.length === 0 && <p className="px-5 sm:px-6 py-6 text-sm text-stone-600">No Tour ID or office matches the search.</p>}
              <ul className="divide-y divide-stone-200">
                {shown.map(p => {
                  const t = p.tour;
                  const id = t.id;
                  const remarks = remarksOf(p);
                  const editing = open.has(id) || Boolean(remarks);
                  return (
                    <li key={id} className="px-5 sm:px-6 py-3">
                      <div className="flex items-start gap-3">
                        <input type="checkbox" className={`${check} mt-1 shrink-0`} aria-label={`Include ${t.ref}`} checked={chosen.has(id)} onChange={() => toggle(id)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-semibold text-stone-950 tabular-nums">{t.ref}</span>
                            <span className={chip(t.reapproval ? 'wait' : 'info')}>{t.reapproval ? 'Re-approval' : 'New approval'}</span>
                            <span className="text-[13px] text-stone-600">{t.office}</span>
                          </div>
                          <p className="mt-0.5 text-[13px] text-stone-700 tabular-nums">{fmtSegments(p.segments)} · {t.paxTotal} pax ({t.paxFaiz} Faiz, {t.paxHotel} hotel)</p>
                          {editing ? (
                            <div className="mt-2">
                              <label className="sr-only" htmlFor={`remarks-${id}`}>Admin remarks for {t.ref}</label>
                              <textarea id={`remarks-${id}`} rows={2} maxLength={2000} value={remarks} placeholder="Admin remarks and observations for the Idara"
                                onChange={e => setDrafts(d => ({ ...d, [id]: e.target.value }))} onBlur={() => void save(p)}
                                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[13px] leading-relaxed text-stone-900 placeholder:text-stone-400" />
                              <p className="mt-0.5 text-xs text-stone-500 tabular-nums">
                                {saving.has(id) ? <><Loader2 className="inline w-3 h-3 animate-spin mr-1" />Saving…</>
                                  : dirty(p) ? 'Not saved yet: saved when you leave the box or download.'
                                  : p.record?.remarks ? `Saved${p.record.remarks.by ? ` by ${p.record.remarks.by}` : ''}` : 'Saved with the Tour ID for the next report.'}
                              </p>
                            </div>
                          ) : (
                            <button type="button" className={`${btnSm.ghost} mt-1 -ml-2 max-md:h-10`} onClick={() => setOpen(s => new Set(s).add(id))}>
                              <MessageSquarePlus className="w-4 h-4" />Add remarks</button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {(error || done) && (
          <p role={error ? 'alert' : 'status'} className={`px-5 sm:px-6 py-2.5 border-t border-stone-200 text-[13px] flex items-center gap-2 ${error ? 'text-rose-700 bg-rose-50' : 'text-emerald-800 bg-emerald-50'}`}>
            {!error && <CheckCircle2 className="w-4 h-4 shrink-0" />}{error ?? done}</p>
        )}
        <div className={`${modalFooter} !justify-between`}>
          <div className="text-[13px] text-stone-700 tabular-nums min-w-0">
            <span className="font-semibold text-stone-950">{picked.length} of {awaiting.length} selected</span> · {counts.fresh} new, {counts.re} re-approval · {counts.faiz} Faiz pax
            <span className="block text-xs mt-0.5"><span className={capTone('NAJAF')}>{capLine('NAJAF')}</span> · <span className={capTone('KARBALA')}>{capLine('KARBALA')}</span></span>
          </div>
          <div className="flex gap-2 max-sm:w-full">
            <button type="button" className={`${btn.secondary} max-sm:flex-1`} disabled={!picked.length || busy !== null} onClick={() => void download('pdf')}>
              {busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}Download PDF</button>
            <button type="button" className={`${btn.primary} max-sm:flex-1`} disabled={!picked.length || busy !== null} onClick={() => void download('xlsx')}>
              {busy === 'xlsx' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}Download Excel</button>
          </div>
        </div>
      </div>
    </div>
  );
};
