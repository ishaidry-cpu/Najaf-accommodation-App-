import React, { useState, useMemo, useEffect } from 'react';
import {
  FileText,
  Printer,
  Download,
  CheckCircle2,
  X,
  Receipt,
  Sparkles,
  Layers,
  UserCheck,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
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

export type SlipDirection = 'B_TO_A' | 'A_TO_B';

interface AccountsRequestSlipModalProps {
  isOpen?: boolean;
  reservation: Reservation | null;
  allReservations?: Reservation[];
  initialDirection?: SlipDirection;
  initialSelectedIds?: string[];
  onClose: () => void;
  onToggleMoneyGiven: (id: string, newStatus: MoneyGivenStatus) => void;
  onToggleRefundGiven?: (id: string, newStatus: MoneyGivenStatus) => void;
  onBatchShiftToCategoryA?: (ids: string[], moneyGiven: MoneyGivenStatus, notes?: string) => void;
  onBatchShiftToCategoryB?: (ids: string[], refundGiven: MoneyGivenStatus, notes?: string) => void;
}

export const AccountsRequestSlipModal: React.FC<AccountsRequestSlipModalProps> = ({
  isOpen,
  reservation,
  allReservations = [],
  initialDirection = 'B_TO_A',
  initialSelectedIds,
  onClose,
  onToggleMoneyGiven,
  onToggleRefundGiven,
  onBatchShiftToCategoryA,
  onBatchShiftToCategoryB,
}) => {
  const modalOpen = isOpen !== undefined ? isOpen : Boolean(reservation);

  const [direction, setDirection] = useState<SlipDirection>(initialDirection);
  const [selectedTourFilter, setSelectedTourFilter] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [slipMode, setSlipMode] = useState<'tour' | 'single'>('tour');
  const [activeSingleZaerId, setActiveSingleZaerId] = useState<string>('');
  const [searchMemberQuery, setSearchMemberQuery] = useState('');
  const [accountsAmountNote, setAccountsAmountNote] = useState('');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Distinct Tour IDs across portal
  const distinctTourOptions = useMemo(() => {
    const counts = new Map<string, number>();
    allReservations.forEach((r) => {
      const t = (r.tourRefNo || r.tourId || '').trim();
      if (t) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .map(([tourId, count]) => ({ tourId, count }))
      .sort((a, b) => a.tourId.localeCompare(b.tourId));
  }, [allReservations]);

  // Synchronize modal initialization whenever opened or target changes
  useEffect(() => {
    if (!modalOpen) return;

    setDirection(initialDirection);
    setAccountsAmountNote('');
    setSearchMemberQuery('');
    setActionFeedback(null);

    const fallbackRes = reservation || allReservations[0] || null;
    const tourRef = (fallbackRes?.tourRefNo || fallbackRes?.tourId || '').trim();

    if (initialSelectedIds && initialSelectedIds.length > 0) {
      const firstMatch = allReservations.find((r) => initialSelectedIds.includes(r.id)) || fallbackRes;
      const firstTour = (firstMatch?.tourRefNo || firstMatch?.tourId || '').trim();
      const allSameTour = initialSelectedIds.every((id) => {
        const rec = allReservations.find((r) => r.id === id);
        return !rec || (rec.tourRefNo || rec.tourId || '').trim() === firstTour;
      });
      setSelectedTourFilter(allSameTour && firstTour ? firstTour : 'ALL');
      setSelectedMemberIds(initialSelectedIds);
      setActiveSingleZaerId(firstMatch?.id || initialSelectedIds[0]);
      setSlipMode(initialSelectedIds.length === 1 ? 'single' : 'tour');
      return;
    }

    if (reservation) {
      setSelectedTourFilter(tourRef || 'ALL');
      setActiveSingleZaerId(reservation.id);
      const tNorm = tourRef.toLowerCase();
      const sameTourMembers = tourRef
        ? allReservations.filter((r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === tNorm)
        : [reservation];
      const list = sameTourMembers.length > 0 ? sameTourMembers : [reservation];
      if (initialDirection === 'A_TO_B') {
        const fam = (reservation.family || '').trim().toLowerCase();
        const sameFam = fam
          ? list.filter((m) => (m.family || '').trim().toLowerCase() === fam)
          : [reservation];
        setSelectedMemberIds(sameFam.length > 0 ? sameFam.map((m) => m.id) : [reservation.id]);
        setSlipMode('tour');
      } else {
        setSelectedMemberIds(list.map((m) => m.id));
        setSlipMode(list.length > 1 ? 'tour' : 'single');
      }
    } else if (fallbackRes) {
      setSelectedTourFilter(tourRef || 'ALL');
      setActiveSingleZaerId(fallbackRes.id);
      const tNorm = tourRef.toLowerCase();
      const sameTourMembers = tourRef
        ? allReservations.filter((r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === tNorm)
        : [fallbackRes];
      setSelectedMemberIds(sameTourMembers.slice(0, 1).map((m) => m.id));
      setSlipMode('tour');
    } else {
      setSelectedTourFilter('ALL');
      setSelectedMemberIds([]);
      setActiveSingleZaerId('');
    }
  }, [modalOpen, reservation?.id, initialDirection, initialSelectedIds]);

  // Pool of members for the chosen Tour Filter (or All Tours)
  const poolMembers = useMemo(() => {
    if (allReservations.length === 0) {
      return reservation ? [reservation] : [];
    }
    if (!selectedTourFilter || selectedTourFilter === 'ALL') {
      return allReservations;
    }
    const tNorm = selectedTourFilter.trim().toLowerCase();
    const matches = allReservations.filter(
      (r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === tNorm
    );
    return matches.length > 0 ? matches : reservation ? [reservation] : [];
  }, [allReservations, selectedTourFilter, reservation]);

  // Filtered checklist members by search query
  const filteredPoolMembers = useMemo(() => {
    if (!searchMemberQuery.trim()) return poolMembers;
    const q = searchMemberQuery.toLowerCase();
    return poolMembers.filter(
      (m) =>
        (m.applicantName || '').toLowerCase().includes(q) ||
        (m.itsId || '').toLowerCase().includes(q) ||
        String(m.age || '').toLowerCase().includes(q) ||
        (m.family || '').toLowerCase().includes(q) ||
        (m.tourRefNo || '').toLowerCase().includes(q) ||
        (m.officeName || '').toLowerCase().includes(q) ||
        (m.roomNumber || '').toLowerCase().includes(q)
    );
  }, [poolMembers, searchMemberQuery]);

  // Primary anchor reservation
  const anchorReservation = useMemo(() => {
    const firstSelected = allReservations.find((r) => selectedMemberIds.includes(r.id));
    return firstSelected || reservation || poolMembers[0] || allReservations[0] || null;
  }, [allReservations, selectedMemberIds, reservation, poolMembers]);

  // Selected reservation objects (in stable list order)
  const selectedReservations = useMemo(() => {
    const idSet = new Set(selectedMemberIds);
    const source = allReservations.length > 0 ? allReservations : poolMembers;
    return source.filter((m) => idSet.has(m.id));
  }, [allReservations, poolMembers, selectedMemberIds]);

  const activeSingleZaer = useMemo(() => {
    return (
      allReservations.find((m) => m.id === activeSingleZaerId) ||
      selectedReservations[0] ||
      anchorReservation
    );
  }, [allReservations, activeSingleZaerId, selectedReservations, anchorReservation]);

  // Effective pax roster shown on the receipt
  const effectiveSlipPaxList = useMemo(() => {
    if (slipMode === 'single') {
      return activeSingleZaer ? [activeSingleZaer] : [];
    }
    if (selectedReservations.length > 0) return selectedReservations;
    return anchorReservation ? [anchorReservation] : [];
  }, [slipMode, activeSingleZaer, selectedReservations, anchorReservation]);

  // Toggle individual member selection
  const handleToggleMember = (id: string) => {
    setSelectedMemberIds((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      if (next.length > 0 && !next.includes(activeSingleZaerId)) {
        setActiveSingleZaerId(next[0]);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    const ids = filteredPoolMembers.map((m) => m.id);
    setSelectedMemberIds(ids);
    if (ids.length > 0) setActiveSingleZaerId(ids[0]);
    setSlipMode('tour');
  };

  const handleSelectSameFamily = () => {
    const ref = anchorReservation;
    if (!ref) return;
    const fam = (ref.family || '').trim().toLowerCase();
    const tour = (ref.tourRefNo || ref.tourId || '').trim().toLowerCase();
    const sameFam = poolMembers.filter(
      (m) =>
        (m.family || '').trim().toLowerCase() === fam &&
        (!tour || (m.tourRefNo || m.tourId || '').trim().toLowerCase() === tour)
    );
    setSelectedMemberIds(sameFam.map((m) => m.id));
    setSlipMode('tour');
  };

  const handleClearSelection = () => {
    setSelectedMemberIds([]);
  };

  // Handle batch shift action depending on direction
  const handleApplyShiftAction = (markSettled: boolean) => {
    if (selectedMemberIds.length === 0) return;

    if (direction === 'A_TO_B') {
      if (onBatchShiftToCategoryB) {
        onBatchShiftToCategoryB(
          selectedMemberIds,
          markSettled ? 'Yes' : 'No',
          accountsAmountNote.trim() || `Category A to B Refund Receipt (${selectedMemberIds.length} pax)`
        );
      } else if (onToggleRefundGiven) {
        selectedMemberIds.forEach((id) => onToggleRefundGiven(id, markSettled ? 'Yes' : 'No'));
      }
      setActionFeedback(
        `Saved A ➔ B shift for ${selectedMemberIds.length} pax (${markSettled ? 'Refunded ✓' : 'Refund Pending'}). You can Print or Download PDF below.`
      );
    } else {
      if (onBatchShiftToCategoryA) {
        onBatchShiftToCategoryA(
          selectedMemberIds,
          markSettled ? 'Yes' : 'No',
          accountsAmountNote.trim() || `Category B to A shift requested via Slip (${selectedMemberIds.length} pax)`
        );
      } else {
        selectedMemberIds.forEach((id) => onToggleMoneyGiven(id, markSettled ? 'Yes' : 'No'));
      }
      setActionFeedback(
        `Saved B ➔ A shift for ${selectedMemberIds.length} pax (${markSettled ? 'Paid ✓' : 'Pending'}).`
      );
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const calculateNights = (arr?: string, dep?: string): number => {
    if (!arr || !dep) return 1;
    const d1 = new Date(arr.slice(0, 10));
    const d2 = new Date(dep.slice(0, 10));
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
    const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
    return Math.max(1, diffDays);
  };

  const formatDateTimeDisplay = (dateStr?: string, timeStr?: string): string => {
    const d = (dateStr || '').slice(0, 10);
    if (!d) return '—';
    return timeStr ? `${d} (${timeStr})` : d;
  };

  const formatRoomGivenIn = (r: Reservation | null): string => {
    if (!r) return 'Room Pending Allotment';
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

  const formatRoomsSummary = (list: Reservation[]): string => {
    const roomsSet = new Set<string>();
    list.forEach((r) => {
      if (r.roomNumber) {
        roomsSet.add(`Room ${r.roomNumber} (${r.building || 'Saifee'})`);
      } else if (r.building) {
        roomsSet.add(`${r.building} (Pending)`);
      }
    });
    return roomsSet.size > 0 ? Array.from(roomsSet).join(', ') : 'Room Pending Allotment';
  };

  const isAToB = direction === 'A_TO_B';
  const refForMeta = effectiveSlipPaxList[0] || anchorReservation;

  const tourIdVal = useMemo(() => {
    if (effectiveSlipPaxList.length === 0) return selectedTourFilter !== 'ALL' ? selectedTourFilter : '—';
    const distinctTours = Array.from(
      new Set(effectiveSlipPaxList.map((r) => (r.tourRefNo || r.tourId || '').trim()).filter(Boolean))
    );
    return distinctTours.length > 0 ? distinctTours.join(', ') : '—';
  }, [effectiveSlipPaxList, selectedTourFilter]);

  const officeVal = useMemo(() => {
    const offices = Array.from(
      new Set(effectiveSlipPaxList.map((r) => (r.officeName || '').trim()).filter(Boolean))
    );
    return offices.length > 0 ? offices.join(', ') : '—';
  }, [effectiveSlipPaxList]);

  const paxVal =
    slipMode === 'single'
      ? activeSingleZaer?.paxCount || activeSingleZaer?.pax || 1
      : effectiveSlipPaxList.length > 0
      ? effectiveSlipPaxList.length
      : 0;

  const arrVal = formatDateTimeDisplay(refForMeta?.arrivalDate, refForMeta?.arrivalTime);
  const depVal = formatDateTimeDisplay(refForMeta?.departureDate, refForMeta?.departureTime);
  const nightsVal = calculateNights(refForMeta?.arrivalDate, refForMeta?.departureDate);
  const roomVal =
    slipMode === 'single'
      ? formatRoomGivenIn(activeSingleZaer)
      : formatRoomsSummary(effectiveSlipPaxList);

  const slipNo = isAToB
    ? refForMeta?.refundSlipNo || `REF-A2B-${Date.now().toString().slice(-4)}`
    : refForMeta?.requestSlipNo || `SLIP-B2A-${Date.now().toString().slice(-4)}`;

  const amountDisplayForPdf = accountsAmountNote.trim()
    ? `$  ${accountsAmountNote.trim()}   (Accounts Verification: ___________________)`
    : '$  __________________________________   (To be written by Accounts)';

  // Early return strictly AFTER all React hooks have executed unconditionally
  if (!modalOpen) return null;

  // ==========================================
  // PDF GENERATION (BOTH B -> A AND A -> B WITH FULL PAX ITS + AGE)
  // ==========================================
  const handleDownloadPdfSlip = () => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const drawPageBorder = () => {
      doc.setDrawColor(18, 78, 57);
      doc.setLineWidth(2);
      doc.rect(25, 25, pageWidth - 50, pageHeight - 50);

      doc.setDrawColor(197, 160, 89);
      doc.setLineWidth(0.75);
      doc.rect(29, 29, pageWidth - 58, pageHeight - 58);
    };

    drawPageBorder();

    // Top Header Banner
    doc.setFillColor(18, 78, 57);
    doc.rect(30, 30, pageWidth - 60, 66, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('FAIZ HUSAINI — ACCOMMODATION OFFICE', pageWidth / 2, 53, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(235, 213, 158);
    doc.text(
      isAToB
        ? 'CATEGORY A TO B ACCOMMODATION REFUND RECEIPT'
        : 'CATEGORY B TO A ACCOMMODATION SHIFT SLIP',
      pageWidth / 2,
      71,
      { align: 'center' }
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 225, 210);
    doc.text(
      isAToB
        ? 'ACCOUNTS DEPARTMENT REFUND & CATEGORY SHIFT RECORD (WITH FULL PAX ROSTER)'
        : 'ACCOUNTS DEPARTMENT PAYMENT & SHIFT RECORD',
      pageWidth / 2,
      85,
      { align: 'center' }
    );

    // Slip Meta Info
    doc.setTextColor(18, 78, 57);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`${isAToB ? 'Refund Receipt No' : 'Slip No'}: ${slipNo}`, 45, 118);

    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Date of Issue: ${new Date().toLocaleDateString()}`, pageWidth - 45, 118, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(1);
    doc.line(45, 126, pageWidth - 45, 126);

    // Core 7 Specification Rows (plus Office Name for Accounts clarity)
    const tableBody = [
      ['Tour ID', tourIdVal],
      ['Office Name', officeVal],
      ['Number of pax', `${paxVal} Pax`],
      ['Number of nights', `${nightsVal} Nights`],
      [
        isAToB
          ? 'Refund Amount (To be filled by accounts)'
          : 'Amount (Keep it blank to be filled by accounts)',
        amountDisplayForPdf,
      ],
      ['Date of arrival', arrVal],
      ['Date of departure', depVal],
      ['Room given in', roomVal],
    ];

    safeAutoTable(doc, {
      startY: 138,
      head: [[isAToB ? 'REFUND RECEIPT DETAIL' : 'SHIFT SLIP DETAIL', 'OFFICIAL SPECIFICATION']],
      body: tableBody,
      margin: { left: 45, right: 45 },
      theme: 'grid',
      styles: {
        fontSize: 9.5,
        cellPadding: 8,
        textColor: [30, 41, 59],
        lineColor: [203, 213, 225],
        lineWidth: 0.75,
      },
      headStyles: {
        fillColor: [18, 78, 57],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9.5,
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 215, fillColor: [248, 250, 252] },
        1: { fontStyle: 'bold', fontSize: 10, textColor: [15, 23, 42] },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === 4) {
          data.cell.styles.textColor = accountsAmountNote.trim() ? [18, 78, 57] : [100, 116, 139];
          data.cell.styles.fontStyle = accountsAmountNote.trim() ? 'bold' : 'normal';
        }
      },
    });

    let currentY = (doc as any).lastAutoTable?.finalY ?? 375;

    // For A -> B Receipt (and whenever full roster is included): Render Shifted Zaereen Roster with Name, ITS ID & Age
    if (isAToB && effectiveSlipPaxList.length > 0) {
      currentY += 16;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(18, 78, 57);
      doc.text(
        `SHIFTED ZAEREEN / PAX DETAILS (${effectiveSlipPaxList.length} PAX — CATEGORY A TO B)`,
        45,
        currentY
      );

      const paxRows = effectiveSlipPaxList.map((z, idx) => [
        String(idx + 1),
        z.applicantName || '—',
        z.itsId || '—',
        z.age !== undefined && z.age !== '' ? `${z.age} yrs` : '—',
        z.gender === 'Female' ? 'F' : z.gender === 'Male' ? 'M' : String(z.gender || '—'),
        z.family ? `#${z.family}` : '—',
        z.roomNumber ? `${z.building || ''} Rm ${z.roomNumber}`.trim() : z.building || 'Pending',
      ]);

      safeAutoTable(doc, {
        startY: currentY + 6,
        head: [['#', 'Zaer Full Name', 'ITS ID', 'Age', 'Sex', 'Family', 'Room']],
        body: paxRows,
        margin: { left: 45, right: 45, bottom: 110 },
        theme: 'grid',
        styles: {
          fontSize: 8.5,
          cellPadding: 5,
          textColor: [30, 41, 59],
          lineColor: [203, 213, 225],
          lineWidth: 0.5,
        },
        headStyles: {
          fillColor: [18, 78, 57],
          textColor: [235, 213, 158],
          fontStyle: 'bold',
          fontSize: 8.5,
        },
        columnStyles: {
          0: { cellWidth: 24, halign: 'center' },
          1: { fontStyle: 'bold', cellWidth: 155 },
          2: { fontStyle: 'bold', cellWidth: 72 },
          3: { halign: 'center', cellWidth: 44 },
          4: { halign: 'center', cellWidth: 32 },
          5: { halign: 'center', cellWidth: 48 },
          6: { cellWidth: 'auto' },
        },
        didDrawPage: () => {
          drawPageBorder();
        },
      });

      currentY = (doc as any).lastAutoTable?.finalY ?? currentY + 60;
    }

    // Ensure enough room for Accounts Use Only box & signatures; otherwise add a clean page
    if (currentY + 170 > pageHeight - 40) {
      doc.addPage();
      drawPageBorder();
      currentY = 45;
    }

    // Accounts Box for Writing Amount & Verification
    const boxY = currentY + 16;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(45, boxY, pageWidth - 90, 74, 4, 4, 'F');
    doc.setDrawColor(18, 78, 57);
    doc.setLineWidth(1);
    doc.roundedRect(45, boxY, pageWidth - 90, 74, 4, 4, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(18, 78, 57);
    doc.text(
      isAToB ? 'FOR ACCOUNTS REFUND PROCESSING ONLY:' : 'FOR ACCOUNTS DEPARTMENT USE ONLY:',
      58,
      boxY + 18
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    if (isAToB) {
      doc.text(
        '1. Verify shifted zaereen names, ITS IDs & ages above and calculate Category A to B refund differential.',
        58,
        boxY + 34
      );
      doc.text(
        '2. Refund Amount Written by Accounts: $_____________________   Voucher / Receipt No: _____________________',
        58,
        boxY + 50
      );
      doc.text(
        '3. Process refund to zaer / tour coordinator and reconcile against Faiz-e-Husaini Accommodation records.',
        58,
        boxY + 64
      );
    } else {
      doc.text('1. Calculate and fill B to A differential tariff in "Amount" field above.', 58, boxY + 34);
      doc.text('2. Amount Collected: $_________________________   Receipt No: _________________________', 58, boxY + 50);
      doc.text('3. Collect money and reconcile against Faiz-e-Husaini Accommodation records.', 58, boxY + 64);
    }

    // Signatures Section at Bottom
    const sigY = Math.max(boxY + 108, pageHeight - 90);
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
    doc.text(
      isAToB ? 'Refunded & Verified By: Accounts Cashier' : 'Received & Verified By: Accounts Cashier',
      pageWidth - 235,
      sigY + 30
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Official Stamp & Signature', pageWidth - 235, sigY + 43);

    const safeTourName = tourIdVal.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'Slip';
    const fileName = isAToB
      ? `Faiz_Husaini_A_to_B_Refund_Receipt_${safeTourName}.pdf`
      : `Faiz_Husaini_B_to_A_Shift_Slip_${safeTourName}.pdf`;
    saveOrDownloadPdf(doc, fileName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-stone-950/45 backdrop-blur-[2px] animate-in fade-in duration-200">
      {/* Print Specific CSS */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
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
      `,
        }}
      />

      <div className="bg-[#f6f8f7] border border-[#e2e8e5] rounded-2xl max-w-5xl w-full p-3.5 sm:p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[95vh] overflow-hidden">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="print-hidden absolute top-3.5 right-3.5 min-w-[40px] min-h-[40px] flex items-center justify-center text-stone-500 hover:text-stone-800 rounded-lg hover:bg-stone-200/60 transition cursor-pointer z-10"
          aria-label="Close receipt modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Top Header (Hidden in Print) */}
        <div className="print-hidden flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-stone-200 gap-2.5">
          <div className="pr-10 sm:pr-0">
            <div className="flex items-center gap-2 flex-wrap">
              <FaizHusainiLogo size="sm" showSubtitle={false} />
              <h3 className="text-sm sm:text-base font-bold text-[#0f4a37]">
                {isAToB
                  ? 'Category A ➔ B Refund Receipt (Full Pax Roster)'
                  : 'Category B ➔ A Shift & Accounts Payment Slip'}
              </h3>
            </div>
            <p className="text-xs text-stone-600 mt-0.5 tabular-nums">
              {isAToB
                ? 'Select zaereen shifting from Category A to B · Includes Name, ITS ID & Age for Accounts refund verification.'
                : 'Tour Reference: '}
              {!isAToB && (
                <span className="font-mono font-bold text-stone-900">
                  {selectedTourFilter !== 'ALL' ? selectedTourFilter : tourIdVal || 'Individual Allotment'}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:mr-10">
            <button
              type="button"
              onClick={handlePrint}
              className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-stone-800 hover:bg-stone-900 text-white shadow-xs transition cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isAToB ? 'Print Refund Receipt' : 'Print Slip'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdfSlip}
              className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#0f4a37] hover:bg-[#0b3a2b] text-white shadow-xs transition cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isAToB ? 'Download Refund PDF' : 'Download Slip PDF'}</span>
            </button>
          </div>
        </div>

        {/* Direction Switcher, Tour Selector & Pax Checklist (Hidden in Print) */}
        <div className="print-hidden bg-stone-100/80 p-3 rounded-xl border border-stone-200 mt-3 space-y-2.5">
          {/* Row 1: Shift Direction Toggle + Tour Picker + Slip Scope */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
            {/* Direction Toggle: B -> A vs A -> B */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-stone-300 text-xs font-bold shadow-2xs">
              <button
                type="button"
                onClick={() => setDirection('B_TO_A')}
                className={`flex-1 sm:flex-initial min-h-[36px] flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg transition cursor-pointer whitespace-nowrap ${
                  direction === 'B_TO_A'
                    ? 'bg-[#0f4a37] text-white shadow-xs'
                    : 'text-stone-700 hover:text-stone-950'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-[#ecdcae]" />
                <span>B ➔ A (Collect)</span>
              </button>
              <button
                type="button"
                onClick={() => setDirection('A_TO_B')}
                className={`flex-1 sm:flex-initial min-h-[36px] flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg transition cursor-pointer whitespace-nowrap ${
                  direction === 'A_TO_B'
                    ? 'bg-amber-700 text-white shadow-xs'
                    : 'text-stone-700 hover:text-stone-950'
                }`}
              >
                <ArrowDownLeft className="w-3.5 h-3.5 text-amber-200" />
                <span>A ➔ B (Refund Receipt)</span>
              </button>
            </div>

            {/* Tour ID Filter + View Mode */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-stone-300 text-xs">
                <span className="font-semibold text-stone-500 whitespace-nowrap">Tour ID:</span>
                <select
                  value={selectedTourFilter}
                  onChange={(e) => {
                    const nextTour = e.target.value;
                    setSelectedTourFilter(nextTour);
                    if (nextTour && nextTour !== 'ALL') {
                      const tNorm = nextTour.trim().toLowerCase();
                      const tourPax = allReservations.filter(
                        (r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === tNorm
                      );
                      setSelectedMemberIds(tourPax.map((p) => p.id));
                      if (tourPax.length > 0) setActiveSingleZaerId(tourPax[0].id);
                      setSlipMode('tour');
                    }
                  }}
                  className="bg-transparent font-mono font-bold text-[#0f4a37] focus:outline-none max-w-[200px] truncate cursor-pointer"
                >
                  <option value="ALL">All Tours ({allReservations.length} pax)</option>
                  {distinctTourOptions.map((opt) => (
                    <option key={opt.tourId} value={opt.tourId}>
                      {opt.tourId} ({opt.count} pax)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-stone-300 text-xs font-bold shadow-2xs">
                <button
                  type="button"
                  onClick={() => setSlipMode('tour')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition cursor-pointer whitespace-nowrap ${
                    slipMode === 'tour' ? 'bg-[#0f4a37] text-white' : 'text-stone-700 hover:text-stone-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-[#ecdcae]" />
                  <span>Selected List ({selectedReservations.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSlipMode('single')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition cursor-pointer whitespace-nowrap ${
                    slipMode === 'single' ? 'bg-[#0f4a37] text-white' : 'text-stone-700 hover:text-stone-900'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5 text-[#ecdcae]" />
                  <span>Single Pax</span>
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: Search Pax + Quick Select Buttons + Optional Accounts Note */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
            <div className="md:col-span-5 relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-stone-400" />
              <input
                type="text"
                placeholder="Search pax by Name, ITS ID, Age, Family, Room..."
                value={searchMemberQuery}
                onChange={(e) => setSearchMemberQuery(e.target.value)}
                className="w-full bg-white border border-stone-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-[#0f4a37]"
              />
            </div>

            <div className="md:col-span-4 relative">
              <input
                type="text"
                placeholder={
                  isAToB
                    ? 'Accounts refund amount (leave blank for Accounts to write)'
                    : 'Amount note (leave blank for Accounts to fill)'
                }
                value={accountsAmountNote}
                onChange={(e) => setAccountsAmountNote(e.target.value)}
                className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-600"
              />
            </div>

            <div className="md:col-span-3 flex items-center justify-end gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#0f4a37] hover:bg-[#0b3a2b] text-white transition cursor-pointer whitespace-nowrap"
              >
                Select All ({filteredPoolMembers.length})
              </button>
              {anchorReservation?.family && (
                <button
                  type="button"
                  onClick={handleSelectSameFamily}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white hover:bg-stone-50 text-stone-700 border border-stone-300 transition cursor-pointer whitespace-nowrap"
                >
                  Fam #{anchorReservation.family}
                </button>
              )}
              <button
                type="button"
                onClick={handleClearSelection}
                className="px-2 py-1.5 rounded-lg text-xs font-semibold text-stone-500 hover:text-stone-800 transition cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Pax Selection List Box (Includes Name, ITS ID, Age, Family, Room) */}
          <div className="bg-white rounded-xl border border-stone-200 p-2.5 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1.5 border-b border-stone-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-stone-800">
                  {isAToB
                    ? 'Select Pax Shifting from Category A ➔ B (Name, ITS & Age shown):'
                    : 'Choose Pax Shifting from Category B ➔ A:'}
                </span>
                <span className="text-[11px] font-bold text-[#0f4a37] tabular-nums">
                  {selectedMemberIds.length} of {filteredPoolMembers.length} Selected
                </span>
              </div>

              {/* Action Buttons to Record Shift in Portal */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleApplyShiftAction(true)}
                  disabled={selectedMemberIds.length === 0}
                  className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-50 text-white shadow-2xs transition cursor-pointer whitespace-nowrap ${
                    isAToB ? 'bg-amber-700 hover:bg-amber-800' : 'bg-emerald-700 hover:bg-emerald-800'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>
                    {isAToB
                      ? `Shift A ➔ B (${selectedMemberIds.length}) & Mark Refunded`
                      : `Shift B ➔ A (${selectedMemberIds.length}) & Mark Paid`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyShiftAction(false)}
                  disabled={selectedMemberIds.length === 0}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 disabled:opacity-50 transition cursor-pointer whitespace-nowrap"
                >
                  {isAToB ? 'Shift A ➔ B (Refund Pending)' : 'Shift as Pending'}
                </button>
              </div>
            </div>

            {actionFeedback && (
              <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs font-semibold flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span>{actionFeedback}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setActionFeedback(null)}
                  className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Checklist of Pax with Name, ITS, Age */}
            <div className="max-h-36 overflow-y-auto space-y-1 divide-y divide-stone-100 pr-1">
              {filteredPoolMembers.length > 0 ? (
                filteredPoolMembers.map((member) => {
                  const isSelected = selectedMemberIds.includes(member.id);
                  const isSettled = isAToB
                    ? member.refundGiven === 'Yes'
                    : member.moneyGiven === 'Yes';

                  return (
                    <div
                      key={member.id}
                      className={`flex items-center justify-between gap-2 p-1.5 rounded-lg transition text-xs ${
                        isSelected ? 'bg-emerald-50/70' : 'hover:bg-stone-50'
                      }`}
                    >
                      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleMember(member.id)}
                          className="rounded text-[#0f4a37] focus:ring-[#0f4a37] w-4 h-4 shrink-0"
                        />
                        <div className="flex items-center gap-x-2.5 gap-y-0.5 flex-wrap min-w-0">
                          <span className="font-bold text-stone-900">{member.applicantName}</span>
                          <span className="font-mono text-stone-700 text-[11px] tabular-nums">
                            ITS: {member.itsId || '—'}
                          </span>
                          <span className="font-mono text-stone-700 text-[11px] tabular-nums">
                            Age: {member.age || '—'}y ({member.gender === 'Female' ? 'F' : 'M'})
                          </span>
                          <span className="font-mono text-stone-500 text-[11px] tabular-nums">
                            Fam #{member.family || '—'}
                          </span>
                          <span className="text-[11px] text-stone-600 tabular-nums">
                            {member.roomNumber ? `Rm ${member.roomNumber} (${member.building})` : 'Room Pending'}
                          </span>
                        </div>
                      </label>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSingleZaerId(member.id);
                            if (slipMode === 'single') setSlipMode('single');
                          }}
                          className="text-[10px] px-2 py-0.5 rounded font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-100 cursor-pointer"
                          title="Preview single pax slip"
                        >
                          Focus
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            isAToB && onToggleRefundGiven
                              ? onToggleRefundGiven(member.id, isSettled ? 'No' : 'Yes')
                              : onToggleMoneyGiven(member.id, isSettled ? 'No' : 'Yes')
                          }
                          className={`text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                            isSettled
                              ? 'bg-emerald-100 text-emerald-950 border border-emerald-300'
                              : 'bg-amber-100 text-amber-950 border border-amber-300'
                          }`}
                        >
                          {isAToB
                            ? isSettled
                              ? 'Refunded ✓'
                              : 'Refund Pending'
                            : isSettled
                            ? 'Paid ✓'
                            : 'Pending ✗'}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-4 text-center text-xs text-stone-400">
                  No zaereen match your search filter.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Printable Receipt / Slip Paper View */}
        <div
          id="accounts-slip-print-area"
          className="flex-1 overflow-y-auto mt-3 p-4 sm:p-6 bg-white border border-[#e2e8e5] rounded-xl shadow-xs text-xs space-y-4"
        >
          {/* Official Header */}
          <div className="text-center pb-3 border-b-2 border-[#0f4a37]">
            <div className="flex justify-center mb-1">
              <FaizHusainiLogo size="md" />
            </div>
            <div
              className={`inline-block font-bold text-xs uppercase px-3 py-1 rounded-md tracking-wider mt-1 ${
                isAToB ? 'bg-amber-800 text-amber-50' : 'bg-[#0f4a37] text-white'
              }`}
            >
              {isAToB
                ? 'ACCOUNTS DEPARTMENT — CATEGORY A TO B SHIFT & REFUND RECEIPT'
                : slipMode === 'tour' && effectiveSlipPaxList.length > 1
                ? 'ACCOUNTS DEPARTMENT — CONSOLIDATED TOUR B TO A SHIFT PAYMENT SLIP'
                : 'ACCOUNTS DEPARTMENT — PILGRIM B TO A SHIFT REQUEST SLIP'}
            </div>
            <div className="text-xs font-semibold text-stone-600 mt-1">
              {isAToB ? (
                <>
                  Official Category Shift & Refund Voucher:{' '}
                  <strong className="text-stone-900">Category A (Nizaam) ➔ Category B (Standard)</strong> · Faiz-e-Husaini Najaf
                </>
              ) : (
                <>
                  Official Shift Request:{' '}
                  <strong className="text-stone-900">Category B (Standard) ➔ Category A (Nizaam)</strong> · Faiz-e-Husaini Najaf
                </>
              )}
            </div>
          </div>

          {/* Slip Reference & Date Header */}
          <div className="flex items-center justify-between bg-stone-50 px-4 py-2 rounded-lg border border-stone-200 text-xs">
            <div>
              <span className="text-stone-500 text-[11px] block">
                {isAToB ? 'Refund Receipt No:' : 'Slip Reference No:'}
              </span>
              <span className="font-mono font-bold text-[#0f4a37] text-sm tabular-nums">{slipNo}</span>
            </div>
            <div className="text-right">
              <span className="text-stone-500 text-[11px] block">Date of Issue:</span>
              <span className="font-semibold text-stone-800 text-sm tabular-nums">
                {new Date().toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Core 7 Specification Rows (Same structure for B -> A and A -> B) */}
          <div className="overflow-x-auto border-2 border-[#0f4a37]/30 rounded-xl shadow-xs">
            <table className="w-full text-left text-sm border-collapse bg-white">
              <thead>
                <tr className="bg-[#0f4a37] text-white">
                  <th className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider w-[44%]">
                    {isAToB ? 'Refund Receipt Detail' : 'Shift Slip Detail'}
                  </th>
                  <th className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider w-[56%]">
                    Official Specification
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Tour ID</td>
                  <td className="py-2.5 px-4 font-mono font-bold text-base text-[#0f4a37] break-all">
                    {tourIdVal}
                  </td>
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Office Name</td>
                  <td className="py-2.5 px-4 font-semibold text-stone-900 text-sm">{officeVal}</td>
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Number of pax</td>
                  <td className="py-2.5 px-4 font-bold text-stone-900 text-sm tabular-nums">
                    {paxVal} Pax
                  </td>
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Number of nights</td>
                  <td className="py-2.5 px-4 font-bold text-stone-900 text-sm tabular-nums">
                    {nightsVal} Nights
                  </td>
                </tr>

                <tr className="bg-amber-50/40">
                  <td className="py-2.5 px-4 font-semibold text-stone-800 bg-amber-50/60">
                    {isAToB ? 'Refund Amount' : 'Amount'}{' '}
                    <span className="text-[11px] font-normal text-stone-500 block sm:inline">
                      (Left blank to be written by accounts)
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-stone-500 text-base">$</span>
                      <div className="min-h-8 min-w-[220px] flex-1 max-w-xs border-b-2 border-stone-500 border-dashed bg-white px-2.5 py-1 flex items-center text-xs font-mono font-bold text-stone-900">
                        {accountsAmountNote.trim() ? (
                          <span>{accountsAmountNote.trim()}</span>
                        ) : (
                          <span className="text-stone-400 font-sans italic font-normal">
                            Blank — To be written by Accounts
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Date of arrival</td>
                  <td className="py-2.5 px-4 font-medium text-stone-900 text-sm tabular-nums">
                    {arrVal}
                  </td>
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Date of departure</td>
                  <td className="py-2.5 px-4 font-medium text-stone-900 text-sm tabular-nums">
                    {depVal}
                  </td>
                </tr>

                <tr>
                  <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Room given in</td>
                  <td className="py-2.5 px-4 font-bold text-[#0f4a37] text-sm">{roomVal}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* DIFFERENCE FOR A -> B: FULL LIST OF ALL SHIFTED ZAEREEN NAMES, ITS IDs & AGES */}
          {isAToB && (
            <div className="border-2 border-amber-700/30 rounded-xl overflow-hidden bg-white shadow-xs">
              <div className="bg-amber-800 text-amber-50 px-4 py-2 flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider">
                  Shifted Zaereen / Pax Details (Category A ➔ Category B)
                </span>
                <span className="font-mono font-bold text-xs tabular-nums">
                  {effectiveSlipPaxList.length} Pax
                </span>
              </div>

              {effectiveSlipPaxList.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-stone-100 text-stone-700 uppercase text-[11px] font-bold border-b border-stone-200">
                      <tr>
                        <th className="py-2 px-3 w-10 text-center">#</th>
                        <th className="py-2 px-3">Zaer Full Name</th>
                        <th className="py-2 px-3">ITS ID</th>
                        <th className="py-2 px-3 text-center">Age</th>
                        <th className="py-2 px-3 text-center">Sex</th>
                        <th className="py-2 px-3 text-center">Family</th>
                        <th className="py-2 px-3">Room Allotted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {effectiveSlipPaxList.map((z, idx) => (
                        <tr key={z.id} className="hover:bg-stone-50/60">
                          <td className="py-2 px-3 text-center font-mono text-stone-500 tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-3 font-bold text-stone-950">{z.applicantName}</td>
                          <td className="py-2 px-3 font-mono font-bold text-stone-900 tabular-nums">
                            {z.itsId || '—'}
                          </td>
                          <td className="py-2 px-3 text-center font-mono font-semibold text-stone-800 tabular-nums">
                            {z.age !== undefined && z.age !== '' ? `${z.age} yrs` : '—'}
                          </td>
                          <td className="py-2 px-3 text-center text-stone-700">
                            {z.gender === 'Female' ? 'F' : z.gender === 'Male' ? 'M' : z.gender || '—'}
                          </td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-emerald-900 tabular-nums">
                            {z.family ? `#${z.family}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-stone-800 font-medium tabular-nums">
                            {z.roomNumber ? `${z.building || ''} Rm ${z.roomNumber}`.trim() : z.building || 'Pending'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-stone-500 italic">
                  Select one or more zaereen above to populate the A ➔ B refund roster.
                </div>
              )}
            </div>
          )}

          {/* Accounts Notice */}
          <div className="p-3 rounded-lg bg-stone-50 border border-stone-300 text-xs text-stone-700 space-y-1.5">
            {isAToB ? (
              <>
                <div>
                  <strong>Accounts Department Refund Directive:</strong> Verify the shifted zaereen names, ITS IDs, and ages listed above, write the approved Category A to B refund amount in the blank box, and issue the refund voucher.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-[11px] text-stone-700">
                  <div>Refund Written ($): _________________________</div>
                  <div>Voucher / Receipt No: _______________________</div>
                </div>
              </>
            ) : (
              <div>
                <strong>Accounts Department Directive:</strong> Please collect the category B to A differential tariff, issue payment receipt, and reconcile against official group records.
              </div>
            )}
          </div>

          {/* Signatures */}
          <div className="pt-4 border-t border-stone-200 grid grid-cols-2 sm:grid-cols-3 gap-4 text-[10px] text-stone-500">
            <div>
              <div className="border-b border-stone-300 w-36 mb-1" />
              <div>Prepared By: Accommodation Officer</div>
            </div>
            <div>
              <div className="border-b border-stone-300 w-36 mb-1" />
              <div>{isAToB ? 'Zaer / Coordinator Acknowledgment' : 'Tour Coordinator Received'}</div>
            </div>
            <div className="sm:text-right">
              <div className="border-b border-stone-300 w-36 mb-1 sm:ml-auto" />
              <div>
                {isAToB ? 'Accounts Cashier Refund & Stamp' : 'Accounts Cashier Verification & Stamp'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
