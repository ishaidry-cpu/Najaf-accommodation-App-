import React, { useState, useMemo, useEffect } from 'react';
import { ArrowRightLeft, Search, Users, User, CheckCircle2, AlertTriangle, X, Lock, ArrowRight } from 'lucide-react';
import { Room, Reservation } from '../types';
import {
  getRoomBookingsForDuration,
  countEffectivePax,
  isInfant,
  getDistinctBuildings,
  getRoomBedCount,
} from '../services/storage';
import {
  btn,
  chip,
  field,
  fieldLabel,
  panel,
  modalScrim,
  modalCard,
  modalHeader,
  modalTitle,
  modalClose,
  modalFooter,
  type ChipTone,
} from './ui';

/* Display helpers. Stored values are never changed, only how they read on screen. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const showDate = (v?: string) => {
  const raw = String(v || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw || '—';
  return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1] || m[2]}`;
};
const showTime = (v?: string) => {
  const raw = String(v || '').trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!m) return raw;
  const h = parseInt(m[1], 10);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
const sentence = (v: string) => {
  const t = v.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** "A, B, C +2" */
const nameList = (list: Reservation[], max = 3) =>
  `${list
    .slice(0, max)
    .map((r) => r.applicantName)
    .join(', ')}${list.length > max ? ` +${list.length - max}` : ''}`;

const segWrap = 'flex items-center gap-1 p-1 rounded-lg bg-stone-100';
const segBtn = (on: boolean) =>
  `h-8 max-sm:h-10 px-3 rounded-md text-[13px] whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
    on
      ? 'bg-white text-brand-700 font-semibold ring-1 ring-inset ring-stone-300'
      : 'font-medium text-stone-600 hover:text-stone-950'
  }`;
const pick = (on: boolean) =>
  `inline-flex items-center h-8 max-sm:h-10 px-2.5 rounded-lg text-xs font-medium ring-1 ring-inset cursor-pointer ${
    on ? 'bg-brand-50 text-brand-800 ring-brand-500' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50'
  }`;

export interface SwitchRoomTarget {
  reservations: Reservation[]; // 1 guest or multiple (family/room occupants)
  initialScope?: 'single' | 'group';
}

interface SwitchRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: SwitchRoomTarget | null;
  rooms: Room[];
  allReservations: Reservation[];
  onConfirmSwitch: (
    sourceReservationIds: string[],
    targetBuilding: string,
    targetRoomNumber: string,
    options: {
      swapWithExistingOccupants: boolean;
      reason?: string;
    }
  ) => void;
}

const QUICK_REASONS = [
  'Senior / Ground Floor',
  'Family Together',
  'Bed / Toilet Preference',
  'Medical / Mobility',
  'Room Upgrade / Adjustment',
];

export const SwitchRoomModal: React.FC<SwitchRoomModalProps> = ({
  isOpen,
  onClose,
  target,
  rooms,
  allReservations,
  onConfirmSwitch,
}) => {
  const [mode, setMode] = useState<'move' | 'swap'>('move');
  const [scope, setScope] = useState<'single' | 'group'>('group');
  const [searchQuery, setSearchQuery] = useState('');
  const [hotelFilter, setHotelFilter] = useState<string>('ALL');
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [availabilityFilter, setAvailabilityFilter] = useState<'vacant_first' | 'vacant_only' | 'all'>('vacant_first');
  const [reason, setReason] = useState<string>('');
  const [pendingConfirm, setPendingConfirm] = useState<{
    room: Room;
    isSwap: boolean;
    targetOccupants: Reservation[];
    warningText?: string;
  } | null>(null);

  const primary = target?.reservations[0] || null;

  // Find full family group if primary belongs to a family
  const familyGroup = useMemo(() => {
    if (!primary) return [];
    const fam = String(primary.family || '').trim().toLowerCase();
    const tour = String(primary.tourRefNo || primary.tourId || '').trim().toLowerCase();
    if (!fam) return target?.reservations || [primary];
    const matches = allReservations.filter((r) => {
      const rFam = String(r.family || '').trim().toLowerCase();
      const rTour = String(r.tourRefNo || r.tourId || '').trim().toLowerCase();
      return rFam === fam && (!tour || !rTour || rTour === tour);
    });
    return matches.length > 0 ? matches : [primary];
  }, [primary, allReservations, target]);

  // Reset modal controls when target changes
  useEffect(() => {
    if (!isOpen || !target) return;
    setMode('move');
    setSearchQuery('');
    setHotelFilter('ALL');
    setFloorFilter('ALL');
    setAvailabilityFilter('vacant_first');
    setReason('');
    setPendingConfirm(null);
    if (target.initialScope) {
      setScope(target.initialScope);
    } else if (target.reservations.length > 1 || familyGroup.length > 1) {
      setScope('group');
    } else {
      setScope('single');
    }
  }, [isOpen, target, familyGroup.length]);

  const activeSourceList = useMemo(() => {
    if (!primary) return [];
    if (scope === 'single') return [primary];
    if (target && target.reservations.length > 1) return target.reservations;
    return familyGroup.length > 0 ? familyGroup : [primary];
  }, [primary, scope, target, familyGroup]);

  const sourceIdsSet = useMemo(
    () => new Set(activeSourceList.map((r) => r.id)),
    [activeSourceList]
  );

  const distinctBuildings = useMemo(() => {
    return getDistinctBuildings(rooms);
  }, [rooms]);

  const floorOptions = useMemo(() => {
    const set: string[] = [];
    rooms.forEach((r) => {
      if (hotelFilter !== 'ALL' && r.building.toLowerCase() !== hotelFilter.toLowerCase()) return;
      const fl = r.floorLabel || `Floor ${r.floor}`;
      if (!set.includes(fl)) set.push(fl);
    });
    return ['ALL', ...set];
  }, [rooms, hotelFilter]);

  const arrivalDate = primary
    ? primary.arrivalDate || primary.arrivalDateTime || primary.rawArrivalStr || ''
    : '';
  const departureDate = primary
    ? primary.departureDate || primary.departureDateTime || primary.rawDepartureStr || ''
    : '';

  const currentBuilding = primary?.building || '';
  const currentRoom = primary?.roomNumber || '';
  const hasCurrentRoom = Boolean(currentRoom && currentRoom.trim() !== '');

  const requestedPax = useMemo(() => {
    return activeSourceList.reduce((acc, r) => acc + (isInfant(r) ? 0 : 1), 0);
  }, [activeSourceList]);

  // Evaluate all rooms for both Move and Swap
  const evaluatedRooms = useMemo(() => {
    if (!primary) return [];
    const poolExcludingSource = allReservations.filter((r) => !sourceIdsSet.has(r.id));

    return rooms.map((room) => {
      const baseCap = room.capacity || room.pax || 2;
      const bufCap = room.buffer || 0;
      const maxCap = baseCap + bufCap;

      const occupants = getRoomBookingsForDuration(
        room.building,
        room.roomNumber,
        arrivalDate,
        departureDate,
        poolExcludingSource
      );
      const currentOccupancy = countEffectivePax(occupants);
      const remainingSlots = Math.max(0, maxCap - currentOccupancy);

      const isSameAsCurrent =
        hasCurrentRoom &&
        room.building.trim().toLowerCase() === currentBuilding.trim().toLowerCase() &&
        room.roomNumber.trim().toLowerCase() === currentRoom.trim().toLowerCase();

      const isBlocked = room.status === 'blocked';
      const isVacant = !isBlocked && occupants.length === 0;
      const canFitInRemaining = !isBlocked && remainingSlots >= requestedPax;

      return {
        room,
        baseCap,
        bufCap,
        maxCap,
        occupants,
        currentOccupancy,
        remainingSlots,
        isSameAsCurrent,
        isBlocked,
        isVacant,
        canFitInRemaining,
      };
    });
  }, [
    primary,
    rooms,
    allReservations,
    sourceIdsSet,
    arrivalDate,
    departureDate,
    hasCurrentRoom,
    currentBuilding,
    currentRoom,
    requestedPax,
  ]);

  const filteredRooms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = evaluatedRooms.filter((item) => {
      if (item.isSameAsCurrent) return false;
      if (hotelFilter !== 'ALL' && item.room.building.toLowerCase() !== hotelFilter.toLowerCase()) {
        return false;
      }
      const fl = item.room.floorLabel || `Floor ${item.room.floor}`;
      if (floorFilter !== 'ALL' && fl !== floorFilter) return false;

      if (mode === 'swap') {
        // Swap mode only shows rooms that currently have overlapping occupants
        if (item.isBlocked || item.occupants.length === 0) return false;
      } else {
        if (availabilityFilter === 'vacant_only' && !item.isVacant) return false;
      }

      if (q) {
        const roomMatch =
          item.room.roomNumber.toLowerCase().includes(q) ||
          item.room.building.toLowerCase().includes(q) ||
          fl.toLowerCase().includes(q) ||
          (item.room.bedType || '').toLowerCase().includes(q) ||
          (item.room.toiletType || '').toLowerCase().includes(q);
        const occupantMatch = item.occupants.some(
          (o) =>
            (o.applicantName || '').toLowerCase().includes(q) ||
            (o.tourRefNo || '').toLowerCase().includes(q) ||
            (o.officeName || '').toLowerCase().includes(q) ||
            (o.family || '').toLowerCase().includes(q) ||
            (o.itsId || '').toLowerCase().includes(q)
        );
        if (!roomMatch && !occupantMatch) return false;
      }

      return true;
    });

    return list.sort((a, b) => {
      if (mode === 'move') {
        if (a.isVacant && !b.isVacant) return -1;
        if (!a.isVacant && b.isVacant) return 1;
        if (a.canFitInRemaining && !b.canFitInRemaining) return -1;
        if (!a.canFitInRemaining && b.canFitInRemaining) return 1;
        if (a.isBlocked && !b.isBlocked) return 1;
        if (!a.isBlocked && b.isBlocked) return -1;
      }
      const bldgCmp = a.room.building.localeCompare(b.room.building);
      if (bldgCmp !== 0) return bldgCmp;
      const numA = parseInt(a.room.roomNumber.replace(/\D/g, ''), 10) || 9999;
      const numB = parseInt(b.room.roomNumber.replace(/\D/g, ''), 10) || 9999;
      return numA !== numB ? numA - numB : a.room.roomNumber.localeCompare(b.room.roomNumber);
    });
  }, [evaluatedRooms, hotelFilter, floorFilter, mode, availabilityFilter, searchQuery]);

  if (!isOpen || !target || !primary) return null;

  type RoomItem = (typeof evaluatedRooms)[number];

  const canSwitchGroup = familyGroup.length > 1 || target.reservations.length > 1;
  const occupiedRoomCountForSwap = evaluatedRooms.filter((r) => !r.isSameAsCurrent && !r.isBlocked && r.occupants.length > 0).length;

  // Choosing a room only marks it. The footer button carries the move out, through executePending.
  const handleChooseMoveRoom = (item: RoomItem) => {
    if (item.isBlocked) {
      setPendingConfirm({
        room: item.room,
        isSwap: false,
        targetOccupants: item.occupants,
        warningText: `Room ${item.room.roomNumber} (${item.room.building}) is marked blocked (${item.room.blockedReason || 'Maintenance'}). Confirm only if you want to override the block and move here.`,
      });
      return;
    }

    if (!item.canFitInRemaining) {
      const occNames = item.occupants.map((o) => o.applicantName).slice(0, 3).join(', ');
      setPendingConfirm({
        room: item.room,
        isSwap: false,
        targetOccupants: item.occupants,
        warningText:
          item.occupants.length > 0
            ? `Room ${item.room.roomNumber} (${item.room.building}) already has ${item.currentOccupancy} of ${item.maxCap} beds taken (${occNames}). Move in alongside them anyway, or use Swap rooms to exchange rooms.`
            : `Room ${item.room.roomNumber} (${item.room.building}) sleeps ${item.maxCap} at most, and this move needs ${requestedPax} beds.`,
      });
      return;
    }

    // Clean move: same call as before (no swap, no warning), made when the footer button is pressed.
    setPendingConfirm({
      room: item.room,
      isSwap: false,
      targetOccupants: item.occupants,
    });
  };

  const handleChooseSwapRoom = (item: RoomItem) => {
    setPendingConfirm({
      room: item.room,
      isSwap: true,
      targetOccupants: item.occupants,
    });
  };

  const executePending = () => {
    if (!pendingConfirm) return;
    onConfirmSwitch(
      activeSourceList.map((r) => r.id),
      pendingConfirm.room.building,
      pendingConfirm.room.roomNumber,
      {
        swapWithExistingOccupants: pendingConfirm.isSwap,
        reason: reason.trim() || undefined,
      }
    );
    setPendingConfirm(null);
    onClose();
  };

  // One state per room. Tone follows the colour table: ok fits, wait look first, bad conflict.
  const roomState = (item: RoomItem): { tone: ChipTone; label: string } => {
    if (mode === 'swap') return { tone: 'neutral', label: `${item.occupants.length} in room` };
    if (item.isBlocked) return { tone: 'bad', label: 'Blocked' };
    if (item.isVacant) {
      if (!item.canFitInRemaining) return { tone: 'bad', label: 'Too small' };
      if (requestedPax > item.baseCap) return { tone: 'wait', label: 'Uses buffer bed' };
      return { tone: 'ok', label: 'Fits' };
    }
    if (item.canFitInRemaining) return { tone: 'wait', label: 'Shared room' };
    return { tone: 'bad', label: item.remainingSlots === 0 ? 'Full' : 'Not enough beds' };
  };

  const chosen = pendingConfirm;
  const chosenItem = chosen ? evaluatedRooms.find((r) => r.room.id === chosen.room.id) || null : null;
  const currentItem = evaluatedRooms.find((r) => r.isSameAsCurrent) || null;
  const staying = currentItem ? currentItem.occupants : [];
  const movingCount = activeSourceList.length;
  const tourLabel = primary.tourRefNo || primary.tourId || '—';
  const movers = movingCount === 1 ? primary.applicantName : `${movingCount} zaereen`;
  // Family members who are not in the same room as the first one (they all go to the new room).
  const elsewhere = Array.from(
    new Set(
      activeSourceList
        .filter(
          (r) =>
            r.roomNumber &&
            String(r.roomNumber).trim() !== '' &&
            (String(r.roomNumber).trim().toLowerCase() !== currentRoom.trim().toLowerCase() ||
              String(r.building || '').trim().toLowerCase() !== currentBuilding.trim().toLowerCase())
        )
        .map((r) => `${r.building} ${r.roomNumber}`)
    )
  );

  const confirmLabel = !chosen
    ? mode === 'swap'
      ? 'Swap rooms'
      : 'Move to room'
    : chosen.isSwap
    ? `Swap with room ${chosen.room.roomNumber}`
    : chosenItem?.isBlocked
    ? `Override block, move to ${chosen.room.roomNumber}`
    : chosen.warningText
    ? `Force move to room ${chosen.room.roomNumber}`
    : chosen.targetOccupants.length > 0
    ? `Move and share room ${chosen.room.roomNumber}`
    : `Move to room ${chosen.room.roomNumber}`;

  return (
    <div className={modalScrim}>
      <div
        className={`${modalCard} max-w-5xl lg:h-[min(92dvh,860px)]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-room-title"
      >
        <div className={modalHeader}>
          <div className="min-w-0">
            <h3 id="switch-room-title" className={modalTitle}>
              Switch room
            </h3>
            <p className="mt-1 text-sm text-stone-600">
              {movers}
              {' · '}Family {primary.family || '—'}
              {' · '}
              <span className="tabular-nums">Tour {tourLabel}</span>
              {primary.officeName && <span className="max-sm:hidden"> · {primary.officeName}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close switch room dialog">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:flex lg:flex-col">
          {/* From → to */}
          <div className="lg:shrink-0 border-b border-stone-200 px-5 sm:px-6 py-4 space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-4">
              <div className={`${panel} px-3.5 py-3 min-w-0`}>
                <p className="text-xs font-medium text-stone-500">From</p>
                <p className="mt-1 flex items-baseline gap-2 min-w-0">
                  {hasCurrentRoom ? (
                    <>
                      <span className="font-display text-2xl leading-none font-semibold text-stone-950 tabular-nums">
                        {currentRoom}
                      </span>
                      <span className="text-[13px] text-stone-600 truncate">{currentBuilding}</span>
                    </>
                  ) : (
                    <span className="text-base font-semibold text-stone-950">Unallotted</span>
                  )}
                </p>
                <p className="mt-2 text-[13px] font-medium text-stone-900 line-clamp-2">{nameList(activeSourceList)}</p>
                <p className="mt-0.5 text-xs text-stone-600">
                  {chosen?.isSwap
                    ? `Move${movingCount === 1 ? 's' : ''} out. ${nameList(chosen.targetOccupants, 2)} move${
                        chosen.targetOccupants.length === 1 ? 's' : ''
                      } in here.`
                    : !hasCurrentRoom
                    ? 'No room yet.'
                    : staying.length > 0
                    ? `Move${movingCount === 1 ? 's' : ''} out. ${staying.length} other${
                        staying.length === 1 ? ' stays' : 's stay'
                      } in this room.`
                    : `Move${movingCount === 1 ? 's' : ''} out. No one else is in this room on these dates.`}
                </p>
                {elsewhere.length > 0 && (
                  <p className="mt-0.5 text-xs text-stone-500 tabular-nums">Some are now in {elsewhere.join(', ')}.</p>
                )}
              </div>

              <div className="flex items-center text-stone-400" aria-hidden="true">
                {mode === 'swap' ? <ArrowRightLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
              </div>

              <div
                className={`rounded-xl px-3.5 py-3 min-w-0 ring-inset ${
                  chosen ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-stone-50 ring-1 ring-stone-200/70'
                }`}
                aria-live="polite"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-stone-500">To</p>
                  {chosen && (
                    <button
                      type="button"
                      onClick={() => setPendingConfirm(null)}
                      aria-label="Clear the chosen room"
                      className="-mt-1.5 -mr-2 w-8 h-8 max-sm:w-10 max-sm:h-10 shrink-0 rounded-lg flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-brand-100 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {chosen ? (
                  <>
                    <p className="-mt-1 max-sm:-mt-3 flex items-baseline gap-2 min-w-0">
                      <span className="font-display text-2xl leading-none font-semibold text-stone-950 tabular-nums">
                        {chosen.room.roomNumber}
                      </span>
                      <span className="text-[13px] text-stone-600 truncate">{chosen.room.building}</span>
                    </p>
                    <p className="mt-2 text-[13px] font-medium text-stone-900 line-clamp-2">
                      {chosen.isSwap
                        ? `${movers} move${movingCount === 1 ? 's' : ''} in`
                        : chosen.targetOccupants.length > 0
                        ? `Shares with ${nameList(chosen.targetOccupants, 2)}`
                        : `${movers} move${movingCount === 1 ? 's' : ''} in`}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-600">
                      {chosen.isSwap
                        ? `${nameList(chosen.targetOccupants, 2)} move${
                            chosen.targetOccupants.length === 1 ? 's' : ''
                          } to ${currentBuilding} ${currentRoom}.`
                        : chosenItem
                        ? `${chosen.targetOccupants.length > 0 ? '' : 'Empty on these dates. '}Sleeps ${chosenItem.baseCap}${
                            chosenItem.bufCap > 0 ? ` + ${chosenItem.bufCap} buffer` : ''
                          }, ${requestedPax} bed${requestedPax === 1 ? '' : 's'} needed.`
                        : ''}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-base font-semibold text-stone-950">Not chosen yet</p>
                    <p className="mt-2 text-xs text-stone-600">
                      {mode === 'swap'
                        ? 'Choose the occupied room to swap with. Both groups change places.'
                        : `Choose a room below. ${requestedPax} bed${requestedPax === 1 ? '' : 's'} needed.`}
                    </p>
                  </>
                )}
              </div>
            </div>

            <p className="text-[13px] text-stone-600 tabular-nums">
              Stay:{' '}
              <span className="font-medium text-stone-900">
                {showDate(arrivalDate)}
                {primary.arrivalTime ? `, ${showTime(primary.arrivalTime)}` : ''}
                <ArrowRight className="inline w-3.5 h-3.5 mx-1 -mt-0.5 text-stone-500" aria-label="to" />
                {showDate(departureDate)}
                {primary.departureTime ? `, ${showTime(primary.departureTime)}` : ''}
              </span>
            </p>

          </div>

          <div className="lg:flex-1 lg:min-h-0 lg:flex">
            {/* How to move */}
            <aside className="lg:w-[304px] lg:shrink-0 lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-stone-200 px-5 sm:px-6 lg:pr-5 py-4 space-y-4">
              <div>
                <p className={fieldLabel} id="switch-mode-label">
                  What to do
                </p>
                <div className={`${segWrap} w-full`} role="group" aria-labelledby="switch-mode-label">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('move');
                      setPendingConfirm(null);
                    }}
                    aria-pressed={mode === 'move'}
                    className={`${segBtn(mode === 'move')} flex-1 inline-flex items-center justify-center gap-1.5`}
                  >
                    <ArrowRight className="w-4 h-4 shrink-0" />
                    Move
                  </button>
                  <button
                    type="button"
                    disabled={!hasCurrentRoom}
                    onClick={() => {
                      setMode('swap');
                      setPendingConfirm(null);
                    }}
                    aria-pressed={mode === 'swap'}
                    title={hasCurrentRoom ? 'Swap rooms 2-way with occupants of another room' : 'Assign a room first before swapping'}
                    className={`${segBtn(mode === 'swap')} flex-1 inline-flex items-center justify-center gap-1.5`}
                  >
                    <ArrowRightLeft className="w-4 h-4 shrink-0" />
                    Swap rooms ({occupiedRoomCountForSwap})
                  </button>
                </div>
              </div>

              {canSwitchGroup && (
                <div>
                  <p className={fieldLabel} id="switch-scope-label">
                    Who moves
                  </p>
                  <div className={`${segWrap} w-full`} role="group" aria-labelledby="switch-scope-label">
                    <button
                      type="button"
                      onClick={() => {
                        setScope('single');
                        setPendingConfirm(null);
                      }}
                      aria-pressed={scope === 'single'}
                      className={`${segBtn(scope === 'single')} flex-1 inline-flex items-center justify-center gap-1.5`}
                    >
                      <User className="w-4 h-4 shrink-0" />
                      This zair only
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScope('group');
                        setPendingConfirm(null);
                      }}
                      aria-pressed={scope === 'group'}
                      className={`${segBtn(scope === 'group')} flex-1 inline-flex items-center justify-center gap-1.5`}
                    >
                      <Users className="w-4 h-4 shrink-0" />
                      All ({target.reservations.length > 1 ? target.reservations.length : familyGroup.length})
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="switch-reason" className={fieldLabel}>
                  Reason <span className="font-normal text-stone-500">(optional)</span>
                </label>
                <input
                  id="switch-reason"
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ground floor needed for senior"
                  className={field}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUICK_REASONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReason(preset)}
                      aria-pressed={reason === preset}
                      className={pick(reason === preset)}
                    >
                      {sentence(preset)}
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            {/* Rooms */}
            <div className="lg:flex-1 lg:min-w-0 lg:flex lg:flex-col">
              <div className="px-5 sm:px-6 lg:pl-5 pt-4 pb-3 space-y-2 lg:border-b border-stone-200">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={
                        mode === 'swap' ? 'Search room, zair, office or Tour ID' : 'Search room, building, floor or bed'
                      }
                      aria-label="Search rooms"
                      className={`${field} pl-9`}
                    />
                  </div>
                  {mode === 'move' && (
                    <select
                      value={availabilityFilter}
                      onChange={(e) => setAvailabilityFilter(e.target.value as typeof availabilityFilter)}
                      aria-label="Which rooms to show"
                      className={`${field} sm:w-40 shrink-0`}
                    >
                      <option value="vacant_first">Vacant first</option>
                      <option value="vacant_only">Vacant only</option>
                      <option value="all">All rooms</option>
                    </select>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <div
                    className={`${segWrap} flex-1 min-w-0 overflow-x-auto app-scroll-x`}
                    role="group"
                    aria-label="Building"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setHotelFilter('ALL');
                        setFloorFilter('ALL');
                      }}
                      aria-pressed={hotelFilter === 'ALL'}
                      className={segBtn(hotelFilter === 'ALL')}
                    >
                      All
                    </button>
                    {distinctBuildings.map((b) => {
                      const on = hotelFilter.toLowerCase() === b.toLowerCase();
                      return (
                        <button
                          key={b}
                          type="button"
                          onClick={() => {
                            setHotelFilter(b);
                            setFloorFilter('ALL');
                          }}
                          aria-pressed={on}
                          className={segBtn(on)}
                        >
                          {b}
                        </button>
                      );
                    })}
                  </div>
                  <select
                    value={floorFilter}
                    onChange={(e) => setFloorFilter(e.target.value)}
                    aria-label="Floor"
                    className={`${field} sm:w-36 shrink-0`}
                  >
                    {floorOptions.map((fl) => (
                      <option key={fl} value={fl}>
                        {fl === 'ALL' ? 'All floors' : fl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto px-5 sm:px-6 lg:pl-5 py-3">
                {filteredRooms.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredRooms.map((item) => {
                      const { room, occupants, isBlocked, currentOccupancy, maxCap, remainingSlots, baseCap, bufCap } = item;
                      const state = roomState(item);
                      const isChosen = chosen?.room.id === room.id;
                      return (
                        <button
                          key={room.id}
                          type="button"
                          aria-pressed={isChosen}
                          onClick={() => {
                            if (isChosen) {
                              setPendingConfirm(null);
                            } else if (mode === 'swap') {
                              handleChooseSwapRoom(item);
                            } else {
                              handleChooseMoveRoom(item);
                            }
                          }}
                          className={`flex flex-col justify-start items-stretch w-full text-left rounded-xl p-3.5 ring-inset cursor-pointer ${
                            isChosen
                              ? 'bg-brand-50 ring-2 ring-brand-500'
                              : isBlocked
                              ? 'bg-stone-50 ring-1 ring-stone-200 hover:ring-stone-400'
                              : 'bg-white ring-1 ring-stone-200 hover:ring-stone-400 hover:bg-stone-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex items-baseline gap-2">
                              <span className="font-display text-[22px] leading-none font-semibold text-stone-950 tabular-nums">
                                {room.roomNumber}
                              </span>
                              <span className="text-[13px] text-stone-600 truncate">
                                {room.building} · {room.floorLabel || `Floor ${room.floor}`}
                              </span>
                            </div>
                            <span className={`${chip(state.tone)} shrink-0`}>
                              {isChosen ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : (
                                isBlocked && mode !== 'swap' && <Lock className="w-3 h-3" />
                              )}
                              {state.label}
                            </span>
                          </div>

                          <div className="mt-2 text-[13px] text-stone-800">
                            Sleeps {baseCap}
                            {bufCap > 0 ? ` + ${bufCap} buffer` : ''}
                            <span className="text-stone-500">
                              {' '}
                              ·{' '}
                              {isBlocked
                                ? `blocked${room.blockedReason ? `: ${room.blockedReason}` : ''}`
                                : occupants.length === 0
                                ? 'empty'
                                : `${currentOccupancy} of ${maxCap} taken, ${remainingSlots} free`}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-stone-500">
                            {getRoomBedCount(room)} × {sentence(room.bedType || 'Single Beds')} ·{' '}
                            {sentence(room.toiletType || 'Standard')} toilet
                          </div>

                          {occupants.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-stone-200 text-xs">
                              <div
                                className="font-medium text-stone-800 truncate"
                                title={occupants.map((o) => o.applicantName).join(', ')}
                              >
                                {occupants.map((o) => o.applicantName).join(', ')}
                              </div>
                              <div className="mt-0.5 text-stone-600 truncate tabular-nums">
                                Family {occupants[0].family || '—'} · Tour {occupants[0].tourRefNo || occupants[0].tourId || '—'}
                                {occupants[0].officeName ? ` · ${occupants[0].officeName}` : ''}
                              </div>
                              <div className="mt-0.5 text-stone-500 tabular-nums">
                                {showDate(occupants[0].arrivalDate)}
                                <ArrowRight className="inline w-3 h-3 mx-1 -mt-0.5" aria-label="to" />
                                {showDate(occupants[0].departureDate)}
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-14 text-center">
                    <p className="text-sm font-semibold text-stone-900">
                      {mode === 'swap' ? 'No other occupied rooms match' : 'No rooms match'}
                    </p>
                    <p className="mt-1 text-[13px] text-stone-600">
                      {mode === 'swap'
                        ? 'Swapping needs a room with people in it on these dates. Clear the search or pick another building.'
                        : 'Clear the search, pick another building or floor, or show all rooms.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* What needs confirming about the chosen room, in plain words, before the move */}
        {chosen && !chosen.isSwap && chosen.warningText && (
          <div className="shrink-0 border-t border-stone-200 px-5 sm:px-6 py-3 max-h-[30dvh] overflow-y-auto">
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 text-amber-800"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 text-[13px] leading-relaxed">
                <p className="font-semibold">This move needs your confirmation</p>
                <p className="mt-0.5">{chosen.warningText}</p>
              </div>
            </div>
          </div>
        )}

        <div className={`${modalFooter} sm:justify-between`}>
          <p className="max-sm:w-full text-[13px] text-stone-600 tabular-nums">
            {chosen ? (
              <>
                {chosen.isSwap ? 'Swap' : 'Move'}:{' '}
                <span className="font-semibold text-stone-950">
                  {hasCurrentRoom ? `${currentBuilding} ${currentRoom}` : 'Unallotted'}
                  {chosen.isSwap ? ' ↔ ' : ' → '}
                  {chosen.room.building} {chosen.room.roomNumber}
                </span>
              </>
            ) : (
              <>{filteredRooms.length} rooms shown. Choose one to continue.</>
            )}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={onClose} className={btn.ghost}>
              Cancel
            </button>
            <button type="button" disabled={!chosen} onClick={executePending} className={btn.primary}>
              {chosen?.isSwap ? <ArrowRightLeft className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
