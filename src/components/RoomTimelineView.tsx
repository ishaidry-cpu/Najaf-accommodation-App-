import React, { useState, useMemo } from 'react';
import { 
  Building2, 
  BedDouble, 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Users, 
  CheckCircle2, 
  Clock, 
  Sparkles, 
  DoorClosed, 
  Search, 
  Filter, 
  LogOut, 
  LogIn, 
  AlertCircle,
  ShieldAlert,
  ArrowRight,
  Maximize2,
  Minimize2,
  RefreshCw,
  Info,
  Plus
} from 'lucide-react';
import { Room, Reservation, UserRole } from '../types';
import { 
  getRoomMaxCapacity, 
  getRoomBookingsOnDate, 
  getRoomStatusOnDate,
  checkRoomAllotmentAvailability
} from '../services/storage';
import { checkTurnoverTimingConflict } from '../utils/turnoverTiming';

interface RoomTimelineViewProps {
  rooms: Room[];
  reservations: Reservation[];
  onAllotRoom: (reservationId: string, building: string, roomNumber: string) => void;
  onBatchAllotFamily?: (tourRefNo: string, family: string, building: string, roomNumber: string) => void;
  userRole?: UserRole;
  onOpenReceptionSlip?: () => void;
  onOpenQuickAllotModal?: (res: Reservation) => void;
  onOpenAddBuildingRooms?: () => void;
}

export const RoomTimelineView: React.FC<RoomTimelineViewProps> = ({
  rooms,
  reservations,
  onAllotRoom,
  onBatchAllotFamily,
  userRole = 'admin',
  onOpenReceptionSlip,
  onOpenQuickAllotModal,
  onOpenAddBuildingRooms,
}) => {
  const isReadOnly = userRole === 'receptionist';

  // Base starting date for the timeline (defaults to today)
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [startDateStr, setStartDateStr] = useState<string>(todayStr);

  // Number of days to display in the top row: 7, 14, 21, or 30 days
  const [dayRange, setDayRange] = useState<number>(14);

  // Dynamic distinct buildings list
  const distinctBuildings = useMemo(() => {
    const list = Array.from(new Set(rooms.map((r) => r.building).filter(Boolean)));
    return list.length > 0 ? list.sort() : ['Saifee', 'Burhani'];
  }, [rooms]);

  // Filters
  const [hotelFilter, setHotelFilter] = useState<string>('ALL');
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'vacant' | 'departing' | 'occupied'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected unallotted zaer for 1-click timeline assignment
  const [selectedZaerToAllot, setSelectedZaerToAllot] = useState<Reservation | null>(null);

  // Hovered booking detail tooltip or modal
  const [hoveredReservation, setHoveredReservation] = useState<Reservation | null>(null);
  const [inspectedRoomTimeline, setInspectedRoomTimeline] = useState<Room | null>(null);

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
  }, [rooms, hotelFilter, floorFilter, statusFilter, searchQuery, roomVacancySummary, reservations]);

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
      // Open inspection or suggest allotment modal
      setInspectedRoomTimeline(room);
    }
  };

  return (
    <div className={`bg-white border border-[#E6DFD5] rounded-2xl shadow-sm overflow-hidden flex flex-col transition-all ${
      isExpanded ? 'fixed inset-3 z-50 rounded-xl max-h-[96vh]' : 'space-y-4 p-4 sm:p-5'
    }`}>
      {/* ========================================================================= */}
      {/* TIMELINE CONTROLS & HEADER                                                */}
      {/* ========================================================================= */}
      <div className={`flex flex-col gap-3 pb-3 border-b border-stone-200 ${isExpanded ? 'p-4 bg-[#FAF7F2]' : ''}`}>
        
        {/* Title & Quick Statistics */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-lg bg-[#124E39] text-[#EBD59E]">
                <Calendar className="w-4 h-4" />
              </span>
              <h2 className="text-base font-bold text-[#124E39] tracking-tight">
                Rooms Availability & Departure Timeline
              </h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300">
                Live Occupancy & Turnover Schedule
              </span>
              {isReadOnly && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                  Receptionist View-Only
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-1">
              Top row shows dates with daily arrivals and departures. Horizontal rows represent each hotel room, highlighting exactly <strong className="text-stone-800">when each room becomes vacant as per guest departures</strong>.
            </p>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center gap-2">
            {onOpenReceptionSlip && (
              <button
                type="button"
                onClick={onOpenReceptionSlip}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#FAF7F2] hover:bg-stone-100 text-[#124E39] border border-[#124E39]/30 shadow-2xs transition"
              >
                <LogOut className="w-3.5 h-3.5 text-amber-600" />
                <span>Daily Departure Slip</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-700 transition"
              title={isExpanded ? 'Collapse timeline' : 'Expand full screen'}
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isExpanded ? 'Collapse' : 'Full Screen'}</span>
            </button>
          </div>
        </div>

        {/* Date Navigation & Range Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Navigation buttons */}
          <div className="flex items-center gap-1.5 bg-[#FAF7F2] p-1 rounded-xl border border-[#E6DFD5] shadow-2xs">
            <button
              type="button"
              onClick={() => handleShiftDays(-dayRange)}
              className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-white rounded-lg transition"
              title={`Previous ${dayRange} days`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleShiftDays(-1)}
              className="px-2 py-1 text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-white rounded-lg transition"
              title="Previous 1 day"
            >
              -1 Day
            </button>
            <button
              type="button"
              onClick={handleResetToToday}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                startDateStr === todayStr
                  ? 'bg-[#124E39] text-white shadow-2xs'
                  : 'bg-white text-[#124E39] hover:bg-emerald-50 border border-[#124E39]/20'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handleShiftDays(1)}
              className="px-2 py-1 text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-white rounded-lg transition"
              title="Next 1 day"
            >
              +1 Day
            </button>
            <button
              type="button"
              onClick={() => handleShiftDays(dayRange)}
              className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-white rounded-lg transition"
              title={`Next ${dayRange} days`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Custom Date Jump */}
            <div className="h-4 w-px bg-stone-300 mx-1" />
            <input
              type="date"
              value={startDateStr}
              onChange={(e) => setStartDateStr(e.target.value)}
              className="bg-transparent text-xs font-bold text-stone-800 px-1 focus:outline-none cursor-pointer"
            />
          </div>

          {/* Day count window buttons */}
          <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl text-xs font-semibold">
            <span className="text-stone-500 text-[11px] px-1.5 hidden sm:inline">Days:</span>
            {[7, 14, 21, 30].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setDayRange(num)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  dayRange === num
                    ? 'bg-[#124E39] text-white shadow-2xs font-bold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {num}d
              </button>
            ))}
          </div>

          {/* Filters: Building & Floor */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Building tabs */}
            <div className="flex items-center bg-stone-100 p-1 rounded-xl font-semibold flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setHotelFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  hotelFilter === 'ALL'
                    ? 'bg-[#124E39] text-white shadow-2xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                All ({rooms.length})
              </button>
              {distinctBuildings.map((bldg) => {
                const bCount = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length;
                return (
                  <button
                    key={bldg}
                    type="button"
                    onClick={() => setHotelFilter(bldg)}
                    className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                      hotelFilter.toLowerCase() === bldg.toLowerCase()
                        ? 'bg-[#124E39] text-white shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {bldg} ({bCount})
                  </button>
                );
              })}
            </div>

            {onOpenAddBuildingRooms && !isReadOnly && (
              <button
                type="button"
                onClick={onOpenAddBuildingRooms}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] border border-[#C5A059]/40 shadow-2xs transition cursor-pointer"
                title="Add Hotel Building & Rooms manually or sync from Google Sheet"
              >
                <Plus className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>+ Add Rooms</span>
              </button>
            )}

            {/* Floor filter */}
            <select
              value={floorFilter}
              onChange={(e) => setFloorFilter(e.target.value)}
              className="bg-[#FAF7F2] border border-stone-300 rounded-xl px-2.5 py-1 text-xs font-semibold text-stone-700 cursor-pointer shadow-2xs"
            >
              {floorOptions.map((fl) => (
                <option key={fl} value={fl}>
                  {fl === 'ALL' ? 'All Floors' : fl}
                </option>
              ))}
            </select>

            {/* Status filter: Highlight departing/vacant */}
            <div className="flex items-center bg-stone-100 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2 py-0.5 rounded-lg transition ${
                  statusFilter === 'ALL' ? 'bg-white font-bold text-stone-900 shadow-2xs' : 'text-stone-500'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('vacant')}
                className={`px-2 py-0.5 rounded-lg transition ${
                  statusFilter === 'vacant' ? 'bg-emerald-700 font-bold text-white shadow-2xs' : 'text-stone-500'
                }`}
                title="Show only rooms that are currently vacant"
              >
                Vacant Now
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('departing')}
                className={`px-2 py-0.5 rounded-lg transition ${
                  statusFilter === 'departing' ? 'bg-amber-600 font-bold text-white shadow-2xs' : 'text-stone-500'
                }`}
                title="Show rooms with guests departing in this timeframe (freeing up)"
              >
                Departing Soon
              </button>
            </div>

            {/* Search input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Room #, Zaer, ITS..."
                className="pl-8 pr-2.5 py-1 rounded-xl border border-stone-300 bg-white text-xs text-stone-800 placeholder-stone-400 focus:outline-none focus:border-[#124E39] shadow-2xs w-44"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Unallotted Zaereen Quick-Allot Banner (If any need rooms) */}
        {!isReadOnly && unallottedZaereen.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-700" />
              <span className="font-bold text-amber-900">
                {unallottedZaereen.length} Zaereen Waiting for Room Allotment:
              </span>
              <span className="text-amber-800 text-[11px] hidden sm:inline">
                Select a zaer, then click any green <strong className="font-semibold text-emerald-800">Vacant</strong> cell to allot directly!
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={selectedZaerToAllot?.id || ''}
                onChange={(e) => {
                  const target = unallottedZaereen.find((z) => z.id === e.target.value) || null;
                  setSelectedZaerToAllot(target);
                }}
                className="bg-white border border-amber-300 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-950 focus:outline-none"
              >
                <option value="">-- Choose Zaer to Allot --</option>
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
                  className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-semibold text-[11px] hover:bg-amber-300"
                >
                  Clear Selection
                </button>
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-[#FAF7F2] px-3 py-2 rounded-xl border border-[#E6DFD5]">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-emerald-600 border border-emerald-700 flex items-center justify-center text-[9px] text-white font-bold">
                ✓
              </span>
              <span className="font-bold text-emerald-950">Vacant / Ready</span>
              <span className="text-[11px] text-stone-500">— Click cell to allot</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-[#124E39] border border-[#0E3C2C] flex items-center justify-center text-[9px] text-[#EBD59E] font-bold">
                ●
              </span>
              <span className="font-bold text-stone-900">Occupied (In-house)</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-amber-500 border border-amber-600 flex items-center justify-center text-[9px] text-white font-bold">
                ↗
              </span>
              <span className="font-bold text-amber-950">Departure Date (Room Freeing Up)</span>
              <span className="text-[11px] text-stone-500">— Vacates for cleaning & new zaer</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-indigo-600 border border-indigo-700 flex items-center justify-center text-[9px] text-white font-bold">
                ↘
              </span>
              <span className="font-bold text-indigo-950">New Arrival</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-purple-600 border border-purple-700 flex items-center justify-center text-[9px] text-white font-bold">
                ⇄
              </span>
              <span className="font-bold text-purple-950">Same-Day Turnover</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-stone-300 border border-stone-400 flex items-center justify-center text-[9px] text-stone-600 font-bold">
                🔒
              </span>
              <span className="font-bold text-stone-700">Blocked Inventory</span>
            </div>
          </div>

          <div className="text-[11px] font-medium text-stone-600">
            Showing <strong className="text-stone-900">{displayedRooms.length}</strong> of {rooms.length} rooms
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TIMELINE MATRIX: TOP ROW OF DATES + HORIZONTAL ROOMS                      */}
      {/* ========================================================================= */}
      <div className="overflow-auto border border-[#E6DFD5] rounded-xl relative max-h-[68vh] shadow-inner bg-stone-50">
        <table className="w-full border-collapse text-left min-w-[950px]">
          
          {/* TOP ROW OF DATES (Sticky Header) */}
          <thead className="sticky top-0 z-30 bg-[#FAF7F2] shadow-xs">
            <tr className="border-b border-[#E6DFD5]">
              
              {/* Top-Left Corner: Room Details & When Vacant Column */}
              <th className="sticky left-0 z-40 bg-[#FAF7F2] p-2.5 text-xs font-bold text-stone-700 border-r border-[#E6DFD5] min-w-[210px] w-[210px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[#124E39]">
                    <Building2 className="w-4 h-4" />
                    <span>Room & Availability</span>
                  </div>
                  <span className="text-[10px] font-normal text-stone-500">
                    {displayedRooms.length} Rms
                  </span>
                </div>
              </th>

              {/* Status & Next Vacant Column */}
              <th className="sticky left-[210px] z-40 bg-[#FAF7F2] p-2.5 text-xs font-bold text-stone-700 border-r border-[#E6DFD5] min-w-[150px] w-[150px]">
                <div className="flex items-center gap-1 text-[#124E39]">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>When Vacant</span>
                </div>
                <div className="text-[9px] font-normal text-stone-500">Next Departure Date</div>
              </th>

              {/* Top row of dates */}
              {timelineDates.map((dateStr) => {
                const dateObj = new Date(dateStr);
                const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                const dayMonth = dateObj.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
                const isToday = dateStr === todayStr;
                const metrics = dailyMetrics.get(dateStr);

                return (
                  <th
                    key={dateStr}
                    className={`p-2 text-center border-r border-stone-200 transition-colors select-none min-w-[105px] ${
                      isToday
                        ? 'bg-emerald-100/90 border-b-2 border-b-emerald-600'
                        : 'hover:bg-stone-100'
                    }`}
                  >
                    <div className="flex flex-col items-center">
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          isToday ? 'text-emerald-900' : 'text-stone-500'
                        }`}>
                          {dayName}
                        </span>
                        {isToday && (
                          <span className="text-[8px] font-extrabold px-1 rounded bg-emerald-700 text-white leading-tight">
                            TODAY
                          </span>
                        )}
                      </div>
                      <span className={`text-xs font-extrabold leading-tight ${
                        isToday ? 'text-emerald-950 font-black' : 'text-stone-800'
                      }`}>
                        {dayMonth}
                      </span>

                      {/* Daily Activity Indicators (Departures & Arrivals) */}
                      {metrics && (
                        <div className="flex items-center gap-1.5 mt-1 text-[9px] font-bold">
                          {metrics.departures > 0 && (
                            <span
                              className="px-1 rounded bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-0.5"
                              title={`${metrics.departures} zaereen departing / checking out on this day (rooms freeing up)`}
                            >
                              <LogOut className="w-2.5 h-2.5" />
                              {metrics.departures}
                            </span>
                          )}
                          {metrics.arrivals > 0 && (
                            <span
                              className="px-1 rounded bg-indigo-100 text-indigo-800 border border-indigo-300 flex items-center gap-0.5"
                              title={`${metrics.arrivals} zaereen arriving on this day`}
                            >
                              <LogIn className="w-2.5 h-2.5" />
                              {metrics.arrivals}
                            </span>
                          )}
                          <span
                            className="px-1 rounded bg-stone-100 text-stone-600"
                            title={`${metrics.vacant} rooms vacant`}
                          >
                            {metrics.vacant} vac
                          </span>
                        </div>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* HORIZONTAL ROOMS (Rows) */}
          <tbody className="divide-y divide-stone-200 text-xs">
            {displayedRooms.length > 0 ? (
              displayedRooms.map((room) => {
                const maxCap = getRoomMaxCapacity(room);
                const vacInfo = roomVacancySummary.get(`${room.building}_${room.roomNumber}`);
                const isBurhani = room.building.toLowerCase() === 'burhani';

                return (
                  <tr key={room.id} className="hover:bg-amber-50/20 transition-colors group">
                    
                    {/* Sticky Room Identity Column */}
                    <td className="sticky left-0 z-20 bg-white group-hover:bg-[#FAF7F2] p-2.5 border-r border-[#E6DFD5] shadow-xs">
                      <div className="flex items-start justify-between gap-1.5">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-sm font-mono text-[#124E39]">
                              Rm {room.roomNumber}
                            </span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                              isBurhani
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}>
                              {room.building}
                            </span>
                          </div>

                          <div className="text-[10px] text-stone-500 mt-0.5 flex items-center gap-1">
                            <span>{room.floorLabel || `Fl ${room.floor}`}</span>
                            <span>•</span>
                            <span className="truncate max-w-[100px]" title={room.bedType}>
                              {room.bedType || 'Beds'}
                            </span>
                          </div>
                        </div>

                        {/* Capacity Badge */}
                        <div className="text-right">
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200 inline-block"
                            title={`Base Pax: ${room.capacity || 2} + Buffer: ${room.buffer || 0} = Max ${maxCap} Pax`}
                          >
                            {room.capacity || 2}{room.buffer ? `+${room.buffer}` : ''} Pax
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Sticky "When Vacant" Column */}
                    <td className="sticky left-[210px] z-20 bg-white group-hover:bg-[#FAF7F2] p-2 border-r border-[#E6DFD5] text-[11px]">
                      {room.status === 'blocked' ? (
                        <div className="flex items-center gap-1 text-stone-500 font-medium">
                          <ShieldAlert className="w-3.5 h-3.5 text-stone-400" />
                          <span>Blocked Inventory</span>
                        </div>
                      ) : vacInfo?.isCurrentlyVacant ? (
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 w-fit">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Vacant Now
                          </span>
                          <span className="text-[9px] text-stone-500 mt-0.5">Ready for allotment</span>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1 font-bold text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 w-fit">
                            <LogOut className="w-3 h-3 text-amber-600" />
                            {vacInfo?.vacantFromText || 'Occupied'}
                          </span>
                          {vacInfo?.nextDepartureZaer && (
                            <span className="text-[9px] text-stone-500 truncate max-w-[130px]" title={`Current occupant: ${vacInfo.nextDepartureZaer}`}>
                              Ex: {vacInfo.nextDepartureZaer}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Timeline Date Cells across the top row */}
                    {timelineDates.map((dateStr) => {
                      const isToday = dateStr === todayStr;

                      // Blocked status
                      if (room.status === 'blocked') {
                        return (
                          <td
                            key={dateStr}
                            className={`p-1 border-r border-stone-200 text-center bg-stone-100 text-stone-400 text-[10px] select-none ${
                              isToday ? 'border-l-2 border-r-2 border-emerald-500/40' : ''
                            }`}
                          >
                            <div className="p-1 rounded bg-stone-200/70 border border-stone-300 flex items-center justify-center gap-1">
                              <ShieldAlert className="w-3 h-3 text-stone-500" />
                              <span className="font-semibold text-stone-600">Blocked</span>
                            </div>
                          </td>
                        );
                      }

                      // Bookings occupying this room on dateStr
                      const dayBookings = getRoomBookingsOnDate(room, dateStr, reservations);
                      const currentPax = dayBookings.reduce((sum, r) => sum + (r.pax || r.paxCount || 1), 0);
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
                            className={`p-1 border-r border-stone-200 text-center transition-colors select-none ${
                              isToday ? 'bg-emerald-50/80 font-bold' : 'bg-emerald-50/30'
                            } hover:bg-emerald-100/70 cursor-pointer`}
                            title={`Room ${room.roomNumber} is VACANT on ${dateStr}. Click to allot!`}
                          >
                            <div className="py-1 px-1 rounded-md border border-emerald-300/80 bg-white/70 text-emerald-800 flex items-center justify-center gap-1 text-[10px] font-semibold hover:border-emerald-600 hover:shadow-2xs">
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                              <span>Vacant</span>
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
                            className={`p-1 border-r border-stone-200 text-center select-none ${
                              isSevere
                                ? 'bg-rose-50 border-l-2 border-r-2 border-rose-500'
                                : isLate
                                ? 'bg-amber-50 border-l-2 border-r-2 border-amber-500'
                                : isToday
                                ? 'bg-purple-50 border-l-2 border-r-2 border-purple-500'
                                : 'bg-purple-50/40'
                            }`}
                          >
                            <div
                              className={`p-1 rounded border text-[9px] cursor-pointer hover:shadow-xs transition ${
                                isSevere
                                  ? 'bg-rose-100 border-rose-300 text-rose-950 font-bold'
                                  : isLate
                                  ? 'bg-amber-100 border-amber-300 text-amber-950 font-semibold'
                                  : 'bg-purple-100 border-purple-300 text-purple-900'
                              }`}
                              title={
                                isLate
                                  ? timing.message
                                  : `Same-Day Turnover: ${dep.applicantName} checking out (${timing.depTimeFormatted}) -> Room cleaning -> ${arr.applicantName} checking in (${timing.arrTimeFormatted})!`
                              }
                              onClick={() => setHoveredReservation(arr)}
                            >
                              <div className="flex items-center justify-between font-bold text-[8px]">
                                <span className={isSevere ? 'text-rose-800' : isLate ? 'text-amber-800' : 'text-amber-800'}>
                                  {isSevere ? '⛔' : isLate ? '⚠️' : '↗'} {timing.depTimeFormatted}
                                </span>
                                <span className="text-stone-400">➔</span>
                                <span className="text-indigo-800">
                                  {timing.arrTimeFormatted}
                                </span>
                              </div>
                              <div className="truncate font-semibold text-[8px] mt-0.5">
                                {dep.applicantName.split(' ')[0]} ➔ {arr.applicantName.split(' ')[0]}
                              </div>
                            </div>
                          </td>
                        );
                      }

                      // DEPARTURE DAY (The room is freeing up on this day!)
                      if (isDepartureDay) {
                        const dep = departingGuests[0];
                        return (
                          <td
                            key={dateStr}
                            onClick={() => setHoveredReservation(dep)}
                            className={`p-1 border-r border-stone-200 text-center select-none ${
                              isToday ? 'bg-amber-100/70 border-l-2 border-r-2 border-amber-500' : 'bg-amber-50/60'
                            } hover:bg-amber-100 cursor-pointer`}
                            title={`Departing on ${dateStr}: ${dep.applicantName} (${dep.family || 'Fam'}). Room becomes vacant after checkout!`}
                          >
                            <div className="p-1 rounded bg-amber-100 border border-amber-300 text-amber-950 flex flex-col items-center shadow-2xs">
                              <div className="flex items-center gap-0.5 text-[9px] font-bold text-amber-800">
                                <LogOut className="w-2.5 h-2.5 text-amber-700" />
                                <span>Checkout Today</span>
                              </div>
                              <span className="text-[9px] font-semibold truncate max-w-[85px]">
                                {dep.applicantName.split(' ')[0]}
                              </span>
                              <span className="text-[8px] text-amber-800 font-bold bg-amber-200/70 px-1 rounded mt-0.5">
                                Vacating
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
                            className={`p-1 border-r border-stone-200 text-center select-none ${
                              isToday ? 'bg-indigo-100/70 border-l-2 border-r-2 border-indigo-500' : 'bg-indigo-50/50'
                            } hover:bg-indigo-100 cursor-pointer`}
                            title={`Arriving on ${dateStr}: ${arr.applicantName} (${arr.family || 'Fam'}). Stay until ${arr.departureDate}.`}
                          >
                            <div className="p-1 rounded bg-indigo-100 border border-indigo-300 text-indigo-950 flex flex-col items-center shadow-2xs">
                              <div className="flex items-center gap-0.5 text-[9px] font-bold text-indigo-800">
                                <LogIn className="w-2.5 h-2.5 text-indigo-700" />
                                <span>Check-in</span>
                              </div>
                              <span className="text-[9px] font-semibold truncate max-w-[85px]">
                                {arr.applicantName.split(' ')[0]}
                              </span>
                              <span className="text-[8px] text-indigo-700 font-mono font-medium">
                                Dep: {(arr.departureDate || '').slice(5)}
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
                          className={`p-1 border-r border-stone-200 text-center select-none bg-stone-50 hover:bg-stone-100 cursor-pointer ${
                            isToday ? 'border-l-2 border-r-2 border-emerald-500/60' : ''
                          }`}
                          title={`Occupied by ${primaryOccupant.applicantName} (${primaryOccupant.family}). Departure on ${primaryOccupant.departureDate}.`}
                        >
                          <div className={`p-1 rounded border flex flex-col items-center shadow-2xs ${
                            isBufferUsed
                              ? 'bg-amber-50 border-amber-300 text-amber-950'
                              : 'bg-[#124E39]/10 border-[#124E39]/30 text-[#0E3C2C]'
                          }`}>
                            <span className="text-[9px] font-bold truncate max-w-[85px] leading-tight">
                              {primaryOccupant.applicantName.split(' ')[0]}
                            </span>
                            <div className="flex items-center gap-1 text-[8px] font-medium text-stone-600 mt-0.5">
                              <span>{dayBookings.length > 1 ? `${dayBookings.length} Guests` : `${currentPax} Pax`}</span>
                              {isBufferUsed && (
                                <span className="px-1 rounded bg-amber-200 text-amber-900 font-bold">
                                  Buf
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
                <td colSpan={timelineDates.length + 2} className="py-12 text-center text-stone-400 text-xs">
                  No rooms match the selected filters or search query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ========================================================================= */}
      {/* RESERVATION DETAIL HOVER / INSPECT MODAL                                  */}
      {/* ========================================================================= */}
      {hoveredReservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-md w-full shadow-2xl overflow-hidden p-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded bg-[#124E39] text-[#EBD59E]">
                  <Users className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-[#124E39]">
                  Guest Stay & Room Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setHoveredReservation(null)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 mt-4 text-xs">
              <div className="p-3 rounded-xl bg-white border border-[#E6DFD5] space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-stone-900">
                    {hoveredReservation.applicantName}
                  </span>
                  <span className="font-mono text-stone-500 font-bold">
                    ITS: {hoveredReservation.itsId}
                  </span>
                </div>
                <div className="text-stone-600">
                  Family: <strong className="text-stone-900">{hoveredReservation.family || 'N/A'}</strong> • Tour: <strong className="text-stone-900">{hoveredReservation.tourRefNo}</strong>
                </div>
                <div className="text-stone-500 text-[11px]">
                  Age: {hoveredReservation.age} • Gender: {hoveredReservation.gender} • Jamaat: {hoveredReservation.jamaat || 'N/A'}
                </div>
              </div>

              {/* Room & Stay Schedule */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="flex items-center gap-1 text-emerald-800 text-[10px] font-bold">
                    <LogIn className="w-3 h-3" />
                    <span>Arrival Date</span>
                  </div>
                  <div className="font-bold text-emerald-950 mt-1">
                    {hoveredReservation.arrivalDate}
                  </div>
                  {hoveredReservation.rawArrivalStr && (
                    <div className="text-[10px] text-emerald-700">
                      {hoveredReservation.rawArrivalStr}
                    </div>
                  )}
                </div>

                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-1 text-amber-800 text-[10px] font-bold">
                    <LogOut className="w-3 h-3" />
                    <span>Departure (Vacates)</span>
                  </div>
                  <div className="font-bold text-amber-950 mt-1">
                    {hoveredReservation.departureDate}
                  </div>
                  {hoveredReservation.rawDepartureStr && (
                    <div className="text-[10px] text-amber-700">
                      {hoveredReservation.rawDepartureStr}
                    </div>
                  )}
                </div>
              </div>

              {/* Current Room */}
              <div className="p-3 rounded-xl bg-white border border-[#E6DFD5] flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-stone-500 uppercase font-bold tracking-wider">
                    Allotted Room
                  </span>
                  <div className="font-extrabold text-sm text-[#124E39]">
                    {hoveredReservation.building} Hotel — Rm {hoveredReservation.roomNumber}
                  </div>
                </div>

                {onOpenQuickAllotModal && !isReadOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      const res = hoveredReservation;
                      setHoveredReservation(null);
                      onOpenQuickAllotModal(res);
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-2xs"
                  >
                    Change Room
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setHoveredReservation(null)}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-stone-200 text-stone-800 hover:bg-stone-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ROOM INSPECTION MODAL (When clicking room title or vacant slot)            */}
      {/* ========================================================================= */}
      {inspectedRoomTimeline && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden p-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded bg-[#124E39] text-[#EBD59E]">
                  <DoorClosed className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-[#124E39]">
                  {inspectedRoomTimeline.building} Hotel — Room {inspectedRoomTimeline.roomNumber}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectedRoomTimeline(null)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 mt-4 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded-xl bg-white border border-[#E6DFD5] text-center">
                  <div className="text-[10px] text-stone-500 font-bold">Floor</div>
                  <div className="font-extrabold text-stone-900 mt-0.5">
                    {inspectedRoomTimeline.floorLabel || `Floor ${inspectedRoomTimeline.floor}`}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-white border border-[#E6DFD5] text-center">
                  <div className="text-[10px] text-stone-500 font-bold">Capacity</div>
                  <div className="font-extrabold text-[#124E39] mt-0.5">
                    {inspectedRoomTimeline.capacity || 2} + {inspectedRoomTimeline.buffer || 0} Buffer
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-white border border-[#E6DFD5] text-center">
                  <div className="text-[10px] text-stone-500 font-bold">Toilet Type</div>
                  <div className="font-extrabold text-stone-900 mt-0.5 truncate" title={inspectedRoomTimeline.toiletType}>
                    {inspectedRoomTimeline.toiletType || 'Standard'}
                  </div>
                </div>
              </div>

              {/* All Upcoming Bookings in this room */}
              <div>
                <h4 className="font-bold text-stone-800 text-xs mb-1.5">
                  Scheduled Stays & Departures for this Room:
                </h4>
                {(() => {
                  const bList = reservations.filter(
                    (r) =>
                      (r.building || '').toLowerCase() === inspectedRoomTimeline.building.toLowerCase() &&
                      (r.roomNumber || '').toLowerCase() === inspectedRoomTimeline.roomNumber.toLowerCase()
                  );

                  if (bList.length === 0) {
                    return (
                      <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-center font-medium">
                        This room is currently completely vacant and has no reservations scheduled.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {bList.map((res) => (
                        <div
                          key={res.id}
                          className="p-2 rounded-lg bg-white border border-[#E6DFD5] flex items-center justify-between gap-2 shadow-2xs"
                        >
                          <div>
                            <div className="font-bold text-stone-900">
                              {res.applicantName} <span className="font-mono text-stone-500">({res.itsId})</span>
                            </div>
                            <div className="text-[10px] text-stone-500">
                              Fam: {res.family} • Tour: {res.tourRefNo}
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-block">
                              Vacating: {res.departureDate}
                            </span>
                            <div className="text-[9px] text-stone-500 mt-0.5">
                              Stay: {res.arrivalDate} to {res.departureDate}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setInspectedRoomTimeline(null)}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-stone-200 text-stone-800 hover:bg-stone-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
