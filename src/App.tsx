/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
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
  Download
} from 'lucide-react';

import { 
  Reservation, 
  Room, 
  PaymentStatus, 
  MoneyGivenStatus, 
  GoogleSheetsConfig, 
  RoomStatus,
  DEFAULT_ZAEREEN_CATEGORIES,
  UserRole
} from './types';
import { 
  getStoredRooms, 
  saveRooms, 
  getStoredReservations, 
  saveReservations, 
  getStoredSheetsConfig, 
  saveSheetsConfig,
  getStoredCategories,
  saveStoredCategories,
  resetToSaifeeBurhani114Rooms,
  isRoomBookedForDuration,
  getStoredUserRole,
  saveStoredUserRole,
  getStoredAdminPin,
  saveStoredAdminPin,
  checkRoomAllotmentAvailability
} from './services/storage';
import { 
  initAuth, 
  googleSignIn, 
  logout 
} from './services/firebaseAuth';
import { 
  syncAllToGoogleSheet, 
  twoWaySyncWithGoogleSheet,
  fetchRoomsFromGoogleSheet, 
  fetchReservationsFromGoogleSheet,
  fetchCategoriesFromGoogleSheet,
  fetchCategoriesFromGoogleSheetUrl
} from './services/googleSheets';
import { downloadSampleExcelTemplate } from './services/excelService';
import { 
  deduplicateForAppend, 
  deduplicateReservationList, 
  isDuplicateReservation 
} from './utils/deduplication';

import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { ReservationsView } from './components/ReservationsView';
import { CategoryUpgradeView } from './components/CategoryUpgradeView';
import { RoomsManagementView } from './components/RoomsManagementView';
import { ExcelUploadModal } from './components/ExcelUploadModal';
import { ReceptionDailySlipModal } from './components/ReceptionDailySlipModal';
import { AccountsRequestSlipModal } from './components/AccountsRequestSlipModal';
import { GoogleSheetsSyncModal } from './components/GoogleSheetsSyncModal';
import { GoogleSheetCategoriesModal } from './components/GoogleSheetCategoriesModal';
import { PdfExportModal } from './components/PdfExportModal';
import { RoleManagementModal } from './components/RoleManagementModal';
import { QuickRoomAllotModal } from './components/QuickRoomAllotModal';
import { AddZaerModal } from './components/AddZaerModal';
import { AddTourGroupModal } from './components/AddTourGroupModal';
import { 
  checkBackendHealth,
  fetchBackendReservations,
  saveBackendReservations,
  upsertBackendReservation,
  deleteBackendReservation,
  batchDeleteBackendReservations,
  fetchBackendRooms,
  saveBackendRooms,
  updateBackendRoom,
  resetBackendRooms,
  fetchBackendSettings,
  saveBackendSettings,
} from './services/api';

export default function App() {
  // Navigation tabs: dashboard | reservations | upgrades | rooms
  const [activeTab, setActiveTab] = useState<'dashboard' | 'reservations' | 'upgrades' | 'rooms'>('dashboard');

  // Core Data
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_ZAEREEN_CATEGORIES);

  // Live Backend Connection Status
  const [isLiveBackendConnected, setIsLiveBackendConnected] = useState<boolean>(true);

  // User Role & Permissions (Admin: editable, Receptionist: view-only)
  const [userRole, setUserRole] = useState<UserRole>(() => getStoredUserRole());
  const [adminPin, setAdminPin] = useState<string>(() => getStoredAdminPin());
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [quickAllotTarget, setQuickAllotTarget] = useState<Reservation | null>(null);

  // Auth & Google Sheets State
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isFetchingCategories, setIsFetchingCategories] = useState(false);
  const [sheetsConfig, setSheetsConfig] = useState<GoogleSheetsConfig>(getStoredSheetsConfig());

  // Modals state
  const [isExcelUploadOpen, setIsExcelUploadOpen] = useState(false);
  const [isReceptionSlipOpen, setIsReceptionSlipOpen] = useState(false);
  const [activeAccountsSlipReservation, setActiveAccountsSlipReservation] = useState<Reservation | null>(null);
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState(false);
  const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [isAddZaerOpen, setIsAddZaerOpen] = useState(false);
  const [isAddTourGroupOpen, setIsAddTourGroupOpen] = useState(false);

  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const handleSaveRoleSettings = (newRole: UserRole, newPin: string) => {
    setUserRole(newRole);
    setAdminPin(newPin);
    saveStoredUserRole(newRole);
    saveStoredAdminPin(newPin);
    saveBackendSettings({ userRole: newRole, adminPin: newPin });
    showToast(
      `Access rights set to ${
        newRole === 'admin' ? 'Administrator (Full Editable Rights)' : 'Receptionist (View-Only Rights)'
      }`
    );
  };

  // Load persistent backend data on startup with local fallback
  useEffect(() => {
    async function loadData() {
      // 1. Initial immediate hydrate from local storage
      const localRooms = getStoredRooms();
      const localReservations = getStoredReservations();
      const localSheetsConfig = getStoredSheetsConfig();
      const localCategories = getStoredCategories();

      setRooms(localRooms);
      setReservations(localReservations);
      setSheetsConfig(localSheetsConfig);
      setCategories(localCategories);

      // 2. Query live server backend
      try {
        const health = await checkBackendHealth();
        if (health) {
          setIsLiveBackendConnected(true);
          const [backendRes, backendRooms, backendSettings] = await Promise.all([
            fetchBackendReservations(),
            fetchBackendRooms(),
            fetchBackendSettings(),
          ]);

          if (backendRes && Array.isArray(backendRes)) {
            setReservations(backendRes);
            saveReservations(backendRes);
          } else if (localReservations.length > 0) {
            saveBackendReservations(localReservations);
          }

          if (backendRooms && Array.isArray(backendRooms)) {
            setRooms(backendRooms);
            saveRooms(backendRooms);
          } else if (localRooms.length > 0) {
            saveBackendRooms(localRooms);
          }

          if (backendSettings) {
            if (backendSettings.sheetsConfig) {
              setSheetsConfig(backendSettings.sheetsConfig);
              saveSheetsConfig(backendSettings.sheetsConfig);
            }
            if (backendSettings.categories) {
              setCategories(backendSettings.categories);
              saveStoredCategories(backendSettings.categories);
            }
            if (backendSettings.userRole) {
              setUserRole(backendSettings.userRole);
              saveStoredUserRole(backendSettings.userRole);
            }
            if (backendSettings.adminPin) {
              setAdminPin(backendSettings.adminPin);
              saveStoredAdminPin(backendSettings.adminPin);
            }
          }
        }
      } catch (err) {
        console.warn('Backend sync initialized from local cache:', err);
      }
    }

    loadData();
  }, []);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser, token) => {
        setUser(authUser);
        setAccessToken(token);
      },
      () => {
        setUser(null);
        setAccessToken(null);
      }
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Sync to Google Sheets if configured
  const triggerAutoSync = useCallback(
    async (currentReservations: Reservation[], currentRooms: Room[]) => {
      if (!accessToken || !sheetsConfig.spreadsheetId || !sheetsConfig.autoSync) {
        return;
      }

      try {
        setSheetsConfig((prev) => ({ ...prev, isSyncing: true }));
        const res = await syncAllToGoogleSheet(
          accessToken,
          sheetsConfig.spreadsheetId,
          currentReservations,
          currentRooms
        );

        if (res.success) {
          const updated = {
            ...sheetsConfig,
            lastSyncedAt: new Date().toISOString(),
            isSyncing: false,
            syncError: null,
          };
          setSheetsConfig(updated);
          saveSheetsConfig(updated);
        } else {
          setSheetsConfig((prev) => ({
            ...prev,
            isSyncing: false,
            syncError: res.error || 'Sync error',
          }));
        }
      } catch (e: any) {
        setSheetsConfig((prev) => ({
          ...prev,
          isSyncing: false,
          syncError: e.message || 'Auto sync failed',
        }));
      }
    },
    [accessToken, sheetsConfig]
  );

  // Sign In Handler
  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setAccessToken(res.accessToken);
        showToast(`Connected to Google as ${res.user.displayName || res.user.email}`);

        if (sheetsConfig.spreadsheetId) {
          await triggerAutoSync(reservations, rooms);
        }
      }
    } catch (err: any) {
      console.error('Sign-in failed', err);
      showToast(err.message || 'Sign in failed. Please try again.', 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout Handler
  const handleGoogleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setAccessToken(null);
      showToast('Signed out of Google.', 'info');
    } catch (err) {
      console.error('Logout error', err);
    }
  };

  // Update sheets config
  const handleUpdateSheetsConfig = (newConfig: GoogleSheetsConfig) => {
    setSheetsConfig(newConfig);
    saveSheetsConfig(newConfig);
    showToast('Google Sheets configuration updated.');
  };

  // Save Categories handler
  const handleSaveCategories = (newCategories: string[]) => {
    setCategories(newCategories);
    saveStoredCategories(newCategories);
    showToast(`Saved ${newCategories.length} categories: ${newCategories.join(', ')}`);
  };

  // Fetch categories dynamically from Google Sheet
  const handleFetchCategoriesFromGoogleSheet = async () => {
    if (!accessToken || !sheetsConfig.spreadsheetId) {
      setIsCategoriesModalOpen(true);
      return;
    }

    setIsFetchingCategories(true);
    try {
      const freshCats = await fetchCategoriesFromGoogleSheet(
        accessToken,
        sheetsConfig.spreadsheetId
      );
      setCategories(freshCats);
      saveStoredCategories(freshCats);
      showToast(`Loaded ${freshCats.length} categories from Google Sheet: ${freshCats.join(', ')}`);
    } catch (err: any) {
      console.error('Fetch categories error:', err);
      showToast(err.message || 'Failed to fetch categories from Google Sheet.', 'error');
    } finally {
      setIsFetchingCategories(false);
    }
  };

  // Open Google Sheet directly
  const handleOpenGoogleSheet = () => {
    if (sheetsConfig.spreadsheetId) {
      const url =
        sheetsConfig.spreadsheetUrl ||
        `https://docs.google.com/spreadsheets/d/${sheetsConfig.spreadsheetId}/edit`;
      window.open(url, '_blank');
    } else {
      setIsSheetsModalOpen(true);
    }
  };

  // 1-Click Two-Way Sync (User request: "once updated in google sheet it shows in the app and if updated in app it shows in google sheet with once sync button")
  const handleQuickSync = async () => {
    let currentToken = accessToken;

    // If not signed in to Google yet, prompt login
    if (!currentToken) {
      try {
        setIsLoggingIn(true);
        const res = await googleSignIn();
        if (res) {
          setUser(res.user);
          setAccessToken(res.accessToken);
          currentToken = res.accessToken;
          showToast(`Signed in to Google as ${res.user.displayName || res.user.email}`);
        } else {
          setIsSheetsModalOpen(true);
          return;
        }
      } catch (err: any) {
        showToast(err.message || 'Google sign-in is required to sync with Google Sheets.', 'error');
        setIsSheetsModalOpen(true);
        return;
      } finally {
        setIsLoggingIn(false);
      }
    }

    if (!sheetsConfig.spreadsheetId) {
      setIsSheetsModalOpen(true);
      return;
    }

    setSheetsConfig((prev) => ({ ...prev, isSyncing: true }));
    try {
      // Execute bidirectional synchronization:
      // 1. Pull changes from Google Sheet (new zaereen, modified room assignments, status)
      // 2. Merge without overwriting backend data
      // 3. Push full updated state back to Google Sheet, including Rooms Availability & Departure Timeline tab
      const syncResult = await twoWaySyncWithGoogleSheet(
        currentToken,
        sheetsConfig.spreadsheetId,
        reservations,
        rooms
      );

      if (syncResult.success) {
        setReservations(syncResult.mergedReservations);
        setRooms(syncResult.mergedRooms);
        saveReservations(syncResult.mergedReservations);
        saveRooms(syncResult.mergedRooms);

        // Persist to backend server so data remains until deleted
        if (isLiveBackendConnected) {
          saveBackendReservations(syncResult.mergedReservations);
          saveBackendRooms(syncResult.mergedRooms);
        }

        const updatedConfig: GoogleSheetsConfig = {
          ...sheetsConfig,
          spreadsheetUrl: syncResult.spreadsheetUrl,
          lastSyncedAt: new Date().toISOString(),
          isSyncing: false,
          syncError: null,
        };

        setSheetsConfig(updatedConfig);
        saveSheetsConfig(updatedConfig);
        if (isLiveBackendConnected) {
          saveBackendSettings({ sheetsConfig: updatedConfig });
        }

        showToast(
          `✓ Synced with Google Sheet! Updated Zaereen Lodging & Room Allotment Grid, 114 rooms & Rooms Availability Timeline.`
        );
      } else {
        throw new Error(syncResult.error || 'Sync failed');
      }
    } catch (err: any) {
      console.error('Two-way sync error:', err);
      setSheetsConfig((prev) => ({
        ...prev,
        isSyncing: false,
        syncError: err.message || 'Sync failed',
      }));
      showToast(err.message || 'Quick sync failed', 'error');
    }
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
    setReservations(updated);
    saveReservations(updated);
    upsertBackendReservation(newReservation);
    showToast(`Added Zair record for ${newReservation.applicantName}`);
    triggerAutoSync(updated, rooms);
    return true;
  };

  // Add Tour Batch (Multiple individuals sharing same Tour ID & dates, with distinct Family IDs)
  const handleAddTourBatch = (newBatch: Reservation[]) => {
    if (!newBatch || newBatch.length === 0) return false;
    const { finalReservations, uniqueToAppend, totalDuplicatesSkipped } = deduplicateForAppend(
      reservations,
      newBatch
    );

    if (uniqueToAppend.length === 0) {
      showToast('All entered individuals are duplicates of existing records.', 'error');
      return false;
    }

    setReservations(finalReservations);
    saveReservations(finalReservations);
    saveBackendReservations(finalReservations);

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
    triggerAutoSync(finalReservations, rooms);
    return true;
  };

  // Update Reservation
  const handleUpdateReservation = (updatedReservation: Reservation) => {
    const updated = reservations.map((r) =>
      r.id === updatedReservation.id ? updatedReservation : r
    );
    setReservations(updated);
    saveReservations(updated);
    upsertBackendReservation(updatedReservation);
    triggerAutoSync(updated, rooms);
  };

  // Delete Reservation (Single)
  const handleDeleteReservation = (id: string) => {
    const target = reservations.find((r) => r.id === id);
    if (!target) return;
    const updated = reservations.filter((r) => r.id !== id);
    setReservations(updated);
    saveReservations(updated);
    deleteBackendReservation(id);
    showToast(`Deleted zaer record for ${target.applicantName} (${target.itsId || target.tourRefNo})`);
    triggerAutoSync(updated, rooms);
  };

  // Delete Multiple Reservations (Batch)
  const handleBatchDeleteReservations = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    const count = ids.length;
    const updated = reservations.filter((r) => !idSet.has(r.id));
    setReservations(updated);
    saveReservations(updated);
    batchDeleteBackendReservations(ids);
    showToast(`Deleted ${count} zaer record${count > 1 ? 's' : ''}`);
    triggerAutoSync(updated, rooms);
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

  // Toggle Shift to Category A (Nizaam)
  const handleToggleShiftToCategoryA = (reservationId: string, willShift: boolean) => {
    const target = reservations.find((r) => r.id === reservationId);
    if (!target) return;

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

  // Allot Room to Zaer (Capacity aware with Buffer!)
  const handleAllotRoom = (reservationId: string, building: string, roomNumber: string) => {
    const target = reservations.find((r) => r.id === reservationId);
    if (!target) return;

    if (roomNumber) {
      const check = checkRoomAllotmentAvailability(
        building,
        roomNumber,
        target.arrivalDate,
        target.departureDate,
        rooms,
        reservations,
        1,
        target.id
      );

      if (!check.allowed) {
        alert(`Room Allotment Conflict: ${check.reason}`);
        return;
      }
    }

    const updatedRes: Reservation = {
      ...target,
      building,
      roomNumber,
      updatedAt: new Date().toISOString(),
    };

    handleUpdateReservation(updatedRes);
    showToast(
      roomNumber
        ? `Allotted ${building} Hotel Room ${roomNumber} to ${target.applicantName} (${target.arrivalDate} to ${target.departureDate})`
        : `Removed room allotment for ${target.applicantName}`
    );
  };

  // Batch Allot Room to entire Family on a Tour ID (or whole family in one go, with buffer support)
  const handleBatchAllotFamily = (
    tourRefNo: string,
    family: string,
    building: string,
    roomNumber: string
  ) => {
    const matches = reservations.filter((r) => {
      const matchFamily = (r.family || '').trim().toLowerCase() === family.trim().toLowerCase();
      const matchTour = !tourRefNo || (r.tourRefNo || '').trim().toLowerCase() === tourRefNo.trim().toLowerCase();
      return matchFamily && matchTour;
    });

    if (matches.length === 0) {
      showToast(`No zaereen found for Family "${family}"${tourRefNo ? ` in Tour "${tourRefNo}"` : ''}`, 'error');
      return;
    }

    // Check conflict against any reservations outside this family group with buffer
    const matchIds = new Set(matches.map((m) => m.id));
    if (roomNumber) {
      const first = matches[0];
      const check = checkRoomAllotmentAvailability(
        building,
        roomNumber,
        first.arrivalDate,
        first.departureDate,
        rooms,
        reservations.filter((r) => !matchIds.has(r.id)),
        matches.length
      );
      if (!check.allowed) {
        alert(`Cannot allot family to Room ${roomNumber}: ${check.reason}`);
        return;
      }
    }

    const updated = reservations.map((r) => {
      if (matchIds.has(r.id)) {
        return {
          ...r,
          building,
          roomNumber,
          updatedAt: new Date().toISOString(),
        };
      }
      return r;
    });

    setReservations(updated);
    saveReservations(updated);
    saveBackendReservations(updated);
    triggerAutoSync(updated, rooms);
    showToast(
      roomNumber
        ? `Allotted ${building} Room ${roomNumber} to all ${matches.length} members of Family "${family}" (${tourRefNo || 'all tours'}) in one go!`
        : `Cleared room allotment for Family "${family}" (${matches.length} members)`
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
      finalReservations = deduplicateReservationList(imported);
      feedbackToast = `Replaced all zaereen with ${finalReservations.length} records from Excel. Saved to backend.`;
    } else {
      const { uniqueToAppend, totalDuplicatesSkipped, finalReservations: merged } = deduplicateForAppend(
        reservations,
        imported
      );
      finalReservations = merged;

      if (uniqueToAppend.length === 0) {
        feedbackToast = `All ${imported.length} zaereen in the sheet are already present. No duplicates were added!`;
      } else if (totalDuplicatesSkipped > 0) {
        feedbackToast = `Appended ${uniqueToAppend.length} unique zaereen (${totalDuplicatesSkipped} duplicate${totalDuplicatesSkipped > 1 ? 's' : ''} skipped). Saved to backend!`;
      } else {
        feedbackToast = `Appended ${uniqueToAppend.length} unique zaereen to database. Saved to backend!`;
      }
    }

    // Auto-discover any new categories from the imported sheet
    const importedCats = Array.from(new Set(imported.map((r) => r.category).filter(Boolean)));
    const mergedCats = Array.from(new Set([...categories, ...importedCats]));
    if (mergedCats.length > categories.length) {
      setCategories(mergedCats);
      saveStoredCategories(mergedCats);
      saveBackendSettings({ categories: mergedCats });
    }

    setReservations(finalReservations);
    saveReservations(finalReservations);
    saveBackendReservations(finalReservations);
    showToast(feedbackToast);
    triggerAutoSync(finalReservations, rooms);
    setActiveTab('reservations');
  };

  // Room status updater (e.g. block / unblock)
  const handleUpdateRoomStatus = (roomId: string, status: RoomStatus) => {
    const updatedRooms = rooms.map((r) => (r.id === roomId ? { ...r, status } : r));
    setRooms(updatedRooms);
    saveRooms(updatedRooms);
    updateBackendRoom(roomId, { status });
    triggerAutoSync(reservations, updatedRooms);
  };

  const handleUpdateRoomDetails = (updatedRoom: Room) => {
    const updatedRooms = rooms.map((r) => (r.id === updatedRoom.id ? updatedRoom : r));
    setRooms(updatedRooms);
    saveRooms(updatedRooms);
    updateBackendRoom(updatedRoom.id, updatedRoom);
    triggerAutoSync(reservations, updatedRooms);
  };

  const handleResetToSaifeeBurhaniRooms = () => {
    if (window.confirm('Reset hotel inventory to the official 114 rooms across Burhani (44) and Saifee (70)?')) {
      const freshRooms = resetToSaifeeBurhani114Rooms();
      setRooms(freshRooms);
      saveRooms(freshRooms);
      resetBackendRooms();
      showToast('Restored official 114 rooms across Burhani (44) and Saifee (70).');
      triggerAutoSync(reservations, freshRooms);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1A2E26] font-sans selection:bg-[#124E39] selection:text-[#EBD59E]">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        sheetsConfig={sheetsConfig}
        userRole={userRole}
        onOpenRoleModal={() => setIsRoleModalOpen(true)}
        onOpenSheetsModal={() => setIsSheetsModalOpen(true)}
        onOpenGoogleSheet={handleOpenGoogleSheet}
        onOpenPdfModal={() => setIsPdfModalOpen(true)}
        onOpenUploadExcel={() => setIsExcelUploadOpen(true)}
        onOpenReceptionSlip={() => setIsReceptionSlipOpen(true)}
        onGoogleSignIn={handleGoogleSignIn}
        onGoogleLogout={handleGoogleLogout}
        isLoggingIn={isLoggingIn}
        onQuickSync={handleQuickSync}
        isLiveBackendConnected={isLiveBackendConnected}
      />

      {/* Main Container - Full Screen Width for complete visibility */}
      <main className="w-full px-2 sm:px-4 lg:px-6 pt-3 pb-12">
        {activeTab === 'dashboard' && (
          <Dashboard
            reservations={reservations}
            rooms={rooms}
            onNavigateTab={setActiveTab}
            onOpenUploadExcel={() => setIsExcelUploadOpen(true)}
            onOpenReceptionSlip={() => setIsReceptionSlipOpen(true)}
            onOpenAddZaer={() => setIsAddZaerOpen(true)}
            onOpenAddTourGroup={() => setIsAddTourGroupOpen(true)}
            onDownloadTemplate={downloadSampleExcelTemplate}
            onAllotRoom={handleAllotRoom}
            onBatchAllotFamily={handleBatchAllotFamily}
            onDeleteReservation={handleDeleteReservation}
            onToggleBlockRoom={(roomId) => {
              const r = rooms.find((rm) => rm.id === roomId);
              if (r) {
                handleUpdateRoomStatus(roomId, r.status === 'blocked' ? 'available' : 'blocked');
              }
            }}
            userRole={userRole}
            onOpenQuickAllotModal={(res) => setQuickAllotTarget(res)}
            sheetsConfig={sheetsConfig}
            onOpenSheetsModal={() => setIsSheetsModalOpen(true)}
            onOpenGoogleSheet={handleOpenGoogleSheet}
            onQuickSync={handleQuickSync}
            isLiveBackendConnected={isLiveBackendConnected}
          />
        )}

        {activeTab === 'reservations' && (
          <ReservationsView
            reservations={reservations}
            rooms={rooms}
            categories={categories}
            onAddReservation={handleAddReservation}
            onUpdateReservation={handleUpdateReservation}
            onDeleteReservation={handleDeleteReservation}
            onBatchDeleteReservations={handleBatchDeleteReservations}
            onOpenUploadExcel={() => setIsExcelUploadOpen(true)}
            onDownloadTemplate={downloadSampleExcelTemplate}
            onOpenAccountsSlip={(res) => setActiveAccountsSlipReservation(res)}
            onOpenReceptionSlip={() => setIsReceptionSlipOpen(true)}
            onOpenAddZaer={() => setIsAddZaerOpen(true)}
            onOpenAddTourGroup={() => setIsAddTourGroupOpen(true)}
            onOpenPdfModal={() => setIsPdfModalOpen(true)}
            onOpenCategoriesModal={() => setIsCategoriesModalOpen(true)}
            onNavigateToShifts={() => setActiveTab('upgrades')}
            onBatchAllotFamily={handleBatchAllotFamily}
            userRole={userRole}
            onOpenQuickAllotModal={(res) => setQuickAllotTarget(res)}
          />
        )}

        {activeTab === 'upgrades' && (
          <CategoryUpgradeView
            reservations={reservations}
            onToggleMoneyGiven={handleToggleMoneyGiven}
            onOpenAccountsSlip={(res) => setActiveAccountsSlipReservation(res)}
            onToggleShiftToCategoryA={handleToggleShiftToCategoryA}
          />
        )}

        {activeTab === 'rooms' && (
          <RoomsManagementView
            rooms={rooms}
            reservations={reservations}
            onUpdateRoomStatus={handleUpdateRoomStatus}
            onUpdateRoomDetails={handleUpdateRoomDetails}
            onResetRoomsToSaifeeBurhani={handleResetToSaifeeBurhaniRooms}
          />
        )}
      </main>

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
      <ReceptionDailySlipModal
        isOpen={isReceptionSlipOpen}
        onClose={() => setIsReceptionSlipOpen(false)}
        reservations={reservations}
        rooms={rooms}
        onUpdateReservation={handleUpdateReservation}
      />

      {/* Category B to A Accounts Request Slip Modal */}
      <AccountsRequestSlipModal
        reservation={activeAccountsSlipReservation}
        onClose={() => setActiveAccountsSlipReservation(null)}
        onToggleMoneyGiven={handleToggleMoneyGiven}
      />

      {/* Google Sheets Categories Modal */}
      <GoogleSheetCategoriesModal
        isOpen={isCategoriesModalOpen}
        onClose={() => setIsCategoriesModalOpen(false)}
        categories={categories}
        onSaveCategories={handleSaveCategories}
        user={user}
        accessToken={accessToken}
      />

      {/* Google Sheets Sync Modal */}
      <GoogleSheetsSyncModal
        isOpen={isSheetsModalOpen}
        onClose={() => setIsSheetsModalOpen(false)}
        user={user}
        accessToken={accessToken}
        sheetsConfig={sheetsConfig}
        categories={categories}
        onUpdateConfig={handleUpdateSheetsConfig}
        onGoogleSignIn={handleGoogleSignIn}
        reservations={reservations}
        rooms={rooms}
        onRoomsFetched={(newRooms) => {
          setRooms(newRooms);
          saveRooms(newRooms);
          showToast(`Imported ${newRooms.length} rooms from Google Sheet!`);
        }}
        onReservationsFetched={(newRes) => {
          const uniqueRes = deduplicateReservationList(newRes);
          setReservations(uniqueRes);
          saveReservations(uniqueRes);
          saveBackendReservations(uniqueRes);
          showToast(`Synchronized ${uniqueRes.length} unique zaereen from Google Sheet!`);
        }}
        onCategoriesFetched={(newCats) => {
          setCategories(newCats);
          saveStoredCategories(newCats);
          showToast(`Synchronized ${newCats.length} categories from Google Sheet!`);
        }}
      />

      {/* Administrative PDF Export Modal */}
      <PdfExportModal
        isOpen={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
        reservations={reservations}
        rooms={rooms}
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
      <QuickRoomAllotModal
        isOpen={!!quickAllotTarget}
        onClose={() => setQuickAllotTarget(null)}
        targetReservation={quickAllotTarget}
        rooms={rooms}
        reservations={reservations}
        onAllotRoom={handleAllotRoom}
        onBatchAllotFamily={handleBatchAllotFamily}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 bg-[#124E39] border border-[#C5A059]/50 text-white rounded-xl shadow-2xl text-xs animate-in fade-in slide-in-from-bottom-2">
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#EBD59E] shrink-0" />
          )}
          <span className="font-medium">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-stone-300 hover:text-white p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
