import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BadgeCheck, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock, Hotel, Info,
  Copy, Loader2, MessageSquare, RefreshCw, Repeat2, RotateCcw, Save, Search, Send, Trash2, X,
} from 'lucide-react';
import {
  btn, btnSm, card, chip, type ChipTone, field, fieldLabel, fieldSm, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle,
  PageHeader,
} from './ui';
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
const REC_STYLE: Record<TourPlan['recommendation'], { label: string; tone: ChipTone }> = {
  approve: { label: 'Approve', tone: 'ok' },
  'review-changes': { label: 'Review changes', tone: 'wait' },
  'hold-capacity': { label: 'Hold: capacity', tone: 'bad' },
  wait: { label: 'Wait for TO', tone: 'neutral' },
  'follow-up': { label: 'Follow up now', tone: 'bad' },
  'needs-chat': { label: 'Needs chat dates', tone: 'wait' },
  resolve: { label: 'Resolve', tone: 'bad' },
  done: { label: 'Sent to NKERP', tone: 'neutral' },
};
const RecChip: React.FC<{ plan: TourPlan }> = ({ plan: p }) => (
  <span className={chip(REC_STYLE[p.recommendation].tone)} title={p.problems[0]}>
    {p.recommendation === 'done' && <CheckCircle2 className="w-3 h-3" />}{REC_STYLE[p.recommendation].label}
  </span>
);
const REAPPROVAL_TONE: Record<ReturnType<typeof reapprovalStatus>, ChipTone> = { Approved: 'ok', Reviewed: 'info', Pending: 'wait' };
const KIND_LABEL: Record<TourPlan['kind'], string> = { faiz: 'Faiz', hotel: 'Hotel', mixed: 'Faiz + hotel', preferred: 'Preferred' };

/** A day is "near the limit" when less than a tenth of the city's limit is still free. */
const nearLimit = (free: number, limit: number) => free >= 0 && free < limit * 0.1;
const freeTone = (free: number | undefined, limit: number | undefined) =>
  free === undefined || limit === undefined ? '' : free < 0 ? 'text-rose-700 font-semibold bg-rose-50' : nearLimit(free, limit) ? 'text-amber-800 font-semibold bg-amber-50' : 'text-stone-900';

const tourLabel = (ref: string) => ref.replace(/^NKERP\/TOUR\//, '');
const th = 'text-left font-semibold px-3 py-2.5 whitespace-nowrap';
const thR = 'text-right font-semibold px-3 py-2.5 whitespace-nowrap';
const thead = 'bg-stone-50 text-xs font-semibold text-stone-600';
const subhead = 'text-[13px] font-semibold text-stone-700';

const Card: React.FC<{ title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, right, children, className = '' }) => (
  <section className={`${card} overflow-hidden ${className}`}>
    <header className="flex flex-col gap-3 px-4 sm:px-5 py-3.5 border-b border-stone-200 md:flex-row md:flex-wrap md:items-center md:justify-between">
      <h2 className="text-base font-semibold leading-snug text-stone-950 tabular-nums">{title}</h2>
      {right && <div className="flex flex-wrap items-center gap-2 md:justify-end">{right}</div>}
    </header>
    {children}
  </section>
);
const CardNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-4 sm:px-5 py-3 text-[13px] leading-relaxed text-stone-600 border-b border-stone-200"><span className="block max-w-[110ch]">{children}</span></p>
);
const when = (v: string) => (v ? `${fmtDay(localDay(v), true)}, ${localTime(v)}` : '—');
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** The table turns into a stacked list on phones, where a wide table would hide the status and the detail. */
const useNarrow = () => {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
};

/** The city-stay sequence, e.g. Najaf 20 Nov–23 Nov → Karbala 23 Nov–27 Nov. */
const Stays: React.FC<{ segments: Segment[] }> = ({ segments }) => (segments.length ? (
  <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums">
    {segments.map((s, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ArrowRight className="w-3.5 h-3.5 shrink-0 text-stone-400" aria-label="then" />}
        <span className="whitespace-nowrap"><span className="font-medium text-stone-900">{CITY_NAME[s.city]}</span> <span className="text-stone-600">{fmtDay(s.start)}–{fmtDay(s.end)}</span></span>
      </React.Fragment>
    ))}
  </span>
) : <span className="text-stone-400">—</span>);

/** Small marks beside a Tour ID: came for re-approval, dustbin sign, unread chat. */
const TourMarks: React.FC<{ plan: TourPlan }> = ({ plan: { tour: t } }) => (
  (t.reapproval || t.dustbin || t.unread) ? (
    <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
      {t.reapproval && <span title="Came for re-approval"><Repeat2 className="w-4 h-4 text-amber-700" aria-label="Re-approval" /></span>}
      {t.dustbin && <span title="Dustbin sign: submission incomplete"><Trash2 className="w-4 h-4 text-amber-700" aria-label="Dustbin sign: submission incomplete" /></span>}
      {t.unread && <span title="Unread chat in NKERP"><MessageSquare className="w-4 h-4 text-blue-700" aria-label="Unread chat in NKERP" /></span>}
    </span>
  ) : null
);

// ------------------------------------------------------------------------------------------------ confirm

interface ConfirmState { title: string; body: React.ReactNode; action: string; onConfirm: () => void }
const ConfirmDialog: React.FC<{ state: ConfirmState | null; onClose: () => void }> = ({ state, onClose }) => {
  if (!state) return null;
  return (
    <div className={`${modalScrim} !z-[80]`} role="dialog" aria-modal="true" aria-label={state.title}>
      <div className={`${modalCard} max-w-lg`}>
        <div className={modalHeader}>
          <h3 className={modalTitle}>{state.title}</h3>
          <button type="button" onClick={onClose} className={`${modalClose} max-md:w-10 max-md:h-10`} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 sm:px-6 py-5 text-sm leading-relaxed text-stone-700 space-y-3 overflow-y-auto">{state.body}</div>
        <div className={modalFooter}>
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
const WhatsAppBox: React.FC<{ title: string; message: string; note?: React.ReactNode }> = ({ title, message, note }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
        <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
        <div className="flex gap-2">
          <button type="button" className={`${btnSm.secondary} max-md:h-10 max-md:px-3.5`} onClick={async () => { setCopied(await copyText(message)); window.setTimeout(() => setCopied(false), 2500); }}>
            {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy'}</button>
          <a className={`${btnSm.ghost} max-md:h-10`} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Open WhatsApp</a>
        </div>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-stone-800 bg-white rounded-lg ring-1 ring-inset ring-stone-200 px-3.5 py-3 max-h-64 overflow-y-auto">{message}</pre>
      {note && <p className="mt-1.5 text-xs text-stone-500">{note}</p>}
    </div>
  );
};

const FollowUpsDialog: React.FC<{ plans: TourPlan[]; onClose: () => void }> = ({ plans, onClose }) => {
  const groups = officeFollowUps(plans);
  return (
    <div className={`${modalScrim} !z-[80]`} role="dialog" aria-modal="true" aria-label="WhatsApp follow-ups">
      <div className={`${modalCard} max-w-2xl`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h3 className={modalTitle}>WhatsApp follow-ups · {groups.length} office{groups.length === 1 ? '' : 's'}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">One message per office for every Tour ID inside the cut-off that still shows the dustbin sign or has no city dates in chat. Copy it into the office's WhatsApp chat. Nothing is sent from the app.</p>
          </div>
          <button type="button" onClick={onClose} className={`${modalClose} max-md:w-10 max-md:h-10`} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 sm:px-6 py-5 space-y-6 overflow-y-auto bg-stone-50 rounded-b-2xl">
          {groups.length ? groups.map(g => <WhatsAppBox key={g.office} title={`${g.office} · ${g.tours.length} Tour ID${g.tours.length === 1 ? '' : 's'}`} message={g.message} />)
            : <p className="text-sm text-stone-600">Nobody needs chasing right now. A message appears here for each office with a Tour ID inside the cut-off that is still incomplete.</p>}
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ tour detail

const ImpactTable: React.FC<{ plan: TourPlan }> = ({ plan }) => {
  if (!plan.impact.length) return <p className="text-[13px] text-stone-600">No Faiz pax: this tour does not use Faiz capacity.</p>;
  const days = [...new Set(plan.impact.map(i => i.date))];
  const cell = (city: City, date: string) => plan.impact.find(i => i.city === city && i.date === date);
  return (
    <div className="overflow-x-auto">
      <table className="text-[13px] min-w-full tabular-nums">
        <thead className="text-xs text-stone-600">
          <tr>
            <th rowSpan={2} className="text-left font-semibold pb-1.5 pr-3 align-bottom">Date</th>
            {(['KARBALA', 'NAJAF'] as City[]).map(c => <th key={c} colSpan={2} className="text-right font-semibold pt-0.5 pl-4">{CITY_NAME[c]}</th>)}
          </tr>
          <tr>
            {(['KARBALA', 'NAJAF'] as City[]).flatMap(c => [
              <th key={c + 'n'} className="text-right font-medium pb-1.5 pl-4">Now</th>,
              <th key={c + 'e'} className="text-right font-medium pb-1.5 pl-3 whitespace-nowrap">Expected before → after / limit</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {days.map(d => (
            <tr key={d} className="border-t border-stone-200">
              <td className="py-1.5 pr-3 text-stone-800 whitespace-nowrap">{fmtDay(d)}</td>
              {(['KARBALA', 'NAJAF'] as City[]).flatMap(c => {
                const i = cell(c, d);
                if (!i) return [<td key={c + 'n'} className="py-1.5 pl-4 text-right text-stone-400">—</td>, <td key={c + 'e'} className="py-1.5 pl-3 text-right text-stone-400">—</td>];
                const over = i.after > i.limit;
                return [
                  <td key={c + 'n'} className="py-1.5 pl-4 text-right text-stone-600" title="Approved in NKERP now">{i.present}</td>,
                  <td key={c + 'e'} className="py-1.5 pl-3 text-right whitespace-nowrap text-stone-600">
                    {i.before} → <span className={over ? 'font-semibold text-rose-700' : 'font-semibold text-emerald-800'}>{i.after}</span> <span className="text-stone-500">/ {i.limit}</span>
                  </td>,
                ];
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
  const overDays = p.impact.filter(i => i.after > i.limit).length;
  return (
    <div className="bg-stone-50 border-t border-stone-200 px-4 sm:px-5 py-5 text-left">
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Left: details, dates, capacity */}
        <div className="space-y-6 min-w-0">
          <div>
            <h3 className={`${subhead} mb-2`}>Tour details</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 text-sm">
              <div>
                <dt className="text-xs text-stone-600">Tour ID</dt>
                <dd className="mt-0.5 font-semibold text-stone-950 tabular-nums break-words">{t.ref}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-stone-600">Office name</dt>
                <dd className="mt-0.5 text-stone-900">{t.office || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-600">Iraq arrival date</dt>
                <dd className="mt-0.5 text-stone-900 tabular-nums">{when(t.arrivalAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-600">Iraq departure date</dt>
                <dd className="mt-0.5 text-stone-900 tabular-nums">{when(t.departureAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-600">Total pax</dt>
                <dd className="mt-0.5 text-stone-900 tabular-nums"><span className="font-semibold text-stone-950">{t.paxTotal}</span> <span className="text-[13px] text-stone-600">({t.paxFaiz} Faiz · {t.paxHotel} hotel)</span></dd>
              </div>
            </dl>
          </div>

          <div>
            <h3 className={`${subhead} mb-2`}>Subvenue details</h3>
            {multi ? (
              <p className="text-sm text-stone-800"><Stays segments={p.segments} /> <span className="text-[13px] text-stone-600">(a repeated city visit; change it in NKERP)</span></p>
            ) : (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-x-2.5 gap-y-3">
                {([['karbalaArrival', 'Karbala arrival'], ['karbalaDeparture', 'Karbala departure'], ['najafArrival', 'Najaf arrival'], ['najafDeparture', 'Najaf departure']] as [keyof SubvenueDates, string][]).map(([key, label]) => (
                  <label key={key} className="block min-w-0">
                    <span className={fieldLabel}>{label}</span>
                    <input type="date" value={fields[key]} min={tripStart(t)} max={tripEnd(t)} disabled={p.recommendation === 'done'}
                      onChange={e => set(key, e.target.value)}
                      className={`${field} !px-2.5 tabular-nums`} />
                  </label>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-stone-600 tabular-nums">
              <span><span className="font-semibold text-stone-800">{SOURCE_LABEL[unsaved ? 'edited' : p.source]}</span>{unsaved && <span className="text-amber-800"> (not saved yet)</span>}</span>
              {p.segments.length > 0 && <span>Karbala {nights.KARBALA} night{nights.KARBALA === 1 ? '' : 's'} · Najaf {nights.NAJAF} night{nights.NAJAF === 1 ? '' : 's'}</span>}
              {p.segments.length > 0 && <span>Faiz: {t.paxFaiz} pax · Hotel: {t.paxHotel} pax in each stay</span>}
            </div>
            {p.recommendation !== 'done' && (unsaved || saved || p.alternative) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {unsaved && <button type="button" className={btn.secondary} disabled={busy || segmentProblems(p.segments, tripStart(t), tripEnd(t)).length > 0} onClick={() => onSave(draft!)}><Save className="w-4 h-4 text-brand-700" />Save dates</button>}
                {(unsaved || saved) && <button type="button" className={btn.secondary} disabled={busy} onClick={() => { onDraft(undefined); if (saved) void onSave(null); }}><RotateCcw className="w-4 h-4" />Back to AI suggestion</button>}
                {p.alternative && <button type="button" className={btn.secondary} disabled={busy} onClick={() => onDraft(p.alternative!.segments)}>
                  <Repeat2 className="w-4 h-4" />Try {CITY_NAME[p.alternative.segments[0].city]} first</button>}
              </div>
            )}
          </div>

          {(p.problems.length > 0 || p.notes.length > 0) && (
            <div className="space-y-1.5 text-sm leading-relaxed">
              {p.problems.map((x, i) => <p key={'p' + i} className="flex gap-2 text-rose-700"><AlertTriangle className="w-4 h-4 mt-1 shrink-0" />{x}</p>)}
              {p.notes.map((x, i) => <p key={'n' + i} className="flex gap-2 text-stone-600"><Info className="w-4 h-4 mt-1 shrink-0 text-stone-400" />{x}</p>)}
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
              <h3 className={subhead}>Capacity before → after (Faiz pax)</h3>
              {p.impact.length > 0 && (overDays
                ? <span className={chip('bad')}>Over the limit on {overDays} {overDays === 1 ? 'day' : 'days'}</span>
                : <span className={chip('ok')}>Within the limits</span>)}
            </div>
            <ImpactTable plan={p} />
            <p className="mt-2 text-xs leading-relaxed text-stone-500 max-w-[80ch]"><span className="font-semibold text-stone-600">Now</span>: approved in NKERP today. <span className="font-semibold text-stone-600">Expected</span>: now + tours waiting for approval + tours that haven't finished submitting. Before → after is the expected count without and with this tour.</p>
            {p.alternative && (
              <p className="mt-2 text-[13px] text-stone-600">Other order ({fmtSegments(p.alternative.segments)}): <span className={p.alternative.fits ? 'font-semibold text-emerald-800' : 'font-semibold text-rose-700'}>{p.alternative.fits ? 'fits' : 'does not fit'}</span>{p.alternative.over.length ? ` · over on ${p.alternative.over.map(o => `${fmtDay(o.date)} ${CITY_NAME[o.city]}`).join(', ')}` : ''}.</p>
            )}
          </div>

          <dl className="text-[13px] leading-relaxed text-stone-600 space-y-1">
            <div><dt className="inline font-semibold text-stone-800">Submission: </dt><dd className="inline">{t.dustbin ? <span className="text-amber-800"><Trash2 className="inline w-3.5 h-3.5 -mt-0.5" /> Dustbin sign visible: something is still pending</span> : 'Complete (no dustbin sign)'} · {p.submission.daysToArrival} days to arrival · cut-off {p.submission.cutoffDays} days</dd></div>
            <div><dt className="inline font-semibold text-stone-800">Accommodation in Faiz: </dt><dd className="inline">{t.optionLabel || t.option} · {t.entryPort || '—'} → {t.exitPort || '—'}{t.mawaid ? ' · Mawaid' : ''}</dd></div>
          </dl>
        </div>

        {/* Right: re-approval, chat, message to the Tour Operator */}
        <div className="space-y-6 min-w-0">
          {t.reapproval && (
            <div className="rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-amber-900 flex flex-wrap items-center gap-2">Re-approval required {status && <span className={chip(REAPPROVAL_TONE[status])}>{status}</span>}</h3>
                {status !== 'Approved' && (
                  <button type="button" className={`${btnSm.secondary} max-md:h-10 max-md:px-3.5`} disabled={busy} onClick={() => onReview(status !== 'Reviewed')}>
                    <BadgeCheck className="w-4 h-4" />{status === 'Reviewed' ? 'Undo reviewed' : 'Mark reviewed'}
                  </button>
                )}
              </div>
              <dl className="mt-3 space-y-2 text-[13px] leading-relaxed">
                <div>
                  <dt className="text-xs text-amber-900/80">Previously approved</dt>
                  <dd className="text-stone-900">{fmtSegments(p.original?.segments ?? [])}{p.original?.paxFaiz !== undefined ? ` · ${p.original.paxFaiz} Faiz pax` : ''}{p.original?.paxHotel !== undefined ? ` · ${p.original.paxHotel} hotel pax` : ''}
                    <span className="text-stone-600"> ({p.originalSource === 'app' ? 'app history' : 'from NKERP'})</span></dd>
                </div>
                <div>
                  <dt className="text-xs text-amber-900/80">Latest request</dt>
                  <dd className="text-stone-900">{fmtSegments(p.segments)} · {t.paxFaiz} Faiz · {t.paxHotel} hotel · {fmtDay(tripStart(t))}–{fmtDay(tripEnd(t))}</dd>
                </div>
              </dl>
              {p.changes.length ? (
                <ul className="mt-3 pt-3 border-t border-amber-200 space-y-1.5">
                  {p.changes.map((c, i) => (
                    <li key={i} className="text-[13px] leading-snug flex flex-wrap gap-x-1.5 gap-y-0.5 items-baseline">
                      <span className="font-semibold text-amber-900">{c.category}</span>
                      <span className="text-stone-600">{c.field}:</span>
                      {c.before && <span className="line-through text-stone-500">{c.before}</span>}
                      {c.before && <ArrowRight className="w-3 h-3 self-center text-stone-500" />}
                      <span className="font-semibold text-stone-950">{c.after}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-[13px] text-stone-700">No change found against the previous approval.</p>}
            </div>
          )}

          <div>
            <h3 className={`${subhead} mb-2 flex flex-wrap items-center gap-2`}>
              <MessageSquare className="w-4 h-4 text-stone-500" />Chat box {t.unread && <span className={chip('info')}>Unread in NKERP</span>}
            </h3>
            {t.messages.length ? (
              <ol className="max-h-72 overflow-y-auto rounded-lg bg-white ring-1 ring-inset ring-stone-200 divide-y divide-stone-200">
                {t.messages.map((m, i) => {
                  const hit = m.text.split(/\r?\n/).some(l => evidence.has(l.trim())) || evidence.has(m.text.trim());
                  return (
                    <li key={i} className={`px-3.5 py-2.5 ${hit ? 'bg-emerald-50' : ''}`}>
                      <span className="block text-xs text-stone-500 tabular-nums">{when(m.at)} · {m.sender || (m.fromOperator ? 'Tour Operator' : 'NKERP')}</span>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-stone-900 whitespace-pre-wrap break-words">{m.text}</p>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="text-[13px] text-stone-600">No messages.</p>}
            <p className="mt-1.5 text-xs text-stone-500">Read only: the planner never marks messages read or replies.</p>
          </div>

          {needsFollowUp(p) && <WhatsAppBox title="WhatsApp message to the Tour Operator" message={followUpMessage(p)} note="Copy it into the Tour Operator's WhatsApp chat. Nothing is sent from the app." />}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[13px] leading-relaxed text-stone-600">
          {sentState ? <>Last approval: <span className="font-semibold text-stone-900">{sentState.state === 'api_reported_approved' ? 'accepted by NKERP' : sentState.state === 'api_rejected' ? 'refused by NKERP' : sentState.state === 'attempting' ? 'sending' : 'result unknown (not resent)'}</span> {ago(sentState.at)}{sentState.message ? ` · ${sentState.message}` : ''}</> : 'Not approved from the planner yet.'}
        </div>
        <button type="button" className={`${btn.primary} shrink-0`} onClick={onApprove}
          disabled={busy || blocked || !p.segments.length || unsaved || p.recommendation === 'done' || p.category === 'pending-submission'}
          title={unsaved ? 'Save the dates first' : blocked ? 'Resolve the problems first' : p.category === 'pending-submission' ? 'The submission is not complete' : ''}>
          <Send className="w-4 h-4" />Approve in NKERP
        </button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ lists

const Caret: React.FC<{ open: boolean; label: string }> = ({ open, label }) => (
  <button type="button" className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500 cursor-pointer" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} ${label}`}>
    {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
  </button>
);
const check = 'w-4 h-4 accent-brand-700 cursor-pointer';

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
  const narrow = useNarrow();
  if (!plans.length) return <p className="px-4 sm:px-5 py-8 text-sm text-stone-600">{empty}</p>;
  const ids = plans.map(p => p.tour.id);
  const all = selectable && ids.every(id => selected?.has(id));
  if (narrow) {
    return (
      <div>
        {selectable && (
          <label className="flex items-center gap-3 px-4 min-h-11 border-b border-stone-200 bg-stone-50 text-[13px] font-medium text-stone-700 cursor-pointer">
            <input type="checkbox" className={check} checked={Boolean(all)} onChange={e => onToggleAll?.(ids, e.target.checked)} />Select all
          </label>
        )}
        <ul className="divide-y divide-stone-200">
          {plans.map(p => {
            const t = p.tour;
            const open = expanded === t.id;
            return (
              <li key={t.id}>
                <div className={`flex items-start gap-1 pl-2 pr-4 py-2.5 ${open ? 'bg-stone-50' : ''}`}>
                  {selectable && (
                    <label className="flex h-10 w-9 shrink-0 items-center justify-center cursor-pointer">
                      <input type="checkbox" className={check} aria-label={`Select ${t.ref}`} checked={selected?.has(t.id) ?? false} onChange={() => onToggle?.(t.id)} />
                    </label>
                  )}
                  <button type="button" className={`flex-1 min-w-0 text-left cursor-pointer rounded-lg py-1 ${selectable ? '' : 'pl-2'}`} aria-expanded={open} onClick={() => onExpand(open ? null : t.id)}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="text-[15px] font-semibold text-stone-950 tabular-nums">{tourLabel(t.ref)}</span>
                        <TourMarks plan={p} />
                      </span>
                      <span className="inline-flex items-center gap-1.5 shrink-0">
                        <RecChip plan={p} />
                        {open ? <ChevronDown className="w-4 h-4 text-stone-500" /> : <ChevronRight className="w-4 h-4 text-stone-500" />}
                      </span>
                    </span>
                    <span className="block mt-0.5 text-sm text-stone-700">{t.office || '—'}</span>
                    <span className="block mt-0.5 text-[13px] text-stone-600 tabular-nums">{fmtDay(tripStart(t))} → {fmtDay(tripEnd(t))} · {t.paxTotal} pax ({t.paxFaiz} Faiz / {t.paxHotel} hotel) · {KIND_LABEL[p.kind]}</span>
                    <span className="block mt-1 text-[13px]"><Stays segments={p.segments} /></span>
                  </button>
                </div>
                {open && renderDetail(p)}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className={thead}>
          <tr>
            {selectable && <th className="pl-4 sm:pl-5 pr-1 py-2.5 w-8"><input type="checkbox" className={`${check} block`} aria-label="Select all" checked={Boolean(all)} onChange={e => onToggleAll?.(ids, e.target.checked)} /></th>}
            <th className="w-10" />
            <th className={`${th} !pl-1`}>Tour ID</th>
            <th className={th}>Office</th>
            <th className={th}>Arrival → Departure</th>
            <th className={thR}>Pax <span className="font-normal text-stone-500">(Faiz / hotel)</span></th>
            <th className={th}>City stays</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {plans.map(p => {
            const t = p.tour;
            const open = expanded === t.id;
            return (
              <React.Fragment key={t.id}>
                <tr className={`border-t border-stone-200 hover:bg-stone-50 cursor-pointer ${open ? 'bg-stone-50' : ''}`} onClick={() => onExpand(open ? null : t.id)}>
                  {selectable && <td className="pl-4 sm:pl-5 pr-1 py-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className={`${check} block`} aria-label={`Select ${t.ref}`} checked={selected?.has(t.id) ?? false} onChange={() => onToggle?.(t.id)} /></td>}
                  <td className="pl-2"><Caret open={open} label={t.ref} /></td>
                  <td className="pl-1 pr-3 py-3 whitespace-nowrap">
                    <span className="font-semibold text-stone-950 tabular-nums">{tourLabel(t.ref)}</span>
                    <TourMarks plan={p} />
                  </td>
                  <td className="px-3 py-3 max-w-[220px] truncate text-stone-800" title={t.office}>{t.office || '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-stone-700 tabular-nums">{fmtDay(tripStart(t))} → {fmtDay(tripEnd(t))}</td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap text-stone-900">{t.paxTotal} <span className="text-stone-500 text-[13px]">({t.paxFaiz} / {t.paxHotel})</span></td>
                  <td className="px-3 py-3 text-[13px]"><span className="block text-xs text-stone-500">{KIND_LABEL[p.kind]}</span><Stays segments={p.segments} /></td>
                  <td className="px-3 py-3"><RecChip plan={p} /></td>
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

/** Re-approvals: what was approved before, what changed, and where the review stands. */
const ReapprovalTable: React.FC<{
  plans: TourPlan[];
  expanded: number | null;
  onExpand: (id: number | null) => void;
  renderDetail: (p: TourPlan) => React.ReactNode;
}> = ({ plans, expanded, onExpand, renderDetail }) => {
  const narrow = useNarrow();
  if (!plans.length) return <p className="px-4 sm:px-5 py-8 text-sm text-stone-600">No Tour ID has come for re-approval. Tours submitted again after an approval appear here with what changed.</p>;
  const changed = (p: TourPlan) => [...new Set(p.changes.map(x => x.category))];
  if (narrow) {
    return (
      <ul className="divide-y divide-stone-200">
        {plans.map(p => {
          const open = expanded === p.tour.id;
          const st = reapprovalStatus(p);
          return (
            <li key={p.tour.id}>
              <button type="button" className={`w-full text-left px-4 py-3 cursor-pointer ${open ? 'bg-stone-50' : ''}`} aria-expanded={open} onClick={() => onExpand(open ? null : p.tour.id)}>
                <span className="flex items-start justify-between gap-2">
                  <span className="text-[15px] font-semibold text-stone-950 tabular-nums">{tourLabel(p.tour.ref)}</span>
                  <span className="inline-flex items-center gap-1.5 shrink-0">
                    <span className={chip(REAPPROVAL_TONE[st])}>{st}</span>
                    {open ? <ChevronDown className="w-4 h-4 text-stone-500" /> : <ChevronRight className="w-4 h-4 text-stone-500" />}
                  </span>
                </span>
                <span className="block mt-0.5 text-sm text-stone-700">{p.tour.office}</span>
                <span className="block mt-1 text-[13px] text-stone-600"><span className="text-stone-500">Was: </span>{fmtSegments(p.original?.segments ?? [])}{p.original?.paxFaiz !== undefined ? ` · ${p.original.paxFaiz} Faiz` : ''}</span>
                <span className="block mt-0.5 text-[13px] text-stone-800"><span className="text-stone-500">Changed: </span>{changed(p).join(' · ') || 'No change found'}</span>
                <span className="block mt-0.5 text-[13px] text-stone-600">{REC_STYLE[p.recommendation].label}</span>
              </button>
              {open && renderDetail(p)}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className={thead}><tr>
          <th className="w-12" />
          <th className={`${th} !pl-1`}>Tour ID</th><th className={th}>Office</th>
          <th className={th}>Original approval</th><th className={th}>Latest requested changes</th>
          <th className={th}>Re-approval status</th>
        </tr></thead>
        <tbody>
          {plans.map(p => {
            const open = expanded === p.tour.id;
            const st = reapprovalStatus(p);
            return (
              <React.Fragment key={p.tour.id}>
                <tr className={`border-t border-stone-200 align-top hover:bg-stone-50 cursor-pointer ${open ? 'bg-stone-50' : ''}`} onClick={() => onExpand(open ? null : p.tour.id)}>
                  <td className="pl-3 sm:pl-4 py-1.5"><Caret open={open} label={p.tour.ref} /></td>
                  <td className="pl-1 pr-3 py-3 font-semibold text-stone-950 tabular-nums whitespace-nowrap">{tourLabel(p.tour.ref)}</td>
                  <td className="px-3 py-3 text-stone-800">{p.tour.office}</td>
                  <td className="px-3 py-3 text-[13px] text-stone-700"><Stays segments={p.original?.segments ?? []} />{p.original?.paxFaiz !== undefined ? <span className="block text-stone-600 tabular-nums">{p.original.paxFaiz} Faiz</span> : null}</td>
                  <td className="px-3 py-3 text-[13px] text-stone-800">{changed(p).join(' · ') || <span className="text-stone-500">No change found</span>}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={chip(REAPPROVAL_TONE[st])}>{st}</span>
                    <span className="ml-2 text-[13px] text-stone-600">{REC_STYLE[p.recommendation].label}</span>
                  </td>
                </tr>
                {open && <tr><td colSpan={6} className="p-0">{renderDetail(p)}</td></tr>}
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
    ['Maximum capacity', r => r?.limit],
    ['Present: approved pax (as in NKERP now)', r => r?.present],
    ['Pending approval pax', r => r?.pendingApproval],
    ['Estimated pending submission pax (buffer)', r => r?.buffer],
    ['Expected total (approved + pending + buffer)', r => r && <span className="font-semibold text-stone-950">{r.expected}</span>],
    ['Available capacity (limit − expected)', r => r && <span className={`font-semibold ${r.available < 0 ? 'text-rose-700' : nearLimit(r.available, r.limit) ? 'text-amber-800' : 'text-emerald-800'}`}>{r.available}</span>],
    ['Recommended additional allocation', r => r?.recommended],
    ['Hotel pax approved (not Faiz)', r => r?.hotelApproved],
    ['Hotel pax pending approval', r => r?.hotelPending],
  ];
  return (
    <div className="space-y-6">
      <Card title="Daily capacity overview" right={
        <label className="inline-flex items-center gap-2 text-[13px] text-stone-600">Day
          <select value={date} onChange={e => setDate(e.target.value)} className={`${fieldSm} max-md:h-10 tabular-nums`}>
            {plan.days.map(d => <option key={d} value={d}>{fmtDay(d, true)}</option>)}
          </select>
        </label>}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={thead}><tr>
              <th className={`${th} !px-4 sm:!px-5`}>Details</th><th className={`${thR} w-28`}>Najaf</th><th className={`${thR} w-28 !pr-4 sm:!pr-5`}>Karbala</th>
            </tr></thead>
            <tbody>{lines.map(([label, f]) => (
              <tr key={label} className="border-t border-stone-200"><td className="px-4 sm:px-5 py-2.5 text-stone-700">{label}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-stone-900">{f(n) ?? '—'}</td><td className="pl-3 pr-4 sm:pr-5 py-2.5 text-right tabular-nums text-stone-900">{f(k) ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="px-4 sm:px-5 py-3 text-xs leading-relaxed text-stone-500 border-t border-stone-200"><span className="block max-w-[110ch]">Present is NKERP's own approved count. In the expected total, tours being re-approved are counted once, with their new plan. Pending approval is this plan's Faiz pax. The buffer keeps {plan.settings.bufferPercent}% of unsubmitted tours' Faiz pax free. Transfer days count in both cities.</span></p>
      </Card>

      <Card title="Shift opportunities (whole Tour IDs only)">
        {plan.shifts.length ? (
          <ul className="divide-y divide-stone-200">
            {plan.shifts.map((s, i) => (
              <li key={i} className="px-4 sm:px-5 py-3.5">
                <p className="text-sm font-medium text-stone-950">{s.benefit}</p>
                <p className="text-[13px] leading-relaxed text-stone-700 mt-1"><span className="font-semibold tabular-nums">{s.move.tour.ref}</span>: {fmtSegments(s.from)} → <span className="font-semibold text-stone-950">{fmtSegments(s.to)}</span> · <span className="font-semibold tabular-nums">{s.admits.tour.ref}</span>: {fmtSegments(s.admitsWith)}</p>
                <p className="text-[13px] text-stone-600 mt-0.5 tabular-nums">Expected: {s.impact.map(x => `${fmtDay(x.date)} ${CITY_NAME[x.city]} ${x.before}→${x.after}`).join(' · ')}</p>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 sm:px-5 py-6 text-sm text-stone-600">No whole-tour shift would let a held tour fit right now. Flexible tours are already placed in the order that fits best.</p>}
      </Card>

      <Card title="Day by day (Faiz pax)" right={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600">
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-200 ring-1 ring-rose-300" />Over the limit</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-200 ring-1 ring-amber-300" />Under 10% free</span>
        </span>}>
        <div className="overflow-x-auto max-h-[520px]">
          <table className="min-w-full text-[13px]">
            <thead className={`${thead} sticky top-0`}>
              <tr>
                <th rowSpan={2} className={`${th} !px-4 sm:!px-5 align-bottom`}>Date</th>
                {(['NAJAF', 'KARBALA'] as City[]).map(c => <th key={c} colSpan={5} className="text-center font-semibold px-3 pt-2.5 pb-1 border-l border-stone-200 text-stone-800 tabular-nums">{CITY_NAME[c]} <span className="font-normal text-stone-500">limit {plan.settings.limits[c]}</span></th>)}
              </tr>
              <tr>
                {(['NAJAF', 'KARBALA'] as City[]).flatMap(c => ['Present', 'Pending', 'Buffer', 'Expected', 'Available'].map((h, i) => <th key={c + h} className={`text-right font-medium px-3 pb-2 ${i === 0 ? 'border-l border-stone-200' : ''}`}>{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {plan.days.map(d => (
                <tr key={d} className="border-t border-stone-200 hover:bg-stone-50">
                  <td className="px-4 sm:px-5 py-2 whitespace-nowrap text-stone-800 tabular-nums">{fmtDay(d)}</td>
                  {(['NAJAF', 'KARBALA'] as City[]).flatMap(c => {
                    const r = plan.capacity.find(x => x.date === d && x.city === c);
                    return [r?.present, r?.pendingApproval, r?.buffer, r?.expected, r?.available].map((v, i) => (
                      <td key={c + i} className={`px-3 py-2 text-right tabular-nums ${i === 0 ? 'border-l border-stone-200' : ''} ${i === 3 ? 'font-semibold text-stone-950' : i === 4 ? freeTone(r?.available, r?.limit) : 'text-stone-700'}`}>{v ?? '—'}</td>
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
        <ul className="max-h-52 overflow-y-auto rounded-lg bg-stone-50 ring-1 ring-inset ring-stone-200 divide-y divide-stone-200 text-[13px] leading-relaxed">
          {items.map(p => <li key={p.tour.id} className="px-3.5 py-2"><span className="font-semibold text-stone-950 tabular-nums">{p.tour.ref}</span> · {p.tour.office} · {p.tour.paxFaiz} Faiz / {p.tour.paxHotel} hotel<br />{fmtSegments(p.segments)}{p.tour.reapproval ? ' · re-approval' : ''}</li>)}
        </ul>
        <p className="text-[13px] text-stone-600 tabular-nums">{faiz} Faiz pax in total.</p>
        {over.length > 0 && <p className="flex gap-2 text-rose-700"><AlertTriangle className="w-4 h-4 mt-1 shrink-0" />{over.length} of these go over a city limit: {over.map(p => p.tour.ref).join(', ')}. Approving them is your exception.</p>}
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
      <div className="py-16 text-center text-sm text-stone-600">
        {error ? <p role="alert" className="text-rose-700">{error}</p> : <><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading approvals…</>}
      </div>
    );
  }
  const c = plan.counts;
  const s = settingsDraft ?? state.settings;
  const reasons = CHANGE_CATEGORIES.map(cat => ({ cat, n: lists.reapproval.filter(p => p.changes.some(x => x.category === cat)).length })).filter(x => x.n);
  const selectedPlans = lists.proposal.filter(p => selected.has(p.tour.id));
  const tiles: { label: string; value: number; tone: string; go: Section; hint: string }[] = [
    { label: 'New approvals', value: c.newApprovals, tone: 'text-stone-950', go: 'all', hint: 'Awaiting first approval' },
    { label: 'Re-approval pending', value: c.reapprovalPending, tone: c.reapprovalPending ? 'text-amber-700' : 'text-stone-950', go: 'reapproval', hint: 'Submitted again' },
    { label: 'Re-approval reviewed', value: c.reapprovalReviewed, tone: 'text-stone-950', go: 'reapproval', hint: 'Changes checked' },
    { label: 'Re-approved', value: c.reApproved, tone: 'text-stone-950', go: 'reapproval', hint: 'From this planner' },
    { label: 'Ready to approve', value: c.ready, tone: c.ready ? 'text-emerald-700' : 'text-stone-950', go: 'proposal', hint: 'Submitted, fits capacity' },
    { label: 'Follow up now', value: c.followUp, tone: c.followUp ? 'text-rose-700' : 'text-stone-950', go: 'pending', hint: `Dustbin sign inside ${s.cutoffDays} days` },
  ];
  const sectionLabel = (id: Section) => SECTIONS.find(x => x.id === id)?.label ?? '';
  const searchBox = (
    <label className="relative block w-full md:w-60">
      <span className="sr-only">Search by Tour ID or office</span>
      <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tour ID or office" className={`${field} pl-9`} />
    </label>
  );
  const numField = `${fieldSm} max-md:h-10 w-[4.5rem] tabular-nums`;
  const unit = 'text-[13px] text-stone-600';

  return (
    <div className="space-y-6">
      <PageHeader title="Tour approvals"
        description="Nizam approvals for Najaf and Karbala from NKERP's Tour Admin queues: exact chat dates, whole-tour capacity planning, re-approval checks and the submission cut-off."
        meta={<p className="text-[13px] text-stone-600 tabular-nums">Read from NKERP {ago(state.snapshot.collectedAt)}{state.snapshot.window ? ` · arrivals ${fmtDay(state.snapshot.window.from)}–${fmtDay(state.snapshot.window.to, true)} plus every re-approval` : ''}{state.snapshot.errors.length ? ` · ${state.snapshot.errors.length} read problem${state.snapshot.errors.length === 1 ? '' : 's'}` : ''}</p>}
        actions={<button type="button" className={btn.secondary} onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{refreshing ? 'Reading NKERP…' : 'Refresh from NKERP'}</button>} />

      {error && (
        <div role="alert" className="rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 pl-4 pr-2 py-2 text-sm text-rose-700 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="min-w-0 flex-1 py-1 break-words">{error}</span>
          <button type="button" className="shrink-0 w-9 h-9 max-md:w-10 max-md:h-10 rounded-lg flex items-center justify-center hover:bg-rose-100 cursor-pointer" onClick={() => setError(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {lists.reapproval.length > 0 && (
        <button type="button" onClick={() => setSection('reapproval')} className="group w-full text-left rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 hover:bg-amber-100/70 transition cursor-pointer flex items-center gap-3">
          <Repeat2 className="w-4 h-4 shrink-0 text-amber-700" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-amber-900 tabular-nums">{lists.reapproval.length} Tour ID{lists.reapproval.length === 1 ? ' has' : 's have'} come for re-approval ({c.reapprovalPending} pending, {c.reapprovalReviewed} reviewed)</span>
            {reasons.length > 0 && <span className="block text-[13px] text-amber-800 mt-0.5 tabular-nums">{reasons.map(r => `${r.cat}: ${r.n}`).join(' · ')}</span>}
          </span>
          <span className="shrink-0 inline-flex items-center gap-1 text-[13px] font-medium text-amber-900"><span className="max-sm:hidden">Review</span><ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /></span>
        </button>
      )}

      <section className={`${card} overflow-hidden`} aria-label="Approval counts">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-px bg-stone-200">
          {tiles.map(t => (
            <button key={t.label} type="button" onClick={() => setSection(t.go)} title={`Open ${sectionLabel(t.go)}`}
              className="group relative text-left bg-white px-4 py-3.5 hover:bg-stone-50 transition cursor-pointer">
              <ChevronRight className="absolute top-3.5 right-3 w-4 h-4 text-stone-300 transition group-hover:text-stone-600 group-hover:translate-x-0.5" />
              <span className={`block type-display text-[28px] leading-none tabular-nums ${t.tone}`}>{t.value}</span>
              <span className="block mt-2 text-[13px] font-medium text-stone-900">{t.label}</span>
              <span className="block text-xs text-stone-500">{t.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Planning settings: rarely changed, so the row stays quieter than the tabs and tables. */}
      <section className="rounded-xl bg-stone-50 ring-1 ring-inset ring-stone-200 px-4 sm:px-5 py-3.5" aria-label="Planning settings">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3.5">
          <div>
            <span className={fieldLabel}>Submission cut-off</span>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg bg-stone-200/70 p-0.5" role="group" aria-label="Cut-off presets">
                {[15, 30].map(d => <button key={d} type="button" aria-pressed={s.cutoffDays === d} onClick={() => void saveSettings({ ...s, cutoffDays: d })}
                  className={`h-8 max-md:h-10 px-3 rounded-md text-[13px] font-medium tabular-nums cursor-pointer transition ${s.cutoffDays === d ? 'bg-white text-stone-950 ring-1 ring-stone-300' : 'text-stone-600 hover:text-stone-950'}`}>{d} days</button>)}
              </div>
              <input type="number" min={1} max={120} value={s.cutoffDays} aria-label="Cut-off days"
                onChange={e => setSettingsDraft({ ...s, cutoffDays: Number(e.target.value) || s.cutoffDays })} onBlur={() => void saveSettings(s)}
                className={numField} />
              <span className={unit}>days</span>
            </div>
          </div>
          {(['NAJAF', 'KARBALA'] as City[]).map(city => (
            <label key={city} className="block"><span className={fieldLabel}>{CITY_NAME[city]} limit</span>
              <span className="flex items-center gap-2">
                <input type="number" min={1} value={s.limits[city]} onChange={e => setSettingsDraft({ ...s, limits: { ...s.limits, [city]: Number(e.target.value) || s.limits[city] } })}
                  onBlur={() => void saveSettings(s)} className={numField} />
                <span className={unit}>pax</span>
              </span>
            </label>
          ))}
          <label className="block"><span className={fieldLabel}>Buffer for unsubmitted tours</span>
            <span className="flex items-center gap-2"><input type="number" min={0} max={200} value={s.bufferPercent} onChange={e => setSettingsDraft({ ...s, bufferPercent: Number(e.target.value) })}
              onBlur={() => void saveSettings(s)} className={numField} /><span className={unit}>%</span></span></label>
          <label className="block"><span className={fieldLabel}>Plan arrivals ahead</span>
            <span className="flex items-center gap-2"><input type="number" min={7} max={120} value={s.horizonDays} onChange={e => setSettingsDraft({ ...s, horizonDays: Number(e.target.value) || s.horizonDays })}
              onBlur={() => void saveSettings(s)} className={numField} /><span className={unit}>days</span></span></label>
        </div>
      </section>

      {/* Tabs */}
      <div className="border-b border-stone-300 overflow-x-auto overflow-y-hidden" role="tablist" aria-label="Approval lists">
        <div className="flex min-w-max gap-1 xl:max-[1439px]:gap-0">
          {SECTIONS.map(x => {
            const n = x.id === 'proposal' ? lists.proposal.length : x.id === 'reapproval' ? lists.reapproval.length : x.id === 'awaiting' ? lists.awaiting.length : x.id === 'pending' ? lists.pending.length : x.id === 'all' ? lists.all.length : null;
            const on = section === x.id;
            return (
              <button key={x.id} type="button" role="tab" aria-selected={on} onClick={() => setSection(x.id)}
                className={`relative h-11 px-2.5 xl:max-[1439px]:px-2 text-sm whitespace-nowrap cursor-pointer transition inline-flex items-center gap-1.5 border-b-2 -mb-px ${on ? 'border-brand-700 text-stone-950 font-semibold' : 'border-transparent text-stone-600 font-medium hover:text-stone-950 hover:border-stone-300'}`}>
                {x.label}
                {n !== null && <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-medium leading-5 text-center tabular-nums ${on ? 'bg-brand-50 text-brand-800' : 'bg-stone-200/70 text-stone-600'}`}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {batch && (
        <div role="status" className={`${card} px-4 sm:px-5 py-4 text-sm`}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-stone-950 tabular-nums">{batch.done < batch.total ? <><Loader2 className="inline w-4 h-4 animate-spin mr-1.5" />Sending {batch.done + 1} of {batch.total}…</> : `Sent ${batch.total}: ${batch.results.filter(r => r.state === 'api_reported_approved').length} accepted, ${batch.results.filter(r => r.state === 'api_rejected' || r.state === 'not sent').length} refused, ${batch.results.filter(r => r.state === 'uncertain_no_retry').length} unknown`}</p>
            {batch.done === batch.total && <button type="button" className={`${modalClose} !mr-0`} onClick={() => setBatch(null)} aria-label="Close"><X className="w-4 h-4" /></button>}
          </div>
          <ul className="mt-2 max-h-40 overflow-y-auto text-[13px] leading-relaxed space-y-1">
            {batch.results.map((r, i) => <li key={i} className={`flex items-start gap-1.5 ${r.state === 'api_reported_approved' ? 'text-emerald-800' : r.state === 'uncertain_no_retry' ? 'text-amber-800' : 'text-rose-700'}`}>
              {r.state === 'api_reported_approved' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}<span><span className="font-semibold tabular-nums">{r.ref}</span>: {r.state === 'api_reported_approved' ? 'accepted' : r.state === 'uncertain_no_retry' ? 'no answer (check NKERP; not resent)' : r.message || r.state}</span></li>)}
          </ul>
        </div>
      )}

      {section === 'proposal' && (
        <Card title={`Proposal · ${lists.proposal.length} Tour IDs ready (${lists.proposal.reduce((n, p) => n + p.tour.paxFaiz, 0)} Faiz pax)`}
          right={<>{searchBox}<button type="button" className={`${btn.primary} max-md:w-full`} disabled={busy || !selectedPlans.length} onClick={() => askApprove(selectedPlans)}>
            <Send className="w-4 h-4" />Approve selected ({selectedPlans.length})</button></>}>
          <CardNote>Submitted (no dustbin), city stays resolved, and within the limits after keeping the buffer. Order: re-approvals, then Faiz Husaini offices, then the rest, by arrival. Open a Tour ID to check its chat and dates before approving.</CardNote>
          <TourTable plans={filter(lists.proposal)} selectable selected={selected} expanded={expanded} onExpand={setExpanded} renderDetail={detail}
            onToggle={id => setSelected(sel => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onToggleAll={(ids, on) => setSelected(sel => { const n = new Set(sel); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; })}
            empty={q ? 'No Tour ID or office matches the search.' : 'Nothing is ready to approve right now. Tour IDs appear here once they are submitted and fit the limits.'} />
        </Card>
      )}

      {section === 'reapproval' && (
        <Card title={`Re-approval dashboard · ${lists.reapproval.length}`} right={searchBox}>
          <ReapprovalTable plans={filter(lists.reapproval)} expanded={expanded} onExpand={setExpanded} renderDetail={detail} />
        </Card>
      )}

      {section === 'awaiting' && (
        <Card title={`Submitted, awaiting approval · ${lists.awaiting.length}`} right={searchBox}>
          <CardNote>Complete submissions held back: over capacity, missing chat dates, or something to resolve. The reason shows on each row.</CardNote>
          <TourTable plans={filter(lists.awaiting)} expanded={expanded} onExpand={setExpanded} renderDetail={detail} empty={q ? 'No Tour ID or office matches the search.' : 'Nothing is waiting.'} />
        </Card>
      )}

      {section === 'pending' && (
        <Card title={`Pending submission (dustbin sign) · ${lists.pending.length}`}
          right={<>{searchBox}<button type="button" className={`${btn.secondary} max-md:w-full`} onClick={() => setFollowUps(true)}><MessageSquare className="w-4 h-4" />WhatsApp follow-ups ({plan.plans.filter(needsFollowUp).length})</button></>}>
          <CardNote><span className="font-semibold text-stone-800 tabular-nums">Cut-off: {s.cutoffDays} days before arrival.</span> Outside the cut-off: wait for the Tour Operator. Inside it: contact the Tour Operator now and follow up until the dustbin sign disappears. Their Faiz pax are kept free as buffer.</CardNote>
          <TourTable plans={filter(lists.pending)} expanded={expanded} onExpand={setExpanded} renderDetail={detail} empty={q ? 'No Tour ID or office matches the search.' : 'Every Tour ID in the window has completed its submission.'} />
        </Card>
      )}

      {section === 'all' && (
        <Card title={`All Tour IDs · ${lists.all.length}`} right={searchBox}>
          <TourTable plans={filter(lists.all)} expanded={expanded} onExpand={setExpanded} renderDetail={detail} empty={q ? 'No Tour ID or office matches the search.' : 'No Tour IDs in the queues.'} />
        </Card>
      )}

      {section === 'capacity' && <CapacitySection plan={plan} />}

      {section === 'najaf' && (
        <Card title="Najaf-only daily report" right={<span className="text-[13px] text-stone-600">Faiz pax only · arrivals are the proposal's Najaf stays</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className={thead}><tr>
                <th className={`${th} !px-4 sm:!px-5`}>Date</th><th className={thR}>Limit</th>
                <th className={thR}>Present (NKERP)</th><th className={thR}>Expected</th><th className={thR}>Headroom</th>
                <th className={`${th} !pl-6`}>Arriving <span className="font-normal text-stone-500">(Tour ID · Faiz pax · office)</span></th>
              </tr></thead>
              <tbody>
                {najafReport(plan).map(r => (
                  <tr key={r.date} className="border-t border-stone-200 align-top hover:bg-stone-50">
                    <td className="px-4 sm:px-5 py-2.5 whitespace-nowrap text-stone-800 tabular-nums">{fmtDay(r.date, true)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">{r.limit}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-700">{r.present}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-stone-950">{r.expected}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${freeTone(r.headroom, r.limit)}`}>{r.headroom}</td>
                    <td className="pl-6 pr-4 py-2.5 text-[13px] text-stone-700">
                      {r.arrivals.length ? r.arrivals.map(a => (
                        <div key={a.id} className="leading-relaxed"><span className="font-semibold text-stone-950 tabular-nums">{tourLabel(a.ref)}</span> · <span className="tabular-nums">{a.pax}</span> · {a.office}</div>
                      )) : <span className="text-stone-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {section === 'remaining' && (
        <Card title="Remaining tours and suggested resolution" right={<><span className="text-[13px] text-stone-600">From the NKERP read {ago(state.snapshot.collectedAt)}</span>{searchBox}</>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className={thead}><tr>
                <th className={`${th} !px-4 sm:!px-5`}>Tour ID</th><th className={th}>Office</th>
                <th className={thR}>Pax <span className="font-normal text-stone-500">(Faiz)</span></th><th className={th}>Trip</th>
                <th className={th}>Issue</th><th className={th}>Suggested resolution</th>
              </tr></thead>
              <tbody>
                {filter(plan.plans.filter(p => !inProposal(p))).map(p => {
                  const sug = suggestion(p, plan);
                  return (
                    <tr key={p.tour.id} className="border-t border-stone-200 align-top hover:bg-stone-50">
                      <td className="px-4 sm:px-5 py-2.5 font-semibold text-stone-950 tabular-nums whitespace-nowrap text-sm">
                        {tourLabel(p.tour.ref)}{p.tour.reapproval && <span title="Came for re-approval"><Repeat2 className="inline w-3.5 h-3.5 ml-1.5 -mt-0.5 text-amber-700" aria-label="Re-approval" /></span>}
                      </td>
                      <td className="px-3 py-2.5 text-stone-800 min-w-[9rem]">{p.tour.office}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-stone-900">{p.tour.paxTotal} <span className="text-stone-500">({p.tour.paxFaiz})</span></td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-stone-700">{fmtDay(tripStart(p.tour))}–{fmtDay(tripEnd(p.tour))}</td>
                      <td className="px-3 py-2.5 text-stone-700 leading-relaxed min-w-[14rem]">{sug.issue}</td>
                      <td className="px-3 py-2.5 text-stone-950 leading-relaxed min-w-[14rem]">{sug.next}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ul className="flex flex-col gap-x-6 gap-y-1.5 text-xs text-stone-500 lg:flex-row lg:flex-wrap">
        <li className="flex items-start gap-1.5"><Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />The queues refresh every 15 minutes and when you press Refresh.</li>
        <li className="flex items-start gap-1.5"><Hotel className="w-3.5 h-3.5 mt-0.5 shrink-0" />Hotel tours are approved only on the Tour Operator's chat dates.</li>
        <li className="flex items-start gap-1.5"><ClipboardList className="w-3.5 h-3.5 mt-0.5 shrink-0" />Every approval is logged with the Tour ID's history.</li>
      </ul>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      {followUps && <FollowUpsDialog plans={plan.plans} onClose={() => setFollowUps(false)} />}
    </div>
  );
};
