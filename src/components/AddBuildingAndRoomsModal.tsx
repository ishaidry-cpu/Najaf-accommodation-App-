import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, DoorClosed, Plus, X } from 'lucide-react';
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
  segBtn,
  segTrack,
  validateRoomSpec,
} from './RoomSpecFields';
import { btn, chip, field, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle, panel } from './ui';

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

const radioLabel = 'inline-flex items-center gap-2 min-h-10 sm:min-h-8 text-sm text-stone-800 cursor-pointer';

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
        ? 'Create building and rooms'
        : 'Save rooms'
      : creatingBrandNewBuilding
      ? `Create ${activeBuilding} (${additions} room${additions === 1 ? '' : 's'})`
      : additions && updates
      ? `Add ${additions}, update ${updates}`
      : updates
      ? `Update ${updates} room${updates === 1 ? '' : 's'}`
      : `Add ${additions} room${additions === 1 ? '' : 's'}`;

  return (
    <div className={modalScrim}>
      <div role="dialog" aria-modal="true" aria-labelledby="add-rooms-title" className={`${modalCard} max-w-3xl`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h2 id="add-rooms-title" className={modalTitle}>
              {isNewBuilding ? 'Add new building and rooms' : 'Add building or rooms'}
            </h2>
            <p className="mt-1 text-[13px] text-stone-600 max-w-xl">
              New buildings and rooms appear across the app straight away: allotment, switching, timeline and planner.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={modalClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0 space-y-6 text-sm text-stone-800">
          {/* Building + mode */}
          <section className="space-y-4">
            <div>
              <span className={fieldLabel}>Building</span>
              <div className={`${segTrack} flex-wrap max-w-full`}>
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
                      className={segBtn(selected)}
                    >
                      {b} <span className="font-normal text-stone-500 tabular-nums">{buildingCount(b)}</span>
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
                  className={segBtn(isNewBuilding)}
                >
                  <Plus className="w-4 h-4" />
                  New building
                </button>
              </div>

              {isNewBuilding && (
                <div className="mt-4">
                  <label className="block max-w-md">
                    <span className={fieldLabel}>New building name *</span>
                    <input
                      type="text"
                      autoFocus
                      placeholder="e.g. Qasr Nobola, Al-Najaf Residency, Mohammedi"
                      value={newBuildingName}
                      onChange={(e) => {
                        setNewBuildingName(e.target.value);
                        setError(null);
                      }}
                      className={field}
                    />
                  </label>
                  {existingBuildingMatch ? (
                    <p className="mt-1.5 text-[13px] text-amber-800">
                      "{existingBuildingMatch}" already exists ({buildingCount(existingBuildingMatch)} rooms). New rooms will be added to {existingBuildingMatch}.
                    </p>
                  ) : hasValidBuildingName ? (
                    <p className="mt-1.5 text-[13px] text-emerald-800">
                      Ready to create building "{activeBuilding}" with the rooms configured below.
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[13px] text-stone-500">
                      Enter a building name above, then choose its starting room numbers below.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <span className={fieldLabel}>How many rooms?</span>
              <div className={`${segTrack} max-w-full`}>
                {(['single', 'batch'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => { setMode(m); setError(null); }}
                    className={segBtn(mode === m)}
                  >
                    {m === 'single' ? 'One room' : 'Several rooms, same setup'}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'single' ? (
              <label className="block max-w-xs">
                <span className={fieldLabel}>Room number *</span>
                <input
                  type="text"
                  autoFocus={!isNewBuilding}
                  placeholder="e.g. 501, G4, M102"
                  value={singleRoomNumber}
                  onChange={(e) => { setSingleRoomNumber(e.target.value); setError(null); }}
                  className={field}
                />
              </label>
            ) : (
              <div className="space-y-4">
                <div>
                  <span className={fieldLabel}>Room numbers</span>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                    <label className={radioLabel}>
                      <input type="radio" name="batchMethod" checked={batchMethod === 'range'} onChange={() => setBatchMethod('range')} />
                      Number range
                    </label>
                    <label className={radioLabel}>
                      <input type="radio" name="batchMethod" checked={batchMethod === 'list'} onChange={() => setBatchMethod('list')} />
                      List of numbers
                    </label>
                  </div>
                </div>
                {batchMethod === 'range' ? (
                  <div className="grid grid-cols-2 gap-4 max-w-sm">
                    <label className="block">
                      <span className={fieldLabel}>From</span>
                      <input type="number" inputMode="numeric" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className={`${field} tabular-nums`} />
                    </label>
                    <label className="block">
                      <span className={fieldLabel}>To</span>
                      <input type="number" inputMode="numeric" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className={`${field} tabular-nums`} />
                    </label>
                  </div>
                ) : (
                  <label className="block">
                    <span className={fieldLabel}>Room numbers, separated by commas or spaces</span>
                    <textarea
                      rows={2}
                      value={roomListInput}
                      onChange={(e) => setRoomListInput(e.target.value)}
                      placeholder="101, 102, 103, G1"
                      className={`${field} h-auto! py-2`}
                    />
                  </label>
                )}
                <div>
                  <span className={fieldLabel}>Floor</span>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                    <label className={radioLabel}>
                      <input type="radio" name="floorMode" checked={batchFloorMode === 'auto'} onChange={() => setBatchFloorMode('auto')} />
                      From room number (501 → Floor 5)
                    </label>
                    <label className={radioLabel}>
                      <input type="radio" name="floorMode" checked={batchFloorMode === 'fixed'} onChange={() => setBatchFloorMode('fixed')} />
                      Same floor for all
                    </label>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Room setup */}
          <section className="pt-5 border-t border-stone-200">
            <h3 className="mb-4 text-[15px] font-semibold text-stone-950">
              {mode === 'single' ? 'Room setup' : 'Setup for every room'}
            </h3>
            <RoomSpecFields
              value={spec}
              onChange={(next) => { setSpec(next); setError(null); }}
              showFloor={mode === 'single' || batchFloorMode === 'fixed'}
            />
          </section>

          {/* Preview */}
          <section className={`${panel} p-4 space-y-3`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-[15px] font-semibold text-stone-950">
                Preview{hasValidBuildingName ? `: ${activeBuilding}` : ''}
              </h3>
              <span className="text-[13px] text-stone-600 tabular-nums">
                {additions} new{updates ? ` · ${updates} existing` : ''}
              </span>
            </div>
            {preview.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                {preview.map(({ room, isUpdate }) => (
                  <span
                    key={room.id}
                    title={isUpdate ? 'Already in the inventory: saving replaces its details' : 'New room'}
                    className={chip(isUpdate ? 'wait' : 'ok')}
                  >
                    <DoorClosed className="w-3.5 h-3.5" />
                    {room.roomNumber} · {room.floorLabel} · {room.beds} beds · sleeps {room.capacity}
                    {room.buffer ? `+${room.buffer}` : ''}
                    {isUpdate && <span className="font-semibold"> · exists</span>}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-stone-500">
                {hasValidBuildingName ? 'Enter a room number to see it here.' : 'Enter a building name to preview rooms.'}
              </p>
            )}
            {invalidNumbers.length > 0 && (
              <p className="text-[13px] font-medium text-rose-700">Not valid room numbers: {invalidNumbers.join(', ')}</p>
            )}
            {mode === 'batch' && batchMethod === 'range' && roomNumbers.length === MAX_BATCH && (
              <p className="text-[13px] text-stone-500">Up to {MAX_BATCH} rooms are added at a time.</p>
            )}
          </section>

          {error && <p role="alert" className="text-[13px] font-medium text-rose-700">{error}</p>}
        </div>

        <div className={modalFooter}>
          <button type="button" onClick={onClose} className={btn.secondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={preview.length === 0 || !hasValidBuildingName}
            className={btn.primary}
          >
            <CheckCircle2 className="w-4 h-4" />
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
