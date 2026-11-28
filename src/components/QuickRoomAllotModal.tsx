import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Users, CheckCircle2, AlertCircle, X, Sparkles, ArrowRight, ArrowRightLeft } from 'lucide-react';
import { Room, Reservation } from '../types';
import { familyGroups, groupOf } from '../utils/familyGroups';
import type { SwitchRoomTarget } from './SwitchRoomModal';
import {
  getRoomBedCount,
  checkRoomAllotmentAvailability,
  getRoomBookingsForDuration,
  isInfant,
  countEffectivePax,
  getDistinctBuildings,
} from '../services/storage';
import {
  btn,
  btnSm,
  chip,
  field,
  fieldLabel,
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

const groupTitle = 'text-[15px] font-semibold text-stone-950 pb-2 border-b border-stone-200';
const segWrap = 'flex items-center gap-1 p-1 rounded-lg bg-stone-100';
const segBtn = (on: boolean) =>
  `h-8 max-sm:h-10 px-3 rounded-md text-[13px] whitespace-nowrap cursor-pointer ${
    on
      ? 'bg-white text-brand-700 font-semibold ring-1 ring-inset ring-stone-300'
      : 'font-medium text-stone-600 hover:text-stone-950'
  }`;

interface QuickRoomAllotModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetReservation: Reservation | null;
  rooms: Room[];
  reservations: Reservation[];
  onAllotRoom: (reservationId: string, building: string, roomNumber: string, forceConfirmed?: boolean) => void;
  onBatchAllotFamily?: (tourRefNo: string, family: string, building: string, roomNumber: string, forceConfirmed?: boolean, memberIds?: string[]) => void;
  onOpenSwitchRoomModal?: (target: SwitchRoomTarget) => void;
}

export const QuickRoomAllotModal: React.FC<QuickRoomAllotModalProps> = ({
  isOpen,
  onClose,
  targetReservation,
  rooms,
  reservations,
  onAllotRoom,
  onBatchAllotFamily,
  onOpenSwitchRoomModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [hotelFilter, setHotelFilter] = useState<string>('ALL');
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [amenityFilter, setAmenityFilter] = useState<'ALL' | 'western' | 'indian' | 'double' | 'single'>('ALL');
  const [allotMode, setAllotMode] = useState<'single' | 'family'>('single');
  // The room picked in the list. Nothing is allotted until the footer button is pressed.
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const targetId = targetReservation?.id;
  useEffect(() => {
    setSelectedRoomId(null);
  }, [targetId]);

  // All buildings in inventory (core 3 + any custom buildings added by user)
  const distinctBuildings = useMemo(() => {
    return getDistinctBuildings(rooms);
  }, [rooms]);

  const arrivalDate = targetReservation ? (targetReservation.arrivalDate || targetReservation.arrivalDateTime || targetReservation.rawArrivalStr || '') : '';
  const departureDate = targetReservation ? (targetReservation.departureDate || targetReservation.departureDateTime || targetReservation.rawDepartureStr || '') : '';

  const targetFam = targetReservation ? String(targetReservation.family || '').trim().toLowerCase() : '';
  const targetTour = targetReservation ? String(targetReservation.tourRefNo || targetReservation.tourId || '').trim().toLowerCase() : '';

  // The zair's family group on this trip: same tour, same family (or household by HOF / group ID), overlapping dates.
  const groups = useMemo(() => familyGroups(reservations), [reservations]);
  const targetGroup = targetReservation ? groupOf(groups, targetReservation) : null;
  const sameGroup = (r: Reservation) => {
    if (!targetReservation || !targetGroup) return false;
    const rTour = String(r.tourRefNo || r.tourId || '').trim().toLowerCase();
    return (!targetTour || !rTour || rTour === targetTour) && groupOf(groups, r).key === targetGroup.key;
  };
  const familyMembers = useMemo(() => {
    if (!targetReservation || !targetGroup) return [];
    const day = (v?: string) => String(v || '').slice(0, 10);
    const a = day(targetReservation.arrivalDate);
    const d = day(targetReservation.departureDate) || a;
    return reservations.filter((r) => {
      if (r.id === targetReservation.id) return true;
      if (!sameGroup(r)) return false;
      const ra = day(r.arrivalDate);
      const rd = day(r.departureDate) || ra;
      return ra === a || (ra < d && a < rd);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations, targetReservation, targetGroup?.key, targetTour, groups]);
  const familyName = targetGroup?.label || targetReservation?.family || '';

  const isFamily = familyMembers.length > 1;
  const requestedPax =
    allotMode === 'family' && isFamily
      ? countEffectivePax(familyMembers)
      : targetReservation && isInfant(targetReservation)
      ? 0
      : 1;

  // Available floors for current building filter
  const floorOptions = useMemo(() => {
    const list: string[] = [];
    rooms.forEach((r) => {
      if (hotelFilter !== 'ALL' && String(r.building || '').toLowerCase() !== hotelFilter.toLowerCase()) return;
      const fl = r.floorLabel || `Floor ${r.floor}`;
      if (!list.includes(fl)) list.push(fl);
    });
    return ['ALL', ...list];
  }, [rooms, hotelFilter]);

  // Compute room statuses & availability for target duration
  const evaluatedRooms = useMemo(() => {
    if (!targetReservation) return [];

    return rooms.map((room) => {
      const baseCap = room.capacity || room.pax || 2;
      const bufCap = room.buffer || 0;
      const maxCap = baseCap + bufCap;

      const familyMemberIds = new Set(familyMembers.map((m) => m.id));
      const poolReservations = allotMode === 'family'
        ? reservations.filter((r) => !familyMemberIds.has(r.id))
        : reservations;

      // Occupants during target reservation dates (excluding current target zaer or family)
      const occupants = getRoomBookingsForDuration(
        room.building,
        room.roomNumber,
        arrivalDate,
        departureDate,
        poolReservations,
        allotMode === 'single' ? targetReservation.id : undefined
      );

      const currentOccupancy = countEffectivePax(occupants);
      const remainingSlots = Math.max(0, maxCap - currentOccupancy);

      // Check if family members are already in this room
      const familyInRoom = occupants.filter(sameGroup);

      const isCurrent =
        String(targetReservation.building || '').trim().toLowerCase() === String(room.building || '').trim().toLowerCase() &&
        String(targetReservation.roomNumber || '').trim().toLowerCase() === String(room.roomNumber || '').trim().toLowerCase() &&
        String(room.roomNumber || '').trim() !== '';

      // Check allotment availability including turnover timing rules:
      const check = checkRoomAllotmentAvailability(
        room.building,
        room.roomNumber,
        arrivalDate,
        departureDate,
        rooms,
        poolReservations,
        requestedPax,
        allotMode === 'single' ? targetReservation.id : undefined,
        false,
        targetReservation.arrivalTime,
        targetReservation.departureTime,
        targetReservation.applicantName,
        targetReservation.family,
        targetReservation.tourRefNo
      );

      const canFit = (check.allowed || remainingSlots >= requestedPax) && room.status !== 'blocked';
      const isFull = currentOccupancy >= maxCap;
      const isBlocked = room.status === 'blocked';
      const hasTimingConflict = !!check.hasTimingConflict;
      const isSevereConflict = !!check.isSevereConflict;
      const canForceAllocate = check.canForceAllocate !== false;
      const timingDiffHours = check.timingConflictDiffHours;
      const conflictReason = check.reason || '';

      return {
        room,
        baseCap,
        bufCap,
        maxCap,
        currentOccupancy,
        remainingSlots,
        occupants,
        familyInRoom,
        isCurrent,
        canFit,
        isFull,
        isBlocked,
        check,
        hasTimingConflict,
        isSevereConflict,
        canForceAllocate,
        timingDiffHours,
        conflictReason,
      };
    });
  }, [rooms, reservations, targetReservation, arrivalDate, departureDate, requestedPax, allotMode, familyMembers, targetFam, targetTour, groups, targetGroup?.key]);

  // Filter evaluated rooms
  const filteredRooms = useMemo(() => {
    if (!targetReservation) return [];

    return evaluatedRooms.filter(({ room }) => {
      // Hotel filter
      if (hotelFilter !== 'ALL' && String(room.building || '').toLowerCase() !== hotelFilter.toLowerCase()) return false;

      // Floor filter
      const fl = room.floorLabel || `Floor ${room.floor}`;
      if (floorFilter !== 'ALL' && fl !== floorFilter) return false;

      // Amenity filter
      if (amenityFilter === 'western' && !String(room.toiletType || '').toLowerCase().includes('western')) return false;
      if (amenityFilter === 'indian' && !String(room.toiletType || '').toLowerCase().includes('indian')) return false;
      if (amenityFilter === 'double' && !String(room.bedType || '').toLowerCase().includes('double')) return false;
      if (amenityFilter === 'single' && !String(room.bedType || '').toLowerCase().includes('single')) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const numMatch = String(room.roomNumber || '').toLowerCase().includes(q);
        const bldgMatch = String(room.building || '').toLowerCase().includes(q);
        const floorMatch = (room.floorLabel || `floor ${room.floor}`).toLowerCase().includes(q);
        const bedMatch = String(room.bedType || '').toLowerCase().includes(q);
        const toiletMatch = String(room.toiletType || '').toLowerCase().includes(q);
        if (!numMatch && !bldgMatch && !floorMatch && !bedMatch && !toiletMatch) return false;
      }

      return true;
    });
  }, [evaluatedRooms, hotelFilter, floorFilter, amenityFilter, searchQuery, targetReservation]);

  // Sort: Recommended rooms (where family is or vacant with high capacity) first
  // Note: Do not prioritize current room as top recommendation to avoid confusion
  const sortedRooms = useMemo(() => {
    if (!targetReservation) return [];

    return [...filteredRooms].sort((a, b) => {
      // Rooms where other family members are already allotted (exclude current room)
      const aFam = a.familyInRoom.length > 0 && !a.isCurrent;
      const bFam = b.familyInRoom.length > 0 && !b.isCurrent;
      if (aFam && !bFam) return -1;
      if (!aFam && bFam) return 1;

      // Available rooms before full/blocked
      if (a.canFit && !b.canFit) return -1;
      if (!a.canFit && b.canFit) return 1;

      // Blocked at bottom
      if (a.isBlocked && !b.isBlocked) return 1;
      if (!a.isBlocked && b.isBlocked) return -1;

      // By room number numerically
      const numA = parseInt(String(a.room.roomNumber || ''), 10) || 999;
      const numB = parseInt(String(b.room.roomNumber || ''), 10) || 999;
      return numA - numB;
    });
  }, [filteredRooms, targetReservation]);

  // Handle single or batch allotment
  const handleSelectRoom = (bldg: string, rNum: string, isForce: boolean = false) => {
    if (!targetReservation) return;
    const safeTour = String(targetReservation.tourRefNo || targetReservation.tourId || '');
    const safeFam = String(targetReservation.family || '');
    if (allotMode === 'family' && isFamily && onBatchAllotFamily) {
      onBatchAllotFamily(safeTour, safeFam, bldg, rNum, isForce, familyMembers.map((m) => m.id));
    } else {
      onAllotRoom(targetReservation.id, bldg, rNum, isForce);
    }
    onClose();
  };

  // Pick a room in the list and bring it into view.
  const pickRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
    requestAnimationFrame(() => {
      const el = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-room-id]') || []).find(
        (n) => n.dataset.roomId === roomId
      );
      el?.scrollIntoView({ block: 'nearest' });
    });
  };

  // Auto-recommend best available room (excluding current room to avoid confusion).
  // It selects the room; staff confirm with the footer button like any other choice.
  const handleAutoRecommend = () => {
    if (!targetReservation) return;

    // 1. Check if room with existing family has capacity (exclude current room)
    const familyRoom = sortedRooms.find((r) => r.familyInRoom.length > 0 && r.canFit && !r.isBlocked && !r.isCurrent);
    if (familyRoom) {
      pickRoom(familyRoom.room.id);
      return;
    }

    // 2. Find best available vacant room with capacity (exclude current room)
    const bestVacant = sortedRooms.find((r) => r.canFit && !r.isBlocked && r.currentOccupancy === 0 && !r.isCurrent);
    if (bestVacant) {
      pickRoom(bestVacant.room.id);
      return;
    }

    // 3. Find any partially filled room with buffer/slots (exclude current room)
    const anyAvailable = sortedRooms.find((r) => r.canFit && !r.isBlocked && !r.isCurrent);
    if (anyAvailable) {
      pickRoom(anyAvailable.room.id);
      return;
    }

    alert('No suitable room found with sufficient remaining capacity for the selected dates.');
  };

  if (!isOpen || !targetReservation) return null;

  type RoomItem = (typeof evaluatedRooms)[number];

  // One state per room, in plain words. Tone follows the colour table: ok fits, wait look first, bad conflict.
  const roomState = (item: RoomItem): { tone: ChipTone; label: string } => {
    if (item.isCurrent) return { tone: 'neutral', label: 'Current room' };
    if (item.isBlocked) return { tone: 'bad', label: 'Blocked' };
    if (item.hasTimingConflict && item.isSevereConflict) return { tone: 'bad', label: 'Turnover conflict' };
    if (item.currentOccupancy + requestedPax > item.maxCap) return { tone: 'bad', label: item.isFull ? 'Full' : 'Over capacity' };
    if (!item.canFit) return { tone: 'bad', label: 'Does not fit' };
    if (item.hasTimingConflict) return { tone: 'wait', label: 'Same-day turnover' };
    if (item.familyInRoom.length > 0) return { tone: 'ok', label: 'Family here' };
    if (item.currentOccupancy > 0) return { tone: 'wait', label: 'Shared room' };
    if (item.currentOccupancy + requestedPax > item.baseCap) return { tone: 'wait', label: 'Uses buffer bed' };
    return { tone: 'ok', label: 'Fits' };
  };

  const selected = selectedRoomId ? evaluatedRooms.find((r) => r.room.id === selectedRoomId) || null : null;
  const selectedUsable = selected && !selected.isCurrent && !selected.isBlocked ? selected : null;
  // Same rule as before: a room that does not fit is allotted with the force flag, so the notice still appears.
  const selectedNeedsForce = !!selectedUsable && !selectedUsable.canFit;
  const selectedOverCapacity = !!selectedUsable && selectedUsable.currentOccupancy + requestedPax > selectedUsable.maxCap;
  const familyMode = allotMode === 'family' && isFamily;
  const tourLabel = targetReservation.tourRefNo || targetReservation.tourId || '—';
  const shownMembers = familyMode ? familyMembers : [targetReservation];

  const confirmLabel = !selectedUsable
    ? 'Allot room'
    : selectedNeedsForce && selectedUsable.hasTimingConflict
    ? `Allot room ${selectedUsable.room.roomNumber} (same-day turnover)`
    : selectedNeedsForce
    ? `Force allot room ${selectedUsable.room.roomNumber}`
    : familyMode
    ? `Allot family to room ${selectedUsable.room.roomNumber}`
    : `Allot room ${selectedUsable.room.roomNumber}`;

  const resetFilters = () => {
    setSearchQuery('');
    setHotelFilter('ALL');
    setFloorFilter('ALL');
    setAmenityFilter('ALL');
  };

  return (
    <div className={modalScrim.replace('z-50', 'z-[100]')}>
      <div
        className={`${modalCard} max-w-5xl lg:h-[min(92dvh,860px)]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-allot-title"
      >
        <div className={modalHeader}>
          <div className="min-w-0">
            <h2 id="quick-allot-title" className={modalTitle}>
              Allot a room
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Choose a room for the stay, then confirm. Nothing is allotted until you do.
            </p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:flex">
          {/* Who is being placed */}
          <aside className="lg:w-[304px] lg:shrink-0 lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-stone-200 px-5 sm:px-6 lg:pr-5 py-5 space-y-5">
            <section>
              <h3 className={groupTitle}>{familyMode ? 'Family being placed' : 'Zair being placed'}</h3>
              <ul className="mt-3 space-y-1.5">
                {shownMembers.slice(0, 8).map((m) => (
                  <li key={m.id} className="text-sm leading-snug">
                    <span className="font-semibold text-stone-950">{m.applicantName}</span>
                    {isInfant(m) && <span className="text-xs text-stone-500"> · infant, no bed</span>}
                    {!familyMode && m.itsId && (
                      <span className="block text-xs text-stone-500 tabular-nums">ITS {m.itsId}</span>
                    )}
                  </li>
                ))}
                {shownMembers.length > 8 && (
                  <li className="text-xs text-stone-500">and {shownMembers.length - 8} more</li>
                )}
              </ul>

              <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
                <dt className="text-stone-500">Family</dt>
                <dd className="text-stone-900">
                  <span className="font-medium">{familyName || '—'}</span>
                  <span className="text-stone-600">
                    {' '}
                    · {familyMembers.length} member{familyMembers.length > 1 ? 's' : ''}
                  </span>
                  {targetGroup?.note && <span className="block text-xs text-stone-500">{targetGroup.note}</span>}
                </dd>
                <dt className="text-stone-500">Tour</dt>
                <dd className="text-stone-900 break-words">
                  <span className="font-medium tabular-nums">{tourLabel}</span>
                  {targetReservation.officeName && (
                    <span className="block text-xs text-stone-500">{targetReservation.officeName}</span>
                  )}
                </dd>
                <dt className="text-stone-500">Stay</dt>
                <dd className="text-stone-900 tabular-nums">
                  <span className="font-medium">
                    {showDate(arrivalDate)}
                    <ArrowRight className="inline w-3.5 h-3.5 mx-1 -mt-0.5 text-stone-500" aria-label="to" />
                    {showDate(departureDate)}
                  </span>
                  {(targetReservation.arrivalTime || targetReservation.departureTime) && (
                    <span className="block text-xs text-stone-500">
                      {[
                        targetReservation.arrivalTime && `arrives ${showTime(targetReservation.arrivalTime)}`,
                        targetReservation.departureTime && `leaves ${showTime(targetReservation.departureTime)}`,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  )}
                </dd>
                <dt className="text-stone-500">Beds</dt>
                <dd className="text-stone-900">
                  <span className="font-semibold tabular-nums">{requestedPax}</span> needed
                  {requestedPax === 0 && <span className="text-stone-500"> (infant shares a bed)</span>}
                </dd>
                {targetReservation.roomNumber && (
                  <>
                    <dt className="text-stone-500">Now in</dt>
                    <dd className="text-stone-900 font-medium tabular-nums">
                      {targetReservation.building} {targetReservation.roomNumber}
                    </dd>
                  </>
                )}
              </dl>

              {onOpenSwitchRoomModal && targetReservation.roomNumber && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenSwitchRoomModal({
                      reservations: [targetReservation],
                      initialScope: isFamily ? 'group' : 'single',
                    })
                  }
                  className={`${btnSm.secondary} max-sm:h-10 mt-3`}
                  title="Switch or swap room with another room"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  Switch room
                </button>
              )}
            </section>

            {isFamily && (
              <section>
                <h3 className={fieldLabel}>Allot for</h3>
                <div className={`${segWrap} w-full`} role="group" aria-label="Allot for">
                  <button
                    type="button"
                    onClick={() => setAllotMode('single')}
                    aria-pressed={allotMode === 'single'}
                    className={`${segBtn(allotMode === 'single')} flex-1`}
                  >
                    This zair only
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllotMode('family')}
                    aria-pressed={allotMode === 'family'}
                    className={`${segBtn(allotMode === 'family')} flex-1 inline-flex items-center justify-center gap-1.5`}
                  >
                    <Users className="w-4 h-4" />
                    Whole family ({familyMembers.length})
                  </button>
                </div>
              </section>
            )}
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
                    placeholder="Search room number or floor"
                    aria-label="Search rooms"
                    className={`${field} pl-9 pr-10`}
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="absolute right-0 top-0 w-10 h-10 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-900 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <select
                  value={amenityFilter}
                  onChange={(e) => setAmenityFilter(e.target.value as typeof amenityFilter)}
                  aria-label="Bed or toilet type"
                  className={`${field} sm:w-44`}
                >
                  <option value="ALL">Any bed or toilet</option>
                  <option value="western">Western toilet</option>
                  <option value="indian">Indian toilet</option>
                  <option value="double">Double bed</option>
                  <option value="single">Single beds</option>
                </select>
                <button type="button" onClick={handleAutoRecommend} className={`${btn.secondary} shrink-0`}>
                  <Sparkles className="w-4 h-4" />
                  Auto-recommend
                </button>
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
                    All <span className="tabular-nums font-normal text-stone-500">{rooms.length}</span>
                  </button>
                  {distinctBuildings.map((bldg) => {
                    const bCount = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length;
                    const on = hotelFilter.toLowerCase() === bldg.toLowerCase();
                    return (
                      <button
                        key={bldg}
                        type="button"
                        onClick={() => {
                          setHotelFilter(bldg);
                          setFloorFilter('ALL');
                        }}
                        aria-pressed={on}
                        className={segBtn(on)}
                      >
                        {bldg} <span className="tabular-nums font-normal text-stone-500">{bCount}</span>
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

            <div ref={listRef} className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto px-5 sm:px-6 lg:pl-5 py-3 min-h-[300px]">
              {sortedRooms.length === 0 ? (
                <div className="py-14 text-center">
                  <p className="text-sm font-semibold text-stone-900">No rooms match these filters</p>
                  <p className="mt-1 text-[13px] text-stone-600">Clear the search or choose another building or floor.</p>
                  <button type="button" onClick={resetFilters} className={`${btn.secondary} mt-4`}>
                    Reset filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {sortedRooms.map((item) => {
                    const {
                      room,
                      baseCap,
                      bufCap,
                      maxCap,
                      currentOccupancy,
                      remainingSlots,
                      occupants,
                      familyInRoom,
                      isCurrent,
                      isBlocked,
                      hasTimingConflict,
                      isSevereConflict,
                      timingDiffHours,
                      conflictReason,
                    } = item;
                    const state = roomState(item);
                    const isSelected = selectedRoomId === room.id && !isCurrent && !isBlocked;
                    const overCapacity = currentOccupancy + requestedPax > maxCap && !isCurrent;
                    const details = (
                      <>
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
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
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
                              ? 'not in use'
                              : currentOccupancy === 0
                              ? 'empty'
                              : `${currentOccupancy} of ${maxCap} taken, ${remainingSlots} free`}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-stone-500">
                          {getRoomBedCount(room)} × {sentence(room.bedType || 'Single Beds')} ·{' '}
                          {sentence(room.toiletType || 'Standard')} toilet
                        </div>

                        {familyInRoom.length > 0 && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs font-medium text-emerald-800">
                            <Users className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              Family {familyName} is here: {familyInRoom.map((m) => m.applicantName.split(' ')[0]).join(', ')}
                            </span>
                          </div>
                        )}

                        {occupants.length > 0 && (
                          <div
                            className="mt-1.5 text-xs text-stone-600 truncate"
                            title={occupants.map((o) => `${o.applicantName} (${o.family})`).join(' · ')}
                          >
                            <span className="text-stone-500">In the room ({occupants.length}): </span>
                            {occupants.map((o) => `${o.applicantName} (${o.family})`).join(' · ')}
                          </div>
                        )}

                        {hasTimingConflict && (
                          <div
                            className={`mt-1.5 flex items-start gap-1.5 text-xs ${
                              isSevereConflict ? 'text-rose-700' : 'text-amber-800'
                            }`}
                            title={conflictReason}
                          >
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              {isSevereConflict
                                ? `Turnover conflict: departure is ${timingDiffHours}h after arrival (over 15h)`
                                : `Same-day turnover: departure is ${timingDiffHours}h after arrival`}
                            </span>
                          </div>
                        )}

                        {overCapacity && (
                          <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-700">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              Not vacant or over the limit: would hold {currentOccupancy + requestedPax} of {maxCap}
                            </span>
                          </div>
                        )}
                      </>
                    );

                    if (isCurrent) {
                      return (
                        <div
                          key={room.id}
                          data-room-id={room.id}
                          className="rounded-xl bg-stone-50 ring-1 ring-inset ring-stone-300 p-3.5"
                        >
                          {details}
                          <div className="mt-2.5 pt-2.5 border-t border-stone-200 flex items-center justify-between gap-2">
                            <span className="text-xs text-stone-600">This is where the zair is now.</span>
                            <button
                              type="button"
                              onClick={() => {
                                onAllotRoom(targetReservation.id, targetReservation.building || 'Saifee', '');
                                onClose();
                              }}
                              className={`${btnSm.danger} max-sm:h-10`}
                            >
                              Unallot
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={room.id}
                        type="button"
                        data-room-id={room.id}
                        disabled={isBlocked}
                        aria-pressed={isSelected}
                        onClick={() => setSelectedRoomId(room.id)}
                        title={isBlocked ? 'Room blocked' : conflictReason || undefined}
                        className={`flex flex-col justify-start items-stretch w-full text-left rounded-xl p-3.5 ring-inset ${
                          isBlocked
                            ? 'bg-stone-50 ring-1 ring-stone-200 opacity-60 cursor-not-allowed'
                            : isSelected
                            ? 'bg-brand-50 ring-2 ring-brand-500 cursor-pointer'
                            : 'bg-white ring-1 ring-stone-200 hover:ring-stone-400 hover:bg-stone-50 cursor-pointer'
                        }`}
                      >
                        {details}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* What the code will ask about this room, in plain words, before it is allotted */}
        {selectedUsable && (selectedUsable.hasTimingConflict || selectedOverCapacity) && (
          <div className="shrink-0 border-t border-stone-200 px-5 sm:px-6 py-3 space-y-2 max-h-[30dvh] overflow-y-auto">
            {selectedUsable.hasTimingConflict && (
              <div
                role="alert"
                className={`flex items-start gap-2.5 rounded-xl px-4 py-3 ring-1 ring-inset ${
                  selectedUsable.isSevereConflict
                    ? 'bg-rose-50 ring-rose-200 text-rose-800'
                    : 'bg-amber-50 ring-amber-200 text-amber-800'
                }`}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="min-w-0 text-[13px] leading-relaxed">
                  <p className="font-semibold">
                    {selectedUsable.isSevereConflict
                      ? `Turnover conflict in room ${selectedUsable.room.roomNumber}: departure is ${selectedUsable.timingDiffHours}h after arrival (over 15h)`
                      : `Same-day turnover in room ${selectedUsable.room.roomNumber}: departure is ${selectedUsable.timingDiffHours}h after arrival`}
                  </p>
                  {selectedUsable.conflictReason && <p className="mt-0.5">{selectedUsable.conflictReason}</p>}
                </div>
              </div>
            )}
            {selectedOverCapacity && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl px-4 py-3 ring-1 ring-inset bg-rose-50 ring-rose-200 text-rose-800"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="min-w-0 text-[13px] leading-relaxed">
                  <p className="font-semibold">
                    Room {selectedUsable.room.roomNumber} is not vacant or would go over its limit (
                    {selectedUsable.currentOccupancy + requestedPax} of {selectedUsable.maxCap})
                  </p>
                  <p className="mt-0.5">
                    The room is occupied or this would exceed its maximum. You can still force allot it; you will be
                    asked to confirm the notice.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`${modalFooter} sm:justify-between`}>
          <p className="max-sm:w-full text-[13px] text-stone-600 tabular-nums">
            {selectedUsable ? (
              <>
                Selected:{' '}
                <span className="font-semibold text-stone-950">
                  {selectedUsable.room.building} {selectedUsable.room.roomNumber}
                </span>{' '}
                for {familyMode ? `${familyMembers.length} zaereen` : '1 zair'}
              </>
            ) : (
              <>
                {sortedRooms.length} of {rooms.length} rooms shown. Choose one to allot.
              </>
            )}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={onClose} className={btn.ghost}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedUsable}
              onClick={() => {
                if (!selectedUsable) return;
                handleSelectRoom(selectedUsable.room.building, selectedUsable.room.roomNumber, selectedNeedsForce);
              }}
              className={btn.primary}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
