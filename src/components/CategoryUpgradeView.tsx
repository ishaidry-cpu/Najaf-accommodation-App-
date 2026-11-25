import React, { useState, useMemo } from 'react';
import {
  ArrowUpRight,
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
import { PageHeader, btn } from './ui';

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
      return <ArrowUpDown className="w-3.5 h-3.5 text-stone-400 inline ml-1 opacity-40 hover:opacity-100" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-[#0f4a37] inline ml-1 font-bold" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-[#0f4a37] inline ml-1 font-bold" />
    );
  };

  const handleInitiateDelete = (res: Reservation) => {
    if (userRole !== 'admin') {
      setBToABlockedNotice(res);
      return;
    }
    setBToARecordToDelete(res);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="B→A shifts"
        description="Shift zaereen from category B to A, mark payment received, and print accounts slips."
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-stone-600 tabular-nums">
            <span>
              <span className="font-semibold text-stone-950">{totalShifts}</span> shifts
            </span>
            <span>·</span>
            <span>
              <span className="font-semibold text-emerald-700">{moneyGivenCount}</span> paid
            </span>
            <span>·</span>
            <span>
              <span className="font-semibold text-amber-700">{moneyPendingCount}</span> awaiting payment
            </span>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {onOpenBToASlipForIds && shiftRequests.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenBToASlipForIds(shiftRequests.map((r) => r.id))}
                className={btn.secondary}
              >
                <FileText className="w-4 h-4 text-[#0f4a37]" />
                All B→A slips ({shiftRequests.length})
              </button>
            )}
            {onOpenAToBSlip && (
              <button type="button" onClick={onOpenAToBSlip} className={btn.secondary}>
                <FileText className="w-4 h-4 text-amber-700" />
                A→B slip
              </button>
            )}
            {(onAddZaer || onToggleShiftToCategoryA || onBatchShiftToCategoryA) && (
              <button type="button" onClick={handleOpenShiftModal} className={btn.primary}>
                <Plus className="w-4 h-4 text-gold-200" />
                Add B→A shift
              </button>
            )}
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <div className="bg-white border border-[#e2e8e5] rounded-xl p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-3 sm:top-2.5 text-stone-400" />
            <input
              type="text"
              placeholder="Search by ITS ID, Applicant Name, Family, Tour Ref..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-0 bg-[#f6f8f7] border border-stone-300 rounded-lg pl-9 pr-3 py-2 sm:py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            />
          </div>

          <select
            value={moneyFilter}
            onChange={(e) => setMoneyFilter(e.target.value as 'ALL' | 'Yes' | 'No')}
            className="min-h-[44px] sm:min-h-0 bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-2 sm:py-1.5 text-xs font-semibold text-stone-800"
          >
            <option value="ALL">All Payment States</option>
            <option value="Yes">Money Given: Yes (Received)</option>
            <option value="No">Money Given: No (Pending)</option>
          </select>

          <select
            value={hotelFilter}
            onChange={(e) => setHotelFilter(e.target.value)}
            className="min-h-[44px] sm:min-h-0 bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-2 sm:py-1.5 text-xs font-semibold text-stone-800"
          >
            <option value="ALL">All Hotels</option>
            {distinctBuildings.map((bldg) => (
              <option key={bldg} value={bldg}>
                {bldg} Hotel
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mobile Cards View (md:hidden) */}
      <div className="md:hidden space-y-2.5">
        {filteredAndSortedRequests.length > 0 ? (
          filteredAndSortedRequests.map((res) => {
            const isPaid = res.moneyGiven === 'Yes';
            return (
              <div key={res.id} className="bg-white border border-[#e2e8e5] rounded-2xl p-3.5 shadow-2xs space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold text-stone-950 truncate">{res.applicantName}</h3>
                    <div className="text-xs font-mono text-stone-600 tabular-nums mt-0.5">
                      ITS {res.itsId} · {res.age}y {res.gender === 'Female' ? 'F' : 'M'} · Fam #{res.family}
                    </div>
                  </div>
                  <span className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-extrabold text-[#0f4a37] tabular-nums">
                    {res.building} {res.roomNumber ? `Rm ${res.roomNumber}` : 'Pending'}
                  </span>
                </div>

                <div className="bg-[#f6f8f7] border border-[#e2e8e5] rounded-xl px-3 py-2 text-xs space-y-1">
                  <div className="font-mono font-bold text-[#0f4a37] break-all">
                    Tour: {res.tourRefNo || '—'}
                  </div>
                  <div className="text-stone-700 font-semibold">Office: {res.officeName || '—'}</div>
                  <div className="text-[11px] text-stone-600 tabular-nums">
                    Stay: {res.arrivalDate?.slice(0, 10) || '—'} ➔ {res.departureDate?.slice(0, 10) || '—'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onToggleMoneyGiven(res.id, isPaid ? 'No' : 'Yes')}
                    className={`flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      isPaid
                        ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                        : 'bg-amber-600 hover:bg-amber-700 text-white'
                    }`}
                  >
                    {isPaid ? <CheckCircle2 className="w-4 h-4 text-[#ecdcae]" /> : <Clock className="w-4 h-4" />}
                    <span>{isPaid ? 'Money: Yes' : 'Money: Pending'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenAccountsSlip(res)}
                    className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-[#f6f8f7] hover:bg-stone-200/80 text-[#0f4a37] border border-[#0f4a37]/30 transition cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Request Slip</span>
                  </button>

                  {(onDeleteReservation || onToggleShiftToCategoryA) && (
                    <button
                      type="button"
                      onClick={() => handleInitiateDelete(res)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-stone-200 bg-stone-50 hover:bg-red-50 text-stone-500 hover:text-red-700 transition cursor-pointer"
                      title="Delete or Revert B to A record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white border border-[#e2e8e5] rounded-2xl p-8 text-center text-stone-500 text-sm">
            No B→A shifts yet. Tap <strong>Add B→A shift</strong> to pick existing zaereen or add new ones.
          </div>
        )}
      </div>

      {/* Requests Table (Desktop View) */}
      <div className="hidden md:block bg-white border border-[#e2e8e5] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-stone-50 text-stone-600 border-b border-stone-200 uppercase text-xs tracking-wider font-medium select-none">
              <tr>
                <th
                  onClick={() => handleSort('itsId')}
                  className="py-3.5 px-3 cursor-pointer hover:bg-stone-100 transition min-w-[115px]"
                >
                  <div className="flex items-center">
                    <span>ITS ID</span>
                    {renderSortIndicator('itsId')}
                  </div>
                </th>

                <th
                  onClick={() => handleSort('applicantName')}
                  className="py-3.5 px-3.5 cursor-pointer hover:bg-stone-100 transition min-w-[185px]"
                >
                  <div className="flex items-center">
                    <span>Applicant Name</span>
                    {renderSortIndicator('applicantName')}
                  </div>
                </th>

                <th className="py-3.5 px-2 text-center min-w-[65px]">Age / Sex</th>

                <th
                  onClick={() => handleSort('family')}
                  className="py-3.5 px-3 cursor-pointer hover:bg-stone-100 transition min-w-[85px]"
                >
                  <div className="flex items-center">
                    <span>Family</span>
                    {renderSortIndicator('family')}
                  </div>
                </th>

                <th
                  onClick={() => handleSort('tourRefNo')}
                  className="py-3.5 px-3.5 cursor-pointer hover:bg-stone-100 transition min-w-[200px] max-w-[290px]"
                >
                  <div className="flex items-center">
                    <span>Tour Reference No.</span>
                    {renderSortIndicator('tourRefNo')}
                  </div>
                </th>

                <th className="py-3.5 px-3.5 min-w-[165px]">Office Name</th>
                <th className="py-3.5 px-3 min-w-[120px]">Stay Dates</th>
                <th
                  onClick={() => handleSort('building')}
                  className="py-3.5 px-3 cursor-pointer hover:bg-stone-100 transition min-w-[135px]"
                >
                  <div className="flex items-center">
                    <span>Hotel &amp; Room</span>
                    {renderSortIndicator('building')}
                  </div>
                </th>

                <th
                  onClick={() => handleSort('moneyGiven')}
                  className="py-3.5 px-3 text-center bg-stone-100 cursor-pointer hover:bg-stone-200/70 transition min-w-[140px]"
                >
                  <div className="flex items-center justify-center">
                    <span>Money Given</span>
                    {renderSortIndicator('moneyGiven')}
                  </div>
                </th>

                <th className="py-3.5 px-3 text-center min-w-[130px]">Accounts Slip</th>

                {(onDeleteReservation || onToggleShiftToCategoryA) && (
                  <th className="py-3.5 px-2 text-center w-16">Remove</th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-stone-100 text-stone-900 text-sm">
              {filteredAndSortedRequests.length > 0 ? (
                filteredAndSortedRequests.map((res) => {
                  const isPaid = res.moneyGiven === 'Yes';
                  return (
                    <tr key={res.id} className="hover:bg-[#f6f8f7] transition">
                      <td className="py-3 px-3 font-mono font-bold text-stone-950 tabular-nums">
                        {res.itsId}
                      </td>

                      <td className="py-3 px-3.5 whitespace-normal break-words font-bold text-stone-950">
                        <div>{res.applicantName}</div>
                        {res.jamaat && <div className="text-xs text-stone-500 font-normal">{res.jamaat}</div>}
                      </td>

                      <td className="py-3 px-2 text-center text-stone-700 font-semibold text-xs tabular-nums">
                        {res.age} / {res.gender === 'Female' ? 'F' : 'M'}
                      </td>

                      <td className="py-3 px-3 font-mono font-extrabold text-emerald-900 tabular-nums">
                        {res.family}
                      </td>

                      <td className="py-3 px-3.5 whitespace-normal break-words break-all font-mono font-bold text-stone-950 min-w-[200px] max-w-[290px] leading-relaxed">
                        {res.tourRefNo}
                      </td>

                      <td className="py-3 px-3.5 whitespace-normal break-words text-stone-700 text-xs font-medium min-w-[165px]">
                        {res.officeName}
                      </td>

                      <td className="py-3 px-3 text-stone-800 text-xs font-medium tabular-nums">
                        <div>{res.arrivalDate}</div>
                        <div className="text-[11px] text-stone-500">to {res.departureDate}</div>
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-bold text-[#0f4a37] text-xs tabular-nums">
                          {res.building} {res.roomNumber ? `Rm ${res.roomNumber}` : '(Room Pending)'}
                        </span>
                        {res.paxCount && res.paxCount > 1 && (
                          <div className="text-[11px] text-amber-800 font-semibold mt-0.5 tabular-nums">
                            {res.paxCount} Pax
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-center bg-stone-50/60">
                        <button
                          type="button"
                          onClick={() => onToggleMoneyGiven(res.id, isPaid ? 'No' : 'Yes')}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer whitespace-nowrap ${
                            isPaid
                              ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                              : 'bg-amber-600 hover:bg-amber-700 text-white'
                          }`}
                        >
                          {isPaid ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#ecdcae]" />
                              <span>Yes (Received)</span>
                            </>
                          ) : (
                            <>
                              <Clock className="w-3.5 h-3.5" />
                              <span>No (Pending)</span>
                            </>
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => onOpenAccountsSlip(res)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#f6f8f7] hover:bg-stone-200/80 text-[#0f4a37] border border-[#0f4a37]/30 transition shadow-2xs cursor-pointer whitespace-nowrap"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Request Slip</span>
                        </button>
                      </td>

                      {(onDeleteReservation || onToggleShiftToCategoryA) && (
                        <td className="py-3 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleInitiateDelete(res)}
                            className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-700 transition cursor-pointer"
                            title="Delete or Revert B to A record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-stone-500 text-sm">
                    No B→A shift requests yet. Click <strong>Add B→A shift</strong> above to pick existing zaereen or register new ones.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Easy B -> A Shift Modal (Supports Picking Existing Zaereen OR Paste ITS OR Adding New) */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/45 backdrop-blur-[2px]">
          <div className="bg-[#f6f8f7] border border-[#e2e8e5] rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="bg-[#0f4a37] text-white p-4 sm:p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-800/80 rounded-xl">
                  <ArrowUpRight className="w-5 h-5 text-[#ecdcae]" />
                </div>
                <div>
                  <h3 className="font-bold text-base sm:text-lg">Add B ➔ A Shift</h3>
                  <p className="text-xs text-[#ecdcae]/90 mt-0.5">
                    Pick existing zaereen by search/ITS paste, or register new zaereen shifting from B to A
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsShiftModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switch Tabs */}
            <div className="bg-white border-b border-stone-200 px-4 py-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFormError('');
                  setModalMode('existing');
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                  modalMode === 'existing'
                    ? 'bg-[#0f4a37] text-white shadow-2xs'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Pick Existing Zaereen ({portalCandidates.length})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormError('');
                  setModalMode('new');
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                  modalMode === 'new'
                    ? 'bg-[#0f4a37] text-white shadow-2xs'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Zaer / Paste ITS</span>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-center gap-2 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{formError}</span>
                </div>
              )}

              {modalMode === 'existing' ? (
                <div className="space-y-3.5">
                  {/* Search & Tour filter */}
                  <div className="bg-white border border-stone-200 rounded-xl p-3 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-7 relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-stone-400" />
                        <input
                          type="text"
                          value={pickSearch}
                          onChange={(e) => setPickSearch(e.target.value)}
                          placeholder="Search by Name, ITS ID, Tour ID, Family #..."
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#0f4a37]"
                        />
                      </div>
                      <div className="sm:col-span-5">
                        <select
                          value={pickTourFilter}
                          onChange={(e) => setPickTourFilter(e.target.value)}
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-800"
                        >
                          <option value="ALL">All Tours ({portalCandidates.length})</option>
                          {candidateTours.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Quick Paste ITS to Auto-Select */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 border-t border-stone-100">
                      <div className="flex-1 flex items-center gap-2">
                        <ClipboardPaste className="w-3.5 h-3.5 text-[#0f4a37] shrink-0" />
                        <input
                          type="text"
                          value={pickItsPaste}
                          onChange={(e) => setPickItsPaste(e.target.value)}
                          placeholder="Quick match by ITS: paste ITS IDs separated by space/comma..."
                          className="flex-1 bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1 font-mono text-xs text-stone-900"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleMatchPastedItsInPortal}
                        disabled={!pickItsPaste.trim()}
                        className="px-3 py-1.5 rounded-lg bg-stone-200 hover:bg-stone-300 disabled:opacity-40 text-stone-900 font-bold cursor-pointer whitespace-nowrap"
                      >
                        Match &amp; Select
                      </button>
                    </div>

                    {pickPasteFeedback && (
                      <div className="text-[11px] font-semibold text-[#0f4a37] bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                        {pickPasteFeedback}
                      </div>
                    )}
                  </div>

                  {/* Candidate List */}
                  <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-stone-50 border-b border-stone-200">
                      <span className="font-bold text-stone-800 tabular-nums">
                        {pickSelectedIds.length} selected · {filteredCandidates.length} matching zaereen
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setPickSelectedIds((prev) =>
                              Array.from(new Set([...prev, ...filteredCandidates.map((c) => c.id)]))
                            )
                          }
                          disabled={filteredCandidates.length === 0}
                          className="text-xs font-bold text-[#0f4a37] hover:underline disabled:opacity-40 cursor-pointer"
                        >
                          Select All ({filteredCandidates.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setPickSelectedIds([])}
                          className="text-xs font-semibold text-stone-500 hover:text-stone-800 cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="max-h-56 overflow-y-auto divide-y divide-stone-100">
                      {filteredCandidates.length > 0 ? (
                        filteredCandidates.slice(0, 150).map((c) => {
                          const checked = pickSelectedIds.includes(c.id);
                          return (
                            <label
                              key={c.id}
                              className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition ${
                                checked ? 'bg-emerald-50/70' : 'hover:bg-stone-50'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setPickSelectedIds((prev) =>
                                      prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                                    )
                                  }
                                  className="w-4 h-4 rounded accent-[#0f4a37] shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="font-bold text-stone-900 truncate">{c.applicantName}</div>
                                  <div className="text-[11px] text-stone-600 font-mono tabular-nums truncate">
                                    ITS {c.itsId || '—'} · Fam #{c.family || '—'} · {c.tourRefNo || 'No Tour'}
                                  </div>
                                </div>
                              </div>
                              <span className="text-[11px] font-semibold text-[#0f4a37] shrink-0 tabular-nums">
                                {c.roomNumber ? `${c.building} Rm ${c.roomNumber}` : 'Unallotted'}
                              </span>
                            </label>
                          );
                        })
                      ) : (
                        <div className="py-8 text-center text-stone-500">
                          {portalCandidates.length === 0
                            ? 'All portal zaereen are already in B→A. Use "Add New Zaer / Paste ITS" to register more.'
                            : 'No zaereen match your search filter.'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Payment & Optional Room Assignment */}
                  <div className="bg-white border border-stone-200 rounded-xl p-3 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold text-stone-700 mb-1">Money Given Status</label>
                        <select
                          value={pickMoneyGiven}
                          onChange={(e) => setPickMoneyGiven(e.target.value as MoneyGivenStatus)}
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1.5 font-semibold text-stone-900"
                        >
                          <option value="No">Pending (Collect at Accounts)</option>
                          <option value="Yes">Yes (Money Already Received)</option>
                        </select>
                      </div>

                      <div>
                        <label className="flex items-center gap-2 font-bold text-stone-700 mb-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pickOverrideRoom}
                            onChange={(e) => setPickOverrideRoom(e.target.checked)}
                            className="w-4 h-4 accent-[#0f4a37]"
                          />
                          <span>Also assign/change Hotel &amp; Room</span>
                        </label>
                        {pickOverrideRoom ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={pickBuilding}
                              onChange={(e) => {
                                setPickBuilding(e.target.value);
                                setPickRoomNumber('');
                              }}
                              className="bg-[#f6f8f7] border border-stone-300 rounded-lg px-2 py-1.5 font-bold text-[#0f4a37]"
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
                              className="flex-1 bg-[#f6f8f7] border border-stone-300 rounded-lg px-2 py-1.5 font-mono font-bold text-stone-900"
                            >
                              <option value="">-- Pick Room --</option>
                              {vacantRoomsForPickOverride.map((rm) => (
                                <option key={rm.id} value={rm.roomNumber}>
                                  Rm {rm.roomNumber} ({getRoomBedCount(rm)} beds, cap {rm.capacity})
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="text-[11px] text-stone-500 pt-1">
                            Keeps each selected zair’s existing room allotment.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3.5">
                  <div className="bg-white border border-stone-200 rounded-xl p-3.5 space-y-3">
                    <div className="text-xs font-bold text-[#0f4a37] uppercase tracking-wider border-b border-stone-100 pb-1">
                      1. Tour, Dates &amp; Room
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold text-stone-800 mb-1">
                          Tour ID <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          list="b2a-tour-ids"
                          placeholder="e.g. NZ-2026-TOUR-44"
                          value={newTourId}
                          onChange={(e) => handleTourIdChange(e.target.value)}
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[#0f4a37]"
                        />
                        <datalist id="b2a-tour-ids">
                          {existingTourIds.map((t) => (
                            <option key={t} value={t} />
                          ))}
                        </datalist>
                      </div>

                      <div>
                        <label className="block font-bold text-stone-800 mb-1">Office Name</label>
                        <input
                          type="text"
                          value={newOfficeName}
                          onChange={(e) => setNewOfficeName(e.target.value)}
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0f4a37]"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-stone-800 mb-1">
                          Date of arrival <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          value={newArrivalDate}
                          onChange={(e) => setNewArrivalDate(e.target.value)}
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-medium tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-stone-800 mb-1">
                          Date of departure <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          value={newDepartureDate}
                          onChange={(e) => setNewDepartureDate(e.target.value)}
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-medium tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-stone-800 mb-1">Hotel / Building</label>
                        <select
                          value={newBuilding}
                          onChange={(e) => {
                            setNewBuilding(e.target.value);
                            setNewRoomNumber('');
                          }}
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-semibold"
                        >
                          {distinctBuildings.map((bldg) => (
                            <option key={bldg} value={bldg}>
                              {bldg} Hotel
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block font-bold text-stone-800 mb-1">
                          Room given in <span className="text-stone-400 font-normal">(Optional · {calculatedNights} Nights)</span>
                        </label>
                        <select
                          value={newRoomNumber}
                          onChange={(e) => setNewRoomNumber(e.target.value)}
                          className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-bold"
                        >
                          <option value="">Room Pending (Allot Later)</option>
                          {vacantRoomsForNewEntry.map((rm) => (
                            <option key={rm.id} value={rm.roomNumber}>
                              Room {rm.roomNumber} ({getRoomBedCount(rm)} beds, cap {rm.capacity})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Quick Paste Multiple ITS IDs OR Enter Single/Pax Count */}
                  <div className="bg-white border border-stone-200 rounded-xl p-3.5 space-y-3">
                    <div className="flex items-center justify-between border-b border-stone-100 pb-1">
                      <span className="text-xs font-bold text-[#0f4a37] uppercase tracking-wider">
                        2. Paste Multiple ITS IDs (or Enter Single Details)
                      </span>
                      {parsedNewBulk && parsedNewBulk.entries.length > 0 && (
                        <span className="font-bold text-emerald-700 tabular-nums">
                          {parsedNewBulk.entries.length} ITS ready
                        </span>
                      )}
                    </div>

                    <textarea
                      rows={3}
                      value={newItsBulkText}
                      onChange={(e) => setNewItsBulkText(e.target.value)}
                      placeholder="Paste multiple ITS numbers (newlines, spaces, or commas) to add multiple B→A pax at once, OR leave blank to fill single details below..."
                      className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-2 font-mono text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#0f4a37]"
                    />

                    {!newItsBulkText.trim() && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">Number of pax</label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={newPaxCount}
                            onChange={(e) => setNewPaxCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 font-bold tabular-nums"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-semibold text-stone-700 mb-1">
                            Applicant / Head of Pax Name
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Murtaza Bhai (optional)"
                            value={newApplicantName}
                            onChange={(e) => setNewApplicantName(e.target.value)}
                            className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">ITS ID (Optional)</label>
                          <input
                            type="text"
                            placeholder="30482910"
                            value={newItsId}
                            onChange={(e) => setNewItsId(e.target.value)}
                            className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 font-mono"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">Family #</label>
                          <input
                            type="text"
                            placeholder="1"
                            value={newFamily}
                            onChange={(e) => setNewFamily(e.target.value)}
                            className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 font-mono"
                          />
                        </div>

                        <div>
                          <label className="block font-semibold text-stone-700 mb-1">Money Given</label>
                          <select
                            value={newMoneyGiven}
                            onChange={(e) => setNewMoneyGiven(e.target.value as MoneyGivenStatus)}
                            className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 font-semibold"
                          >
                            <option value="No">Pending</option>
                            <option value="Yes">Yes (Received)</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-white px-4 py-3 border-t border-stone-200 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsShiftModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-stone-300 hover:bg-stone-100 text-stone-700 font-bold text-xs transition cursor-pointer"
              >
                Cancel
              </button>

              {modalMode === 'existing' ? (
                <>
                  <button
                    type="button"
                    disabled={pickSelectedIds.length === 0}
                    onClick={() => handleShiftSelectedExisting(false)}
                    className="px-4 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 disabled:opacity-40 text-stone-900 font-bold text-xs transition cursor-pointer"
                  >
                    Save B→A ({pickSelectedIds.length})
                  </button>
                  <button
                    type="button"
                    disabled={pickSelectedIds.length === 0}
                    onClick={() => handleShiftSelectedExisting(true)}
                    className="px-5 py-2 rounded-xl bg-[#0f4a37] hover:bg-[#0b3a2b] disabled:opacity-40 text-white font-bold text-xs transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#ecdcae]" />
                    <span>Shift ({pickSelectedIds.length}) &amp; Open B→A Slip</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleSubmitNewShiftZaer(false)}
                    className="px-4 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-900 font-bold text-xs transition cursor-pointer"
                  >
                    Save Only
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmitNewShiftZaer(true)}
                    className="px-5 py-2 rounded-xl bg-[#0f4a37] hover:bg-[#0b3a2b] text-white font-bold text-xs transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#ecdcae]" />
                    <span>Save &amp; Open B→A Slip</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* B to A Entry Deletion Modal */}
      {bToARecordToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/45 backdrop-blur-[2px] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-lg w-full overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-amber-700">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] font-bold text-purple-900 uppercase tracking-wide mb-0.5">
                  B to A Registry Protected
                </div>
                <h3 className="text-base sm:text-lg font-bold text-stone-900">Delete B to A Shift Entry</h3>
              </div>
              <button
                type="button"
                onClick={() => setBToARecordToDelete(null)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-950 font-bold text-sm">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                <span>This entry is in B to A. Do you want to delete it?</span>
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">
                When a pax is added in B to A, it should not be deleted until deleted by the admin. Deleting removes their B to A shift status and frees up room{' '}
                <strong>
                  {bToARecordToDelete.building}{' '}
                  {bToARecordToDelete.roomNumber ? `Rm ${bToARecordToDelete.roomNumber}` : ''}
                </strong>
                .
              </p>
            </div>

            <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 text-xs space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-stone-900 text-sm">{bToARecordToDelete.applicantName}</div>
                  <div className="font-mono text-stone-500 text-[11px]">ITS ID: {bToARecordToDelete.itsId}</div>
                </div>
                <span className="font-mono text-xs font-bold text-[#0f4a37]">
                  Tour: {bToARecordToDelete.tourRefNo}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-stone-600 text-[11px] pt-1">
                <div>
                  Room:{' '}
                  <strong className="text-stone-900">
                    {bToARecordToDelete.building} Rm {bToARecordToDelete.roomNumber || 'Unassigned'}
                  </strong>
                </div>
                <div>
                  Payment:{' '}
                  <strong className="text-stone-900">
                    {bToARecordToDelete.moneyGiven === 'Yes' ? 'Paid ✓' : 'Pending'}
                  </strong>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setBToARecordToDelete(null)}
                className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 font-bold text-xs transition cursor-pointer"
              >
                No, Keep in B to A
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
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Yes, Delete B to A Entry</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocked Modal for Non-Admin */}
      {bToABlockedNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/45 backdrop-blur-[2px] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-md w-full overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-red-600">
                <ShieldAlert className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] font-bold text-red-800 uppercase tracking-wide mb-0.5">
                  Admin Only Permission
                </div>
                <h3 className="text-base font-bold text-stone-900">Deletion Blocked: B to A Record</h3>
                <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                  When a pax is added in <strong>B to A</strong>, it{' '}
                  <strong>should not be deleted until deleted by the admin</strong>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBToABlockedNotice(null)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              Please switch to <strong>Admin role</strong> using your Admin PIN to authorize deletion of B to A records.
            </div>

            <div className="flex justify-end pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setBToABlockedNotice(null)}
                className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-900 text-white font-bold text-xs transition cursor-pointer"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
