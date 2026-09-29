import React, { useState, useMemo } from 'react';
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
  CheckSquare
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Reservation, Room } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';

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
  // Default to today's date in YYYY-MM-DD
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [activeHotelFilter, setActiveHotelFilter] = useState<'ALL' | 'Saifee' | 'Burhani'>('ALL');
  const [activeTab, setActiveTab] = useState<'turnover' | 'roster'>('turnover');
  const [showOnlyActiveRooms, setShowOnlyActiveRooms] = useState<boolean>(true);

  if (!isOpen) return null;

  // Filter arrivals on selected date
  const arrivalsOnDate = reservations.filter((r) => {
    const arr = (r.arrivalDate || r.arrivalDateTime || '').slice(0, 10);
    return arr === selectedDate;
  });

  // Filter departures on selected date
  const departuresOnDate = reservations.filter((r) => {
    const dep = (r.departureDate || r.departureDateTime || '').slice(0, 10);
    return dep === selectedDate;
  });

  // Bifurcated by Hotel: Saifee & Burhani
  const saifeeArrivals = arrivalsOnDate.filter((r) => r.building === 'Saifee');
  const saifeeDepartures = departuresOnDate.filter((r) => r.building === 'Saifee');

  const burhaniArrivals = arrivalsOnDate.filter((r) => r.building === 'Burhani');
  const burhaniDepartures = departuresOnDate.filter((r) => r.building === 'Burhani');

  // Room Preparation Schedule: Room-by-Room Departure & Arrival Turnover matrix
  const roomPrepSchedule = useMemo(() => {
    return rooms.map((room) => {
      const rBldg = (room.building || '').toLowerCase();
      const rNum = (room.roomNumber || '').toLowerCase();

      // Departures from this room on selectedDate
      const deps = reservations.filter((r) => {
        const bMatch = (r.building || '').toLowerCase() === rBldg;
        const nMatch = (r.roomNumber || '').toLowerCase() === rNum;
        const dMatch = (r.departureDate || r.departureDateTime || '').slice(0, 10) === selectedDate;
        return bMatch && nMatch && dMatch;
      });

      // Arrivals into this room on selectedDate
      const arrs = reservations.filter((r) => {
        const bMatch = (r.building || '').toLowerCase() === rBldg;
        const nMatch = (r.roomNumber || '').toLowerCase() === rNum;
        const aMatch = (r.arrivalDate || r.arrivalDateTime || '').slice(0, 10) === selectedDate;
        return bMatch && nMatch && aMatch;
      });

      // In-house stayers (continuing over this date)
      const inHouse = reservations.filter((r) => {
        const bMatch = (r.building || '').toLowerCase() === rBldg;
        const nMatch = (r.roomNumber || '').toLowerCase() === rNum;
        const aDate = (r.arrivalDate || '').slice(0, 10);
        const dDate = (r.departureDate || '').slice(0, 10);
        return bMatch && nMatch && aDate < selectedDate && dDate > selectedDate;
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
  }, [rooms, reservations, selectedDate]);

  // Filtered room prep by hotel and active status
  const filteredRoomPrep = useMemo(() => {
    return roomPrepSchedule.filter((item) => {
      if (activeHotelFilter !== 'ALL' && item.room.building.toLowerCase() !== activeHotelFilter.toLowerCase()) {
        return false;
      }
      if (showOnlyActiveRooms && !item.hasActivity) {
        return false;
      }
      return true;
    });
  }, [roomPrepSchedule, activeHotelFilter, showOnlyActiveRooms]);

  const activeTurnoversCount = roomPrepSchedule.filter((r) => r.actionType === 'turnover').length;
  const newArrivalsPrepCount = roomPrepSchedule.filter((r) => r.actionType === 'new_arrival').length;
  const checkoutCleansCount = roomPrepSchedule.filter((r) => r.actionType === 'departure_clean').length;

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
      `ROOM TURNOVER & PREPARATION RECEPTION SLIP • DATE: ${selectedDate}`,
      pageWidth / 2,
      43,
      { align: 'center' }
    );

    let currentY = 75;

    // Room-by-room preparation matrix table for PDF
    const prepRows = filteredRoomPrep.map((item) => {
      const depText = item.deps.length > 0
        ? item.deps.map((d) => `${d.applicantName} (${d.itsId} • ${d.family})`).join('\n')
        : '— None (Vacant)';

      const arrText = item.arrs.length > 0
        ? item.arrs.map((a) => `${a.applicantName} (${a.itsId} • ${a.family})`).join('\n')
        : '— None';

      return [
        `Room ${item.room.roomNumber}\n${item.room.building} • Fl ${item.room.floor}`,
        `Pax: ${item.room.capacity}${item.room.buffer ? ` +${item.room.buffer}B` : ''}\n${item.room.toiletType || ''}`,
        depText,
        arrText,
        item.actionLabel,
        '[ ] Cleaned\n[ ] Fresh Linens\n[ ] Key Ready',
      ];
    });

    autoTable(doc, {
      startY: currentY,
      head: [['Room & Hotel', 'Specs / Pax', 'Departures (Check-outs)', 'Arrivals (New Zaereen)', 'Turnover Prep Action', 'Housekeeping Sign-off']],
      body: prepRows.length > 0 ? prepRows : [['No rooms with turnover activity on selected date', '', '', '', '', '']],
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 5 },
      headStyles: { fillColor: [18, 78, 57], textColor: [255, 255, 255], fontStyle: 'bold' },
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
    doc.text('Prepared by: Accommodation Office', 60, currentY + 48);

    doc.text('____________________________________', pageWidth - 260, currentY + 35);
    doc.text('Received by: Housekeeping & Reception Duty Manager', pageWidth - 260, currentY + 48);

    doc.save(`Faiz_Husaini_Room_Turnover_Prep_Slip_${selectedDate}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-6xl w-full p-5 sm:p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[92vh]">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="print:hidden absolute top-4 right-4 text-stone-500 hover:text-stone-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Top Controls Bar (Hidden in Print) */}
        <div className="print:hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-200">
          <div>
            <div className="flex items-center gap-2">
              <FaizHusainiLogo size="sm" showSubtitle={false} />
              <h3 className="text-base font-bold text-[#124E39]">
                Reception Slip — Room Turnover & Daily Operations
              </h3>
            </div>
            <p className="text-xs text-stone-600">
              Departures and arrivals organized room-by-room for housekeeping and room turnaround preparation
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Date Picker */}
            <div className="flex items-center gap-1.5 bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs shadow-xs">
              <Calendar className="w-4 h-4 text-[#124E39]" />
              <span className="font-medium text-stone-600">Date:</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent font-bold text-stone-800 focus:outline-none cursor-pointer"
              />
            </div>

            {/* Hotel Bifurcation Filter */}
            <div className="flex items-center bg-stone-200/70 p-0.5 rounded-lg text-xs font-semibold">
              <button
                onClick={() => setActiveHotelFilter('ALL')}
                className={`px-2 py-1 rounded-md transition ${
                  activeHotelFilter === 'ALL'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                All (114)
              </button>
              <button
                onClick={() => setActiveHotelFilter('Saifee')}
                className={`px-2 py-1 rounded-md transition ${
                  activeHotelFilter === 'Saifee'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                Saifee (70)
              </button>
              <button
                onClick={() => setActiveHotelFilter('Burhani')}
                className={`px-2 py-1 rounded-md transition ${
                  activeHotelFilter === 'Burhani'
                    ? 'bg-[#124E39] text-white shadow-xs font-bold'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                Burhani (44)
              </button>
            </div>

            {/* Print and PDF Buttons */}
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-800 hover:bg-stone-900 text-white shadow-xs transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Slip</span>
            </button>

            <button
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>PDF</span>
            </button>
          </div>
        </div>

        {/* View Switcher Tabs (Print Prep Schedule vs Standard Roster) */}
        <div className="print:hidden flex items-center justify-between gap-3 pt-3 flex-wrap">
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
              <span>Room Turnover & Preparation Schedule (Housekeeping)</span>
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
              <span>Arrivals & Departures Roster</span>
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
        <div className="flex-1 overflow-y-auto mt-4 p-4 sm:p-6 bg-white border border-[#E6DFD5] rounded-xl shadow-xs space-y-6 print:m-0 print:p-0 print:border-none print:shadow-none">
          
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
              <span className="text-stone-500 text-[10px] uppercase font-bold block">New Arrivals Prep</span>
              <span className="text-base font-extrabold text-emerald-800">{newArrivalsPrepCount} Rooms ({arrivalsOnDate.length} Zaereen)</span>
              <span className="text-[10px] text-stone-500 block">Fresh arrival preparation</span>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">Checkout Cleaning</span>
              <span className="text-base font-extrabold text-amber-800">{checkoutCleansCount} Rooms ({departuresOnDate.length} Zaereen)</span>
              <span className="text-[10px] text-stone-500 block">Vacating to clean inventory</span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FAF7F2] border border-[#E6DFD5]">
              <span className="text-stone-500 text-[10px] uppercase font-bold block">Total Hotel Inventory</span>
              <span className="text-base font-extrabold text-[#124E39]">114 Official Rooms</span>
              <span className="text-[10px] text-stone-500 block">Saifee (70) • Burhani (44)</span>
            </div>
          </div>

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

              <div className="overflow-x-auto border border-stone-200 rounded-xl">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="bg-[#124E39] text-white uppercase text-[9px] font-bold">
                    <tr>
                      <th className="py-2.5 px-3 w-[15%]">Room & Hotel</th>
                      <th className="py-2.5 px-3 w-[14%]">Specs & Capacity</th>
                      <th className="py-2.5 px-3 w-[26%] bg-amber-950/40">Departures (Vacating Today)</th>
                      <th className="py-2.5 px-3 w-[26%] bg-emerald-950/40">Arrivals (New Zaereen)</th>
                      <th className="py-2.5 px-3 w-[19%]">Turnover Status & Checklist</th>
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
                                ? 'bg-purple-50/70 font-medium'
                                : item.actionType === 'new_arrival'
                                ? 'bg-emerald-50/40'
                                : item.actionType === 'departure_clean'
                                ? 'bg-amber-50/40'
                                : 'hover:bg-stone-50'
                            }`}
                          >
                            {/* 1. Room & Hotel */}
                            <td className="py-2.5 px-3 align-top">
                              <div className="font-serif font-extrabold text-sm text-[#124E39]">
                                Room {item.room.roomNumber}
                              </div>
                              <div className="text-[10px] text-stone-600 font-bold">
                                {item.room.building} Hotel • {item.room.floorLabel || `Floor ${item.room.floor}`}
                              </div>
                            </td>

                            {/* 2. Specs & Capacity */}
                            <td className="py-2.5 px-3 align-top">
                              <div className="font-bold text-stone-800">
                                Pax: {item.room.capacity}
                                {item.room.buffer ? (
                                  <span className="text-amber-700"> (+{item.room.buffer} Buf)</span>
                                ) : null}
                              </div>
                              <div className="text-[10px] text-stone-500">
                                🚽 {item.room.toiletType || 'Standard'}
                              </div>
                              <div className="text-[10px] text-stone-500">
                                🛏️ {item.room.bedType || 'Single Beds'}
                              </div>
                            </td>

                            {/* 3. Departures (Vacating Today) */}
                            <td className="py-2.5 px-3 align-top border-l border-amber-200/60">
                              {item.deps.length > 0 ? (
                                <div className="space-y-1.5">
                                  {item.deps.map((d, dIdx) => (
                                    <div key={dIdx} className="p-1 rounded bg-amber-100/70 border border-amber-300 text-amber-950">
                                      <div className="font-bold text-[11px] flex items-center justify-between">
                                        <span>{d.applicantName}</span>
                                        <span className="font-mono text-[10px] bg-amber-200 px-1 rounded">{d.family}</span>
                                      </div>
                                      <div className="text-[10px] text-amber-900 flex items-center gap-2">
                                        <span>ITS: {d.itsId}</span>
                                        <span>•</span>
                                        <span>Tour: {d.tourRefNo}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-stone-400 italic text-[10px]">
                                  No departure today
                                </span>
                              )}
                            </td>

                            {/* 4. Arrivals (New Zaereen) */}
                            <td className="py-2.5 px-3 align-top border-l border-emerald-200/60">
                              {item.arrs.length > 0 ? (
                                <div className="space-y-1.5">
                                  {item.arrs.map((a, aIdx) => (
                                    <div key={aIdx} className="p-1 rounded bg-emerald-100/70 border border-emerald-300 text-emerald-950">
                                      <div className="font-bold text-[11px] flex items-center justify-between">
                                        <span>{a.applicantName}</span>
                                        <span className="font-mono text-[10px] bg-emerald-200 px-1 rounded">{a.family}</span>
                                      </div>
                                      <div className="text-[10px] text-emerald-900 flex items-center gap-2">
                                        <span>ITS: {a.itsId}</span>
                                        <span>•</span>
                                        <span className="font-bold">{a.category}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-stone-400 italic text-[10px]">
                                  No new arrival today
                                </span>
                              )}
                            </td>

                            {/* 5. Turnover Status & Checklist */}
                            <td className="py-2.5 px-3 align-top border-l border-stone-200">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] border mb-1.5 ${item.actionBadge}`}>
                                {item.actionLabel}
                              </span>

                              {/* Housekeeping Checkboxes for printed slip */}
                              <div className="space-y-0.5 text-[9px] text-stone-600 font-medium">
                                <div className="flex items-center gap-1">
                                  <span className="inline-block w-3 h-3 border border-stone-400 rounded-2xs" />
                                  <span>Linen & Bed Fresh</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="inline-block w-3 h-3 border border-stone-400 rounded-2xs" />
                                  <span>Toilet Clean & Sanitized</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="inline-block w-3 h-3 border border-stone-400 rounded-2xs" />
                                  <span>Key Cards Ready</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-stone-400 italic">
                          No room preparation or turnover activity scheduled for the selected date.
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
                      <span>SAIFEE HOTEL — ROSTER</span>
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
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-[#124E39] text-white uppercase text-[9px] font-semibold">
                          <tr>
                            <th className="py-2 px-2.5">Room #</th>
                            <th className="py-2 px-2.5">Family</th>
                            <th className="py-2 px-2.5">Applicant / Guest</th>
                            <th className="py-2 px-2.5">ITS ID</th>
                            <th className="py-2 px-2.5">Tour Ref</th>
                            <th className="py-2 px-2.5">Office</th>
                            <th className="py-2 px-2.5">Category</th>
                            <th className="py-2 px-2.5">Money Given (B➔A)</th>
                            <th className="py-2 px-2.5">Dep Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {saifeeArrivals.length > 0 ? (
                            saifeeArrivals.map((r, i) => (
                              <tr key={i} className="hover:bg-emerald-50/40">
                                <td className="py-1.5 px-2.5 font-bold text-[#124E39]">
                                  {r.roomNumber ? `Room ${r.roomNumber}` : <span className="text-amber-700">Unallotted</span>}
                                </td>
                                <td className="py-1.5 px-2.5 font-mono text-stone-700">{r.family}</td>
                                <td className="py-1.5 px-2.5 font-semibold text-stone-900">{r.applicantName}</td>
                                <td className="py-1.5 px-2.5 font-mono text-stone-600">{r.itsId}</td>
                                <td className="py-1.5 px-2.5 text-stone-700">{r.tourRefNo}</td>
                                <td className="py-1.5 px-2.5 text-stone-600">{r.officeName}</td>
                                <td className="py-1.5 px-2.5">
                                  <span className="font-semibold text-emerald-800">{r.category}</span>
                                </td>
                                <td className="py-1.5 px-2.5">
                                  {r.category === 'B to A' ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.moneyGiven === 'Yes' ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'}`}>
                                      {r.moneyGiven === 'Yes' ? 'Paid ✓' : 'Pending ✗'}
                                    </span>
                                  ) : (
                                    <span className="text-stone-400">—</span>
                                  )}
                                </td>
                                <td className="py-1.5 px-2.5 text-stone-600">{r.departureDate}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={9} className="py-3 text-center text-stone-400 italic">
                                No arrivals scheduled for Saifee Hotel on this date
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Saifee Departures */}
                  <div>
                    <h4 className="text-xs font-bold text-amber-800 mb-1.5 flex items-center gap-1.5">
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Scheduled Departures ({saifeeDepartures.length})</span>
                    </h4>
                    <div className="overflow-x-auto border border-stone-200 rounded-lg">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-stone-700 text-white uppercase text-[9px] font-semibold">
                          <tr>
                            <th className="py-2 px-2.5">Room #</th>
                            <th className="py-2 px-2.5">Family</th>
                            <th className="py-2 px-2.5">Applicant / Guest</th>
                            <th className="py-2 px-2.5">ITS ID</th>
                            <th className="py-2 px-2.5">Tour Ref</th>
                            <th className="py-2 px-2.5">Office</th>
                            <th className="py-2 px-2.5">Check-out Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {saifeeDepartures.length > 0 ? (
                            saifeeDepartures.map((r, i) => (
                              <tr key={i} className="hover:bg-amber-50/40">
                                <td className="py-1.5 px-2.5 font-bold text-stone-900">
                                  {r.roomNumber ? `Room ${r.roomNumber}` : '—'}
                                </td>
                                <td className="py-1.5 px-2.5 font-mono text-stone-700">{r.family}</td>
                                <td className="py-1.5 px-2.5 font-semibold text-stone-900">{r.applicantName}</td>
                                <td className="py-1.5 px-2.5 font-mono text-stone-600">{r.itsId}</td>
                                <td className="py-1.5 px-2.5 text-stone-700">{r.tourRefNo}</td>
                                <td className="py-1.5 px-2.5 text-stone-600">{r.officeName}</td>
                                <td className="py-1.5 px-2.5 text-emerald-700 font-medium">Clear keys & prepare for cleaning</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={7} className="py-3 text-center text-stone-400 italic">
                                No departures scheduled for Saifee Hotel on this date
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
                      <span>BURHANI HOTEL — ROSTER</span>
                    </div>
                    <span className="text-xs font-semibold text-[#124E39]">
                      {burhaniArrivals.length} Arrivals • {burhaniDepartures.length} Departures
                    </span>
                  </div>

                  {/* Burhani Arrivals */}
                  <div>
                    <h4 className="text-xs font-bold text-emerald-800 mb-1.5 flex items-center gap-1.5">
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Room-wise Arrivals ({burhaniArrivals.length})</span>
                    </h4>
                    <div className="overflow-x-auto border border-stone-200 rounded-lg">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-[#124E39] text-white uppercase text-[9px] font-semibold">
                          <tr>
                            <th className="py-2 px-2.5">Room #</th>
                            <th className="py-2 px-2.5">Family</th>
                            <th className="py-2 px-2.5">Applicant / Guest</th>
                            <th className="py-2 px-2.5">ITS ID</th>
                            <th className="py-2 px-2.5">Tour Ref</th>
                            <th className="py-2 px-2.5">Office</th>
                            <th className="py-2 px-2.5">Category</th>
                            <th className="py-2 px-2.5">Money Given (B➔A)</th>
                            <th className="py-2 px-2.5">Dep Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {burhaniArrivals.length > 0 ? (
                            burhaniArrivals.map((r, i) => (
                              <tr key={i} className="hover:bg-emerald-50/40">
                                <td className="py-1.5 px-2.5 font-bold text-[#124E39]">
                                  {r.roomNumber ? `Room ${r.roomNumber}` : <span className="text-amber-700">Unallotted</span>}
                                </td>
                                <td className="py-1.5 px-2.5 font-mono text-stone-700">{r.family}</td>
                                <td className="py-1.5 px-2.5 font-semibold text-stone-900">{r.applicantName}</td>
                                <td className="py-1.5 px-2.5 font-mono text-stone-600">{r.itsId}</td>
                                <td className="py-1.5 px-2.5 text-stone-700">{r.tourRefNo}</td>
                                <td className="py-1.5 px-2.5 text-stone-600">{r.officeName}</td>
                                <td className="py-1.5 px-2.5">
                                  <span className="font-semibold text-emerald-800">{r.category}</span>
                                </td>
                                <td className="py-1.5 px-2.5">
                                  {r.category === 'B to A' ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.moneyGiven === 'Yes' ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'}`}>
                                      {r.moneyGiven === 'Yes' ? 'Paid ✓' : 'Pending ✗'}
                                    </span>
                                  ) : (
                                    <span className="text-stone-400">—</span>
                                  )}
                                </td>
                                <td className="py-1.5 px-2.5 text-stone-600">{r.departureDate}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={9} className="py-3 text-center text-stone-400 italic">
                                No arrivals scheduled for Burhani Hotel on this date
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Burhani Departures */}
                  <div>
                    <h4 className="text-xs font-bold text-amber-800 mb-1.5 flex items-center gap-1.5">
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Scheduled Departures ({burhaniDepartures.length})</span>
                    </h4>
                    <div className="overflow-x-auto border border-stone-200 rounded-lg">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-stone-700 text-white uppercase text-[9px] font-semibold">
                          <tr>
                            <th className="py-2 px-2.5">Room #</th>
                            <th className="py-2 px-2.5">Family</th>
                            <th className="py-2 px-2.5">Applicant / Guest</th>
                            <th className="py-2 px-2.5">ITS ID</th>
                            <th className="py-2 px-2.5">Tour Ref</th>
                            <th className="py-2 px-2.5">Office</th>
                            <th className="py-2 px-2.5">Check-out Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {burhaniDepartures.length > 0 ? (
                            burhaniDepartures.map((r, i) => (
                              <tr key={i} className="hover:bg-amber-50/40">
                                <td className="py-1.5 px-2.5 font-bold text-stone-900">
                                  {r.roomNumber ? `Room ${r.roomNumber}` : '—'}
                                </td>
                                <td className="py-1.5 px-2.5 font-mono text-stone-700">{r.family}</td>
                                <td className="py-1.5 px-2.5 font-semibold text-stone-900">{r.applicantName}</td>
                                <td className="py-1.5 px-2.5 font-mono text-stone-600">{r.itsId}</td>
                                <td className="py-1.5 px-2.5 text-stone-700">{r.tourRefNo}</td>
                                <td className="py-1.5 px-2.5 text-stone-600">{r.officeName}</td>
                                <td className="py-1.5 px-2.5 text-emerald-700 font-medium">Clear keys & prepare for cleaning</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={7} className="py-3 text-center text-stone-400 italic">
                                No departures scheduled for Burhani Hotel on this date
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
