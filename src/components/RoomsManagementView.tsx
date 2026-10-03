import React, { useState, useMemo } from 'react';
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
  RotateCcw,
  FileSpreadsheet,
  DoorClosed
} from 'lucide-react';
import { Room, RoomStatus, RoomCategory, Reservation, GoogleSheetsConfig } from '../types';
import { getRoomStatusOnDate, getRoomBookingOnDate } from '../services/storage';
import { AddBuildingAndRoomsModal } from './AddBuildingAndRoomsModal';

interface RoomsManagementViewProps {
  rooms: Room[];
  reservations: Reservation[];
  onUpdateRoomStatus: (roomId: string, status: RoomStatus) => void;
  onUpdateRoomDetails: (updatedRoom: Room) => void;
  onResetRoomsToSaifeeBurhani: () => void;
  onAddRooms?: (newRooms: Room[], replaceExisting?: boolean) => void;
  onDeleteRoom?: (roomId: string) => void;
  accessToken?: string | null;
  sheetsConfig?: GoogleSheetsConfig;
}

export const RoomsManagementView: React.FC<RoomsManagementViewProps> = ({
  rooms,
  reservations,
  onUpdateRoomStatus,
  onUpdateRoomDetails,
  onResetRoomsToSaifeeBurhani,
  onAddRooms,
  onDeleteRoom,
  accessToken,
  sheetsConfig,
}) => {
  const [selectedBuilding, setSelectedBuilding] = useState<string>('ALL');
  const [selectedFloorLabel, setSelectedFloorLabel] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Date for dynamic availability check
  const todayStr = new Date().toISOString().slice(0, 10);
  const [checkDate, setCheckDate] = useState<string>(todayStr);

  const [inspectingRoom, setInspectingRoom] = useState<Room | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addModalTab, setAddModalTab] = useState<'manual' | 'sheet'>('manual');

  // Dynamic distinct buildings list
  const distinctBuildings = useMemo(() => {
    const list = Array.from(new Set(rooms.map((r) => r.building).filter(Boolean)));
    return list.sort();
  }, [rooms]);

  // Available floors for current building
  const availableFloorLabels = useMemo(() => {
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
  const blockedCount = rooms.filter((r) => r.status === 'blocked').length;

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-2.5 h-2.5 rounded-full bg-[#124E39]" />
            <h2 className="text-base font-bold text-[#124E39]">
              Hotel Inventory & Building Management — {totalCount} Rooms
            </h2>
            <div className="flex items-center gap-1.5 flex-wrap">
              {distinctBuildings.map((bldg) => {
                const count = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length;
                return (
                  <span
                    key={bldg}
                    className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-950 border border-emerald-300 font-semibold"
                  >
                    {bldg} ({count})
                  </span>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-stone-600 mt-1 max-w-2xl">
            Manage hotel rooms and buildings. Add rooms manually, create new buildings, or sync inventory directly with your Google Sheet.
          </p>
        </div>

        {/* Action Buttons: Add Building / Rooms, Sync Google Sheet, Reset */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setAddModalTab('manual');
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-xs transition cursor-pointer"
            title="Add a new building or room manually or sync via Google Sheets"
          >
            <Plus className="w-4 h-4 text-[#EBD59E]" />
            <span>+ Add Building / Rooms</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAddModalTab('sheet');
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-emerald-50 text-emerald-900 border border-emerald-300 shadow-2xs transition cursor-pointer"
            title="Sync inventory with a Google Sheet"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Sync Google Sheet</span>
          </button>

          <button
            type="button"
            onClick={onResetRoomsToSaifeeBurhani}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 shadow-2xs transition cursor-pointer"
            title="Reset room inventory back to the official 114 rooms across Saifee and Burhani"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#124E39]" />
            <span className="hidden sm:inline">Reset to 114 Rooms</span>
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
              placeholder="Search Room, Building, Bed..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#FAF7F2] border border-stone-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            />
          </div>

          {/* Dynamic Building Tabs */}
          <div className="flex items-center bg-stone-100 p-1 rounded-lg font-semibold flex-wrap gap-1">
            <button
              onClick={() => {
                setSelectedBuilding('ALL');
                setSelectedFloorLabel('ALL');
              }}
              className={`px-2.5 py-1 rounded-md transition ${selectedBuilding === 'ALL' ? 'bg-[#124E39] text-white shadow-xs' : 'text-stone-600 hover:text-stone-900'}`}
            >
              All Buildings ({totalCount})
            </button>
            {distinctBuildings.map((bldg) => {
              const bCount = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length;
              return (
                <button
                  key={bldg}
                  onClick={() => {
                    setSelectedBuilding(bldg);
                    setSelectedFloorLabel('ALL');
                  }}
                  className={`px-2.5 py-1 rounded-md transition ${selectedBuilding === bldg ? 'bg-[#124E39] text-white shadow-xs' : 'text-stone-600 hover:text-stone-900'}`}
                >
                  {bldg} ({bCount})
                </button>
              );
            })}
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
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Status Filter & Date Picker */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-[#FAF7F2] px-2.5 py-1 rounded-lg border border-stone-300">
            <Calendar className="w-3.5 h-3.5 text-[#124E39]" />
            <span className="text-[11px] text-stone-500 font-semibold">Check Date:</span>
            <input
              type="date"
              value={checkDate}
              onChange={(e) => setCheckDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-stone-800 cursor-pointer focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-stone-50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-800 font-semibold focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="available">Available (Vacant)</option>
            <option value="occupied">Occupied</option>
            <option value="blocked">Blocked ({blockedCount})</option>
          </select>
        </div>
      </div>

      {/* Rooms Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
        {filteredRooms.map((room) => {
          const dynStatus = getRoomStatusOnDate(room, checkDate, reservations);
          const currentBooking = getRoomBookingOnDate(room, checkDate, reservations);
          const isBlocked = room.status === 'blocked';

          let statusBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
          let statusText = 'Vacant Ready';

          if (isBlocked) {
            statusBadgeClass = 'bg-stone-200 text-stone-700 border-stone-300';
            statusText = 'Blocked';
          } else if (dynStatus === 'occupied') {
            statusBadgeClass = 'bg-purple-100 text-purple-900 border-purple-300';
            statusText = 'Occupied';
          }

          return (
            <div
              key={room.id}
              className={`bg-white border rounded-xl p-3.5 shadow-2xs hover:shadow-md transition flex flex-col justify-between ${
                isBlocked
                  ? 'border-stone-300 bg-stone-50/50'
                  : dynStatus === 'occupied'
                  ? 'border-purple-200 hover:border-purple-300'
                  : 'border-[#E6DFD5] hover:border-[#124E39]/40'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="font-mono text-base font-extrabold text-[#124E39] block">
                      Room {room.roomNumber}
                    </span>
                    <span className="text-[11px] font-semibold text-stone-500">
                      {room.building} Hotel • {room.floorLabel || `Floor ${room.floor}`}
                    </span>
                  </div>

                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase ${statusBadgeClass}`}>
                    {statusText}
                  </span>
                </div>

                {/* Specs */}
                <div className="grid grid-cols-2 gap-1.5 text-[11px] bg-[#FAF7F2] p-2 rounded-lg border border-[#E6DFD5] mb-2.5">
                  <div className="text-stone-600">
                    <span className="text-stone-400 block text-[9px] uppercase">Capacity:</span>
                    <span className="font-bold text-stone-900">
                      Pax: {room.capacity}
                      {room.buffer ? ` (+${room.buffer} Buffer)` : ''}
                    </span>
                  </div>
                  <div className="text-stone-600">
                    <span className="text-stone-400 block text-[9px] uppercase">Toilet:</span>
                    <span className="font-semibold text-blue-900 truncate block">
                      {room.toiletType || 'Standard'}
                    </span>
                  </div>
                  <div className="col-span-2 text-stone-600 pt-1 border-t border-stone-200/60">
                    <span className="text-stone-400 block text-[9px] uppercase">Beds:</span>
                    <span className="font-semibold text-amber-900 truncate block">
                      {room.bedType || 'Single Beds'}
                    </span>
                  </div>
                </div>

                {/* Current Guest info if occupied */}
                {currentBooking && !isBlocked && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 text-[11px] text-purple-950 mb-2 space-y-0.5">
                    <div className="font-bold truncate">{currentBooking.applicantName}</div>
                    <div className="text-[10px] text-purple-800">
                      Fam #{currentBooking.family} • Tour: {currentBooking.tourRefNo}
                    </div>
                  </div>
                )}

                {/* Blocked reason */}
                {isBlocked && room.blockedReason && (
                  <div className="bg-stone-200/70 border border-stone-300 rounded-lg p-2 text-[11px] text-stone-700 mb-2">
                    <span className="font-bold block text-[10px] uppercase text-stone-500">Hold Reason:</span>
                    <p className="text-[10px] line-clamp-2">{room.blockedReason}</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-2 border-t border-stone-100 flex items-center justify-between gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setInspectingRoom(room)}
                  className="text-[#124E39] hover:underline font-bold text-[11px] cursor-pointer"
                >
                  View Details
                </button>

                <button
                  type="button"
                  onClick={() => onUpdateRoomStatus(room.id, isBlocked ? 'available' : 'blocked')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${
                    isBlocked
                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                      : 'bg-stone-200 hover:bg-stone-300 text-stone-800'
                  }`}
                >
                  {isBlocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                  <span>{isBlocked ? 'Unblock' : 'Block'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredRooms.length === 0 && (
        <div className="bg-white p-12 rounded-2xl border border-stone-200 text-center text-stone-500 space-y-2">
          <DoorClosed className="w-10 h-10 mx-auto text-stone-300" />
          <p className="font-bold text-sm">No rooms match the selected filters.</p>
          <button
            type="button"
            onClick={() => {
              setSelectedBuilding('ALL');
              setSelectedFloorLabel('ALL');
              setStatusFilter('ALL');
              setSearchQuery('');
            }}
            className="text-xs text-[#124E39] underline font-bold cursor-pointer"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Inspect Room Details Modal */}
      {inspectingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <BedDouble className="w-5 h-5 text-[#124E39]" />
                <h3 className="font-bold text-base text-stone-900">
                  Room {inspectingRoom.roomNumber} ({inspectingRoom.building} Hotel)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectingRoom(null)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-stone-700">
              <div className="flex justify-between py-1 border-b border-stone-200">
                <span className="text-stone-500">Building / Hotel:</span>
                <span className="font-bold text-[#124E39]">{inspectingRoom.building} Hotel</span>
              </div>
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

            <div className="mt-4 pt-3 border-t border-stone-200 flex items-center justify-between">
              {onDeleteRoom ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete Room ${inspectingRoom.roomNumber} (${inspectingRoom.building}) from inventory?`)) {
                      onDeleteRoom(inspectingRoom.id);
                      setInspectingRoom(null);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Room</span>
                </button>
              ) : <div />}

              <button
                type="button"
                onClick={() => setInspectingRoom(null)}
                className="px-4 py-1.5 rounded-lg bg-[#124E39] text-white text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Building & Rooms Modal */}
      {isAddModalOpen && (
        <AddBuildingAndRoomsModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          existingRooms={rooms}
          onAddRooms={(newRooms, replace) => {
            if (onAddRooms) {
              onAddRooms(newRooms, replace);
            }
          }}
          accessToken={accessToken}
          sheetsConfig={sheetsConfig}
          initialTab={addModalTab}
        />
      )}
    </div>
  );
};
