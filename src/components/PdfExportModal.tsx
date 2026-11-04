import React, { useState, useMemo, useEffect } from 'react';
import { 
  FileText, 
  Download, 
  CheckSquare, 
  Filter, 
  Building2, 
  Calendar, 
  ArrowUpRight, 
  ShieldCheck,
  X,
  Search,
  Users,
  Star,
  BedDouble,
  Clock,
  Printer,
  ChevronRight,
  Info,
  CheckCircle2
} from 'lucide-react';
import { Reservation, Room } from '../types';
import { generateAdministrativePdf, PdfExportOptions } from '../services/pdfExport';
import { normalizeDate } from '../services/excelService';

export interface PdfExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: Reservation[];
  rooms: Room[];
  initialReportType?: PdfExportOptions['reportType'];
  initialTourId?: string;
}

export const PdfExportModal: React.FC<PdfExportModalProps> = ({
  isOpen,
  onClose,
  reservations = [],
  rooms = [],
  initialReportType,
  initialTourId,
}) => {
  if (!isOpen) return null;

  const [reportType, setReportType] = useState<PdfExportOptions['reportType']>(
    initialReportType || 'all_reservations'
  );
  const [tourIdFilter, setTourIdFilter] = useState<string>(initialTourId || 'ALL');
  const [buildingFilter, setBuildingFilter] = useState<string>('ALL');
  const [arrivalDateFilter, setArrivalDateFilter] = useState<string>('ALL');
  const [includeSignatures, setIncludeSignatures] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Search state for Tour ID
  const [tourSearchQuery, setTourSearchQuery] = useState<string>('');
  // Search state for Pax within Tour manifest
  const [paxSearchQuery, setPaxSearchQuery] = useState<string>('');

  // If initialTourId provided, set filter
  useEffect(() => {
    if (initialTourId) {
      setTourIdFilter(initialTourId);
    }
  }, [initialTourId]);

  useEffect(() => {
    if (initialReportType) {
      setReportType(initialReportType);
    }
  }, [initialReportType]);

  // Rich summaries of all Tour IDs for fast searching & metadata display
  const tourSummaries = useMemo(() => {
    const map = new Map<string, {
      tourId: string;
      totalPax: number;
      familiesSet: Set<string>;
      arrivalDatesSet: Set<string>;
      departureDatesSet: Set<string>;
      officesSet: Set<string>;
      specialCount: number;
      allottedCount: number;
      earliestArrival: string;
      latestDeparture: string;
    }>();

    reservations.forEach((r) => {
      const tid = (r.tourRefNo || r.tourId || '').trim();
      if (!tid) return;

      if (!map.has(tid)) {
        map.set(tid, {
          tourId: tid,
          totalPax: 0,
          familiesSet: new Set(),
          arrivalDatesSet: new Set(),
          departureDatesSet: new Set(),
          officesSet: new Set(),
          specialCount: 0,
          allottedCount: 0,
          earliestArrival: '',
          latestDeparture: '',
        });
      }

      const item = map.get(tid)!;
      item.totalPax += 1;
      if (r.family) item.familiesSet.add(r.family.trim());
      if (r.officeName) item.officesSet.add(r.officeName.trim());
      if (r.isSpecialGuest) item.specialCount += 1;
      if (r.roomNumber && r.roomNumber.trim()) item.allottedCount += 1;

      const arr = (r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr || '').slice(0, 10);
      if (arr) {
        item.arrivalDatesSet.add(arr);
        if (!item.earliestArrival || arr < item.earliestArrival) item.earliestArrival = arr;
      }

      const dep = (r.departureDate || r.departureDateTime || r.rawDepartureStr || '').slice(0, 10);
      if (dep) {
        item.departureDatesSet.add(dep);
        if (!item.latestDeparture || dep > item.latestDeparture) item.latestDeparture = dep;
      }
    });

    return Array.from(map.values()).sort((a, b) => a.tourId.localeCompare(b.tourId, undefined, { numeric: true }));
  }, [reservations]);

  // Unique Tour IDs list
  const uniqueTourIds = useMemo(() => tourSummaries.map((t) => t.tourId), [tourSummaries]);

  // Filtered Tour IDs based on tourSearchQuery
  const filteredTourSummaries = useMemo(() => {
    const q = tourSearchQuery.trim().toLowerCase();
    if (!q) return tourSummaries;
    return tourSummaries.filter((t) => {
      if (t.tourId.toLowerCase().includes(q)) return true;
      const officeStr = Array.from(t.officesSet).join(' ').toLowerCase();
      if (officeStr.includes(q)) return true;
      return false;
    });
  }, [tourSummaries, tourSearchQuery]);

  // Unique arrival dates with count of arriving guests
  const uniqueArrivalDates = useMemo(() => {
    const datesMap = new Map<string, number>();
    reservations.forEach((r) => {
      const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      if (arr) {
        datesMap.set(arr, (datesMap.get(arr) || 0) + 1);
      }
    });
    return Array.from(datesMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [reservations]);

  // All reservations for the currently selected Tour ID
  const selectedTourReservations = useMemo(() => {
    if (tourIdFilter === 'ALL') {
      return reservations;
    }
    return reservations.filter(
      (r) => (r.tourRefNo || r.tourId || '').trim() === tourIdFilter.trim()
    );
  }, [reservations, tourIdFilter]);

  // Filtered reservations for the in-modal Pax Manifest viewer
  const displayedPaxManifest = useMemo(() => {
    let list = selectedTourReservations;
    if (buildingFilter !== 'ALL') {
      list = list.filter((r) => (r.building || '').toLowerCase().includes(buildingFilter.toLowerCase()));
    }
    if (arrivalDateFilter !== 'ALL') {
      list = list.filter((r) => normalizeDate(r.arrivalDate || r.rawArrivalStr) === arrivalDateFilter);
    }
    const q = paxSearchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const name = (r.applicantName || r.groupLeadName || '').toLowerCase();
        const its = (r.itsId || '').toLowerCase();
        const fam = (r.family || '').toLowerCase();
        const rm = (r.roomNumber || '').toLowerCase();
        return name.includes(q) || its.includes(q) || fam.includes(q) || rm.includes(q);
      });
    }

    // Sort by Family number, then by Room number, then applicant name
    return [...list].sort((a, b) => {
      const famA = (a.family || '').trim();
      const famB = (b.family || '').trim();
      const famCmp = famA.localeCompare(famB, undefined, { numeric: true });
      if (famCmp !== 0) return famCmp;
      const numA = parseInt((a.roomNumber || '').replace(/\D/g, ''), 10) || 9999;
      const numB = parseInt((b.roomNumber || '').replace(/\D/g, ''), 10) || 9999;
      if (numA !== numB) return numA - numB;
      return (a.applicantName || '').localeCompare(b.applicantName || '');
    });
  }, [selectedTourReservations, buildingFilter, arrivalDateFilter, paxSearchQuery]);

  // Metadata summary of selected tour
  const currentTourSummary = useMemo(() => {
    return tourSummaries.find((t) => t.tourId === tourIdFilter);
  }, [tourSummaries, tourIdFilter]);

  const handleExport = (overrideBuilding?: string) => {
    setIsGenerating(true);
    const finalBuilding = overrideBuilding || buildingFilter;
    try {
      generateAdministrativePdf(reservations, rooms, {
        reportType,
        tourIdFilter,
        buildingFilter: finalBuilding,
        arrivalDateFilter,
        includeSignatures,
      });
      setTimeout(() => {
        setIsGenerating(false);
        onClose();
      }, 600);
    } catch (e) {
      console.error('PDF export error', e);
      setIsGenerating(false);
    }
  };

  const isTourManifest = reportType === 'tour_manifest';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className={`bg-slate-900 border border-slate-800 rounded-2xl w-full p-4 sm:p-6 shadow-2xl relative text-xs my-auto transition-all ${
        isTourManifest ? 'max-w-5xl max-h-[92vh] flex flex-col' : 'max-w-xl'
      }`}>
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer z-10"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-2 mb-1 text-amber-400 shrink-0">
          <FileText className="w-5 h-5 text-amber-400" />
          <h3 className="text-base font-bold text-white tracking-tight">
            Administrative PDF Manifest & Documentation
          </h3>
        </div>
        <p className="text-slate-400 mb-4 shrink-0 text-[11px]">
          Generate formal PDF reports for coordinators, bus guides, front-desk records, and security desk manifests.
        </p>

        {/* Main Body */}
        <div className={`space-y-4 ${isTourManifest ? 'overflow-y-auto pr-1' : ''}`}>
          {/* Report Type Selector */}
          <div>
            <label className="block text-slate-300 font-bold mb-2">
              Select Report Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Option 1: Tour ID Specific Lodging Manifest (User Request Focus) */}
              <label
                onClick={() => setReportType('tour_manifest')}
                className={`p-3 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${
                  reportType === 'tour_manifest'
                    ? 'bg-amber-950/40 border-amber-500 text-amber-200 ring-1 ring-amber-500/50'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  checked={reportType === 'tour_manifest'}
                  onChange={() => setReportType('tour_manifest')}
                  className="mt-0.5 text-amber-500 accent-amber-500"
                />
                <div>
                  <div className="font-bold text-white text-xs flex items-center gap-1.5">
                    <span>Tour ID Specific Lodging Manifest</span>
                    <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                      Pax Names Included
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Search and filter by Tour ID. Full manifest with <strong>every pax name</strong>, ITS ID, family #, room allotment & timings.
                  </div>
                </div>
              </label>

              {/* Option 2: All Reservations Manifest */}
              <label
                onClick={() => setReportType('all_reservations')}
                className={`p-3 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${
                  reportType === 'all_reservations'
                    ? 'bg-amber-950/40 border-amber-500 text-amber-200 ring-1 ring-amber-500/50'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  checked={reportType === 'all_reservations'}
                  onChange={() => setReportType('all_reservations')}
                  className="mt-0.5 text-amber-500 accent-amber-500"
                />
                <div>
                  <div className="font-bold text-white text-xs">
                    Comprehensive All Zaereen Manifest
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Full system roster across all tours with Zaereen names, assigned rooms, buildings, and arrival/departure dates.
                  </div>
                </div>
              </label>

              {/* Option 3: Category Upgrades */}
              <label
                onClick={() => setReportType('category_upgrades')}
                className={`p-3 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${
                  reportType === 'category_upgrades'
                    ? 'bg-amber-950/40 border-amber-500 text-amber-200 ring-1 ring-amber-500/50'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  checked={reportType === 'category_upgrades'}
                  onChange={() => setReportType('category_upgrades')}
                  className="mt-0.5 text-amber-500 accent-amber-500"
                />
                <div>
                  <div className="font-bold text-amber-400 text-xs flex items-center gap-1">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span>Category B ➔ A (Nizaam) Upgrades Audit</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Ledger of guests shifted from standard to Nizaam with surcharge & payment records.
                  </div>
                </div>
              </label>

              {/* Option 4: Room Inventory */}
              <label
                onClick={() => setReportType('rooms_inventory')}
                className={`p-3 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${
                  reportType === 'rooms_inventory'
                    ? 'bg-amber-950/40 border-amber-500 text-amber-200 ring-1 ring-amber-500/50'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  checked={reportType === 'rooms_inventory'}
                  onChange={() => setReportType('rooms_inventory')}
                  className="mt-0.5 text-amber-500 accent-amber-500"
                />
                <div>
                  <div className="font-bold text-white text-xs">
                    Room Inventory & Blocked Rooms Audit
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Complete 114 rooms listing across Saifee and Burhani with blocked reasons.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* TOUR ID SEARCH & SELECTION (User Request: "I also want to able to search the tour ID") */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-amber-500/30 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-amber-300 font-bold flex items-center gap-1.5 text-xs">
                <Search className="w-3.5 h-3.5 text-amber-400" />
                <span>Search Tour ID {isTourManifest ? '(Required for Specific Manifest)' : '(Optional Filter)'}</span>
              </label>

              {tourIdFilter !== 'ALL' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono font-bold border border-amber-500/40">
                    Active Tour: {tourIdFilter}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTourIdFilter('ALL');
                      setTourSearchQuery('');
                    }}
                    className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
                  >
                    Reset to All
                  </button>
                </div>
              )}
            </div>

            {/* Interactive Tour ID Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={tourSearchQuery}
                onChange={(e) => setTourSearchQuery(e.target.value)}
                placeholder="Type to search Tour ID (e.g. 1333, NKERP, VIP, Mumbai)..."
                className="w-full bg-slate-900 text-white pl-9 pr-8 py-2 rounded-xl border border-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-slate-500 font-mono"
              />
              {tourSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTourSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white p-0.5 cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Tour Selection Matching Pills / Cards */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Matching Tours ({filteredTourSummaries.length}):</span>
                {uniqueTourIds.length > 0 && (
                  <span>Total {uniqueTourIds.length} Tours in System</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 max-h-36 overflow-y-auto p-1 bg-slate-900/60 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setTourIdFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    tourIdFilter === 'ALL'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  All Tours ({reservations.length} Zaereen)
                </button>

                {filteredTourSummaries.slice(0, 15).map((t) => {
                  const isSelected = tourIdFilter === t.tourId;
                  return (
                    <button
                      key={t.tourId}
                      type="button"
                      onClick={() => setTourIdFilter(t.tourId)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer border ${
                        isSelected
                          ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 border-amber-400 shadow-md font-black'
                          : 'bg-slate-800/90 text-slate-200 border-slate-700 hover:border-amber-500/60 hover:bg-slate-800'
                      }`}
                      title={`Tour ${t.tourId}: ${t.totalPax} Zaereen across ${t.familiesSet.size} families`}
                    >
                      <span>{t.tourId}</span>
                      <span className={`text-[10px] font-sans font-semibold px-1 rounded ${
                        isSelected ? 'bg-amber-950/20 text-slate-950' : 'bg-slate-700 text-amber-300'
                      }`}>
                        {t.totalPax}p
                      </span>
                      {t.specialCount > 0 && (
                        <span className="text-[10px] text-amber-300 flex items-center font-bold" title={`${t.specialCount} Special Guest(s)`}>
                          ★{t.specialCount}
                        </span>
                      )}
                    </button>
                  );
                })}

                {filteredTourSummaries.length === 0 && (
                  <div className="py-2 px-3 text-amber-300/80 text-xs italic">
                    No tours found matching "{tourSearchQuery}". Try clearing search.
                  </div>
                )}
              </div>
            </div>

            {/* Dropdown Selector Fallback */}
            <div className="pt-1 flex items-center gap-2">
              <span className="text-[11px] text-slate-400 shrink-0">Or choose from list:</span>
              <select
                value={tourIdFilter}
                onChange={(e) => setTourIdFilter(e.target.value)}
                className="w-full bg-slate-900 text-white px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono cursor-pointer"
              >
                <option value="ALL">All Tours ({reservations.length} Zaereen)</option>
                {uniqueTourIds.map((tid) => {
                  const sum = tourSummaries.find((s) => s.tourId === tid);
                  return (
                    <option key={tid} value={tid}>
                      {tid} — {sum?.totalPax || 0} Zaereen ({sum?.familiesSet.size || 0} Families • Arr: {sum?.earliestArrival || '—'})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* LIVE IN-MODAL PAX LODGING MANIFEST TABLE (User Request: "I want names of pax too") */}
          {isTourManifest && (
            <div className="bg-slate-950 p-3.5 rounded-xl border border-emerald-600/40 space-y-3 animate-in fade-in">
              {/* Manifest Header & Stats Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-emerald-400" />
                      <span>Tour Manifest Pax Roster:</span>
                    </span>
                    <span className="font-mono font-black text-xs text-white bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                      {tourIdFilter === 'ALL' ? 'All Tours' : `Tour ID: ${tourIdFilter}`}
                    </span>
                    {currentTourSummary && (
                      <span className="text-[11px] text-slate-300">
                        {currentTourSummary.totalPax} Zaereen • {currentTourSummary.familiesSet.size} Families • Arr: {currentTourSummary.earliestArrival || '—'} ➔ Dep: {currentTourSummary.latestDeparture || '—'}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Below are the individual <strong>names of all pax</strong>, ITS IDs, family numbers, room allocations & flight timings.
                  </p>
                </div>

                {/* Filter within Pax Names */}
                <div className="relative w-full sm:w-64 shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2 pointer-events-none" />
                  <input
                    type="text"
                    value={paxSearchQuery}
                    onChange={(e) => setPaxSearchQuery(e.target.value)}
                    placeholder="Filter pax by name or ITS..."
                    className="w-full bg-slate-900 text-white pl-8 pr-7 py-1.5 rounded-lg border border-slate-700 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-500"
                  />
                  {paxSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setPaxSearchQuery('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Pax Table */}
              <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-900 text-slate-300 font-bold border-b border-slate-800 text-[11px] shadow-xs">
                    <tr>
                      <th className="py-2 px-2.5 w-10 text-center">#</th>
                      <th className="py-2 px-3">Pax / Zair Full Name</th>
                      <th className="py-2 px-2.5 text-center">Fam #</th>
                      <th className="py-2 px-3">Room & Hotel</th>
                      <th className="py-2 px-3">Arrival Date & Time</th>
                      <th className="py-2 px-3">Departure Date & Time</th>
                      <th className="py-2 px-2.5">Category</th>
                      <th className="py-2 px-3">Special / Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-950/70">
                    {displayedPaxManifest.length > 0 ? (
                      displayedPaxManifest.map((res, idx) => {
                        const isAllotted = !!res.roomNumber && res.roomNumber.trim() !== '';
                        return (
                          <tr key={res.id || idx} className="hover:bg-slate-900/60 transition">
                            <td className="py-2 px-2.5 text-center font-mono text-slate-400 text-[11px]">
                              {idx + 1}
                            </td>
                            {/* PAX NAME (Prominently displayed) */}
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {res.isSpecialGuest && (
                                  <span className="p-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40" title="Special Guest">
                                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                  </span>
                                )}
                                <span className={`font-bold ${res.isSpecialGuest ? 'text-amber-300 font-black' : 'text-white'}`}>
                                  {res.applicantName || res.groupLeadName || 'Guest'}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5 font-mono">
                                {res.itsId && <span>ITS: {res.itsId}</span>}
                                {res.gender && <span>• {res.gender}</span>}
                                {res.age && <span>• Age {res.age}</span>}
                              </div>
                            </td>

                            {/* FAMILY NUMBER */}
                            <td className="py-2 px-2.5 text-center font-mono text-amber-300 font-bold">
                              {res.family || '—'}
                            </td>

                            {/* ROOM & BUILDING */}
                            <td className="py-2 px-3">
                              {isAllotted ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-bold text-[11px]">
                                  <BedDouble className="w-3 h-3 text-emerald-400" />
                                  <span>{res.building || 'Hotel'} Rm {res.roomNumber}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-950/70 text-rose-300 border border-rose-800 font-semibold text-[11px]">
                                  Unallotted
                                </span>
                              )}
                            </td>

                            {/* ARRIVAL */}
                            <td className="py-2 px-3 font-mono text-slate-200">
                              <div>{res.arrivalDate || '—'}</div>
                              {res.arrivalTime && (
                                <div className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  <span>{res.arrivalTime}</span>
                                </div>
                              )}
                            </td>

                            {/* DEPARTURE */}
                            <td className="py-2 px-3 font-mono text-slate-200">
                              <div>{res.departureDate || '—'}</div>
                              {res.departureTime && (
                                <div className="text-[10px] text-amber-400 flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  <span>{res.departureTime}</span>
                                </div>
                              )}
                            </td>

                            {/* CATEGORY */}
                            <td className="py-2 px-2.5 text-slate-300">
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-medium border border-slate-700">
                                {res.category || 'Standard'}
                              </span>
                            </td>

                            {/* SPECIAL / REMARKS */}
                            <td className="py-2 px-3 text-[11px]">
                              {res.isSpecialGuest ? (
                                <div className="text-amber-300 font-bold bg-amber-950/40 p-1 rounded border border-amber-500/30">
                                  ★ {res.specialRemarks || 'Special Guest'}
                                </div>
                              ) : res.remarks || res.notes ? (
                                <span className="text-slate-400 italic">
                                  {res.remarks || res.notes}
                                </span>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-400 text-xs">
                          {paxSearchQuery
                            ? `No zaereen found matching "${paxSearchQuery}" in this tour.`
                            : 'No zaereen found for the selected Tour ID.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                <span>
                  Showing {displayedPaxManifest.length} of {selectedTourReservations.length} Zaereen in manifest
                </span>
                <span className="text-emerald-400 font-medium">
                  ✓ All Pax Names, ITS & room allotments will be exported in the PDF
                </span>
              </div>
            </div>
          )}

          {/* Secondary Filters: Hotel Building & Arrival Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* Hotel Filter */}
            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between text-xs">
                <span>Hotel / Building Filter</span>
                <span className="text-[10px] text-amber-400 font-mono">
                  {buildingFilter === 'ALL' ? 'Both Hotels' : `${buildingFilter} Hotel`}
                </span>
              </label>
              <select
                value={buildingFilter}
                onChange={(e) => setBuildingFilter(e.target.value)}
                className="w-full bg-slate-900 text-white px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Hotels (Saifee & Burhani)</option>
                <option value="Saifee">Saifee Hotel (70 Rooms)</option>
                <option value="Burhani">Burhani Hotel (44 Rooms)</option>
              </select>
            </div>

            {/* Arrival Date Filter */}
            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between text-xs">
                <span>Filter by Arrival Date</span>
                {arrivalDateFilter !== 'ALL' && (
                  <span className="text-[10px] text-amber-400 font-mono">
                    {arrivalDateFilter}
                  </span>
                )}
              </label>
              <select
                value={arrivalDateFilter}
                onChange={(e) => setArrivalDateFilter(e.target.value)}
                className="w-full bg-slate-900 text-white px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Arrival Dates</option>
                {uniqueArrivalDates.map(({ date, count }) => (
                  <option key={date} value={date}>
                    {date} ({count} Zaereen)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Signature Box Checkbox */}
          <div className="flex items-center gap-2 pt-0.5">
            <input
              type="checkbox"
              id="sigCheck"
              checked={includeSignatures}
              onChange={(e) => setIncludeSignatures(e.target.checked)}
              className="w-4 h-4 text-amber-500 rounded border-slate-700 cursor-pointer accent-amber-500"
            />
            <label htmlFor="sigCheck" className="text-slate-300 text-xs cursor-pointer">
              Include Official Administrative Signatures & Stamp block in PDF footer
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-4 mt-4 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="text-slate-400 text-[11px]">
            {isTourManifest && tourIdFilter !== 'ALL' ? (
              <span className="text-amber-300 font-medium">
                Tour: <strong className="font-mono text-white">{tourIdFilter}</strong> ({selectedTourReservations.length} Pax with Names)
              </span>
            ) : (
              <span>Full Manifest ({buildingFilter === 'ALL' ? 'Both Hotels' : `${buildingFilter} Hotel`})</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition cursor-pointer text-xs"
            >
              Cancel
            </button>

            {/* Quick Saifee Only */}
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => handleExport('Saifee')}
              className="px-3 py-2 bg-slate-800 hover:bg-emerald-950 text-emerald-300 border border-emerald-700/60 rounded-xl font-semibold text-xs transition cursor-pointer"
              title="Download only Saifee Hotel records"
            >
              Saifee Only
            </button>

            {/* Quick Burhani Only */}
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => handleExport('Burhani')}
              className="px-3 py-2 bg-slate-800 hover:bg-emerald-950 text-emerald-300 border border-emerald-700/60 rounded-xl font-semibold text-xs transition cursor-pointer"
              title="Download only Burhani Hotel records"
            >
              Burhani Only
            </button>

            {/* Main Download Button */}
            <button
              onClick={() => handleExport()}
              disabled={isGenerating}
              className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-amber-600 hover:from-emerald-500 hover:to-amber-500 text-white rounded-xl font-bold flex items-center gap-2 transition shadow-lg shadow-emerald-950/40 disabled:opacity-50 cursor-pointer text-xs"
            >
              <Download className="w-4 h-4 text-amber-200" />
              <span>
                {isGenerating
                  ? 'Generating PDF...'
                  : isTourManifest
                  ? `Download Tour Manifest PDF (${tourIdFilter !== 'ALL' ? tourIdFilter : 'All Tours'})`
                  : `Download PDF Manifest (${buildingFilter === 'ALL' ? 'Joined' : buildingFilter})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
