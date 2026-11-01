import React, { useState, useEffect, useMemo } from 'react';
import { 
  Star, 
  X, 
  Check, 
  User, 
  Users, 
  Sparkles, 
  Building2, 
  AlertCircle 
} from 'lucide-react';
import { Reservation } from '../types';

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

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#FAF7F2] rounded-2xl border border-[#E6DFD5] shadow-2xl max-w-lg w-full p-5 space-y-4 animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-stone-200">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-700 border border-amber-300">
              <Star className="w-5 h-5 fill-amber-400 text-amber-600" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-sm">
                Special Guest & Requirements Scope
              </h3>
              <p className="text-xs text-stone-500">
                Mark guest, whole family, or entire Tour ID with star badge & remarks
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Guest Reference Card */}
        <div className="p-3 rounded-xl bg-white border border-stone-200 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-stone-900 text-sm">{targetReservation.applicantName}</span>
            <span className="font-mono text-stone-500 font-bold">ITS: {targetReservation.itsId}</span>
          </div>
          <div className="text-stone-500 text-[11px] flex items-center gap-2 flex-wrap">
            <span>Family: <strong>{targetReservation.family || '—'}</strong></span>
            <span>•</span>
            <span className="truncate max-w-[200px]">Tour: <strong>{targetReservation.tourRefNo || '—'}</strong></span>
            <span>•</span>
            <span>Room: {targetReservation.roomNumber ? `${targetReservation.building} ${targetReservation.roomNumber}` : 'Not Allotted'}</span>
          </div>
        </div>

        {/* Scope Selection: Guest / Family / Tour ID */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-stone-800">
            Apply Special Status To:
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            
            {/* 1. Only Guest */}
            <button
              type="button"
              onClick={() => setScope('guest')}
              className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                scope === 'guest'
                  ? 'border-[#124E39] bg-emerald-50 text-[#124E39] shadow-2xs ring-2 ring-[#124E39]'
                  : 'border-stone-200 bg-white hover:border-stone-300 text-stone-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  <span>Only Guest</span>
                </span>
                {scope === 'guest' && <Check className="w-3.5 h-3.5 text-[#124E39]" />}
              </div>
              <div className="text-[10px] text-stone-500 mt-1 truncate" title={targetReservation.applicantName}>
                1 Individual Pax
              </div>
            </button>

            {/* 2. Whole Family */}
            <button
              type="button"
              onClick={() => setScope('family')}
              className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                scope === 'family'
                  ? 'border-[#124E39] bg-emerald-50 text-[#124E39] shadow-2xs ring-2 ring-[#124E39]'
                  : 'border-stone-200 bg-white hover:border-stone-300 text-stone-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  <span>Whole Family</span>
                </span>
                {scope === 'family' && <Check className="w-3.5 h-3.5 text-[#124E39]" />}
              </div>
              <div className="text-[10px] text-stone-500 mt-1">
                Fam {targetReservation.family} ({familyMembers.length} {familyMembers.length > 1 ? 'Members' : 'Member'})
              </div>
            </button>

            {/* 3. Whole Tour ID */}
            <button
              type="button"
              onClick={() => setScope('tour')}
              className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                scope === 'tour'
                  ? 'border-[#124E39] bg-emerald-50 text-[#124E39] shadow-2xs ring-2 ring-[#124E39]'
                  : 'border-stone-200 bg-white hover:border-stone-300 text-stone-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Whole Tour ID</span>
                </span>
                {scope === 'tour' && <Check className="w-3.5 h-3.5 text-[#124E39]" />}
              </div>
              <div className="text-[10px] text-stone-500 mt-1 truncate" title={targetReservation.tourRefNo}>
                All {tourMembers.length} Zaereen
              </div>
            </button>
          </div>
        </div>

        {/* Star Badge Toggle Switch */}
        <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-300 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <Star className={`w-5 h-5 ${isStarred ? 'text-amber-500 fill-amber-400' : 'text-stone-400'}`} />
            <div>
              <div className="text-xs font-bold text-stone-900">
                {isStarred ? 'Special Guest Status: Active (⭐ Starred)' : 'Special Guest Status: Disabled'}
              </div>
              <div className="text-[11px] text-stone-600">
                {scope === 'guest'
                  ? 'Highlights this individual guest in allotment views'
                  : scope === 'family'
                  ? `Highlights all ${familyMembers.length} members of Family "${targetReservation.family}"`
                  : `Highlights all ${tourMembers.length} zaereen across Tour "${targetReservation.tourRefNo}"`}
              </div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isStarred}
              onChange={(e) => setIsStarred(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
          </label>
        </div>

        {/* Special Lodging Requirements Remarks */}
        {isStarred && (
          <div className="space-y-1.5 animate-in fade-in duration-150">
            <label className="block text-xs font-bold text-stone-700">
              Special Lodging Requirements & Remarks:
            </label>
            <textarea
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Ground floor required, elderly wheelchair user, western toilet, double bed..."
              className="w-full bg-white border border-stone-300 rounded-xl p-2.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
            />

            {/* Quick Requirement Chips */}
            <div className="space-y-1 pt-1">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                Quick Insert Common Requirements:
              </span>
              <div className="flex flex-wrap gap-1.5">
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
                    className="px-2 py-0.5 rounded-lg bg-stone-100 hover:bg-amber-100 text-stone-700 hover:text-amber-900 border border-stone-200 text-[11px] font-medium transition cursor-pointer"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="pt-3 border-t border-stone-200 flex items-center justify-between gap-2">
          <span className="text-[11px] text-stone-500">
            {scope === 'guest'
              ? 'Applies to 1 guest'
              : scope === 'family'
              ? `Applies to ${familyMembers.length} family members`
              : `Applies to ${tourMembers.length} tour zaereen`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-stone-700 bg-stone-200/80 hover:bg-stone-300 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-sm transition flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4 text-[#EBD59E]" />
              <span>
                {isStarred
                  ? scope === 'guest'
                    ? 'Save for Guest'
                    : scope === 'family'
                    ? `Save for Family (${familyMembers.length})`
                    : `Save for Tour (${tourMembers.length})`
                  : 'Remove Special Status'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
