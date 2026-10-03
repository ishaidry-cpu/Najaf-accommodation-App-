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
  const handleDownloadPdfSlip = (mode: 'tour' | 'single' = slipMode) => {
    const isTourMode = mode === 'tour' && selectedReservations.length > 1;

    if (!isTourMode) {
      // SINGLE MEMBER SLIP PDF (A5 portrait)
      const target = activeSingleZaer;
      const isPaid = target.moneyGiven === 'Yes';
      const slipNo = target.requestSlipNo || `SLIP-${target.family || 'FAM'}-${Date.now().toString().slice(-4)}`;

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a5',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Border
      doc.setDrawColor(18, 78, 57);
      doc.setLineWidth(2);
      doc.rect(15, 15, pageWidth - 30, pageHeight - 30);

      // Header Background
      doc.setFillColor(18, 78, 57);
      doc.rect(17, 17, pageWidth - 34, 55, 'F');

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('FAIZ HUSAINI — ACCOMMODATION OFFICE', pageWidth / 2, 38, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(235, 213, 158);
      doc.text('ACCOUNTS DEPARTMENT • CATEGORY B TO A SHIFT REQUEST SLIP', pageWidth / 2, 54, { align: 'center' });

      // Slip Number & Date
      doc.setFontSize(9);
      doc.setTextColor(18, 78, 57);
      doc.setFont('helvetica', 'bold');
      doc.text(`Slip No: ${slipNo}`, 30, 95);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth - 30, 95, { align: 'right' });

      // Divider
      doc.setDrawColor(203, 213, 225);
      doc.line(30, 105, pageWidth - 30, 105);

      // Details Grid
      let y = 125;
      const items = [
        ['ITS Id', target.itsId || '—'],
        ['Applicant Name', target.applicantName || '—'],
        ['Age / Gender', `${target.age || '—'} Yrs / ${target.gender || '—'}`],
        ['Category Request', 'Category B (Standard) ➔ Category A (Nizaam)'],
        ['Idara', target.idara || 'Faiz-e-Husaini'],
        ['Family Number', `Family #${target.family || '—'}`],
        ['Tour Reference No.', target.tourRefNo || '—'],
        ['Office Name', target.officeName || '—'],
        ['Group Lead Name', target.groupLeadName || target.applicantName || '—'],
        ['Arrival Date', target.arrivalDate || '—'],
        ['Departure Date', target.departureDate || '—'],
        ['Assigned Hotel & Room', `${target.building || 'Saifee'} Hotel — Room ${target.roomNumber || 'Pending'}`],
        ['Money Given Status', isPaid ? 'YES (FEE RECEIVED ✓)' : 'NO (PAYMENT PENDING ✗)'],
      ];

      items.forEach(([label, val]) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text(label, 30, y);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        if (label === 'Money Given Status') {
          if (isPaid) {
            doc.setTextColor(22, 101, 52); // green
          } else {
            doc.setTextColor(180, 83, 9); // amber
          }
        } else {
          doc.setTextColor(15, 23, 42);
        }
        doc.text(String(val), 160, y);

        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.5);
        doc.line(30, y + 4, pageWidth - 30, y + 4);

        y += 18;
      });

      // Accounts instructions box
      doc.setFillColor(245, 242, 235);
      doc.rect(30, y + 8, pageWidth - 60, 40, 'F');
      doc.setDrawColor(18, 78, 57);
      doc.rect(30, y + 8, pageWidth - 60, 40, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(18, 78, 57);
      doc.text('ACCOUNTS DEPARTMENT INSTRUCTION:', 38, y + 22);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text(
        'Please collect category B to A differential tariff and verify "Money Given" in accommodation portal.',
        38,
        y + 35
      );

      // Signatures
      const sigY = pageHeight - 65;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('_____________________________', 30, sigY);
      doc.text('Prepared by: Accommodation Desk', 30, sigY + 12);

      doc.text('_____________________________', pageWidth - 160, sigY);
      doc.text('Received by: Accounts Cashier', pageWidth - 160, sigY + 12);

      saveOrDownloadPdf(doc, `Faiz_Husaini_Accounts_Slip_${target.itsId || target.family || 'ZAER'}.pdf`);
      return;
    }

    // ==========================================
    // CONSOLIDATED TOUR ID PAYMENT SLIP (A4 Landscape)
    // ==========================================
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Top Header
    doc.setFillColor(18, 78, 57);
    doc.rect(0, 0, pageWidth, 55, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('FAIZ-E-HUSAINI — CONSOLIDATED TOUR ID B TO A SHIFT PAYMENT SLIP', pageWidth / 2, 24, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(235, 213, 158);
    doc.text(
      `TOUR ID: ${currentTourRef || '—'} • OFFICE: ${reservation.officeName || '—'} • ACCOUNTS PAYMENT & VERIFICATION MANIFEST`,
      pageWidth / 2,
      42,
      { align: 'center' }
    );

    // Summary Statistics Sub-bar
    doc.setFillColor(245, 242, 235);
    doc.rect(20, 65, pageWidth - 40, 26, 'F');
    doc.setDrawColor(18, 78, 57);
    doc.rect(20, 65, pageWidth - 40, 26, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(18, 78, 57);
    doc.text(`Total Tour Pilgrims Selected: ${selectedReservations.length} of ${tourMembers.length}`, 30, 81);
    doc.text(`Money Given (Paid): ${selectedPaidCount}`, pageWidth / 2 - 40, 81);
    doc.setTextColor(180, 83, 9);
    doc.text(`Payment Pending: ${selectedPendingCount}`, pageWidth - 190, 81);

    // Build Table Rows
    const tableRows = selectedReservations.map((r, idx) => {
      const roomStr = r.roomNumber ? `Rm ${r.roomNumber} (${r.building || 'Saifee'})` : 'Pending';
      const isPaid = r.moneyGiven === 'Yes';
      return [
        String(idx + 1),
        r.itsId || '—',
        r.applicantName || '—',
        `Fam #${r.family || '—'}`,
        `${r.age || '—'} / ${r.gender || '—'}`,
        roomStr,
        `${r.arrivalDate || '—'} ➔ ${r.departureDate || '—'}`,
        'B ➔ A (Nizaam)',
        isPaid ? 'PAID ✓ (FEE RECEIVED)' : 'PENDING ✗ (COLLECT)',
        '[ ] Verified / Stamp',
      ];
    });

    safeAutoTable(doc, {
      startY: 100,
      head: [['#', 'ITS ID', 'Applicant / Member Name', 'Family #', 'Age/Sex', 'Hotel & Room', 'Stay Dates', 'Shift Category', 'Payment Status', 'Accounts Sign']],
      body: tableRows.length > 0 ? tableRows : [['No members selected in this Tour ID', '', '', '', '', '', '', '', '', '']],
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 5, textColor: [30, 30, 30] },
      headStyles: { fillColor: [18, 78, 57], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
      columnStyles: {
        0: { cellWidth: 25, halign: 'center' },
        1: { fontStyle: 'bold', fontSize: 8, cellWidth: 60, halign: 'center' },
        2: { fontStyle: 'bold', fontSize: 8.5, cellWidth: 140 },
        3: { fontSize: 8, cellWidth: 60, halign: 'center' },
        4: { fontSize: 7.5, cellWidth: 55, halign: 'center' },
        5: { fontStyle: 'bold', fontSize: 8, cellWidth: 95 },
        6: { fontSize: 7.5, cellWidth: 110, halign: 'center' },
        7: { fontStyle: 'bold', fontSize: 7.5, cellWidth: 80, halign: 'center' },
        8: { fontStyle: 'bold', fontSize: 8, cellWidth: 100, halign: 'center' },
        9: { fontSize: 7, cellWidth: 75, halign: 'center' },
      },
    });

    let currentY = (doc as any).lastAutoTable?.finalY ?? 200;
    currentY += 15;

    if (currentY + 60 > pageHeight) {
      doc.addPage();
      currentY = 40;
    }

    // Accounts instruction & Signatures
    doc.setFillColor(245, 242, 235);
    doc.rect(20, currentY, pageWidth - 40, 24, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(18, 78, 57);
    doc.text('ACCOUNTS DIRECTIVE:', 30, currentY + 16);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(
      'Verify and collect differential payment for all chosen pilgrims shifted to Category A and reconcile against group roster.',
      140,
      currentY + 16
    );

    currentY += 40;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Accommodation Desk Officer: ___________________________', 40, currentY);
    doc.text(`Tour Coordinator: ___________________________ (${currentTourRef})`, pageWidth / 2 - 100, currentY);
    doc.text('Accounts Cashier Sign & Stamp: ___________________________', pageWidth - 260, currentY);

    const safeTourName = currentTourRef.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `Faiz_Husaini_Tour_${safeTourName}_B_to_A_Shift_Slip.pdf`;
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

          {/* Tour & Slip Meta */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-200 text-xs">
            <div>
              <span className="text-stone-500 block text-[10px]">Tour Reference:</span>
              <span className="font-mono font-bold text-[#124E39]">{currentTourRef || 'Unassigned Tour'}</span>
            </div>
            <div>
              <span className="text-stone-500 block text-[10px]">Office Name:</span>
              <span className="font-semibold text-stone-800">{reservation.officeName || '—'}</span>
            </div>
            <div>
              <span className="text-stone-500 block text-[10px]">Pilgrims Shifted:</span>
              <span className="font-bold text-emerald-800">
                {slipMode === 'tour' && selectedReservations.length > 1
                  ? `${selectedReservations.length} Selected (Tour Total: ${tourMembers.length})`
                  : '1 Individual Pilgrim'}
              </span>
            </div>
            <div>
              <span className="text-stone-500 block text-[10px]">Date of Slip:</span>
              <span className="font-medium text-stone-800">{new Date().toLocaleDateString()}</span>
            </div>
          </div>

          {/* MODE 1: TOUR MANIFEST TABLE (WHEN MULTIPLE/WHOLE TOUR CHOSEN) */}
          {slipMode === 'tour' && selectedReservations.length > 1 ? (
            <div className="space-y-3">
              <div className="overflow-x-auto border border-stone-300 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#124E39] text-white uppercase text-[10px] font-bold">
                    <tr>
                      <th className="py-2 px-2 text-center w-[5%]">#</th>
                      <th className="py-2 px-2 w-[12%]">ITS ID</th>
                      <th className="py-2 px-2 w-[25%]">Applicant Name</th>
                      <th className="py-2 px-2 w-[10%]">Family #</th>
                      <th className="py-2 px-2 w-[10%]">Age / Sex</th>
                      <th className="py-2 px-2 w-[16%]">Hotel & Room</th>
                      <th className="py-2 px-2 w-[12%] text-center">Shift Category</th>
                      <th className="py-2 px-2 w-[10%] text-center">Payment Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {selectedReservations.map((r, idx) => {
                      const isPaid = r.moneyGiven === 'Yes';
                      return (
                        <tr key={r.id} className="hover:bg-stone-50">
                          <td className="py-2 px-2 text-center font-mono text-stone-500">{idx + 1}</td>
                          <td className="py-2 px-2 font-mono font-bold text-stone-900">{r.itsId || '—'}</td>
                          <td className="py-2 px-2 font-bold text-stone-900">{r.applicantName}</td>
                          <td className="py-2 px-2 font-mono text-stone-700">Family #{r.family || '—'}</td>
                          <td className="py-2 px-2 text-stone-600">{r.age || '—'} / {r.gender || '—'}</td>
                          <td className="py-2 px-2 font-semibold text-stone-800">
                            {r.roomNumber ? `Rm ${r.roomNumber} (${r.building})` : 'Pending'}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-900 font-bold text-[10px]">
                              B ➔ A
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isPaid ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : 'bg-amber-100 text-amber-900 border border-amber-300'
                            }`}>
                              {isPaid ? 'Paid ✓' : 'Pending ✗'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Total Accounts Summary */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                <div>
                  <span className="font-bold text-emerald-900">Total Shifted to Category A:</span>{' '}
                  <span className="font-mono font-extrabold text-emerald-950">{selectedReservations.length} Zaereen</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-emerald-800">Fee Received (Paid): {selectedPaidCount}</span>
                  <span className="font-bold text-amber-800">Pending Collection: {selectedPendingCount}</span>
                </div>
              </div>
            </div>
          ) : (
            /* MODE 2: SINGLE PILGRIM SLIP VIEW */
            <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs pt-1">
              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">ITS ID:</div>
                <div className="font-mono font-bold text-stone-900 text-sm">{activeSingleZaer.itsId || '—'}</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Applicant Name:</div>
                <div className="font-semibold text-stone-900 text-sm">{activeSingleZaer.applicantName || '—'}</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Age / Gender:</div>
                <div className="text-stone-800">{activeSingleZaer.age || '—'} Yrs / {activeSingleZaer.gender || '—'}</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Category Shift Request:</div>
                <div className="font-bold text-purple-900">Category B (Standard) ➔ Category A (Nizaam)</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Family Number:</div>
                <div className="font-mono font-bold text-emerald-800">Family #{activeSingleZaer.family || '—'}</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Tour Reference No:</div>
                <div className="font-mono font-semibold text-stone-900">{activeSingleZaer.tourRefNo || '—'}</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Office Name:</div>
                <div className="text-stone-800">{activeSingleZaer.officeName || '—'}</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Group Lead Name:</div>
                <div className="text-stone-800">{activeSingleZaer.groupLeadName || activeSingleZaer.applicantName || '—'}</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Arrival Date:</div>
                <div className="text-stone-800">{activeSingleZaer.arrivalDate || '—'}</div>
              </div>

              <div className="border-b border-stone-100 pb-1.5">
                <div className="text-stone-500 text-[10px]">Departure Date:</div>
                <div className="text-stone-800">{activeSingleZaer.departureDate || '—'}</div>
              </div>

              <div className="col-span-2 bg-[#FAF7F2] p-2.5 rounded-lg border border-[#E6DFD5] flex items-center justify-between">
                <div>
                  <div className="text-stone-500 text-[10px]">Assigned Hotel & Room:</div>
                  <div className="font-bold text-[#124E39] text-xs">
                    {activeSingleZaer.building || 'Saifee'} Hotel — Room {activeSingleZaer.roomNumber || 'Pending Allotment'}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-stone-500 mb-0.5">Money Given Status:</div>
                  <button
                    type="button"
                    onClick={() => onToggleMoneyGiven(activeSingleZaer.id, activeSingleZaer.moneyGiven === 'Yes' ? 'No' : 'Yes')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition shadow-2xs ${
                      activeSingleZaer.moneyGiven === 'Yes'
                        ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                        : 'bg-amber-600 text-white hover:bg-amber-700'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Money Given: {activeSingleZaer.moneyGiven === 'Yes' ? 'Yes (Paid)' : 'No (Pending)'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

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
