import React, { useState, useMemo, useEffect } from 'react';
import { Download, Search, Star, X } from 'lucide-react';
import { Reservation, Room } from '../types';
import { generateAdministrativePdf, PdfExportOptions } from '../services/pdfExport';
import { normalizeDate } from '../services/excelService';
import { getDistinctBuildings, normalizeBuildingName } from '../services/storage';
import {
  btn, btnSm, chip, field, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle, panel,
} from './ui';

/** Compact buttons grow to the 40px touch size on phones. */
const tap = (cls: string) => `${cls} max-sm:h-10 max-sm:px-3.5`;
/** A field with room for a search icon on the left and a clear button on the right. */
const searchField = field.replace('px-3', 'pl-9 pr-9');

/** A yyyy-mm-dd date as "28 Nov 2026" on screen (shown only; filter values and the PDF keep the stored date). */
function shownDate(value: string | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const REPORTS: { value: PdfExportOptions['reportType']; title: string; detail: string }[] = [
  { value: 'tour_manifest', title: 'Tour ID lodging manifest', detail: 'Search and filter by Tour ID. Every zair’s name, ITS, family, room allotment and timings.' },
  { value: 'all_reservations', title: 'All zaereen manifest', detail: 'Full roster across all tours with zaereen names, assigned rooms, buildings, and arrival and departure dates.' },
  { value: 'category_upgrades', title: 'Category B→A (Nizaam) upgrades audit', detail: 'Ledger of guests shifted from standard to Nizaam, with surcharge and payment records.' },
  { value: 'rooms_inventory', title: 'Room inventory and blocked rooms audit', detail: 'Every room by building, with blocked reasons.' },
];

export interface PdfExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: Reservation[];
  rooms: Room[];
  initialReportType?: PdfExportOptions['reportType'];
  initialTourId?: string;
  /** Receptionist access: only the tour manifest, to view and print. */
  manifestOnly?: boolean;
}

export const PdfExportModal: React.FC<PdfExportModalProps> = ({
  isOpen,
  onClose,
  reservations = [],
  rooms = [],
  initialReportType,
  initialTourId,
  manifestOnly = false,
}) => {
  if (!isOpen) return null;

  const [reportTypeState, setReportType] = useState<PdfExportOptions['reportType']>(
    initialReportType || 'all_reservations'
  );
  const reportType: PdfExportOptions['reportType'] = manifestOnly ? 'tour_manifest' : reportTypeState;
  const reports = manifestOnly ? REPORTS.filter((r) => r.value === 'tour_manifest') : REPORTS;
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

  const buildings = getDistinctBuildings(rooms);
  const buildingText = buildingFilter === 'ALL' ? 'all buildings' : buildingFilter;

  return (
    <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="pdf-export-title">
      <div className={`${modalCard} ${isTourManifest ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h3 id="pdf-export-title" className={modalTitle}>{manifestOnly ? 'Tour manifest' : 'Export PDF reports'}</h3>
            <p className="mt-1 text-sm text-stone-600">
              {manifestOnly
                ? 'Pick a Tour ID to view and print its lodging manifest.'
                : 'Formal PDF reports for coordinators, bus guides, front-desk records and security desk manifests.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-6">
          {/* Which report */}
          {!manifestOnly && <fieldset>
            <legend className={fieldLabel}>Report type</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {reports.map(({ value, title, detail }) => {
                const on = reportType === value;
                return (
                  <label key={value}
                    className={`flex items-start gap-3 rounded-xl px-3.5 py-3 cursor-pointer transition ring-inset ${
                      on ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-1 ring-stone-300 hover:ring-stone-400'}`}>
                    <input
                      type="radio"
                      name="reportType"
                      checked={on}
                      onChange={() => setReportType(value)}
                      className="mt-0.5 w-4 h-4 shrink-0 accent-brand-700"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-stone-950">{title}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-stone-600">{detail}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>}

          {/* Tour ID: search, pick from the matches, or choose from the list */}
          <div>
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 mb-1.5">
              <label htmlFor="pdf-tour-search" className="text-[13px] font-medium text-stone-700">
                Tour ID <span className="font-normal text-stone-500">{isTourManifest ? '(pick one for the tour manifest)' : '(optional filter)'}</span>
              </label>
              {tourIdFilter !== 'ALL' && (
                <span className="flex items-center gap-2 text-[13px] text-stone-600">
                  <span>Active tour <span className="font-semibold text-stone-950 tabular-nums">{tourIdFilter}</span></span>
                  <button
                    type="button"
                    onClick={() => {
                      setTourIdFilter('ALL');
                      setTourSearchQuery('');
                    }}
                    className={tap(btnSm.ghost)}
                  >
                    Reset to all
                  </button>
                </span>
              )}
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3 pointer-events-none" />
              <input
                id="pdf-tour-search"
                type="text"
                value={tourSearchQuery}
                onChange={(e) => setTourSearchQuery(e.target.value)}
                placeholder="Search by Tour ID or office (e.g. 1333, Mumbai)"
                className={searchField}
              />
              {tourSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTourSearchQuery('')}
                  className="absolute right-1 top-1 w-8 h-8 rounded-md flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 text-[13px] text-stone-600 tabular-nums">
              <span>Matching tours ({filteredTourSummaries.length})</span>
              {uniqueTourIds.length > 0 && <span>{uniqueTourIds.length} tours in all</span>}
            </div>
            <div className={`${panel} mt-1.5 flex flex-wrap items-center gap-2 max-h-36 overflow-y-auto p-2`}>
              <button
                type="button"
                onClick={() => setTourIdFilter('ALL')}
                aria-pressed={tourIdFilter === 'ALL'}
                className={tap(tourIdFilter === 'ALL' ? btnSm.primary : btnSm.secondary)}
              >
                All tours
                <span className={`font-normal tabular-nums ${tourIdFilter === 'ALL' ? 'text-white/80' : 'text-stone-500'}`}>{reservations.length} zaereen</span>
              </button>

              {filteredTourSummaries.slice(0, 15).map((t) => {
                const isSelected = tourIdFilter === t.tourId;
                return (
                  <button
                    key={t.tourId}
                    type="button"
                    onClick={() => setTourIdFilter(t.tourId)}
                    aria-pressed={isSelected}
                    className={`${tap(isSelected ? btnSm.primary : btnSm.secondary)} tabular-nums`}
                    title={`Tour ${t.tourId}: ${t.totalPax} Zaereen across ${t.familiesSet.size} families`}
                  >
                    {t.tourId}
                    <span className={`font-normal ${isSelected ? 'text-white/80' : 'text-stone-500'}`}>{t.totalPax}</span>
                    {t.specialCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 font-normal" title={`${t.specialCount} Special Guest(s)`}>
                        <Star className="w-3 h-3 fill-gold-400 text-gold-500" />{t.specialCount}
                      </span>
                    )}
                  </button>
                );
              })}

              {filteredTourSummaries.length === 0 && (
                <div className="px-2 py-1.5 text-[13px] text-stone-600">
                  No tours match "{tourSearchQuery}". Try clearing the search.
                </div>
              )}
            </div>

            <div className="mt-3">
              <label htmlFor="pdf-tour-select" className={fieldLabel}>Or choose from the list</label>
              <select
                id="pdf-tour-select"
                value={tourIdFilter}
                onChange={(e) => setTourIdFilter(e.target.value)}
                className={`${field} cursor-pointer tabular-nums`}
              >
                <option value="ALL">All tours ({reservations.length} zaereen)</option>
                {uniqueTourIds.map((tid) => {
                  const sum = tourSummaries.find((s) => s.tourId === tid);
                  return (
                    <option key={tid} value={tid}>
                      {tid} — {sum?.totalPax || 0} zaereen ({sum?.familiesSet.size || 0} families · arrives {shownDate(sum?.earliestArrival) || '—'})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* The roster the tour manifest will carry */}
          {isTourManifest && (
            <div className="animate-in fade-in">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h4 className="text-[15px] font-semibold text-stone-950">
                    Tour manifest roster: <span className="tabular-nums">{tourIdFilter === 'ALL' ? 'all tours' : `Tour ID ${tourIdFilter}`}</span>
                  </h4>
                  {currentTourSummary && (
                    <p className="mt-0.5 text-[13px] text-stone-600 tabular-nums">
                      {currentTourSummary.totalPax} zaereen · {currentTourSummary.familiesSet.size} families · arrives {shownDate(currentTourSummary.earliestArrival) || '—'} · departs {shownDate(currentTourSummary.latestDeparture) || '—'}
                    </p>
                  )}
                  <p className="mt-0.5 text-[13px] text-stone-500">
                    Every zair by name, with ITS, family number, room allotment and timings.
                  </p>
                </div>

                <div className="relative w-full sm:w-64 shrink-0">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="text"
                    value={paxSearchQuery}
                    onChange={(e) => setPaxSearchQuery(e.target.value)}
                    placeholder="Filter by name or ITS"
                    aria-label="Filter the roster by name or ITS"
                    className={searchField}
                  />
                  {paxSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setPaxSearchQuery('')}
                      className="absolute right-1 top-1 w-8 h-8 rounded-md flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer"
                      aria-label="Clear filter"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-auto max-h-72 rounded-xl ring-1 ring-inset ring-stone-200">
                <table className="w-full text-left text-[13px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-stone-50 text-xs text-stone-600">
                    <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-semibold [&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-stone-200">
                      <th scope="col" className="w-10 text-right">#</th>
                      <th scope="col">Zair</th>
                      <th scope="col">Family</th>
                      <th scope="col">Room</th>
                      <th scope="col">Arrival</th>
                      <th scope="col">Departure</th>
                      <th scope="col">Category</th>
                      <th scope="col">Special / remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {displayedPaxManifest.length > 0 ? (
                      displayedPaxManifest.map((res, idx) => {
                        const isAllotted = !!res.roomNumber && res.roomNumber.trim() !== '';
                        return (
                          <tr key={res.id || idx} className="hover:bg-stone-50 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-top">
                            <td className="text-right text-stone-500 tabular-nums">{idx + 1}</td>
                            <td className="min-w-[11rem]">
                              <div className="flex items-center gap-1.5 font-semibold text-stone-950">
                                {res.isSpecialGuest && <Star className="w-3.5 h-3.5 shrink-0 fill-gold-400 text-gold-500" aria-label="Special guest" />}
                                <span>{res.applicantName || res.groupLeadName || 'Guest'}</span>
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500 tabular-nums">
                                {res.itsId && <span>ITS {res.itsId}</span>}
                                {res.gender && <span>{res.gender}</span>}
                                {res.age && <span>Age {res.age}</span>}
                              </div>
                            </td>
                            <td className="text-stone-800 tabular-nums whitespace-nowrap">{res.family || '—'}</td>
                            <td className="whitespace-nowrap">
                              {isAllotted
                                ? <span className="font-semibold text-stone-950 tabular-nums">{res.building || 'Hotel'} {res.roomNumber}</span>
                                : <span className={chip('wait')}>Unallotted</span>}
                            </td>
                            <td className="whitespace-nowrap tabular-nums">
                              <div className="text-stone-900">{shownDate(res.arrivalDate) || '—'}</div>
                              {res.arrivalTime && <div className="text-xs text-stone-500">{res.arrivalTime}</div>}
                            </td>
                            <td className="whitespace-nowrap tabular-nums">
                              <div className="text-stone-900">{shownDate(res.departureDate) || '—'}</div>
                              {res.departureTime && <div className="text-xs text-stone-500">{res.departureTime}</div>}
                            </td>
                            <td className="text-stone-700 whitespace-nowrap">{res.category || 'Standard'}</td>
                            <td className="min-w-[10rem]">
                              {res.isSpecialGuest ? (
                                <span className="text-stone-900">{res.specialRemarks || 'Special guest'}</span>
                              ) : res.remarks || res.notes ? (
                                <span className="text-stone-600">{res.remarks || res.notes}</span>
                              ) : (
                                <span className="text-stone-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-[13px] text-stone-600">
                          {paxSearchQuery
                            ? `No zaereen found matching "${paxSearchQuery}" in this tour.`
                            : 'No zaereen found for the selected Tour ID.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-stone-600">
                <span className="tabular-nums">Showing {displayedPaxManifest.length} of {selectedTourReservations.length} zaereen in the manifest</span>
                <span>All names, ITS and room allotments are exported in the PDF</span>
              </div>
            </div>
          )}

          {/* Narrow by building and arrival date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pdf-building" className={fieldLabel}>Hotel / building</label>
              <select
                id="pdf-building"
                value={buildingFilter}
                onChange={(e) => setBuildingFilter(e.target.value)}
                className={`${field} cursor-pointer`}
              >
                <option value="ALL">All buildings ({buildings.join(', ')})</option>
                {buildings.map((bldg) => {
                  const count = rooms.filter((r) => normalizeBuildingName(r.building).toLowerCase() === bldg.toLowerCase()).length;
                  return (
                    <option key={bldg} value={bldg}>
                      {bldg} ({count} rooms)
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label htmlFor="pdf-arrival" className={fieldLabel}>Arrival date</label>
              <select
                id="pdf-arrival"
                value={arrivalDateFilter}
                onChange={(e) => setArrivalDateFilter(e.target.value)}
                className={`${field} cursor-pointer tabular-nums`}
              >
                <option value="ALL">All arrival dates</option>
                {uniqueArrivalDates.map(({ date, count }) => (
                  <option key={date} value={date}>
                    {shownDate(date)} ({count} zaereen)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label htmlFor="sigCheck" className="flex items-start gap-2.5 min-h-10 py-2 text-sm text-stone-800 cursor-pointer">
            <input
              type="checkbox"
              id="sigCheck"
              checked={includeSignatures}
              onChange={(e) => setIncludeSignatures(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 accent-brand-700 cursor-pointer"
            />
            Include the official signatures and stamp block in the PDF footer
          </label>
        </div>

        <div className={modalFooter}>
          <span className="mr-auto min-w-0 max-sm:basis-full text-[13px] text-stone-600">
            {isTourManifest && tourIdFilter !== 'ALL' ? (
              <>Tour <span className="font-semibold text-stone-950 tabular-nums">{tourIdFilter}</span> · <span className="tabular-nums">{selectedTourReservations.length}</span> zaereen with names</>
            ) : (
              <>Full manifest, {buildingText}</>
            )}
          </span>

          <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => handleExport('Saifee')}
            className={btn.secondary}
            title="Download only Saifee Hotel records"
          >
            Saifee only
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => handleExport('Burhani')}
            className={btn.secondary}
            title="Download only Burhani Hotel records"
          >
            Burhani only
          </button>
          <button type="button" onClick={() => handleExport()} disabled={isGenerating} className={`${btn.primary} max-w-full max-sm:basis-full`}>
            <Download className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {isGenerating
                ? 'Generating PDF…'
                : isTourManifest
                ? `Download tour manifest PDF (${tourIdFilter !== 'ALL' ? tourIdFilter : 'all tours'})`
                : `Download PDF manifest (${buildingText})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
