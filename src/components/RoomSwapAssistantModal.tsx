import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowRightLeft,
  X,
  Building2,
  BedDouble,
  Users,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Info,
  History,
  ShieldAlert,
  ArrowRight,
  Sparkles,
  Search,
  Filter,
  RefreshCw,
  DoorClosed
} from 'lucide-react';
import { Room, RoomStatus, Reservation } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';

interface RoomSwapAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  rooms: Room[];
  reservations: Reservation[];
  initialRoomAId?: string;
  initialRoomBId?: string;
  onExecuteSwap: (
    roomA: Room,
    roomB: Room,
    reservationsFromA: Reservation[],
    reservationsFromB: Reservation[],
    newStatusA: RoomStatus,
    newStatusB: RoomStatus,
    reason: string
  ) => void;
}

export const RoomSwapAssistantModal: React.FC<RoomSwapAssistantModalProps> = ({
  isOpen,
  onClose,
  rooms = [],
  reservations = [],
  initialRoomAId,
  initialRoomBId,
  onExecuteSwap,
}) => {
  // Building filters for Room A and Room B selection
  const [bldgFilterA, setBldgFilterA] = useState<string>('ALL');
  const [bldgFilterB, setBldgFilterB] = useState<string>('ALL');

  // Search queries for Room A and Room B
  const [searchA, setSearchA] = useState<string>('');
  const [searchB, setSearchB] = useState<string>('');

  // Selected room IDs
  const [selectedRoomAId, setSelectedRoomAId] = useState<string>(initialRoomAId || '');
  const [selectedRoomBId, setSelectedRoomBId] = useState<string>(initialRoomBId || '');

  // Custom Swap reason
  const [swapReason, setSwapReason] = useState<string>('Guest request - Room Swap optimization');

  // Checkbox selections for specific reservations (defaults to all in room)
  const [selectedResIdsA, setSelectedResIdsA] = useState<Set<string>>(new Set());
  const [selectedResIdsB, setSelectedResIdsB] = useState<Set<string>>(new Set());

  // Distinct buildings
  const distinctBuildings = useMemo(() => {
    return Array.from(new Set(rooms.map((r) => r.building).filter(Boolean))).sort();
  }, [rooms]);

  // Sync initial rooms when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialRoomAId) {
        setSelectedRoomAId(initialRoomAId);
      } else if (!selectedRoomAId && rooms.length > 0) {
        // Pick first room with reservations if possible
        const roomWithRes = rooms.find((r) =>
          reservations.some(
            (res) =>
              (res.building || '').trim().toLowerCase() === (r.building || '').trim().toLowerCase() &&
              (res.roomNumber || '').trim().toLowerCase() === (r.roomNumber || '').trim().toLowerCase()
          )
        );
        setSelectedRoomAId(roomWithRes ? roomWithRes.id : rooms[0].id);
      }

      if (initialRoomBId) {
        setSelectedRoomBId(initialRoomBId);
      }
    }
  }, [isOpen, initialRoomAId, initialRoomBId, rooms]);

  // Object references for Room A and Room B
  const roomA = useMemo(() => rooms.find((r) => r.id === selectedRoomAId) || null, [rooms, selectedRoomAId]);
  const roomB = useMemo(() => rooms.find((r) => r.id === selectedRoomBId) || null, [rooms, selectedRoomBId]);

  // Filtered rooms lists for dropdowns
  const availableRoomsForA = useMemo(() => {
    return rooms.filter((r) => {
      if (bldgFilterA !== 'ALL' && r.building.toLowerCase() !== bldgFilterA.toLowerCase()) return false;
      if (searchA.trim()) {
        const q = searchA.toLowerCase();
        const matchNum = r.roomNumber.toLowerCase().includes(q);
        const matchBldg = r.building.toLowerCase().includes(q);
        const matchCat = r.category.toLowerCase().includes(q);
        if (!matchNum && !matchBldg && !matchCat) return false;
      }
      return true;
    });
  }, [rooms, bldgFilterA, searchA]);

  const availableRoomsForB = useMemo(() => {
    return rooms.filter((r) => {
      if (bldgFilterB !== 'ALL' && r.building.toLowerCase() !== bldgFilterB.toLowerCase()) return false;
      if (searchB.trim()) {
        const q = searchB.toLowerCase();
        const matchNum = r.roomNumber.toLowerCase().includes(q);
        const matchBldg = r.building.toLowerCase().includes(q);
        const matchCat = r.category.toLowerCase().includes(q);
        if (!matchNum && !matchBldg && !matchCat) return false;
      }
      return true;
    });
  }, [rooms, bldgFilterB, searchB]);

  // All reservations assigned to Room A
  const allReservationsInRoomA = useMemo(() => {
    if (!roomA) return [];
    const rBldg = (roomA.building || '').trim().toLowerCase();
    const rNum = (roomA.roomNumber || '').trim().toLowerCase();
    return reservations.filter(
      (r) =>
        (r.building || '').trim().toLowerCase() === rBldg &&
        (r.roomNumber || '').trim().toLowerCase() === rNum &&
        r.roomNumber !== ''
    );
  }, [roomA, reservations]);

  // All reservations assigned to Room B
  const allReservationsInRoomB = useMemo(() => {
    if (!roomB) return [];
    const rBldg = (roomB.building || '').trim().toLowerCase();
    const rNum = (roomB.roomNumber || '').trim().toLowerCase();
    return reservations.filter(
      (r) =>
        (r.building || '').trim().toLowerCase() === rBldg &&
        (r.roomNumber || '').trim().toLowerCase() === rNum &&
        r.roomNumber !== ''
    );
  }, [roomB, reservations]);

  // Initialize selected reservations when room changes
  useEffect(() => {
    setSelectedResIdsA(new Set(allReservationsInRoomA.map((r) => r.id)));
  }, [allReservationsInRoomA]);

  useEffect(() => {
    setSelectedResIdsB(new Set(allReservationsInRoomB.map((r) => r.id)));
  }, [allReservationsInRoomB]);

  const reservationsToMoveFromA = useMemo(() => {
    return allReservationsInRoomA.filter((r) => selectedResIdsA.has(r.id));
  }, [allReservationsInRoomA, selectedResIdsA]);

  const reservationsToMoveFromB = useMemo(() => {
    return allReservationsInRoomB.filter((r) => selectedResIdsB.has(r.id));
  }, [allReservationsInRoomB, selectedResIdsB]);

  // Target statuses
  const defaultStatusA: RoomStatus = useMemo(() => {
    if (!roomA) return 'available';
    // If Room A will receive guests from Room B -> occupied
    if (reservationsToMoveFromB.length > 0) return 'occupied';
    // If Room A had guests and now has none -> cleaning / ready
    if (allReservationsInRoomA.length > 0) return 'cleaning';
    return roomA.status || 'available';
  }, [roomA, reservationsToMoveFromB, allReservationsInRoomA]);

  const defaultStatusB: RoomStatus = useMemo(() => {
    if (!roomB) return 'available';
    // If Room B will receive guests from Room A -> occupied
    if (reservationsToMoveFromA.length > 0) return 'occupied';
    // If Room B had guests and now has none -> cleaning / ready
    if (allReservationsInRoomB.length > 0) return 'cleaning';
    return roomB.status || 'available';
  }, [roomB, reservationsToMoveFromA, allReservationsInRoomB]);

  const [targetStatusA, setTargetStatusA] = useState<RoomStatus>(defaultStatusA);
  const [targetStatusB, setTargetStatusB] = useState<RoomStatus>(defaultStatusB);

  // Update target statuses whenever default calculations change
  useEffect(() => {
    setTargetStatusA(defaultStatusA);
  }, [defaultStatusA]);

  useEffect(() => {
    setTargetStatusB(defaultStatusB);
  }, [defaultStatusB]);

  // Swap Direction (flip Room A and Room B)
  const handleSwapDirection = () => {
    const tempId = selectedRoomAId;
    setSelectedRoomAId(selectedRoomBId);
    setSelectedRoomBId(tempId);
  };

  // Automated Plan Validation
  const planValidation = useMemo(() => {
    if (!roomA || !roomB) {
      return {
        isValid: false,
        error: 'Please select both Room A and Room B.',
        warnings: [],
      };
    }

    if (roomA.id === roomB.id) {
      return {
        isValid: false,
        error: 'Room A and Room B cannot be the same room.',
        warnings: [],
      };
    }

    const totalToMove = reservationsToMoveFromA.length + reservationsToMoveFromB.length;
    if (totalToMove === 0) {
      return {
        isValid: false,
        error: 'Neither room has any assigned reservations selected to swap.',
        warnings: [],
      };
    }

    const warnings: string[] = [];

    // Capacity checks
    const paxFromA = reservationsToMoveFromA.reduce((sum, r) => sum + (r.pax || r.paxCount || 1), 0);
    const maxCapacityB = roomB.capacity + (roomB.buffer || 0);
    if (paxFromA > maxCapacityB) {
      warnings.push(
        `Room A guests (${paxFromA} Pax) exceed Room B capacity (${roomB.capacity} + ${roomB.buffer || 0} buffer = ${maxCapacityB} Pax max).`
      );
    }

    const paxFromB = reservationsToMoveFromB.reduce((sum, r) => sum + (r.pax || r.paxCount || 1), 0);
    const maxCapacityA = roomA.capacity + (roomA.buffer || 0);
    if (paxFromB > maxCapacityA) {
      warnings.push(
        `Room B guests (${paxFromB} Pax) exceed Room A capacity (${roomA.capacity} + ${roomA.buffer || 0} buffer = ${maxCapacityA} Pax max).`
      );
    }

    // Category difference
    if (roomA.category !== roomB.category) {
      warnings.push(
        `Accommodation Category difference: Room ${roomA.roomNumber} is "${roomA.category}" whereas Room ${roomB.roomNumber} is "${roomB.category}".`
      );
    }

    // Blocked room check
    if (roomA.status === 'blocked' || roomB.status === 'blocked') {
      const blockedRoom = roomA.status === 'blocked' ? roomA : roomB;
      warnings.push(
        `Room ${blockedRoom.roomNumber} is currently marked as BLOCKED (${blockedRoom.blockedReason || 'Administrative hold'}). Executing swap will update its status.`
      );
    }

    return {
      isValid: true,
      error: null,
      warnings,
      paxFromA,
      paxFromB,
    };
  }, [roomA, roomB, reservationsToMoveFromA, reservationsToMoveFromB]);

  // Execute Swap Handler
  const handleExecute = () => {
    if (!roomA || !roomB || !planValidation.isValid) return;

    if (planValidation.warnings.length > 0) {
      const proceed = window.confirm(
        `⚠️ Room Swap Warning:\n\n${planValidation.warnings.join('\n\n')}\n\nDo you want to proceed with swapping the reservations and updating history logs and room statuses?`
      );
      if (!proceed) return;
    }

    onExecuteSwap(
      roomA,
      roomB,
      reservationsToMoveFromA,
      reservationsToMoveFromB,
      targetStatusA,
      targetStatusB,
      swapReason
    );
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[94vh] flex flex-col shadow-2xl border border-stone-300 overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#124E39] text-white px-5 py-3.5 flex items-center justify-between shrink-0 border-b border-[#C5A059]/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/10 border border-[#EBD59E]/30">
              <ArrowRightLeft className="w-5 h-5 text-[#EBD59E]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-[#EBD59E] tracking-wide">
                  Room Swap Assistant
                </h3>
                <span className="text-[10px] uppercase font-bold bg-[#EBD59E] text-[#124E39] px-2 py-0.5 rounded-full">
                  Admin Tool
                </span>
              </div>
              <p className="text-xs text-emerald-100/90 mt-0.5">
                Select two rooms to automatically generate an exchange plan, update audit history logs, and set room statuses simultaneously.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-300 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
            title="Close Assistant"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-[#FAF7F2]/50">
          
          {/* Quick preset swap reason bar */}
          <div className="bg-white p-3 rounded-xl border border-stone-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-stone-700">
              <span className="flex items-center gap-1.5">
                <History className="w-4 h-4 text-[#124E39]" />
                <span>Audit Trail Reason for Swap (Will be logged in Zaereen History):</span>
              </span>
              <span className="text-[11px] text-stone-400 font-normal">Stored permanently in reservation records</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {[
                'Guest request - Accessibility / Ground floor',
                'Family consolidation & proximity swap',
                'Medical / Special assistance requirement',
                'AC / Maintenance room swap',
                'Tour coordinator re-allocation',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSwapReason(preset)}
                  className={`px-2 py-1 rounded-lg border transition text-left cursor-pointer ${
                    swapReason === preset
                      ? 'bg-[#124E39] text-[#EBD59E] border-[#124E39] font-bold shadow-2xs'
                      : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={swapReason}
              onChange={(e) => setSwapReason(e.target.value)}
              placeholder="Enter custom swap reason..."
              className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
            />
          </div>

          {/* Side-by-side Room Selection & Occupants Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 relative">
            
            {/* Center Swap Direction Button */}
            <div className="hidden lg:flex absolute left-1/2 top-28 -translate-x-1/2 -translate-y-1/2 z-20">
              <button
                type="button"
                onClick={handleSwapDirection}
                className="w-10 h-10 rounded-full bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] border-2 border-white shadow-lg flex items-center justify-center transition transform hover:scale-105 cursor-pointer"
                title="Swap Direction (Flip Room A and Room B)"
              >
                <ArrowRightLeft className="w-5 h-5" />
              </button>
            </div>

            {/* ROOM A CARD */}
            <div className="bg-white rounded-2xl border-2 border-stone-200 shadow-xs p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#124E39] text-[#EBD59E] text-xs font-black flex items-center justify-center">
                    A
                  </span>
                  <div>
                    <h4 className="font-bold text-sm text-stone-900">Room A (Source / Primary)</h4>
                    <span className="text-[10px] text-stone-500">Select first room to swap</span>
                  </div>
                </div>
                {roomA && (
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase ${
                    roomA.status === 'occupied' ? 'bg-purple-100 text-purple-900 border-purple-300' :
                    roomA.status === 'blocked' ? 'bg-rose-100 text-rose-900 border-rose-300' :
                    roomA.status === 'cleaning' ? 'bg-amber-100 text-amber-900 border-amber-300' :
                    'bg-emerald-100 text-emerald-900 border-emerald-300'
                  }`}>
                    {roomA.status}
                  </span>
                )}
              </div>

              {/* Room A Filter & Select */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <span className="font-bold text-stone-600">Building:</span>
                  <button
                    type="button"
                    onClick={() => setBldgFilterA('ALL')}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                      bldgFilterA === 'ALL' ? 'bg-[#124E39] text-white' : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    All
                  </button>
                  {distinctBuildings.map((bldg) => (
                    <button
                      key={bldg}
                      type="button"
                      onClick={() => setBldgFilterA(bldg)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                        bldgFilterA === bldg ? 'bg-[#124E39] text-white' : 'bg-stone-100 text-stone-700'
                      }`}
                    >
                      {bldg}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-stone-400" />
                    <input
                      type="text"
                      placeholder="Search Room A by number..."
                      value={searchA}
                      onChange={(e) => setSearchA(e.target.value)}
                      className="w-full pl-8 pr-2 py-1 text-xs bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                    />
                  </div>
                  <select
                    value={selectedRoomAId}
                    onChange={(e) => setSelectedRoomAId(e.target.value)}
                    className="w-1/2 bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39] cursor-pointer truncate"
                  >
                    <option value="">-- Choose Room A --</option>
                    {availableRoomsForA.map((r) => {
                      const resCount = reservations.filter(
                        (res) =>
                          (res.building || '').toLowerCase() === r.building.toLowerCase() &&
                          (res.roomNumber || '').toLowerCase() === r.roomNumber.toLowerCase()
                      ).length;
                      return (
                        <option key={r.id} value={r.id}>
                          Room {r.roomNumber} ({r.building} • Fl {r.floor}) {resCount > 0 ? `[${resCount} guests]` : '[Vacant]'}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Room A Details Profile */}
              {roomA ? (
                <div className="space-y-3 pt-2">
                  <div className="bg-[#FAF7F2] p-3 rounded-xl border border-[#E6DFD5] flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-mono font-black text-lg text-[#124E39]">
                        Room {roomA.roomNumber}
                      </div>
                      <div className="text-[11px] font-bold text-stone-700">
                        {roomA.building} Hotel • {roomA.floorLabel || `Floor ${roomA.floor}`}
                      </div>
                      <div className="text-[10px] text-stone-500 mt-0.5">
                        {roomA.bedType || 'Standard Beds'} • {roomA.toiletType || 'Standard Toilet'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-stone-900">
                        Capacity: <span className="font-mono text-emerald-800">{roomA.capacity} Pax</span>
                      </div>
                      {roomA.buffer ? (
                        <div className="text-[10px] text-amber-800 font-semibold">
                          +{roomA.buffer} Buffer Capacity
                        </div>
                      ) : null}
                      <span className="inline-block mt-1 text-[10px] font-bold bg-[#124E39]/10 text-[#124E39] border border-[#124E39]/20 px-2 py-0.5 rounded">
                        {roomA.category}
                      </span>
                    </div>
                  </div>

                  {/* Room A Assigned Reservations */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-stone-800 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#124E39]" />
                        <span>Assigned Guests ({allReservationsInRoomA.length})</span>
                      </span>
                      {allReservationsInRoomA.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedResIdsA.size === allReservationsInRoomA.length) {
                              setSelectedResIdsA(new Set());
                            } else {
                              setSelectedResIdsA(new Set(allReservationsInRoomA.map((r) => r.id)));
                            }
                          }}
                          className="text-[10px] font-bold text-[#124E39] hover:underline cursor-pointer"
                        >
                          {selectedResIdsA.size === allReservationsInRoomA.length ? 'Deselect All' : 'Select All'}
                        </button>
                      )}
                    </div>

                    {allReservationsInRoomA.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {allReservationsInRoomA.map((r) => {
                          const isSelected = selectedResIdsA.has(r.id);
                          return (
                            <label
                              key={r.id}
                              className={`p-2 rounded-lg border flex items-start gap-2.5 transition text-xs cursor-pointer ${
                                isSelected
                                  ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-300'
                                  : 'bg-stone-50 border-stone-200 opacity-60'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const next = new Set(selectedResIdsA);
                                  if (e.target.checked) next.add(r.id);
                                  else next.delete(r.id);
                                  setSelectedResIdsA(next);
                                }}
                                className="mt-0.5 rounded text-[#124E39] focus:ring-[#124E39]"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-bold text-stone-900 truncate">
                                    {r.applicantName}
                                  </span>
                                  <span className="font-mono text-[10px] font-bold bg-white border border-stone-200 px-1.5 py-0.2 rounded text-stone-700">
                                    Fam #{r.family}
                                  </span>
                                </div>
                                <div className="text-[11px] text-stone-600 flex items-center justify-between gap-2 mt-0.5">
                                  <span className="truncate">Tour: {r.tourRefNo}</span>
                                  <span className="font-mono font-semibold text-[10px] text-stone-500">
                                    ITS: {r.itsId}
                                  </span>
                                </div>
                                <div className="text-[10px] text-stone-500 flex items-center gap-1 mt-0.5">
                                  <Calendar className="w-3 h-3 text-stone-400" />
                                  <span>{r.arrivalDate} ➔ {r.departureDate}</span>
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-stone-50 border border-dashed border-stone-300 text-center text-xs text-stone-500">
                        <DoorClosed className="w-5 h-5 mx-auto text-stone-400 mb-1" />
                        <span>Room A is currently vacant.</span>
                        <div className="text-[10px] text-stone-400 mt-0.5">
                          It will receive guests arriving from Room B upon swap.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-stone-400 text-xs italic">
                  Select Room A from the dropdown above to inspect details and occupants.
                </div>
              )}
            </div>

            {/* ROOM B CARD */}
            <div className="bg-white rounded-2xl border-2 border-stone-200 shadow-xs p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#C5A059] text-stone-950 text-xs font-black flex items-center justify-center">
                    B
                  </span>
                  <div>
                    <h4 className="font-bold text-sm text-stone-900">Room B (Target / Secondary)</h4>
                    <span className="text-[10px] text-stone-500">Select second room to swap</span>
                  </div>
                </div>
                {roomB && (
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase ${
                    roomB.status === 'occupied' ? 'bg-purple-100 text-purple-900 border-purple-300' :
                    roomB.status === 'blocked' ? 'bg-rose-100 text-rose-900 border-rose-300' :
                    roomB.status === 'cleaning' ? 'bg-amber-100 text-amber-900 border-amber-300' :
                    'bg-emerald-100 text-emerald-900 border-emerald-300'
                  }`}>
                    {roomB.status}
                  </span>
                )}
              </div>

              {/* Room B Filter & Select */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <span className="font-bold text-stone-600">Building:</span>
                  <button
                    type="button"
                    onClick={() => setBldgFilterB('ALL')}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                      bldgFilterB === 'ALL' ? 'bg-[#124E39] text-white' : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    All
                  </button>
                  {distinctBuildings.map((bldg) => (
                    <button
                      key={bldg}
                      type="button"
                      onClick={() => setBldgFilterB(bldg)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                        bldgFilterB === bldg ? 'bg-[#124E39] text-white' : 'bg-stone-100 text-stone-700'
                      }`}
                    >
                      {bldg}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-stone-400" />
                    <input
                      type="text"
                      placeholder="Search Room B by number..."
                      value={searchB}
                      onChange={(e) => setSearchB(e.target.value)}
                      className="w-full pl-8 pr-2 py-1 text-xs bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                    />
                  </div>
                  <select
                    value={selectedRoomBId}
                    onChange={(e) => setSelectedRoomBId(e.target.value)}
                    className="w-1/2 bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39] cursor-pointer truncate"
                  >
                    <option value="">-- Choose Room B --</option>
                    {availableRoomsForB.map((r) => {
                      const resCount = reservations.filter(
                        (res) =>
                          (res.building || '').toLowerCase() === r.building.toLowerCase() &&
                          (res.roomNumber || '').toLowerCase() === r.roomNumber.toLowerCase()
                      ).length;
                      return (
                        <option key={r.id} value={r.id} disabled={r.id === selectedRoomAId}>
                          Room {r.roomNumber} ({r.building} • Fl {r.floor}) {resCount > 0 ? `[${resCount} guests]` : '[Vacant]'} {r.id === selectedRoomAId ? '(Chosen as A)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Room B Details Profile */}
              {roomB ? (
                <div className="space-y-3 pt-2">
                  <div className="bg-[#FAF7F2] p-3 rounded-xl border border-[#E6DFD5] flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-mono font-black text-lg text-[#124E39]">
                        Room {roomB.roomNumber}
                      </div>
                      <div className="text-[11px] font-bold text-stone-700">
                        {roomB.building} Hotel • {roomB.floorLabel || `Floor ${roomB.floor}`}
                      </div>
                      <div className="text-[10px] text-stone-500 mt-0.5">
                        {roomB.bedType || 'Standard Beds'} • {roomB.toiletType || 'Standard Toilet'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-stone-900">
                        Capacity: <span className="font-mono text-emerald-800">{roomB.capacity} Pax</span>
                      </div>
                      {roomB.buffer ? (
                        <div className="text-[10px] text-amber-800 font-semibold">
                          +{roomB.buffer} Buffer Capacity
                        </div>
                      ) : null}
                      <span className="inline-block mt-1 text-[10px] font-bold bg-[#124E39]/10 text-[#124E39] border border-[#124E39]/20 px-2 py-0.5 rounded">
                        {roomB.category}
                      </span>
                    </div>
                  </div>

                  {/* Room B Assigned Reservations */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-stone-800 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#124E39]" />
                        <span>Assigned Guests ({allReservationsInRoomB.length})</span>
                      </span>
                      {allReservationsInRoomB.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedResIdsB.size === allReservationsInRoomB.length) {
                              setSelectedResIdsB(new Set());
                            } else {
                              setSelectedResIdsB(new Set(allReservationsInRoomB.map((r) => r.id)));
                            }
                          }}
                          className="text-[10px] font-bold text-[#124E39] hover:underline cursor-pointer"
                        >
                          {selectedResIdsB.size === allReservationsInRoomB.length ? 'Deselect All' : 'Select All'}
                        </button>
                      )}
                    </div>

                    {allReservationsInRoomB.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {allReservationsInRoomB.map((r) => {
                          const isSelected = selectedResIdsB.has(r.id);
                          return (
                            <label
                              key={r.id}
                              className={`p-2 rounded-lg border flex items-start gap-2.5 transition text-xs cursor-pointer ${
                                isSelected
                                  ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-300'
                                  : 'bg-stone-50 border-stone-200 opacity-60'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const next = new Set(selectedResIdsB);
                                  if (e.target.checked) next.add(r.id);
                                  else next.delete(r.id);
                                  setSelectedResIdsB(next);
                                }}
                                className="mt-0.5 rounded text-[#124E39] focus:ring-[#124E39]"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-bold text-stone-900 truncate">
                                    {r.applicantName}
                                  </span>
                                  <span className="font-mono text-[10px] font-bold bg-white border border-stone-200 px-1.5 py-0.2 rounded text-stone-700">
                                    Fam #{r.family}
                                  </span>
                                </div>
                                <div className="text-[11px] text-stone-600 flex items-center justify-between gap-2 mt-0.5">
                                  <span className="truncate">Tour: {r.tourRefNo}</span>
                                  <span className="font-mono font-semibold text-[10px] text-stone-500">
                                    ITS: {r.itsId}
                                  </span>
                                </div>
                                <div className="text-[10px] text-stone-500 flex items-center gap-1 mt-0.5">
                                  <Calendar className="w-3 h-3 text-stone-400" />
                                  <span>{r.arrivalDate} ➔ {r.departureDate}</span>
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-stone-50 border border-dashed border-stone-300 text-center text-xs text-stone-500">
                        <DoorClosed className="w-5 h-5 mx-auto text-stone-400 mb-1" />
                        <span>Room B is currently vacant.</span>
                        <div className="text-[10px] text-stone-400 mt-0.5">
                          It will receive guests arriving from Room A upon swap.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-stone-400 text-xs italic">
                  Select Room B from the dropdown above to inspect details and occupants.
                </div>
              )}
            </div>
          </div>

          {/* AUTOMATED PLAN GENERATION & IMPACT ANALYSIS */}
          {roomA && roomB && (
            <div className="bg-white rounded-2xl border-2 border-[#124E39]/30 shadow-sm p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#124E39]" />
                  <h4 className="font-bold text-sm text-[#124E39]">
                    Generated Room Swap Execution Plan
                  </h4>
                </div>
                <span className="text-xs font-bold text-stone-600 bg-stone-100 px-2.5 py-0.5 rounded-full">
                  Total Guests Swapping: {reservationsToMoveFromA.length + reservationsToMoveFromB.length}
                </span>
              </div>

              {/* Validation Errors or Warnings */}
              {planValidation.error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />
                  <span>{planValidation.error}</span>
                </div>
              )}

              {planValidation.warnings.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Swap Compatibility Notices:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] pl-1 text-amber-900">
                    {planValidation.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Visual Plan Mapping */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Movement 1: Room A -> Room B */}
                <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#E6DFD5] space-y-2">
                  <div className="flex items-center justify-between pb-1 border-b border-stone-200">
                    <span className="font-bold text-stone-800">
                      Step 1: Relocate {reservationsToMoveFromA.length} Guests from Room A
                    </span>
                    <span className="font-mono font-bold text-[#124E39]">
                      Room {roomA.roomNumber} ➔ Room {roomB.roomNumber}
                    </span>
                  </div>
                  {reservationsToMoveFromA.length > 0 ? (
                    <div className="space-y-1">
                      {reservationsToMoveFromA.map((r) => (
                        <div key={r.id} className="text-[11px] text-stone-700 bg-white p-1.5 rounded border border-stone-200 flex items-center justify-between">
                          <span className="font-semibold text-stone-900 truncate">
                            {r.applicantName} (Fam #{r.family})
                          </span>
                          <span className="text-[10px] text-emerald-800 font-bold shrink-0">
                            ➔ Moves to {roomB.building} Rm {roomB.roomNumber}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-stone-400 italic text-[11px]">No guests to move out of Room A</span>
                  )}
                </div>

                {/* Movement 2: Room B -> Room A */}
                <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#E6DFD5] space-y-2">
                  <div className="flex items-center justify-between pb-1 border-b border-stone-200">
                    <span className="font-bold text-stone-800">
                      Step 2: Relocate {reservationsToMoveFromB.length} Guests from Room B
                    </span>
                    <span className="font-mono font-bold text-[#124E39]">
                      Room {roomB.roomNumber} ➔ Room {roomA.roomNumber}
                    </span>
                  </div>
                  {reservationsToMoveFromB.length > 0 ? (
                    <div className="space-y-1">
                      {reservationsToMoveFromB.map((r) => (
                        <div key={r.id} className="text-[11px] text-stone-700 bg-white p-1.5 rounded border border-stone-200 flex items-center justify-between">
                          <span className="font-semibold text-stone-900 truncate">
                            {r.applicantName} (Fam #{r.family})
                          </span>
                          <span className="text-[10px] text-emerald-800 font-bold shrink-0">
                            ➔ Moves to {roomA.building} Rm {roomA.roomNumber}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-stone-400 italic text-[11px]">No guests to move out of Room B</span>
                  )}
                </div>
              </div>

              {/* Simultaneous Room Status Update Selector */}
              <div className="pt-2 border-t border-stone-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-stone-800">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>Simultaneous Room Status Updates upon Swap:</span>
                  </span>
                  <span className="text-[11px] text-stone-500 font-normal">Automatically recommended & customizable</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Status A */}
                  <div className="flex items-center justify-between bg-stone-50 p-2.5 rounded-xl border border-stone-200">
                    <div>
                      <span className="font-bold text-stone-900 block">Room {roomA.roomNumber} Status:</span>
                      <span className="text-[10px] text-stone-500">
                        {reservationsToMoveFromB.length > 0 ? 'Receiving guests ➔ Occupied' : 'Vacating ➔ Cleaning/Ready'}
                      </span>
                    </div>
                    <select
                      value={targetStatusA}
                      onChange={(e) => setTargetStatusA(e.target.value as RoomStatus)}
                      className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs font-bold text-stone-900 focus:outline-none cursor-pointer"
                    >
                      <option value="occupied">occupied</option>
                      <option value="available">available</option>
                      <option value="cleaning">cleaning</option>
                      <option value="maintenance">maintenance</option>
                      <option value="blocked">blocked</option>
                    </select>
                  </div>

                  {/* Status B */}
                  <div className="flex items-center justify-between bg-stone-50 p-2.5 rounded-xl border border-stone-200">
                    <div>
                      <span className="font-bold text-stone-900 block">Room {roomB.roomNumber} Status:</span>
                      <span className="text-[10px] text-stone-500">
                        {reservationsToMoveFromA.length > 0 ? 'Receiving guests ➔ Occupied' : 'Vacating ➔ Cleaning/Ready'}
                      </span>
                    </div>
                    <select
                      value={targetStatusB}
                      onChange={(e) => setTargetStatusB(e.target.value as RoomStatus)}
                      className="bg-white border border-stone-300 rounded-lg px-2 py-1 text-xs font-bold text-stone-900 focus:outline-none cursor-pointer"
                    >
                      <option value="occupied">occupied</option>
                      <option value="available">available</option>
                      <option value="cleaning">cleaning</option>
                      <option value="maintenance">maintenance</option>
                      <option value="blocked">blocked</option>
                    </select>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-stone-100 border-t border-stone-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-stone-600">
            {roomA && roomB ? (
              <span>
                Ready to swap: <strong>Room {roomA.roomNumber} ({roomA.building})</strong> ⇄ <strong>Room {roomB.roomNumber} ({roomB.building})</strong>
              </span>
            ) : (
              <span>Please pick both Room A and Room B to generate swap plan.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-stone-200 text-stone-700 border border-stone-300 transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleExecute}
              disabled={!planValidation.isValid}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ${
                planValidation.isValid
                  ? 'bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E]'
                  : 'bg-stone-300 text-stone-500 cursor-not-allowed'
              }`}
            >
              <ArrowRightLeft className="w-4 h-4 text-[#EBD59E]" />
              <span>Execute Room Swap & Update History</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
