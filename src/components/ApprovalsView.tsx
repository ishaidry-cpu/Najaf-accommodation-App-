import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BadgeCheck, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock, Hotel, Info,
  Copy, Loader2, MessageSquare, RefreshCw, Repeat2, RotateCcw, Save, Search, Send, Trash2, X,
} from 'lucide-react';
import { btn, PageHeader } from './ui';
import {
  type ApprovalPlan, type ApprovalRecord, type ApprovalSettings, CHANGE_CATEGORIES, CITY_NAME, type City, cityNights,
  fmtDay, fmtSegments, followUpMessage, fromSubvenueDates, inProposal, needsFollowUp, officeFollowUps, localDay, localTime, najafReport, planApprovals, reapprovalStatus,
  type Segment, type SegmentSource, segmentProblems, type SubvenueDates, suggestion, toSubvenueDates, type TourPlan, tripEnd,
  tripStart,
} from '../services/approvalPlanner';
import {
  type ApprovalState, approveInNkerp, loadApprovals, refreshApprovals, saveApprovalEdit, saveApprovalReview, saveApprovalSettings,
} from '../services/approvalsApi';

type Section = 'proposal' | 'reapproval' | 'awaiting' | 'pending' | 'capacity' | 'najaf' | 'remaining' | 'all';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'proposal', label: 'Ready to approve' },
  { id: 'reapproval', label: 'Re-approvals' },
  { id: 'awaiting', label: 'Awaiting' },
  { id: 'pending', label: 'Pending submission' },
  { id: 'capacity', label: 'Capacity' },
  { id: 'najaf', label: 'Najaf report' },
  { id: 'remaining', label: 'Remaining tours' },
  { id: 'all', label: 'All Tour IDs' },
];

const SOURCE_LABEL: Record<SegmentSource, string> = {
  edited: 'Approver\'s dates', 'chat-dates': 'Exact chat dates', 'chat-order': 'Chat sequence, days split (odd day to Karbala)',
  balanced: 'Balanced split (odd day to Karbala)', previous: 'Previously approved stays', none: 'No dates yet',
};
const REC_STYLE: Record<TourPlan['recommendation'], { label: string; cls: string }> = {
  approve: { label: 'Approve', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  'review-changes': { label: 'Review changes', cls: 'bg-amber-50 text-amber-900 ring-amber-200' },
  'hold-capacity': { label: 'Hold: capacity', cls: 'bg-rose-50 text-rose-800 ring-rose-200' },
  wait: { label: 'Wait for TO', cls: 'bg-stone-100 text-stone-700 ring-stone-200' },
  'follow-up': { label: 'Follow up now', cls: 'bg-orange-50 text-orange-800 ring-orange-200' },
  'needs-chat': { label: 'Needs chat dates', cls: 'bg-amber-50 text-amber-900 ring-amber-200' },
  resolve: { label: 'Resolve', cls: 'bg-rose-50 text-rose-800 ring-rose-200' },
  done: { label: 'Sent to NKERP', cls: 'bg-sky-50 text-sky-800 ring-sky-200' },
};
const KIND_LABEL: Record<TourPlan['kind'], string> = { faiz: 'Faiz', hotel: 'Hotel', mixed: 'Faiz + hotel', preferred: 'Preferred' };

const Pill: React.FC<{ cls: string; children: React.ReactNode; title?: string }> = ({ cls, children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ring-1 ring-inset text-[11px] font-semibold whitespace-nowrap ${cls}`}>{children}</span>
);
const Card: React.FC<{ title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, right, children, className = '' }) => (
  <section className={`bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden ${className}`}>
    <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-stone-100">
      <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
      {right}
    </header>
    {children}
  </section>
);
const when = (v: string) => (v ? `${fmtDay(localDay(v), true)}, ${localTime(v)}` : '—');
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

// ------------------------------------------------------------------------------------------------ confirm

interface ConfirmState { title: string; body: React.ReactNode; action: string; onConfirm: () => void }
const ConfirmDialog: React.FC<{ state: ConfirmState | null; onClose: () => void }> = ({ state, onClose }) => {
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/40 p-4" role="dialog" aria-modal="true" aria-label={state.title}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h3 className="text-base font-semibold text-stone-900">{state.title}</h3>
          <button type="button" onClick={onClose} className={btn.ghost} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 text-sm text-stone-700 space-y-3">{state.body}</div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-100">
          <button type="button" className={btn.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={btn.primary} onClick={() => { onClose(); state.onConfirm(); }}>{state.action}</button>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ WhatsApp

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const area = document.createElement('textarea');
    area.value = text; document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy'); area.remove(); return ok;
  }
}
const WhatsAppBox: React.FC<{ title: string; message: string }> = ({ title, message }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-emerald-950">{title}</h3>
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} onClick={async () => { setCopied(await copyText(message)); window.setTimeout(() => setCopied(false), 2500); }}>
            {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy'}</button>
          <a className={btn.secondary} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Open WhatsApp</a>
        </div>
      </div>
      <pre className="whitespace-pre-wrap text-xs text-stone-800 font-sans bg-white rounded-lg border border-emerald-100 p-2.5 max-h-64 overflow-y-auto">{message}</pre>
    </div>
  );
};

const FollowUpsDialog: React.FC<{ plans: TourPlan[]; onClose: () => void }> = ({ plans, onClose }) => {
  const groups = officeFollowUps(plans);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/40 p-4" role="dialog" aria-modal="true" aria-label="WhatsApp follow-ups">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 sticky top-0 bg-white">
          <h3 className="text-base font-semibold text-stone-900">WhatsApp follow-ups · {groups.length} office{groups.length === 1 ? '' : 's'}</h3>
          <button type="button" onClick={onClose} className={btn.ghost} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-stone-600">One message per office for every Tour ID inside the cut-off that still shows the dustbin sign or has no city dates in chat. Copy it into the office's WhatsApp chat. Nothing is sent from the app.</p>
          {groups.length ? groups.map(g => <WhatsAppBox key={g.office} title={`${g.office} · ${g.tours.length} Tour ID${g.tours.length === 1 ? '' : 's'}`} message={g.message} />)
            : <p className="text-sm text-stone-500">Nobody needs chasing right now.</p>}
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ tour detail

const ImpactTable: React.FC<{ plan: TourPlan }> = ({ plan }) => {
  if (!plan.impact.length) return <p className="text-xs text-stone-500">No Faiz pax: this tour does not use Faiz capacity.</p>;
  const days = [...new Set(plan.impact.map(i => i.date))];
  const cell = (city: City, date: string) => plan.impact.find(i => i.city === city && i.date === date);
  return (
    <div className="overflow-x-auto">
      <table className="text-xs min-w-full">
        <thead><tr className="text-stone-500">
          <th className="text-left font-medium py-1 pr-3">Date</th>
          <th className="text-right font-medium py-1 px-2">Karbala before → after</th>
          <th className="text-right font-medium py-1 px-2">Najaf before → after</th>
        </tr></thead>
        <tbody>
          {days.map(d => (
            <tr key={d} className="border-t border-stone-100">
              <td className="py-1 pr-3 text-stone-700">{fmtDay(d)}</td>
              {(['KARBALA', 'NAJAF'] as City[]).map(c => {
                const i = cell(c, d);
                return <td key={c} className={`py-1 px-2 text-right tabular-nums ${i && i.after > i.limit ? 'text-rose-700 font-semibold' : 'text-stone-700'}`}>
                  {i ? <>{i.before} → {i.after} <span className="text-stone-400">/ {i.limit}</span></> : <span className="text-stone-300">—</span>}
                </td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const TourDetail: React.FC<{
  plan: TourPlan;
  draft: Segment[] | undefined;
  onDraft: (segments: Segment[] | undefined) => void;
  onSave: (segments: Segment[] | null) => Promise<void>;
  onReview: (reviewed: boolean) => Promise<void>;
  onApprove: () => void;
  busy: boolean;
}> = ({ plan: p, draft, onDraft, onSave, onReview, onApprove, busy }) => {
  const t = p.tour;
  const fields = toSubvenueDates(p.segments);
  const multi = p.segments.filter(s => s.city === 'KARBALA').length > 1 || p.segments.filter(s => s.city === 'NAJAF').length > 1;
  const set = (key: keyof SubvenueDates, value: string) => onDraft(fromSubvenueDates({ ...fields, [key]: value }));
  const nights = cityNights(p.segments);
  const status = t.reapproval ? reapprovalStatus(p) : null;
  const blocked = p.problems.some(x => !x.startsWith('Over the'));
  const evidence = new Set(p.chat.evidence);
  const saved = p.record?.edits?.segments;
  const unsaved = draft !== undefined;
  const sentState = p.record?.approval;
  return (
    <div className="bg-stone-50/60 border-t border-stone-200 px-3 sm:px-5 py-4 space-y-4">
      {/* 1. Tour details */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1.5">1 · Tour details</h3>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs"><tr>
              <th className="text-left font-medium px-3 py-2">Tour ID</th><th className="text-left font-medium px-3 py-2">Office Name</th>
              <th className="text-left font-medium px-3 py-2">Iraq Arrival Date</th><th className="text-left font-medium px-3 py-2">Iraq Departure Date</th>
              <th className="text-left font-medium px-3 py-2">Total Pax</th>
            </tr></thead>
            <tbody><tr>
              <td className="px-3 py-2 font-semibold text-stone-900 whitespace-nowrap">{t.ref}</td>
              <td className="px-3 py-2">{t.office || '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap">{when(t.arrivalAt)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{when(t.departureAt)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{t.paxTotal} <span className="text-stone-500 text-xs">({t.paxFaiz} Faiz · {t.paxHotel} hotel)</span></td>
            </tr></tbody>
          </table>
        </div>
      </div>

      {/* 2. Subvenue details */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1.5">2 · Subvenue details</h3>
        <div className="rounded-xl border border-stone-200 bg-white p-3">
          {multi ? (
            <p className="text-sm text-stone-700">{fmtSegments(p.segments)} <span className="text-xs text-stone-500">(a repeated city visit; change it in NKERP)</span></p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {([['karbalaArrival', 'Karbala Arrival'], ['karbalaDeparture', 'Karbala Departure'], ['najafArrival', 'Najaf Arrival'], ['najafDeparture', 'Najaf Departure']] as [keyof SubvenueDates, string][]).map(([key, label]) => (
                <label key={key} className="text-xs text-stone-600">
                  <span className="block mb-1 font-medium">{label}</span>
                  <input type="date" value={fields[key]} min={tripStart(t)} max={tripEnd(t)} disabled={p.recommendation === 'done'}
                    onChange={e => set(key, e.target.value)}
                    className="w-full h-9 rounded-lg border border-stone-200 px-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                </label>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
            <span><b>{SOURCE_LABEL[unsaved ? 'edited' : p.source]}</b>{unsaved && ' (not saved yet)'}</span>
            {p.segments.length > 0 && <span>Karbala {nights.KARBALA} night{nights.KARBALA === 1 ? '' : 's'} · Najaf {nights.NAJAF} night{nights.NAJAF === 1 ? '' : 's'}</span>}
            {p.segments.length > 0 && <span>Faiz: {t.paxFaiz} pax · Hotel: {t.paxHotel} pax in each stay</span>}
          </div>
          {p.recommendation !== 'done' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {unsaved && <button type="button" className={btn.primary} disabled={busy || segmentProblems(p.segments, tripStart(t), tripEnd(t)).length > 0} onClick={() => onSave(draft!)}><Save className="w-4 h-4" />Save dates</button>}
              {(unsaved || saved) && <button type="button" className={btn.secondary} disabled={busy} onClick={() => { onDraft(undefined); if (saved) void onSave(null); }}><RotateCcw className="w-4 h-4" />Back to AI suggestion</button>}
              {p.alternative && <button type="button" className={btn.secondary} disabled={busy} onClick={() => onDraft(p.alternative!.segments)}>
                <Repeat2 className="w-4 h-4" />Try {CITY_NAME[p.alternative.segments[0].city]} first</button>}
            </div>
          )}
        </div>
      </div>

      {needsFollowUp(p) && <WhatsAppBox title="WhatsApp message to the Tour Operator" message={followUpMessage(p)} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {(p.problems.length > 0 || p.notes.length > 0) && (
            <div className="space-y-1.5">
              {p.problems.map((x, i) => <p key={'p' + i} className="flex gap-2 text-sm text-rose-800"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{x}</p>)}
              {p.notes.map((x, i) => <p key={'n' + i} className="flex gap-2 text-sm text-stone-600"><Info className="w-4 h-4 mt-0.5 shrink-0 text-stone-400" />{x}</p>)}
            </div>
          )}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1.5">Capacity before → after (Faiz pax)</h3>
            <ImpactTable plan={p} />
            {p.alternative && (
              <p className="mt-2 text-xs text-stone-600">Other order ({fmtSegments(p.alternative.segments)}): {p.alternative.fits ? 'fits' : 'does not fit'}{p.alternative.over.length ? ` · over on ${p.alternative.over.map(o => `${fmtDay(o.date)} ${CITY_NAME[o.city]}`).join(', ')}` : ''}.</p>
            )}
          </div>
          <div className="text-xs text-stone-600 space-y-0.5">
            <p><b>Submission:</b> {t.dustbin ? <span className="text-orange-800"><Trash2 className="inline w-3.5 h-3.5 -mt-0.5" /> Dustbin sign visible: something is still pending</span> : 'Complete (no dustbin sign)'} · {p.submission.daysToArrival} days to arrival · cut-off {p.submission.cutoffDays} days</p>
            <p><b>Accommodation in Faiz:</b> {t.optionLabel || t.option} · {t.entryPort || '—'} → {t.exitPort || '—'}{t.mawaid ? ' · Mawaid' : ''}</p>
          </div>
        </div>

        <div className="space-y-4">
          {t.reapproval && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-amber-950">Re-Approval Required · {status}</h3>
                {status !== 'Approved' && (
                  <button type="button" className={btn.secondary} disabled={busy} onClick={() => onReview(status !== 'Reviewed')}>
                    <BadgeCheck className="w-4 h-4" />{status === 'Reviewed' ? 'Undo reviewed' : 'Mark reviewed'}
                  </button>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-stone-500">Previously approved</dt>
                <dd className="text-stone-800">{fmtSegments(p.original?.segments ?? [])}{p.original?.paxFaiz !== undefined ? ` · ${p.original.paxFaiz} Faiz pax` : ''}{p.original?.paxHotel !== undefined ? ` · ${p.original.paxHotel} hotel pax` : ''}
                  <span className="text-stone-400"> ({p.originalSource === 'app' ? 'app history' : 'from NKERP'})</span></dd>
                <dt className="text-stone-500">Latest request</dt>
                <dd className="text-stone-800">{fmtSegments(p.segments)} · {t.paxFaiz} Faiz · {t.paxHotel} hotel · {fmtDay(tripStart(t))}–{fmtDay(tripEnd(t))}</dd>
              </dl>
              {p.changes.length ? (
                <ul className="mt-2 space-y-1">
                  {p.changes.map((c, i) => (
                    <li key={i} className="text-xs flex flex-wrap gap-1.5 items-baseline">
                      <Pill cls="bg-white text-amber-900 ring-amber-300">{c.category}</Pill>
                      <span className="text-stone-600">{c.field}:</span>
                      {c.before && <span className="line-through text-stone-400">{c.before}</span>}
                      {c.before && <ArrowRight className="w-3 h-3 text-stone-400" />}
                      <span className="font-semibold text-stone-900">{c.after}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-xs text-stone-600">No change found against the previous approval.</p>}
            </div>
          )}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1.5 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />Chat box {t.unread && <Pill cls="bg-rose-50 text-rose-700 ring-rose-200">unread in NKERP</Pill>}
            </h3>
            {t.messages.length ? (
              <ol className="max-h-56 overflow-y-auto rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
                {t.messages.map((m, i) => {
                  const hit = m.text.split(/\r?\n/).some(l => evidence.has(l.trim())) || evidence.has(m.text.trim());
                  return (
                    <li key={i} className={`px-3 py-1.5 text-xs ${hit ? 'bg-emerald-50/70' : ''}`}>
                      <span className="text-stone-400">{when(m.at)} · {m.sender || (m.fromOperator ? 'Tour Operator' : 'NKERP')}</span>
                      <p className="text-stone-800 whitespace-pre-wrap">{m.text}</p>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="text-xs text-stone-500">No messages.</p>}
            <p className="mt-1 text-[11px] text-stone-400">Read only: the planner never marks messages read or replies.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 pt-3">
        <div className="text-xs text-stone-600">
          {sentState ? <>Last approval: <b>{sentState.state === 'api_reported_approved' ? 'accepted by NKERP' : sentState.state === 'api_rejected' ? 'refused by NKERP' : sentState.state === 'attempting' ? 'sending' : 'result unknown (not resent)'}</b> {ago(sentState.at)}{sentState.message ? ` · ${sentState.message}` : ''}</> : 'Not approved from the planner yet.'}
        </div>
        <button type="button" className={btn.primary} onClick={onApprove}
          disabled={busy || blocked || !p.segments.length || unsaved || p.recommendation === 'done' || p.category === 'pending-submission'}
          title={unsaved ? 'Save the dates first' : blocked ? 'Resolve the problems first' : p.category === 'pending-submission' ? 'The submission is not complete' : ''}>
          <Send className="w-4 h-4" />Approve in NKERP
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ lists

const TourTable: React.FC<{
  plans: TourPlan[];
  selectable?: boolean;
  selected?: Set<number>;
  onToggle?: (id: number) => void;
  onToggleAll?: (ids: number[], on: boolean) => void;
  expanded: number | null;
  onExpand: (id: number | null) => void;
  renderDetail: (p: TourPlan) => React.ReactNode;
  empty: string;
}> = ({ plans, selectable, selected, onToggle, onToggleAll, expanded, onExpand, renderDetail, empty }) => {
  if (!plans.length) return <p className="px-4 py-8 text-center text-sm text-stone-500">{empty}</p>;
  const ids = plans.map(p => p.tour.id);
  const all = selectable && ids.every(id => selected?.has(id));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-stone-50 text-xs text-stone-500">
          <tr>
            {selectable && <th className="px-3 py-2 w-8"><input type="checkbox" aria-label="Select all" checked={Boolean(all)} onChange={e => onToggleAll?.(ids, e.target.checked)} /></th>}
            <th className="w-6" />
            <th className="text-left font-medium px-3 py-2">Tour ID</th>
            <th className="text-left font-medium px-3 py-2">Office</th>
            <th className="text-left font-medium px-3 py-2">Arrival → Departure</th>
            <th className="text-right font-medium px-3 py-2">Pax (Faiz / hotel)</th>
            <th className="text-left font-medium px-3 py-2">City stays</th>
            <th className="text-left font-medium px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {plans.map(p => {
            const t = p.tour;
            const open = expanded === t.id;
            const rec = REC_STYLE[p.recommendation];
            return (
              <React.Fragment key={t.id}>
                <tr className={`border-t border-stone-100 hover:bg-stone-50 cursor-pointer ${open ? 'bg-stone-50' : ''}`} onClick={() => onExpand(open ? null : t.id)}>
                  {selectable && <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${t.ref}`} checked={selected?.has(t.id) ?? false} onChange={() => onToggle?.(t.id)} /></td>}
                  <td className="pl-2">{open ? <ChevronDown className="w-4 h-4 text-stone-400" /> : <ChevronRight className="w-4 h-4 text-stone-400" />}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-semibold text-stone-900">{t.ref.replace(/^NKERP\/TOUR\//, '')}</span>
                    <span className="ml-1.5 inline-flex gap-1 align-middle">
                      {t.reapproval && <Pill cls="bg-amber-50 text-amber-900 ring-amber-200">Re-approval</Pill>}
                      {t.dustbin && <span title="Dustbin sign: submission incomplete"><Trash2 className="w-3.5 h-3.5 text-orange-600" /></span>}
                      {t.unread && <span title="Unread chat in NKERP"><MessageSquare className="w-3.5 h-3.5 text-rose-600" /></span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[220px] truncate" title={t.office}>{t.office || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-stone-700">{fmtDay(tripStart(t))} → {fmtDay(tripEnd(t))}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{t.paxTotal} <span className="text-stone-500 text-xs">({t.paxFaiz} / {t.paxHotel})</span></td>
                  <td className="px-3 py-2 text-xs text-stone-700 whitespace-nowrap"><Pill cls="bg-white text-stone-600 ring-stone-200">{KIND_LABEL[p.kind]}</Pill> {fmtSegments(p.segments)}</td>
                  <td className="px-3 py-2"><Pill cls={rec.cls} title={p.problems[0]}>{rec.label}</Pill></td>
                </tr>
                {open && <tr><td colSpan={selectable ? 8 : 7} className="p-0">{renderDetail(p)}</td></tr>}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const CapacitySection: React.FC<{ plan: ApprovalPlan }> = ({ plan }) => {
  const [date, setDate] = useState(plan.days[0] ?? '');
  useEffect(() => { if (!plan.days.includes(date)) setDate(plan.days[0] ?? ''); }, [plan.days, date]);
  const row = (city: City) => plan.capacity.find(c => c.date === date && c.city === city);
  const n = row('NAJAF'), k = row('KARBALA');
  const lines: [string, (r: typeof n) => React.ReactNode][] = [
    ['Maximum Capacity', r => r?.limit],
    ['Approved Pax', r => r?.approved],
    ['Pending Approval Pax', r => r?.pendingApproval],
    ['Estimated Pending Submission Pax (buffer)', r => r?.buffer],
    ['Available Capacity', r => r && <span className={r.available < 0 ? 'text-rose-700 font-semibold' : 'text-emerald-800 font-semibold'}>{r.available}</span>],
    ['Recommended Additional Allocation', r => r?.recommended],
    ['Hotel pax approved (not Faiz)', r => r?.hotelApproved],
    ['Hotel pax pending approval', r => r?.hotelPending],
  ];
  return (
    <div className="space-y-4">
      <Card title="Daily capacity overview" right={
        <select value={date} onChange={e => setDate(e.target.value)} className="h-9 rounded-lg border border-stone-200 px-2 text-sm">
          {plan.days.map(d => <option key={d} value={d}>{fmtDay(d, true)}</option>)}
        </select>}>
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-xs text-stone-500"><tr>
            <th className="text-left font-medium px-4 py-2">Details</th><th className="text-right font-medium px-4 py-2">Najaf</th><th className="text-right font-medium px-4 py-2">Karbala</th>
          </tr></thead>
          <tbody>{lines.map(([label, f]) => (
            <tr key={label} className="border-t border-stone-100"><td className="px-4 py-2 text-stone-700">{label}</td>
              <td className="px-4 py-2 text-right tabular-nums">{f(n) ?? '—'}</td><td className="px-4 py-2 text-right tabular-nums">{f(k) ?? '—'}</td></tr>
          ))}</tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-stone-500 border-t border-stone-100">Approved pax come from NKERP's accommodation dashboard (tours being re-approved are taken out and planned again). Pending approval is this plan's Faiz pax. The buffer keeps {plan.settings.bufferPercent}% of unsubmitted tours' Faiz pax free. Transfer days count in both cities.</p>
      </Card>

      <Card title="Shift opportunities (whole Tour IDs only)">
        {plan.shifts.length ? (
          <ul className="divide-y divide-stone-100">
            {plan.shifts.map((s, i) => (
              <li key={i} className="px-4 py-3 text-sm">
                <p className="text-stone-900">{s.benefit}</p>
                <p className="text-xs text-stone-600 mt-0.5">{s.move.tour.ref}: {fmtSegments(s.from)} → <b>{fmtSegments(s.to)}</b> · {s.admits.tour.ref}: {fmtSegments(s.admitsWith)}</p>
                <p className="text-xs text-stone-500 mt-1">{s.impact.map(x => `${fmtDay(x.date)} ${CITY_NAME[x.city]} ${x.before}→${x.after}`).join(' · ')}</p>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-6 text-sm text-stone-500">No whole-tour shift would let a held tour fit right now. Flexible tours are already placed in the order that fits best.</p>}
      </Card>

      <Card title="Day by day (Faiz pax)">
        <div className="overflow-x-auto max-h-[480px]">
          <table className="min-w-full text-xs">
            <thead className="bg-stone-50 text-stone-500 sticky top-0"><tr>
              <th className="text-left font-medium px-3 py-2">Date</th>
              {(['NAJAF', 'KARBALA'] as City[]).map(c => <th key={c} colSpan={4} className="text-center font-medium px-3 py-2 border-l border-stone-200">{CITY_NAME[c]} / {plan.settings.limits[c]}</th>)}
            </tr><tr>
              <th />
              {(['NAJAF', 'KARBALA'] as City[]).flatMap(c => ['Approved', 'Pending', 'Buffer', 'Available'].map((h, i) => <th key={c + h} className={`text-right font-medium px-2 py-1 ${i === 0 ? 'border-l border-stone-200' : ''}`}>{h}</th>))}
            </tr></thead>
            <tbody>
              {plan.days.map(d => (
                <tr key={d} className="border-t border-stone-100">
                  <td className="px-3 py-1 whitespace-nowrap text-stone-700">{fmtDay(d)}</td>
                  {(['NAJAF', 'KARBALA'] as City[]).flatMap(c => {
                    const r = plan.capacity.find(x => x.date === d && x.city === c);
                    return [r?.approved, r?.pendingApproval, r?.buffer, r?.available].map((v, i) => (
                      <td key={c + i} className={`px-2 py-1 text-right tabular-nums ${i === 0 ? 'border-l border-stone-200' : ''} ${i === 3 && (v ?? 0) < 0 ? 'text-rose-700 font-semibold bg-rose-50' : i === 3 ? 'text-emerald-800' : 'text-stone-700'}`}>{v ?? '—'}</td>
                    ));
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ view

export const ApprovalsView: React.FC = () => {
  const [state, setState] = useState<ApprovalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<Section>('proposal');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Segment[]>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [batch, setBatch] = useState<{ total: number; done: number; results: { ref: string; state: string; message?: string }[] } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ApprovalSettings | null>(null);
  const [followUps, setFollowUps] = useState(false);
  const autoRefreshed = useRef(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try { setState(await refreshApprovals()); }
    catch (e) { setError(e instanceof Error ? e.message : 'NKERP could not be read.'); }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    loadApprovals().then(s => {
      setState(s);
      const age = s.snapshot.collectedAt ? Date.now() - Date.parse(s.snapshot.collectedAt) : Infinity;
      if (age > 15 * 60_000 && !autoRefreshed.current) { autoRefreshed.current = true; void refresh(); }
    }, e => setError(e instanceof Error ? e.message : 'The approvals could not be loaded.'));
  }, [refresh]);
  useEffect(() => { if (state) setSettingsDraft(state.settings); }, [state?.settings]);

  // The approver's unsaved dates recalculate the whole plan at once.
  const plan = useMemo(() => {
    if (!state) return null;
    const records: Record<string, ApprovalRecord> = { ...state.records };
    for (const [id, segments] of Object.entries(drafts)) {
      const tour = state.snapshot.tours.find(t => String(t.id) === id);
      if (!tour) continue;
      const base = records[id] ?? { id: tour.id, ref: tour.ref, office: tour.office, status: 'new', firstSeenAt: '', lastSeenAt: '', history: [] } as ApprovalRecord;
      records[id] = { ...base, edits: { segments, at: '', modifiedOn: tour.modifiedOn } };
    }
    return planApprovals(state.snapshot, records, settingsDraft ?? state.settings);
  }, [state, drafts, settingsDraft]);

  const q = search.trim().toLowerCase();
  const filter = (list: TourPlan[]) => q ? list.filter(p => `${p.tour.ref} ${p.tour.office}`.toLowerCase().includes(q)) : list;
  const lists = useMemo(() => {
    const plans = plan?.plans ?? [];
    return {
      proposal: plans.filter(p => !p.tour.reapproval && p.recommendation === 'approve').concat(plans.filter(p => p.tour.reapproval && p.recommendation === 'approve')),
      reapproval: plans.filter(p => p.tour.reapproval),
      awaiting: plans.filter(p => p.category === 'awaiting'),
      pending: plans.filter(p => p.category === 'pending-submission').sort((a, b) => a.submission.daysToArrival - b.submission.daysToArrival),
      all: plans,
    };
  }, [plan]);

  const persistEdit = async (p: TourPlan, segments: Segment[] | null) => {
    setBusy(true);
    try {
      setState(await saveApprovalEdit(p.tour.id, segments, p.tour.modifiedOn));
      setDrafts(d => { const n = { ...d }; delete n[String(p.tour.id)]; return n; });
    } catch (e) { setError(e instanceof Error ? e.message : 'The dates could not be saved.'); }
    finally { setBusy(false); }
  };
  const review = async (p: TourPlan, reviewed: boolean) => {
    setBusy(true);
    try { setState(await saveApprovalReview(p.tour.id, reviewed)); }
    catch (e) { setError(e instanceof Error ? e.message : 'The review could not be saved.'); }
    finally { setBusy(false); }
  };

  const sendApprovals = async (items: TourPlan[]) => {
    setBusy(true);
    setBatch({ total: items.length, done: 0, results: [] });
    for (const p of items) {
      let result: { ref: string; state: string; message?: string };
      try {
        const s = await approveInNkerp(p.tour.id, p.segments, p.tour.modifiedOn);
        setState(s);
        result = { ref: p.tour.ref, state: s.record.approval?.state ?? 'unknown', message: s.record.approval?.message };
      } catch (e) {
        result = { ref: p.tour.ref, state: 'not sent', message: e instanceof Error ? e.message : 'Failed' };
      }
      setBatch(b => b && { ...b, done: b.done + 1, results: [...b.results, result] });
    }
    setSelected(new Set());
    setBusy(false);
  };
  const askApprove = (items: TourPlan[]) => {
    const over = items.filter(p => !p.fits);
    const faiz = items.reduce((s, p) => s + p.tour.paxFaiz, 0);
    setConfirm({
      title: items.length === 1 ? `Approve ${items[0].tour.ref} in NKERP?` : `Approve ${items.length} Tour IDs in NKERP?`,
      action: items.length === 1 ? 'Approve in NKERP' : `Approve ${items.length} in NKERP`,
      body: <>
        <p>Each Tour ID is sent once, with these city stays. A result that does not come back is never sent again automatically.</p>
        <ul className="max-h-52 overflow-y-auto rounded-lg border border-stone-200 divide-y divide-stone-100 text-xs">
          {items.map(p => <li key={p.tour.id} className="px-3 py-1.5"><b>{p.tour.ref}</b> · {p.tour.office} · {p.tour.paxFaiz} Faiz / {p.tour.paxHotel} hotel<br />{fmtSegments(p.segments)}{p.tour.reapproval ? ' · re-approval' : ''}</li>)}
        </ul>
        <p className="text-xs text-stone-600">{faiz} Faiz pax in total.</p>
        {over.length > 0 && <p className="flex gap-2 text-rose-800"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{over.length} of these go over a city limit: {over.map(p => p.tour.ref).join(', ')}. Approving them is your exception.</p>}
      </>,
      onConfirm: () => void sendApprovals(items),
    });
  };

  const saveSettings = async (next: ApprovalSettings) => {
    setSettingsDraft(next);
    try { setState(await saveApprovalSettings(next)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Settings could not be saved.'); }
  };

  const detail = (p: TourPlan) => (
    <TourDetail plan={p} draft={drafts[String(p.tour.id)]} busy={busy}
      onDraft={segments => setDrafts(d => { const n = { ...d }; if (segments) n[String(p.tour.id)] = segments; else delete n[String(p.tour.id)]; return n; })}
      onSave={segments => persistEdit(p, segments)} onReview={reviewed => review(p, reviewed)} onApprove={() => askApprove([p])} />
  );

  if (!state || !plan) {
    return (
      <div className="py-16 text-center text-sm text-stone-500">
        {error ? <p className="text-rose-700">{error}</p> : <><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading approvals…</>}
      </div>
    );
  }
  const c = plan.counts;
  const s = settingsDraft ?? state.settings;
  const reasons = CHANGE_CATEGORIES.map(cat => ({ cat, n: lists.reapproval.filter(p => p.changes.some(x => x.category === cat)).length })).filter(x => x.n);
  const selectedPlans = lists.proposal.filter(p => selected.has(p.tour.id));
  const tiles: { label: string; value: number; tone: string; go: Section; hint: string }[] = [
    { label: 'New Approvals', value: c.newApprovals, tone: 'text-stone-900', go: 'all', hint: 'Awaiting first approval' },
    { label: 'Re-Approval Pending', value: c.reapprovalPending, tone: 'text-amber-700', go: 'reapproval', hint: 'Submitted again' },
    { label: 'Re-Approval Reviewed', value: c.reapprovalReviewed, tone: 'text-sky-700', go: 'reapproval', hint: 'Changes checked' },
    { label: 'Re-Approved', value: c.reApproved, tone: 'text-emerald-700', go: 'reapproval', hint: 'From this planner' },
    { label: 'Ready to approve', value: c.ready, tone: 'text-emerald-700', go: 'proposal', hint: 'Submitted, fits capacity' },
    { label: 'Follow up now', value: c.followUp, tone: 'text-orange-700', go: 'pending', hint: `Dustbin sign inside ${s.cutoffDays} days` },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Tour approvals"
        description="Nizam approvals for Najaf and Karbala from NKERP's Tour Admin queues: exact chat dates, whole-tour capacity planning, re-approval checks and the submission cut-off."
        meta={<p className="text-xs text-stone-500">Read from NKERP {ago(state.snapshot.collectedAt)}{state.snapshot.window ? ` · arrivals ${fmtDay(state.snapshot.window.from)}–${fmtDay(state.snapshot.window.to, true)} plus every re-approval` : ''}{state.snapshot.errors.length ? ` · ${state.snapshot.errors.length} read problem${state.snapshot.errors.length === 1 ? '' : 's'}` : ''}</p>}
        actions={<button type="button" className={btn.primary} onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{refreshing ? 'Reading NKERP…' : 'Refresh from NKERP'}</button>} />

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}<button type="button" className="ml-auto" onClick={() => setError(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button></div>}

      {lists.reapproval.length > 0 && (
        <button type="button" onClick={() => setSection('reapproval')} className="w-full text-left rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 hover:bg-amber-100/60 transition cursor-pointer">
          <p className="text-sm font-semibold text-amber-950 flex items-center gap-2"><Repeat2 className="w-4 h-4" />{lists.reapproval.length} Tour ID{lists.reapproval.length === 1 ? ' has' : 's have'} come for re-approval ({c.reapprovalPending} pending, {c.reapprovalReviewed} reviewed)</p>
          {reasons.length > 0 && <p className="text-xs text-amber-900 mt-1">{reasons.map(r => `${r.cat}: ${r.n}`).join(' · ')}</p>}
        </button>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {tiles.map(t => (
          <button key={t.label} type="button" onClick={() => setSection(t.go)} className="text-left rounded-xl border border-stone-200 bg-white px-3 py-2.5 hover:border-stone-300 transition cursor-pointer">
            <span className={`block text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</span>
            <span className="block text-xs font-medium text-stone-800">{t.label}</span>
            <span className="block text-[11px] text-stone-500">{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-xs text-stone-600">
        <div>
          <span className="block mb-1 font-medium">Submission cut-off</span>
          <div className="flex items-center gap-1">
            {[15, 30].map(d => <button key={d} type="button" onClick={() => void saveSettings({ ...s, cutoffDays: d })}
              className={`h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer ${s.cutoffDays === d ? 'bg-emerald-800 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}>{d} days</button>)}
            <input type="number" min={1} max={120} value={s.cutoffDays} aria-label="Cut-off days"
              onChange={e => setSettingsDraft({ ...s, cutoffDays: Number(e.target.value) || s.cutoffDays })} onBlur={() => void saveSettings(s)}
              className="w-16 h-8 rounded-lg border border-stone-200 px-2 text-sm" />
          </div>
        </div>
        {(['NAJAF', 'KARBALA'] as City[]).map(city => (
          <label key={city}><span className="block mb-1 font-medium">{CITY_NAME[city]} limit</span>
            <input type="number" min={1} value={s.limits[city]} onChange={e => setSettingsDraft({ ...s, limits: { ...s.limits, [city]: Number(e.target.value) || s.limits[city] } })}
              onBlur={() => void saveSettings(s)} className="w-20 h-8 rounded-lg border border-stone-200 px-2 text-sm" /></label>
        ))}
        <label><span className="block mb-1 font-medium">Buffer for unsubmitted tours</span>
          <span className="flex items-center gap-1"><input type="number" min={0} max={200} value={s.bufferPercent} onChange={e => setSettingsDraft({ ...s, bufferPercent: Number(e.target.value) })}
            onBlur={() => void saveSettings(s)} className="w-16 h-8 rounded-lg border border-stone-200 px-2 text-sm" />%</span></label>
        <label><span className="block mb-1 font-medium">Plan arrivals ahead</span>
          <span className="flex items-center gap-1"><input type="number" min={7} max={120} value={s.horizonDays} onChange={e => setSettingsDraft({ ...s, horizonDays: Number(e.target.value) || s.horizonDays })}
            onBlur={() => void saveSettings(s)} className="w-16 h-8 rounded-lg border border-stone-200 px-2 text-sm" />days</span></label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1">
          {SECTIONS.map(x => {
            const n = x.id === 'proposal' ? lists.proposal.length : x.id === 'reapproval' ? lists.reapproval.length : x.id === 'awaiting' ? lists.awaiting.length : x.id === 'pending' ? lists.pending.length : x.id === 'all' ? lists.all.length : null;
            return <button key={x.id} type="button" onClick={() => setSection(x.id)}
              className={`h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer ${section === x.id ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600 hover:text-stone-900'}`}>
              {x.label}{n !== null && <span className="ml-1 text-stone-400">{n}</span>}</button>;
          })}
        </div>
        {['proposal', 'reapproval', 'awaiting', 'pending', 'all', 'remaining'].includes(section) && (
          <label className="relative ml-auto">
            <Search className="w-4 h-4 text-stone-400 absolute left-2.5 top-2.5" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tour ID or office" className="h-9 w-56 rounded-lg border border-stone-200 pl-8 pr-2 text-sm" />
          </label>
        )}
      </div>

      {batch && (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-stone-900">{batch.done < batch.total ? <><Loader2 className="inline w-4 h-4 animate-spin mr-1" />Sending {batch.done + 1} of {batch.total}…</> : `Sent ${batch.total}: ${batch.results.filter(r => r.state === 'api_reported_approved').length} accepted, ${batch.results.filter(r => r.state === 'api_rejected' || r.state === 'not sent').length} refused, ${batch.results.filter(r => r.state === 'uncertain_no_retry').length} unknown`}</p>
            {batch.done === batch.total && <button type="button" onClick={() => setBatch(null)} aria-label="Close"><X className="w-4 h-4 text-stone-400" /></button>}
          </div>
          <ul className="mt-2 max-h-40 overflow-y-auto text-xs space-y-0.5">
            {batch.results.map((r, i) => <li key={i} className={r.state === 'api_reported_approved' ? 'text-emerald-800' : r.state === 'uncertain_no_retry' ? 'text-amber-800' : 'text-rose-800'}>
              {r.state === 'api_reported_approved' ? <CheckCircle2 className="inline w-3.5 h-3.5 mr-1" /> : <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />}{r.ref}: {r.state === 'api_reported_approved' ? 'accepted' : r.state === 'uncertain_no_retry' ? 'no answer (check NKERP; not resent)' : r.message || r.state}</li>)}
          </ul>
        </div>
      )}

      {section === 'proposal' && (
        <Card title={`Proposal · ${lists.proposal.length} Tour IDs ready (${lists.proposal.reduce((n, p) => n + p.tour.paxFaiz, 0)} Faiz pax)`}
          right={<button type="button" className={btn.primary} disabled={busy || !selectedPlans.length} onClick={() => askApprove(selectedPlans)}>
            <Send className="w-4 h-4" />Approve selected ({selectedPlans.length})</button>}>
          <p className="px-4 py-2 text-xs text-stone-600 border-b border-stone-100">Submitted (no dustbin), city stays resolved, and within the limits after keeping the buffer. Order: re-approvals, then Faiz Husaini offices, then the rest, by arrival. Open a Tour ID to check its chat and dates before approving.</p>
          <TourTable plans={filter(lists.proposal)} selectable selected={selected} expanded={expanded} onExpand={setExpanded} renderDetail={detail}
            onToggle={id => setSelected(sel => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onToggleAll={(ids, on) => setSelected(sel => { const n = new Set(sel); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; })}
            empty="Nothing is ready to approve right now." />
        </Card>
      )}

      {section === 'reapproval' && (
        <Card title={`Re-approval dashboard · ${lists.reapproval.length}`}>
          <div className="overflow-x-auto border-b border-stone-100">
            <table className="min-w-full text-xs">
              <thead className="bg-stone-50 text-stone-500"><tr>
                <th className="text-left font-medium px-3 py-2">Tour ID</th><th className="text-left font-medium px-3 py-2">Office</th>
                <th className="text-left font-medium px-3 py-2">Original approval</th><th className="text-left font-medium px-3 py-2">Latest requested changes</th>
                <th className="text-left font-medium px-3 py-2">Re-approval status</th>
              </tr></thead>
              <tbody>
                {filter(lists.reapproval).map(p => (
                  <tr key={p.tour.id} className="border-t border-stone-100 align-top hover:bg-stone-50 cursor-pointer" onClick={() => setExpanded(expanded === p.tour.id ? null : p.tour.id)}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{p.tour.ref.replace(/^NKERP\/TOUR\//, '')}</td>
                    <td className="px-3 py-2">{p.tour.office}</td>
                    <td className="px-3 py-2 text-stone-700">{fmtSegments(p.original?.segments ?? [])}{p.original?.paxFaiz !== undefined ? ` · ${p.original.paxFaiz} Faiz` : ''}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">{[...new Set(p.changes.map(x => x.category))].map(cat => <Pill key={cat} cls="bg-amber-50 text-amber-900 ring-amber-200">{cat}</Pill>)}{!p.changes.length && <span className="text-stone-500">No change found</span>}</div>
                    </td>
                    <td className="px-3 py-2"><Pill cls={reapprovalStatus(p) === 'Approved' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : reapprovalStatus(p) === 'Reviewed' ? 'bg-sky-50 text-sky-800 ring-sky-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}>{reapprovalStatus(p)}</Pill>
                      <span className="ml-1"><Pill cls={REC_STYLE[p.recommendation].cls}>{REC_STYLE[p.recommendation].label}</Pill></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {expanded !== null && lists.reapproval.find(p => p.tour.id === expanded) && detail(lists.reapproval.find(p => p.tour.id === expanded)!)}
        </Card>
      )}

      {section === 'awaiting' && (
        <Card title={`Submitted, awaiting approval · ${lists.awaiting.length}`}>
          <p className="px-4 py-2 text-xs text-stone-600 border-b border-stone-100">Complete submissions held back: over capacity, missing chat dates, or something to resolve. The reason shows on each row.</p>
          <TourTable plans={filter(lists.awaiting)} expanded={expanded} onExpand={setExpanded} renderDetail={detail} empty="Nothing is waiting." />
        </Card>
      )}

      {section === 'pending' && (
        <Card title={`Pending submission (dustbin sign) · ${lists.pending.length}`}
          right={<div className="flex items-center gap-2"><span className="text-xs text-stone-500">Cut-off: {s.cutoffDays} days before arrival</span>
            <button type="button" className={btn.secondary} onClick={() => setFollowUps(true)}><MessageSquare className="w-4 h-4" />WhatsApp follow-ups ({plan.plans.filter(needsFollowUp).length})</button></div>}>
          <p className="px-4 py-2 text-xs text-stone-600 border-b border-stone-100">Outside the cut-off: wait for the Tour Operator. Inside it: contact the Tour Operator now and follow up until the dustbin sign disappears. Their Faiz pax are kept free as buffer.</p>
          <TourTable plans={filter(lists.pending)} expanded={expanded} onExpand={setExpanded} renderDetail={detail} empty="Every Tour ID in the window has completed its submission." />
        </Card>
      )}

      {section === 'all' && (
        <Card title={`All Tour IDs · ${lists.all.length}`}>
          <TourTable plans={filter(lists.all)} expanded={expanded} onExpand={setExpanded} renderDetail={detail} empty="No Tour IDs in the queues." />
        </Card>
      )}

      {section === 'capacity' && <CapacitySection plan={plan} />}

      {section === 'najaf' && (
        <Card title="Najaf-only daily report" right={<span className="text-xs text-stone-500">Faiz pax only · arrivals are the proposal's Najaf stays</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500"><tr>
                <th className="text-left font-medium px-3 py-2">Date</th><th className="text-right font-medium px-3 py-2">Limit</th>
                <th className="text-right font-medium px-3 py-2">Projected Faiz</th><th className="text-right font-medium px-3 py-2">Headroom</th>
                <th className="text-left font-medium px-3 py-2">Arriving (Tour ID · Faiz pax · office)</th>
              </tr></thead>
              <tbody>
                {najafReport(plan).map(r => (
                  <tr key={r.date} className="border-t border-stone-100 align-top">
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtDay(r.date, true)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.limit}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.projected}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${r.headroom < 0 ? 'text-rose-700' : 'text-emerald-800'}`}>{r.headroom}</td>
                    <td className="px-3 py-1.5 text-xs">{r.arrivals.length ? r.arrivals.map(a => <div key={a.id}>{a.ref.replace(/^NKERP\/TOUR\//, '')} · {a.pax} · {a.office}</div>) : <span className="text-stone-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === 'remaining' && (
        <Card title="Remaining tours and suggested resolution" right={<span className="text-xs text-stone-500">From the NKERP read {ago(state.snapshot.collectedAt)}</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-stone-50 text-stone-500"><tr>
                <th className="text-left font-medium px-3 py-2">Tour ID</th><th className="text-left font-medium px-3 py-2">Office</th>
                <th className="text-right font-medium px-3 py-2">Pax (Faiz)</th><th className="text-left font-medium px-3 py-2">Trip</th>
                <th className="text-left font-medium px-3 py-2">Issue</th><th className="text-left font-medium px-3 py-2">Suggested resolution</th>
              </tr></thead>
              <tbody>
                {filter(plan.plans.filter(p => !inProposal(p))).map(p => {
                  const sug = suggestion(p, plan);
                  return (
                    <tr key={p.tour.id} className="border-t border-stone-100 align-top">
                      <td className="px-3 py-1.5 font-semibold whitespace-nowrap">{p.tour.ref.replace(/^NKERP\/TOUR\//, '')}{p.tour.reapproval ? ' ↻' : ''}</td>
                      <td className="px-3 py-1.5">{p.tour.office}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.tour.paxTotal} ({p.tour.paxFaiz})</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{fmtDay(tripStart(p.tour))}–{fmtDay(tripEnd(p.tour))}</td>
                      <td className="px-3 py-1.5 text-stone-700">{sug.issue}</td>
                      <td className="px-3 py-1.5 text-stone-900">{sug.next}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-stone-400"><Clock className="w-3.5 h-3.5" />The queues refresh every 15 minutes and when you press Refresh. <Hotel className="w-3.5 h-3.5 ml-2" />Hotel tours are approved only on the Tour Operator's chat dates. <ClipboardList className="w-3.5 h-3.5 ml-2" />Every approval is logged with the Tour ID's history.</p>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      {followUps && <FollowUpsDialog plans={plan.plans} onClose={() => setFollowUps(false)} />}
    </div>
  );
};
