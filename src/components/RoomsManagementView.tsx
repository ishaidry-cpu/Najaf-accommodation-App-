import React, { useState } from 'react';
import { 
  Building2, 
  BedDouble, 
  ShieldAlert, 
  CheckCircle2, 
  AlertTriangle, 
  Filter, 
  Plus, 
  Trash2, 
  Search, 
  Lock, 
  Unlock, 
  Sparkles,
  Calendar,
  X,
  RotateCcw
} from 'lucide-react';
import { Room, RoomStatus, RoomCategory, Reservation } from '../types';
import { getRoomStatusOnDate, getRoomBookingOnDate } from '../services/storage';

interface RoomsManagementViewProps {
  rooms: Room[];
  reservations: Reservation[];
  onUpdateRoomStatus: (roomId: string, status: RoomStatus) => void;
  onUpdateRoomDetails: (updatedRoom: Room) => void;
  onResetRoomsToSaifeeBurhani: () => void;
}

export const RoomsManagementView: React.FC<RoomsManagementViewProps> = ({
  rooms,
  reservations,
  onUpdateRoomStatus,
  onUpdateRoomDetails,
  onResetRoomsToSaifeeBurhani,
}) => {
  const [selectedBuilding, setSelectedBuilding] = useState<string>('ALL');
  const [selectedFloorLabel, setSelectedFloorLabel] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Date for dynamic availability check
  const todayStr = new Date().toISOString().slice(0, 10);
  const [checkDate, setCheckDate] = useState<string>(todayStr);

  const [inspectingRoom, setInspectingRoom] = useState<Room | null>(null);

  // Available floors for current building
  const availableFloorLabels = React.useMemo(() => {
    const relevant = rooms.filter(
      (r) => selectedBuilding === 'ALL' || r.building.toLowerCase() === selectedBuilding.toLowerCase()
    );
    const labels: string[] = [];
    relevant.forEach((r) => {
      const flLabel = r.floorLabel || `Floor ${r.floor}`;
      if (!labels.includes(flLabel)) {
        labels.push(flLabel);
      }
    });
    return ['ALL', ...labels];
  }, [rooms, selectedBuilding]);

  // Filtered rooms
  const filteredRooms = rooms.filter((room) => {
    if (selectedBuilding !== 'ALL' && room.building.toLowerCase() !== selectedBuilding.toLowerCase()) return false;
    
    const flLabel = room.floorLabel || `Floor ${room.floor}`;
    if (selectedFloorLabel !== 'ALL' && flLabel !== selectedFloorLabel) return false;
    
    const dynStatus = getRoomStatusOnDate(room, checkDate, reservations);
    if (statusFilter !== 'ALL' && dynStatus !== statusFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNum = room.roomNumber.toLowerCase().includes(q);
      const matchBldg = room.building.toLowerCase().includes(q);
      const matchCat = room.category.toLowerCase().includes(q);
      const matchToilet = (room.toiletType || '').toLowerCase().includes(q);
      const matchBed = (room.bedType || '').toLowerCase().includes(q);
      if (!matchNum && !matchBldg && !matchCat && !matchToilet && !matchBed) return false;
    }

    return true;
  });

  const totalCount = rooms.length;
  const saifeeCount = rooms.filter((r) => r.building.toLowerCase() === 'saifee').length;
  const burhaniCount = rooms.filter((r) => r.building.toLowerCase() === 'burhani').length;
  const blockedCount = rooms.filter((r) => r.status === 'blocked').length;

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#124E39]" />
            <h2 className="text-base font-bold text-[#124E39]">
              Hotel Inventory Management — 114 Rooms
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 font-semibold">
              Burhani ({burhaniCount}) • Saifee ({saifeeCount})
            </span>
          </div>
          <p className="text-xs text-stone-600 mt-1 max-w-2xl">
            Burhani Hotel (44 rooms: Ground, Mezzanine, Floors 1 to 4 with 1 buffer) • Saifee Hotel (70 rooms: Floors 1 to 7). Monitor pax capacity, toilet type (Western / Indian), bed types, and block status.
          </p>
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={onResetRoomsToSaifeeBurhani}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 shadow-2xs transition cursor-pointer"
            title="Reset room inventory back to the official 114 rooms"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#124E39]" />
            <span>Reset to Official 114 Rooms</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-[#E6DFD5] rounded-xl p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative min-w-[160px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-stone-400" />
            <input
              type="text"
              placeholder="Search Room, Toilet, Bed..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#FAF7F2] border border-stone-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            />
          </div>

          {/* Building Tabs */}
          <div className="flex items-center bg-stone-100 p-1 rounded-lg font-semibold">
            <button
              onClick={() => {
                setSelectedBuilding('ALL');
                setSelectedFloorLabel('ALL');
              }}
              className={`px-2.5 py-1 rounded-md transition ${selectedBuilding === 'ALL' ? 'bg-[#124E39] text-white shadow-xs' : 'text-stone-600'}`}
            >
              All Hotels ({totalCount})
            </button>
            <button
              onClick={() => {
                setSelectedBuilding('Burhani');
                setSelectedFloorLabel('ALL');
              }}
              className={`px-2.5 py-1 rounded-md transition ${selectedBuilding === 'Burhani' ? 'bg-[#124E39] text-white shadow-xs' : 'text-stone-600'}`}
            >
              Burhani ({burhaniCount})
            </button>
            <button
              onClick={() => {
                setSelectedBuilding('Saifee');
                setSelectedFloorLabel('ALL');
              }}
              className={`px-2.5 py-1 rounded-md transition ${selectedBuilding === 'Saifee' ? 'bg-[#124E39] text-white shadow-xs' : 'text-stone-600'}`}
            >
              Saifee ({saifeeCount})
            </button>
          </div>

          {/* Dynamic Floor Tabs / Selector */}
          <div className="flex items-center bg-stone-100 p-1 rounded-lg overflow-x-auto max-w-full">
            {availableFloorLabels.map((lbl) => (
              <button
                key={lbl}
                onClick={() => setSelectedFloorLabel(lbl)}
                className={`px-2 py-0.5 rounded transition text-[11px] whitespace-nowrap ${
                  selectedFloorLabel === lbl
                    ? 'bg-white font-bold text-stone-900 shadow-2xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                {lbl === 'ALL' ? 'All Floors' : lbl}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-700"
          >
            <option value="ALL">All Statuses</option>
            <option value="available">Vacant (Available)</option>
            <option value="occupied">Occupied</option>
            <option value="blocked">Blocked (Maintenance)</option>
          </select>
        </div>

        {/* Date Selector */}
        <div className="flex items-center gap-1.5 bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1 text-xs">
          <Calendar className="w-3.5 h-3.5 text-[#124E39]" />
          <span className="text-stone-500">Check Date:</span>
          <input
            type="date"
            value={checkDate}
            onChange={(e) => setCheckDate(e.target.value)}
            className="bg-transparent font-bold text-stone-800 focus:outline-none cursor-pointer"
          />
        </div>
      </div>

      {/* Rooms Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {filteredRooms.map((room) => {
          const status = getRoomStatusOnDate(room, checkDate, reservations);
          const booking = getRoomBookingOnDate(room, checkDate, reservations);
          const isBlocked = room.status === 'blocked';

          let borderClass = 'border-stone-200';
          let statusBadge = (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900">
              Vacant
            </span>
          );

          if (isBlocked) {
            borderClass = 'border-stone-400 bg-stone-100';
            statusBadge = (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-stone-300 text-stone-800 flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" /> Blocked
              </span>
            );
          } else if (status === 'occupied') {
            borderClass = 'border-amber-300 bg-amber-50/40';
            statusBadge = (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
                Occupied
              </span>
            );
          }

          return (
            <div
              key={room.id}
              className={`bg-white border ${borderClass} rounded-xl p-3 shadow-2xs hover:shadow-sm transition flex flex-col justify-between`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-extrabold text-sm text-stone-900">
                    Room {room.roomNumber}
                  </span>
                  {statusBadge}
                </div>

                <div className="text-[11px] text-stone-600 font-bold">
                  {room.building} Hotel • {room.floorLabel || `Fl ${room.floor}`}
                </div>

                <div className="text-[10px] text-stone-700 mt-1 font-medium flex items-center gap-1">
                  <span>Pax: {room.capacity}</span>
                  {room.buffer ? <span className="text-amber-700">(+{room.buffer} Buffer)</span> : null}
                  <span>•</span>
                  <span>{room.category.includes('A') ? 'Nizaam' : 'Standard'}</span>
                </div>

                {/* Toilet & Bed Type badges */}
                <div className="mt-2 space-y-1">
                  <div className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200/80 font-medium truncate" title={`Toilet: ${room.toiletType}`}>
                    🚽 {room.toiletType || 'Standard'}
                  </div>
                  <div className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200/80 font-medium truncate" title={`Beds: ${room.bedType}`}>
                    🛏️ {room.bedType || 'Single Beds'}
                  </div>
                </div>

                {/* If occupied on this date */}
                {booking && (
                  <div className="mt-2 p-1.5 rounded bg-amber-100/70 border border-amber-200 text-[10px] text-amber-900">
                    <span className="font-bold block truncate">{booking.applicantName}</span>
                    <span className="text-amber-800 font-mono text-[9px]">{booking.family}</span>
                  </div>
                )}

                {/* If blocked */}
                {isBlocked && (
                  <div className="mt-2 p-1.5 rounded bg-stone-200 text-[10px] text-stone-700">
                    <span className="font-semibold block truncate">{room.blockedReason || 'Maintenance'}</span>
                  </div>
                )}
              </div>

              {/* Card Footer Actions */}
              <div className="mt-3 pt-2 border-t border-stone-100 flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateRoomStatus(room.id, isBlocked ? 'available' : 'blocked')
                  }
                  className={`text-[10px] font-bold px-2 py-0.5 rounded transition cursor-pointer ${
                    isBlocked
                      ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                      : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                  }`}
                >
                  {isBlocked ? 'Unblock' : 'Block Room'}
                </button>

                <button
                  type="button"
                  onClick={() => setInspectingRoom(room)}
                  className="text-stone-500 hover:text-stone-900 text-[10px] underline cursor-pointer"
                >
                  Details
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Room Details Modal */}
      {inspectingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
          <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-md w-full p-5 shadow-2xl relative text-stone-800">
            <button
              onClick={() => setInspectingRoom(null)}
              className="absolute top-4 right-4 text-stone-400 hover:text-stone-700 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-5 h-5 text-[#124E39]" />
              <h3 className="text-base font-bold text-[#124E39]">
                {inspectingRoom.building} Hotel — Room {inspectingRoom.roomNumber}
              </h3>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-stone-200">
                <span className="text-stone-500">Floor:</span>
                <span className="font-bold">{inspectingRoom.floorLabel || `Floor ${inspectingRoom.floor}`}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-200">
                <span className="text-stone-500">Pax Capacity:</span>
                <span className="font-bold">{inspectingRoom.capacity} Guests</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-200">
                <span className="text-stone-500">Buffer:</span>
                <span className="font-bold">{inspectingRoom.buffer ?? 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-200">
                <span className="text-stone-500">Toilet Type:</span>
                <span className="font-bold text-blue-900">{inspectingRoom.toiletType || 'Standard'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-200">
                <span className="text-stone-500">Bed Types:</span>
                <span className="font-bold text-amber-900">{inspectingRoom.bedType || 'Single Beds'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-200">
                <span className="text-stone-500">Accommodation Category:</span>
                <span className="font-bold text-[#124E39]">{inspectingRoom.category}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-200">
                <span className="text-stone-500">Status:</span>
                <span className="font-bold uppercase">{inspectingRoom.status}</span>
              </div>

              {inspectingRoom.blockedReason && (
                <div className="p-2.5 rounded-lg bg-stone-200 border border-stone-300 text-stone-800">
                  <div className="font-semibold text-stone-900 mb-0.5">Maintenance Hold Details:</div>
                  <p className="text-[11px] text-stone-600">{inspectingRoom.blockedReason}</p>
                </div>
              )}

              <div className="pt-2">
                <span className="text-stone-500 font-semibold block mb-1">Amenities & Specs:</span>
                <div className="flex flex-wrap gap-1">
                  {inspectingRoom.amenities.map((a, i) => (
                    <span key={i} className="px-2 py-0.5 bg-white border border-stone-200 rounded text-[10px]">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-stone-200 flex justify-end">
              <button
                onClick={() => setInspectingRoom(null)}
                className="px-4 py-1.5 rounded-lg bg-[#124E39] text-white text-xs font-bold cursor-pointer"
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
