/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Download,
  Clock,
  RefreshCw
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
  checkRoomAllotmentAvailability,
  isInfant,
  countEffectivePax,
  getRoomBookingsForDuration,
  deduplicateRooms,
  getCanonicalRoomKey,
  reconcileOfficialSaifeeBurhaniRooms
} from './services/storage';
import { 
  initAuth, 
  googleSignIn, 
  logout,
  getSessionRemainingMs,
  AUTHORIZED_ADMIN_EMAILS,
  getUserEmail,
  isAuthorizedAdminEmail
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
import { 
  broadcastLiveSync, 
  subscribeToMultiWindowSync 
} from './utils/multiWindowSync';

import { Navbar, type AppTab } from './components/Navbar';
import { NkerpSyncView } from './components/NkerpSyncView';
import { NajafEmailsView } from './components/NajafEmailsView';
import { useNajafEmails } from './hooks/useNajafEmails';
import { SyncAccessKeyModal } from './components/SyncAccessKeyModal';
import { useNkerpSync } from './hooks/useNkerpSync';
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
import { PdfExportOptions } from './services/pdfExport';
import { RoleManagementModal } from './components/RoleManagementModal';
import { QuickRoomAllotModal } from './components/QuickRoomAllotModal';
import { SwitchRoomModal, SwitchRoomTarget } from './components/SwitchRoomModal';
import { AddZaerModal } from './components/AddZaerModal';
import { AddTourGroupModal } from './components/AddTourGroupModal';
import { AddBuildingAndRoomsModal } from './components/AddBuildingAndRoomsModal';
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
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');

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
  const [switchRoomTarget, setSwitchRoomTarget] = useState<SwitchRoomTarget | null>(null);

  // Auth & Google Sheets State
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isFetchingCategories, setIsFetchingCategories] = useState(false);
  const [sheetsConfig, setSheetsConfig] = useState<GoogleSheetsConfig>(getStoredSheetsConfig());

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
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState(false);
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
  const [addBuildingRoomsInitialTab, setAddBuildingRoomsInitialTab] = useState<'manual' | 'sheet'>('manual');

  // User request: "when the app is opened first ask to upload excel and then sync the document"
  const [isStartupPromptOpen, setIsStartupPromptOpen] = useState<boolean>(() => {
    try {
      return !sessionStorage.getItem('faiz_startup_prompt_dismissed');
    } catch {
      return true;
    }
  });

  // User request: "when all rooms for one date are allotted ask once to sync with google sheet so that when it is opened again the list is updated and ready to be synced again"
  const [dateFullyAllottedSyncPrompt, setDateFullyAllottedSyncPrompt] = useState<{
    date: string;
    totalZaereen: number;
  } | null>(null);
  const promptedAllottedDatesRef = useRef<Set<string>>(new Set());
  // Dates already fully allotted when the data first loads are not prompted again;
  // only a date that becomes fully allotted during this session asks to sync.
  const allottedDatesSeededRef = useRef(false);

  // Post-Excel upload sync prompt
  const [afterExcelSyncPrompt, setAfterExcelSyncPrompt] = useState<{
    count: number;
  } | null>(null);

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
  } | null>(null);

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

  // User Requirement: "when refeshed it should take all the data which is fed in the same computer"
  // And "in compact button matrix I want to add live change when multiple windows are open."
  const handleRefreshLiveComputerData = useCallback(async (showFeedback = true) => {
    // 1. Initial immediate hydrate from local storage
    const localRooms = getStoredRooms();
    const localReservations = getStoredReservations();
    const localSheetsConfig = getStoredSheetsConfig();
    const localCategories = getStoredCategories();

    setRooms(localRooms);
    setReservations(localReservations);
    setSheetsConfig(localSheetsConfig);
    setCategories(localCategories);

    // 2. Query live server backend for latest data fed across windows
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
          const cleanBackendRooms = reconcileOfficialSaifeeBurhaniRooms(deduplicateRooms(backendRooms));
          setRooms(cleanBackendRooms);
          saveRooms(cleanBackendRooms);
          if (cleanBackendRooms.length !== backendRooms.length || JSON.stringify(cleanBackendRooms) !== JSON.stringify(backendRooms)) {
            saveBackendRooms(cleanBackendRooms);
          }
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
        }
      }
      if (showFeedback) {
        showToast('✓ Successfully refreshed all latest accommodation & zaereen data on this computer.');
      }
    } catch (err) {
      console.warn('Backend sync refreshed from local cache:', err);
      if (showFeedback) {
        showToast('Refreshed data from computer cache.', 'info');
      }
    }
  }, []);

  // Initial data load on mount
  useEffect(() => {
    handleRefreshLiveComputerData(false);
  }, [handleRefreshLiveComputerData]);

  // Live Multi-Window synchronization listener (BroadcastChannel + Window Storage + SSE)
  // When another open window on this computer makes any allotment or data change, silently refresh
  useEffect(() => {
    const unsubscribe = subscribeToMultiWindowSync(() => {
      handleRefreshLiveComputerData(false);
    });

    return () => {
      unsubscribe();
    };
  }, [handleRefreshLiveComputerData]);

  // Initialize Firebase Auth listener
  // User Requirement:
  // Authorized Admin emails automatically receive Admin access; others get Receptionist view.
  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser, token) => {
        setUser(authUser);
        setAccessToken(token || null);
        const email = getUserEmail(authUser);
        if (isAuthorizedAdminEmail(email)) {
          setUserRole('admin');
          saveStoredUserRole('admin');
        } else {
          setUserRole('receptionist');
          saveStoredUserRole('receptionist');
        }
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setUserRole('receptionist');
        saveStoredUserRole('receptionist');
      }
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // User request: "when all rooms for one date are allotted ask once to sync with google sheet so that when it is opened again the list is updated and ready to be synced again"
  useEffect(() => {
    if (reservations.length === 0) return;
    const dateMap = new Map<string, Reservation[]>();
    reservations.forEach((r) => {
      const arr = (r.arrivalDate || '').slice(0, 10);
      if (arr) {
        const list = dateMap.get(arr) || [];
        list.push(r);
        dateMap.set(arr, list);
      }
    });

    const isSeeding = !allottedDatesSeededRef.current;
    allottedDatesSeededRef.current = true;

    dateMap.forEach((resList, dateKey) => {
      if (resList.length > 0) {
        const allAllotted = resList.every((r) => !!r.roomNumber && r.roomNumber.trim() !== '');
        if (allAllotted) {
          if (!promptedAllottedDatesRef.current.has(dateKey)) {
            promptedAllottedDatesRef.current.add(dateKey);
            if (isSeeding) return;
            setDateFullyAllottedSyncPrompt({
              date: dateKey,
              totalZaereen: resList.length,
            });
          }
        } else {
          promptedAllottedDatesRef.current.delete(dateKey);
        }
      }
    });
  }, [reservations]);

  // Sync to Google Sheets if configured (strictly Admin only)
  const triggerAutoSync = useCallback(
    async (currentReservations: Reservation[], currentRooms: Room[], force: boolean = false) => {
      // User Requirement: without admin login no one can push to sheet
      if (userRole !== 'admin') {
        return;
      }
      if (!accessToken || !sheetsConfig.spreadsheetId) {
        return;
      }
      if (!force && !sheetsConfig.autoSync) {
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
          if (force) {
            showToast('⭐ Special status updated & synced to Google Sheet!', 'success');
          }
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
    [accessToken, sheetsConfig, userRole, showToast]
  );

  // Pull rooms & reservations from linked sheet (Accessible by Receptionist & Admin)
  // User Requirement: "so when pulled by receptionist it updates the blocked/unblock rooms too"
  const handlePullFromGoogleSheet = useCallback(
    async (showFeedback: boolean = false) => {
      if (!sheetsConfig.spreadsheetId) return;

      try {
        setSheetsConfig((prev) => ({ ...prev, isSyncing: true }));
        const [freshRooms, freshRes] = await Promise.all([
          fetchRoomsFromGoogleSheet(accessToken || '', sheetsConfig.spreadsheetId, rooms).catch((err) => {
            console.warn('Rooms pull warning:', err);
            return rooms;
          }),
          fetchReservationsFromGoogleSheet(accessToken || '', sheetsConfig.spreadsheetId, rooms, reservations),
        ]);

        if (freshRooms && freshRooms.length > 0) {
          const cleanFreshRooms = reconcileOfficialSaifeeBurhaniRooms(deduplicateRooms(freshRooms));
          setRooms(cleanFreshRooms);
          saveRooms(cleanFreshRooms);
          saveBackendRooms(cleanFreshRooms);
        }

        if (freshRes && freshRes.length > 0) {
          const uniqueRes = deduplicateReservationList(freshRes);
          setReservations(uniqueRes);
          saveReservations(uniqueRes);
          saveBackendReservations(uniqueRes);
        }

        broadcastLiveSync({ type: 'PULL_COMPLETED' });

        const updated: GoogleSheetsConfig = {
          ...sheetsConfig,
          lastSyncedAt: new Date().toISOString(),
          isSyncing: false,
          syncError: null,
        };
        setSheetsConfig(updated);
        saveSheetsConfig(updated);

        if (showFeedback) {
          showToast(
            `✓ Successfully pulled from Google Sheet! Synchronized ${freshRooms.length} rooms (with blocked/unblocked status) and ${freshRes.length} zaereen.`
          );
        }
      } catch (err: any) {
        console.warn('Google Sheet pull error:', err);
        setSheetsConfig((prev) => ({
          ...prev,
          isSyncing: false,
          syncError: err.message || 'Pull failed',
        }));
        if (showFeedback) {
          showToast(err.message || 'Failed to pull from Google Sheet', 'error');
        }
      }
    },
    [accessToken, sheetsConfig, rooms, reservations, showToast]
  );

  // Logout Handler
  const handleGoogleLogout = useCallback(async () => {
    try {
      await logout();
      setUser(null);
      setAccessToken(null);
      setUserRole('receptionist');
      saveStoredUserRole('receptionist');
      showToast('Signed out of Google. Switched to Receptionist view.', 'info');
    } catch (err) {
      console.error('Logout error', err);
    }
  }, [showToast]);

  // 1-Hour Session & Recurring Auto Push/Pull Lifecycle:
  // User Requirement:
  // "2: Receptionist should have live update. the admin should push after every one hour and receptionist view should pull after every one hour. (manual push and pull should be intact as logic given before)
  //  3: keep signed in for 1 hour without need to log in again and after 1 hr logout automatically and before that push if admin and pull if receptionist view"
  useEffect(() => {
    const ONE_HOUR = 60 * 60 * 1000;

    // Hourly Interval for Auto-Push (Admin) and Auto-Pull (Receptionist)
    const hourlySyncInterval = setInterval(async () => {
      if (userRole === 'admin') {
        if (accessToken && sheetsConfig.spreadsheetId) {
          try {
            await triggerAutoSync(reservations, rooms, true);
            showToast('⏰ Hourly Admin Push: Pushed latest Zaereen and blocked/unblocked room details to Google Sheet.', 'info');
          } catch (e) {
            console.warn('Hourly auto-push error:', e);
          }
        }
      } else {
        // Receptionist view pulls after every 1 hour
        if (sheetsConfig.spreadsheetId) {
          await handlePullFromGoogleSheet(true);
        }
      }
    }, ONE_HOUR);

    // Session Timeout Checker (Every 30 seconds):
    // Keeps signed in for 1 hour without needing to re-login.
    // When 1 hour expires, pushes if admin / pulls if receptionist, and automatically logs out.
    const sessionTimer = setInterval(async () => {
      if (user) {
        const remaining = getSessionRemainingMs();
        if (remaining <= 0) {
          try {
            if (userRole === 'admin' && accessToken && sheetsConfig.spreadsheetId) {
              await syncAllToGoogleSheet(accessToken, sheetsConfig.spreadsheetId, reservations, rooms);
            } else if (sheetsConfig.spreadsheetId) {
              await handlePullFromGoogleSheet(false);
            }
          } catch (e) {
            console.warn('Pre-logout auto-sync error:', e);
          }
          await handleGoogleLogout();
          showToast('🔒 1-hour session expired. Final sync executed to Google Sheet and automatically signed out.', 'info');
        }
      }
    }, 30000);

    return () => {
      clearInterval(hourlySyncInterval);
      clearInterval(sessionTimer);
    };
  }, [user, userRole, accessToken, sheetsConfig, reservations, rooms, triggerAutoSync, handlePullFromGoogleSheet, handleGoogleLogout, showToast]);

  // Sign In Handler
  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setAccessToken(res.accessToken || null);
        const email = getUserEmail(res.user);
        if (isAuthorizedAdminEmail(email)) {
          setUserRole('admin');
          saveStoredUserRole('admin');
          showToast(
            res.accessToken
              ? `Welcome Admin ${res.user.displayName || email}! Full editable rights & Push to Google Sheet enabled.`
              : `Welcome Admin ${res.user.displayName || email}! Full editable rights enabled.`
          );
          if (sheetsConfig.spreadsheetId && res.accessToken) {
            await triggerAutoSync(reservations, rooms);
          }
        } else {
          setUserRole('receptionist');
          saveStoredUserRole('receptionist');
          showToast(`Logged in as ${email}. Receptionist view active (View-only, Pull from Google Sheet allowed).`);
        }
      }
    } catch (err: any) {
      console.error('Sign-in failed', err);
      showToast(err.message || 'Sign in failed. Please try again.', 'error');
    } finally {
      setIsLoggingIn(false);
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
    if (sheetsConfig.spreadsheetUrl && sheetsConfig.spreadsheetUrl.startsWith('http')) {
      window.open(sheetsConfig.spreadsheetUrl, '_blank');
    } else if (
      sheetsConfig.spreadsheetId &&
      sheetsConfig.spreadsheetId !== 'faiz_husaini_attached_default' &&
      !sheetsConfig.spreadsheetId.includes('default')
    ) {
      window.open(`https://docs.google.com/spreadsheets/d/${sheetsConfig.spreadsheetId}/edit`, '_blank');
    } else {
      setIsSheetsModalOpen(true);
    }
  };

  // 1-Click Two-Way Sync (User request: "once updated in google sheet it shows in the app and if updated in app it shows in google sheet with once sync button")
  const handleQuickSync = async () => {
    let currentToken = accessToken;
    let effectiveRole: UserRole = userRole;

    // If not signed in to Google (or missing Sheets OAuth token), prompt login
    if (!currentToken) {
      try {
        setIsLoggingIn(true);
        const res = await googleSignIn();
        if (res) {
          setUser(res.user);
          setAccessToken(res.accessToken || null);
          currentToken = res.accessToken || null;
          const email = getUserEmail(res.user);
          effectiveRole = isAuthorizedAdminEmail(email) ? 'admin' : 'receptionist';
          setUserRole(effectiveRole);
          saveStoredUserRole(effectiveRole);
          showToast(`Signed in to Google as ${res.user.displayName || email}`);
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

    if (effectiveRole !== 'admin') {
      showToast(
        `Action Blocked: Only authorized Administrators (${AUTHORIZED_ADMIN_EMAILS.join(', ')}) can push to sheet. Receptionist view can only pull from sheet.`,
        'error'
      );
      return;
    }

    if (!currentToken) {
      showToast('Google Sheets write permission was not granted during sign-in. Open Sheet settings or add this Gmail as an OAuth Test User for Google Sheets access.', 'error');
      setIsSheetsModalOpen(true);
      return;
    }

    if (!sheetsConfig.spreadsheetId) {
      setIsSheetsModalOpen(true);
      return;
    }

    setSheetsConfig((prev) => ({ ...prev, isSyncing: true }));
    try {
      // User requirement: "otherwise there should be no two way sync only 'Push to sheet'"
      // Push current app state to Google Sheet (Zaereen grid, room allotments, timeline)
      const syncResult = await syncAllToGoogleSheet(
        currentToken,
        sheetsConfig.spreadsheetId,
        reservations,
        rooms
      );

      if (syncResult.success) {
        const updatedConfig: GoogleSheetsConfig = {
          ...sheetsConfig,
          spreadsheetUrl: syncResult.spreadsheetUrl || sheetsConfig.spreadsheetUrl,
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
          `✓ Successfully pushed latest Zaereen records and room allotments to Google Sheet!`
        );
      } else {
        throw new Error(syncResult.error || 'Push to sheet failed');
      }
    } catch (err: any) {
      console.error('Push to Google Sheet error:', err);
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
    broadcastLiveSync({ type: 'RESERVATION_ADDED', reservationId: newReservation.id });
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
    broadcastLiveSync({ type: 'TOUR_BATCH_ADDED', tourId });
    return true;
  };

  // Update Reservation
  const handleUpdateReservation = (updatedReservation: Reservation) => {
    setReservations((prev) => {
      const updated = prev.map((r) =>
        r.id === updatedReservation.id ? updatedReservation : r
      );
      saveReservations(updated);
      const isSpecialToggled = updatedReservation.isSpecialGuest !== undefined;
      triggerAutoSync(updated, rooms, isSpecialToggled);
      return updated;
    });
    upsertBackendReservation(updatedReservation);
    broadcastLiveSync({ type: 'RESERVATION_UPDATED', reservationId: updatedReservation.id });
  };

  // Batch Update Reservations
  const handleBatchUpdateReservations = (updatedList: Reservation[]) => {
    if (!updatedList || updatedList.length === 0) return;
    const map = new Map(updatedList.map((r) => [r.id, r]));
    setReservations((prev) => {
      const updated = prev.map((r) => map.get(r.id) || r);
      saveReservations(updated);
      const anySpecialToggled = updatedList.some((r) => r.isSpecialGuest !== undefined);
      triggerAutoSync(updated, rooms, anySpecialToggled);
      return updated;
    });
    updatedList.forEach((r) => upsertBackendReservation(r));
    broadcastLiveSync({ type: 'RESERVATIONS_BATCH_UPDATED', count: updatedList.length });
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
    setReservations(updated);
    saveReservations(updated);
    deleteBackendReservation(id);
    showToast(`Deleted zaer record for ${target.applicantName} (${target.itsId || target.tourRefNo})`);
    triggerAutoSync(updated, rooms);
    broadcastLiveSync({ type: 'RESERVATION_DELETED', reservationId: id });
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
    setReservations(updated);
    saveReservations(updated);
    batchDeleteBackendReservations(ids);
    showToast(`Deleted ${count} zaer record${count > 1 ? 's' : ''}`);
    triggerAutoSync(updated, rooms);
    broadcastLiveSync({ type: 'RESERVATIONS_BATCH_DELETED', count });
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
    forceConfirmed: boolean = false
  ) => {
    const target = reservations.find((r) => r.id === reservationId);
    if (!target) return;

    if (!roomNumber) {
      executeDirectAllot(reservationId, building, '', 'Room allotment cleared');
      return;
    }

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
    forceConfirmed: boolean = false
  ) => {
    const safeTour = String(tourRefNo || '').trim().toLowerCase();
    const safeFam = String(family || '').trim().toLowerCase();

    const matches = reservations.filter((r) => {
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
    notes?: string
  ) => {
    const slipDate = new Date().toISOString().slice(0, 10);
    const idSet = new Set(reservationIds);
    const updated = reservations.map((r) => {
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
      `Shifted ${reservationIds.length} pilgrim(s) to Category A (Payment / Money Given: ${moneyGiven})`
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

    setReservations(updated);
    saveReservations(updated);
    saveBackendReservations(updated);
    triggerAutoSync(updated, rooms);
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
      finalReservations = deduplicateReservationList(imported);
      feedbackToast = `Replaced all zaereen with ${finalReservations.length} records from Excel. Saved to backend.`;
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
      saveStoredCategories(mergedCats);
      saveBackendSettings({ categories: mergedCats });
    }

    setReservations(finalReservations);
    saveReservations(finalReservations);
    saveBackendReservations(finalReservations);
    showToast(feedbackToast);
    triggerAutoSync(finalReservations, rooms);
    broadcastLiveSync({ type: 'EXCEL_IMPORTED', count: finalReservations.length });
    setActiveTab('reservations');
    // Prompt to sync document with Google Sheet after uploading Excel
    setAfterExcelSyncPrompt({ count: finalReservations.length });
  };

  // Room status updater (e.g. block / unblock)
  const handleUpdateRoomStatus = (roomId: string, status: RoomStatus) => {
    const updatedRooms = rooms.map((r) => (r.id === roomId ? { ...r, status } : r));
    setRooms(updatedRooms);
    saveRooms(updatedRooms);
    updateBackendRoom(roomId, { status });
    triggerAutoSync(reservations, updatedRooms);
    broadcastLiveSync({ type: 'ROOM_STATUS_UPDATED', roomId, status });
  };

  const handleUpdateRoomDetails = (updatedRoom: Room) => {
    const updatedRooms = rooms.map((r) => (r.id === updatedRoom.id ? updatedRoom : r));
    setRooms(updatedRooms);
    saveRooms(updatedRooms);
    updateBackendRoom(updatedRoom.id, updatedRoom);
    triggerAutoSync(reservations, updatedRooms);
    broadcastLiveSync({ type: 'ROOM_DETAILS_UPDATED', roomId: updatedRoom.id });
  };

  const handleResetToSaifeeBurhaniRooms = () => {
    if (window.confirm('Reset hotel inventory to the official 114 rooms across Burhani (44) and Saifee (70)?')) {
      const freshRooms = resetToSaifeeBurhani114Rooms();
      setRooms(freshRooms);
      saveRooms(freshRooms);
      resetBackendRooms();
      showToast('Restored official 114 rooms across Burhani (44) and Saifee (70).');
      triggerAutoSync(reservations, freshRooms);
      broadcastLiveSync({ type: 'ROOMS_RESET_114' });
    }
  };

  // Add or sync rooms / buildings
  const handleAddRooms = (newRoomsToAdd: Room[], replaceExisting: boolean = false) => {
    const cleanIncoming = deduplicateRooms(newRoomsToAdd);
    let finalRooms: Room[];
    if (replaceExisting) {
      finalRooms = cleanIncoming;
    } else {
      // Merge by canonical (building, roomNumber), preserving existing canonical IDs
      const roomMap = new Map<string, Room>();
      deduplicateRooms(rooms).forEach((r) => {
        const key = getCanonicalRoomKey(r.building, r.roomNumber);
        if (key) roomMap.set(key, r);
      });
      cleanIncoming.forEach((nr) => {
        const key = getCanonicalRoomKey(nr.building, nr.roomNumber);
        if (!key) return;
        const existing = roomMap.get(key);
        roomMap.set(key, existing ? { ...nr, id: existing.id } : nr);
      });
      finalRooms = reconcileOfficialSaifeeBurhaniRooms(deduplicateRooms(Array.from(roomMap.values())));
    }

    setRooms(finalRooms);
    saveRooms(finalRooms);
    saveBackendRooms(finalRooms);
    triggerAutoSync(reservations, finalRooms);
    broadcastLiveSync({ type: 'ROOMS_ADDED', count: cleanIncoming.length });

    const distinctNewBuildings = Array.from(new Set(cleanIncoming.map((r) => r.building)));
    showToast(
      `Saved ${cleanIncoming.length} unique room(s) across building(s): ${distinctNewBuildings.join(', ')}! Total inventory: ${finalRooms.length} rooms.`
    );
  };

  const handleDeleteRoom = (roomId: string) => {
    const updated = rooms.filter((r) => r.id !== roomId);
    setRooms(updated);
    saveRooms(updated);
    saveBackendRooms(updated);
    triggerAutoSync(reservations, updated);
    broadcastLiveSync({ type: 'ROOM_DELETED', roomId });
    showToast('Room removed from inventory.');
  };

  return (
    <div className="min-h-screen bg-canvas text-ink font-sans">
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
        onOpenPdfModal={handleOpenPdfModal}
        onOpenUploadExcel={() => setIsExcelUploadOpen(true)}
        onOpenReceptionSlip={handleOpenReceptionSlip}
        onGoogleSignIn={handleGoogleSignIn}
        onGoogleLogout={handleGoogleLogout}
        isLoggingIn={isLoggingIn}
        onQuickSync={handleQuickSync}
        isLiveBackendConnected={isLiveBackendConnected}
        roomsCount={rooms.length}
        onOpenAddBuildingRooms={() => {
          setAddBuildingRoomsInitialTab('manual');
          setIsAddBuildingRoomsOpen(true);
        }}
        nkerpSync={nkerpSync}
        emailsRunning={najafEmails.run.running}
      />
      <SyncAccessKeyModal sync={nkerpSync} />

      {/* Main Container - Full Screen Width with mobile bottom-bar clearance */}
      <main key={activeTab} className="tab-enter mx-auto w-full max-w-[1680px] px-3 sm:px-4 lg:px-6 pt-3 md:pt-5 pb-24 md:pb-12">
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
            sheetsConfig={sheetsConfig}
            onOpenSheetsModal={() => setIsSheetsModalOpen(true)}
            onOpenGoogleSheet={handleOpenGoogleSheet}
            onQuickSync={handleQuickSync}
            isLiveBackendConnected={isLiveBackendConnected}
            onRefreshLiveComputerData={() => handleRefreshLiveComputerData(true)}
            onOpenAddBuildingRooms={() => {
              setAddBuildingRoomsInitialTab('manual');
              setIsAddBuildingRoomsOpen(true);
            }}
            onOpenPdfModal={handleOpenPdfModal}
          />
        )}

        {activeTab === 'reservations' && (
          <ReservationsView
            reservations={reservations}
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
          />
        )}

        {activeTab === 'upgrades' && (
          <CategoryUpgradeView
            reservations={reservations}
            rooms={rooms}
            onToggleMoneyGiven={handleToggleMoneyGiven}
            onOpenAccountsSlip={(res) => handleOpenAccountsSlipModal(res, 'B_TO_A')}
            onOpenAToBSlip={() => handleOpenAccountsSlipModal(null, 'A_TO_B')}
            onToggleShiftToCategoryA={handleToggleShiftToCategoryA}
            onAddZaer={handleAddReservation}
            onDeleteReservation={handleDeleteReservation}
            userRole={userRole}
          />
        )}

        {activeTab === 'sync' && <NkerpSyncView sync={nkerpSync} />}

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
            accessToken={accessToken}
            sheetsConfig={sheetsConfig}
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
        userRole={userRole}
        onRoomsFetched={(newRooms) => {
          const cleanRooms = reconcileOfficialSaifeeBurhaniRooms(deduplicateRooms(newRooms));
          setRooms(cleanRooms);
          saveRooms(cleanRooms);
          saveBackendRooms(cleanRooms);
          broadcastLiveSync({ type: 'ROOMS_UPDATED' });
          showToast(`Imported ${cleanRooms.length} unique rooms from Google Sheet! (Verified Burhani & Saifee capacities and blocked status)`);
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
        onOpenAddBuildingRoomsModal={() => {
          setAddBuildingRoomsInitialTab('sheet');
          setIsAddBuildingRoomsOpen(true);
        }}
      />

      {/* Add Hotel Buildings & Rooms Modal (Manual Entry & Google Sheet Sync) */}
      <AddBuildingAndRoomsModal
        isOpen={isAddBuildingRoomsOpen}
        onClose={() => setIsAddBuildingRoomsOpen(false)}
        existingRooms={rooms}
        onAddRooms={handleAddRooms}
        accessToken={accessToken}
        sheetsConfig={sheetsConfig}
        initialTab={addBuildingRoomsInitialTab}
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
        user={user}
        onGoogleSignIn={handleGoogleSignIn}
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
        <div className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-2xl max-w-lg w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl ${allocationNotice.isSameDayTurnover ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                  {allocationNotice.isSameDayTurnover ? (
                    <Clock className="w-5 h-5" />
                  ) : (
                    <AlertCircle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base leading-tight">
                    {allocationNotice.title}
                  </h3>
                  <p className="text-xs text-stone-500">
                    Room {allocationNotice.roomNumber} • {allocationNotice.building} Hotel • For {allocationNotice.guestName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAllocationNotice(null)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className={`p-3.5 rounded-xl text-xs space-y-2 border ${
              allocationNotice.isSameDayTurnover
                ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                : 'bg-rose-50/80 border-rose-200 text-rose-950'
            }`}>
              <div className="font-semibold text-sm leading-snug">
                {allocationNotice.message}
              </div>
              {allocationNotice.diffHoursText && (
                <div className="flex items-center gap-2 pt-1 font-mono text-xs">
                  <span className="bg-amber-200/80 border border-amber-300 px-2 py-0.5 rounded font-bold">
                    ⏱ Hour Difference: {allocationNotice.diffHoursText} Hours
                  </span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-stone-500">
              Allotting will save this room and update the room grid.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setAllocationNotice(null)}
                className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 font-semibold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={allocationNotice.onConfirm}
                className="px-5 py-2 rounded-xl bg-[#0f4a37] hover:bg-[#0b3a2b] text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-[#ecdcae]" />
                <span>Allot anyway</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User request: "when the app is opened first ask to upload excel and then sync the document" */}
      {isStartupPromptOpen && (() => {
        const dismissStartup = () => {
          setIsStartupPromptOpen(false);
          try { sessionStorage.setItem('faiz_startup_prompt_dismissed', 'true'); } catch {}
        };
        return (
          <div
            className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3 sm:p-4 animate-in fade-in"
            onClick={dismissStartup}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="startup-title"
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-6 pb-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 id="startup-title" className="text-xl font-semibold tracking-[-0.01em] text-stone-950">
                      Start your shift
                    </h3>
                    <p className="mt-1 text-sm text-stone-500">
                      Bring in today's zaereen list, then sync it so everyone works from the same data.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={dismissStartup}
                    className="-mr-2 -mt-1 p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <ol className="px-3 py-3 space-y-1">
                {[
                  {
                    n: 1,
                    title: 'Upload the zaereen Excel',
                    body: 'ITS, name, family, tour ID and dates.',
                    action: 'Upload',
                    icon: Upload,
                    primary: true,
                    onClick: () => { dismissStartup(); setIsExcelUploadOpen(true); },
                  },
                  {
                    n: 2,
                    title: 'Sync with Google Sheets',
                    body: 'Update the sheet with rooms and the latest list.',
                    action: 'Sync',
                    icon: RefreshCw,
                    primary: false,
                    onClick: () => { dismissStartup(); handleQuickSync(); },
                  },
                ].map((step) => (
                  <li key={step.n} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-stone-50">
                    <span className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 text-[13px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
                      {step.n}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-900">{step.title}</div>
                      <div className="text-[13px] text-stone-500">{step.body}</div>
                    </div>
                    <button
                      type="button"
                      onClick={step.onClick}
                      className={`h-9 px-3 rounded-lg text-[13px] font-medium flex items-center gap-1.5 shrink-0 cursor-pointer transition ${
                        step.primary
                          ? 'bg-brand-700 hover:bg-brand-800 text-white shadow-xs'
                          : 'bg-white text-stone-800 ring-1 ring-inset ring-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <step.icon className={`w-4 h-4 ${step.primary ? 'text-gold-200' : 'text-stone-500'}`} />
                      {step.action}
                    </button>
                  </li>
                ))}
              </ol>

              <div className="flex items-center justify-between gap-3 px-6 py-4 bg-stone-50 border-t border-stone-100">
                <span className="text-[13px] text-stone-500 tabular-nums">
                  {reservations.length} zaereen, {rooms.length} rooms loaded
                </span>
                <button
                  type="button"
                  onClick={dismissStartup}
                  className="text-[13px] font-medium text-stone-700 hover:text-stone-950 cursor-pointer"
                >
                  Skip for now
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* User request: "when all rooms for one date are allotted ask once to sync with google sheet so that when it is opened again the list is updated and ready to be synced again" */}
      {/* One dialog at a time: this waits until the start-of-shift prompt is closed. */}
      {dateFullyAllottedSyncPrompt && !isStartupPromptOpen && (
        <div className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in">
          <div role="dialog" aria-modal="true" className="bg-white rounded-2xl border border-stone-200 shadow-2xl max-w-md w-full p-5 space-y-4 text-stone-800 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base leading-tight">
                    Rooms allotted for {dateFullyAllottedSyncPrompt.date}
                  </h3>
                  <p className="text-xs text-stone-500">
                    All {dateFullyAllottedSyncPrompt.totalZaereen} zaereen arriving that day have rooms
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDateFullyAllottedSyncPrompt(null)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-stone-700 leading-relaxed">
              Every zair arriving on <strong>{dateFullyAllottedSyncPrompt.date}</strong> now has a room. Sync with Google Sheets now so the sheet shows these rooms next time the app opens.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setDateFullyAllottedSyncPrompt(null)}
                className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 font-semibold text-xs transition cursor-pointer"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => {
                  setDateFullyAllottedSyncPrompt(null);
                  handleQuickSync();
                }}
                className="px-4 py-2 rounded-xl bg-[#0f4a37] hover:bg-[#0b3a2b] text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#ecdcae]" />
                <span>Sync now</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-Excel upload follow-up sync prompt */}
      {afterExcelSyncPrompt && (
        <div className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-2xl max-w-md w-full p-5 space-y-4 text-stone-800">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-100 text-blue-800">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base leading-tight">
                    Excel imported
                  </h3>
                  <p className="text-xs text-stone-500">
                    {afterExcelSyncPrompt.count} zaereen saved
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAfterExcelSyncPrompt(null)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-stone-700 leading-relaxed">
              The list is saved. Sync with Google Sheets now to back it up and share it.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setAfterExcelSyncPrompt(null)}
                className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 font-semibold text-xs transition cursor-pointer"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => {
                  setAfterExcelSyncPrompt(null);
                  handleQuickSync();
                }}
                className="px-4 py-2 rounded-xl bg-[#0f4a37] hover:bg-[#0b3a2b] text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#ecdcae]" />
                <span>Sync now</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div role="status" className="fixed bottom-20 md:bottom-6 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-md z-50 flex items-start gap-2.5 px-4 py-3 bg-stone-900 text-white rounded-xl shadow-2xl text-[13px] leading-snug animate-in fade-in slide-in-from-bottom-2">
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 mt-px text-rose-300 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 mt-px text-emerald-300 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="-mr-1 -mt-0.5 p-1 rounded text-stone-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
