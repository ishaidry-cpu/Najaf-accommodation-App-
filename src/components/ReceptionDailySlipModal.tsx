import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Printer, 
  Download, 
  Calendar, 
  Building2, 
  X, 
  Users, 
  CheckCircle2, 
  ArrowRight, 
  Clock, 
  Sparkles, 
  Luggage, 
  LogIn, 
  LogOut, 
  RefreshCw, 
  BedDouble, 
  DoorClosed, 
  CheckSquare,
  Square,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Info,
  HardHat,
  ClipboardList,
  FileCheck,
  Search
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Reservation, Room } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import { normalizeDate } from '../services/excelService';
import { saveOrDownloadPdf, PdfDownloadResult } from '../services/pdfExport';
import { parseTimeToMinutes } from '../utils/turnoverTiming';

// Safe invocation of jspdf-autotable to prevent runtime errors across bundler environments
function safeAutoTable(doc: jsPDF, options: any) {
  try {
    if (typeof (doc as any).autoTable === 'function') {
      (doc as any).autoTable(options);
    } else if (typeof autoTable === 'function') {
      autoTable(doc, options);
    } else if (typeof (autoTable as any)?.default === 'function') {
      (autoTable as any).default(doc, options);
    }
  } catch (err) {
    console.error('safeAutoTable error:', err);
  }
}

// Robust PDF download helper that falls back to blob download if doc.save is restricted
function downloadPdfDoc(doc: jsPDF, fileName: string) {
  try {
    doc.save(fileName);
  } catch (err) {
    console.warn('doc.save failed, using blob fallback', err);
    try {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (e) {
      console.error('Blob download failed:', e);
    }
  }
}

/**
 * Extracts and formats flight / arrival / departure time cleanly (e.g. "11:00 AM" or "02:30 PM").
 * Robustly parses 12-hour (AM/PM) and 24-hour timestamps.
 */
export function extractCleanTime(
  explicitTime?: string,
  rawStr?: string,
  dateTimeStr?: string,
  defaultFallback: string = ''
): string {
  const candidates = [explicitTime, rawStr, dateTimeStr].filter(Boolean) as string[];
  for (const c of candidates) {
    const cleaned = String(c).trim().replace(/^['"’‘\s]+|['"’‘\s]+$/g, '');
    const match12 = cleaned.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i);
    if (match12) return match12[1].toUpperCase();

    const match24 = cleaned.match(/(?:^|\s|T)(\d{1,2}:\d{2})(?::\d{2})?(?:\s|$)/);
    if (match24) {
      let h = parseInt(match24[1].split(':')[0], 10);
      const m = match24[1].split(':')[1];
      const ampm = h >= 12 ? 'PM' : 'AM';
      if (h > 12) h -= 12;
      if (h === 0) h = 12;
      return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
    }
  }
  return defaultFallback;
}

/**
 * Backwards-compatible helper for extracting arrival/departure time.
 * If 3rd parameter is a fallback (e.g. '11:00 AM' or '12:00 PM'), it is only used if candidates have no time.
 */
export function formatFlightOrStayTime(
  rawStr?: string,
  dateTimeStr?: string,
  timeFieldOrFallback?: string,
  defaultFallback: string = ''
): string {
  // Check if rawStr or dateTimeStr contains time
  const primaryTime = extractCleanTime(undefined, rawStr, dateTimeStr, '');
  if (primaryTime) return primaryTime;

  // If timeFieldOrFallback looks like a valid time, return it if nothing else matched
  if (timeFieldOrFallback) {
    const fromField = extractCleanTime(timeFieldOrFallback, undefined, undefined, '');
    if (fromField) return fromField;
  }

  return defaultFallback || timeFieldOrFallback || '';
}

export function getReservationArrivalTime(r?: Partial<Reservation>, defaultFallback: string = '11:00 AM'): string {
  if (!r) return defaultFallback;
  return extractCleanTime(r.arrivalTime, r.rawArrivalStr, r.arrivalDateTime, defaultFallback);
}

export function getReservationDepartureTime(r?: Partial<Reservation>, defaultFallback: string = '12:00 PM'): string {
  if (!r) return defaultFallback;
  return extractCleanTime(r.departureTime, r.rawDepartureStr, r.departureDateTime, defaultFallback);
}

/**
 * Converts a time string (e.g. "11:00 AM", "02:30 PM", "14:30") to minutes from midnight (0-1439)
 * for chronological sorting of operational schedules.
 */
export function timeStringToMinutes(timeStr?: string, defaultMinutes: number = 720): number {
  if (!timeStr) return defaultMinutes;
  const cleaned = timeStr.trim();
  const m12 = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m12) {
    let hours = parseInt(m12[1], 10);
    const mins = parseInt(m12[2], 10);
    const meridiem = m12[3].toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    return hours * 60 + mins;
  }
  const m24 = cleaned.match(/(\d{1,2}):(\d{2})/);
  if (m24) {
    const hours = parseInt(m24[1], 10);
    const mins = parseInt(m24[2], 10);
    return hours * 60 + mins;
  }
  return defaultMinutes;
}

/**
 * Robust date formatting that never throws RangeError on empty/invalid dates
 */
export function formatSafeDateLabel(dateStr?: string, options?: Intl.DateTimeFormatOptions): string {
  if (!dateStr || typeof dateStr !== 'string') return '—';
  try {
    const parts = dateStr.trim().split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      const dt = new Date(y, m, d);
      if (!isNaN(dt.getTime())) {
        return dt.toLocaleDateString(undefined, options);
      }
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(undefined, options);
    }
  } catch (e) {}
  return dateStr;
}

/**
 * Normalizes hotel building string to canonical 'Saifee' or 'Burhani'
 */
export function normalizeHotelBuilding(b?: string): 'Saifee' | 'Burhani' | string {
  if (!b) return '';
  const s = b.trim().toLowerCase();
  if (s.includes('saifee')) return 'Saifee';
  if (s.includes('burhani')) return 'Burhani';
  return b.trim();
}

interface ReceptionDailySlipModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: Reservation[];
  rooms: Room[];
  onUpdateReservation?: (updated: Reservation) => void;
}

export const ReceptionDailySlipModal: React.FC<ReceptionDailySlipModalProps> = ({
  isOpen,
  onClose,
  reservations = [],
  rooms = [],
  onUpdateReservation,
}) => {
  const safeReservations = useMemo(() => (Array.isArray(reservations) ? reservations : []), [reservations]);
  const safeRooms = useMemo(() => (Array.isArray(rooms) ? rooms : []), [rooms]);

  // Today's date in YYYY-MM-DD
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Compute all unique dates in the system that have arrivals or departures
  const activeDatesSummary = useMemo(() => {
    const datesMap = new Map<string, { arrivals: number; departures: number; total: number }>();

    safeReservations.forEach((r) => {
      const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      const dep = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);

      if (arr) {
        const existing = datesMap.get(arr) || { arrivals: 0, departures: 0, total: 0 };
        existing.arrivals += 1;
        existing.total += 1;
        datesMap.set(arr, existing);
      }
      if (dep) {
        const existing = datesMap.get(dep) || { arrivals: 0, departures: 0, total: 0 };
        existing.departures += 1;
        existing.total += 1;
        datesMap.set(dep, existing);
      }
    });

    const sortedDates = Array.from(datesMap.keys()).sort();
    return {
      sortedDates,
      datesMap,
    };
  }, [safeReservations]);

  // Determine smart default date:
  // 1. If today has activity, use today.
  // 2. Otherwise pick the upcoming date with activity.
  // 3. Otherwise pick the date with the highest activity across all system records.
  const initialDate = useMemo(() => {
    const { sortedDates, datesMap } = activeDatesSummary;
    if (datesMap.has(todayStr) && (datesMap.get(todayStr)?.total || 0) > 0) return todayStr;
    const future = sortedDates.filter((d) => d >= todayStr && (datesMap.get(d)?.total || 0) > 0);
    if (future.length > 0) return future[0];
    if (sortedDates.length > 0) {
      const sortedByActivity = [...sortedDates].sort((a, b) => {
        const actA = datesMap.get(a)?.total || 0;
        const actB = datesMap.get(b)?.total || 0;
        return actB - actA;
      });
      return sortedByActivity[0];
    }
    return todayStr;
  }, [activeDatesSummary, todayStr]);

  const [selectedDate, setSelectedDate] = useState<string>(initialDate);

  // Active dates for quick jump bar, guaranteeing selectedDate is included even if chosen manually
  const displayDates = useMemo(() => {
    const dates = [...activeDatesSummary.sortedDates];
    if (selectedDate && !dates.includes(selectedDate)) {
      dates.push(selectedDate);
      dates.sort();
    }
    return dates;
  }, [activeDatesSummary.sortedDates, selectedDate]);
  const [activeHotelFilter, setActiveHotelFilter] = useState<'ALL' | 'Saifee' | 'Burhani'>('ALL');
  const [activeTab, setActiveTab] = useState<'turnover' | 'roster' | 'worker_summary' | 'portal_upload'>('turnover');
  const [showOnlyActiveRooms, setShowOnlyActiveRooms] = useState<boolean>(true);
  const [rosterGroupByTour, setRosterGroupByTour] = useState<boolean>(true);
  const [workerViewMode, setWorkerViewMode] = useState<'grouped' | 'room_numeric'>('grouped');

  // Persistent worker checklists and portal upload state across reloads/reopens
  const [workerCompletedTasks, setWorkerCompletedTasks] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('faiz_worker_completed_tasks');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [portalUploadedMap, setPortalUploadedMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('faiz_portal_uploaded_map');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [workerSubtasks, setWorkerSubtasks] = useState<Record<string, { linen?: boolean; toilet?: boolean; cards?: boolean }>>(() => {
    try {
      const saved = localStorage.getItem('faiz_worker_subtasks');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('faiz_worker_completed_tasks', JSON.stringify(workerCompletedTasks));
    } catch {}
  }, [workerCompletedTasks]);

  useEffect(() => {
    try {
      localStorage.setItem('faiz_portal_uploaded_map', JSON.stringify(portalUploadedMap));
    } catch {}
  }, [portalUploadedMap]);

  useEffect(() => {
    try {
      localStorage.setItem('faiz_worker_subtasks', JSON.stringify(workerSubtasks));
    } catch {}
  }, [workerSubtasks]);

  const [portalFilterScope, setPortalFilterScope] = useState<'date' | 'all'>('date');
  const [portalSearchQuery, setPortalSearchQuery] = useState<string>('');
  const [pdfDownloadStatus, setPdfDownloadStatus] = useState<PdfDownloadResult | null>(null);
  const [pdfPreviewBlobUrl, setPdfPreviewBlobUrl] = useState<string | null>(null);

  // Set smart default date only when modal is initially opened
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      if (initialDate) {
        setSelectedDate(initialDate);
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialDate]);

  // Filter arrivals on selected date using robust normalization
  const arrivalsOnDate = safeReservations.filter((r) => {
    const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
    return arr === selectedDate;
  });

  // Filter departures on selected date using robust normalization
  const departuresOnDate = safeReservations.filter((r) => {
    const dep = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
    return dep === selectedDate;
  });

  // In-house continuing stayers
  const inHouseOnDate = safeReservations.filter((r) => {
    const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
    const dep = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
    return arr && dep && arr < selectedDate && dep > selectedDate;
  });

  // Unallotted arrivals & departures today (need immediate room assignment)
  const unallottedArrivals = arrivalsOnDate.filter(
    (r) => !r.building || (normalizeHotelBuilding(r.building) !== 'Saifee' && normalizeHotelBuilding(r.building) !== 'Burhani') || !r.roomNumber || r.roomNumber.trim() === ''
  );
  const unallottedDepartures = departuresOnDate.filter(
    (r) => !r.building || (normalizeHotelBuilding(r.building) !== 'Saifee' && normalizeHotelBuilding(r.building) !== 'Burhani') || !r.roomNumber || r.roomNumber.trim() === ''
  );

  // Bifurcated by Hotel: Saifee & Burhani
  const saifeeArrivals = arrivalsOnDate.filter((r) => normalizeHotelBuilding(r.building) === 'Saifee');
  const saifeeDepartures = departuresOnDate.filter((r) => normalizeHotelBuilding(r.building) === 'Saifee');

  const burhaniArrivals = arrivalsOnDate.filter((r) => normalizeHotelBuilding(r.building) === 'Burhani');
  const burhaniDepartures = departuresOnDate.filter((r) => normalizeHotelBuilding(r.building) === 'Burhani');

  // Room Preparation Schedule: Room-by-Room Departure & Arrival Turnover matrix
  const roomPrepSchedule = safeRooms.map((room) => {
    const rBldgNorm = normalizeHotelBuilding(room.building);
    const rNum = (room.roomNumber || '').trim().toLowerCase();

    // Departures from this room on selectedDate
    const deps = safeReservations.filter((r) => {
      const bMatch = normalizeHotelBuilding(r.building) === rBldgNorm;
      const nMatch = (r.roomNumber || '').trim().toLowerCase() === rNum;
      const depDate = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
      return bMatch && nMatch && depDate === selectedDate;
    });

    // Arrivals into this room on selectedDate
    const arrs = safeReservations.filter((r) => {
      const bMatch = normalizeHotelBuilding(r.building) === rBldgNorm;
      const nMatch = (r.roomNumber || '').trim().toLowerCase() === rNum;
      const arrDate = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      return bMatch && nMatch && arrDate === selectedDate;
    });

    // In-house stayers (continuing over this date)
    const inHouse = safeReservations.filter((r) => {
      const bMatch = normalizeHotelBuilding(r.building) === rBldgNorm;
      const nMatch = (r.roomNumber || '').trim().toLowerCase() === rNum;
      const aDate = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      const dDate = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
      return bMatch && nMatch && aDate && dDate && aDate < selectedDate && dDate > selectedDate;
    });

    let actionType: 'turnover' | 'new_arrival' | 'departure_clean' | 'in_house' | 'vacant' = 'vacant';
    let actionLabel = 'Vacant Ready';
    let actionBadge = 'bg-stone-100 text-stone-700 border-stone-200';

    if (deps.length > 0 && arrs.length > 0) {
      actionType = 'turnover';
      const maxDepM = Math.max(...deps.map(d => parseTimeToMinutes(getReservationDepartureTime(d, '01:00 AM'), 60)));
      const minArrM = Math.min(...arrs.map(a => parseTimeToMinutes(getReservationArrivalTime(a, '11:00 AM'), 660)));
      if (maxDepM > minArrM) {
        const diffHours = Math.round(((maxDepM - minArrM) / 60) * 10) / 10;
        if (diffHours > 15) {
          actionLabel = `⛔ CRITICAL OVERLAP (Dep > Arr by ${diffHours}h > 15h)`;
          actionBadge = 'bg-rose-100 text-rose-950 border-rose-400 font-extrabold ring-1 ring-rose-400';
        } else {
          actionLabel = `⚠️ TIMING WARNING (Dep > Arr by ${diffHours}h)`;
          actionBadge = 'bg-amber-100 text-amber-950 border-amber-400 font-extrabold ring-1 ring-amber-400';
        }
      } else {
        actionLabel = 'PRIORITY TURNOVER (Dep ➔ Arr)';
        actionBadge = 'bg-purple-100 text-purple-900 border-purple-300 font-extrabold';
      }
    } else if (arrs.length > 0) {
      actionType = 'new_arrival';
      actionLabel = 'NEW ARRIVAL PREPARATION';
      actionBadge = 'bg-emerald-100 text-emerald-900 border-emerald-300 font-extrabold';
    } else if (deps.length > 0) {
      actionType = 'departure_clean';
      actionLabel = 'CHECKOUT CLEANING';
      actionBadge = 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold';
    } else if (inHouse.length > 0) {
      actionType = 'in_house';
      actionLabel = 'CONTINUING STAY';
      actionBadge = 'bg-blue-100 text-blue-900 border-blue-200';
    }

    const hasActivity = deps.length > 0 || arrs.length > 0;

    return {
      room,
      deps,
      arrs,
      inHouse,
      actionType,
      actionLabel,
      actionBadge,
      hasActivity,
    };
  });

  // Filtered room prep by hotel and active status
  const filteredRoomPrep = roomPrepSchedule.filter((item) => {
    const itemBldg = normalizeHotelBuilding(item.room?.building);
    if (activeHotelFilter !== 'ALL' && itemBldg !== activeHotelFilter) {
      return false;
    }
    if (showOnlyActiveRooms && !item.hasActivity) {
      return false;
    }
    return true;
  });

  const activeTurnoversCount = roomPrepSchedule.filter((r) => r.actionType === 'turnover').length;
  const newArrivalsPrepCount = roomPrepSchedule.filter((r) => r.actionType === 'new_arrival').length;
  const checkoutCleansCount = roomPrepSchedule.filter((r) => r.actionType === 'departure_clean').length;

  // Helper to compute pax in specific room along with family number for roster views
  const getRoomPaxInfo = (res: Reservation) => {
    if (!res.roomNumber) return { famPaxInRoom: 1, totalRoomPax: 1 };
    const bldg = (res.building || '').trim().toLowerCase();
    const room = (res.roomNumber || '').trim().toLowerCase();
    const fam = (res.family || '').trim().toLowerCase();

    const sameRoomList = reservations.filter((other) => {
      if ((other.building || '').trim().toLowerCase() !== bldg) return false;
      if ((other.roomNumber || '').trim().toLowerCase() !== room) return false;
      const arr = normalizeDate(other.arrivalDate || other.arrivalDateTime || other.rawArrivalStr);
      const dep = normalizeDate(other.departureDate || other.departureDateTime || other.rawDepartureStr);
      return (arr && dep && arr <= selectedDate && dep >= selectedDate) || arr === selectedDate || dep === selectedDate;
    });

    const totalRoomPax = sameRoomList.length > 0 ? sameRoomList.length : 1;
    const famPaxInRoom = sameRoomList.filter(x => (x.family || '').trim().toLowerCase() === fam).length || 1;

    return {
      famPaxInRoom,
      totalRoomPax,
    };
  };

  // Helper to sort arrivals chronologically by arrival time (Requirement 2)
  const sortArrivalsByTime = (list: Reservation[]) => {
    return [...list].sort((a, b) => {
      const tA = getReservationArrivalTime(a, '11:00 AM');
      const tB = getReservationArrivalTime(b, '11:00 AM');
      const diff = timeStringToMinutes(tA, 660) - timeStringToMinutes(tB, 660);
      if (diff !== 0) return diff;
      return (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true });
    });
  };

  // Helper to sort departures chronologically by departure time (Requirement 2)
  const sortDeparturesByTime = (list: Reservation[]) => {
    return [...list].sort((a, b) => {
      const tA = getReservationDepartureTime(a, '12:00 PM');
      const tB = getReservationDepartureTime(b, '12:00 PM');
      const diff = timeStringToMinutes(tA, 720) - timeStringToMinutes(tB, 720);
      if (diff !== 0) return diff;
      return (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true });
    });
  };

  // Group reservations by Tour ID and sort each group chronologically by time (Requirement 2)
  const groupAndSortByTour = (list: Reservation[], isArrival: boolean) => {
    const map = new Map<string, Reservation[]>();
    list.forEach((r) => {
      const tour = (r.tourRefNo || (r as any).tourId || 'Unassigned Tour').trim() || 'Unassigned Tour';
      const existing = map.get(tour) || [];
      existing.push(r);
      map.set(tour, existing);
    });

    const groups: {
      tourRefNo: string;
      officeName: string;
      reservations: Reservation[];
      earliestTime: string;
      latestTime: string;
      uniqueFamiliesCount: number;
    }[] = [];

    map.forEach((items, tourRefNo) => {
      const sorted = isArrival ? sortArrivalsByTime(items) : sortDeparturesByTime(items);
      const officeName = items[0]?.officeName || '—';
      const uniqueFamilies = new Set(items.map((x) => (x.family || '').trim()).filter(Boolean)).size;
      const times = sorted.map((x) =>
        isArrival
          ? getReservationArrivalTime(x, '11:00 AM')
          : getReservationDepartureTime(x, '12:00 PM')
      );
      const earliestTime = times[0] || '—';
      const latestTime = times[times.length - 1] || '—';

      groups.push({
        tourRefNo,
        officeName,
        reservations: sorted,
        earliestTime,
        latestTime,
        uniqueFamiliesCount: uniqueFamilies,
      });
    });

    // Sort tour groups by their earliest time window chronologically
    groups.sort((a, b) => {
      return timeStringToMinutes(a.earliestTime) - timeStringToMinutes(b.earliestTime);
    });

    return groups;
  };

  // Pre-computed Tour ID groupings for Tab 2
  const allArrivalsGroupedByTour = useMemo(() => groupAndSortByTour(arrivalsOnDate, true), [arrivalsOnDate]);
  const allDeparturesGroupedByTour = useMemo(() => groupAndSortByTour(departuresOnDate, false), [departuresOnDate]);
  const saifeeArrivalsGroupedByTour = useMemo(() => groupAndSortByTour(saifeeArrivals, true), [saifeeArrivals]);
  const saifeeDeparturesGroupedByTour = useMemo(() => groupAndSortByTour(saifeeDepartures, false), [saifeeDepartures]);
  const burhaniArrivalsGroupedByTour = useMemo(() => groupAndSortByTour(burhaniArrivals, true), [burhaniArrivals]);
  const burhaniDeparturesGroupedByTour = useMemo(() => groupAndSortByTour(burhaniDepartures, false), [burhaniDepartures]);
  const unallottedArrivalsGroupedByTour = useMemo(() => groupAndSortByTour(unallottedArrivals, true), [unallottedArrivals]);
  const unallottedDeparturesGroupedByTour = useMemo(() => groupAndSortByTour(unallottedDepartures, false), [unallottedDepartures]);

  // Worker Room Operations Summary (Requirement 3):
  // Base is Room Number, followed by Departure/Arrival Time, grouped by Office Name and Tour ID in timing sequence.
  interface WorkerRoomItem {
    id: string;
    roomNumber: string;
    building: string;
    floor: number | string;
    floorLabel?: string;
    actionType: 'TURNOVER' | 'CHECKOUT' | 'ARRIVAL';
    timeLabel: string;
    timeMinutes: number;
    officeName: string;
    tourRefNo: string;
    familyNumbers: string;
    totalPaxInRoom: number;
    leadGuestName: string;
    leadGuestIts: string;
    actionNotes: string;
  }

  // Reusable builder for Worker Operations Summary (used both for screen and clean PDF generation)
  const buildWorkerSummary = (prepList: typeof roomPrepSchedule, dateKey: string = selectedDate) => {
    const rawItems: WorkerRoomItem[] = [];

    prepList.forEach((item) => {
      const r = item.room;
      const isDep = item.deps.length > 0;
      const isArr = item.arrs.length > 0;

      if (isDep && isArr) {
        // Priority Turnover
        const depTime = getReservationDepartureTime(item.deps[0], '01:00 AM');
        const arrTime = getReservationArrivalTime(item.arrs[0], '11:00 AM');
        const office = item.arrs[0]?.officeName || item.deps[0]?.officeName || 'Main Office';
        const tour = (item.arrs[0]?.tourRefNo || item.arrs[0]?.tourId || item.deps[0]?.tourRefNo || item.deps[0]?.tourId || 'Unassigned Tour').trim();
        const fams = Array.from(new Set([...item.deps, ...item.arrs].map((x) => x.family).filter(Boolean))).join(', ');

        rawItems.push({
          id: `${dateKey}-${r.building}-${r.roomNumber}-turnover`,
          roomNumber: r.roomNumber,
          building: r.building,
          floor: r.floor,
          floorLabel: r.floorLabel,
          actionType: 'TURNOVER',
          timeLabel: `Dep: ${depTime} ➔ Arr: ${arrTime}`,
          timeMinutes: timeStringToMinutes(depTime, 720),
          officeName: office,
          tourRefNo: tour,
          familyNumbers: fams || '—',
          totalPaxInRoom: item.arrs.length || item.deps.length,
          leadGuestName: `${item.deps[0]?.applicantName || 'Vacating'} ➔ ${item.arrs[0]?.applicantName || 'Incoming'}`,
          leadGuestIts: `${item.deps[0]?.itsId || '—'} / ${item.arrs[0]?.itsId || '—'}`,
          actionNotes: 'PRIORITY TURNOVER: Deep clean room & prepare beds immediately after checkout',
        });
      } else if (isDep) {
        // Checkout Cleaning
        const depTime = getReservationDepartureTime(item.deps[0], '01:00 AM');
        const arrTime = getReservationArrivalTime(item.deps[0], '11:00 AM');
        const office = item.deps[0]?.officeName || 'Main Office';
        const tour = (item.deps[0]?.tourRefNo || item.deps[0]?.tourId || 'Unassigned Tour').trim();
        const fams = Array.from(new Set(item.deps.map((x) => x.family).filter(Boolean))).join(', ');
        const arrDate = item.deps[0]?.arrivalDate || '—';

        rawItems.push({
          id: `${dateKey}-${r.building}-${r.roomNumber}-checkout`,
          roomNumber: r.roomNumber,
          building: r.building,
          floor: r.floor,
          floorLabel: r.floorLabel,
          actionType: 'CHECKOUT',
          timeLabel: `Dep: ${depTime} (Arr was: ${arrDate} ${arrTime})`,
          timeMinutes: timeStringToMinutes(depTime, 720),
          officeName: office,
          tourRefNo: tour,
          familyNumbers: fams || '—',
          totalPaxInRoom: item.deps.length,
          leadGuestName: item.deps[0]?.applicantName || 'Guest vacating',
          leadGuestIts: item.deps[0]?.itsId || '—',
          actionNotes: 'CHECKOUT VACATING: Strip bed linen, sanitize toilet, mop floor',
        });
      } else if (isArr) {
        // New Arrival Prep
        const arrTime = getReservationArrivalTime(item.arrs[0], '11:00 AM');
        const depTime = getReservationDepartureTime(item.arrs[0], '01:00 AM');
        const office = item.arrs[0]?.officeName || 'Main Office';
        const tour = (item.arrs[0]?.tourRefNo || item.arrs[0]?.tourId || 'Unassigned Tour').trim();
        const fams = Array.from(new Set(item.arrs.map((x) => x.family).filter(Boolean))).join(', ');
        const depDate = item.arrs[0]?.departureDate || '—';

        rawItems.push({
          id: `${dateKey}-${r.building}-${r.roomNumber}-arrival`,
          roomNumber: r.roomNumber,
          building: r.building,
          floor: r.floor,
          floorLabel: r.floorLabel,
          actionType: 'ARRIVAL',
          timeLabel: `Arr: ${arrTime} (Dep: ${depDate} ${depTime})`,
          timeMinutes: timeStringToMinutes(arrTime, 660),
          officeName: office,
          tourRefNo: tour,
          familyNumbers: fams || '—',
          totalPaxInRoom: item.arrs.length,
          leadGuestName: item.arrs[0]?.applicantName || 'New Arrival',
          leadGuestIts: item.arrs[0]?.itsId || '—',
          actionNotes: 'NEW ARRIVAL PREPARATION: Fresh linens, wajba & cards ready, room locked',
        });
      }
    });

    // Grouping by Office Name, then by Tour ID, sorted in timing sequence
    const officeMap = new Map<string, Map<string, WorkerRoomItem[]>>();

    rawItems.forEach((item) => {
      const off = (item.officeName || 'General Administration').trim();
      if (!officeMap.has(off)) {
        officeMap.set(off, new Map());
      }
      const tourMap = officeMap.get(off)!;
      const tour = (item.tourRefNo || 'General Allotments').trim();
      if (!tourMap.has(tour)) {
        tourMap.set(tour, []);
      }
      tourMap.get(tour)!.push(item);
    });

    const result: {
      officeName: string;
      tours: {
        tourRefNo: string;
        items: WorkerRoomItem[];
        totalRooms: number;
        totalPax: number;
      }[];
    }[] = [];

    officeMap.forEach((tourMap, officeName) => {
      const toursList: {
        tourRefNo: string;
        items: WorkerRoomItem[];
        totalRooms: number;
        totalPax: number;
      }[] = [];

      tourMap.forEach((tourItems, tourRefNo) => {
        // Sort items strictly by timing sequence
        tourItems.sort((a, b) => {
          if (a.timeMinutes !== b.timeMinutes) {
            return a.timeMinutes - b.timeMinutes;
          }
          return (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true });
        });

        const totalPax = tourItems.reduce((acc, curr) => acc + curr.totalPaxInRoom, 0);

        toursList.push({
          tourRefNo,
          items: tourItems,
          totalRooms: tourItems.length,
          totalPax,
        });
      });

      // Sort tours by their earliest timing
      toursList.sort((a, b) => {
        const minA = a.items[0]?.timeMinutes ?? 0;
        const minB = b.items[0]?.timeMinutes ?? 0;
        return minA - minB;
      });

      result.push({
        officeName,
        tours: toursList,
      });
    });

    result.sort((a, b) => (a.officeName || '').localeCompare(b.officeName || ''));

    // Also prepare room list sorted by Room Number (base organized by Room Number)
    const numericRooms = [...rawItems].sort((a, b) =>
      (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true })
    );

    return {
      groupedByOffice: result,
      numericRooms,
      rawItems,
    };
  };

  const { groupedByOffice: workerRoomSummary, numericRooms: workerNumericRoomList } = useMemo(
    () => buildWorkerSummary(filteredRoomPrep, selectedDate),
    [filteredRoomPrep, selectedDate]
  );

  // Active tours on selected date for Assistant Portal Upload (Requirement 4)
  const dateTourIds = useMemo(() => {
    const tourIds = new Set<string>();
    safeReservations.forEach((r) => {
      const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      const dep = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
      if ((arr && dep && arr <= selectedDate && dep >= selectedDate) || arr === selectedDate || dep === selectedDate) {
        const tour = (r.tourRefNo || (r as any).tourId || 'Unassigned Tour').trim() || 'Unassigned Tour';
        tourIds.add(tour);
      }
    });
    return tourIds;
  }, [safeReservations, selectedDate]);

  // All distinct tours across system
  const allSystemTourIds = useMemo(() => {
    const tourIds = new Set<string>();
    safeReservations.forEach((r) => {
      const tour = (r.tourRefNo || (r as any).tourId || 'Unassigned Tour').trim() || 'Unassigned Tour';
      tourIds.add(tour);
    });
    return tourIds;
  }, [safeReservations]);

  // Grouped Tour data for Assistant Portal Upload (Requirement 4)
  const portalUploadData = useMemo(() => {
    const list = safeReservations.filter((r) => {
      const tour = (r.tourRefNo || (r as any).tourId || 'Unassigned Tour').trim() || 'Unassigned Tour';
      if (portalFilterScope === 'date') {
        if (!dateTourIds.has(tour)) return false;
      }
      if (activeHotelFilter !== 'ALL') {
        const normB = normalizeHotelBuilding(r.building);
        const matchesB = normB === activeHotelFilter;
        const isUnallotted = !r.roomNumber || r.roomNumber.trim() === '';
        if (!matchesB && !isUnallotted) return false;
      }
      if (portalSearchQuery.trim()) {
        const q = portalSearchQuery.toLowerCase();
        const mTour = tour.toLowerCase().includes(q);
        const mFam = (r.family || '').toLowerCase().includes(q);
        const mName = (r.applicantName || '').toLowerCase().includes(q);
        const mIts = (r.itsId || '').toLowerCase().includes(q);
        const mRoom = (r.roomNumber || '').toLowerCase().includes(q);
        const mOffice = (r.officeName || '').toLowerCase().includes(q);
        const mBldg = (r.building || '').toLowerCase().includes(q);
        if (!mTour && !mFam && !mName && !mIts && !mRoom && !mOffice && !mBldg) return false;
      }
      return true;
    });

    // Group by Tour ID
    const map = new Map<string, Reservation[]>();
    list.forEach((r) => {
      const t = (r.tourRefNo || (r as any).tourId || 'Unassigned Tour').trim() || 'Unassigned Tour';
      const existing = map.get(t) || [];
      existing.push(r);
      map.set(t, existing);
    });

    const groups: {
      tourRefNo: string;
      officeName: string;
      reservations: Reservation[];
      familiesCount: number;
      totalPax: number;
      allottedCount: number;
      unallottedCount: number;
    }[] = [];

    map.forEach((items, tourRefNo) => {
      const officeName = items[0]?.officeName || '—';
      const familiesCount = new Set(items.map((x) => (x.family || '').trim()).filter(Boolean)).size;
      const totalPax = items.length;
      const allottedCount = items.filter((x) => x.roomNumber && x.roomNumber.trim() !== '').length;
      const unallottedCount = totalPax - allottedCount;

      // Sort families, then rooms
      const sorted = [...items].sort((a, b) => {
        const famA = (a.family || '').localeCompare(b.family || '', undefined, { numeric: true });
        if (famA !== 0) return famA;
        return (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true });
      });

      groups.push({
        tourRefNo,
        officeName,
        reservations: sorted,
        familiesCount,
        totalPax,
        allottedCount,
        unallottedCount,
      });
    });

    groups.sort((a, b) => (a.tourRefNo || '').localeCompare(b.tourRefNo || '', undefined, { numeric: true }));
    return groups;
  }, [safeReservations, portalFilterScope, dateTourIds, portalSearchQuery, activeHotelFilter]);

  // Worker task checklist toggle handlers
  const toggleWorkerSubtask = (itemId: string, taskKey: 'linen' | 'toilet' | 'cards') => {
    setWorkerSubtasks((prev) => {
      const current = prev[itemId] || {};
      const updated = { ...current, [taskKey]: !current[taskKey] };
      const allDone = !!(updated.linen && updated.toilet && updated.cards);
      if (allDone) {
        setWorkerCompletedTasks((c) => ({ ...c, [itemId]: true }));
      }
      return { ...prev, [itemId]: updated };
    });
  };

  const toggleRoomMasterSignoff = (itemId: string) => {
    const current = !!workerCompletedTasks[itemId];
    const newStatus = !current;
    setWorkerCompletedTasks((prev) => ({ ...prev, [itemId]: newStatus }));
    setWorkerSubtasks((prev) => ({
      ...prev,
      [itemId]: { linen: newStatus, toilet: newStatus, cards: newStatus },
    }));
  };

  const handleMarkAllWorkersReady = () => {
    const nextCompleted: Record<string, boolean> = {};
    const nextSubtasks: Record<string, { linen: boolean; toilet: boolean; cards: boolean }> = {};
    workerNumericRoomList.forEach((item) => {
      nextCompleted[item.id] = true;
      nextSubtasks[item.id] = { linen: true, toilet: true, cards: true };
    });
    setWorkerCompletedTasks(nextCompleted);
    setWorkerSubtasks(nextSubtasks);
  };

  const handleResetAllWorkerTasks = () => {
    setWorkerCompletedTasks({});
    setWorkerSubtasks({});
  };

  // Assistant Portal batch toggle handlers
  const handleMarkAllPortalUploaded = () => {
    const nextMap = { ...portalUploadedMap };
    const allResToUpdate: Reservation[] = [];
    portalUploadData.forEach((tourGroup) => {
      tourGroup.reservations.forEach((r) => {
        nextMap[r.id] = true;
        allResToUpdate.push({ ...r, isUploadedToPortal: true });
      });
    });
    setPortalUploadedMap(nextMap);
    allResToUpdate.forEach((r) => onUpdateReservation?.(r));
  };

  const handleUnmarkAllPortalUploaded = () => {
    const nextMap = { ...portalUploadedMap };
    const allResToUpdate: Reservation[] = [];
    portalUploadData.forEach((tourGroup) => {
      tourGroup.reservations.forEach((r) => {
        nextMap[r.id] = false;
        allResToUpdate.push({ ...r, isUploadedToPortal: false });
      });
    });
    setPortalUploadedMap(nextMap);
    allResToUpdate.forEach((r) => onUpdateReservation?.(r));
  };

  // Shift to next or previous active date
  const handleNavigateActiveDate = (direction: 'prev' | 'next') => {
    const list = activeDatesSummary.sortedDates;
    if (list.length === 0) return;
    const currentIndex = list.indexOf(selectedDate);
    if (currentIndex === -1) {
      setSelectedDate(list[0]);
      return;
    }
    if (direction === 'prev' && currentIndex > 0) {
      setSelectedDate(list[currentIndex - 1]);
    } else if (direction === 'next' && currentIndex < list.length - 1) {
      setSelectedDate(list[currentIndex + 1]);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = (targetHotelInput?: 'ALL' | 'Saifee' | 'Burhani' | unknown) => {
    const targetHotel: 'ALL' | 'Saifee' | 'Burhani' =
      targetHotelInput === 'Saifee' || targetHotelInput === 'Burhani' || targetHotelInput === 'ALL'
        ? targetHotelInput
        : activeHotelFilter;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const renderPrepSection = (hotelTitle: string, prepList: typeof filteredRoomPrep, startAtY: number) => {
      doc.setFillColor(18, 78, 57);
      doc.roundedRect(20, startAtY, pageWidth - 40, 24, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158);
      doc.text(hotelTitle, 30, startAtY + 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(`Rooms in Section: ${prepList.length}`, pageWidth - 160, startAtY + 16);

      const prepRows = prepList.map((item) => {
        const activeResInRoom = item.arrs.length > 0 ? item.arrs : (item.inHouse.length > 0 ? item.inHouse : item.deps);
        const famPaxMap = new Map<string, number>();
        activeResInRoom.forEach((r) => {
          const fam = (r.family || 'Unassigned').trim();
          famPaxMap.set(fam, (famPaxMap.get(fam) || 0) + 1);
        });
        const famPaxSummary = Array.from(famPaxMap.entries())
          .map(([fam, count]) => `Fam #${fam} (${count} Pax)`)
          .join('\n');

        const depText = item.deps.length > 0
          ? item.deps.map((d) => {
              const timeStr = getReservationDepartureTime(d, '01:00 AM');
              const famPax = item.deps.filter(x => (x.family || '').trim() === (d.family || '').trim()).length;
              return `• ${d.applicantName} (ITS: ${d.itsId})\n  DEP: ${timeStr} | Fam #${d.family || '—'} (${famPax} Pax) | Tour: ${d.tourRefNo || '—'}`;
            }).join('\n\n')
          : '— None';

        const arrText = item.arrs.length > 0
          ? item.arrs.map((a) => {
              const timeStr = getReservationArrivalTime(a, '11:00 AM');
              const famPax = item.arrs.filter(x => (x.family || '').trim() === (a.family || '').trim()).length;
              return `• ${a.applicantName} (ITS: ${a.itsId})\n  ARR: ${timeStr} | Fam #${a.family || '—'} (${famPax} Pax) | Tour: ${a.tourRefNo || '—'}`;
            }).join('\n\n')
          : '— None';

        const roomCell = `Room ${item.room.roomNumber}\n${item.room.building} Hotel • Fl ${item.room.floor}\n\n[Total: ${activeResInRoom.length} Pax in Room]\n${famPaxSummary || 'No Zaereen'}`;

        return [
          roomCell,
          depText,
          arrText,
          item.actionLabel,
          '[ ] Cleaned\n[ ] Fresh Linens\n[ ] Toilet Sanitized\n[ ] Wajba/cards ready\n[ ] Key Cards Ready',
        ];
      });

      safeAutoTable(doc, {
        startY: startAtY + 28,
        head: [['Room & Hotel (Pax & Family)', 'Departures (Check-outs & Times)', 'Arrivals (New Zaereen & Times)', 'Turnover Prep Action', 'Housekeeping Sign-off']],
        body: prepRows.length > 0 ? prepRows : [['No rooms with turnover activity in this hotel section on selected date', '', '', '', '']],
        margin: { left: 20, right: 20 },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 5, textColor: [30, 30, 30] },
        headStyles: { fillColor: [18, 78, 57], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        columnStyles: {
          0: { fontStyle: 'bold', fontSize: 9, cellWidth: 110, halign: 'center' },
          1: { fontSize: 7.5, cellWidth: 155 },
          2: { fontSize: 7.5, cellWidth: 155 },
          3: { fontSize: 8, cellWidth: 90 },
          4: { fontSize: 7, cellWidth: 90 },
        },
      });

      return (doc as any).lastAutoTable?.finalY ?? (startAtY + 30);
    };

    const renderHeader = (title: string, subtitle: string) => {
      doc.setFillColor(18, 78, 57);
      doc.rect(0, 0, pageWidth, 55, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(title, pageWidth / 2, 24, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(235, 213, 158);
      doc.text(subtitle, pageWidth / 2, 42, { align: 'center' });
    };

    let currentY = 75;

    const prepPool = showOnlyActiveRooms ? roomPrepSchedule.filter((p) => p.hasActivity) : roomPrepSchedule;
    const saifeePrep = prepPool.filter((p) => (p.room.building || '').toLowerCase().includes('saifee'));
    const burhaniPrep = prepPool.filter((p) => (p.room.building || '').toLowerCase().includes('burhani'));

    if (targetHotel === 'Saifee') {
      renderHeader('FAIZ-E-HUSAINI — SAIFEE HOTEL (70 ROOMS) TURNOVER SLIP', `ROOM TURNOVER & PREPARATION RECEPTION SLIP • DATE: ${selectedDate} • SEPARATE PRINT`);
      renderPrepSection('SAIFEE HOTEL (70 ROOMS) — ROOM TURNOVER & PREPARATION MATRIX', saifeePrep, currentY);
    } else if (targetHotel === 'Burhani') {
      renderHeader('FAIZ-E-HUSAINI — BURHANI HOTEL (44 ROOMS) TURNOVER SLIP', `ROOM TURNOVER & PREPARATION RECEPTION SLIP • DATE: ${selectedDate} • SEPARATE PRINT`);
      renderPrepSection('BURHANI HOTEL (44 ROOMS) — ROOM TURNOVER & PREPARATION MATRIX', burhaniPrep, currentY);
    } else {
      // ALL HOTELS: JOINED & BIFURCATED WITH PAGE BREAKS (Prompt: "pdf should be bifurcated as per hotels. different buildings can be printed seperately and when joined it can be done too")
      renderHeader('FAIZ-E-HUSAINI — ROOM TURNOVER & PREPARATION RECEPTION SLIP (JOINED & BIFURCATED)', `OPERATIONAL DATE: ${selectedDate} • SAIFEE HOTEL (70 ROOMS) & BURHANI HOTEL (44 ROOMS)`);
      renderPrepSection('PART 1: SAIFEE HOTEL (70 ROOMS) — ROOM TURNOVER & PREPARATION MATRIX', saifeePrep, currentY);

      doc.addPage();
      renderHeader('FAIZ-E-HUSAINI — ROOM TURNOVER & PREPARATION RECEPTION SLIP (PART 2: BURHANI HOTEL)', `OPERATIONAL DATE: ${selectedDate} • BURHANI HOTEL (44 ROOMS)`);
      currentY = 75;
      renderPrepSection('PART 2: BURHANI HOTEL (44 ROOMS) — ROOM TURNOVER & PREPARATION MATRIX', burhaniPrep, currentY);
    }

    currentY = (doc as any).lastAutoTable?.finalY ?? (currentY + 25);
    currentY += 15;
    if (currentY + 50 > pageHeight) {
      doc.addPage();
      currentY = 40;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('____________________________________', 60, currentY + 30);
    doc.text('Prepared by: Accommodation Control Desk', 60, currentY + 42);
    doc.text('____________________________________', pageWidth - 260, currentY + 30);
    doc.text('Received by: Housekeeping & Reception Duty Manager', pageWidth - 260, currentY + 42);

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Faiz-e-Husaini Room Turnover — Date: ${selectedDate} — Page ${i} of ${totalPages}`, 40, pageHeight - 12);
      doc.text('CONFIDENTIAL OPERATIONAL RECORD', pageWidth - 200, pageHeight - 12);
    }

    const hotelSuffix = targetHotel !== 'ALL' ? `_${targetHotel}_Hotel` : '_Joined_Bifurcated_Hotels';
    const fileName = `Faiz_Husaini_Room_Turnover_Prep_Slip_${selectedDate}${hotelSuffix}.pdf`;
    const res = saveOrDownloadPdf(doc, fileName);
    setPdfDownloadStatus(res);
  };

  // Download Dedicated Arrivals PDF for the chosen arrival date (Prompt: "I want the downloaded pdf of the date of arrival I have chosen / pdf should be bifurcated as per hotels. different buildings can be printed seperately and when joined it can be done too")
  const handleDownloadArrivalsPdf = (targetHotelInput?: 'ALL' | 'Saifee' | 'Burhani' | unknown) => {
    const targetHotel: 'ALL' | 'Saifee' | 'Burhani' =
      targetHotelInput === 'Saifee' || targetHotelInput === 'Burhani' || targetHotelInput === 'ALL'
        ? targetHotelInput
        : activeHotelFilter;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const renderHeader = (title: string, subtitle: string) => {
      doc.setFillColor(18, 78, 57);
      doc.rect(0, 0, pageWidth, 55, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(title, pageWidth / 2, 24, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(235, 213, 158);
      doc.text(subtitle, pageWidth / 2, 42, { align: 'center' });
    };

    const renderArrivalsTable = (
      hotelTitle: string,
      tourGroups: typeof allArrivalsGroupedByTour,
      arrivalsList: Reservation[],
      startAtY: number,
      bannerColor: [number, number, number] = [18, 78, 57]
    ) => {
      doc.setFillColor(bannerColor[0], bannerColor[1], bannerColor[2]);
      doc.roundedRect(20, startAtY, pageWidth - 40, 24, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158);
      doc.text(hotelTitle, 30, startAtY + 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(`Total Arrivals: ${arrivalsList.length} Zaereen • Sorted As Per Room Numbers`, pageWidth - 290, startAtY + 16);

      // Sort as per rooms (Requirement: "the arrival slip should be sorted as per rooms with all the details told prior")
      const sortedByRooms = [...arrivalsList].sort((a, b) => {
        const hasA = !!a.roomNumber && a.roomNumber.trim() !== '';
        const hasB = !!b.roomNumber && b.roomNumber.trim() !== '';
        if (hasA && !hasB) return -1;
        if (!hasA && hasB) return 1;
        const numA = parseInt(a.roomNumber || '', 10) || 9999;
        const numB = parseInt(b.roomNumber || '', 10) || 9999;
        if (numA !== numB) return numA - numB;
        const famA = (a.family || '').localeCompare(b.family || '', undefined, { numeric: true });
        if (famA !== 0) return famA;
        return (a.applicantName || '').localeCompare(b.applicantName || '');
      });

      const rows: string[][] = [];
      let counter = 1;
      sortedByRooms.forEach((r) => {
        const paxInfo = getRoomPaxInfo(r);
        const arrTime = getReservationArrivalTime(r, '11:00 AM');
        const depTime = getReservationDepartureTime(r, '01:00 AM');
        const roomStr = r.roomNumber ? `Room ${r.roomNumber}\n(${r.building || ''} Hotel)` : 'UNALLOTTED\n[Assign Rm]';
        rows.push([
          String(counter++),
          roomStr,
          `Family #${r.family || '—'}\n(${paxInfo.famPaxInRoom} Pax in Room)`,
          `${r.applicantName}\nITS: ${r.itsId || '—'}`,
          `Time: ${arrTime}`,
          `Dep: ${r.departureDate || '—'}\n(${depTime})`,
          `Tour: ${r.tourRefNo || '—'}\nOffice: ${r.officeName || '—'}`,
          r.category || 'Mumineen',
          r.moneyGiven === 'Yes' ? 'Paid (Cat A) ✓' : (r.shiftToCategoryA ? 'Pending Cat A' : 'Standard'),
          '[ ] ID Verified\n[ ] Key Cards Given\n[ ] Wajba Given',
        ]);
      });

      safeAutoTable(doc, {
        startY: startAtY + 28,
        head: [['#', 'Room # & Hotel (Base)', 'Family # & Room Pax', 'Applicant / Guest & ITS', 'Arrival Time', 'Departure Date & Time', 'Tour ID & Office', 'Category', 'Payment / Cat', 'Reception Sign-off']],
        body: rows.length > 0 ? rows : [[`No arrivals scheduled for this section on ${selectedDate}`, '', '', '', '', '', '', '', '', '']],
        margin: { left: 20, right: 20 },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4.5, textColor: [30, 30, 30] },
        headStyles: { fillColor: bannerColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 25, halign: 'center' },
          1: { fontStyle: 'bold', fontSize: 9, cellWidth: 85, halign: 'center' },
          2: { fontSize: 8, cellWidth: 80 },
          3: { fontStyle: 'bold', fontSize: 8, cellWidth: 110 },
          4: { fontStyle: 'bold', fontSize: 8.5, cellWidth: 70, halign: 'center' },
          5: { fontSize: 8, cellWidth: 75, halign: 'center' },
          6: { fontSize: 7.5, cellWidth: 95 },
          7: { fontSize: 7.5, cellWidth: 55, halign: 'center' },
          8: { fontSize: 7.5, cellWidth: 65, halign: 'center' },
          9: { fontSize: 7, cellWidth: 90 },
        },
      });

      return (doc as any).lastAutoTable?.finalY ?? (startAtY + 40);
    };

    let currentY = 75;

    if (targetHotel === 'Saifee') {
      renderHeader(
        'FAIZ-E-HUSAINI — SAIFEE HOTEL (70 ROOMS) ARRIVALS MANIFEST',
        `OFFICIAL ARRIVAL DATE: ${selectedDate} • SEPARATE BUILDING PRINT • ${saifeeArrivals.length} ZAEREEN ARRIVING`
      );
      renderArrivalsTable('SAIFEE HOTEL (70 ROOMS) — SCHEDULED ARRIVALS & GUEST ALLOTMENT', saifeeArrivalsGroupedByTour, saifeeArrivals, currentY);
    } else if (targetHotel === 'Burhani') {
      renderHeader(
        'FAIZ-E-HUSAINI — BURHANI HOTEL (44 ROOMS) ARRIVALS MANIFEST',
        `OFFICIAL ARRIVAL DATE: ${selectedDate} • SEPARATE BUILDING PRINT • ${burhaniArrivals.length} ZAEREEN ARRIVING`
      );
      renderArrivalsTable('BURHANI HOTEL (44 ROOMS) — SCHEDULED ARRIVALS & GUEST ALLOTMENT', burhaniArrivalsGroupedByTour, burhaniArrivals, currentY);
    } else {
      // JOINED & BIFURCATED AS PER HOTELS (Prompt: "pdf should be bifurcated as per hotels. different buildings can be printed seperately and when joined it can be done too")
      renderHeader(
        'FAIZ-E-HUSAINI — SCHEDULED ARRIVALS MANIFEST (JOINED & BIFURCATED AS PER HOTELS)',
        `OFFICIAL ARRIVAL DATE: ${selectedDate} • TOTAL ZAEREEN: ${arrivalsOnDate.length} (SAIFEE: ${saifeeArrivals.length} | BURHANI: ${burhaniArrivals.length})`
      );

      // Part 1: Saifee Hotel
      renderArrivalsTable('PART 1: SAIFEE HOTEL (70 ROOMS) — ARRIVALS MANIFEST & GUEST ALLOTMENT', saifeeArrivalsGroupedByTour, saifeeArrivals, currentY);

      // Page break for Part 2: Burhani Hotel (So each hotel can be printed separately from this PDF or joined together)
      doc.addPage();
      renderHeader(
        'FAIZ-E-HUSAINI — SCHEDULED ARRIVALS MANIFEST (PART 2: BURHANI HOTEL)',
        `OFFICIAL ARRIVAL DATE: ${selectedDate} • BURHANI HOTEL (44 ROOMS) • ${burhaniArrivals.length} ZAEREEN ARRIVING`
      );
      currentY = 75;
      renderArrivalsTable('PART 2: BURHANI HOTEL (44 ROOMS) — ARRIVALS MANIFEST & GUEST ALLOTMENT', burhaniArrivalsGroupedByTour, burhaniArrivals, currentY);

      // If unallotted zaereen exist, add Part 3 on clean page
      if (unallottedArrivals.length > 0) {
        doc.addPage();
        renderHeader(
          'FAIZ-E-HUSAINI — UNALLOTTED ZAEREEN ARRIVALS (ATTENTION REQUIRED)',
          `OFFICIAL ARRIVAL DATE: ${selectedDate} • PENDING ROOM ALLOTMENT • ${unallottedArrivals.length} ZAEREEN`
        );
        currentY = 75;
        renderArrivalsTable(
          'PART 3: UNALLOTTED ZAEREEN (PENDING HOTEL & ROOM ALLOTMENT)',
          unallottedArrivalsGroupedByTour,
          unallottedArrivals,
          currentY,
          [185, 28, 28] // red banner
        );
      }
    }

    currentY = (doc as any).lastAutoTable?.finalY ?? (currentY + 25);
    currentY += 15;
    if (currentY + 50 > pageHeight) {
      doc.addPage();
      currentY = 40;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Reception In-Charge Sign-off: ___________________________  Arrival Date: ${selectedDate}`, 40, currentY + 25);
    doc.text('Tour Coordinator Received: ___________________________', pageWidth - 280, currentY + 25);

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Faiz-e-Husaini Arrivals Manifest — Date: ${selectedDate} — Page ${i} of ${totalPages}`, 40, pageHeight - 12);
      doc.text('BIFURCATED ADMINISTRATIVE RECORD', pageWidth - 200, pageHeight - 12);
    }

    const hotelSuffix = targetHotel !== 'ALL' ? `_${targetHotel}_Hotel` : '_Joined_Bifurcated_Hotels';
    const fileName = `Faiz_Husaini_Arrivals_Manifest_${selectedDate}${hotelSuffix}.pdf`;
    const res = saveOrDownloadPdf(doc, fileName);
    setPdfDownloadStatus(res);
  };

  // Download Tour Roster PDF (Requirement 2) - bifurcated as per hotels
  const handleDownloadRosterPdf = (targetHotelInput?: 'ALL' | 'Saifee' | 'Burhani' | unknown) => {
    const targetHotel: 'ALL' | 'Saifee' | 'Burhani' =
      targetHotelInput === 'Saifee' || targetHotelInput === 'Burhani' || targetHotelInput === 'ALL'
        ? targetHotelInput
        : activeHotelFilter;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const renderHeader = (title: string, subtitle: string) => {
      doc.setFillColor(18, 78, 57);
      doc.rect(0, 0, pageWidth, 55, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(title, pageWidth / 2, 24, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(235, 213, 158);
      doc.text(subtitle, pageWidth / 2, 42, { align: 'center' });
    };

    const renderRosterTables = (
      hotelTitle: string,
      arrGroups: typeof allArrivalsGroupedByTour,
      arrList: Reservation[],
      depGroups: typeof allDeparturesGroupedByTour,
      depList: Reservation[],
      startAtY: number
    ) => {
      let y = startAtY;
      doc.setFillColor(18, 78, 57);
      doc.roundedRect(20, y, pageWidth - 40, 22, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158);
      doc.text(`${hotelTitle} — ARRIVALS (${arrList.length} Zaereen • ${arrGroups.length} Tours)`, 30, y + 15);

      const arrivalRows: string[][] = [];
      arrGroups.forEach((group) => {
        group.reservations.forEach((r) => {
          const paxInfo = getRoomPaxInfo(r);
          const arrTime = getReservationArrivalTime(r, '11:00 AM');
          const depTime = getReservationDepartureTime(r, '01:00 AM');
          const roomStr = r.roomNumber ? `Room ${r.roomNumber}\n(${r.building || ''})` : 'UNALLOTTED';
          arrivalRows.push([
            `Tour: ${group.tourRefNo}\nOffice: ${group.officeName}`,
            roomStr,
            `Family #${r.family || '—'}\n(${paxInfo.famPaxInRoom} Pax)`,
            `${r.applicantName}\nITS: ${r.itsId || '—'}`,
            `Arr: ${arrTime}`,
            `Dep: ${r.departureDate || '—'}\n(${depTime})`,
            r.category || 'Mumineen',
            r.moneyGiven === 'Yes' ? 'Paid ✓' : (r.shiftToCategoryA ? 'Pending' : '—'),
          ]);
        });
      });

      safeAutoTable(doc, {
        startY: y + 26,
        head: [['Tour ID & Office', 'Room # & Hotel', 'Family # & Pax', 'Applicant / Guest & ITS', 'Arrival Time', 'Departure Date & Time', 'Category', 'Money (B➔A)']],
        body: arrivalRows.length > 0 ? arrivalRows : [['No arrivals scheduled for this section on this date', '', '', '', '', '', '', '']],
        margin: { left: 20, right: 20 },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4.5, textColor: [30, 30, 30] },
        headStyles: { fillColor: [18, 78, 57], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { fontStyle: 'bold', fontSize: 8, cellWidth: 120 },
          1: { fontStyle: 'bold', fontSize: 8.5, cellWidth: 75, halign: 'center' },
          2: { fontSize: 8, cellWidth: 85 },
          3: { fontStyle: 'bold', fontSize: 8, cellWidth: 125 },
          4: { fontStyle: 'bold', fontSize: 8.5, cellWidth: 70, halign: 'center' },
          5: { fontSize: 8, cellWidth: 70, halign: 'center' },
          6: { fontSize: 8, cellWidth: 65, halign: 'center' },
          7: { fontSize: 8, cellWidth: 65, halign: 'center' },
        },
      });

      y = (doc as any).lastAutoTable?.finalY ?? (y + 30);
      y += 15;

      // Departures section
      if (y + 100 > pageHeight) {
        doc.addPage();
        y = 40;
      }

      doc.setFillColor(50, 60, 70);
      doc.roundedRect(20, y, pageWidth - 40, 22, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text(`${hotelTitle} — DEPARTURES (${depList.length} Zaereen • ${depGroups.length} Tours)`, 30, y + 15);

      const departureRows: string[][] = [];
      depGroups.forEach((group) => {
        group.reservations.forEach((r) => {
          const paxInfo = getRoomPaxInfo(r);
          const depTime = getReservationDepartureTime(r, '01:00 AM');
          const arrTime = getReservationArrivalTime(r, '11:00 AM');
          const roomStr = r.roomNumber ? `Room ${r.roomNumber}\n(${r.building || ''})` : '—';
          departureRows.push([
            `Tour: ${group.tourRefNo}\nOffice: ${group.officeName}`,
            roomStr,
            `Family #${r.family || '—'}\n(${paxInfo.famPaxInRoom} Pax)`,
            `${r.applicantName}\nITS: ${r.itsId || '—'}`,
            `Dep: ${depTime}`,
            `Arr: ${r.arrivalDate || '—'}\n(${arrTime})`,
            'Clear key cards & prepare for cleaning',
          ]);
        });
      });

      safeAutoTable(doc, {
        startY: y + 26,
        head: [['Tour ID & Office', 'Room # & Hotel', 'Family # & Pax', 'Applicant / Guest & ITS', 'Departure Time', 'Arrival Date & Time', 'Turnover / Check-out Notes']],
        body: departureRows.length > 0 ? departureRows : [['No departures scheduled for this section on this date', '', '', '', '', '', '']],
        margin: { left: 20, right: 20 },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4.5, textColor: [30, 30, 30] },
        headStyles: { fillColor: [40, 50, 60], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { fontStyle: 'bold', fontSize: 8, cellWidth: 120 },
          1: { fontStyle: 'bold', fontSize: 8.5, cellWidth: 75, halign: 'center' },
          2: { fontSize: 8, cellWidth: 85 },
          3: { fontStyle: 'bold', fontSize: 8, cellWidth: 125 },
          4: { fontStyle: 'bold', fontSize: 8.5, cellWidth: 70, halign: 'center' },
          5: { fontSize: 8, cellWidth: 70, halign: 'center' },
          6: { fontSize: 8, cellWidth: 130 },
        },
      });

      return (doc as any).lastAutoTable?.finalY ?? (y + 30);
    };

    let currentY = 75;

    if (targetHotel === 'Saifee') {
      renderHeader('FAIZ-E-HUSAINI — SAIFEE HOTEL (70 ROOMS) TOUR ROSTER', `ARRIVALS & DEPARTURES • OPERATIONAL DATE: ${selectedDate} • SEPARATE PRINT`);
      renderRosterTables('SAIFEE HOTEL', saifeeArrivalsGroupedByTour, saifeeArrivals, saifeeDeparturesGroupedByTour, saifeeDepartures, currentY);
    } else if (targetHotel === 'Burhani') {
      renderHeader('FAIZ-E-HUSAINI — BURHANI HOTEL (44 ROOMS) TOUR ROSTER', `ARRIVALS & DEPARTURES • OPERATIONAL DATE: ${selectedDate} • SEPARATE PRINT`);
      renderRosterTables('BURHANI HOTEL', burhaniArrivalsGroupedByTour, burhaniArrivals, burhaniDeparturesGroupedByTour, burhaniDepartures, currentY);
    } else {
      // Joined & Bifurcated
      renderHeader('FAIZ-E-HUSAINI — DAILY TOUR ROSTER (JOINED & BIFURCATED AS PER HOTELS)', `OPERATIONAL DATE: ${selectedDate} • GROUPED BY TOUR ID & SORTED BY TIMING`);
      renderRosterTables('PART 1: SAIFEE HOTEL', saifeeArrivalsGroupedByTour, saifeeArrivals, saifeeDeparturesGroupedByTour, saifeeDepartures, currentY);

      doc.addPage();
      renderHeader('FAIZ-E-HUSAINI — DAILY TOUR ROSTER (PART 2: BURHANI HOTEL)', `OPERATIONAL DATE: ${selectedDate} • BURHANI HOTEL (44 ROOMS)`);
      currentY = 75;
      renderRosterTables('PART 2: BURHANI HOTEL', burhaniArrivalsGroupedByTour, burhaniArrivals, burhaniDeparturesGroupedByTour, burhaniDepartures, currentY);

      if (unallottedArrivals.length > 0 || unallottedDepartures.length > 0) {
        doc.addPage();
        renderHeader('FAIZ-E-HUSAINI — DAILY TOUR ROSTER (PART 3: UNALLOTTED ZAEREEN)', `OPERATIONAL DATE: ${selectedDate} • PENDING ROOM ALLOTMENTS`);
        currentY = 75;
        renderRosterTables('PART 3: UNALLOTTED ZAEREEN', unallottedArrivalsGroupedByTour, unallottedArrivals, unallottedDeparturesGroupedByTour, unallottedDepartures, currentY);
      }
    }

    currentY = (doc as any).lastAutoTable?.finalY ?? (currentY + 25);
    currentY += 15;
    if (currentY + 50 > pageHeight) {
      doc.addPage();
      currentY = 40;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Reception Manager Sign-off: ___________________________', 40, currentY + 25);
    doc.text('Tour Co-ordinator Received: ___________________________', pageWidth - 280, currentY + 25);

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Faiz-e-Husaini Tour Roster — Date: ${selectedDate} — Page ${i} of ${totalPages}`, 40, pageHeight - 12);
      doc.text('BIFURCATED ADMINISTRATIVE RECORD', pageWidth - 200, pageHeight - 12);
    }

    const hotelSuffix = targetHotel !== 'ALL' ? `_${targetHotel}_Hotel` : '_Joined_Bifurcated_Hotels';
    const fileName = `Faiz_Husaini_Tour_Roster_${selectedDate}${hotelSuffix}.pdf`;
    const res = saveOrDownloadPdf(doc, fileName);
    setPdfDownloadStatus(res);
  };

  // Download Worker Room Operations Summary Sheet (Requirement 3) - bifurcated as per hotels
  const handleDownloadWorkerPdf = (
    targetHotelInput?: 'ALL' | 'Saifee' | 'Burhani' | unknown,
    modeInput?: 'grouped' | 'room_numeric'
  ) => {
    const targetHotel: 'ALL' | 'Saifee' | 'Burhani' =
      targetHotelInput === 'Saifee' || targetHotelInput === 'Burhani' || targetHotelInput === 'ALL'
        ? targetHotelInput
        : activeHotelFilter;
    const mode = modeInput || workerViewMode;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const renderHeader = (title: string, subtitle: string) => {
      doc.setFillColor(18, 78, 57);
      doc.rect(0, 0, pageWidth, 55, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(title, pageWidth / 2, 24, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(235, 213, 158);
      doc.text(subtitle, pageWidth / 2, 42, { align: 'center' });
    };

    const renderWorkerSection = (hotelTitle: string, buildingName: string, startAtY: number) => {
      doc.setFillColor(18, 78, 57);
      doc.roundedRect(20, startAtY, pageWidth - 40, 24, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158);
      doc.text(hotelTitle, 30, startAtY + 16);

      const sectionPrep = roomPrepSchedule.filter((p) => {
        if (!p.hasActivity) return false;
        if (buildingName !== 'ALL') {
          return normalizeHotelBuilding(p.room.building) === buildingName;
        }
        return true;
      });
      const summaryResult = buildWorkerSummary(sectionPrep, selectedDate);
      const sectionSummary = summaryResult.groupedByOffice;
      const sectionNumeric = summaryResult.numericRooms;

      const tableRows: any[][] = [];

      if (mode === 'room_numeric') {
        // Mode 1: Base organized strictly by Room Number
        sectionNumeric.forEach((item) => {
          const roomCell = `Room ${item.roomNumber}\n${item.building} Hotel • Fl ${item.floor}`;
          const timingCell = `${item.actionType}\n${item.timeLabel}`;
          const officeTourCell = `Office:\n${item.officeName}\n\nTour ID:\n${item.tourRefNo}`;
          const famPaxCell = `Family #${item.familyNumbers}\n\n[Total: ${item.totalPaxInRoom} Pax in Room]`;
          const guestCell = `${item.leadGuestName}\nITS: ${item.leadGuestIts}`;
          const checklistCell = `[ ] Bed Sheets & Linens Fresh\n[ ] Toilet Sanitized\n[ ] Wajba & Key Cards Ready\n[ ] Worker Sign: ___________`;

          tableRows.push([
            roomCell,
            timingCell,
            officeTourCell,
            famPaxCell,
            guestCell,
            checklistCell,
          ]);
        });
      } else {
        // Mode 2: Grouped by Office Name and Tour ID in timing sequence (Base Room # followed by Timings)
        sectionSummary.forEach((officeGroup) => {
          officeGroup.tours.forEach((tourGroup) => {
            tableRows.push([
              {
                content: `OFFICE: ${officeGroup.officeName.toUpperCase()}   •   TOUR ID: ${tourGroup.tourRefNo}   (${tourGroup.totalRooms} Rooms to service • ${tourGroup.totalPax} Zaereen • Timing Sequence Sorted)`,
                colSpan: 6,
                styles: { fillColor: [18, 78, 57], textColor: [235, 213, 158], fontStyle: 'bold', fontSize: 8.5 }
              },
              '', '', '', '', ''
            ]);

            tourGroup.items.forEach((item) => {
              const roomCell = `Room ${item.roomNumber}\n${item.building} Hotel • Fl ${item.floor}`;
              const timingCell = `${item.actionType}\n${item.timeLabel}`;
              const officeTourCell = `Office:\n${officeGroup.officeName}\n\nTour ID:\n${tourGroup.tourRefNo}`;
              const famPaxCell = `Family #${item.familyNumbers}\n\n[Total: ${item.totalPaxInRoom} Pax in Room]`;
              const guestCell = `${item.leadGuestName}\nITS: ${item.leadGuestIts}`;
              const checklistCell = `[ ] Bed Sheets & Linens Fresh\n[ ] Toilet Sanitized\n[ ] Wajba & Key Cards Ready\n[ ] Worker Sign: ___________`;

              tableRows.push([
                roomCell,
                timingCell,
                officeTourCell,
                famPaxCell,
                guestCell,
                checklistCell,
              ]);
            });
          });
        });
      }

      const tableHead = [['Room # & Hotel (Base)', 'Event & Arrival/Departure Timings', 'Office Name & Tour ID', 'Family # & Room Pax', 'Guest Details & ITS', 'Worker Checklist & Sign-off']];

      safeAutoTable(doc, {
        startY: startAtY + 28,
        head: tableHead,
        body: tableRows.length > 0 ? tableRows : [[`No room operations scheduled for workers in this hotel on selected date`, '', '', '', '', '']],
        margin: { left: 20, right: 20 },
        theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 30, 30] },
        headStyles: { fillColor: [18, 78, 57], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        columnStyles: {
          0: { fontStyle: 'bold', fontSize: 9.5, cellWidth: 105, halign: 'center' },
          1: { fontSize: 8, cellWidth: 135 },
          2: { fontStyle: 'bold', fontSize: 8.5, cellWidth: 145 },
          3: { fontSize: 8.5, cellWidth: 110 },
          4: { fontSize: 8, cellWidth: 125 },
          5: { fontSize: 7.5, cellWidth: 170 },
        },
      });

      return (doc as any).lastAutoTable?.finalY ?? (startAtY + 30);
    };

    let currentY = 75;

    if (targetHotel === 'Saifee') {
      renderHeader('FAIZ-E-HUSAINI — SAIFEE HOTEL (70 ROOMS) WORKER SHEET', `HOUSEKEEPING EXECUTION • DATE: ${selectedDate} • SEPARATE PRINT`);
      renderWorkerSection('SAIFEE HOTEL (70 ROOMS) — ROOM OPERATIONS & TURNOVER', 'Saifee', currentY);
    } else if (targetHotel === 'Burhani') {
      renderHeader('FAIZ-E-HUSAINI — BURHANI HOTEL (44 ROOMS) WORKER SHEET', `HOUSEKEEPING EXECUTION • DATE: ${selectedDate} • SEPARATE PRINT`);
      renderWorkerSection('BURHANI HOTEL (44 ROOMS) — ROOM OPERATIONS & TURNOVER', 'Burhani', currentY);
    } else {
      // Joined & Bifurcated
      renderHeader('FAIZ-E-HUSAINI — WORKER ROOM OPERATIONS SHEET (JOINED & BIFURCATED)', `HOUSEKEEPING & ROOM ATTENDANTS EXECUTION SHEET • DATE: ${selectedDate}`);
      renderWorkerSection('PART 1: SAIFEE HOTEL (70 ROOMS) — ROOM OPERATIONS', 'Saifee', currentY);

      doc.addPage();
      renderHeader('FAIZ-E-HUSAINI — WORKER ROOM OPERATIONS SHEET (PART 2: BURHANI HOTEL)', `HOUSEKEEPING & ROOM ATTENDANTS EXECUTION SHEET • DATE: ${selectedDate}`);
      currentY = 75;
      renderWorkerSection('PART 2: BURHANI HOTEL (44 ROOMS) — ROOM OPERATIONS', 'Burhani', currentY);
    }

    currentY = (doc as any).lastAutoTable?.finalY ?? (currentY + 25);
    currentY += 15;
    if (currentY + 50 > pageHeight) {
      doc.addPage();
      currentY = 40;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Supervisor Shift In-charge: ___________________________', 40, currentY + 25);
    doc.text('Housekeeping Team Lead Received: ___________________________', pageWidth - 320, currentY + 25);

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Faiz-e-Husaini Worker Sheet — Date: ${selectedDate} — Page ${i} of ${totalPages}`, 40, pageHeight - 12);
      doc.text('BIFURCATED ADMINISTRATIVE RECORD', pageWidth - 200, pageHeight - 12);
    }

    const hotelSuffix = targetHotel !== 'ALL' ? `_${targetHotel}_Hotel` : '_Joined_Bifurcated_Hotels';
    const fileName = `Faiz_Husaini_Worker_Room_Operations_${selectedDate}${hotelSuffix}.pdf`;
    const res = saveOrDownloadPdf(doc, fileName);
    setPdfDownloadStatus(res);
  };

  // Download Assistant Portal Allotment Checklist PDF (Requirement 4) - bifurcated as per hotels
  const handleDownloadPortalUploadPdf = (targetHotelInput?: 'ALL' | 'Saifee' | 'Burhani' | unknown) => {
    const targetHotel: 'ALL' | 'Saifee' | 'Burhani' =
      targetHotelInput === 'Saifee' || targetHotelInput === 'Burhani' || targetHotelInput === 'ALL'
        ? targetHotelInput
        : activeHotelFilter;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const renderHeader = (title: string, subtitle: string) => {
      doc.setFillColor(18, 78, 57);
      doc.rect(0, 0, pageWidth, 55, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(title, pageWidth / 2, 24, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(235, 213, 158);
      doc.text(subtitle, pageWidth / 2, 42, { align: 'center' });
    };

    const dateTours = new Set<string>();
    const checkAndAdd = (r: Reservation) => {
      const tour = (r.tourRefNo || (r as any).tourId || 'Unassigned Tour').trim() || 'Unassigned Tour';
      dateTours.add(tour);
    };
    arrivalsOnDate.forEach(checkAndAdd);
    departuresOnDate.forEach(checkAndAdd);
    inHouseOnDate.forEach(checkAndAdd);

    const renderPortalSection = (hotelTitle: string, buildingName: string, startAtY: number) => {
      doc.setFillColor(18, 78, 57);
      doc.roundedRect(20, startAtY, pageWidth - 40, 24, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158);
      doc.text(hotelTitle, 30, startAtY + 16);

      const portalReservations = safeReservations.filter((r) => {
        const tour = (r.tourRefNo || (r as any).tourId || 'Unassigned Tour').trim() || 'Unassigned Tour';
        const matchesScope = portalFilterScope === 'all' ? true : dateTours.has(tour);
        if (!matchesScope) return false;
        if (buildingName !== 'ALL') {
          const rBldg = normalizeHotelBuilding(r.building);
          const matchesBldg = rBldg === buildingName;
          const isUnallotted = !r.roomNumber || r.roomNumber.trim() === '';
          if (!matchesBldg && !isUnallotted) return false;
        }
        return true;
      });

      const tourMap = new Map<string, Reservation[]>();
      portalReservations.forEach((r) => {
        const t = (r.tourRefNo || (r as any).tourId || 'Unassigned Tour').trim() || 'Unassigned Tour';
        const existing = tourMap.get(t) || [];
        existing.push(r);
        tourMap.set(t, existing);
      });

      const sortedTours = Array.from(tourMap.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const portalRows: string[][] = [];
      let counter = 1;

      sortedTours.forEach((tourId) => {
        const items = tourMap.get(tourId) || [];
        items.sort((a, b) => {
          const famA = (a.family || '').localeCompare(b.family || '', undefined, { numeric: true });
          if (famA !== 0) return famA;
          return (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true });
        });

        items.forEach((r) => {
          const roomStr = r.roomNumber ? `Room ${r.roomNumber}\n(${r.building} Hotel)` : 'UNALLOTTED\n[Needs Room]';
          const isUploaded = (portalUploadedMap[r.id] ?? r.isUploadedToPortal) ? '[✓] Uploaded' : '[  ] Pending';
          const arrTime = getReservationArrivalTime(r, '11:00 AM');
          const depTime = getReservationDepartureTime(r, '01:00 AM');
          const arrDep = `Arr: ${r.arrivalDate || '—'}${arrTime ? ` (${arrTime})` : ''}\nDep: ${r.departureDate || '—'}${depTime ? ` (${depTime})` : ''}`;

          portalRows.push([
            String(counter++),
            tourId,
            `Fam #${r.family || '—'}`,
            roomStr,
            `${r.applicantName}\n(Office: ${r.officeName || '—'})`,
            r.itsId || '—',
            `${r.age || '—'} / ${r.gender || '—'}`,
            r.category || 'Mumineen',
            arrDep,
            isUploaded,
          ]);
        });
      });

      safeAutoTable(doc, {
        startY: startAtY + 28,
        head: [['#', 'Tour ID', 'Family #', 'Allotted Room & Building', 'Applicant / Member Name', 'ITS ID', 'Age / Sex', 'Category', 'Arrival ➔ Departure', 'Portal Status & Checkbox']],
        body: portalRows.length > 0 ? portalRows : [[`No zaereen found for portal verification in this section`, '', '', '', '', '', '', '', '', '']],
        margin: { left: 20, right: 20 },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4.5, textColor: [30, 30, 30] },
        headStyles: { fillColor: [18, 78, 57], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 25, halign: 'center' },
          1: { fontStyle: 'bold', fontSize: 7.5, cellWidth: 95 },
          2: { fontStyle: 'bold', fontSize: 8, cellWidth: 55, halign: 'center' },
          3: { fontStyle: 'bold', fontSize: 8.5, cellWidth: 85, halign: 'center' },
          4: { fontSize: 8, cellWidth: 120 },
          5: { fontStyle: 'bold', fontSize: 8, cellWidth: 55, halign: 'center' },
          6: { fontSize: 7.5, cellWidth: 55, halign: 'center' },
          7: { fontSize: 7.5, cellWidth: 65, halign: 'center' },
          8: { fontSize: 7.5, cellWidth: 80, halign: 'center' },
          9: { fontStyle: 'bold', fontSize: 8, cellWidth: 75, halign: 'center' },
        },
      });

      return (doc as any).lastAutoTable?.finalY ?? (startAtY + 30);
    };

    let currentY = 75;

    if (targetHotel === 'Saifee') {
      renderHeader('FAIZ-E-HUSAINI — SAIFEE HOTEL PORTAL UPLOAD CHECKLIST', `DATE: ${selectedDate} • SEPARATE PRINT • SAIFEE (70 ROOMS)`);
      renderPortalSection('SAIFEE HOTEL — ASSISTANT PORTAL ALLOTMENT CHECKLIST', 'Saifee', currentY);
    } else if (targetHotel === 'Burhani') {
      renderHeader('FAIZ-E-HUSAINI — BURHANI HOTEL PORTAL UPLOAD CHECKLIST', `DATE: ${selectedDate} • SEPARATE PRINT • BURHANI (44 ROOMS)`);
      renderPortalSection('BURHANI HOTEL — ASSISTANT PORTAL ALLOTMENT CHECKLIST', 'Burhani', currentY);
    } else {
      // Complete Master Tour Verification (All Hotels & Unallotted)
      renderHeader('FAIZ-E-HUSAINI — ASSISTANT PORTAL UPLOAD CHECKLIST (MASTER TOUR VERIFICATION)', `TOUR & FAMILY ALLOTMENT VERIFICATION • OPERATIONAL DATE: ${selectedDate}`);
      renderPortalSection('ALL TOURS & HOTELS — ASSISTANT PORTAL ALLOTMENT VERIFICATION', 'ALL', currentY);
    }

    currentY = (doc as any).lastAutoTable?.finalY ?? (currentY + 25);
    currentY += 15;
    if (currentY + 50 > pageHeight) {
      doc.addPage();
      currentY = 40;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Portal Upload Assistant: ___________________________  Date/Time: ___________________', 40, currentY + 25);
    doc.text('Supervisor Verification Sign-off: ___________________________', pageWidth - 280, currentY + 25);

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Faiz-e-Husaini Portal Checklist — Date: ${selectedDate} — Page ${i} of ${totalPages}`, 40, pageHeight - 12);
      doc.text('BIFURCATED ADMINISTRATIVE RECORD', pageWidth - 200, pageHeight - 12);
    }

    const hotelSuffix = targetHotel !== 'ALL' ? `_${targetHotel}_Hotel` : '_Joined_Bifurcated_Hotels';
    const fileName = `Faiz_Husaini_Assistant_Portal_Upload_${selectedDate}${hotelSuffix}.pdf`;
    const res = saveOrDownloadPdf(doc, fileName);
    setPdfDownloadStatus(res);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* Print-specific style to guarantee pristine paper print without scroll cutoffs */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm;
          }
          html, body {
            height: auto !important;
            overflow: visible !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * {
            visibility: hidden;
          }
          #reception-slip-printable-area, #reception-slip-printable-area * {
            visibility: visible;
          }
          .fixed.inset-0 {
            position: static !important;
            display: block !important;
            padding: 0 !important;
            background: transparent !important;
            backdrop-filter: none !important;
          }
          .max-h-\\[94vh\\] {
            max-height: none !important;
            height: auto !important;
            overflow: visible !important;
            border: none !important;
            box-shadow: none !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
          }
          #reception-slip-printable-area {
            position: static !important;
            display: block !important;
            width: 100% !important;
            max-height: none !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 6px !important;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
          }
          .print-hidden-element {
            display: none !important;
          }
          table {
            width: 100% !important;
            page-break-inside: auto !important;
            border-collapse: collapse !important;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          thead {
            display: table-header-group !important;
          }
        }
      `}} />

      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-6xl w-full p-4 sm:p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[94vh]">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="print-hidden-element absolute top-4 right-4 text-stone-500 hover:text-stone-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition cursor-pointer z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Top Controls Bar (Hidden in Print) */}
        <div className="print-hidden-element flex flex-col gap-3 pb-3 border-b border-stone-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FaizHusainiLogo size="sm" showSubtitle={false} />
                <h3 className="text-base font-bold text-[#124E39]">
                  Daily Reception Slip — Room Turnover & Guest Roster
                </h3>
              </div>
              <p className="text-xs text-stone-600 mt-0.5">
                Room-by-room preparation matrix for housekeeping turnover, checkouts, and incoming zaereen check-in.
              </p>
            </div>

            {/* Print and PDF Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-stone-800 hover:bg-stone-900 text-white shadow-xs transition cursor-pointer"
                title="Print current slip on paper"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Slip</span>
              </button>

              {/* Dedicated Chosen Arrival Date PDF Group (Prompt: "I want the downloaded pdf of the date of arrival I have chosen / pdf should be bifurcated as per hotels. different buildings can be printed seperately and when joined it can be done too") */}
              <div className="flex items-center rounded-xl bg-[#124E39] p-0.5 border border-[#C5A059] shadow-sm">
                <button
                  type="button"
                  onClick={() => handleDownloadArrivalsPdf('ALL')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#EBD59E] hover:bg-[#0E3C2C] transition cursor-pointer"
                  title={`Download official Arrivals Manifest PDF (Joined & Bifurcated with page breaks) for chosen arrival date: ${selectedDate}`}
                >
                  <LogIn className="w-3.5 h-3.5 text-[#EBD59E]" />
                  <span>Arrivals PDF ({selectedDate})</span>
                </button>

                <div className="h-4 w-px bg-[#C5A059]/40 my-auto" />

                <button
                  type="button"
                  onClick={() => handleDownloadArrivalsPdf('Saifee')}
                  className="px-2 py-1.5 text-[11px] font-semibold text-emerald-100 hover:text-white hover:bg-emerald-800/60 rounded-md transition cursor-pointer"
                  title={`Print Saifee Hotel Arrivals Separately for ${selectedDate}`}
                >
                  Saifee ({saifeeArrivals.length})
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadArrivalsPdf('Burhani')}
                  className="px-2 py-1.5 text-[11px] font-semibold text-emerald-100 hover:text-white hover:bg-emerald-800/60 rounded-md transition cursor-pointer"
                  title={`Print Burhani Hotel Arrivals Separately for ${selectedDate}`}
                >
                  Burhani ({burhaniArrivals.length})
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleDownloadPdf(activeHotelFilter)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-xs transition cursor-pointer ${
                  activeTab === 'turnover'
                    ? 'bg-[#124E39] text-white ring-2 ring-[#EBD59E]'
                    : 'bg-emerald-900/80 hover:bg-[#124E39] text-white'
                }`}
                title={`Download Room Turnover Slip PDF (${activeHotelFilter === 'ALL' ? 'Joined Bifurcated' : activeHotelFilter})`}
              >
                <Download className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>Turnover PDF</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadRosterPdf(activeHotelFilter)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-xs transition cursor-pointer ${
                  activeTab === 'roster'
                    ? 'bg-[#124E39] text-white ring-2 ring-[#EBD59E]'
                    : 'bg-emerald-900/80 hover:bg-[#124E39] text-white'
                }`}
                title={`Download Tour ID Roster PDF (${activeHotelFilter === 'ALL' ? 'Joined Bifurcated' : activeHotelFilter})`}
              >
                <Users className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>Roster PDF</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadWorkerPdf(activeHotelFilter)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-xs transition cursor-pointer ${
                  activeTab === 'worker_summary'
                    ? 'bg-amber-800 text-white ring-2 ring-amber-300'
                    : 'bg-amber-700 hover:bg-amber-800 text-white'
                }`}
                title={`Download Worker Operations Summary PDF (${activeHotelFilter === 'ALL' ? 'Joined Bifurcated' : activeHotelFilter})`}
              >
                <HardHat className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>Worker Sheet PDF</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadPortalUploadPdf(activeHotelFilter)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-xs transition cursor-pointer ${
                  activeTab === 'portal_upload'
                    ? 'bg-blue-800 text-white ring-2 ring-blue-300'
                    : 'bg-blue-700 hover:bg-blue-800 text-white'
                }`}
                title={`Download Assistant Portal Allotment Checklist PDF (${activeHotelFilter === 'ALL' ? 'Joined Bifurcated' : activeHotelFilter})`}
              >
                <ClipboardList className="w-3.5 h-3.5 text-blue-200" />
                <span>Portal Upload PDF</span>
              </button>
            </div>
          </div>

          {/* Real-time PDF Generation & Download Status Banner */}
          {pdfDownloadStatus && (
            <div className="bg-emerald-50 border border-emerald-400 rounded-xl p-2.5 sm:p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-emerald-950 shadow-xs animate-in fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <div>
                  <div className="font-bold text-xs">
                    PDF Document Ready: <span className="font-mono text-emerald-900 font-black">{pdfDownloadStatus.fileName}</span>
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    If automatic download was blocked by browser restrictions, click Direct Download or View PDF.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {pdfDownloadStatus.blobUrl && (
                  <a
                    href={pdfDownloadStatus.blobUrl}
                    download={pdfDownloadStatus.fileName}
                    className="px-3 py-1.5 rounded-lg bg-[#124E39] text-[#EBD59E] font-bold text-xs hover:bg-[#0E3C2C] shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Direct Download</span>
                  </a>
                )}
                {pdfDownloadStatus.blobUrl && (
                  <button
                    type="button"
                    onClick={() => setPdfPreviewBlobUrl(pdfDownloadStatus.blobUrl)}
                    className="px-3 py-1.5 rounded-lg bg-white border border-emerald-400 text-emerald-950 font-bold text-xs hover:bg-emerald-100 shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                    <span>View / Print PDF</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPdfDownloadStatus(null)}
                  className="p-1 text-emerald-700 hover:text-emerald-950 rounded cursor-pointer"
                  title="Dismiss notification"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Date Picker & Active Date Chips Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {/* Date navigation */}
              <div className="flex items-center gap-1 bg-white border border-stone-300 rounded-xl px-2 py-1 shadow-2xs text-xs">
                <button
                  type="button"
                  onClick={() => handleNavigateActiveDate('prev')}
                  className="p-1 text-stone-500 hover:text-stone-900 rounded"
                  title="Previous operational date with activity"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <Calendar className="w-4 h-4 text-[#124E39]" />
                <span className="font-semibold text-stone-600">Date:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent font-bold text-stone-900 focus:outline-none cursor-pointer"
                />

                <button
                  type="button"
                  onClick={() => handleNavigateActiveDate('next')}
                  className="p-1 text-stone-500 hover:text-stone-900 rounded"
                  title="Next operational date with activity"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Quick Jump to Active Dates */}
              <div className="flex items-center gap-1 overflow-x-auto max-w-xl py-0.5">
                <span className="text-[11px] font-bold text-stone-500 mr-1 hidden sm:inline">Active Dates:</span>
                {displayDates.map((dateStr) => {
                  const stat = activeDatesSummary.datesMap.get(dateStr);
                  const isSelected = dateStr === selectedDate;
                  const dateLabel = formatSafeDateLabel(dateStr, { day: '2-digit', month: 'short' });

                  return (
                    <button
                      key={dateStr}
                      type="button"
                      onClick={() => setSelectedDate(dateStr)}
                      className={`px-2 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap shadow-2xs flex items-center gap-1 ${
                        isSelected
                          ? 'bg-[#124E39] text-white shadow-xs'
                          : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
                      }`}
                    >
                      <span>{dateLabel}</span>
                      {stat && stat.arrivals > 0 && (
                        <span className={`text-[10px] px-1 rounded ${isSelected ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-100 text-emerald-900'}`}>
                          +{stat.arrivals}
                        </span>
                      )}
                      {stat && stat.departures > 0 && (
                        <span className={`text-[10px] px-1 rounded ${isSelected ? 'bg-amber-800 text-amber-100' : 'bg-amber-100 text-amber-900'}`}>
                          -{stat.departures}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 1-Click Download PDF for chosen arrival date */}
              <div className="flex items-center rounded-xl bg-[#124E39] p-0.5 border border-[#C5A059]/50 shadow-xs">
                <button
                  type="button"
                  onClick={() => handleDownloadArrivalsPdf('ALL')}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-[#EBD59E] hover:bg-[#0E3C2C] transition cursor-pointer whitespace-nowrap"
                  title={`Download PDF with Saifee & Burhani bifurcated on separate pages for ${selectedDate}`}
                >
                  <Download className="w-3.5 h-3.5 text-[#EBD59E]" />
                  <span>Download PDF ({selectedDate})</span>
                </button>
                <div className="h-3.5 w-px bg-[#C5A059]/40 my-auto" />
                <button
                  type="button"
                  onClick={() => handleDownloadArrivalsPdf('Saifee')}
                  className="px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:text-white hover:bg-emerald-800/60 rounded-md transition cursor-pointer"
                  title={`Print Saifee Hotel Arrivals Separately for ${selectedDate}`}
                >
                  Saifee
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadArrivalsPdf('Burhani')}
                  className="px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:text-white hover:bg-emerald-800/60 rounded-md transition cursor-pointer"
                  title={`Print Burhani Hotel Arrivals Separately for ${selectedDate}`}
                >
                  Burhani
                </button>
              </div>
            </div>

            {/* Hotel Filter Tabs */}
            <div className="flex items-center bg-stone-200/70 p-0.5 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveHotelFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  activeHotelFilter === 'ALL'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                All (114)
              </button>
              <button
                type="button"
                onClick={() => setActiveHotelFilter('Saifee')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  activeHotelFilter === 'Saifee'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                Saifee (70)
              </button>
              <button
                type="button"
                onClick={() => setActiveHotelFilter('Burhani')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  activeHotelFilter === 'Burhani'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                Burhani (44)
              </button>
            </div>
          </div>
        </div>

        {/* View Switcher Tabs (Print Prep Schedule vs Standard Roster vs Worker Operations) */}
        <div className="print-hidden-element flex items-center justify-between gap-3 pt-3 flex-wrap">
          <div className="flex items-center gap-1 bg-stone-200/80 p-1 rounded-xl text-xs font-bold flex-wrap">
            <button
              type="button"
              onClick={() => setActiveTab('turnover')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                activeTab === 'turnover'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              <DoorClosed className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>Room-by-Room Turnover Schedule</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('roster')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                activeTab === 'roster'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Arrivals & Departures by Tour ID</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('worker_summary')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                activeTab === 'worker_summary'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              <HardHat className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>Worker Room Operations Sheet (By Office ➔ Tour ➔ Time)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('portal_upload')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                activeTab === 'portal_upload'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5 text-blue-300" />
              <span>Assistant Portal Upload Sheet (Tour IDs & Rooms)</span>
            </button>
          </div>

          {activeTab === 'turnover' && (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyActiveRooms}
                onChange={(e) => setShowOnlyActiveRooms(e.target.checked)}
                className="rounded text-[#124E39] focus:ring-[#124E39]"
              />
              <span>Show only rooms with Turnover / Activity Today ({filteredRoomPrep.length})</span>
            </label>
          )}

          {activeTab === 'roster' && (
            <div className="flex items-center bg-stone-200/80 p-0.5 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setRosterGroupByTour(true)}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  rosterGroupByTour
                    ? 'bg-[#124E39] text-white shadow-xs'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Group by Tour ID & Time (Req 2)</span>
              </button>
              <button
                type="button"
                onClick={() => setRosterGroupByTour(false)}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  !rosterGroupByTour
                    ? 'bg-[#124E39] text-white shadow-xs'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                <DoorClosed className="w-3.5 h-3.5" />
                <span>Sorted as Per Rooms (Arrival Slip)</span>
              </button>
            </div>
          )}

          {activeTab === 'worker_summary' && (
            <div className="flex items-center gap-2 text-xs font-bold text-stone-700">
              <span className="bg-amber-100 text-amber-950 border border-amber-300 px-2.5 py-1 rounded-lg">
                Base Room # • Timing Sequence • Grouped by Office & Tour (Req 3)
              </span>
            </div>
          )}

          {activeTab === 'portal_upload' && (
            <div className="flex items-center gap-2 text-xs font-bold">
              <span className="bg-blue-100 text-blue-950 border border-blue-300 px-2.5 py-1 rounded-lg">
                For Assistant Portal Upload (Req 4)
              </span>
            </div>
          )}
        </div>

        {/* Printable Paper Slip View Container */}
        <div
          id="reception-slip-printable-area"
          className="flex-1 overflow-y-auto mt-4 p-4 sm:p-6 bg-white border border-[#E6DFD5] rounded-xl shadow-xs space-y-6"
        >
          {/* Slip Official Header */}
          <div className="text-center pb-4 border-b-2 border-[#124E39]">
            <div className="flex items-center justify-center gap-3 mb-1">
              <FaizHusainiLogo size="lg" />
            </div>
            <div className="inline-block bg-[#124E39] text-[#EBD59E] font-bold text-xs uppercase px-3 py-1 rounded-md tracking-wider mt-1">
              {activeTab === 'turnover'
                ? 'Room Turnover & Preparation Daily Reception Slip'
                : activeTab === 'roster'
                ? 'Daily Tour Roster — Arrivals & Departures (Grouped by Tour ID & Time)'
                : activeTab === 'worker_summary'
                ? 'Worker Room Operations & Timing Sheet (Base Room # ➔ Time ➔ Office & Tour ID)'
                : 'Assistant Portal Upload Verification Sheet (Tour IDs & Rooms)'}
            </div>
            <div className="mt-2 text-xs font-semibold text-stone-700">
              Operational Date: <span className="text-[#124E39] font-bold underline">{formatSafeDateLabel(selectedDate, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span> • Najaf Al-Ashraf Lodging
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">Priority Room Turnovers</span>
              <span className="text-base font-extrabold text-purple-900">{activeTurnoversCount} Rooms</span>
              <span className="text-[10px] text-stone-500 block">Departing ➔ Arriving same day</span>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-col justify-between">
              <div>
                <span className="text-stone-500 text-[10px] uppercase font-bold block">New Arrivals Today</span>
                <span className="text-base font-extrabold text-emerald-800">{newArrivalsPrepCount} Rooms ({arrivalsOnDate.length} Zaereen)</span>
                <span className="text-[10px] text-stone-500 block">Fresh check-ins to welcome</span>
              </div>
              <button
                type="button"
                onClick={handleDownloadArrivalsPdf}
                className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-[#124E39] hover:text-[#0E3C2C] bg-white px-2 py-0.5 rounded border border-emerald-300 shadow-2xs w-fit cursor-pointer"
                title={`Download official PDF of arrivals for ${selectedDate}`}
              >
                <Download className="w-3 h-3 text-[#124E39]" />
                <span>Arrivals PDF</span>
              </button>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">Checkouts / Freeing Up</span>
              <span className="text-base font-extrabold text-amber-800">{checkoutCleansCount} Rooms ({departuresOnDate.length} Zaereen)</span>
              <span className="text-[10px] text-stone-500 block">Vacating to clean inventory</span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FAF7F2] border border-[#E6DFD5]">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">Total Hotel Inventory</span>
              <span className="text-base font-extrabold text-[#124E39]">114 Official Rooms</span>
              <span className="text-[10px] text-stone-500 block">Saifee (70) • Burhani (44)</span>
            </div>
          </div>

          {/* Unallotted Zaereen Alert if any arrive today without a room */}
          {unallottedArrivals.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-col gap-2">
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-700" />
                <span>Notice: {unallottedArrivals.length} Zaereen arriving on {selectedDate} have no Room Number assigned yet!</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {unallottedArrivals.map((z) => (
                  <span key={z.id} className="px-2 py-0.5 rounded bg-white border border-amber-300 text-amber-900 font-medium text-[11px]">
                    {z.applicantName} ({z.family || 'Fam'} • Tour: {z.tourRefNo})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 1: ROOM-BY-ROOM TURNOVER & PREPARATION MATRIX (REQUESTED) */}
          {/* ============================================================ */}
          {activeTab === 'turnover' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#124E39]/30 pb-2">
                <div className="flex items-center gap-2 text-sm font-bold text-[#124E39]">
                  <DoorClosed className="w-4 h-4 text-[#124E39]" />
                  <span>Room Turnover & Preparation Schedule (Housekeeping & Reception Handover)</span>
                </div>
                <span className="text-xs text-stone-500 font-semibold">
                  Showing {filteredRoomPrep.length} Rooms
                </span>
              </div>

              <div className="overflow-x-auto border border-stone-300 rounded-xl shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                      <th className="py-3 px-3 w-[22%]">Room & Hotel (Pax & Family)</th>
                      <th className="py-3 px-3 w-[29%] bg-[#124E39]/95">Departures (Vacating & Times)</th>
                      <th className="py-3 px-3 w-[29%] bg-[#124E39]/95">Arrivals (New Zaereen & Times)</th>
                      <th className="py-3 px-3 w-[20%]">Turnover Status & Housekeeping Sign-off</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {filteredRoomPrep.length > 0 ? (
                      filteredRoomPrep.map((item, idx) => {
                        const isTurnover = item.actionType === 'turnover';

                        // Active Zaereen in this specific room
                        const activeResInRoom = item.arrs.length > 0 ? item.arrs : (item.inHouse.length > 0 ? item.inHouse : item.deps);
                        const totalPaxInRoom = activeResInRoom.length;

                        // Calculate count of pax per family in this specific room
                        const famPaxMap = new Map<string, number>();
                        activeResInRoom.forEach((r) => {
                          const fam = (r.family || 'Unassigned').trim();
                          famPaxMap.set(fam, (famPaxMap.get(fam) || 0) + 1);
                        });
                        const famPaxList = Array.from(famPaxMap.entries()).map(([family, count]) => ({ family, count }));

                        // Tour reference
                        const tourRefText = item.arrs[0]?.tourRefNo || item.deps[0]?.tourRefNo || item.inHouse[0]?.tourRefNo || '—';

                        // Unique departure and arrival operational times
                        const depTimes = item.deps.map(d => getReservationDepartureTime(d, '01:00 AM')).filter(Boolean);
                        const arrTimes = item.arrs.map(a => getReservationArrivalTime(a, '11:00 AM')).filter(Boolean);
                        const depTimeDisplay = depTimes.length > 0 ? Array.from(new Set(depTimes)).join(', ') : '';
                        const arrTimeDisplay = arrTimes.length > 0 ? Array.from(new Set(arrTimes)).join(', ') : '';

                        return (
                          <tr
                            key={idx}
                            className={`transition ${
                              isTurnover
                                ? 'bg-purple-50/40 font-medium'
                                : item.actionType === 'new_arrival'
                                ? 'bg-emerald-50/30'
                                : item.actionType === 'departure_clean'
                                ? 'bg-amber-50/30'
                                : 'hover:bg-stone-50'
                            }`}
                          >
                            {/* 1. Room & Hotel (with Count of Pax & Family Number) */}
                            <td className="py-3 px-3 align-top">
                              <div className="bg-[#124E39]/10 border-2 border-[#124E39]/30 rounded-xl p-2 text-center shadow-xs">
                                <div className="text-[10px] uppercase font-bold tracking-wider text-stone-600">Room</div>
                                <div className="font-mono font-black text-3xl sm:text-4xl text-[#124E39] leading-tight tracking-tight my-0.5">
                                  {item.room.roomNumber}
                                </div>
                                <div className="text-xs font-black text-stone-900">
                                  {item.room.building} Hotel
                                </div>
                                <div className="text-[10px] text-stone-600 font-semibold">
                                  {item.room.floorLabel || `Floor ${item.room.floor}`}
                                </div>
                              </div>

                              {/* Specific Room Pax Count and Family Number Details */}
                              <div className="mt-2 p-2 rounded-xl bg-white border border-stone-300 text-stone-900 shadow-2xs space-y-1.5">
                                <div className="flex items-center justify-between pb-1 border-b border-stone-200">
                                  <span className="text-[11px] font-bold text-stone-700 flex items-center gap-1">
                                    <Users className="w-3.5 h-3.5 text-[#124E39]" />
                                    <span>Room Pax:</span>
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full bg-[#124E39] text-[#EBD59E] font-black font-mono text-[11px]">
                                    {totalPaxInRoom > 0 ? `${totalPaxInRoom} Pax in Room` : '0 Pax (Vacant)'}
                                  </span>
                                </div>

                                {/* Family number along with pax in this specific room */}
                                {famPaxList.length > 0 ? (
                                  <div className="space-y-1">
                                    {famPaxList.map((f, fIdx) => (
                                      <div key={fIdx} className="flex items-center justify-between text-xs bg-stone-50 px-1.5 py-0.5 rounded border border-stone-200">
                                        <span className="font-mono font-black text-stone-950">
                                          Family #{f.family}
                                        </span>
                                        <span className="font-extrabold text-[#124E39] text-[10px] bg-white px-1.5 py-0.5 rounded border border-[#124E39]/20">
                                          {f.count} Pax in Room
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-stone-400 italic">No family assigned</div>
                                )}

                                {/* Tour Reference */}
                                <div className="text-[10px] text-stone-700 flex items-center justify-between pt-1 border-t border-stone-200">
                                  <span className="font-semibold text-stone-500">Tour Ref:</span>
                                  <span className="font-mono font-bold text-stone-900 truncate max-w-[110px]" title={tourRefText}>
                                    {tourRefText}
                                  </span>
                                </div>

                                {/* Operational Times summary */}
                                {(depTimeDisplay || arrTimeDisplay) && (
                                  <div className="pt-1 border-t border-stone-200 text-[10px] space-y-0.5">
                                    {depTimeDisplay && (
                                      <div className="flex items-center justify-between text-amber-900 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                        <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-700 shrink-0" /> Dep:</span>
                                        <span className="font-mono">{depTimeDisplay}</span>
                                      </div>
                                    )}
                                    {arrTimeDisplay && (
                                      <div className="flex items-center justify-between text-emerald-950 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                        <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-emerald-700 shrink-0" /> Arr:</span>
                                        <span className="font-mono">{arrTimeDisplay}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* 2. Departures (Vacating Today & Departure Time) */}
                            <td className="py-3 px-3 align-top border-l border-stone-200">
                              {item.deps.length > 0 ? (
                                <div className="space-y-2">
                                  {item.deps.map((d, dIdx) => {
                                    const famPaxInRoom = item.deps.filter(x => (x.family || '').trim() === (d.family || '').trim()).length;
                                    const depTime = getReservationDepartureTime(d, '01:00 AM');
                                    return (
                                      <div key={dIdx} className="p-2.5 rounded-xl bg-stone-50 border border-stone-300 text-stone-900 shadow-2xs space-y-1.5">
                                        <div className="font-bold text-xs text-stone-900 flex items-center justify-between">
                                          <span className="font-black text-stone-950">{d.applicantName}</span>
                                          <span className="font-mono font-black text-stone-900 bg-stone-200 px-2 py-0.5 rounded text-[11px] border border-stone-300">
                                            Family #{d.family || '—'} ({famPaxInRoom} Pax in Room)
                                          </span>
                                        </div>

                                        {/* Prominent Departure Time Badge */}
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="inline-flex items-center gap-1.5 text-xs font-black text-amber-950 bg-amber-100/90 border border-amber-300 px-2 py-0.5 rounded-lg shadow-2xs">
                                            <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                            <span>Departure Time: {depTime}</span>
                                          </div>
                                          <span className="font-mono text-[11px] text-stone-700">ITS: {d.itsId}</span>
                                        </div>

                                        <div className="text-[11px] text-stone-800 flex flex-wrap items-center gap-2 pt-0.5">
                                          <span className="font-bold text-stone-900 bg-stone-200 px-1.5 py-0.5 rounded text-[10px]">
                                            Tour: {d.tourRefNo || '—'}
                                          </span>
                                          <span className="text-[10px] text-stone-600 truncate">{d.officeName}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : item.inHouse.length > 0 && item.arrs.length === 0 ? (
                                <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200 text-blue-950 text-xs space-y-1.5 shadow-2xs">
                                  <div className="font-bold flex items-center justify-between text-[11px] text-blue-900">
                                    <span className="flex items-center gap-1">
                                      <Users className="w-3.5 h-3.5 text-blue-700" />
                                      <span>Continuing In-House Stay</span>
                                    </span>
                                    <span className="text-[10px] bg-blue-100 text-blue-900 px-1.5 py-0.2 rounded font-semibold border border-blue-200">
                                      No Departure Today
                                    </span>
                                  </div>
                                  {item.inHouse.map((ih, ihIdx) => {
                                    const depTime = getReservationDepartureTime(ih, '12:00 PM');
                                    return (
                                      <div key={ihIdx} className="text-[10px] text-stone-800 bg-white p-1.5 rounded-lg border border-blue-100 flex items-center justify-between gap-2">
                                        <span className="font-semibold truncate">{ih.applicantName}</span>
                                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-amber-900 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 shrink-0">
                                          <Clock className="w-2.5 h-2.5 text-amber-700" />
                                          Dep: {ih.departureDate || '—'} ({depTime})
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-stone-400 italic text-[11px]">
                                  No departures today
                                </span>
                              )}
                            </td>

                            {/* 3. Arrivals (New Zaereen & Arrival Time) */}
                            <td className="py-3 px-3 align-top border-l border-stone-200">
                              {item.arrs.length > 0 ? (
                                <div className="space-y-2">
                                  {item.arrs.map((a, aIdx) => {
                                    const famPaxInRoom = item.arrs.filter(x => (x.family || '').trim() === (a.family || '').trim()).length;
                                    const arrTime = getReservationArrivalTime(a, '11:00 AM');
                                    return (
                                      <div key={aIdx} className="p-2.5 rounded-xl bg-stone-50 border border-stone-300 text-stone-900 shadow-2xs space-y-1.5">
                                        <div className="font-bold text-xs text-stone-900 flex items-center justify-between">
                                          <span className="font-black text-stone-950">{a.applicantName}</span>
                                          <span className="font-mono font-black text-stone-900 bg-stone-200 px-2 py-0.5 rounded text-[11px] border border-stone-300">
                                            Family #{a.family || '—'} ({famPaxInRoom} Pax in Room)
                                          </span>
                                        </div>

                                        {/* Prominent Arrival Time Badge */}
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-950 bg-emerald-100/90 border border-emerald-300 px-2 py-0.5 rounded-lg shadow-2xs">
                                            <Clock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                            <span>Arrival Time: {arrTime}</span>
                                          </div>
                                          <span className="font-mono text-[11px] text-stone-700">ITS: {a.itsId}</span>
                                        </div>

                                        <div className="text-[11px] text-stone-800 flex flex-wrap items-center gap-2 pt-0.5">
                                          <span className="font-bold text-stone-900 bg-stone-200 px-1.5 py-0.5 rounded text-[10px]">
                                            Tour: {a.tourRefNo || '—'}
                                          </span>
                                          <span className="font-bold text-[#124E39] text-[10px] bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded">
                                            {a.category}
                                          </span>
                                          <span className="text-[10px] text-stone-600 truncate">{a.officeName}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : item.inHouse.length > 0 && item.deps.length === 0 ? (
                                <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200 text-blue-950 text-xs space-y-1.5 shadow-2xs">
                                  <div className="font-bold flex items-center justify-between text-[11px] text-blue-900">
                                    <span className="flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-700" />
                                      <span>Occupied by In-House Guests</span>
                                    </span>
                                    <span className="text-[10px] bg-blue-100 text-blue-900 px-1.5 py-0.2 rounded font-semibold border border-blue-200">
                                      Stay Active
                                    </span>
                                  </div>
                                  {item.inHouse.map((ih, ihIdx) => {
                                    const arrTime = getReservationArrivalTime(ih, '11:00 AM');
                                    return (
                                      <div key={ihIdx} className="text-[10px] text-stone-800 bg-white p-1.5 rounded-lg border border-blue-100 flex items-center justify-between gap-2">
                                        <span className="font-semibold truncate">{ih.applicantName}</span>
                                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-900 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0">
                                          <Clock className="w-2.5 h-2.5 text-emerald-700" />
                                          Arr was: {ih.arrivalDate || '—'} ({arrTime})
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-stone-400 italic text-[11px]">
                                  No new arrival today
                                </span>
                              )}
                            </td>

                            {/* 4. Turnover Status & Housekeeping Sign-off */}
                            <td className="py-3 px-3 align-top border-l border-stone-200">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] border mb-2 font-bold ${item.actionBadge}`}>
                                {item.actionLabel}
                              </span>

                              {/* Housekeeping Checkboxes for printed slip */}
                              <div className="space-y-1 text-[10px] text-stone-900 font-medium">
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-block w-3.5 h-3.5 border border-stone-600 rounded-2xs bg-white shrink-0" />
                                  <span>Linen & Bed Fresh</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-block w-3.5 h-3.5 border border-stone-600 rounded-2xs bg-white shrink-0" />
                                  <span>Toilet Clean & Sanitized</span>
                                </div>
                                <div className="flex items-center gap-1.5 font-bold text-stone-950">
                                  <span className="inline-block w-3.5 h-3.5 border-2 border-stone-800 rounded-2xs bg-white shrink-0" />
                                  <span>Wajba/cards ready</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-block w-3.5 h-3.5 border border-stone-600 rounded-2xs bg-white shrink-0" />
                                  <span>Key Cards Ready</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-10 text-center">
                          <div className="text-stone-500 font-semibold text-xs">
                            No room preparation or turnover activity scheduled for {selectedDate}.
                          </div>
                          {activeDatesSummary.sortedDates.length > 0 && (
                            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                              <span className="text-stone-400 text-xs">Jump to date with Zaereen:</span>
                              {activeDatesSummary.sortedDates.slice(0, 4).map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setSelectedDate(d)}
                                  className="px-2.5 py-1 rounded bg-[#124E39] text-[#EBD59E] font-bold text-xs shadow-2xs hover:bg-[#0E3C2C]"
                                >
                                  {d}
                                </button>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowOnlyActiveRooms(false)}
                            className="mt-3 text-xs text-[#124E39] font-bold underline hover:text-stone-900"
                          >
                            View All 114 Hotel Rooms
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: ARRIVALS & DEPARTURES (GROUPED BY TOUR ID & TIME)       */}
          {/* ============================================================ */}
          {(() => {
            const renderArrivalsTable = (
              groups: typeof saifeeArrivalsGroupedByTour,
              flatList: Reservation[],
              hotelName: string
            ) => {
              if (rosterGroupByTour) {
                if (groups.length === 0) {
                  return (
                    <div className="py-4 text-center text-stone-400 italic bg-stone-50 rounded-lg border border-stone-200 text-xs">
                      No arrivals scheduled for {hotelName} Hotel on {selectedDate}
                    </div>
                  );
                }
                return (
                  <div className="space-y-3">
                    {groups.map((tourGroup) => (
                      <div key={tourGroup.tourRefNo} className="border border-emerald-300 rounded-xl overflow-hidden bg-white shadow-2xs">
                        <div className="bg-emerald-800 text-white px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-xs text-[#EBD59E] bg-emerald-950 px-2 py-0.5 rounded">
                              Tour ID: {tourGroup.tourRefNo}
                            </span>
                            <span className="text-xs text-emerald-100 font-semibold">• Office: {tourGroup.officeName}</span>
                            <span className="text-[11px] font-bold text-emerald-950 bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1">
                              <Clock className="w-3 h-3 text-emerald-800" />
                              Arrival: {tourGroup.earliestTime}{tourGroup.latestTime !== tourGroup.earliestTime ? ` to ${tourGroup.latestTime}` : ''}
                            </span>
                          </div>
                          <div className="text-xs font-bold text-emerald-200">
                            {tourGroup.reservations.length} Zaereen • {tourGroup.uniqueFamiliesCount} Families
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold">
                              <tr>
                                <th className="py-2.5 px-3">Room #</th>
                                <th className="py-2.5 px-3">Family # & Room Pax</th>
                                <th className="py-2.5 px-3">Applicant / Guest</th>
                                <th className="py-2.5 px-3">ITS ID</th>
                                <th className="py-2.5 px-3">Arrival Time</th>
                                <th className="py-2.5 px-3">Dep Date & Time</th>
                                <th className="py-2.5 px-3">Tour Ref</th>
                                <th className="py-2.5 px-3">Office</th>
                                <th className="py-2.5 px-3">Category</th>
                                <th className="py-2.5 px-3">Money Given (B➔A)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-200">
                              {tourGroup.reservations.map((r, i) => {
                                const paxInfo = getRoomPaxInfo(r);
                                const arrTime = getReservationArrivalTime(r, '11:00 AM');
                                const depTime = getReservationDepartureTime(r, '01:00 AM');
                                return (
                                  <tr key={i} className="hover:bg-stone-50">
                                    <td className="py-2.5 px-3 font-mono font-black text-sm text-[#124E39]">
                                      {r.roomNumber ? `Room ${r.roomNumber}` : <span className="text-amber-800 font-extrabold text-xs">Unallotted</span>}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-mono font-bold text-stone-950">Family #{r.family}</div>
                                      <div className="text-[10px] font-extrabold text-emerald-950 bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5 inline-block mt-0.5">
                                        {paxInfo.famPaxInRoom} Pax in Room
                                      </div>
                                    </td>
                                    <td className="py-2 px-3 font-bold text-stone-900">{r.applicantName}</td>
                                    <td className="py-2 px-3 font-mono text-stone-800">{r.itsId}</td>
                                    <td className="py-2.5 px-3 font-mono font-bold text-emerald-950">
                                      <span className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded text-[11px]">
                                        <Clock className="w-3 h-3 text-emerald-700 shrink-0" />
                                        {arrTime}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-semibold text-stone-800">{r.departureDate || '—'}</div>
                                      <div className="mt-0.5">
                                        <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded text-[10px] text-amber-950 font-bold">
                                          <Clock className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                                          {depTime}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.tourRefNo}</td>
                                    <td className="py-2 px-3 text-stone-700">{r.officeName}</td>
                                    <td className="py-2 px-3 text-stone-800 font-semibold">{r.category}</td>
                                    <td className="py-2 px-3">
                                      {r.category === 'B to A' || r.shiftToCategoryA ? (
                                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.moneyGiven === 'Yes' ? 'bg-emerald-100 text-emerald-950 border border-emerald-300' : 'bg-rose-100 text-rose-950 border border-rose-300'}`}>
                                          {r.moneyGiven === 'Yes' ? 'Paid ✓' : 'Pending ✗'}
                                        </span>
                                      ) : (
                                        <span className="text-stone-400">—</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }

              const sortedArrivalsList = [...flatList].sort((a, b) => {
                const hasA = !!a.roomNumber && a.roomNumber.trim() !== '';
                const hasB = !!b.roomNumber && b.roomNumber.trim() !== '';
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;
                const numA = parseInt(a.roomNumber || '', 10) || 9999;
                const numB = parseInt(b.roomNumber || '', 10) || 9999;
                if (numA !== numB) return numA - numB;
                const famA = (a.family || '').localeCompare(b.family || '', undefined, { numeric: true });
                if (famA !== 0) return famA;
                return (a.applicantName || '').localeCompare(b.applicantName || '');
              });

              return (
                <div className="overflow-x-auto border border-stone-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold">
                      <tr>
                        <th className="py-2.5 px-3">Room # & Hotel (Base)</th>
                        <th className="py-2.5 px-3">Family # & Room Pax</th>
                        <th className="py-2.5 px-3">Applicant / Guest</th>
                        <th className="py-2.5 px-3">ITS ID</th>
                        <th className="py-2.5 px-3">Arrival Time</th>
                        <th className="py-2.5 px-3">Dep Date & Time</th>
                        <th className="py-2.5 px-3">Tour Ref</th>
                        <th className="py-2.5 px-3">Office</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Money Given (B➔A)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {sortedArrivalsList.length > 0 ? (
                        sortedArrivalsList.map((r, i) => {
                          const paxInfo = getRoomPaxInfo(r);
                          const arrTime = getReservationArrivalTime(r, '11:00 AM');
                          const depTime = getReservationDepartureTime(r, '01:00 AM');
                          return (
                            <tr key={i} className="hover:bg-stone-50">
                              <td className="py-2.5 px-3 font-mono font-black text-sm text-[#124E39]">
                                {r.roomNumber ? `Room ${r.roomNumber} (${r.building || ''})` : <span className="text-amber-800 font-extrabold text-xs">Unallotted</span>}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-mono font-bold text-stone-950">Family #{r.family}</div>
                                <div className="text-[10px] font-extrabold text-emerald-950 bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5 inline-block mt-0.5">
                                  {paxInfo.famPaxInRoom} Pax in Room
                                </div>
                              </td>
                              <td className="py-2 px-3 font-bold text-stone-900">{r.applicantName}</td>
                              <td className="py-2 px-3 font-mono text-stone-800">{r.itsId}</td>
                              <td className="py-2.5 px-3 font-mono font-bold text-emerald-950">
                                <span className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded text-[11px]">
                                  <Clock className="w-3 h-3 text-emerald-700 shrink-0" />
                                  {arrTime}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-stone-800">{r.departureDate || '—'}</div>
                                <div className="mt-0.5">
                                  <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded text-[10px] text-amber-950 font-bold">
                                    <Clock className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                                    {depTime}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.tourRefNo}</td>
                              <td className="py-2 px-3 text-stone-700">{r.officeName}</td>
                              <td className="py-2 px-3 text-stone-800 font-semibold">{r.category}</td>
                              <td className="py-2 px-3">
                                {r.category === 'B to A' || r.shiftToCategoryA ? (
                                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.moneyGiven === 'Yes' ? 'bg-emerald-100 text-emerald-950 border border-emerald-300' : 'bg-rose-100 text-rose-950 border border-rose-300'}`}>
                                    {r.moneyGiven === 'Yes' ? 'Paid ✓' : 'Pending ✗'}
                                  </span>
                                ) : (
                                  <span className="text-stone-400">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={10} className="py-3 text-center text-stone-400 italic">
                            No arrivals scheduled for {hotelName} Hotel on {selectedDate}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            };

            const renderDeparturesTable = (
              groups: typeof saifeeDeparturesGroupedByTour,
              flatList: Reservation[],
              hotelName: string
            ) => {
              if (rosterGroupByTour) {
                if (groups.length === 0) {
                  return (
                    <div className="py-4 text-center text-stone-400 italic bg-stone-50 rounded-lg border border-stone-200 text-xs">
                      No departures scheduled for {hotelName} Hotel on {selectedDate}
                    </div>
                  );
                }
                return (
                  <div className="space-y-3">
                    {groups.map((tourGroup) => (
                      <div key={tourGroup.tourRefNo} className="border border-stone-300 rounded-xl overflow-hidden bg-white shadow-2xs">
                        <div className="bg-stone-800 text-white px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-xs text-[#EBD59E] bg-stone-900 px-2 py-0.5 rounded">
                              Tour ID: {tourGroup.tourRefNo}
                            </span>
                            <span className="text-xs text-stone-200 font-semibold">• Office: {tourGroup.officeName}</span>
                            <span className="text-[11px] font-bold text-amber-950 bg-amber-100 px-2 py-0.5 rounded flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-800" />
                              Departure: {tourGroup.earliestTime}{tourGroup.latestTime !== tourGroup.earliestTime ? ` to ${tourGroup.latestTime}` : ''}
                            </span>
                          </div>
                          <div className="text-xs font-bold text-stone-300">
                            {tourGroup.reservations.length} Zaereen • {tourGroup.uniqueFamiliesCount} Families
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-stone-800 text-white uppercase text-[10px] font-bold">
                              <tr>
                                <th className="py-2 px-3">Room #</th>
                                <th className="py-2 px-3">Family # & Room Pax</th>
                                <th className="py-2 px-3">Applicant / Guest</th>
                                <th className="py-2 px-3">ITS ID</th>
                                <th className="py-2 px-3">Departure Time</th>
                                <th className="py-2 px-3">Arrival Date & Time</th>
                                <th className="py-2 px-3">Tour Ref</th>
                                <th className="py-2 px-3">Office</th>
                                <th className="py-2 px-3">Check-out Notes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-200">
                              {tourGroup.reservations.map((r, i) => {
                                const paxInfo = getRoomPaxInfo(r);
                                const depTime = getReservationDepartureTime(r, '12:00 PM');
                                const arrTime = getReservationArrivalTime(r, '11:00 AM');
                                return (
                                  <tr key={i} className="hover:bg-stone-50">
                                    <td className="py-2.5 px-3 font-mono font-black text-sm text-stone-900">
                                      {r.roomNumber ? `Room ${r.roomNumber}` : '—'}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-mono font-bold text-stone-900">Family #{r.family}</div>
                                      <div className="text-[10px] font-extrabold text-amber-950 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 inline-block mt-0.5">
                                        {paxInfo.famPaxInRoom} Pax in Room
                                      </div>
                                    </td>
                                    <td className="py-2 px-3 font-bold text-stone-900">{r.applicantName}</td>
                                    <td className="py-2 px-3 font-mono text-stone-800">{r.itsId}</td>
                                    <td className="py-2.5 px-3 font-mono font-bold text-amber-950">
                                      <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded text-[11px]">
                                        <Clock className="w-3 h-3 text-amber-700 shrink-0" />
                                        {depTime}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-semibold text-stone-800">{r.arrivalDate || '—'}</div>
                                      <div className="mt-0.5">
                                        <span className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-300 px-1.5 py-0.5 rounded text-[10px] text-emerald-950 font-bold">
                                          <Clock className="w-2.5 h-2.5 text-emerald-700 shrink-0" />
                                          {arrTime}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.tourRefNo}</td>
                                    <td className="py-2 px-3 text-stone-700">{r.officeName}</td>
                                    <td className="py-2 px-3 text-stone-800 font-medium">Clear keys & prepare for cleaning</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }

              const sortedDeparturesList = [...flatList].sort((a, b) => {
                const hasA = !!a.roomNumber && a.roomNumber.trim() !== '';
                const hasB = !!b.roomNumber && b.roomNumber.trim() !== '';
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;
                const numA = parseInt(a.roomNumber || '', 10) || 9999;
                const numB = parseInt(b.roomNumber || '', 10) || 9999;
                if (numA !== numB) return numA - numB;
                const famA = (a.family || '').localeCompare(b.family || '', undefined, { numeric: true });
                if (famA !== 0) return famA;
                return (a.applicantName || '').localeCompare(b.applicantName || '');
              });

              return (
                <div className="overflow-x-auto border border-stone-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-800 text-white uppercase text-[10px] font-bold">
                      <tr>
                        <th className="py-2.5 px-3">Room #</th>
                        <th className="py-2.5 px-3">Family # & Room Pax</th>
                        <th className="py-2.5 px-3">Applicant / Guest</th>
                        <th className="py-2.5 px-3">ITS ID</th>
                        <th className="py-2.5 px-3">Departure Time</th>
                        <th className="py-2.5 px-3">Arrival Date & Time</th>
                        <th className="py-2.5 px-3">Tour Ref</th>
                        <th className="py-2.5 px-3">Office</th>
                        <th className="py-2.5 px-3">Check-out Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {sortedDeparturesList.length > 0 ? (
                        sortedDeparturesList.map((r, i) => {
                          const paxInfo = getRoomPaxInfo(r);
                          const depTime = getReservationDepartureTime(r, '12:00 PM');
                          const arrTime = getReservationArrivalTime(r, '11:00 AM');
                          return (
                            <tr key={i} className="hover:bg-stone-50">
                              <td className="py-2.5 px-3 font-mono font-black text-sm text-stone-900">
                                {r.roomNumber ? `Room ${r.roomNumber}` : '—'}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-mono font-bold text-stone-900">Family #{r.family}</div>
                                <div className="text-[10px] font-extrabold text-amber-950 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 inline-block mt-0.5">
                                  {paxInfo.famPaxInRoom} Pax in Room
                                </div>
                              </td>
                              <td className="py-2 px-3 font-bold text-stone-900">{r.applicantName}</td>
                              <td className="py-2 px-3 font-mono text-stone-800">{r.itsId}</td>
                              <td className="py-2.5 px-3 font-mono font-bold text-amber-950">
                                <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded text-[11px]">
                                  <Clock className="w-3 h-3 text-amber-700 shrink-0" />
                                  {depTime}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-stone-800">{r.arrivalDate || '—'}</div>
                                <div className="mt-0.5">
                                  <span className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-300 px-1.5 py-0.5 rounded text-[10px] text-emerald-950 font-bold">
                                    <Clock className="w-2.5 h-2.5 text-emerald-700 shrink-0" />
                                    {arrTime}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.tourRefNo}</td>
                              <td className="py-2 px-3 text-stone-700">{r.officeName}</td>
                              <td className="py-2 px-3 text-stone-800 font-medium">Clear keys & prepare for cleaning</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={9} className="py-3 text-center text-stone-400 italic">
                            No departures scheduled for {hotelName} Hotel on {selectedDate}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            };

            return (
              <>
                {activeTab === 'roster' && (
                  <div className="space-y-6">
                    {/* Tab 2 Header Banner & Quick PDF Download */}
                    <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-950 shadow-2xs">
                      <div>
                        <div className="flex items-center gap-2 font-bold text-sm text-[#124E39]">
                          <Users className="w-4 h-4 text-[#124E39]" />
                          <span>Tour ID Grouped Roster — Arrivals & Departures Chronologically Sorted</span>
                        </div>
                        <p className="text-xs text-stone-600 mt-0.5">
                          Both arrivals and departures grouped strictly by Tour Reference No. and sequenced chronologically by time.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={handleDownloadRosterPdf}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-[#EBD59E]" />
                          <span>Download Tour Roster (PDF)</span>
                        </button>
                      </div>
                    </div>

                    {/* Unified View for ALL Hotels & Unallotted */}
                    {activeHotelFilter === 'ALL' && (
                      <div className="space-y-5">
                        {/* All Arrivals */}
                        <div className="space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-emerald-900 text-white px-3.5 py-2 rounded-xl shadow-xs">
                            <div className="flex items-center gap-2 font-bold text-sm">
                              <LogIn className="w-4 h-4 text-emerald-300" />
                              <span>ALL SCHEDULED ARRIVALS ({arrivalsOnDate.length} Zaereen • {allArrivalsGroupedByTour.length} Tours)</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="flex items-center rounded-lg bg-emerald-800 p-0.5 border border-emerald-700">
                                <button
                                  type="button"
                                  onClick={() => handleDownloadArrivalsPdf('ALL')}
                                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-[#EBD59E] hover:bg-[#dfc488] text-[#124E39] shadow-2xs transition cursor-pointer"
                                  title={`Download PDF with Saifee and Burhani bifurcated on separate pages for ${selectedDate}`}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Download Joined PDF (Both Hotels)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadArrivalsPdf('Saifee')}
                                  className="px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700 rounded transition cursor-pointer"
                                  title="Print Saifee Hotel Arrivals Separately"
                                >
                                  Saifee ({saifeeArrivals.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadArrivalsPdf('Burhani')}
                                  className="px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700 rounded transition cursor-pointer"
                                  title="Print Burhani Hotel Arrivals Separately"
                                >
                                  Burhani ({burhaniArrivals.length})
                                </button>
                              </div>
                              <span className="text-xs text-emerald-200 font-medium">
                                Sorted by Arrival Time
                              </span>
                            </div>
                          </div>
                          {renderArrivalsTable(allArrivalsGroupedByTour, arrivalsOnDate, 'All Hotels')}
                        </div>

                        {/* All Departures */}
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center justify-between bg-stone-800 text-white px-3.5 py-2 rounded-xl shadow-xs">
                            <div className="flex items-center gap-2 font-bold text-sm">
                              <LogOut className="w-4 h-4 text-amber-300" />
                              <span>ALL SCHEDULED DEPARTURES ({departuresOnDate.length} Zaereen • {allDeparturesGroupedByTour.length} Tours)</span>
                            </div>
                            <span className="text-xs text-stone-300 font-medium">
                              Date: {selectedDate} • Sorted by Departure Time
                            </span>
                          </div>
                          {renderDeparturesTable(allDeparturesGroupedByTour, departuresOnDate, 'All Hotels')}
                        </div>
                      </div>
                    )}

                    {/* Saifee Hotel Section */}
                    {activeHotelFilter === 'Saifee' && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#124E39]/10 border border-[#124E39]/30 px-3 py-2 rounded-lg">
                          <div className="flex items-center gap-2 font-bold text-sm text-[#124E39]">
                            <Building2 className="w-4 h-4 text-[#124E39]" />
                            <span>SAIFEE HOTEL — DAILY ROSTER ({selectedDate})</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleDownloadArrivalsPdf('Saifee')}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-2xs transition cursor-pointer"
                              title={`Download separate PDF for Saifee Hotel Arrivals on ${selectedDate}`}
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download Saifee Arrivals PDF</span>
                            </button>
                            <span className="text-xs font-semibold text-[#124E39]">
                              {saifeeArrivals.length} Arrivals • {saifeeDepartures.length} Departures
                            </span>
                          </div>
                        </div>

                        {/* Saifee Arrivals */}
                        <div>
                          <h4 className="text-xs font-bold text-emerald-800 mb-2 flex items-center gap-1.5">
                            <LogIn className="w-3.5 h-3.5" />
                            <span>Saifee Arrivals ({saifeeArrivals.length} Zaereen {rosterGroupByTour ? `• Grouped across ${saifeeArrivalsGroupedByTour.length} Tours` : ''})</span>
                          </h4>
                          {renderArrivalsTable(saifeeArrivalsGroupedByTour, saifeeArrivals, 'Saifee')}
                        </div>

                        {/* Saifee Departures */}
                        <div>
                          <h4 className="text-xs font-bold text-stone-800 mb-2 flex items-center gap-1.5">
                            <LogOut className="w-3.5 h-3.5 text-stone-600" />
                            <span>Saifee Departures ({saifeeDepartures.length} Zaereen {rosterGroupByTour ? `• Grouped across ${saifeeDeparturesGroupedByTour.length} Tours` : ''})</span>
                          </h4>
                          {renderDeparturesTable(saifeeDeparturesGroupedByTour, saifeeDepartures, 'Saifee')}
                        </div>
                      </div>
                    )}

                    {/* Burhani Hotel Section */}
                    {activeHotelFilter === 'Burhani' && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#124E39]/10 border border-[#124E39]/30 px-3 py-2 rounded-lg">
                          <div className="flex items-center gap-2 font-bold text-sm text-[#124E39]">
                            <Building2 className="w-4 h-4 text-[#124E39]" />
                            <span>BURHANI HOTEL — DAILY ROSTER ({selectedDate})</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleDownloadArrivalsPdf('Burhani')}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-2xs transition cursor-pointer"
                              title={`Download separate PDF for Burhani Hotel Arrivals on ${selectedDate}`}
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download Burhani Arrivals PDF</span>
                            </button>
                            <span className="text-xs font-semibold text-[#124E39]">
                              {burhaniArrivals.length} Arrivals • {burhaniDepartures.length} Departures
                            </span>
                          </div>
                        </div>

                        {/* Burhani Arrivals */}
                        <div>
                          <h4 className="text-xs font-bold text-stone-800 mb-2 flex items-center gap-1.5">
                            <LogIn className="w-3.5 h-3.5 text-stone-600" />
                            <span>Burhani Arrivals ({burhaniArrivals.length} Zaereen {rosterGroupByTour ? `• Grouped across ${burhaniArrivalsGroupedByTour.length} Tours` : ''})</span>
                          </h4>
                          {renderArrivalsTable(burhaniArrivalsGroupedByTour, burhaniArrivals, 'Burhani')}
                        </div>

                        {/* Burhani Departures */}
                        <div>
                          <h4 className="text-xs font-bold text-stone-800 mb-2 flex items-center gap-1.5">
                            <LogOut className="w-3.5 h-3.5 text-stone-600" />
                            <span>Burhani Departures ({burhaniDepartures.length} Zaereen {rosterGroupByTour ? `• Grouped across ${burhaniDeparturesGroupedByTour.length} Tours` : ''})</span>
                          </h4>
                          {renderDeparturesTable(burhaniDeparturesGroupedByTour, burhaniDepartures, 'Burhani')}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}

          {/* ============================================================ */}
          {/* TAB 3: WORKER ROOM OPERATIONS & TIMING SUMMARY (REQ 3)        */}
          {/* ============================================================ */}
          {activeTab === 'worker_summary' && (
            <div className="space-y-6">
              {/* Header Note & Worker Action Bar */}
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-950 shadow-2xs">
                <div>
                  <div className="flex items-center gap-2 font-bold text-sm text-amber-900">
                    <HardHat className="w-4 h-4 text-amber-700" />
                    <span>Worker Room Operations Sheet — Base Room # ➔ Time ➔ Office & Tour ID</span>
                  </div>
                  <p className="text-xs text-amber-800/80 mt-0.5">
                    Structured for ground workers and housekeeping attendants. Base is Room Number, followed by Departure/Arrival Time, grouped by Office Name and Tour ID in timing sequence.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* View Mode Switcher */}
                  <div className="flex items-center bg-amber-100 p-0.5 rounded-lg border border-amber-300 text-xs font-bold text-amber-950">
                    <button
                      type="button"
                      onClick={() => setWorkerViewMode('grouped')}
                      className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                        workerViewMode === 'grouped'
                          ? 'bg-amber-800 text-white shadow-2xs font-extrabold'
                          : 'text-amber-900 hover:bg-amber-200/60'
                      }`}
                    >
                      Grouped by Office & Tour
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkerViewMode('room_numeric')}
                      className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                        workerViewMode === 'room_numeric'
                          ? 'bg-amber-800 text-white shadow-2xs font-extrabold'
                          : 'text-amber-900 hover:bg-amber-200/60'
                      }`}
                    >
                      Room Number Order (Base)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDownloadWorkerPdf(activeHotelFilter)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-700 hover:bg-amber-800 text-white shadow-xs transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#EBD59E]" />
                    <span>Download Worker Sheet (PDF)</span>
                  </button>
                </div>
              </div>

              {/* Worker Task Summary Stats */}
              {(() => {
                const turnCount = filteredRoomPrep.filter((r) => r.actionType === 'turnover').length;
                const arrCount = filteredRoomPrep.filter((r) => r.actionType === 'new_arrival').length;
                const depCount = filteredRoomPrep.filter((r) => r.actionType === 'departure_clean').length;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-white border border-stone-200 shadow-2xs">
                      <span className="text-stone-500 text-[10px] uppercase font-bold block">Rooms Scheduled</span>
                      <span className="text-base font-extrabold text-stone-900">
                        {workerNumericRoomList.length} Rooms
                      </span>
                      <span className="text-[10px] text-stone-500">
                        {workerViewMode === 'grouped' ? `Across ${workerRoomSummary.length} Offices` : 'In Numeric Room Sequence'}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200 shadow-2xs">
                      <span className="text-stone-500 text-[10px] uppercase font-bold block">Priority Turnovers</span>
                      <span className="text-base font-extrabold text-purple-900">{turnCount} Rooms</span>
                      <span className="text-[10px] text-stone-500">Fast turn before arrivals</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 shadow-2xs">
                      <span className="text-stone-500 text-[10px] uppercase font-bold block">Checkout Cleans</span>
                      <span className="text-base font-extrabold text-amber-900">{depCount} Rooms</span>
                      <span className="text-[10px] text-stone-500">Freeing up inventory</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 shadow-2xs">
                      <span className="text-stone-500 text-[10px] uppercase font-bold block">New Arrival Preps</span>
                      <span className="text-base font-extrabold text-emerald-900">{arrCount} Rooms</span>
                      <span className="text-[10px] text-stone-500">Linens & wajba ready</span>
                    </div>
                  </div>
                );
              })()}

              {/* Real-time Housekeeping Progress Tracking Bar & Quick Actions */}
              {(() => {
                const readyCount = workerNumericRoomList.filter((r) => !!workerCompletedTasks[r.id]).length;
                const totalCount = workerNumericRoomList.length;
                const readyPercent = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;
                return (
                  <div className="bg-amber-50/80 border border-amber-300 p-3 rounded-xl shadow-2xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                      <span className="text-amber-950 flex items-center gap-1.5">
                        <HardHat className="w-4 h-4 text-amber-700" />
                        <span>Housekeeping Room Turnover & Preparation Progress:</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="bg-amber-100 text-amber-950 border border-amber-300 px-2.5 py-0.5 rounded-full font-mono text-xs font-extrabold">
                          {readyCount} of {totalCount} Rooms Ready ({readyPercent}%)
                        </span>
                        <button
                          type="button"
                          onClick={handleMarkAllWorkersReady}
                          className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-700 hover:bg-amber-800 text-white shadow-2xs transition cursor-pointer"
                        >
                          Mark All Ready
                        </button>
                        <button
                          type="button"
                          onClick={handleResetAllWorkerTasks}
                          className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-white text-stone-700 border border-stone-300 hover:bg-stone-100 transition cursor-pointer"
                        >
                          Reset Checklist
                        </button>
                      </div>
                    </div>
                    <div className="w-full h-2.5 bg-amber-200/50 rounded-full overflow-hidden border border-amber-300">
                      <div
                        className="h-full bg-amber-600 transition-all duration-300 rounded-full"
                        style={{ width: `${readyPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* View 1: Room Number Numeric Order (Base organized by Room Number) */}
              {workerViewMode === 'room_numeric' && (
                <div className="border border-stone-300 rounded-2xl overflow-hidden shadow-xs bg-white">
                  <div className="bg-stone-800 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <DoorClosed className="w-4 h-4 text-[#EBD59E]" />
                      <span className="font-bold text-sm tracking-wide">
                        ROOM NUMBER SEQUENCE (BASE ROOM # ➔ ARRIVAL & DEPARTURE TIMINGS)
                      </span>
                    </div>
                    <div className="text-xs font-bold bg-stone-900 text-[#EBD59E] border border-[#EBD59E]/30 px-2.5 py-0.5 rounded-md">
                      {workerNumericRoomList.length} Rooms • Sequenced by Room #
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold">
                        <tr>
                          <th className="py-2.5 px-3 w-[15%]">Room # & Hotel (Base)</th>
                          <th className="py-2.5 px-3 w-[25%] bg-[#0E3C2C]">Event & Timing Sequence</th>
                          <th className="py-2.5 px-3 w-[18%]">Office & Tour ID</th>
                          <th className="py-2.5 px-3 w-[18%]">Family # & Room Pax</th>
                          <th className="py-2.5 px-3 w-[24%]">Worker Checklist & Sign-off</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">
                        {workerNumericRoomList.length > 0 ? (
                          workerNumericRoomList.map((roomItem) => {
                            const isDone = !!workerCompletedTasks[roomItem.id];
                            return (
                              <tr key={roomItem.id} className={`transition ${isDone ? 'bg-emerald-50/70' : 'hover:bg-stone-50'}`}>
                                <td className="py-3 px-3 align-top font-bold">
                                  <div className="inline-block bg-[#124E39] text-[#EBD59E] font-mono font-black text-sm px-2.5 py-1 rounded-lg shadow-2xs">
                                    Room {roomItem.roomNumber}
                                  </div>
                                  <div className="text-[11px] font-semibold text-stone-700 mt-1">
                                    {roomItem.building} Hotel • Fl {roomItem.floor}
                                  </div>
                                </td>
                                <td className="py-3 px-3 align-top">
                                  <div className="flex items-center gap-1 font-mono font-extrabold text-xs text-stone-900">
                                    <Clock className="w-3.5 h-3.5 text-[#124E39] shrink-0" />
                                    <span>{roomItem.timeLabel}</span>
                                  </div>
                                  <div className="mt-1">
                                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border inline-block ${
                                      roomItem.actionType === 'TURNOVER'
                                        ? 'bg-purple-100 text-purple-900 border-purple-300'
                                        : roomItem.actionType === 'CHECKOUT'
                                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                                        : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                    }`}>
                                      {roomItem.actionType === 'TURNOVER' ? 'PRIORITY TURNOVER' : roomItem.actionType === 'CHECKOUT' ? 'CHECKOUT CLEANING' : 'NEW ARRIVAL PREP'}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-stone-500 mt-1 leading-tight">
                                    {roomItem.actionNotes}
                                  </div>
                                </td>
                                <td className="py-3 px-3 align-top">
                                  <div className="font-mono font-bold text-stone-900">
                                    Tour: {roomItem.tourRefNo}
                                  </div>
                                  <div className="text-[11px] text-stone-600 mt-0.5">
                                    Office: {roomItem.officeName}
                                  </div>
                                  <div className="font-semibold text-stone-800 text-[11px] mt-1">
                                    Guest: {roomItem.leadGuestName}
                                  </div>
                                </td>
                                <td className="py-3 px-3 align-top">
                                  <div className="font-mono font-bold text-stone-950">
                                    Family #{roomItem.familyNumbers}
                                  </div>
                                  <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-extrabold bg-[#124E39]/10 text-[#124E39] border border-[#124E39]/30">
                                    <Users className="w-3 h-3" />
                                    {roomItem.totalPaxInRoom} Pax in Room
                                  </div>
                                </td>
                                <td className="py-3 px-3 align-top">
                                  <div className="space-y-1.5">
                                    <button
                                      type="button"
                                      onClick={() => toggleRoomMasterSignoff(roomItem.id)}
                                      className={`w-full py-1.5 px-2 rounded-lg text-[11px] font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs ${
                                        isDone
                                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                                          : 'bg-stone-100 text-stone-700 hover:bg-emerald-50 hover:text-emerald-800 border-stone-300'
                                      }`}
                                    >
                                      <CheckSquare className="w-3.5 h-3.5" />
                                      <span>{isDone ? 'Cleaned & Ready ✓' : 'Mark Room Ready'}</span>
                                    </button>
                                    <div className="bg-stone-50 border border-stone-200 rounded-lg p-1.5 space-y-1 text-[10px]">
                                      <label className="flex items-center gap-1.5 cursor-pointer select-none text-stone-700 hover:text-stone-950 font-medium">
                                        <input
                                          type="checkbox"
                                          checked={!!workerSubtasks[roomItem.id]?.linen || isDone}
                                          onChange={() => toggleWorkerSubtask(roomItem.id, 'linen')}
                                          className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-stone-300 cursor-pointer"
                                        />
                                        <span>Linen & Beds Fresh</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 cursor-pointer select-none text-stone-700 hover:text-stone-950 font-medium">
                                        <input
                                          type="checkbox"
                                          checked={!!workerSubtasks[roomItem.id]?.toilet || isDone}
                                          onChange={() => toggleWorkerSubtask(roomItem.id, 'toilet')}
                                          className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-stone-300 cursor-pointer"
                                        />
                                        <span>Toilet Sanitized</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 cursor-pointer select-none text-stone-700 hover:text-stone-950 font-medium">
                                        <input
                                          type="checkbox"
                                          checked={!!workerSubtasks[roomItem.id]?.cards || isDone}
                                          onChange={() => toggleWorkerSubtask(roomItem.id, 'cards')}
                                          className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-stone-300 cursor-pointer"
                                        />
                                        <span>Wajba & Cards Ready</span>
                                      </label>
                                    </div>
                                    <div className="text-[10px] text-stone-400 text-center font-mono">
                                      Sign: ____________
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-stone-500">
                              No worker operations scheduled for this section.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* View 2: Office & Tour ID Groupings (Grouped by Office Name and Tour ID in timing sequence) */}
              {workerViewMode === 'grouped' && (
                workerRoomSummary.length > 0 ? (
                  workerRoomSummary.map((officeGroup) => (
                    <div key={officeGroup.officeName} className="border-2 border-stone-300 rounded-2xl overflow-hidden shadow-xs bg-white">
                      {/* Office Banner */}
                      <div className="bg-[#124E39] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-[#EBD59E]" />
                          <span className="font-bold text-sm tracking-wide">
                            OFFICE: {officeGroup.officeName}
                          </span>
                          <span className="text-xs text-[#EBD59E] font-medium">
                            ({officeGroup.tours.length} Tours under this office)
                          </span>
                        </div>
                        <div className="text-xs font-bold bg-[#0E3C2C] border border-[#EBD59E]/40 text-[#EBD59E] px-2.5 py-0.5 rounded-full">
                          {officeGroup.tours.reduce((sum, t) => sum + t.totalRooms, 0)} Rooms • {officeGroup.tours.reduce((sum, t) => sum + t.totalPax, 0)} Pax
                        </div>
                      </div>

                      <div className="p-4 space-y-5 bg-stone-50/50">
                        {officeGroup.tours.map((tourGroup) => (
                          <div key={tourGroup.tourRefNo} className="border border-stone-200 rounded-xl bg-white shadow-2xs overflow-hidden">
                            {/* Tour ID Banner */}
                            <div className="bg-stone-100 border-b border-stone-200 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-black text-sm text-stone-900 bg-white border border-stone-300 px-2 py-0.5 rounded-md shadow-2xs">
                                  Tour ID: {tourGroup.tourRefNo}
                                </span>
                                <span className="text-xs text-stone-600 font-semibold">
                                  (Office: {officeGroup.officeName})
                                </span>
                                <span className="text-[11px] font-bold text-[#124E39] bg-[#124E39]/10 border border-[#124E39]/30 px-2 py-0.5 rounded-md flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-[#124E39]" />
                                  Timing Sequence Sorted
                                </span>
                              </div>
                              <div className="text-xs font-bold text-stone-700">
                                {tourGroup.totalRooms} Rooms to service • {tourGroup.totalPax} Zaereen
                              </div>
                            </div>

                            {/* Table: Base is Room Number, then Departure/Arrival Time, Family #, Lead Guest, Sign-off */}
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead className="bg-stone-800 text-white uppercase text-[10px] font-bold">
                                  <tr>
                                    <th className="py-2.5 px-3 w-[18%]">Room # & Hotel (Base)</th>
                                    <th className="py-2.5 px-3 w-[26%] bg-stone-900">Event & Timing Sequence</th>
                                    <th className="py-2.5 px-3 w-[18%]">Family # & Room Pax</th>
                                    <th className="py-2.5 px-3 w-[20%]">Lead Guest & ITS</th>
                                    <th className="py-2.5 px-3 w-[18%]">Worker Checklist & Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-200">
                                  {tourGroup.items.map((roomItem) => {
                                    const isDone = !!workerCompletedTasks[roomItem.id];
                                    return (
                                      <tr key={roomItem.id} className={`transition ${isDone ? 'bg-emerald-50/70' : 'hover:bg-stone-50'}`}>
                                        {/* 1. Base: Room Number */}
                                        <td className="py-3 px-3 align-top font-bold">
                                          <div className="inline-block bg-[#124E39] text-[#EBD59E] font-mono font-black text-sm px-2.5 py-1 rounded-lg shadow-2xs">
                                            Room {roomItem.roomNumber}
                                          </div>
                                          <div className="text-[11px] font-semibold text-stone-700 mt-1">
                                            {roomItem.building} Hotel • Fl {roomItem.floor}
                                          </div>
                                        </td>

                                        {/* 2. Timing Sequence & Event */}
                                        <td className="py-3 px-3 align-top">
                                          <div className="flex items-center gap-1 font-mono font-extrabold text-xs text-stone-900">
                                            <Clock className="w-3.5 h-3.5 text-[#124E39] shrink-0" />
                                            <span>{roomItem.timeLabel}</span>
                                          </div>
                                          <div className="mt-1">
                                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border inline-block ${
                                              roomItem.actionType === 'TURNOVER'
                                                ? 'bg-purple-100 text-purple-900 border-purple-300'
                                                : roomItem.actionType === 'CHECKOUT'
                                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                                : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                            }`}>
                                              {roomItem.actionType === 'TURNOVER' ? 'PRIORITY TURNOVER' : roomItem.actionType === 'CHECKOUT' ? 'CHECKOUT CLEANING' : 'NEW ARRIVAL PREP'}
                                            </span>
                                          </div>
                                          <div className="text-[10px] text-stone-500 mt-1 leading-tight">
                                            {roomItem.actionNotes}
                                          </div>
                                        </td>

                                        {/* 3. Family Number & Pax */}
                                        <td className="py-3 px-3 align-top">
                                          <div className="font-mono font-bold text-stone-950">
                                            Family #{roomItem.familyNumbers}
                                          </div>
                                          <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-extrabold bg-[#124E39]/10 text-[#124E39] border border-[#124E39]/30">
                                            <Users className="w-3 h-3" />
                                            {roomItem.totalPaxInRoom} Pax in Room
                                          </div>
                                        </td>

                                        {/* 4. Lead Guest & ITS */}
                                        <td className="py-3 px-3 align-top">
                                          <div className="font-bold text-stone-900 leading-tight">
                                            {roomItem.leadGuestName}
                                          </div>
                                          <div className="font-mono text-[11px] text-stone-600 mt-0.5">
                                            ITS: {roomItem.leadGuestIts}
                                          </div>
                                        </td>

                                        {/* 5. Worker Checklist & Action */}
                                        <td className="py-3 px-3 align-top">
                                          <div className="space-y-1.5">
                                            <button
                                              type="button"
                                              onClick={() => toggleRoomMasterSignoff(roomItem.id)}
                                              className={`w-full py-1.5 px-2 rounded-lg text-[11px] font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs ${
                                                isDone
                                                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                                                  : 'bg-stone-100 text-stone-700 hover:bg-emerald-50 hover:text-emerald-800 border-stone-300'
                                              }`}
                                            >
                                              <CheckSquare className="w-3.5 h-3.5" />
                                              <span>{isDone ? 'Cleaned & Ready ✓' : 'Mark Room Ready'}</span>
                                            </button>
                                            <div className="bg-stone-50 border border-stone-200 rounded-lg p-1.5 space-y-1 text-[10px]">
                                              <label className="flex items-center gap-1.5 cursor-pointer select-none text-stone-700 hover:text-stone-950 font-medium">
                                                <input
                                                  type="checkbox"
                                                  checked={!!workerSubtasks[roomItem.id]?.linen || isDone}
                                                  onChange={() => toggleWorkerSubtask(roomItem.id, 'linen')}
                                                  className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-stone-300 cursor-pointer"
                                                />
                                                <span>Linen & Beds Fresh</span>
                                              </label>
                                              <label className="flex items-center gap-1.5 cursor-pointer select-none text-stone-700 hover:text-stone-950 font-medium">
                                                <input
                                                  type="checkbox"
                                                  checked={!!workerSubtasks[roomItem.id]?.toilet || isDone}
                                                  onChange={() => toggleWorkerSubtask(roomItem.id, 'toilet')}
                                                  className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-stone-300 cursor-pointer"
                                                />
                                                <span>Toilet Sanitized</span>
                                              </label>
                                              <label className="flex items-center gap-1.5 cursor-pointer select-none text-stone-700 hover:text-stone-950 font-medium">
                                                <input
                                                  type="checkbox"
                                                  checked={!!workerSubtasks[roomItem.id]?.cards || isDone}
                                                  onChange={() => toggleWorkerSubtask(roomItem.id, 'cards')}
                                                  className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-stone-300 cursor-pointer"
                                                />
                                                <span>Wajba & Cards Ready</span>
                                              </label>
                                            </div>
                                            <div className="text-[10px] text-stone-400 text-center font-mono">
                                              Initial: ___________
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-stone-500 font-semibold text-xs bg-stone-50 rounded-xl border border-dashed border-stone-300">
                    No worker room operations or turnovers scheduled for {selectedDate}.
                  </div>
                )
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 4: ASSISTANT PORTAL UPLOAD SHEET (REQ 4)                 */}
          {/* ============================================================ */}
          {activeTab === 'portal_upload' && (
            <div className="space-y-5">
              {/* Assistant Helper Banner */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-blue-950 shadow-2xs">
                <div>
                  <div className="flex items-center gap-2 font-bold text-sm text-blue-900">
                    <ClipboardList className="w-4 h-4 text-blue-700" />
                    <span>Assistant Portal Upload Checklist — Tour IDs, Families & Allotted Rooms</span>
                  </div>
                  <p className="text-xs text-blue-800/80 mt-0.5">
                    Structured for the accommodation assistant to cross-verify family members and allotted rooms with buildings, and upload onto the main portal.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleDownloadPortalUploadPdf}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-700 hover:bg-blue-800 text-white shadow-xs transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-200" />
                    <span>Download Portal Upload PDF</span>
                  </button>
                </div>
              </div>

              {/* Real-time Progress Tracking Bar */}
              {(() => {
                const totalPortalZaereen = portalUploadData.reduce((acc, tg) => acc + tg.totalPax, 0);
                const uploadedPortalZaereen = portalUploadData.reduce(
                  (acc, tg) => acc + tg.reservations.filter(r => !!(portalUploadedMap[r.id] ?? r.isUploadedToPortal)).length,
                  0
                );
                const portalPercent = totalPortalZaereen > 0 ? Math.round((uploadedPortalZaereen / totalPortalZaereen) * 100) : 0;
                return (
                  <div className="bg-white p-3 rounded-xl border border-blue-200 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-stone-700 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-blue-600" />
                        <span>Portal Upload Verification Progress:</span>
                      </span>
                      <span className="text-blue-900 bg-blue-100 px-2.5 py-0.5 rounded-full font-mono text-xs">
                        {uploadedPortalZaereen} of {totalPortalZaereen} Zaereen Uploaded ({portalPercent}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden border border-stone-200">
                      <div
                        className="h-full bg-blue-600 transition-all duration-300 rounded-full"
                        style={{ width: `${portalPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Search, Scope Filters & Batch Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 bg-stone-100 p-2.5 rounded-xl border border-stone-200 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-stone-700">Scope:</span>
                  <button
                    type="button"
                    onClick={() => setPortalFilterScope('date')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                      portalFilterScope === 'date'
                        ? 'bg-blue-700 text-white shadow-2xs'
                        : 'bg-white text-stone-700 border border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    Tours on {selectedDate} ({dateTourIds.size} Active Tours)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPortalFilterScope('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                      portalFilterScope === 'all'
                        ? 'bg-blue-700 text-white shadow-2xs'
                        : 'bg-white text-stone-700 border border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    All System Tours ({allSystemTourIds.size} Tours)
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleMarkAllPortalUploaded}
                    className="px-2.5 py-1 rounded-lg font-bold bg-blue-700 hover:bg-blue-800 text-white shadow-2xs transition cursor-pointer"
                    title="Mark all currently visible zaereen as Uploaded to Portal"
                  >
                    Mark All Displayed Uploaded
                  </button>
                  <button
                    type="button"
                    onClick={handleUnmarkAllPortalUploaded}
                    className="px-2.5 py-1 rounded-lg font-bold bg-white text-stone-700 border border-stone-300 hover:bg-stone-100 transition cursor-pointer"
                    title="Unmark all currently visible zaereen"
                  >
                    Unmark All
                  </button>

                  <div className="relative min-w-[200px]">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-stone-400" />
                    <input
                      type="text"
                      placeholder="Search Tour ID, Fam #, Name, Room..."
                      value={portalSearchQuery}
                      onChange={(e) => setPortalSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1 rounded-lg bg-white border border-stone-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                  {portalSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setPortalSearchQuery('')}
                      className="text-stone-400 hover:text-stone-700 text-xs cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Tour Groups */}
              {portalUploadData.length > 0 ? (
                portalUploadData.map((tourGroup) => {
                  const allUploaded = tourGroup.reservations.every((r) => !!(portalUploadedMap[r.id] ?? r.isUploadedToPortal));
                  return (
                    <div key={tourGroup.tourRefNo} className="border border-stone-200 rounded-xl bg-white shadow-xs overflow-hidden">
                      {/* Tour ID Banner */}
                      <div className="bg-stone-800 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-mono font-black text-sm text-[#EBD59E] bg-stone-900 border border-[#EBD59E]/30 px-2.5 py-0.5 rounded-md">
                            Tour ID: {tourGroup.tourRefNo}
                          </span>
                          <span className="text-xs text-stone-300">
                            Office: <strong className="text-white">{tourGroup.officeName}</strong>
                          </span>
                          {/* Tour Timings with Clock Badges */}
                          {(() => {
                            const arrTimes = tourGroup.reservations.map(r => getReservationArrivalTime(r, '11:00 AM')).filter(Boolean);
                            const depTimes = tourGroup.reservations.map(r => getReservationDepartureTime(r, '01:00 AM')).filter(Boolean);
                            const earliestArr = arrTimes.sort((a, b) => timeStringToMinutes(a) - timeStringToMinutes(b))[0];
                            const earliestDep = depTimes.sort((a, b) => timeStringToMinutes(a) - timeStringToMinutes(b))[0];
                            return (
                              <div className="flex items-center gap-1.5 text-[11px] font-bold">
                                {earliestArr && (
                                  <span className="bg-emerald-950/80 text-emerald-200 border border-emerald-700/60 px-2 py-0.5 rounded flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-emerald-400" />
                                    Arr: {earliestArr}
                                  </span>
                                )}
                                {earliestDep && (
                                  <span className="bg-amber-950/80 text-amber-200 border border-amber-700/60 px-2 py-0.5 rounded flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-amber-400" />
                                    Dep: {earliestDep}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          <span className="bg-stone-700 px-2 py-0.5 rounded font-semibold text-stone-200">
                            {tourGroup.familiesCount} Families
                          </span>
                          <span className="bg-blue-900 text-blue-200 border border-blue-700 px-2 py-0.5 rounded font-bold">
                            {tourGroup.totalPax} Zaereen
                          </span>
                          {tourGroup.unallottedCount > 0 ? (
                            <span className="bg-rose-900 text-rose-200 border border-rose-700 px-2 py-0.5 rounded font-bold">
                              {tourGroup.unallottedCount} Unallotted
                            </span>
                          ) : (
                            <span className="bg-emerald-900 text-emerald-200 border border-emerald-700 px-2 py-0.5 rounded font-bold">
                              100% Allotted
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const newStatus = !allUploaded;
                              setPortalUploadedMap((prev) => {
                                const next = { ...prev };
                                tourGroup.reservations.forEach((r) => {
                                  next[r.id] = newStatus;
                                });
                                return next;
                              });
                              tourGroup.reservations.forEach((r) => {
                                onUpdateReservation?.({ ...r, isUploadedToPortal: newStatus });
                              });
                            }}
                            className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-200 border border-stone-600 transition cursor-pointer"
                          >
                            {allUploaded ? 'Unmark All' : 'Mark All Uploaded'}
                          </button>
                        </div>
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-stone-100 text-stone-700 uppercase text-[10px] font-bold border-b border-stone-200">
                            <tr>
                              <th className="py-2.5 px-3 w-[4%] text-center">#</th>
                              <th className="py-2.5 px-3 w-[10%]">Family #</th>
                              <th className="py-2.5 px-3 w-[20%]">Allotted Room & Building</th>
                              <th className="py-2.5 px-3 w-[20%]">Family Member (Zaer)</th>
                              <th className="py-2.5 px-3 w-[11%]">ITS ID</th>
                              <th className="py-2.5 px-3 w-[9%]">Age / Sex</th>
                              <th className="py-2.5 px-3 w-[14%]">Arrival ➔ Departure</th>
                              <th className="py-2.5 px-3 w-[12%] text-center">Portal Upload Check</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-200">
                            {tourGroup.reservations.map((r, rIdx) => {
                              const isUploaded = !!(portalUploadedMap[r.id] ?? r.isUploadedToPortal);
                              const arrTime = getReservationArrivalTime(r, '11:00 AM');
                              const depTime = getReservationDepartureTime(r, '01:00 AM');
                              return (
                                <tr key={r.id || rIdx} className={`hover:bg-stone-50 ${isUploaded ? 'bg-blue-50/40' : ''}`}>
                                  <td className="py-2.5 px-3 text-center text-stone-400 font-mono text-[11px]">
                                    {rIdx + 1}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono font-bold text-stone-900">
                                    Family #{r.family || '—'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {r.roomNumber ? (
                                      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-950 font-bold text-xs">
                                        <BedDouble className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
                                        <span>Room {r.roomNumber} ({r.building} Hotel)</span>
                                      </div>
                                    ) : (
                                      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-100 border border-amber-300 text-amber-950 font-bold text-[11px]">
                                        <AlertCircle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                        <span>UNALLOTTED [Needs Room]</span>
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="font-bold text-stone-900">{r.applicantName}</div>
                                    <div className="text-[10px] text-stone-500 font-medium">{r.category || 'Mumineen'}</div>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-stone-800 font-medium">
                                    {r.itsId || '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-stone-700">
                                    {r.age || '—'} / {r.gender || '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-[11px] leading-tight text-stone-800">
                                    <div className="flex items-center gap-1">
                                      <span className="font-semibold text-stone-600">Arr:</span>
                                      <span>{r.arrivalDate || '—'}</span>
                                      <span className="inline-flex items-center gap-0.5 text-emerald-800 font-bold bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                                        <Clock className="w-2.5 h-2.5 text-emerald-600" />
                                        {arrTime}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <span className="font-semibold text-stone-600">Dep:</span>
                                      <span>{r.departureDate || '—'}</span>
                                      <span className="inline-flex items-center gap-0.5 text-amber-800 font-bold bg-amber-50 px-1 py-0.2 rounded border border-amber-200">
                                        <Clock className="w-2.5 h-2.5 text-amber-600" />
                                        {depTime}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none group">
                                      <input
                                        type="checkbox"
                                        checked={isUploaded}
                                        onChange={() => {
                                          const newStatus = !isUploaded;
                                          setPortalUploadedMap((prev) => ({ ...prev, [r.id]: newStatus }));
                                          onUpdateReservation?.({ ...r, isUploadedToPortal: newStatus });
                                        }}
                                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-stone-300 cursor-pointer transition"
                                      />
                                      <span
                                        className={`px-2 py-0.5 rounded text-[11px] font-bold border transition ${
                                          isUploaded
                                            ? 'bg-blue-600 text-white border-blue-700 shadow-2xs'
                                            : 'bg-stone-100 text-stone-600 group-hover:bg-blue-50 group-hover:text-blue-800 border-stone-300'
                                        }`}
                                      >
                                        {isUploaded ? 'Uploaded ✓' : 'Pending'}
                                      </span>
                                    </label>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center text-stone-500 font-semibold text-xs bg-stone-50 rounded-xl border border-dashed border-stone-300">
                  No tours or reservations match the current filter.
                </div>
              )}
            </div>
          )}

          {/* Handover & Signatures Box */}
          <div className="pt-6 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs text-stone-600">
            <div>
              <div className="font-semibold text-stone-800 mb-6">Submitted by:</div>
              <div className="border-b border-stone-400 w-48 mb-1" />
              <div>Accommodation Control Desk Officer</div>
              <div className="text-[10px] text-stone-400">Date: {selectedDate}</div>
            </div>

            <div className="sm:text-right">
              <div className="font-semibold text-stone-800 mb-6">Acknowledged & Received by:</div>
              <div className="border-b border-stone-400 w-48 mb-1 sm:ml-auto" />
              <div>Reception & Housekeeping Duty Manager</div>
              <div className="text-[10px] text-stone-400">Time: ______________</div>
            </div>
          </div>

        </div>
      </div>

      {/* Embedded PDF Viewer Modal for Instant In-Browser Inspection & Printing */}
      {pdfPreviewBlobUrl && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl border border-stone-400 overflow-hidden">
            <div className="flex items-center justify-between bg-[#124E39] text-white px-4 py-3 shrink-0">
              <div className="flex items-center gap-2 font-bold text-sm">
                <FileCheck className="w-5 h-5 text-[#EBD59E]" />
                <span>Faiz-e-Husaini — PDF Document Preview & Print</span>
                {pdfDownloadStatus?.fileName && (
                  <span className="hidden sm:inline text-xs text-emerald-200 font-mono">
                    ({pdfDownloadStatus.fileName})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={pdfPreviewBlobUrl}
                  download={pdfDownloadStatus?.fileName || 'document.pdf'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#EBD59E] hover:bg-amber-300 text-stone-950 shadow-xs transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download File</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPdfPreviewBlobUrl(null)}
                  className="p-1.5 text-stone-300 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
                  title="Close PDF preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 w-full bg-stone-200 p-1">
              <iframe
                src={pdfPreviewBlobUrl}
                className="w-full h-full rounded-xl border border-stone-300 bg-white"
                title="Generated PDF Document Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
