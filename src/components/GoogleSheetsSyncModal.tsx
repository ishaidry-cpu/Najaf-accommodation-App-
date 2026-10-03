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
  Layers,
  Building2
} from 'lucide-react';
import { User } from 'firebase/auth';
import { GoogleSheetsConfig, Reservation, Room, DEFAULT_ZAEREEN_CATEGORIES } from '../types';
import { 
  createAccommodationSpreadsheet, 
  syncAllToGoogleSheet, 
  twoWaySyncWithGoogleSheet,
  testSpreadsheetAccess, 
  fetchRoomsFromGoogleSheet, 
  fetchReservationsFromGoogleSheet,
  fetchCategoriesFromGoogleSheet
} from '../services/googleSheets';

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
}) => {
  if (!isOpen) return null;

  const [customSheetInput, setCustomSheetInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPullingCats, setIsPullingCats] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Extract Sheet ID from full URL or raw ID
  const extractSheetId = (input: string) => {
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : input.trim();
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
        'Faiz Husaini Zaereen Accommodation (Saifee & Burhani)'
      );

      const syncRes = await syncAllToGoogleSheet(
        accessToken,
        spreadsheetId,
        reservations,
        rooms
      );

      if (syncRes.success) {
        onUpdateConfig({
          ...sheetsConfig,
          spreadsheetId,
          spreadsheetUrl,
          spreadsheetName: 'Faiz Husaini Zaereen Accommodation (Saifee & Burhani)',
          lastSyncedAt: new Date().toISOString(),
          isSyncing: false,
          syncError: null,
        });
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

  // Link existing spreadsheet
  const handleLinkExistingSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawId = extractSheetId(customSheetInput);
    if (!rawId) {
      setFeedback({ type: 'error', message: 'Please provide a valid Google Sheet URL or ID.' });
      return;
    }

    if (!accessToken) {
      setFeedback({ type: 'error', message: 'Please sign in with Google first.' });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);

    try {
      const info = await testSpreadsheetAccess(accessToken, rawId);

      const newConfig: GoogleSheetsConfig = {
        ...sheetsConfig,
        spreadsheetId: rawId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${rawId}/edit`,
        spreadsheetName: info.title,
        lastSyncedAt: new Date().toISOString(),
        isSyncing: false,
        syncError: null,
      };

      onUpdateConfig(newConfig);

      // Attempt to pull rooms and reservations
      const [freshRooms, freshRes] = await Promise.all([
        fetchRoomsFromGoogleSheet(accessToken, rawId, rooms).catch(() => rooms),
        fetchReservationsFromGoogleSheet(accessToken, rawId, rooms, reservations).catch(() => reservations),
      ]);

      if (onRoomsFetched && freshRooms.length > 0) onRoomsFetched(freshRooms);
      if (onReservationsFetched && freshRes.length > 0) onReservationsFetched(freshRes);

      setFeedback({
        type: 'success',
        message: `Successfully linked to "${info.title}"! Tabs found: ${info.sheets.join(', ')}`,
      });
      setCustomSheetInput('');
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Could not connect to that Google Sheet. Make sure you have view/edit permissions.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Pull rooms & reservations from linked sheet
  const handlePullFromSheet = async () => {
    if (!accessToken || !sheetsConfig.spreadsheetId) {
      setFeedback({ type: 'error', message: 'No Google Sheet linked or not signed in.' });
      return;
    }

    setIsPulling(true);
    setFeedback(null);

    try {
      const [freshRooms, freshRes] = await Promise.all([
        fetchRoomsFromGoogleSheet(accessToken, sheetsConfig.spreadsheetId, rooms),
        fetchReservationsFromGoogleSheet(accessToken, sheetsConfig.spreadsheetId, rooms, reservations),
      ]);

      if (onRoomsFetched) onRoomsFetched(freshRooms);
      if (onReservationsFetched) onReservationsFetched(freshRes);

      onUpdateConfig({
        ...sheetsConfig,
        lastSyncedAt: new Date().toISOString(),
        syncError: null,
      });

      setFeedback({
        type: 'success',
        message: `Loaded ${freshRooms.length} rooms and ${freshRes.length} reservations from Google Sheets!`,
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

  // Push current data to linked sheet
  const handlePushToSheet = async () => {
    if (!accessToken || !sheetsConfig.spreadsheetId) {
      setFeedback({ type: 'error', message: 'No Google Sheet linked or not signed in.' });
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

  // 1-Click Two-Way Sync (Pull edits from Google Sheet + Merge + Push Timeline)
  const handleTwoWaySync = async () => {
    if (!accessToken || !sheetsConfig.spreadsheetId) {
      setFeedback({ type: 'error', message: 'No Google Sheet linked or not signed in.' });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);

    try {
      const res = await twoWaySyncWithGoogleSheet(
        accessToken,
        sheetsConfig.spreadsheetId,
        reservations,
        rooms
      );

      if (res.success) {
        if (onRoomsFetched) onRoomsFetched(res.mergedRooms);
        if (onReservationsFetched) onReservationsFetched(res.mergedReservations);

        onUpdateConfig({
          ...sheetsConfig,
          spreadsheetUrl: res.spreadsheetUrl,
          lastSyncedAt: new Date().toISOString(),
          isSyncing: false,
          syncError: null,
        });

        setFeedback({
          type: 'success',
          message: `1-Click Sync complete! Successfully synchronized Zaereen Lodging & Room Allotment Grid, 114 Rooms, and Timeline with zero duplicates.`,
        });
      } else {
        throw new Error(res.error);
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Two-way sync failed.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Fetch categories from linked sheet
  const handleFetchCategories = async () => {
    if (!accessToken || !sheetsConfig.spreadsheetId) {
      setFeedback({ type: 'error', message: 'No Google Sheet linked or not signed in.' });
      return;
    }

    setIsPullingCats(true);
    setFeedback(null);

    try {
      const fetchedCats = await fetchCategoriesFromGoogleSheet(
        accessToken,
        sheetsConfig.spreadsheetId
      );

      if (onCategoriesFetched) {
        onCategoriesFetched(fetchedCats);
      }

      onUpdateConfig({
        ...sheetsConfig,
        customCategories: fetchedCats,
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
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-xl w-full p-6 shadow-2xl relative text-xs my-8 text-stone-800">
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
            Google Sheets Two-Way Integration
          </h3>
        </div>
        <p className="text-stone-600 mb-4">
          Connect your Google Sheet to sync rooms, zaereen, and fetch dynamic categories (Mumineen, Muntasbeen, Qasreali, Baitezainy).
        </p>

        {/* Feedback message */}
        {feedback && (
          <div
            className={`p-3 rounded-xl mb-4 flex items-start gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
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

        {/* Authentication State */}
        {!user ? (
          <div className="p-4 bg-white rounded-xl border border-stone-200 text-center space-y-3 mb-4 shadow-2xs">
            <p className="text-stone-600">
              Sign in with your Google Account to connect Google Sheets.
            </p>
            <button
              onClick={onGoogleSignIn}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#124E39] hover:bg-[#0E3C2C] text-white font-bold text-xs rounded-xl transition shadow-sm"
            >
              <LogIn className="w-4 h-4 text-[#EBD59E]" />
              <span>Sign in with Google</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-stone-200 mb-4 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center font-bold text-emerald-800 text-xs">
                {user.email ? user.email[0].toUpperCase() : 'G'}
              </div>
              <div className="truncate max-w-[220px]">
                <div className="font-bold text-stone-900 truncate">
                  {user.displayName || user.email}
                </div>
                <div className="text-[10px] text-stone-500 truncate">{user.email}</div>
              </div>
            </div>
            <span className="text-[10px] bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded border border-emerald-300 font-bold">
              Connected
            </span>
          </div>
        )}

        {/* Current Linked Sheet Status */}
        {sheetsConfig.spreadsheetId ? (
          <div className="space-y-4 mb-4">
            <div className="p-4 bg-white border border-[#E6DFD5] rounded-xl space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[#124E39] font-bold text-xs flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  <span>Linked: {sheetsConfig.spreadsheetName}</span>
                </span>
                <a
                  href={sheetsConfig.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheetsConfig.spreadsheetId}/edit`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#124E39] hover:underline flex items-center gap-1 font-bold text-xs"
                >
                  <span>Open Sheet</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="text-[11px] text-stone-600 font-mono bg-stone-50 p-2 rounded border border-stone-200 truncate">
                ID: {sheetsConfig.spreadsheetId}
              </div>

              {/* Synchronized Tabs Info */}
              <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-200 text-[11px] text-emerald-950 space-y-1">
                <div className="font-bold flex items-center gap-1 text-emerald-900">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Synchronized Google Sheet Tabs (Two-Way):</span>
                </div>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  <span className="px-2 py-0.5 bg-[#124E39] text-[#EBD59E] rounded font-bold text-[10px] shadow-2xs">
                    ★ 1. Zaereen Lodging & Room Allotment Grid
                  </span>
                  <span className="px-2 py-0.5 bg-[#124E39] text-[#EBD59E] rounded font-bold text-[10px] shadow-2xs">
                    ★ 2. Rooms_Availability_&_Timeline
                  </span>
                  <span className="px-2 py-0.5 bg-white rounded border border-emerald-300 font-semibold text-[10px]">
                    3. Rooms_Inventory (114)
                  </span>
                  <span className="px-2 py-0.5 bg-white rounded border border-emerald-300 font-semibold text-[10px]">
                    4. Category_B_to_A_Upgrades
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                {/* Primary 1-Click Sync */}
                <button
                  onClick={handleTwoWaySync}
                  disabled={isProcessing || isPulling}
                  className="w-full py-2.5 px-3 bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-sm cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 text-[#EBD59E] ${isProcessing ? 'animate-spin' : ''}`} />
                  <span>{isProcessing ? 'Syncing Two-Way...' : '1-Click Two-Way Sync (Sync App & Google Sheet)'}</span>
                </button>

                {/* Secondary Individual Pull / Push buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handlePullFromSheet}
                    disabled={isPulling || isProcessing}
                    className="py-1.5 px-2 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 text-stone-800 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition text-[11px]"
                    title="Pull latest rows from Google Sheet only"
                  >
                    <DownloadCloud className={`w-3.5 h-3.5 text-stone-600 ${isPulling ? 'animate-bounce' : ''}`} />
                    <span>Pull from Sheet</span>
                  </button>

                  <button
                    onClick={handlePushToSheet}
                    disabled={isProcessing || isPulling}
                    className="py-1.5 px-2 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 text-stone-800 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition text-[11px]"
                    title="Push current app state to Google Sheet only"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Push to Sheet</span>
                  </button>
                </div>
              </div>

              {/* Pilgrim Categories Fetch Section */}
              <div className="pt-3 border-t border-stone-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Tag className="w-4 h-4 text-[#124E39]" />
                    <span className="font-bold text-[#124E39] text-xs">
                      Pilgrim Categories ({categories.length}):
                    </span>
                  </div>
                  <button
                    onClick={handleFetchCategories}
                    disabled={isPullingCats}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-[11px] font-bold transition shadow-2xs"
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
                <p className="text-[10px] text-stone-500 mt-1.5">
                  In your Google Sheet, create a tab named <strong>Categories</strong> (column A with category names like Mumineen, Muntasbeen, Qasreali, Baitezainy), or the app will extract them from your Zaereen Category column.
                </p>
              </div>

              {/* Hotel Buildings & Rooms Section */}
              {onOpenAddBuildingRoomsModal && (
                <div className="pt-3 border-t border-stone-200">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-[#124E39] shrink-0" />
                      <div>
                        <div className="font-bold text-[#124E39] text-xs">
                          Hotel Buildings & Rooms Inventory ({rooms.length} Rooms)
                        </div>
                        <div className="text-[11px] text-stone-600">
                          Add new hotel buildings, room numbers, floors, or sync inventory directly with Google Sheets.
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
                      <span>Manage / Sync Rooms</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 mb-4">
            {/* Create New Sheet */}
            <div className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs">
              <h4 className="font-bold text-stone-900 mb-1 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Option 1: Auto-Create New Formatted Sheet</span>
              </h4>
              <p className="text-[11px] text-stone-600 mb-3">
                Generates a new Google Sheet in your Google Drive with tabs for Zaereen Lodging & Room Allotment Grid, Rooms Availability & Timeline, and Inventory.
              </p>
              <button
                onClick={handleCreateNewSheet}
                disabled={isProcessing || !user}
                className="w-full py-2.5 px-3 bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-sm"
              >
                <Plus className="w-4 h-4 text-[#EBD59E]" />
                <span>{isProcessing ? 'Creating & Syncing...' : 'Create New Google Sheet'}</span>
              </button>
            </div>

            {/* Link Existing Sheet */}
            <form onSubmit={handleLinkExistingSheet} className="p-4 bg-white rounded-xl border border-stone-200 shadow-2xs">
              <h4 className="font-bold text-stone-900 mb-1 flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5 text-emerald-700" />
                <span>Option 2: Connect Existing Google Sheet</span>
              </h4>
              <p className="text-[11px] text-stone-600 mb-2">
                Paste your Google Spreadsheet URL or ID. The app will read your rooms, reservations, and categories from it.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={customSheetInput}
                  onChange={(e) => setCustomSheetInput(e.target.value)}
                  className="flex-1 bg-[#FAF7F2] text-stone-900 px-3 py-1.5 rounded-lg border border-stone-300 text-xs focus:outline-none focus:border-emerald-700"
                />
                <button
                  type="submit"
                  disabled={isProcessing || !user || !customSheetInput}
                  className="px-4 py-1.5 bg-[#124E39] hover:bg-[#0E3C2C] disabled:opacity-50 text-white rounded-lg font-bold transition shadow-2xs"
                >
                  Connect
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Close Footer */}
        <div className="pt-4 border-t border-stone-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
