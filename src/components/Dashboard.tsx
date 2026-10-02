import React, { useState, useMemo, useEffect } from 'react';
import { 
  Building2, 
  BedDouble, 
  Users, 
  CheckCircle2, 
  Clock, 
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  Printer,
  Upload,
  Download,
  Filter,
  ArrowRight,
  ShieldAlert,
  Info,
  ChevronRight,
  ChevronDown,
  Lock,
  Unlock,
  CheckSquare,
  Sparkles,
  Trash2,
  X,
  ArrowUpRight,
  RefreshCw,
  Search,
  Plus
} from 'lucide-react';
import { Reservation, Room, UserRole, GoogleSheetsConfig } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import { getRoomStatusOnDate, getRoomBookingOnDate, getVacantRoomsForDuration } from '../services/storage';
import { RoomTimelineView } from './RoomTimelineView';

interface DashboardProps {
  reservations: Reservation[];
  rooms: Room[];
  onNavigateTab: (tab: 'dashboard' | 'reservations' | 'upgrades' | 'rooms') => void;
  onOpenUploadExcel: () => void;
  onOpenReceptionSlip: () => void;
  onOpenAddZaer?: () => void;
  onOpenAddTourGroup?: () => void;
  onDownloadTemplate: () => void;
  onAllotRoom: (reservationId: string, building: string, roomNumber: string) => void;
  onBatchAllotFamily?: (tourRefNo: string, family: string, building: string, roomNumber: string) => void;
  onDeleteReservation?: (id: string) => void;
  onToggleBlockRoom?: (roomId: string) => void;
  userRole?: UserRole;
  onOpenQuickAllotModal?: (res: Reservation) => void;
  sheetsConfig?: GoogleSheetsConfig;
  onOpenSheetsModal?: () => void;
  onOpenGoogleSheet?: () => void;
  onQuickSync?: () => void;
  isLiveBackendConnected?: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  reservations,
  rooms,
  onNavigateTab,
  onOpenUploadExcel,
  onOpenReceptionSlip,
  onOpenAddZaer,
  onOpenAddTourGroup,
  onDownloadTemplate,
  onAllotRoom,
  onBatchAllotFamily,
  onDeleteReservation,
  onToggleBlockRoom,
  userRole = 'admin',
  onOpenQuickAllotModal,
  sheetsConfig,
  onOpenSheetsModal,
  onOpenGoogleSheet,
  onQuickSync,
  isLiveBackendConnected = true,
}) => {
  // Rooms View Mode: 'timeline' (Top Dates & Horizontal Rooms) vs 'buttons' (Compact Matrix)
  const [roomsViewMode, setRoomsViewMode] = useState<'timeline' | 'buttons'>('timeline');
  // Deleting record confirmation state
  const [recordToDelete, setRecordToDelete] = useState<Reservation | null>(null);
  // Date selector for room availability view (defaults to today)
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Hotel selector: 'ALL' | 'Saifee' | 'Burhani'
  const [selectedHotel, setSelectedHotel] = useState<'ALL' | 'Saifee' | 'Burhani'>('ALL');
  // Filter for room buttons: 'all' | 'available' | 'occupied' | 'blocked'
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'occupied' | 'blocked'>('all');

  // Selected room for popup/drawer inspector
  const [inspectedRoom, setInspectedRoom] = useState<Room | null>(null);

  // Target Zaer to allot when in inspection popup
  const [allotTargetZaerId, setAllotTargetZaerId] = useState<string>('');

  // Unallotted zaereen who need rooms
  const unallottedZaereen = reservations.filter((r) => !r.roomNumber || r.roomNumber.trim() === '');

  // Search & filter state for Tour & Family Room Allotment Overview
  const [tourSearchQuery, setTourSearchQuery] = useState<string>('');
  const [tourArrivalDateFilter, setTourArrivalDateFilter] = useState<string>('');

  // Rich summaries for each tour (Zaereen count, families count, arrival dates)
  const tourSummaries = useMemo(() => {
    const map = new Map<string, {
      tourId: string;
      totalZaereen: number;
      familiesSet: Set<string>;
      arrivalDatesSet: Set<string>;
      earliestArrival: string;
      latestArrival: string;
    }>();

    reservations.forEach((r) => {
      const tid = (r.tourRefNo || '').trim();
      if (!tid) return;

      if (!map.has(tid)) {
        map.set(tid, {
          tourId: tid,
          totalZaereen: 0,
          familiesSet: new Set(),
          arrivalDatesSet: new Set(),
          earliestArrival: '',
          latestArrival: '',
        });
      }

      const item = map.get(tid)!;
      item.totalZaereen += 1;
      if (r.family) item.familiesSet.add(r.family.trim());
      const arr = (r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr || '').slice(0, 10);
      if (arr && arr.length >= 8) {
        item.arrivalDatesSet.add(arr);
        if (!item.earliestArrival || arr < item.earliestArrival) {
          item.earliestArrival = arr;
        }
        if (!item.latestArrival || arr > item.latestArrival) {
          item.latestArrival = arr;
        }
      }
    });

    return Array.from(map.values())
      .map((item) => ({
        tourId: item.tourId,
        totalZaereen: item.totalZaereen,
        familiesCount: item.familiesSet.size,
        arrivalDates: Array.from(item.arrivalDatesSet).sort(),
        primaryArrivalDate: item.earliestArrival,
      }))
      .sort((a, b) => a.tourId.localeCompare(b.tourId));
  }, [reservations]);

  // Distinct Tour IDs from all reservations
  const distinctTourIds = useMemo(() => {
    return tourSummaries.map((t) => t.tourId);
  }, [tourSummaries]);

  // Filtered tours matching search by Tour ID AND/OR Arrival Date
  const filteredTourSummaries = useMemo(() => {
    return tourSummaries.filter((t) => {
      // 1. Tour ID search query (case-insensitive substring match)
      if (tourSearchQuery.trim()) {
        const q = tourSearchQuery.trim().toLowerCase();
        if (!t.tourId.toLowerCase().includes(q)) {
          return false;
        }
      }

      // 2. Arrival Date filter (checks if any Zaer in this tour arrives on or starts with the selected date)
      if (tourArrivalDateFilter.trim()) {
        const targetDate = tourArrivalDateFilter.trim();
        const hasDate = t.arrivalDates.some((d) => d.startsWith(targetDate) || targetDate.startsWith(d));
        if (!hasDate) {
          return false;
        }
      }

      return true;
    });
  }, [tourSummaries, tourSearchQuery, tourArrivalDateFilter]);

  // Selected Tour ID for the Overview Family Allotment section
  const [dashTourId, setDashTourId] = useState<string>('');

  useEffect(() => {
    // Keep selected tour in sync with search and filter results
    if (filteredTourSummaries.length > 0) {
      const isCurrentInFiltered = filteredTourSummaries.some((t) => t.tourId === dashTourId);
      if (!isCurrentInFiltered) {
        setDashTourId(filteredTourSummaries[0].tourId);
      }
    } else if (tourSummaries.length > 0 && !tourSearchQuery && !tourArrivalDateFilter) {
      if (!dashTourId) {
        setDashTourId(tourSummaries[0].tourId);
      }
    }
  }, [filteredTourSummaries, dashTourId, tourSummaries, tourSearchQuery, tourArrivalDateFilter]);

  // Inspect drawer allotment state
  const [inspectAllotMode, setInspectAllotMode] = useState<'family' | 'individual'>('family');
  const [inspectTourId, setInspectTourId] = useState<string>('');
  const [inspectFamily, setInspectFamily] = useState<string>('');

  // Overview per-family custom drafts: { [fam: string]: { building: string; roomNumber: string } }
  const [familyDrafts, setFamilyDrafts] = useState<{ [fam: string]: { building: string; roomNumber: string } }>({});
  // Expanded family accordion in overview
  const [expandedFamilies, setExpandedFamilies] = useState<{ [fam: string]: boolean }>({});

  const toggleExpandFamily = (fam: string) => {
    setExpandedFamilies((prev) => ({ ...prev, [fam]: !prev[fam] }));
  };

  // Group reservations of selected tour by family
  const currentTourId = dashTourId || (distinctTourIds[0] || '');
  const familiesInTour = useMemo(() => {
    if (!currentTourId) return [];
    const tourRes = reservations.filter((r) => r.tourRefNo === currentTourId);
    const famMap: { [fam: string]: Reservation[] } = {};
    tourRes.forEach((r) => {
      const fam = (r.family || 'Unassigned').trim();
      if (!famMap[fam]) famMap[fam] = [];
      famMap[fam].push(r);
    });

    return Object.entries(famMap).map(([fam, members]) => {
      const allottedCount = members.filter((m) => m.roomNumber && m.roomNumber.trim() !== '').length;
      return {
        family: fam,
        members,
        totalCount: members.length,
        allottedCount,
        isFullyAllotted: allottedCount === members.length && members.length > 0,
        arrivalDate: members[0]?.arrivalDate || todayStr,
        departureDate: members[0]?.departureDate || todayStr,
        commonBuilding: members[0]?.building || 'Saifee',
        commonRoom: members[0]?.roomNumber || '',
      };
    });
  }, [reservations, currentTourId, todayStr]);

  // Dynamic room statistics on the selected date
  const filteredRooms = rooms.filter((r) => {
    if (selectedHotel !== 'ALL' && r.building !== selectedHotel) return false;
    return true;
  });

  let vacantCount = 0;
  let occupiedCount = 0;
  let blockedCount = 0;

  filteredRooms.forEach((r) => {
    const st = getRoomStatusOnDate(r, selectedDate, reservations);
    if (st === 'blocked') blockedCount++;
    else if (st === 'occupied') occupiedCount++;
    else vacantCount++;
  });

  // Overall counts
  const totalZaereen = reservations.length;
  const bToACount = reservations.filter((r) => r.category === 'B to A' || r.shiftToCategoryA).length;
  const bToAPaidCount = reservations.filter((r) => (r.category === 'B to A' || r.shiftToCategoryA) && r.moneyGiven === 'Yes').length;
  const uploadedCount = reservations.filter((r) => r.isUploadedToPortal).length;

  // Arrivals and departures on selected date
  const arrivalsOnDate = reservations.filter(
    (r) => (r.arrivalDate || r.arrivalDateTime || '').slice(0, 10) === selectedDate
  );
  const departuresOnDate = reservations.filter(
    (r) => (r.departureDate || r.departureDateTime || '').slice(0, 10) === selectedDate
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner / Hero - Beige & Deep Green */}
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <FaizHusainiLogo size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                Accommodation Operations
              </span>
              <span className="text-xs text-stone-500 hidden sm:inline">
                Saifee & Burhani Hotels (114 Rooms)
              </span>
            </div>
            <p className="text-xs text-stone-600 mt-1 max-w-xl">
              Minimalist room occupancy overview, daily reception manager departure slips, Excel batch allocation, and B ➔ A shift requests.
            </p>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {onOpenAddZaer && (
            <button
              onClick={onOpenAddZaer}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm transition cursor-pointer"
              title="Manually add all details of a Zair with duplicate check"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Zair</span>
            </button>
          )}

          {onOpenAddTourGroup && (
            <button
              onClick={onOpenAddTourGroup}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] border border-[#C5A059]/40 shadow-sm transition cursor-pointer"
              title="Add a Tour ID with different family IDs and multiple individuals with same arrival and departure dates"
            >
              <Users className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>Add Tour Group</span>
            </button>
          )}

          <button
            onClick={onOpenUploadExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-sm transition"
          >
            <Upload className="w-3.5 h-3.5 text-[#EBD59E]" />
            <span>Upload Excel</span>
          </button>

          <button
            onClick={onOpenReceptionSlip}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-stone-50 text-[#124E39] border border-[#124E39]/30 shadow-sm transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Reception Daily Slip</span>
          </button>

          <button
            onClick={onDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 transition"
            title="Download sample Excel template with required columns"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Template</span>
          </button>
        </div>
      </div>

      {/* GOOGLE SHEETS & LIVE BACKEND REAL-TIME SYNC BAR (User Request: "syced with rooms Availability & Departure Timeline, live website with backhand data until delted") */}
      <div className="bg-white border border-[#E6DFD5] rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100/90 text-emerald-900 flex items-center justify-center shrink-0 border border-emerald-300 shadow-2xs">
            <FileSpreadsheet className="w-5 h-5 text-emerald-800" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-bold text-stone-900">
                {sheetsConfig?.spreadsheetName ? `Google Sheet: ${sheetsConfig.spreadsheetName}` : 'Google Sheets Two-Way Synchronization'}
              </h4>
              {isLiveBackendConnected && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-950 border border-emerald-300 text-[10px] font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                  Live Backend Persistent Data
                </span>
              )}
            </div>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Synced with <strong>Rooms Availability & Departure Timeline</strong>, Zaereen Allotments, 114 Rooms & Accounts Slips. Data remains on backend until deleted.
              {sheetsConfig?.lastSyncedAt && (
                <span className="ml-2 font-medium text-emerald-800">
                  • Last Synced: {new Date(sheetsConfig.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          {sheetsConfig?.spreadsheetId ? (
            <>
              {/* Access Google Sheet in New Tab */}
              <button
                onClick={onOpenGoogleSheet || onOpenSheetsModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border border-emerald-300 shadow-2xs transition cursor-pointer"
                title="Open Google Sheet in new browser tab"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-800" />
                <span>Open Google Sheet</span>
                <ArrowUpRight className="w-3 h-3 text-emerald-700" />
              </button>

              {/* 1-Click Sync */}
              <button
                onClick={onQuickSync}
                disabled={sheetsConfig?.isSyncing}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ${
                  sheetsConfig?.isSyncing
                    ? 'bg-amber-100 text-amber-950 border border-amber-300 animate-pulse'
                    : 'bg-[#124E39] hover:bg-[#0E3C2C] text-white'
                }`}
                title="One-Click Two-Way Sync: Updates Google Sheet and App with Latest Changes"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#EBD59E] ${sheetsConfig?.isSyncing ? 'animate-spin' : ''}`} />
                <span>{sheetsConfig?.isSyncing ? 'Syncing...' : '1-Click Sync'}</span>
              </button>
            </>
          ) : (
            <button
              onClick={onOpenSheetsModal}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>Connect Google Sheet</span>
            </button>
          )}

          {onOpenSheetsModal && (
            <button
              onClick={onOpenSheetsModal}
              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition cursor-pointer"
              title="Sheet settings & configuration"
            >
              <Filter className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Summary Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Zaereen */}
        <div className="bg-white p-3.5 rounded-xl border border-[#E6DFD5] shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-[11px] font-semibold">
            <span>Total Zaereen</span>
            <Users className="w-3.5 h-3.5 text-stone-400" />
          </div>
          <div className="mt-1 text-xl font-bold text-stone-900">{totalZaereen}</div>
          <div className="text-[10px] text-stone-500 mt-0.5">
            {unallottedZaereen.length} unallotted
          </div>
        </div>

        {/* Vacant Rooms */}
        <div className="bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-200 shadow-xs">
          <div className="flex items-center justify-between text-emerald-800 text-[11px] font-semibold">
            <span>Vacant (On Date)</span>
            <BedDouble className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-800">{vacantCount}</div>
          <div className="text-[10px] text-emerald-700 mt-0.5">
            Ready to allot
          </div>
        </div>

        {/* Occupied Rooms */}
        <div className="bg-amber-50/60 p-3.5 rounded-xl border border-amber-200 shadow-xs">
          <div className="flex items-center justify-between text-amber-800 text-[11px] font-semibold">
            <span>Occupied (On Date)</span>
            <Building2 className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-amber-800">{occupiedCount}</div>
          <div className="text-[10px] text-amber-700 mt-0.5">
            In-house zaereen
          </div>
        </div>

        {/* Blocked Rooms */}
        <div className="bg-stone-100 p-3.5 rounded-xl border border-stone-300 shadow-xs">
          <div className="flex items-center justify-between text-stone-700 text-[11px] font-semibold">
            <span>Blocked Inventory</span>
            <ShieldAlert className="w-3.5 h-3.5 text-stone-500" />
          </div>
          <div className="mt-1 text-xl font-bold text-stone-800">{blockedCount}</div>
          <div className="text-[10px] text-stone-500 mt-0.5">
            Maintenance / VIP
          </div>
        </div>

        {/* B to A Shifts */}
        <div className="bg-white p-3.5 rounded-xl border border-[#E6DFD5] shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-[11px] font-semibold">
            <span>B ➔ A Shifts</span>
            <span className="text-[10px] font-bold text-[#124E39]">Nizaam</span>
          </div>
          <div className="mt-1 text-xl font-bold text-[#124E39]">{bToACount}</div>
          <div className="text-[10px] text-stone-500 mt-0.5">
            {bToAPaidCount} paid • {bToACount - bToAPaidCount} pending
          </div>
        </div>

        {/* Uploaded to Portal */}
        <div className="bg-white p-3.5 rounded-xl border border-[#E6DFD5] shadow-xs">
          <div className="flex items-center justify-between text-stone-500 text-[11px] font-semibold">
            <span>Main Portal Upload</span>
            <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-stone-900">
            {uploadedCount} <span className="text-xs text-stone-500 font-normal">/ {totalZaereen}</span>
          </div>
          <div className="text-[10px] text-emerald-700 font-medium mt-0.5">
            {totalZaereen > 0 ? Math.round((uploadedCount / totalZaereen) * 100) : 0}% synced
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* DASHBOARD TOUR & FAMILY ROOM ALLOTMENT OVERVIEW                           */}
      {/* "the dasborad and overview I should be able to allot to family members     */}
      {/* for respective tour IDs"                                                  */}
      {/* ========================================================================= */}
      <div className="bg-white border border-[#E6DFD5] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="space-y-3 pb-3 border-b border-stone-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1 rounded bg-[#124E39] text-[#EBD59E]">
                  <Users className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-[#124E39] tracking-tight">
                  Tour & Family Room Allotment Overview
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-950 border border-emerald-300">
                  1-Click Family Allocation
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-1">
                Search by Tour ID or Arrival Date to review family clusters and allot rooms to whole families in one go.
              </p>
            </div>

            {/* Tour count indicator & Reset button */}
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {onOpenAddTourGroup && (
                <button
                  type="button"
                  onClick={onOpenAddTourGroup}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-2xs transition cursor-pointer"
                  title="Add a Tour ID with multiple individuals across different family IDs"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>+ Add Tour Group</span>
                </button>
              )}

              {tourSummaries.length > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-stone-100 border border-stone-200 text-stone-600 font-semibold">
                  {filteredTourSummaries.length} of {tourSummaries.length} Tours
                </span>
              )}
              {(tourSearchQuery || tourArrivalDateFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setTourSearchQuery('');
                    setTourArrivalDateFilter('');
                  }}
                  className="text-xs text-[#124E39] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                  title="Reset search and date filters"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reset Search</span>
                </button>
              )}
            </div>
          </div>

          {/* Search Controls: Tour ID Search, Arrival Date Filter, Tour Dropdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 pt-1">
            {/* 1. Search by Tour ID */}
            <div className="lg:col-span-4 relative flex items-center">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search Tour ID (e.g. 101, T-2...)"
                value={tourSearchQuery}
                onChange={(e) => setTourSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 bg-[#FAF7F2] border border-[#124E39]/30 rounded-xl text-xs font-mono font-bold text-[#124E39] placeholder:text-stone-400 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-[#124E39] shadow-2xs"
              />
              {tourSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTourSearchQuery('')}
                  className="absolute right-2 text-stone-400 hover:text-stone-700 p-0.5 cursor-pointer"
                  title="Clear Tour ID search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 2. Filter by Arrival Date */}
            <div className="lg:col-span-3 flex items-center gap-1.5 bg-[#FAF7F2] border border-[#124E39]/30 rounded-xl px-2.5 py-1.5 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-[#124E39] shrink-0" />
              <span className="text-[11px] font-bold text-stone-600 shrink-0">Arrival:</span>
              <input
                type="date"
                value={tourArrivalDateFilter}
                onChange={(e) => setTourArrivalDateFilter(e.target.value)}
                className="bg-transparent text-xs font-bold text-[#124E39] focus:outline-none cursor-pointer w-full"
                title="Filter tours arriving on date"
              />
              {tourArrivalDateFilter && (
                <button
                  type="button"
                  onClick={() => setTourArrivalDateFilter('')}
                  className="text-stone-400 hover:text-stone-700 p-0.5 shrink-0 cursor-pointer"
                  title="Clear arrival date filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 3. Tour Selection Dropdown */}
            <div className="lg:col-span-5 flex items-center gap-2">
              <span className="text-xs font-bold text-stone-700 shrink-0 hidden lg:inline">Tour:</span>
              <select
                value={currentTourId}
                onChange={(e) => setDashTourId(e.target.value)}
                className="w-full bg-[#FAF7F2] border border-[#124E39]/40 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-[#124E39] focus:outline-none focus:ring-1 focus:ring-[#124E39] cursor-pointer shadow-2xs truncate"
              >
                {filteredTourSummaries.length > 0 ? (
                  filteredTourSummaries.map((t) => (
                    <option key={t.tourId} value={t.tourId}>
                      {t.tourId} {t.primaryArrivalDate ? `• Arr: ${t.primaryArrivalDate}` : ''} ({t.totalZaereen} Zaereen{t.familiesCount > 0 ? `, ${t.familiesCount} Fam` : ''})
                    </option>
                  ))
                ) : (
                  <option value="">No tours found matching search</option>
                )}
              </select>
            </div>
          </div>

          {/* Quick matching tour pills if filtered with multiple matches */}
          {filteredTourSummaries.length > 1 && filteredTourSummaries.length <= 8 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pt-1">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider shrink-0">Matching Tours:</span>
              {filteredTourSummaries.map((t) => {
                const isSelected = t.tourId === currentTourId;
                return (
                  <button
                    key={t.tourId}
                    type="button"
                    onClick={() => setDashTourId(t.tourId)}
                    className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold transition shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-[#124E39] text-[#EBD59E] shadow-2xs'
                        : 'bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200'
                    }`}
                  >
                    <span>{t.tourId}</span>
                    {t.primaryArrivalDate && (
                      <span className="text-[10px] font-sans font-normal opacity-80 ml-1">
                        ({t.primaryArrivalDate.slice(5)})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Families list for the selected Tour ID */}
        {familiesInTour.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {familiesInTour.map((famItem) => {
              const currentBuilding = familyDrafts[famItem.family]?.building || famItem.commonBuilding || 'Saifee';
              const currentRoom = familyDrafts[famItem.family]?.roomNumber !== undefined
                ? familyDrafts[famItem.family]?.roomNumber
                : famItem.commonRoom;

              // Get vacant rooms for this family's duration
              const memberIds = new Set(famItem.members.map((m) => m.id));
              const vacantRoomsForFam = getVacantRoomsForDuration(
                currentBuilding,
                famItem.arrivalDate,
                famItem.departureDate,
                rooms,
                reservations.filter((r) => !memberIds.has(r.id))
              );

              const isExpanded = !!expandedFamilies[famItem.family];

              return (
                <div
                  key={famItem.family}
                  className={`p-4 rounded-xl border transition shadow-2xs ${
                    famItem.isFullyAllotted
                      ? 'bg-[#FAF7F2]/60 border-emerald-300'
                      : 'bg-white border-amber-300/80 ring-1 ring-amber-200'
                  }`}
                >
                  {/* Family Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-sm text-[#124E39]">
                          Family {famItem.family}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-950 font-bold">
                          {famItem.totalCount} Members
                        </span>
                        {famItem.isFullyAllotted ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-700 text-white font-extrabold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Room {famItem.commonRoom} ({famItem.commonBuilding})</span>
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                            {famItem.allottedCount}/{famItem.totalCount} Allotted
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-stone-500 mt-1">
                        Stay: <strong>{famItem.arrivalDate}</strong> to <strong>{famItem.departureDate}</strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleExpandFamily(famItem.family)}
                      className="text-stone-500 hover:text-stone-900 text-xs font-semibold flex items-center gap-1 p-1 rounded hover:bg-stone-100 cursor-pointer"
                    >
                      <span>{isExpanded ? 'Hide' : 'Edit Members'}</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Summary of members names */}
                  <div className="text-xs text-stone-700 font-medium mt-2 line-clamp-1">
                    Guests: {famItem.members.map((m) => `${m.applicantName} (${m.age})`).join(', ')}
                  </div>

                  {/* 1-Click Allotment Controls */}
                  <div className="mt-3 pt-3 border-t border-stone-200/80 flex flex-wrap items-center gap-2">
                    <select
                      value={currentBuilding}
                      onChange={(e) => {
                        const newB = e.target.value;
                        setFamilyDrafts((prev) => ({
                          ...prev,
                          [famItem.family]: { building: newB, roomNumber: '' },
                        }));
                      }}
                      className="bg-[#FAF7F2] border border-stone-300 rounded-lg px-2 py-1 text-xs font-bold text-[#124E39] focus:outline-none cursor-pointer"
                    >
                      <option value="Saifee">Saifee</option>
                      <option value="Burhani">Burhani</option>
                    </select>

                    <select
                      value={currentRoom}
                      onChange={(e) => {
                        const newR = e.target.value;
                        setFamilyDrafts((prev) => ({
                          ...prev,
                          [famItem.family]: { building: currentBuilding, roomNumber: newR },
                        }));
                      }}
                      className="flex-1 min-w-[130px] bg-white border border-emerald-300 rounded-lg px-2 py-1 text-xs font-bold text-stone-900 focus:outline-none cursor-pointer"
                    >
                      <option value="">-- Choose Vacant Room --</option>
                      {currentRoom && (
                        <option value={currentRoom}>
                          Room {currentRoom} ({currentBuilding}) ✓ Current
                        </option>
                      )}
                      {vacantRoomsForFam
                        .filter((rm) => rm.roomNumber !== currentRoom)
                        .map((rm) => (
                          <option key={rm.id} value={rm.roomNumber}>
                            Rm {rm.roomNumber} (Fl {rm.floor} • Cap {rm.capacity})
                          </option>
                        ))}
                    </select>

                    <button
                      type="button"
                      disabled={!currentRoom}
                      onClick={() => {
                        if (onBatchAllotFamily && currentRoom) {
                          onBatchAllotFamily(currentTourId, famItem.family, currentBuilding, currentRoom);
                        }
                      }}
                      className="px-3 py-1 bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-40 text-[#EBD59E] font-bold rounded-lg text-xs shadow-xs transition cursor-pointer"
                    >
                      Allot Family ({famItem.totalCount})
                    </button>

                    {famItem.allottedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (onBatchAllotFamily) {
                            onBatchAllotFamily(currentTourId, famItem.family, currentBuilding, '');
                          }
                        }}
                        className="px-2 py-1 bg-stone-200 hover:bg-stone-300 text-stone-700 font-semibold rounded-lg text-xs cursor-pointer"
                        title="Clear allotment for this entire family"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Individual Member List if expanded ("and if needed it should be editable") */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-stone-200 space-y-2 animate-in fade-in">
                      <div className="text-[11px] font-bold text-stone-600 uppercase">
                        Individual Family Members (Directly Editable):
                      </div>
                      <div className="space-y-1.5">
                        {famItem.members.map((m) => {
                          const vacantForMember = getVacantRoomsForDuration(
                            m.building || 'Saifee',
                            m.arrivalDate,
                            m.departureDate,
                            rooms,
                            reservations,
                            m.id
                          );
                          return (
                            <div
                              key={m.id}
                              className="flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded-lg bg-stone-50 border border-stone-200 gap-2 text-xs"
                            >
                              <div>
                                <div className="font-bold text-stone-900">
                                  {m.applicantName} <span className="font-mono text-stone-400 font-normal">({m.itsId})</span>
                                </div>
                                <div className="text-[10px] text-stone-500">
                                  Age: {m.age} • {m.gender} • Stay: {m.arrivalDate} to {m.departureDate}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <select
                                  value={m.building || 'Saifee'}
                                  onChange={(e) => {
                                    onAllotRoom(m.id, e.target.value, m.roomNumber || '');
                                  }}
                                  className="bg-white border border-stone-300 rounded px-1.5 py-0.5 text-xs font-bold text-[#124E39] cursor-pointer"
                                >
                                  <option value="Saifee">Saifee</option>
                                  <option value="Burhani">Burhani</option>
                                </select>

                                <select
                                  value={m.roomNumber || ''}
                                  onChange={(e) => {
                                    onAllotRoom(m.id, m.building || 'Saifee', e.target.value);
                                  }}
                                  className="bg-white border border-stone-300 rounded px-2 py-0.5 text-xs font-bold text-stone-900 cursor-pointer"
                                >
                                  <option value="">-- No Room --</option>
                                  {m.roomNumber && (
                                    <option value={m.roomNumber}>Rm {m.roomNumber} ✓</option>
                                  )}
                                  {vacantForMember
                                    .filter((rm) => rm.roomNumber !== m.roomNumber)
                                    .map((rm) => (
                                      <option key={rm.id} value={rm.roomNumber}>
                                        Rm {rm.roomNumber}
                                      </option>
                                    ))}
                                </select>

                                {onDeleteReservation && (
                                  <button
                                    type="button"
                                    onClick={() => setRecordToDelete(m)}
                                    className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                    title={`Delete zaer record for ${m.applicantName}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-10 text-center space-y-3">
            <div className="text-stone-500 font-semibold text-xs">
              {filteredTourSummaries.length === 0
                ? `No tours found matching ${tourSearchQuery ? `Tour ID "${tourSearchQuery}"` : ''}${tourSearchQuery && tourArrivalDateFilter ? ' and ' : ''}${tourArrivalDateFilter ? `Arrival Date "${tourArrivalDateFilter}"` : ''}.`
                : `No reservations found for the selected Tour ID ${currentTourId || ''}.`}
            </div>
            {(tourSearchQuery || tourArrivalDateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setTourSearchQuery('');
                  setTourArrivalDateFilter('');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#124E39] text-[#EBD59E] font-bold text-xs shadow-2xs hover:bg-[#0E3C2C] transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset Tour Search & Arrival Date</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* ROOMS TIMELINE & OVERVIEW SECTION                                         */}
      {/* "in Dashboard and overview I want timeline of rooms. as per arrival and   */}
      {/* departure. showing when the room will be vacant as per the date of       */}
      {/* departures. top row of dates and horizontal rooms"                        */}
      {/* ========================================================================= */}

      {/* View Mode Toggle: Timeline vs Compact Button Matrix */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF7F2] p-2.5 rounded-2xl border border-[#E6DFD5] shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-xl bg-[#124E39] text-[#EBD59E]">
            <Calendar className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-xs font-extrabold text-[#124E39] tracking-tight uppercase">
              Hotel Rooms Allotment & Turnover Overview
            </h3>
            <span className="text-[11px] text-stone-500">
              114 Rooms Inventory across Saifee (70) and Burhani (44)
            </span>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-white p-1 rounded-xl border border-[#E6DFD5] shadow-2xs text-xs font-bold">
          <button
            type="button"
            onClick={() => setRoomsViewMode('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              roomsViewMode === 'timeline'
                ? 'bg-[#124E39] text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-[#EBD59E]" />
            <span>Timeline View (Top Dates & Horizontal Rooms)</span>
          </button>

          <button
            type="button"
            onClick={() => setRoomsViewMode('buttons')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              roomsViewMode === 'buttons'
                ? 'bg-[#124E39] text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Compact Buttons Matrix</span>
          </button>
        </div>
      </div>

      {/* If Timeline View selected, render the dedicated RoomTimelineView */}
      {roomsViewMode === 'timeline' && (
        <RoomTimelineView
          rooms={rooms}
          reservations={reservations}
          onAllotRoom={onAllotRoom}
          onBatchAllotFamily={onBatchAllotFamily}
          userRole={userRole}
          onOpenReceptionSlip={onOpenReceptionSlip}
          onOpenQuickAllotModal={onOpenQuickAllotModal}
        />
      )}

      {/* Compact Room Buttons Matrix (Toggleable) */}
      {roomsViewMode === 'buttons' && (
      <div className="bg-white border border-[#E6DFD5] rounded-2xl p-5 shadow-sm space-y-4">
        {/* Section Header & Minimalist Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-stone-200">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#124E39]" />
              <h3 className="text-sm font-bold text-[#124E39] tracking-tight">
                Hotel Room Vacancy & Allocation Overview
              </h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-stone-100 text-stone-600">
                114 Rooms Inventory
              </span>
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Click any small button to inspect room status, view guest booking, or allot to waiting zaer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {/* Date Picker Control */}
            <div className="flex items-center gap-1.5 bg-[#FAF7F2] border border-[#E6DFD5] rounded-lg px-2.5 py-1.5 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-[#124E39]" />
              <span className="text-stone-600 font-medium">Date:</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent font-bold text-stone-800 focus:outline-none cursor-pointer"
              />
              <button
                type="button"
                onClick={() => setSelectedDate(todayStr)}
                className="text-[10px] ml-1 font-semibold text-[#124E39] hover:underline"
              >
                Today
              </button>
            </div>

            {/* Hotel Tabs */}
            <div className="flex items-center bg-stone-100 p-1 rounded-lg font-semibold">
              <button
                onClick={() => setSelectedHotel('ALL')}
                className={`px-2.5 py-1 rounded-md transition text-xs ${
                  selectedHotel === 'ALL'
                    ? 'bg-[#124E39] text-white shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                All (114)
              </button>
              <button
                onClick={() => setSelectedHotel('Burhani')}
                className={`px-2.5 py-1 rounded-md transition text-xs ${
                  selectedHotel === 'Burhani'
                    ? 'bg-[#124E39] text-white shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Burhani ({rooms.filter(r => r.building.toLowerCase() === 'burhani').length})
              </button>
              <button
                onClick={() => setSelectedHotel('Saifee')}
                className={`px-2.5 py-1 rounded-md transition text-xs ${
                  selectedHotel === 'Saifee'
                    ? 'bg-[#124E39] text-white shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Saifee ({rooms.filter(r => r.building.toLowerCase() === 'saifee').length})
              </button>
            </div>

            {/* Status Quick Filter */}
            <div className="flex items-center bg-stone-100 p-1 rounded-lg text-xs">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2 py-0.5 rounded transition ${statusFilter === 'all' ? 'bg-white font-bold text-stone-900 shadow-2xs' : 'text-stone-500'}`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter('available')}
                className={`px-2 py-0.5 rounded transition ${statusFilter === 'available' ? 'bg-emerald-700 font-bold text-white shadow-2xs' : 'text-stone-500'}`}
              >
                Vacant ({vacantCount})
              </button>
              <button
                onClick={() => setStatusFilter('occupied')}
                className={`px-2 py-0.5 rounded transition ${statusFilter === 'occupied' ? 'bg-amber-600 font-bold text-white shadow-2xs' : 'text-stone-500'}`}
              >
                Occupied ({occupiedCount})
              </button>
              <button
                onClick={() => setStatusFilter('blocked')}
                className={`px-2 py-0.5 rounded transition ${statusFilter === 'blocked' ? 'bg-stone-500 font-bold text-white shadow-2xs' : 'text-stone-500'}`}
              >
                Blocked ({blockedCount})
              </button>
            </div>
          </div>
        </div>

        {/* Legend Bar */}
        <div className="flex flex-wrap items-center gap-4 text-xs bg-[#FAF7F2] p-2.5 rounded-xl border border-[#E6DFD5]">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-emerald-700 text-white text-[9px] font-bold flex items-center justify-center">✓</span>
            <span className="font-semibold text-emerald-900">Green = Vacant ({vacantCount})</span>
            <span className="text-stone-500 text-[11px]">— Available for room allotment</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-amber-600 text-white text-[9px] font-bold flex items-center justify-center">●</span>
            <span className="font-semibold text-amber-900">Amber = Occupied ({occupiedCount})</span>
            <span className="text-stone-500 text-[11px]">— In use by Zaer</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-stone-400 text-white text-[9px] font-bold flex items-center justify-center">🔒</span>
            <span className="font-semibold text-stone-800">Gray = Blocked ({blockedCount})</span>
            <span className="text-stone-500 text-[11px]">— Maintenance or VIP hold</span>
          </div>
        </div>

        {/* Minimalist Button Matrix for Buildings */}
        <div className="space-y-6 pt-1">
          {/* BURHANI HOTEL BUTTON MATRIX (44 Rooms) */}
          {(selectedHotel === 'ALL' || selectedHotel === 'Burhani') && (
            <div className="p-3.5 rounded-xl bg-stone-50/60 border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-xs text-[#124E39]">
                  <Building2 className="w-4 h-4 text-[#124E39]" />
                  <span>BURHANI HOTEL (44 Rooms: Ground, Mezzanine, Floors 1 to 4)</span>
                </div>
                <span className="text-[11px] text-stone-500 font-semibold">
                  {rooms.filter(r => r.building.toLowerCase() === 'burhani' && getRoomStatusOnDate(r, selectedDate, reservations) === 'available').length} Vacant / {rooms.filter(r => r.building.toLowerCase() === 'burhani').length} Total
                </span>
              </div>

              {/* Burhani Floor Sections */}
              {[
                { label: 'Ground Fl', rooms: rooms.filter(r => r.building.toLowerCase() === 'burhani' && r.roomNumber.startsWith('G')) },
                { label: 'Mezzanine', rooms: rooms.filter(r => r.building.toLowerCase() === 'burhani' && r.roomNumber.startsWith('M')) },
                { label: 'Floor 1 (101-110)', rooms: rooms.filter(r => r.building.toLowerCase() === 'burhani' && r.floor === 1 && !r.roomNumber.startsWith('M')) },
                { label: 'Floor 2 (201-210)', rooms: rooms.filter(r => r.building.toLowerCase() === 'burhani' && r.floor === 2) },
                { label: 'Floor 3 (301-310)', rooms: rooms.filter(r => r.building.toLowerCase() === 'burhani' && r.floor === 3) },
                { label: 'Floor 4 (401-410)', rooms: rooms.filter(r => r.building.toLowerCase() === 'burhani' && r.floor === 4) },
              ].map((flGroup, idx) => {
                if (flGroup.rooms.length === 0) return null;
                const sortedRooms = [...flGroup.rooms].sort((a, b) => {
                  const numA = parseInt(a.roomNumber.replace(/\D/g, '')) || 0;
                  const numB = parseInt(b.roomNumber.replace(/\D/g, '')) || 0;
                  return numA - numB;
                });

                return (
                  <div key={`burhani-fl-${idx}`} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="w-28 text-[11px] font-bold text-stone-600 flex-shrink-0">
                      {flGroup.label}
                    </div>

                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {sortedRooms.map((room) => {
                        const status = getRoomStatusOnDate(room, selectedDate, reservations);
                        if (statusFilter !== 'all' && status !== statusFilter) return null;

                        const booking = getRoomBookingOnDate(room, selectedDate, reservations);

                        let btnBg = 'bg-emerald-700 hover:bg-emerald-800 text-white';
                        if (status === 'occupied') {
                          btnBg = 'bg-amber-600 hover:bg-amber-700 text-white';
                        } else if (status === 'blocked') {
                          btnBg = 'bg-stone-300 hover:bg-stone-400 text-stone-800 border border-stone-400';
                        }

                        return (
                          <button
                            key={room.id}
                            type="button"
                            onClick={() => setInspectedRoom(room)}
                            title={`Room ${room.roomNumber} (${room.building})\nPax: ${room.capacity}${room.buffer ? ` (+${room.buffer} Buffer)` : ''}\nToilet: ${room.toiletType}\nBed: ${room.bedType}\nStatus: ${status.toUpperCase()}\n${booking ? `Guest: ${booking.applicantName} (${booking.family})\nTour: ${booking.tourRefNo}` : ''}`}
                            className={`w-10 h-9 sm:w-11 sm:h-9 rounded-md text-[11px] font-bold flex flex-col items-center justify-center transition shadow-2xs cursor-pointer relative ${btnBg} ${
                              inspectedRoom?.id === room.id ? 'ring-2 ring-stone-900 ring-offset-1' : ''
                            }`}
                          >
                            <span>{room.roomNumber}</span>
                            {status === 'blocked' && (
                              <Lock className="w-2 h-2 text-stone-700 absolute bottom-0.5 right-0.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* SAIFEE HOTEL BUTTON MATRIX (70 Rooms) */}
          {(selectedHotel === 'ALL' || selectedHotel === 'Saifee') && (
            <div className="p-3.5 rounded-xl bg-stone-50/60 border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-xs text-[#124E39]">
                  <Building2 className="w-4 h-4 text-[#124E39]" />
                  <span>SAIFEE HOTEL (70 Rooms: Floors 1 to 7)</span>
                </div>
                <span className="text-[11px] text-stone-500 font-semibold">
                  {rooms.filter(r => r.building.toLowerCase() === 'saifee' && getRoomStatusOnDate(r, selectedDate, reservations) === 'available').length} Vacant / {rooms.filter(r => r.building.toLowerCase() === 'saifee').length} Total
                </span>
              </div>

              {/* Floors 1 through 7 */}
              {[1, 2, 3, 4, 5, 6, 7].map((fl) => {
                const floorRooms = rooms
                  .filter((r) => r.building.toLowerCase() === 'saifee' && r.floor === fl)
                  .sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber));

                if (floorRooms.length === 0) return null;

                return (
                  <div key={`saifee-fl-${fl}`} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="w-28 text-[11px] font-bold text-stone-600 flex-shrink-0">
                      Floor {fl} ({fl}01-{fl}10)
                    </div>

                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {floorRooms.map((room) => {
                        const status = getRoomStatusOnDate(room, selectedDate, reservations);
                        if (statusFilter !== 'all' && status !== statusFilter) return null;

                        const booking = getRoomBookingOnDate(room, selectedDate, reservations);

                        let btnBg = 'bg-emerald-700 hover:bg-emerald-800 text-white';
                        if (status === 'occupied') {
                          btnBg = 'bg-amber-600 hover:bg-amber-700 text-white';
                        } else if (status === 'blocked') {
                          btnBg = 'bg-stone-300 hover:bg-stone-400 text-stone-800 border border-stone-400';
                        }

                        return (
                          <button
                            key={room.id}
                            type="button"
                            onClick={() => setInspectedRoom(room)}
                            title={`Room ${room.roomNumber} (${room.building})\nPax: ${room.capacity}${room.buffer ? ` (+${room.buffer} Buffer)` : ''}\nToilet: ${room.toiletType}\nBed: ${room.bedType}\nStatus: ${status.toUpperCase()}\n${booking ? `Guest: ${booking.applicantName} (${booking.family})\nTour: ${booking.tourRefNo}` : ''}`}
                            className={`w-10 h-9 sm:w-11 sm:h-9 rounded-md text-[11px] font-bold flex flex-col items-center justify-center transition shadow-2xs cursor-pointer relative ${btnBg} ${
                              inspectedRoom?.id === room.id ? 'ring-2 ring-stone-900 ring-offset-1' : ''
                            }`}
                          >
                            <span>{room.roomNumber}</span>
                            {status === 'blocked' && (
                              <Lock className="w-2 h-2 text-stone-700 absolute bottom-0.5 right-0.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Room Inspection Panel */}
        {inspectedRoom && (
          <div className="mt-4 p-4 rounded-xl bg-[#FAF7F2] border border-[#124E39]/30 animate-in fade-in">
            <div className="flex items-center justify-between pb-2 border-b border-stone-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-sm text-[#124E39]">
                  {inspectedRoom.building} Hotel — Room {inspectedRoom.roomNumber}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-white text-stone-700 border border-stone-200 font-medium">
                  {inspectedRoom.floorLabel || `Floor ${inspectedRoom.floor}`} • Pax: {inspectedRoom.capacity}{inspectedRoom.buffer ? ` (+${inspectedRoom.buffer} Buffer)` : ''} • Toilet: {inspectedRoom.toiletType || 'Standard'} • Bed: {inspectedRoom.bedType || 'Single Beds'} • {inspectedRoom.category}
                </span>
              </div>
              <button
                onClick={() => setInspectedRoom(null)}
                className="text-stone-400 hover:text-stone-700 text-xs font-semibold cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-xs">
              <div>
                <div className="text-stone-500 font-semibold mb-1">Status on {selectedDate}:</div>
                {(() => {
                  const status = getRoomStatusOnDate(inspectedRoom, selectedDate, reservations);
                  const booking = getRoomBookingOnDate(inspectedRoom, selectedDate, reservations);

                  if (status === 'blocked') {
                    return (
                      <div className="p-2.5 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 space-y-1">
                        <div className="font-bold flex items-center gap-1.5 text-stone-900">
                          <Lock className="w-3.5 h-3.5" />
                          <span>BLOCKED INVENTORY</span>
                        </div>
                        <div className="text-[11px] text-stone-600">
                          {inspectedRoom.blockedReason || 'Maintenance buffer'}
                        </div>
                        {onToggleBlockRoom && (
                          <button
                            type="button"
                            onClick={() => onToggleBlockRoom(inspectedRoom.id)}
                            className="mt-1 px-2.5 py-1 rounded bg-stone-800 text-white text-[10px] font-bold hover:bg-stone-900"
                          >
                            Unblock Room
                          </button>
                        )}
                      </div>
                    );
                  }

                  if (status === 'occupied' && booking) {
                    return (
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 space-y-1.5">
                        <div className="font-bold flex items-center justify-between text-amber-950">
                          <span>OCCUPIED BY ZAER</span>
                          {onDeleteReservation && (
                            <button
                              type="button"
                              onClick={() => setRecordToDelete(booking)}
                              className="text-xs text-red-600 hover:text-red-700 hover:bg-red-100/70 px-2 py-0.5 rounded font-bold flex items-center gap-1 transition"
                              title="Delete this Zair record"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Delete Record</span>
                            </button>
                          )}
                        </div>
                        <div className="text-[11px]">
                          <strong>Applicant:</strong> {booking.applicantName} ({booking.gender}, {booking.age} yrs)
                        </div>
                        <div className="text-[11px]">
                          <strong>Family:</strong> {booking.family} • <strong>ITS:</strong> {booking.itsId}
                        </div>
                        <div className="text-[11px]">
                          <strong>Tour Ref:</strong> {booking.tourRefNo} • <strong>Office:</strong> {booking.officeName}
                        </div>
                        <div className="text-[11px]">
                          <strong>Stay Duration:</strong> {booking.arrivalDate} to {booking.departureDate}
                        </div>
                        <div className="text-[11px]">
                          <strong>Category:</strong> {booking.category} {booking.category === 'B to A' && `(Money Given: ${booking.moneyGiven})`}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-extrabold text-emerald-950 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                          <span>VACANT ROOM READY FOR ALLOTMENT</span>
                        </div>

                        {/* Allotment Mode Toggle */}
                        <div className="flex items-center bg-white rounded-lg p-0.5 border border-emerald-300 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setInspectAllotMode('family')}
                            className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                              inspectAllotMode === 'family'
                                ? 'bg-[#124E39] text-[#EBD59E]'
                                : 'text-stone-600 hover:text-stone-900'
                            }`}
                          >
                            👨‍👩‍👧 Whole Family
                          </button>
                          <button
                            type="button"
                            onClick={() => setInspectAllotMode('individual')}
                            className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                              inspectAllotMode === 'individual'
                                ? 'bg-[#124E39] text-[#EBD59E]'
                                : 'text-stone-600 hover:text-stone-900'
                            }`}
                          >
                            👤 Single Zaer
                          </button>
                        </div>
                      </div>

                      {inspectAllotMode === 'family' ? (
                        <div className="space-y-2.5 pt-1">
                          <p className="text-[11px] text-emerald-900">
                            Allot {inspectedRoom.building} Room {inspectedRoom.roomNumber} (Capacity: {inspectedRoom.capacity}) to an entire family for their Tour ID in one go.
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] font-bold text-stone-600 uppercase">1. Tour ID:</label>
                              <select
                                value={inspectTourId}
                                onChange={(e) => {
                                  setInspectTourId(e.target.value);
                                  setInspectFamily('');
                                }}
                                className="w-full bg-white border border-emerald-300 rounded-lg p-1.5 text-xs font-mono font-bold text-stone-900 mt-0.5 cursor-pointer"
                              >
                                <option value="">-- Choose Tour ID --</option>
                                {distinctTourIds.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="text-[10px] font-bold text-stone-600 uppercase">2. Family:</label>
                              <select
                                value={inspectFamily}
                                onChange={(e) => setInspectFamily(e.target.value)}
                                disabled={!inspectTourId}
                                className="w-full bg-white border border-emerald-300 rounded-lg p-1.5 text-xs font-mono font-bold text-stone-900 mt-0.5 cursor-pointer disabled:opacity-40"
                              >
                                <option value="">-- Choose Family --</option>
                                {Array.from(
                                  new Set(
                                    reservations
                                      .filter((r) => r.tourRefNo === inspectTourId)
                                      .map((r) => r.family)
                                      .filter(Boolean)
                                  )
                                ).map((f) => {
                                  const count = reservations.filter(
                                    (r) => r.tourRefNo === inspectTourId && (r.family || '').trim() === f.trim()
                                  ).length;
                                  return (
                                    <option key={f} value={f}>
                                      Family {f} ({count} Zaereen)
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          </div>

                          {inspectFamily && (
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[11px] text-emerald-950 font-bold">
                                Family "{inspectFamily}" has {reservations.filter((r) => r.tourRefNo === inspectTourId && (r.family || '').trim() === inspectFamily.trim()).length} members
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (onBatchAllotFamily && inspectTourId && inspectFamily) {
                                    onBatchAllotFamily(inspectTourId, inspectFamily, inspectedRoom.building, inspectedRoom.roomNumber);
                                    setInspectFamily('');
                                    setInspectedRoom(null);
                                  }
                                }}
                                className="px-3.5 py-1.5 bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] font-black rounded-lg text-xs shadow-xs transition cursor-pointer"
                              >
                                ⚡ Allot Room {inspectedRoom.roomNumber} to Entire Family
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] text-emerald-800">
                            Select an unassigned zaer to allot into this vacant room.
                          </p>
                          {unallottedZaereen.length > 0 ? (
                            <div className="flex items-center gap-2 pt-1">
                              <select
                                value={allotTargetZaerId}
                                onChange={(e) => setAllotTargetZaerId(e.target.value)}
                                className="flex-1 bg-white border border-emerald-300 rounded-lg px-2 py-1.5 text-xs text-stone-800 font-medium"
                              >
                                <option value="">Select unallotted Zaer...</option>
                                {unallottedZaereen.map((z) => (
                                  <option key={z.id} value={z.id}>
                                    {z.applicantName} ({z.family} • {z.tourRefNo} • {z.arrivalDate} to {z.departureDate})
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!allotTargetZaerId}
                                onClick={() => {
                                  if (allotTargetZaerId) {
                                    onAllotRoom(allotTargetZaerId, inspectedRoom.building, inspectedRoom.roomNumber);
                                    setAllotTargetZaerId('');
                                  }
                                }}
                                className="px-3 py-1.5 rounded-lg bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-40 text-white font-bold text-xs cursor-pointer"
                              >
                                Allot Room
                              </button>
                            </div>
                          ) : (
                            <div className="text-[11px] text-stone-500 italic">
                              All zaereen currently have rooms allotted.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Room details & Allotment Duration explanation */}
              <div className="space-y-2">
                <div className="text-stone-500 font-semibold">Booking Duration Rule:</div>
                <div className="p-2.5 rounded-lg bg-white border border-stone-200 text-[11px] text-stone-600 leading-relaxed">
                  When a room is allotted, the entire duration between arrival and departure is reserved in this room.
                  Rooms cannot be double-booked for overlapping date spans.
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => onNavigateTab('reservations')}
                    className="inline-flex items-center gap-1.5 text-xs text-[#124E39] font-bold hover:underline"
                  >
                    <span>View all Zaereen in Main Grid</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Daily Arrivals & Departures Table for Selected Date */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Arrivals on Date */}
        <div className="bg-white border border-[#E6DFD5] rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-stone-200">
            <div className="flex items-center gap-2 font-bold text-xs text-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              <span>Arrivals on {selectedDate} ({arrivalsOnDate.length})</span>
            </div>
            <button
              onClick={onOpenReceptionSlip}
              className="text-[11px] text-[#124E39] font-semibold hover:underline"
            >
              Print Reception Slip
            </button>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {arrivalsOnDate.length > 0 ? (
              arrivalsOnDate.map((res) => (
                <div
                  key={res.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-stone-50 hover:bg-emerald-50/50 text-xs border border-stone-100"
                >
                  <div>
                    <div className="font-semibold text-stone-900">{res.applicantName}</div>
                    <div className="text-[10px] text-stone-500 font-mono">
                      {res.family} • {res.tourRefNo} • {res.officeName}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#124E39] text-xs">
                      {res.building} {res.roomNumber ? `Rm ${res.roomNumber}` : <span className="text-amber-700">Unallotted</span>}
                    </span>
                    <div className="text-[10px] text-stone-500">{res.category}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-4 text-center text-xs text-stone-400 italic">
                No arrivals scheduled on {selectedDate}
              </div>
            )}
          </div>
        </div>

        {/* Departures on Date */}
        <div className="bg-white border border-[#E6DFD5] rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-stone-200">
            <div className="flex items-center gap-2 font-bold text-xs text-amber-800">
              <span className="w-2 h-2 rounded-full bg-amber-600" />
              <span>Departures on {selectedDate} ({departuresOnDate.length})</span>
            </div>
            <button
              onClick={onOpenReceptionSlip}
              className="text-[11px] text-[#124E39] font-semibold hover:underline"
            >
              Daily Reception Slip
            </button>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {departuresOnDate.length > 0 ? (
              departuresOnDate.map((res) => (
                <div
                  key={res.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-stone-50 hover:bg-amber-50/50 text-xs border border-stone-100"
                >
                  <div>
                    <div className="font-semibold text-stone-900">{res.applicantName}</div>
                    <div className="text-[10px] text-stone-500 font-mono">
                      {res.family} • {res.tourRefNo} • {res.officeName}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-stone-800 text-xs">
                      {res.building} {res.roomNumber ? `Rm ${res.roomNumber}` : '—'}
                    </span>
                    <div className="text-[10px] text-emerald-700 font-medium">Ready for check-out</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-4 text-center text-xs text-stone-400 italic">
                No departures scheduled on {selectedDate}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Zair Confirmation Modal (Non-blocking In-App Modal) */}
      {recordToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-md w-full overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-red-600">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-stone-900">Delete Zair Record</h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Are you sure you want to permanently delete this zaer record?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRecordToDelete(null)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Zair summary card */}
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-stone-900 text-sm">{recordToDelete.applicantName}</div>
                  <div className="font-mono text-stone-500 text-[11px]">ITS ID: {recordToDelete.itsId}</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-stone-200 text-stone-700">
                  Family {recordToDelete.family}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-stone-600">
                <div>
                  <span className="text-stone-400">Tour Ref:</span> {recordToDelete.tourRefNo}
                </div>
                <div>
                  <span className="text-stone-400">Category:</span> {recordToDelete.category || 'Mumineen'}
                </div>
                <div className="col-span-2">
                  <span className="text-stone-400">Stay:</span> {recordToDelete.arrivalDate} to {recordToDelete.departureDate}
                </div>
              </div>
              {recordToDelete.roomNumber && (
                <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px]">
                  ⚠️ <strong>Room Allocation Note:</strong> {recordToDelete.building} - Room {recordToDelete.roomNumber} will become vacant immediately upon deletion.
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setRecordToDelete(null)}
                className="px-4 py-2 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 font-semibold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteReservation && recordToDelete) {
                    onDeleteReservation(recordToDelete.id);
                    setRecordToDelete(null);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Yes, Delete Record</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
