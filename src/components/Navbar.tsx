import React, { useEffect, useLayoutEffect, useState } from 'react';
import {
  Building2,
  CalendarDays,
  FileText,
  BedDouble,
  LayoutGrid,
  RefreshCcw,
  Printer,
  Upload,
  Download,
  ShieldCheck,
  Eye,
  Menu,
  X,
  ChevronRight,
  ChevronsUpDown,
  Repeat2,
  Mail,
  Loader2,
  Sparkles,
  BadgeCheck,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
} from 'lucide-react';
import { motion } from 'motion/react';
import { UserRole } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import { SyncToNkerpButton } from './SyncToNkerpButton';
import { Dropdown, MenuItem, MenuDivider, MenuHeading } from './ui';
import type { NkerpSyncState } from '../hooks/useNkerpSync';
import type { PullStatus } from '../services/api';

export type AppTab = 'dashboard' | 'reservations' | 'planner' | 'approvals' | 'upgrades' | 'rooms' | 'sync' | 'emails';

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
  /** When NKERP was last pulled, shown beside the pull button. */
  pullStatus?: PullStatus | null;
}

type NavItem = { tab: AppTab; label: string; short: string; icon: React.ElementType };
type NavGroup = { heading: string; items: NavItem[] };

/** The rail groups the eight screens by the job they belong to. */
const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Reception',
    items: [
      { tab: 'dashboard', label: 'Overview', short: 'Overview', icon: LayoutGrid },
      { tab: 'reservations', label: 'Zaereen', short: 'Zaereen', icon: CalendarDays },
      { tab: 'rooms', label: 'Rooms', short: 'Rooms', icon: BedDouble },
    ],
  },
  {
    heading: 'Planning',
    items: [
      { tab: 'planner', label: 'AI Planner', short: 'Planner', icon: Sparkles },
      { tab: 'approvals', label: 'Approvals', short: 'Approve', icon: BadgeCheck },
      { tab: 'upgrades', label: 'B→A shifts', short: 'B→A', icon: Repeat2 },
    ],
  },
  {
    heading: 'NKERP',
    items: [
      { tab: 'sync', label: 'NKERP sync', short: 'Sync', icon: RefreshCcw },
      { tab: 'emails', label: 'Najaf emails', short: 'Emails', icon: Mail },
    ],
  },
];
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
/** The phone's bottom bar holds the four everyday screens; the rest sit under More. */
const MOBILE_PRIMARY: AppTab[] = ['dashboard', 'reservations', 'planner', 'rooms'];

/** The gold marker glides to the chosen tab. */
const markerSpring = { type: 'spring', stiffness: 520, damping: 40, mass: 0.7 } as const;

/** The eight-pointed star of Fatemi stonework: the "you are here" marker. */
const KhatamStar: React.FC<{ className?: string }> = ({ className = 'w-2.5 h-2.5' }) => (
  <svg viewBox="0 0 20 20" aria-hidden className={className} fill="currentColor">
    <path d="M10 0l2.93 2.93H17.07V7.07L20 10l-2.93 2.93v4.14h-4.14L10 20l-2.93-2.93H2.93v-4.14L0 10l2.93-2.93V2.93h4.14z" />
  </svg>
);

const RAIL_KEY = 'najaf.rail.collapsed';
const RAIL_WIDE = '236px';
const RAIL_NARROW = '68px';

const pulledAt = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

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
  pullStatus,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(RAIL_KEY);
      if (saved !== null) return saved === '1';
    } catch { /* private mode: fall through to the width default */ }
    return typeof window !== 'undefined' && window.innerWidth < 1280;
  });
  // The page reads the rail's width from this variable to leave room for it.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--rail-w', collapsed ? RAIL_NARROW : RAIL_WIDE);
  }, [collapsed]);
  const toggleCollapsed = () => setCollapsed((v) => {
    try { window.localStorage.setItem(RAIL_KEY, v ? '0' : '1'); } catch { /* not saved in private mode */ }
    return !v;
  });
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

  const lastPull = pulledAt(pullStatus?.lastSyncedAt);
  const pullFailed = Boolean(pullStatus?.error);
  const moreActive = !MOBILE_PRIMARY.includes(activeTab);

  const railItem = (active: boolean) =>
    `group relative flex items-center gap-2.5 w-full h-10 rounded-lg text-sm whitespace-nowrap cursor-pointer ${
      collapsed ? 'justify-center px-0' : 'px-3'
    } ${active ? 'text-white font-semibold' : 'text-brand-100/85 font-medium hover:bg-white/[0.07] hover:text-white'}`;
  const railUtility = `flex items-center gap-2.5 w-full h-10 rounded-lg text-sm font-medium text-brand-100/85 hover:bg-white/[0.07] hover:text-white cursor-pointer disabled:opacity-60 disabled:cursor-default ${
    collapsed ? 'justify-center px-0' : 'px-3'
  }`;

  return (
    <>
      {/* Desktop rail */}
      <aside
        aria-label="Navigation"
        className="app-rail hidden lg:flex fixed inset-y-0 left-0 z-40 flex-col bg-brand-900 text-white"
        style={{ width: collapsed ? RAIL_NARROW : RAIL_WIDE }}
      >
        <div className="app-rail-lattice" aria-hidden />
        {(nkerpSync.running || emailsRunning) && (
          <div className="gold-thread gold-thread-top" role="progressbar" aria-label={emailsRunning ? 'Sending Najaf emails' : 'Syncing to NKERP'} />
        )}

        <div className={`relative flex items-center h-[76px] shrink-0 ${collapsed ? 'justify-center' : 'pl-4 pr-2 justify-between'}`}>
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="min-w-0 rounded-lg cursor-pointer"
            aria-label="Go to overview"
            title={collapsed ? 'Faiz-e-Husaini · Overview' : undefined}
          >
            <FaizHusainiLogo size="md" showSubtitle={false} light stacked sealOnly={collapsed} />
          </button>
          {!collapsed && (
            <button type="button" onClick={toggleCollapsed} aria-label="Collapse navigation" title="Collapse navigation"
              className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-brand-200/70 hover:text-white hover:bg-white/[0.07] cursor-pointer">
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        <nav aria-label="Main" className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden app-scroll-x px-2.5 pb-3">
          {collapsed && (
            <button type="button" onClick={toggleCollapsed} aria-label="Expand navigation" title="Expand navigation"
              className="mb-2 w-full h-9 rounded-lg flex items-center justify-center text-brand-200/70 hover:text-white hover:bg-white/[0.07] cursor-pointer">
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.heading} className={gi ? 'mt-4' : ''}>
              {collapsed
                ? (gi > 0 && <div className="mx-3 mb-3 h-px bg-white/10" aria-hidden />)
                : <div className="px-3 pb-1.5 text-xs font-semibold text-brand-300/90">{group.heading}</div>}
              <ul className="space-y-0.5">
                {group.items.map(({ tab, label, icon: Icon }) => {
                  const active = activeTab === tab;
                  const spinning = tab === 'sync' && nkerpSync.running;
                  return (
                    <li key={tab}>
                      <button
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        aria-current={active ? 'page' : undefined}
                        aria-label={collapsed ? label : undefined}
                        title={collapsed ? label : undefined}
                        className={railItem(active)}
                      >
                        {active && (
                          <motion.span layoutId="rail-marker" transition={markerSpring} aria-hidden
                            className="absolute inset-0 rounded-lg bg-brand-700 ring-1 ring-inset ring-white/10" />
                        )}
                        <Icon className={`relative w-[18px] h-[18px] shrink-0 ${active ? 'text-gold-300' : 'text-brand-200/80 group-hover:text-white'} ${spinning ? 'animate-spin' : ''} ${tab === 'emails' && emailsRunning ? 'animate-pulse text-gold-300' : ''}`} strokeWidth={1.9} />
                        {!collapsed && <span className="relative flex-1 text-left truncate">{label}</span>}
                        {!collapsed && tab === 'rooms' && roomsCount ? (
                          <span className={`relative text-xs tabular-nums font-normal ${active ? 'text-brand-100' : 'text-brand-300/80'}`}>{roomsCount}</span>
                        ) : null}
                        {tab === 'sync' && syncBadge > 0 && (
                          <span className={`${collapsed ? 'absolute top-1 right-1.5' : 'relative'} min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-xs leading-5 text-center font-semibold tabular-nums`}>
                            {syncBadge}
                          </span>
                        )}
                        {!collapsed && active && tab !== 'rooms' && !(tab === 'sync' && syncBadge > 0) && (
                          <KhatamStar className="relative w-2.5 h-2.5 text-gold-400" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Utilities stay outside the scrolling list so their menus are never clipped. */}
        <div className="relative shrink-0 px-2.5 pt-3 pb-3 border-t border-white/10 space-y-0.5">
          <div className="pb-2">
            <SyncToNkerpButton sync={nkerpSync} onOpenSyncTab={() => setActiveTab('sync')} variant="rail" iconOnly={collapsed} />
          </div>
          <button type="button" className={railUtility} disabled={isPulling} onClick={onPullNkerp}
            title={collapsed ? `Pull from NKERP${lastPull ? ` · last pulled ${lastPull}` : ''}` : 'Read the latest zaereen, stays and rooms from NKERP'}
            aria-label={isPulling ? 'Pulling from NKERP' : 'Pull from NKERP'}>
            {isPulling
              ? <Loader2 className="w-[18px] h-[18px] shrink-0 animate-spin text-gold-300" />
              : <Download className={`w-[18px] h-[18px] shrink-0 ${pullFailed ? 'text-rose-300' : 'text-brand-200/80'}`} strokeWidth={1.9} />}
            {!collapsed && (
              <>
                <span className="flex-1 text-left truncate">{isPulling ? 'Pulling…' : 'Pull from NKERP'}</span>
                {lastPull && !isPulling && <span className={`text-xs font-normal tabular-nums ${pullFailed ? 'text-rose-300' : 'text-brand-300/80'}`}>{lastPull}</span>}
              </>
            )}
          </button>

          <Dropdown label="Print and export" placement="side" block
            trigger={(open) => (
              <span className={`${railUtility} ${open ? 'bg-white/[0.07] text-white' : ''}`} title={collapsed ? 'Print and export' : undefined}>
                <Printer className="w-[18px] h-[18px] shrink-0 text-brand-200/80" strokeWidth={1.9} />
                {!collapsed && <><span className="flex-1 text-left truncate">Print and export</span><ChevronRight className="w-4 h-4 text-brand-300/70" /></>}
              </span>
            )}
          >
            {printItems}
          </Dropdown>

          <Dropdown label="Account" placement="side" block
            trigger={(open) => (
              <span className={`mt-2 flex items-center gap-2.5 w-full rounded-lg ${collapsed ? 'justify-center h-11' : 'h-12 px-2'} ${open ? 'bg-white/[0.09]' : 'bg-white/[0.04] hover:bg-white/[0.08]'}`}
                title={collapsed ? (isReceptionist ? 'Receptionist · view only' : 'Admin · can edit') : undefined}>
                <span className="w-8 h-8 shrink-0 rounded-full bg-gold-200 text-brand-900 flex items-center justify-center">
                  {isReceptionist ? <Eye className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                </span>
                {!collapsed && (
                  <>
                    <span className="flex-1 min-w-0 text-left leading-tight">
                      <span className="block text-sm font-semibold text-white truncate">{isReceptionist ? 'Receptionist' : 'Admin'}</span>
                      <span className="block text-xs text-brand-200/80 truncate">{isReceptionist ? 'View only' : 'Can edit'}</span>
                    </span>
                    <ChevronsUpDown className="w-4 h-4 text-brand-300/70" />
                  </>
                )}
              </span>
            )}
          >
            {accountItems}
          </Dropdown>
        </div>
      </aside>

      {/* Phone and tablet top bar */}
      <header className="app-topbar lg:hidden sticky top-0 z-40 w-full bg-brand-900 text-white">
        {(nkerpSync.running || emailsRunning) && <div className="gold-thread" role="progressbar" aria-label={emailsRunning ? 'Sending Najaf emails' : 'Syncing to NKERP'} />}
        <div className="flex h-14 items-center gap-2 pl-3 pr-1.5">
          <button type="button" onClick={() => setActiveTab('dashboard')} className="min-w-0 rounded-lg cursor-pointer" aria-label="Go to overview">
            <FaizHusainiLogo size="sm" showSubtitle={false} light />
          </button>
          <div className="ml-auto flex items-center gap-1">
            <SyncToNkerpButton sync={nkerpSync} onOpenSyncTab={() => setActiveTab('sync')} variant="rail" compact />
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="w-11 h-11 rounded-lg text-brand-100 hover:bg-white/10 flex items-center justify-center cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Phone and tablet bottom navigation: four everyday screens and More */}
      <nav
        aria-label="Main"
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-stone-200 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid max-w-xl grid-cols-5 h-[60px]">
          {NAV_ITEMS.filter((n) => MOBILE_PRIMARY.includes(n.tab)).map(({ tab, short, icon: Icon }) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 text-xs cursor-pointer ${
                  active ? 'text-brand-700 font-semibold' : 'text-stone-500 font-medium'
                }`}
              >
                {active && <motion.span layoutId="nav-marker-mobile" transition={markerSpring} aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-gold-400" />}
                <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.1 : 1.8} />
                <span>{short}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isMobileMenuOpen}
            className={`relative flex flex-col items-center justify-center gap-1 text-xs cursor-pointer ${
              moreActive ? 'text-brand-700 font-semibold' : 'text-stone-500 font-medium'
            }`}
          >
            {moreActive && <motion.span layoutId="nav-marker-mobile" transition={markerSpring} aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-gold-400" />}
            <MoreHorizontal className={`w-[22px] h-[22px] ${nkerpSync.running ? 'animate-pulse' : ''}`} strokeWidth={moreActive ? 2.1 : 1.8} />
            <span>{moreActive ? NAV_ITEMS.find((n) => n.tab === activeTab)?.short : 'More'}</span>
            {syncBadge > 0 && (
              <span className="absolute top-1.5 left-1/2 ml-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[11px] leading-[18px] text-center font-semibold">
                {syncBadge}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* More: the other screens, printing, the NKERP pull and the account */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex justify-end bg-stone-950/45 animate-in fade-in duration-150"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Menu"
            className="w-[88%] max-w-sm h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pl-4 pr-1.5 h-14 bg-brand-900 shrink-0">
              <FaizHusainiLogo size="sm" showSubtitle={false} light />
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-11 h-11 rounded-lg flex items-center justify-center text-brand-100 hover:bg-white/10 cursor-pointer"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 pb-10">
              {NAV_GROUPS.map((group) => (
                <div key={group.heading}>
                  <MenuHeading>{group.heading}</MenuHeading>
                  {group.items.map(({ tab, label, icon: Icon }) => {
                    const active = activeTab === tab;
                    return (
                      <button key={tab} type="button" aria-current={active ? 'page' : undefined}
                        onClick={() => { setIsMobileMenuOpen(false); setActiveTab(tab); }}
                        className={`w-full flex items-center gap-3 h-12 rounded-lg px-2.5 text-[15px] cursor-pointer ${
                          active ? 'bg-brand-50 text-brand-800 font-semibold' : 'text-stone-800 font-medium hover:bg-stone-100'}`}>
                        <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-brand-600' : 'text-stone-500'}`} strokeWidth={1.9} />
                        <span className="flex-1 text-left">{label}</span>
                        {tab === 'sync' && syncBadge > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-xs leading-5 text-center font-semibold tabular-nums">{syncBadge}</span>
                        )}
                        {active && <KhatamStar className="w-2.5 h-2.5 text-gold-500" />}
                      </button>
                    );
                  })}
                </div>
              ))}
              <MenuDivider />
              <MenuHeading>NKERP data</MenuHeading>
              <MenuItem icon={Download} disabled={isPulling} onClick={() => { setIsMobileMenuOpen(false); onPullNkerp(); }}
                hint={lastPull ? `Last pulled ${lastPull}` : undefined}>
                {isPulling ? 'Pulling…' : 'Pull from NKERP'}
              </MenuItem>
              <MenuDivider />
              <MenuHeading>Print</MenuHeading>
              {printItems(() => setIsMobileMenuOpen(false))}
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
