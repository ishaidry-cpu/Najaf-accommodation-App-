import React, { useEffect, useState } from 'react';
import {
  Building2,
  CalendarDays,
  FileSpreadsheet,
  FileText,
  BedDouble,
  ArrowUpRight,
  LayoutGrid,
  LogIn,
  LogOut,
  RefreshCcw,
  Printer,
  Upload,
  Download,
  ShieldCheck,
  Eye,
  UploadCloud,
  Menu,
  X,
  ChevronDown,
  Settings2,
  Repeat2,
  ExternalLink,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { GoogleSheetsConfig, UserRole } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import { SyncToNkerpButton } from './SyncToNkerpButton';
import { Dropdown, MenuItem, MenuDivider, MenuHeading } from './ui';
import type { NkerpSyncState } from '../hooks/useNkerpSync';

export type AppTab = 'dashboard' | 'reservations' | 'upgrades' | 'rooms' | 'sync';

interface NavbarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  user: User | null;
  sheetsConfig: GoogleSheetsConfig;
  userRole: UserRole;
  onOpenRoleModal: () => void;
  onOpenSheetsModal: () => void;
  onOpenGoogleSheet?: () => void;
  onOpenPdfModal: (reportType?: any, tourId?: string) => void;
  onOpenUploadExcel: () => void;
  onOpenReceptionSlip?: (tab?: 'arrival_slip' | 'departure_list' | 'turnover' | 'roster' | 'worker_summary' | 'portal_upload') => void;
  onOpenAToBReceipt?: () => void;
  onGoogleSignIn: () => void;
  onGoogleLogout: () => void;
  isLoggingIn: boolean;
  onQuickSync: () => void;
  isLiveBackendConnected?: boolean;
  roomsCount?: number;
  onOpenAddBuildingRooms?: () => void;
  nkerpSync: NkerpSyncState;
}

type NavItem = { tab: AppTab; label: string; short: string; icon: React.ElementType };

const NAV_ITEMS: NavItem[] = [
  { tab: 'dashboard', label: 'Overview', short: 'Overview', icon: LayoutGrid },
  { tab: 'reservations', label: 'Zaereen', short: 'Zaereen', icon: CalendarDays },
  { tab: 'rooms', label: 'Rooms', short: 'Rooms', icon: BedDouble },
  { tab: 'upgrades', label: 'B→A shifts', short: 'B→A', icon: Repeat2 },
  { tab: 'sync', label: 'NKERP sync', short: 'Sync', icon: RefreshCcw },
];

const ghostTrigger = (open: boolean) =>
  `flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-[13px] font-medium transition ${
    open ? 'bg-stone-100 text-stone-900' : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
  }`;

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
  onOpenAToBReceipt,
  onGoogleSignIn,
  onGoogleLogout,
  isLoggingIn,
  onQuickSync,
  isLiveBackendConnected = true,
  roomsCount,
  onOpenAddBuildingRooms,
  nkerpSync,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isReceptionist = userRole === 'receptionist';
  const hasLinkedSheet = Boolean(sheetsConfig.spreadsheetId);
  const lastSynced = sheetsConfig.lastSyncedAt
    ? new Date(sheetsConfig.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const initial = user?.email ? user.email[0].toUpperCase() : null;

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsMobileMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobileMenuOpen]);

  const syncBadge =
    nkerpSync.attentionCount > 0 && !nkerpSync.running ? nkerpSync.attentionCount : 0;

  /* Shared menu bodies (desktop dropdowns and mobile drawer use the same actions). */
  const printItems = (close: () => void) => (
    <>
      {onOpenReceptionSlip && (
        <>
          <MenuItem icon={Printer} onClick={() => { close(); onOpenReceptionSlip('arrival_slip'); }} hint="Today's arrivals with rooms">
            Arrival slip
          </MenuItem>
          <MenuItem icon={Printer} onClick={() => { close(); onOpenReceptionSlip('departure_list'); }} hint="Rooms freeing up today">
            Departure list
          </MenuItem>
        </>
      )}
      <MenuItem icon={FileText} onClick={() => { close(); onOpenPdfModal('tour_manifest'); }} hint="Lodging list for one tour">
        Tour manifest
      </MenuItem>
      {onOpenAToBReceipt && (
        <MenuItem icon={FileText} onClick={() => { close(); onOpenAToBReceipt(); }}>
          A→B refund receipt
        </MenuItem>
      )}
      <MenuDivider />
      <MenuItem icon={Download} onClick={() => { close(); onOpenPdfModal('all_reservations'); }}>
        Export PDF reports
      </MenuItem>
    </>
  );

  const sheetItems = (close: () => void) => (
    <>
      <div className="px-2.5 pt-1.5 pb-2">
        <div className="text-[13px] font-semibold text-stone-900 leading-snug">
          {sheetsConfig.spreadsheetName || (hasLinkedSheet ? 'Google Sheet' : 'No sheet connected')}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500">
          <span className={`w-1.5 h-1.5 rounded-full ${hasLinkedSheet ? 'bg-emerald-500' : 'bg-stone-300'}`} />
          {hasLinkedSheet ? (lastSynced ? `Last synced ${lastSynced}` : 'Connected') : 'Connect a sheet to back up data'}
        </div>
      </div>
      <MenuDivider />
      {hasLinkedSheet ? (
        <>
          <MenuItem icon={ExternalLink} onClick={() => { close(); (onOpenGoogleSheet || onOpenSheetsModal)(); }}>
            Open in Google Sheets
          </MenuItem>
          {isReceptionist ? (
            <MenuItem icon={Download} onClick={() => { close(); onOpenSheetsModal(); }} hint="Get the latest zaereen and rooms">
              Pull from sheet
            </MenuItem>
          ) : (
            <MenuItem
              icon={UploadCloud}
              disabled={sheetsConfig.isSyncing}
              onClick={() => { close(); onQuickSync(); }}
              hint="Send this app's records to the sheet"
            >
              {sheetsConfig.isSyncing ? 'Pushing…' : 'Push to sheet'}
            </MenuItem>
          )}
          <MenuItem icon={Settings2} onClick={() => { close(); onOpenSheetsModal(); }}>
            Sheet settings
          </MenuItem>
        </>
      ) : (
        <MenuItem icon={FileSpreadsheet} onClick={() => { close(); onOpenSheetsModal(); }}>
          Connect Google Sheet
        </MenuItem>
      )}
    </>
  );

  const accountItems = (close: () => void) => (
    <>
      <div className="px-2.5 pt-1.5 pb-2">
        <div className="text-[13px] font-semibold text-stone-900 truncate">{user?.email || 'Not signed in'}</div>
        <div className="mt-0.5 text-xs text-stone-500">
          {isReceptionist ? 'Receptionist · view only' : 'Admin · can edit'}
        </div>
      </div>
      <MenuDivider />
      <MenuItem
        icon={isReceptionist ? ShieldCheck : Eye}
        onClick={() => { close(); onOpenRoleModal(); }}
        hint={isReceptionist ? 'Enter the admin PIN to edit' : 'Limit this device to viewing'}
      >
        {isReceptionist ? 'Switch to admin' : 'Switch to receptionist'}
      </MenuItem>
      {!isReceptionist && (
        <>
          <MenuDivider />
          <MenuHeading>Data</MenuHeading>
          <MenuItem icon={Upload} onClick={() => { close(); onOpenUploadExcel(); }}>
            Upload zaereen Excel
          </MenuItem>
          {onOpenAddBuildingRooms && (
            <MenuItem icon={Building2} onClick={() => { close(); onOpenAddBuildingRooms(); }}>
              Add building or rooms
            </MenuItem>
          )}
        </>
      )}
      <MenuDivider />
      {user ? (
        <MenuItem icon={LogOut} tone="danger" onClick={() => { close(); onGoogleLogout(); }}>
          Sign out
        </MenuItem>
      ) : (
        <MenuItem icon={LogIn} disabled={isLoggingIn} onClick={() => { close(); onGoogleSignIn(); }}>
          {isLoggingIn ? 'Signing in…' : 'Sign in with Google'}
        </MenuItem>
      )}
    </>
  );

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-stone-200 bg-white/90 backdrop-blur-md supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex h-14 w-full max-w-[1680px] items-center gap-3 px-4 lg:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="shrink-0 rounded-lg cursor-pointer"
            aria-label="Go to overview"
          >
            <FaizHusainiLogo size="sm" showSubtitle={false} />
          </button>

          {/* Desktop navigation */}
          <nav aria-label="Main" className="hidden md:flex h-full items-stretch gap-0.5 ml-2 lg:ml-6 min-w-0 overflow-x-auto app-scroll-x">
            {NAV_ITEMS.map(({ tab, label, icon: Icon }) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-1.5 px-2.5 lg:px-3 text-[13px] whitespace-nowrap transition cursor-pointer ${
                    active ? 'text-stone-950 font-semibold' : 'text-stone-500 font-medium hover:text-stone-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-brand-700' : ''} ${tab === 'sync' && nkerpSync.running ? 'animate-spin' : ''}`} />
                  <span>{label}</span>
                  {tab === 'rooms' && roomsCount ? (
                    <span className="text-xs text-stone-400 tabular-nums font-normal">{roomsCount}</span>
                  ) : null}
                  {tab === 'sync' && syncBadge > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] leading-[18px] text-center font-semibold tabular-nums">
                      {syncBadge}
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={`absolute left-2.5 right-2.5 lg:left-3 lg:right-3 -bottom-px h-[2px] rounded-full transition-colors ${
                      active ? 'bg-gold-400' : 'bg-transparent'
                    }`}
                  />
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {/* Desktop utilities */}
            <div className="hidden md:flex items-center gap-1">
              <Dropdown
                label="Google Sheet"
                width="w-72"
                trigger={(open) => (
                  <span className={ghostTrigger(open)} title={isLiveBackendConnected ? 'Data is saved on the server and synced with the Google Sheet' : undefined}>
                    <span className="relative flex">
                      <FileSpreadsheet className="w-4 h-4 text-stone-500" />
                      <span
                        className={`absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full ring-2 ring-white ${
                          sheetsConfig.isSyncing ? 'bg-amber-500 animate-pulse' : hasLinkedSheet ? 'bg-emerald-500' : 'bg-stone-300'
                        }`}
                      />
                    </span>
                    <span className="hidden lg:inline">Sheet</span>
                    <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                  </span>
                )}
              >
                {sheetItems}
              </Dropdown>

              <Dropdown
                label="Print and export"
                trigger={(open) => (
                  <span className={ghostTrigger(open)}>
                    <Printer className="w-4 h-4 text-stone-500" />
                    <span className="hidden lg:inline">Print</span>
                    <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                  </span>
                )}
              >
                {printItems}
              </Dropdown>

              <div className="mx-1.5 h-5 w-px bg-stone-200" />

              <SyncToNkerpButton sync={nkerpSync} onOpenSyncTab={() => setActiveTab('sync')} />

              <Dropdown
                label="Account"
                trigger={(open) => (
                  <span
                    className={`ml-1 flex items-center gap-1.5 h-9 pl-1 pr-2 rounded-full border transition ${
                      open ? 'border-stone-300 bg-stone-50' : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <span className="w-7 h-7 rounded-full bg-brand-700 text-gold-200 flex items-center justify-center text-xs font-semibold">
                      {initial ?? <LogIn className="w-3.5 h-3.5" />}
                    </span>
                    <span className="text-xs font-medium text-stone-700">{isReceptionist ? 'Reception' : 'Admin'}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                  </span>
                )}
              >
                {accountItems}
              </Dropdown>
            </div>

            {/* Mobile utilities */}
            <div className="flex md:hidden items-center gap-1">
              <SyncToNkerpButton sync={nkerpSync} onOpenSyncTab={() => setActiveTab('sync')} compact />
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                className="w-10 h-10 rounded-lg text-stone-700 hover:bg-stone-100 flex items-center justify-center cursor-pointer"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-stone-200 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 h-14">
          {NAV_ITEMS.map(({ tab, short, icon: Icon }) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] transition cursor-pointer ${
                  active ? 'text-brand-700 font-semibold' : 'text-stone-500 font-medium'
                }`}
              >
                <span aria-hidden className={`absolute top-0 h-[2px] w-8 rounded-full ${active ? 'bg-gold-400' : 'bg-transparent'}`} />
                <Icon className={`w-5 h-5 ${tab === 'sync' && nkerpSync.running ? 'animate-spin' : ''}`} strokeWidth={active ? 2.2 : 1.8} />
                <span>{short}</span>
                {tab === 'sync' && syncBadge > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] leading-4 text-center font-semibold">
                    {syncBadge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile drawer */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden flex justify-end bg-stone-950/40 backdrop-blur-[2px] animate-in fade-in duration-150"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Menu"
            className="w-[86%] max-w-sm h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-14 border-b border-stone-100">
              <FaizHusainiLogo size="sm" showSubtitle={false} />
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-10 h-10 -mr-2 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 cursor-pointer"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 pb-8">
              <MenuHeading>Print</MenuHeading>
              {printItems(() => setIsMobileMenuOpen(false))}
              <MenuDivider />
              <MenuHeading>Google Sheet</MenuHeading>
              {sheetItems(() => setIsMobileMenuOpen(false))}
              <MenuDivider />
              <MenuHeading>Account</MenuHeading>
              {accountItems(() => setIsMobileMenuOpen(false))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
