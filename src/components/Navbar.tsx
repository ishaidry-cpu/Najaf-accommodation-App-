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
  Mail,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';
import { UserRole } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import { SyncToNkerpButton } from './SyncToNkerpButton';
import { Dropdown, MenuItem, MenuDivider, MenuHeading } from './ui';
import type { NkerpSyncState } from '../hooks/useNkerpSync';

export type AppTab = 'dashboard' | 'reservations' | 'planner' | 'upgrades' | 'rooms' | 'sync' | 'emails';

interface NavbarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  userRole: UserRole;
  onPullNkerp: () => void;
  isPulling: boolean;
  onOpenRoleModal: () => void;
  onOpenPdfModal: (reportType?: any, tourId?: string) => void;
  onOpenUploadExcel: () => void;
  onOpenReceptionSlip?: (tab?: 'arrival_slip' | 'departure_list' | 'turnover' | 'roster' | 'worker_summary' | 'portal_upload') => void;
  onOpenAToBReceipt?: () => void;
  roomsCount?: number;
  onOpenAddBuildingRooms?: () => void;
  nkerpSync: NkerpSyncState;
  /** Najaf accommodation emails are being sent. */
  emailsRunning?: boolean;
}

/** mobileOnly: on desktop the top bar's "Send emails" button is the way in, so the tab would only repeat it. */
type NavItem = { tab: AppTab; label: string; short: string; icon: React.ElementType; mobileOnly?: boolean };

const NAV_ITEMS: NavItem[] = [
  { tab: 'dashboard', label: 'Overview', short: 'Overview', icon: LayoutGrid },
  { tab: 'reservations', label: 'Zaereen', short: 'Zaereen', icon: CalendarDays },
  { tab: 'planner', label: 'AI Planner', short: 'Planner', icon: Sparkles },
  { tab: 'rooms', label: 'Rooms', short: 'Rooms', icon: BedDouble },
  { tab: 'upgrades', label: 'B→A shifts', short: 'B→A', icon: Repeat2 },
  { tab: 'sync', label: 'NKERP sync', short: 'Sync', icon: RefreshCcw },
  { tab: 'emails', label: 'Najaf emails', short: 'Emails', icon: Mail, mobileOnly: true },
];

/** The gold marker glides to the chosen tab. */
const markerSpring = { type: 'spring', stiffness: 520, damping: 40, mass: 0.7 } as const;

const ghostTrigger = (open: boolean) =>
  `flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-[13px] font-medium transition ${
    open ? 'bg-stone-100 text-stone-900' : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
  }`;

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  userRole,
  onPullNkerp,
  isPulling,
  onOpenRoleModal,
  onOpenPdfModal,
  onOpenUploadExcel,
  onOpenReceptionSlip,
  onOpenAToBReceipt,
  roomsCount,
  onOpenAddBuildingRooms,
  nkerpSync,
  emailsRunning = false,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isReceptionist = userRole === 'receptionist';
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

  const accountItems = (close: () => void) => (
    <>
      <div className="px-2.5 pt-1.5 pb-2">
        <div className="text-[13px] font-semibold text-stone-900 truncate">Local access</div>
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
    </>
  );

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-stone-200 bg-white/90 backdrop-blur-md supports-[backdrop-filter]:bg-white/80">
        {(nkerpSync.running || emailsRunning) && <div className="gold-thread" role="progressbar" aria-label={emailsRunning ? 'Sending Najaf emails' : 'Syncing to NKERP'} />}
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
          <nav aria-label="Main" className="hidden md:flex h-full items-stretch gap-0.5 ml-2 lg:ml-4 2xl:ml-6 min-w-0 overflow-x-auto app-scroll-x">
            {NAV_ITEMS.filter((n) => !n.mobileOnly).map(({ tab, label, icon: Icon }) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-1.5 px-2.5 2xl:px-3 text-[13px] whitespace-nowrap transition cursor-pointer ${
                    active ? 'text-stone-950 font-semibold' : 'text-stone-500 font-medium hover:text-stone-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 transition-colors ${active ? 'text-brand-700' : ''} ${tab === 'sync' && nkerpSync.running ? 'animate-spin' : ''} ${tab === 'emails' && emailsRunning ? 'animate-pulse text-gold-600' : ''}`} />
                  <span>{label}</span>
                  {tab === 'rooms' && roomsCount ? (
                    <span className="hidden 2xl:inline text-xs text-stone-400 tabular-nums font-normal">{roomsCount}</span>
                  ) : null}
                  {tab === 'sync' && syncBadge > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] leading-[18px] text-center font-semibold tabular-nums">
                      {syncBadge}
                    </span>
                  )}
                  {active && (
                    <motion.span
                      layoutId="nav-marker"
                      transition={markerSpring}
                      aria-hidden
                      className="absolute left-2.5 right-2.5 2xl:left-3 2xl:right-3 -bottom-px h-[2px] rounded-full bg-gold-400"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {/* Desktop utilities */}
            <div className="hidden md:flex items-center gap-1">
              <button type="button" className={`${ghostTrigger(false)} whitespace-nowrap`} disabled={isPulling} onClick={onPullNkerp}
                title="Pull from NKERP" aria-label={isPulling ? 'Pulling from NKERP' : 'Pull from NKERP'}>
                <Download className="w-4 h-4" /> <span className="hidden 2xl:inline">{isPulling ? 'Pulling…' : 'Pull from NKERP'}</span>
              </button>

              <Dropdown
                label="Print and export"
                trigger={(open) => (
                  <span className={ghostTrigger(open)}>
                    <Printer className="w-4 h-4 text-stone-500" />
                    <span className="hidden 2xl:inline">Print</span>
                    <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                  </span>
                )}
              >
                {printItems}
              </Dropdown>

              <div className="mx-1.5 h-5 w-px bg-stone-200" />

              <button
                type="button"
                onClick={() => setActiveTab('emails')}
                title="Send Najaf accommodation emails to tour operators or zaereen"
                aria-current={activeTab === 'emails' ? 'page' : undefined}
                aria-label={emailsRunning ? 'Sending Najaf emails' : 'Send emails'}
                className={`group shrink-0 whitespace-nowrap flex items-center gap-1.5 h-9 px-2.5 xl:px-3 rounded-lg text-[13px] font-medium ring-1 ring-inset cursor-pointer ${
                  activeTab === 'emails' ? 'bg-brand-50 text-brand-800 ring-brand-100' : 'bg-white text-stone-800 ring-stone-200 hover:ring-stone-300 hover:bg-stone-50'
                }`}
              >
                {emailsRunning ? <Loader2 className="w-4 h-4 animate-spin text-gold-600" /> : <Mail className="w-4 h-4 text-stone-500 transition-transform duration-300 group-hover:-translate-y-px group-hover:-rotate-6" />}
                <span className="hidden xl:inline">{emailsRunning ? 'Sending…' : 'Send emails'}</span>
              </button>

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
                      <ShieldCheck className="w-3.5 h-3.5" />
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
        <div className="grid grid-cols-7 h-14">
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
                {active && <motion.span layoutId="nav-marker-mobile" transition={markerSpring} aria-hidden className="absolute top-0 h-[2px] w-8 rounded-full bg-gold-400" />}
                <Icon className={`w-5 h-5 ${tab === 'sync' && nkerpSync.running ? 'animate-spin' : ''} ${tab === 'emails' && emailsRunning ? 'animate-pulse' : ''}`} strokeWidth={active ? 2.2 : 1.8} />
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
              <MenuDivider />
              <MenuItem icon={Download} disabled={isPulling} onClick={() => { setIsMobileMenuOpen(false); onPullNkerp(); }}>
                {isPulling ? 'Pulling…' : 'Pull from NKERP'}
              </MenuItem>
              <MenuHeading>Account</MenuHeading>
              {accountItems(() => setIsMobileMenuOpen(false))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
