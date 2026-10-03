import React, { useState, useMemo, useEffect } from 'react';
import { 
  Building2, 
  DoorClosed, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  FileSpreadsheet, 
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
import { Room, RoomCategory, RoomStatus, GoogleSheetsConfig } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import { 
  fetchRoomsAndBuildingsFromGoogleSheetUrl, 
  parseRoomsFromCsvText 
} from '../services/googleSheets';

interface AddBuildingAndRoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRooms: Room[];
  onAddRooms: (newRooms: Room[], replaceExisting?: boolean) => void;
  accessToken?: string | null;
  sheetsConfig?: GoogleSheetsConfig;
  initialTab?: 'manual' | 'sheet';
}

export const AddBuildingAndRoomsModal: React.FC<AddBuildingAndRoomsModalProps> = ({
  isOpen,
  onClose,
  existingRooms,
  onAddRooms,
  accessToken,
  sheetsConfig,
  initialTab = 'manual',
}) => {
  // Main Tab: 'manual' or 'sheet'
  const [activeTab, setActiveTab] = useState<'manual' | 'sheet'>(initialTab);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Existing distinct building names
  const existingBuildingNames = useMemo(() => {
    const list = Array.from(new Set(existingRooms.map((r) => r.building).filter(Boolean)));
    return list.length > 0 ? list : ['Saifee', 'Burhani'];
  }, [existingRooms]);

  // ==========================================
  // TAB 1: MANUAL ADDITION STATE
  // ==========================================
  const [manualMode, setManualMode] = useState<'single' | 'batch'>('batch');
  
  // Building selection
  const [buildingType, setBuildingType] = useState<'existing' | 'new'>('existing');
  const [selectedBuildingName, setSelectedBuildingName] = useState<string>(existingBuildingNames[0] || 'Saifee');
  const [newBuildingNameInput, setNewBuildingNameInput] = useState<string>('');

  const activeBuildingName = buildingType === 'new' ? newBuildingNameInput.trim() : selectedBuildingName;

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

  // Compute preview of manual rooms to be added
  const previewManualRooms = useMemo(() => {
    const building = activeBuildingName || 'Saifee';
    const result: Room[] = [];

    if (manualMode === 'single') {
      if (!singleRoomNumber.trim()) return [];
      const cleanNum = singleRoomNumber.trim();
      const id = `rm-${building.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${cleanNum.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
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
        const parts = roomListInput.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
        roomNumbers.push(...parts);
      }

      roomNumbers.forEach((rNum) => {
        let floor = batchFixedFloor;
        if (batchFloorMode === 'auto') {
          const m = rNum.match(/^(\d)/);
          floor = m ? parseInt(m[1], 10) : 1;
        }

        const id = `rm-${building.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${rNum.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        result.push({
          id,
          roomNumber: rNum,
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

    return result;
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
  // TAB 2: GOOGLE SHEETS SYNC STATE
  // ==========================================
  const defaultSheetUrl = sheetsConfig?.spreadsheetUrl || 
    (sheetsConfig?.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${sheetsConfig.spreadsheetId}/edit` : '');

  const [sheetUrlInput, setSheetUrlInput] = useState<string>(defaultSheetUrl);
  const [isFetchingSheet, setIsFetchingSheet] = useState<boolean>(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [parsedSheetRooms, setParsedSheetRooms] = useState<Room[] | null>(null);
  const [sheetImportMode, setSheetImportMode] = useState<'merge' | 'replace'>('merge');
  const [showFormatGuide, setShowFormatGuide] = useState<boolean>(false);
  const [copiedSample, setCopiedSample] = useState<boolean>(false);

  useEffect(() => {
    if (defaultSheetUrl && !sheetUrlInput) {
      setSheetUrlInput(defaultSheetUrl);
    }
  }, [defaultSheetUrl, sheetUrlInput]);

  const sampleCsvHeader = 'Building,Room,Floor,Capacity,Buffer,Toilet Type,Bed Type,Category,Status\nSaifee,101,1,3,0,Western Toilet,Single Beds,Category B (Standard),available\nBurhani,201,2,4,1,Indian Toilet,Double & Single Bed,Category A (Nizaam),available\nAl-Rawda,301,3,2,0,Western Toilet,Double Bed,Executive Suite,available';

  const handleCopySample = () => {
    navigator.clipboard.writeText(sampleCsvHeader);
    setCopiedSample(true);
    setTimeout(() => setCopiedSample(false), 2000);
  };

  const handleDownloadSampleCsv = () => {
    const blob = new Blob([sampleCsvHeader], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'hotel_buildings_and_rooms_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFetchRoomsFromSheet = async () => {
    if (!sheetUrlInput.trim()) {
      setSheetError('Please enter a Google Sheet URL or Spreadsheet ID.');
      return;
    }

    setIsFetchingSheet(true);
    setSheetError(null);
    setParsedSheetRooms(null);

    try {
      const fetched = await fetchRoomsAndBuildingsFromGoogleSheetUrl(
        sheetUrlInput.trim(),
        accessToken,
        existingRooms
      );

      if (fetched.length === 0) {
        setSheetError('No valid room rows found in the Google Sheet. Please check your columns (Building, Room, Floor, Capacity).');
      } else {
        setParsedSheetRooms(fetched);
      }
    } catch (err: any) {
      setSheetError(err.message || 'Failed to fetch rooms from Google Sheet.');
    } finally {
      setIsFetchingSheet(false);
    }
  };

  const handleConfirmSheetSync = () => {
    if (!parsedSheetRooms || parsedSheetRooms.length === 0) return;
    onAddRooms(parsedSheetRooms, sheetImportMode === 'replace');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-4xl w-full shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-stone-800">
        
        {/* Top Header */}
        <div className="bg-[#124E39] text-white p-4 sm:p-5 flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 className="w-5 h-5 text-[#EBD59E]" />
              <h2 className="text-base sm:text-lg font-bold font-serif tracking-wide text-white">
                Add Hotel Buildings & Rooms
              </h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#EBD59E]/20 text-[#EBD59E] border border-[#EBD59E]/40 font-semibold">
                Inventory Setup
              </span>
            </div>
            <p className="text-xs text-stone-200 mt-1 max-w-xl">
              Add new rooms to Saifee & Burhani, or create a brand new hotel building. Add manually or sync directly from your Google Sheet.
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

        {/* Tab Switcher */}
        <div className="bg-stone-200/80 px-4 py-2 border-b border-stone-300 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-stone-300 text-xs font-bold shadow-2xs">
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'manual'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              <Plus className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>Add Manually</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sheet')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'sheet'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sync from Google Sheet</span>
            </button>
          </div>

          <div className="text-xs text-stone-600 font-semibold hidden sm:block">
            Current Inventory: <strong className="text-[#124E39]">{existingRooms.length} Rooms</strong> across {existingBuildingNames.length} Building(s)
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          
          {/* ============================================================ */}
          {/* TAB 1: ADD MANUALLY                                          */}
          {/* ============================================================ */}
          {activeTab === 'manual' && (
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
                          ? 'bg-[#124E39] text-white font-bold shadow-2xs'
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
                          ? 'bg-[#124E39] text-white font-bold shadow-2xs'
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

              {/* Building Selection Section */}
              <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-[#124E39]" />
                    <span>Target Hotel / Building:</span>
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="buildingType"
                        checked={buildingType === 'existing'}
                        onChange={() => setBuildingType('existing')}
                        className="text-[#124E39] focus:ring-[#124E39]"
                      />
                      <span>Existing Building</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="buildingType"
                        checked={buildingType === 'new'}
                        onChange={() => setBuildingType('new')}
                        className="text-[#124E39] focus:ring-[#124E39]"
                      />
                      <span className="font-bold text-[#124E39]">+ Create New Building</span>
                    </label>
                  </div>
                </div>

                {buildingType === 'existing' ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {existingBuildingNames.map((bldg) => (
                      <button
                        key={bldg}
                        type="button"
                        onClick={() => setSelectedBuildingName(bldg)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                          selectedBuildingName === bldg
                            ? 'bg-[#124E39] text-white border-[#124E39] shadow-xs'
                            : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
                        }`}
                      >
                        {bldg} Hotel ({existingRooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length} Rooms)
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="e.g. Al-Rawda Hotel, Najaf Grand, Building C..."
                      value={newBuildingNameInput}
                      onChange={(e) => setNewBuildingNameInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-stone-50 border border-stone-300 text-xs font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                    />
                    <p className="text-[11px] text-stone-500 mt-1">
                      This will create a brand new hotel building in the system.
                    </p>
                  </div>
                )}
              </div>

              {/* Single Room Form */}
              {manualMode === 'single' ? (
                <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-4">
                  <h4 className="text-xs font-bold text-[#124E39] uppercase tracking-wider pb-1 border-b border-stone-100">
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
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Floor Label</label>
                      <input
                        type="text"
                        placeholder="e.g. Floor 1, Ground, Mezzanine"
                        value={singleFloorLabel}
                        onChange={(e) => setSingleFloorLabel(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Toilet Type</label>
                      <select
                        value={singleToiletType}
                        onChange={(e) => setSingleToiletType(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                  <h4 className="text-xs font-bold text-[#124E39] uppercase tracking-wider pb-1 border-b border-stone-100 flex items-center justify-between">
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
                          className="text-[#124E39] focus:ring-[#124E39]"
                        />
                        <span>Sequential Range (e.g. 101 to 110)</span>
                      </label>
                      <label className="flex items-center gap-1 font-semibold cursor-pointer">
                        <input
                          type="radio"
                          name="batchMethod"
                          checked={batchMethod === 'list'}
                          onChange={() => setBatchMethod('list')}
                          className="text-[#124E39] focus:ring-[#124E39]"
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
                            className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
                          />
                        </div>
                        <div>
                          <label className="block text-stone-600 font-semibold mb-1">To Room Number</label>
                          <input
                            type="number"
                            value={rangeTo}
                            onChange={(e) => setRangeTo(parseInt(e.target.value, 10) || 110)}
                            className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                          className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-bold text-xs focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                          className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-stone-600 font-semibold mb-1">Toilet Type</label>
                      <select
                        value={batchToiletType}
                        onChange={(e) => setBatchToiletType(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
                        className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 font-bold focus:ring-1 focus:ring-[#124E39]"
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
              <div className="bg-[#FAF7F2] p-3 rounded-xl border border-[#E6DFD5] space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-stone-800">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>Live Preview of Rooms to be Added:</span>
                  </span>
                  <span className="text-[#124E39] bg-emerald-100 px-2.5 py-0.5 rounded-full font-mono">
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
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-50 text-[#EBD59E] shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save {previewManualRooms.length} Room(s) to Inventory</span>
                </button>
              </div>

            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: SYNC FROM GOOGLE SHEET                                */}
          {/* ============================================================ */}
          {activeTab === 'sheet' && (
            <div className="space-y-4">
              {/* Google Sheet Sync Explainer */}
              <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-950 shadow-2xs">
                <div>
                  <div className="flex items-center gap-2 font-bold text-sm text-[#124E39]">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                    <span>Sync Hotel Buildings & Rooms from Google Sheets</span>
                  </div>
                  <p className="text-xs text-emerald-800/80 mt-0.5">
                    Paste your Google Sheet link or ID. The sheet can have multiple buildings and rooms with capacities, floors, and toilet specs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFormatGuide(!showFormatGuide)}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-emerald-900 border border-emerald-300 shadow-2xs hover:bg-emerald-100 transition whitespace-nowrap cursor-pointer"
                >
                  {showFormatGuide ? 'Hide Column Guide' : 'View Expected Columns'}
                </button>
              </div>

              {/* Format Guide Dropdown */}
              {showFormatGuide && (
                <div className="bg-white p-3.5 rounded-xl border border-stone-300 shadow-xs text-xs space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between font-bold text-stone-800 flex-wrap gap-2">
                    <span>Expected Columns in your Google Sheet:</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopySample}
                        className="flex items-center gap-1 text-[11px] font-bold text-[#124E39] hover:text-[#0E3C2C] bg-stone-100 hover:bg-stone-200 px-2 py-1 rounded transition cursor-pointer"
                      >
                        {copiedSample ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedSample ? 'Copied CSV!' : 'Copy Sample CSV'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadSampleCsv}
                        className="flex items-center gap-1 text-[11px] font-bold text-emerald-800 hover:text-emerald-950 bg-emerald-100/70 hover:bg-emerald-200/80 px-2 py-1 rounded transition cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Download CSV Template</span>
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-stone-200 rounded-lg">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead className="bg-stone-100 text-stone-700 font-bold">
                        <tr>
                          <th className="p-1.5 border-b">Building</th>
                          <th className="p-1.5 border-b">Room</th>
                          <th className="p-1.5 border-b">Floor</th>
                          <th className="p-1.5 border-b">Capacity</th>
                          <th className="p-1.5 border-b">Buffer</th>
                          <th className="p-1.5 border-b">Toilet Type</th>
                          <th className="p-1.5 border-b">Bed Type</th>
                          <th className="p-1.5 border-b">Category</th>
                          <th className="p-1.5 border-b">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 text-stone-600 font-mono text-[10px]">
                        <tr>
                          <td className="p-1.5 font-bold text-stone-900">Saifee</td>
                          <td className="p-1.5 font-bold">101</td>
                          <td className="p-1.5">1</td>
                          <td className="p-1.5">3</td>
                          <td className="p-1.5">0</td>
                          <td className="p-1.5">Western Toilet</td>
                          <td className="p-1.5">Single Beds</td>
                          <td className="p-1.5">Category B (Standard)</td>
                          <td className="p-1.5 text-emerald-700 font-bold">available</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 font-bold text-stone-900">Burhani</td>
                          <td className="p-1.5 font-bold">201</td>
                          <td className="p-1.5">2</td>
                          <td className="p-1.5">4</td>
                          <td className="p-1.5">1</td>
                          <td className="p-1.5">Indian Toilet</td>
                          <td className="p-1.5">Double & Single Bed</td>
                          <td className="p-1.5">Category A (Nizaam)</td>
                          <td className="p-1.5 text-emerald-700 font-bold">available</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 font-bold text-stone-900">Najaf Grand</td>
                          <td className="p-1.5 font-bold">301</td>
                          <td className="p-1.5">3</td>
                          <td className="p-1.5">2</td>
                          <td className="p-1.5">0</td>
                          <td className="p-1.5">Western Toilet</td>
                          <td className="p-1.5">Double Bed</td>
                          <td className="p-1.5">Executive Suite</td>
                          <td className="p-1.5 text-emerald-700 font-bold">available</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-stone-500">
                    * Make sure your Google Sheet sharing setting is set to: <strong>"Anyone with the link can view"</strong>.
                  </p>
                </div>
              )}

              {/* Input for Sheet URL */}
              <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-3">
                {sheetsConfig?.spreadsheetId && (
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span className="text-emerald-950 font-bold truncate">
                        Linked Spreadsheet: {sheetsConfig.spreadsheetName || sheetsConfig.spreadsheetId}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const url = sheetsConfig.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheetsConfig.spreadsheetId}/edit`;
                        setSheetUrlInput(url);
                      }}
                      className="px-2.5 py-1 rounded bg-[#124E39] text-[#EBD59E] font-bold text-[11px] hover:bg-[#0E3C2C] transition shrink-0 cursor-pointer shadow-2xs"
                    >
                      Use Connected Sheet
                    </button>
                  </div>
                )}

                <label className="block text-xs font-bold text-stone-800">
                  Google Sheet Link or Spreadsheet ID:
                </label>
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <input
                    type="text"
                    value={sheetUrlInput}
                    onChange={(e) => setSheetUrlInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit..."
                    className="w-full px-3.5 py-2 rounded-xl border border-stone-300 text-xs font-mono font-medium focus:ring-2 focus:ring-[#124E39] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleFetchRoomsFromSheet}
                    disabled={isFetchingSheet}
                    className="w-full sm:w-auto px-5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-50 text-[#EBD59E] shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {isFetchingSheet ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-[#EBD59E]" />
                    )}
                    <span>{isFetchingSheet ? 'Fetching...' : 'Fetch & Preview Rooms'}</span>
                  </button>
                </div>

                {sheetError && (
                  <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>{sheetError}</div>
                  </div>
                )}
              </div>

              {/* Preview of Parsed Rooms from Google Sheet */}
              {parsedSheetRooms && (
                <div className="bg-white p-4 rounded-xl border border-stone-300 shadow-xs space-y-3 animate-in fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-stone-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="font-bold text-xs text-stone-900">
                        Parsed from Google Sheet: <strong className="text-[#124E39]">{parsedSheetRooms.length} Rooms</strong>
                      </span>
                      <span className="text-[11px] font-semibold text-stone-500">
                        across {Array.from(new Set(parsedSheetRooms.map((r) => r.building))).length} Building(s):{' '}
                        {Array.from(new Set(parsedSheetRooms.map((r) => r.building))).join(', ')}
                      </span>
                    </div>

                    {/* Import Mode: Merge or Replace */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-stone-500 font-semibold">Mode:</span>
                      <select
                        value={sheetImportMode}
                        onChange={(e) => setSheetImportMode(e.target.value as any)}
                        className="px-2 py-1 rounded-lg border border-stone-300 text-xs font-bold bg-stone-50 text-stone-800"
                      >
                        <option value="merge">Merge & Add New Rooms</option>
                        <option value="replace">Replace Entire Inventory</option>
                      </select>
                    </div>
                  </div>

                  {/* Room Preview Table */}
                  <div className="max-h-60 overflow-y-auto border border-stone-200 rounded-lg">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold sticky top-0">
                        <tr>
                          <th className="py-2 px-2.5">Building</th>
                          <th className="py-2 px-2.5">Room #</th>
                          <th className="py-2 px-2.5">Floor</th>
                          <th className="py-2 px-2.5">Capacity</th>
                          <th className="py-2 px-2.5">Buffer</th>
                          <th className="py-2 px-2.5">Toilet Type</th>
                          <th className="py-2 px-2.5">Bed Type</th>
                          <th className="py-2 px-2.5">Category</th>
                          <th className="py-2 px-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">
                        {parsedSheetRooms.map((rm) => {
                          const isExisting = existingRooms.some(
                            (er) => er.roomNumber === rm.roomNumber && er.building.toLowerCase() === rm.building.toLowerCase()
                          );
                          return (
                            <tr key={rm.id} className="hover:bg-stone-50">
                              <td className="py-1.5 px-2.5 font-bold text-stone-900">
                                {rm.building}
                              </td>
                              <td className="py-1.5 px-2.5 font-mono font-black text-[#124E39]">
                                Room {rm.roomNumber}
                              </td>
                              <td className="py-1.5 px-2.5 text-stone-600">
                                Fl {rm.floor}
                              </td>
                              <td className="py-1.5 px-2.5 font-bold text-stone-800">
                                {rm.capacity} Pax
                              </td>
                              <td className="py-1.5 px-2.5 text-stone-600">
                                +{rm.buffer || 0}
                              </td>
                              <td className="py-1.5 px-2.5 text-stone-700">
                                {rm.toiletType}
                              </td>
                              <td className="py-1.5 px-2.5 text-stone-700">
                                {rm.bedType}
                              </td>
                              <td className="py-1.5 px-2.5 text-stone-800">
                                {rm.category}
                              </td>
                              <td className="py-1.5 px-2.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  rm.status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                                }`}>
                                  {rm.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Confirm Sync Button */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
                    <button
                      type="button"
                      onClick={() => setParsedSheetRooms(null)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 transition cursor-pointer"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmSheetSync}
                      className="px-5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4 text-[#EBD59E]" />
                      <span>Confirm & Sync {parsedSheetRooms.length} Rooms to Inventory</span>
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

      </div>
    </div>
  );
};
