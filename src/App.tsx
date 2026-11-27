/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Building2, 
  BedDouble, 
  CalendarDays, 
  ArrowUpRight, 
  BarChart3, 
  FileSpreadsheet, 
  FileText, 
  CheckCircle2, 
  AlertCircle,
  X,
  Upload,
  Printer,
  Download,
  Clock,
  RefreshCw
} from 'lucide-react';

import { 
  Reservation, 
  Room, 
  PaymentStatus, 
  MoneyGivenStatus, 
  RoomStatus,
  DEFAULT_ZAEREEN_CATEGORIES,
  UserRole
} from './types';
import { 
  getStoredCategories,
  isRoomBookedForDuration,
  getStoredUserRole,
  saveStoredUserRole,
  getStoredAdminPin,
  checkRoomAllotmentAvailability,
  isInfant,
  countEffectivePax,
  getRoomBookingsForDuration,
  deduplicateRooms,
  getCanonicalRoomKey,
  mergeRoomsIntoInventory,
  normalizeBuildingName,
  normalizeRoomNumber
} from './services/storage';
import { downloadSampleExcelTemplate } from './services/excelService';
import { 
  deduplicateForAppend, 
  deduplicateReservationList, 
  isDuplicateReservation 
} from './utils/deduplication';
import { subscribeToMultiWindowSync } from './utils/multiWindowSync';

import { Navbar, type AppTab } from './components/Navbar';
import { btn, modalScrim, modalCard, modalHeader, modalTitle, modalClose, modalFooter } from './components/ui';
import { NkerpSyncView } from './components/NkerpSyncView';
import { NajafEmailsView } from './components/NajafEmailsView';
import { useNajafEmails } from './hooks/useNajafEmails';
import { SyncAccessKeyModal } from './components/SyncAccessKeyModal';
import { useNkerpSync } from './hooks/useNkerpSync';
import { Dashboard } from './components/Dashboard';
import { ReservationsView } from './components/ReservationsView';
import { CategoryUpgradeView } from './components/CategoryUpgradeView';
import { RoomsManagementView } from './components/RoomsManagementView';
import { AllocationPlannerView, type PlanAllocationItem } from './components/AllocationPlannerView';
import { ApprovalsView } from './components/ApprovalsView';
import { SlipRecordsPanel } from './components/SlipRecordsPanel';
import { ExcelUploadModal } from './components/ExcelUploadModal';
import { ReceptionDailySlipModal } from './components/ReceptionDailySlipModal';
import { AccountsRequestSlipModal } from './components/AccountsRequestSlipModal';
import { CategoriesModal } from './components/CategoriesModal';
import { PdfExportModal } from './components/PdfExportModal';
import { PdfExportOptions } from './services/pdfExport';
import { RoleManagementModal } from './components/RoleManagementModal';
import { QuickRoomAllotModal } from './components/QuickRoomAllotModal';
import { SwitchRoomModal, SwitchRoomTarget } from './components/SwitchRoomModal';
import { AddZaerModal } from './components/AddZaerModal';
import { AddTourGroupModal } from './components/AddTourGroupModal';
import { AddBuildingAndRoomsModal } from './components/AddBuildingAndRoomsModal';
import { checkManualRoomRules, normalizeRules, type PlannerRules } from './services/allocationRules';
import { loadAccommodation, saveChanges, fetchBackendStatus, pullNkerp, resetBackendRooms, saveBackendSettings, type PullStatus } from './services/api';
import { exportRoomAllocation } from './services/excelService';

export default function App() {
  // Navigation tabs: dashboard | reservations | upgrades | rooms
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');

  // Core Data
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<string[]>(DEFAULT_ZAEREEN_CATEGORIES);

  // Live Backend Connection Status
  const [isLiveBackendConnected, setIsLiveBackendConnected] = useState<boolean>(false);

  // User Role & Permissions (Admin: editable, Receptionist: view-only)
  const [userRole, setUserRole] = useState<UserRole>(() => getStoredUserRole());
  const [adminPin, setAdminPin] = useState<string>(() => getStoredAdminPin());
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [quickAllotTarget, setQuickAllotTarget] = useState<Reservation | null>(null);
  const [switchRoomTarget, setSwitchRoomTarget] = useState<SwitchRoomTarget | null>(null);

  const [pullStatus, setPullStatus] = useState<PullStatus | null>(null);
  /** NKERP stays the app hides because they were deleted here. */
  const [hiddenStays, setHiddenStays] = useState(0);
  const [manualPullRunning, setManualPullRunning] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const [isSaving, setIsSaving] = useState(false);
  const dataVersion = useRef(0);
  const reservationsRef = useRef<Reservation[]>([]);
  const roomsRef = useRef<Room[]>([]);

  // Modals state
  const [isExcelUploadOpen, setIsExcelUploadOpen] = useState(false);
  const [isReceptionSlipOpen, setIsReceptionSlipOpen] = useState(false);
  const [receptionSlipInitialTab, setReceptionSlipInitialTab] = useState<
    'arrival_slip' | 'departure_list' | 'turnover' | 'roster' | 'worker_summary' | 'portal_upload'
  >('arrival_slip');

  const handleOpenReceptionSlip = (
    tab: 'arrival_slip' | 'departure_list' | 'turnover' | 'roster' | 'worker_summary' | 'portal_upload' = 'arrival_slip'
  ) => {
    setReceptionSlipInitialTab(tab);
    setIsReceptionSlipOpen(true);
  };
  const [activeAccountsSlipReservation, setActiveAccountsSlipReservation] = useState<Reservation | null>(null);
  const [isAccountsSlipOpen, setIsAccountsSlipOpen] = useState(false);
  const [accountsSlipDirection, setAccountsSlipDirection] = useState<'B_TO_A' | 'A_TO_B'>('B_TO_A');
  const [accountsSlipInitialIds, setAccountsSlipInitialIds] = useState<string[] | undefined>(undefined);

  const handleOpenAccountsSlipModal = (
    res: Reservation | null,
    direction: 'B_TO_A' | 'A_TO_B' = 'B_TO_A',
    selectedIds?: string[]
  ) => {
    setActiveAccountsSlipReservation(res);
    setAccountsSlipDirection(direction);
    setAccountsSlipInitialIds(selectedIds);
    setIsAccountsSlipOpen(true);
  };
  const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [pdfModalInitialReportType, setPdfModalInitialReportType] = useState<PdfExportOptions['reportType']>('all_reservations');
  const [pdfModalInitialTourId, setPdfModalInitialTourId] = useState<string>('ALL');

  const handleOpenPdfModal = (
    reportType: PdfExportOptions['reportType'] = 'all_reservations',
    tourId: string = 'ALL'
  ) => {
    setPdfModalInitialReportType(reportType);
    setPdfModalInitialTourId(tourId);
    setIsPdfModalOpen(true);
  };
  const [isAddZaerOpen, setIsAddZaerOpen] = useState(false);
  const [isAddTourGroupOpen, setIsAddTourGroupOpen] = useState(false);
  const [isAddBuildingRoomsOpen, setIsAddBuildingRoomsOpen] = useState(false);
  // Notice dialog for allocation confirmation (Same-day turnover hour difference & Room not vacant force allocation)
  const [allocationNotice, setAllocationNotice] = useState<{
    title: string;
    message: string;
    diffHoursText?: string;
    isSameDayTurnover?: boolean;
    isRoomNotVacant?: boolean;
    roomNumber: string;
    building: string;
    guestName: string;
    onConfirm: () => void;
    /** Reserved-room approval prompt (Burhani 409, 410, G2) or a planner instruction. */
    isApproval?: boolean;
    confirmLabel?: string;
  } | null>(null);

  // AI Planner rules and chat-box instructions, saved with the app settings so everyone shares them.
  const [plannerRules, setPlannerRules] = useState<PlannerRules>(() => normalizeRules(null));
  const plannerRulesRef = useRef(plannerRules);
  plannerRulesRef.current = plannerRules;
  const handleSavePlannerRules = async (next: PlannerRules) => {
    setPlannerRules(next);
    const ok = await saveBackendSettings({ plannerRules: next });
    if (!ok) showToast('The planner rules could not be saved to the app. They apply on this screen until you reload.', 'error');
    return ok;
  };

  /**
   * Standing room rules for a manual allotment: KUN HR rooms, Saifee single-gender rooms, Burhani rooms that need
   * approval, and the planner instructions. Returns false when the allotment must not go ahead now.
   */
  const passesRoomRules = (members: Reservation[], building: string, roomNumber: string, onApproved: () => void) => {
    if (!roomNumber) return true;
    const room = rooms.find((r) => r.building.toLowerCase() === building.toLowerCase() && r.roomNumber.toLowerCase() === roomNumber.toLowerCase());
    const check = checkManualRoomRules(room, members, reservations, rooms, plannerRulesRef.current);
    if (check.block) {
      showToast(check.block, 'error');
      return false;
    }
    if (check.approval) {
      setAllocationNotice({
        title: check.approval.title,
        message: check.approval.message,
        isApproval: true,
        confirmLabel: 'Approve & allot',
        roomNumber,
        building,
        guestName: members.length === 1 ? members[0].applicantName : `${members.length} zaereen`,
        onConfirm: () => {
          setAllocationNotice(null);
          onApproved();
        },
      });
      return false;
    }
    return true;
  };

  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, type === 'error' ? 6500 : 4000);
  };

  // Sync to NKERP: one live connection to the server-side sync engine, shared by the top-bar button and the Sync tab
  const nkerpSync = useNkerpSync(showToast);
  const najafEmails = useNajafEmails(nkerpSync, showToast);
  const syncWithSavedData = isSaving ? {...nkerpSync, busy:true} : nkerpSync;

  const handleSaveRoleSettings = (newRole: UserRole, newPin: string) => {
    setUserRole(newRole);
    setAdminPin(newPin);
    saveStoredUserRole(newRole);
    void saveBackendSettings({ adminPin: newPin }).then(ok => { if (!ok) showToast('The admin PIN could not be saved.', 'error'); });
    showToast(
      `Access rights set to ${
        newRole === 'admin' ? 'Administrator (Full Editable Rights)' : 'Receptionist (View-Only Rights)'
      }`
    );
  };

  const handleRefreshLiveComputerData = useCallback(async (showFeedback = true) => {
    const version = dataVersion.current;
    try {
      const data = await loadAccommodation();
      if (version !== dataVersion.current || pendingSaves.current) return;
      reservationsRef.current = data.reservations;
      roomsRef.current = data.rooms;
      setReservations(data.reservations);
      setRooms(data.rooms);
      setPhotos(data.photos);
      setCategories(data.settings.categories);
      setAdminPin(data.settings.adminPin);
      setPlannerRules(normalizeRules(data.settings.plannerRules));
      setIsLiveBackendConnected(true);
      if (showFeedback) showToast('Loaded the latest saved accommodation data.');
    } catch {
      setIsLiveBackendConnected(false);
      if (showFeedback) showToast('Could not reach the app database.', 'error');
    }
  }, []);

  useEffect(() => {
    for (const key of Object.keys(localStorage)) {
      if (/^zaereen_accommodation_(reservations|sheets|rooms)/.test(key) ||
          ['nkerp-sync-last-run','nkerp-sync-messages','faize_google_session_v1'].includes(key)) localStorage.removeItem(key);
    }
    const refresh = () => void handleRefreshLiveComputerData(false);
    let active = true;
    let lastRevision: number | undefined;
    let unsubscribe = () => {};
    const status = () => fetchBackendStatus().then(result => {
      if (!active) return;
      setPullStatus(result.pull);
      setHiddenStays(result.hiddenStays ?? 0);
      if (lastRevision === undefined) unsubscribe = subscribeToMultiWindowSync(refresh, result.events);
      if (lastRevision !== result.revision) refresh();
      lastRevision = result.revision;
    }).catch(() => { if (active) setPullStatus(null); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingSaves.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    refresh();
    void status();
    const timer = window.setInterval(status, 5000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('beforeunload',beforeUnload);
    };
  }, [handleRefreshLiveComputerData]);

  function persist<T extends Reservation | Room>(collection: 'reservations' | 'rooms', next: T[]) {
    const ref = collection === 'reservations' ? reservationsRef : roomsRef;
    const before = ref.current as T[];
    if (collection === 'reservations') {
      reservationsRef.current = next as Reservation[];
      setReservations(reservationsRef.current);
    } else {
      roomsRef.current = next as Room[];
      setRooms(roomsRef.current);
    }
    dataVersion.current++;
    pendingSaves.current++;
    setIsSaving(true);
    saveQueue.current = saveQueue.current.then(async () => {
      try { await saveChanges(collection, before, next); }
      catch (error) { showToast((error as Error).message, 'error'); }
      finally {
        pendingSaves.current--;
        if (!pendingSaves.current) {
          setIsSaving(false);
          await handleRefreshLiveComputerData(false);
        }
      }
    });
  }

  const handlePullNkerp = async () => {
    setManualPullRunning(true);
    try {
      const result = await pullNkerp();
      await handleRefreshLiveComputerData(false);
      const travel = result.travel;
      const transport = travel ? ` Travel updated for ${travel.changed} stays.` : '';
      const pending = travel?.pending ? ` ${travel.pending} travel checks are pending.` :
        travel?.failed ? ` ${travel.failed} travel checks will retry.` : '';
      showToast(`Pulled ${result.received} NKERP stays · ${result.changed} saved changes.${transport}${pending}`);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setManualPullRunning(false);
      fetchBackendStatus().then(status => setPullStatus(status.pull)).catch(() => setPullStatus(null));
    }
  };

  const handleSaveCategories = async (next: string[]) => {
    if (await saveBackendSettings({categories:next})) {
      setCategories(next);
      showToast('Categories saved.');
    } else showToast('Categories could not be saved.', 'error');
  };

  // Add Reservation (ensures unique zaereen only)
  const handleAddReservation = (newReservation: Reservation) => {
    const existing = reservations.find((r) => isDuplicateReservation(r, newReservation));
    if (existing) {
      showToast(
        `Zair already in list: ${existing.applicantName} (${existing.itsId ? `ITS ${existing.itsId}` : existing.tourRefNo})`,
        'error'
      );
      return false;
    }
    const updated = [newReservation, ...reservations];
    persist('reservations', updated);

    showToast(`Added Zair record for ${newReservation.applicantName}`);


    return true;
  };

  // Add Tour Batch (Multiple individuals sharing same Tour ID & dates, with distinct Family IDs)
  const handleAddTourBatch = (newBatch: Reservation[]) => {
    if (!newBatch || newBatch.length === 0) return false;
    const { finalReservations, uniqueToAppend, totalDuplicatesSkipped } = deduplicateForAppend(
      reservationsRef.current,
      newBatch
    );

    if (uniqueToAppend.length === 0) {
      showToast('All entered individuals are duplicates of existing records.', 'error');
      return false;
    }

    persist('reservations', finalReservations);


    const tourId = newBatch[0]?.tourRefNo || 'Tour Group';
    const famCount = new Set(uniqueToAppend.map((r) => r.family.trim()).filter(Boolean)).size;

    if (totalDuplicatesSkipped > 0) {
      showToast(
        `Added Tour ${tourId}: ${uniqueToAppend.length} zaereen across ${famCount} families (${totalDuplicatesSkipped} duplicates skipped).`,
        'info'
      );
    } else {
      showToast(
        `Added Tour ${tourId}: ${uniqueToAppend.length} zaereen across ${famCount} families successfully!`
      );
    }


    return true;
  };

  // Update Reservation
  const handleUpdateReservation = (updatedReservation: Reservation) => {
    persist('reservations', reservationsRef.current.map(r => r.id === updatedReservation.id ? updatedReservation : r));
  };

  const handleBatchUpdateReservations = (updatedList: Reservation[]) => {
    if (!updatedList.length) return;
    const updates = new Map(updatedList.map(r => [r.id, r]));
    persist('reservations', reservationsRef.current.map(r => updates.get(r.id) || r));
  };

  // Helper: check if a reservation is a B to A record
  const isBToAEntry = (r?: Reservation | null): boolean => {
    if (!r) return false;
    return Boolean(
      r.shiftToCategoryA ||
      r.category === 'B to A' ||
      (r.category && r.category.toLowerCase().includes('b to a')) ||
      r.id.startsWith('b2a-')
    );
  };

  // Delete Reservation (Single) - Protected: B to A can only be deleted by Admin
  const handleDeleteReservation = (id: string) => {
    const target = reservations.find((r) => r.id === id);
    if (!target) return;

    if (isBToAEntry(target) && userRole !== 'admin') {
      showToast(
        'Action Blocked: This pax is added in B to A. It cannot be deleted at any cost until deleted by the admin.',
        'error'
      );
      return;
    }

    const updated = reservations.filter((r) => r.id !== id);
    persist('reservations', updated);

    showToast(`Deleted zaer record for ${target.applicantName} (${target.itsId || target.tourRefNo})`);


  };

  // Delete Multiple Reservations (Batch) - Protected: B to A records require Admin role
  const handleBatchDeleteReservations = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    const targetReservations = reservations.filter((r) => ids.includes(r.id));
    const bToACount = targetReservations.filter((r) => isBToAEntry(r)).length;

    if (bToACount > 0 && userRole !== 'admin') {
      showToast(
        `Action Blocked: ${bToACount} of the selected zaereen are in B to A. A pax added in B to A cannot be deleted at any cost until deleted by the admin.`,
        'error'
      );
      return;
    }

    const idSet = new Set(ids);
    const count = ids.length;
    const updated = reservations.filter((r) => !idSet.has(r.id));
    persist('reservations', updated);

    showToast(`Deleted ${count} zaer record${count > 1 ? 's' : ''}`);


  };

  // Toggle Money Given for accounts
  const handleToggleMoneyGiven = (reservationId: string, status: MoneyGivenStatus) => {
    const target = reservations.find((r) => r.id === reservationId);
    if (!target) return;

    const updated: Reservation = {
      ...target,
      moneyGiven: status,
      moneyGivenDate: status === 'Yes' ? new Date().toISOString().slice(0, 10) : undefined,
      updatedAt: new Date().toISOString(),
    };

    handleUpdateReservation(updated);
    showToast(`Money Given status updated to "${status}" for ${target.applicantName}`);
  };

  // Toggle Shift to Category A (Nizaam) - Reverting or removing requires Admin role
  const handleToggleShiftToCategoryA = (reservationId: string, willShift: boolean) => {
    const target = reservations.find((r) => r.id === reservationId);
    if (!target) return;

    if (!willShift && userRole !== 'admin') {
      showToast(
        'Action Blocked: A pax added in B to A cannot be deleted or reverted at any cost until deleted by the admin.',
        'error'
      );
      return;
    }

    const slipNo = willShift ? (target.requestSlipNo || `REQ-SLIP-${Math.floor(1000 + Math.random() * 9000)}`) : undefined;
    const updated: Reservation = {
      ...target,
      shiftToCategoryA: willShift,
      accommodationCategory: willShift ? 'Category A (Nizaam)' : 'Category B (Standard)',
      requestSlipNo: slipNo,
      requestSlipDate: willShift ? new Date().toISOString().slice(0, 10) : undefined,
      moneyGiven: willShift ? target.moneyGiven || 'No' : 'No',
      updatedAt: new Date().toISOString(),
    };

    handleUpdateReservation(updated);
    showToast(
      willShift
        ? `Shifted ${target.applicantName} to Category A (Nizaam). Request Slip: ${slipNo}`
        : `Reverted ${target.applicantName} to Standard (B)`
    );
  };

  // Direct allotment executor
  const executeDirectAllot = (
    reservationId: string,
    building: string,
    roomNumber: string,
    forceReason?: string
  ) => {
    const target = reservations.find((r) => r.id === reservationId);
    if (!target) return;

    const hadPreviousRoom = !!target.roomNumber && String(target.roomNumber).trim() !== '';
    const isChanged = hadPreviousRoom && String(target.roomNumber) !== String(roomNumber) && roomNumber !== '';
    const newHistory = target.roomChangeHistory ? [...target.roomChangeHistory] : [];
    if (isChanged) {
      newHistory.push({
        fromRoom: target.roomNumber,
        fromBuilding: target.building,
        toRoom: roomNumber,
        toBuilding: building,
        changedAt: new Date().toISOString(),
        reason: forceReason || 'Room changed via Room Allotment',
      });
    }

    const updatedRes: Reservation = {
      ...target,
      building,
      roomNumber,
      isRoomChanged: target.isRoomChanged || isChanged,
      roomChangeHistory: newHistory,
      updatedAt: new Date().toISOString(),
    };

    handleUpdateReservation(updatedRes);
    showToast(
      roomNumber
        ? `${isChanged ? `Changed room from ${target.roomNumber} to ${roomNumber}` : `Allotted ${building} Hotel Room ${roomNumber}`} for ${target.applicantName}`
        : `Removed room allotment for ${target.applicantName}`
    );
  };

  // Allot Room to Zaer (Capacity aware with Buffer & Force Allotment option)
  const handleAllotRoom = (
    reservationId: string,
    building: string,
    roomNumber: string,
    forceConfirmed: boolean = false,
    rulesApproved: boolean = false
  ) => {
    const target = reservations.find((r) => r.id === reservationId);
    if (!target) return;

    if (!roomNumber) {
      executeDirectAllot(reservationId, building, '', 'Room allotment cleared');
      return;
    }

    if (!rulesApproved && !passesRoomRules([target], building, roomNumber, () => handleAllotRoom(reservationId, building, roomNumber, forceConfirmed, true))) return;

    if (!forceConfirmed) {
      const requestedPax = isInfant(target) ? 0 : 1;
      const check = checkRoomAllotmentAvailability(
        building,
        roomNumber,
        target.arrivalDate,
        target.departureDate,
        rooms,
        reservations,
        requestedPax,
        target.id,
        false,
        target.arrivalTime,
        target.departureTime,
        target.applicantName,
        target.family,
        target.tourRefNo
      );

      if (!check.allowed || check.hasTimingConflict || check.isOverPaxLimit) {
        const isTurnover = !!check.hasTimingConflict;
        const diffText = check.timingConflictDiffHours !== undefined ? `${check.timingConflictDiffHours}` : undefined;
        const noticeTitle = isTurnover
          ? `Same-Day Turnover Notice (${diffText ? `${diffText}h Difference` : 'Timing Notice'})`
          : `Room Not Vacant Notice (${building} Hotel Room ${roomNumber})`;

        setAllocationNotice({
          title: noticeTitle,
          message: check.reason || `Room ${roomNumber} is not vacant. Do you want to allow allocation?`,
          diffHoursText: diffText,
          isSameDayTurnover: isTurnover,
          isRoomNotVacant: !isTurnover,
          roomNumber,
          building,
          guestName: target.applicantName,
          onConfirm: () => {
            setAllocationNotice(null);
            executeDirectAllot(reservationId, building, roomNumber, check.reason);
          },
        });
        return;
      }
    }

    executeDirectAllot(reservationId, building, roomNumber);
  };

  // Direct batch allotment executor for family
  const executeBatchFamilyAllot = (
    tourRefNo: string,
    family: string,
    building: string,
    roomNumber: string,
    matches: Reservation[],
    matchIds: Set<string>,
    forceReason?: string
  ) => {
    const now = new Date().toISOString();
    const updated = reservations.map((r) => {
      if (matchIds.has(r.id)) {
        const hadPreviousRoom = !!r.roomNumber && String(r.roomNumber).trim() !== '';
        const isChanged = hadPreviousRoom && String(r.roomNumber) !== String(roomNumber) && roomNumber !== '';
        const newHistory = r.roomChangeHistory ? [...r.roomChangeHistory] : [];
        if (isChanged) {
          newHistory.push({
            fromRoom: r.roomNumber,
            fromBuilding: r.building,
            toRoom: roomNumber,
            toBuilding: building,
            changedAt: now,
            reason: forceReason || `Family ${family} batch reallocation`,
          });
        }

        return {
          ...r,
          building,
          roomNumber,
          isRoomChanged: r.isRoomChanged || isChanged,
          roomChangeHistory: newHistory,
          updatedAt: now,
        };
      }
      return r;
    });

    handleBatchUpdateReservations(updated);
    showToast(
      roomNumber
        ? `Allotted ${building} Room ${roomNumber} to all ${matches.length} members of Family "${family}" (${tourRefNo || 'all tours'})!`
        : `Cleared room allotment for Family "${family}" (${matches.length} members)`
    );
  };

  // Batch Allot Room to entire Family on a Tour ID (or whole family in one go, with buffer support & force allotment option)
  const handleBatchAllotFamily = (
    tourRefNo: string,
    family: string,
    building: string,
    roomNumber: string,
    forceConfirmed: boolean = false,
    memberIds?: string[],
    rulesApproved: boolean = false
  ) => {
    const safeTour = String(tourRefNo || '').trim().toLowerCase();
    const safeFam = String(family || '').trim().toLowerCase();
    const chosen = memberIds?.length ? new Set(memberIds) : null;

    // The room pop-up names the exact members (the family on this trip, or a household grouped by HOF ID).
    const matches = chosen ? reservations.filter((r) => chosen.has(r.id)) : reservations.filter((r) => {
      const rFam = String(r.family || '').trim().toLowerCase();
      const rTour = String(r.tourRefNo || r.tourId || '').trim().toLowerCase();
      const matchFamily = rFam === safeFam;
      const matchTour = !safeTour || rTour === safeTour;
      return matchFamily && matchTour;
    });

    if (matches.length === 0) {
      showToast(`No zaereen found for Family "${family}"${tourRefNo ? ` in Tour "${tourRefNo}"` : ''}`, 'error');
      return;
    }

    const matchIds = new Set(matches.map((m) => m.id));

    if (!rulesApproved && !passesRoomRules(matches, building, roomNumber,
      () => handleBatchAllotFamily(tourRefNo, family, building, roomNumber, forceConfirmed, matches.map((m) => m.id), true))) return;

    if (roomNumber && !forceConfirmed) {
      const first = matches[0];
      const effectivePax = countEffectivePax(matches);
      const infantCount = matches.length - effectivePax;
      const check = checkRoomAllotmentAvailability(
        building,
        roomNumber,
        first.arrivalDate,
        first.departureDate,
        rooms,
        reservations.filter((r) => !matchIds.has(r.id)),
        effectivePax,
        undefined,
        false,
        first.arrivalTime,
        first.departureTime,
        first.applicantName,
        family,
        tourRefNo
      );

      if (!check.allowed) {
        const isTurnover = !!check.hasTimingConflict;
        const diffText = check.timingConflictDiffHours !== undefined ? `${check.timingConflictDiffHours}` : undefined;
        const noticeTitle = isTurnover
          ? `Same-Day Turnover Notice (${diffText ? `${diffText}h Difference` : 'Timing Notice'})`
          : `Room Not Vacant Notice (${building} Hotel Room ${roomNumber})`;

        const paxSummary = infantCount > 0
          ? `${matches.length} zaereen (${effectivePax} bed pax, ${infantCount} infant <3y not counted in room pax)`
          : `${matches.length} pax`;

        setAllocationNotice({
          title: noticeTitle,
          message: check.reason || `Room ${roomNumber} is not vacant. Do you want to allow allocation for family "${family}" (${paxSummary})?`,
          diffHoursText: diffText,
          isSameDayTurnover: isTurnover,
          isRoomNotVacant: !isTurnover,
          roomNumber,
          building,
          guestName: `Family #${family} (${paxSummary})`,
          onConfirm: () => {
            setAllocationNotice(null);
            executeBatchFamilyAllot(tourRefNo, family, building, roomNumber, matches, matchIds, check.reason);
          },
        });
        return;
      }
    }

    executeBatchFamilyAllot(tourRefNo, family, building, roomNumber, matches, matchIds);
  };

  // AI Planner: allocate a reviewed plan in one save. A zair who got a room meanwhile keeps it.
  const handleApplyPlan = (items: PlanAllocationItem[]) => {
    const byId = new Map(items.map((i) => [i.reservationId, i]));
    const now = new Date().toISOString();
    const people = new Set<string>();
    let records = 0;
    const next = reservationsRef.current.map((r) => {
      const item = byId.get(r.id);
      if (!item || String(r.roomNumber || '').trim()) return r;
      records++;
      people.add(item.personId);
      return { ...r, building: item.building, roomNumber: item.roomNumber, updatedAt: now };
    });
    const applied = people.size;
    const skipped = new Set(items.map((i) => i.personId)).size - applied;
    if (records) persist('reservations', next);
    showToast(
      applied
        ? `Allocated ${applied} zaereen from the AI plan.${skipped ? ` ${skipped} already had a room.` : ''}`
        : 'Nothing allocated: everyone in the plan already has a room.',
      applied ? 'success' : 'info'
    );
    return { applied, skipped };
  };

  // Switch or Atomically Swap Rooms between Guest/Family A and Guest/Family B
  const handleSwapRooms = (
    sourceReservationIds: string[],
    targetBuilding: string,
    targetRoomNumber: string,
    options: {
      swapWithExistingOccupants: boolean;
      reason?: string;
    }
  ) => {
    const sourceIdSet = new Set(sourceReservationIds);
    const sourceList = reservations.filter((r) => sourceIdSet.has(r.id));
    if (sourceList.length === 0) return;

    const primary = sourceList[0];
    const originBuilding = primary.building || 'Saifee';
    const originRoom = primary.roomNumber || '';
    const now = new Date().toISOString();

    // Standing room rules for the move (KUN HR rooms, single-gender rooms, rooms that need approval).
    const ruleCheck = (members: Reservation[], building: string, roomNumber: string) => {
      const room = rooms.find((r) => r.building.toLowerCase() === building.toLowerCase() && r.roomNumber.toLowerCase() === String(roomNumber).toLowerCase());
      return checkManualRoomRules(room, members, reservations.filter((r) => !sourceIdSet.has(r.id)), rooms, plannerRulesRef.current);
    };
    const toTarget = ruleCheck(sourceList, targetBuilding, targetRoomNumber);
    if (toTarget.block) { showToast(toTarget.block, 'error'); return; }
    if (toTarget.approval && !window.confirm(`${toTarget.approval.title}\n\n${toTarget.approval.message}`)) return;

    let targetOccupantIdSet = new Set<string>();
    if (options.swapWithExistingOccupants && originRoom) {
      const arrivalDate = primary.arrivalDate || primary.arrivalDateTime || primary.rawArrivalStr || '';
      const departureDate = primary.departureDate || primary.departureDateTime || primary.rawDepartureStr || '';
      const poolWithoutSource = reservations.filter((r) => !sourceIdSet.has(r.id));
      const overlappingOccupants = getRoomBookingsForDuration(
        targetBuilding,
        targetRoomNumber,
        arrivalDate,
        departureDate,
        poolWithoutSource
      );
      targetOccupantIdSet = new Set(overlappingOccupants.map((o) => o.id));
      const back = ruleCheck(overlappingOccupants, originBuilding, originRoom);
      if (back.block) { showToast(back.block, 'error'); return; }
      if (back.approval && !window.confirm(`${back.approval.title}\n\n${back.approval.message}`)) return;
    }

    const updated = reservations.map((r) => {
      if (sourceIdSet.has(r.id)) {
        const hadPrev = !!r.roomNumber && String(r.roomNumber).trim() !== '';
        const isChanged =
          hadPrev &&
          (String(r.roomNumber) !== String(targetRoomNumber) ||
            String(r.building || '').toLowerCase() !== String(targetBuilding).toLowerCase());
        const history = r.roomChangeHistory ? [...r.roomChangeHistory] : [];
        if (isChanged) {
          history.push({
            fromRoom: r.roomNumber,
            fromBuilding: r.building,
            toRoom: targetRoomNumber,
            toBuilding: targetBuilding,
            changedAt: now,
            reason:
              options.reason ||
              (options.swapWithExistingOccupants
                ? `Swapped rooms with ${targetBuilding} Rm ${targetRoomNumber}`
                : 'Switched room'),
          });
        }
        return {
          ...r,
          building: targetBuilding,
          roomNumber: targetRoomNumber,
          isRoomChanged: r.isRoomChanged || isChanged,
          roomChangeHistory: history,
          updatedAt: now,
        };
      }

      if (targetOccupantIdSet.has(r.id)) {
        const history = r.roomChangeHistory ? [...r.roomChangeHistory] : [];
        history.push({
          fromRoom: r.roomNumber,
          fromBuilding: r.building,
          toRoom: originRoom,
          toBuilding: originBuilding,
          changedAt: now,
          reason:
            options.reason ||
            `Swapped rooms with ${originBuilding} Rm ${originRoom}`,
        });
        return {
          ...r,
          building: originBuilding,
          roomNumber: originRoom,
          isRoomChanged: true,
          roomChangeHistory: history,
          updatedAt: now,
        };
      }

      return r;
    });

    handleBatchUpdateReservations(updated);
    if (options.swapWithExistingOccupants && targetOccupantIdSet.size > 0) {
      showToast(
        `Swapped ${originBuilding} Rm ${originRoom} (${sourceList.length} pax) ↔ ${targetBuilding} Rm ${targetRoomNumber} (${targetOccupantIdSet.size} pax)`
      );
    } else {
      showToast(
        `Switched ${sourceList.length > 1 ? `${sourceList.length} zaereen` : primary.applicantName} to ${targetBuilding} Rm ${targetRoomNumber}`
      );
    }
  };

  // Batch shift selected zaereen or entire Tour ID to Category A (Nizaam)
  const handleBatchShiftToCategoryA = (
    reservationIds: string[],
    moneyGiven: MoneyGivenStatus = 'Yes',
    notes?: string,
    roomOverride?: { building: string; roomNumber: string }
  ) => {
    const slipDate = new Date().toISOString().slice(0, 10);
    const idSet = new Set(reservationIds);
    const cleanRoom = roomOverride?.roomNumber?.trim() || '';
    const cleanBuilding = roomOverride?.building?.trim() || '';
    const updated = reservationsRef.current.map((r) => {
      if (idSet.has(r.id)) {
        const slipNo = r.requestSlipNo || `SLIP-${r.tourRefNo?.slice(-4) || 'TOUR'}-${r.family || 'FAM'}-${Date.now().toString().slice(-4)}`;
        return {
          ...r,
          category: 'B to A',
          shiftToCategoryA: true,
          accommodationCategory: 'Category A (Nizaam)' as const,
          moneyGiven,
          moneyGivenDate: moneyGiven === 'Yes' ? slipDate : undefined,
          moneyNotes: notes !== undefined ? notes : r.moneyNotes,
          requestSlipNo: slipNo,
          requestSlipDate: slipDate,
          ...(cleanRoom
            ? {
                building: cleanBuilding || r.building || 'Burhani',
                roomNumber: cleanRoom,
              }
            : {}),
          updatedAt: new Date().toISOString(),
        };
      }
      return r;
    });

    persist('reservations', updated);

    showToast(
      `Shifted ${reservationIds.length} pilgrim(s) to Category A (Payment / Money Given: ${moneyGiven}${cleanRoom ? ` · ${cleanBuilding || ''} Rm ${cleanRoom}` : ''})`
    );
  };

  // Toggle Refund Given for A to B accounts slips
  const handleToggleRefundGiven = (reservationId: string, status: MoneyGivenStatus) => {
    const target = reservations.find((r) => r.id === reservationId);
    if (!target) return;

    const slipDate = new Date().toISOString().slice(0, 10);
    const updated: Reservation = {
      ...target,
      shiftDirection: 'A_TO_B',
      accommodationCategory: 'Category B (Standard)',
      refundGiven: status,
      refundGivenDate: status === 'Yes' ? slipDate : undefined,
      refundSlipNo:
        target.refundSlipNo ||
        `REF-A2B-${target.tourRefNo?.slice(-4) || 'TOUR'}-${target.family || 'FAM'}-${Date.now().toString().slice(-4)}`,
      refundSlipDate: target.refundSlipDate || slipDate,
      updatedAt: new Date().toISOString(),
    };

    handleUpdateReservation(updated);
    showToast(`A to B refund status updated to "${status}" for ${target.applicantName}`);
  };

  // Batch shift selected zaereen or Tour ID to Category B (A to B slip)
  const handleBatchShiftToCategoryB = (
    reservationIds: string[],
    refundGiven: MoneyGivenStatus = 'No',
    notes?: string
  ) => {
    const slipDate = new Date().toISOString().slice(0, 10);
    const idSet = new Set(reservationIds);
    const tourSlipNoMap = new Map<string, string>();
    const updated = reservations.map((r) => {
      if (idSet.has(r.id)) {
        const tourKey = (r.tourRefNo || r.tourId || 'TOUR').trim();
        let slipNo = r.refundSlipNo || tourSlipNoMap.get(tourKey);
        if (!slipNo) {
          slipNo = `REF-A2B-${tourKey.slice(-4) || 'TOUR'}-${Date.now().toString().slice(-4)}`;
          tourSlipNoMap.set(tourKey, slipNo);
        }
        return {
          ...r,
          shiftToCategoryA: false,
          shiftDirection: 'A_TO_B' as const,
          accommodationCategory: 'Category B (Standard)' as const,
          refundGiven,
          refundGivenDate: refundGiven === 'Yes' ? slipDate : undefined,
          refundAmountNotes: notes !== undefined ? notes : r.refundAmountNotes,
          refundSlipNo: slipNo,
          refundSlipDate: r.refundSlipDate || slipDate,
          updatedAt: new Date().toISOString(),
        };
      }
      return r;
    });

    persist('reservations', updated);


    showToast(
      `Saved ${reservationIds.length} pax to A ➔ B Slip (Refund Given: ${refundGiven})`
    );
  };

  // Import from Excel Sheet (User request: "When append dont append duplicates only unique should be added")
  const handleImportFromExcel = (
    imported: Reservation[],
    mode: 'replace' | 'append'
  ) => {
    let finalReservations: Reservation[];
    let feedbackToast = '';

    if (mode === 'replace') {
      const matchedExistingIds = new Set<string>();
      const preservedImports = deduplicateReservationList(imported).map((imp) => {
        const match = reservations.find((ex) => isDuplicateReservation(ex, imp));
        if (!match) return imp;
        matchedExistingIds.add(match.id);
        const existingRoom = normalizeRoomNumber(match.roomNumber);
        const impRoom = normalizeRoomNumber(imp.roomNumber);
        return {
          ...imp,
          id: match.id,
          roomNumber: existingRoom || impRoom || '',
          building: existingRoom ? (match.building || imp.building || '') : (imp.building || match.building || ''),
          roomId: existingRoom ? (match.roomId || imp.roomId) : imp.roomId,
          isRoomChanged: match.isRoomChanged || imp.isRoomChanged,
          roomChangeHistory: match.roomChangeHistory || imp.roomChangeHistory,
          isSpecialGuest: match.isSpecialGuest !== undefined ? match.isSpecialGuest : imp.isSpecialGuest,
          specialRemarks: match.specialRemarks || imp.specialRemarks,
          shiftToCategoryA: match.shiftToCategoryA || imp.shiftToCategoryA,
          shiftDirection: match.shiftDirection || imp.shiftDirection,
          moneyGiven: match.moneyGiven && match.moneyGiven !== 'No' ? match.moneyGiven : imp.moneyGiven,
          requestSlipNo: match.requestSlipNo || imp.requestSlipNo,
          refundGiven: match.refundGiven || imp.refundGiven,
          refundSlipNo: match.refundSlipNo || imp.refundSlipNo,
        };
      });
      const preservedUnmatchedAllotted = reservations.filter(
        (ex) => !matchedExistingIds.has(ex.id) && !!normalizeRoomNumber(ex.roomNumber)
      );
      finalReservations = deduplicateReservationList([...preservedImports, ...preservedUnmatchedAllotted]);
      feedbackToast = `Imported ${preservedImports.length} records from Excel while preserving ${preservedUnmatchedAllotted.length > 0 ? 'all ' : ''}existing allotted rooms. Saved to backend.`;
    } else {
      const { uniqueToAppend, totalDuplicatesSkipped, updatedExistingCount, finalReservations: merged } = deduplicateForAppend(
        reservations,
        imported
      );
      finalReservations = merged;

      const updateMsg = updatedExistingCount > 0 ? ` (${updatedExistingCount} records updated with new arrival & departure times)` : '';
      if (uniqueToAppend.length === 0) {
        feedbackToast = updatedExistingCount > 0
          ? `Updated ${updatedExistingCount} existing zaereen with new arrival/departure times & dates from Excel. No duplicates added!`
          : `All ${imported.length} zaereen in the sheet are already present. No duplicates were added!`;
      } else if (totalDuplicatesSkipped > 0) {
        feedbackToast = `Appended ${uniqueToAppend.length} unique zaereen${updateMsg} (${totalDuplicatesSkipped} duplicate${totalDuplicatesSkipped > 1 ? 's' : ''} skipped). Saved to backend!`;
      } else {
        feedbackToast = `Appended ${uniqueToAppend.length} unique zaereen to database${updateMsg}. Saved to backend!`;
      }
    }

    // Auto-discover any new categories from the imported sheet
    const importedCats = Array.from(new Set(imported.map((r) => r.category).filter(Boolean)));
    const mergedCats = Array.from(new Set([...categories, ...importedCats]));
    if (mergedCats.length > categories.length) {
      setCategories(mergedCats);
      void handleSaveCategories(mergedCats);
    }

    persist('reservations', finalReservations);

    showToast(feedbackToast);


    setActiveTab('reservations');

  };

  // Room status updater (e.g. block / unblock)
  const handleUpdateRoomStatus = (roomId: string, status: RoomStatus) => {
    const updatedRooms = rooms.map((r) => (r.id === roomId ? { ...r, status } : r));
    persist('rooms', updatedRooms);

  };

  const handleUpdateRoomDetails = (updatedRoom: Room) => {
    const updatedRooms = rooms.map((r) => (r.id === updatedRoom.id ? updatedRoom : r));
    persist('rooms', updatedRooms);

  };

  const handleResetToSaifeeBurhaniRooms = async () => {
    if (!window.confirm('Reset hotel inventory to the official 120 rooms across Burhani (44), Saifee (70), and Badri (6)?')) return;
    await saveQueue.current;
    const freshRooms = await resetBackendRooms();
    if (!freshRooms) return showToast('Could not reset the room inventory.', 'error');
    await handleRefreshLiveComputerData(false);
    showToast('Restored the official 120 rooms.');
  };

  // Add or update rooms in any official or newly added building. Custom rooms and edited specs are kept as entered.
  const handleAddRooms = (newRoomsToAdd: Room[]) => {
    const cleanIncoming = deduplicateRooms(newRoomsToAdd);
    if (cleanIncoming.length === 0) {
      showToast('Enter valid building and room details.', 'error');
      return;
    }

    const existingKeys = new Set(rooms.map((r) => getCanonicalRoomKey(r.building, r.roomNumber)));
    const updated = cleanIncoming.filter((r) => existingKeys.has(getCanonicalRoomKey(r.building, r.roomNumber))).length;
    const added = cleanIncoming.length - updated;
    const finalRooms = mergeRoomsIntoInventory(rooms, cleanIncoming);

    persist('rooms', finalRooms);

    const buildings = Array.from(new Set(cleanIncoming.map((r) => r.building))).join(', ');
    const summary = [added && `added ${added} room${added === 1 ? '' : 's'}`, updated && `updated ${updated}`]
      .filter(Boolean).join(', ');
    showToast(`${summary.charAt(0).toUpperCase()}${summary.slice(1)} in ${buildings}. Inventory: ${finalRooms.length} rooms.`);
  };

  const handleDeleteRoom = (roomId: string) => {
    const targetRoom = rooms.find((r) => r.id === roomId);
    if (targetRoom) {
      const targetNum = normalizeRoomNumber(targetRoom.roomNumber);
      const targetBldg = normalizeBuildingName(targetRoom.building).toLowerCase();
      const hasAllottedGuests = reservations.some(
        (res) =>
          normalizeRoomNumber(res.roomNumber) === targetNum &&
          normalizeBuildingName(res.building).toLowerCase() === targetBldg
      );
      if (hasAllottedGuests) {
        showToast(
          `Cannot delete ${targetRoom.building} Room ${targetRoom.roomNumber} because it has allotted Zaereen. Rooms allotted should not be deleted.`,
          'error'
        );
        return;
      }
    }

    const updated = rooms.filter((r) => r.id !== roomId);
    persist('rooms', updated);

    showToast('Room removed from inventory.');
  };

  return (
    <div className="min-h-screen bg-canvas text-ink font-sans">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userRole={userRole}
        onOpenRoleModal={() => setIsRoleModalOpen(true)}
        onOpenPdfModal={handleOpenPdfModal}
        onOpenUploadExcel={() => setIsExcelUploadOpen(true)}
        onOpenReceptionSlip={handleOpenReceptionSlip}
        onPullNkerp={handlePullNkerp}
        isPulling={manualPullRunning}
        roomsCount={rooms.length}
        onOpenAddBuildingRooms={() => {

          setIsAddBuildingRoomsOpen(true);
        }}
        nkerpSync={syncWithSavedData}
        emailsRunning={najafEmails.run.running}
        pullStatus={pullStatus}
      />
      <SyncAccessKeyModal sync={nkerpSync} />

      {/* Main Container - Full Screen Width with mobile bottom-bar clearance */}
      <div className="app-content">
      <main key={activeTab} className="tab-enter mx-auto w-full max-w-[1720px] px-3 sm:px-5 lg:px-8 pt-4 sm:pt-6 lg:pt-9 pb-28 lg:pb-14">
        {activeTab === 'dashboard' && (
          <Dashboard
            reservations={reservations}
            rooms={rooms}
            onNavigateTab={setActiveTab}
            onOpenUploadExcel={() => setIsExcelUploadOpen(true)}
            onOpenReceptionSlip={handleOpenReceptionSlip}
            onOpenAddZaer={() => setIsAddZaerOpen(true)}
            onOpenAddTourGroup={() => setIsAddTourGroupOpen(true)}
            onDownloadTemplate={downloadSampleExcelTemplate}
            onAllotRoom={handleAllotRoom}
            onBatchAllotFamily={handleBatchAllotFamily}
            onAddReservation={handleAddReservation}
            onUpdateReservation={handleUpdateReservation}
            onBatchUpdateReservations={handleBatchUpdateReservations}
            onDeleteReservation={handleDeleteReservation}
            onToggleBlockRoom={(roomId) => {
              const r = rooms.find((rm) => rm.id === roomId);
              if (r) {
                handleUpdateRoomStatus(roomId, r.status === 'blocked' ? 'available' : 'blocked');
              }
            }}
            userRole={userRole}
            onOpenQuickAllotModal={(res) => setQuickAllotTarget(res)}
            onOpenSwitchRoomModal={(target) => setSwitchRoomTarget(target)}
            isLiveBackendConnected={isLiveBackendConnected}
            pullStatus={pullStatus}
            isPulling={manualPullRunning}
            onPullNkerp={handlePullNkerp}
            onExportRoomAllocation={() => exportRoomAllocation(reservations, rooms)}
            onRefreshLiveComputerData={() => handleRefreshLiveComputerData(true)}
            onOpenAddBuildingRooms={() => {

              setIsAddBuildingRoomsOpen(true);
            }}
            onOpenPdfModal={handleOpenPdfModal}
          />
        )}

        {activeTab === 'reservations' && (
          <ReservationsView
            reservations={reservations}
            photos={photos}
            rooms={rooms}
            categories={categories}
            onAddReservation={handleAddReservation}
            onUpdateReservation={handleUpdateReservation}
            onBatchUpdateReservations={handleBatchUpdateReservations}
            onDeleteReservation={handleDeleteReservation}
            onBatchDeleteReservations={handleBatchDeleteReservations}
            onOpenUploadExcel={() => setIsExcelUploadOpen(true)}
            onDownloadTemplate={downloadSampleExcelTemplate}
            onOpenAccountsSlip={(res) => handleOpenAccountsSlipModal(res, 'B_TO_A')}
            onOpenAToBSlip={(res, selectedIds) => handleOpenAccountsSlipModal(res || null, 'A_TO_B', selectedIds)}
            onOpenBToASlip={(res, selectedIds) => handleOpenAccountsSlipModal(res || null, 'B_TO_A', selectedIds)}
            onOpenReceptionSlip={handleOpenReceptionSlip}
            onOpenAddZaer={() => setIsAddZaerOpen(true)}
            onOpenAddTourGroup={() => setIsAddTourGroupOpen(true)}
            onOpenPdfModal={() => setIsPdfModalOpen(true)}
            onOpenCategoriesModal={() => setIsCategoriesModalOpen(true)}
            onNavigateToShifts={() => setActiveTab('upgrades')}
            onBatchAllotFamily={handleBatchAllotFamily}
            onAllotRoom={handleAllotRoom}
            userRole={userRole}
            onOpenQuickAllotModal={(res) => setQuickAllotTarget(res)}
            onOpenSwitchRoomModal={(target) => setSwitchRoomTarget(target)}
            hiddenStays={hiddenStays}
            onHiddenStaysRestored={(count) => {
              setHiddenStays((n) => Math.max(0, n - count));
              showToast(`Restored ${count} stay${count === 1 ? '' : 's'}. ${count === 1 ? 'It returns' : 'They return'} with the NKERP pull that has just started.`);
              window.setTimeout(() => void handleRefreshLiveComputerData(false), 4000);
            }}
          />
        )}

        {activeTab === 'planner' && (
          <AllocationPlannerView
            reservations={reservations}
            rooms={rooms}
            userRole={userRole}
            onApplyPlan={handleApplyPlan}
            onShiftToB={(ids) => handleBatchShiftToCategoryB(ids, 'No')}
            onOpenSync={() => setActiveTab('sync')}
            rules={plannerRules}
            onSaveRules={handleSavePlannerRules}
          />
        )}

        {activeTab === 'approvals' && <ApprovalsView />}

        {activeTab === 'upgrades' && (<>
          <CategoryUpgradeView
            reservations={reservations}
            rooms={rooms}
            onToggleMoneyGiven={handleToggleMoneyGiven}
            onOpenAccountsSlip={(res) => handleOpenAccountsSlipModal(res, 'B_TO_A')}
            onOpenAToBSlip={() => handleOpenAccountsSlipModal(null, 'A_TO_B')}
            onOpenBToASlipForIds={(ids) => handleOpenAccountsSlipModal(null, 'B_TO_A', ids)}
            onToggleShiftToCategoryA={handleToggleShiftToCategoryA}
            onBatchShiftToCategoryA={handleBatchShiftToCategoryA}
            onAddZaer={handleAddReservation}
            onAddTourBatch={handleAddTourBatch}
            onDeleteReservation={handleDeleteReservation}
            userRole={userRole}
          />
          <SlipRecordsPanel refreshKey={isAccountsSlipOpen} />
        </>)}

        {activeTab === 'sync' && <NkerpSyncView sync={syncWithSavedData} />}

        {activeTab === 'emails' && <NajafEmailsView emails={najafEmails} sync={nkerpSync} />}

        {activeTab === 'rooms' && (
          <RoomsManagementView
            rooms={rooms}
            reservations={reservations}
            onUpdateRoomStatus={handleUpdateRoomStatus}
            onUpdateRoomDetails={handleUpdateRoomDetails}
            onResetRoomsToSaifeeBurhani={handleResetToSaifeeBurhaniRooms}
            onAddRooms={handleAddRooms}
            onDeleteRoom={handleDeleteRoom}
            onOpenSwitchRoomModal={(target) => setSwitchRoomTarget(target)}
          />
        )}
      </main>
      </div>

      {/* Excel Upload Modal */}
      <ExcelUploadModal
        isOpen={isExcelUploadOpen}
        onClose={() => setIsExcelUploadOpen(false)}
        onImportSuccess={handleImportFromExcel}
        existingCount={reservations.length}
        existingReservations={reservations}
      />

      {/* Add Zair Manual Entry Modal */}
      <AddZaerModal
        isOpen={isAddZaerOpen}
        onClose={() => setIsAddZaerOpen(false)}
        onAddZaer={handleAddReservation}
        existingReservations={reservations}
        rooms={rooms}
        categories={categories}
        onSwitchToAddTourGroup={() => {
          setIsAddZaerOpen(false);
          setIsAddTourGroupOpen(true);
        }}
      />

      {/* Add Tour Group (Shared Tour ID, Shared Dates, Different Family IDs & Multiple Individuals) */}
      <AddTourGroupModal
        isOpen={isAddTourGroupOpen}
        onClose={() => setIsAddTourGroupOpen(false)}
        onAddTourBatch={handleAddTourBatch}
        existingReservations={reservations}
        rooms={rooms}
        categories={categories}
      />

      {/* Reception Daily Operational Slip Modal */}
      {isReceptionSlipOpen && (
        <ReceptionDailySlipModal
          isOpen={isReceptionSlipOpen}
          onClose={() => setIsReceptionSlipOpen(false)}
          reservations={reservations}
          rooms={rooms}
          initialTab={receptionSlipInitialTab}
          onUpdateReservation={handleUpdateReservation}
          onBatchUpdateReservations={handleBatchUpdateReservations}
        />
      )}

      {/* Category B to A & A to B Accounts Request Slip Modal */}
      <AccountsRequestSlipModal
        isOpen={isAccountsSlipOpen}
        reservation={activeAccountsSlipReservation}
        allReservations={reservations}
        initialDirection={accountsSlipDirection}
        initialSelectedIds={accountsSlipInitialIds}
        onClose={() => {
          setIsAccountsSlipOpen(false);
          setActiveAccountsSlipReservation(null);
          setAccountsSlipInitialIds(undefined);
        }}
        onToggleMoneyGiven={handleToggleMoneyGiven}
        onToggleRefundGiven={handleToggleRefundGiven}
        onBatchShiftToCategoryA={handleBatchShiftToCategoryA}
        onBatchShiftToCategoryB={handleBatchShiftToCategoryB}
      />

      {isCategoriesModalOpen && <CategoriesModal
        isOpen
        onClose={() => setIsCategoriesModalOpen(false)}
        categories={categories}
        onSaveCategories={handleSaveCategories}
      />}

      <AddBuildingAndRoomsModal
        isOpen={isAddBuildingRoomsOpen}
        onClose={() => setIsAddBuildingRoomsOpen(false)}
        existingRooms={rooms}
        onAddRooms={handleAddRooms}
      />

      {/* Administrative PDF Export Modal */}
      <PdfExportModal
        isOpen={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
        reservations={reservations}
        rooms={rooms}
        initialReportType={pdfModalInitialReportType}
        initialTourId={pdfModalInitialTourId}
      />

      {/* Role Management Modal (Admin PIN vs Receptionist View-Only) */}
      <RoleManagementModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        currentRole={userRole}
        adminPin={adminPin}
        onSaveRoleSettings={handleSaveRoleSettings}
      />

      {/* Quick Room Allotment Modal (Easy Allotment with capacity and buffer) */}
      {quickAllotTarget && (
        <QuickRoomAllotModal
          isOpen={true}
          onClose={() => setQuickAllotTarget(null)}
          targetReservation={quickAllotTarget}
          rooms={rooms}
          reservations={reservations}
          onAllotRoom={handleAllotRoom}
          onBatchAllotFamily={handleBatchAllotFamily}
          onOpenSwitchRoomModal={(target) => {
            setQuickAllotTarget(null);
            setSwitchRoomTarget(target);
          }}
        />
      )}

      {/* Switch or Swap Rooms Modal */}
      {switchRoomTarget && (
        <SwitchRoomModal
          isOpen={true}
          onClose={() => setSwitchRoomTarget(null)}
          target={switchRoomTarget}
          rooms={rooms}
          allReservations={reservations}
          onConfirmSwitch={handleSwapRooms}
        />
      )}

      {/* Allocation Notice Confirmation Modal (Same-day turnover hour difference & Room not vacant force allocation notice) */}
      {allocationNotice && (
        <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="allocation-notice-title">
          <div className={`${modalCard} max-w-lg`}>
            <div className={modalHeader}>
              <div className="flex items-start gap-3 min-w-0">
                <span className={`mt-0.5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${allocationNotice.isSameDayTurnover || allocationNotice.isApproval ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                  {allocationNotice.isSameDayTurnover ? <Clock className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                </span>
                <div className="min-w-0">
                  <h3 id="allocation-notice-title" className={modalTitle}>{allocationNotice.title}</h3>
                  <p className="mt-1 text-sm text-stone-600">
                    Room {allocationNotice.roomNumber} · {allocationNotice.building} · for {allocationNotice.guestName}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setAllocationNotice(null)} aria-label="Close" className={modalClose}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 sm:px-6 py-5 space-y-3 overflow-y-auto">
              <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ring-1 ring-inset ${
                allocationNotice.isSameDayTurnover || allocationNotice.isApproval
                  ? 'bg-amber-50 ring-amber-200 text-amber-900'
                  : 'bg-rose-50 ring-rose-200 text-rose-900'
              }`}>
                <p className="font-medium">{allocationNotice.message}</p>
                {allocationNotice.diffHoursText && (
                  <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold tabular-nums">
                    <Clock className="w-4 h-4" />
                    Hour difference: {allocationNotice.diffHoursText} hours
                  </p>
                )}
              </div>
              <p className="text-[13px] text-stone-500">Allotting will save this room and update the room grid.</p>
            </div>

            <div className={modalFooter}>
              <button type="button" onClick={() => setAllocationNotice(null)} className={btn.secondary}>Cancel</button>
              <button type="button" onClick={allocationNotice.onConfirm} className={btn.primary}>
                <CheckCircle2 className="w-4 h-4" />
                <span>{allocationNotice.confirmLabel || 'Allot anyway'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User request: "when the app is opened first ask to upload excel and then sync the document" */}
      {isSaving && <div role="status" className="fixed bottom-20 lg:bottom-5 left-5 lg:left-[calc(var(--rail-w)+1.25rem)] z-50 rounded-lg bg-stone-900 px-3 py-2 text-[13px] font-medium text-white shadow-lg">Saving to the app…</div>}

      {/* Toast Notification */}
      {toast && (
        <div role="status" className="fixed bottom-20 lg:bottom-6 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-md z-50 flex items-start gap-2.5 px-4 py-3 bg-stone-900 text-white rounded-xl shadow-2xl text-sm leading-snug animate-in fade-in slide-in-from-bottom-2">
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 mt-px text-rose-300 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 mt-px text-emerald-300 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="-mr-1.5 -mt-1 w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-stone-300 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
