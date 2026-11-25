import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, CheckCircle2, DoorClosed, Plus, Sparkles, X } from 'lucide-react';
import { Room } from '../types';
import {
  deduplicateRooms,
  normalizeBuildingName,
  normalizeRoomNumber,
  getCanonicalRoomKey,
  isPlausibleRoom,
  getDistinctBuildings,
} from '../services/storage';
import {
  DEFAULT_ROOM_SPEC,
  RoomSpecDraft,
  RoomSpecFields,
  applyRoomSpec,
  floorLabelFor,
  validateRoomSpec,
} from './RoomSpecFields';

interface AddBuildingAndRoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRooms: Room[];
  onAddRooms: (newRooms: Room[]) => void;
  initialBuildingMode?: 'existing' | 'new_building';
}

const MAX_BATCH = 100;

const roomId = (building: string, roomNumber: string) =>
  `rm-${building.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${roomNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

const inputClass =
  'w-full min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-900 font-semibold focus:outline-none focus:ring-1 focus:ring-[#0f4a37]';

export const AddBuildingAndRoomsModal: React.FC<AddBuildingAndRoomsModalProps> = ({
  isOpen,
  onClose,
  existingRooms,
  onAddRooms,
  initialBuildingMode = 'existing',
}) => {
  const [isNewBuilding, setIsNewBuilding] = useState(initialBuildingMode === 'new_building');
  const [newBuildingName, setNewBuildingName] = useState('');
  const [building, setBuilding] = useState<string>('Burhani');

  const [mode, setMode] = useState<'single' | 'batch'>(initialBuildingMode === 'new_building' ? 'batch' : 'single');

  // Single room
  const [singleRoomNumber, setSingleRoomNumber] = useState('');

  // Several rooms
  const [batchMethod, setBatchMethod] = useState<'range' | 'list'>('range');
  const [rangeFrom, setRangeFrom] = useState('101');
  const [rangeTo, setRangeTo] = useState('110');
  const [roomListInput, setRoomListInput] = useState('');
  const [batchFloorMode, setBatchFloorMode] = useState<'auto' | 'fixed'>('auto');

  const [spec, setSpec] = useState<RoomSpecDraft>(DEFAULT_ROOM_SPEC);
  const [error, setError] = useState<string | null>(null);

  const distinctBuildings = useMemo(() => getDistinctBuildings(existingRooms), [existingRooms]);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const startNew = initialBuildingMode === 'new_building';
      setIsNewBuilding(startNew);
      setNewBuildingName('');
      setBuilding((prev) => (distinctBuildings.includes(prev) ? prev : distinctBuildings[0] || 'Burhani'));
      setMode(startNew ? 'batch' : 'single');
      setSingleRoomNumber('');
      setBatchMethod('range');
      setRangeFrom(startNew ? '101' : '501');
      setRangeTo(startNew ? '110' : '510');
      setRoomListInput('');
      setError(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, initialBuildingMode, distinctBuildings]);

  const activeBuildingRaw = isNewBuilding ? newBuildingName : building;
  const activeBuilding = useMemo(() => normalizeBuildingName(activeBuildingRaw), [activeBuildingRaw]);

  const existingBuildingMatch = useMemo(() => {
    if (!activeBuilding) return null;
    return distinctBuildings.find((b) => b.toLowerCase() === activeBuilding.toLowerCase()) || null;
  }, [distinctBuildings, activeBuilding]);

  const existingByKey = useMemo(() => {
    const map = new Map<string, Room>();
    existingRooms.forEach((r) => {
      const key = getCanonicalRoomKey(r.building, r.roomNumber);
      if (key) map.set(key, r);
    });
    return map;
  }, [existingRooms]);

  const roomNumbers = useMemo(() => {
    if (mode === 'single') return [normalizeRoomNumber(singleRoomNumber)].filter(Boolean);
    if (batchMethod === 'range') {
      const from = parseInt(rangeFrom, 10);
      const to = parseInt(rangeTo, 10);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
      const start = Math.min(from, to);
      const end = Math.min(Math.max(from, to), start + MAX_BATCH - 1);
      return Array.from({ length: end - start + 1 }, (_, i) => String(start + i));
    }
    return Array.from(
      new Set(roomListInput.split(/[,;\s]+/).map((s) => normalizeRoomNumber(s)).filter(Boolean))
    ).slice(0, MAX_BATCH);
  }, [mode, singleRoomNumber, batchMethod, rangeFrom, rangeTo, roomListInput]);

  const hasValidBuildingName = activeBuilding.length > 0 && /[a-z]/i.test(activeBuilding);

  const invalidNumbers = useMemo(() => {
    if (!hasValidBuildingName) return [];
    return roomNumbers.filter((n) => !isPlausibleRoom(activeBuilding, n));
  }, [roomNumbers, activeBuilding, hasValidBuildingName]);

  const preview = useMemo(() => {
    if (!hasValidBuildingName) return [];
    const bldg = activeBuilding;
    return roomNumbers
      .filter((n) => isPlausibleRoom(bldg, n))
      .map((num) => {
        const key = getCanonicalRoomKey(bldg, num);
        const existing = existingByKey.get(key);
        // Several rooms: take the floor from the first digit (501 -> Floor 5) unless a fixed floor is set.
        let roomSpec = spec;
        if (mode === 'batch' && batchFloorMode === 'auto') {
          const digits = num.replace(/\D/g, '');
          const floor = digits.length >= 3 ? parseInt(digits.slice(0, digits.length - 2), 10) : /^g/i.test(num) ? 0 : 1;
          roomSpec = { ...spec, floor, floorLabel: floorLabelFor(floor) };
        }
        const room = applyRoomSpec(
          existing ? { ...existing } : { id: roomId(bldg, num), building: bldg, roomNumber: num },
          roomSpec
        );
        return { room, isUpdate: !!existing };
      });
  }, [roomNumbers, activeBuilding, hasValidBuildingName, existingByKey, spec, mode, batchFloorMode]);

  const updates = preview.filter((p) => p.isUpdate).length;
  const additions = preview.length - updates;

  const handleSave = () => {
    if (!hasValidBuildingName) {
      return setError('Enter a valid building name using letters (e.g. Qasr Nobola, Najaf Lodge).');
    }
    const problem = validateRoomSpec(spec);
    if (problem) return setError(problem);
    if (invalidNumbers.length) {
      return setError(`Check these room numbers: ${invalidNumbers.join(', ')}. Use up to 6 characters, e.g. 105 or G1.`);
    }
    if (preview.length === 0) return setError('Enter at least one room number for this building.');
    if (
      updates > 0 &&
      !window.confirm(
        `${updates} of these room${updates === 1 ? '' : 's'} already exist${updates === 1 ? 's' : ''} in ${activeBuilding}. Replace ${updates === 1 ? 'its' : 'their'} details with the ones entered here?`
      )
    ) {
      return;
    }
    onAddRooms(deduplicateRooms(preview.map((p) => p.room)));
    onClose();
  };

  if (!isOpen) return null;

  const buildingCount = (b: string) =>
    existingRooms.filter((r) => normalizeBuildingName(r.building).toLowerCase() === b.toLowerCase()).length;

  const creatingBrandNewBuilding = isNewBuilding && hasValidBuildingName && !existingBuildingMatch;

  const saveLabel =
    preview.length === 0
      ? creatingBrandNewBuilding
        ? 'Create building & rooms'
        : 'Save rooms'
      : creatingBrandNewBuilding
      ? `Create ${activeBuilding} (${additions} room${additions === 1 ? '' : 's'})`
      : additions && updates
      ? `Add ${additions}, update ${updates}`
      : updates
      ? `Update ${updates} room${updates === 1 ? '' : 's'}`
      : `Add ${additions} room${additions === 1 ? '' : 's'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-950/45 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-rooms-title"
        className="bg-[#f6f8f7] border border-[#e2e8e5] rounded-t-3xl sm:rounded-2xl max-w-3xl w-full shadow-2xl flex flex-col max-h-[94vh] overflow-hidden text-stone-800"
      >
        <div className="bg-[#0f4a37] text-white p-4 sm:p-5 flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#ecdcae]" />
              <h2 id="add-rooms-title" className="text-base sm:text-lg font-bold font-serif tracking-wide">
                {isNewBuilding ? 'Add new building & rooms' : 'Add building or rooms'}
              </h2>
            </div>
            <p className="text-xs text-stone-200 mt-1 max-w-xl">
              New buildings and rooms appear across the app straight away: allotment, switching, timeline, and planner.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-stone-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 text-xs">
          {/* Building + mode */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 space-y-3">
            <div>
              <span className="block font-bold text-stone-800 mb-2">Building</span>
              <div className="flex items-center gap-2 flex-wrap">
                {distinctBuildings.map((b) => {
                  const selected = !isNewBuilding && building === b;
                  return (
                    <button
                      key={b}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setIsNewBuilding(false);
                        setBuilding(b);
                        setError(null);
                      }}
                      className={`min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-xl font-bold border transition cursor-pointer ${
                        selected
                          ? 'bg-[#0f4a37] text-white border-[#0f4a37]'
                          : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
                      }`}
                    >
                      {b} <span className="font-normal opacity-75 tabular-nums">({buildingCount(b)})</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={isNewBuilding}
                  onClick={() => {
                    setIsNewBuilding(true);
                    setMode('batch');
                    if (rangeFrom === '501' && rangeTo === '510') {
                      setRangeFrom('101');
                      setRangeTo('110');
                    }
                    setError(null);
                  }}
                  className={`min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-xl font-bold border transition cursor-pointer inline-flex items-center gap-1.5 ${
                    isNewBuilding
                      ? 'bg-[#0f4a37] text-white border-[#0f4a37]'
                      : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  New building
                </button>
              </div>

              {isNewBuilding && (
                <div className="mt-3 p-3 rounded-xl bg-[#f6f8f7] border border-[#c9a85a]/50 space-y-1.5">
                  <label className="block max-w-md">
                    <span className="block text-stone-700 font-bold mb-1">New building name *</span>
                    <input
                      type="text"
                      autoFocus
                      placeholder="e.g. Qasr Nobola, Al-Najaf Residency, Mohammedi"
                      value={newBuildingName}
                      onChange={(e) => {
                        setNewBuildingName(e.target.value);
                        setError(null);
                      }}
                      className={inputClass}
                    />
                  </label>
                  {existingBuildingMatch ? (
                    <p className="text-[11px] font-semibold text-amber-800">
                      "{existingBuildingMatch}" already exists ({buildingCount(existingBuildingMatch)} rooms). New rooms will be added to {existingBuildingMatch}.
                    </p>
                  ) : hasValidBuildingName ? (
                    <p className="text-[11px] font-semibold text-[#0f4a37]">
                      Ready to create building "{activeBuilding}" with the rooms configured below.
                    </p>
                  ) : (
                    <p className="text-[11px] text-stone-500">
                      Enter a building name above, then choose its starting room numbers below.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <span className="block font-bold text-stone-800 mb-2">How many rooms?</span>
              <div className="inline-flex items-center bg-stone-100 p-0.5 rounded-lg font-semibold">
                {(['single', 'batch'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => { setMode(m); setError(null); }}
                    className={`min-h-[36px] sm:min-h-0 px-3 py-1 rounded-md transition cursor-pointer ${
                      mode === m ? 'bg-[#0f4a37] text-white shadow-2xs' : 'text-stone-700 hover:text-stone-900'
                    }`}
                  >
                    {m === 'single' ? 'One room' : 'Several rooms, same setup'}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'single' ? (
              <label className="block max-w-xs">
                <span className="block text-stone-600 font-semibold mb-1">Room number *</span>
                <input
                  type="text"
                  autoFocus={!isNewBuilding}
                  placeholder="e.g. 501, G4, M102"
                  value={singleRoomNumber}
                  onChange={(e) => { setSingleRoomNumber(e.target.value); setError(null); }}
                  className={inputClass}
                />
              </label>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                    <input type="radio" name="batchMethod" checked={batchMethod === 'range'} onChange={() => setBatchMethod('range')} />
                    Number range
                  </label>
                  <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                    <input type="radio" name="batchMethod" checked={batchMethod === 'list'} onChange={() => setBatchMethod('list')} />
                    List of numbers
                  </label>
                </div>
                {batchMethod === 'range' ? (
                  <div className="grid grid-cols-2 gap-3 max-w-sm">
                    <label className="block">
                      <span className="block text-stone-600 font-semibold mb-1">From</span>
                      <input type="number" inputMode="numeric" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className={inputClass} />
                    </label>
                    <label className="block">
                      <span className="block text-stone-600 font-semibold mb-1">To</span>
                      <input type="number" inputMode="numeric" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className={inputClass} />
                    </label>
                  </div>
                ) : (
                  <label className="block">
                    <span className="block text-stone-600 font-semibold mb-1">Room numbers, separated by commas or spaces</span>
                    <textarea
                      rows={2}
                      value={roomListInput}
                      onChange={(e) => setRoomListInput(e.target.value)}
                      placeholder="101, 102, 103, G1"
                      className={inputClass}
                    />
                  </label>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="font-semibold text-stone-600">Floor:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="floorMode" checked={batchFloorMode === 'auto'} onChange={() => setBatchFloorMode('auto')} />
                    From room number (501 → Floor 5)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="floorMode" checked={batchFloorMode === 'fixed'} onChange={() => setBatchFloorMode('fixed')} />
                    Same floor for all
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Room setup */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 space-y-3">
            <h3 className="font-bold text-[#0f4a37] uppercase tracking-wider pb-1 border-b border-stone-100">
              {mode === 'single' ? 'Room setup' : 'Setup for every room'}
            </h3>
            <RoomSpecFields
              value={spec}
              onChange={(next) => { setSpec(next); setError(null); }}
              showFloor={mode === 'single' || batchFloorMode === 'fixed'}
            />
          </div>

          {/* Preview */}
          <div className="bg-[#f6f8f7] p-3 rounded-xl border border-[#e2e8e5] space-y-2">
            <div className="flex items-center justify-between gap-2 font-bold text-stone-800">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                Preview {hasValidBuildingName ? `— ${activeBuilding}` : ''}
              </span>
              <span className="text-[#0f4a37] bg-emerald-100 px-2.5 py-0.5 rounded-full tabular-nums">
                {additions} new{updates ? ` · ${updates} existing` : ''}
              </span>
            </div>
            {preview.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 bg-white rounded-lg border border-stone-200">
                {preview.map(({ room, isUpdate }) => (
                  <span
                    key={room.id}
                    title={isUpdate ? 'Already in the inventory: saving replaces its details' : 'New room'}
                    className={`px-2 py-0.5 rounded border text-[11px] font-semibold flex items-center gap-1 ${
                      isUpdate ? 'bg-amber-50 border-amber-300 text-amber-950' : 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    }`}
                  >
                    <DoorClosed className="w-3 h-3" />
                    {room.building} {room.roomNumber} · {room.floorLabel} · {room.beds} beds · sleeps {room.capacity}
                    {room.buffer ? `+${room.buffer}` : ''}
                    {isUpdate && <span className="font-bold"> · exists</span>}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-stone-400 italic text-center py-2">
                {hasValidBuildingName ? 'Enter a room number to see it here.' : 'Enter a building name to preview rooms.'}
              </p>
            )}
            {invalidNumbers.length > 0 && (
              <p className="text-red-700 font-semibold">Not valid room numbers: {invalidNumbers.join(', ')}</p>
            )}
            {mode === 'batch' && batchMethod === 'range' && roomNumbers.length === MAX_BATCH && (
              <p className="text-stone-500">Up to {MAX_BATCH} rooms are added at a time.</p>
            )}
          </div>

          {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
        </div>

        <div className="px-4 sm:px-6 py-3 border-t border-stone-200 bg-white flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={preview.length === 0 || !hasValidBuildingName}
            className="min-h-[40px] px-5 py-2 rounded-xl text-xs font-bold bg-[#0f4a37] hover:bg-[#0b3a2b] disabled:opacity-50 text-white transition flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
