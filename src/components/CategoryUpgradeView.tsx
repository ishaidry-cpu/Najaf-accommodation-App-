import React, { useState, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  ShieldAlert,
  Users,
  ClipboardPaste,
} from 'lucide-react';
import { Reservation, Room, MoneyGivenStatus, UserRole } from '../types';
import {
  normalizeBuildingName,
  normalizeRoomNumber,
  getRoomBedCount,
  getVacantRoomsForDuration,
  getDistinctBuildings,
} from '../services/storage';
import { normalizeItsId } from '../utils/deduplication';
import { parseBulkTourPaste } from '../utils/itsPasteParser';
import {
  PageHeader, btn, btnDanger, btnSm, card, chip, field, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle, panel,
} from './ui';

/** Shows a stored `2026-11-22…` date as `22 Nov`; anything else is shown as it was saved. */
const day = (value?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!m) return value || '—';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const tourLabel = (ref?: string) => (ref || '').replace(/^NKERP\/TOUR\//i, '');

interface CategoryUpgradeViewProps {
  reservations: Reservation[];
  rooms?: Room[];
  onToggleMoneyGiven: (reservationId: string, status: MoneyGivenStatus) => void;
  onOpenAccountsSlip: (reservation: Reservation) => void;
  onOpenBToASlipForIds?: (selectedIds: string[]) => void;
  onOpenAToBSlip?: () => void;
  onToggleShiftToCategoryA?: (reservationId: string, willShift: boolean) => void;
  onBatchShiftToCategoryA?: (
    reservationIds: string[],
    moneyGiven: MoneyGivenStatus,
    notes?: string,
    roomOverride?: { building: string; roomNumber: string }
  ) => void;
  onAddZaer?: (newZaer: Reservation) => boolean | void;
  onAddTourBatch?: (newReservations: Reservation[]) => boolean | void;
  onDeleteReservation?: (id: string) => void;
  userRole?: UserRole;
}

export const CategoryUpgradeView: React.FC<CategoryUpgradeViewProps> = ({
  reservations,
  rooms = [],
  onToggleMoneyGiven,
  onOpenAccountsSlip,
  onOpenBToASlipForIds,
  onOpenAToBSlip,
  onToggleShiftToCategoryA,
  onBatchShiftToCategoryA,
  onAddZaer,
  onAddTourBatch,
  onDeleteReservation,
  userRole = 'admin',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [moneyFilter, setMoneyFilter] = useState<'ALL' | 'Yes' | 'No'>('ALL');
  const [hotelFilter, setHotelFilter] = useState<string>('ALL');

  // All buildings in inventory (core 3 + any custom buildings added by user)
  const distinctBuildings = useMemo(() => getDistinctBuildings(rooms), [rooms]);

  // Deletion protection modals for B to A
  const [bToARecordToDelete, setBToARecordToDelete] = useState<Reservation | null>(null);
  const [bToABlockedNotice, setBToABlockedNotice] = useState<Reservation | null>(null);

  // Modal state for Easy B -> A
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'existing' | 'new'>('existing');

  // --- Mode 1: Pick Existing Zaereen / Paste ITS ---
  const [pickSearch, setPickSearch] = useState('');
  const [pickTourFilter, setPickTourFilter] = useState('ALL');
  const [pickSelectedIds, setPickSelectedIds] = useState<string[]>([]);
  const [pickItsPaste, setPickItsPaste] = useState('');
  const [pickPasteFeedback, setPickPasteFeedback] = useState<string | null>(null);
  const [pickMoneyGiven, setPickMoneyGiven] = useState<MoneyGivenStatus>('No');
  const [pickOverrideRoom, setPickOverrideRoom] = useState(false);
  const [pickBuilding, setPickBuilding] = useState('Saifee');
  const [pickRoomNumber, setPickRoomNumber] = useState('');

  // --- Mode 2: New Zair / Paste ITS (Not in portal yet) ---
  const [newTourId, setNewTourId] = useState('');
  const [newOfficeName, setNewOfficeName] = useState('Faiz-e-Husaini Najaf');
  const [newPaxCount, setNewPaxCount] = useState<number>(1);
  const [newItsBulkText, setNewItsBulkText] = useState('');
  const [newArrivalDate, setNewArrivalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newDepartureDate, setNewDepartureDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [newBuilding, setNewBuilding] = useState<string>('Saifee');
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newApplicantName, setNewApplicantName] = useState('');
  const [newItsId, setNewItsId] = useState('');
  const [newFamily, setNewFamily] = useState('1');
  const [newPhone, setNewPhone] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newMoneyGiven, setNewMoneyGiven] = useState<MoneyGivenStatus>('No');
  const [formError, setFormError] = useState('');

  // Filter existing B to A accommodation shift requests
  const shiftRequests = useMemo(() => {
    return reservations.filter(
      (r) =>
        Boolean(r.shiftToCategoryA) ||
        r.category === 'B to A' ||
        Boolean(r.category && r.category.toLowerCase().includes('b to a'))
    );
  }, [reservations]);

  const shiftRequestIdSet = useMemo(() => new Set(shiftRequests.map((r) => r.id)), [shiftRequests]);

  // Candidates from existing portal records (not yet marked B to A)
  const portalCandidates = useMemo(() => {
    return reservations.filter((r) => !shiftRequestIdSet.has(r.id));
  }, [reservations, shiftRequestIdSet]);

  const candidateTours = useMemo(() => {
    const set = new Set<string>();
    portalCandidates.forEach((r) => {
      const t = (r.tourRefNo || r.tourId || '').trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort();
  }, [portalCandidates]);

  const filteredCandidates = useMemo(() => {
    return portalCandidates.filter((r) => {
      if (pickTourFilter !== 'ALL') {
        const t = (r.tourRefNo || r.tourId || '').trim();
        if (t !== pickTourFilter) return false;
      }
      if (pickSearch.trim()) {
        const q = pickSearch.toLowerCase().trim();
        const hit =
          (r.applicantName || '').toLowerCase().includes(q) ||
          (r.itsId || '').toLowerCase().includes(q) ||
          (r.family || '').toLowerCase().includes(q) ||
          (r.tourRefNo || '').toLowerCase().includes(q) ||
          (r.roomNumber || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [portalCandidates, pickTourFilter, pickSearch]);

  // Live nights calculation
  const calculatedNights = useMemo(() => {
    if (!newArrivalDate || !newDepartureDate) return 1;
    const d1 = new Date(newArrivalDate);
    const d2 = new Date(newDepartureDate);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
    return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000));
  }, [newArrivalDate, newDepartureDate]);

  // Unique existing Tour IDs for auto-suggestion
  const existingTourIds = useMemo(() => {
    const set = new Set<string>();
    reservations.forEach((r) => {
      const t = (r.tourRefNo || r.tourId || '').trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort();
  }, [reservations]);

  // Vacant rooms for chosen hotel & dates
  const vacantRoomsForNewEntry = useMemo(() => {
    if (!rooms || rooms.length === 0) return [];
    if (newArrivalDate && newDepartureDate) {
      return getVacantRoomsForDuration(newBuilding, newArrivalDate, newDepartureDate, rooms, reservations);
    }
    return rooms.filter((r) => normalizeBuildingName(r.building).toLowerCase() === newBuilding.toLowerCase());
  }, [rooms, newBuilding, newArrivalDate, newDepartureDate, reservations]);

  const vacantRoomsForPickOverride = useMemo(() => {
    if (!rooms || rooms.length === 0) return [];
    const firstSelected = reservations.find((r) => pickSelectedIds.includes(r.id));
    if (firstSelected?.arrivalDate && firstSelected?.departureDate) {
      return getVacantRoomsForDuration(
        pickBuilding,
        firstSelected.arrivalDate,
        firstSelected.departureDate,
        rooms,
        reservations
      );
    }
    return rooms.filter((r) => normalizeBuildingName(r.building).toLowerCase() === pickBuilding.toLowerCase());
  }, [rooms, pickBuilding, pickSelectedIds, reservations]);

  // Parse bulk ITS paste in Mode 2 ("New B -> A Entry")
  const parsedNewBulk = useMemo(() => {
    if (!newItsBulkText.trim()) return null;
    return parseBulkTourPaste(newItsBulkText, reservations, {
      defaultBuilding: newBuilding,
      defaultCategory: 'B to A',
    });
  }, [newItsBulkText, reservations, newBuilding]);

  const handleTourIdChange = (val: string) => {
    setNewTourId(val);
    const trimmed = val.trim().toLowerCase();
    const match = reservations.find(
      (r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === trimmed
    );
    if (match) {
      if (match.officeName) setNewOfficeName(match.officeName);
      if (match.arrivalDate) setNewArrivalDate(match.arrivalDate.slice(0, 10));
      if (match.departureDate) setNewDepartureDate(match.departureDate.slice(0, 10));
    }
  };

  // Match pasted ITS IDs against portal records in Mode 1
  const handleMatchPastedItsInPortal = () => {
    const parsed = parseBulkTourPaste(pickItsPaste, reservations);
    if (parsed.entries.length === 0) {
      setPickPasteFeedback('Paste one or more 7–9 digit ITS IDs to auto-select matching zaereen.');
      return;
    }

    const wantedSet = new Set(parsed.entries.map((e) => normalizeItsId(e.itsId)).filter(Boolean));
    const matchedIds: string[] = [];
    const matchedNorm = new Set<string>();

    for (const candidate of portalCandidates) {
      const k = normalizeItsId(candidate.itsId);
      if (k && wantedSet.has(k)) {
        matchedIds.push(candidate.id);
        matchedNorm.add(k);
      }
    }

    setPickSelectedIds((prev) => Array.from(new Set([...prev, ...matchedIds])));

    const missingCount = wantedSet.size - matchedNorm.size;
    if (matchedIds.length === 0) {
      setPickPasteFeedback(
        `None of those ${wantedSet.size} ITS IDs were in the portal yet. Switch to "Add New B→A" tab to add them directly.`
      );
    } else {
      setPickPasteFeedback(
        `Selected ${matchedIds.length} matching zaereen${
          missingCount > 0 ? ` (${missingCount} not found in portal)` : ''
        }.`
      );
    }
  };

  const handleOpenShiftModal = () => {
    setFormError('');
    setPickPasteFeedback(null);
    setPickItsPaste('');
    setPickSearch('');
    setPickSelectedIds([]);
    setPickOverrideRoom(false);
    setPickRoomNumber('');
    setModalMode(portalCandidates.length > 0 ? 'existing' : 'new');
    setIsShiftModalOpen(true);
  };

  // Submit Mode 1: Shift existing portal zaereen to B -> A
  const handleShiftSelectedExisting = (openSlipAfter: boolean) => {
    setFormError('');
    if (pickSelectedIds.length === 0) {
      setFormError('Select at least one Zaer (or paste ITS IDs) to shift to B→A.');
      return;
    }

    const roomOverride =
      pickOverrideRoom && pickRoomNumber.trim()
        ? { building: pickBuilding, roomNumber: normalizeRoomNumber(pickRoomNumber) }
        : undefined;

    if (onBatchShiftToCategoryA) {
      onBatchShiftToCategoryA(
        pickSelectedIds,
        pickMoneyGiven,
        'Shifted B to A',
        roomOverride
      );
    } else if (onToggleShiftToCategoryA) {
      pickSelectedIds.forEach((id) => onToggleShiftToCategoryA(id, true));
    }

    const idsCopy = [...pickSelectedIds];
    const firstObj = reservations.find((r) => r.id === idsCopy[0]) || null;

    setIsShiftModalOpen(false);
    setPickSelectedIds([]);
    setPickItsPaste('');

    if (openSlipAfter) {
      if (onOpenBToASlipForIds) {
        onOpenBToASlipForIds(idsCopy);
      } else if (firstObj) {
        onOpenAccountsSlip(firstObj);
      }
    }
  };

  // Submit Mode 2: Add new B -> A Zaer(s) directly
  const handleSubmitNewShiftZaer = (openSlipAfter: boolean) => {
    setFormError('');
    if (!newTourId.trim()) {
      setFormError('Please enter a Tour ID.');
      return;
    }
    if (!newArrivalDate || !newDepartureDate) {
      setFormError('Please select arrival and departure dates.');
      return;
    }

    const nowIso = new Date().toISOString();
    const todayIso = nowIso.slice(0, 10);
    const cleanRoom = normalizeRoomNumber(newRoomNumber);
    const cleanBuilding = normalizeBuildingName(newBuilding) || 'Saifee';

    // If bulk ITS numbers were pasted, create individual B to A records for each ITS
    if (parsedNewBulk && parsedNewBulk.entries.length > 0) {
      const batch: Reservation[] = parsedNewBulk.entries.map((entry, idx) => ({
        id: `b2a-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        itsId: entry.itsId,
        applicantName: entry.applicantName || `Zaer ITS ${entry.itsId}`,
        gender: entry.gender || 'Male',
        age: entry.age ? parseInt(entry.age, 10) || 35 : 35,
        jamaat: entry.jamaat || 'Najaf',
        family: entry.family || newFamily.trim() || String(idx + 1),
        idara: '',
        hofId: entry.hofId || '',
        tourRefNo: newTourId.trim(),
        tourId: newTourId.trim(),
        officeName: newOfficeName.trim() || 'Faiz-e-Husaini Najaf',
        groupLeadName: entry.applicantName || newApplicantName.trim() || `Zaer (Tour ${newTourId.trim()})`,
        paxCount: 1,
        pax: 1,
        totalGuests: 1,
        arrivalDate: newArrivalDate,
        departureDate: newDepartureDate,
        building: cleanBuilding,
        roomNumber: cleanRoom,
        category: 'B to A',
        accommodationCategory: 'Category A (Nizaam)',
        shiftToCategoryA: true,
        moneyGiven: newMoneyGiven,
        moneyGivenDate: newMoneyGiven === 'Yes' ? todayIso : undefined,
        requestSlipNo: `SLIP-${newTourId.trim().slice(-4) || 'B2A'}-${Date.now().toString().slice(-4)}`,
        requestSlipDate: todayIso,
        paymentStatus: newMoneyGiven === 'Yes' ? 'Paid' : 'Pending',
        isUploadedToPortal: false,
        specialRequests: newNotes.trim() ? `Shift B to A: ${newNotes.trim()}` : 'Shifted from Category B to Category A',
        guestContact: newPhone.trim(),
        createdAt: nowIso,
        updatedAt: nowIso,
      }));

      if (onAddTourBatch) {
        onAddTourBatch(batch);
      } else if (onAddZaer) {
        batch.forEach((b) => onAddZaer(b));
      }

      const ids = batch.map((b) => b.id);
      setIsShiftModalOpen(false);
      setNewItsBulkText('');
      setNewRoomNumber('');
      setNewApplicantName('');
      setNewItsId('');
      setNewNotes('');

      if (openSlipAfter) {
        if (onOpenBToASlipForIds) onOpenBToASlipForIds(ids);
        else onOpenAccountsSlip(batch[0]);
      }
      return;
    }

    // Otherwise single / multi-pax summary record
    const createdReservation: Reservation = {
      id: `b2a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      itsId: newItsId.trim() || `B2A-${Math.floor(100000 + Math.random() * 900000)}`,
      applicantName: newApplicantName.trim() || `Zaer (Tour ${newTourId.trim()})`,
      gender: 'Male',
      age: 35,
      jamaat: 'Najaf',
      family: newFamily.trim() || '1',
      idara: '',
      tourRefNo: newTourId.trim(),
      tourId: newTourId.trim(),
      officeName: newOfficeName.trim() || 'Faiz-e-Husaini Najaf',
      groupLeadName: newApplicantName.trim() || `Zaer (Tour ${newTourId.trim()})`,
      paxCount: Math.max(1, newPaxCount || 1),
      pax: Math.max(1, newPaxCount || 1),
      totalGuests: Math.max(1, newPaxCount || 1),
      arrivalDate: newArrivalDate,
      departureDate: newDepartureDate,
      building: cleanBuilding,
      roomNumber: cleanRoom,
      category: 'B to A',
      accommodationCategory: 'Category A (Nizaam)',
      shiftToCategoryA: true,
      moneyGiven: newMoneyGiven,
      moneyGivenDate: newMoneyGiven === 'Yes' ? todayIso : undefined,
      requestSlipNo: `SLIP-${newTourId.trim().slice(-4) || 'B2A'}-${Date.now().toString().slice(-4)}`,
      requestSlipDate: todayIso,
      paymentStatus: newMoneyGiven === 'Yes' ? 'Paid' : 'Pending',
      isUploadedToPortal: false,
      specialRequests: newNotes.trim() ? `Shift B to A: ${newNotes.trim()}` : 'Shifted from Category B to Category A',
      guestContact: newPhone.trim(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (onAddZaer) {
      onAddZaer(createdReservation);
    } else if (onToggleShiftToCategoryA) {
      onToggleShiftToCategoryA(createdReservation.id, true);
    }

    setIsShiftModalOpen(false);
    setFormError('');
    setNewTourId('');
    setNewPaxCount(1);
    setNewApplicantName('');
    setNewItsId('');
    setNewRoomNumber('');
    setNewPhone('');
    setNewNotes('');

    if (openSlipAfter) {
      onOpenAccountsSlip(createdReservation);
    }
  };

  // Sorting
  const [sortColumn, setSortColumn] = useState<string>('itsId');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const filteredAndSortedRequests = useMemo(() => {
    const filtered = shiftRequests.filter((r) => {
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (r.applicantName && r.applicantName.toLowerCase().includes(q)) ||
          (r.itsId && r.itsId.toLowerCase().includes(q)) ||
          (r.jamaat && r.jamaat.toLowerCase().includes(q)) ||
          (r.category && r.category.toLowerCase().includes(q)) ||
          (r.family && r.family.toLowerCase().includes(q)) ||
          (r.tourRefNo && r.tourRefNo.toLowerCase().includes(q)) ||
          (r.officeName && r.officeName.toLowerCase().includes(q));
        if (!match) return false;
      }

      if (moneyFilter !== 'ALL' && r.moneyGiven !== moneyFilter) return false;
      if (hotelFilter !== 'ALL' && normalizeBuildingName(r.building) !== hotelFilter) return false;

      return true;
    });

    filtered.sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';

      switch (sortColumn) {
        case 'itsId':
          valA = parseInt(a.itsId, 10) || 0;
          valB = parseInt(b.itsId, 10) || 0;
          break;
        case 'applicantName':
          valA = (a.applicantName || '').toLowerCase();
          valB = (b.applicantName || '').toLowerCase();
          break;
        case 'category':
          valA = (a.category || '').toLowerCase();
          valB = (b.category || '').toLowerCase();
          break;
        case 'family':
          return sortDirection === 'asc'
            ? (a.family || '').localeCompare(b.family || '', undefined, { numeric: true, sensitivity: 'base' })
            : (b.family || '').localeCompare(a.family || '', undefined, { numeric: true, sensitivity: 'base' });
        case 'tourRefNo':
          return sortDirection === 'asc'
            ? (a.tourRefNo || '').localeCompare(b.tourRefNo || '', undefined, { numeric: true, sensitivity: 'base' })
            : (b.tourRefNo || '').localeCompare(a.tourRefNo || '', undefined, { numeric: true, sensitivity: 'base' });
        case 'moneyGiven':
          valA = a.moneyGiven || 'No';
          valB = b.moneyGiven || 'No';
          break;
        case 'building':
          valA = (a.building || '').toLowerCase();
          valB = (b.building || '').toLowerCase();
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
  }, [shiftRequests, searchTerm, moneyFilter, hotelFilter, sortColumn, sortDirection]);

  const totalShifts = shiftRequests.length;
  const moneyGivenCount = shiftRequests.filter((r) => r.moneyGiven === 'Yes').length;
  const moneyPendingCount = shiftRequests.filter((r) => r.moneyGiven !== 'Yes').length;

  const renderSortIndicator = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-stone-400" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-brand-700" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-brand-700" />
    );
  };

  const handleInitiateDelete = (res: Reservation) => {
    if (userRole !== 'admin') {
      setBToABlockedNotice(res);
      return;
    }
    setBToARecordToDelete(res);
  };

  const canAdd = Boolean(onAddZaer || onToggleShiftToCategoryA || onBatchShiftToCategoryA);
  const canRemove = Boolean(onDeleteReservation || onToggleShiftToCategoryA);
  const emptyState = shiftRequests.length > 0 ? (
    <p className="text-sm text-stone-600">No B→A shift matches the search or filters. Clear them to see all {shiftRequests.length}.</p>
  ) : (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <p className="font-medium text-stone-900">No B→A shifts yet.</p>
        <p className="mt-0.5 text-stone-600">Zaereen shifted from category B to A appear here, with their payment and accounts slip.</p>
      </div>
      {canAdd && (
        <button type="button" onClick={handleOpenShiftModal} className={`${btn.secondary} shrink-0`}>
          <Plus className="w-4 h-4" />
          Add B→A shift
        </button>
      )}
    </div>
  );
  /** Money given shows as a state chip; pressing it switches Paid and Pending, as before. */
  const moneyButton = (res: Reservation, extra = '') => {
    const isPaid = res.moneyGiven === 'Yes';
    return (
      <button
        type="button"
        aria-pressed={isPaid}
        onClick={() => onToggleMoneyGiven(res.id, isPaid ? 'No' : 'Yes')}
        title={isPaid ? 'Money received. Press to mark as pending.' : 'Money pending. Press to mark as paid.'}
        className={`${chip(isPaid ? 'ok' : 'wait')} !h-8 !px-2.5 !text-[13px] cursor-pointer transition ${
          isPaid ? 'hover:bg-emerald-100 hover:ring-emerald-300' : 'hover:bg-amber-100 hover:ring-amber-300'
        } ${extra}`}
      >
        {isPaid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
        {isPaid ? 'Paid' : 'Pending'}
      </button>
    );
  };
  const roomText = (res: Reservation) => `${res.building || ''} ${res.roomNumber || ''}`.trim();
  const sortTh = (column: string, label: string) => (
    <button
      type="button"
      onClick={() => handleSort(column)}
      className={`inline-flex items-center gap-1 -mx-1 px-1 h-7 rounded-md cursor-pointer hover:bg-stone-200/70 hover:text-stone-950 ${
        sortColumn === column ? 'text-stone-950' : ''
      }`}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {label}
      {renderSortIndicator(column)}
    </button>
  );
  const ariaSort = (column: string) =>
    sortColumn === column ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined;
  const th = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
  const modeTab = (mode: 'existing' | 'new') =>
    `inline-flex items-center justify-center gap-1.5 h-9 max-md:h-10 px-3 rounded-md text-[13px] font-medium whitespace-nowrap cursor-pointer transition ${
      modalMode === mode ? 'bg-white text-stone-950 ring-1 ring-stone-300' : 'text-stone-600 hover:text-stone-950'
    }`;
  const sectionTitle = 'text-[15px] font-semibold text-stone-950';
  const required = <span className="text-rose-600" aria-hidden="true"> *</span>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="B→A shifts"
        description="Shift zaereen from category B to A, mark payment received, and print accounts slips."
        meta={
          <p className="text-sm text-stone-600 tabular-nums">
            <span className="font-semibold text-stone-950">{totalShifts}</span> {totalShifts === 1 ? 'shift' : 'shifts'}
            <span className="mx-2 text-stone-400">·</span>
            <span className="font-semibold text-stone-950">{moneyGivenCount}</span> paid
            <span className="mx-2 text-stone-400">·</span>
            <span className={`font-semibold ${moneyPendingCount ? 'text-amber-700' : 'text-stone-950'}`}>{moneyPendingCount}</span> awaiting payment
          </p>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {onOpenBToASlipForIds && shiftRequests.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenBToASlipForIds(shiftRequests.map((r) => r.id))}
                className={btn.secondary}
              >
                <FileText className="w-4 h-4" />
                All B→A slips ({shiftRequests.length})
              </button>
            )}
            {onOpenAToBSlip && (
              <button type="button" onClick={onOpenAToBSlip} className={btn.secondary}>
                <FileText className="w-4 h-4" />
                A→B slip
              </button>
            )}
            {canAdd && (
              <button type="button" onClick={handleOpenShiftModal} className={btn.primary}>
                <Plus className="w-4 h-4" />
                Add B→A shift
              </button>
            )}
          </div>
        }
      />

      {/* Shifts: search and filters in the card header, then the list */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-col gap-2.5 p-4 sm:px-5 md:flex-row md:items-center">
          <label className="relative flex-1 min-w-0">
            <span className="sr-only">Search B→A shifts</span>
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by ITS ID, name, family, Tour ID or office"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`${field} pl-9`}
            />
          </label>
          <div className="grid grid-cols-2 gap-2.5 md:flex">
            <select
              value={moneyFilter}
              onChange={(e) => setMoneyFilter(e.target.value as 'ALL' | 'Yes' | 'No')}
              aria-label="Filter by money given"
              className={`${field} md:w-48`}
            >
              <option value="ALL">All payment states</option>
              <option value="Yes">Money given: paid</option>
              <option value="No">Money given: pending</option>
            </select>
            <select
              value={hotelFilter}
              onChange={(e) => setHotelFilter(e.target.value)}
              aria-label="Filter by hotel"
              className={`${field} md:w-40`}
            >
              <option value="ALL">All hotels</option>
              {distinctBuildings.map((bldg) => (
                <option key={bldg} value={bldg}>
                  {bldg}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Phone list */}
        <div className="md:hidden border-t border-stone-200">
          {filteredAndSortedRequests.length > 0 ? (
            <ul className="divide-y divide-stone-200">
              {filteredAndSortedRequests.map((res) => (
                <li key={res.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold leading-snug text-stone-950">{res.applicantName}</h3>
                      <p className="mt-0.5 text-[13px] text-stone-600 tabular-nums">
                        ITS <span className="font-semibold text-stone-900">{res.itsId}</span> · {res.age} {res.gender === 'Female' ? 'F' : 'M'} · Family {res.family}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm text-right tabular-nums">
                      {res.roomNumber ? (
                        <span className="font-semibold text-stone-950">{roomText(res)}</span>
                      ) : (
                        <>
                          <span className="block text-stone-700">{res.building}</span>
                          <span className="block text-[13px] text-amber-800">Room pending</span>
                        </>
                      )}
                    </p>
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px] leading-relaxed">
                    <dt className="text-stone-500">Tour ID</dt>
                    <dd className="font-medium text-stone-900 tabular-nums break-words">{tourLabel(res.tourRefNo) || '—'}</dd>
                    <dt className="text-stone-500">Office</dt>
                    <dd className="text-stone-800">{res.officeName || '—'}</dd>
                    <dt className="text-stone-500">Stay</dt>
                    <dd className="text-stone-800 tabular-nums">{day(res.arrivalDate)} → {day(res.departureDate)}{res.paxCount && res.paxCount > 1 ? ` · ${res.paxCount} pax` : ''}</dd>
                  </dl>
                  <div className="mt-3 flex items-center gap-2">
                    {moneyButton(res, '!h-10 !px-3.5')}
                    <button type="button" onClick={() => onOpenAccountsSlip(res)} className={`${btn.secondary} flex-1`}>
                      <FileText className="w-4 h-4" />
                      Request slip
                    </button>
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => handleInitiateDelete(res)}
                        className={`${btn.ghost} w-10 !px-0 shrink-0 hover:!text-rose-700 hover:!bg-rose-50`}
                        title="Delete or revert this B→A record"
                        aria-label={`Delete or revert the B→A record of ${res.applicantName}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-8">{emptyState}</div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block border-t border-stone-200 overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-stone-50 text-xs font-semibold text-stone-600 select-none">
              <tr>
                <th className={`${th} pl-5`} aria-sort={ariaSort('itsId')}>{sortTh('itsId', 'ITS ID')}</th>
                <th className={th} aria-sort={ariaSort('applicantName') || ariaSort('family')}>
                  <span className="inline-flex items-center gap-3">
                    {sortTh('applicantName', 'Applicant name')}
                    {sortTh('family', 'Family')}
                  </span>
                </th>
                <th className={th} aria-sort={ariaSort('tourRefNo')}>
                  {sortTh('tourRefNo', 'Tour ID')} <span className="font-normal text-stone-500">and office</span>
                </th>
                <th className={th}>Stay</th>
                <th className={th} aria-sort={ariaSort('building')}>{sortTh('building', 'Hotel & room')}</th>
                <th className={th} aria-sort={ariaSort('moneyGiven')}>{sortTh('moneyGiven', 'Money given')}</th>
                <th className={th}>Accounts slip</th>
                {canRemove && <th className="w-12 pr-3"><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>

            <tbody className="divide-y divide-stone-200 text-stone-900">
              {filteredAndSortedRequests.length > 0 ? (
                filteredAndSortedRequests.map((res) => (
                  <tr key={res.id} className="hover:bg-stone-50 transition align-top">
                    <td className="py-3 pl-5 pr-3 font-bold text-stone-950 tabular-nums whitespace-nowrap">{res.itsId}</td>

                    <td className="py-3 px-3 min-w-[11rem]">
                      <div className="font-semibold leading-snug text-stone-950 break-words">{res.applicantName}</div>
                      <div className="mt-0.5 text-[13px] text-stone-600 tabular-nums">
                        {res.age} {res.gender === 'Female' ? 'F' : 'M'} · Family {res.family}
                        {res.jamaat ? ` · ${res.jamaat}` : ''}
                      </div>
                    </td>

                    <td className="py-3 px-3 min-w-[9rem]">
                      <div className="font-semibold text-stone-950 tabular-nums break-words" title={res.tourRefNo}>{tourLabel(res.tourRefNo)}</div>
                      <div className="mt-0.5 text-[13px] leading-snug text-stone-600">{res.officeName}</div>
                    </td>

                    <td className="py-3 px-3 text-stone-800 tabular-nums whitespace-nowrap">
                      {day(res.arrivalDate)} → {day(res.departureDate)}
                    </td>

                    <td className="py-3 px-3 tabular-nums whitespace-nowrap">
                      {res.roomNumber ? (
                        <span className="font-semibold text-stone-950">{roomText(res)}</span>
                      ) : (
                        <>
                          <span className="text-stone-800">{res.building}</span>
                          <span className="block text-[13px] text-amber-800">Room pending</span>
                        </>
                      )}
                      {res.paxCount && res.paxCount > 1 && (
                        <div className="mt-0.5 text-[13px] text-stone-600">{res.paxCount} pax</div>
                      )}
                    </td>

                    <td className="py-2 px-3">{moneyButton(res)}</td>

                    <td className="py-2 px-3">
                      <button type="button" onClick={() => onOpenAccountsSlip(res)} className={btnSm.secondary}>
                        <FileText className="w-4 h-4" />
                        Request slip
                      </button>
                    </td>

                    {canRemove && (
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          onClick={() => handleInitiateDelete(res)}
                          className={`${btnSm.ghost} w-8 !px-0 hover:!text-rose-700 hover:!bg-rose-50`}
                          title="Delete or revert this B→A record"
                          aria-label={`Delete or revert the B→A record of ${res.applicantName}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-5 py-8">{emptyState}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add B→A shift: pick existing zaereen, paste ITS IDs, or add new */}
      {isShiftModalOpen && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-label="Add B→A shift">
          <div className={`${modalCard} max-w-3xl`}>
            <div className={modalHeader}>
              <div className="min-w-0">
                <h3 className={modalTitle}>Add B→A shift</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">
                  Pick existing zaereen by search or ITS paste, or register new zaereen shifting from B to A.
                </p>
              </div>
              <button type="button" onClick={() => setIsShiftModalOpen(false)} className={`${modalClose} max-md:w-10 max-md:h-10`} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode switch */}
            <div className="px-5 sm:px-6 pt-4">
              <div className="grid grid-cols-2 sm:inline-grid rounded-lg bg-stone-200/70 p-1 gap-1" role="group" aria-label="How to add">
                <button
                  type="button"
                  aria-pressed={modalMode === 'existing'}
                  onClick={() => {
                    setFormError('');
                    setModalMode('existing');
                  }}
                  className={modeTab('existing')}
                >
                  <Users className="w-4 h-4 max-sm:hidden" />
                  <span>Pick existing zaereen ({portalCandidates.length})</span>
                </button>
                <button
                  type="button"
                  aria-pressed={modalMode === 'new'}
                  onClick={() => {
                    setFormError('');
                    setModalMode('new');
                  }}
                  className={modeTab('new')}
                >
                  <Plus className="w-4 h-4 max-sm:hidden" />
                  <span>Add new zair / paste ITS</span>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
              {formError && (
                <div role="alert" className="rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 px-3.5 py-2.5 text-sm text-rose-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {modalMode === 'existing' ? (
                <>
                  {/* Search, tour filter, quick ITS match */}
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      <label className="sm:col-span-7 relative">
                        <span className="sr-only">Search zaereen</span>
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                        <input
                          type="text"
                          value={pickSearch}
                          onChange={(e) => setPickSearch(e.target.value)}
                          placeholder="Search by name, ITS ID, Tour ID or family"
                          className={`${field} pl-9`}
                        />
                      </label>
                      <div className="sm:col-span-5">
                        <select
                          value={pickTourFilter}
                          onChange={(e) => setPickTourFilter(e.target.value)}
                          aria-label="Filter by tour"
                          className={field}
                        >
                          <option value="ALL">All tours ({portalCandidates.length})</option>
                          {candidateTours.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                      <label className="relative flex-1 min-w-0">
                        <span className="sr-only">Paste ITS IDs to select matching zaereen</span>
                        <ClipboardPaste className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                        <input
                          type="text"
                          value={pickItsPaste}
                          onChange={(e) => setPickItsPaste(e.target.value)}
                          placeholder="Quick match: paste ITS IDs separated by spaces or commas"
                          className={`${field} pl-9 tabular-nums`}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleMatchPastedItsInPortal}
                        disabled={!pickItsPaste.trim()}
                        className={btn.secondary}
                      >
                        Match and select
                      </button>
                    </div>

                    {pickPasteFeedback && (
                      <p role="status" className="rounded-lg bg-blue-50 ring-1 ring-inset ring-blue-200 px-3 py-2 text-[13px] text-blue-800">
                        {pickPasteFeedback}
                      </p>
                    )}
                  </div>

                  {/* Candidate list */}
                  <div className="rounded-xl ring-1 ring-inset ring-stone-200 overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pl-3.5 pr-2 py-1.5 bg-stone-50 border-b border-stone-200">
                      <span className="text-[13px] text-stone-700 tabular-nums">
                        <span className="font-semibold text-stone-950">{pickSelectedIds.length} selected</span> · {filteredCandidates.length} matching zaereen
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setPickSelectedIds((prev) =>
                              Array.from(new Set([...prev, ...filteredCandidates.map((c) => c.id)]))
                            )
                          }
                          disabled={filteredCandidates.length === 0}
                          className={`${btnSm.ghost} max-md:h-10 !text-brand-700`}
                        >
                          Select all ({filteredCandidates.length})
                        </button>
                        <button type="button" onClick={() => setPickSelectedIds([])} className={`${btnSm.ghost} max-md:h-10`}>
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto divide-y divide-stone-200">
                      {filteredCandidates.length > 0 ? (
                        filteredCandidates.slice(0, 150).map((c) => {
                          const checked = pickSelectedIds.includes(c.id);
                          return (
                            <label
                              key={c.id}
                              className={`flex items-center justify-between gap-3 px-3.5 py-2 min-h-11 cursor-pointer transition ${
                                checked ? 'bg-brand-50' : 'hover:bg-stone-50'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setPickSelectedIds((prev) =>
                                      prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                                    )
                                  }
                                  className="w-4 h-4 accent-brand-700 shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-stone-950 truncate">{c.applicantName}</div>
                                  <div className="text-[13px] text-stone-600 tabular-nums truncate">
                                    ITS {c.itsId || '—'} · Family {c.family || '—'} · {tourLabel(c.tourRefNo) || 'No tour'}
                                  </div>
                                </div>
                              </div>
                              <span className={`text-[13px] shrink-0 tabular-nums ${c.roomNumber ? 'font-medium text-stone-900' : 'text-stone-500'}`}>
                                {c.roomNumber ? `${c.building} ${c.roomNumber}` : 'Unallotted'}
                              </span>
                            </label>
                          );
                        })
                      ) : (
                        <p className="px-4 py-8 text-center text-sm text-stone-600">
                          {portalCandidates.length === 0
                            ? 'All portal zaereen are already in B→A. Use “Add new zair / paste ITS” to register more.'
                            : 'No zaereen match your search or tour filter.'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Payment and optional room */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                    <label className="block">
                      <span className={fieldLabel}>Money given status</span>
                      <select
                        value={pickMoneyGiven}
                        onChange={(e) => setPickMoneyGiven(e.target.value as MoneyGivenStatus)}
                        className={field}
                      >
                        <option value="No">Pending (collect at accounts)</option>
                        <option value="Yes">Yes (money already received)</option>
                      </select>
                    </label>

                    <div>
                      <label className="flex items-center gap-2 mb-1.5 text-[13px] font-medium text-stone-700 cursor-pointer min-h-5">
                        <input
                          type="checkbox"
                          checked={pickOverrideRoom}
                          onChange={(e) => setPickOverrideRoom(e.target.checked)}
                          className="w-4 h-4 accent-brand-700"
                        />
                        <span>Also assign or change hotel and room</span>
                      </label>
                      {pickOverrideRoom ? (
                        <div className="flex items-center gap-2">
                          <select
                            value={pickBuilding}
                            onChange={(e) => {
                              setPickBuilding(e.target.value);
                              setPickRoomNumber('');
                            }}
                            aria-label="Hotel"
                            className={`${field} !w-auto`}
                          >
                            {distinctBuildings.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                          <select
                            value={pickRoomNumber}
                            onChange={(e) => setPickRoomNumber(e.target.value)}
                            aria-label="Room"
                            className={`${field} flex-1 min-w-0 tabular-nums`}
                          >
                            <option value="">Pick room</option>
                            {vacantRoomsForPickOverride.map((rm) => (
                              <option key={rm.id} value={rm.roomNumber}>
                                Room {rm.roomNumber} ({getRoomBedCount(rm)} beds, cap {rm.capacity})
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <p className="h-10 flex items-center text-[13px] text-stone-600">
                          Keeps each selected zair’s existing room allotment.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-3.5">
                    <h4 className={sectionTitle}>1. Tour, dates and room</h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
                      <label className="block">
                        <span className={fieldLabel}>Tour ID{required}</span>
                        <input
                          type="text"
                          list="b2a-tour-ids"
                          placeholder="e.g. NZ-2026-TOUR-44"
                          value={newTourId}
                          onChange={(e) => handleTourIdChange(e.target.value)}
                          className={`${field} tabular-nums`}
                        />
                        <datalist id="b2a-tour-ids">
                          {existingTourIds.map((t) => (
                            <option key={t} value={t} />
                          ))}
                        </datalist>
                      </label>

                      <label className="block">
                        <span className={fieldLabel}>Office name</span>
                        <input
                          type="text"
                          value={newOfficeName}
                          onChange={(e) => setNewOfficeName(e.target.value)}
                          className={field}
                        />
                      </label>

                      <label className="block">
                        <span className={fieldLabel}>Date of arrival{required}</span>
                        <input
                          type="date"
                          value={newArrivalDate}
                          onChange={(e) => setNewArrivalDate(e.target.value)}
                          className={`${field} tabular-nums`}
                        />
                      </label>

                      <label className="block">
                        <span className={fieldLabel}>Date of departure{required}</span>
                        <input
                          type="date"
                          value={newDepartureDate}
                          onChange={(e) => setNewDepartureDate(e.target.value)}
                          className={`${field} tabular-nums`}
                        />
                      </label>

                      <label className="block">
                        <span className={fieldLabel}>Hotel / building</span>
                        <select
                          value={newBuilding}
                          onChange={(e) => {
                            setNewBuilding(e.target.value);
                            setNewRoomNumber('');
                          }}
                          className={field}
                        >
                          {distinctBuildings.map((bldg) => (
                            <option key={bldg} value={bldg}>
                              {bldg}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className={fieldLabel}>
                          Room given in <span className="font-normal text-stone-500">(optional · {calculatedNights} {calculatedNights === 1 ? 'night' : 'nights'})</span>
                        </span>
                        <select
                          value={newRoomNumber}
                          onChange={(e) => setNewRoomNumber(e.target.value)}
                          className={`${field} tabular-nums`}
                        >
                          <option value="">Room pending (allot later)</option>
                          {vacantRoomsForNewEntry.map((rm) => (
                            <option key={rm.id} value={rm.roomNumber}>
                              Room {rm.roomNumber} ({getRoomBedCount(rm)} beds, cap {rm.capacity})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  {/* Paste several ITS IDs, or enter one zair's details */}
                  <div className="space-y-3.5 pt-5 border-t border-stone-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className={sectionTitle}>2. Paste multiple ITS IDs (or enter single details)</h4>
                      {parsedNewBulk && parsedNewBulk.entries.length > 0 && (
                        <span className={chip('ok')}>{parsedNewBulk.entries.length} ITS ready</span>
                      )}
                    </div>

                    <textarea
                      rows={3}
                      value={newItsBulkText}
                      onChange={(e) => setNewItsBulkText(e.target.value)}
                      aria-label="ITS numbers to add"
                      placeholder="Paste multiple ITS numbers (new lines, spaces or commas) to add several B→A pax at once, or leave blank to fill single details below."
                      className={`${field} !h-auto py-2.5 leading-relaxed tabular-nums`}
                    />

                    {!newItsBulkText.trim() && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3.5">
                        <label className="block">
                          <span className={fieldLabel}>Number of pax</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={newPaxCount}
                            onChange={(e) => setNewPaxCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className={`${field} tabular-nums`}
                          />
                        </label>

                        <label className="block sm:col-span-2">
                          <span className={fieldLabel}>Applicant / head of pax name</span>
                          <input
                            type="text"
                            placeholder="e.g. Murtaza Bhai (optional)"
                            value={newApplicantName}
                            onChange={(e) => setNewApplicantName(e.target.value)}
                            className={field}
                          />
                        </label>

                        <label className="block">
                          <span className={fieldLabel}>ITS ID <span className="font-normal text-stone-500">(optional)</span></span>
                          <input
                            type="text"
                            placeholder="30482910"
                            value={newItsId}
                            onChange={(e) => setNewItsId(e.target.value)}
                            className={`${field} tabular-nums`}
                          />
                        </label>

                        <label className="block">
                          <span className={fieldLabel}>Family</span>
                          <input
                            type="text"
                            placeholder="1"
                            value={newFamily}
                            onChange={(e) => setNewFamily(e.target.value)}
                            className={`${field} tabular-nums`}
                          />
                        </label>

                        <label className="block">
                          <span className={fieldLabel}>Money given</span>
                          <select
                            value={newMoneyGiven}
                            onChange={(e) => setNewMoneyGiven(e.target.value as MoneyGivenStatus)}
                            className={field}
                          >
                            <option value="No">Pending</option>
                            <option value="Yes">Yes (received)</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className={modalFooter}>
              <button type="button" onClick={() => setIsShiftModalOpen(false)} className={`${btn.ghost} max-sm:order-last max-sm:w-full`}>
                Cancel
              </button>

              {modalMode === 'existing' ? (
                <>
                  <button
                    type="button"
                    disabled={pickSelectedIds.length === 0}
                    onClick={() => handleShiftSelectedExisting(false)}
                    className={`${btn.secondary} max-sm:flex-1`}
                  >
                    Save B→A ({pickSelectedIds.length})
                  </button>
                  <button
                    type="button"
                    disabled={pickSelectedIds.length === 0}
                    onClick={() => handleShiftSelectedExisting(true)}
                    className={`${btn.primary} max-sm:flex-1`}
                  >
                    <FileText className="w-4 h-4" />
                    <span>Shift ({pickSelectedIds.length}) and open slip</span>
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => handleSubmitNewShiftZaer(false)} className={`${btn.secondary} max-sm:flex-1`}>
                    Save only
                  </button>
                  <button type="button" onClick={() => handleSubmitNewShiftZaer(true)} className={`${btn.primary} max-sm:flex-1`}>
                    <FileText className="w-4 h-4" />
                    <span>Save and open B→A slip</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete a B→A entry (admin) */}
      {bToARecordToDelete && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-label="Delete B→A shift entry">
          <div className={`${modalCard} max-w-lg`}>
            <div className={modalHeader}>
              <h3 className={modalTitle}>Delete B→A shift entry?</h3>
              <button type="button" onClick={() => setBToARecordToDelete(null)} className={`${modalClose} max-md:w-10 max-md:h-10`} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 sm:px-6 py-5 space-y-4 overflow-y-auto">
              <div className="rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 mt-1 shrink-0 text-amber-700" />
                <div className="text-sm leading-relaxed text-amber-900">
                  <p className="font-semibold">This entry is in B to A. Do you want to delete it?</p>
                  <p className="mt-1 text-[13px]">
                    When a pax is added in B to A, it should not be deleted until deleted by the admin. Deleting removes their B to A shift status and frees up room{' '}
                    <span className="font-semibold tabular-nums">
                      {bToARecordToDelete.building} {bToARecordToDelete.roomNumber || ''}
                    </span>
                    .
                  </p>
                </div>
              </div>

              <dl className={`${panel} px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm`}>
                <div className="col-span-2">
                  <dt className="text-xs text-stone-600">Zair</dt>
                  <dd className="mt-0.5 font-semibold text-stone-950">{bToARecordToDelete.applicantName}</dd>
                  <dd className="text-[13px] text-stone-600 tabular-nums">ITS {bToARecordToDelete.itsId}</dd>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-xs text-stone-600">Tour ID</dt>
                  <dd className="mt-0.5 text-stone-900 tabular-nums break-words">{tourLabel(bToARecordToDelete.tourRefNo) || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-600">Room</dt>
                  <dd className="mt-0.5 text-stone-900 tabular-nums">
                    {bToARecordToDelete.building} {bToARecordToDelete.roomNumber || 'unassigned'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-600">Payment</dt>
                  <dd className="mt-1">
                    <span className={chip(bToARecordToDelete.moneyGiven === 'Yes' ? 'ok' : 'wait')}>
                      {bToARecordToDelete.moneyGiven === 'Yes' ? 'Paid' : 'Pending'}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>

            <div className={modalFooter}>
              <button type="button" onClick={() => setBToARecordToDelete(null)} className={`${btn.secondary} max-sm:flex-1`}>
                No, keep in B to A
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteReservation) {
                    onDeleteReservation(bToARecordToDelete.id);
                  } else if (onToggleShiftToCategoryA) {
                    onToggleShiftToCategoryA(bToARecordToDelete.id, false);
                  }
                  setBToARecordToDelete(null);
                }}
                className={`${btnDanger} max-sm:flex-1`}
              >
                <Trash2 className="w-4 h-4" />
                <span>Yes, delete B to A entry</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deleting is blocked for the receptionist role */}
      {bToABlockedNotice && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-label="Deletion blocked">
          <div className={`${modalCard} max-w-md`}>
            <div className={modalHeader}>
              <h3 className={`${modalTitle} flex items-center gap-2`}>
                <ShieldAlert className="w-5 h-5 shrink-0 text-rose-600" />
                Deletion blocked: B to A record
              </h3>
              <button type="button" onClick={() => setBToABlockedNotice(null)} className={`${modalClose} max-md:w-10 max-md:h-10`} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 sm:px-6 py-5 space-y-3 text-sm leading-relaxed text-stone-700">
              <p>
                Only an admin can delete this. When a pax is added in <span className="font-semibold text-stone-950">B to A</span>, it{' '}
                <span className="font-semibold text-stone-950">should not be deleted until deleted by the admin</span>.
              </p>
              <p className={`${panel} px-3.5 py-2.5 text-[13px]`}>
                Please switch to <span className="font-semibold text-stone-950">Admin role</span> using your Admin PIN to authorize deletion of B to A records.
              </p>
            </div>

            <div className={modalFooter}>
              <button type="button" onClick={() => setBToABlockedNotice(null)} className={btn.primary}>
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
