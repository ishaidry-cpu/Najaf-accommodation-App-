import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowRightLeft,
  Building2,
  Search,
  Users,
  User,
  CheckCircle2,
  AlertTriangle,
  X,
  BedDouble,
  Bath,
  Clock,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { Room, Reservation } from '../types';
import {
  getRoomBookingsForDuration,
  countEffectivePax,
  isInfant,
} from '../services/storage';

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
    const set = new Set<string>(['Saifee', 'Burhani', 'Badri']);
    rooms.forEach((r) => {
      if (r.building) set.add(String(r.building).trim());
    });
    return Array.from(set).sort();
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

  const canSwitchGroup = familyGroup.length > 1 || target.reservations.length > 1;
  const occupiedRoomCountForSwap = evaluatedRooms.filter((r) => !r.isSameAsCurrent && !r.isBlocked && r.occupants.length > 0).length;

  const handleChooseMoveRoom = (item: (typeof evaluatedRooms)[0]) => {
    if (item.isBlocked) {
      setPendingConfirm({
        room: item.room,
        isSwap: false,
        targetOccupants: item.occupants,
        warningText: `Room ${item.room.roomNumber} (${item.room.building}) is currently marked BLOCKED (${item.room.blockedReason || 'Maintenance'}). Confirm if you want to override and move here.`,
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
            ? `Room ${item.room.roomNumber} (${item.room.building}) already has ${item.currentOccupancy}/${item.maxCap} pax (${occNames}). Move alongside them anyway, or switch to Swap Mode to exchange rooms.`
            : `Room ${item.room.roomNumber} (${item.room.building}) has capacity ${item.maxCap} pax, while selection has ${requestedPax} bed pax.`,
      });
      return;
    }

    // Direct clean move
    onConfirmSwitch(
      activeSourceList.map((r) => r.id),
      item.room.building,
      item.room.roomNumber,
      {
        swapWithExistingOccupants: false,
        reason: reason.trim() || undefined,
      }
    );
    onClose();
  };

  const handleChooseSwapRoom = (item: (typeof evaluatedRooms)[0]) => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#FAF7F2] w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl border border-[#E6DFD5] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="bg-[#124E39] text-white px-4 py-3.5 sm:px-5 sm:py-4 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-[#EBD59E] shrink-0" />
              <h3 className="font-bold text-sm sm:text-base text-[#EBD59E] tracking-tight truncate">
                Switch or Swap Room Allotment
              </h3>
            </div>
            <div className="text-xs text-emerald-100 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-bold text-white">
                {activeSourceList.length === 1
                  ? primary.applicantName
                  : `${activeSourceList.length} Zaereen (Family #${primary.family || '—'})`}
              </span>
              <span className="opacity-60">·</span>
              <span className="font-mono">Tour {primary.tourRefNo || primary.tourId || '—'}</span>
              {primary.officeName && (
                <>
                  <span className="opacity-60">·</span>
                  <span className="truncate max-w-[220px]">{primary.officeName}</span>
                </>
              )}
            </div>
            <div className="text-[11px] text-emerald-100/90 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
              <span>
                Current:{' '}
                <strong className="text-[#EBD59E]">
                  {hasCurrentRoom ? `${currentBuilding} Rm ${currentRoom}` : 'Unallotted'}
                </strong>
              </span>
              <span className="opacity-60">·</span>
              <span>
                {arrivalDate.slice(0, 10)} {primary.arrivalTime ? `(${primary.arrivalTime})` : ''} ➔{' '}
                {departureDate.slice(0, 10)} {primary.departureTime ? `(${primary.departureTime})` : ''}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-emerald-100 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
            aria-label="Close switch room modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scope & Mode Bar */}
        <div className="bg-white border-b border-[#E6DFD5] px-4 py-3 space-y-2.5 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            {/* Mode Switcher: Move vs 2-Way Swap */}
            <div className="grid grid-cols-2 sm:inline-flex bg-stone-100 p-1 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => {
                  setMode('move');
                  setPendingConfirm(null);
                }}
                className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  mode === 'move'
                    ? 'bg-[#124E39] text-[#EBD59E] shadow-xs'
                    : 'text-stone-700 hover:text-stone-950'
                }`}
              >
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                <span>Move to Room</span>
              </button>

              <button
                type="button"
                disabled={!hasCurrentRoom}
                onClick={() => {
                  setMode('swap');
                  setPendingConfirm(null);
                }}
                title={hasCurrentRoom ? 'Swap rooms 2-way with occupants of another room' : 'Assign a room first before swapping'}
                className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  mode === 'swap'
                    ? 'bg-[#124E39] text-[#EBD59E] shadow-xs'
                    : 'text-stone-700 hover:text-stone-950'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
                <span>Swap Rooms ({occupiedRoomCountForSwap})</span>
              </button>
            </div>

            {/* Single Guest vs Whole Family Scope */}
            {canSwitchGroup && (
              <div className="grid grid-cols-2 sm:inline-flex bg-stone-100 p-1 rounded-xl gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setScope('single');
                    setPendingConfirm(null);
                  }}
                  className={`min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                    scope === 'single'
                      ? 'bg-white text-[#124E39] shadow-xs border border-stone-200'
                      : 'text-stone-600'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>This Zair Only</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScope('group');
                    setPendingConfirm(null);
                  }}
                  className={`min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                    scope === 'group'
                      ? 'bg-white text-[#124E39] shadow-xs border border-stone-200'
                      : 'text-stone-600'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>
                    All ({target.reservations.length > 1 ? target.reservations.length : familyGroup.length})
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Search & Hotel / Floor Filters */}
          <div className="grid grid-cols-2 sm:grid-cols-12 gap-2">
            <div className="col-span-2 sm:col-span-5 relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3 sm:top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  mode === 'swap'
                    ? 'Search room #, guest, office, tour ID...'
                    : 'Search room #, hotel, floor, bed...'
                }
                className="w-full min-h-[44px] sm:min-h-[38px] bg-[#FAF7F2] border border-stone-300 rounded-xl pl-9 pr-3 text-xs font-medium text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
              />
            </div>

            <select
              value={hotelFilter}
              onChange={(e) => {
                setHotelFilter(e.target.value);
                setFloorFilter('ALL');
              }}
              className="col-span-1 sm:col-span-3 min-h-[44px] sm:min-h-[38px] bg-[#FAF7F2] border border-stone-300 rounded-xl px-2.5 text-xs font-bold text-[#124E39] cursor-pointer"
            >
              <option value="ALL">All Hotels</option>
              {distinctBuildings.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <select
              value={floorFilter}
              onChange={(e) => setFloorFilter(e.target.value)}
              className="col-span-1 sm:col-span-2 min-h-[44px] sm:min-h-[38px] bg-[#FAF7F2] border border-stone-300 rounded-xl px-2.5 text-xs font-semibold text-stone-800 cursor-pointer"
            >
              {floorOptions.map((fl) => (
                <option key={fl} value={fl}>
                  {fl === 'ALL' ? 'All Floors' : fl}
                </option>
              ))}
            </select>

            {mode === 'move' && (
              <select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value as any)}
                className="col-span-2 sm:col-span-2 min-h-[44px] sm:min-h-[38px] bg-[#FAF7F2] border border-stone-300 rounded-xl px-2.5 text-xs font-semibold text-stone-800 cursor-pointer"
              >
                <option value="vacant_first">Vacant First</option>
                <option value="vacant_only">Vacant Only</option>
                <option value="all">All Rooms</option>
              </select>
            )}
          </div>

          {/* Optional Reason Input + Quick Presets */}
          <div className="space-y-1.5">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional reason for switching room (e.g. Ground floor needed for senior)..."
              className="w-full min-h-[40px] sm:min-h-[34px] bg-white border border-stone-200 rounded-xl px-3 text-xs text-stone-800 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
            />
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {QUICK_REASONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                    reason === preset
                      ? 'bg-[#124E39] text-[#EBD59E] border-[#124E39]'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Inline Confirmation Banner when Swap or Force Move is selected */}
        {pendingConfirm && (
          <div className="bg-amber-50 border-b border-amber-300 p-4 space-y-3 shrink-0 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              {pendingConfirm.isSwap ? (
                <ArrowRightLeft className="w-5 h-5 text-[#124E39] shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-xs space-y-1">
                <div className="font-bold text-stone-900 text-sm">
                  {pendingConfirm.isSwap
                    ? `Confirm 2-Way Room Swap`
                    : `Confirm Room Move Override`}
                </div>
                {pendingConfirm.isSwap ? (
                  <div className="text-stone-700 space-y-1">
                    <div>
                      <strong>{activeSourceList.map((r) => r.applicantName).slice(0, 2).join(', ')}{activeSourceList.length > 2 ? ` +${activeSourceList.length - 2}` : ''}</strong>{' '}
                      ({currentBuilding} Rm {currentRoom}) ➔{' '}
                      <strong className="text-[#124E39]">
                        {pendingConfirm.room.building} Rm {pendingConfirm.room.roomNumber}
                      </strong>
                    </div>
                    <div>
                      <strong>{pendingConfirm.targetOccupants.map((o) => o.applicantName).slice(0, 2).join(', ')}{pendingConfirm.targetOccupants.length > 2 ? ` +${pendingConfirm.targetOccupants.length - 2}` : ''}</strong>{' '}
                      ({pendingConfirm.room.building} Rm {pendingConfirm.room.roomNumber}) ➔{' '}
                      <strong className="text-[#124E39]">
                        {currentBuilding} Rm {currentRoom}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <p className="text-amber-950 font-medium">{pendingConfirm.warningText}</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="min-h-[44px] sm:min-h-[36px] px-4 rounded-xl border border-stone-300 bg-white text-stone-700 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executePending}
                className="min-h-[44px] sm:min-h-[36px] px-4 rounded-xl bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{pendingConfirm.isSwap ? 'Confirm Swap ↔' : 'Confirm Move'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Room List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5">
          {filteredRooms.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredRooms.map((item) => {
                const { room, occupants, isVacant, isBlocked, canFitInRemaining, currentOccupancy, maxCap, remainingSlots } = item;
                return (
                  <div
                    key={room.id}
                    className={`bg-white rounded-xl border p-3 flex flex-col justify-between gap-2.5 transition ${
                      isBlocked
                        ? 'border-stone-300 bg-stone-50'
                        : isVacant
                        ? 'border-emerald-300'
                        : canFitInRemaining
                        ? 'border-amber-300'
                        : 'border-stone-200'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-mono font-extrabold text-sm text-[#124E39] tabular-nums">
                            {room.building} · Room {room.roomNumber}
                          </div>
                          <div className="text-[11px] text-stone-500">
                            {room.floorLabel || `Floor ${room.floor}`} · Cap {room.capacity}
                            {room.buffer ? ` (+${room.buffer})` : ''} · {room.bedType || 'Single Beds'} ·{' '}
                            {room.toiletType || 'Standard'}
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 tabular-nums ${
                            isBlocked
                              ? 'bg-stone-200 text-stone-700'
                              : isVacant
                              ? 'bg-emerald-100 text-emerald-900'
                              : canFitInRemaining
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-rose-100 text-rose-900'
                          }`}
                        >
                          {isBlocked
                            ? 'Blocked'
                            : isVacant
                            ? `Vacant (${maxCap})`
                            : `${currentOccupancy}/${maxCap} Pax`}
                        </span>
                      </div>

                      {occupants.length > 0 && (
                        <div className="bg-[#FAF7F2] border border-stone-200/80 rounded-lg p-2 text-[11px] space-y-0.5">
                          <div className="font-bold text-stone-800 truncate">
                            {occupants.map((o) => o.applicantName).join(', ')}
                          </div>
                          <div className="text-stone-600 truncate">
                            Tour {occupants[0].tourRefNo || occupants[0].tourId || '—'}
                            {occupants[0].officeName ? ` · ${occupants[0].officeName}` : ''} · Fam #{occupants[0].family || '—'}
                          </div>
                          <div className="text-stone-500 flex items-center gap-1 tabular-nums">
                            <Clock className="w-3 h-3 text-stone-400 shrink-0" />
                            <span>
                              {(occupants[0].arrivalDate || '').slice(0, 10)} ➔{' '}
                              {(occupants[0].departureDate || '').slice(0, 10)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="pt-1">
                      {mode === 'swap' ? (
                        <button
                          type="button"
                          onClick={() => handleChooseSwapRoom(item)}
                          className="w-full min-h-[44px] sm:min-h-[36px] rounded-xl bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          <span>
                            Swap with Rm {room.roomNumber} ({occupants.length} pax)
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleChooseMoveRoom(item)}
                          className={`w-full min-h-[44px] sm:min-h-[36px] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            isVacant
                              ? 'bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E]'
                              : canFitInRemaining
                              ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                              : 'bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300'
                          }`}
                        >
                          {isBlocked && <Lock className="w-3.5 h-3.5" />}
                          <span>
                            {isVacant
                              ? `Move to Rm ${room.roomNumber}`
                              : canFitInRemaining
                              ? `Move & Share (${remainingSlots} slots open)`
                              : isBlocked
                              ? `Override Blocked Rm ${room.roomNumber}`
                              : `Force Move to Rm ${room.roomNumber}`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-stone-500 space-y-2">
              <Building2 className="w-8 h-8 mx-auto text-stone-300" />
              <p className="font-semibold">
                {mode === 'swap'
                  ? 'No other occupied rooms found matching your filters.'
                  : 'No rooms match your search criteria.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
