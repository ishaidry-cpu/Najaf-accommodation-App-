import React, { useState, useMemo, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Users,
  CheckCircle2,
  Search,
  LogOut,
  LogIn,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Maximize2,
  Minimize2,
  RefreshCw,
  Plus,
  Check,
  ArrowRightLeft,
  X
} from 'lucide-react';
import { Room, Reservation, UserRole } from '../types';
import {
  getRoomMaxCapacity,
  getRoomBedCount,
  getRoomBookingsOnDate,
  getRoomStatusOnDate,
  checkRoomAllotmentAvailability,
  getDistinctBuildings,
  countEffectivePax
} from '../services/storage';
import { checkTurnoverTimingConflict } from '../utils/turnoverTiming';
import { formatDay, segBtn, segTrack } from './RoomSpecFields';
import { btn, btnSm, card, chip, field, fieldLabel, fieldSm, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle, panel } from './ui';

/** Toolbar controls grow to a full 40px touch target on phones. */
const tap = 'max-sm:h-10';
const navBtn =
  'inline-flex items-center justify-center h-10 sm:h-9 px-2.5 text-[13px] font-medium text-stone-700 hover:bg-stone-50 hover:text-stone-950 transition cursor-pointer whitespace-nowrap';

/**
 * Timeline cells. One block per day: a soft fill with a 1px ring of the same family.
 * Occupied recedes (stone); vacant is a quiet emerald; amber = room freeing up, blue = arrival,
 * purple = same-day turnover (amber / rose when the times clash), hatched stone = blocked.
 * The legend draws its swatches from this same map.
 */
const cellBase =
  'min-h-10 rounded-md px-1.5 py-1 flex flex-col items-center justify-center text-center leading-tight ring-1 ring-inset transition';
const cellSub = 'text-[11px] keep-size leading-tight tabular-nums';
const cellHover = 'group-hover/cell:brightness-[0.96]';
const cellTone = {
  vacant: 'bg-emerald-50 ring-emerald-200/70',
  occupied: 'bg-stone-100 ring-stone-200 text-stone-800',
  out: 'bg-amber-50 ring-amber-200 text-amber-900',
  in: 'bg-blue-50 ring-blue-200 text-blue-800',
  turnover: 'bg-purple-50 ring-purple-200 text-purple-800',
  late: 'bg-amber-50 ring-amber-300 text-amber-900',
  severe: 'bg-rose-50 ring-rose-300 text-rose-800',
  blocked: 'ring-stone-200 bg-[repeating-linear-gradient(135deg,var(--color-stone-200)_0_3px,var(--color-stone-50)_3px_9px)]',
} as const;

/** "06:00 PM" reads as "6 PM" inside a narrow turnover cell; the tooltip keeps the full times. */
const shortTime = (value?: string) => (value || '').replace(/^0(\d)/, '$1').replace(/:00(?=\s|$)/, '');

interface RoomTimelineViewProps {
  rooms: Room[];
  reservations: Reservation[];
  onAllotRoom: (reservationId: string, building: string, roomNumber: string) => void;
  onBatchAllotFamily?: (tourRefNo: string, family: string, building: string, roomNumber: string) => void;
  onAddReservation?: (newReservation: Reservation) => boolean | void;
  userRole?: UserRole;
  onOpenReceptionSlip?: (tab?: 'arrival_slip' | 'departure_list' | 'turnover' | 'roster' | 'worker_summary' | 'portal_upload') => void;
  onOpenQuickAllotModal?: (res: Reservation) => void;
  onOpenAddBuildingRooms?: () => void;
  onRefreshLiveComputerData?: () => Promise<void> | void;
}

export const RoomTimelineView: React.FC<RoomTimelineViewProps> = ({
  rooms,
  reservations,
  onAllotRoom,
  onBatchAllotFamily,
  onAddReservation,
  userRole = 'admin',
  onOpenReceptionSlip,
  onOpenQuickAllotModal,
  onOpenAddBuildingRooms,
  onRefreshLiveComputerData,
}) => {
  const isReadOnly = userRole === 'receptionist';

  // Refresh Timeline state (refreshes all data on same computer without changing startDateStr)
  const [isRefreshingTimeline, setIsRefreshingTimeline] = useState(false);
  const handleRefreshTimeline = async () => {
    setIsRefreshingTimeline(true);
    try {
      if (onRefreshLiveComputerData) {
        await onRefreshLiveComputerData();
      }
    } finally {
      setIsRefreshingTimeline(false);
    }
  };

  // Base starting date for the timeline (defaults to today)
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [startDateStr, setStartDateStr] = useState<string>(todayStr);

  // Number of days to display in the top row: 7, 14, 21, or 30 days
  const [dayRange, setDayRange] = useState<number>(14);

  // All buildings in inventory (core 3 + any custom buildings added by user)
  const distinctBuildings = useMemo(() => {
    return getDistinctBuildings(rooms);
  }, [rooms]);

  // Existing Tour IDs for auto-suggestion datalist
  const existingTourIds = useMemo(() => {
    return Array.from(new Set(reservations.map((r) => (r.tourRefNo || '').trim()).filter(Boolean))).sort();
  }, [reservations]);

  // Filters
  const [hotelFilter, setHotelFilter] = useState<string>('ALL');
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [capacityFilter, setCapacityFilter] = useState<string>('ALL');
  // One chip per room size in the inventory, so custom room sizes can be filtered too.
  const capacityOptions = useMemo(
    () => Array.from(new Set(rooms.map((r) => Number(r.capacity || r.pax || 0)).filter((n) => n > 0)))
      .sort((a, b) => a - b)
      .map(String),
    [rooms]
  );
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'vacant' | 'departing' | 'occupied'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected unallotted zaer for 1-click timeline assignment
  const [selectedZaerToAllot, setSelectedZaerToAllot] = useState<Reservation | null>(null);

  // Hovered booking detail tooltip or modal (Guest Stay & Room Details)
  const [hoveredReservation, setHoveredReservation] = useState<Reservation | null>(null);
  const [inspectedRoomTimeline, setInspectedRoomTimeline] = useState<Room | null>(null);

  // In-modal Room Change state for Guest Stay & Room Details
  const [modalChangeBuilding, setModalChangeBuilding] = useState<string>('Saifee');
  const [modalChangeRoomNumber, setModalChangeRoomNumber] = useState<string>('');
  const [modalChangeApplyToFamily, setModalChangeApplyToFamily] = useState<boolean>(true);
  const [modalRoomChangeSuccess, setModalRoomChangeSuccess] = useState<string | null>(null);
  const [modalRoomChangeError, setModalRoomChangeError] = useState<string | null>(null);

  // Instant Room Booking Modal state (when clicking vacant slot)
  const [instantBookingModal, setInstantBookingModal] = useState<{ room: Room; dateStr: string } | null>(null);
  const [instantTourId, setInstantTourId] = useState<string>('');
  const [instantApplicantName, setInstantApplicantName] = useState<string>('');
  const [instantFamilyNumber, setInstantFamilyNumber] = useState<string>('F-1');
  const [instantPax, setInstantPax] = useState<number>(2);
  const [instantArrivalDate, setInstantArrivalDate] = useState<string>('');
  const [instantArrivalTime, setInstantArrivalTime] = useState<string>('11:00 AM');
  const [instantDepartureDate, setInstantDepartureDate] = useState<string>('');
  const [instantDepartureTime, setInstantDepartureTime] = useState<string>('01:00 AM');
  const [instantRemarks, setInstantRemarks] = useState<string>('');
  const [instantCategory, setInstantCategory] = useState<string>('Category A (Nizaam)');
  const [instantGender, setInstantGender] = useState<'Male' | 'Female'>('Male');
  const [instantAge, setInstantAge] = useState<string>('45');
  const [instantItsId, setInstantItsId] = useState<string>('');
  const [instantError, setInstantError] = useState<string | null>(null);
  const [instantSuccess, setInstantSuccess] = useState<string | null>(null);

  // Sync in-modal change room defaults when hoveredReservation changes
  useEffect(() => {
    if (hoveredReservation) {
      setModalChangeBuilding(hoveredReservation.building || 'Saifee');
      setModalChangeRoomNumber(hoveredReservation.roomNumber || '');
      setModalRoomChangeSuccess(null);
      setModalRoomChangeError(null);
    }
  }, [hoveredReservation]);

  // Full-width expand state
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Calculate array of dates for top row
  const timelineDates = useMemo(() => {
    const dates: string[] = [];
    const base = new Date(startDateStr);
    if (isNaN(base.getTime())) {
      base.setTime(new Date().getTime());
    }

    for (let i = 0; i < dayRange; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }, [startDateStr, dayRange]);

  // Navigate date controls
  const handleShiftDays = (days: number) => {
    const base = new Date(startDateStr);
    base.setDate(base.getDate() + days);
    setStartDateStr(base.toISOString().slice(0, 10));
  };

  const handleResetToToday = () => {
    setStartDateStr(todayStr);
  };

  // Unallotted zaereen
  const unallottedZaereen = useMemo(() => {
    return reservations.filter((r) => !r.roomNumber || r.roomNumber.trim() === '');
  }, [reservations]);

  // Floor options based on building
  const floorOptions = useMemo(() => {
    const fls: string[] = [];
    rooms.forEach((r) => {
      if (hotelFilter !== 'ALL' && r.building.toLowerCase() !== hotelFilter.toLowerCase()) return;
      const fl = r.floorLabel || `Floor ${r.floor}`;
      if (!fls.includes(fl)) fls.push(fl);
    });
    return ['ALL', ...fls];
  }, [rooms, hotelFilter]);

  // Calculate Next Vacancy Date / Info for each room
  // "showing when the room will be vacant as per the date of departures"
  const roomVacancySummary = useMemo(() => {
    const map = new Map<string, {
      isCurrentlyVacant: boolean;
      currentOccupants: Reservation[];
      nextDepartureDate: string | null;
      nextDepartureZaer: string | null;
      vacantFromText: string;
      hasUpcomingDepartureInRange: boolean;
      allDeparturesInDates: { date: string; reservation: Reservation }[];
    }>();

    rooms.forEach((room) => {
      const rBldg = (room.building || '').toLowerCase();
      const rNum = (room.roomNumber || '').toLowerCase();

      // All active bookings for this room
      const roomBookings = reservations.filter((r) => {
        const b = (r.building || '').toLowerCase();
        const n = (r.roomNumber || '').toLowerCase();
        return b === rBldg && n === rNum && n !== '';
      });

      // Today's bookings
      const todayBookings = roomBookings.filter((r) => {
        const arr = (r.arrivalDate || '').slice(0, 10);
        const dep = (r.departureDate || '').slice(0, 10);
        return arr <= todayStr && dep >= todayStr;
      });

      const isCurrentlyVacant = todayBookings.length === 0;

      // Find future or today departures
      const futureOrTodayDeps = roomBookings
        .filter((r) => (r.departureDate || '').slice(0, 10) >= todayStr)
        .sort((a, b) => (a.departureDate || '').localeCompare(b.departureDate || ''));

      const nextDep = futureOrTodayDeps[0] || null;

      // Departures falling inside the current visible timeline range
      const visibleDepartures = roomBookings
        .filter((r) => {
          const d = (r.departureDate || '').slice(0, 10);
          return timelineDates.includes(d);
        })
        .map((r) => ({
          date: (r.departureDate || '').slice(0, 10),
          reservation: r,
        }));

      let vacantFromText = 'Vacant Now';
      if (!isCurrentlyVacant) {
        if (nextDep) {
          const depDate = (nextDep.departureDate || '').slice(0, 10);
          vacantFromText = `Vacant on ${depDate}`;
        } else {
          vacantFromText = 'Occupied';
        }
      }

      map.set(`${room.building}_${room.roomNumber}`, {
        isCurrentlyVacant,
        currentOccupants: todayBookings,
        nextDepartureDate: nextDep ? (nextDep.departureDate || '').slice(0, 10) : null,
        nextDepartureZaer: nextDep ? nextDep.applicantName : null,
        vacantFromText,
        hasUpcomingDepartureInRange: visibleDepartures.length > 0,
        allDeparturesInDates: visibleDepartures,
      });
    });

    return map;
  }, [rooms, reservations, todayStr, timelineDates]);

  // Daily statistics for top header row (Arrivals, Departures, Vacancy counts)
  const dailyMetrics = useMemo(() => {
    const map = new Map<string, { arrivals: number; departures: number; vacant: number; occupied: number }>();

    timelineDates.forEach((dateStr) => {
      let arrCount = 0;
      let depCount = 0;
      let occCount = 0;
      let vacCount = 0;

      rooms.forEach((r) => {
        const st = getRoomStatusOnDate(r, dateStr, reservations);
        if (st === 'occupied') occCount++;
        else vacCount++;

        const rBldg = (r.building || '').toLowerCase();
        const rNum = (r.roomNumber || '').toLowerCase();

        // Check if anyone arrives or departs on this room on dateStr
        const rArrs = reservations.filter((res) => {
          const b = (res.building || '').toLowerCase();
          const n = (res.roomNumber || '').toLowerCase();
          return b === rBldg && n === rNum && (res.arrivalDate || '').slice(0, 10) === dateStr;
        });

        const rDeps = reservations.filter((res) => {
          const b = (res.building || '').toLowerCase();
          const n = (res.roomNumber || '').toLowerCase();
          return b === rBldg && n === rNum && (res.departureDate || '').slice(0, 10) === dateStr;
        });

        arrCount += rArrs.length;
        depCount += rDeps.length;
      });

      map.set(dateStr, {
        arrivals: arrCount,
        departures: depCount,
        vacant: vacCount,
        occupied: occCount,
      });
    });

    return map;
  }, [timelineDates, rooms, reservations]);

  // Filtered rooms to display in horizontal rows
  const displayedRooms = useMemo(() => {
    return rooms.filter((room) => {
      // Hotel filter
      if (hotelFilter !== 'ALL' && room.building.toLowerCase() !== hotelFilter.toLowerCase()) {
        return false;
      }

      // Floor filter
      if (floorFilter !== 'ALL') {
        const fl = room.floorLabel || `Floor ${room.floor}`;
        if (fl !== floorFilter) return false;
      }

      // Capacity filter: 2 pax / 3 pax / 4 pax
      if (capacityFilter !== 'ALL') {
        const cap = Number(capacityFilter);
        const roomCap = Number(room.capacity || room.pax || 0);
        if (roomCap !== cap) return false;
      }

      // Room vacancy info
      const vacInfo = roomVacancySummary.get(`${room.building}_${room.roomNumber}`);

      // Status filter
      if (statusFilter === 'vacant') {
        if (!vacInfo?.isCurrentlyVacant) return false;
      } else if (statusFilter === 'departing') {
        if (!vacInfo?.hasUpcomingDepartureInRange) return false;
      } else if (statusFilter === 'occupied') {
        if (vacInfo?.isCurrentlyVacant) return false;
      }

      // Search query (matches room number, building, floor, or occupant name/ITS)
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchRoom = room.roomNumber.toLowerCase().includes(q);
        const matchBldg = room.building.toLowerCase().includes(q);
        
        // Also search occupants
        const rBldg = (room.building || '').toLowerCase();
        const rNum = (room.roomNumber || '').toLowerCase();
        const matchOccupant = reservations.some((r) => {
          const b = (r.building || '').toLowerCase();
          const n = (r.roomNumber || '').toLowerCase();
          return (
            b === rBldg &&
            n === rNum &&
            ((r.applicantName || '').toLowerCase().includes(q) ||
              (r.itsId || '').toLowerCase().includes(q) ||
              (r.family || '').toLowerCase().includes(q) ||
              (r.tourRefNo || '').toLowerCase().includes(q))
          );
        });

        if (!matchRoom && !matchBldg && !matchOccupant) return false;
      }

      return true;
    });
  }, [rooms, hotelFilter, floorFilter, capacityFilter, statusFilter, searchQuery, roomVacancySummary, reservations]);

  // Quick allot action when clicking on a vacant cell
  const handleCellClick = (room: Room, dateStr: string) => {
    if (isReadOnly) {
      return;
    }

    if (selectedZaerToAllot) {
      // Validate availability
      const check = checkRoomAllotmentAvailability(
        room.building,
        room.roomNumber,
        selectedZaerToAllot.arrivalDate || dateStr,
        selectedZaerToAllot.departureDate || dateStr,
        rooms,
        reservations,
        1,
        selectedZaerToAllot.id
      );

      if (!check.allowed) {
        alert(`Cannot allot: ${check.reason}`);
        return;
      }

      onAllotRoom(selectedZaerToAllot.id, room.building, room.roomNumber);
      setSelectedZaerToAllot(null);
    } else {
      // User requirement: When clicking on vacant slot, allot rooms directly even if Tour ID is not in database,
      // with remarks, and optional names and family numbers.
      const arr = new Date(dateStr);
      const dep = new Date(arr);
      dep.setDate(arr.getDate() + 3);
      const defaultDepStr = dep.toISOString().slice(0, 10);

      setInstantTourId('');
      setInstantApplicantName('');
      setInstantFamilyNumber('F-1');
      setInstantPax(room.capacity || 2);
      setInstantArrivalDate(dateStr);
      setInstantArrivalTime('11:00 AM');
      setInstantDepartureDate(defaultDepStr);
      setInstantDepartureTime('01:00 AM');
      setInstantRemarks('');
      setInstantCategory(room.category || 'Category A (Nizaam)');
      setInstantGender('Male');
      setInstantAge('45');
      setInstantItsId('');
      setInstantError(null);
      setInstantSuccess(null);
      setInstantBookingModal({ room, dateStr });
    }
  };

  // Instant booking form submission handler
  const handleInstantBookingSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!instantBookingModal) return;

    const tourClean = instantTourId.trim();
    if (!tourClean) {
      setInstantError('Please enter a Tour ID to book this room (you can enter any new or existing Tour ID).');
      return;
    }

    if (!instantArrivalDate || !instantDepartureDate) {
      setInstantError('Please select valid Arrival and Departure dates.');
      return;
    }

    if (instantDepartureDate < instantArrivalDate) {
      setInstantError('Departure date cannot be earlier than Arrival date.');
      return;
    }

    const { room } = instantBookingModal;
    const finalPax = Math.max(1, instantPax || 1);
    const guestName = instantApplicantName.trim() || `Guest (Tour ${tourClean})`;
    const famNumber = instantFamilyNumber.trim() || 'F-1';
    const newId = `instant_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newItsId = instantItsId.trim() || `${Math.floor(10000000 + Math.random() * 90000000)}`;

    const newReservation: Reservation = {
      id: newId,
      itsId: newItsId,
      applicantName: guestName,
      tourRefNo: tourClean,
      family: famNumber,
      building: room.building,
      roomNumber: room.roomNumber,
      arrivalDate: instantArrivalDate,
      arrivalTime: instantArrivalTime || '11:00 AM',
      departureDate: instantDepartureDate,
      departureTime: instantDepartureTime || '01:00 AM',
      rawArrivalStr: `${instantArrivalDate} ${instantArrivalTime || '11:00 AM'}`.trim(),
      rawDepartureStr: `${instantDepartureDate} ${instantDepartureTime || '01:00 AM'}`.trim(),
      remarks: instantRemarks.trim(),
      notes: instantRemarks.trim(),
      category: (instantCategory as any) || room.category || 'Category A (Nizaam)',
      pax: finalPax,
      paxCount: finalPax,
      age: parseInt(instantAge) || 45,
      gender: instantGender,
      jamaat: 'Direct Booking',
      idara: '',
      officeName: 'Faiz E Husayni',
      groupLeadName: guestName,
      moneyGiven: 'No',
      isUploadedToPortal: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isRoomChanged: false,
      roomChangeHistory: [],
    };

    if (onAddReservation) {
      onAddReservation(newReservation);
    }

    onAllotRoom(newId, room.building, room.roomNumber);

    setInstantSuccess(`✓ Room ${room.roomNumber} (${room.building}) successfully booked & allotted to Tour ${tourClean}!`);
    setTimeout(() => {
      setInstantBookingModal(null);
      setInstantSuccess(null);
    }, 1200);
  };

  const todayCol = 'bg-brand-50/60';

  return (
    <>
    {isExpanded && <div aria-hidden="true" className="fixed inset-0 z-50 bg-stone-950/50" />}
    <div className={`${card} flex flex-col ${
      isExpanded ? 'fixed inset-2 sm:inset-3 z-50 shadow-2xl! overflow-y-auto p-4 sm:p-5 gap-4' : 'p-4 sm:p-5 gap-4'
    }`}>
      {/* ========================================================================= */}
      {/* TIMELINE CONTROLS & HEADER                                                */}
      {/* ========================================================================= */}
      <div className="flex flex-col gap-3 shrink-0">

        {/* Title and actions */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold leading-tight text-stone-950">
                Room timeline
              </h2>
              {isReadOnly && <span className={chip('neutral')}>View only</span>}
            </div>
            <p className="mt-1 text-sm text-stone-600 text-pretty">
              Each row is a room, each column a day. See who is in, who leaves, and when a room frees up.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenReceptionSlip && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenReceptionSlip('arrival_slip')}
                  className={`${btnSm.secondary} ${tap}`}
                  title="Open the arrival slip"
                >
                  <LogIn className="w-4 h-4 text-stone-500" />
                  <span>Arrival slip</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenReceptionSlip('departure_list')}
                  className={`${btnSm.secondary} ${tap}`}
                  title="Open the departure list"
                >
                  <LogOut className="w-4 h-4 text-stone-500" />
                  <span>Departure list</span>
                </button>
              </>
            )}

            {onOpenAddBuildingRooms && !isReadOnly && (
              <button
                type="button"
                onClick={onOpenAddBuildingRooms}
                className={`${btnSm.secondary} ${tap}`}
                title="Add new building or rooms"
              >
                <Plus className="w-4 h-4 text-stone-500" />
                <span>Add building / rooms</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className={`${isExpanded ? btnSm.secondary : btnSm.ghost} ${tap}`}
              title={isExpanded ? 'Collapse timeline' : 'Expand full screen'}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              <span>{isExpanded ? 'Collapse' : 'Full screen'}</span>
            </button>
          </div>
        </div>

        {/* Row 1: which days. Date navigation on the left, how many days on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-3 border-t border-stone-200">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg bg-white ring-1 ring-inset ring-stone-300 divide-x divide-stone-200 overflow-hidden">
              <button
                type="button"
                onClick={() => handleShiftDays(-dayRange)}
                className={navBtn}
                title={`Previous ${dayRange} days`}
                aria-label={`Previous ${dayRange} days`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleShiftDays(-1)}
                className={navBtn}
                title="Previous 1 day"
              >
                −1 day
              </button>
              <button
                type="button"
                onClick={handleResetToToday}
                aria-pressed={startDateStr === todayStr}
                className={`${navBtn} ${startDateStr === todayStr ? 'bg-brand-50 text-brand-800! font-semibold' : ''}`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleShiftDays(1)}
                className={navBtn}
                title="Next 1 day"
              >
                +1 day
              </button>
              <button
                type="button"
                onClick={() => handleShiftDays(dayRange)}
                className={navBtn}
                title={`Next ${dayRange} days`}
                aria-label={`Next ${dayRange} days`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Custom Date Jump */}
            <input
              type="date"
              aria-label="First day shown"
              title="Jump to a date"
              value={startDateStr}
              onChange={(e) => setStartDateStr(e.target.value)}
              className={`${fieldSm} ${tap} tabular-nums cursor-pointer`}
            />

            {/* Refresh Timeline (reloads data fed in this computer without changing startDateStr) */}
            <button
              type="button"
              onClick={handleRefreshTimeline}
              disabled={isRefreshingTimeline}
              className={`${btnSm.ghost} h-10! sm:h-9!`}
              title="Refresh timeline: pulls all rooms and zaereen data fed in this computer without changing the timeline date"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshingTimeline ? 'animate-spin' : ''}`} />
              <span>{isRefreshingTimeline ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          </div>

          {/* Day count window */}
          <div role="group" aria-label="Days shown" className={segTrack}>
            {[7, 14, 21, 30].map((num) => (
              <button
                key={num}
                type="button"
                aria-pressed={dayRange === num}
                onClick={() => setDayRange(num)}
                className={segBtn(dayRange === num)}
              >
                {num} days
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: which rooms. Building, floor, capacity, vacancy switch, search. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select
            aria-label="Building"
            value={distinctBuildings.find((b) => b.toLowerCase() === hotelFilter.toLowerCase()) ?? 'ALL'}
            onChange={(e) => setHotelFilter(e.target.value)}
            className={`${fieldSm} ${tap} col-span-2 min-w-0`}
          >
            <option value="ALL">All buildings ({rooms.length})</option>
            {distinctBuildings.map((bldg) => {
              const bCount = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length;
              return (
                <option key={bldg} value={bldg}>
                  {bldg} ({bCount})
                </option>
              );
            })}
          </select>

          {/* Floor filter */}
          <select
            aria-label="Floor"
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
            className={`${fieldSm} ${tap} min-w-0`}
          >
            {floorOptions.map((fl) => (
              <option key={fl} value={fl}>
                {fl === 'ALL' ? 'All floors' : fl}
              </option>
            ))}
          </select>

          {/* Capacity filter: one option per room size in the inventory */}
          <select
            aria-label="Capacity"
            title="Show only rooms that sleep this many"
            value={capacityFilter}
            onChange={(e) => setCapacityFilter(e.target.value)}
            className={`${fieldSm} ${tap} min-w-0`}
          >
            <option value="ALL">Any capacity</option>
            {capacityOptions.map((cap) => (
              <option key={cap} value={cap}>
                {cap} pax
              </option>
            ))}
          </select>

          {/* Status filter: vacant now / departing soon */}
          <div role="group" aria-label="Show rooms" className={`${segTrack} col-span-2 max-sm:flex`}>
            <button
              type="button"
              aria-pressed={statusFilter === 'ALL'}
              onClick={() => setStatusFilter('ALL')}
              className={`${segBtn(statusFilter === 'ALL')} max-sm:flex-1`}
            >
              All
            </button>
            <button
              type="button"
              aria-pressed={statusFilter === 'vacant'}
              onClick={() => setStatusFilter('vacant')}
              className={`${segBtn(statusFilter === 'vacant')} max-sm:flex-1`}
              title="Show only rooms that are currently vacant"
            >
              Vacant now
            </button>
            <button
              type="button"
              aria-pressed={statusFilter === 'departing'}
              onClick={() => setStatusFilter('departing')}
              className={`${segBtn(statusFilter === 'departing')} max-sm:flex-1`}
              title="Show rooms with guests departing in this timeframe (freeing up)"
            >
              Departing soon
            </button>
          </div>

          {/* Search input */}
          <div className="relative col-span-2 sm:ml-auto sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              aria-label="Search the timeline"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search room, zair, ITS"
              className={`${fieldSm} ${tap} w-full pl-9 pr-9`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Unallotted zaereen quick-allot strip (if any need rooms) */}
        {!isReadOnly && unallottedZaereen.length > 0 && (
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2.5">
            <div className="flex items-start gap-2 text-[13px] text-amber-900 min-w-0">
              <Users className="w-4 h-4 mt-0.5 text-amber-700 shrink-0" />
              <span>
                <strong className="font-semibold">{unallottedZaereen.length} zaereen waiting for room allotment.</strong>{' '}
                Choose a zair, then click any vacant cell to allot directly.
              </span>
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <select
                aria-label="Zair to allot"
                value={selectedZaerToAllot?.id || ''}
                onChange={(e) => {
                  const target = unallottedZaereen.find((z) => z.id === e.target.value) || null;
                  setSelectedZaerToAllot(target);
                }}
                className={`${fieldSm} ${tap} min-w-0 w-full lg:w-80`}
              >
                <option value="">Choose zair to allot</option>
                {unallottedZaereen.slice(0, 50).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.applicantName} ({z.family || 'Fam'}, Tour: {z.tourRefNo}) • {z.arrivalDate} to {z.departureDate}
                  </option>
                ))}
              </select>

              {selectedZaerToAllot && (
                <button
                  type="button"
                  onClick={() => setSelectedZaerToAllot(null)}
                  className={`${btnSm.ghost} ${tap} shrink-0`}
                >
                  Clear selection
                </button>
              )}
            </div>
          </div>
        )}

        {/* Legend: the swatches are the cell styles themselves. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs text-stone-700">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {([
              ['vacant', isReadOnly ? 'Vacant' : 'Vacant (click to allot)'],
              ['occupied', 'Occupied'],
              ['out', 'Checkout (room frees up)'],
              ['in', 'Check-in'],
              ['turnover', 'Same-day turnover'],
              ['blocked', 'Blocked'],
            ] as const).map(([tone, label]) => (
              <span key={tone} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className={`w-4 h-3.5 rounded-[4px] ring-1 ring-inset ${cellTone[tone]}`} />
                {label}
              </span>
            ))}
            <span
              className="inline-flex items-center gap-1.5 whitespace-nowrap"
              title="Same-day turnover where the departing zair leaves after the next one arrives"
            >
              <span className={`w-4 h-3.5 rounded-[4px] ring-1 ring-inset flex items-center justify-center ${cellTone.late}`}>
                <AlertTriangle className="w-2.5 h-2.5" />
              </span>
              Turnover clash
            </span>
          </div>

          <div className="text-stone-600 tabular-nums">
            Showing <strong className="font-semibold text-stone-900">{displayedRooms.length}</strong> of {rooms.length} rooms
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TIMELINE MATRIX: TOP ROW OF DATES + HORIZONTAL ROOMS                      */}
      {/* ========================================================================= */}
      <div className={`overflow-auto rounded-xl ring-1 ring-stone-200 bg-white relative ${
        isExpanded ? 'max-h-[68vh] sm:max-h-none sm:flex-1 sm:min-h-[320px]' : 'max-h-[68vh]'
      }`}>
        {/* Fixed layout: the two room columns keep their width, the day columns share the rest (108px at least). */}
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-left"
          style={{ minWidth: `${336 + timelineDates.length * 108}px` }}
        >

          {/* TOP ROW OF DATES (Sticky Header) */}
          <thead className="sticky top-0 z-30">
            <tr>

              {/* Top-left corner: room column */}
              <th className="sticky left-0 z-40 bg-stone-50 px-2.5 sm:px-3 py-2 text-xs font-semibold text-stone-600 border-b border-r border-stone-200 align-bottom w-[132px] sm:w-[200px]">
                Room
              </th>

              {/* When the room is next vacant */}
              <th className="sm:sticky sm:left-[200px] z-40 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-600 border-b border-r border-stone-200 align-bottom w-[136px]">
                <div>When vacant</div>
                <div className="font-normal text-stone-500">Next departure date</div>
              </th>

              {/* Top row of dates */}
              {timelineDates.map((dateStr) => {
                const dateObj = new Date(dateStr);
                const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
                const dayMonth = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
                const isToday = dateStr === todayStr;
                const metrics = dailyMetrics.get(dateStr);

                return (
                  <th
                    key={dateStr}
                    className={`px-1.5 py-2 text-center font-normal border-b border-r border-stone-200 select-none align-bottom ${
                      isToday ? 'bg-brand-50 border-t-2 border-t-brand-500' : 'bg-stone-50 border-t-2 border-t-transparent'
                    }`}
                  >
                    <div className={`text-xs ${isToday ? 'font-semibold text-brand-700' : 'text-stone-500'}`}>
                      {dayName}{isToday ? ' · Today' : ''}
                    </div>
                    <div className={`text-[13px] font-semibold tabular-nums ${isToday ? 'text-brand-800' : 'text-stone-900'}`}>
                      {dayMonth}
                    </div>

                    {/* Daily activity: departures, arrivals, vacant rooms */}
                    {metrics && (
                      <div className="mt-1 text-[11px] keep-size leading-[15px] tabular-nums text-stone-600">
                        {(metrics.departures > 0 || metrics.arrivals > 0) && (
                          <div className="flex items-center justify-center gap-x-2">
                            {metrics.departures > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 text-amber-800"
                                title={`${metrics.departures} zaereen departing / checking out on this day (rooms freeing up)`}
                              >
                                <LogOut className="w-3 h-3" />
                                {metrics.departures}
                              </span>
                            )}
                            {metrics.arrivals > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 text-blue-700"
                                title={`${metrics.arrivals} zaereen arriving on this day`}
                              >
                                <LogIn className="w-3 h-3" />
                                {metrics.arrivals}
                              </span>
                            )}
                          </div>
                        )}
                        <div title={`${metrics.vacant} rooms vacant`}>{metrics.vacant} vacant</div>
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* HORIZONTAL ROOMS (Rows) */}
          <tbody>
            {displayedRooms.length > 0 ? (
              displayedRooms.map((room) => {
                const maxCap = getRoomMaxCapacity(room);
                const vacInfo = roomVacancySummary.get(`${room.building}_${room.roomNumber}`);
                const paxText = `${room.capacity || 2}${room.buffer ? ` + ${room.buffer}` : ''} pax`;
                const floorBedsText = `${room.floorLabel || `Fl ${room.floor}`} · ${getRoomBedCount(room)} ${(room.bedType || 'Beds').toLowerCase()}`;

                return (
                  <tr key={room.id} className="group/row">

                    {/* Sticky Room Identity Column */}
                    <td className="sticky left-0 z-20 bg-white group-hover/row:bg-stone-50 px-2.5 sm:px-3 py-1.5 border-b border-r border-stone-200">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold text-stone-950 tabular-nums">
                          {room.roomNumber}
                        </span>
                        <span className="text-xs text-stone-600 truncate">
                          {room.building}
                        </span>
                        <span
                          className="hidden sm:inline ml-auto text-xs text-stone-600 tabular-nums whitespace-nowrap"
                          title={`Base Pax: ${room.capacity || 2} + Buffer: ${room.buffer || 0} = Max ${maxCap} Pax`}
                        >
                          {paxText}
                        </span>
                      </div>
                      <div className="text-xs text-stone-500 truncate" title={`${floorBedsText} · ${paxText}`}>
                        <span className="sm:hidden tabular-nums">{paxText}</span>
                        <span className="hidden sm:inline">{floorBedsText}</span>
                      </div>
                    </td>

                    {/* "When Vacant" Column (sticky from tablets up) */}
                    <td className="sm:sticky sm:left-[200px] z-20 bg-white group-hover/row:bg-stone-50 px-2.5 py-1.5 border-b border-r border-stone-200">
                      {room.status === 'blocked' ? (
                        <div className="flex items-center gap-1.5 text-[13px] text-stone-500">
                          <ShieldAlert className="w-3.5 h-3.5 text-stone-400" />
                          <span>Blocked</span>
                        </div>
                      ) : vacInfo?.isCurrentlyVacant ? (
                        <span className={chip('ok')} title="Ready for allotment">
                          Vacant now
                        </span>
                      ) : (
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-stone-900 tabular-nums whitespace-nowrap">
                            {vacInfo?.nextDepartureDate
                              ? `Vacant ${formatDay(vacInfo.nextDepartureDate)}`
                              : vacInfo?.vacantFromText || 'Occupied'}
                          </div>
                          {vacInfo?.nextDepartureZaer && (
                            <div className="text-xs text-stone-500 truncate" title={`Current occupant: ${vacInfo.nextDepartureZaer}`}>
                              {vacInfo.nextDepartureZaer}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Timeline Date Cells across the top row */}
                    {timelineDates.map((dateStr) => {
                      const isToday = dateStr === todayStr;
                      const tdBase = `p-1 border-b border-r border-stone-200/80 select-none align-middle ${isToday ? todayCol : ''}`;

                      // Blocked status
                      if (room.status === 'blocked') {
                        return (
                          <td key={dateStr} className={tdBase} title={`Room ${room.roomNumber} is blocked`}>
                            <div className={`${cellBase} ${cellTone.blocked}`}>
                              <span className="sr-only">Blocked</span>
                            </div>
                          </td>
                        );
                      }

                      // Bookings occupying this room on dateStr
                      const dayBookings = getRoomBookingsOnDate(room, dateStr, reservations);
                      const currentPax = countEffectivePax(dayBookings);
                      const isBufferUsed = currentPax > (room.capacity || 2) && currentPax <= maxCap;

                      // Check arrivals and departures on this specific date
                      const arrivingGuests = dayBookings.filter((r) => (r.arrivalDate || '').slice(0, 10) === dateStr);
                      const departingGuests = dayBookings.filter((r) => (r.departureDate || '').slice(0, 10) === dateStr);

                      const isDepartureDay = departingGuests.length > 0;
                      const isArrivalDay = arrivingGuests.length > 0;
                      const isTurnoverDay = isDepartureDay && isArrivalDay;

                      // VACANT SLOT on this day
                      if (dayBookings.length === 0) {
                        return (
                          <td
                            key={dateStr}
                            onClick={() => handleCellClick(room, dateStr)}
                            className={`group/cell ${tdBase} ${isReadOnly ? '' : 'cursor-pointer'}`}
                            title={`Room ${room.roomNumber} is vacant on ${dateStr}.${isReadOnly ? '' : ' Click to allot.'}`}
                          >
                            <div className={`${cellBase} ${cellTone.vacant} ${
                              isReadOnly ? '' : 'group-hover/cell:bg-emerald-100 group-hover/cell:ring-emerald-300'
                            }`}>
                              <span className="sr-only">Vacant</span>
                              {!isReadOnly && (
                                <span className="hidden group-hover/cell:inline text-xs font-medium text-emerald-800">Allot</span>
                              )}
                            </div>
                          </td>
                        );
                      }

                      // TURNOVER DAY (Same-day Departure & Arrival)
                      if (isTurnoverDay) {
                        const dep = departingGuests[0];
                        const arr = arrivingGuests[0];
                        const timing = checkTurnoverTimingConflict(
                          dep.departureDate,
                          dep.departureTime || dep.rawDepartureStr,
                          arr.arrivalDate,
                          arr.arrivalTime || arr.rawArrivalStr,
                          dep.applicantName,
                          arr.applicantName
                        );

                        const isLate = timing.isDepLaterThanArr;
                        const isSevere = timing.isSevereConflict;

                        return (
                          <td
                            key={dateStr}
                            className={`group/cell ${tdBase} cursor-pointer`}
                            onClick={() => setHoveredReservation(arr)}
                            title={
                              isLate
                                ? timing.message
                                : `Same-Day Turnover: ${dep.applicantName} checking out (${timing.depTimeFormatted}) -> Room cleaning -> ${arr.applicantName} checking in (${timing.arrTimeFormatted})!`
                            }
                          >
                            <div
                              className={`${cellBase} ${cellHover} ${
                                isSevere ? cellTone.severe : isLate ? cellTone.late : cellTone.turnover
                              }`}
                            >
                              <div className="flex items-center justify-center gap-1 max-w-full text-xs font-medium">
                                {(isSevere || isLate) && <AlertTriangle className="w-3 h-3 shrink-0" />}
                                <span className="truncate">
                                  {dep.applicantName.split(' ')[0]} → {arr.applicantName.split(' ')[0]}
                                </span>
                              </div>
                              <div className={`${cellSub} flex flex-wrap items-center justify-center gap-x-1`}>
                                <span className="whitespace-nowrap">{shortTime(timing.depTimeFormatted)}</span>
                                <ArrowRight className="w-3 h-3 shrink-0 opacity-70" />
                                <span className="whitespace-nowrap">{shortTime(timing.arrTimeFormatted)}</span>
                              </div>
                            </div>
                          </td>
                        );
                      }

                      // DEPARTURE DAY (The room is freeing up on this day!)
                      if (isDepartureDay) {
                        const dep = departingGuests[0];
                        const depTime = dep.departureTime || '01:00 AM';
                        return (
                          <td
                            key={dateStr}
                            onClick={() => setHoveredReservation(dep)}
                            className={`group/cell ${tdBase} cursor-pointer`}
                            title={`Departing on ${dateStr} at ${depTime}: ${dep.applicantName} (${dep.family || 'Fam'}). Room becomes vacant after checkout!`}
                          >
                            <div className={`${cellBase} ${cellHover} ${cellTone.out}`}>
                              <div className="flex items-center justify-center gap-1 max-w-full text-xs font-medium">
                                <LogOut className="w-3 h-3 shrink-0" />
                                <span className="truncate">{dep.applicantName}</span>
                              </div>
                              <span className={`${cellSub} max-w-full truncate`} title={`Departure time: ${depTime}`}>
                                Out {depTime}
                              </span>
                            </div>
                          </td>
                        );
                      }

                      // ARRIVAL DAY
                      if (isArrivalDay) {
                        const arr = arrivingGuests[0];
                        return (
                          <td
                            key={dateStr}
                            onClick={() => setHoveredReservation(arr)}
                            className={`group/cell ${tdBase} cursor-pointer`}
                            title={`Arriving on ${dateStr}: ${arr.applicantName} (${arr.family || 'Fam'}). Stay until ${arr.departureDate}.`}
                          >
                            <div className={`${cellBase} ${cellHover} ${cellTone.in}`}>
                              <div className="flex items-center justify-center gap-1 max-w-full text-xs font-medium">
                                <LogIn className="w-3 h-3 shrink-0" />
                                <span className="truncate">{arr.applicantName}</span>
                              </div>
                              <span className={`${cellSub} max-w-full truncate`}>
                                Until {formatDay((arr.departureDate || '').slice(0, 10))}
                              </span>
                            </div>
                          </td>
                        );
                      }

                      // IN-HOUSE OCCUPIED (Continuing stay)
                      const primaryOccupant = dayBookings[0];
                      return (
                        <td
                          key={dateStr}
                          onClick={() => setHoveredReservation(primaryOccupant)}
                          className={`group/cell ${tdBase} cursor-pointer`}
                          title={`Occupied by ${primaryOccupant.applicantName} (${primaryOccupant.family}). Departure on ${primaryOccupant.departureDate}.`}
                        >
                          <div className={`${cellBase} ${cellHover} ${cellTone.occupied}`}>
                            <span className="text-xs font-medium truncate max-w-full">
                              {primaryOccupant.applicantName}
                            </span>
                            <div className={`${cellSub} flex items-center justify-center gap-1 text-stone-600`}>
                              <span>{dayBookings.length > 1 ? `${dayBookings.length} guests` : `${currentPax} pax`}</span>
                              {isBufferUsed && (
                                <span className="px-1 rounded bg-amber-100 text-amber-800 font-medium" title="The buffer bed is in use">
                                  Buffer
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={timelineDates.length + 2} className="px-4 py-12 text-center text-sm text-stone-600">
                  No rooms match the selected filters or search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ========================================================================= */}
      {/* RESERVATION DETAIL / INSPECT MODAL (Guest Stay & Room Details)            */}
      {/* ========================================================================= */}
      {hoveredReservation && (
        <div className={modalScrim}>
          <div role="dialog" aria-modal="true" aria-labelledby="timeline-stay-title" className={`${modalCard} max-w-lg`}>
            <div className={modalHeader}>
              <h3 id="timeline-stay-title" className={modalTitle}>
                Guest stay and room details
              </h3>
              <button type="button" onClick={() => setHoveredReservation(null)} aria-label="Close" className={modalClose}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0 space-y-5">
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-base font-semibold text-stone-950">
                    {hoveredReservation.applicantName}
                  </span>
                  <span className="text-[13px] text-stone-600 tabular-nums">
                    ITS <strong className="font-bold text-stone-900">{hoveredReservation.itsId}</strong>
                  </span>
                </div>
                <div className="mt-1 text-sm text-stone-600">
                  Family <span className="font-medium text-stone-900">{hoveredReservation.family || 'N/A'}</span> · Tour <span className="font-medium text-stone-900">{hoveredReservation.tourRefNo}</span>
                </div>
                <div className="mt-0.5 text-[13px] text-stone-500">
                  Age {hoveredReservation.age} · {hoveredReservation.gender} · Jamaat: {hoveredReservation.jamaat || 'N/A'}
                </div>
              </div>

              {/* Stay schedule: dates and times together */}
              <dl className="grid grid-cols-2 gap-4 pt-5 border-t border-stone-200">
                <div className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-xs text-stone-500">
                    <LogIn className="w-3.5 h-3.5 text-blue-600" />
                    Arrival
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-stone-900 tabular-nums">
                    {formatDay(hoveredReservation.arrivalDate)}, {hoveredReservation.arrivalTime || '11:00 AM'}
                  </dd>
                  {hoveredReservation.rawArrivalStr && (
                    <dd className="text-xs text-stone-500 break-words">
                      Raw: {hoveredReservation.rawArrivalStr}
                    </dd>
                  )}
                </div>

                <div className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-xs text-stone-500">
                    <LogOut className="w-3.5 h-3.5 text-amber-600" />
                    Departure
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-stone-900 tabular-nums">
                    {formatDay(hoveredReservation.departureDate)}, {hoveredReservation.departureTime || '01:00 AM'}
                  </dd>
                  {hoveredReservation.rawDepartureStr && (
                    <dd className="text-xs text-stone-500 break-words">
                      Raw: {hoveredReservation.rawDepartureStr}
                    </dd>
                  )}
                </div>
              </dl>

              {/* Current room, and changing it right here */}
              <div className="pt-5 border-t border-stone-200 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-stone-500">Current allotted room</div>
                    <div className="mt-0.5 text-[15px] font-semibold text-stone-950">
                      {hoveredReservation.building || 'Saifee'} Hotel, room {hoveredReservation.roomNumber || 'unallotted'}
                    </div>
                  </div>
                  <span className={`${chip(hoveredReservation.roomNumber ? 'ok' : 'wait')} shrink-0`}>
                    {hoveredReservation.roomNumber ? 'Allotted' : 'Pending room'}
                  </span>
                </div>

                {/* Direct Room Change Controls */}
                {!isReadOnly && (
                  <div className={`${panel} p-4 space-y-3`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
                        <ArrowRightLeft className="w-4 h-4 text-stone-500" />
                        <span>Change room directly</span>
                      </span>
                      {onOpenQuickAllotModal && (
                        <button
                          type="button"
                          onClick={() => {
                            const res = hoveredReservation;
                            setHoveredReservation(null);
                            onOpenQuickAllotModal(res);
                          }}
                          className={`${btnSm.ghost} ${tap} -mr-2`}
                        >
                          Advanced reassignment
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-4">
                        <label htmlFor="timeline-change-building" className={fieldLabel}>
                          Building
                        </label>
                        <select
                          id="timeline-change-building"
                          value={modalChangeBuilding}
                          onChange={(e) => {
                            setModalChangeBuilding(e.target.value);
                            setModalChangeRoomNumber('');
                            setModalRoomChangeSuccess(null);
                            setModalRoomChangeError(null);
                          }}
                          className={field}
                        >
                          {distinctBuildings.map((b) => (
                            <option key={b} value={b}>{b} Hotel</option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-8">
                        <label htmlFor="timeline-change-room" className={fieldLabel}>
                          Choose new room
                        </label>
                        <select
                          id="timeline-change-room"
                          value={modalChangeRoomNumber}
                          onChange={(e) => {
                            setModalChangeRoomNumber(e.target.value);
                            setModalRoomChangeSuccess(null);
                            setModalRoomChangeError(null);
                          }}
                          className={field}
                        >
                          <option value="">Select room number</option>
                          {rooms
                            .filter((rm) => rm.building.toLowerCase() === modalChangeBuilding.toLowerCase())
                            .sort((a, b) => {
                              const numA = parseInt(a.roomNumber.replace(/\D/g, '')) || 0;
                              const numB = parseInt(b.roomNumber.replace(/\D/g, '')) || 0;
                              return numA - numB;
                            })
                            .map((rm) => {
                              const isCurrent = rm.roomNumber === hoveredReservation.roomNumber && rm.building.toLowerCase() === (hoveredReservation.building || '').toLowerCase();
                              return (
                                <option key={rm.id} value={rm.roomNumber}>
                                  Room {rm.roomNumber} (Cap: {rm.capacity}{rm.buffer ? `+${rm.buffer}` : ''} • {rm.toiletType || 'Std'}{isCurrent ? ' • CURRENT' : ''})
                                </option>
                              );
                            })}
                        </select>
                      </div>
                    </div>

                    {/* Family propagation checkbox if other family members exist */}
                    {(() => {
                      const famMembers = reservations.filter(
                        (r) =>
                          r.tourRefNo === hoveredReservation.tourRefNo &&
                          r.family &&
                          r.family === hoveredReservation.family &&
                          r.id !== hoveredReservation.id
                      );
                      if (famMembers.length === 0) return null;
                      return (
                        <label className="flex items-start gap-2 min-h-10 py-1 text-[13px] text-stone-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={modalChangeApplyToFamily}
                            onChange={(e) => setModalChangeApplyToFamily(e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded"
                          />
                          <span>
                            Also change room for other {famMembers.length} member{famMembers.length > 1 ? 's' : ''} of Family {hoveredReservation.family}
                          </span>
                        </label>
                      );
                    })()}

                    {modalRoomChangeSuccess && (
                      <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-800 animate-in fade-in">
                        <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-700 shrink-0" />
                        <span>{modalRoomChangeSuccess}</span>
                      </div>
                    )}

                    {modalRoomChangeError && (
                      <div role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700 animate-in fade-in">
                        <AlertCircle className="w-4 h-4 mt-0.5 text-rose-700 shrink-0" />
                        <span>{modalRoomChangeError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className={modalFooter}>
              <button type="button" onClick={() => setHoveredReservation(null)} className={btn.secondary}>
                Close
              </button>
              {!isReadOnly && (
                <button
                  type="button"
                  disabled={!modalChangeRoomNumber || (modalChangeRoomNumber === hoveredReservation.roomNumber && modalChangeBuilding.toLowerCase() === (hoveredReservation.building || '').toLowerCase())}
                  onClick={() => {
                    if (!modalChangeRoomNumber) {
                      setModalRoomChangeError('Please select a room to assign.');
                      return;
                    }
                    const targetBldg = modalChangeBuilding;
                    const targetRoom = modalChangeRoomNumber;

                    onAllotRoom(hoveredReservation.id, targetBldg, targetRoom);

                    if (modalChangeApplyToFamily && onBatchAllotFamily && hoveredReservation.family) {
                      onBatchAllotFamily(
                        hoveredReservation.tourRefNo,
                        hoveredReservation.family,
                        targetBldg,
                        targetRoom
                      );
                    }

                    setModalRoomChangeSuccess(`✓ Successfully assigned Room ${targetRoom} (${targetBldg} Hotel)!`);
                    setHoveredReservation((prev) =>
                      prev ? { ...prev, building: targetBldg, roomNumber: targetRoom } : null
                    );
                  }}
                  className={btn.primary}
                >
                  <Check className="w-4 h-4" />
                  <span>Confirm room change</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ROOM INSPECTION MODAL (room schedule)                                     */}
      {/* ========================================================================= */}
      {inspectedRoomTimeline && (
        <div className={modalScrim}>
          <div role="dialog" aria-modal="true" aria-labelledby="timeline-room-title" className={`${modalCard} max-w-xl`}>
            <div className={modalHeader}>
              <h3 id="timeline-room-title" className={modalTitle}>
                {inspectedRoomTimeline.building} Hotel, room {inspectedRoomTimeline.roomNumber}
              </h3>
              <button type="button" onClick={() => setInspectedRoomTimeline(null)} aria-label="Close" className={modalClose}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0 space-y-5">
              <dl className="grid grid-cols-3 gap-4">
                <div className="min-w-0">
                  <dt className="text-xs text-stone-500">Floor</dt>
                  <dd className="mt-0.5 text-sm font-medium text-stone-900">
                    {inspectedRoomTimeline.floorLabel || `Floor ${inspectedRoomTimeline.floor}`}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-stone-500">Capacity</dt>
                  <dd className="mt-0.5 text-sm font-medium text-stone-900 tabular-nums">
                    {inspectedRoomTimeline.capacity || 2} + {inspectedRoomTimeline.buffer || 0} buffer
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-stone-500">Toilet type</dt>
                  <dd className="mt-0.5 text-sm font-medium text-stone-900 truncate" title={inspectedRoomTimeline.toiletType}>
                    {inspectedRoomTimeline.toiletType || 'Standard'}
                  </dd>
                </div>
              </dl>

              {/* All bookings in this room */}
              <div className="pt-5 border-t border-stone-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-[15px] font-semibold text-stone-950">
                    Scheduled stays and departures
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const r = inspectedRoomTimeline;
                      setInspectedRoomTimeline(null);
                      handleCellClick(r, todayStr);
                    }}
                    className={`${btnSm.secondary} ${tap}`}
                  >
                    <Plus className="w-4 h-4" />
                    Book this room directly
                  </button>
                </div>
                {(() => {
                  const bList = reservations.filter(
                    (r) =>
                      (r.building || '').toLowerCase() === inspectedRoomTimeline.building.toLowerCase() &&
                      (r.roomNumber || '').toLowerCase() === inspectedRoomTimeline.roomNumber.toLowerCase()
                  );

                  if (bList.length === 0) {
                    return (
                      <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                        This room is currently completely vacant and has no reservations scheduled.
                      </p>
                    );
                  }

                  return (
                    <ul className="mt-2 divide-y divide-stone-200">
                      {bList.map((res) => (
                        <li key={res.id} className="py-2.5 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-stone-900">
                              {res.applicantName} <span className="font-normal text-stone-500 tabular-nums">({res.itsId})</span>
                            </div>
                            <div className="text-[13px] text-stone-600">
                              Fam {res.family} · Tour {res.tourRefNo}
                            </div>
                          </div>

                          <div className="sm:text-right shrink-0 tabular-nums">
                            <div className="inline-flex items-center gap-1 text-[13px] font-medium text-amber-800">
                              <LogOut className="w-3.5 h-3.5" />
                              <span>Vacating {formatDay(res.departureDate)}, {res.departureTime || '01:00 AM'}</span>
                            </div>
                            <div className="text-xs text-stone-500">
                              Stay: {formatDay(res.arrivalDate)}, {res.arrivalTime || '11:00 AM'} → {formatDay(res.departureDate)}, {res.departureTime || '01:00 AM'}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            </div>

            <div className={modalFooter}>
              <button type="button" onClick={() => setInspectedRoomTimeline(null)} className={btn.primary}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* INSTANT ROOM BOOKING & ALLOTMENT MODAL (Clicking on Vacant slot)          */}
      {/* ========================================================================= */}
      {instantBookingModal && (
        <div className={modalScrim}>
          <div role="dialog" aria-modal="true" aria-labelledby="timeline-book-title" className={`${modalCard} max-w-xl`}>
            {/* Modal Header */}
            <div className={modalHeader}>
              <div className="min-w-0">
                <h3 id="timeline-book-title" className={modalTitle}>
                  Instant room booking and allotment
                </h3>
                <p className="mt-1 text-[13px] text-stone-600">
                  {instantBookingModal.room.building} Hotel, room {instantBookingModal.room.roomNumber} · sleeps {instantBookingModal.room.capacity}
                </p>
              </div>
              <button type="button" onClick={() => setInstantBookingModal(null)} aria-label="Close" className={modalClose}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleInstantBookingSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0 space-y-4">
                {/* Tour ID: even if the Tour ID is not in the database, book instantly */}
                <div>
                  <label htmlFor="timeline-book-tour" className={fieldLabel}>
                    Tour ID <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="timeline-book-tour"
                    type="text"
                    required
                    list="timeline-existing-tours"
                    placeholder="e.g. NKERP/TOUR/2026/1333, T-101, VIP-01"
                    value={instantTourId}
                    onChange={(e) => {
                      setInstantTourId(e.target.value);
                      setInstantError(null);
                    }}
                    className={`${field} tabular-nums`}
                  />
                  <datalist id="timeline-existing-tours">
                    {existingTourIds.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  <p className="mt-1 text-xs text-stone-500">
                    Type any Tour ID. You can book instantly even if this Tour ID is not in the database.
                  </p>
                </div>

                {/* Arrival and departure: date and time together */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <div className="min-w-0">
                    <label htmlFor="timeline-book-arr-date" className={fieldLabel}>Arrival date</label>
                    <input
                      id="timeline-book-arr-date"
                      type="date"
                      required
                      value={instantArrivalDate}
                      onChange={(e) => setInstantArrivalDate(e.target.value)}
                      className={`${field} tabular-nums`}
                    />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="timeline-book-arr-time" className={fieldLabel}>Arrival time</label>
                    <select
                      id="timeline-book-arr-time"
                      value={instantArrivalTime}
                      onChange={(e) => setInstantArrivalTime(e.target.value)}
                      className={field}
                    >
                      <option value="11:00 AM">11:00 AM (Standard Check-in)</option>
                      <option value="12:00 PM">12:00 PM</option>
                      <option value="01:00 PM">01:00 PM</option>
                      <option value="02:00 PM">02:00 PM</option>
                      <option value="06:00 AM">06:00 AM (Early Arrival)</option>
                      <option value="08:00 AM">08:00 AM</option>
                      <option value="10:00 AM">10:00 AM</option>
                      <option value="04:00 PM">04:00 PM</option>
                      <option value="08:00 PM">08:00 PM</option>
                      <option value="11:00 PM">11:00 PM (Late Night)</option>
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="timeline-book-dep-date" className={fieldLabel}>Departure date</label>
                    <input
                      id="timeline-book-dep-date"
                      type="date"
                      required
                      value={instantDepartureDate}
                      onChange={(e) => setInstantDepartureDate(e.target.value)}
                      className={`${field} tabular-nums`}
                    />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="timeline-book-dep-time" className={fieldLabel}>Departure time</label>
                    <select
                      id="timeline-book-dep-time"
                      value={instantDepartureTime}
                      onChange={(e) => setInstantDepartureTime(e.target.value)}
                      className={field}
                    >
                      <option value="01:00 AM">01:00 AM (Standard Night Checkout)</option>
                      <option value="08:00 AM">08:00 AM (Morning Checkout)</option>
                      <option value="10:00 AM">10:00 AM</option>
                      <option value="11:00 AM">11:00 AM</option>
                      <option value="12:00 PM">12:00 PM (Noon Checkout)</option>
                      <option value="02:00 PM">02:00 PM</option>
                      <option value="06:00 PM">06:00 PM</option>
                      <option value="10:00 PM">10:00 PM</option>
                    </select>
                  </div>
                </div>

                {/* Remarks */}
                <div>
                  <label htmlFor="timeline-book-remarks" className={fieldLabel}>
                    Booking remarks and instructions
                  </label>
                  <textarea
                    id="timeline-book-remarks"
                    rows={2}
                    placeholder="Remarks, accounts comments, special requests, direct allotment notes"
                    value={instantRemarks}
                    onChange={(e) => setInstantRemarks(e.target.value)}
                    className={`${field} h-auto! py-2`}
                  />
                </div>

                {/* Optional guest name and family number */}
                <div className="pt-4 border-t border-stone-200 space-y-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-semibold text-stone-950">Guest name and family number</span>
                    <span className="text-[13px] text-stone-500">Optional</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                    <div>
                      <label htmlFor="timeline-book-name" className={fieldLabel}>
                        Guest / applicant name
                      </label>
                      <input
                        id="timeline-book-name"
                        type="text"
                        placeholder="e.g. Husain Bhai (or leave blank)"
                        value={instantApplicantName}
                        onChange={(e) => setInstantApplicantName(e.target.value)}
                        className={field}
                      />
                    </div>

                    <div>
                      <label htmlFor="timeline-book-family" className={fieldLabel}>
                        Family number
                      </label>
                      <input
                        id="timeline-book-family"
                        type="text"
                        placeholder="e.g. F-1, 101, Fam-A"
                        value={instantFamilyNumber}
                        onChange={(e) => setInstantFamilyNumber(e.target.value)}
                        className={`${field} tabular-nums`}
                      />
                    </div>

                    <div>
                      <label htmlFor="timeline-book-pax" className={fieldLabel}>
                        Number of pax
                      </label>
                      <input
                        id="timeline-book-pax"
                        type="number"
                        min={1}
                        max={10}
                        value={instantPax}
                        onChange={(e) => setInstantPax(parseInt(e.target.value) || 1)}
                        className={`${field} tabular-nums`}
                      />
                    </div>
                    <div>
                      <label htmlFor="timeline-book-category" className={fieldLabel}>
                        Category
                      </label>
                      <select
                        id="timeline-book-category"
                        value={instantCategory}
                        onChange={(e) => setInstantCategory(e.target.value)}
                        className={field}
                      >
                        <option value="Category A (Nizaam)">Category A (Nizaam)</option>
                        <option value="Category B (Standard)">Category B (Standard)</option>
                        <option value="B to A">B to A</option>
                        <option value="Mumineen">Mumineen</option>
                        <option value="Executive Suite">Executive Suite</option>
                      </select>
                    </div>
                  </div>
                </div>

                {instantError && (
                  <div role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 mt-0.5 text-rose-700 shrink-0" />
                    <span>{instantError}</span>
                  </div>
                )}

                {instantSuccess && (
                  <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-800 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-700 shrink-0" />
                    <span>{instantSuccess}</span>
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className={modalFooter}>
                <button
                  type="button"
                  onClick={() => {
                    const r = instantBookingModal.room;
                    setInstantBookingModal(null);
                    setInspectedRoomTimeline(r);
                  }}
                  className={`${btn.ghost} mr-auto -ml-3`}
                >
                  View room schedule
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button type="button" onClick={() => setInstantBookingModal(null)} className={btn.secondary}>
                  Cancel
                </button>
                <button type="submit" className={btn.primary}>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Book and allot room</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </>
  );
};
