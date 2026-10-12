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
  User,
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
  Tag,
  LayoutGrid
} from 'lucide-react';
import { Reservation, Room, DEFAULT_ZAEREEN_CATEGORIES, UserRole } from '../types';
import { 
  isRoomBookedForDuration, 
  getVacantRoomsForDuration,
  checkRoomAllotmentAvailability,
  isInfant,
  countEffectivePax
} from '../services/storage';
import { normalizeDate } from '../services/excelService';
import { generateAdministrativePdf } from '../services/pdfExport';
import { hasDeparturePassed48Hours, getDepartureElapsedHours } from '../utils/turnoverTiming';

interface ReservationsViewProps {
  reservations: Reservation[];
  rooms: Room[];
  categories?: string[];
  onAddReservation: (newReservation: Reservation) => void;
  onUpdateReservation: (updatedReservation: Reservation) => void;
  onBatchUpdateReservations?: (updatedReservations: Reservation[]) => void;
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
  onAllotRoom?: (reservationId: string, building: string, roomNumber: string) => void;
  userRole?: UserRole;
  onOpenQuickAllotModal?: (res: Reservation) => void;
}

const STANDARD_TIMES = [
  '08:00 AM', '09:00 AM', '10:00 AM', '10:45 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '01:00 PM', '01:15 PM', '02:00 PM', '03:00 PM',
  '04:00 PM', '05:00 PM', '06:00 PM', '07:00 PM', '08:00 PM', '09:00 PM',
  '10:00 PM', '11:00 PM', '01:00 AM', '02:00 AM', '03:00 AM', '04:00 AM'
];

export const ReservationsView: React.FC<ReservationsViewProps> = ({
  reservations,
  rooms,
  categories = DEFAULT_ZAEREEN_CATEGORIES,
  onAddReservation,
  onUpdateReservation,
  onBatchUpdateReservations,
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
  onAllotRoom,
  userRole = 'admin',
  onOpenQuickAllotModal,
}) => {
  const isReadOnly = userRole === 'receptionist';
  // Deletion modal state & multi-selection state
  const [recordToDelete, setRecordToDelete] = useState<Reservation | null>(null);
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // User requirement: "Give a button to delete any records which departure date has passed for 48 hours."
  const expiredReservations = useMemo(() => {
    return reservations.filter((r) => hasDeparturePassed48Hours(r));
  }, [reservations]);
  const [isPurgeExpiredModalOpen, setIsPurgeExpiredModalOpen] = useState(false);

  // User requirement: "make allcolumns visible to the screen"
  const [fitColumnsToScreen, setFitColumnsToScreen] = useState(true);

  // Precomputed family counts to avoid O(N^2) loops inside rows
  const familyCountMap = useMemo(() => {
    const map = new Map<string, number>();
    reservations.forEach((r) => {
      if (r.family && r.tourRefNo) {
        const key = `${r.tourRefNo}___${r.family.trim().toLowerCase()}`;
        map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [reservations]);

  // Split rooms by hotel building for rapid lookup
  const saifeeRooms = useMemo(
    () => rooms.filter((r) => (r.building || '').toLowerCase().includes('saifee')),
    [rooms]
  );
  const burhaniRooms = useMemo(
    () => rooms.filter((r) => (r.building || '').toLowerCase().includes('burhani')),
    [rooms]
  );

  // Tour date/time batch change confirmation modal state
  const [pendingTourDateChange, setPendingTourDateChange] = useState<{
    reservation: Reservation;
    field: 'arrivalDate' | 'departureDate' | 'arrivalTime' | 'departureTime';
    oldValue: string;
    newValue: string;
    tourId: string;
    otherZaereenCount: number;
    allTourZaereen: Reservation[];
  } | null>(null);

  // User feedback toast
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' } | null>(null);

  // Auto-dismiss feedback toast after 4 seconds
  React.useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(t);
  }, [toastMessage]);

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

  // Fast memoized available rooms lookup by date duration and building:
  // Evaluates rooms where capacity is NOT reached, executing in <2ms for entire view!
  const availableRoomsCache = useMemo(() => {
    const cache = new Map<string, Room[]>();
    const datePairs = new Set<string>();
    filteredAndSortedReservations.forEach((r) => {
      if (r.arrivalDate && r.departureDate) {
        const b = (r.building || 'Saifee').trim().toLowerCase();
        const arr = r.arrivalDate.slice(0, 10);
        const dep = r.departureDate.slice(0, 10);
        datePairs.add(`${b}___${arr}___${dep}`);
      }
    });

    datePairs.forEach((pair) => {
      const [bldgNorm, arr, dep] = pair.split('___');
      const bldgRooms = rooms.filter((rm) => (rm.building || '').trim().toLowerCase() === bldgNorm);
      const bldgName = bldgRooms[0]?.building || (bldgNorm.includes('burhani') ? 'Burhani' : 'Saifee');

      const available = bldgRooms.filter((rm) => {
        if (rm.status === 'blocked') return false;
        const check = checkRoomAllotmentAvailability(
          bldgName,
          rm.roomNumber,
          arr,
          dep,
          rooms,
          reservations,
          1,
          undefined,
          false
        );
        return check.allowed;
      });
      cache.set(pair, available);
    });

    return cache;
  }, [filteredAndSortedReservations, rooms, reservations]);

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

  // User requirement: "Give a button to delete any records which departure date has passed for 48 hours."
  const handlePurgeExpiredRecords = () => {
    if (expiredReservations.length === 0) return;
    const ids = expiredReservations.map((r) => r.id);
    if (onBatchDeleteReservations) {
      onBatchDeleteReservations(ids);
    } else {
      ids.forEach((id) => onDeleteReservation(id));
    }
    setIsPurgeExpiredModalOpen(false);
    setToastMessage({
      text: `Permanently deleted ${ids.length} expired record${ids.length > 1 ? 's' : ''} (>48 hours past departure).`,
      type: 'success',
    });
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

  // Apply single field change directly to a single reservation
  const applySingleFieldChange = (id: string, field: keyof Reservation, value: any) => {
    const target = reservations.find((r) => r.id === id);
    if (!target) return;

    const updated: Reservation = {
      ...target,
      [field]: value,
      updatedAt: new Date().toISOString(),
    };

    // Synchronize compound date/time and raw string fields
    if (field === 'arrivalDate') {
      const cleanDate = String(value || '').slice(0, 10);
      updated.arrivalDate = cleanDate;
      const tPart = updated.arrivalTime || '11:00 AM';
      updated.arrivalDateTime = `${cleanDate}T${tPart.replace(/\s+/g, '')}`;
      updated.rawArrivalStr = `${cleanDate} ${tPart}`;
    } else if (field === 'departureDate') {
      const cleanDate = String(value || '').slice(0, 10);
      updated.departureDate = cleanDate;
      const tPart = updated.departureTime || '01:00 AM';
      updated.departureDateTime = `${cleanDate}T${tPart.replace(/\s+/g, '')}`;
      updated.rawDepartureStr = `${cleanDate} ${tPart}`;
    } else if (field === 'arrivalTime') {
      const cleanTime = String(value || '').trim();
      updated.arrivalTime = cleanTime;
      const dPart = (updated.arrivalDate || '').slice(0, 10);
      if (dPart) {
        updated.arrivalDateTime = `${dPart}T${cleanTime.replace(/\s+/g, '')}`;
        updated.rawArrivalStr = `${dPart} ${cleanTime}`;
      }
    } else if (field === 'departureTime') {
      const cleanTime = String(value || '').trim();
      updated.departureTime = cleanTime;
      const dPart = (updated.departureDate || '').slice(0, 10);
      if (dPart) {
        updated.departureDateTime = `${dPart}T${cleanTime.replace(/\s+/g, '')}`;
        updated.rawDepartureStr = `${dPart} ${cleanTime}`;
      }
    }

    onUpdateReservation(updated);
  };

  // In-place field editor handler with Tour-wide date/time prompt
  const handleFieldChange = (id: string, field: keyof Reservation, value: any) => {
    const target = reservations.find((r) => r.id === id);
    if (!target) return;

    // Intercept arrival/departure date & time changes
    if (
      field === 'arrivalDate' ||
      field === 'departureDate' ||
      field === 'arrivalTime' ||
      field === 'departureTime'
    ) {
      const currentVal =
        field === 'arrivalDate' || field === 'departureDate'
          ? String(target[field] || '').slice(0, 10).trim()
          : (field === 'arrivalTime' ? (target.arrivalTime || '11:00 AM') : (target.departureTime || '01:00 AM')).trim();

      const newVal =
        field === 'arrivalDate' || field === 'departureDate'
          ? String(value || '').slice(0, 10).trim()
          : String(value || '').trim();

      // If value hasn't actually changed, return
      if (currentVal === newVal || !newVal) return;

      const tourId = (target.tourRefNo || (target as any).tourId || '').trim();
      if (tourId) {
        const tourMembers = reservations.filter(
          (r) => (r.tourRefNo || (r as any).tourId || '').trim().toLowerCase() === tourId.toLowerCase()
        );

        // If there are multiple zaereen in this tour group, ask the user!
        if (tourMembers.length > 1) {
          setPendingTourDateChange({
            reservation: target,
            field,
            oldValue: currentVal,
            newValue: newVal,
            tourId,
            otherZaereenCount: tourMembers.length - 1,
            allTourZaereen: tourMembers,
          });
          return;
        }
      }
    }

    // Default: update single field directly
    applySingleFieldChange(id, field, value);
  };

  // Confirm: Apply new date/time to all zaereen of the same Tour ID
  const handleConfirmApplyToAllTour = () => {
    if (!pendingTourDateChange) return;
    const { field, newValue, tourId, allTourZaereen, reservation } = pendingTourDateChange;

    const updatedTourMembers = allTourZaereen.map((r) => {
      const updated: Reservation = {
        ...r,
        [field]: newValue,
        updatedAt: new Date().toISOString(),
      };

      // Synchronize compound date/time and raw string fields
      if (field === 'arrivalDate') {
        const cleanDate = String(newValue || '').slice(0, 10);
        updated.arrivalDate = cleanDate;
        const tPart = updated.arrivalTime || '11:00 AM';
        updated.arrivalDateTime = `${cleanDate}T${tPart.replace(/\s+/g, '')}`;
        updated.rawArrivalStr = `${cleanDate} ${tPart}`;
      } else if (field === 'departureDate') {
        const cleanDate = String(newValue || '').slice(0, 10);
        updated.departureDate = cleanDate;
        const tPart = updated.departureTime || '01:00 AM';
        updated.departureDateTime = `${cleanDate}T${tPart.replace(/\s+/g, '')}`;
        updated.rawDepartureStr = `${cleanDate} ${tPart}`;
      } else if (field === 'arrivalTime') {
        const cleanTime = String(newValue || '').trim();
        updated.arrivalTime = cleanTime;
        const dPart = (updated.arrivalDate || '').slice(0, 10);
        if (dPart) {
          updated.arrivalDateTime = `${dPart}T${cleanTime.replace(/\s+/g, '')}`;
          updated.rawArrivalStr = `${dPart} ${cleanTime}`;
        }
      } else if (field === 'departureTime') {
        const cleanTime = String(newValue || '').trim();
        updated.departureTime = cleanTime;
        const dPart = (updated.departureDate || '').slice(0, 10);
        if (dPart) {
          updated.departureDateTime = `${dPart}T${cleanTime.replace(/\s+/g, '')}`;
          updated.rawDepartureStr = `${dPart} ${cleanTime}`;
        }
      }

      return updated;
    });

    if (onBatchUpdateReservations) {
      onBatchUpdateReservations(updatedTourMembers);
    } else {
      updatedTourMembers.forEach((r) => onUpdateReservation(r));
    }

    const fieldLabel =
      field === 'arrivalDate'
        ? 'Arrival Date'
        : field === 'departureDate'
        ? 'Departure Date'
        : field === 'arrivalTime'
        ? 'Arrival Time'
        : 'Departure Time';

    setToastMessage({
      text: `✓ Updated ${fieldLabel} to "${newValue}" for all ${updatedTourMembers.length} zaereen in Tour ${tourId}.`,
      type: 'success',
    });

    setPendingTourDateChange(null);
  };

  // Confirm: Apply new date/time for this single zaer only
  const handleConfirmApplyToSingle = () => {
    if (!pendingTourDateChange) return;
    const { reservation, field, newValue } = pendingTourDateChange;

    applySingleFieldChange(reservation.id, field, newValue);

    const fieldLabel =
      field === 'arrivalDate'
        ? 'Arrival Date'
        : field === 'departureDate'
        ? 'Departure Date'
        : field === 'arrivalTime'
        ? 'Arrival Time'
        : 'Departure Time';

    setToastMessage({
      text: `Updated ${fieldLabel} to "${newValue}" for ${reservation.applicantName} only.`,
      type: 'info',
    });

    setPendingTourDateChange(null);
  };

  // Cancel tour date change dialog
  const handleCancelTourDateChange = () => {
    setPendingTourDateChange(null);
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

          {/* Purge Records with Departure Passed for 48 Hours */}
          <button
            onClick={() => {
              if (expiredReservations.length === 0) {
                setToastMessage({
                  text: 'No records found with departure date passed for 48+ hours.',
                  type: 'info'
                });
                return;
              }
              setIsPurgeExpiredModalOpen(true);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer ${
              expiredReservations.length > 0
                ? 'bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-300'
                : 'bg-stone-50 text-stone-600 border border-stone-200 hover:bg-stone-100'
            }`}
            title="Delete any records whose departure date has passed for 48 hours"
          >
            <Clock className={`w-3.5 h-3.5 ${expiredReservations.length > 0 ? 'text-rose-600' : 'text-stone-400'}`} />
            <span>Purge Expired (&gt;48h)</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
              expiredReservations.length > 0
                ? 'bg-rose-600 text-white'
                : 'bg-stone-200 text-stone-600'
            }`}>
              {expiredReservations.length}
            </span>
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

        {/* Fit to Screen Toggle & Bulk Portal Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setFitColumnsToScreen((p) => !p)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border transition cursor-pointer shadow-2xs ${
              fitColumnsToScreen
                ? 'bg-[#124E39] text-[#EBD59E] border-[#124E39]'
                : 'bg-white hover:bg-stone-50 text-stone-700 border-stone-300'
            }`}
            title="Toggle Fit All 16 Columns on Screen without horizontal scroll vs Wide Scrollable view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>{fitColumnsToScreen ? 'All Columns on Screen ✓' : 'Scroll View'}</span>
          </button>

          <div className="h-4 w-px bg-stone-300" />

          <span className="text-stone-500 text-xs">Bulk Portal:</span>
          <button
            onClick={() => handleBulkMarkPortal(true)}
            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded text-xs font-bold cursor-pointer"
            title="Mark all filtered zaereen as Uploaded on Main Portal"
          >
            Tick All Filtered
          </button>
          <button
            onClick={() => handleBulkMarkPortal(false)}
            className="px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded text-xs cursor-pointer"
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
      {/* MAIN ZAEREEN GRID TABLE: ALL 16 COLUMNS VISIBLE ON SCREEN                 */}
      {/* ========================================================================= */}
      <div className="bg-white border border-[#E6DFD5] rounded-2xl shadow-sm overflow-hidden flex flex-col w-full">
        <div className={`w-full ${fitColumnsToScreen ? 'overflow-x-auto lg:overflow-visible' : 'overflow-x-auto'}`}>
          <table className={`w-full text-left text-xs border-collapse ${fitColumnsToScreen ? 'table-fixed' : 'min-w-[2000px]'}`}>
            {/* Table Header with interactive sorting on all columns */}
            <thead className="bg-[#124E39] text-white uppercase text-[11px] tracking-wider font-bold select-none sticky top-0 z-10">
              <tr>
                <th className={`py-3 px-1 text-center ${fitColumnsToScreen ? 'w-[36px]' : 'w-14'}`}>
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
                  className={`py-3 px-1.5 cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[78px]' : 'min-w-[115px]'
                  }`}
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
                  className={`py-3 px-1.5 cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[130px]' : 'min-w-[200px]'
                  }`}
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
                  className={`py-3 px-1 text-center cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[42px]' : 'min-w-[65px]'
                  }`}
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
                  className={`py-3 px-1 text-center cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[56px]' : 'min-w-[95px]'
                  }`}
                  title="Click to sort by Family"
                >
                  <div className="flex items-center justify-center">
                    <span>FAM</span>
                    {renderSortIndicator('family')}
                  </div>
                </th>

                {/* 5. Office Name */}
                <th
                  onClick={() => handleSort('officeName')}
                  className={`py-3 px-1.5 cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[105px]' : 'min-w-[180px]'
                  }`}
                  title="Click to sort by Office Name"
                >
                  <div className="flex items-center">
                    <span>OFFICE</span>
                    {renderSortIndicator('officeName')}
                  </div>
                </th>

                {/* 6. TOUR ID */}
                <th
                  onClick={() => handleSort('tourRefNo')}
                  className={`py-3 px-1.5 cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[135px]' : 'min-w-[230px] max-w-[320px]'
                  }`}
                  title="Click to sort by Tour ID"
                >
                  <div className="flex items-center">
                    <span>TOUR ID</span>
                    {renderSortIndicator('tourRefNo')}
                  </div>
                </th>

                {/* 7. Building */}
                <th
                  onClick={() => handleSort('building')}
                  className={`py-3 px-1 text-center cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[70px]' : 'min-w-[110px]'
                  }`}
                  title="Click to sort by Building (Saifee / Burhani)"
                >
                  <div className="flex items-center justify-center">
                    <span>BLDG</span>
                    {renderSortIndicator('building')}
                  </div>
                </th>

                {/* 8. Room Allottment */}
                <th
                  onClick={() => handleSort('roomNumber')}
                  className={`py-3 px-1.5 cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[115px]' : 'min-w-[170px]'
                  }`}
                  title="Click to sort by Room Number"
                >
                  <div className="flex items-center">
                    <span>ROOM</span>
                    {renderSortIndicator('roomNumber')}
                  </div>
                </th>

                {/* 9. Gender */}
                <th
                  onClick={() => handleSort('gender')}
                  className={`py-3 px-1 text-center cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[48px]' : 'min-w-[80px]'
                  }`}
                  title="Click to sort by Gender"
                >
                  <div className="flex items-center justify-center">
                    <span>GEN</span>
                    {renderSortIndicator('gender')}
                  </div>
                </th>

                {/* 10. Group Lead */}
                <th
                  onClick={() => handleSort('groupLeadName')}
                  className={`py-3 px-1.5 cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[100px]' : 'min-w-[170px]'
                  }`}
                  title="Click to sort by Group Lead"
                >
                  <div className="flex items-center">
                    <span>LEAD</span>
                    {renderSortIndicator('groupLeadName')}
                  </div>
                </th>

                {/* 11. Arrival Date */}
                <th
                  onClick={() => handleSort('arrivalDate')}
                  className={`py-3 px-1 text-center cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[88px]' : 'min-w-[130px]'
                  }`}
                  title="Click to sort by Arrival Date"
                >
                  <div className="flex items-center justify-center">
                    <span>ARRIVAL</span>
                    {renderSortIndicator('arrivalDate')}
                  </div>
                </th>

                {/* 12. Departure Date */}
                <th
                  onClick={() => handleSort('departureDate')}
                  className={`py-3 px-1 text-center cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[88px]' : 'min-w-[130px]'
                  }`}
                  title="Click to sort by Departure Date"
                >
                  <div className="flex items-center justify-center">
                    <span>DEPARTURE</span>
                    {renderSortIndicator('departureDate')}
                  </div>
                </th>

                {/* 13. Category Sort (KEPT AT THE END!) */}
                <th
                  onClick={() => handleSort('category')}
                  className={`py-3 px-1 text-center cursor-pointer hover:bg-[#0E3C2C] transition ${
                    fitColumnsToScreen ? 'w-[85px]' : 'min-w-[125px]'
                  }`}
                  title="Click to sort by Category"
                >
                  <div className="flex items-center justify-center">
                    <span>CATEGORY</span>
                    {renderSortIndicator('category')}
                  </div>
                </th>

                {/* 14. Main Portal Tick Button Sort */}
                <th
                  onClick={() => handleSort('portal')}
                  className={`py-3 px-1 text-center bg-[#0E3C2C] cursor-pointer hover:bg-[#08281D] transition ${
                    fitColumnsToScreen ? 'w-[80px]' : 'min-w-[135px]'
                  }`}
                  title="Click to sort by Main Portal upload status"
                >
                  <div className="flex items-center justify-center">
                    <span>PORTAL</span>
                    {renderSortIndicator('portal')}
                  </div>
                </th>

                <th className={`py-3 px-1 text-center ${fitColumnsToScreen ? 'w-[40px]' : 'w-12'}`}>ACT</th>
              </tr>
            </thead>

            {/* Table Body with optimized rendering */}
            <tbody className="divide-y divide-stone-100 text-stone-900 text-xs">
              {filteredAndSortedReservations.length > 0 ? (
                filteredAndSortedReservations.map((res, index) => {
                  const isShiftedToA = !!res.shiftToCategoryA;
                  const isAllotted = !!res.roomNumber && res.roomNumber.trim() !== '';

                  // Effective Pax (infants under 3 do not consume room capacity)
                  const resEffectivePax = isInfant(res) ? 0 : (res.pax || res.paxCount || 1);

                  // Precomputed O(1) family member count
                  const famKey = res.family && res.tourRefNo ? `${res.tourRefNo}___${res.family.trim().toLowerCase()}` : '';
                  const sameFamilyCount = famKey ? (familyCountMap.get(famKey) || 1) : 1;

                  // Available rooms lookup: Instant, memoized, showing all rooms where capacity is not reached!
                  const bldgNorm = (res.building || 'Saifee').trim().toLowerCase();
                  const hotelRooms = rooms.filter((rm) => (rm.building || '').trim().toLowerCase() === bldgNorm);
                  const dateCacheKey = `${bldgNorm}___${(res.arrivalDate || '').slice(0, 10)}___${(res.departureDate || '').slice(0, 10)}`;
                  const cachedAvailable = availableRoomsCache.get(dateCacheKey);
                  const availableRoomsForRes = cachedAvailable || hotelRooms.filter((rm) => rm.status !== 'blocked');
                  const availableRoomSet = new Set(availableRoomsForRes.map((rm) => rm.roomNumber));

                  const isSelected = selectedIds.has(res.id);

                  return (
                    <tr
                      key={res.id}
                      className={`hover:bg-[#FAF7F2] transition ${
                        isSelected ? 'bg-amber-100/40' : !isAllotted ? 'bg-amber-50/25' : ''
                      }`}
                    >
                      {/* Checkbox & Index */}
                      <td className={`py-2 px-1 text-center text-stone-400 font-mono text-[11px] ${fitColumnsToScreen ? 'w-[36px]' : 'w-14'}`}>
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectRow(res.id)}
                            className="w-3.5 h-3.5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-[#124E39]"
                            title="Select record"
                          />
                          <span className="text-[10px] text-stone-400 font-normal">{index + 1}</span>
                        </div>
                      </td>

                      {/* 1. ITS ID */}
                      <td className={`py-2 px-1.5 font-mono font-bold text-stone-950 ${fitColumnsToScreen ? 'w-[78px]' : 'min-w-[115px]'}`}>
                        <input
                          type="text"
                          value={res.itsId}
                          onChange={(e) => handleFieldChange(res.id, 'itsId', e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none font-mono font-bold text-stone-950 text-xs"
                        />
                      </td>

                      {/* 2. Applicant Name */}
                      <td className={`py-2 px-1.5 ${fitColumnsToScreen ? 'w-[130px]' : 'min-w-[200px]'}`}>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={res.applicantName}
                            onChange={(e) => handleFieldChange(res.id, 'applicantName', e.target.value)}
                            title={res.applicantName}
                            className="w-full bg-transparent font-bold text-stone-950 text-xs border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none truncate"
                          />
                          {isShiftedToA && (
                            <span 
                              className="shrink-0 px-1 py-0.2 rounded text-[9px] font-extrabold bg-[#124E39] text-[#EBD59E] border border-[#C5A059]/50 shadow-2xs"
                              title="Shifted to Category A (Nizaam)"
                            >
                              A
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Age */}
                      <td className={`py-2 px-1 text-center text-stone-800 font-semibold ${fitColumnsToScreen ? 'w-[42px]' : 'min-w-[65px]'}`}>
                        <input
                          type="text"
                          value={res.age}
                          onChange={(e) => handleFieldChange(res.id, 'age', e.target.value)}
                          className="w-full text-center bg-transparent border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none font-semibold text-xs"
                        />
                      </td>

                      {/* 4. Family */}
                      <td className={`py-2 px-1 text-center font-mono text-emerald-900 font-extrabold ${fitColumnsToScreen ? 'w-[56px]' : 'min-w-[95px]'}`}>
                        <input
                          type="text"
                          value={res.family}
                          onChange={(e) => handleFieldChange(res.id, 'family', e.target.value)}
                          className="w-full text-center bg-transparent font-mono font-extrabold text-emerald-900 border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none text-xs"
                        />
                      </td>

                      {/* 5. Office Name */}
                      <td className={`py-2 px-1.5 text-stone-800 text-xs font-medium ${fitColumnsToScreen ? 'w-[105px]' : 'min-w-[180px]'}`}>
                        <input
                          type="text"
                          value={res.officeName}
                          onChange={(e) => handleFieldChange(res.id, 'officeName', e.target.value)}
                          title={res.officeName}
                          className="w-full bg-transparent text-stone-800 text-xs font-medium border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none truncate"
                        />
                      </td>

                      {/* 6. TOUR ID */}
                      <td className={`py-2 px-1.5 ${fitColumnsToScreen ? 'w-[135px]' : 'min-w-[230px] max-w-[320px]'}`}>
                        <input
                          type="text"
                          value={res.tourRefNo}
                          onChange={(e) => handleFieldChange(res.id, 'tourRefNo', e.target.value)}
                          title={res.tourRefNo}
                          className="w-full bg-transparent font-mono font-bold text-stone-950 text-xs border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none truncate"
                        />
                      </td>

                      {/* 7. Hotel / Building */}
                      <td className={`py-2 px-1 text-center text-stone-900 font-bold ${fitColumnsToScreen ? 'w-[70px]' : 'min-w-[110px]'}`}>
                        <select
                          value={res.building || 'Saifee'}
                          onChange={(e) => handleFieldChange(res.id, 'building', e.target.value)}
                          className="bg-white border border-stone-200 rounded px-1.5 py-0.5 text-[11px] font-bold text-[#124E39] cursor-pointer shadow-2xs w-full"
                        >
                          {distinctBuildings.map((bldg) => (
                            <option key={bldg} value={bldg}>{bldg}</option>
                          ))}
                        </select>
                      </td>

                      {/* 8. Room Allotted */}
                      <td className={`py-2 px-1.5 ${fitColumnsToScreen ? 'w-[115px]' : 'min-w-[170px]'}`}>
                        <div className="flex flex-col gap-1">
                          {isReadOnly ? (
                            <div className="px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200 text-[11px] font-bold text-stone-700 truncate">
                              {res.roomNumber ? `${res.building} Rm ${res.roomNumber}` : 'Unallotted'}
                            </div>
                          ) : (
                            <>
                              <select
                                value={res.roomNumber || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (onAllotRoom) {
                                    onAllotRoom(res.id, res.building || 'Saifee', val);
                                  } else {
                                    handleFieldChange(res.id, 'roomNumber', val);
                                  }
                                }}
                                className={`w-full text-[11px] font-bold rounded px-1.5 py-0.5 border transition cursor-pointer shadow-2xs ${
                                  isAllotted
                                    ? 'bg-emerald-50 text-emerald-950 border-emerald-300'
                                    : 'bg-amber-100 text-amber-950 border-amber-300 font-bold'
                                }`}
                              >
                                <option value="">-- Allot Room --</option>
                                {res.roomNumber && (
                                  <option value={res.roomNumber}>
                                    Rm {res.roomNumber} ({res.building || 'Saifee'}) ✓ Current
                                  </option>
                                )}
                                {availableRoomsForRes.length > 0 && (
                                  <optgroup label="Available Rooms (Capacity Not Reached)">
                                    {availableRoomsForRes
                                      .filter((rm) => rm.roomNumber !== res.roomNumber)
                                      .map((rm) => (
                                        <option key={rm.id} value={rm.roomNumber}>
                                          Rm {rm.roomNumber} ({rm.floorLabel || `Fl ${rm.floor}`} • Cap {rm.capacity}{rm.buffer ? `+${rm.buffer}` : ''})
                                        </option>
                                      ))}
                                  </optgroup>
                                )}
                                <optgroup label="All Rooms (Notice / Force Allot)">
                                  {hotelRooms
                                    .filter((rm) => rm.roomNumber !== res.roomNumber && !availableRoomSet.has(rm.roomNumber))
                                    .map((rm) => (
                                      <option key={rm.id} value={rm.roomNumber}>
                                        Rm {rm.roomNumber} ({rm.status === 'blocked' ? 'Blocked' : `Cap ${rm.capacity} Pax`})
                                      </option>
                                    ))}
                                </optgroup>
                              </select>

                              {/* Quick Allot Button */}
                              {onOpenQuickAllotModal && (
                                <button
                                  type="button"
                                  onClick={() => onOpenQuickAllotModal(res)}
                                  className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded bg-stone-100 hover:bg-[#124E39] hover:text-[#EBD59E] text-stone-700 border border-stone-300 text-[9px] font-bold shadow-2xs transition"
                                  title="Open Quick Room Allotment modal"
                                >
                                  <Sparkles className="w-2.5 h-2.5 text-amber-600" />
                                  <span>Allot Modal</span>
                                </button>
                              )}
                            </>
                          )}

                          {/* 1-Click Allot to Family button if family has multiple members */}
                          {!isReadOnly && sameFamilyCount > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!res.roomNumber) {
                                  alert(`Please select a room first in the dropdown, then click here to allot to all ${sameFamilyCount} members of Family ${res.family}.`);
                                  return;
                                }
                                if (onBatchAllotFamily) {
                                  onBatchAllotFamily(res.tourRefNo, res.family, res.building || 'Saifee', res.roomNumber);
                                }
                              }}
                              className="flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-950 border border-emerald-400 text-[9px] font-extrabold shadow-2xs transition truncate"
                              title={`Allot ${res.building || 'Saifee'} Room ${res.roomNumber || '...'} to all ${sameFamilyCount} members of Family ${res.family}`}
                            >
                              <Users className="w-2.5 h-2.5 text-emerald-800 shrink-0" />
                              <span>Allot Fam ({sameFamilyCount})</span>
                            </button>
                          )}
                        </div>
                      </td>

                      {/* 9. Gender */}
                      <td className={`py-2 px-1 text-center font-medium ${fitColumnsToScreen ? 'w-[48px]' : 'min-w-[80px]'}`}>
                        <select
                          value={res.gender}
                          onChange={(e) => handleFieldChange(res.id, 'gender', e.target.value)}
                          className="bg-transparent text-[11px] font-semibold text-stone-700 cursor-pointer"
                        >
                          <option value="Male">M</option>
                          <option value="Female">F</option>
                        </select>
                      </td>

                      {/* 10. Group Lead Name */}
                      <td className={`py-2 px-1.5 text-stone-900 font-semibold ${fitColumnsToScreen ? 'w-[100px]' : 'min-w-[170px]'}`}>
                        <input
                          type="text"
                          value={res.groupLeadName}
                          onChange={(e) => handleFieldChange(res.id, 'groupLeadName', e.target.value)}
                          title={res.groupLeadName}
                          className="w-full bg-transparent text-stone-900 text-xs font-semibold border-b border-transparent hover:border-stone-300 focus:border-emerald-700 focus:outline-none truncate"
                        />
                      </td>

                      {/* 11. Arrival Date & Time */}
                      <td className={`py-2 px-1 text-center text-stone-900 font-medium ${fitColumnsToScreen ? 'w-[88px]' : 'min-w-[130px]'}`}>
                        <input
                          type="date"
                          value={res.arrivalDate ? res.arrivalDate.slice(0, 10) : ''}
                          onChange={(e) => handleFieldChange(res.id, 'arrivalDate', e.target.value)}
                          className="bg-transparent font-semibold text-stone-900 cursor-pointer focus:outline-none text-[11px] w-full"
                        />
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          <span
                            className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-indigo-50 text-indigo-700 font-bold text-[9px] border border-indigo-200"
                            title="Edit Arrival Time"
                          >
                            <Clock className="w-2.5 h-2.5 text-indigo-600 shrink-0" />
                            <select
                              value={res.arrivalTime || '11:00 AM'}
                              onChange={(e) => handleFieldChange(res.id, 'arrivalTime', e.target.value)}
                              className="bg-transparent text-indigo-950 font-bold text-[9px] focus:outline-none cursor-pointer"
                            >
                              {STANDARD_TIMES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                              {res.arrivalTime && !STANDARD_TIMES.includes(res.arrivalTime) && (
                                <option value={res.arrivalTime}>{res.arrivalTime}</option>
                              )}
                            </select>
                          </span>
                        </div>
                      </td>

                      {/* 12. Departure Date & Time */}
                      <td className={`py-2 px-1 text-center text-stone-900 font-medium ${fitColumnsToScreen ? 'w-[88px]' : 'min-w-[130px]'}`}>
                        <input
                          type="date"
                          value={res.departureDate ? res.departureDate.slice(0, 10) : ''}
                          onChange={(e) => handleFieldChange(res.id, 'departureDate', e.target.value)}
                          className="bg-transparent font-semibold text-stone-900 cursor-pointer focus:outline-none text-[11px] w-full"
                        />
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          <span
                            className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-amber-50 text-amber-800 font-bold text-[9px] border border-amber-200"
                            title="Edit Departure Time"
                          >
                            <Clock className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                            <select
                              value={res.departureTime || '01:00 AM'}
                              onChange={(e) => handleFieldChange(res.id, 'departureTime', e.target.value)}
                              className="bg-transparent text-amber-950 font-bold text-[9px] focus:outline-none cursor-pointer"
                            >
                              {STANDARD_TIMES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                              {res.departureTime && !STANDARD_TIMES.includes(res.departureTime) && (
                                <option value={res.departureTime}>{res.departureTime}</option>
                              )}
                            </select>
                          </span>
                        </div>
                      </td>

                      {/* 13. Category */}
                      <td className={`py-2 px-1 text-center ${fitColumnsToScreen ? 'w-[85px]' : 'min-w-[125px]'}`}>
                        {renderCategoryBadge(res)}
                      </td>

                      {/* 14. Main Portal Upload Status */}
                      <td className={`py-2 px-1 text-center bg-stone-50/60 ${fitColumnsToScreen ? 'w-[80px]' : 'min-w-[135px]'}`}>
                        <button
                          type="button"
                          onClick={() =>
                            handleFieldChange(res.id, 'isUploadedToPortal', !res.isUploadedToPortal)
                          }
                          className={`inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold transition shadow-2xs cursor-pointer ${
                            res.isUploadedToPortal
                              ? 'bg-[#124E39] text-[#EBD59E] border border-[#124E39]'
                              : 'bg-white hover:bg-stone-100 text-stone-500 border border-stone-300'
                          }`}
                          title={res.isUploadedToPortal ? 'Uploaded to portal (Click to untick)' : 'Mark uploaded'}
                        >
                          {res.isUploadedToPortal ? (
                            <>
                              <CheckSquare className="w-3.5 h-3.5 text-[#EBD59E]" />
                              <span>Done ✓</span>
                            </>
                          ) : (
                            <>
                              <Square className="w-3.5 h-3.5 text-stone-400" />
                              <span>Tick</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className={`py-2 px-1 text-center ${fitColumnsToScreen ? 'w-[40px]' : 'w-12'}`}>
                        <div className="flex items-center justify-center gap-1">
                          {isShiftedToA && (
                            <button
                              type="button"
                              onClick={() => onOpenAccountsSlip(res)}
                              className="p-1 text-emerald-800 hover:text-emerald-950 hover:bg-emerald-50 rounded transition cursor-pointer"
                              title="Print Accounts Slip"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setRecordToDelete(res)}
                            className="p-1 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded transition cursor-pointer"
                            title={`Delete record for ${res.applicantName}`}
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

      {/* Common Timings Datalists for 1-Click Autocomplete */}
      <datalist id="common-arrival-times">
        <option value="11:00 AM" />
        <option value="11:30 AM" />
        <option value="12:00 PM" />
        <option value="01:00 PM" />
        <option value="01:15 PM" />
        <option value="01:30 PM" />
        <option value="02:00 PM" />
        <option value="03:00 PM" />
        <option value="04:00 PM" />
        <option value="06:00 PM" />
        <option value="08:00 PM" />
        <option value="10:00 PM" />
        <option value="10:45 AM" />
        <option value="08:00 AM" />
        <option value="09:00 AM" />
        <option value="10:00 AM" />
      </datalist>

      <datalist id="common-departure-times">
        <option value="01:00 AM" />
        <option value="02:00 AM" />
        <option value="08:00 AM" />
        <option value="08:30 AM" />
        <option value="09:00 AM" />
        <option value="09:15 AM" />
        <option value="09:30 AM" />
        <option value="10:00 AM" />
        <option value="11:00 AM" />
        <option value="12:00 PM" />
        <option value="01:00 PM" />
        <option value="02:00 PM" />
      </datalist>

      {/* Tour Date/Time Batch Change Prompt Modal */}
      {pendingTourDateChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-lg w-full overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-[#124E39]">
                <Calendar className="w-5 h-5 text-[#124E39]" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-stone-900">
                  Update Tour Schedule for All Zaereen?
                </h3>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="font-mono text-xs font-black text-[#124E39] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Tour: {pendingTourDateChange.tourId}
                  </span>
                  <span className="text-xs text-stone-500 font-semibold">
                    • {pendingTourDateChange.allTourZaereen.length} Zaereen Total
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelTourDateChange}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer rounded-lg"
                title="Cancel changes"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Change Detail Card */}
            <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between pb-1.5 border-b border-stone-200">
                <span className="font-bold text-stone-700">
                  {pendingTourDateChange.field === 'arrivalDate'
                    ? 'Arrival Date'
                    : pendingTourDateChange.field === 'departureDate'
                    ? 'Departure Date'
                    : pendingTourDateChange.field === 'arrivalTime'
                    ? 'Arrival Time'
                    : 'Departure Time'}{' '}
                  Changed:
                </span>
                <span className="font-bold text-stone-900 truncate max-w-[220px]" title={pendingTourDateChange.reservation.applicantName}>
                  {pendingTourDateChange.reservation.applicantName} (ITS: {pendingTourDateChange.reservation.itsId})
                </span>
              </div>

              <div className="flex items-center justify-center gap-3 py-1 font-mono text-xs">
                <div className="px-2.5 py-1 rounded-md bg-stone-100 text-stone-600 border border-stone-200 text-center min-w-[100px]">
                  <span className="text-[10px] block text-stone-400 font-sans uppercase font-bold">Current</span>
                  <span className="font-bold">{pendingTourDateChange.oldValue || '—'}</span>
                </div>
                <span className="text-stone-400 font-bold text-sm">➔</span>
                <div className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-950 border border-emerald-300 font-bold text-center min-w-[100px]">
                  <span className="text-[10px] block text-emerald-700 font-sans uppercase font-bold">New Value</span>
                  <span>{pendingTourDateChange.newValue}</span>
                </div>
              </div>

              <p className="text-[11px] text-stone-600 pt-1 leading-relaxed">
                There are <strong>{pendingTourDateChange.allTourZaereen.length} zaereen</strong> in Tour{' '}
                <strong className="font-mono text-[#124E39]">{pendingTourDateChange.tourId}</strong>. Would you like to apply this new {pendingTourDateChange.field.includes('Date') ? 'date' : 'time'} to all zaereen of the same tour ID, or change it for <strong>{pendingTourDateChange.reservation.applicantName}</strong> only?
              </p>
            </div>

            {/* List preview of all zaereen in this tour */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-stone-500 font-semibold px-1">
                <span>Zaereen in Tour ({pendingTourDateChange.allTourZaereen.length}):</span>
                <span>Family & Room</span>
              </div>
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-2 max-h-36 overflow-y-auto space-y-1 text-xs">
                {pendingTourDateChange.allTourZaereen.map((m) => {
                  const isCurrent = m.id === pendingTourDateChange.reservation.id;
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center justify-between py-1 px-2 rounded ${
                        isCurrent ? 'bg-emerald-50 border border-emerald-200 font-bold text-emerald-950' : 'bg-white border border-stone-100 text-stone-800'
                      }`}
                    >
                      <div className="truncate max-w-[240px]">
                        <span>{m.applicantName}</span>
                        {isCurrent && <span className="text-[10px] text-emerald-700 ml-1 font-semibold">(Selected)</span>}
                        <span className="font-mono text-stone-400 ml-1 text-[11px]">({m.itsId || '—'})</span>
                      </div>
                      <div className="font-mono text-[11px] text-stone-600 shrink-0">
                        Fam #{m.family || '—'} • {m.roomNumber ? `${m.building} Rm ${m.roomNumber}` : 'Unallotted'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelTourDateChange}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-100 font-semibold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApplyToSingle}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer"
                title={`Apply ${pendingTourDateChange.newValue} only to ${pendingTourDateChange.reservation.applicantName}`}
              >
                <User className="w-3.5 h-3.5 text-stone-600" />
                <span>Change for This Zaer Only</span>
              </button>
              <button
                type="button"
                onClick={handleConfirmApplyToAllTour}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
                title={`Apply ${pendingTourDateChange.newValue} to all ${pendingTourDateChange.allTourZaereen.length} zaereen in Tour ${pendingTourDateChange.tourId}`}
              >
                <Users className="w-4 h-4 text-[#EBD59E]" />
                <span>Update All ({pendingTourDateChange.allTourZaereen.length}) in Tour</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User requirement: Purge Expired (>48h Departure) Records Modal */}
      {isPurgeExpiredModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 flex flex-col max-h-[90vh]">
            <div className="flex items-start justify-between pb-4 border-b border-stone-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-stone-900">
                    Purge Expired Records (&gt;48h Departure)
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Permanently delete completed zaereen records whose departure date was 48+ hours ago.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPurgeExpiredModalOpen(false)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3 flex-1 overflow-y-auto">
              {expiredReservations.length > 0 ? (
                <>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      Found <strong>{expiredReservations.length}</strong> record{expiredReservations.length > 1 ? 's' : ''} whose departure was 48 hours or more in the past.
                    </span>
                  </div>

                  <div className="border border-stone-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-stone-100 text-stone-700 uppercase text-[10px] sticky top-0">
                        <tr>
                          <th className="py-2 px-3">ITS</th>
                          <th className="py-2 px-3">Applicant Name</th>
                          <th className="py-2 px-3">Family & Tour</th>
                          <th className="py-2 px-3">Room</th>
                          <th className="py-2 px-3 text-right">Departure & Elapsed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 font-medium text-stone-800">
                        {expiredReservations.map((r) => {
                          const elapsed = getDepartureElapsedHours(r);
                          return (
                            <tr key={r.id} className="hover:bg-stone-50">
                              <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.itsId}</td>
                              <td className="py-2 px-3 font-semibold">{r.applicantName}</td>
                              <td className="py-2 px-3 text-[11px] text-stone-600 font-mono">
                                {r.family} • {r.tourRefNo}
                              </td>
                              <td className="py-2 px-3 text-emerald-800 font-bold">
                                {r.roomNumber ? `${r.building} Rm ${r.roomNumber}` : '—'}
                              </td>
                              <td className="py-2 px-3 text-right">
                                <span className="font-semibold text-rose-700">
                                  {r.departureDate} {r.departureTime || ''}
                                </span>
                                <span className="block text-[10px] text-stone-400">
                                  ({elapsed > 0 ? `${elapsed}h ago` : '48h+ passed'})
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-stone-500 text-sm">
                  No records currently match the criteria (departure date passed for 48+ hours).
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-stone-100 flex items-center justify-between gap-3">
              <span className="text-xs text-stone-500">
                Action is permanent and cleans up the active database.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPurgeExpiredModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePurgeExpiredRecords}
                  disabled={expiredReservations.length === 0}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete {expiredReservations.length} Expired Record{expiredReservations.length > 1 ? 's' : ''}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Feedback Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg border text-xs font-bold ${
              toastMessage.type === 'success'
                ? 'bg-[#124E39] text-[#EBD59E] border-[#124E39]'
                : 'bg-stone-800 text-white border-stone-700'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-[#EBD59E] shrink-0" />
            <span>{toastMessage.text}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="ml-2 text-stone-300 hover:text-white cursor-pointer"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
