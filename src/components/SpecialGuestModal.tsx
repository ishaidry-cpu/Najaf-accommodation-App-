import React, { useState, useEffect, useMemo } from 'react';
import { Check, Plus, Sparkles, Star, User, Users, X } from 'lucide-react';
import { Reservation } from '../types';
import { btn, btnSm, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle, panel } from './ui';

interface SpecialGuestModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetReservation: Reservation | null;
  allReservations: Reservation[];
  onUpdateReservation: (updatedReservation: Reservation) => void;
  onBatchUpdateReservations?: (updatedReservations: Reservation[]) => void;
  onShowToast?: (message: string) => void;
  initialScope?: SpecialGuestScope;
}

export type SpecialGuestScope = 'guest' | 'family' | 'tour';

export const SpecialGuestModal: React.FC<SpecialGuestModalProps> = ({
  isOpen,
  onClose,
  targetReservation,
  allReservations,
  onUpdateReservation,
  onBatchUpdateReservations,
  onShowToast,
  initialScope = 'guest',
}) => {
  if (!isOpen || !targetReservation) return null;

  const [isStarred, setIsStarred] = useState<boolean>(true);
  const [remarks, setRemarks] = useState<string>('');
  const [scope, setScope] = useState<SpecialGuestScope>(initialScope);

  // Initialize state when targetReservation changes
  useEffect(() => {
    if (targetReservation) {
      setIsStarred(targetReservation.isSpecialGuest ?? true);
      setRemarks(targetReservation.specialRemarks || '');
      setScope(initialScope);
    }
  }, [targetReservation, initialScope]);

  const targetFam = (targetReservation.family || '').trim().toLowerCase();
  const targetTour = (targetReservation.tourRefNo || targetReservation.tourId || '').trim().toLowerCase();

  // Family members matching this guest's Tour + Family
  const familyMembers = useMemo(() => {
    return allReservations.filter((r) => {
      const matchFam = (r.family || '').trim().toLowerCase() === targetFam;
      const matchTour = !targetTour || (r.tourRefNo || r.tourId || '').trim().toLowerCase() === targetTour;
      return matchFam && matchTour;
    });
  }, [allReservations, targetFam, targetTour]);

  // Tour members matching this guest's Tour Reference
  const tourMembers = useMemo(() => {
    return allReservations.filter((r) => {
      return (r.tourRefNo || r.tourId || '').trim().toLowerCase() === targetTour;
    });
  }, [allReservations, targetTour]);

  const handleSave = () => {
    const now = new Date().toISOString();
    const finalRemarks = isStarred ? remarks.trim() : undefined;

    if (scope === 'guest') {
      const updated: Reservation = {
        ...targetReservation,
        isSpecialGuest: isStarred,
        specialRemarks: finalRemarks,
        updatedAt: now,
      };
      onUpdateReservation(updated);
      if (onShowToast) {
        onShowToast(
          isStarred
            ? `⭐ Marked ${targetReservation.applicantName} as Special Guest!`
            : `Removed Special Guest status for ${targetReservation.applicantName}.`
        );
      }
    } else if (scope === 'family') {
      const updatedList = allReservations.map((r) => {
        const famMatch = (r.family || '').trim().toLowerCase() === targetFam;
        const tourMatch = !targetTour || (r.tourRefNo || r.tourId || '').trim().toLowerCase() === targetTour;
        if (famMatch && tourMatch) {
          return {
            ...r,
            isSpecialGuest: isStarred,
            specialRemarks: finalRemarks,
            updatedAt: now,
          };
        }
        return r;
      });

      if (onBatchUpdateReservations) {
        onBatchUpdateReservations(updatedList);
      } else {
        updatedList.forEach((r) => {
          if ((r.family || '').trim().toLowerCase() === targetFam) {
            onUpdateReservation(r);
          }
        });
      }

      if (onShowToast) {
        onShowToast(
          isStarred
            ? `⭐ Marked entire Family "${targetReservation.family}" (${familyMembers.length} members) as Special Guests!`
            : `Removed Special Guest status for Family "${targetReservation.family}".`
        );
      }
    } else if (scope === 'tour') {
      const updatedList = allReservations.map((r) => {
        const tourMatch = (r.tourRefNo || r.tourId || '').trim().toLowerCase() === targetTour;
        if (tourMatch) {
          return {
            ...r,
            isSpecialGuest: isStarred,
            specialRemarks: finalRemarks,
            updatedAt: now,
          };
        }
        return r;
      });

      if (onBatchUpdateReservations) {
        onBatchUpdateReservations(updatedList);
      } else {
        updatedList.forEach((r) => {
          if ((r.tourRefNo || r.tourId || '').trim().toLowerCase() === targetTour) {
            onUpdateReservation(r);
          }
        });
      }

      if (onShowToast) {
        onShowToast(
          isStarred
            ? `⭐ Marked all ${tourMembers.length} zaereen in Tour "${targetReservation.tourRefNo}" as Special Guests!`
            : `Removed Special Guest status for Tour "${targetReservation.tourRefNo}".`
        );
      }
    }

    onClose();
  };

  const scopes: { value: SpecialGuestScope; icon: React.ElementType; label: string; sub: string; title?: string }[] = [
    { value: 'guest', icon: User, label: 'Only this zair', sub: '1 zair', title: targetReservation.applicantName },
    { value: 'family', icon: Users, label: 'Whole family', sub: `Family ${targetReservation.family || '—'} · ${familyMembers.length} ${familyMembers.length > 1 ? 'members' : 'member'}` },
    { value: 'tour', icon: Sparkles, label: 'Whole Tour ID', sub: `All ${tourMembers.length} zaereen`, title: targetReservation.tourRefNo },
  ];

  return (
    <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="special-guest-title">
      <div className={`${modalCard} max-w-lg`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h3 id="special-guest-title" className={modalTitle}>Special guest</h3>
            <p className="mt-1 text-sm text-stone-600">
              Star a zair, the whole family or the whole Tour ID, and note what they need.
            </p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-5 overflow-y-auto">
          {/* Who this was opened for */}
          <div className={`${panel} px-3.5 py-3`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-[15px] font-semibold text-stone-950">{targetReservation.applicantName}</span>
              <span className="text-[13px] text-stone-600 tabular-nums">ITS <span className="font-bold text-stone-900">{targetReservation.itsId}</span></span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-stone-600">
              <span>Family <span className="font-medium text-stone-900">{targetReservation.family || '—'}</span></span>
              <span className="truncate max-w-[220px]">Tour <span className="font-medium text-stone-900">{targetReservation.tourRefNo || '—'}</span></span>
              <span>Room <span className="font-medium text-stone-900">{targetReservation.roomNumber ? `${targetReservation.building} ${targetReservation.roomNumber}` : 'not allotted'}</span></span>
            </div>
          </div>

          {/* Scope: guest / family / Tour ID */}
          <div role="radiogroup" aria-labelledby="special-guest-scope">
            <div id="special-guest-scope" className={fieldLabel}>Apply to</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {scopes.map(({ value, icon: Icon, label, sub, title }) => {
                const on = scope === value;
                return (
                  <button key={value} type="button" role="radio" aria-checked={on} onClick={() => setScope(value)} title={title}
                    className={`min-h-14 rounded-xl px-3 py-2.5 text-left transition cursor-pointer ring-inset ${
                      on ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-1 ring-stone-300 hover:ring-stone-400'}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-stone-950">
                        <Icon className={`w-4 h-4 ${on ? 'text-brand-700' : 'text-stone-500'}`} />
                        {label}
                      </span>
                      {on && <Check className="w-4 h-4 shrink-0 text-brand-700" />}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-stone-600">{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Star on or off */}
          <div className="flex items-center justify-between gap-4 border-t border-stone-200 pt-4">
            <div className="flex items-start gap-2.5 min-w-0">
              <Star className={`w-5 h-5 mt-0.5 shrink-0 ${isStarred ? 'text-gold-500 fill-gold-400' : 'text-stone-400'}`} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-stone-950">
                  {isStarred ? 'Special guest: starred' : 'Special guest: off'}
                </div>
                <div className="text-[13px] leading-relaxed text-stone-600">
                  {scope === 'guest'
                    ? 'Highlights this individual guest in allotment views'
                    : scope === 'family'
                    ? `Highlights all ${familyMembers.length} members of Family "${targetReservation.family}"`
                    : `Highlights all ${tourMembers.length} zaereen across Tour "${targetReservation.tourRefNo}"`}
                </div>
              </div>
            </div>
            <label className="relative inline-flex h-10 items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={isStarred}
                onChange={(e) => setIsStarred(e.target.checked)}
                className="sr-only peer"
                aria-label="Special guest"
              />
              <div className="w-11 h-6 bg-stone-300 rounded-full peer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[10px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:shadow-xs after:transition-all peer-checked:bg-brand-700"></div>
            </label>
          </div>

          {/* Requirements and remarks */}
          {isStarred && (
            <div className="animate-in fade-in duration-150">
              <label htmlFor="special-guest-remarks" className={fieldLabel}>
                Special lodging requirements and remarks
              </label>
              <textarea
                id="special-guest-remarks"
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Ground floor required, elderly wheelchair user, western toilet, double bed..."
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm leading-relaxed text-stone-900 placeholder:text-stone-400"
              />

              <div className="mt-3">
                <div className="mb-1.5 text-[13px] text-stone-600">Quick add a common requirement</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Ground floor only',
                    'Western toilet required',
                    'Wheelchair user / Elderly',
                    'Double bed required',
                    'Near elevator / Lift',
                    'VIP Mumineen',
                    'Quiet room requested',
                    'Adjacent family rooms'
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setRemarks((prev) => (prev ? `${prev}, ${chip}` : chip));
                      }}
                      className={`${btnSm.secondary} max-sm:h-10 max-sm:px-3`}
                    >
                      <Plus className="w-3.5 h-3.5 text-stone-500" />
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={modalFooter}>
          <span className="mr-auto text-[13px] text-stone-600">
            {scope === 'guest'
              ? 'Applies to 1 guest'
              : scope === 'family'
              ? `Applies to ${familyMembers.length} family members`
              : `Applies to ${tourMembers.length} tour zaereen`}
          </span>
          <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
          <button type="button" onClick={handleSave} className={btn.primary}>
            <Check className="w-4 h-4" />
            {isStarred
              ? scope === 'guest'
                ? 'Save for guest'
                : scope === 'family'
                ? `Save for family (${familyMembers.length})`
                : `Save for tour (${tourMembers.length})`
              : 'Remove special status'}
          </button>
        </div>
      </div>
    </div>
  );
};
