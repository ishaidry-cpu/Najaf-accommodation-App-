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
  DoorClosed,
  ArrowRightLeft,
  Users
} from 'lucide-react';
import { Room, RoomStatus, RoomCategory, Reservation, GoogleSheetsConfig } from '../types';
import { getRoomStatusOnDate, getRoomBookingOnDate, getRoomBookingsOnDate, deduplicateRooms, normalizeBuildingName } from '../services/storage';
import { AddBuildingAndRoomsModal } from './AddBuildingAndRoomsModal';
import { SwitchRoomTarget } from './SwitchRoomModal';
import { PageHeader, btn } from './ui';

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
  onOpenSwitchRoomModal?: (target: SwitchRoomTarget) => void;
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
  onOpenSwitchRoomModal,
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

  // Canonical deduplicated rooms list
  const cleanRooms = useMemo(() => deduplicateRooms(rooms), [rooms]);

  // Dynamic distinct buildings list (normalized to prevent case/suffix duplicates)
  const distinctBuildings = useMemo(() => {
    const list = Array.from(new Set(cleanRooms.map((r) => normalizeBuildingName(r.building)).filter(Boolean)));
    return list.sort();
  }, [cleanRooms]);

  // Available floors for current building
  const availableFloorLabels = useMemo(() => {
    const relevant = cleanRooms.filter(
      (r) => selectedBuilding === 'ALL' || normalizeBuildingName(r.building).toLowerCase() === selectedBuilding.toLowerCase()
    );
    const labels: string[] = [];
    relevant.forEach((r) => {
      const flLabel = r.floorLabel || `Floor ${r.floor}`;
      if (!labels.includes(flLabel)) {
        labels.push(flLabel);
      }
    });
    return ['ALL', ...labels];
  }, [cleanRooms, selectedBuilding]);

  // Filtered rooms
  const filteredRooms = cleanRooms.filter((room) => {
    if (selectedBuilding !== 'ALL' && normalizeBuildingName(room.building).toLowerCase() !== selectedBuilding.toLowerCase()) return false;
    
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

  const totalCount = cleanRooms.length;
  const blockedCount = cleanRooms.filter((r) => r.status === 'blocked').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rooms"
        description={`${totalCount} rooms across ${distinctBuildings.length} buildings. Block a room, edit its details or add new ones.`}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-stone-600">
            {distinctBuildings.slice(0, 8).map((bldg) => {
              const count = cleanRooms.filter((r) => normalizeBuildingName(r.building).toLowerCase() === bldg.toLowerCase()).length;
              return (
                <span key={bldg}>
                  {bldg} <span className="text-stone-400 tabular-nums">{count}</span>
                </span>
              );
            })}
          </div>
        }
        actions={
          <>
            <button
              type="button"
              onClick={onResetRoomsToSaifeeBurhani}
              className={btn.ghost}
              title="Reset room inventory back to the official 114 rooms across Saifee and Burhani"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to 114 rooms
            </button>
            <button
              type="button"
              onClick={() => {
                setAddModalTab('sheet');
                setIsAddModalOpen(true);
              }}
              className={btn.secondary}
            >
              <FileSpreadsheet className="w-4 h-4 text-stone-500" />
              Import from sheet
            </button>
            <button
              type="button"
              onClick={() => {
                setAddModalTab('manual');
                setIsAddModalOpen(true);
              }}
              className={btn.primary}
            >
              <Plus className="w-4 h-4 text-gold-200" />
              Add rooms
            </button>
          </>
        }
      />

      {/* Filter Toolbar */}
      <div className="bg-white border border-[#e2e8e5] rounded-xl p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          {/* Search Box */}
          <div className="relative min-w-[160px] flex-1 sm:flex-none">
            <Search className="w-3.5 h-3.5 absolute left-3 top-3.5 sm:top-2.5 text-stone-400" />
            <input
              type="text"
              placeholder="Search Room, Building, Bed..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-0 bg-[#f6f8f7] border border-stone-300 rounded-lg pl-8 pr-3 py-2 sm:py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            />
          </div>

          {/* Dynamic Building Tabs */}
          <div className="flex items-center bg-stone-100 p-1 rounded-lg font-semibold flex-wrap gap-1">
            <button
              onClick={() => {
                setSelectedBuilding('ALL');
                setSelectedFloorLabel('ALL');
              }}
              className={`min-h-[40px] sm:min-h-0 px-2.5 py-1.5 sm:py-1 rounded-md transition cursor-pointer ${selectedBuilding === 'ALL' ? 'bg-[#0f4a37] text-white shadow-xs' : 'text-stone-600 hover:text-stone-900'}`}
            >
              All Buildings ({totalCount})
            </button>
            {distinctBuildings.map((bldg) => {
              const bCount = cleanRooms.filter((r) => normalizeBuildingName(r.building).toLowerCase() === bldg.toLowerCase()).length;
              return (
                <button
                  key={bldg}
                  onClick={() => {
                    setSelectedBuilding(bldg);
                    setSelectedFloorLabel('ALL');
                  }}
                  className={`min-h-[40px] sm:min-h-0 px-2.5 py-1.5 sm:py-1 rounded-md transition cursor-pointer ${selectedBuilding === bldg ? 'bg-[#0f4a37] text-white shadow-xs' : 'text-stone-600 hover:text-stone-900'}`}
                >
                  {bldg} ({bCount})
                </button>
              );
            })}
          </div>

          {/* Dynamic Floor Tabs / Selector */}
          <div className="flex items-center bg-stone-100 p-1 rounded-lg overflow-x-auto max-w-full gap-1">
            {availableFloorLabels.map((lbl) => (
              <button
                key={lbl}
                onClick={() => setSelectedFloorLabel(lbl)}
                className={`min-h-[36px] sm:min-h-0 px-2.5 py-1 sm:py-0.5 rounded transition text-[11px] whitespace-nowrap cursor-pointer ${
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
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <div className="flex items-center gap-1.5 min-h-[44px] sm:min-h-0 bg-[#f6f8f7] px-2.5 py-1 rounded-lg border border-stone-300">
            <Calendar className="w-3.5 h-3.5 text-[#0f4a37]" />
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
            className="min-h-[44px] sm:min-h-0 bg-stone-50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-800 font-semibold focus:outline-none"
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
              className={`bg-white border rounded-xl p-4 shadow-xs hover:shadow-md transition flex flex-col justify-between ${
                isBlocked
                  ? 'border-stone-300 bg-stone-50/50'
                  : dynStatus === 'occupied'
                  ? 'border-purple-200 hover:border-purple-300'
                  : 'border-stone-200 hover:border-stone-300'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="text-[17px] font-semibold tracking-[-0.01em] text-stone-950 block tabular-nums">
                      {room.roomNumber}
                    </span>
                    <span className="text-xs text-stone-500">
                      {room.building}, {room.floorLabel || `Floor ${room.floor}`}
                    </span>
                  </div>

                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${statusBadgeClass}`}>
                    {statusText}
                  </span>
                </div>

                {/* Specs */}
                <dl className="grid grid-cols-3 gap-2 text-xs py-2.5 mb-2 border-y border-stone-100">
                  <div className="min-w-0">
                    <dt className="text-stone-400">Sleeps</dt>
                    <dd className="mt-0.5 font-medium text-stone-900 tabular-nums">
                      {room.capacity}
                      {room.buffer ? <span className="text-stone-400 font-normal"> +{room.buffer}</span> : null}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-stone-400">Beds</dt>
                    <dd className="mt-0.5 font-medium text-stone-900 truncate">{(room.bedType || 'Single Beds').replace(/ beds?$/i, '')}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-stone-400">Toilet</dt>
                    <dd className="mt-0.5 font-medium text-stone-900 truncate capitalize">{(room.toiletType || 'Standard').toLowerCase()}</dd>
                  </div>
                </dl>

                {/* Current Guest info if occupied */}
                {currentBooking && !isBlocked && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 text-[11px] text-purple-950 mb-2 space-y-0.5">
                    <div className="font-bold truncate">{currentBooking.applicantName}</div>
                    <div className="text-[10px] text-purple-800">
                      Fam #{currentBooking.family} · Tour: {currentBooking.tourRefNo}
                    </div>
                    {currentBooking.officeName && (
                      <div className="text-[10px] text-purple-900 font-semibold truncate">
                        Office: {currentBooking.officeName}
                      </div>
                    )}
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
              <div className="pt-2 border-t border-stone-100 flex items-center justify-between gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setInspectingRoom(room)}
                  className="min-h-[44px] sm:min-h-0 px-2 text-[#0f4a37] hover:underline font-bold text-xs sm:text-[11px] cursor-pointer"
                >
                  View Details
                </button>

                <div className="flex items-center gap-1.5">
                  {!isBlocked && dynStatus === 'occupied' && onOpenSwitchRoomModal && (
                    <button
                      type="button"
                      onClick={() => {
                        const occupants = getRoomBookingsOnDate(room, checkDate, reservations);
                        if (occupants.length > 0) {
                          onOpenSwitchRoomModal({ reservations: occupants, initialScope: 'group' });
                        }
                      }}
                      className="min-h-[44px] sm:min-h-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300 transition cursor-pointer"
                      title="Switch or swap this room's occupants to another room"
                    >
                      <ArrowRightLeft className="w-3 h-3 text-amber-700" />
                      <span>Switch</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onUpdateRoomStatus(room.id, isBlocked ? 'available' : 'blocked')}
                    className={`min-h-[44px] sm:min-h-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${
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
            className="text-xs text-[#0f4a37] underline font-bold cursor-pointer"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Inspect Room Details Modal */}
      {inspectingRoom && (() => {
        const occupantsOnDate = getRoomBookingsOnDate(inspectingRoom, checkDate, reservations);
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-950/45 backdrop-blur-[2px] animate-in fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 shadow-2xl border border-stone-200 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div className="flex items-center gap-2">
                  <BedDouble className="w-5 h-5 text-[#0f4a37]" />
                  <h3 className="font-bold text-base text-stone-900">
                    Room {inspectingRoom.roomNumber} ({inspectingRoom.building} Hotel)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectingRoom(null)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-stone-400 hover:text-stone-700 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 text-xs text-stone-700">
                <div className="flex justify-between py-1 border-b border-stone-200">
                  <span className="text-stone-500">Building / Hotel:</span>
                  <span className="font-bold text-[#0f4a37]">{inspectingRoom.building} Hotel</span>
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
                  <span className="font-bold text-[#0f4a37]">{inspectingRoom.category}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-stone-200">
                  <span className="text-stone-500">Status:</span>
                  <span className="font-bold uppercase">{inspectingRoom.status}</span>
                </div>

                {/* Current Occupants on Check Date + Switch Room */}
                {occupantsOnDate.length > 0 && (
                  <div className="pt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-stone-700 font-bold flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#0f4a37]" />
                        <span>Occupants on {checkDate} ({occupantsOnDate.length})</span>
                      </span>
                      {onOpenSwitchRoomModal && (
                        <button
                          type="button"
                          onClick={() => {
                            const targetRoomOccupants = occupantsOnDate;
                            setInspectingRoom(null);
                            onOpenSwitchRoomModal({ reservations: targetRoomOccupants, initialScope: 'group' });
                          }}
                          className="min-h-[36px] px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          <ArrowRightLeft className="w-3 h-3 text-amber-700" />
                          <span>Switch / Swap Room</span>
                        </button>
                      )}
                    </div>
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {occupantsOnDate.map((occ) => (
                        <div key={occ.id} className="bg-[#f6f8f7] border border-[#e2e8e5] rounded-xl p-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-stone-900 truncate">{occ.applicantName}</div>
                            <div className="text-[11px] text-stone-600 font-mono">
                              Fam #{occ.family} · Tour: {occ.tourRefNo || occ.tourId || '—'}
                            </div>
                            {occ.officeName && (
                              <div className="text-[11px] text-stone-700 font-semibold truncate">
                                Office: {occ.officeName}
                              </div>
                            )}
                            <div className="text-[10px] text-stone-500 tabular-nums">
                              {occ.arrivalDate?.slice(0, 10)} ({occ.arrivalTime || '11:00 AM'}) ➔ {occ.departureDate?.slice(0, 10)} ({occ.departureTime || '01:00 AM'})
                            </div>
                          </div>
                          {onOpenSwitchRoomModal && (
                            <button
                              type="button"
                              onClick={() => {
                                setInspectingRoom(null);
                                onOpenSwitchRoomModal({ reservations: [occ], initialScope: 'single' });
                              }}
                              className="shrink-0 min-h-[36px] px-2.5 py-1 rounded-lg bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 font-bold text-[11px] cursor-pointer"
                            >
                              Switch
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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

              <div className="mt-4 pt-3 border-t border-stone-200 flex items-center justify-between gap-2">
                {onDeleteRoom ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete Room ${inspectingRoom.roomNumber} (${inspectingRoom.building}) from inventory?`)) {
                        onDeleteRoom(inspectingRoom.id);
                        setInspectingRoom(null);
                      }
                    }}
                    className="min-h-[44px] px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Room</span>
                  </button>
                ) : <div />}

                <button
                  type="button"
                  onClick={() => setInspectingRoom(null)}
                  className="min-h-[44px] px-5 py-2 rounded-lg bg-[#0f4a37] text-white text-xs font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add Building & Rooms Modal */}
      {isAddModalOpen && (
        <AddBuildingAndRoomsModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          existingRooms={cleanRooms}
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
