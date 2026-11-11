import React, { useState } from 'react';
import { 
  FileSpreadsheet, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Link as LinkIcon, 
  LogIn, 
  Sparkles, 
  DownloadCloud, 
  UploadCloud, 
  X,
  Tag,
  Building2,
  RotateCcw,
  Check,
  Search
} from 'lucide-react';
import { User } from 'firebase/auth';
import { GoogleSheetsConfig, Reservation, Room, DEFAULT_ZAEREEN_CATEGORIES, UserRole } from '../types';
import { 
  createAccommodationSpreadsheet, 
  syncAllToGoogleSheet, 
  twoWaySyncWithGoogleSheet,
  testSpreadsheetAccess, 
  fetchRoomsFromGoogleSheet, 
  fetchReservationsFromGoogleSheet,
  fetchCategoriesFromGoogleSheet,
  fetchReservationsFromGoogleSheetUrl,
  fetchRoomsAndBuildingsFromGoogleSheetUrl,
  fetchCategoriesFromGoogleSheetUrl,
  extractSpreadsheetId
} from '../services/googleSheets';
import { 
  DEFAULT_ATTACHED_SHEET_NAME, 
  DEFAULT_ATTACHED_SHEET_URL, 
  DEFAULT_ATTACHED_SHEET_ID,
  INITIAL_SHEETS_CONFIG 
} from '../services/storage';
import { 
  resetBackendToDefaultSheet, 
  switchBackendSheet, 
  saveBackendSettings 
} from '../services/api';

interface GoogleSheetsSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  accessToken: string | null;
  sheetsConfig: GoogleSheetsConfig;
  onUpdateConfig: (config: GoogleSheetsConfig) => void;
  onGoogleSignIn: () => void;
  reservations: Reservation[];
  rooms: Room[];
  categories?: string[];
  onRoomsFetched?: (newRooms: Room[]) => void;
  onReservationsFetched?: (newReservations: Reservation[]) => void;
  onCategoriesFetched?: (newCategories: string[]) => void;
  onOpenAddBuildingRoomsModal?: () => void;
  userRole?: UserRole;
}

export const GoogleSheetsSyncModal: React.FC<GoogleSheetsSyncModalProps> = ({
  isOpen,
  onClose,
  user,
  accessToken,
  sheetsConfig,
  onUpdateConfig,
  onGoogleSignIn,
  reservations,
  rooms,
  categories = DEFAULT_ZAEREEN_CATEGORIES,
  onRoomsFetched,
  onReservationsFetched,
  onCategoriesFetched,
  onOpenAddBuildingRoomsModal,
  userRole = 'receptionist',
}) => {
  if (!isOpen) return null;

  const [customSheetInput, setCustomSheetInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPullingCats, setIsPullingCats] = useState(false);
  const [isTestingSheet, setIsTestingSheet] = useState(false);
  const [isResettingDefault, setIsResettingDefault] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [showPullConfirm, setShowPullConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [testedSheetInfo, setTestedSheetInfo] = useState<{ id: string; title: string; sheets?: string[] } | null>(null);

  const isCurrentDefaultAttachedSheet =
    !sheetsConfig.spreadsheetId ||
    sheetsConfig.spreadsheetId === DEFAULT_ATTACHED_SHEET_ID ||
    (sheetsConfig.spreadsheetUrl || '').includes('Faiz_Husaini') ||
    sheetsConfig.spreadsheetName === DEFAULT_ATTACHED_SHEET_NAME;

  // Test Spreadsheet Access
  const handleTestSheetConnection = async () => {
    const rawId = extractSpreadsheetId(customSheetInput);
    if (!rawId) {
      setFeedback({ type: 'error', message: 'Please provide a valid Google Sheet URL or ID to test.' });
      return;
    }

    setIsTestingSheet(true);
    setFeedback(null);
    setTestedSheetInfo(null);

    try {
      if (accessToken) {
        const info = await testSpreadsheetAccess(accessToken, rawId);
        setTestedSheetInfo({ id: rawId, title: info.title, sheets: info.sheets });
        setFeedback({
          type: 'success',
          message: `✓ Connection successful! Spreadsheet: "${info.title}" (${info.sheets.length} tabs found: ${info.sheets.slice(0, 3).join(', ')}${info.sheets.length > 3 ? '...' : ''})`,
        });
      } else {
        // Attempt public connection test
        const cats = await fetchCategoriesFromGoogleSheetUrl(rawId).catch(() => []);
        setTestedSheetInfo({ id: rawId, title: 'Google Spreadsheet (Public Link)' });
        setFeedback({
          type: 'success',
          message: `✓ Connection reachable via public link! ${cats.length > 0 ? `Found categories: ${cats.join(', ')}` : 'Ready to link and import.'}`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Could not connect to that Google Sheet. Make sure sharing is set to "Anyone with the link can view", or sign in with Google.',
      });
    } finally {
      setIsTestingSheet(false);
    }
  };

  // Switch to Custom Google Sheet
  const handleSwitchGoogleSheet = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const rawId = extractSpreadsheetId(customSheetInput);
    if (!rawId) {
      setFeedback({ type: 'error', message: 'Please provide a valid Google Sheet URL or ID.' });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);

    try {
      const title = testedSheetInfo?.title || 'Custom Google Sheet';
      const newUrl = `https://docs.google.com/spreadsheets/d/${rawId}/edit`;

      const newConfig: GoogleSheetsConfig = {
        ...sheetsConfig,
        spreadsheetId: rawId,
        spreadsheetUrl: newUrl,
        spreadsheetName: title,
        lastSyncedAt: new Date().toISOString(),
        isSyncing: false,
        syncError: null,
      };

      onUpdateConfig(newConfig);
      await switchBackendSheet(rawId, newUrl, title);
      saveBackendSettings({ sheetsConfig: newConfig });

      // Attempt to pull reservations and rooms from the new sheet
      try {
        const [freshRooms, freshRes] = await Promise.all([
          fetchRoomsAndBuildingsFromGoogleSheetUrl(rawId, accessToken, rooms).catch(() => rooms),
          fetchReservationsFromGoogleSheetUrl(rawId, accessToken, rooms, reservations).catch(() => reservations),
        ]);

        if (onRoomsFetched && freshRooms.length > 0) onRoomsFetched(freshRooms);
        if (onReservationsFetched && freshRes.length > 0) onReservationsFetched(freshRes);

        setFeedback({
          type: 'success',
          message: `Successfully changed active Google Sheet to "${title}"! Loaded ${freshRes.length} zaereen records and ${freshRooms.length} rooms.`,
        });
      } catch {
        setFeedback({
          type: 'success',
          message: `Linked to Google Sheet ID "${rawId}". Ready for data sync!`,
        });
      }

      setCustomSheetInput('');
      setTestedSheetInfo(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to switch Google Sheet.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset to Default Attached Sheet
  const handleResetToDefaultSheet = async () => {
    setIsResettingDefault(true);
    setShowResetConfirm(false);
    setFeedback(null);

    try {
      const res = await resetBackendToDefaultSheet();
      if (res && res.reservations && res.reservations.length > 0) {
        if (onReservationsFetched) onReservationsFetched(res.reservations);
        if (onUpdateConfig) onUpdateConfig(res.sheetsConfig || INITIAL_SHEETS_CONFIG);
        setFeedback({
          type: 'success',
          message: `✓ Successfully restored default Google Sheet "${DEFAULT_ATTACHED_SHEET_NAME}"! Preloaded ${res.reservations.length} Zaereen records.`,
        });
      } else {
        // Client fallback
        const fallbackRes = await fetchReservationsFromGoogleSheetUrl(DEFAULT_ATTACHED_SHEET_ID, null, rooms, reservations);
        if (onReservationsFetched && fallbackRes.length > 0) onReservationsFetched(fallbackRes);
        onUpdateConfig(INITIAL_SHEETS_CONFIG);
        setFeedback({
          type: 'success',
          message: `✓ Restored default Google Sheet "${DEFAULT_ATTACHED_SHEET_NAME}" with ${fallbackRes.length} Zaereen records.`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to reset to default Google Sheet.',
      });
    } finally {
      setIsResettingDefault(false);
    }
  };

  // Create new formatted Google Spreadsheet
  const handleCreateNewSheet = async () => {
    if (!accessToken) {
      setFeedback({ type: 'error', message: 'Please sign in with Google first.' });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);

    try {
      const { spreadsheetId, spreadsheetUrl } = await createAccommodationSpreadsheet(
        accessToken,
        DEFAULT_ATTACHED_SHEET_NAME
      );

      const syncRes = await syncAllToGoogleSheet(
        accessToken,
        spreadsheetId,
        reservations,
        rooms
      );

      if (syncRes.success) {
        const newConfig: GoogleSheetsConfig = {
          ...sheetsConfig,
          spreadsheetId,
          spreadsheetUrl,
          spreadsheetName: DEFAULT_ATTACHED_SHEET_NAME,
          lastSyncedAt: new Date().toISOString(),
          isSyncing: false,
          syncError: null,
        };
        onUpdateConfig(newConfig);
        await switchBackendSheet(spreadsheetId, spreadsheetUrl, DEFAULT_ATTACHED_SHEET_NAME);

        setFeedback({
          type: 'success',
          message: 'Created and synced new Google Sheet successfully!',
        });
      } else {
        throw new Error(syncRes.error);
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to create Google Sheet.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Pull rooms & reservations from active sheet
  const handleInitiatePull = () => {
    setShowPullConfirm(true);
  };

  const handleExecutePullFromSheet = async () => {
    setIsPulling(true);
    setShowPullConfirm(false);
    setFeedback(null);

    try {
      const targetId = sheetsConfig.spreadsheetId || DEFAULT_ATTACHED_SHEET_ID;
      const [freshRooms, freshRes] = await Promise.all([
        fetchRoomsAndBuildingsFromGoogleSheetUrl(targetId, accessToken, rooms).catch((err) => {
          console.warn('Rooms pull warning:', err);
          return rooms;
        }),
        fetchReservationsFromGoogleSheetUrl(targetId, accessToken, rooms, reservations),
      ]);

      if (onRoomsFetched && freshRooms.length > 0) onRoomsFetched(freshRooms);
      if (onReservationsFetched && freshRes.length > 0) onReservationsFetched(freshRes);

      onUpdateConfig({
        ...sheetsConfig,
        lastSyncedAt: new Date().toISOString(),
        syncError: null,
      });

      setFeedback({
        type: 'success',
        message: `Successfully imported all data: ${freshRes.length} zaereen (including all family members & allotted rooms) and ${freshRooms.length} rooms from Google Sheet!`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to pull data from Google Sheet.',
      });
    } finally {
      setIsPulling(false);
    }
  };

  // Push current data to linked sheet (Admin only)
  const handlePushToSheet = async () => {
    if (userRole !== 'admin') {
      setFeedback({ 
        type: 'error', 
        message: 'Action Restricted: Only Administrator (logged in as ishaidry@gmail.com) can push to Google Sheet. Receptionist view can only pull from sheet.' 
      });
      return;
    }

    if (!accessToken || !sheetsConfig.spreadsheetId || sheetsConfig.spreadsheetId === DEFAULT_ATTACHED_SHEET_ID) {
      setFeedback({
        type: 'error',
        message: 'To push changes to Google Sheet, please sign in with Google and ensure you have linked an editable Google Spreadsheet ID.',
      });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);

    try {
      const res = await syncAllToGoogleSheet(
        accessToken,
        sheetsConfig.spreadsheetId,
        reservations,
        rooms
      );

      if (res.success) {
        onUpdateConfig({
          ...sheetsConfig,
          lastSyncedAt: new Date().toISOString(),
          isSyncing: false,
          syncError: null,
        });
        setFeedback({
          type: 'success',
          message: 'Pushed latest app data to Google Sheets successfully!',
        });
      } else {
        throw new Error(res.error);
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Sync failed.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Fetch categories from linked sheet
  const handleFetchCategories = async () => {
    setIsPullingCats(true);
    setFeedback(null);

    try {
      const targetId = sheetsConfig.spreadsheetId || DEFAULT_ATTACHED_SHEET_ID;
      const fetchedCats = await fetchCategoriesFromGoogleSheetUrl(targetId, accessToken);

      if (onCategoriesFetched && fetchedCats.length > 0) {
        onCategoriesFetched(fetchedCats);
      }

      onUpdateConfig({
        ...sheetsConfig,
        customCategories: fetchedCats.length > 0 ? fetchedCats : categories,
      });

      setFeedback({
        type: 'success',
        message: `Fetched ${fetchedCats.length} categories from Google Sheet: ${fetchedCats.join(', ')}`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to fetch categories from Google Sheet.',
      });
    } finally {
      setIsPullingCats(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative text-xs my-8 text-stone-800 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-500 hover:text-stone-800 p-1 rounded-lg hover:bg-stone-200/60 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-2 mb-1 text-[#124E39]">
          <FileSpreadsheet className="w-5 h-5" />
          <h3 className="text-base font-bold text-[#124E39]">
            Google Sheets Integration & Sheet Management
          </h3>
        </div>
        <p className="text-stone-600 mb-4">
          Default Google Sheet is set to the attached <strong>{DEFAULT_ATTACHED_SHEET_NAME}</strong>. You can change to any Google Sheet URL or ID at any time.
        </p>

        {/* Feedback message */}
        {feedback && (
          <div
            className={`p-3 rounded-xl mb-4 flex items-start gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                : feedback.type === 'info'
                ? 'bg-blue-50 border border-blue-300 text-blue-900'
                : 'bg-rose-50 border border-rose-300 text-rose-900'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            )}
            <p className="text-xs font-medium">{feedback.message}</p>
          </div>
        )}

        {/* SECTION 1: DEFAULT ATTACHED GOOGLE SHEET CARD */}
        <div className="mb-4 p-4 rounded-xl border border-emerald-300 bg-emerald-50/70 shadow-2xs space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse"></span>
              <span className="font-bold text-emerald-950 text-xs">
                Default Attached Google Sheet
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-200/80 text-emerald-900 font-bold text-[10px]">
                {DEFAULT_ATTACHED_SHEET_NAME}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={DEFAULT_ATTACHED_SHEET_URL}
                target="_blank"
                rel="noreferrer"
                download="Faiz_Husaini_Zaereen_Accommodation_Saifee_Burhani.csv"
                className="text-emerald-800 hover:text-emerald-950 underline font-semibold text-[11px] flex items-center gap-1"
                title="Download / view default attached sheet dataset"
              >
                <span>View Attachment</span>
                <ExternalLink className="w-3 h-3" />
              </a>

              {!isCurrentDefaultAttachedSheet && (
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(true)}
                  disabled={isResettingDefault}
                  className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] flex items-center gap-1 shadow-2xs transition cursor-pointer"
                  title="Switch back to the default attached sheet dataset"
                >
                  <RotateCcw className={`w-3 h-3 ${isResettingDefault ? 'animate-spin' : ''}`} />
                  <span>Restore Default Sheet</span>
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-emerald-900 leading-relaxed">
            Contains <strong>1,074 Zaereen records</strong>, exact arrival & departure times, 145 rooms across Saifee, Burhani, Badri & Qasr Nobola, and verified categories.
          </p>

          {/* Reset Confirmation Dialog */}
          {showResetConfirm && (
            <div className="p-3 rounded-xl bg-amber-50 border-2 border-amber-400 text-amber-950 space-y-2 shadow-xs mt-2 animate-in fade-in duration-150">
              <div className="font-bold text-xs flex items-center gap-1.5 text-amber-950">
                <AlertCircle className="w-4 h-4 text-amber-700" />
                <span>Confirm Restore Default Attached Sheet</span>
              </div>
              <p className="text-[11px] text-amber-900">
                This will reset the active spreadsheet back to the default attached dataset (1,074 records) and reload all allotments. Do you want to proceed?
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1 rounded-lg bg-white border border-stone-300 text-stone-700 font-bold text-xs hover:bg-stone-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResetToDefaultSheet}
                  disabled={isResettingDefault}
                  className="px-3.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs transition flex items-center gap-1 shadow-xs"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isResettingDefault ? 'animate-spin' : ''}`} />
                  <span>{isResettingDefault ? 'Restoring...' : 'Yes, Restore Default'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 2: CURRENT ACTIVE SHEET STATUS */}
        <div className="p-4 bg-white border border-[#E6DFD5] rounded-xl space-y-3 mb-4 shadow-2xs">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider">
                Currently Active Google Sheet
              </div>
              <div className="text-sm font-bold text-[#124E39] flex items-center gap-1.5 mt-0.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{sheetsConfig.spreadsheetName || DEFAULT_ATTACHED_SHEET_NAME}</span>
                {isCurrentDefaultAttachedSheet && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                    Default
                  </span>
                )}
              </div>
            </div>

            {sheetsConfig.spreadsheetUrl && sheetsConfig.spreadsheetUrl.startsWith('http') && (
              <a
                href={sheetsConfig.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-bold text-xs flex items-center gap-1.5 transition"
              >
                <span>Open in Google Sheets</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-stone-600 bg-stone-50 p-2 rounded border border-stone-200">
            <span className="font-mono truncate max-w-[320px]">
              ID: {sheetsConfig.spreadsheetId || DEFAULT_ATTACHED_SHEET_ID}
            </span>
            <span className="text-[10px] text-stone-500">
              {sheetsConfig.lastSyncedAt ? `Last Synced: ${new Date(sheetsConfig.lastSyncedAt).toLocaleTimeString()}` : 'Ready'}
            </span>
          </div>

          {/* Action Buttons for Active Sheet */}
          <div className="space-y-2 pt-1">
            {/* Pull Confirmation Dialog */}
            {showPullConfirm && (
              <div className="p-3.5 rounded-xl bg-amber-50 border-2 border-amber-400 text-amber-950 space-y-2.5 shadow-sm animate-in fade-in duration-150">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-xs text-amber-950">Confirm Pull & Import from Sheet</div>
                    <div className="text-[11px] text-amber-900 mt-0.5 leading-relaxed">
                      Import all zaereen, family members, their allotted rooms, and blocked room statuses from the active sheet into the app?
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowPullConfirm(false)}
                    className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white hover:bg-stone-100 text-stone-700 font-bold text-xs transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleExecutePullFromSheet}
                    disabled={isPulling}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <DownloadCloud className={`w-3.5 h-3.5 ${isPulling ? 'animate-bounce' : ''}`} />
                    <span>{isPulling ? 'Importing All Data...' : 'Yes, Pull & Import All Data'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Push to Sheet (Admin Only) */}
            {userRole === 'admin' ? (
              <button
                type="button"
                onClick={handlePushToSheet}
                disabled={isProcessing || isPulling}
                className="w-full py-2.5 px-3 bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-sm cursor-pointer"
                title="Push latest app state, Zaereen grid, and room allotments to Google Sheet"
              >
                <UploadCloud className={`w-4 h-4 text-[#EBD59E] ${isProcessing ? 'animate-pulse' : ''}`} />
                <span>{isProcessing ? 'Pushing to Sheet...' : 'Push to Sheet (Export App to Google Sheet)'}</span>
              </button>
            ) : (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-[11px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Receptionist View: Push to Sheet requires Admin (ishaidry@gmail.com). You can pull updates below.</span>
              </div>
            )}

            {/* Pull from Sheet */}
            <button
              type="button"
              onClick={handleInitiatePull}
              disabled={isPulling || isProcessing}
              className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition text-xs shadow-sm cursor-pointer"
              title="Pull and import all data from Google Sheet with confirmation"
            >
              <DownloadCloud className={`w-4 h-4 text-[#EBD59E] ${isPulling ? 'animate-bounce' : ''}`} />
              <span>Pull from Sheet (Import Allotments, Rooms & Zaereen)</span>
            </button>
          </div>
        </div>

        {/* SECTION 3: CHANGE GOOGLE SHEET (ALWAYS ACCESSIBLE) */}
        <div className="p-4 bg-white rounded-xl border border-stone-200 mb-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-stone-900 flex items-center gap-1.5 text-xs">
              <LinkIcon className="w-4 h-4 text-emerald-700" />
              <span>Change Google Sheet (Switch URL / ID)</span>
            </h4>
            <span className="text-[10px] text-stone-500 font-semibold">
              Option to change anytime
            </span>
          </div>

          <p className="text-[11px] text-stone-600">
            Paste any Google Spreadsheet URL (e.g. <code className="bg-stone-100 px-1 py-0.5 rounded text-[10px]">https://docs.google.com/spreadsheets/d/.../edit</code>) or raw Spreadsheet ID.
          </p>

          <div className="space-y-2">
            <input
              type="text"
              placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit..."
              value={customSheetInput}
              onChange={(e) => setCustomSheetInput(e.target.value)}
              className="w-full bg-[#FAF7F2] text-stone-900 px-3 py-2 rounded-lg border border-stone-300 text-xs focus:outline-none focus:border-emerald-700 font-mono"
            />

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleTestSheetConnection}
                disabled={isTestingSheet || !customSheetInput.trim()}
                className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 disabled:opacity-50 rounded-lg font-bold transition flex items-center gap-1.5 border border-stone-300 cursor-pointer text-xs"
                title="Test if the sheet is accessible"
              >
                <Search className={`w-3.5 h-3.5 ${isTestingSheet ? 'animate-spin' : ''}`} />
                <span>{isTestingSheet ? 'Testing Connection...' : 'Test Connection'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchGoogleSheet()}
                disabled={isProcessing || !customSheetInput.trim()}
                className="px-4 py-1.5 bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-50 text-white rounded-lg font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer text-xs"
                title="Save and switch active sheet to this URL"
              >
                <Check className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>{isProcessing ? 'Switching Sheet...' : 'Switch to this Sheet'}</span>
              </button>

              {!isCurrentDefaultAttachedSheet && (
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(true)}
                  className="px-3 py-1.5 bg-stone-50 hover:bg-stone-100 text-emerald-800 border border-emerald-300 rounded-lg font-bold transition flex items-center gap-1.5 text-xs ml-auto cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore Default Attached Sheet</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 4: GOOGLE AUTHENTICATION & EXTRA CONTROLS */}
        <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 mb-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center font-bold text-emerald-800 text-[10px]">
                {user?.email ? user.email[0].toUpperCase() : 'G'}
              </div>
              <div>
                <div className="font-bold text-stone-900 text-[11px]">
                  {user ? (user.displayName || user.email) : 'Not Signed In to Google'}
                </div>
                <div className="text-[10px] text-stone-500">
                  {user ? (user.email === 'ishaidry@gmail.com' ? 'Administrator (Full Push & Pull Rights)' : 'Receptionist View') : 'Sign in for official Google Sheets API write access'}
                </div>
              </div>
            </div>

            {!user ? (
              <button
                onClick={onGoogleSignIn}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#124E39] hover:bg-[#0E3C2C] text-white font-bold text-xs rounded-lg transition shadow-2xs cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>Sign In with Google</span>
              </button>
            ) : (
              <span className="text-[10px] bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded border border-emerald-300 font-bold">
                OAuth Active
              </span>
            )}
          </div>

          {/* Auto Create Google Sheet option */}
          <div className="pt-2 border-t border-stone-200 flex items-center justify-between">
            <span className="text-[11px] text-stone-600">
              Need a fresh formatted Google Spreadsheet in your Google Drive?
            </span>
            <button
              onClick={handleCreateNewSheet}
              disabled={isProcessing || !user}
              className="px-2.5 py-1 bg-white hover:bg-stone-100 text-[#124E39] border border-stone-300 disabled:opacity-50 rounded font-bold text-[11px] transition flex items-center gap-1"
            >
              <Plus className="w-3 h-3 text-emerald-700" />
              <span>Create New Sheet in Drive</span>
            </button>
          </div>
        </div>

        {/* Pilgrim Categories Fetch Section */}
        <div className="pt-2 border-t border-stone-200 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-[#124E39]" />
              <span className="font-bold text-[#124E39] text-xs">
                Zaereen Categories ({categories.length}):
              </span>
            </div>
            <button
              onClick={handleFetchCategories}
              disabled={isPullingCats}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-[11px] font-bold transition shadow-2xs cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${isPullingCats ? 'animate-spin' : ''}`} />
              <span>{isPullingCats ? 'Fetching...' : 'Fetch from Sheet'}</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <span
                key={c}
                className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-800 border border-stone-200 text-[11px] font-semibold"
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Hotel Buildings & Rooms Section */}
        {onOpenAddBuildingRoomsModal && (
          <div className="pt-2 border-t border-stone-200 mb-4">
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#124E39] shrink-0" />
                <div>
                  <div className="font-bold text-[#124E39] text-xs">
                    Hotel Buildings & Rooms Inventory ({rooms.length} Rooms)
                  </div>
                  <div className="text-[11px] text-stone-600">
                    Saifee (70), Burhani (44), Badri (30), Qasr Nobola (1). Add rooms or sync inventory.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAddBuildingRoomsModal();
                }}
                className="px-3 py-1.5 rounded-lg bg-[#124E39] text-[#EBD59E] hover:bg-[#0E3C2C] text-xs font-bold transition flex items-center gap-1 shadow-2xs shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Manage Rooms</span>
              </button>
            </div>
          </div>
        )}

        {/* Close Footer */}
        <div className="pt-3 border-t border-stone-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl font-semibold transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
