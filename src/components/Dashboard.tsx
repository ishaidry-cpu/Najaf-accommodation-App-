import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Building2,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Printer,
  Upload,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Lock,
  Unlock,
  Sparkles,
  Trash2,
  X,
  RefreshCw,
  Search,
  Plus,
  ArrowRightLeft,
  Star,
  FileText,
  Users,
  Pencil,
} from 'lucide-react';
import type { PullStatus } from '../services/api';
import { Reservation, Room, UserRole } from '../types';
import {
  getRoomBookingsOnDate,
  countEffectivePax,
  getVacantRoomsForDuration,
  getDistinctBuildings,
  getRoomBedCount,
} from '../services/storage';
import { extractCleanTime } from '../utils/turnoverTiming';
import { RoomTimelineView } from './RoomTimelineView';
import { SpecialGuestModal, SpecialGuestScope } from './SpecialGuestModal';
import type { SwitchRoomTarget } from './SwitchRoomModal';
import { BuildingBoard, formatDay, HATCH, ROOM_LOOK, RoomSwatch } from './BuildingBoard';
import { TravelDetails, travelLegsOn } from './TravelDetails';
import {
  CountUp,
  PageHeader,
  SectionHeader,
  btn,
  btnSm,
  btnDanger,
  chip,
  card,
  panel,
  field,
  fieldSm,
  fieldLabel,
  modalScrim,
  modalCard,
  modalHeader,
  modalTitle,
  modalClose,
  modalFooter,
} from './ui';
import { SUBVENUE_ARRIVAL_TIME, SUBVENUE_DEPARTURE_TIME } from '../services/stayTimes';

/* ------------------------------------------------------------------ */
/* Display helpers. They only change how a value reads on screen.      */
/* ------------------------------------------------------------------ */

/** `23:59`, `11:00 AM` and the like read `11:59 PM`; anything unrecognised is shown as it is. */
const formatTime = (value?: string | null): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return extractCleanTime(raw, undefined, undefined, raw).replace(/^0(?=\d:)/, '');
};

/** A day and, when there is one, its time: `28 Nov, 11:00 AM`. */
const formatStay = (date?: string | null, time?: string | null): string => {
  const day = formatDay(date);
  const t = formatTime(time);
  return t ? `${day}, ${t}` : day;
};

/** Tour IDs all start `NKERP/TOUR/`; tight lists show the part that differs (the full ID stays in the tooltip). */
const shortTour = (id?: string | null): string => String(id ?? '').trim().replace(/^NKERP\/TOUR\//i, '');

/** Occupants by departure, earliest first, then by family, so a room's departures read in order. */
const sortByDeparture = (list: Reservation[]): Reservation[] =>
  [...list].sort(
    (a, b) =>
      (a.departureDate || '').slice(0, 10).localeCompare((b.departureDate || '').slice(0, 10)) ||
      String(a.family || '').localeCompare(String(b.family || ''), undefined, { numeric: true }) ||
      a.applicantName.localeCompare(b.applicantName)
  );

/**
 * A room's departures at a glance: one line per departure date, time and tour, with how many zaereen leave
 * and the travel NKERP holds for it. The same details the Zaereen list shows, gathered room by room.
 */
const RoomDepartures: React.FC<{ occupants: Reservation[]; selectedDate: string; isToday: boolean }> = ({ occupants, selectedDate, isToday }) => {
  const groups = new Map<string, { date: string; time: string; tour: string; people: Reservation[] }>();
  sortByDeparture(occupants).forEach((o) => {
    const date = (o.departureDate || '').slice(0, 10);
    const time = o.departureTime || SUBVENUE_DEPARTURE_TIME;
    const tour = (o.tourRefNo || o.tourId || '').trim();
    const key = `${date}|${formatTime(time)}|${tour.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { date, time, tour, people: [] });
    groups.get(key)!.people.push(o);
  });
  const list = Array.from(groups.values());
  if (list.length === 0) return null;
  return (
    <div className={`${panel} mt-2 px-3.5 py-3`}>
      <h5 className="text-[13px] font-medium text-stone-700">Departures from this room</h5>
      <ul className="mt-1.5 space-y-2">
        {list.map((g) => {
          const leavingNow = g.date === selectedDate;
          // Everyone in a group shares the date, so the first zair with travel legs for that day speaks for it.
          const withTravel = g.people.find((p) => travelLegsOn(p.departureTravel, p.departureDate).length > 0);
          return (
            <li key={`${g.date}|${g.time}|${g.tour}`} className="text-[13px] leading-snug">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                <span className="font-semibold text-stone-950">{formatStay(g.date, g.time)}</span>
                {leavingNow && <span className={chip('wait')}>Leaving {isToday ? 'today' : 'this day'}</span>}
                <span className="text-stone-600">
                  {g.people.length} {g.people.length === 1 ? 'zair' : 'zaereen'}
                  {g.tour ? ` · Tour ${shortTour(g.tour)}` : ''}
                </span>
              </div>
              {withTravel && (
                <TravelDetails legs={withTravel.departureTravel} date={withTravel.departureDate} direction="departure" flush />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** A saved timestamp: `27 Nov, 3:15 PM`. */
const formatWhen = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${day}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

/** On the phone and tablet layout, compact controls grow to a 40px touch target. */
const touch = 'max-lg:h-10';

/** Segmented choice (Timeline / Grid, building, room state): a quiet track with the chosen option raised. */
const segTrack = 'inline-flex flex-wrap items-center gap-1 rounded-lg bg-stone-200/70 p-1';
const segBtn = (on: boolean) =>
  `inline-flex items-center justify-center gap-1.5 h-8 max-lg:h-10 px-3 rounded-md text-[13px] font-medium whitespace-nowrap transition cursor-pointer ${
    on ? 'bg-white text-stone-950 shadow-xs' : 'text-stone-600 hover:text-stone-950'
  }`;

/**
 * The amber "Room changed" chip. Hover, focus or tap opens the list of changes;
 * the list is nudged left when it would run off the screen.
 */
const ChangeHistory: React.FC<{ label: React.ReactNode; title: string; children: React.ReactNode }> = ({ label, title, children }) => {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const show = () => {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const width = Math.min(352, window.innerWidth - 24);
      const overflow = rect.left + width - (window.innerWidth - 12);
      setShift(overflow > 0 ? -overflow : 0);
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      // Hover is for a mouse only; a finger opens the list with a tap and closes it by tapping elsewhere.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={show}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className={`${chip('wait')} relative cursor-help before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']`}
      >
        <ArrowRightLeft className="w-3 h-3" />
        {label}
      </button>
      {open && (
        <div className="absolute top-full z-40 pt-1.5 w-[22rem] max-w-[calc(100vw-1.5rem)]" style={{ left: shift }}>
          <div role="tooltip" className="rounded-xl border border-stone-200 bg-white p-3 text-left shadow-xl">
            <div className="text-[13px] font-semibold text-stone-950">{title}</div>
            <div className="mt-2 max-h-60 overflow-y-auto divide-y divide-stone-200">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
};

interface DashboardProps {
  reservations: Reservation[];
  rooms: Room[];
  onNavigateTab: (tab: 'dashboard' | 'reservations' | 'upgrades' | 'rooms') => void;
  onOpenUploadExcel: () => void;
  onOpenReceptionSlip?: (tab?: 'arrival_slip' | 'departure_list' | 'turnover' | 'roster' | 'worker_summary' | 'portal_upload') => void;
  onOpenAddZaer?: () => void;
  onOpenAddTourGroup?: () => void;
  onDownloadTemplate: () => void;
  onAllotRoom: (reservationId: string, building: string, roomNumber: string) => void;
  onBatchAllotFamily?: (tourRefNo: string, family: string, building: string, roomNumber: string) => void;
  onAddReservation?: (newReservation: Reservation) => boolean | void;
  onUpdateReservation?: (updatedReservation: Reservation) => void;
  onBatchUpdateReservations?: (updatedReservations: Reservation[]) => void;
  onDeleteReservation?: (id: string) => void;
  onToggleBlockRoom?: (roomId: string) => void;
  userRole?: UserRole;
  onOpenQuickAllotModal?: (res: Reservation) => void;
  onOpenSwitchRoomModal?: (target: SwitchRoomTarget) => void;
  isLiveBackendConnected?: boolean;
  pullStatus: PullStatus | null;
  isPulling: boolean;
  onPullNkerp: () => void;
  onExportRoomAllocation: () => void;
  onOpenAddBuildingRooms?: () => void;
  onRefreshLiveComputerData?: () => Promise<void> | void;
  onOpenPdfModal?: (reportType?: any, tourId?: string) => void;
  /** Receptionist access: everything is shown, nothing can be changed. */
  readOnly?: boolean;
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
  onAddReservation,
  onUpdateReservation,
  onBatchUpdateReservations,
  onDeleteReservation,
  onToggleBlockRoom,
  userRole = 'admin',
  onOpenQuickAllotModal,
  onOpenSwitchRoomModal,
  isLiveBackendConnected = true,
  pullStatus,
  isPulling,
  onPullNkerp,
  onExportRoomAllocation,
  onOpenAddBuildingRooms,
  onRefreshLiveComputerData,
  onOpenPdfModal,
  readOnly = false,
}) => {
  // Rooms View Mode: Compact Matrix by default on mobile phones, Timeline on desktop
  const [roomsViewMode, setRoomsViewMode] = useState<'timeline' | 'buttons'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'buttons' : 'timeline'
  );
  // Mobile Quick-Check search state
  const [mobileQuickSearch, setMobileQuickSearch] = useState<string>('');
  // Deleting record confirmation state
  const [recordToDelete, setRecordToDelete] = useState<Reservation | null>(null);
  // Special Guest & Requirements modal state (Scope: Guest / Family / Tour ID)
  const [specialGuestModalTarget, setSpecialGuestModalTarget] = useState<Reservation | null>(null);
  const [specialGuestInitialScope, setSpecialGuestInitialScope] = useState<SpecialGuestScope>('guest');
  const [toastFeedback, setToastFeedback] = useState<string | null>(null);

  // Refresh Matrix state (refreshes all data on same computer without changing selectedDate)
  const [isRefreshingMatrix, setIsRefreshingMatrix] = useState(false);
  const handleRefreshMatrix = async () => {
    setIsRefreshingMatrix(true);
    try {
      if (onRefreshLiveComputerData) {
        await onRefreshLiveComputerData();
      }
    } finally {
      setIsRefreshingMatrix(false);
    }
  };

  useEffect(() => {
    if (!toastFeedback) return;
    const t = setTimeout(() => setToastFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [toastFeedback]);

  // Date selector for room availability view (defaults to today)
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // All buildings in inventory (core 3 + any custom buildings added by user)
  const distinctBuildings = useMemo(() => {
    return getDistinctBuildings(rooms);
  }, [rooms]);

  // Hotel selector: 'ALL' | building name
  const [selectedHotel, setSelectedHotel] = useState<string>('ALL');
  // Filter for room buttons: 'all' | 'available' (Green) | 'partial' (Orange) | 'full' (Red) | 'occupied' | 'blocked' (Grey) | 'vip' (v)
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'partial' | 'full' | 'occupied' | 'blocked' | 'vip'>('all');

  // Selected room for popup/drawer inspector
  const [inspectedRoom, setInspectedRoom] = useState<Room | null>(null);

  // Target Zaer to allot when in inspection popup
  const [allotTargetZaerId, setAllotTargetZaerId] = useState<string>('');

  // Unallotted zaereen who need rooms
  const unallottedZaereen = reservations.filter((r) => !r.roomNumber || r.roomNumber.trim() === '');

  // Search & filter state for Tour & Family Room Allotment Overview
  const [tourSearchQuery, setTourSearchQuery] = useState<string>('');
  const [tourArrivalDateFilter, setTourArrivalDateFilter] = useState<string>('');
  const [tourDepartureDateFilter, setTourDepartureDateFilter] = useState<string>('');

  // Rich summaries for each tour (Zaereen count, office names, families count, arrival & departure dates, room change tracking)
  const tourSummaries = useMemo(() => {
    const map = new Map<string, {
      tourId: string;
      officeNamesSet: Set<string>;
      totalZaereen: number;
      familiesSet: Set<string>;
      arrivalDatesSet: Set<string>;
      earliestArrival: string;
      latestArrival: string;
      departureDatesSet: Set<string>;
      earliestDeparture: string;
      latestDeparture: string;
      hasRoomChange: boolean;
      roomChanges: {
        guestName: string;
        family: string;
        fromRoom: string;
        fromBuilding?: string;
        toRoom: string;
        toBuilding?: string;
        changedAt: string;
        reason?: string;
      }[];
    }>();

    reservations.forEach((r) => {
      const tid = (r.tourRefNo || r.tourId || '').trim();
      if (!tid) return;

      if (!map.has(tid)) {
        map.set(tid, {
          tourId: tid,
          officeNamesSet: new Set(),
          totalZaereen: 0,
          familiesSet: new Set(),
          arrivalDatesSet: new Set(),
          earliestArrival: '',
          latestArrival: '',
          departureDatesSet: new Set(),
          earliestDeparture: '',
          latestDeparture: '',
          hasRoomChange: false,
          roomChanges: [],
        });
      }

      const item = map.get(tid)!;
      item.totalZaereen += 1;
      if (r.officeName && r.officeName.trim()) {
        item.officeNamesSet.add(r.officeName.trim());
      }
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

      const dep = (r.departureDate || r.departureDateTime || r.rawDepartureStr || '').slice(0, 10);
      if (dep && dep.length >= 8) {
        item.departureDatesSet.add(dep);
        if (!item.earliestDeparture || dep < item.earliestDeparture) {
          item.earliestDeparture = dep;
        }
        if (!item.latestDeparture || dep > item.latestDeparture) {
          item.latestDeparture = dep;
        }
      }

      if (r.isRoomChanged || (r.roomChangeHistory && r.roomChangeHistory.length > 0)) {
        item.hasRoomChange = true;
        (r.roomChangeHistory || []).forEach((ch) => {
          item.roomChanges.push({
            guestName: r.applicantName,
            family: r.family || '—',
            fromRoom: ch.fromRoom,
            fromBuilding: ch.fromBuilding,
            toRoom: ch.toRoom,
            toBuilding: ch.toBuilding,
            changedAt: ch.changedAt,
            reason: ch.reason,
          });
        });
      }
    });

    return Array.from(map.values())
      .map((item) => {
        const officeNames = Array.from(item.officeNamesSet);
        return {
          tourId: item.tourId,
          officeNames,
          officeDisplay: officeNames.join(', '),
          totalZaereen: item.totalZaereen,
          familiesCount: item.familiesSet.size,
          arrivalDates: Array.from(item.arrivalDatesSet).sort(),
          primaryArrivalDate: item.earliestArrival,
          departureDates: Array.from(item.departureDatesSet).sort(),
          primaryDepartureDate: item.latestDeparture || item.earliestDeparture,
          earliestDeparture: item.earliestDeparture,
          latestDeparture: item.latestDeparture,
          hasRoomChange: item.hasRoomChange,
          roomChanges: item.roomChanges,
        };
      })
      .sort((a, b) => a.tourId.localeCompare(b.tourId));
  }, [reservations]);

  // Distinct Tour IDs from all reservations
  const distinctTourIds = useMemo(() => {
    return tourSummaries.map((t) => t.tourId);
  }, [tourSummaries]);

  // Filtered tours matching search by Tour ID or Office Name, Arrival Date, and/or Departure Date
  const filteredTourSummaries = useMemo(() => {
    return tourSummaries.filter((t) => {
      // 1. Tour ID or Office Name search query (case-insensitive substring match)
      if (tourSearchQuery.trim()) {
        const q = tourSearchQuery.trim().toLowerCase();
        const matchTour = t.tourId.toLowerCase().includes(q);
        const matchOffice = t.officeDisplay.toLowerCase().includes(q);
        if (!matchTour && !matchOffice) {
          return false;
        }
      }

      // 2. Arrival Date filter
      if (tourArrivalDateFilter.trim()) {
        const targetDate = tourArrivalDateFilter.trim();
        const hasDate = t.arrivalDates.some((d) => d.startsWith(targetDate) || targetDate.startsWith(d));
        if (!hasDate) {
          return false;
        }
      }

      // 3. Departure Date filter
      if (tourDepartureDateFilter.trim()) {
        const targetDate = tourDepartureDateFilter.trim();
        const hasDate = t.departureDates.some((d) => d.startsWith(targetDate) || targetDate.startsWith(d));
        if (!hasDate) {
          return false;
        }
      }

      return true;
    });
  }, [tourSummaries, tourSearchQuery, tourArrivalDateFilter, tourDepartureDateFilter]);

  // Selected Tour ID for the Overview Family Allotment section
  const [dashTourId, setDashTourId] = useState<string>('');

  useEffect(() => {
    // Keep selected tour in sync with search and filter results
    if (filteredTourSummaries.length > 0) {
      const isCurrentInFiltered = filteredTourSummaries.some((t) => t.tourId === dashTourId);
      if (!isCurrentInFiltered) {
        setDashTourId(filteredTourSummaries[0].tourId);
      }
    } else if (tourSummaries.length > 0 && !tourSearchQuery && !tourArrivalDateFilter && !tourDepartureDateFilter) {
      if (!dashTourId) {
        setDashTourId(tourSummaries[0].tourId);
      }
    }
  }, [filteredTourSummaries, dashTourId, tourSummaries, tourSearchQuery, tourArrivalDateFilter, tourDepartureDateFilter]);

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
      const familyChanges = members.flatMap((m) =>
        (m.roomChangeHistory || []).map((ch) => ({
          ...ch,
          guestName: m.applicantName,
          itsId: m.itsId,
        }))
      );
      const hasRoomChange = members.some((m) => m.isRoomChanged) || familyChanges.length > 0;

      const famOffices = Array.from(
        new Set(members.map((m) => (m.officeName || '').trim()).filter(Boolean))
      ).join(', ');

      return {
        family: fam,
        members,
        officeName: famOffices,
        totalCount: members.length,
        allottedCount,
        isFullyAllotted: allottedCount === members.length && members.length > 0,
        arrivalDate: members[0]?.arrivalDate || todayStr,
        arrivalTime: members[0]?.arrivalTime || '',
        departureDate: members[0]?.departureDate || todayStr,
        departureTime: members[0]?.departureTime || '',
        commonBuilding: members[0]?.building || 'Saifee',
        commonRoom: members[0]?.roomNumber || '',
        hasRoomChange,
        familyChanges,
      };
    });
  }, [reservations, currentTourId, todayStr]);

  // Mobile Quick-Check matching results (instant search across Name, ITS, Tour ID, Office Name, Family, Room #)
  const mobileQuickMatches = useMemo(() => {
    const q = mobileQuickSearch.trim().toLowerCase();
    if (!q) return [];
    return reservations
      .filter((r) => {
        return (
          (r.applicantName || '').toLowerCase().includes(q) ||
          (r.itsId || '').toLowerCase().includes(q) ||
          (r.tourRefNo || r.tourId || '').toLowerCase().includes(q) ||
          (r.officeName || '').toLowerCase().includes(q) ||
          (r.family || '').toLowerCase().includes(q) ||
          (r.roomNumber || '').toLowerCase().includes(q) ||
          (r.building || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 15);
  }, [reservations, mobileQuickSearch]);

  // Helper to compute room matrix occupancy state on selected date:
  // - Full occupied (No space): RED
  // - Occupied but still space: ORANGE
  // - Completely available: GREEN
  // - Blocked: GREY (with Lock sign)
  // - VIP occupied (written in tour ID): small 'v' badge
  const getMatrixState = useCallback(
    (room: Room) => {
      if (room.status === 'blocked') {
        return {
          status: 'blocked' as const,
          occupants: [] as Reservation[],
          currentOccupancy: 0,
          baseCapacity: room.capacity || room.pax || 2,
          bufferCapacity: room.buffer || 0,
          maxCapacity: (room.capacity || room.pax || 2) + (room.buffer || 0),
          remainingSlots: 0,
          isVip: false,
          vipTourIds: [] as string[],
        };
      }

      const occupants = getRoomBookingsOnDate(room, selectedDate, reservations);
      const currentOccupancy = countEffectivePax(occupants);
      const baseCapacity = room.capacity || room.pax || 2;
      const bufferCapacity = room.buffer || 0;
      const maxCapacity = baseCapacity + bufferCapacity;
      const remainingSlots = Math.max(0, maxCapacity - currentOccupancy);

      // Check if occupied by VIP (written in tour ID)
      const vipOccupants = occupants.filter((r) => {
        const tour = (r.tourRefNo || r.tourId || '').toUpperCase();
        return tour.includes('VIP') || tour.includes('V.I.P');
      });
      const isVip = vipOccupants.length > 0;
      const vipTourIds = Array.from(
        new Set(vipOccupants.map((o) => (o.tourRefNo || o.tourId || '').trim()).filter(Boolean))
      );

      let status: 'blocked' | 'full' | 'partial' | 'available' = 'available';
      if (currentOccupancy >= maxCapacity && maxCapacity > 0) {
        status = 'full'; // RED: Full occupied (No space)
      } else if (currentOccupancy > 0) {
        status = 'partial'; // ORANGE: Occupied but still space
      } else {
        status = 'available'; // GREEN: Completely available
      }

      return {
        status,
        occupants,
        currentOccupancy,
        baseCapacity,
        bufferCapacity,
        maxCapacity,
        remainingSlots,
        isVip,
        vipTourIds,
      };
    },
    [selectedDate, reservations]
  );

  // Dynamic room statistics on the selected date
  const filteredRooms = rooms.filter((r) => {
    if (selectedHotel !== 'ALL' && r.building.toLowerCase() !== selectedHotel.toLowerCase()) return false;
    return true;
  });

  let completelyAvailableCount = 0;
  let partialOccupiedCount = 0;
  let fullOccupiedCount = 0;
  let blockedCount = 0;
  let vipRoomsCount = 0;

  filteredRooms.forEach((r) => {
    const st = getMatrixState(r);
    if (st.status === 'blocked') blockedCount++;
    else if (st.status === 'full') fullOccupiedCount++;
    else if (st.status === 'partial') partialOccupiedCount++;
    else completelyAvailableCount++;

    if (st.isVip) vipRoomsCount++;
  });

  const vacantCount = completelyAvailableCount;
  const occupiedCount = partialOccupiedCount + fullOccupiedCount;

  // The room grid's quick filter: which states a room has to be in to be shown.
  const matchesStatusFilter = (state: ReturnType<typeof getMatrixState>) => {
    if (statusFilter === 'available' && state.status !== 'available') return false;
    if (statusFilter === 'partial' && state.status !== 'partial') return false;
    if (statusFilter === 'full' && state.status !== 'full') return false;
    if (statusFilter === 'occupied' && state.status !== 'partial' && state.status !== 'full') return false;
    if (statusFilter === 'blocked' && state.status !== 'blocked') return false;
    if (statusFilter === 'vip' && !state.isVip) return false;
    return true;
  };

  // One room in the grid. The look matches the "Buildings today" board:
  // vacant = green, occupied with space = orange, full = red, blocked = hatched. A VIP tour adds a small gold "v".
  const renderMatrixRoomButton = (room: Room) => {
    const state = getMatrixState(room);
    if (!matchesStatusFilter(state)) return null;

    const look = ROOM_LOOK[state.status];

    const statusLine =
      state.status === 'blocked'
        ? `Blocked (${room.blockedReason || 'Maintenance buffer'})`
        : state.status === 'full'
        ? 'Full, no space'
        : state.status === 'partial'
        ? `Occupied, ${state.remainingSlots} ${state.remainingSlots === 1 ? 'place' : 'places'} free`
        : 'Vacant';

    const tooltipLines = [
      `${room.building} ${room.roomNumber}: ${statusLine}`,
      `${state.currentOccupancy} of ${state.maxCapacity} places taken`,
      `Beds: ${getRoomBedCount(room)} × ${room.bedType || 'Single Beds'} · Toilet: ${room.toiletType || 'Standard'}`,
    ];

    if (state.isVip) {
      tooltipLines.push(`VIP Tour ID: ${state.vipTourIds.join(', ')}`);
    }

    if (state.occupants.length > 0) {
      tooltipLines.push(
        `Zaereen (${state.occupants.length}):\n` +
          state.occupants
            .map((o: Reservation) => `• ${o.applicantName} (Family ${o.family}, Tour ${o.tourRefNo || o.tourId || '—'})`)
            .join('\n')
      );
    }

    return (
      <button
        key={room.id}
        type="button"
        onClick={() => setInspectedRoom(room)}
        title={tooltipLines.join('\n')}
        aria-label={`${room.building} ${room.roomNumber}, ${statusLine}${state.isVip ? ', VIP tour' : ''}`}
        style={state.status === 'blocked' ? HATCH : undefined}
        className={`relative w-11 h-11 sm:h-9 rounded-md text-xs tabular-nums flex items-center justify-center cursor-pointer hover:outline-2 hover:outline-offset-1 hover:outline-brand-500/70 ${look} ${
          inspectedRoom?.id === room.id ? 'outline-2 outline-offset-1 outline-stone-900' : ''
        }`}
      >
        <span>{room.roomNumber}</span>
        {state.status === 'blocked' && <Lock aria-hidden="true" className="w-2.5 h-2.5 text-stone-500 absolute bottom-0.5 right-0.5" />}
        {state.isVip && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-gold-300 text-[11px] leading-[14px] font-semibold text-stone-950 text-center"
          >
            v
          </span>
        )}
      </button>
    );
  };

  // One building in the room grid: its name, its counts, and a row of rooms per floor.
  const renderGridBuilding = (
    name: string,
    detail: string,
    buildingRooms: Room[],
    floorGroups: { label: string; rooms: Room[] }[]
  ) => {
    const counts = { available: 0, partial: 0, full: 0, blocked: 0 };
    buildingRooms.forEach((r) => {
      counts[getMatrixState(r).status] += 1;
    });
    const rows = floorGroups
      .map((g) => ({ label: g.label, rooms: g.rooms.filter((r) => matchesStatusFilter(getMatrixState(r))) }))
      .filter((g) => g.rooms.length > 0);

    return (
      <section key={name} aria-label={name} className="border-t border-stone-200 pt-4 first:border-t-0 first:pt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h4 className="text-[15px] font-semibold text-stone-950">
            {name}
            <span className="ml-2 text-[13px] font-normal text-stone-500">{detail}</span>
          </h4>
          <p className="text-[13px] text-stone-600 tabular-nums">
            <span className={counts.available > 0 ? 'font-semibold text-emerald-800' : ''}>{counts.available} vacant</span>
            {' · '}
            {counts.partial} with space
            {' · '}
            {counts.full} full
            {counts.blocked > 0 && ` · ${counts.blocked} blocked`}
          </p>
        </div>
        {rows.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {rows.map((g) => (
              <div key={g.label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                <div className="sm:w-32 shrink-0 text-xs text-stone-500 tabular-nums">{g.label}</div>
                <div className="flex flex-wrap gap-1.5 flex-1">{g.rooms.map(renderMatrixRoomButton)}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-stone-500">No rooms in {name} match this filter.</p>
        )}
      </section>
    );
  };

  // Overall counts
  const totalZaereen = reservations.length;
  const bToACount = reservations.filter((r) => r.category === 'B to A' || r.shiftToCategoryA).length;
  const bToAPaidCount = reservations.filter((r) => (r.category === 'B to A' || r.shiftToCategoryA) && r.moneyGiven === 'Yes').length;
  const uploadedCount = reservations.filter((r) => r.isUploadedToPortal).length;

  // Arrivals and departures on selected date (sorted tour ID wise, then room-wise)
  const arrivalsOnDate = useMemo(() => {
    return reservations
      .filter((r) => (r.arrivalDate || r.arrivalDateTime || '').slice(0, 10) === selectedDate)
      .sort((a, b) => {
        const tourA = (a.tourRefNo || a.tourId || '').trim();
        const tourB = (b.tourRefNo || b.tourId || '').trim();
        const tourCmp = tourA.localeCompare(tourB, undefined, { numeric: true });
        if (tourCmp !== 0) return tourCmp;
        const numA = parseInt((a.roomNumber || '').replace(/\D/g, ''), 10) || 9999;
        const numB = parseInt((b.roomNumber || '').replace(/\D/g, ''), 10) || 9999;
        if (numA !== numB) return numA - numB;
        return (a.roomNumber || '').localeCompare(b.roomNumber || '');
      });
  }, [reservations, selectedDate]);

  const departuresOnDate = useMemo(() => {
    return reservations
      .filter((r) => (r.departureDate || r.departureDateTime || '').slice(0, 10) === selectedDate)
      .sort((a, b) => {
        const tourA = (a.tourRefNo || a.tourId || '').trim();
        const tourB = (b.tourRefNo || b.tourId || '').trim();
        const tourCmp = tourA.localeCompare(tourB, undefined, { numeric: true });
        if (tourCmp !== 0) return tourCmp;
        const numA = parseInt((a.roomNumber || '').replace(/\D/g, ''), 10) || 9999;
        const numB = parseInt((b.roomNumber || '').replace(/\D/g, ''), 10) || 9999;
        if (numA !== numB) return numA - numB;
        return (a.roomNumber || '').localeCompare(b.roomNumber || '');
      });
  }, [reservations, selectedDate]);

  const isToday = selectedDate === todayStr;
  const dayPhrase = isToday ? 'today' : `on ${formatDay(selectedDate)}`;
  const hasTourFilter = !!(tourSearchQuery || tourArrivalDateFilter || tourDepartureDateFilter);
  const resetTourFilters = () => {
    setTourSearchQuery('');
    setTourArrivalDateFilter('');
    setTourDepartureDateFilter('');
  };

  // The room whose details are open, re-read from the inventory so a block or unblock shows at once.
  const openRoom = inspectedRoom ? rooms.find((r) => r.id === inspectedRoom.id) || inspectedRoom : null;
  const roomScrimRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!inspectedRoom && !recordToDelete) return;
    // Escape closes the top pop-up only: the delete confirmation first, then the room details,
    // and nothing here while another window (switch room, special guest) is open above them.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (recordToDelete) {
        setRecordToDelete(null);
        return;
      }
      const mine = roomScrimRef.current;
      if (!mine) return;
      const covered = Array.from(document.querySelectorAll<HTMLElement>('.fixed.inset-0')).some(
        (el) => el !== mine && !mine.contains(el) && !!(mine.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
      if (!covered) setInspectedRoom(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inspectedRoom, recordToDelete]);

  // With a search or date filter that matches no tour, say so instead of leaving the last tour on show.
  const showTour = filteredTourSummaries.length > 0 || !hasTourFilter;

  const pullLine = !isLiveBackendConnected
    ? 'App database unavailable'
    : pullStatus?.running
    ? 'Pulling from NKERP…'
    : pullStatus?.error
    ? pullStatus.error
    : pullStatus?.lastSyncedAt
    ? `NKERP pulled at ${new Date(pullStatus.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Waiting for the first NKERP pull';
  const pullIsBad = !!pullStatus?.error || !isLiveBackendConnected;
  const nkerpLine = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[13px]">
      <span className={`inline-flex items-center gap-1.5 max-md:w-full ${pullIsBad ? 'text-rose-700' : 'text-stone-600'}`} role="status">
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${pullIsBad ? 'bg-rose-500' : pullStatus?.lastSyncedAt ? 'bg-emerald-500' : 'bg-stone-400'}`}
        />
        {pullLine}
      </span>
      {!readOnly && (<>
      <button
        type="button"
        className="inline-flex items-center max-lg:min-h-10 font-medium text-brand-700 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onPullNkerp}
        disabled={isPulling}
      >
        Pull from NKERP
      </button>
      <button
        type="button"
        className="inline-flex items-center max-lg:min-h-10 font-medium text-brand-700 hover:underline cursor-pointer"
        onClick={onExportRoomAllocation}
      >
        Export room allocation
      </button>
      </>)}
      {readOnly && <span className="text-stone-500">Receptionist · view only</span>}
    </div>
  );

  const arrivalsWithoutRoom = arrivalsOnDate.filter((r) => !r.roomNumber || r.roomNumber.trim() === '').length;

  return (
    <div className="space-y-4 sm:space-y-6 pb-8">
      {/* Phones: the quick look-up comes first */}
      <section aria-label="Find a zair" className={`${readOnly ? '' : 'md:hidden'} ${card} p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight text-stone-950">Find a zair</h2>
            <p className="mt-1 text-[13px] text-stone-600">Search by name, ITS, tour, office or room</p>
          </div>
          {onOpenAddZaer && (
            <button type="button" onClick={onOpenAddZaer} className={`${btn.primary} shrink-0`}>
              <Plus className="w-4 h-4" />
              Add zair
            </button>
          )}
        </div>

        <div className="relative mt-3">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={mobileQuickSearch}
            onChange={(e) => setMobileQuickSearch(e.target.value)}
            placeholder="Name, ITS, tour ID or room"
            aria-label="Find a zair"
            className={`${field} pl-9 pr-11`}
          />
          {mobileQuickSearch && (
            <button
              type="button"
              onClick={() => setMobileQuickSearch('')}
              className="absolute right-0 top-0 w-10 h-10 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-900 cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {mobileQuickSearch.trim() &&
          (mobileQuickMatches.length > 0 ? (
            <ul className="mt-3 max-h-[26rem] overflow-y-auto divide-y divide-stone-200 border-t border-stone-200">
              {mobileQuickMatches.map((res) => (
                <li key={res.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-950">
                        {res.isSpecialGuest && <Star aria-label="Starred" className="w-3.5 h-3.5 text-gold-500 fill-gold-400 shrink-0" />}
                        <span className="truncate">{res.applicantName}</span>
                      </div>
                      <div className="mt-0.5 text-[13px] text-stone-600 tabular-nums">
                        ITS {res.itsId || '—'} · Family {res.family || '—'}
                      </div>
                    </div>
                    {res.roomNumber ? (
                      <span className="shrink-0 text-right text-[13px] font-bold text-stone-950 tabular-nums">
                        {res.building} {res.roomNumber}
                      </span>
                    ) : (
                      <span className={`${chip('wait')} shrink-0`}>Needs a room</span>
                    )}
                  </div>

                  <div className="mt-1 text-[13px] text-stone-600">
                    <span className="tabular-nums">Tour {res.tourRefNo || res.tourId || '—'}</span>
                    {res.officeName && <span> · {res.officeName}</span>}
                  </div>
                  <div className="mt-0.5 text-[13px] text-stone-500 tabular-nums">
                    {formatStay((res.arrivalDate || '').slice(0, 10), res.arrivalTime || SUBVENUE_ARRIVAL_TIME)}
                    {' → '}
                    {formatStay((res.departureDate || '').slice(0, 10), res.departureTime || SUBVENUE_DEPARTURE_TIME)}
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    {res.roomNumber && onOpenSwitchRoomModal ? (
                      <button type="button" onClick={() => onOpenSwitchRoomModal({ reservations: [res] })} className={btn.primary}>
                        <ArrowRightLeft className="w-4 h-4" />
                        Switch room
                      </button>
                    ) : (
                      onOpenQuickAllotModal && (
                        <button type="button" onClick={() => onOpenQuickAllotModal(res)} className={btn.primary}>
                          <Sparkles className="w-4 h-4" />
                          Allot room
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const tid = (res.tourRefNo || res.tourId || '').trim();
                        if (tid) {
                          setDashTourId(tid);
                          setMobileQuickSearch('');
                        }
                      }}
                      className={btn.secondary}
                    >
                      View tour
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 py-3 text-center text-[13px] text-stone-600">
              No zaereen match "{mobileQuickSearch}". Try a name, an ITS number, a Tour ID or a room number.
            </p>
          ))}
      </section>

      {/* Page header: title, today's context, NKERP status and the main actions */}
      <div className="hidden md:block">
        <PageHeader
          title="Reception overview"
          description={
            <span className="block text-balance">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' · '}
              {rooms.length} rooms in {distinctBuildings.join(', ')}
            </span>
          }
          meta={nkerpLine}
          actions={
            <>
              {!readOnly && (<>
              <button
                type="button"
                onClick={onDownloadTemplate}
                className={btn.ghost}
                title="Download a blank Excel file with the required columns"
              >
                Excel template
              </button>
              <button type="button" onClick={onOpenUploadExcel} className={btn.secondary}>
                <Upload className="w-4 h-4 text-stone-500" />
                Upload Excel
              </button>
              </>)}
              {onOpenAddTourGroup && (
                <button
                  type="button"
                  onClick={onOpenAddTourGroup}
                  className={btn.secondary}
                  title="Add several zaereen who share a Tour ID and dates"
                >
                  <Users className="w-4 h-4 text-stone-500" />
                  Add tour group
                </button>
              )}
              {onOpenAddZaer && (
                <button type="button" onClick={onOpenAddZaer} className={btn.primary}>
                  <Plus className="w-4 h-4" />
                  Add zair
                </button>
              )}
            </>
          }
        />
      </div>
      <div className="md:hidden px-1">{nkerpLine}</div>

      {/* Key numbers: one quiet strip, colour only where it means something */}
      <section aria-label="Key numbers" className={`${card} overflow-hidden`}>
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-stone-200">
          {(
            [
              {
                label: 'Zaereen',
                value: totalZaereen,
                foot:
                  unallottedZaereen.length > 0 ? (
                    <span className={chip('wait')}>
                      <AlertCircle className="w-3.5 h-3.5" />
                      {unallottedZaereen.length} need a room
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      All have rooms
                    </span>
                  ),
              },
              {
                label: 'Vacant rooms',
                value: vacantCount,
                swatch: 'bg-emerald-100 ring-[1.5px] ring-inset ring-emerald-500',
                foot: 'Ready to allot',
              },
              {
                label: 'Occupied rooms',
                value: occupiedCount,
                swatch: 'bg-linear-to-r from-orange-300 from-50% to-rose-600 to-50%',
                foot: <span className="tabular-nums">{partialOccupiedCount} with space, {fullOccupiedCount} full</span>,
              },
              { label: 'Blocked rooms', value: blockedCount, swatch: 'bg-stone-100 ring-1 ring-inset ring-stone-300', hatch: true, foot: 'Maintenance or VIP' },
              {
                label: 'B→A shifts',
                value: bToACount,
                foot: (
                  <span className="tabular-nums">
                    {bToAPaidCount} paid,{' '}
                    <span className={bToACount - bToAPaidCount > 0 ? 'text-amber-700' : ''}>{bToACount - bToAPaidCount} pending</span>
                  </span>
                ),
              },
              {
                label: 'Uploaded to portal',
                value: uploadedCount,
                suffix: `of ${totalZaereen}`,
                progress: totalZaereen > 0 ? Math.round((uploadedCount / totalZaereen) * 100) : 0,
              },
            ] as { label: string; value: number; foot?: React.ReactNode; swatch?: string; hatch?: boolean; suffix?: string; progress?: number }[]
          ).map((k) => (
            <div key={k.label} className="bg-white px-4 py-4 sm:px-5">
              <dt className="flex items-center gap-1.5 text-[13px] text-stone-600">
                {k.swatch && (
                  <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-[3px] shrink-0 ${k.swatch}`} style={k.hatch ? HATCH : undefined} />
                )}
                {k.label}
              </dt>
              <dd className="mt-2 flex items-baseline gap-1.5">
                <CountUp value={k.value} className="type-display text-[34px] leading-none font-semibold text-stone-950" />
                {k.suffix && <span className="text-[13px] text-stone-500 tabular-nums">{k.suffix}</span>}
              </dd>
              <dd className="mt-2 min-h-6 flex items-center text-[13px] text-stone-600">
                {typeof k.progress === 'number' ? (
                  <span className="flex flex-1 items-center gap-2">
                    <span className="h-1.5 flex-1 rounded-full bg-stone-200 overflow-hidden">
                      <span className="block h-full rounded-full bg-brand-600 transition-[width] duration-700 ease-out" style={{ width: `${k.progress}%` }} />
                    </span>
                    <span className="tabular-nums">{k.progress}%</span>
                  </span>
                ) : (
                  k.foot
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Buildings today: every room, floor by floor */}
      <BuildingBoard rooms={rooms} getRoomState={getMatrixState} date={selectedDate} isToday={isToday} onSelectRoom={setInspectedRoom} />

      {/* ========================================================================= */}
      {/* TOURS AND FAMILIES: allot or switch rooms for a whole family at once       */}
      {/* ========================================================================= */}
      <section aria-label="Tours and families" className={`${card} p-4 sm:p-6 @container`}>
        <SectionHeader
          title="Tours and families"
          description={readOnly ? 'Find a tour by ID, office or date to see its families, rooms and dates.' : 'Find a tour by ID, office or date, then allot or switch rooms for a whole family at once.'}
          actions={
            <>
              {tourSummaries.length > 0 && (
                <span className="text-[13px] text-stone-600 tabular-nums">
                  {filteredTourSummaries.length} of {tourSummaries.length} tours
                </span>
              )}
              {hasTourFilter && (
                <button type="button" onClick={resetTourFilters} className={`${btnSm.ghost} ${touch}`} title="Reset search and date filters">
                  <RefreshCw className="w-4 h-4" />
                  Reset
                </button>
              )}
              {onOpenAddTourGroup && (
                <button
                  type="button"
                  onClick={onOpenAddTourGroup}
                  className={`md:hidden ${btn.secondary}`}
                  title="Add several zaereen who share a Tour ID and dates"
                >
                  <Users className="w-4 h-4 text-stone-500" />
                  Add tour group
                </button>
              )}
            </>
          }
        />

        {/* Find a tour: search, arrival date, departure date, then the tour itself */}
        <div className="mt-4 grid grid-cols-2 xl:grid-cols-12 gap-3">
          <div className="col-span-2 sm:col-span-1 xl:col-span-3">
            <label htmlFor="overview-tour-search" className={fieldLabel}>
              Search
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="overview-tour-search"
                type="text"
                placeholder="Tour ID or office name"
                value={tourSearchQuery}
                onChange={(e) => setTourSearchQuery(e.target.value)}
                className={`${field} pl-9 pr-10`}
              />
              {tourSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTourSearchQuery('')}
                  className="absolute right-0 top-0 w-10 h-10 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-900 cursor-pointer"
                  title="Clear Tour ID / office search"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="xl:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="overview-tour-arrival" className="text-[13px] font-medium text-stone-700">
                Arriving on
              </label>
              {tourArrivalDateFilter && (
                <button
                  type="button"
                  onClick={() => setTourArrivalDateFilter('')}
                  className="text-xs font-medium text-brand-700 hover:underline cursor-pointer max-lg:-my-3 max-lg:py-3"
                  title="Clear arrival date filter"
                >
                  Clear
                </button>
              )}
            </div>
            <input
              id="overview-tour-arrival"
              type="date"
              value={tourArrivalDateFilter}
              onChange={(e) => setTourArrivalDateFilter(e.target.value)}
              className={`${field} cursor-pointer`}
              title="Show tours arriving on this date"
            />
          </div>

          <div className="xl:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="overview-tour-departure" className="text-[13px] font-medium text-stone-700">
                Leaving on
              </label>
              {tourDepartureDateFilter && (
                <button
                  type="button"
                  onClick={() => setTourDepartureDateFilter('')}
                  className="text-xs font-medium text-brand-700 hover:underline cursor-pointer max-lg:-my-3 max-lg:py-3"
                  title="Clear departure date filter"
                >
                  Clear
                </button>
              )}
            </div>
            <input
              id="overview-tour-departure"
              type="date"
              value={tourDepartureDateFilter}
              onChange={(e) => setTourDepartureDateFilter(e.target.value)}
              className={`${field} cursor-pointer`}
              title="Show tours leaving on this date"
            />
          </div>

          <div className="col-span-2 sm:col-span-1 xl:col-span-5">
            <label htmlFor="overview-tour-select" className={fieldLabel}>
              Tour
            </label>
            <select
              id="overview-tour-select"
              value={currentTourId}
              onChange={(e) => setDashTourId(e.target.value)}
              className={`${field} font-medium truncate`}
            >
              {filteredTourSummaries.length > 0 ? (
                filteredTourSummaries.map((t) => (
                  <option key={t.tourId} value={t.tourId}>
                    {t.tourId}
                    {t.officeDisplay ? ` · ${t.officeDisplay}` : ''} · {formatDay(t.primaryArrivalDate) || '—'} → {formatDay(t.primaryDepartureDate) || '—'} · {t.totalZaereen} zaereen
                  </option>
                ))
              ) : (
                <option value="">No tours match the search</option>
              )}
            </select>
          </div>
        </div>

        {/* A short list of matches becomes one-tap choices */}
        {filteredTourSummaries.length > 1 && filteredTourSummaries.length <= 8 && (
          <div className="mt-3 flex items-center gap-2 overflow-x-auto app-scroll-x">
            <span className="text-xs text-stone-500 shrink-0">Matching tours</span>
            {filteredTourSummaries.map((t) => {
              const isSelected = t.tourId === currentTourId;
              return (
                <button
                  key={t.tourId}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setDashTourId(t.tourId)}
                  className={`${isSelected ? btnSm.primary : btnSm.secondary} ${touch} shrink-0`}
                >
                  <span className="tabular-nums">{t.tourId}</span>
                  {t.officeDisplay && <span className="max-w-[140px] truncate font-normal opacity-85">· {t.officeDisplay}</span>}
                  <span className="font-normal opacity-85 tabular-nums">
                    {formatDay(t.primaryArrivalDate) || '—'} → {formatDay(t.primaryDepartureDate) || '—'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* The chosen tour: who it is, when it stays, and its two actions */}
        {currentTourId &&
          showTour &&
          (() => {
            const tourSum = tourSummaries.find((t) => t.tourId === currentTourId);
            const tourChanges = tourSum?.roomChanges || [];
            const tourMembers = reservations.filter((r) => r.tourRefNo === currentTourId);
            const tourStarredCount = tourMembers.filter((r) => r.isSpecialGuest).length;
            const hasSpecial = tourStarredCount > 0;
            const firstMember = tourMembers[0];
            return (
              <div className={`${panel} mt-4 px-4 py-3.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <h3 className="text-base font-semibold text-stone-950 tabular-nums break-all">
                      <span className="font-normal text-stone-500">Tour ID</span> {currentTourId}
                    </h3>
                    {tourSum?.hasRoomChange && (
                      <ChangeHistory label={`Room changed (${tourChanges.length})`} title={`Room changes for Tour ${currentTourId}`}>
                        {tourChanges.length > 0 ? (
                          tourChanges.map((ch, idx) => (
                            <div key={idx} className="py-2 first:pt-0 last:pb-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[13px] font-medium text-stone-900">{ch.guestName}</span>
                                <span className="shrink-0 text-xs text-stone-500 tabular-nums">Family {ch.family}</span>
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] tabular-nums">
                                <span className="text-stone-500 line-through">Room {ch.fromRoom}</span>
                                <ArrowRight className="w-3 h-3 text-stone-400 shrink-0" />
                                <span className="font-semibold text-stone-950">
                                  Room {ch.toRoom} ({ch.toBuilding || 'Hotel'})
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-stone-500">
                                <span>{ch.reason || 'Room reallocated'}</span>
                                <span className="shrink-0 tabular-nums">{formatWhen(ch.changedAt)}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-[13px] text-stone-600">A room in this tour was changed. No details were recorded.</p>
                        )}
                      </ChangeHistory>
                    )}
                  </div>
                  {tourSum && (
                    <p className="mt-1 text-[13px] text-stone-600 tabular-nums">
                      {tourSum.officeDisplay && <span className="font-medium text-stone-800">{tourSum.officeDisplay} · </span>}
                      {tourSum.totalZaereen} zaereen · {tourSum.familiesCount} {tourSum.familiesCount === 1 ? 'family' : 'families'} ·{' '}
                      {formatDay(tourSum.primaryArrivalDate) || '—'} → {formatDay(tourSum.primaryDepartureDate) || '—'}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {onOpenPdfModal && (
                    <button
                      type="button"
                      onClick={() => onOpenPdfModal('tour_manifest', currentTourId)}
                      className={`${btnSm.secondary} ${touch}`}
                      title={`Open the lodging manifest for Tour ${currentTourId} (names, allotments and PDF)`}
                    >
                      <FileText className="w-4 h-4 text-stone-500" />
                      Tour manifest
                    </button>
                  )}
                  {firstMember && !readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        setSpecialGuestModalTarget(firstMember);
                        setSpecialGuestInitialScope('tour');
                      }}
                      className={`${btnSm.ghost} ${touch}`}
                      title={`Mark or edit special requirements for Tour ${currentTourId}`}
                    >
                      <Star className={`w-4 h-4 ${hasSpecial ? 'fill-gold-400 text-gold-500' : ''}`} />
                      <span className={hasSpecial ? 'text-gold-700' : ''}>
                        {hasSpecial ? `Tour special (${tourStarredCount}/${tourMembers.length})` : 'Star tour'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

        {/* The families of the chosen tour, one row each */}
        {familiesInTour.length > 0 && showTour ? (
          <ul className="mt-1">
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

              // All rooms in the selected building for this family
              const allRoomsInBuilding = rooms
                .filter((r) => (r.building || '').trim().toLowerCase() === currentBuilding.trim().toLowerCase())
                .sort((a, b) => {
                  const floorDiff = a.floor - b.floor;
                  if (floorDiff !== 0) return floorDiff;
                  const numA = parseInt(a.roomNumber.replace(/\D/g, '')) || 0;
                  const numB = parseInt(b.roomNumber.replace(/\D/g, '')) || 0;
                  return numA !== numB ? numA - numB : a.roomNumber.localeCompare(b.roomNumber);
                });

              const vacantRoomNumbers = new Set(vacantRoomsForFam.map((r) => r.roomNumber));
              const otherRoomsInBuilding = allRoomsInBuilding.filter(
                (r) => !vacantRoomNumbers.has(r.roomNumber) && r.roomNumber !== currentRoom
              );

              const isExpanded = !!expandedFamilies[famItem.family];
              const famStarredCount = famItem.members.filter((m) => m.isSpecialGuest).length;
              const famHasSpecial = famStarredCount > 0;
              const firstMember = famItem.members[0];

              return (
                <li key={famItem.family} className="border-t border-stone-200 py-4 first:border-t-0 last:pb-0">
                  <div className="grid grid-cols-1 @min-[62rem]:grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3">
                    {/* Who they are */}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <h4 className="text-[15px] font-semibold text-stone-950 tabular-nums">Family {famItem.family}</h4>
                        <span className="text-[13px] text-stone-600 tabular-nums">
                          {famItem.totalCount} {famItem.totalCount === 1 ? 'member' : 'members'}
                        </span>
                        {famItem.isFullyAllotted ? (
                          <span className={chip('ok')}>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Room {famItem.commonRoom} · {famItem.commonBuilding}
                          </span>
                        ) : famItem.allottedCount > 0 ? (
                          <span className={chip('wait')}>
                            {famItem.allottedCount} of {famItem.totalCount} allotted
                          </span>
                        ) : (
                          <span className={chip('wait')}>Needs a room</span>
                        )}
                        {famItem.hasRoomChange && (
                          <ChangeHistory label="Room changed" title={`Room changes for Family ${famItem.family}`}>
                            {famItem.familyChanges.length > 0 ? (
                              famItem.familyChanges.map((ch, cIdx) => (
                                <div key={cIdx} className="py-2 first:pt-0 last:pb-0">
                                  <div className="text-[13px] font-medium text-stone-900">{ch.guestName}</div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] tabular-nums">
                                    <span className="text-stone-500 line-through">Room {ch.fromRoom}</span>
                                    <ArrowRight className="w-3 h-3 text-stone-400 shrink-0" />
                                    <span className="font-semibold text-stone-950">
                                      Room {ch.toRoom} ({ch.toBuilding || 'Hotel'})
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-xs text-stone-500 tabular-nums">{formatWhen(ch.changedAt)}</div>
                                </div>
                              ))
                            ) : (
                              <p className="text-[13px] text-stone-600">A room in this family was changed. No details were recorded.</p>
                            )}
                          </ChangeHistory>
                        )}
                      </div>

                      <p className="mt-1 text-[13px] text-stone-600 tabular-nums">
                        {formatStay(famItem.arrivalDate, famItem.arrivalTime)} → {formatStay(famItem.departureDate, famItem.departureTime)}
                        {famItem.officeName && <span> · {famItem.officeName}</span>}
                      </p>

                      <p className="mt-1.5 text-[13px] leading-relaxed text-stone-800">
                        {famItem.members.map((m, mIdx) => (
                          <span key={m.id} className="inline-block mr-1.5" title={m.isSpecialGuest ? m.specialRemarks || 'Special guest' : undefined}>
                            {m.isSpecialGuest && (
                              <Star aria-label="Starred" className="inline-block w-3.5 h-3.5 mr-1 -mt-0.5 text-gold-500 fill-gold-400" />
                            )}
                            <span className={m.isSpecialGuest ? 'font-semibold' : ''}>{m.applicantName}</span>
                            {m.age !== undefined && m.age !== null && String(m.age) !== '' && (
                              <span className="text-stone-500 tabular-nums">, {m.age}</span>
                            )}
                            {mIdx < famItem.members.length - 1 && <span className="ml-1.5 text-stone-400">·</span>}
                          </span>
                        ))}
                      </p>

                      {/* Special requirements: seen before a room is chosen */}
                      {famHasSpecial && (
                        <div className="mt-2.5 rounded-lg bg-amber-50 px-3 py-2">
                          <div className="flex items-center gap-1.5 text-[13px] font-medium text-amber-900">
                            <Star className="w-3.5 h-3.5 shrink-0 text-gold-500 fill-gold-400" />
                            Special guest requirements. Do not overlook when allotting.
                          </div>
                          <ul className="mt-1 space-y-0.5">
                            {famItem.members
                              .filter((m) => m.isSpecialGuest)
                              .map((m) => (
                                <li key={m.id}>
                                  <button
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() => {
                                      setSpecialGuestModalTarget(m);
                                      setSpecialGuestInitialScope('guest');
                                    }}
                                    className="text-left text-[13px] text-amber-900 enabled:hover:underline enabled:cursor-pointer max-lg:min-h-10"
                                    title={readOnly ? undefined : "Edit this guest's special requirements"}
                                  >
                                    <span className="font-semibold tabular-nums">
                                      {m.applicantName} ({m.itsId}):
                                    </span>{' '}
                                    {m.specialRemarks || 'Special VIP requirements noted'}
                                  </button>
                                </li>
                              ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Where they go */}
                    <div className="@min-[62rem]:w-[38rem] flex flex-wrap items-start gap-x-2 gap-y-1">
                      {readOnly ? (
                        <span className="text-sm font-semibold text-stone-950 tabular-nums">
                          {famItem.allottedCount > 0 && currentRoom ? `${currentBuilding} ${currentRoom}` : 'No room yet'}
                        </span>
                      ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Building for Family ${famItem.family}`}
                          value={currentBuilding}
                          onChange={(e) => {
                            const newB = e.target.value;
                            setFamilyDrafts((prev) => ({
                              ...prev,
                              [famItem.family]: { building: newB, roomNumber: '' },
                            }));
                          }}
                          className={`${fieldSm} ${touch} w-[calc(40%-0.25rem)] sm:w-28 font-medium`}
                        >
                          {distinctBuildings.map((bldg) => (
                            <option key={bldg} value={bldg}>
                              {bldg}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label={`Room for Family ${famItem.family}`}
                          value={currentRoom}
                          onChange={(e) => {
                            const newR = e.target.value;
                            setFamilyDrafts((prev) => ({
                              ...prev,
                              [famItem.family]: { building: currentBuilding, roomNumber: newR },
                            }));
                          }}
                          className={`${fieldSm} ${touch} w-[calc(60%-0.25rem)] sm:w-40 font-medium`}
                        >
                          <option value="">Choose a room</option>
                          {currentRoom && (
                            <option value={currentRoom}>
                              Room {currentRoom} · current
                            </option>
                          )}
                          {vacantRoomsForFam.length > 0 && (
                            <optgroup label={`Vacant rooms in ${currentBuilding} (${vacantRoomsForFam.length})`}>
                              {vacantRoomsForFam
                                .filter((rm) => rm.roomNumber !== currentRoom)
                                .map((rm) => (
                                  <option key={rm.id} value={rm.roomNumber}>
                                    Room {rm.roomNumber} · {rm.floorLabel || `Floor ${rm.floor}`} · sleeps {rm.capacity}{rm.buffer ? `+${rm.buffer}` : ''}
                                  </option>
                                ))}
                            </optgroup>
                          )}
                          {otherRoomsInBuilding.length > 0 && (
                            <optgroup label={`Other rooms in ${currentBuilding} (${otherRoomsInBuilding.length})`}>
                              {otherRoomsInBuilding.map((rm) => (
                                <option key={rm.id} value={rm.roomNumber}>
                                  Room {rm.roomNumber} · {rm.floorLabel || `Floor ${rm.floor}`} · sleeps {rm.capacity}{rm.status === 'blocked' ? ' · blocked' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {allRoomsInBuilding.length === 0 && (
                            <option value="" disabled>
                              No rooms set up in {currentBuilding}
                            </option>
                          )}
                        </select>

                        {allRoomsInBuilding.length === 0 && onOpenAddBuildingRooms && (
                          <button
                            type="button"
                            onClick={onOpenAddBuildingRooms}
                            className={`${btnSm.secondary} ${touch}`}
                            title={`Add rooms to ${currentBuilding}`}
                          >
                            <Plus className="w-4 h-4" />
                            Add rooms
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={!currentRoom}
                          onClick={() => {
                            if (onBatchAllotFamily && currentRoom) {
                              onBatchAllotFamily(currentTourId, famItem.family, currentBuilding, currentRoom);
                            }
                          }}
                          className={`${btnSm.primary} ${touch} tabular-nums`}
                        >
                          Allot family ({famItem.totalCount})
                        </button>

                        {famItem.allottedCount > 0 && onOpenSwitchRoomModal && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenSwitchRoomModal({
                                reservations: famItem.members,
                                initialScope: 'group',
                              })
                            }
                            className={`${btnSm.secondary} ${touch}`}
                            title="Switch or swap room for this family"
                          >
                            <ArrowRightLeft className="w-4 h-4 text-stone-500" />
                            Switch room
                          </button>
                        )}

                        {famItem.allottedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (onBatchAllotFamily) {
                                onBatchAllotFamily(currentTourId, famItem.family, currentBuilding, '');
                              }
                            }}
                            className={`${btnSm.ghost} ${touch}`}
                            title="Clear allotment for this entire family"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      )}

                      <div className="-ml-2.5 @min-[40rem]:ml-auto @min-[62rem]:-ml-2.5 flex items-center gap-x-1">
                        {firstMember && !readOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              setSpecialGuestModalTarget(firstMember);
                              setSpecialGuestInitialScope('family');
                            }}
                            className={`${btnSm.ghost} ${touch}`}
                            title={`Mark or edit special requirements for Family ${famItem.family}`}
                          >
                            <Star className={`w-4 h-4 ${famHasSpecial ? 'fill-gold-400 text-gold-500' : ''}`} />
                            <span className={famHasSpecial ? 'text-gold-700' : ''}>
                              {famHasSpecial ? `Family special (${famStarredCount})` : 'Star family'}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleExpandFamily(famItem.family)}
                          className={`${btnSm.ghost} ${touch}`}
                        >
                          {!readOnly && <Pencil className="w-4 h-4" />}
                          {isExpanded ? 'Hide members' : readOnly ? 'View members' : 'Edit members'}
                          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Each member on their own line, directly editable */}
                  {isExpanded && (
                    <div className={`${panel} mt-3 px-3 sm:px-4 py-3 animate-in fade-in`}>
                      <div className="text-[13px] font-medium text-stone-800">
                        Family members
                        {!readOnly && <span className="font-normal text-stone-500"> · choosing a building or room here applies straight away</span>}
                      </div>
                      <ul className="mt-1 divide-y divide-stone-200">
                        {famItem.members.map((m) => {
                          const memberBuilding = m.building || 'Saifee';
                          const vacantForMember = getVacantRoomsForDuration(
                            memberBuilding,
                            m.arrivalDate,
                            m.departureDate,
                            rooms,
                            reservations,
                            m.id
                          );
                          const allRoomsForMember = rooms
                            .filter((r) => (r.building || '').trim().toLowerCase() === memberBuilding.trim().toLowerCase())
                            .sort((a, b) => {
                              const floorDiff = a.floor - b.floor;
                              if (floorDiff !== 0) return floorDiff;
                              const numA = parseInt(a.roomNumber.replace(/\D/g, '')) || 0;
                              const numB = parseInt(b.roomNumber.replace(/\D/g, '')) || 0;
                              return numA !== numB ? numA - numB : a.roomNumber.localeCompare(b.roomNumber);
                            });
                          const memberVacantSet = new Set(vacantForMember.map((r) => r.roomNumber));
                          const otherRoomsForMember = allRoomsForMember.filter(
                            (r) => !memberVacantSet.has(r.roomNumber) && r.roomNumber !== m.roomNumber
                          );
                          return (
                            <li key={m.id} className="py-2.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                              <div className="flex items-start gap-1 min-w-0">
                                <button
                                  type="button"
                                  disabled={readOnly}
                                  onClick={() => {
                                    setSpecialGuestModalTarget(m);
                                    setSpecialGuestInitialScope('guest');
                                  }}
                                  className="-ml-2 -mt-1.5 w-8 h-8 max-lg:w-10 max-lg:h-10 shrink-0 rounded-lg flex items-center justify-center text-stone-500 enabled:hover:text-stone-900 enabled:hover:bg-stone-200/70 enabled:cursor-pointer"
                                  title={`Mark or edit special requirements for ${m.applicantName} (guest, family or Tour ID)`}
                                  aria-label={m.isSpecialGuest ? `${m.applicantName} is starred. Edit special requirements` : `Star ${m.applicantName}`}
                                >
                                  <Star className={`w-4 h-4 ${m.isSpecialGuest ? 'text-gold-500 fill-gold-400' : ''}`} />
                                </button>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-baseline gap-x-2">
                                    <span className={`text-[13px] text-stone-900 ${m.isSpecialGuest ? 'font-semibold' : 'font-medium'}`}>{m.applicantName}</span>
                                    <span className="text-[13px] text-stone-500 tabular-nums">{m.itsId}</span>
                                  </div>
                                  <div className="mt-0.5 text-xs text-stone-500 tabular-nums">
                                    Age {m.age} · {m.gender} · {formatStay(m.arrivalDate, m.arrivalTime)} → {formatStay(m.departureDate, m.departureTime)}
                                  </div>
                                  {m.isSpecialGuest && m.specialRemarks && (
                                    <button
                                      type="button"
                                      disabled={readOnly}
                                      onClick={() => {
                                        setSpecialGuestModalTarget(m);
                                        setSpecialGuestInitialScope('guest');
                                      }}
                                      className="mt-0.5 text-left text-xs font-medium text-amber-800 enabled:hover:underline enabled:cursor-pointer max-lg:py-2"
                                      title="Edit this special lodging requirement"
                                    >
                                      Requirement: {m.specialRemarks}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {readOnly ? (
                                <span className="shrink-0 text-[13px] font-semibold text-stone-950 tabular-nums">
                                  {m.roomNumber ? `${m.building || ''} ${m.roomNumber}`.trim() : 'No room yet'}
                                </span>
                              ) : (
                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <select
                                  aria-label={`Building for ${m.applicantName}`}
                                  value={m.building || 'Saifee'}
                                  onChange={(e) => {
                                    onAllotRoom(m.id, e.target.value, m.roomNumber || '');
                                  }}
                                  className={`${fieldSm} ${touch} w-[calc(40%-0.25rem)] sm:w-28`}
                                >
                                  {distinctBuildings.map((bldg) => (
                                    <option key={bldg} value={bldg}>
                                      {bldg}
                                    </option>
                                  ))}
                                </select>

                                <select
                                  aria-label={`Room for ${m.applicantName}`}
                                  value={m.roomNumber || ''}
                                  onChange={(e) => {
                                    onAllotRoom(m.id, m.building || 'Saifee', e.target.value);
                                  }}
                                  className={`${fieldSm} ${touch} w-[calc(60%-0.25rem)] sm:w-40`}
                                >
                                  <option value="">No room</option>
                                  {m.roomNumber && (
                                    <option value={m.roomNumber}>Room {m.roomNumber} · current</option>
                                  )}
                                  {vacantForMember.length > 0 && (
                                    <optgroup label={`Vacant (${vacantForMember.length})`}>
                                      {vacantForMember
                                        .filter((rm) => rm.roomNumber !== m.roomNumber)
                                        .map((rm) => (
                                          <option key={rm.id} value={rm.roomNumber}>
                                            Room {rm.roomNumber} · {rm.floorLabel || `Floor ${rm.floor}`} · sleeps {rm.capacity}
                                          </option>
                                        ))}
                                    </optgroup>
                                  )}
                                  {otherRoomsForMember.length > 0 && (
                                    <optgroup label={`Other rooms (${otherRoomsForMember.length})`}>
                                      {otherRoomsForMember.map((rm) => (
                                        <option key={rm.id} value={rm.roomNumber}>
                                          Room {rm.roomNumber} · {rm.floorLabel || `Floor ${rm.floor}`} · sleeps {rm.capacity}{rm.status === 'blocked' ? ' · blocked' : ''}
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                  {allRoomsForMember.length === 0 && (
                                    <option value="" disabled>No rooms in {memberBuilding}</option>
                                  )}
                                </select>

                                {onOpenSwitchRoomModal && m.roomNumber && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenSwitchRoomModal({
                                        reservations: [m],
                                        initialScope: 'single',
                                      })
                                    }
                                    className={`${btnSm.secondary} ${touch}`}
                                    title={`Switch room for ${m.applicantName}`}
                                  >
                                    <ArrowRightLeft className="w-4 h-4 text-stone-500" />
                                    Switch
                                  </button>
                                )}

                                {onDeleteReservation && (
                                  <button
                                    type="button"
                                    onClick={() => setRecordToDelete(m)}
                                    className={`${btnSm.danger} ${touch} px-2`}
                                    title={`Delete the zair record for ${m.applicantName}`}
                                    aria-label={`Delete the zair record for ${m.applicantName}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-4 border-t border-stone-200 py-10 text-center">
            {tourSummaries.length === 0 ? (
              <>
                <p className="text-sm font-medium text-stone-800">No tours yet</p>
                <p className="mt-1 text-[13px] text-stone-600">
                  Tours and their families appear here after a pull from NKERP, an Excel upload or a tour group you add.
                </p>
              </>
            ) : filteredTourSummaries.length === 0 ? (
              <>
                <p className="text-sm font-medium text-stone-800">No tours match</p>
                <p className="mt-1 text-[13px] text-stone-600">
                  {[
                    tourSearchQuery ? `Tour ID or office "${tourSearchQuery}"` : '',
                    tourArrivalDateFilter ? `arriving on ${formatDay(tourArrivalDateFilter)}` : '',
                    tourDepartureDateFilter ? `leaving on ${formatDay(tourDepartureDateFilter)}` : '',
                  ]
                    .filter(Boolean)
                    .join(', ') || 'Nothing fits the current search.'}
                </p>
              </>
            ) : (
              <p className="text-sm font-medium text-stone-800">No zaereen found for Tour ID {currentTourId || ''}</p>
            )}
            {hasTourFilter && (
              <button type="button" onClick={resetTourFilters} className={`${btn.secondary} mt-4`}>
                <RefreshCw className="w-4 h-4 text-stone-500" />
                Reset search and dates
              </button>
            )}
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* ROOMS: the timeline (rooms down, days across) or the grid                  */}
      {/* ========================================================================= */}
      <SectionHeader
        className="pt-2"
        title="Rooms"
        description={`${rooms.length} rooms across ${distinctBuildings.join(', ')}`}
        actions={
          <div role="tablist" aria-label="Room view" className={segTrack}>
            <button
              type="button"
              role="tab"
              aria-selected={roomsViewMode === 'timeline'}
              onClick={() => setRoomsViewMode('timeline')}
              className={segBtn(roomsViewMode === 'timeline')}
            >
              <Calendar className="w-4 h-4" />
              Timeline
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={roomsViewMode === 'buttons'}
              onClick={() => setRoomsViewMode('buttons')}
              className={segBtn(roomsViewMode === 'buttons')}
            >
              <Building2 className="w-4 h-4" />
              Grid
            </button>
          </div>
        }
      />

      {/* If Timeline View selected, render the dedicated RoomTimelineView */}
      {roomsViewMode === 'timeline' && (
        <RoomTimelineView
          rooms={rooms}
          reservations={reservations}
          onAllotRoom={onAllotRoom}
          onBatchAllotFamily={onBatchAllotFamily}
          onAddReservation={onAddReservation}
          userRole={userRole}
          onOpenReceptionSlip={onOpenReceptionSlip}
          onOpenQuickAllotModal={onOpenQuickAllotModal}
          onOpenAddBuildingRooms={onOpenAddBuildingRooms}
          onRefreshLiveComputerData={onRefreshLiveComputerData}
        />
      )}

      {/* The room grid: every room as a small button, by building and floor, for any date */}
      {roomsViewMode === 'buttons' && (
        <section aria-label="Room grid" className={`${card} p-4 sm:p-6`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-stone-950">Room vacancy and allotment</h3>
              <p className="mt-1 text-[13px] text-stone-600">
                Choose a room to see who is in it, switch rooms or allot a waiting zair.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="overview-grid-date" className={fieldLabel}>
                  Date
                </label>
                <input
                  id="overview-grid-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className={`${fieldSm} ${touch} cursor-pointer`}
                />
              </div>
              <button type="button" onClick={() => setSelectedDate(todayStr)} className={`${btnSm.ghost} ${touch} mb-0.5`}>
                Today
              </button>
              <button
                type="button"
                onClick={handleRefreshMatrix}
                disabled={isRefreshingMatrix}
                className={`${btnSm.secondary} ${touch} mb-0.5`}
                title="Reload the room allotments and zaereen saved on this computer. The chosen date stays as it is."
              >
                <RefreshCw className={`w-4 h-4 text-stone-500 ${isRefreshingMatrix ? 'animate-spin' : ''}`} />
                {isRefreshingMatrix ? 'Refreshing…' : 'Refresh grid'}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            {/* Building */}
            <div role="group" aria-label="Building" className={segTrack}>
              <button type="button" aria-pressed={selectedHotel === 'ALL'} onClick={() => setSelectedHotel('ALL')} className={segBtn(selectedHotel === 'ALL')}>
                All <span className="tabular-nums opacity-70">{rooms.length}</span>
              </button>
              {distinctBuildings.map((bldg) => {
                const bldgCount = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length;
                const on = selectedHotel.toLowerCase() === bldg.toLowerCase();
                return (
                  <button key={bldg} type="button" aria-pressed={on} onClick={() => setSelectedHotel(bldg)} className={segBtn(on)}>
                    {bldg} <span className="tabular-nums opacity-70">{bldgCount}</span>
                  </button>
                );
              })}
            </div>

            {/* State: each choice carries its swatch, so this row is the legend too */}
            <div role="group" aria-label="Room state" className={segTrack}>
              {(
                [
                  { id: 'all', label: 'All', count: filteredRooms.length, title: 'Every room' },
                  {
                    id: 'available',
                    label: 'Vacant',
                    count: completelyAvailableCount,
                    title: 'Nobody in the room, the whole room is free',
                    swatch: <RoomSwatch status="available" className="w-3 h-3 rounded-[3px]" />,
                  },
                  {
                    id: 'partial',
                    label: 'Has space',
                    count: partialOccupiedCount,
                    title: 'Occupied, with places still open for a zair',
                    swatch: <RoomSwatch status="partial" className="w-3 h-3 rounded-[3px]" />,
                  },
                  {
                    id: 'full',
                    label: 'Full',
                    count: fullOccupiedCount,
                    title: 'Occupied, no space left',
                    swatch: <RoomSwatch status="full" className="w-3 h-3 rounded-[3px]" />,
                  },
                  {
                    id: 'blocked',
                    label: 'Blocked',
                    count: blockedCount,
                    title: 'Blocked for maintenance or on hold',
                    swatch: <RoomSwatch status="blocked" className="w-3 h-3 rounded-[3px] ring-1 ring-inset ring-stone-300" />,
                  },
                  {
                    id: 'vip',
                    label: 'VIP',
                    count: vipRoomsCount,
                    title: 'Rooms with a VIP Tour ID, marked with a small v',
                    swatch: (
                      <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full bg-gold-300 text-[11px] leading-[14px] font-semibold text-stone-950 text-center">
                        v
                      </span>
                    ),
                  },
                ] as { id: typeof statusFilter; label: string; count: number; title: string; swatch?: React.ReactNode }[]
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={statusFilter === o.id}
                  onClick={() => setStatusFilter(o.id)}
                  title={o.title}
                  className={segBtn(statusFilter === o.id)}
                >
                  {o.swatch}
                  {o.label} <span className="tabular-nums opacity-70">{o.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* The buildings, floor by floor */}
          <div className="mt-5 space-y-5 border-t border-stone-200 pt-5">
            {/* Burhani: Ground, Mezzanine, Floors 1 to 4 */}
            {(selectedHotel === 'ALL' || selectedHotel.toLowerCase() === 'burhani') &&
              (() => {
                const burhaniRooms = rooms.filter((r) => r.building.toLowerCase() === 'burhani');
                const byNumber = (list: Room[]) =>
                  [...list].sort((a, b) => {
                    const numA = parseInt(a.roomNumber.replace(/\D/g, '')) || 0;
                    const numB = parseInt(b.roomNumber.replace(/\D/g, '')) || 0;
                    return numA - numB;
                  });
                return renderGridBuilding('Burhani', `${burhaniRooms.length} rooms · Ground, Mezzanine, Floors 1 to 4`, burhaniRooms, [
                  { label: 'Ground', rooms: byNumber(burhaniRooms.filter((r) => r.roomNumber.startsWith('G'))) },
                  { label: 'Mezzanine', rooms: byNumber(burhaniRooms.filter((r) => r.roomNumber.startsWith('M'))) },
                  { label: 'Floor 1 (101–110)', rooms: byNumber(burhaniRooms.filter((r) => r.floor === 1 && !r.roomNumber.startsWith('M'))) },
                  { label: 'Floor 2 (201–210)', rooms: byNumber(burhaniRooms.filter((r) => r.floor === 2)) },
                  { label: 'Floor 3 (301–310)', rooms: byNumber(burhaniRooms.filter((r) => r.floor === 3)) },
                  { label: 'Floor 4 (401–410)', rooms: byNumber(burhaniRooms.filter((r) => r.floor === 4)) },
                ]);
              })()}

            {/* Saifee: Floors 1 to 7 */}
            {(selectedHotel === 'ALL' || selectedHotel.toLowerCase() === 'saifee') &&
              (() => {
                const saifeeRooms = rooms.filter((r) => r.building.toLowerCase() === 'saifee');
                return renderGridBuilding(
                  'Saifee',
                  `${saifeeRooms.length} rooms · Floors 1 to 7`,
                  saifeeRooms,
                  [1, 2, 3, 4, 5, 6, 7].map((fl) => ({
                    label: `Floor ${fl} (${fl}01–${fl}10)`,
                    rooms: saifeeRooms.filter((r) => r.floor === fl).sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber)),
                  }))
                );
              })()}

            {/* Every other building in the inventory (Badri, Mohammedi, any added later) */}
            {distinctBuildings
              .filter((bldg) => !['burhani', 'saifee'].includes(bldg.toLowerCase()))
              .filter((bldg) => selectedHotel === 'ALL' || selectedHotel.toLowerCase() === bldg.toLowerCase())
              .map((bldg) => {
                const bldgRooms = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase());
                if (bldgRooms.length === 0) return null;

                // Group by floor
                const floorMap = new Map<string, Room[]>();
                bldgRooms.forEach((r) => {
                  const flKey = r.floorLabel || `Floor ${r.floor}`;
                  if (!floorMap.has(flKey)) floorMap.set(flKey, []);
                  floorMap.get(flKey)!.push(r);
                });

                return renderGridBuilding(
                  bldg,
                  `${bldgRooms.length} rooms`,
                  bldgRooms,
                  Array.from(floorMap.entries()).map(([flLabel, flRooms]) => ({
                    label: flLabel,
                    rooms: [...flRooms].sort((a, b) => {
                      const numA = parseInt(a.roomNumber.replace(/\D/g, '')) || 0;
                      const numB = parseInt(b.roomNumber.replace(/\D/g, '')) || 0;
                      return numA - numB;
                    }),
                  }))
                );
              })}
          </div>
        </section>
      )}

      {/* Arrivals and departures for the chosen date */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Arrivals */}
        <section aria-label={`Arrivals ${dayPhrase}`} className={`${card} flex flex-col min-w-0`}>
          <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-stone-950">
                <span aria-hidden="true" className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                Arrivals {dayPhrase}
              </h2>
              <p className="mt-0.5 text-[13px] text-stone-600 tabular-nums">
                {arrivalsOnDate.length} {arrivalsOnDate.length === 1 ? 'zair' : 'zaereen'}
                {arrivalsWithoutRoom > 0 && <span className="text-amber-700"> · {arrivalsWithoutRoom} need a room</span>}
              </p>
            </div>
            <button type="button" onClick={() => onOpenReceptionSlip?.('arrival_slip')} className={`${btnSm.secondary} ${touch} shrink-0`}>
              <Printer className="w-4 h-4 text-stone-500" />
              Arrival slip
            </button>
          </div>

          {arrivalsOnDate.length > 0 ? (
            <ul className="border-t border-stone-200 divide-y divide-stone-200 max-h-[26rem] overflow-y-auto">
              {arrivalsOnDate.map((res) => (
                <li key={res.id} className="px-4 sm:px-5 py-2.5 hover:bg-stone-50">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-stone-950">{res.applicantName}</span>
                    {res.roomNumber ? (
                      <span className="shrink-0 text-[13px] font-bold text-stone-950 tabular-nums">
                        {res.building} {res.roomNumber}
                      </span>
                    ) : (
                      <span className={`${chip('wait')} shrink-0`}>Needs a room</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[13px] text-stone-500">
                    <span className="flex min-w-0 items-baseline">
                      <span className="w-[4.5rem] shrink-0 font-medium text-stone-800 tabular-nums">{formatTime(res.arrivalTime || SUBVENUE_ARRIVAL_TIME)}</span>
                      <span className="truncate tabular-nums" title={`Tour ${res.tourRefNo || res.tourId || '—'}${res.officeName ? ` · ${res.officeName}` : ''}`}>
                        {res.family} · Tour {shortTour(res.tourRefNo || res.tourId) || '—'}
                        {res.officeName ? ` · ${res.officeName}` : ''}
                      </span>
                    </span>
                    {res.category && <span className="shrink-0 text-xs">{res.category}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="border-t border-stone-200 px-5 py-8 text-center">
              <p className="text-sm font-medium text-stone-800">No arrivals {dayPhrase}</p>
              <p className="mt-1 text-[13px] text-stone-600">Zaereen whose arrival date is {isToday ? 'today' : 'this day'} are listed here.</p>
            </div>
          )}
        </section>

        {/* Departures */}
        <section aria-label={`Departures ${dayPhrase}`} className={`${card} flex flex-col min-w-0`}>
          <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-stone-950">
                <span aria-hidden="true" className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                Departures {dayPhrase}
              </h2>
              <p className="mt-0.5 text-[13px] text-stone-600 tabular-nums">
                {departuresOnDate.length} {departuresOnDate.length === 1 ? 'zair' : 'zaereen'}
              </p>
            </div>
            <button type="button" onClick={() => onOpenReceptionSlip?.('departure_list')} className={`${btnSm.secondary} ${touch} shrink-0`}>
              <Printer className="w-4 h-4 text-stone-500" />
              Departure list
            </button>
          </div>

          {departuresOnDate.length > 0 ? (
            <ul className="border-t border-stone-200 divide-y divide-stone-200 max-h-[26rem] overflow-y-auto">
              {departuresOnDate.map((res) => (
                <li key={res.id} className="px-4 sm:px-5 py-2.5 hover:bg-stone-50">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-stone-950">{res.applicantName}</span>
                    <span className="shrink-0 text-[13px] font-bold text-stone-950 tabular-nums">
                      {res.roomNumber ? `${res.building} ${res.roomNumber}` : '—'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3 text-[13px] text-stone-500">
                    <span className="flex min-w-0 max-w-full items-baseline">
                      <span className="w-[4.5rem] shrink-0 font-medium text-stone-800 tabular-nums">{formatTime(res.departureTime || SUBVENUE_DEPARTURE_TIME)}</span>
                      <span className="truncate tabular-nums" title={`Tour ${res.tourRefNo || res.tourId || '—'}${res.officeName ? ` · ${res.officeName}` : ''}`}>
                        {res.family} · Tour {shortTour(res.tourRefNo || res.tourId) || '—'}
                        {res.officeName ? ` · ${res.officeName}` : ''}
                      </span>
                    </span>
                    <span className={`${chip('wait')} shrink-0`}>Ready for check-out</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="border-t border-stone-200 px-5 py-8 text-center">
              <p className="text-sm font-medium text-stone-800">No departures {dayPhrase}</p>
              <p className="mt-1 text-[13px] text-stone-600">Zaereen whose departure date is {isToday ? 'today' : 'this day'} are listed here.</p>
            </div>
          )}
        </section>
      </div>

      {/* Room details: who is in the room, switch or delete, unblock, or allot it */}
      {openRoom &&
        (() => {
          const state = getMatrixState(openRoom);
          const isFull = state.status === 'full';
          return (
            <div
              ref={roomScrimRef}
              className={modalScrim}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setInspectedRoom(null);
              }}
            >
              <div role="dialog" aria-modal="true" aria-labelledby="overview-room-title" className={`${modalCard} max-w-2xl`}>
                <div className={modalHeader}>
                  <div className="min-w-0">
                    <h3 id="overview-room-title" className={`${modalTitle} tabular-nums`}>
                      {openRoom.building} · Room {openRoom.roomNumber}
                    </h3>
                    <p className="mt-1 text-[13px] text-stone-600 tabular-nums">
                      {openRoom.floorLabel || `Floor ${openRoom.floor}`} · {getRoomBedCount(openRoom)} beds · sleeps {openRoom.capacity}
                      {openRoom.buffer ? ` (+${openRoom.buffer} buffer)` : ''} · Toilet: {openRoom.toiletType || 'Standard'} · {openRoom.bedType || 'Single Beds'} · {openRoom.category}
                    </p>
                  </div>
                  <button type="button" onClick={() => setInspectedRoom(null)} className={modalClose} aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <span className="text-[13px] text-stone-600">Status {dayPhrase}</span>
                    {state.status === 'blocked' ? (
                      <span className={chip('neutral')}>
                        <Lock className="w-3 h-3" />
                        Blocked
                      </span>
                    ) : state.occupants.length > 0 ? (
                      <>
                        <span className={chip(isFull ? 'bad' : 'wait')}>
                          {isFull
                            ? 'Full, no space'
                            : `Occupied, ${state.remainingSlots} ${state.remainingSlots === 1 ? 'place' : 'places'} free`}
                        </span>
                        <span className="text-[13px] text-stone-600 tabular-nums">
                          {state.currentOccupancy} of {state.maxCapacity} places taken
                        </span>
                        {state.isVip && (
                          <span className={chip('gold')}>
                            <Star className="w-3 h-3 fill-gold-400 text-gold-500" />
                            VIP tour {state.vipTourIds.join(', ')}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className={chip('ok')}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Free
                      </span>
                    )}
                  </div>

                  {state.status === 'blocked' ? (
                    <div className={`${panel} px-4 py-3`}>
                      <p className="text-sm text-stone-800">{openRoom.blockedReason || 'Maintenance buffer'}</p>
                      {onToggleBlockRoom && (
                        <button type="button" onClick={() => onToggleBlockRoom(openRoom.id)} className={`${btnSm.secondary} ${touch} mt-3`}>
                          <Unlock className="w-4 h-4 text-stone-500" />
                          Unblock room
                        </button>
                      )}
                    </div>
                  ) : state.occupants.length > 0 ? (
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-[13px] font-medium text-stone-700 tabular-nums">In this room ({state.occupants.length})</h4>
                        {onOpenSwitchRoomModal && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenSwitchRoomModal({
                                reservations: state.occupants,
                                initialScope: 'group',
                              })
                            }
                            className={`${btnSm.secondary} ${touch}`}
                          >
                            <ArrowRightLeft className="w-4 h-4 text-stone-500" />
                            Switch or swap room
                          </button>
                        )}
                      </div>
                      <RoomDepartures occupants={state.occupants} selectedDate={selectedDate} isToday={isToday} />
                      <ul className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
                        {sortByDeparture(state.occupants).map((booking: Reservation) => (
                          <li key={booking.id} className="py-2.5 flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-stone-950">
                                {booking.applicantName}
                                <span className="font-normal text-stone-500">
                                  {' '}
                                  · {booking.gender}, {booking.age}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[13px] text-stone-600 tabular-nums">
                                Family {booking.family} · ITS {booking.itsId} · Tour {booking.tourRefNo || booking.tourId || '—'}
                                {booking.officeName ? ` · ${booking.officeName}` : ''}
                                {booking.category ? ` · ${booking.category}` : ''}
                              </div>
                              <dl className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[13px] leading-snug">
                                <div className="min-w-0">
                                  <dt className="text-xs text-stone-500">Arrival</dt>
                                  <dd className="text-stone-800 tabular-nums">
                                    {formatStay(booking.arrivalDate, booking.arrivalTime || SUBVENUE_ARRIVAL_TIME)}
                                    <TravelDetails legs={booking.arrivalTravel} date={booking.arrivalDate} direction="arrival" flush />
                                  </dd>
                                </div>
                                <div className="min-w-0">
                                  <dt className="flex items-center gap-1.5 text-xs text-stone-500">
                                    Departure
                                    {(booking.departureDate || '').slice(0, 10) === selectedDate && (
                                      <span className={chip('wait')}>Leaving {isToday ? 'today' : 'this day'}</span>
                                    )}
                                  </dt>
                                  <dd className="font-semibold text-stone-950 tabular-nums">
                                    {formatStay(booking.departureDate, booking.departureTime || SUBVENUE_DEPARTURE_TIME)}
                                    <span className="font-normal">
                                      <TravelDetails legs={booking.departureTravel} date={booking.departureDate} direction="departure" flush />
                                    </span>
                                  </dd>
                                </div>
                              </dl>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {onOpenSwitchRoomModal && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenSwitchRoomModal({
                                      reservations: [booking],
                                      initialScope: 'single',
                                    })
                                  }
                                  className={`${btnSm.secondary} ${touch}`}
                                  title="Switch room for this zair"
                                >
                                  <ArrowRightLeft className="w-4 h-4 text-stone-500" />
                                  Switch
                                </button>
                              )}
                              {onDeleteReservation && (
                                <button
                                  type="button"
                                  onClick={() => setRecordToDelete(booking)}
                                  className={`${btnSm.danger} ${touch} px-2`}
                                  title="Delete this zair record"
                                  aria-label={`Delete the zair record for ${booking.applicantName}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                      {!isFull && state.remainingSlots > 0 && (
                        <p className="mt-2 text-[13px] text-emerald-800">
                          {state.remainingSlots} {state.remainingSlots === 1 ? 'place is' : 'places are'} still open in this room for another zair.
                        </p>
                      )}
                    </div>
                  ) : readOnly ? (
                    <p className={`${panel} px-4 py-4 text-[13px] text-stone-700`}>No zair is in this room on this date.</p>
                  ) : (
                    <div className={`${panel} px-4 py-4`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold text-stone-950">Allot this room</h4>
                        <div role="group" aria-label="Allot to" className={segTrack}>
                          <button
                            type="button"
                            aria-pressed={inspectAllotMode === 'family'}
                            onClick={() => setInspectAllotMode('family')}
                            className={segBtn(inspectAllotMode === 'family')}
                          >
                            <Users className="w-4 h-4" />
                            Whole family
                          </button>
                          <button
                            type="button"
                            aria-pressed={inspectAllotMode === 'individual'}
                            onClick={() => setInspectAllotMode('individual')}
                            className={segBtn(inspectAllotMode === 'individual')}
                          >
                            Single zair
                          </button>
                        </div>
                      </div>

                      {inspectAllotMode === 'family' ? (
                        <div className="mt-3">
                          <p className="text-[13px] text-stone-600">
                            Allot {openRoom.building} room {openRoom.roomNumber} (sleeps {openRoom.capacity}
                            {openRoom.buffer ? `, +${openRoom.buffer} buffer` : ''}) to an entire family of a Tour ID in one go.
                          </p>

                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label htmlFor="overview-room-tour" className={fieldLabel}>
                                Tour ID
                              </label>
                              <select
                                id="overview-room-tour"
                                value={inspectTourId}
                                onChange={(e) => {
                                  setInspectTourId(e.target.value);
                                  setInspectFamily('');
                                }}
                                className={`${field} tabular-nums`}
                              >
                                <option value="">Choose a Tour ID</option>
                                {distinctTourIds.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label htmlFor="overview-room-family" className={fieldLabel}>
                                Family
                              </label>
                              <select
                                id="overview-room-family"
                                value={inspectFamily}
                                onChange={(e) => setInspectFamily(e.target.value)}
                                disabled={!inspectTourId}
                                className={`${field} tabular-nums`}
                              >
                                <option value="">Choose a family</option>
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
                                      Family {f} ({count} zaereen)
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          </div>

                          {inspectFamily && (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                              <span className="text-[13px] text-stone-700 tabular-nums">
                                Family {inspectFamily} has{' '}
                                {reservations.filter((r) => r.tourRefNo === inspectTourId && (r.family || '').trim() === inspectFamily.trim()).length}{' '}
                                members
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (onBatchAllotFamily && inspectTourId && inspectFamily) {
                                    onBatchAllotFamily(inspectTourId, inspectFamily, openRoom.building, openRoom.roomNumber);
                                    setInspectFamily('');
                                    setInspectedRoom(null);
                                  }
                                }}
                                className={`${btn.primary} tabular-nums`}
                              >
                                Allot room {openRoom.roomNumber} to the family
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3">
                          {unallottedZaereen.length > 0 ? (
                            <>
                              <label htmlFor="overview-room-zair" className={fieldLabel}>
                                Zair without a room
                              </label>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <select
                                  id="overview-room-zair"
                                  value={allotTargetZaerId}
                                  onChange={(e) => setAllotTargetZaerId(e.target.value)}
                                  className={`${field} sm:flex-1 sm:w-auto min-w-0`}
                                >
                                  <option value="">Choose a zair</option>
                                  {unallottedZaereen.map((z) => (
                                    <option key={z.id} value={z.id}>
                                      {z.applicantName} · {z.family} · {z.tourRefNo} · {formatDay(z.arrivalDate)} → {formatDay(z.departureDate)}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={!allotTargetZaerId}
                                  onClick={() => {
                                    if (allotTargetZaerId) {
                                      onAllotRoom(allotTargetZaerId, openRoom.building, openRoom.roomNumber);
                                      setAllotTargetZaerId('');
                                    }
                                  }}
                                  className={btn.primary}
                                >
                                  Allot room
                                </button>
                              </div>
                            </>
                          ) : (
                            <p className="text-[13px] text-stone-600">Every zair already has a room.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[13px] leading-relaxed text-stone-500">
                    An allotted room is reserved for the whole stay, from arrival to departure. A room cannot be double-booked for overlapping dates.
                  </p>
                </div>

                <div className={modalFooter}>
                  {!readOnly && <button type="button" onClick={() => onNavigateTab('reservations')} className={`${btn.ghost} mr-auto -ml-2`}>
                    View all zaereen
                    <ChevronRight className="w-4 h-4" />
                  </button>}
                  <button type="button" onClick={() => setInspectedRoom(null)} className={btn.secondary}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Delete zair confirmation */}
      {recordToDelete && (
        <div
          className={modalScrim}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRecordToDelete(null);
          }}
        >
          <div role="alertdialog" aria-modal="true" aria-labelledby="overview-delete-title" className={`${modalCard} max-w-md`}>
            <div className={modalHeader}>
              <div className="min-w-0">
                <h3 id="overview-delete-title" className={modalTitle}>
                  Delete zair record
                </h3>
                <p className="mt-1 text-[13px] text-stone-600">This permanently deletes the record below.</p>
              </div>
              <button type="button" onClick={() => setRecordToDelete(null)} className={modalClose} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 sm:px-6 py-5 space-y-3 overflow-y-auto">
              <div className={`${panel} px-4 py-3`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-stone-950">{recordToDelete.applicantName}</div>
                    <div className="mt-0.5 text-[13px] text-stone-600 tabular-nums">ITS {recordToDelete.itsId}</div>
                  </div>
                  <span className="shrink-0 text-[13px] font-medium text-stone-700 tabular-nums">Family {recordToDelete.family}</span>
                </div>
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
                  <dt className="text-stone-500">Tour ID</dt>
                  <dd className="text-stone-800 tabular-nums break-all">{recordToDelete.tourRefNo}</dd>
                  <dt className="text-stone-500">Category</dt>
                  <dd className="text-stone-800">{recordToDelete.category || 'Mumineen'}</dd>
                  <dt className="text-stone-500">Stay</dt>
                  <dd className="text-stone-800 tabular-nums">
                    {formatDay(recordToDelete.arrivalDate)} → {formatDay(recordToDelete.departureDate)}
                  </dd>
                </dl>
              </div>
              {recordToDelete.roomNumber && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {recordToDelete.building} room {recordToDelete.roomNumber} becomes vacant as soon as this record is deleted.
                  </span>
                </p>
              )}
            </div>

            <div className={modalFooter}>
              <button type="button" onClick={() => setRecordToDelete(null)} className={btn.secondary}>
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
                className={btnDanger}
              >
                <Trash2 className="w-4 h-4" />
                Delete record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Special Guest & Lodging Requirements Modal (Scope: Guest / Family / Tour ID) */}
      <SpecialGuestModal
        isOpen={!!specialGuestModalTarget}
        onClose={() => setSpecialGuestModalTarget(null)}
        targetReservation={specialGuestModalTarget}
        allReservations={reservations}
        onUpdateReservation={(updated) => {
          if (onUpdateReservation) {
            onUpdateReservation(updated);
          }
        }}
        onBatchUpdateReservations={onBatchUpdateReservations}
        onShowToast={(msg) => setToastFeedback(msg)}
        initialScope={specialGuestInitialScope}
      />

      {/* Toast */}
      {toastFeedback && (
        <div
          role="status"
          className="fixed bottom-20 lg:bottom-6 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-md z-[70] flex items-start gap-2.5 rounded-xl bg-stone-900 px-4 py-3 text-sm leading-snug text-white shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-300 shrink-0" />
          <span className="min-w-0 flex-1">{toastFeedback}</span>
          <button
            type="button"
            onClick={() => setToastFeedback(null)}
            className="-my-1 -mr-1.5 w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-stone-300 hover:text-white hover:bg-white/10 cursor-pointer"
            aria-label="Dismiss"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
