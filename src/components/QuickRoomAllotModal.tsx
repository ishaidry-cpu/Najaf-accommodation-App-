import React, { useState, useMemo } from 'react';
import { 
  Building2, 
  DoorClosed, 
  Search, 
  Users, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Sparkles, 
  BedDouble, 
  Bath, 
  Filter,
  ArrowRight,
  ShieldCheck,
  Calendar,
  Clock
} from 'lucide-react';
import { Room, Reservation } from '../types';
import { 
  getRoomMaxCapacity, 
  checkRoomAllotmentAvailability, 
  getRoomBookingsForDuration,
  isInfant,
  countEffectivePax
} from '../services/storage';

interface QuickRoomAllotModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetReservation: Reservation | null;
  rooms: Room[];
  reservations: Reservation[];
  onAllotRoom: (reservationId: string, building: string, roomNumber: string) => void;
  onBatchAllotFamily?: (tourRefNo: string, family: string, building: string, roomNumber: string) => void;
}

export const QuickRoomAllotModal: React.FC<QuickRoomAllotModalProps> = ({
  isOpen,
  onClose,
  targetReservation,
  rooms,
  reservations,
  onAllotRoom,
  onBatchAllotFamily,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [hotelFilter, setHotelFilter] = useState<'ALL' | 'Saifee' | 'Burhani'>('ALL');
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [amenityFilter, setAmenityFilter] = useState<'ALL' | 'western' | 'indian' | 'double' | 'single'>('ALL');
  const [allotMode, setAllotMode] = useState<'single' | 'family'>('single');

  if (!isOpen || !targetReservation) return null;

  const arrivalDate = targetReservation.arrivalDate || targetReservation.arrivalDateTime || '';
  const departureDate = targetReservation.departureDate || targetReservation.departureDateTime || '';

  // Other family members sharing the same tour and family code
  const familyMembers = reservations.filter(
    (r) =>
      r.family &&
      r.tourRefNo === targetReservation.tourRefNo &&
      (r.family || '').trim().toLowerCase() === (targetReservation.family || '').trim().toLowerCase()
  );

  const isFamily = familyMembers.length > 1;
  const requestedPax =
    allotMode === 'family' && isFamily
      ? countEffectivePax(familyMembers)
      : isInfant(targetReservation)
      ? 0
      : 1;

  // Available floors for current building filter
  const floorOptions = useMemo(() => {
    const list: string[] = [];
    rooms.forEach((r) => {
      if (hotelFilter !== 'ALL' && r.building.toLowerCase() !== hotelFilter.toLowerCase()) return;
      const fl = r.floorLabel || `Floor ${r.floor}`;
      if (!list.includes(fl)) list.push(fl);
    });
    return ['ALL', ...list];
  }, [rooms, hotelFilter]);

  // Compute room statuses & availability for target duration
  const evaluatedRooms = useMemo(() => {
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
      const familyInRoom = occupants.filter(
        (o) =>
          o.family &&
          o.tourRefNo === targetReservation.tourRefNo &&
          (o.family || '').trim().toLowerCase() === (targetReservation.family || '').trim().toLowerCase()
      );

      const isCurrent =
        (targetReservation.building || '').toLowerCase() === room.building.toLowerCase() &&
        (targetReservation.roomNumber || '').trim().toLowerCase() === room.roomNumber.trim().toLowerCase();

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

      const canFit = check.allowed;
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
  }, [rooms, reservations, targetReservation, arrivalDate, departureDate, requestedPax, allotMode]);

  // Filter evaluated rooms
  const filteredRooms = useMemo(() => {
    return evaluatedRooms.filter(({ room, isBlocked }) => {
      // Hotel filter
      if (hotelFilter !== 'ALL' && room.building.toLowerCase() !== hotelFilter.toLowerCase()) return false;

      // Floor filter
      const fl = room.floorLabel || `Floor ${room.floor}`;
      if (floorFilter !== 'ALL' && fl !== floorFilter) return false;

      // Amenity filter
      if (amenityFilter === 'western' && !(room.toiletType || '').toLowerCase().includes('western')) return false;
      if (amenityFilter === 'indian' && !(room.toiletType || '').toLowerCase().includes('indian')) return false;
      if (amenityFilter === 'double' && !(room.bedType || '').toLowerCase().includes('double')) return false;
      if (amenityFilter === 'single' && !(room.bedType || '').toLowerCase().includes('single')) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const numMatch = room.roomNumber.toLowerCase().includes(q);
        const bldgMatch = room.building.toLowerCase().includes(q);
        const floorMatch = (room.floorLabel || `floor ${room.floor}`).toLowerCase().includes(q);
        const bedMatch = (room.bedType || '').toLowerCase().includes(q);
        const toiletMatch = (room.toiletType || '').toLowerCase().includes(q);
        if (!numMatch && !bldgMatch && !floorMatch && !bedMatch && !toiletMatch) return false;
      }

      return true;
    });
  }, [evaluatedRooms, hotelFilter, floorFilter, amenityFilter, searchQuery]);

  // Sort: Recommended rooms (where family is or vacant with high capacity) first
  // Note: Do not prioritize current room as top recommendation to avoid confusion
  const sortedRooms = useMemo(() => {
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
      const numA = parseInt(a.room.roomNumber, 10) || 999;
      const numB = parseInt(b.room.roomNumber, 10) || 999;
      return numA - numB;
    });
  }, [filteredRooms]);

  // Handle single or batch allotment
  const handleSelectRoom = (bldg: string, rNum: string) => {
    if (allotMode === 'family' && isFamily && onBatchAllotFamily) {
      onBatchAllotFamily(targetReservation.tourRefNo, targetReservation.family, bldg, rNum);
    } else {
      onAllotRoom(targetReservation.id, bldg, rNum);
    }
    onClose();
  };

  // Auto-recommend best available room (excluding current room to avoid confusion)
  const handleAutoRecommend = () => {
    // 1. Check if room with existing family has capacity (exclude current room)
    const familyRoom = sortedRooms.find((r) => r.familyInRoom.length > 0 && r.canFit && !r.isBlocked && !r.isCurrent);
    if (familyRoom) {
      handleSelectRoom(familyRoom.room.building, familyRoom.room.roomNumber);
      return;
    }

    // 2. Find best available vacant room with capacity (exclude current room)
    const bestVacant = sortedRooms.find((r) => r.canFit && !r.isBlocked && r.currentOccupancy === 0 && !r.isCurrent);
    if (bestVacant) {
      handleSelectRoom(bestVacant.room.building, bestVacant.room.roomNumber);
      return;
    }

    // 3. Find any partially filled room with buffer/slots (exclude current room)
    const anyAvailable = sortedRooms.find((r) => r.canFit && !r.isBlocked && !r.isCurrent);
    if (anyAvailable) {
      handleSelectRoom(anyAvailable.room.building, anyAvailable.room.roomNumber);
      return;
    }

    alert('No suitable room found with sufficient remaining capacity for the selected dates.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-4xl w-full shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-stone-800">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-[#124E39] to-[#0E3C2C] text-white p-4 sm:p-5 flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <DoorClosed className="w-5 h-5 text-[#EBD59E]" />
              <h2 className="text-base sm:text-lg font-bold font-serif tracking-wide">
                Quick Room Allotment
              </h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#EBD59E]/20 text-[#EBD59E] border border-[#EBD59E]/40 font-semibold">
                Capacity + Buffer Enabled
              </span>
            </div>
            
            {/* Zaer Info Bar */}
            <div className="mt-2 text-xs text-stone-200 flex flex-wrap items-center gap-x-4 gap-y-1">
              <div>
                <span className="text-stone-400">Applicant: </span>
                <strong className="text-white">{targetReservation.applicantName}</strong>
              </div>
              <div>
                <span className="text-stone-400">ITS: </span>
                <span className="font-mono text-[#EBD59E] font-bold">{targetReservation.itsId}</span>
              </div>
              <div>
                <span className="text-stone-400">Family: </span>
                <strong className="text-white">{targetReservation.family}</strong> ({familyMembers.length} member{familyMembers.length > 1 ? 's' : ''})
              </div>
              <div className="flex items-center gap-1.5 text-[11px] bg-white/10 px-2.5 py-1 rounded-lg border border-white/15 flex-wrap">
                <Calendar className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span className="font-semibold text-white">Arr: {arrivalDate}</span>
                {targetReservation.arrivalTime && (
                  <span className="inline-flex items-center gap-1 bg-[#124E39] text-[#EBD59E] px-1.5 py-0.2 rounded text-[10px] font-bold border border-[#C5A059]/40">
                    <Clock className="w-2.5 h-2.5" />
                    {targetReservation.arrivalTime}
                  </span>
                )}
                <span className="text-stone-400 mx-1">➔</span>
                <span className="font-semibold text-white">Dep: {departureDate}</span>
                {targetReservation.departureTime && (
                  <span className="inline-flex items-center gap-1 bg-[#124E39] text-[#EBD59E] px-1.5 py-0.2 rounded text-[10px] font-bold border border-[#C5A059]/40">
                    <Clock className="w-2.5 h-2.5" />
                    {targetReservation.departureTime}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="p-3 sm:p-4 border-b border-[#E6DFD5] bg-[#F5F1E9] space-y-3 flex-shrink-0">
          
          {/* Top row: Allotment Scope (Single vs Entire Family) & Auto-Recommend */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {isFamily ? (
              <div className="flex items-center bg-stone-200/80 p-0.5 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setAllotMode('single')}
                  className={`px-3 py-1.5 rounded-lg transition ${
                    allotMode === 'single'
                      ? 'bg-[#124E39] text-white shadow-xs'
                      : 'text-stone-700 hover:text-stone-900'
                  }`}
                >
                  Allot Single (1 Pax)
                </button>
                <button
                  type="button"
                  onClick={() => setAllotMode('family')}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1 transition ${
                    allotMode === 'family'
                      ? 'bg-[#124E39] text-white shadow-xs'
                      : 'text-stone-700 hover:text-stone-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Allot Entire Family {targetReservation.family} ({familyMembers.length} Pax)</span>
                </button>
              </div>
            ) : (
              <span className="text-xs text-stone-600 font-medium">
                Single Zaer Allotment (1 Pax)
              </span>
            )}

            <button
              type="button"
              onClick={handleAutoRecommend}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-emerald-700 to-[#124E39] hover:from-emerald-800 hover:to-[#0E3C2C] text-white shadow-sm transition"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>⚡ Auto-Recommend Best Room</span>
            </button>
          </div>

          {/* Search and Hotel Tabs */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            {/* Search Box */}
            <div className="sm:col-span-5 relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Room # (e.g. 101, 203) or floor..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-[#D5CDBD] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-stone-400 hover:text-stone-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Hotel Filter Tabs */}
            <div className="sm:col-span-4 flex items-center bg-stone-200/70 p-0.5 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setHotelFilter('ALL')}
                className={`flex-1 py-1 text-center rounded-lg transition ${
                  hotelFilter === 'ALL' ? 'bg-white text-[#124E39] shadow-xs font-bold' : 'text-stone-600'
                }`}
              >
                All (114)
              </button>
              <button
                type="button"
                onClick={() => setHotelFilter('Saifee')}
                className={`flex-1 py-1 text-center rounded-lg transition ${
                  hotelFilter === 'Saifee' ? 'bg-white text-[#124E39] shadow-xs font-bold' : 'text-stone-600'
                }`}
              >
                Saifee (70)
              </button>
              <button
                type="button"
                onClick={() => setHotelFilter('Burhani')}
                className={`flex-1 py-1 text-center rounded-lg transition ${
                  hotelFilter === 'Burhani' ? 'bg-white text-[#124E39] shadow-xs font-bold' : 'text-stone-600'
                }`}
              >
                Burhani (44)
              </button>
            </div>

            {/* Floor selector */}
            <div className="sm:col-span-3">
              <select
                value={floorFilter}
                onChange={(e) => setFloorFilter(e.target.value)}
                className="w-full py-1.5 px-2.5 text-xs bg-white border border-[#D5CDBD] rounded-xl text-stone-700 font-medium"
              >
                {floorOptions.map((fl) => (
                  <option key={fl} value={fl}>
                    {fl === 'ALL' ? 'All Floors' : fl}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick amenity filters */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-stone-500 font-semibold mr-1">Filter by:</span>
            {[
              { id: 'ALL', label: 'All Specs' },
              { id: 'western', label: 'Western Toilet' },
              { id: 'indian', label: 'Indian Toilet' },
              { id: 'double', label: 'Double Bed' },
              { id: 'single', label: 'Single Beds' },
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setAmenityFilter(chip.id as any)}
                className={`px-2 py-0.5 rounded-full border transition font-medium ${
                  amenityFilter === chip.id
                    ? 'bg-[#124E39] text-white border-[#124E39] font-bold'
                    : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-100'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Room Grid / Cards */}
        <div className="p-4 overflow-y-auto flex-1 min-h-[300px]">
          {sortedRooms.length === 0 ? (
            <div className="py-12 text-center text-stone-500 space-y-2">
              <DoorClosed className="w-10 h-10 mx-auto text-stone-300" />
              <p className="text-sm font-semibold">No rooms match the selected filters.</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setHotelFilter('ALL');
                  setFloorFilter('ALL');
                  setAmenityFilter('ALL');
                }}
                className="text-xs text-[#124E39] underline font-bold"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {sortedRooms.map(
                ({
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
                  hasTimingConflict,
                  isSevereConflict,
                  canForceAllocate,
                  timingDiffHours,
                  conflictReason,
                }) => {
                  return (
                    <div
                      key={room.id}
                      className={`relative rounded-xl border p-3.5 transition flex flex-col justify-between ${
                        isCurrent
                          ? 'bg-emerald-50/90 border-emerald-500 shadow-md ring-2 ring-emerald-400'
                          : isBlocked
                          ? 'bg-stone-100 border-stone-300 opacity-60'
                          : canFit
                          ? 'bg-white hover:bg-[#FAF7F2] border-[#E6DFD5] hover:border-[#124E39]/60 shadow-xs'
                          : 'bg-stone-50 border-stone-200 opacity-75'
                      }`}
                    >
                      {/* Top Room Header */}
                      <div>
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-serif font-extrabold text-base text-[#124E39]">
                              Room {room.roomNumber}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-stone-100 font-bold text-stone-600">
                              {room.building}
                            </span>
                          </div>

                          {/* Occupancy Badge */}
                          {isBlocked ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800">
                              Blocked
                            </span>
                          ) : isFull ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
                              FULL ({currentOccupancy}/{maxCap})
                            </span>
                          ) : currentOccupancy > 0 ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                              {currentOccupancy}/{maxCap} Pax ({remainingSlots} left)
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                              Vacant (0/{maxCap})
                            </span>
                          )}
                        </div>

                        {/* Floor & Capacity Spec */}
                        <div className="text-[11px] text-stone-600 flex items-center gap-2 mb-2 font-medium">
                          <span>{room.floorLabel || `Floor ${room.floor}`}</span>
                          <span>•</span>
                          <span className="text-stone-800 font-bold">
                            Pax: {baseCap}{bufCap > 0 ? ` + ${bufCap} Buffer` : ''} (Max {maxCap})
                          </span>
                        </div>

                        {/* Room Amenities */}
                        <div className="flex flex-wrap gap-1 text-[9px] mb-2">
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200 truncate">
                            🚽 {room.toiletType || 'Standard'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 truncate">
                            🛏️ {room.bedType || 'Single Beds'}
                          </span>
                        </div>

                        {/* Highlight if Family Members are already here */}
                        {familyInRoom.length > 0 && (
                          <div className="mb-2 p-1.5 rounded-lg bg-emerald-100/80 border border-emerald-300 text-[10px] text-emerald-950 font-bold flex items-center gap-1">
                            <Users className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" />
                            <span>
                              Family {targetReservation.family} here: {familyInRoom.map((m) => m.applicantName.split(' ')[0]).join(', ')}
                            </span>
                          </div>
                        )}

                        {/* Same-day Turnover Timing Warning Banner */}
                        {hasTimingConflict && (
                          <div
                            className={`mb-2 p-2 rounded-lg text-[10px] flex items-start gap-1.5 leading-snug ${
                              isSevereConflict
                                ? 'bg-rose-50 text-rose-900 border border-rose-300 font-bold'
                                : 'bg-amber-50 text-amber-900 border border-amber-300 font-medium'
                            }`}
                          >
                            <AlertCircle
                              className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                isSevereConflict ? 'text-rose-600' : 'text-amber-600'
                              }`}
                            />
                            <div>
                              <div className="font-bold">
                                {isSevereConflict
                                  ? `⛔ Critical Conflict: Dep > Arr by ${timingDiffHours}h (>15h)`
                                  : `⚠️ Turnover Warning: Dep > Arr by ${timingDiffHours}h`}
                              </div>
                              <div className="text-[9px] text-stone-600 mt-0.5">{conflictReason}</div>
                            </div>
                          </div>
                        )}

                        {/* Capacity Exceeded Banner */}
                        {currentOccupancy + requestedPax > maxCap && !isCurrent && (
                          <div className="mb-2 p-2 rounded-lg text-[10px] flex items-start gap-1.5 leading-snug bg-rose-50 text-rose-900 border border-rose-300 font-bold">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600" />
                            <div>
                              <div className="font-bold">⚠️ Room Not Vacant / Pax Limit Notice ({currentOccupancy + requestedPax}/{maxCap} Pax)</div>
                              <div className="text-[9px] text-stone-600 mt-0.5">
                                Room is currently occupied or exceeds max capacity. Force allocation is allowed upon acknowledging the notice.
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Current Roommates preview */}
                        {occupants.length > 0 && (
                          <div className="mb-2 text-[10px] text-stone-600 bg-stone-50 p-1.5 rounded border border-stone-200">
                            <span className="font-semibold text-stone-700 block">Current Occupants ({occupants.length}):</span>
                            <div className="truncate text-stone-500">
                              {occupants.map((o) => `${o.applicantName} (${o.family})`).join(' • ')}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action Button */}
                      <div className="mt-2 pt-2 border-t border-stone-200/80">
                        {isCurrent ? (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-emerald-700 font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Current Room
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onAllotRoom(targetReservation.id, targetReservation.building || 'Saifee', '');
                                onClose();
                              }}
                              className="text-[10px] text-red-600 hover:text-red-800 font-bold underline cursor-pointer"
                            >
                              Unallot
                            </button>
                          </div>
                        ) : isBlocked ? (
                          <button
                            type="button"
                            disabled
                            className="w-full py-1.5 rounded-lg text-xs font-bold bg-stone-200 text-stone-500 cursor-not-allowed text-center"
                          >
                            Room Blocked
                          </button>
                        ) : hasTimingConflict && !canFit ? (
                          <button
                            type="button"
                            onClick={() => handleSelectRoom(room.building, room.roomNumber)}
                            className="w-full py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                            title={conflictReason}
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-200" />
                            <span>Same-Day Turnover ({timingDiffHours !== undefined ? `${timingDiffHours}h diff` : 'Notice'}) ➔ Allot</span>
                          </button>
                        ) : !canFit ? (
                          <button
                            type="button"
                            onClick={() => handleSelectRoom(room.building, room.roomNumber)}
                            className="w-full py-1.5 rounded-lg text-xs font-bold bg-amber-700 hover:bg-amber-800 text-white shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                            title={conflictReason}
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-200" />
                            <span>Force Allot ({currentOccupancy}/${maxCap} Pax • Not Vacant)</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelectRoom(room.building, room.roomNumber)}
                            className="w-full py-1.5 rounded-lg text-xs font-extrabold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <span>Allot Room {room.roomNumber}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-[#EBD59E]" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 bg-[#FAF7F2] border-t border-[#E6DFD5] flex items-center justify-between text-xs text-stone-500 flex-shrink-0">
          <div>
            Showing <strong className="text-stone-700">{sortedRooms.length}</strong> rooms • Saifee (70) & Burhani (44)
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-stone-300 text-stone-700 font-bold hover:bg-stone-200 transition"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
};
