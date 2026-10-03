import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  Plus, 
  Calendar, 
  Clock, 
  Building2, 
  CheckCircle2, 
  AlertCircle, 
  Trash2, 
  ChevronDown, 
  Users, 
  ArrowUpRight,
  Printer, 
  FileSpreadsheet, 
  Upload, 
  Download, 
  CheckSquare, 
  Square, 
  FileText,
  Copy,
  RefreshCw,
  Info,
  Check,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Sparkles,
  MapPin,
  Tag
} from 'lucide-react';
import { Reservation, Room, DEFAULT_ZAEREEN_CATEGORIES, UserRole } from '../types';
import { 
  isRoomBookedForDuration, 
  getVacantRoomsForDuration 
} from '../services/storage';
import { normalizeDate } from '../services/excelService';
import { generateAdministrativePdf } from '../services/pdfExport';

interface ReservationsViewProps {
  reservations: Reservation[];
  rooms: Room[];
  categories?: string[];
  onAddReservation: (newReservation: Reservation) => void;
  onUpdateReservation: (updatedReservation: Reservation) => void;
  onDeleteReservation: (id: string) => void;
  onBatchDeleteReservations?: (ids: string[]) => void;
  onOpenUploadExcel: () => void;
  onDownloadTemplate: () => void;
  onOpenAccountsSlip: (reservation: Reservation) => void;
  onOpenReceptionSlip: () => void;
  onOpenAddZaer?: () => void;
  onOpenAddTourGroup?: () => void;
  onOpenPdfModal?: () => void;
  onOpenCategoriesModal?: () => void;
  onNavigateToShifts?: () => void;
  onBatchAllotFamily?: (tourRefNo: string, family: string, building: string, roomNumber: string) => void;
  userRole?: UserRole;
  onOpenQuickAllotModal?: (res: Reservation) => void;
}

export const ReservationsView: React.FC<ReservationsViewProps> = ({
  reservations,
  rooms,
  categories = DEFAULT_ZAEREEN_CATEGORIES,
  onAddReservation,
  onUpdateReservation,
  onDeleteReservation,
  onBatchDeleteReservations,
  onOpenUploadExcel,
  onDownloadTemplate,
  onOpenAccountsSlip,
  onOpenReceptionSlip,
  onOpenAddZaer,
  onOpenAddTourGroup,
  onOpenPdfModal,
  onOpenCategoriesModal,
  onNavigateToShifts,
  onBatchAllotFamily,
  userRole = 'admin',
  onOpenQuickAllotModal,
}) => {
  const isReadOnly = userRole === 'receptionist';
  // Deletion modal state & multi-selection state
  const [recordToDelete, setRecordToDelete] = useState<Reservation | null>(null);
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [buildingFilter, setBuildingFilter] = useState('ALL');
  const [portalUploadFilter, setPortalUploadFilter] = useState('ALL');
  const [arrivalDateFilter, setArrivalDateFilter] = useState('ALL');

  // Distinct Arrival Dates for filtering and 1-click PDF download
  const distinctArrivalDates = useMemo(() => {
    const map = new Map<string, number>();
    reservations.forEach((r) => {
      const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      if (arr) {
        map.set(arr, (map.get(arr) || 0) + 1);
      }
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [reservations]);

  // Batch Family Allotment Quick Bar state
  const [batchTourId, setBatchTourId] = useState<string>('');
  const [batchFamily, setBatchFamily] = useState<string>('');
  const [batchBuilding, setBatchBuilding] = useState<string>('Saifee');
  const [batchRoomNumber, setBatchRoomNumber] = useState<string>('');

  // Distinct Tour IDs from reservations
  const distinctTourIds = useMemo(() => {
    return Array.from(new Set(reservations.map((r) => r.tourRefNo).filter(Boolean))).sort();
  }, [reservations]);

  // Distinct buildings from rooms and reservations
  const distinctBuildings = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach((r) => { if (r.building) set.add(r.building); });
    reservations.forEach((r) => { if (r.building) set.add(r.building); });
    return Array.from(set).length > 0 ? Array.from(set).sort() : ['Saifee', 'Burhani'];
  }, [rooms, reservations]);

  // Distinct families for selected batch Tour ID
  const familiesInBatchTour = useMemo(() => {
    const list = batchTourId
      ? reservations.filter((r) => r.tourRefNo === batchTourId)
      : reservations;
    return Array.from(new Set(list.map((r) => r.family).filter(Boolean))).sort();
  }, [reservations, batchTourId]);

  // Members in selected family
  const selectedFamilyMembers = useMemo(() => {
    if (!batchFamily) return [];
    return reservations.filter((r) => {
      const matchFam = (r.family || '').trim().toLowerCase() === batchFamily.trim().toLowerCase();
      const matchTour = !batchTourId || r.tourRefNo === batchTourId;
      return matchFam && matchTour;
    });
  }, [reservations, batchTourId, batchFamily]);

  // Vacant rooms for this family's duration
  const vacantRoomsForFamily = useMemo(() => {
    if (selectedFamilyMembers.length === 0) return [];
    const firstMember = selectedFamilyMembers[0];
    const memberIds = new Set(selectedFamilyMembers.map((m) => m.id));
    return getVacantRoomsForDuration(
      batchBuilding,
      firstMember.arrivalDate,
      firstMember.departureDate,
      rooms,
      reservations.filter((r) => !memberIds.has(r.id))
    );
  }, [rooms, reservations, selectedFamilyMembers, batchBuilding]);

  // Sorting state (default by ITS ID ascending)
  const [sortColumn, setSortColumn] = useState<string>('itsId');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Handle column header click for sorting
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Filter and sort reservations
  const filteredAndSortedReservations = useMemo(() => {
    // 1. Filter
    const filtered = reservations.filter((res) => {
      // Search
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchSearch =
          (res.applicantName && res.applicantName.toLowerCase().includes(query)) ||
          (res.itsId && res.itsId.toLowerCase().includes(query)) ||
          (res.jamaat && res.jamaat.toLowerCase().includes(query)) ||
          (res.category && res.category.toLowerCase().includes(query)) ||
          (res.idara && res.idara.toLowerCase().includes(query)) ||
          (res.family && res.family.toLowerCase().includes(query)) ||
          (res.tourRefNo && res.tourRefNo.toLowerCase().includes(query)) ||
          (res.officeName && res.officeName.toLowerCase().includes(query)) ||
          (res.groupLeadName && res.groupLeadName.toLowerCase().includes(query)) ||
          (res.roomNumber && res.roomNumber.toLowerCase().includes(query));
        if (!matchSearch) return false;
      }

      // Pilgrim Category filter (Mumineen, Muntasbeen, Qasreali, Baitezainy, etc.)
      if (categoryFilter !== 'ALL') {
        if (res.category?.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      }

      // Building filter
      if (buildingFilter !== 'ALL') {
        if (buildingFilter === 'Unallotted') {
          if (res.roomNumber && res.roomNumber.trim() !== '') return false;
        } else if (res.building !== buildingFilter) {
          return false;
        }
      }

      // Portal upload filter
      if (portalUploadFilter !== 'ALL') {
        const isUp = portalUploadFilter === 'Uploaded';
        if (res.isUploadedToPortal !== isUp) return false;
      }

      // Arrival Date Filter (Prompt: "I want the downloaded pdf of the date of arrival I have chosen")
      if (arrivalDateFilter !== 'ALL') {
        const arr = normalizeDate(res.arrivalDate || res.arrivalDateTime || res.rawArrivalStr);
        if (arr !== arrivalDateFilter) return false;
      }

      return true;
    });

    // 2. Sort
    filtered.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (sortColumn) {
        case 'itsId':
          valA = parseInt(a.itsId, 10) || 0;
          valB = parseInt(b.itsId, 10) || 0;
          break;
        case 'applicantName':
          valA = (a.applicantName || '').toLowerCase();
          valB = (b.applicantName || '').toLowerCase();
          break;
        case 'age':
          valA = Number(a.age) || 0;
          valB = Number(b.age) || 0;
          break;
        case 'category':
          valA = (a.category || '').toLowerCase();
          valB = (b.category || '').toLowerCase();
          break;
        case 'idara':
          valA = (a.idara || '').toLowerCase();
          valB = (b.idara || '').toLowerCase();
          break;
        case 'gender':
          valA = (a.gender || '').toLowerCase();
          valB = (b.gender || '').toLowerCase();
          break;
        case 'family':
          return sortDirection === 'asc'
            ? (a.family || '').localeCompare(b.family || '', undefined, { numeric: true, sensitivity: 'base' })
            : (b.family || '').localeCompare(a.family || '', undefined, { numeric: true, sensitivity: 'base' });
        case 'tourRefNo':
          return sortDirection === 'asc'
            ? (a.tourRefNo || '').localeCompare(b.tourRefNo || '', undefined, { numeric: true, sensitivity: 'base' })
            : (b.tourRefNo || '').localeCompare(a.tourRefNo || '', undefined, { numeric: true, sensitivity: 'base' });
        case 'officeName':
          valA = (a.officeName || '').toLowerCase();
          valB = (b.officeName || '').toLowerCase();
          break;
        case 'groupLeadName':
          valA = (a.groupLeadName || '').toLowerCase();
          valB = (b.groupLeadName || '').toLowerCase();
          break;
        case 'arrivalDate':
          valA = new Date(a.arrivalDate).getTime() || 0;
          valB = new Date(b.arrivalDate).getTime() || 0;
          break;
        case 'departureDate':
          valA = new Date(a.departureDate).getTime() || 0;
          valB = new Date(b.departureDate).getTime() || 0;
          break;
        case 'building':
          valA = (a.building || '').toLowerCase();
          valB = (b.building || '').toLowerCase();
          break;
        case 'roomNumber':
          valA = parseInt(a.roomNumber, 10) || 9999;
          valB = parseInt(b.roomNumber, 10) || 9999;
          break;
        case 'portal':
          valA = a.isUploadedToPortal ? 1 : 0;
          valB = b.isUploadedToPortal ? 1 : 0;
          break;
        default:
          valA = a.id;
          valB = b.id;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [
    reservations,
    searchTerm,
    categoryFilter,
    buildingFilter,
    portalUploadFilter,
    arrivalDateFilter,
    sortColumn,
    sortDirection,
  ]);

  // Selection helpers
  const handleToggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllVisibleSelected = useMemo(() => {
    if (filteredAndSortedReservations.length === 0) return false;
    return filteredAndSortedReservations.every((r) => selectedIds.has(r.id));
  }, [filteredAndSortedReservations, selectedIds]);

  const isSomeVisibleSelected = useMemo(() => {
    return (
      filteredAndSortedReservations.some((r) => selectedIds.has(r.id)) &&
      !isAllVisibleSelected
    );
  }, [filteredAndSortedReservations, selectedIds, isAllVisibleSelected]);

  const handleToggleSelectAllVisible = () => {
    if (isAllVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredAndSortedReservations.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredAndSortedReservations.forEach((r) => next.add(r.id));
        return next;
      });
    }
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBulkMarkSelectedPortal = (uploaded: boolean) => {
    selectedIds.forEach((id) => {
      const target = reservations.find((r) => r.id === id);
      if (target && target.isUploadedToPortal !== uploaded) {
        onUpdateReservation({ ...target, isUploadedToPortal: uploaded });
      }
    });
  };

  const handleExecuteBatchDelete = () => {
    const ids = Array.from(selectedIds);
    if (onBatchDeleteReservations) {
      onBatchDeleteReservations(ids);
    } else {
      ids.forEach((id) => onDeleteReservation(id));
    }
    setSelectedIds(new Set());
    setIsBatchDeleteModalOpen(false);
  };

  // Bulk actions
  const handleBulkMarkPortal = (uploaded: boolean) => {
    filteredAndSortedReservations.forEach((r) => {
      if (r.isUploadedToPortal !== uploaded) {
        onUpdateReservation({ ...r, isUploadedToPortal: uploaded });
      }
    });
  };

  // Add a blank row
  const handleAddNewRow = () => {
    const newId = `res-${Date.now()}`;
    const newRes: Reservation = {
      id: newId,
      itsId: `30${Math.floor(100000 + Math.random() * 900000)}`,
      applicantName: 'New Zaer Applicant',
      age: 40,
      jamaat: 'HATEMI MOHALLA (MUMBAI)',
      category: categories[0] || 'Mumineen',
      gender: 'Male',
      family: `F-${reservations.length + 1}`,
      idara: 'Faiz-e-Husaini',
      tourRefNo: 'NKERP/TOUR/2026/1333',
      officeName: 'Fayz E Husayni Trust Mumbai',
      groupLeadName: 'Group Leader Name',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-06',
      shiftToCategoryA: false,
      accommodationCategory: 'Category B (Standard)',
      moneyGiven: 'No',
      building: 'Saifee',
      roomNumber: '',
      isUploadedToPortal: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onAddReservation(newRes);
  };

  // In-place field editor handler
  const handleFieldChange = (id: string, field: keyof Reservation, value: any) => {
    const target = reservations.find((r) => r.id === id);
    if (!target) return;

    const updated: Reservation = {
      ...target,
      [field]: value,
      updatedAt: new Date().toISOString(),
    };

    // If building or dates change, check room validity
    if (field === 'building' || field === 'arrivalDate' || field === 'departureDate') {
      if (updated.roomNumber) {
        const isOccupied = isRoomBookedForDuration(
          updated.building || 'Saifee',
          updated.roomNumber,
          updated.arrivalDate,
          updated.departureDate,
          reservations,
          updated.id
        );
        if (isOccupied) {
          updated.roomNumber = '';
        }
      }
    }

    onUpdateReservation(updated);
  };

  // Render sort header icon
  const renderSortIndicator = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-emerald-200/50 inline ml-1 opacity-40 hover:opacity-100" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-[#EBD59E] inline ml-1 font-bold" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-[#EBD59E] inline ml-1 font-bold" />
    );
  };

  // Helper to render category at the end:
  // "if any category is other than mumineen color it otherwise no need to mention and keep it in the the end"
  const renderCategoryBadge = (res: Reservation) => {
    const rawCat = (res.category || '').trim();
    const isMumineen = !rawCat || rawCat.toLowerCase() === 'mumineen';

    if (isMumineen) {
      // Mumineen: no need to mention, show clean dash
      return (
        <div className="flex items-center justify-center relative group min-w-[50px]" title="Category: Mumineen (Default)">
          <span className="text-stone-300 font-mono text-xs select-none">—</span>
          {/* Subtle edit trigger on hover/click */}
          <select
            value={res.category}
            onChange={(e) => handleFieldChange(res.id, 'category', e.target.value)}
            className="opacity-0 group-hover:opacity-100 absolute inset-0 text-xs rounded border border-stone-300 bg-white cursor-pointer transition font-medium"
            title="Click to change category"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!categories.includes(res.category) && res.category && (
              <option value={res.category}>{res.category}</option>
            )}
          </select>
        </div>
      );
    }

    // Other than Mumineen: COLOR IT!
    const lower = rawCat.toLowerCase();
    let badgeClass = 'bg-rose-100 text-rose-950 border-rose-300';
    if (lower === 'muntasbeen') {
      badgeClass = 'bg-purple-100 text-purple-950 border-purple-400 font-black';
    } else if (lower === 'qasreali') {
      badgeClass = 'bg-amber-100 text-amber-950 border-amber-400 font-black ring-1 ring-amber-300';
    } else if (lower === 'baitezainy') {
      badgeClass = 'bg-cyan-100 text-cyan-950 border-cyan-400 font-black';
    } else if (lower.includes('nizaam') || lower.includes('category a')) {
      badgeClass = 'bg-emerald-100 text-emerald-950 border-emerald-400 font-black';
    }

    return (
      <div className="relative group inline-block">
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-black border shadow-2xs uppercase tracking-wide ${badgeClass}`}>
          {rawCat}
        </span>
        <select
          value={res.category}
          onChange={(e) => handleFieldChange(res.id, 'category', e.target.value)}
          className="opacity-0 group-hover:opacity-100 absolute inset-0 text-xs rounded border border-stone-300 bg-white cursor-pointer transition font-bold"
          title="Click to change category"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {!categories.includes(res.category) && res.category && (
            <option value={res.category}>{res.category}</option>
          )}
        </select>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Action Bar */}
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[#124E39] tracking-tight">
              Zaereen Lodging & Room Allotment Grid
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-950 border border-emerald-300 font-bold">
              {reservations.length} Zaereen Total
            </span>
          </div>
          <p className="text-xs text-stone-600 mt-1">
            Sequence: <strong>ITS ➔ NAME ➔ AGE ➔ FAMILY ➔ OFFICE NAME ➔ TOUR ID ➔ BUILDING & ROOM ALLOTTMENT</strong> ➔ GENDER ➔ GROUP LEAD ➔ DATES ➔ CATEGORY. Full Screen Table.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Upload Excel Button */}
          <button
            onClick={onOpenUploadExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-sm transition"
          >
            <Upload className="w-4 h-4 text-[#EBD59E]" />
            <span>Upload Excel</span>
          </button>

          {/* Download Template */}
          <button
            onClick={onDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-stone-50 text-stone-800 border border-stone-300 shadow-2xs transition"
          >
            <Download className="w-3.5 h-3.5 text-stone-500" />
            <span>Excel Template</span>
          </button>

          {/* Google Sheet Categories Button */}
          {onOpenCategoriesModal && (
            <button
              onClick={onOpenCategoriesModal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-[#124E39] border border-emerald-300 shadow-2xs transition"
              title="Configure or fetch Pilgrim Categories (Mumineen, Muntasbeen, Qasreali, Baitezainy) from Google Sheet"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#124E39]" />
              <span>Google Sheet Categories</span>
              <span className="bg-[#124E39] text-[#EBD59E] px-1.5 py-0.2 rounded-full text-[10px] font-extrabold">
                {categories.length}
              </span>
            </button>
          )}

          {/* B to A Shifts Button */}
          {onNavigateToShifts && (
            <button
              onClick={onNavigateToShifts}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs transition"
              title="Manage B to A accommodation shifts, accounts money given, and slips"
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-amber-700" />
              <span>B ➔ A Shifts (Accounts)</span>
            </button>
          )}

          {/* Reception Daily Slip */}
          <button
            onClick={onOpenReceptionSlip}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-stone-50 text-[#124E39] border border-[#124E39]/40 shadow-2xs transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Reception Slip</span>
          </button>

          {/* Add Zair Button */}
          <button
            onClick={onOpenAddZaer || handleAddNewRow}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm transition cursor-pointer"
            title="Manually add all details of a single Zair with duplicate check"
          >
            <Plus className="w-4 h-4" />
            <span>Add Zair</span>
          </button>

          {/* Add Tour Group Button (Shared Tour ID, Shared Dates, Different Family IDs & Multiple Individuals) */}
          {onOpenAddTourGroup && (
            <button
              onClick={onOpenAddTourGroup}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] border border-[#C5A059]/40 shadow-sm transition cursor-pointer"
              title="Add a Tour ID with different family IDs and multiple individuals with same arrival and departure dates"
            >
              <Users className="w-4 h-4 text-[#EBD59E]" />
              <span>Add Tour Group</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-[#E6DFD5] rounded-xl p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
            <input
              type="text"
              placeholder="Search ITS, Name, Family, Office, Tour ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg pl-9 pr-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            />
          </div>

          {/* Pilgrim Category Filter */}
          <div className="flex items-center gap-1">
            <span className="text-stone-500 font-semibold">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-800"
            >
              <option value="ALL">All Categories ({categories.length})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Hotel Filter */}
          <select
            value={buildingFilter}
            onChange={(e) => setBuildingFilter(e.target.value)}
            className="bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-800 cursor-pointer"
          >
            <option value="ALL">All Hotels</option>
            {distinctBuildings.map((bldg) => (
              <option key={bldg} value={bldg}>{bldg} Hotel</option>
            ))}
            <option value="Unallotted">Unallotted Rooms</option>
          </select>

          {/* Portal Upload Filter */}
          <select
            value={portalUploadFilter}
            onChange={(e) => setPortalUploadFilter(e.target.value)}
            className="bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-800"
          >
            <option value="ALL">Portal: All</option>
            <option value="Uploaded">Uploaded ✓</option>
            <option value="Pending">Pending ✗</option>
          </select>

          {/* Arrival Date Filter (Prompt: "I want the downloaded pdf of the date of arrival I have chosen") */}
          <div className="flex items-center gap-1">
            <span className="text-stone-500 font-semibold flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-[#124E39]" />
              <span>Arrival:</span>
            </span>
            <select
              value={arrivalDateFilter}
              onChange={(e) => setArrivalDateFilter(e.target.value)}
              className="bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-800"
            >
              <option value="ALL">All Arrival Dates</option>
              {distinctArrivalDates.map(({ date, count }) => (
                <option key={date} value={date}>
                  {date} ({count} Zaereen)
                </option>
              ))}
            </select>
          </div>

          {/* 1-Click Download PDF for chosen arrival date with Hotel Bifurcation options */}
          {arrivalDateFilter !== 'ALL' && (
            <div className="flex items-center rounded-lg bg-[#124E39] p-0.5 border border-[#C5A059] shadow-xs">
              <button
                type="button"
                onClick={() => {
                  generateAdministrativePdf(reservations, rooms, {
                    reportType: 'all_reservations',
                    arrivalDateFilter,
                    buildingFilter: buildingFilter !== 'ALL' ? buildingFilter : 'ALL',
                    includeSignatures: true,
                  });
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold text-[#EBD59E] hover:bg-[#0E3C2C] transition cursor-pointer"
                title={`Download official PDF for arrival date ${arrivalDateFilter} (${buildingFilter === 'ALL' ? 'Joined Bifurcated Both Hotels' : `${buildingFilter} Hotel`})`}
              >
                <Download className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>
                  {buildingFilter === 'ALL'
                    ? `Download PDF (${arrivalDateFilter})`
                    : `Download ${buildingFilter} PDF (${arrivalDateFilter})`}
                </span>
              </button>
              <div className="h-3.5 w-px bg-[#C5A059]/40 my-auto" />
              <button
                type="button"
                onClick={() => {
                  generateAdministrativePdf(reservations, rooms, {
                    reportType: 'all_reservations',
                    arrivalDateFilter,
                    buildingFilter: 'Saifee',
                    includeSignatures: true,
                  });
                }}
                className="px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:text-white hover:bg-emerald-800/60 rounded transition cursor-pointer"
                title={`Download separate Saifee Hotel PDF for arrival date ${arrivalDateFilter}`}
              >
                Saifee
              </button>
              <button
                type="button"
                onClick={() => {
                  generateAdministrativePdf(reservations, rooms, {
                    reportType: 'all_reservations',
                    arrivalDateFilter,
                    buildingFilter: 'Burhani',
                    includeSignatures: true,
                  });
                }}
                className="px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:text-white hover:bg-emerald-800/60 rounded transition cursor-pointer"
                title={`Download separate Burhani Hotel PDF for arrival date ${arrivalDateFilter}`}
              >
                Burhani
              </button>
            </div>
          )}
        </div>

        {/* Bulk Portal Actions */}
        <div className="flex items-center gap-2">
          <span className="text-stone-500 text-xs">Bulk Portal:</span>
          <button
            onClick={() => handleBulkMarkPortal(true)}
            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded text-xs font-bold"
            title="Mark all filtered zaereen as Uploaded on Main Portal"
          >
            Tick All Filtered
          </button>
          <button
            onClick={() => handleBulkMarkPortal(false)}
            className="px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded text-xs"
          >
            Untick All
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1-CLICK BATCH FAMILY ALLOTMENT QUICK BAR                                  */}
      {/* "in family member I should be able to allottment on tour id and whole it  */}
      {/* family number in one go and if needed it should be editable"              */}
      {/* ========================================================================= */}
      <div className="bg-emerald-50/70 border border-emerald-300 rounded-2xl p-3.5 shadow-2xs space-y-2">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-[#124E39] text-[#EBD59E] shadow-2xs">
              <Users className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-[#124E39] uppercase tracking-wider">
                  One-Click Family Room Allotment
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#124E39] text-[#EBD59E] font-bold">
                  Batch on Tour ID & Family Number
                </span>
              </div>
              <p className="text-[11px] text-stone-600 mt-0.5">
                Select a Tour ID and Family Number to allot a room to the whole family in one go. Individual rooms remain editable.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Tour ID select */}
            <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-emerald-300 shadow-2xs">
              <span className="text-stone-500 font-semibold text-[11px]">Tour ID:</span>
              <select
                value={batchTourId}
                onChange={(e) => {
                  setBatchTourId(e.target.value);
                  setBatchFamily('');
                  setBatchRoomNumber('');
                }}
                className="bg-transparent font-mono font-bold text-stone-900 focus:outline-none cursor-pointer max-w-[170px] truncate"
              >
                <option value="">-- All Tour IDs --</option>
                {distinctTourIds.map((tid) => (
                  <option key={tid} value={tid}>
                    {tid}
                  </option>
                ))}
              </select>
            </div>

            {/* Family select */}
            <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-emerald-300 shadow-2xs">
              <span className="text-stone-500 font-semibold text-[11px]">Family:</span>
              <select
                value={batchFamily}
                onChange={(e) => {
                  setBatchFamily(e.target.value);
                  setBatchRoomNumber('');
                }}
                className="bg-transparent font-mono font-bold text-emerald-950 focus:outline-none cursor-pointer max-w-[170px]"
              >
                <option value="">-- Select Family --</option>
                {familiesInBatchTour.map((fam) => {
                  const cnt = reservations.filter(
                    (r) => (r.family || '').trim().toLowerCase() === fam.trim().toLowerCase() && (!batchTourId || r.tourRefNo === batchTourId)
                  ).length;
                  return (
                    <option key={fam} value={fam}>
                      {fam} ({cnt} members)
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Hotel select */}
            <select
              value={batchBuilding}
              onChange={(e) => {
                setBatchBuilding(e.target.value);
                setBatchRoomNumber('');
              }}
              className="bg-white border border-emerald-300 rounded-lg px-2.5 py-1 text-xs font-bold text-[#124E39] shadow-2xs cursor-pointer"
            >
              {distinctBuildings.map((bldg) => (
                <option key={bldg} value={bldg}>{bldg}</option>
              ))}
            </select>

            {/* Room select */}
            <select
              value={batchRoomNumber}
              onChange={(e) => setBatchRoomNumber(e.target.value)}
              disabled={!batchFamily}
              className="bg-white border border-emerald-300 rounded-lg px-2.5 py-1 text-xs font-bold text-stone-900 shadow-2xs cursor-pointer disabled:opacity-40"
            >
              <option value="">-- Select Vacant Room --</option>
              {vacantRoomsForFamily.map((rm) => (
                <option key={rm.id} value={rm.roomNumber}>
                  Room {rm.roomNumber} ({rm.floorLabel || `Fl ${rm.floor}`} • Pax {rm.capacity}{rm.buffer ? ` +${rm.buffer} Buf` : ''} • {rm.toiletType || 'Standard'} • {rm.bedType || 'Single Beds'})
                </option>
              ))}
            </select>

            {/* Allot in One Go button */}
            <button
              type="button"
              disabled={!batchFamily || !batchRoomNumber}
              onClick={() => {
                if (batchFamily && batchRoomNumber && onBatchAllotFamily) {
                  onBatchAllotFamily(batchTourId, batchFamily, batchBuilding, batchRoomNumber);
                  setBatchRoomNumber('');
                }
              }}
              className="px-3.5 py-1.5 bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-40 text-[#EBD59E] font-extrabold rounded-lg text-xs shadow-xs transition cursor-pointer"
            >
              Allot All ({selectedFamilyMembers.length}) Members
            </button>

            {/* Clear Allotment */}
            {batchFamily && (
              <button
                type="button"
                onClick={() => {
                  if (onBatchAllotFamily) {
                    onBatchAllotFamily(batchTourId, batchFamily, batchBuilding, '');
                  }
                }}
                className="px-2.5 py-1 bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-lg text-xs font-semibold transition"
                title="Clear room allotment for this family"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Selected Family Member Preview Chips */}
        {selectedFamilyMembers.length > 0 && (
          <div className="pt-2 border-t border-emerald-200/80 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-extrabold text-[#124E39] mr-1">
              Family "{batchFamily}" ({selectedFamilyMembers.length} Zaereen):
            </span>
            {selectedFamilyMembers.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-stone-900 text-xs shadow-2xs"
              >
                <span className="font-bold text-stone-950">{m.applicantName}</span>
                <span className="text-stone-400 font-mono text-[11px]">(ITS {m.itsId}, Age {m.age})</span>
                {m.roomNumber ? (
                  <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-950 font-black text-[11px]">
                    Rm {m.roomNumber} ({m.building}) ✓
                  </span>
                ) : (
                  <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-950 font-bold text-[11px]">
                    Unallotted
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Floating / Sticky Batch Selection Action Bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 mb-3 bg-[#124E39] text-white px-4 py-2.5 rounded-xl shadow-xl border border-[#C5A059]/40 flex flex-wrap items-center justify-between gap-3 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 bg-[#0E3C2C] px-3 py-1 rounded-lg text-xs font-bold text-[#EBD59E] border border-[#C5A059]/30">
              <CheckSquare className="w-3.5 h-3.5" />
              <span>{selectedIds.size} Selected</span>
            </span>
            <span className="text-xs text-stone-200 hidden sm:inline">
              Perform batch operations on selected zaereen records
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleBulkMarkSelectedPortal(true)}
              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-[#EBD59E] rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
              title="Mark selected zaereen as Uploaded to main portal"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Mark Uploaded</span>
            </button>

            <button
              type="button"
              onClick={() => handleBulkMarkSelectedPortal(false)}
              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-stone-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
              title="Mark selected zaereen as Pending"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Mark Pending</span>
            </button>

            <button
              type="button"
              onClick={() => setIsBatchDeleteModalOpen(true)}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
              title="Delete all selected zaereen records"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Selected ({selectedIds.size})</span>
            </button>

            <button
              type="button"
              onClick={handleClearSelection}
              className="text-stone-300 hover:text-white px-2 py-1 text-xs transition cursor-pointer ml-1"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MAIN ZAEREEN FULL-SCREEN GRID TABLE                                       */}
      {/* SEQUENCE: ITS, NAME, AGE, FAMILY, OFFICE NAME, TOUR ID,                   */}
      {/* BUILDING, ROOM ALLOTTMENT, then GENDER, GROUP LEAD, DATES, CATEGORY, PORTAL*/}
      {/* REMOVED IDARA. CATEGORY KEPT AT THE END & COLORED IF NOT MUMINEEN.        */}
      {/* ========================================================================= */}
      <div className="bg-white border border-[#E6DFD5] rounded-2xl shadow-sm overflow-hidden flex flex-col w-full">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-sm border-collapse min-w-full">
            {/* Table Header with interactive sorting on all columns */}
            <thead className="bg-[#124E39] text-white uppercase text-xs tracking-wider font-bold select-none sticky top-0 z-10">
              <tr>
                <th className="py-3.5 px-2 text-center w-14">
                  <div className="flex items-center justify-center gap-1">
                    <input
                      type="checkbox"
                      checked={isAllVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = isSomeVisibleSelected;
                      }}
                      onChange={handleToggleSelectAllVisible}
                      className="w-3.5 h-3.5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-[#EBD59E]"
                      title="Select / Deselect all visible zaereen"
                    />
                    <span>#</span>
                  </div>
                </th>

                {/* 1. ITS ID */}
                <th
                  onClick={() => handleSort('itsId')}
                  className="py-3.5 px-3 min-w-[115px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by ITS ID"
                >
                  <div className="flex items-center">
                    <span>ITS</span>
                    {renderSortIndicator('itsId')}
                  </div>
                </th>

                {/* 2. Applicant Name */}
                <th
                  onClick={() => handleSort('applicantName')}
                  className="py-3.5 px-3.5 min-w-[200px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Applicant Name"
                >
                  <div className="flex items-center">
                    <span>NAME</span>
                    {renderSortIndicator('applicantName')}
                  </div>
                </th>

                {/* 3. Age */}
                <th
                  onClick={() => handleSort('age')}
                  className="py-3.5 px-2.5 text-center min-w-[65px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Age"
                >
                  <div className="flex items-center justify-center">
                    <span>AGE</span>
                    {renderSortIndicator('age')}
                  </div>
                </th>

                {/* 4. Family */}
                <th
                  onClick={() => handleSort('family')}
                  className="py-3.5 px-3 min-w-[95px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Family"
                >
                  <div className="flex items-center">
                    <span>FAMILY</span>
                    {renderSortIndicator('family')}
                  </div>
                </th>

                {/* 5. Office Name */}
                <th
                  onClick={() => handleSort('officeName')}
                  className="py-3.5 px-3.5 min-w-[180px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Office Name"
                >
                  <div className="flex items-center">
                    <span>OFFICE NAME</span>
                    {renderSortIndicator('officeName')}
                  </div>
                </th>

                {/* 6. TOUR ID (Bold, wide, wrap text, complete ID visible) */}
                <th
                  onClick={() => handleSort('tourRefNo')}
                  className="py-3.5 px-3.5 min-w-[230px] max-w-[320px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Tour ID. Full ID is visible."
                >
                  <div className="flex items-center">
                    <span>TOUR ID</span>
                    {renderSortIndicator('tourRefNo')}
                  </div>
                </th>

                {/* 7. Building */}
                <th
                  onClick={() => handleSort('building')}
                  className="py-3.5 px-3 min-w-[110px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Building (Saifee / Burhani)"
                >
                  <div className="flex items-center">
                    <span>BUILDING</span>
                    {renderSortIndicator('building')}
                  </div>
                </th>

                {/* 8. Room Allottment (with 1-click batch family allotment) */}
                <th
                  onClick={() => handleSort('roomNumber')}
                  className="py-3.5 px-3.5 min-w-[170px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Room Number"
                >
                  <div className="flex items-center">
                    <span>ROOM ALLOTTMENT</span>
                    {renderSortIndicator('roomNumber')}
                  </div>
                </th>

                {/* 9. Gender */}
                <th
                  onClick={() => handleSort('gender')}
                  className="py-3.5 px-2.5 text-center min-w-[80px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Gender"
                >
                  <div className="flex items-center justify-center">
                    <span>GENDER</span>
                    {renderSortIndicator('gender')}
                  </div>
                </th>

                {/* 10. Group Lead */}
                <th
                  onClick={() => handleSort('groupLeadName')}
                  className="py-3.5 px-3.5 min-w-[170px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Group Lead"
                >
                  <div className="flex items-center">
                    <span>GROUP LEAD</span>
                    {renderSortIndicator('groupLeadName')}
                  </div>
                </th>

                {/* 11. Arrival Date */}
                <th
                  onClick={() => handleSort('arrivalDate')}
                  className="py-3.5 px-3 min-w-[130px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Arrival Date"
                >
                  <div className="flex items-center">
                    <span>ARRIVAL</span>
                    {renderSortIndicator('arrivalDate')}
                  </div>
                </th>

                {/* 12. Departure Date */}
                <th
                  onClick={() => handleSort('departureDate')}
                  className="py-3.5 px-3 min-w-[130px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Departure Date"
                >
                  <div className="flex items-center">
                    <span>DEPARTURE</span>
                    {renderSortIndicator('departureDate')}
                  </div>
                </th>

                {/* 13. Category Sort (KEPT AT THE END!) */}
                <th
                  onClick={() => handleSort('category')}
                  className="py-3.5 px-3 text-center min-w-[125px] cursor-pointer hover:bg-[#0E3C2C] transition"
                  title="Click to sort by Category. Mumineen is default/omitted, other categories are colored."
                >
                  <div className="flex items-center justify-center">
                    <span>CATEGORY</span>
                    {renderSortIndicator('category')}
                  </div>
                </th>

                {/* 14. Main Portal Tick Button Sort */}
                <th
                  onClick={() => handleSort('portal')}
                  className="py-3.5 px-3.5 text-center min-w-[135px] bg-[#0E3C2C] cursor-pointer hover:bg-[#08281D] transition"
                  title="Click to sort by Main Portal upload status"
                >
                  <div className="flex items-center justify-center">
                    <span>MAIN PORTAL</span>
                    {renderSortIndicator('portal')}
                  </div>
                </th>

                <th className="py-3.5 px-2 text-center w-12">ACT</th>
              </tr>
            </thead>

            {/* Table Body with bigger fonts and text wrapping */}
            <tbody className="divide-y divide-stone-100 text-stone-900 text-sm md:text-base">
              {filteredAndSortedReservations.length > 0 ? (
                filteredAndSortedReservations.map((res, index) => {
                  const isShiftedToA = !!res.shiftToCategoryA;
                  const isAllotted = !!res.roomNumber && res.roomNumber.trim() !== '';

                  // Vacant rooms for this single zaer
                  const vacantRoomsForRes = getVacantRoomsForDuration(
                    res.building || 'Saifee',
                    res.arrivalDate,
                    res.departureDate,
                    rooms,
                    reservations,
                    res.id
                  );

                  // Count how many members share this family and tour
                  const sameFamilyMembers = reservations.filter(
                    (r) =>
                      r.family &&
                      (r.family || '').trim().toLowerCase() === (res.family || '').trim().toLowerCase() &&
                      r.tourRefNo === res.tourRefNo
                  );

                  const isSelected = selectedIds.has(res.id);

                  return (
                    <tr
                      key={res.id}
                      className={`hover:bg-[#FAF7F2] transition ${
                        isSelected ? 'bg-amber-100/40' : !isAllotted ? 'bg-amber-50/25' : ''
                      }`}
                    >
                      {/* Checkbox & Index */}
                      <td className="py-3 px-2 text-center text-stone-400 font-mono text-xs">
                        <div className="flex items-center justify-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectRow(res.id)}
                            className="w-3.5 h-3.5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-[#124E39]"
                            title="Select record"
                          />
                          <span className="text-[11px] text-stone-400 font-normal">{index + 1}</span>
                        </div>
                      </td>

                      {/* 1. ITS ID (Bold, legible, bigger font) */}
                      <td className="py-3 px-3 font-mono font-bold text-stone-950 text-sm md:text-base">
                        <input
                          type="text"
                          value={res.itsId}
                          onChange={(e) => handleFieldChange(res.id, 'itsId', e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none font-mono font-bold text-stone-950 text-sm md:text-base"
                        />
                      </td>

                      {/* 2. Applicant Name (Bigger font, wrap text, with shifted pill if applicable) */}
                      <td className="py-3 px-3.5 whitespace-normal break-words">
                        <div className="flex items-center flex-wrap gap-1">
                          <input
                            type="text"
                            value={res.applicantName}
                            onChange={(e) => handleFieldChange(res.id, 'applicantName', e.target.value)}
                            className="w-full bg-transparent font-bold text-stone-950 text-sm md:text-base border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none leading-snug"
                          />
                          {isShiftedToA && (
                            <span 
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-[#124E39] text-[#EBD59E] border border-[#C5A059]/50 shadow-2xs mt-0.5"
                              title="Shifted to Category A (Nizaam). Managed in B to A Shifts."
                            >
                              Nizaam (A)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Age */}
                      <td className="py-3 px-2.5 text-center text-stone-800 font-semibold text-sm md:text-base">
                        <input
                          type="text"
                          value={res.age}
                          onChange={(e) => handleFieldChange(res.id, 'age', e.target.value)}
                          className="w-12 text-center bg-transparent border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none font-semibold text-sm md:text-base"
                        />
                      </td>

                      {/* 4. Family (e.g. F-1, F-2) */}
                      <td className="py-3 px-3 font-mono text-emerald-900 font-extrabold text-sm md:text-base">
                        <input
                          type="text"
                          value={res.family}
                          onChange={(e) => handleFieldChange(res.id, 'family', e.target.value)}
                          className="w-full bg-transparent font-mono font-extrabold text-emerald-900 border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none"
                        />
                      </td>

                      {/* 5. Office Name (Wrap text) */}
                      <td className="py-3 px-3.5 whitespace-normal break-words text-stone-800 text-xs md:text-sm font-medium min-w-[180px]">
                        <input
                          type="text"
                          value={res.officeName}
                          onChange={(e) => handleFieldChange(res.id, 'officeName', e.target.value)}
                          className="w-full bg-transparent text-stone-800 text-xs md:text-sm font-medium border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none leading-snug"
                        />
                      </td>

                      {/* 6. COMPLETE TOUR ID (Fonts bigger, wrap text, full visibility) */}
                      <td className="py-3 px-3.5 whitespace-normal break-words break-all min-w-[230px] max-w-[320px]">
                        <div className="font-mono font-bold text-stone-950 text-sm md:text-base leading-relaxed break-words break-all">
                          <input
                            type="text"
                            value={res.tourRefNo}
                            onChange={(e) => handleFieldChange(res.id, 'tourRefNo', e.target.value)}
                            className="w-full bg-transparent font-mono font-bold text-stone-950 text-sm md:text-base border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none leading-relaxed"
                            title={res.tourRefNo}
                          />
                        </div>
                      </td>

                      {/* 7. Hotel / Building */}
                      <td className="py-3 px-3 text-stone-900 font-bold text-xs md:text-sm">
                        <select
                          value={res.building || 'Saifee'}
                          onChange={(e) => handleFieldChange(res.id, 'building', e.target.value)}
                          className="bg-white border border-stone-200 rounded px-2 py-1 text-xs md:text-sm font-bold text-[#124E39] cursor-pointer shadow-2xs"
                        >
                          {distinctBuildings.map((bldg) => (
                            <option key={bldg} value={bldg}>{bldg}</option>
                          ))}
                        </select>
                      </td>

                      {/* 8. Room Allotted: Dynamic vacant rooms dropdown + 1-Click Family Allotment button */}
                      <td className="py-3 px-3.5 min-w-[170px]">
                        <div className="flex flex-col gap-1">
                          {isReadOnly ? (
                            <div className="px-2 py-1 rounded bg-stone-100 border border-stone-200 text-xs font-bold text-stone-700">
                              {res.roomNumber ? `${res.building} Rm ${res.roomNumber}` : 'Unallotted'}
                            </div>
                          ) : (
                            <>
                              <select
                                value={res.roomNumber || ''}
                                onChange={(e) => handleFieldChange(res.id, 'roomNumber', e.target.value)}
                                className={`w-full text-xs md:text-sm font-bold rounded-lg px-2.5 py-1 border transition cursor-pointer shadow-2xs ${
                                  isAllotted
                                    ? 'bg-emerald-50 text-emerald-950 border-emerald-300'
                                    : 'bg-amber-100 text-amber-950 border-amber-300 font-bold animate-pulse'
                                }`}
                              >
                                <option value="">-- Allot Room --</option>
                                {/* If currently assigned room exists, show it */}
                                {res.roomNumber && (
                                  <option value={res.roomNumber}>
                                    Room {res.roomNumber} ({res.building}) ✓
                                  </option>
                                )}
                                {/* Available rooms (with turnover/vacant) */}
                                <optgroup label="Available Rooms (Vacant / Turnover Ready)">
                                  {vacantRoomsForRes
                                    .filter((rm) => rm.roomNumber !== res.roomNumber)
                                    .map((rm) => (
                                      <option key={rm.id} value={rm.roomNumber}>
                                        Rm {rm.roomNumber} ({rm.floorLabel || `Fl ${rm.floor}`} • Pax {rm.capacity}{rm.buffer ? ` +${rm.buffer} Buf` : ''} • {rm.toiletType || 'Standard'} • {rm.bedType || 'Single Beds'})
                                      </option>
                                    ))}
                                </optgroup>
                                {/* All other rooms in building for Force Allocation if quota exceeds */}
                                <optgroup label="All Hotel Rooms (Force Allocate / Quota Override)">
                                  {rooms
                                    .filter(
                                      (rm) =>
                                        (rm.building || '').toLowerCase() === (res.building || 'Saifee').toLowerCase() &&
                                        rm.roomNumber !== res.roomNumber &&
                                        !vacantRoomsForRes.some((v) => v.roomNumber === rm.roomNumber) &&
                                        rm.status !== 'blocked'
                                    )
                                    .map((rm) => (
                                      <option key={rm.id} value={rm.roomNumber}>
                                        Rm {rm.roomNumber} [FORCE ALLOCATE • Over Quota]
                                      </option>
                                    ))}
                                </optgroup>
                              </select>

                              {/* Quick Allot Modal Trigger */}
                              {onOpenQuickAllotModal && (
                                <button
                                  type="button"
                                  onClick={() => onOpenQuickAllotModal(res)}
                                  className="flex items-center justify-center gap-1 px-2 py-0.5 rounded bg-stone-100 hover:bg-[#124E39] hover:text-[#EBD59E] text-stone-700 border border-stone-300 text-[10px] font-bold shadow-2xs transition"
                                  title="Open Quick Room Allotment visual modal"
                                >
                                  <Sparkles className="w-2.5 h-2.5 text-amber-600" />
                                  <span>Easy Room Allot</span>
                                </button>
                              )}
                            </>
                          )}

                          {/* 1-Click Allot to Family button if family has multiple members */}
                          {!isReadOnly && sameFamilyMembers.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!res.roomNumber) {
                                  alert(`Please select a room first in the dropdown, then click here to allot to all ${sameFamilyMembers.length} members of Family ${res.family}.`);
                                  return;
                                }
                                if (onBatchAllotFamily) {
                                  onBatchAllotFamily(res.tourRefNo, res.family, res.building || 'Saifee', res.roomNumber);
                                }
                              }}
                              className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-950 border border-emerald-400 text-[10px] font-extrabold shadow-2xs transition"
                              title={`Allot ${res.building || 'Saifee'} Room ${res.roomNumber || '...'} to all ${sameFamilyMembers.length} members of Family ${res.family} (Tour: ${res.tourRefNo}) in one go! Each member remains editable if needed.`}
                            >
                              <Users className="w-3 h-3 text-emerald-800" />
                              <span>Allot to Family ({sameFamilyMembers.length})</span>
                            </button>
                          )}
                        </div>
                      </td>

                      {/* 9. Gender */}
                      <td className="py-3 px-2.5 text-center text-xs md:text-sm font-medium">
                        <select
                          value={res.gender}
                          onChange={(e) => handleFieldChange(res.id, 'gender', e.target.value)}
                          className="bg-transparent text-xs md:text-sm font-semibold text-stone-700 cursor-pointer"
                        >
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                        </select>
                      </td>

                      {/* 10. Group Lead Name (Wrap text) */}
                      <td className="py-3 px-3.5 whitespace-normal break-words text-stone-900 text-xs md:text-sm font-semibold min-w-[170px]">
                        <input
                          type="text"
                          value={res.groupLeadName}
                          onChange={(e) => handleFieldChange(res.id, 'groupLeadName', e.target.value)}
                          className="w-full bg-transparent text-stone-900 text-xs md:text-sm font-semibold border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none leading-snug"
                        />
                      </td>

                      {/* 11. Arrival Date */}
                      <td className="py-3 px-3 text-stone-900 text-xs md:text-sm font-medium">
                        <input
                          type="date"
                          value={res.arrivalDate.slice(0, 10)}
                          onChange={(e) => handleFieldChange(res.id, 'arrivalDate', e.target.value)}
                          className="bg-transparent font-semibold text-stone-900 cursor-pointer focus:outline-none"
                        />
                        {res.rawArrivalStr && (
                          <div className="text-[10px] text-stone-400 truncate" title={res.rawArrivalStr}>
                            {res.rawArrivalStr}
                          </div>
                        )}
                      </td>

                      {/* 12. Departure Date */}
                      <td className="py-3 px-3 text-stone-900 text-xs md:text-sm font-medium">
                        <input
                          type="date"
                          value={res.departureDate.slice(0, 10)}
                          onChange={(e) => handleFieldChange(res.id, 'departureDate', e.target.value)}
                          className="bg-transparent font-semibold text-stone-900 cursor-pointer focus:outline-none"
                        />
                        {res.rawDepartureStr && (
                          <div className="text-[10px] text-stone-400 truncate" title={res.rawDepartureStr}>
                            {res.rawDepartureStr}
                          </div>
                        )}
                      </td>

                      {/* 13. Category (AT THE END! If other than mumineen color it, otherwise no need to mention) */}
                      <td className="py-3 px-3 text-center min-w-[125px]">
                        {renderCategoryBadge(res)}
                      </td>

                      {/* 14. Main Portal Upload Status: Tick Button */}
                      <td className="py-3 px-3.5 text-center bg-stone-50/60">
                        <button
                          type="button"
                          onClick={() =>
                            handleFieldChange(res.id, 'isUploadedToPortal', !res.isUploadedToPortal)
                          }
                          className={`inline-flex items-center justify-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition shadow-2xs ${
                            res.isUploadedToPortal
                              ? 'bg-[#124E39] text-[#EBD59E] border border-[#124E39]'
                              : 'bg-white hover:bg-stone-100 text-stone-500 border border-stone-300'
                          }`}
                          title={
                            res.isUploadedToPortal
                              ? 'Allotment is uploaded on the main portal. Click to untick.'
                              : 'Click to mark room allocation uploaded on main portal'
                          }
                        >
                          {res.isUploadedToPortal ? (
                            <>
                              <CheckSquare className="w-4 h-4 text-[#EBD59E]" />
                              <span>Uploaded ✓</span>
                            </>
                          ) : (
                            <>
                              <Square className="w-4 h-4 text-stone-400" />
                              <span>Pending</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isShiftedToA && (
                            <button
                              type="button"
                              onClick={() => onOpenAccountsSlip(res)}
                              className="p-1 text-emerald-800 hover:text-emerald-950 hover:bg-emerald-50 rounded transition"
                              title="Print Accounts Slip"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setRecordToDelete(res)}
                            className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                            title={`Delete zaer record for ${res.applicantName}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={16} className="py-12 text-center text-stone-400 text-sm">
                    No zaereen found matching your filter criteria. Click "Upload Excel" to import your sheet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary Bar */}
        <div className="bg-[#FAF7F2] border-t border-[#E6DFD5] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-600 font-medium">
          <div className="flex items-center gap-4">
            <span>
              Showing <strong className="text-stone-900">{filteredAndSortedReservations.length}</strong> of{' '}
              <strong className="text-stone-900">{reservations.length}</strong> zaereen
            </span>
            <span>•</span>
            <span>
              Allotted:{' '}
              <strong className="text-emerald-900">
                {reservations.filter((r) => r.roomNumber && r.roomNumber.trim() !== '').length}
              </strong>
            </span>
            <span>•</span>
            <span>
              Unassigned:{' '}
              <strong className="text-amber-800">
                {reservations.filter((r) => !r.roomNumber || r.roomNumber.trim() === '').length}
              </strong>
            </span>
            <span>•</span>
            <span>
              Uploaded to Portal:{' '}
              <strong className="text-[#124E39]">
                {reservations.filter((r) => r.isUploadedToPortal).length}
              </strong>
            </span>
          </div>

          <div className="text-[11px] text-stone-500">
            Click any column header to sort ascending or descending.
          </div>
        </div>
      </div>

      {/* Single Delete Confirmation Modal (In-App Modal, never blocked by iframe) */}
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
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
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
                <div>
                  <span className="text-stone-400">Age / Gender:</span> {recordToDelete.age} yrs • {recordToDelete.gender}
                </div>
                <div>
                  <span className="text-stone-400">Jamaat:</span> {recordToDelete.jamaat || '—'}
                </div>
                <div className="col-span-2">
                  <span className="text-stone-400">Stay Duration:</span> {recordToDelete.arrivalDate} to {recordToDelete.departureDate}
                </div>
              </div>
              {recordToDelete.roomNumber ? (
                <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px]">
                  ⚠️ <strong>Room Allocation Note:</strong> {recordToDelete.building} - Room {recordToDelete.roomNumber} will become vacant immediately upon deletion.
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-stone-500 italic">
                  Zaer is currently unallotted (no room).
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
                  if (recordToDelete) {
                    onDeleteReservation(recordToDelete.id);
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      next.delete(recordToDelete.id);
                      return next;
                    });
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

      {/* Batch Delete Confirmation Modal */}
      {isBatchDeleteModalOpen && selectedIds.size > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-lg w-full overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-red-600">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-stone-900">
                  Delete {selectedIds.size} Zair Record{selectedIds.size > 1 ? 's' : ''}
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Are you sure you want to permanently delete all {selectedIds.size} selected zaereen? Any associated room allocations will be freed up.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBatchDeleteModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selected zaereen preview list */}
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 max-h-48 overflow-y-auto space-y-1.5 text-xs">
              {Array.from(selectedIds).map((id) => {
                const z = reservations.find((r) => r.id === id);
                if (!z) return null;
                return (
                  <div key={id} className="flex items-center justify-between py-1 px-2 rounded bg-white border border-stone-100">
                    <div>
                      <span className="font-semibold text-stone-900">{z.applicantName}</span>
                      <span className="font-mono text-stone-400 ml-1.5 text-[11px]">({z.itsId})</span>
                    </div>
                    <div className="text-[11px] text-stone-500">
                      {z.building} {z.roomNumber ? `Rm ${z.roomNumber}` : 'Unallotted'}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setIsBatchDeleteModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 font-semibold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteBatchDelete}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete All {selectedIds.size} Records</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
