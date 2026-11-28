import React, { useState, useMemo } from 'react';
import {
  Building2,
  Plus,
  Trash2,
  Search,
  Lock,
  X,
  RotateCcw,
  DoorClosed,
  ArrowRightLeft,
  Users,
  Pencil
} from 'lucide-react';
import { Room, RoomStatus, Reservation } from '../types';
import { getRoomStatusOnDate, getRoomBookingOnDate, getRoomBookingsOnDate, deduplicateRooms, normalizeBuildingName, normalizeRoomNumber, getDistinctBuildings, getRoomBedCount, ROOM_TOILET_TYPES } from '../services/storage';
import { AddBuildingAndRoomsModal } from './AddBuildingAndRoomsModal';
import { RoomEditModal, formatDay, segBtn, segTrack } from './RoomSpecFields';
import { SwitchRoomTarget } from './SwitchRoomModal';
import { PageHeader, btn, btnSm, card, chip, fieldSm, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle } from './ui';

/** Card actions sit in a tight row: slightly narrower padding, and a full 40px target on phones. */
const cardBtn = 'px-2! max-sm:h-10';

/** The stored toilet type ("WESTERN", "Both WESTERN & INDIAN") as staff read it. */
const toiletLabel = (value?: string) => {
  const raw = value || 'Standard';
  const known = ROOM_TOILET_TYPES.find((t) => t.value.toLowerCase() === raw.toLowerCase());
  if (known) return known.label;
  return raw.toLowerCase().replace(/(^|[\s&/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
};

interface RoomsManagementViewProps {
  rooms: Room[];
  reservations: Reservation[];
  onUpdateRoomStatus: (roomId: string, status: RoomStatus) => void;
  onUpdateRoomDetails: (updatedRoom: Room) => void;
  onResetRoomsToSaifeeBurhani: () => void;
  onAddRooms?: (newRooms: Room[]) => void;
  onDeleteRoom?: (roomId: string) => void;
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
  const [addModalInitialMode, setAddModalInitialMode] = useState<'existing' | 'new_building'>('existing');
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);

  // Canonical deduplicated rooms list
  const cleanRooms = useMemo(() => deduplicateRooms(rooms), [rooms]);

  // All buildings in inventory (starts with Burhani, Saifee, Badri + any user-added buildings)
  const distinctBuildings = useMemo(() => {
    return getDistinctBuildings(cleanRooms);
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
      const matchFeature = (room.amenities || []).some((a) => String(a).toLowerCase().includes(q)) || (room.notes || '').toLowerCase().includes(q);
      if (!matchNum && !matchBldg && !matchCat && !matchToilet && !matchBed && !matchFeature) return false;
    }

    return true;
  });

  const totalCount = cleanRooms.length;
  const totalBeds = cleanRooms.reduce((n, r) => n + getRoomBedCount(r), 0);
  const totalSleeps = cleanRooms.reduce((n, r) => n + (r.capacity || r.pax || 0), 0);
  const blockedCount = cleanRooms.filter((r) => r.status === 'blocked').length;

  const clearFilters = () => {
    setSelectedBuilding('ALL');
    setSelectedFloorLabel('ALL');
    setStatusFilter('ALL');
    setSearchQuery('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rooms"
        description={`${totalCount} rooms, ${totalBeds} beds, sleeping ${totalSleeps} across ${distinctBuildings.length} buildings. Block a room, edit its details or add new ones.`}
        actions={
          <>
            <button
              type="button"
              onClick={onResetRoomsToSaifeeBurhani}
              className={btn.ghost}
              title="Reset room inventory back to the official 120 rooms across Burhani (44), Saifee (70), and Badri (6)"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to 120 rooms
            </button>
            <button
              type="button"
              onClick={() => {
                setAddModalInitialMode('new_building');
                setIsAddModalOpen(true);
              }}
              className={btn.secondary}
              title="Add a new building and configure its rooms"
            >
              <Building2 className="w-4 h-4" />
              Add building
            </button>
            <button
              type="button"
              onClick={() => {
                setAddModalInitialMode('existing');
                setIsAddModalOpen(true);
              }}
              className={btn.primary}
            >
              <Plus className="w-4 h-4" />
              Add rooms
            </button>
          </>
        }
      />

      {/* Filter toolbar: find a room (search, date, status), then narrow by building and floor. */}
      <div className={`${card} p-3 sm:p-4 space-y-3`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search room, building, bed or feature"
              aria-label="Search rooms"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`${fieldSm} w-full pl-9 max-sm:h-10`}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-3">
            <label className="flex flex-col gap-1 md:flex-row md:items-center md:gap-2 min-w-0">
              <span className="text-xs md:text-[13px] text-stone-600 whitespace-nowrap">Check date</span>
              <input
                type="date"
                aria-label="Check date"
                title="Show each room's status on this date"
                value={checkDate}
                onChange={(e) => setCheckDate(e.target.value)}
                className={`${fieldSm} w-full md:w-auto max-sm:h-10 tabular-nums cursor-pointer`}
              />
            </label>

            <label className="flex flex-col gap-1 min-w-0">
              <span className="md:hidden text-xs text-stone-600">Status</span>
              <select
                aria-label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={`${fieldSm} w-full md:w-auto max-sm:h-10`}
              >
                <option value="ALL">All statuses</option>
                <option value="available">Vacant</option>
                <option value="occupied">Occupied</option>
                <option value="blocked">Blocked ({blockedCount})</option>
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-3 border-t border-stone-200">
          <div className="flex items-center justify-between gap-4">
            <div className="app-scroll-x overflow-x-auto max-w-full -mx-1 px-1">
              <div role="group" aria-label="Building" className={segTrack}>
                <button
                  type="button"
                  aria-pressed={selectedBuilding === 'ALL'}
                  onClick={() => {
                    setSelectedBuilding('ALL');
                    setSelectedFloorLabel('ALL');
                  }}
                  className={segBtn(selectedBuilding === 'ALL')}
                >
                  All buildings <span className="font-normal text-stone-500 tabular-nums">{totalCount}</span>
                </button>
                {distinctBuildings.map((bldg) => {
                  const bCount = cleanRooms.filter((r) => normalizeBuildingName(r.building).toLowerCase() === bldg.toLowerCase()).length;
                  return (
                    <button
                      key={bldg}
                      type="button"
                      aria-pressed={selectedBuilding === bldg}
                      onClick={() => {
                        setSelectedBuilding(bldg);
                        setSelectedFloorLabel('ALL');
                      }}
                      className={segBtn(selectedBuilding === bldg)}
                    >
                      {bldg} <span className="font-normal text-stone-500 tabular-nums">{bCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <span className="hidden lg:block shrink-0 text-[13px] text-stone-600 tabular-nums" aria-live="polite">
              {filteredRooms.length === totalCount ? `${totalCount} rooms` : `${filteredRooms.length} of ${totalCount} rooms`}
            </span>
          </div>

          <div className="app-scroll-x overflow-x-auto max-w-full -mx-1 px-1">
            <div role="group" aria-label="Floor" className={segTrack}>
              {availableFloorLabels.map((lbl) => (
                <button
                  key={lbl}
                  type="button"
                  aria-pressed={selectedFloorLabel === lbl}
                  onClick={() => setSelectedFloorLabel(lbl)}
                  className={segBtn(selectedFloorLabel === lbl)}
                >
                  {lbl === 'ALL' ? 'All floors' : lbl}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Rooms grid: the number of columns follows the room the page has, not the window. */}
      <div className="@container">
        <div className="grid grid-cols-1 @[520px]:grid-cols-2 @[860px]:grid-cols-3 @[1080px]:grid-cols-4 gap-3 sm:gap-4">
          {filteredRooms.map((room) => {
            const dynStatus = getRoomStatusOnDate(room, checkDate, reservations);
            const currentBooking = getRoomBookingOnDate(room, checkDate, reservations);
            const isBlocked = room.status === 'blocked';

            let statusTone: 'ok' | 'neutral' = 'ok';
            let statusText = 'Vacant ready';

            if (isBlocked) {
              statusTone = 'neutral';
              statusText = 'Blocked';
            } else if (dynStatus === 'occupied') {
              statusTone = 'neutral';
              statusText = 'Occupied';
            }

            const floorText = room.floorLabel || `Floor ${room.floor}`;
            const bedTypeText = /single.*double|double.*single/i.test(room.bedType || '')
              ? 'mixed'
              : (room.bedType || 'Single Beds').replace(/ beds?$/i, '').toLowerCase();

            return (
              <div
                key={room.id}
                className={`${card} px-4 pt-3.5 pb-2 flex flex-col ${isBlocked ? 'bg-stone-50!' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 min-w-0">
                    <span className="type-display text-[22px] leading-7 font-semibold text-stone-950">
                      {room.roomNumber}
                    </span>
                    <span className="text-[13px] leading-5 text-stone-600">
                      {room.building}, {floorText}
                    </span>
                  </div>
                  <span className={`${chip(statusTone)} shrink-0 self-start mt-0.5`}>
                    {isBlocked && <Lock className="w-3 h-3" />}
                    {statusText}
                  </span>
                </div>

                {/* Specs */}
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 sm:grid sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-3">
                  <div className="min-w-0 flex items-baseline gap-1.5 sm:block">
                    <dt className="text-xs text-stone-500">Sleeps</dt>
                    <dd
                      className="text-sm text-stone-900 tabular-nums truncate"
                      title={room.buffer ? `Sleeps ${room.capacity}, plus ${room.buffer} buffer` : undefined}
                    >
                      {room.capacity}
                      {room.buffer ? <span className="text-stone-600"> + {room.buffer} buffer</span> : null}
                    </dd>
                  </div>
                  <div className="min-w-0 flex items-baseline gap-1.5 sm:block">
                    <dt className="text-xs text-stone-500">Beds</dt>
                    <dd className="text-sm text-stone-900 truncate" title={room.bedType || 'Single Beds'}>
                      <span className="tabular-nums">{getRoomBedCount(room)}</span> {bedTypeText}
                    </dd>
                  </div>
                  <div className="min-w-0 flex items-baseline gap-1.5 sm:block">
                    <dt className="text-xs text-stone-500">Toilet</dt>
                    <dd className="text-sm text-stone-900 truncate" title={toiletLabel(room.toiletType)}>
                      {toiletLabel(room.toiletType)}
                    </dd>
                  </div>
                </dl>

                {/* Who is in the room on the check date */}
                {currentBooking && !isBlocked && (
                  <div className="mt-2 pt-2 border-t border-stone-200 min-w-0">
                    <div className="text-sm font-semibold text-stone-900 truncate" title={currentBooking.applicantName}>
                      {currentBooking.applicantName}
                    </div>
                    <div
                      className="text-[13px] leading-[18px] text-stone-600 truncate"
                      title={`Family ${currentBooking.family} · Tour ${currentBooking.tourRefNo}`}
                    >
                      Fam {String(currentBooking.family ?? '').replace(/^#/, '')} · Tour {currentBooking.tourRefNo}
                    </div>
                    {currentBooking.officeName && (
                      <div className="text-[13px] leading-[18px] text-stone-600 truncate" title={`Office: ${currentBooking.officeName}`}>
                        {currentBooking.officeName}
                      </div>
                    )}
                  </div>
                )}

                {/* Blocked reason */}
                {isBlocked && room.blockedReason && (
                  <div className="mt-2 pt-2 border-t border-stone-200 min-w-0">
                    <div className="text-xs text-stone-500">Hold reason</div>
                    <p className="text-[13px] leading-[18px] text-stone-800 line-clamp-2" title={room.blockedReason}>{room.blockedReason}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-auto pt-2">
                  <div className="pt-1.5 border-t border-stone-200 flex items-center justify-between gap-1">
                    <div className="flex items-center -ml-2">
                      <button
                        type="button"
                        onClick={() => setInspectingRoom(room)}
                        className={`${btnSm.ghost} ${cardBtn}`}
                        aria-label={`Details of room ${room.roomNumber}, ${room.building}`}
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingRoom(room)}
                        className={`${btnSm.ghost} ${cardBtn}`}
                        aria-label={`Edit room ${room.roomNumber}, ${room.building}`}
                      >
                        Edit
                      </button>
                    </div>

                    <div className="flex items-center gap-1 -mr-2">
                      {!isBlocked && dynStatus === 'occupied' && onOpenSwitchRoomModal && (
                        <button
                          type="button"
                          onClick={() => {
                            const occupants = getRoomBookingsOnDate(room, checkDate, reservations);
                            if (occupants.length > 0) {
                              onOpenSwitchRoomModal({ reservations: occupants, initialScope: 'group' });
                            }
                          }}
                          className={`${btnSm.secondary} ${cardBtn}`}
                          title="Switch or swap this room's occupants to another room"
                        >
                          Switch room
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onUpdateRoomStatus(room.id, isBlocked ? 'available' : 'blocked')}
                        className={`${btnSm.ghost} ${cardBtn} ${isBlocked ? '' : 'hover:text-rose-700! hover:bg-rose-50!'}`}
                        title={isBlocked ? 'Put this room back into use' : 'Take this room out of use'}
                      >
                        {isBlocked ? 'Unblock' : 'Block'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {filteredRooms.length === 0 && (
        <div className={`${card} px-6 py-12 text-center`}>
          <DoorClosed className="w-9 h-9 mx-auto text-stone-400" />
          <p className="mt-3 text-[15px] font-semibold text-stone-900">No rooms match these filters</p>
          <p className="mt-1 text-sm text-stone-600">Try another building, floor, status or search, or show every room again.</p>
          <button type="button" onClick={clearFilters} className={`${btn.secondary} mt-4`}>
            Clear all filters
          </button>
        </div>
      )}

      {/* Inspect Room Details Modal */}
      {inspectingRoom && (() => {
        const occupantsOnDate = getRoomBookingsOnDate(inspectingRoom, checkDate, reservations);
        const statusLabel = String(inspectingRoom.status || '');
        const facts: [string, React.ReactNode][] = [
          ['Building / hotel', `${inspectingRoom.building} Hotel`],
          ['Floor', inspectingRoom.floorLabel || `Floor ${inspectingRoom.floor}`],
          ['Beds', getRoomBedCount(inspectingRoom)],
          ['Sleeps', `${inspectingRoom.capacity} guests`],
          ['Buffer', inspectingRoom.buffer ?? 0],
          ['Toilet type', toiletLabel(inspectingRoom.toiletType)],
          ['Bed types', inspectingRoom.bedType || 'Single Beds'],
          ['Accommodation category', inspectingRoom.category],
        ];
        return (
          <div className={modalScrim}>
            <div role="dialog" aria-modal="true" aria-labelledby="room-details-title" className={`${modalCard} max-w-xl`}>
              <div className={modalHeader}>
                <div className="min-w-0">
                  <h3 id="room-details-title" className={modalTitle}>
                    Room {inspectingRoom.roomNumber}
                  </h3>
                  <p className="mt-1 text-[13px] text-stone-600">
                    {inspectingRoom.building} Hotel, {inspectingRoom.floorLabel || `Floor ${inspectingRoom.floor}`}
                  </p>
                </div>
                <button type="button" onClick={() => setInspectingRoom(null)} aria-label="Close" className={modalClose}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0 space-y-5">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
                  {facts.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-xs text-stone-500">{label}</dt>
                      <dd className="mt-0.5 text-sm font-medium text-stone-900 tabular-nums break-words">{value}</dd>
                    </div>
                  ))}
                  <div className="min-w-0">
                    <dt className="text-xs text-stone-500">Status</dt>
                    <dd className="mt-1">
                      <span className={chip(statusLabel === 'available' ? 'ok' : statusLabel === 'cleaning' ? 'wait' : 'neutral')}>
                        {statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}
                      </span>
                    </dd>
                  </div>
                </dl>

                {/* Current Occupants on Check Date + Switch Room */}
                {occupantsOnDate.length > 0 && (
                  <div className="pt-5 border-t border-stone-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="flex items-center gap-2 text-[15px] font-semibold text-stone-950">
                        <Users className="w-4 h-4 text-stone-500" />
                        <span>
                          Occupants on {formatDay(checkDate)}{' '}
                          <span className="font-normal text-stone-500 tabular-nums">{occupantsOnDate.length}</span>
                        </span>
                      </h4>
                      {onOpenSwitchRoomModal && (
                        <button
                          type="button"
                          onClick={() => {
                            const targetRoomOccupants = occupantsOnDate;
                            setInspectingRoom(null);
                            onOpenSwitchRoomModal({ reservations: targetRoomOccupants, initialScope: 'group' });
                          }}
                          className={`${btnSm.secondary} max-sm:h-10`}
                        >
                          <ArrowRightLeft className="w-4 h-4" />
                          Switch / swap room
                        </button>
                      )}
                    </div>
                    <ul className="mt-2 divide-y divide-stone-200">
                      {occupantsOnDate.map((occ) => (
                        <li key={occ.id} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-stone-900 truncate">{occ.applicantName}</div>
                            <div className="text-[13px] text-stone-600">
                              Fam {String(occ.family ?? '').replace(/^#/, '')} · Tour {occ.tourRefNo || occ.tourId || '—'}
                            </div>
                            {occ.officeName && (
                              <div className="text-[13px] text-stone-600 truncate">Office: {occ.officeName}</div>
                            )}
                            <div className="text-xs text-stone-500 tabular-nums">
                              {formatDay(occ.arrivalDate)}, {occ.arrivalTime || '11:00 AM'} → {formatDay(occ.departureDate)}, {occ.departureTime || '01:00 AM'}
                            </div>
                          </div>
                          {onOpenSwitchRoomModal && (
                            <button
                              type="button"
                              onClick={() => {
                                setInspectingRoom(null);
                                onOpenSwitchRoomModal({ reservations: [occ], initialScope: 'single' });
                              }}
                              className={`${btnSm.ghost} shrink-0 max-sm:h-10`}
                            >
                              Switch
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(inspectingRoom.blockedReason || inspectingRoom.notes) && (
                  <div className="pt-5 border-t border-stone-200 space-y-4">
                    {inspectingRoom.blockedReason && (
                      <div>
                        <div className="text-xs text-stone-500">Maintenance hold details</div>
                        <p className="mt-0.5 text-sm text-stone-900">{inspectingRoom.blockedReason}</p>
                      </div>
                    )}
                    {inspectingRoom.notes && (
                      <div>
                        <div className="text-xs text-stone-500">Notes</div>
                        <p className="mt-0.5 text-sm text-stone-900">{inspectingRoom.notes}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-5 border-t border-stone-200">
                  <div className="text-xs text-stone-500">Amenities and specs</div>
                  <p className="mt-0.5 text-sm text-stone-900">
                    {inspectingRoom.amenities.length > 0 ? inspectingRoom.amenities.join(' · ') : '—'}
                  </p>
                </div>
              </div>

              <div className={modalFooter}>
                {onDeleteRoom ? (() => {
                  const inspNum = normalizeRoomNumber(inspectingRoom.roomNumber);
                  const inspBldg = normalizeBuildingName(inspectingRoom.building).toLowerCase();
                  const hasAnyAllotted = reservations.some(
                    (res) =>
                      normalizeRoomNumber(res.roomNumber) === inspNum &&
                      normalizeBuildingName(res.building).toLowerCase() === inspBldg
                  );
                  return (
                    <button
                      type="button"
                      disabled={hasAnyAllotted}
                      onClick={() => {
                        if (hasAnyAllotted) return;
                        if (window.confirm(`Delete Room ${inspectingRoom.roomNumber} (${inspectingRoom.building}) from inventory?`)) {
                          onDeleteRoom(inspectingRoom.id);
                          setInspectingRoom(null);
                        }
                      }}
                      title={hasAnyAllotted ? 'Cannot delete: this room has allotted Zaereen' : 'Delete room from inventory'}
                      className={`mr-auto inline-flex items-center justify-center gap-1.5 h-10 px-3 -ml-3 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                        hasAnyAllotted
                          ? 'text-stone-500 cursor-not-allowed'
                          : 'text-rose-700 hover:bg-rose-50 cursor-pointer'
                      }`}
                    >
                      {hasAnyAllotted ? <Lock className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                      <span>{hasAnyAllotted ? 'Allotted (protected)' : 'Delete room'}</span>
                    </button>
                  );
                })() : null}

                <button
                  type="button"
                  onClick={() => {
                    setEditingRoom(inspectingRoom);
                    setInspectingRoom(null);
                  }}
                  className={btn.secondary}
                >
                  <Pencil className="w-4 h-4" />
                  Edit
                </button>
                <button type="button" onClick={() => setInspectingRoom(null)} className={btn.primary}>
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
          onAddRooms={(newRooms) => onAddRooms?.(newRooms)}
          initialBuildingMode={addModalInitialMode}
        />
      )}

      {editingRoom && (
        <RoomEditModal
          room={editingRoom}
          onClose={() => setEditingRoom(null)}
          onSave={onUpdateRoomDetails}
        />
      )}
    </div>
  );
};
