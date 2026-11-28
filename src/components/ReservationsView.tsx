import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  User,
  Users,
  ArrowUpRight,
  ArrowRight,
  FileSpreadsheet,
  Upload,
  Download,
  CheckSquare,
  Square,
  FileText,
  Info,
  Check,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Sparkles,
  LayoutGrid,
  ShieldAlert,
  Star,
  ArrowRightLeft,
  RotateCcw
} from 'lucide-react';
import { Reservation, Room, DEFAULT_ZAEREEN_CATEGORIES, UserRole, type TravelLeg } from '../types';
import { SpecialGuestModal } from './SpecialGuestModal';
import {
  PageHeader,
  Dropdown,
  MenuItem,
  MenuDivider,
  btn,
  btnSm,
  btnDanger,
  chip,
  card,
  panel,
  field,
  fieldLabel,
  modalScrim,
  modalCard,
  modalHeader,
  modalTitle,
  modalClose,
  modalFooter,
} from './ui';
import { SwitchRoomTarget } from './SwitchRoomModal';
import {
  getVacantRoomsForDuration,
  checkRoomAllotmentAvailability,
  normalizeBuildingName,
  getDistinctBuildings,
  getRoomBedCount,
} from '../services/storage';
import { normalizeDate } from '../services/excelService';
import { generateAdministrativePdf } from '../services/pdfExport';
import { hasDeparturePassed48Hours, getDepartureElapsedHours, extractCleanTime } from '../utils/turnoverTiming';
import { ZairPhoto, photoUrl, type PhotoIndex } from './ZairPhoto';
import { oneRowPerIts } from '../utils/deduplication';
import { HiddenStaysModal } from './HiddenStaysModal';

/** Baghdad calendar date. */
const baghdadDay = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const stayDay = (v?: string) => {
  const d = String(v || '').slice(0, 10);
  const date = new Date(d + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
/** "3 Dec – 6 Dec · Burhani 203" for each other record of the same ITS. */
const describeOtherStays = (others: Reservation[]) => others.map((o) =>
  `${stayDay(o.arrivalDate)} – ${stayDay(o.departureDate)}${o.roomNumber ? ` · ${o.building} ${o.roomNumber}` : o.building ? ` · ${o.building}` : ' · no room'}${o.tourRefNo ? ` · ${String(o.tourRefNo).replace(/^NKERP\/TOUR\//i, '')}` : ''}`).join('\n');

const OtherStays: React.FC<{ others?: Reservation[] }> = ({ others }) => others?.length ? (
  <span className={`${chip('neutral')} shrink-0 cursor-help tabular-nums`}
    title={`Same ITS, ${others.length === 1 ? 'one more record' : `${others.length} more records`} (shown as one row):\n${describeOtherStays(others)}`}>
    +{others.length} stay{others.length > 1 ? 's' : ''}
  </span>
) : null;

/** "24 Nov 2026" for display only; stored values and input values stay as they are. */
const longDay = (v?: string) => {
  const d = String(v || '').slice(0, 10);
  const date = new Date(d + 'T00:00:00Z');
  return !d || Number.isNaN(date.getTime())
    ? d || '—'
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
/** "2026/1333": the part of a tour ID that tells tours apart. */
const shortTour = (v?: string) => String(v || '').replace(/^NKERP\/TOUR\//i, '');
const fmtCount = (v: number) => v.toLocaleString('en-US');
const fieldName = (f: 'arrivalDate' | 'departureDate' | 'arrivalTime' | 'departureTime') =>
  f === 'arrivalDate' ? 'Arrival date' : f === 'departureDate' ? 'Departure date' : f === 'arrivalTime' ? 'Arrival time' : 'Departure time';

/* Table pieces. Every inline control is 32px tall with a quiet border that firms up on hover and focus. */
const cellBox =
  'block h-8 min-w-0 rounded-md border border-transparent bg-transparent truncate hover:border-stone-300 hover:bg-white focus:border-brand-500 focus:bg-white';
const cellInput = `${cellBox} w-full px-1.5 text-[13px]`;
const cellSelect =
  'block h-8 rounded-md border border-stone-200 bg-white pl-1.5 pr-0 text-[13px] hover:border-stone-400 focus:border-brand-500 cursor-pointer';
const dateInput = `${cellBox} w-full flex-1 px-1 text-[13px] text-stone-900 tabular-nums cursor-pointer [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60`;
const timeInput = `${cellBox} w-[82px] shrink-0 px-1 text-[13px] text-stone-700 tabular-nums`;
const thCell = 'sticky top-0 border-b border-stone-200 bg-stone-50 p-0 text-xs font-semibold text-stone-600 whitespace-nowrap';
const tdCell = 'border-b border-stone-200 px-1.5 py-1.5 align-top';
const iconGhost = 'inline-flex shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 cursor-pointer';
const iconRing =
  'inline-flex shrink-0 items-center justify-center rounded-lg bg-white text-stone-600 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 hover:text-stone-950 hover:ring-stone-400 cursor-pointer';
const iconDanger = 'inline-flex shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-rose-50 hover:text-rose-700 cursor-pointer';
const needsRoomBtn =
  'inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-amber-50 px-2 text-[13px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 hover:ring-amber-300 cursor-pointer whitespace-nowrap';
const portalDone =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 cursor-pointer whitespace-nowrap';
const portalTodo =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium bg-white text-stone-700 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 hover:ring-stone-400 cursor-pointer whitespace-nowrap';
/** Toolbar fields: 40px on phones, 36px on a desk. */
const filterField = `${field} md:h-9 md:px-2.5 md:text-[13px]`;

/** True from the `md` breakpoint up, so only one of the two layouts (table or phone list) is ever built. */
const useIsDesktop = () => {
  const query = '(min-width: 768px)';
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return matches;
};

/** Tour ID field. In "Fit to screen" it shows the short form until it is focused, then the full ID to edit. */
const TourIdInput: React.FC<{ value: string; short: boolean; onChange: (value: string) => void; className: string }> = ({
  value,
  short,
  onChange,
  className,
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="text"
      value={short && !focused ? shortTour(value) : value}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Tour ID"
      title={value}
      className={className}
    />
  );
};

/** "Rows 1–50 of 1,179" with previous / next. The full form adds rows per page, first / last and the page number. */
const Pager: React.FC<{
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  compact?: boolean;
}> = ({ page, pageCount, from, to, total, pageSize, onPage, onPageSize, compact }) => {
  const nav = `${iconRing} h-8 w-8 max-md:h-10 max-md:w-10 disabled:opacity-40 disabled:cursor-not-allowed`;
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;
  return (
    <nav aria-label="Pages of the zaereen list" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] text-stone-600">
      {!compact && onPageSize && (
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 max-md:h-10 rounded-lg border border-stone-300 bg-white pl-2 pr-1 text-[13px] text-stone-900 tabular-nums"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={0}>All</option>
          </select>
        </label>
      )}
      <span className="tabular-nums" aria-live="polite">
        {total === 0 ? (
          'No rows'
        ) : (
          <>
            Rows <strong className="font-semibold text-stone-900">{fmtCount(from)}–{fmtCount(to)}</strong> of {fmtCount(total)}
          </>
        )}
      </span>
      <div className="flex items-center gap-1">
        {!compact && (
          <button type="button" className={nav} disabled={atStart} onClick={() => onPage(0)} title="First page" aria-label="First page">
            <ChevronsLeft className="w-4 h-4" />
          </button>
        )}
        <button type="button" className={nav} disabled={atStart} onClick={() => onPage(page - 1)} title="Previous page" aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {!compact && (
          <span className="px-1.5 tabular-nums">
            Page {fmtCount(page + 1)} of {fmtCount(pageCount)}
          </span>
        )}
        <button type="button" className={nav} disabled={atEnd} onClick={() => onPage(page + 1)} title="Next page" aria-label="Next page">
          <ChevronRight className="w-4 h-4" />
        </button>
        {!compact && (
          <button type="button" className={nav} disabled={atEnd} onClick={() => onPage(pageCount - 1)} title="Last page" aria-label="Last page">
            <ChevronsRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </nav>
  );
};

interface ReservationsViewProps {
  reservations: Reservation[];
  rooms: Room[];
  categories?: string[];
  onAddReservation: (newReservation: Reservation) => void;
  onUpdateReservation: (updatedReservation: Reservation) => void;
  onBatchUpdateReservations?: (updatedReservations: Reservation[]) => void;
  onDeleteReservation: (id: string) => void;
  /** NKERP stays hidden because they were deleted in the app. */
  hiddenStays?: number;
  onHiddenStaysRestored?: (count: number) => void;
  onBatchDeleteReservations?: (ids: string[]) => void;
  onOpenUploadExcel: () => void;
  onDownloadTemplate: () => void;
  onOpenAccountsSlip: (reservation: Reservation) => void;
  onOpenAToBSlip?: (reservation?: Reservation | null, selectedIds?: string[]) => void;
  onOpenBToASlip?: (reservation?: Reservation | null, selectedIds?: string[]) => void;
  onOpenReceptionSlip?: (tab?: 'arrival_slip' | 'departure_list' | 'turnover' | 'roster' | 'worker_summary' | 'portal_upload') => void;
  onOpenAddZaer?: () => void;
  onOpenAddTourGroup?: () => void;
  onOpenPdfModal?: () => void;
  onOpenCategoriesModal?: () => void;
  onNavigateToShifts?: () => void;
  onBatchAllotFamily?: (tourRefNo: string, family: string, building: string, roomNumber: string) => void;
  onAllotRoom?: (reservationId: string, building: string, roomNumber: string) => void;
  userRole?: UserRole;
  onOpenQuickAllotModal?: (res: Reservation) => void;
  onOpenSwitchRoomModal?: (target: SwitchRoomTarget) => void;
  /** ITS → NKERP photo version, refreshed with every pull. */
  photos?: PhotoIndex;
}

const STANDARD_TIMES = [
  '08:00 AM', '09:00 AM', '10:00 AM', '10:45 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '01:00 PM', '01:15 PM', '02:00 PM', '03:00 PM',
  '04:00 PM', '05:00 PM', '06:00 PM', '07:00 PM', '08:00 PM', '09:00 PM',
  '10:00 PM', '11:00 PM', '01:00 AM', '02:00 AM', '03:00 AM', '04:00 AM'
];

/** Travel note under a date: "SBVN from KARBALA, arrival 11:00". Plain secondary text, one or two lines. */
function TravelDetails({ legs, date, direction, flush }: {
  legs?: TravelLeg[];
  date: string;
  direction: 'arrival' | 'departure';
  /** No side padding (the phone list, where it sits under plain text rather than under an input). */
  flush?: boolean;
}) {
  const visible = legs?.filter(leg => leg.serviceDate === String(date || '').slice(0, 10));
  if (!visible?.length) return null;
  const incoming = direction === 'arrival';
  return (
    <ul className={`mt-0.5 space-y-0.5 text-xs leading-snug text-stone-600 ${flush ? '' : 'px-1.5'}`}>
      {visible.map(leg => {
        const kind = leg.kind === 'subvenue' ? 'SBVN' : leg.kind === 'flight' ? 'Flight' : leg.kind === 'land' ? 'Land' : '';
        const route = leg.location && `${incoming ? 'from' : 'to'} ${leg.location}`;
        const time = leg.localTime?.slice(11, 16);
        const eventDate = leg.localTime?.slice(0, 10);
        const event = leg.kind === 'flight' ? (incoming ? 'lands' : 'takes off') : (incoming ? 'arrival' : 'departure');
        return (
          <li key={JSON.stringify(leg)} className="break-words">
            <span className="text-stone-700">{[kind, leg.flightCode, route].filter(Boolean).join(' ')}</span>
            {time && (
              <span title="Baghdad time" className="tabular-nums">
                , {event} {eventDate !== leg.serviceDate && `${stayDay(eventDate)} `}{time}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const ReservationsView: React.FC<ReservationsViewProps> = ({
  reservations,
  rooms,
  categories = DEFAULT_ZAEREEN_CATEGORIES,
  onAddReservation,
  onUpdateReservation,
  onBatchUpdateReservations,
  onDeleteReservation,
  hiddenStays = 0,
  onHiddenStaysRestored,
  onBatchDeleteReservations,
  onOpenUploadExcel,
  onDownloadTemplate,
  onOpenAccountsSlip,
  onOpenAToBSlip,
  onOpenBToASlip,
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
  onOpenSwitchRoomModal,
  photos,
}) => {
  const isReadOnly = userRole === 'receptionist';
  // Deletion modal state & multi-selection state
  const [recordToDelete, setRecordToDelete] = useState<Reservation | null>(null);
  const [isHiddenStaysOpen, setIsHiddenStaysOpen] = useState(false);
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // B to A Protection: Only Admin can delete B to A records
  const [bToABlockedRecord, setBToABlockedRecord] = useState<Reservation | null>(null);

  // Helper: check if a record belongs to Category B to A
  const isBToARecord = (r?: Reservation | null): boolean => {
    if (!r) return false;
    return Boolean(
      r.shiftToCategoryA ||
      r.category === 'B to A' ||
      (r.category && r.category.toLowerCase().includes('b to a')) ||
      r.id.startsWith('b2a-')
    );
  };

  // Count how many of the currently selected zaereen are in B to A
  const selectedBToACount = useMemo(() => {
    let count = 0;
    selectedIds.forEach((id) => {
      const z = reservations.find((r) => r.id === id);
      if (isBToARecord(z)) count++;
    });
    return count;
  }, [selectedIds, reservations]);

  // User requirement: "Give a button to delete any records which departure date has passed for 48 hours."
  const expiredReservations = useMemo(() => {
    return reservations.filter((r) => hasDeparturePassed48Hours(r));
  }, [reservations]);
  const [isPurgeExpiredModalOpen, setIsPurgeExpiredModalOpen] = useState(false);

  // User requirement: "make allcolumns visible to the screen"
  const [fitColumnsToScreen, setFitColumnsToScreen] = useState(true);

  // User Requirement: Star badge on special guests with remarks (Scope: Guest / Family / Tour ID)
  const [specialGuestModalTarget, setSpecialGuestModalTarget] = useState<Reservation | null>(null);

  const handleOpenSpecialGuestModal = (res: Reservation) => {
    setSpecialGuestModalTarget(res);
  };

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

  // Only one layout is built at a time: the table from the md breakpoint up, the block list on phones.
  const isDesktop = useIsDesktop();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const listTopRef = useRef<HTMLDivElement>(null);
  // The name column sticks to the left edge once the table is scrolled sideways past it.
  const [nameStuck, setNameStuck] = useState(false);

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

  // All buildings in inventory (core 3 + any custom buildings added by user)
  const distinctBuildings = useMemo(() => {
    return getDistinctBuildings(rooms);
  }, [rooms]);

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
  const { rows: filteredAndSortedReservations, others: otherStays } = useMemo(() => {
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
        } else if (normalizeBuildingName(res.building).toLowerCase() !== buildingFilter.toLowerCase()) {
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

    // 3. One row per ITS: the stay that matters now; the row notes the other records.
    return oneRowPerIts(filtered, baghdadDay());
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

  // Everyone counts once, however many records NKERP has for their ITS.
  const totalZaereen = useMemo(() => oneRowPerIts(reservations, baghdadDay()).rows.length, [reservations]);

  // Paging. Only the rows of the current page are rendered; sorting, filtering, selection, bulk actions and
  // exports all keep working on the whole filtered list (filteredAndSortedReservations).
  const [pageSize, setPageSize] = useState<number>(50); // 0 = all rows on one page
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [searchTerm, categoryFilter, buildingFilter, portalUploadFilter, arrivalDateFilter, sortColumn, sortDirection, pageSize]);
  const totalRows = filteredAndSortedReservations.length;
  const rowsPerPage = pageSize > 0 ? pageSize : Math.max(totalRows, 1);
  const pageCount = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * rowsPerPage;
  const pageRows = useMemo(
    () => filteredAndSortedReservations.slice(pageStart, pageStart + rowsPerPage),
    [filteredAndSortedReservations, pageStart, rowsPerPage]
  );

  // Memoized available rooms lookup by date duration and building, for the rows on screen:
  // the rooms where capacity is not reached.
  const availableRoomsCache = useMemo(() => {
    const cache = new Map<string, Room[]>();
    const datePairs = new Set<string>();
    pageRows.forEach((r) => {
      if (r.arrivalDate && r.departureDate) {
        const b = (normalizeBuildingName(r.building) || 'Saifee').toLowerCase();
        const arr = r.arrivalDate.slice(0, 10);
        const dep = r.departureDate.slice(0, 10);
        datePairs.add(`${b}___${arr}___${dep}`);
      }
    });

    datePairs.forEach((pair) => {
      const [bldgNorm, arr, dep] = pair.split('___');
      const bldgRooms = rooms.filter((rm) => normalizeBuildingName(rm.building).toLowerCase() === bldgNorm);
      const bldgName = bldgRooms[0]?.building || normalizeBuildingName(bldgNorm) || 'Saifee';

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
  }, [pageRows, rooms, reservations]);

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
    let ids = Array.from(selectedIds);
    if (userRole !== 'admin') {
      const protectedIds = ids.filter((id) => {
        const z = reservations.find((r) => r.id === id);
        return isBToARecord(z);
      });
      if (protectedIds.length > 0) {
        setToastMessage({
          text: `Blocked: ${protectedIds.length} B to A record${protectedIds.length > 1 ? 's' : ''} can only be deleted by an admin.`,
          type: 'info',
        });
        ids = ids.filter((id) => !protectedIds.includes(id));
      }
    }
    if (ids.length > 0) {
      if (onBatchDeleteReservations) {
        onBatchDeleteReservations(ids);
      } else {
        ids.forEach((id) => onDeleteReservation(id));
      }
    }
    setSelectedIds(new Set());
    setIsBatchDeleteModalOpen(false);
  };

  // User requirement: "Give a button to delete any records which departure date has passed for 48 hours."
  const handlePurgeExpiredRecords = () => {
    if (expiredReservations.length === 0) return;
    let targetExpired = expiredReservations;
    if (userRole !== 'admin') {
      targetExpired = expiredReservations.filter((r) => !isBToARecord(r));
    }
    const ids = targetExpired.map((r) => r.id);
    if (ids.length > 0) {
      if (onBatchDeleteReservations) {
        onBatchDeleteReservations(ids);
      } else {
        ids.forEach((id) => onDeleteReservation(id));
      }
    }
    setIsPurgeExpiredModalOpen(false);
    setToastMessage({
      text: `Deleted ${ids.length} record${ids.length > 1 ? 's' : ''} of zaereen who left more than 48 hours ago.`,
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
      idara: '',
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
    } else if (field === 'category') {
      const catStr = String(value || '').trim().toLowerCase();
      if (catStr.includes('b to a')) {
        const slipDate = new Date().toISOString().slice(0, 10);
        updated.shiftToCategoryA = true;
        updated.accommodationCategory = 'Category A (Nizaam)';
        updated.moneyGiven = target.moneyGiven || 'No';
        updated.requestSlipNo =
          target.requestSlipNo ||
          `SLIP-${target.tourRefNo?.slice(-4) || 'TOUR'}-${target.family || 'FAM'}-${Date.now().toString().slice(-4)}`;
        updated.requestSlipDate = target.requestSlipDate || slipDate;
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
    const { field, newValue, tourId, allTourZaereen } = pendingTourDateChange;

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

    setToastMessage({
      text: `Updated ${fieldName(field).toLowerCase()} to ${field.includes('Date') ? longDay(newValue) : newValue} for all ${updatedTourMembers.length} zaereen in tour ${shortTour(tourId)}.`,
      type: 'success',
    });

    setPendingTourDateChange(null);
  };

  // Confirm: Apply new date/time for this single zaer only
  const handleConfirmApplyToSingle = () => {
    if (!pendingTourDateChange) return;
    const { reservation, field, newValue } = pendingTourDateChange;

    applySingleFieldChange(reservation.id, field, newValue);

    setToastMessage({
      text: `Updated ${fieldName(field).toLowerCase()} to ${field.includes('Date') ? longDay(newValue) : newValue} for ${reservation.applicantName} only.`,
      type: 'info',
    });

    setPendingTourDateChange(null);
  };

  // Cancel tour date change dialog
  const handleCancelTourDateChange = () => {
    setPendingTourDateChange(null);
  };

  // Sortable column header: the whole header cell is a button.
  const renderSortTh = (column: string, label: string, extra = '') => {
    const active = sortColumn === column;
    return (
      <th
        scope="col"
        aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`${thCell} ${extra || 'z-10'}`}
      >
        <button
          type="button"
          onClick={() => handleSort(column)}
          title={`Sort by ${label}`}
          className={`group/sort flex h-10 w-full items-center gap-0.5 px-3 text-left cursor-pointer hover:text-stone-950 ${
            active ? 'text-stone-950' : ''
          }`}
        >
          <span className="truncate">{label}</span>
          {active ? (
            sortDirection === 'asc' ? (
              <ArrowUp className="w-3 h-3 shrink-0 text-brand-600" />
            ) : (
              <ArrowDown className="w-3 h-3 shrink-0 text-brand-600" />
            )
          ) : (
            <ArrowUpDown className="hidden w-3 h-3 shrink-0 text-stone-400 group-hover/sort:block group-focus-visible/sort:block" />
          )}
        </button>
      </th>
    );
  };

  // Category: plain editable text for ordinary categories, a chip only when it carries state (B to A, A to B).
  const renderCategoryCell = (res: Reservation) => {
    const rawCat = (res.category || '').trim();
    const lower = rawCat.toLowerCase();
    const isDefault = !rawCat || lower === 'mumineen';
    const isShift = lower.includes('b to a') || lower.includes('a to b');
    const options = (
      <>
        {!res.category && <option value="">—</option>}
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        {!categories.includes(res.category) && res.category && (
          <option value={res.category}>{res.category}</option>
        )}
      </>
    );

    if (isShift) {
      return (
        <div
          className="relative flex h-8 items-center px-1.5 rounded-md focus-within:outline-2 focus-within:outline-brand-500"
          title="Category: click to change"
        >
          <span className={chip('special')}>
            {rawCat}
            <ChevronDown className="w-3 h-3" />
          </span>
          <select
            value={res.category || ''}
            onChange={(e) => handleFieldChange(res.id, 'category', e.target.value)}
            aria-label="Category"
            className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
          >
            {options}
          </select>
        </div>
      );
    }

    return (
      <select
        value={res.category || ''}
        onChange={(e) => handleFieldChange(res.id, 'category', e.target.value)}
        aria-label="Category"
        title={isDefault ? 'Category: Mumineen (default). Click to change' : 'Category: click to change'}
        className={`${cellBox} w-full pl-1.5 pr-0 text-[13px] cursor-pointer ${
          isDefault ? 'text-stone-500' : 'font-medium text-stone-900'
        }`}
      >
        {options}
      </select>
    );
  };

  const hasActiveFilters =
    searchTerm.trim() !== '' ||
    categoryFilter !== 'ALL' ||
    buildingFilter !== 'ALL' ||
    portalUploadFilter !== 'ALL' ||
    arrivalDateFilter !== 'ALL';

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('ALL');
    setBuildingFilter('ALL');
    setPortalUploadFilter('ALL');
    setArrivalDateFilter('ALL');
  };

  const goToPage = (next: number) => {
    setPage(Math.max(0, Math.min(next, pageCount - 1)));
    tableScrollRef.current?.scrollTo({ top: 0 });
    if (!isDesktop) listTopRef.current?.scrollIntoView({ block: 'start' });
  };

  const pagerProps = {
    page: currentPage,
    pageCount,
    from: totalRows === 0 ? 0 : pageStart + 1,
    to: pageStart + pageRows.length,
    total: totalRows,
    pageSize,
    onPage: goToPage,
  };

  // Selection covers every filtered row, so say when part of it is on another page.
  const selectedOnPage = pageRows.reduce((count, r) => count + (selectedIds.has(r.id) ? 1 : 0), 0);
  const selectedElsewhere = selectedIds.size - selectedOnPage;

  // Column widths in px. "Fit to screen" squeezes the text columns; "Wide" gives every column room.
  const pageHasPhoto = pageRows.some((r) => Boolean(photoUrl(photos, r.itsId)));
  const columnWidths = fitColumnsToScreen
    ? [56, pageHasPhoto ? 108 : 60, 88, 196, 60, 78, 96, 96, 98, 224, 80, 92, 192, 192, 100, 80, 72]
    : [64, pageHasPhoto ? 108 : 60, 112, 250, 64, 84, 200, 190, 124, 232, 84, 190, 204, 204, 150, 96, 80];
  const tableMinWidth = columnWidths.reduce((sum, w) => sum + w, 0);
  const nameColumnLeft = columnWidths[0] + columnWidths[1] + columnWidths[2];

  const emptyState = (
    <div className="mx-auto max-w-md px-4 py-12 text-center">
      <div className="text-[15px] font-semibold text-stone-900">
        {reservations.length === 0 ? 'No zaereen on the list yet' : 'No zaereen match these filters'}
      </div>
      <p className="mt-1 text-sm text-stone-600">
        {reservations.length === 0
          ? 'Upload the Excel sheet or add a zair, and they will appear here.'
          : 'Change the search or the filters to see more of the list.'}
      </p>
      <div className="mt-4 flex justify-center">
        {reservations.length === 0 ? (
          <button type="button" onClick={onOpenUploadExcel} className={btn.secondary}>
            <Upload className="w-4 h-4 text-stone-500" />
            Upload Excel
          </button>
        ) : (
          <button type="button" onClick={clearFilters} className={btn.secondary}>
            <X className="w-4 h-4 text-stone-500" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Page header */}
      <PageHeader
        title="Zaereen"
        description={`${totalZaereen} zaereen on the list. Search, allot rooms and track portal uploads.`}
        actions={
          <>
            <Dropdown
              label="More actions"
              width="w-72"
              trigger={(open) => (
                <span className={`${btn.ghost} ${open ? 'bg-stone-200/60 text-stone-900' : ''}`}>
                  More
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                </span>
              )}
            >
              {(close) => (
                <>
                  <MenuItem icon={Download} onClick={() => { close(); onDownloadTemplate(); }} hint="Blank file with the required columns">
                    Excel template
                  </MenuItem>
                  {onOpenCategoriesModal && (
                    <MenuItem icon={FileSpreadsheet} onClick={() => { close(); onOpenCategoriesModal(); }} hint={`${categories.length} saved categories`}>
                      Zaereen categories
                    </MenuItem>
                  )}
                  {onNavigateToShifts && (
                    <MenuItem icon={ArrowUpRight} onClick={() => { close(); onNavigateToShifts(); }}>
                      B→A shifts and accounts
                    </MenuItem>
                  )}
                  {onOpenAToBSlip && (
                    <MenuItem icon={FileText} onClick={() => { close(); onOpenAToBSlip(null); }} hint="Two-page A→B accounts slip for each tour">
                      A→B slip
                    </MenuItem>
                  )}
                  <MenuItem icon={RotateCcw} onClick={() => { close(); setIsHiddenStaysOpen(true); }}
                    hint={hiddenStays ? `${hiddenStays} NKERP stays hidden because they were deleted` : 'Nothing hidden'}>
                    Deleted NKERP stays
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem
                    icon={Clock}
                    tone={expiredReservations.length > 0 ? 'danger' : 'default'}
                    onClick={() => {
                      close();
                      if (expiredReservations.length === 0) {
                        setToastMessage({ text: 'No records have a departure more than 48 hours ago.', type: 'info' });
                        return;
                      }
                      setIsPurgeExpiredModalOpen(true);
                    }}
                    hint={expiredReservations.length > 0 ? `${expiredReservations.length} records left more than 48 hours ago` : 'Nothing to remove'}
                  >
                    Remove departed zaereen
                  </MenuItem>
                </>
              )}
            </Dropdown>
            <button type="button" onClick={onOpenUploadExcel} className={btn.secondary}>
              <Upload className="w-4 h-4 text-stone-500" />
              Upload Excel
            </button>
            {onOpenAddTourGroup && (
              <button type="button" onClick={onOpenAddTourGroup} className={btn.secondary} title="Add several zaereen who share a tour ID and dates">
                <Users className="w-4 h-4 text-stone-500" />
                Add tour group
              </button>
            )}
            <button type="button" onClick={onOpenAddZaer || handleAddNewRow} className={btn.primary}>
              <Plus className="w-4 h-4" />
              Add zair
            </button>
          </>
        }
      />

      {/* Toolbar: find and filter on the first line, view and bulk portal actions on the second */}
      <div className={`${card} p-4`}>
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end">
          <div className="col-span-2 md:flex-1 md:min-w-[220px]">
            <label htmlFor="zaereen-search" className={fieldLabel}>Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                id="zaereen-search"
                type="text"
                placeholder="ITS, name, family, office, tour ID or room"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`${filterField} pl-9 md:pl-9`}
              />
            </div>
          </div>

          <div className="md:w-[150px]">
            <label htmlFor="zaereen-filter-category" className={fieldLabel}>Category</label>
            <select
              id="zaereen-filter-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={filterField}
            >
              <option value="ALL">All categories ({categories.length})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="md:w-[150px]">
            <label htmlFor="zaereen-filter-hotel" className={fieldLabel}>Hotel</label>
            <select
              id="zaereen-filter-hotel"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
              className={filterField}
            >
              <option value="ALL">All hotels</option>
              {distinctBuildings.map((bldg) => (
                <option key={bldg} value={bldg}>{bldg} Hotel</option>
              ))}
              <option value="Unallotted">Unallotted (no room)</option>
            </select>
          </div>

          <div className="md:w-[130px]">
            <label htmlFor="zaereen-filter-portal" className={fieldLabel}>Portal</label>
            <select
              id="zaereen-filter-portal"
              value={portalUploadFilter}
              onChange={(e) => setPortalUploadFilter(e.target.value)}
              className={filterField}
            >
              <option value="ALL">All</option>
              <option value="Uploaded">Uploaded</option>
              <option value="Pending">Pending</option>
            </select>
          </div>

          <div className="md:w-[190px]">
            <label htmlFor="zaereen-filter-arrival" className={fieldLabel}>Arrival date</label>
            <select
              id="zaereen-filter-arrival"
              value={arrivalDateFilter}
              onChange={(e) => setArrivalDateFilter(e.target.value)}
              className={filterField}
            >
              <option value="ALL">All arrival dates</option>
              {distinctArrivalDates.map(({ date, count }) => (
                <option key={date} value={date}>
                  {longDay(date)} ({count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* One-click PDF for the chosen arrival date, joined or per hotel */}
        {arrivalDateFilter !== 'ALL' && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-stone-50 px-3 py-2">
            <span className="text-[13px] text-stone-700">
              PDF of arrivals on <span className="font-semibold text-stone-950">{longDay(arrivalDateFilter)}</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
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
                className={`${btnSm.secondary} max-md:h-10`}
                title={`Download the official PDF for arrival date ${arrivalDateFilter} (${buildingFilter === 'ALL' ? 'both hotels, joined' : `${buildingFilter} Hotel`})`}
              >
                <Download className="w-4 h-4 text-stone-500" />
                {buildingFilter === 'ALL' ? 'Download PDF' : `Download ${buildingFilter} PDF`}
              </button>
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
                className={`${btnSm.ghost} max-md:h-10`}
                title={`Download a separate Saifee Hotel PDF for arrival date ${arrivalDateFilter}`}
              >
                Saifee only
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
                className={`${btnSm.ghost} max-md:h-10`}
                title={`Download a separate Burhani Hotel PDF for arrival date ${arrivalDateFilter}`}
              >
                Burhani only
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-stone-200 pt-3">
          {/* Column width (the table is not shown on phones) */}
          <div className="hidden md:flex items-center gap-2">
            <span className="text-[13px] font-medium text-stone-700">Columns</span>
            <div
              className="inline-flex h-8 items-center rounded-lg bg-stone-100 p-0.5"
              title="Fit all columns on screen, or scroll sideways for wider columns"
            >
              <button
                type="button"
                aria-pressed={fitColumnsToScreen}
                onClick={() => setFitColumnsToScreen(true)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium cursor-pointer ${
                  fitColumnsToScreen ? 'bg-white text-stone-950 shadow-xs' : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Fit to screen
              </button>
              <button
                type="button"
                aria-pressed={!fitColumnsToScreen}
                onClick={() => setFitColumnsToScreen(false)}
                className={`inline-flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium cursor-pointer ${
                  !fitColumnsToScreen ? 'bg-white text-stone-950 shadow-xs' : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                Wide columns
              </button>
            </div>
          </div>

          {/* Bulk portal: always the whole filtered list, not just the page on screen */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-stone-700">
              Bulk portal <span className="font-normal text-stone-500">({fmtCount(totalRows)} filtered)</span>
            </span>
            <button
              type="button"
              onClick={() => handleBulkMarkPortal(true)}
              className={`${btnSm.secondary} max-md:h-10`}
              title="Mark all filtered zaereen as uploaded on the main portal"
            >
              <CheckSquare className="w-4 h-4 text-stone-500" />
              Tick all filtered
            </button>
            <button
              type="button"
              onClick={() => handleBulkMarkPortal(false)}
              className={`${btnSm.ghost} max-md:h-10`}
              title="Mark all filtered zaereen as pending"
            >
              Untick all
            </button>
          </div>

          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className={`${btnSm.ghost} max-md:h-10 md:ml-auto`}>
              <X className="w-4 h-4" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Allot a whole family: tour, family, building, vacant room, go */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold text-stone-950">Allot a whole family</h2>
          <p className="text-[13px] text-stone-600">
            Pick a tour and family, then a vacant room, to give every member the same room.
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 lg:flex lg:items-end">
          <div className="col-span-2 lg:w-[150px] lg:shrink-0">
            <label htmlFor="family-allot-tour" className={fieldLabel}>Tour ID</label>
            <select
              id="family-allot-tour"
              value={batchTourId}
              onChange={(e) => {
                setBatchTourId(e.target.value);
                setBatchFamily('');
                setBatchRoomNumber('');
              }}
              className={`${filterField} tabular-nums`}
            >
              <option value="">All tours</option>
              {distinctTourIds.map((tid) => (
                <option key={tid} value={tid}>
                  {shortTour(tid)}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:w-[164px] lg:shrink-0">
            <label htmlFor="family-allot-family" className={fieldLabel}>Family</label>
            <select
              id="family-allot-family"
              value={batchFamily}
              onChange={(e) => {
                setBatchFamily(e.target.value);
                setBatchRoomNumber('');
              }}
              className={`${filterField} tabular-nums`}
            >
              <option value="">Choose a family</option>
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

          <div className="lg:w-[116px] lg:shrink-0">
            <label htmlFor="family-allot-building" className={fieldLabel}>Building</label>
            <select
              id="family-allot-building"
              value={batchBuilding}
              onChange={(e) => {
                setBatchBuilding(e.target.value);
                setBatchRoomNumber('');
              }}
              className={filterField}
            >
              {distinctBuildings.map((bldg) => (
                <option key={bldg} value={bldg}>{bldg}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2 lg:min-w-0 lg:flex-1">
            <label htmlFor="family-allot-room" className={fieldLabel}>Vacant room</label>
            <select
              id="family-allot-room"
              value={batchRoomNumber}
              onChange={(e) => setBatchRoomNumber(e.target.value)}
              disabled={!batchFamily}
              className={`${filterField} tabular-nums`}
            >
              <option value="">{batchFamily ? 'Choose a vacant room' : 'Choose a family first'}</option>
              {vacantRoomsForFamily.map((rm) => (
                <option key={rm.id} value={rm.roomNumber}>
                  Room {rm.roomNumber} ({rm.floorLabel || `Fl ${rm.floor}`} • {getRoomBedCount(rm)} beds • Pax {rm.capacity}{rm.buffer ? ` +${rm.buffer} buffer` : ''} • {rm.toiletType || 'Standard'} • {rm.bedType || 'Single beds'})
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 flex items-center gap-2 lg:shrink-0">
            <button
              type="button"
              disabled={!batchFamily || !batchRoomNumber}
              onClick={() => {
                if (batchFamily && batchRoomNumber && onBatchAllotFamily) {
                  onBatchAllotFamily(batchTourId, batchFamily, batchBuilding, batchRoomNumber);
                  setBatchRoomNumber('');
                }
              }}
              className={`${btn.primary} md:h-9 max-lg:flex-1`}
            >
              <Users className="w-4 h-4" />
              Allot all ({selectedFamilyMembers.length}) members
            </button>

            {batchFamily && (
              <button
                type="button"
                onClick={() => {
                  if (onBatchAllotFamily) {
                    onBatchAllotFamily(batchTourId, batchFamily, batchBuilding, '');
                  }
                }}
                className={`${btnSm.danger} max-md:h-10 md:h-9`}
                title="Clear the room allotment for this family"
              >
                Clear room
              </button>
            )}
          </div>
        </div>

        {/* The chosen family, so staff can see who is about to move */}
        {selectedFamilyMembers.length > 0 && (
          <div className="mt-4 border-t border-stone-200 pt-3">
            <div className="text-[13px] font-medium text-stone-700">
              Family {batchFamily} · {selectedFamilyMembers.length} zaereen
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {selectedFamilyMembers.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="font-medium text-stone-900">{m.applicantName}</span>
                  <span className="text-stone-500 tabular-nums">ITS {m.itsId}, age {m.age}</span>
                  {m.roomNumber ? (
                    <span className={chip('ok')}>{m.building} {m.roomNumber}</span>
                  ) : (
                    <span className={chip('wait')}>Needs room</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Bulk actions for the selection (stays on screen while scrolling) */}
      {selectedIds.size > 0 && (
        <div className="sticky top-[68px] lg:top-3 z-30 rounded-xl border border-brand-300 bg-brand-50 px-4 py-2.5 shadow-xl animate-in slide-in-from-top-2 md:flex md:flex-wrap md:items-center md:justify-between md:gap-x-4 md:gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-brand-800 tabular-nums">{fmtCount(selectedIds.size)} selected</span>
            {selectedElsewhere > 0 && (
              <span className="text-[13px] text-stone-600 tabular-nums">
                {fmtCount(selectedElsewhere)} of them not on this page
              </span>
            )}
          </div>

          <div className="app-scroll-x flex items-center gap-2 max-md:-mx-4 max-md:mt-2 max-md:overflow-x-auto max-md:px-4 md:flex-wrap">
            {onOpenBToASlip && (
              <button
                type="button"
                onClick={() => onOpenBToASlip(null, Array.from(selectedIds))}
                className={`${btnSm.secondary} max-md:h-10`}
                title="Shift the selected zaereen to Category A (B to A) and make the accounts slip"
              >
                <ArrowRightLeft className="w-4 h-4 text-stone-500" />
                B→A shift
              </button>
            )}

            {onOpenAToBSlip && (
              <button
                type="button"
                onClick={() => onOpenAToBSlip(null, Array.from(selectedIds))}
                className={`${btnSm.secondary} max-md:h-10`}
                title="Make the A to B slip for the selected zaereen (grouped by tour ID)"
              >
                <FileText className="w-4 h-4 text-stone-500" />
                A→B slip
              </button>
            )}

            <button
              type="button"
              onClick={() => handleBulkMarkSelectedPortal(true)}
              className={`${btnSm.secondary} max-md:h-10`}
              title="Mark the selected zaereen as uploaded to the main portal"
            >
              <CheckSquare className="w-4 h-4 text-stone-500" />
              Mark uploaded
            </button>

            <button
              type="button"
              onClick={() => handleBulkMarkSelectedPortal(false)}
              className={`${btnSm.secondary} max-md:h-10`}
              title="Mark the selected zaereen as pending"
            >
              <Square className="w-4 h-4 text-stone-500" />
              Mark pending
            </button>

            <button
              type="button"
              onClick={() => setIsBatchDeleteModalOpen(true)}
              className={`${btnSm.danger} max-md:h-10`}
              title="Delete all selected zaereen records"
            >
              <Trash2 className="w-4 h-4" />
              Delete selected ({selectedIds.size})
            </button>

            <button type="button" onClick={handleClearSelection} className={`${btnSm.ghost} max-md:h-10`}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PHONE LIST: one block per zair                                            */}
      {/* ========================================================================= */}
      {!isDesktop && (
        <div ref={listTopRef} className="space-y-3 scroll-mt-20">
          <div className="flex items-center justify-between gap-3 px-1">
            <span className="text-[13px] text-stone-600 tabular-nums">
              {totalRows === 0 ? (
                'No zaereen'
              ) : (
                <>
                  Rows <strong className="font-semibold text-stone-900">{fmtCount(pagerProps.from)}–{fmtCount(pagerProps.to)}</strong> of {fmtCount(totalRows)}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={handleToggleSelectAllVisible}
              disabled={totalRows === 0}
              className={btn.ghost}
              title="Selects every filtered zair, on every page"
            >
              {isAllVisibleSelected ? 'Deselect all' : `Select all ${fmtCount(totalRows)}`}
            </button>
          </div>

          {pageRows.length > 0 ? (
            <>
              {pageRows.map((res, idx) => {
                const isAllotted = !!res.roomNumber && res.roomNumber.trim() !== '';
                const isShiftedToA = !!res.shiftToCategoryA;
                const isSelected = selectedIds.has(res.id);
                const famKey = res.family && res.tourRefNo ? `${res.tourRefNo}___${res.family.trim().toLowerCase()}` : '';
                const sameFamilyCount = famKey ? (familyCountMap.get(famKey) || 1) : 1;

                return (
                  <div
                    key={res.id}
                    className={`rounded-2xl border p-4 shadow-xs ${
                      isSelected ? 'border-brand-400 bg-brand-50' : 'border-stone-200 bg-white'
                    }`}
                  >
                    {/* Who: select, name, star */}
                    <div className="flex items-start gap-1">
                      <label className="-ml-3 -mt-2.5 flex h-11 w-11 shrink-0 items-center justify-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRow(res.id)}
                          aria-label={`Select ${res.applicantName}`}
                          className="w-[18px] h-[18px] rounded border-stone-300 accent-brand-700"
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="min-w-0 truncate text-[15px] font-semibold leading-snug text-stone-950">
                            {res.applicantName}
                          </h3>
                          <OtherStays others={otherStays.get(res.id)} />
                        </div>
                        <div className="mt-0.5 text-[13px] text-stone-600 tabular-nums">
                          #{pageStart + idx + 1} · ITS {res.itsId} · {res.age}y {res.gender === 'Female' ? 'F' : 'M'} · Family {res.family}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenSpecialGuestModal(res)}
                        className={`-mr-2.5 -mt-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg cursor-pointer ${
                          res.isSpecialGuest ? 'text-gold-500' : 'text-stone-400'
                        }`}
                        title={res.isSpecialGuest ? `Special guest: ${res.specialRemarks || 'Edit remarks'}` : 'Mark as star guest'}
                        aria-label={res.isSpecialGuest ? 'Edit star guest remarks' : 'Mark as star guest'}
                      >
                        <Star className={`w-5 h-5 ${res.isSpecialGuest ? 'fill-gold-400' : ''}`} />
                      </button>
                    </div>

                    {/* Room state */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {isAllotted ? (
                        <span className={chip('ok')}>
                          <Check className="w-3.5 h-3.5" />
                          {res.building} {res.roomNumber}
                        </span>
                      ) : (
                        <span className={chip('wait')}>Needs room</span>
                      )}
                      {isShiftedToA && <span className={chip('special')}>B→A</span>}
                      {res.isUploadedToPortal && <span className={chip('neutral')}>On portal</span>}
                    </div>

                    {/* NKERP photo, tour, office, dates */}
                    <div className="mt-3 flex items-start gap-3">
                      <ZairPhoto photos={photos} itsId={res.itsId} name={res.applicantName} />
                      <dl className="min-w-0 flex-1 space-y-1.5 text-[13px] leading-snug">
                        <div className="flex gap-2">
                          <dt className="w-[70px] shrink-0 text-stone-500">Tour</dt>
                          <dd className="min-w-0 break-words font-medium text-stone-900 tabular-nums" title={res.tourRefNo || res.tourId || ''}>{shortTour(res.tourRefNo || res.tourId) || '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-[70px] shrink-0 text-stone-500">Office</dt>
                          <dd className="min-w-0 text-stone-800">{res.officeName || '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-[70px] shrink-0 text-stone-500">Arrival</dt>
                          <dd className="min-w-0 text-stone-800">
                            <span className="font-medium text-stone-900 tabular-nums">
                              {res.arrivalDate ? stayDay(res.arrivalDate) : '—'}, {res.arrivalTime || '11:00 AM'}
                            </span>
                            <TravelDetails legs={res.arrivalTravel} date={res.arrivalDate} direction="arrival" flush />
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-[70px] shrink-0 text-stone-500">Departure</dt>
                          <dd className="min-w-0 text-stone-800">
                            <span className="font-medium text-stone-900 tabular-nums">
                              {res.departureDate ? stayDay(res.departureDate) : '—'}, {res.departureTime || '01:00 AM'}
                            </span>
                            <TravelDetails legs={res.departureTravel} date={res.departureDate} direction="departure" flush />
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {/* Actions */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
                      {!isReadOnly && onOpenQuickAllotModal && (
                        <button
                          type="button"
                          onClick={() => onOpenQuickAllotModal(res)}
                          className={`${isAllotted ? btn.secondary : btn.primary} flex-1`}
                        >
                          <Sparkles className={`w-4 h-4 ${isAllotted ? 'text-stone-500' : ''}`} />
                          {isAllotted ? 'Edit room' : 'Allot room'}
                        </button>
                      )}

                      {!isReadOnly && isAllotted && onOpenSwitchRoomModal && (
                        <button
                          type="button"
                          onClick={() => onOpenSwitchRoomModal({ reservations: [res], initialScope: 'single' })}
                          className={`${btn.secondary} flex-1`}
                        >
                          <ArrowRightLeft className="w-4 h-4 text-stone-500" />
                          Switch room
                        </button>
                      )}

                      {!isReadOnly && sameFamilyCount > 1 && isAllotted && onBatchAllotFamily && (
                        <button
                          type="button"
                          onClick={() => {
                            onBatchAllotFamily(String(res.tourRefNo || res.tourId || ''), String(res.family || ''), res.building || 'Saifee', res.roomNumber);
                          }}
                          className={btn.secondary}
                          title={`Give ${res.building || 'Saifee'} room ${res.roomNumber} to all ${sameFamilyCount} members of family ${res.family}`}
                        >
                          <Users className="w-4 h-4 text-stone-500" />
                          Family ({sameFamilyCount})
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleFieldChange(res.id, 'isUploadedToPortal', !res.isUploadedToPortal)}
                        aria-pressed={!!res.isUploadedToPortal}
                        className={res.isUploadedToPortal ? `${portalDone} h-10 px-3.5 text-sm` : btn.secondary}
                      >
                        {res.isUploadedToPortal ? <Check className="w-4 h-4" /> : <Square className="w-4 h-4 text-stone-400" />}
                        {res.isUploadedToPortal ? 'Portal done' : 'Tick portal'}
                      </button>

                      {isShiftedToA && (
                        <button
                          type="button"
                          onClick={() => onOpenAccountsSlip(res)}
                          className={`${iconRing} h-10 w-10`}
                          title="Accounts slip (B to A)"
                          aria-label="Accounts slip (B to A)"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}

                      {!isShiftedToA && res.shiftDirection === 'A_TO_B' && onOpenAToBSlip && (
                        <button
                          type="button"
                          onClick={() => onOpenAToBSlip(res, [res.id])}
                          className={`${iconRing} h-10 w-10`}
                          title="Accounts slip (A to B)"
                          aria-label="Accounts slip (A to B)"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (isBToARecord(res) && userRole !== 'admin') {
                            setBToABlockedRecord(res);
                          } else {
                            setRecordToDelete(res);
                          }
                        }}
                        className={`${iconDanger} h-10 w-10 ring-1 ring-inset ring-stone-200`}
                        title="Delete record"
                        aria-label={`Delete record for ${res.applicantName}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="flex justify-center pt-1">
                <Pager {...pagerProps} onPageSize={setPageSize} />
              </div>
            </>
          ) : (
            <div className={card}>{emptyState}</div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* DESKTOP TABLE: scrolls inside its own frame, header and name stay put     */}
      {/* ========================================================================= */}
      {isDesktop && (
        <div className={`${card} flex w-full flex-col overflow-hidden`}>
          {/* Count and compact pager */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-stone-200 px-4 py-2">
            <div className="text-[13px] text-stone-600 tabular-nums">
              {hasActiveFilters ? (
                <>
                  <strong className="font-semibold text-stone-900">{fmtCount(totalRows)}</strong> of {fmtCount(totalZaereen)} zaereen match
                </>
              ) : (
                <>
                  <strong className="font-semibold text-stone-900">{fmtCount(totalRows)}</strong> zaereen
                </>
              )}
            </div>
            <Pager {...pagerProps} compact />
          </div>

          <div
            ref={tableScrollRef}
            onScroll={(e) => {
              const stuck = e.currentTarget.scrollLeft > nameColumnLeft;
              setNameStuck((prev) => (prev === stuck ? prev : stuck));
            }}
            className="w-full overflow-auto max-h-[max(22rem,calc(100dvh-9rem))]"
          >
            <table
              className="w-full table-fixed border-separate border-spacing-0 text-left text-[13px] text-stone-800"
              style={{ minWidth: tableMinWidth }}
            >
              <colgroup>
                {columnWidths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>

              <thead className="select-none">
                <tr>
                  <th scope="col" className={`${thCell} z-10`}>
                    <label
                      className="flex h-10 items-center gap-2 pl-3 cursor-pointer"
                      title={`Select or deselect all ${fmtCount(totalRows)} filtered zaereen, on every page`}
                    >
                      <input
                        type="checkbox"
                        checked={isAllVisibleSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isSomeVisibleSelected;
                        }}
                        onChange={handleToggleSelectAllVisible}
                        aria-label="Select all filtered zaereen"
                        className="w-4 h-4 rounded border-stone-300 cursor-pointer accent-brand-700"
                      />
                      <span>#</span>
                    </label>
                  </th>
                  <th scope="col" className={`${thCell} z-10 h-10 px-3 text-left`}>Photo</th>
                  {renderSortTh('itsId', 'ITS')}
                  {renderSortTh('applicantName', 'Name', `left-0 z-20 ${nameStuck ? 'border-r' : ''}`)}
                  {renderSortTh('age', 'Age')}
                  {renderSortTh('family', 'Family')}
                  {renderSortTh('officeName', 'Office')}
                  {renderSortTh('tourRefNo', 'Tour ID')}
                  {renderSortTh('building', 'Building')}
                  {renderSortTh('roomNumber', 'Room')}
                  {renderSortTh('gender', 'Gender')}
                  {renderSortTh('groupLeadName', 'Lead')}
                  {renderSortTh('arrivalDate', 'Arrival')}
                  {renderSortTh('departureDate', 'Departure')}
                  {renderSortTh('category', 'Category')}
                  {renderSortTh('portal', 'Portal')}
                  <th scope="col" className={`${thCell} z-10`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {pageRows.length > 0 ? (
                  pageRows.map((res, index) => {
                    const isShiftedToA = !!res.shiftToCategoryA;
                    const isAllotted = !!res.roomNumber && res.roomNumber.trim() !== '';

                    // Precomputed O(1) family member count
                    const famKey = res.family && res.tourRefNo ? `${res.tourRefNo}___${res.family.trim().toLowerCase()}` : '';
                    const sameFamilyCount = famKey ? (familyCountMap.get(famKey) || 1) : 1;

                    // Available rooms lookup: memoized, showing all rooms where capacity is not reached
                    const chosenBldg = normalizeBuildingName(res.building) || 'Saifee';
                    const bldgNorm = chosenBldg.toLowerCase();
                    const hotelRooms = rooms.filter((rm) => normalizeBuildingName(rm.building).toLowerCase() === bldgNorm);
                    const dateCacheKey = `${bldgNorm}___${(res.arrivalDate || '').slice(0, 10)}___${(res.departureDate || '').slice(0, 10)}`;
                    const cachedAvailable = availableRoomsCache.get(dateCacheKey);
                    const availableRoomsForRes = cachedAvailable || hotelRooms.filter((rm) => rm.status !== 'blocked');
                    const availableRoomSet = new Set(availableRoomsForRes.map((rm) => rm.roomNumber));

                    const isSelected = selectedIds.has(res.id);

                    const roomSelect = (
                      <select
                        value={res.roomNumber || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__OPEN_ALLOT_MODAL__') {
                            if (onOpenQuickAllotModal) onOpenQuickAllotModal(res);
                            return;
                          }
                          const matchedRoom = hotelRooms.find(
                            (rm) => String(rm.roomNumber).trim().toLowerCase() === String(val).trim().toLowerCase()
                          );
                          const targetBldg = matchedRoom
                            ? (normalizeBuildingName(matchedRoom.building) || chosenBldg)
                            : chosenBldg;
                          if (onAllotRoom) {
                            onAllotRoom(res.id, targetBldg, val);
                          } else {
                            handleFieldChange(res.id, 'roomNumber', val);
                            if (targetBldg !== res.building) {
                              handleFieldChange(res.id, 'building', targetBldg);
                            }
                          }
                        }}
                        aria-label={isAllotted ? `Room for ${res.applicantName}` : `Pick a room for ${res.applicantName}`}
                        title={isAllotted ? `${chosenBldg} room ${res.roomNumber}. Pick another room to move.` : 'Pick a room straight from the list'}
                        className={
                          isAllotted
                            ? `${cellSelect} min-w-0 flex-1 font-bold text-stone-950 tabular-nums`
                            : `${cellSelect} w-[60px] shrink-0 text-stone-600`
                        }
                      >
                        <option value="">{isAllotted ? 'No room' : 'Pick'}</option>
                        {onOpenQuickAllotModal && (
                          <option value="__OPEN_ALLOT_MODAL__">
                            Open the allot window…
                          </option>
                        )}
                        {res.roomNumber && (
                          <option value={res.roomNumber}>
                            {res.roomNumber}
                          </option>
                        )}
                        {availableRoomsForRes.length > 0 && (
                          <optgroup label="Available rooms (capacity not reached)">
                            {availableRoomsForRes
                              .filter((rm) => rm.roomNumber !== res.roomNumber)
                              .map((rm) => (
                                <option key={rm.id} value={rm.roomNumber}>
                                  Rm {rm.roomNumber} ({rm.floorLabel || `Fl ${rm.floor}`} • Cap {rm.capacity}{rm.buffer ? `+${rm.buffer}` : ''})
                                </option>
                              ))}
                          </optgroup>
                        )}
                        <optgroup label="All rooms (notice / force allot)">
                          {hotelRooms
                            .filter((rm) => rm.roomNumber !== res.roomNumber && !availableRoomSet.has(rm.roomNumber))
                            .map((rm) => (
                              <option key={rm.id} value={rm.roomNumber}>
                                Rm {rm.roomNumber} ({rm.status === 'blocked' ? 'Blocked' : `Cap ${rm.capacity} Pax`})
                              </option>
                            ))}
                        </optgroup>
                      </select>
                    );

                    return (
                      <tr key={res.id} className={`group ${isSelected ? 'bg-brand-50' : 'hover:bg-stone-50'}`}>
                        {/* Checkbox and running number */}
                        <td className={tdCell}>
                          <label className="flex h-8 items-center gap-2 pl-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectRow(res.id)}
                              aria-label={`Select ${res.applicantName}`}
                              className="w-4 h-4 shrink-0 rounded border-stone-300 cursor-pointer accent-brand-700"
                            />
                            <span className="text-xs text-stone-500 tabular-nums">{pageStart + index + 1}</span>
                          </label>
                        </td>

                        {/* NKERP photo */}
                        <td className={tdCell}>
                          <div className="flex justify-center">
                            <ZairPhoto photos={photos} itsId={res.itsId} name={res.applicantName} />
                          </div>
                        </td>

                        {/* 1. ITS ID */}
                        <td className={tdCell}>
                          <input
                            type="text"
                            value={res.itsId}
                            onChange={(e) => handleFieldChange(res.id, 'itsId', e.target.value)}
                            aria-label="ITS"
                            title={res.itsId}
                            className={`${cellInput} font-medium text-stone-900 tabular-nums`}
                          />
                        </td>

                        {/* 2. Name: stays in view while the table scrolls sideways */}
                        <td
                          className={`${tdCell} sticky left-0 z-[1] ${nameStuck ? 'border-r' : ''} ${
                            isSelected ? 'bg-brand-50' : 'bg-white group-hover:bg-stone-50'
                          }`}
                        >
                          <div className="group/name flex h-8 items-center gap-1">
                            <input
                              type="text"
                              value={res.applicantName}
                              onChange={(e) => handleFieldChange(res.id, 'applicantName', e.target.value)}
                              aria-label="Name"
                              title={res.specialRemarks ? `${res.applicantName} (star guest: ${res.specialRemarks})` : res.applicantName}
                              className={`${cellBox} w-full px-1.5 text-sm font-semibold text-stone-950`}
                            />
                            <OtherStays others={otherStays.get(res.id)} />
                            {isShiftedToA && (
                              <span className={chip('brand')} title="Shifted to Category A (Nizaam)">
                                A
                              </span>
                            )}
                            {res.isSpecialGuest ? (
                              <button
                                type="button"
                                onClick={() => handleOpenSpecialGuestModal(res)}
                                className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-gold-500 hover:bg-gold-50 cursor-pointer"
                                title={`Star guest: ${res.specialRemarks || 'Click to edit special requirements'}`}
                                aria-label="Edit star guest remarks"
                              >
                                <Star className="w-4 h-4 fill-gold-400" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenSpecialGuestModal(res)}
                                className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 opacity-0 hover:bg-stone-100 hover:text-gold-600 focus-visible:opacity-100 group-hover/name:opacity-100 cursor-pointer"
                                title="Add a star and special lodging remarks"
                                aria-label="Mark as star guest"
                              >
                                <Star className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 3. Age */}
                        <td className={tdCell}>
                          <input
                            type="text"
                            value={res.age}
                            onChange={(e) => handleFieldChange(res.id, 'age', e.target.value)}
                            aria-label="Age"
                            className={`${cellInput} text-stone-800 tabular-nums`}
                          />
                        </td>

                        {/* 4. Family */}
                        <td className={tdCell}>
                          <input
                            type="text"
                            value={res.family}
                            onChange={(e) => handleFieldChange(res.id, 'family', e.target.value)}
                            aria-label="Family"
                            className={`${cellInput} text-stone-800 tabular-nums`}
                          />
                        </td>

                        {/* 5. Office Name */}
                        <td className={tdCell}>
                          <input
                            type="text"
                            value={res.officeName}
                            onChange={(e) => handleFieldChange(res.id, 'officeName', e.target.value)}
                            aria-label="Office"
                            title={res.officeName}
                            className={`${cellInput} text-stone-700`}
                          />
                        </td>

                        {/* 6. Tour ID: the short form reads at a glance, the full ID shows while editing */}
                        <td className={tdCell}>
                          <TourIdInput
                            value={res.tourRefNo}
                            short={fitColumnsToScreen}
                            onChange={(v) => handleFieldChange(res.id, 'tourRefNo', v)}
                            className={`${cellInput} text-stone-800 tabular-nums`}
                          />
                        </td>

                        {/* 7. Hotel / Building */}
                        <td className={tdCell}>
                          <select
                            value={chosenBldg}
                            onChange={(e) => handleFieldChange(res.id, 'building', e.target.value)}
                            aria-label="Building"
                            className={`${cellSelect} w-full text-stone-800`}
                          >
                            {distinctBuildings.map((bldg) => (
                              <option key={bldg} value={bldg}>{bldg}</option>
                            ))}
                            {chosenBldg && !distinctBuildings.includes(chosenBldg) && (
                              <option value={chosenBldg}>{chosenBldg}</option>
                            )}
                          </select>
                        </td>

                        {/* 8. Room: a clear state first, then the ways to change it */}
                        <td className={tdCell}>
                          <div className="flex h-8 items-center gap-1">
                            {isReadOnly ? (
                              res.roomNumber ? (
                                <span className="truncate px-1.5 font-bold text-stone-950 tabular-nums" title={`${res.building} room ${res.roomNumber}`}>
                                  {res.building} {res.roomNumber}
                                </span>
                              ) : (
                                <span className={`${chip('wait')} ml-1`}>Needs room</span>
                              )
                            ) : (
                              <>
                                {!isAllotted && onOpenQuickAllotModal && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenQuickAllotModal(res)}
                                    className={needsRoomBtn}
                                    title="Open the allot window with capacity, buffer and a recommended room"
                                  >
                                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">Needs room</span>
                                  </button>
                                )}

                                {roomSelect}

                                {isAllotted && onOpenSwitchRoomModal && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenSwitchRoomModal({ reservations: [res], initialScope: 'single' })}
                                    className={`${iconRing} h-8 w-8`}
                                    title="Switch or swap with another room"
                                    aria-label="Switch room"
                                  >
                                    <ArrowRightLeft className="w-4 h-4" />
                                  </button>
                                )}

                                {isAllotted && onOpenQuickAllotModal && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenQuickAllotModal(res)}
                                    className={`${iconRing} h-8 w-8`}
                                    title="Open the allot window"
                                    aria-label="Open the allot window"
                                  >
                                    <Sparkles className="w-4 h-4" />
                                  </button>
                                )}
                              </>
                            )}

                            {/* Give this row's room to the whole family */}
                            {!isReadOnly && sameFamilyCount > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!res.roomNumber) {
                                    alert(`Please select a room first in the dropdown, then click here to allot to all ${sameFamilyCount} members of Family ${res.family}.`);
                                    return;
                                  }
                                  if (onBatchAllotFamily) {
                                    const safeTour = String(res.tourRefNo || res.tourId || '');
                                    const safeFam = String(res.family || '');
                                    onBatchAllotFamily(safeTour, safeFam, chosenBldg, res.roomNumber);
                                  }
                                }}
                                className={`${iconRing} h-8 gap-1 px-1.5 text-xs font-medium tabular-nums`}
                                title={`Allot ${res.building || 'Saifee'} room ${res.roomNumber || '...'} to all ${sameFamilyCount} members of family ${res.family}`}
                                aria-label={`Allot this room to all ${sameFamilyCount} members of family ${res.family}`}
                              >
                                <Users className="w-4 h-4" />
                                {sameFamilyCount}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 9. Gender */}
                        <td className={tdCell}>
                          <select
                            value={res.gender}
                            onChange={(e) => handleFieldChange(res.id, 'gender', e.target.value)}
                            aria-label="Gender"
                            className={`${cellSelect} w-full text-stone-800`}
                          >
                            <option value="Male">M</option>
                            <option value="Female">F</option>
                          </select>
                        </td>

                        {/* 10. Group Lead Name */}
                        <td className={tdCell}>
                          <input
                            type="text"
                            value={res.groupLeadName}
                            onChange={(e) => handleFieldChange(res.id, 'groupLeadName', e.target.value)}
                            aria-label="Group lead"
                            title={res.groupLeadName}
                            className={`${cellInput} text-stone-700`}
                          />
                        </td>

                        {/* 11. Arrival: date and time on one line, travel note beneath */}
                        <td className={tdCell}>
                          <div className="flex items-center gap-0.5">
                            <input
                              type="date"
                              value={res.arrivalDate ? res.arrivalDate.slice(0, 10) : ''}
                              onChange={(e) => handleFieldChange(res.id, 'arrivalDate', e.target.value)}
                              aria-label="Arrival date"
                              className={dateInput}
                            />
                            <input
                              type="text"
                              list="portal-standard-times"
                              value={res.arrivalTime || '11:00 AM'}
                              onChange={(e) => handleFieldChange(res.id, 'arrivalTime', e.target.value)}
                              onBlur={(e) => {
                                const formatted = extractCleanTime(e.target.value, undefined, undefined, e.target.value.trim());
                                if (formatted && formatted !== res.arrivalTime) {
                                  handleFieldChange(res.id, 'arrivalTime', formatted);
                                }
                              }}
                              aria-label="Arrival time"
                              title="Exact arrival time (type or pick)"
                              className={timeInput}
                            />
                          </div>
                          <TravelDetails legs={res.arrivalTravel} date={res.arrivalDate} direction="arrival" />
                        </td>

                        {/* 12. Departure: same layout */}
                        <td className={tdCell}>
                          <div className="flex items-center gap-0.5">
                            <input
                              type="date"
                              value={res.departureDate ? res.departureDate.slice(0, 10) : ''}
                              onChange={(e) => handleFieldChange(res.id, 'departureDate', e.target.value)}
                              aria-label="Departure date"
                              className={dateInput}
                            />
                            <input
                              type="text"
                              list="portal-standard-times"
                              value={res.departureTime || '01:00 AM'}
                              onChange={(e) => handleFieldChange(res.id, 'departureTime', e.target.value)}
                              onBlur={(e) => {
                                const formatted = extractCleanTime(e.target.value, undefined, undefined, e.target.value.trim());
                                if (formatted && formatted !== res.departureTime) {
                                  handleFieldChange(res.id, 'departureTime', formatted);
                                }
                              }}
                              aria-label="Departure time"
                              title="Exact departure time (type or pick)"
                              className={timeInput}
                            />
                          </div>
                          <TravelDetails legs={res.departureTravel} date={res.departureDate} direction="departure" />
                        </td>

                        {/* 13. Category */}
                        <td className={tdCell}>{renderCategoryCell(res)}</td>

                        {/* 14. Main portal upload status */}
                        <td className={tdCell}>
                          <button
                            type="button"
                            onClick={() =>
                              handleFieldChange(res.id, 'isUploadedToPortal', !res.isUploadedToPortal)
                            }
                            aria-pressed={!!res.isUploadedToPortal}
                            className={res.isUploadedToPortal ? `${portalDone} h-8 w-full px-2 text-[13px]` : `${portalTodo} h-8 w-full px-2 text-[13px]`}
                            title={res.isUploadedToPortal ? 'Uploaded to the portal (click to untick)' : 'Mark as uploaded to the portal'}
                          >
                            {res.isUploadedToPortal ? (
                              <>
                                <Check className="w-3.5 h-3.5 shrink-0" />
                                Done
                              </>
                            ) : (
                              <>
                                <Square className="w-3.5 h-3.5 shrink-0 text-stone-400" />
                                Tick
                              </>
                            )}
                          </button>
                        </td>

                        {/* Row actions */}
                        <td className={tdCell}>
                          <div className="flex h-8 items-center justify-end gap-0.5 pr-1">
                            {isShiftedToA && (
                              <button
                                type="button"
                                onClick={() => onOpenAccountsSlip(res)}
                                className={`${iconGhost} h-8 w-8`}
                                title="Print accounts slip (B to A)"
                                aria-label="Print accounts slip (B to A)"
                              >
                                <FileText className="w-4 h-4" />
                              </button>
                            )}
                            {!isShiftedToA && res.shiftDirection === 'A_TO_B' && onOpenAToBSlip && (
                              <button
                                type="button"
                                onClick={() => onOpenAToBSlip(res, [res.id])}
                                className={`${iconGhost} h-8 w-8`}
                                title="Print accounts slip (A to B)"
                                aria-label="Print accounts slip (A to B)"
                              >
                                <FileText className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (isBToARecord(res) && userRole !== 'admin') {
                                  setBToABlockedRecord(res);
                                } else {
                                  setRecordToDelete(res);
                                }
                              }}
                              className={`${iconDanger} h-8 w-8`}
                              title={isBToARecord(res) ? `Delete B to A record: ${res.applicantName}` : `Delete record for ${res.applicantName}`}
                              aria-label={`Delete record for ${res.applicantName}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={17}>
                      <div className="sticky left-0" style={{ width: 'min(100%, 60rem)' }}>{emptyState}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals and the full pager */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-stone-200 bg-stone-50 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-stone-600 tabular-nums">
              <span>
                Allotted{' '}
                <strong className="font-semibold text-stone-900">
                  {fmtCount(reservations.filter((r) => r.roomNumber && r.roomNumber.trim() !== '').length)}
                </strong>
              </span>
              <span>
                Needs room{' '}
                <strong className="font-semibold text-amber-800">
                  {fmtCount(reservations.filter((r) => !r.roomNumber || r.roomNumber.trim() === '').length)}
                </strong>
              </span>
              <span>
                Uploaded to portal{' '}
                <strong className="font-semibold text-stone-900">
                  {fmtCount(reservations.filter((r) => r.isUploadedToPortal).length)}
                </strong>
              </span>
            </div>
            <Pager {...pagerProps} onPageSize={setPageSize} />
          </div>
        </div>
      )}

      <datalist id="portal-standard-times">
        {STANDARD_TIMES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {/* Receptionist tried to delete a B to A record */}
      {bToABlockedRecord && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="b2a-blocked-title">
          <div className={`${modalCard} max-w-md`}>
            <div className={modalHeader}>
              <div className="min-w-0">
                <h3 id="b2a-blocked-title" className={modalTitle}>Only an admin can delete a B to A record</h3>
                <p className="mt-1 text-sm text-stone-600">
                  Once a zair is added in B to A, the record must not be deleted until an admin deletes it.
                </p>
              </div>
              <button type="button" onClick={() => setBToABlockedRecord(null)} className={modalClose} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
              <dl className={`${panel} space-y-1.5 p-3.5 text-sm`}>
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-stone-500">Zair</dt>
                  <dd className="min-w-0 font-semibold text-stone-950">{bToABlockedRecord.applicantName}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-stone-500">Tour ID</dt>
                  <dd className="min-w-0 break-all text-stone-800 tabular-nums">{bToABlockedRecord.tourRefNo}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-stone-500">Category</dt>
                  <dd className="min-w-0"><span className={chip('special')}>Category B to A (Nizaam)</span></dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-stone-500">Room</dt>
                  <dd className="min-w-0 text-stone-800 tabular-nums">
                    {bToABlockedRecord.building} {bToABlockedRecord.roomNumber ? bToABlockedRecord.roomNumber : 'Unallotted'}
                  </dd>
                </div>
              </dl>

              <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                <ShieldAlert className="mt-0.5 w-4 h-4 shrink-0 text-amber-700" />
                <span>Switch to the <strong className="font-semibold">Admin role</strong> with the admin PIN to delete B to A records.</span>
              </div>
            </div>

            <div className={modalFooter}>
              <button type="button" onClick={() => setBToABlockedRecord(null)} className={btn.primary}>
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {isHiddenStaysOpen && (
        <HiddenStaysModal onClose={() => setIsHiddenStaysOpen(false)} onRestored={(count) => onHiddenStaysRestored?.(count)} />
      )}

      {/* Delete one record */}
      {recordToDelete && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="delete-record-title">
          <div className={`${modalCard} max-w-lg`}>
            {isBToARecord(recordToDelete) ? (
              // B to A entry: asks the exact question staff were promised
              <>
                <div className={modalHeader}>
                  <div className="min-w-0">
                    <h3 id="delete-record-title" className={modalTitle}>Delete B to A entry</h3>
                    <p className="mt-1.5"><span className={chip('special')}>B to A registry, protected</span></p>
                  </div>
                  <button type="button" onClick={() => setRecordToDelete(null)} className={modalClose} aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
                  <div className="rounded-xl bg-amber-50 px-4 py-3.5">
                    <div className="flex items-start gap-2.5 text-[15px] font-semibold text-amber-950">
                      <AlertCircle className="mt-0.5 w-5 h-5 shrink-0 text-amber-600" />
                      <span>This entry is in B to A. Do you want to delete it?</span>
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-amber-900">
                      This zair was registered under <strong className="font-semibold">Category B to A</strong> and has an official accounts request slip. Deleting this entry removes it from the system for good, releases room <strong className="font-semibold">{recordToDelete.building} {recordToDelete.roomNumber ? recordToDelete.roomNumber : ''}</strong>, and removes the B to A accounts records.
                    </p>
                  </div>

                  <div className={`${panel} p-3.5`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-stone-950">{recordToDelete.applicantName}</div>
                        <div className="text-[13px] text-stone-600 tabular-nums">ITS {recordToDelete.itsId}</div>
                      </div>
                      <span className={chip('special')}>B→A shifted</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                      <div>
                        <dt className="text-stone-500">Tour ID</dt>
                        <dd className="break-all text-stone-900 tabular-nums">{recordToDelete.tourRefNo}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-500">Family</dt>
                        <dd className="text-stone-900 tabular-nums">{recordToDelete.family}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-500">Allotted room</dt>
                        <dd className="text-stone-900 tabular-nums">{recordToDelete.building} {recordToDelete.roomNumber ? recordToDelete.roomNumber : 'Unallotted'}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-500">Accounts slip</dt>
                        <dd className="break-all text-stone-900 tabular-nums">{recordToDelete.requestSlipNo || 'Active B to A slip'}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-stone-500">Stay</dt>
                        <dd className="text-stone-900 tabular-nums">{longDay(recordToDelete.arrivalDate)} to {longDay(recordToDelete.departureDate)}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className={modalFooter}>
                  <button type="button" onClick={() => setRecordToDelete(null)} className={btn.secondary}>
                    No, keep in B to A
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
                    className={btnDanger}
                  >
                    <Trash2 className="w-4 h-4" />
                    Yes, delete B to A entry
                  </button>
                </div>
              </>
            ) : (
              // Ordinary record
              <>
                <div className={modalHeader}>
                  <div className="min-w-0">
                    <h3 id="delete-record-title" className={modalTitle}>Delete zair record</h3>
                    <p className="mt-1 text-sm text-stone-600">
                      Are you sure you want to permanently delete this zair record?
                    </p>
                  </div>
                  <button type="button" onClick={() => setRecordToDelete(null)} className={modalClose} aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
                  <div className={`${panel} p-3.5`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-stone-950">{recordToDelete.applicantName}</div>
                        <div className="text-[13px] text-stone-600 tabular-nums">ITS {recordToDelete.itsId}</div>
                      </div>
                      <span className="shrink-0 text-[13px] text-stone-600 tabular-nums">Family {recordToDelete.family}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                      <div>
                        <dt className="text-stone-500">Tour ID</dt>
                        <dd className="break-all text-stone-900 tabular-nums">{recordToDelete.tourRefNo}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-500">Category</dt>
                        <dd className="text-stone-900">{recordToDelete.category || 'Mumineen'}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-500">Age and gender</dt>
                        <dd className="text-stone-900 tabular-nums">{recordToDelete.age} yrs, {recordToDelete.gender}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-500">Jamaat</dt>
                        <dd className="text-stone-900">{recordToDelete.jamaat || '—'}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-stone-500">Stay</dt>
                        <dd className="text-stone-900 tabular-nums">{longDay(recordToDelete.arrivalDate)} to {longDay(recordToDelete.departureDate)}</dd>
                      </div>
                    </dl>
                  </div>

                  {recordToDelete.roomNumber ? (
                    <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900">
                      <AlertCircle className="mt-0.5 w-4 h-4 shrink-0 text-amber-700" />
                      <span>
                        <strong className="font-semibold">{recordToDelete.building} room {recordToDelete.roomNumber}</strong> becomes vacant as soon as this record is deleted.
                      </span>
                    </div>
                  ) : (
                    <p className="text-[13px] text-stone-600">This zair has no room allotted.</p>
                  )}

                  <p className="text-[13px] text-stone-600">
                    If NKERP still lists this stay, it stays hidden until NKERP changes its dates. You can bring it back from
                    More → Deleted NKERP stays.
                  </p>
                </div>

                <div className={modalFooter}>
                  <button type="button" onClick={() => setRecordToDelete(null)} className={btn.secondary}>
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
                    className={btnDanger}
                  >
                    <Trash2 className="w-4 h-4" />
                    Yes, delete record
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete the selection */}
      {isBatchDeleteModalOpen && selectedIds.size > 0 && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="batch-delete-title">
          <div className={`${modalCard} max-w-lg`}>
            <div className={modalHeader}>
              <div className="min-w-0">
                <h3 id="batch-delete-title" className={modalTitle}>
                  Delete {selectedIds.size} zair record{selectedIds.size > 1 ? 's' : ''}
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  Are you sure you want to permanently delete all {selectedIds.size} selected zaereen? Their rooms will be freed.
                </p>
              </div>
              <button type="button" onClick={() => setIsBatchDeleteModalOpen(false)} className={modalClose} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
              {/* Warning when part of the selection is B to A */}
              {selectedBToACount > 0 && (
                <div className="rounded-xl bg-amber-50 px-4 py-3.5">
                  <div className="flex items-start gap-2.5 text-sm font-semibold text-amber-950">
                    <AlertCircle className="mt-0.5 w-4 h-4 shrink-0 text-amber-600" />
                    <span>
                      {selectedBToACount} of the selected {selectedIds.size > 1 ? 'entries are' : 'entry is'} in B to A. Do you want to delete {selectedBToACount > 1 ? 'them' : 'it'}?
                    </span>
                  </div>
                  {userRole !== 'admin' ? (
                    <p className="mt-2 text-[13px] font-medium text-rose-700">
                      Blocked: a zair added in B to A cannot be deleted until an admin deletes it. Switch to the Admin role with the PIN to go on.
                    </p>
                  ) : (
                    <p className="mt-2 text-[13px] text-amber-900">
                      Admin confirmation: going on permanently deletes these B to A entries, frees their rooms and removes the related accounts request slips.
                    </p>
                  )}
                </div>
              )}

              {/* The selection */}
              <ul className={`${panel} max-h-52 divide-y divide-stone-200 overflow-y-auto text-[13px]`}>
                {Array.from(selectedIds).map((id) => {
                  const z = reservations.find((r) => r.id === id);
                  if (!z) return null;
                  const isB2A = isBToARecord(z);
                  return (
                    <li key={id} className="flex items-center justify-between gap-3 px-3.5 py-2">
                      <div className="min-w-0">
                        <span className="font-medium text-stone-900">{z.applicantName}</span>
                        <span className="ml-1.5 text-stone-500 tabular-nums">{z.itsId}</span>
                        {isB2A && <span className={`${chip('special')} ml-2`}>B→A entry</span>}
                      </div>
                      <div className="shrink-0 text-stone-600 tabular-nums">
                        {z.building} {z.roomNumber ? z.roomNumber : 'Unallotted'}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className={modalFooter}>
              <button type="button" onClick={() => setIsBatchDeleteModalOpen(false)} className={btn.secondary}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteBatchDelete}
                disabled={selectedBToACount > 0 && userRole !== 'admin'}
                className={btnDanger}
              >
                <Trash2 className="w-4 h-4" />
                {selectedBToACount > 0 && userRole === 'admin'
                  ? `Delete all (${selectedBToACount} in B to A)`
                  : `Delete all ${selectedIds.size} records`}
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

      {/* A date or time changed for someone in a tour: this zair only, or the whole tour? */}
      {pendingTourDateChange && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="tour-change-title">
          <div className={`${modalCard} max-w-lg`}>
            <div className={modalHeader}>
              <div className="min-w-0">
                <h3 id="tour-change-title" className={modalTitle}>Update the schedule for the whole tour?</h3>
                <p className="mt-1 text-sm text-stone-600 tabular-nums">
                  Tour <span className="font-medium text-stone-900">{shortTour(pendingTourDateChange.tourId)}</span> · {pendingTourDateChange.allTourZaereen.length} zaereen
                </p>
              </div>
              <button type="button" onClick={handleCancelTourDateChange} className={modalClose} aria-label="Cancel the change" title="Cancel the change">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
              <div className={`${panel} p-3.5`}>
                <div className="text-[13px] text-stone-600">
                  {fieldName(pendingTourDateChange.field)} changed for{' '}
                  <span className="font-medium text-stone-900">{pendingTourDateChange.reservation.applicantName}</span>{' '}
                  <span className="tabular-nums">(ITS {pendingTourDateChange.reservation.itsId})</span>
                </div>
                <div className="mt-3 flex items-end gap-4 tabular-nums">
                  <div>
                    <div className="text-xs text-stone-500">Current</div>
                    <div className="text-[15px] text-stone-600">
                      {pendingTourDateChange.field.includes('Date')
                        ? (pendingTourDateChange.oldValue ? longDay(pendingTourDateChange.oldValue) : '—')
                        : (pendingTourDateChange.oldValue || '—')}
                    </div>
                  </div>
                  <ArrowRight className="mb-1 w-4 h-4 shrink-0 text-stone-400" />
                  <div>
                    <div className="text-xs text-stone-500">New</div>
                    <div className="text-[15px] font-semibold text-stone-950">
                      {pendingTourDateChange.field.includes('Date')
                        ? longDay(pendingTourDateChange.newValue)
                        : pendingTourDateChange.newValue}
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-stone-700">
                There are <strong className="font-semibold">{pendingTourDateChange.allTourZaereen.length} zaereen</strong> in this tour. Apply the new {pendingTourDateChange.field.includes('Date') ? 'date' : 'time'} to all of them, or change it for <strong className="font-semibold">{pendingTourDateChange.reservation.applicantName}</strong> only?
              </p>

              {/* Everyone in the tour */}
              <div>
                <div className="mb-1.5 flex items-center justify-between px-1 text-xs font-medium text-stone-500">
                  <span>Zaereen in the tour ({pendingTourDateChange.allTourZaereen.length})</span>
                  <span>Family and room</span>
                </div>
                <ul className={`${panel} max-h-40 divide-y divide-stone-200 overflow-y-auto text-[13px]`}>
                  {pendingTourDateChange.allTourZaereen.map((m) => {
                    const isCurrent = m.id === pendingTourDateChange.reservation.id;
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-3 px-3.5 py-2">
                        <div className="min-w-0 truncate">
                          <span className={isCurrent ? 'font-semibold text-stone-950' : 'text-stone-800'}>{m.applicantName}</span>
                          {isCurrent && <span className="ml-1.5 text-brand-700">(this zair)</span>}
                          <span className="ml-1.5 text-stone-500 tabular-nums">{m.itsId || '—'}</span>
                        </div>
                        <div className="shrink-0 text-stone-600 tabular-nums">
                          Family {m.family || '—'} · {m.roomNumber ? `${m.building} ${m.roomNumber}` : 'Unallotted'}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <div className={`${modalFooter} max-sm:flex-col max-sm:items-stretch`}>
              <button type="button" onClick={handleCancelTourDateChange} className={btn.ghost}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApplyToSingle}
                className={btn.secondary}
                title={`Apply ${pendingTourDateChange.newValue} only to ${pendingTourDateChange.reservation.applicantName}`}
              >
                <User className="w-4 h-4 text-stone-500" />
                This zair only
              </button>
              <button
                type="button"
                onClick={handleConfirmApplyToAllTour}
                className={btn.primary}
                title={`Apply ${pendingTourDateChange.newValue} to all ${pendingTourDateChange.allTourZaereen.length} zaereen in tour ${pendingTourDateChange.tourId}`}
              >
                <Users className="w-4 h-4" />
                Update all {pendingTourDateChange.allTourZaereen.length} in tour
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove zaereen who left more than 48 hours ago */}
      {isPurgeExpiredModalOpen && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="purge-title">
          <div className={`${modalCard} max-w-2xl`}>
            <div className={modalHeader}>
              <div className="min-w-0">
                <h3 id="purge-title" className={modalTitle}>Remove departed zaereen</h3>
                <p className="mt-1 text-sm text-stone-600">
                  Permanently deletes the records of zaereen whose departure was 48 hours ago or more.
                </p>
              </div>
              <button type="button" onClick={() => setIsPurgeExpiredModalOpen(false)} className={modalClose} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5 sm:px-6">
              {expiredReservations.length > 0 ? (
                <>
                  <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900">
                    <Clock className="w-4 h-4 shrink-0 text-amber-700" />
                    <span>
                      <strong className="font-semibold">{expiredReservations.length}</strong> record{expiredReservations.length > 1 ? 's' : ''} left 48 hours ago or more.
                    </span>
                  </div>

                  <div className={`${panel} max-h-72 overflow-auto`}>
                    <table className="w-full min-w-[600px] border-separate border-spacing-0 text-left text-[13px]">
                      <thead>
                        <tr className="text-xs font-semibold text-stone-600">
                          <th className="sticky top-0 border-b border-stone-200 bg-stone-50 px-3.5 py-2">ITS</th>
                          <th className="sticky top-0 border-b border-stone-200 bg-stone-50 px-3 py-2">Name</th>
                          <th className="sticky top-0 border-b border-stone-200 bg-stone-50 px-3 py-2 whitespace-nowrap">Family and tour</th>
                          <th className="sticky top-0 border-b border-stone-200 bg-stone-50 px-3 py-2">Room</th>
                          <th className="sticky top-0 border-b border-stone-200 bg-stone-50 px-3.5 py-2 text-right">Departure</th>
                        </tr>
                      </thead>
                      <tbody className="text-stone-800">
                        {expiredReservations.map((r) => {
                          const elapsed = getDepartureElapsedHours(r);
                          return (
                            <tr key={r.id}>
                              <td className="border-b border-stone-200 px-3.5 py-2 font-medium text-stone-900 tabular-nums whitespace-nowrap">{r.itsId}</td>
                              <td className="border-b border-stone-200 px-3 py-2 font-semibold text-stone-950">{r.applicantName}</td>
                              <td className="border-b border-stone-200 px-3 py-2 text-stone-600 tabular-nums whitespace-nowrap">
                                {r.family} · {shortTour(r.tourRefNo)}
                              </td>
                              <td className="border-b border-stone-200 px-3 py-2 tabular-nums whitespace-nowrap">
                                {r.roomNumber ? `${r.building} ${r.roomNumber}` : '—'}
                              </td>
                              <td className="border-b border-stone-200 px-3.5 py-2 text-right tabular-nums whitespace-nowrap">
                                <span className="text-stone-900">
                                  {longDay(r.departureDate)} {r.departureTime || ''}
                                </span>
                                <span className="block text-xs text-stone-500">
                                  {elapsed > 0 ? `${elapsed}h ago` : '48h+ passed'}
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
                <div className="py-8 text-center text-sm text-stone-600">
                  No zaereen left more than 48 hours ago, so there is nothing to remove.
                </div>
              )}
            </div>

            <div className={`${modalFooter} sm:justify-between`}>
              <span className="text-[13px] text-stone-600">This cannot be undone.</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setIsPurgeExpiredModalOpen(false)} className={btn.secondary}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePurgeExpiredRecords}
                  disabled={expiredReservations.length === 0}
                  className={btnDanger}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete {expiredReservations.length} record{expiredReservations.length > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feedback toast */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-20 lg:bottom-6 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-md z-50 flex items-start gap-2.5 rounded-xl bg-stone-900 px-4 py-3 text-[13px] leading-snug text-white shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="mt-px w-4 h-4 shrink-0 text-emerald-300" />
          ) : (
            <Info className="mt-px w-4 h-4 shrink-0 text-stone-300" />
          )}
          <span className="min-w-0 flex-1">{toastMessage.text}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-300 hover:text-white cursor-pointer"
            title="Close"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Special Guest & Lodging Requirements Modal (Scope: Guest / Family / Tour ID) */}
      <SpecialGuestModal
        isOpen={!!specialGuestModalTarget}
        onClose={() => setSpecialGuestModalTarget(null)}
        targetReservation={specialGuestModalTarget}
        allReservations={reservations}
        onUpdateReservation={onUpdateReservation}
        onBatchUpdateReservations={onBatchUpdateReservations}
        onShowToast={(msg) => setToastMessage({ text: msg, type: 'success' })}
      />
    </div>
  );
};
