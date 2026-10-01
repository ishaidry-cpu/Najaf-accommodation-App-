import React, { useState, useMemo, useEffect } from 'react';
import { 
  Printer, 
  Download, 
  Calendar, 
  Building2, 
  X, 
  Users, 
  CheckCircle2, 
  ArrowRight, 
  Clock, 
  Sparkles, 
  Luggage, 
  LogIn, 
  LogOut, 
  RefreshCw, 
  BedDouble, 
  DoorClosed, 
  CheckSquare,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Info
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Reservation, Room } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import { normalizeDate } from '../services/excelService';

interface ReceptionDailySlipModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: Reservation[];
  rooms: Room[];
}

export const ReceptionDailySlipModal: React.FC<ReceptionDailySlipModalProps> = ({
  isOpen,
  onClose,
  reservations,
  rooms,
}) => {
  // Today's date in YYYY-MM-DD
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Compute all unique dates in the system that have arrivals or departures
  const activeDatesSummary = useMemo(() => {
    const datesMap = new Map<string, { arrivals: number; departures: number; total: number }>();

    reservations.forEach((r) => {
      const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      const dep = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);

      if (arr) {
        const existing = datesMap.get(arr) || { arrivals: 0, departures: 0, total: 0 };
        existing.arrivals += 1;
        existing.total += 1;
        datesMap.set(arr, existing);
      }
      if (dep) {
        const existing = datesMap.get(dep) || { arrivals: 0, departures: 0, total: 0 };
        existing.departures += 1;
        existing.total += 1;
        datesMap.set(dep, existing);
      }
    });

    const sortedDates = Array.from(datesMap.keys()).sort();
    return {
      sortedDates,
      datesMap,
    };
  }, [reservations]);

  // Determine smart default date:
  // If today has activity, use today.
  // Otherwise pick the closest upcoming date (or first active date).
  const initialDate = useMemo(() => {
    const { sortedDates, datesMap } = activeDatesSummary;
    if (datesMap.has(todayStr)) return todayStr;
    const future = sortedDates.filter((d) => d >= todayStr);
    if (future.length > 0) return future[0];
    if (sortedDates.length > 0) return sortedDates[0];
    return todayStr;
  }, [activeDatesSummary, todayStr]);

  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [activeHotelFilter, setActiveHotelFilter] = useState<'ALL' | 'Saifee' | 'Burhani'>('ALL');
  const [activeTab, setActiveTab] = useState<'turnover' | 'roster'>('turnover');
  const [showOnlyActiveRooms, setShowOnlyActiveRooms] = useState<boolean>(true);

  // Sync selectedDate if empty and active dates exist
  useEffect(() => {
    if (isOpen && activeDatesSummary.sortedDates.length > 0) {
      if (!activeDatesSummary.datesMap.has(selectedDate)) {
        setSelectedDate(initialDate);
      }
    }
  }, [isOpen, initialDate, activeDatesSummary, selectedDate]);

  if (!isOpen) return null;

  // Filter arrivals on selected date using robust normalization
  const arrivalsOnDate = reservations.filter((r) => {
    const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
    return arr === selectedDate;
  });

  // Filter departures on selected date using robust normalization
  const departuresOnDate = reservations.filter((r) => {
    const dep = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
    return dep === selectedDate;
  });

  // In-house continuing stayers
  const inHouseOnDate = reservations.filter((r) => {
    const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
    const dep = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
    return arr && dep && arr < selectedDate && dep > selectedDate;
  });

  // Unallotted arrivals today (need immediate room assignment)
  const unallottedArrivals = arrivalsOnDate.filter((r) => !r.roomNumber || r.roomNumber.trim() === '');

  // Bifurcated by Hotel: Saifee & Burhani
  const saifeeArrivals = arrivalsOnDate.filter((r) => (r.building || '').toLowerCase().includes('saifee'));
  const saifeeDepartures = departuresOnDate.filter((r) => (r.building || '').toLowerCase().includes('saifee'));

  const burhaniArrivals = arrivalsOnDate.filter((r) => (r.building || '').toLowerCase().includes('burhani'));
  const burhaniDepartures = departuresOnDate.filter((r) => (r.building || '').toLowerCase().includes('burhani'));

  // Room Preparation Schedule: Room-by-Room Departure & Arrival Turnover matrix
  const roomPrepSchedule = rooms.map((room) => {
    const rBldg = (room.building || '').trim().toLowerCase();
    const rNum = (room.roomNumber || '').trim().toLowerCase();

    // Departures from this room on selectedDate
    const deps = reservations.filter((r) => {
      const bMatch = (r.building || '').trim().toLowerCase() === rBldg;
      const nMatch = (r.roomNumber || '').trim().toLowerCase() === rNum;
      const depDate = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
      return bMatch && nMatch && depDate === selectedDate;
    });

    // Arrivals into this room on selectedDate
    const arrs = reservations.filter((r) => {
      const bMatch = (r.building || '').trim().toLowerCase() === rBldg;
      const nMatch = (r.roomNumber || '').trim().toLowerCase() === rNum;
      const arrDate = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      return bMatch && nMatch && arrDate === selectedDate;
    });

    // In-house stayers (continuing over this date)
    const inHouse = reservations.filter((r) => {
      const bMatch = (r.building || '').trim().toLowerCase() === rBldg;
      const nMatch = (r.roomNumber || '').trim().toLowerCase() === rNum;
      const aDate = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      const dDate = normalizeDate(r.departureDate || r.departureDateTime || r.rawDepartureStr);
      return bMatch && nMatch && aDate && dDate && aDate < selectedDate && dDate > selectedDate;
    });

    let actionType: 'turnover' | 'new_arrival' | 'departure_clean' | 'in_house' | 'vacant' = 'vacant';
    let actionLabel = 'Vacant Ready';
    let actionBadge = 'bg-stone-100 text-stone-700 border-stone-200';

    if (deps.length > 0 && arrs.length > 0) {
      actionType = 'turnover';
      actionLabel = 'PRIORITY TURNOVER (Dep ➔ Arr)';
      actionBadge = 'bg-purple-100 text-purple-900 border-purple-300 font-extrabold';
    } else if (arrs.length > 0) {
      actionType = 'new_arrival';
      actionLabel = 'NEW ARRIVAL PREPARATION';
      actionBadge = 'bg-emerald-100 text-emerald-900 border-emerald-300 font-extrabold';
    } else if (deps.length > 0) {
      actionType = 'departure_clean';
      actionLabel = 'CHECKOUT CLEANING';
      actionBadge = 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold';
    } else if (inHouse.length > 0) {
      actionType = 'in_house';
      actionLabel = 'CONTINUING STAY';
      actionBadge = 'bg-blue-100 text-blue-900 border-blue-200';
    }

    const hasActivity = deps.length > 0 || arrs.length > 0;

    return {
      room,
      deps,
      arrs,
      inHouse,
      actionType,
      actionLabel,
      actionBadge,
      hasActivity,
    };
  });

  // Filtered room prep by hotel and active status
  const filteredRoomPrep = roomPrepSchedule.filter((item) => {
    if (activeHotelFilter !== 'ALL' && item.room.building.toLowerCase() !== activeHotelFilter.toLowerCase()) {
      return false;
    }
    if (showOnlyActiveRooms && !item.hasActivity) {
      return false;
    }
    return true;
  });

  const activeTurnoversCount = roomPrepSchedule.filter((r) => r.actionType === 'turnover').length;
  const newArrivalsPrepCount = roomPrepSchedule.filter((r) => r.actionType === 'new_arrival').length;
  const checkoutCleansCount = roomPrepSchedule.filter((r) => r.actionType === 'departure_clean').length;

  // Shift to next or previous active date
  const handleNavigateActiveDate = (direction: 'prev' | 'next') => {
    const list = activeDatesSummary.sortedDates;
    if (list.length === 0) return;
    const currentIndex = list.indexOf(selectedDate);
    if (currentIndex === -1) {
      setSelectedDate(list[0]);
      return;
    }
    if (direction === 'prev' && currentIndex > 0) {
      setSelectedDate(list[currentIndex - 1]);
    } else if (direction === 'next' && currentIndex < list.length - 1) {
      setSelectedDate(list[currentIndex + 1]);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();

    // Top Header Banner
    doc.setFillColor(18, 78, 57); // #124E39 deep green
    doc.rect(0, 0, pageWidth, 55, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('FAIZ-E-HUSAINI — ZAEREEN ACCOMMODATION MANAGEMENT', pageWidth / 2, 25, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(235, 213, 158); // Gold #EBD59E
    doc.text(
      `ROOM TURNOVER & PREPARATION RECEPTION SLIP • OPERATIONAL DATE: ${selectedDate}`,
      pageWidth / 2,
      43,
      { align: 'center' }
    );

    let currentY = 75;

    // Room-by-room preparation matrix table for PDF
    const prepRows = filteredRoomPrep.map((item) => {
      const depText = item.deps.length > 0
        ? item.deps.map((d) => `• ${d.applicantName}\n  Tour: ${d.tourRefNo || '—'} | Fam #${d.family || '—'} (ITS: ${d.itsId})`).join('\n\n')
        : '— None';

      const arrText = item.arrs.length > 0
        ? item.arrs.map((a) => `• ${a.applicantName}\n  Tour: ${a.tourRefNo || '—'} | Fam #${a.family || '—'} (ITS: ${a.itsId})`).join('\n\n')
        : '— None';

      return [
        `Room ${item.room.roomNumber}\n${item.room.building} Hotel\nFl ${item.room.floor}`,
        depText,
        arrText,
        item.actionLabel,
        '[ ] Cleaned\n[ ] Fresh Linens\n[ ] Toilet Sanitized\n[ ] Wajba/cards ready\n[ ] Key Cards Ready',
      ];
    });

    autoTable(doc, {
      startY: currentY,
      head: [['Room & Hotel', 'Departures (Check-outs)', 'Arrivals (New Zaereen)', 'Turnover Prep Action', 'Housekeeping Sign-off']],
      body: prepRows.length > 0 ? prepRows : [['No rooms with turnover activity on selected date', '', '', '', '']],
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 6, textColor: [30, 30, 30] },
      headStyles: { fillColor: [18, 78, 57], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 },
      bodyStyles: { textColor: [30, 30, 30] },
      didDrawPage: (data) => {
        currentY = data.cursor?.y || currentY;
      },
    });

    currentY += 30;

    // Signatures
    if (currentY + 60 > doc.internal.pageSize.getHeight()) {
      doc.addPage();
      currentY = 40;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('____________________________________', 60, currentY + 35);
    doc.text('Prepared by: Accommodation Control Desk', 60, currentY + 48);

    doc.text('____________________________________', pageWidth - 260, currentY + 35);
    doc.text('Received by: Housekeeping & Reception Duty Manager', pageWidth - 260, currentY + 48);

    doc.save(`Faiz_Husaini_Room_Turnover_Prep_Slip_${selectedDate}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* Print-specific style to guarantee pristine paper print without scroll cutoffs */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden;
          }
          #reception-slip-printable-area, #reception-slip-printable-area * {
            visibility: visible;
          }
          #reception-slip-printable-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 15px;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
          }
          .print-hidden-element {
            display: none !important;
          }
        }
      `}} />

      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-6xl w-full p-4 sm:p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[94vh]">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="print-hidden-element absolute top-4 right-4 text-stone-500 hover:text-stone-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition cursor-pointer z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Top Controls Bar (Hidden in Print) */}
        <div className="print-hidden-element flex flex-col gap-3 pb-3 border-b border-stone-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FaizHusainiLogo size="sm" showSubtitle={false} />
                <h3 className="text-base font-bold text-[#124E39]">
                  Daily Reception Slip — Room Turnover & Guest Roster
                </h3>
              </div>
              <p className="text-xs text-stone-600 mt-0.5">
                Room-by-room preparation matrix for housekeeping turnover, checkouts, and incoming zaereen check-in.
              </p>
            </div>

            {/* Print and PDF Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-stone-800 hover:bg-stone-900 text-white shadow-xs transition cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Reception Slip</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>Download PDF</span>
              </button>
            </div>
          </div>

          {/* Date Picker & Active Date Chips Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {/* Date navigation */}
              <div className="flex items-center gap-1 bg-white border border-stone-300 rounded-xl px-2 py-1 shadow-2xs text-xs">
                <button
                  type="button"
                  onClick={() => handleNavigateActiveDate('prev')}
                  className="p-1 text-stone-500 hover:text-stone-900 rounded"
                  title="Previous operational date with activity"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <Calendar className="w-4 h-4 text-[#124E39]" />
                <span className="font-semibold text-stone-600">Date:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent font-bold text-stone-900 focus:outline-none cursor-pointer"
                />

                <button
                  type="button"
                  onClick={() => handleNavigateActiveDate('next')}
                  className="p-1 text-stone-500 hover:text-stone-900 rounded"
                  title="Next operational date with activity"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Quick Jump to Active Dates */}
              <div className="flex items-center gap-1 overflow-x-auto max-w-xl py-0.5">
                <span className="text-[11px] font-bold text-stone-500 mr-1 hidden sm:inline">Active Dates:</span>
                {activeDatesSummary.sortedDates.map((dateStr) => {
                  const stat = activeDatesSummary.datesMap.get(dateStr);
                  const isSelected = dateStr === selectedDate;
                  const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short' });

                  return (
                    <button
                      key={dateStr}
                      type="button"
                      onClick={() => setSelectedDate(dateStr)}
                      className={`px-2 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap shadow-2xs flex items-center gap-1 ${
                        isSelected
                          ? 'bg-[#124E39] text-white shadow-xs'
                          : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
                      }`}
                    >
                      <span>{dateLabel}</span>
                      {stat && stat.arrivals > 0 && (
                        <span className={`text-[10px] px-1 rounded ${isSelected ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-100 text-emerald-900'}`}>
                          +{stat.arrivals}
                        </span>
                      )}
                      {stat && stat.departures > 0 && (
                        <span className={`text-[10px] px-1 rounded ${isSelected ? 'bg-amber-800 text-amber-100' : 'bg-amber-100 text-amber-900'}`}>
                          -{stat.departures}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hotel Filter Tabs */}
            <div className="flex items-center bg-stone-200/70 p-0.5 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveHotelFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  activeHotelFilter === 'ALL'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                All (114)
              </button>
              <button
                type="button"
                onClick={() => setActiveHotelFilter('Saifee')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  activeHotelFilter === 'Saifee'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                Saifee (70)
              </button>
              <button
                type="button"
                onClick={() => setActiveHotelFilter('Burhani')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  activeHotelFilter === 'Burhani'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                Burhani (44)
              </button>
            </div>
          </div>
        </div>

        {/* View Switcher Tabs (Print Prep Schedule vs Standard Roster) */}
        <div className="print-hidden-element flex items-center justify-between gap-3 pt-3 flex-wrap">
          <div className="flex items-center gap-1 bg-stone-200/80 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('turnover')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                activeTab === 'turnover'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              <DoorClosed className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>Room-by-Room Turnover Schedule (Housekeeping)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('roster')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                activeTab === 'roster'
                  ? 'bg-[#124E39] text-white shadow-xs'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Arrivals & Departures Guest Roster</span>
            </button>
          </div>

          {activeTab === 'turnover' && (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyActiveRooms}
                onChange={(e) => setShowOnlyActiveRooms(e.target.checked)}
                className="rounded text-[#124E39] focus:ring-[#124E39]"
              />
              <span>Show only rooms with Turnover / Activity Today ({filteredRoomPrep.length})</span>
            </label>
          )}
        </div>

        {/* Printable Paper Slip View Container */}
        <div
          id="reception-slip-printable-area"
          className="flex-1 overflow-y-auto mt-4 p-4 sm:p-6 bg-white border border-[#E6DFD5] rounded-xl shadow-xs space-y-6"
        >
          {/* Slip Official Header */}
          <div className="text-center pb-4 border-b-2 border-[#124E39]">
            <div className="flex items-center justify-center gap-3 mb-1">
              <FaizHusainiLogo size="lg" />
            </div>
            <div className="inline-block bg-[#124E39] text-[#EBD59E] font-bold text-xs uppercase px-3 py-1 rounded-md tracking-wider mt-1">
              {activeTab === 'turnover' ? 'Room Turnover & Preparation Daily Reception Slip' : 'Daily Operational Reception Slip'}
            </div>
            <div className="mt-2 text-xs font-semibold text-stone-700">
              Operational Date: <span className="text-[#124E39] font-bold underline">{new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span> • Najaf Al-Ashraf Lodging
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">Priority Room Turnovers</span>
              <span className="text-base font-extrabold text-purple-900">{activeTurnoversCount} Rooms</span>
              <span className="text-[10px] text-stone-500 block">Departing ➔ Arriving same day</span>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">New Arrivals Today</span>
              <span className="text-base font-extrabold text-emerald-800">{newArrivalsPrepCount} Rooms ({arrivalsOnDate.length} Zaereen)</span>
              <span className="text-[10px] text-stone-500 block">Fresh check-ins to welcome</span>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">Checkouts / Freeing Up</span>
              <span className="text-base font-extrabold text-amber-800">{checkoutCleansCount} Rooms ({departuresOnDate.length} Zaereen)</span>
              <span className="text-[10px] text-stone-500 block">Vacating to clean inventory</span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FAF7F2] border border-[#E6DFD5]">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">Total Hotel Inventory</span>
              <span className="text-base font-extrabold text-[#124E39]">114 Official Rooms</span>
              <span className="text-[10px] text-stone-500 block">Saifee (70) • Burhani (44)</span>
            </div>
          </div>

          {/* Unallotted Zaereen Alert if any arrive today without a room */}
          {unallottedArrivals.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-col gap-2">
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-700" />
                <span>Notice: {unallottedArrivals.length} Zaereen arriving on {selectedDate} have no Room Number assigned yet!</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {unallottedArrivals.map((z) => (
                  <span key={z.id} className="px-2 py-0.5 rounded bg-white border border-amber-300 text-amber-900 font-medium text-[11px]">
                    {z.applicantName} ({z.family || 'Fam'} • Tour: {z.tourRefNo})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 1: ROOM-BY-ROOM TURNOVER & PREPARATION MATRIX (REQUESTED) */}
          {/* ============================================================ */}
          {activeTab === 'turnover' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#124E39]/30 pb-2">
                <div className="flex items-center gap-2 text-sm font-bold text-[#124E39]">
                  <DoorClosed className="w-4 h-4 text-[#124E39]" />
                  <span>Room Turnover & Preparation Schedule (Housekeeping & Reception Handover)</span>
                </div>
                <span className="text-xs text-stone-500 font-semibold">
                  Showing {filteredRoomPrep.length} Rooms
                </span>
              </div>

              <div className="overflow-x-auto border border-stone-300 rounded-xl shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                      <th className="py-3 px-3 w-[18%]">Room & Hotel</th>
                      <th className="py-3 px-3 w-[31%] bg-[#124E39]/95">Departures (Vacating Today)</th>
                      <th className="py-3 px-3 w-[31%] bg-[#124E39]/95">Arrivals (New Zaereen)</th>
                      <th className="py-3 px-3 w-[20%]">Turnover Status & Housekeeping Sign-off</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {filteredRoomPrep.length > 0 ? (
                      filteredRoomPrep.map((item, idx) => {
                        const isTurnover = item.actionType === 'turnover';
                        return (
                          <tr
                            key={idx}
                            className={`transition ${
                              isTurnover
                                ? 'bg-purple-50/40 font-medium'
                                : item.actionType === 'new_arrival'
                                ? 'bg-emerald-50/30'
                                : item.actionType === 'departure_clean'
                                ? 'bg-amber-50/30'
                                : 'hover:bg-stone-50'
                            }`}
                          >
                            {/* 1. Room & Hotel */}
                            <td className="py-3 px-3 align-top">
                              <div className="font-serif font-extrabold text-base text-[#124E39]">
                                Room {item.room.roomNumber}
                              </div>
                              <div className="text-[11px] text-stone-700 font-bold mt-0.5">
                                {item.room.building} Hotel • {item.room.floorLabel || `Floor ${item.room.floor}`}
                              </div>
                              {/* Tour ID and Family quick label if present */}
                              {(item.arrs[0] || item.deps[0]) && (
                                <div className="mt-2 text-[10px] text-stone-800 space-y-0.5 bg-stone-100 p-1.5 rounded border border-stone-200">
                                  <div>Tour: <span className="font-mono font-bold text-stone-900">{item.arrs[0]?.tourRefNo || item.deps[0]?.tourRefNo || '—'}</span></div>
                                  <div>Family: <span className="font-mono font-bold text-stone-900">#{item.arrs[0]?.family || item.deps[0]?.family || '—'}</span></div>
                                </div>
                              )}
                            </td>

                            {/* 2. Departures (Vacating Today) */}
                            <td className="py-3 px-3 align-top border-l border-stone-200">
                              {item.deps.length > 0 ? (
                                <div className="space-y-2">
                                  {item.deps.map((d, dIdx) => (
                                    <div key={dIdx} className="p-2 rounded-lg bg-stone-50 border border-stone-300 text-stone-900 shadow-2xs">
                                      <div className="font-bold text-xs text-stone-900 flex items-center justify-between">
                                        <span>{d.applicantName}</span>
                                        <span className="font-mono font-bold text-stone-900 bg-stone-200/90 px-1.5 py-0.5 rounded text-[11px]">
                                          Family #{d.family || '—'}
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-stone-800 flex flex-wrap items-center gap-2 mt-1">
                                        <span className="font-bold text-stone-900 bg-stone-200/90 px-1.5 py-0.5 rounded">
                                          Tour: {d.tourRefNo || '—'}
                                        </span>
                                        <span className="font-mono text-stone-700">ITS: {d.itsId}</span>
                                      </div>
                                      {d.rawDepartureStr && (
                                        <div className="text-[10px] text-stone-700 font-semibold mt-1">
                                          Checkout Time: {d.rawDepartureStr}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-stone-400 italic text-[11px]">
                                  No departures today
                                </span>
                              )}
                            </td>

                            {/* 3. Arrivals (New Zaereen) */}
                            <td className="py-3 px-3 align-top border-l border-stone-200">
                              {item.arrs.length > 0 ? (
                                <div className="space-y-2">
                                  {item.arrs.map((a, aIdx) => (
                                    <div key={aIdx} className="p-2 rounded-lg bg-stone-50 border border-stone-300 text-stone-900 shadow-2xs">
                                      <div className="font-bold text-xs text-stone-900 flex items-center justify-between">
                                        <span>{a.applicantName}</span>
                                        <span className="font-mono font-bold text-stone-900 bg-stone-200/90 px-1.5 py-0.5 rounded text-[11px]">
                                          Family #{a.family || '—'}
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-stone-800 flex flex-wrap items-center gap-2 mt-1">
                                        <span className="font-bold text-stone-900 bg-stone-200/90 px-1.5 py-0.5 rounded">
                                          Tour: {a.tourRefNo || '—'}
                                        </span>
                                        <span className="font-mono text-stone-700">ITS: {a.itsId}</span>
                                        <span className="font-semibold text-stone-700">• {a.category}</span>
                                      </div>
                                      {a.rawArrivalStr && (
                                        <div className="text-[10px] text-stone-700 font-semibold mt-1">
                                          Arrival Time: {a.rawArrivalStr}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-stone-400 italic text-[11px]">
                                  No new arrival today
                                </span>
                              )}
                            </td>

                            {/* 4. Turnover Status & Housekeeping Sign-off */}
                            <td className="py-3 px-3 align-top border-l border-stone-200">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] border mb-2 font-bold ${item.actionBadge}`}>
                                {item.actionLabel}
                              </span>

                              {/* Housekeeping Checkboxes for printed slip */}
                              <div className="space-y-1 text-[10px] text-stone-900 font-medium">
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-block w-3.5 h-3.5 border border-stone-600 rounded-2xs bg-white shrink-0" />
                                  <span>Linen & Bed Fresh</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-block w-3.5 h-3.5 border border-stone-600 rounded-2xs bg-white shrink-0" />
                                  <span>Toilet Clean & Sanitized</span>
                                </div>
                                <div className="flex items-center gap-1.5 font-bold text-stone-950">
                                  <span className="inline-block w-3.5 h-3.5 border-2 border-stone-800 rounded-2xs bg-white shrink-0" />
                                  <span>Wajba/cards ready</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-block w-3.5 h-3.5 border border-stone-600 rounded-2xs bg-white shrink-0" />
                                  <span>Key Cards Ready</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-10 text-center">
                          <div className="text-stone-500 font-semibold text-xs">
                            No room preparation or turnover activity scheduled for {selectedDate}.
                          </div>
                          {activeDatesSummary.sortedDates.length > 0 && (
                            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                              <span className="text-stone-400 text-xs">Jump to date with Zaereen:</span>
                              {activeDatesSummary.sortedDates.slice(0, 4).map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setSelectedDate(d)}
                                  className="px-2.5 py-1 rounded bg-[#124E39] text-[#EBD59E] font-bold text-xs shadow-2xs hover:bg-[#0E3C2C]"
                                >
                                  {d}
                                </button>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowOnlyActiveRooms(false)}
                            className="mt-3 text-xs text-[#124E39] font-bold underline hover:text-stone-900"
                          >
                            View All 114 Hotel Rooms
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: STANDARD ARRIVALS & DEPARTURES ROSTER                  */}
          {/* ============================================================ */}
          {activeTab === 'roster' && (
            <div className="space-y-6">
              {/* Saifee Hotel Section */}
              {(activeHotelFilter === 'ALL' || activeHotelFilter === 'Saifee') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-[#124E39]/10 border border-[#124E39]/30 px-3 py-2 rounded-lg">
                    <div className="flex items-center gap-2 font-bold text-sm text-[#124E39]">
                      <Building2 className="w-4 h-4 text-[#124E39]" />
                      <span>SAIFEE HOTEL — DAILY ROSTER ({selectedDate})</span>
                    </div>
                    <span className="text-xs font-semibold text-[#124E39]">
                      {saifeeArrivals.length} Arrivals • {saifeeDepartures.length} Departures
                    </span>
                  </div>

                  {/* Saifee Arrivals */}
                  <div>
                    <h4 className="text-xs font-bold text-emerald-800 mb-1.5 flex items-center gap-1.5">
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Room-wise Arrivals ({saifeeArrivals.length})</span>
                    </h4>
                    <div className="overflow-x-auto border border-stone-200 rounded-lg">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold">
                          <tr>
                            <th className="py-2.5 px-3">Room #</th>
                            <th className="py-2.5 px-3">Family</th>
                            <th className="py-2.5 px-3">Applicant / Guest</th>
                            <th className="py-2.5 px-3">ITS ID</th>
                            <th className="py-2.5 px-3">Tour Ref</th>
                            <th className="py-2.5 px-3">Office</th>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3">Money Given (B➔A)</th>
                            <th className="py-2.5 px-3">Dep Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200">
                          {saifeeArrivals.length > 0 ? (
                            saifeeArrivals.map((r, i) => (
                              <tr key={i} className="hover:bg-stone-50">
                                <td className="py-2 px-3 font-bold text-[#124E39]">
                                  {r.roomNumber ? `Room ${r.roomNumber}` : <span className="text-amber-800 font-extrabold">Unallotted</span>}
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.family}</td>
                                <td className="py-2 px-3 font-bold text-stone-900">{r.applicantName}</td>
                                <td className="py-2 px-3 font-mono text-stone-800">{r.itsId}</td>
                                <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.tourRefNo}</td>
                                <td className="py-2 px-3 text-stone-700">{r.officeName}</td>
                                <td className="py-2 px-3 text-stone-800 font-semibold">{r.category}</td>
                                <td className="py-2 px-3">
                                  {r.category === 'B to A' || r.shiftToCategoryA ? (
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.moneyGiven === 'Yes' ? 'bg-emerald-100 text-emerald-950 border border-emerald-300' : 'bg-rose-100 text-rose-950 border border-rose-300'}`}>
                                      {r.moneyGiven === 'Yes' ? 'Paid ✓' : 'Pending ✗'}
                                    </span>
                                  ) : (
                                    <span className="text-stone-400">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-stone-700">{r.departureDate}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={9} className="py-3 text-center text-stone-400 italic">
                                No arrivals scheduled for Saifee Hotel on {selectedDate}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Saifee Departures */}
                  <div>
                    <h4 className="text-xs font-bold text-stone-800 mb-1.5 flex items-center gap-1.5">
                      <LogOut className="w-3.5 h-3.5 text-stone-600" />
                      <span>Scheduled Departures ({saifeeDepartures.length})</span>
                    </h4>
                    <div className="overflow-x-auto border border-stone-200 rounded-lg">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-stone-800 text-white uppercase text-[10px] font-bold">
                          <tr>
                            <th className="py-2.5 px-3">Room #</th>
                            <th className="py-2.5 px-3">Family</th>
                            <th className="py-2.5 px-3">Applicant / Guest</th>
                            <th className="py-2.5 px-3">ITS ID</th>
                            <th className="py-2.5 px-3">Tour Ref</th>
                            <th className="py-2.5 px-3">Office</th>
                            <th className="py-2.5 px-3">Check-out Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200">
                          {saifeeDepartures.length > 0 ? (
                            saifeeDepartures.map((r, i) => (
                              <tr key={i} className="hover:bg-stone-50">
                                <td className="py-2 px-3 font-bold text-stone-900">
                                  {r.roomNumber ? `Room ${r.roomNumber}` : '—'}
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.family}</td>
                                <td className="py-2 px-3 font-bold text-stone-900">{r.applicantName}</td>
                                <td className="py-2 px-3 font-mono text-stone-800">{r.itsId}</td>
                                <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.tourRefNo}</td>
                                <td className="py-2 px-3 text-stone-700">{r.officeName}</td>
                                <td className="py-2 px-3 text-stone-800 font-medium">Clear keys & prepare for cleaning</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={7} className="py-3 text-center text-stone-400 italic">
                                No departures scheduled for Saifee Hotel on {selectedDate}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Burhani Hotel Section */}
              {(activeHotelFilter === 'ALL' || activeHotelFilter === 'Burhani') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-[#124E39]/10 border border-[#124E39]/30 px-3 py-2 rounded-lg">
                    <div className="flex items-center gap-2 font-bold text-sm text-[#124E39]">
                      <Building2 className="w-4 h-4 text-[#124E39]" />
                      <span>BURHANI HOTEL — DAILY ROSTER ({selectedDate})</span>
                    </div>
                    <span className="text-xs font-semibold text-[#124E39]">
                      {burhaniArrivals.length} Arrivals • {burhaniDepartures.length} Departures
                    </span>
                  </div>

                  {/* Burhani Arrivals */}
                  <div>
                    <h4 className="text-xs font-bold text-stone-800 mb-1.5 flex items-center gap-1.5">
                      <LogIn className="w-3.5 h-3.5 text-stone-600" />
                      <span>Room-wise Arrivals ({burhaniArrivals.length})</span>
                    </h4>
                    <div className="overflow-x-auto border border-stone-200 rounded-lg">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold">
                          <tr>
                            <th className="py-2.5 px-3">Room #</th>
                            <th className="py-2.5 px-3">Family</th>
                            <th className="py-2.5 px-3">Applicant / Guest</th>
                            <th className="py-2.5 px-3">ITS ID</th>
                            <th className="py-2.5 px-3">Tour Ref</th>
                            <th className="py-2.5 px-3">Office</th>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3">Money Given (B➔A)</th>
                            <th className="py-2.5 px-3">Dep Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200">
                          {burhaniArrivals.length > 0 ? (
                            burhaniArrivals.map((r, i) => (
                              <tr key={i} className="hover:bg-stone-50">
                                <td className="py-2 px-3 font-bold text-[#124E39]">
                                  {r.roomNumber ? `Room ${r.roomNumber}` : <span className="text-amber-800 font-extrabold">Unallotted</span>}
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.family}</td>
                                <td className="py-2 px-3 font-bold text-stone-900">{r.applicantName}</td>
                                <td className="py-2 px-3 font-mono text-stone-800">{r.itsId}</td>
                                <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.tourRefNo}</td>
                                <td className="py-2 px-3 text-stone-700">{r.officeName}</td>
                                <td className="py-2 px-3 text-stone-800 font-semibold">{r.category}</td>
                                <td className="py-2 px-3">
                                  {r.category === 'B to A' || r.shiftToCategoryA ? (
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${r.moneyGiven === 'Yes' ? 'bg-emerald-100 text-emerald-950 border border-emerald-300' : 'bg-rose-100 text-rose-950 border border-rose-300'}`}>
                                      {r.moneyGiven === 'Yes' ? 'Paid ✓' : 'Pending ✗'}
                                    </span>
                                  ) : (
                                    <span className="text-stone-400">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-stone-700">{r.departureDate}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={9} className="py-3 text-center text-stone-400 italic">
                                No arrivals scheduled for Burhani Hotel on {selectedDate}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Burhani Departures */}
                  <div>
                    <h4 className="text-xs font-bold text-stone-800 mb-1.5 flex items-center gap-1.5">
                      <LogOut className="w-3.5 h-3.5 text-stone-600" />
                      <span>Scheduled Departures ({burhaniDepartures.length})</span>
                    </h4>
                    <div className="overflow-x-auto border border-stone-200 rounded-lg">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-stone-800 text-white uppercase text-[10px] font-bold">
                          <tr>
                            <th className="py-2.5 px-3">Room #</th>
                            <th className="py-2.5 px-3">Family</th>
                            <th className="py-2.5 px-3">Applicant / Guest</th>
                            <th className="py-2.5 px-3">ITS ID</th>
                            <th className="py-2.5 px-3">Tour Ref</th>
                            <th className="py-2.5 px-3">Office</th>
                            <th className="py-2.5 px-3">Check-out Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200">
                          {burhaniDepartures.length > 0 ? (
                            burhaniDepartures.map((r, i) => (
                              <tr key={i} className="hover:bg-stone-50">
                                <td className="py-2 px-3 font-bold text-stone-900">
                                  {r.roomNumber ? `Room ${r.roomNumber}` : '—'}
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.family}</td>
                                <td className="py-2 px-3 font-bold text-stone-900">{r.applicantName}</td>
                                <td className="py-2 px-3 font-mono text-stone-800">{r.itsId}</td>
                                <td className="py-2 px-3 font-mono font-bold text-stone-900">{r.tourRefNo}</td>
                                <td className="py-2 px-3 text-stone-700">{r.officeName}</td>
                                <td className="py-2 px-3 text-stone-800 font-medium">Clear keys & prepare for cleaning</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={7} className="py-3 text-center text-stone-400 italic">
                                No departures scheduled for Burhani Hotel on {selectedDate}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Handover & Signatures Box */}
          <div className="pt-6 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs text-stone-600">
            <div>
              <div className="font-semibold text-stone-800 mb-6">Submitted by:</div>
              <div className="border-b border-stone-400 w-48 mb-1" />
              <div>Accommodation Control Desk Officer</div>
              <div className="text-[10px] text-stone-400">Date: {selectedDate}</div>
            </div>

            <div className="sm:text-right">
              <div className="font-semibold text-stone-800 mb-6">Acknowledged & Received by:</div>
              <div className="border-b border-stone-400 w-48 mb-1 sm:ml-auto" />
              <div>Reception & Housekeeping Duty Manager</div>
              <div className="text-[10px] text-stone-400">Time: ______________</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
