import React, { useState } from 'react';
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
  Printer,
  Upload,
  Download,
  ShieldCheck,
  Eye,
  UploadCloud,
  Menu,
  X
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
  onOpenPdfModal: (reportType?: any, tourId?: string) => void;
  onOpenUploadExcel: () => void;
  onOpenReceptionSlip?: (tab?: 'arrival_slip' | 'departure_list' | 'turnover' | 'roster' | 'worker_summary' | 'portal_upload') => void;
  onGoogleSignIn: () => void;
  onGoogleLogout: () => void;
  isLoggingIn: boolean;
  onQuickSync: () => void;
  isLiveBackendConnected?: boolean;
  roomsCount?: number;
  onOpenAddBuildingRooms?: () => void;
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
  roomsCount,
  onOpenAddBuildingRooms,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isReceptionist = userRole === 'receptionist';
  const hasLinkedSheet = Boolean(sheetsConfig.spreadsheetId);

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-[#E6DFD5] shadow-xs">
        <div className="w-full px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-16 gap-2 sm:gap-3">
            {/* Faiz Husaini Branding */}
            <div
              className="flex items-center gap-2 sm:gap-3 cursor-pointer shrink-0"
              onClick={() => setActiveTab('dashboard')}
            >
              <FaizHusainiLogo size="md" />
            </div>

            {/* Navigation Tabs (Desktop) */}
            <nav className="hidden md:flex items-center space-x-1 bg-stone-200/60 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'rooms'
                    ? 'bg-[#124E39] text-white shadow-xs'
                    : 'text-stone-700 hover:text-stone-950 hover:bg-stone-200/80'
                }`}
              >
                <BedDouble className="w-3.5 h-3.5" />
                <span>{roomsCount ? `${roomsCount} Hotel Rooms` : 'Hotel Rooms'}</span>
              </button>
            </nav>

            {/* Mobile Quick Controls (Compact, Touch-Friendly) */}
            <div className="flex md:hidden items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenRoleModal}
                className={`min-h-[40px] px-2.5 rounded-xl text-[11px] font-bold border flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  isReceptionist
                    ? 'bg-amber-100 text-amber-950 border-amber-300'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-300'
                }`}
              >
                {isReceptionist ? <Eye className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5 text-[#124E39]" />}
                <span>{isReceptionist ? 'View' : 'Admin'}</span>
              </button>

              {!isReceptionist && hasLinkedSheet && (
                <button
                  type="button"
                  onClick={onQuickSync}
                  disabled={sheetsConfig.isSyncing}
                  className="min-h-[40px] px-2.5 rounded-xl text-[11px] font-bold bg-[#124E39] text-[#EBD59E] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  title="Sync with Google Sheet"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${sheetsConfig.isSyncing ? 'animate-spin' : ''}`} />
                  <span>Sync</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-white border border-stone-300 text-[#124E39] flex items-center justify-center cursor-pointer"
                aria-label="Open mobile menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>

            {/* Desktop Action Icons / Buttons */}
            <div className="hidden md:flex items-center gap-2">
              {isLiveBackendConnected && (
                <div
                  className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-100/80 text-emerald-950 border border-emerald-300 text-xs font-bold shadow-2xs whitespace-nowrap"
                  title="Data is stored on live backend server until deleted, and synchronizes with Google Sheets & Rooms Timeline"
                >
                  <span>Live Backend & Sheets</span>
                </div>
              )}

              <button
                type="button"
                onClick={onOpenRoleModal}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer shadow-2xs whitespace-nowrap ${
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

              {!isReceptionist && onOpenAddBuildingRooms && (
                <button
                  type="button"
                  onClick={onOpenAddBuildingRooms}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] border border-[#C5A059]/40 shadow-xs transition cursor-pointer whitespace-nowrap"
                  title="Add Hotel Building & Rooms manually or sync from Google Sheet"
                >
                  <Building2 className="w-3.5 h-3.5 text-[#EBD59E]" />
                  <span className="hidden xl:inline">+ Add Building / Rooms</span>
                  <span className="xl:hidden">+ Building/Rooms</span>
                </button>
              )}

              {!isReceptionist && (
                <button
                  onClick={onOpenUploadExcel}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition cursor-pointer whitespace-nowrap"
                  title="Upload Zaereen Excel Sheet"
                >
                  <Upload className="w-3.5 h-3.5 text-[#EBD59E]" />
                  <span className="hidden sm:inline">Upload Excel</span>
                </button>
              )}

              {onOpenReceptionSlip && (
                <div className="flex items-center rounded-lg border border-stone-300 bg-white shadow-2xs p-0.5">
                  <button
                    type="button"
                    onClick={() => onOpenReceptionSlip('arrival_slip')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold text-[#124E39] hover:bg-emerald-50 transition cursor-pointer whitespace-nowrap"
                    title="Open Arrival Slip"
                  >
                    <Printer className="w-3.5 h-3.5 text-emerald-800" />
                    <span className="hidden sm:inline">Arrival Slip</span>
                  </button>
                  <div className="w-[1px] h-4 bg-stone-300 mx-0.5" />
                  <button
                    type="button"
                    onClick={() => onOpenReceptionSlip('departure_list')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold text-amber-900 hover:bg-amber-50 transition cursor-pointer whitespace-nowrap"
                    title="Open Departure List"
                  >
                    <Printer className="w-3.5 h-3.5 text-amber-800" />
                    <span className="hidden sm:inline">Departure List</span>
                  </button>
                </div>
              )}

              <div className="flex items-center rounded-lg border border-stone-300 bg-white shadow-2xs p-0.5">
                <button
                  type="button"
                  onClick={() => onOpenPdfModal('tour_manifest')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold text-[#124E39] hover:bg-emerald-50 transition cursor-pointer whitespace-nowrap"
                  title="Tour ID Specific Lodging Manifest"
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-800" />
                  <span className="hidden sm:inline">Tour Manifest</span>
                </button>
                <div className="w-[1px] h-4 bg-stone-300 mx-0.5" />
                <button
                  type="button"
                  onClick={() => onOpenPdfModal('all_reservations')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold text-stone-700 hover:bg-stone-100 transition cursor-pointer whitespace-nowrap"
                  title="Export Administrative PDF Reports"
                >
                  <Download className="w-3.5 h-3.5 text-stone-500" />
                  <span className="hidden xl:inline">Export PDF</span>
                </button>
              </div>

              {user ? (
                <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-xl border border-stone-200 shadow-2xs">
                  <div
                    className="w-6 h-6 rounded-full bg-[#124E39] text-[#EBD59E] flex items-center justify-center font-bold text-[11px]"
                    title={user.email || 'Google User'}
                  >
                    {user.email ? user.email[0].toUpperCase() : 'U'}
                  </div>
                  <span className="text-xs font-semibold text-stone-700 max-w-[120px] truncate hidden xl:inline" title={user.email || ''}>
                    {user.email}
                  </span>
                  <button
                    type="button"
                    onClick={onGoogleLogout}
                    className="p-1 text-stone-500 hover:text-rose-700 hover:bg-stone-100 rounded-lg transition cursor-pointer"
                    title="Sign out of Google"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onGoogleSignIn}
                  disabled={isLoggingIn}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] border border-[#C5A059]/40 shadow-2xs transition cursor-pointer whitespace-nowrap"
                  title="Sign in with Google"
                >
                  <LogIn className="w-3.5 h-3.5 text-[#EBD59E]" />
                  <span className="hidden sm:inline">{isLoggingIn ? 'Signing in...' : 'Sign In'}</span>
                </button>
              )}

              <div className="flex items-center gap-1.5 bg-emerald-50/80 border border-emerald-300 p-1 rounded-xl shadow-2xs">
                {hasLinkedSheet ? (
                  <>
                    <button
                      onClick={onOpenGoogleSheet || onOpenSheetsModal}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-950 hover:bg-emerald-100 transition cursor-pointer whitespace-nowrap"
                      title="Open synced Google Sheet in new tab"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-800" />
                      <span className="hidden sm:inline">Google Sheet</span>
                      <ArrowUpRight className="w-3 h-3 text-emerald-700" />
                    </button>

                    {!isReceptionist && (
                      <button
                        onClick={onQuickSync}
                        disabled={sheetsConfig.isSyncing}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                          sheetsConfig.isSyncing
                            ? 'bg-amber-100 text-amber-950 border border-amber-300'
                            : 'bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-2xs'
                        }`}
                        title="Push to Google Sheet"
                      >
                        <UploadCloud className="w-3 h-3 text-[#EBD59E]" />
                        <span>{sheetsConfig.isSyncing ? 'Pushing...' : 'Push'}</span>
                      </button>
                    )}

                    {isReceptionist && (
                      <button
                        onClick={onOpenSheetsModal}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-2xs transition cursor-pointer whitespace-nowrap"
                        title="Pull latest records from Google Sheet"
                      >
                        <Download className="w-3 h-3 text-[#EBD59E]" />
                        <span>Pull</span>
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={onOpenSheetsModal}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-950 hover:bg-emerald-100 transition cursor-pointer whitespace-nowrap"
                    title="Connect Google Sheet"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-800" />
                    <span className="hidden sm:inline">Connect Sheet</span>
                  </button>
                )}

                <button
                  onClick={onOpenSheetsModal}
                  className="p-1 rounded-md text-emerald-800 hover:text-emerald-950 hover:bg-emerald-100 transition cursor-pointer"
                  title="Configure or Change Google Sheet"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Fixed Mobile Bottom Navigation Bar (<= 56px, thumb friendly) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden h-14 bg-[#FAF7F2]/95 backdrop-blur-md border-t border-[#E6DFD5] grid grid-cols-5 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'dashboard' ? 'text-[#124E39] bg-emerald-50/70' : 'text-stone-600'
          }`}
        >
          <BarChart3 className={`w-4 h-4 ${activeTab === 'dashboard' ? 'text-[#124E39]' : 'text-stone-500'}`} />
          <span className="whitespace-nowrap">Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('reservations')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'reservations' ? 'text-[#124E39] bg-emerald-50/70' : 'text-stone-600'
          }`}
        >
          <CalendarDays className={`w-4 h-4 ${activeTab === 'reservations' ? 'text-[#124E39]' : 'text-stone-500'}`} />
          <span className="whitespace-nowrap">Zaereen</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('rooms')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'rooms' ? 'text-[#124E39] bg-emerald-50/70' : 'text-stone-600'
          }`}
        >
          <BedDouble className={`w-4 h-4 ${activeTab === 'rooms' ? 'text-[#124E39]' : 'text-stone-500'}`} />
          <span className="whitespace-nowrap">Rooms</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('upgrades')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition cursor-pointer ${
            activeTab === 'upgrades' ? 'text-[#124E39] bg-emerald-50/70' : 'text-stone-600'
          }`}
        >
          <ArrowUpRight className={`w-4 h-4 ${activeTab === 'upgrades' ? 'text-[#124E39]' : 'text-stone-500'}`} />
          <span className="whitespace-nowrap">B ➔ A</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenReceptionSlip?.('arrival_slip')}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold text-[#124E39] cursor-pointer"
        >
          <Printer className="w-4 h-4 text-[#124E39]" />
          <span className="whitespace-nowrap">Slips</span>
        </button>
      </nav>

      {/* Mobile Slide-Over / Action Sheet Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-[88%] max-w-sm bg-[#FAF7F2] h-full shadow-2xl border-l border-[#E6DFD5] flex flex-col overflow-hidden">
            <div className="bg-[#124E39] text-white px-4 py-3.5 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-[#EBD59E]">Reception Tools & Sheets</div>
                <div className="text-[11px] text-emerald-100">
                  {user?.email || (isReceptionist ? 'Receptionist Mode' : 'Admin Mode')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-emerald-100 hover:text-white cursor-pointer"
                aria-label="Close mobile menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {/* Google Sheets Section */}
              <div className="bg-white rounded-xl border border-[#E6DFD5] p-3 space-y-2">
                <div className="font-bold text-[#124E39] text-xs">
                  Google Sheet: {sheetsConfig.spreadsheetName || 'Not Connected'}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {hasLinkedSheet && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        (onOpenGoogleSheet || onOpenSheetsModal)();
                      }}
                      className="min-h-[44px] w-full px-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 font-bold flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-800" />
                        <span>Open Google Sheet</span>
                      </span>
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenSheetsModal();
                    }}
                    className="min-h-[44px] w-full px-3 rounded-xl bg-[#124E39] text-[#EBD59E] font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Change / Sync Google Sheet</span>
                  </button>
                </div>
              </div>

              {/* Operational Slips & Reports */}
              <div className="bg-white rounded-xl border border-[#E6DFD5] p-3 space-y-2">
                <div className="font-bold text-stone-700 text-[11px] uppercase tracking-wider">
                  Daily Slips & PDF Reports
                </div>
                {onOpenReceptionSlip && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        onOpenReceptionSlip('arrival_slip');
                      }}
                      className="min-h-[44px] w-full px-3 rounded-xl bg-[#FAF7F2] border border-stone-200 text-[#124E39] font-bold flex items-center gap-2 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Arrival Slip</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        onOpenReceptionSlip('departure_list');
                      }}
                      className="min-h-[44px] w-full px-3 rounded-xl bg-[#FAF7F2] border border-stone-200 text-amber-900 font-bold flex items-center gap-2 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Departure List</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onOpenPdfModal('tour_manifest');
                  }}
                  className="min-h-[44px] w-full px-3 rounded-xl bg-[#FAF7F2] border border-stone-200 text-[#124E39] font-bold flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>Tour Manifest</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onOpenPdfModal('all_reservations');
                  }}
                  className="min-h-[44px] w-full px-3 rounded-xl bg-[#FAF7F2] border border-stone-200 text-stone-800 font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Export PDF Reports</span>
                </button>
              </div>

              {/* Admin Data Tools */}
              {!isReceptionist && (
                <div className="bg-white rounded-xl border border-[#E6DFD5] p-3 space-y-2">
                  <div className="font-bold text-stone-700 text-[11px] uppercase tracking-wider">
                    Data & Inventory Actions
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenUploadExcel();
                    }}
                    className="min-h-[44px] w-full px-3 rounded-xl bg-[#124E39] text-white font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-[#EBD59E]" />
                    <span>Upload Zaereen Excel</span>
                  </button>
                  {onOpenAddBuildingRooms && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        onOpenAddBuildingRooms();
                      }}
                      className="min-h-[44px] w-full px-3 rounded-xl bg-emerald-50 border border-emerald-300 text-[#124E39] font-bold flex items-center gap-2 cursor-pointer"
                    >
                      <Building2 className="w-4 h-4" />
                      <span>Add Building / Rooms</span>
                    </button>
                  )}
                </div>
              )}

              {/* Account & Role */}
              <div className="bg-white rounded-xl border border-[#E6DFD5] p-3 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onOpenRoleModal();
                  }}
                  className="min-h-[44px] w-full px-3 rounded-xl bg-stone-100 text-stone-900 font-bold flex items-center gap-2 cursor-pointer"
                >
                  {isReceptionist ? <Eye className="w-4 h-4 text-amber-700" /> : <ShieldCheck className="w-4 h-4 text-[#124E39]" />}
                  <span>Switch Role ({isReceptionist ? 'Receptionist' : 'Admin'})</span>
                </button>

                {user ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onGoogleLogout();
                    }}
                    className="min-h-[44px] w-full px-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out ({user.email})</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onGoogleSignIn();
                    }}
                    disabled={isLoggingIn}
                    className="min-h-[44px] w-full px-3 rounded-xl bg-[#124E39] text-[#EBD59E] font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{isLoggingIn ? 'Signing in...' : 'Sign In with Google'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

