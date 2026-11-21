import React, { useState, useMemo, useEffect } from 'react';
import { 
  Building2, 
  DoorClosed, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Sparkles, 
  Layers, 
  Copy, 
  ExternalLink, 
  RefreshCw,
  Info,
  Check,
  BedDouble,
  Download
} from 'lucide-react';
import { Room, RoomCategory, RoomStatus } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import {
  deduplicateRooms,
  normalizeBuildingName,
  normalizeRoomNumber,
  getCanonicalRoomKey,
  OFFICIAL_THREE_BUILDINGS,
} from '../services/storage';

interface AddBuildingAndRoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRooms: Room[];
  onAddRooms: (newRooms: Room[], replaceExisting?: boolean) => void;
}

export const AddBuildingAndRoomsModal: React.FC<AddBuildingAndRoomsModalProps> = ({
  isOpen,
  onClose,
  existingRooms,
  onAddRooms,
}) => {
  // Strictly the 3 official buildings (Burhani, Saifee, Badri)
  const existingBuildingNames = useMemo(() => {
    return [...OFFICIAL_THREE_BUILDINGS];
  }, []);

  // ==========================================
  // TAB 1: MANUAL ADDITION STATE
  // ==========================================
  const [manualMode, setManualMode] = useState<'single' | 'batch'>('batch');
  
  // Building selection (locked to the 3 official buildings)
  const [selectedBuildingName, setSelectedBuildingName] = useState<string>('Burhani');

  const activeBuildingName = selectedBuildingName;

  // Single Room fields
  const [singleRoomNumber, setSingleRoomNumber] = useState<string>('');
  const [singleFloor, setSingleFloor] = useState<number>(1);
  const [singleFloorLabel, setSingleFloorLabel] = useState<string>('Floor 1');
  const [singleCapacity, setSingleCapacity] = useState<number>(3);
  const [singleBuffer, setSingleBuffer] = useState<number>(0);
  const [singleToiletType, setSingleToiletType] = useState<string>('Western Toilet');
  const [singleBedType, setSingleBedType] = useState<string>('Single Beds');
  const [singleCategory, setSingleCategory] = useState<RoomCategory>('Category B (Standard)');
  const [singleStatus, setSingleStatus] = useState<RoomStatus>('available');

  // Batch Room fields
  const [batchMethod, setBatchMethod] = useState<'range' | 'list'>('range');
  const [rangeFrom, setRangeFrom] = useState<number>(101);
  const [rangeTo, setRangeTo] = useState<number>(110);
  const [roomListInput, setRoomListInput] = useState<string>('101, 102, 103, 104, 201, 202, 203, 204');
  const [batchFloorMode, setBatchFloorMode] = useState<'auto' | 'fixed'>('auto');
  const [batchFixedFloor, setBatchFixedFloor] = useState<number>(1);
  const [batchCapacity, setBatchCapacity] = useState<number>(3);
  const [batchBuffer, setBatchBuffer] = useState<number>(0);
  const [batchToiletType, setBatchToiletType] = useState<string>('Western Toilet');
  const [batchBedType, setBatchBedType] = useState<string>('Single Beds');
  const [batchCategory, setBatchCategory] = useState<RoomCategory>('Category B (Standard)');

  // Compute preview of manual rooms to be added (normalized & deduplicated)
  const previewManualRooms = useMemo(() => {
    const building = normalizeBuildingName(activeBuildingName) || 'Saifee';
    const existingIdMap = new Map<string, string>();
    existingRooms.forEach((er) => {
      const k = getCanonicalRoomKey(er.building, er.roomNumber);
      if (k && er.id) existingIdMap.set(k, er.id);
    });

    const result: Room[] = [];

    if (manualMode === 'single') {
      const cleanNum = normalizeRoomNumber(singleRoomNumber);
      if (!cleanNum) return [];
      const key = getCanonicalRoomKey(building, cleanNum);
      const id =
        existingIdMap.get(key) ||
        `rm-${building.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${cleanNum.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      result.push({
        id,
        roomNumber: cleanNum,
        building,
        floor: singleFloor,
        floorLabel: singleFloorLabel || `Floor ${singleFloor}`,
        capacity: singleCapacity,
        pax: singleCapacity,
        buffer: singleBuffer,
        toiletType: singleToiletType,
        bedType: singleBedType,
        category: singleCategory,
        status: singleStatus,
        amenities: ['Air Conditioning', 'WiFi', 'Clean Linens'],
      });
    } else {
      // Batch mode
      const roomNumbers: string[] = [];
      if (batchMethod === 'range') {
        const start = Math.min(rangeFrom, rangeTo);
        const end = Math.max(rangeFrom, rangeTo);
        // limit range to max 100 rooms per batch for safety
        const safeEnd = Math.min(end, start + 99);
        for (let num = start; num <= safeEnd; num++) {
          roomNumbers.push(String(num));
        }
      } else {
        const parts = roomListInput
          .split(/[,;\n]+/)
          .map((s) => normalizeRoomNumber(s))
          .filter(Boolean);
        roomNumbers.push(...Array.from(new Set(parts)));
      }

      roomNumbers.forEach((rNum) => {
        const cleanNum = normalizeRoomNumber(rNum);
        if (!cleanNum) return;
        let floor = batchFixedFloor;
        if (batchFloorMode === 'auto') {
          const m = cleanNum.match(/^(\d)/);
          floor = m ? parseInt(m[1], 10) : 1;
        }

        const key = getCanonicalRoomKey(building, cleanNum);
        const id =
          existingIdMap.get(key) ||
          `rm-${building.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${cleanNum.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        result.push({
          id,
          roomNumber: cleanNum,
          building,
          floor,
          floorLabel: `Floor ${floor}`,
          capacity: batchCapacity,
          pax: batchCapacity,
          buffer: batchBuffer,
          toiletType: batchToiletType,
          bedType: batchBedType,
          category: batchCategory,
          status: 'available',
          amenities: ['Air Conditioning', 'WiFi', 'Clean Linens'],
        });
      });
    }

    return deduplicateRooms(result);
  }, [
    manualMode,
    activeBuildingName,
    singleRoomNumber,
    singleFloor,
    singleFloorLabel,
    singleCapacity,
    singleBuffer,
    singleToiletType,
    singleBedType,
    singleCategory,
    singleStatus,
    batchMethod,
    rangeFrom,
    rangeTo,
    roomListInput,
    batchFloorMode,
    batchFixedFloor,
    batchCapacity,
    batchBuffer,
    batchToiletType,
    batchBedType,
    batchCategory,
  ]);

  const handleSaveManualRooms = () => {
    if (!activeBuildingName) {
      alert('Please select or specify a building name.');
      return;
    }
    if (previewManualRooms.length === 0) {
      alert('Please enter at least one valid room number.');
      return;
    }

    onAddRooms(previewManualRooms, false);
    onClose();
  };

  // ==========================================
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/45 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div className="bg-[#f6f8f7] border border-[#e2e8e5] rounded-2xl max-w-4xl w-full shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-stone-800">
        
        {/* Top Header */}
        <div className="bg-[#0f4a37] text-white p-4 sm:p-5 flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 className="w-5 h-5 text-[#ecdcae]" />
              <h2 className="text-base sm:text-lg font-bold font-serif tracking-wide text-white">
                Add Hotel Buildings & Rooms
              </h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#ecdcae]/20 text-[#ecdcae] border border-[#ecdcae]/40 font-semibold">
                Inventory Setup
              </span>
            </div>
            <p className="text-xs text-stone-200 mt-1 max-w-xl">
              Add or update rooms in Burhani, Saifee, and Badri.
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          
          {/* ============================================================ */}
          {/* TAB 1: ADD MANUALLY                                          */}
          {/* ============================================================ */}
            <div className="space-y-5">
              
              {/* Manual Sub-mode: Single vs Batch */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-stone-200 shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-stone-700">Mode:</span>
                  <div className="flex items-center bg-stone-100 p-0.5 rounded-lg text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setManualMode('single')}
                      className={`px-3 py-1 rounded-md transition cursor-pointer ${
                        manualMode === 'single'
                          ? 'bg-[#0f4a37] text-white font-bold shadow-2xs'
                          : 'text-stone-700 hover:text-stone-900'
                      }`}
                    >
                      Single Room
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualMode('batch')}
                      className={`px-3 py-1 rounded-md transition cursor-pointer ${
                        manualMode === 'batch'
                          ? 'bg-[#0f4a37] text-white font-bold shadow-2xs'
                          : 'text-stone-700 hover:text-stone-900'
                      }`}
                    >
                      Batch Add Rooms / Entire Building
                    </button>
                  </div>
                </div>

                <div className="text-xs text-stone-500 font-medium">
                  {manualMode === 'single' ? 'Add 1 custom room' : 'Quickly generate multiple rooms across floors'}
                </div>
              </div>

              {/* Building Selection Section (Only 3 Official Buildings: Burhani, Saifee, Badri) */}
              <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-[#0f4a37]" />
                    <span>Target Hotel / Building (3 Official Buildings):</span>
                  </label>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {existingBuildingNames.map((bldg) => (
                    <button
                      key={bldg}
                      type="button"
                      onClick={() => setSelectedBuildingName(bldg)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        selectedBuildingName === bldg
                          ? 'bg-[#0f4a37] text-white border-[#0f4a37] shadow-xs'
                          : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
                      }`}
                    >
                      {bldg} Hotel ({existingRooms.filter((r) => normalizeBuildingName(r.building).toLowerCase() === bldg.toLowerCase()).length} Rooms)
                    </button>
                  ))}
                </div>
              </div>

              {/* Single Room Form */}
              {manualMode === 'single' ? (
                <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-4">
                  <h4 className="text-xs font-bold text-[#0f4a37] uppercase tracking-wider pb-1 border-b border-stone-100">
                    Room Specifications
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Room Number *</label>
                      <input
                        type="text"
                        placeholder="e.g. 105, 201, G1"
                        value={singleRoomNumber}
                        onChange={(e) => setSingleRoomNumber(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Floor Level</label>
                      <input
                        type="number"
                        min="0"
                        max="25"
                        value={singleFloor}
                        onChange={(e) => {
                          const fl = parseInt(e.target.value, 10) || 1;
                          setSingleFloor(fl);
                          setSingleFloorLabel(`Floor ${fl}`);
                        }}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Floor Label</label>
                      <input
                        type="text"
                        placeholder="e.g. Floor 1, Ground, Mezzanine"
                        value={singleFloorLabel}
                        onChange={(e) => setSingleFloorLabel(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Capacity (Pax) *</label>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={singleCapacity}
                        onChange={(e) => setSingleCapacity(parseInt(e.target.value, 10) || 3)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Buffer Pax</label>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        value={singleBuffer}
                        onChange={(e) => setSingleBuffer(parseInt(e.target.value, 10) || 0)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Toilet Type</label>
                      <select
                        value={singleToiletType}
                        onChange={(e) => setSingleToiletType(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      >
                        <option value="Western Toilet">Western Toilet</option>
                        <option value="Indian Toilet">Indian Toilet</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Bed Configuration</label>
                      <select
                        value={singleBedType}
                        onChange={(e) => setSingleBedType(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      >
                        <option value="Single Beds">Single Beds</option>
                        <option value="Double Bed">Double Bed</option>
                        <option value="Double & Single Bed">Double & Single Bed</option>
                        <option value="Suite Beds">Suite Beds</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Category</label>
                      <select
                        value={singleCategory}
                        onChange={(e) => setSingleCategory(e.target.value as RoomCategory)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      >
                        <option value="Category B (Standard)">Category B (Standard)</option>
                        <option value="Category A (Nizaam)">Category A (Nizaam)</option>
                        <option value="Executive Suite">Executive Suite</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Initial Status</label>
                      <select
                        value={singleStatus}
                        onChange={(e) => setSingleStatus(e.target.value as RoomStatus)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      >
                        <option value="available">Available (Vacant Ready)</option>
                        <option value="blocked">Blocked (Hold)</option>
                        <option value="cleaning">Cleaning</option>
                      </select>
                    </div>
                  </div>
                </div>
              ) : (
                /* Batch Rooms Form */
                <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-4">
                  <h4 className="text-xs font-bold text-[#0f4a37] uppercase tracking-wider pb-1 border-b border-stone-100 flex items-center justify-between">
                    <span>Batch Room Generator</span>
                    <span className="text-[11px] text-stone-500 font-normal">
                      Will generate <strong className="text-stone-900">{previewManualRooms.length} Rooms</strong>
                    </span>
                  </h4>

                  {/* Method: Range vs Comma List */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-xs">
                      <label className="flex items-center gap-1 font-semibold cursor-pointer">
                        <input
                          type="radio"
                          name="batchMethod"
                          checked={batchMethod === 'range'}
                          onChange={() => setBatchMethod('range')}
                          className="text-[#0f4a37] focus:ring-[#0f4a37]"
                        />
                        <span>Sequential Range (e.g. 101 to 110)</span>
                      </label>
                      <label className="flex items-center gap-1 font-semibold cursor-pointer">
                        <input
                          type="radio"
                          name="batchMethod"
                          checked={batchMethod === 'list'}
                          onChange={() => setBatchMethod('list')}
                          className="text-[#0f4a37] focus:ring-[#0f4a37]"
                        />
                        <span>Custom List (Comma / Space separated)</span>
                      </label>
                    </div>

                    {batchMethod === 'range' ? (
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="block text-stone-600 font-semibold mb-1">From Room Number</label>
                          <input
                            type="number"
                            value={rangeFrom}
                            onChange={(e) => setRangeFrom(parseInt(e.target.value, 10) || 101)}
                            className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                          />
                        </div>
                        <div>
                          <label className="block text-stone-600 font-semibold mb-1">To Room Number</label>
                          <input
                            type="number"
                            value={rangeTo}
                            onChange={(e) => setRangeTo(parseInt(e.target.value, 10) || 110)}
                            className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-stone-600 font-semibold mb-1 text-xs">
                          Enter Room Numbers (Separated by commas or spaces)
                        </label>
                        <textarea
                          rows={2}
                          value={roomListInput}
                          onChange={(e) => setRoomListInput(e.target.value)}
                          placeholder="e.g. 101, 102, 103, 104, 201, 202, 203, 204..."
                          className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold text-xs focus:ring-1 focus:ring-[#0f4a37]"
                        />
                      </div>
                    )}
                  </div>

                  {/* Floor and Capacity Defaults */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs pt-1">
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Floor Assignment</label>
                      <select
                        value={batchFloorMode}
                        onChange={(e) => setBatchFloorMode(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      >
                        <option value="auto">Auto (from 1st digit: 101➔Fl 1)</option>
                        <option value="fixed">Fixed Floor</option>
                      </select>
                    </div>

                    {batchFloorMode === 'fixed' && (
                      <div>
                        <label className="block text-stone-600 font-semibold mb-1">Floor Level</label>
                        <input
                          type="number"
                          min="0"
                          max="25"
                          value={batchFixedFloor}
                          onChange={(e) => setBatchFixedFloor(parseInt(e.target.value, 10) || 1)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Default Capacity (Pax)</label>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={batchCapacity}
                        onChange={(e) => setBatchCapacity(parseInt(e.target.value, 10) || 3)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      />
                    </div>

                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Default Buffer</label>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        value={batchBuffer}
                        onChange={(e) => setBatchBuffer(parseInt(e.target.value, 10) || 0)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Toilet Type</label>
                      <select
                        value={batchToiletType}
                        onChange={(e) => setBatchToiletType(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      >
                        <option value="Western Toilet">Western Toilet</option>
                        <option value="Indian Toilet">Indian Toilet</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Bed Type</label>
                      <select
                        value={batchBedType}
                        onChange={(e) => setBatchBedType(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      >
                        <option value="Single Beds">Single Beds</option>
                        <option value="Double Bed">Double Bed</option>
                        <option value="Double & Single Bed">Double & Single Bed</option>
                        <option value="Suite Beds">Suite Beds</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Category</label>
                      <select
                        value={batchCategory}
                        onChange={(e) => setBatchCategory(e.target.value as RoomCategory)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#0f4a37]"
                      >
                        <option value="Category B (Standard)">Category B (Standard)</option>
                        <option value="Category A (Nizaam)">Category A (Nizaam)</option>
                        <option value="Executive Suite">Executive Suite</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Live Preview Bar */}
              <div className="bg-[#f6f8f7] p-3 rounded-xl border border-[#e2e8e5] space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-stone-800">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>Live Preview of Rooms to be Added:</span>
                  </span>
                  <span className="text-[#0f4a37] bg-emerald-100 px-2.5 py-0.5 rounded-full font-mono">
                    {previewManualRooms.length} Room(s) for {activeBuildingName || 'Building'}
                  </span>
                </div>

                {previewManualRooms.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1 bg-white rounded-lg border border-stone-200">
                    {previewManualRooms.map((rm) => (
                      <span
                        key={rm.id}
                        className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-[11px] font-bold text-emerald-950 flex items-center gap-1"
                      >
                        <DoorClosed className="w-3 h-3 text-emerald-700" />
                        <span>Room {rm.roomNumber} ({rm.building} • Fl {rm.floor} • {rm.capacity} Pax)</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-stone-400 italic text-center py-2">
                    Enter room numbers above to preview rooms.
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualRooms}
                  disabled={previewManualRooms.length === 0}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-[#0f4a37] hover:bg-[#0b3a2b] disabled:opacity-50 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save {previewManualRooms.length} Room(s) to Inventory</span>
                </button>
              </div>

            </div>

        </div>

      </div>
    </div>
  );
};
