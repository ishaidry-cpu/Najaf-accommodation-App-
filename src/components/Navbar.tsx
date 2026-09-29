import React from 'react';
import { 
  Building2, 
  CalendarDays, 
  FileSpreadsheet, 
  FileText, 
  BedDouble, 
  ArrowUpRight, 
  BarChart3, 
  LogIn, 
  LogOut, 
  RefreshCw, 
  CheckCircle2,
  AlertCircle,
  Printer,
  Upload,
  Download,
  ShieldCheck,
  Eye,
  Lock
} from 'lucide-react';
import { User } from 'firebase/auth';
import { GoogleSheetsConfig, UserRole } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';

interface NavbarProps {
  activeTab: 'dashboard' | 'reservations' | 'upgrades' | 'rooms';
  setActiveTab: (tab: 'dashboard' | 'reservations' | 'upgrades' | 'rooms') => void;
  user: User | null;
  sheetsConfig: GoogleSheetsConfig;
  userRole: UserRole;
  onOpenRoleModal: () => void;
  onOpenSheetsModal: () => void;
  onOpenGoogleSheet?: () => void;
  onOpenPdfModal: () => void;
  onOpenUploadExcel: () => void;
  onOpenReceptionSlip: () => void;
  onGoogleSignIn: () => void;
  onGoogleLogout: () => void;
  isLoggingIn: boolean;
  onQuickSync: () => void;
  isLiveBackendConnected?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  user,
  sheetsConfig,
  userRole,
  onOpenRoleModal,
  onOpenSheetsModal,
  onOpenGoogleSheet,
  onOpenPdfModal,
  onOpenUploadExcel,
  onOpenReceptionSlip,
  onGoogleSignIn,
  onGoogleLogout,
  isLoggingIn,
  onQuickSync,
  isLiveBackendConnected = true,
}) => {
  const isReceptionist = userRole === 'receptionist';
  const hasLinkedSheet = Boolean(sheetsConfig.spreadsheetId);

  return (
    <header className="sticky top-0 z-40 bg-[#FAF7F2] border-b border-[#E6DFD5] shadow-xs">
      <div className="w-full px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          
          {/* Faiz Husaini Branding */}
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setActiveTab('dashboard')}
          >
            <FaizHusainiLogo size="md" />
          </div>

          {/* Navigation Tabs (Beige & Deep Green) */}
          <nav className="hidden md:flex items-center space-x-1 bg-stone-200/60 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-950 hover:bg-stone-200/80'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Dashboard & Rooms Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('reservations')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'reservations'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-950 hover:bg-stone-200/80'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Zaereen & Allotment Grid</span>
            </button>

            <button
              onClick={() => setActiveTab('upgrades')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'upgrades'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-950 hover:bg-stone-200/80'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>B ➔ A Shifts (Accounts)</span>
            </button>

            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'rooms'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-950 hover:bg-stone-200/80'
              }`}
            >
              <BedDouble className="w-3.5 h-3.5" />
              <span>114 Hotel Rooms</span>
            </button>
          </nav>

          {/* Right Action Icons / Buttons */}
          <div className="flex items-center gap-2">
            
            {/* Live Backend Data & Sheets Sync Status Indicator */}
            {isLiveBackendConnected && (
              <div
                className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-100/80 text-emerald-950 border border-emerald-300 text-xs font-bold shadow-2xs"
                title="Data is stored on live backend server until deleted, and synchronizes with Google Sheets & Rooms Timeline"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                <span>Live Backend & Sheets</span>
              </div>
            )}

            {/* Role Rights Badge / Switcher */}
            <button
              type="button"
              onClick={onOpenRoleModal}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer shadow-2xs ${
                isReceptionist
                  ? 'bg-amber-100/90 text-amber-950 border-amber-300 hover:bg-amber-200'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
              }`}
              title="Click to manage access rights (View-only for Receptionist, Edit for Admin)"
            >
              {isReceptionist ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-amber-800" />
                  <span className="hidden sm:inline">Receptionist (View Only)</span>
                  <span className="sm:hidden">View Only</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#124E39]" />
                  <span className="hidden sm:inline">Admin (Editable Rights)</span>
                  <span className="sm:hidden">Admin</span>
                </>
              )}
            </button>

            {/* Upload Excel Quick Button (Only for Admin) */}
            {!isReceptionist && (
              <button
                onClick={onOpenUploadExcel}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition cursor-pointer"
                title="Upload Zaereen Excel Sheet"
              >
                <Upload className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span className="hidden sm:inline">Upload Excel</span>
              </button>
            )}

            {/* Reception Daily Slip Button */}
            <button
              onClick={onOpenReceptionSlip}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-white hover:bg-stone-50 text-[#124E39] border border-[#124E39]/40 shadow-xs transition cursor-pointer"
              title="Print Reception Manager Daily Operational & Room Turnover Slip"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Reception Slip</span>
            </button>

            {/* Google Sheets Access & 1-Click Sync (User request: "once sync button & i can access the google") */}
            {!isReceptionist && (
              <div className="flex items-center gap-1.5 bg-emerald-50/80 border border-emerald-300 p-1 rounded-xl shadow-2xs">
                {hasLinkedSheet ? (
                  <>
                    {/* Open Google Sheet Directly */}
                    <button
                      onClick={onOpenGoogleSheet || onOpenSheetsModal}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-950 hover:bg-emerald-100 transition cursor-pointer"
                      title="Open synced Google Sheet in new tab"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-800" />
                      <span className="hidden sm:inline">Google Sheet</span>
                      <ArrowUpRight className="w-3 h-3 text-emerald-700" />
                    </button>

                    {/* 1-Click Sync Button */}
                    <button
                      onClick={onQuickSync}
                      disabled={sheetsConfig.isSyncing}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        sheetsConfig.isSyncing
                          ? 'bg-amber-100 text-amber-950 border border-amber-300 animate-pulse'
                          : 'bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-2xs'
                      }`}
                      title="1-Click Two-Way Sync: Syncs Zaereen, 114 Rooms & Rooms Availability & Departure Timeline"
                    >
                      <RefreshCw className={`w-3 h-3 text-[#EBD59E] ${sheetsConfig.isSyncing ? 'animate-spin' : ''}`} />
                      <span>{sheetsConfig.isSyncing ? 'Syncing...' : 'Sync'}</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={onOpenSheetsModal}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-950 hover:bg-emerald-100 transition cursor-pointer"
                    title="Connect Google Sheet to sync rooms, zaereen & departure timeline"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-800" />
                    <span className="hidden sm:inline">Connect Sheet</span>
                  </button>
                )}

                {/* Settings icon to open Google Sheets Modal */}
                <button
                  onClick={onOpenSheetsModal}
                  className="p-1 rounded-md text-emerald-800 hover:text-emerald-950 hover:bg-emerald-100 transition cursor-pointer"
                  title="Configure Google Sheet settings"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Tab Bar */}
      <div className="md:hidden flex items-center justify-around border-t border-[#E6DFD5] px-2 py-1.5 bg-[#FAF7F2] text-[11px] font-bold">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-2 py-1 rounded ${activeTab === 'dashboard' ? 'bg-[#124E39] text-white' : 'text-stone-700'}`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setActiveTab('reservations')}
          className={`px-2 py-1 rounded ${activeTab === 'reservations' ? 'bg-[#124E39] text-white' : 'text-stone-700'}`}
        >
          Zaereen
        </button>
        <button
          onClick={() => setActiveTab('upgrades')}
          className={`px-2 py-1 rounded ${activeTab === 'upgrades' ? 'bg-[#124E39] text-white' : 'text-stone-700'}`}
        >
          B ➔ A
        </button>
        <button
          onClick={() => setActiveTab('rooms')}
          className={`px-2 py-1 rounded ${activeTab === 'rooms' ? 'bg-[#124E39] text-white' : 'text-stone-700'}`}
        >
          Rooms
        </button>
      </div>
    </header>
  );
};
