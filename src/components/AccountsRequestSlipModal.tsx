import React, { useState, useMemo, useEffect } from 'react';
import { 
  FileText, 
  Printer, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Building2, 
  Calendar, 
  Users, 
  Receipt,
  Sparkles,
  Check,
  CheckSquare,
  Square,
  ArrowRight,
  Layers,
  UserCheck
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Reservation, MoneyGivenStatus } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';
import { saveOrDownloadPdf } from '../services/pdfExport';

function safeAutoTable(doc: jsPDF, options: any) {
  try {
    if (typeof (doc as any).autoTable === 'function') {
      (doc as any).autoTable(options);
    } else if (typeof autoTable === 'function') {
      autoTable(doc, options);
    } else if (typeof (autoTable as any)?.default === 'function') {
      (autoTable as any).default(doc, options);
    }
  } catch (err) {
    console.error('autoTable execution error:', err);
  }
}

interface AccountsRequestSlipModalProps {
  reservation: Reservation | null;
  allReservations?: Reservation[];
  onClose: () => void;
  onToggleMoneyGiven: (id: string, newStatus: MoneyGivenStatus) => void;
  onBatchShiftToCategoryA?: (ids: string[], moneyGiven: MoneyGivenStatus, notes?: string) => void;
}

export const AccountsRequestSlipModal: React.FC<AccountsRequestSlipModalProps> = ({
  reservation,
  allReservations = [],
  onClose,
  onToggleMoneyGiven,
  onBatchShiftToCategoryA,
}) => {
  if (!reservation) return null;

  // Active tour reference
  const currentTourRef = (reservation.tourRefNo || reservation.tourId || '').trim();

  // Find all members in this Tour ID across reservations
  const tourMembers = useMemo(() => {
    if (!currentTourRef || allReservations.length === 0) return [reservation];
    const tNorm = currentTourRef.toLowerCase();
    const members = allReservations.filter(
      (r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === tNorm
    );
    return members.length > 0 ? members : [reservation];
  }, [currentTourRef, allReservations, reservation]);

  // Selected members who want to shift to Category A
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  // Print / Display mode: 'single' (focused on current zaer) or 'tour' (consolidated tour manifest)
  const [slipMode, setSlipMode] = useState<'tour' | 'single'>('tour');
  const [activeSingleZaerId, setActiveSingleZaerId] = useState<string>(reservation.id);
  const [searchMemberQuery, setSearchMemberQuery] = useState('');

  // Initialize selected members with everyone in the Tour ID or the primary zaer
  useEffect(() => {
    if (reservation) {
      setActiveSingleZaerId(reservation.id);
      // Default to selecting all members of this Tour ID so the officer can shift whole tour with 1 click or deselect
      setSelectedMemberIds(tourMembers.map((m) => m.id));
    }
  }, [reservation?.id, currentTourRef]);

  // The active single zaer for single-slip mode
  const activeSingleZaer = useMemo(() => {
    return tourMembers.find((m) => m.id === activeSingleZaerId) || reservation;
  }, [tourMembers, activeSingleZaerId, reservation]);

  // Filtered tour members for the checklist
  const filteredTourMembers = useMemo(() => {
    if (!searchMemberQuery.trim()) return tourMembers;
    const q = searchMemberQuery.toLowerCase();
    return tourMembers.filter(
      (m) =>
        m.applicantName.toLowerCase().includes(q) ||
        (m.itsId || '').toLowerCase().includes(q) ||
        (m.family || '').toLowerCase().includes(q) ||
        (m.roomNumber || '').toLowerCase().includes(q)
    );
  }, [tourMembers, searchMemberQuery]);

  // Toggle individual member selection
  const handleToggleMember = (id: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Select all members in the tour
  const handleSelectAllTour = () => {
    setSelectedMemberIds(tourMembers.map((m) => m.id));
    setSlipMode('tour');
  };

  // Select same family members
  const handleSelectSameFamily = () => {
    const fam = (reservation.family || '').trim().toLowerCase();
    const sameFam = tourMembers.filter((m) => (m.family || '').trim().toLowerCase() === fam);
    setSelectedMemberIds(sameFam.map((m) => m.id));
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedMemberIds([]);
  };

  // The list of selected reservation objects
  const selectedReservations = useMemo(() => {
    const idSet = new Set(selectedMemberIds);
    return tourMembers.filter((m) => idSet.has(m.id));
  }, [tourMembers, selectedMemberIds]);

  // Count paid vs pending among selected
  const selectedPaidCount = selectedReservations.filter((r) => r.moneyGiven === 'Yes').length;
  const selectedPendingCount = selectedReservations.length - selectedPaidCount;

  // Batch apply shift to Category A
  const handleApplyShiftToSelected = (markPaid: boolean = true) => {
    if (selectedMemberIds.length === 0) {
      alert('Please select at least one member to shift to Category A.');
      return;
    }
    if (onBatchShiftToCategoryA) {
      onBatchShiftToCategoryA(
        selectedMemberIds,
        markPaid ? 'Yes' : 'No',
        `Category B to A shift requested via Tour Slip (${selectedMemberIds.length} zaereen)`
      );
    } else {
      // Fallback
      selectedMemberIds.forEach((id) => onToggleMoneyGiven(id, markPaid ? 'Yes' : 'No'));
    }
  };

  // Batch toggle money given for all selected
  const handleBatchToggleMoney = (status: MoneyGivenStatus) => {
    if (selectedMemberIds.length === 0) return;
    if (onBatchShiftToCategoryA) {
      onBatchShiftToCategoryA(selectedMemberIds, status);
    } else {
      selectedMemberIds.forEach((id) => onToggleMoneyGiven(id, status));
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // ==========================================
  // PDF GENERATION: ACCORDING TO USER CHOICE
  // ==========================================
  const calculateNights = (arr?: string, dep?: string): number => {
    if (!arr || !dep) return 1;
    const d1 = new Date(arr.slice(0, 10));
    const d2 = new Date(dep.slice(0, 10));
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
    const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
    return Math.max(1, diffDays);
  };

  const formatRoomGivenIn = (r: Reservation): string => {
    if (r.roomNumber && r.building) {
      return `Room ${r.roomNumber} (${r.building} Hotel)`;
    }
    if (r.roomNumber) {
      return `Room ${r.roomNumber}`;
    }
    if (r.building) {
      return `${r.building} Hotel (Room Pending)`;
    }
    return 'Room Pending Allotment';
  };

  const formatTourRoomsGivenIn = (list: Reservation[]): string => {
    const roomsSet = new Set<string>();
    list.forEach((r) => {
      if (r.roomNumber) {
        roomsSet.add(`Room ${r.roomNumber} (${r.building || 'Saifee'} Hotel)`);
      } else if (r.building) {
        roomsSet.add(`${r.building} Hotel (Pending)`);
      }
    });
    return roomsSet.size > 0 ? Array.from(roomsSet).join(', ') : 'Room Pending Allotment';
  };

  // Determine current slip values
  const isTourSlip = slipMode === 'tour' && selectedReservations.length > 1;

  const tourIdVal = isTourSlip
    ? (currentTourRef || reservation.tourRefNo || reservation.tourId || '—')
    : (activeSingleZaer.tourRefNo || activeSingleZaer.tourId || currentTourRef || '—');

  const paxVal = isTourSlip
    ? selectedReservations.reduce((sum, r) => sum + (r.paxCount || r.pax || 1), 0)
    : (activeSingleZaer.paxCount || activeSingleZaer.pax || 1);

  const arrVal = isTourSlip
    ? (reservation.arrivalDate || '—')
    : (activeSingleZaer.arrivalDate || '—');

  const depVal = isTourSlip
    ? (reservation.departureDate || '—')
    : (activeSingleZaer.departureDate || '—');

  const nightsVal = isTourSlip
    ? calculateNights(reservation.arrivalDate, reservation.departureDate)
    : calculateNights(activeSingleZaer.arrivalDate, activeSingleZaer.departureDate);

  const roomVal = isTourSlip
    ? formatTourRoomsGivenIn(selectedReservations)
    : formatRoomGivenIn(activeSingleZaer);

  const slipNo = isTourSlip
    ? (reservation.requestSlipNo || `SLIP-TOUR-${Date.now().toString().slice(-4)}`)
    : (activeSingleZaer.requestSlipNo || `SLIP-${Date.now().toString().slice(-4)}`);

  // ==========================================
  // PDF GENERATION: EXACT 7 DETAILS REQUESTED BY USER
  // 1. Tour ID
  // 2. Number of pax
  // 3. Number of nights
  // 4. Amount (Keep it blank to be filled by accounts)
  // 5. Date of arrival
  // 6. Date of departure
  // 7. Room given in
  // ==========================================
  const handleDownloadPdfSlip = (mode: 'tour' | 'single' = slipMode) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Elegant Outer Border
    doc.setDrawColor(18, 78, 57);
    doc.setLineWidth(2);
    doc.rect(25, 25, pageWidth - 50, pageHeight - 50);

    // Inner Thin Border
    doc.setDrawColor(197, 160, 89); // Gold
    doc.setLineWidth(0.75);
    doc.rect(29, 29, pageWidth - 58, pageHeight - 58);

    // Top Header Banner
    doc.setFillColor(18, 78, 57);
    doc.rect(30, 30, pageWidth - 60, 65, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('FAIZ HUSAINI — ACCOMMODATION OFFICE', pageWidth / 2, 54, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(235, 213, 158);
    doc.text('CATEGORY B TO A ACCOMMODATION SHIFT SLIP', pageWidth / 2, 72, { align: 'center' });

    doc.setFontSize(8);
    doc.setTextColor(200, 225, 210);
    doc.text('ACCOUNTS DEPARTMENT PAYMENT & SHIFT RECORD', pageWidth / 2, 85, { align: 'center' });

    // Slip Meta Info
    doc.setTextColor(18, 78, 57);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`Slip No: ${slipNo}`, 45, 120);

    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Date of Issue: ${new Date().toLocaleDateString()}`, pageWidth - 45, 120, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(1);
    doc.line(45, 128, pageWidth - 45, 128);

    // EXACT 7 DETAILS TABLE AS REQUESTED BY USER
    const tableBody = [
      ['Tour ID', tourIdVal],
      ['Number of pax', `${paxVal} Pax`],
      ['Number of nights', `${nightsVal} Nights`],
      ['Amount (Keep it blank to be filled by accounts)', '$  __________________________________'],
      ['Date of arrival', arrVal],
      ['Date of departure', depVal],
      ['Room given in', roomVal],
    ];

    safeAutoTable(doc, {
      startY: 145,
      head: [['SHIFT SLIP DETAIL', 'OFFICIAL SPECIFICATION']],
      body: tableBody,
      margin: { left: 45, right: 45 },
      theme: 'grid',
      styles: {
        fontSize: 10,
        cellPadding: 10,
        textColor: [30, 41, 59],
        lineColor: [203, 213, 225],
        lineWidth: 0.75,
      },
      headStyles: {
        fillColor: [18, 78, 57],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 10,
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 230, fillColor: [248, 250, 252] },
        1: { fontStyle: 'bold', fontSize: 10.5, textColor: [15, 23, 42] },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === 3) {
          // Amount row: format specially for accounts handwritten entry
          data.cell.styles.textColor = [100, 116, 139];
          data.cell.styles.fontStyle = 'normal';
        }
      },
    });

    const finalTableY = (doc as any).lastAutoTable?.finalY ?? 380;

    // Accounts Box for Writing / Notes
    const boxY = finalTableY + 25;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(45, boxY, pageWidth - 90, 75, 4, 4, 'F');
    doc.setDrawColor(18, 78, 57);
    doc.setLineWidth(1);
    doc.roundedRect(45, boxY, pageWidth - 90, 75, 4, 4, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(18, 78, 57);
    doc.text('FOR ACCOUNTS DEPARTMENT USE ONLY:', 58, boxY + 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text('1. Calculate and fill B to A differential tariff in "Amount" field above.', 58, boxY + 36);
    doc.text('2. Amount Collected: $_________________________   Receipt No: _________________________', 58, boxY + 52);
    doc.text('3. Collect money and reconcile against Faiz-e-Husaini Accommodation records.', 58, boxY + 66);

    // Signatures Section at Bottom
    const sigY = pageHeight - 90;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.5);
    doc.line(45, sigY - 15, pageWidth - 45, sigY - 15);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);

    doc.text('_____________________________________', 55, sigY + 15);
    doc.text('Prepared By: Accommodation Desk Officer', 55, sigY + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Faiz-e-Husaini Najaf Office', 55, sigY + 43);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    doc.text('_____________________________________', pageWidth - 235, sigY + 15);
    doc.text('Received & Verified By: Accounts Cashier', pageWidth - 235, sigY + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Official Stamp & Signature', pageWidth - 235, sigY + 43);

    const safeTourName = tourIdVal.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `Faiz_Husaini_B_to_A_Shift_Slip_${safeTourName}.pdf`;
    saveOrDownloadPdf(doc, fileName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* Print Specific CSS */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden;
          }
          #accounts-slip-print-area, #accounts-slip-print-area * {
            visibility: visible;
          }
          #accounts-slip-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 15px;
            background: white !important;
          }
          .print-hidden {
            display: none !important;
          }
        }
      `}} />

      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-5xl w-full p-4 sm:p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[95vh] overflow-hidden">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="print-hidden absolute top-4 right-4 text-stone-500 hover:text-stone-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition cursor-pointer z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Top Header (Hidden in Print) */}
        <div className="print-hidden flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-stone-200 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FaizHusainiLogo size="sm" showSubtitle={false} />
              <h3 className="text-base font-bold text-[#124E39]">
                Category B to A Shift & Accounts Payment Slip
              </h3>
            </div>
            <p className="text-xs text-stone-600 mt-0.5">
              Tour Reference: <span className="font-mono font-bold text-stone-900">{currentTourRef || 'Individual Allotment'}</span> • Shift whole Tour ID or choose specific zaereen.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap mr-8">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-stone-800 hover:bg-stone-900 text-white shadow-xs transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Slip</span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadPdfSlip(slipMode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-xs transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{slipMode === 'tour' && selectedReservations.length > 1 ? 'Tour Slip (PDF)' : 'Single Slip (PDF)'}</span>
            </button>
          </div>
        </div>

        {/* Mode Selector & Quick Action Bar (Hidden in Print) */}
        <div className="print-hidden bg-stone-100/80 p-3 rounded-xl border border-stone-200 mt-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-stone-300 text-xs font-bold shadow-2xs">
              <button
                type="button"
                onClick={() => setSlipMode('tour')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  slipMode === 'tour'
                    ? 'bg-[#124E39] text-white shadow-xs'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>Tour ID Group View ({tourMembers.length} in Tour)</span>
              </button>
              <button
                type="button"
                onClick={() => setSlipMode('single')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  slipMode === 'single'
                    ? 'bg-[#124E39] text-white shadow-xs'
                    : 'text-stone-700 hover:text-stone-900'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5 text-[#EBD59E]" />
                <span>Single Zaer Slip</span>
              </button>
            </div>

            {/* Quick 1-Click Buttons for Whole Tour ID Shift */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={handleSelectAllTour}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-2xs transition cursor-pointer"
                title="Select all members of this Tour ID to shift to Category A"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Shift Whole Tour ID ({tourMembers.length})</span>
              </button>
              <button
                type="button"
                onClick={handleSelectSameFamily}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white hover:bg-stone-50 text-stone-700 border border-stone-300 transition cursor-pointer"
              >
                Family #{reservation.family || 'Fam'} Only
              </button>
              <button
                type="button"
                onClick={handleClearSelection}
                className="px-2 py-1.5 rounded-lg text-xs font-semibold text-stone-500 hover:text-stone-800 transition cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Tour ID Members Selection Box */}
          <div className="bg-white rounded-xl border border-stone-200 p-2.5 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1.5 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-stone-800">
                  Choose Who Wants to Shift in Tour <span className="font-mono text-[#124E39]">{currentTourRef || 'ID'}</span>:
                </span>
                <span className="text-[11px] font-bold text-[#124E39] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {selectedMemberIds.length} of {tourMembers.length} Selected
                </span>
              </div>

              {/* Action Buttons to Apply Shift to Selected */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleApplyShiftToSelected(true)}
                  disabled={selectedMemberIds.length === 0}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white shadow-2xs transition cursor-pointer"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Shift Selected ({selectedMemberIds.length}) & Mark Paid</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyShiftToSelected(false)}
                  disabled={selectedMemberIds.length === 0}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 disabled:opacity-50 transition cursor-pointer"
                >
                  Shift as Pending
                </button>
              </div>
            </div>

            {/* Checklist of Tour Members */}
            <div className="max-h-40 overflow-y-auto space-y-1 divide-y divide-stone-100 pr-1">
              {filteredTourMembers.map((member) => {
                const isSelected = selectedMemberIds.includes(member.id);
                const isPaid = member.moneyGiven === 'Yes';
                const isShifted = member.shiftToCategoryA || member.category === 'B to A' || member.accommodationCategory === 'Category A (Nizaam)';

                return (
                  <div
                    key={member.id}
                    className={`flex items-center justify-between p-1.5 rounded-lg transition text-xs ${
                      isSelected ? 'bg-emerald-50/60 font-semibold' : 'hover:bg-stone-50'
                    }`}
                  >
                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleMember(member.id)}
                        className="rounded text-[#124E39] focus:ring-[#124E39] w-3.5 h-3.5"
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-stone-900">{member.applicantName}</span>
                        <span className="font-mono text-stone-500 text-[11px]">ITS: {member.itsId || '—'}</span>
                        <span className="font-mono text-stone-600 text-[11px] bg-stone-100 px-1 rounded">
                          Fam #{member.family || '—'}
                        </span>
                        <span className="text-[11px] text-stone-500">
                          {member.roomNumber ? `Rm ${member.roomNumber} (${member.building})` : 'Room Pending'}
                        </span>
                      </div>
                    </label>

                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        isShifted ? 'bg-purple-100 text-purple-900 border border-purple-200' : 'bg-stone-100 text-stone-600'
                      }`}>
                        {isShifted ? 'Cat A (Shifted)' : 'Cat B'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onToggleMoneyGiven(member.id, isPaid ? 'No' : 'Yes')}
                        className={`text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                          isPaid
                            ? 'bg-emerald-100 text-emerald-950 border border-emerald-300 hover:bg-emerald-200'
                            : 'bg-amber-100 text-amber-950 border border-amber-300 hover:bg-amber-200'
                        }`}
                        title="Click to toggle Money Given status for this zaer"
                      >
                        {isPaid ? 'Paid ✓' : 'Pending ✗'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Printable Slip Paper View (Reflects Single or Tour Selection) */}
        <div
          id="accounts-slip-print-area"
          className="flex-1 overflow-y-auto mt-3 p-4 sm:p-6 bg-white border border-[#E6DFD5] rounded-xl shadow-xs text-xs space-y-4"
        >
          {/* Official Header */}
          <div className="text-center pb-3 border-b-2 border-[#124E39]">
            <div className="flex justify-center mb-1">
              <FaizHusainiLogo size="md" />
            </div>
            <div className="inline-block bg-[#124E39] text-[#EBD59E] font-bold text-xs uppercase px-3 py-1 rounded-md tracking-wider mt-1">
              {slipMode === 'tour' && selectedReservations.length > 1
                ? 'ACCOUNTS DEPARTMENT — CONSOLIDATED TOUR B TO A SHIFT PAYMENT SLIP'
                : 'ACCOUNTS DEPARTMENT — PILGRIM B TO A SHIFT REQUEST SLIP'}
            </div>
            <div className="text-xs font-semibold text-stone-600 mt-1">
              Official Shift Request: <strong className="text-stone-900">Category B (Standard) ➔ Category A (Nizaam)</strong> • Faiz-e-Husaini Najaf
            </div>
          </div>

          {/* Slip Reference & Date Header */}
          <div className="flex items-center justify-between bg-stone-50 px-4 py-2 rounded-lg border border-stone-200 text-xs">
            <div>
              <span className="text-stone-500 text-[11px] block">Slip Reference No:</span>
              <span className="font-mono font-bold text-[#124E39] text-sm">{slipNo}</span>
            </div>
            <div className="text-right">
              <span className="text-stone-500 text-[11px] block">Date of Issue:</span>
              <span className="font-semibold text-stone-800 text-sm">{new Date().toLocaleDateString()}</span>
            </div>
          </div>

          {/* EXACT 7 DETAILS TABLE AS REQUESTED BY USER */}
          <div className="overflow-x-auto border-2 border-[#124E39]/30 rounded-xl shadow-xs">
            <table className="w-full text-left text-sm border-collapse bg-white">
              <thead>
                <tr className="bg-[#124E39] text-[#EBD59E]">
                  <th className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider w-[44%]">
                    Shift Slip Detail
                  </th>
                  <th className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider w-[56%]">
                    Official Specification
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                <tr className="hover:bg-stone-50/70 transition">
                  <td className="py-3 px-4 font-semibold text-stone-700 bg-stone-50/50">
                    Tour ID
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-base text-[#124E39]">
                    {tourIdVal}
                  </td>
                </tr>

                <tr className="hover:bg-stone-50/70 transition">
                  <td className="py-3 px-4 font-semibold text-stone-700 bg-stone-50/50">
                    Number of pax
                  </td>
                  <td className="py-3 px-4 font-bold text-stone-900 text-sm">
                    {paxVal} Pax
                  </td>
                </tr>

                <tr className="hover:bg-stone-50/70 transition">
                  <td className="py-3 px-4 font-semibold text-stone-700 bg-stone-50/50">
                    Number of nights
                  </td>
                  <td className="py-3 px-4 font-bold text-stone-900 text-sm">
                    {nightsVal} Nights
                  </td>
                </tr>

                <tr className="bg-amber-50/40 hover:bg-amber-50/70 transition">
                  <td className="py-3 px-4 font-semibold text-stone-800 bg-amber-50/60">
                    Amount <span className="text-[11px] font-normal text-stone-500 block sm:inline">(Keep it blank to be filled by accounts)</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-stone-400 text-base">$</span>
                      <div className="h-8 w-56 border-b-2 border-stone-400 border-dashed bg-white/80 rounded px-2 flex items-center text-xs text-stone-400 italic">
                        Blank for Accounts
                      </div>
                    </div>
                  </td>
                </tr>

                <tr className="hover:bg-stone-50/70 transition">
                  <td className="py-3 px-4 font-semibold text-stone-700 bg-stone-50/50">
                    Date of arrival
                  </td>
                  <td className="py-3 px-4 font-medium text-stone-900 text-sm">
                    {arrVal}
                  </td>
                </tr>

                <tr className="hover:bg-stone-50/70 transition">
                  <td className="py-3 px-4 font-semibold text-stone-700 bg-stone-50/50">
                    Date of departure
                  </td>
                  <td className="py-3 px-4 font-medium text-stone-900 text-sm">
                    {depVal}
                  </td>
                </tr>

                <tr className="hover:bg-stone-50/70 transition">
                  <td className="py-3 px-4 font-semibold text-stone-700 bg-stone-50/50">
                    Room given in
                  </td>
                  <td className="py-3 px-4 font-bold text-[#124E39] text-sm">
                    {roomVal}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Accounts Notice */}
          <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-300 text-xs text-stone-700">
            <strong>Accounts Department Directive:</strong> Please collect the category B to A differential tariff, issue payment receipt, and reconcile against official group records.
          </div>

          {/* Signatures */}
          <div className="pt-4 border-t border-stone-200 grid grid-cols-2 sm:grid-cols-3 gap-4 text-[10px] text-stone-500">
            <div>
              <div className="border-b border-stone-300 w-36 mb-1" />
              <div>Prepared By: Accommodation Officer</div>
            </div>
            <div>
              <div className="border-b border-stone-300 w-36 mb-1" />
              <div>Tour Coordinator Received</div>
            </div>
            <div className="sm:text-right">
              <div className="border-b border-stone-300 w-36 mb-1 sm:ml-auto" />
              <div>Accounts Cashier Verification & Stamp</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
