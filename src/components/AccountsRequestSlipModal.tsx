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
import { btn, btnSm, chip, field, fieldLabel, modalHeader, modalTitle, modalClose } from './ui';
import { saveOrDownloadPdf } from '../services/pdfExport';
import { recordSlip } from '../services/api';

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
  const [fallbackSlipSuffix, setFallbackSlipSuffix] = useState(() => Date.now().toString().slice(-4));

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

  // Saved A to B & B to A pax across all tours
  const savedAToBPax = useMemo(
    () => allReservations.filter((r) => r.shiftDirection === 'A_TO_B' || Boolean(r.refundSlipNo)),
    [allReservations]
  );
  const savedBToAPax = useMemo(
    () =>
      allReservations.filter(
        (r) =>
          Boolean(r.shiftToCategoryA) ||
          r.category === 'B to A' ||
          Boolean(r.category && r.category.toLowerCase().includes('b to a'))
      ),
    [allReservations]
  );

  // Synchronize modal initialization whenever opened or target changes
  useEffect(() => {
    if (!modalOpen) return;

    setDirection(initialDirection);
    setFallbackSlipSuffix(Date.now().toString().slice(-4));
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
      setSlipMode('tour');
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
        // Default to B to A members in this tour (never drag unrelated Category A tour members into a B to A slip)
        const bToAInTour = list.filter(
          (m) =>
            m.id === reservation.id ||
            Boolean(m.shiftToCategoryA) ||
            m.category === 'B to A' ||
            Boolean(m.category && m.category.toLowerCase().includes('b to a'))
        );
        const initialList = bToAInTour.length > 0 ? bToAInTour : [reservation];
        setSelectedMemberIds(initialList.map((m) => m.id));
        setSlipMode(initialList.length > 1 ? 'tour' : 'single');
      }
    } else if (initialDirection === 'A_TO_B') {
      const savedA2B = allReservations.filter((r) => r.shiftDirection === 'A_TO_B' || Boolean(r.refundSlipNo));
      if (savedA2B.length > 0) {
        const distinctSavedTours = new Set(savedA2B.map((r) => (r.tourRefNo || r.tourId || '').trim()).filter(Boolean));
        setSelectedTourFilter(distinctSavedTours.size === 1 ? Array.from(distinctSavedTours)[0] : 'ALL');
        setSelectedMemberIds(savedA2B.map((m) => m.id));
        setActiveSingleZaerId(savedA2B[0].id);
        setSlipMode('tour');
      } else if (fallbackRes) {
        setSelectedTourFilter(tourRef || 'ALL');
        setActiveSingleZaerId(fallbackRes.id);
        const tNorm = tourRef.toLowerCase();
        const sameTourMembers = tourRef
          ? allReservations.filter((r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === tNorm)
          : [fallbackRes];
        setSelectedMemberIds(sameTourMembers.map((m) => m.id));
        setSlipMode('tour');
      } else {
        setSelectedTourFilter('ALL');
        setSelectedMemberIds([]);
        setActiveSingleZaerId('');
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

  const handleSelectSavedAToBPax = () => {
    if (savedAToBPax.length === 0) return;
    setSelectedTourFilter('ALL');
    setSelectedMemberIds(savedAToBPax.map((m) => m.id));
    setActiveSingleZaerId(savedAToBPax[0].id);
    setSlipMode('tour');
  };

  const handleSelectSavedBToAPax = () => {
    if (savedBToAPax.length === 0) return;
    setSelectedTourFilter('ALL');
    setSelectedMemberIds(savedBToAPax.map((m) => m.id));
    setActiveSingleZaerId(savedBToAPax[0].id);
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

  /** Every B→A slip printed or downloaded is recorded in the app (a reprint adds to its record). */
  const recordBToASlip = (action: 'print' | 'pdf') => {
    if (isAToB || effectiveSlipPaxList.length === 0) return;
    recordSlip({ slipNo, reservationIds: effectiveSlipPaxList.map((r) => r.id), amountNote: accountsAmountNote, action })
      .then(() => setActionFeedback(`Slip ${slipNo} recorded in B→A slip records.`))
      .catch(() => setActionFeedback(`Slip ${slipNo} could not be recorded. Check the connection and print or download it again.`));
  };

  const handlePrint = () => {
    recordBToASlip('print');
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
      ? Math.max(1, activeSingleZaer?.paxCount || activeSingleZaer?.pax || 1)
      : effectiveSlipPaxList.reduce(
          (sum, r) => sum + Math.max(1, Number(r.paxCount || r.pax || 1) || 1),
          0
        );

  const arrVal = formatDateTimeDisplay(refForMeta?.arrivalDate, refForMeta?.arrivalTime);
  const depVal = formatDateTimeDisplay(refForMeta?.departureDate, refForMeta?.departureTime);
  const nightsVal = calculateNights(refForMeta?.arrivalDate, refForMeta?.departureDate);
  const roomVal =
    slipMode === 'single'
      ? formatRoomGivenIn(activeSingleZaer)
      : formatRoomsSummary(effectiveSlipPaxList);

  // A slip without a saved number gets one fixed number while the slip is open, so the printed, downloaded and
  // recorded numbers are the same.
  const slipNo = isAToB
    ? refForMeta?.refundSlipNo || `REF-A2B-${fallbackSlipSuffix}`
    : refForMeta?.requestSlipNo || `SLIP-B2A-${fallbackSlipSuffix}`;

  const amountDisplayForPdf = accountsAmountNote.trim()
    ? `$  ${accountsAmountNote.trim()}   (Accounts Verification: ___________________)`
    : '$  __________________________________   (To be written by Accounts)';

  // Group selected/active pax by Tour ID so each Tour ID gets its own 2-page A to B slip
  const tourSlipGroups = useMemo(() => {
    const list = effectiveSlipPaxList;
    if (list.length === 0) {
      const fallbackTour = selectedTourFilter && selectedTourFilter !== 'ALL' ? selectedTourFilter : '—';
      return [
        {
          tourId: fallbackTour,
          officeName: '—',
          paxList: [] as Reservation[],
          paxCount: 0,
          arrivalDate: '',
          arrivalTime: '',
          departureDate: '',
          departureTime: '',
          nights: 1,
          roomSummary: 'Room Pending Allotment',
          slipNo,
        },
      ];
    }

    const map = new Map<string, Reservation[]>();
    list.forEach((item) => {
      const rawTour = (item.tourRefNo || item.tourId || '').trim() || 'Individual / Unassigned Tour';
      const existing = map.get(rawTour) || [];
      existing.push(item);
      map.set(rawTour, existing);
    });

    const entries = Array.from(map.entries());
    return entries.map(([tId, members]) => {
      const offices = Array.from(new Set(members.map((m) => (m.officeName || '').trim()).filter(Boolean)));
      const withArr = members.find((m) => m.arrivalDate) || members[0];
      const withDep = members.find((m) => m.departureDate) || members[0];
      const arrD = withArr?.arrivalDate || '';
      const arrT = withArr?.arrivalTime || '';
      const depD = withDep?.departureDate || '';
      const depT = withDep?.departureTime || '';
      const existingSlip = members.find((m) => m.refundSlipNo)?.refundSlipNo;
      const safeSuffix = tId.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'TOUR';
      const groupSlipNo = existingSlip || `REF-A2B-${safeSuffix}`;
      const count =
        slipMode === 'single' && entries.length === 1
          ? activeSingleZaer?.paxCount || activeSingleZaer?.pax || members.length
          : members.length;

      return {
        tourId: tId,
        officeName: offices.length > 0 ? offices.join(', ') : '—',
        paxList: members,
        paxCount: count,
        arrivalDate: arrD,
        arrivalTime: arrT,
        departureDate: depD,
        departureTime: depT,
        nights: calculateNights(arrD, depD),
        roomSummary:
          slipMode === 'single' && entries.length === 1
            ? formatRoomGivenIn(activeSingleZaer)
            : formatRoomsSummary(members),
        slipNo: groupSlipNo,
      };
    });
  }, [effectiveSlipPaxList, selectedTourFilter, slipNo, slipMode, activeSingleZaer]);

  // Early return strictly AFTER all React hooks have executed unconditionally
  if (!modalOpen) return null;

  // ==========================================
  // PDF GENERATION
  // - A -> B: Each Tour ID has its OWN 2-page slip:
  //     Page 1 (Front Page): Tour ID, Office Name, Number of Pax, Number of Nights, Arrival & Departure Dates + same B->A fields & Accounts/Signatures
  //     Page 2 (Second Page): Names of all pax sent to A to B from that specific Tour ID
  // - B -> A: Unchanged
  // ==========================================
  const generateAToBPdfForGroups = (
    groupsToRender: typeof tourSlipGroups,
    customFileName?: string
  ) => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const issueDateStr = new Date().toLocaleDateString();

    const drawPageBorder = () => {
      doc.setDrawColor(18, 78, 57);
      doc.setLineWidth(2);
      doc.rect(25, 25, pageWidth - 50, pageHeight - 50);

      doc.setDrawColor(197, 160, 89);
      doc.setLineWidth(0.75);
      doc.rect(29, 29, pageWidth - 58, pageHeight - 58);
    };

    groupsToRender.forEach((group, groupIndex) => {
      // ==================================================
      // PAGE 1 (FRONT PAGE FOR THIS SPECIFIC TOUR ID)
      // ==================================================
      if (groupIndex > 0) {
        doc.addPage();
      }
      drawPageBorder();

      // Top Header Banner (same as B to A slip)
      doc.setFillColor(18, 78, 57);
      doc.rect(30, 30, pageWidth - 60, 66, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('FAIZ HUSAINI — ACCOMMODATION OFFICE', pageWidth / 2, 53, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(235, 213, 158);
      doc.text('CATEGORY A TO B ACCOMMODATION SHIFT SLIP', pageWidth / 2, 71, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(200, 225, 210);
      doc.text('ACCOUNTS DEPARTMENT REFUND & CATEGORY SHIFT RECORD', pageWidth / 2, 85, { align: 'center' });

      // Slip Meta Info
      doc.setTextColor(18, 78, 57);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(`Slip / Refund Receipt No: ${group.slipNo}`, 45, 118);

      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Date of Issue: ${issueDateStr}`, pageWidth - 45, 118, { align: 'right' });

      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(1);
      doc.line(45, 126, pageWidth - 45, 126);

      // Core Specification Rows (Tour ID, Office Name, Pax, Nights, Amount, Arrival, Departure, Room given in)
      const tableBody = [
        ['Tour ID', group.tourId],
        ['Office Name', group.officeName],
        ['Number of pax', `${group.paxCount} Pax`],
        ['Number of nights', `${group.nights} Nights`],
        ['Amount (Keep it blank to be filled by accounts)', amountDisplayForPdf],
        ['Date of arrival', formatDateTimeDisplay(group.arrivalDate, group.arrivalTime)],
        ['Date of departure', formatDateTimeDisplay(group.departureDate, group.departureTime)],
        ['Room given in', group.roomSummary],
      ];

      safeAutoTable(doc, {
        startY: 140,
        head: [['A TO B SLIP DETAIL', 'OFFICIAL SPECIFICATION']],
        body: tableBody,
        margin: { left: 45, right: 45 },
        theme: 'grid',
        styles: {
          fontSize: 9.5,
          cellPadding: 9,
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

      const frontAfterTableY = (doc as any).lastAutoTable?.finalY ?? 410;

      // Accounts Box for Writing Amount & Verification (same style as B to A slip)
      const boxY = frontAfterTableY + 22;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(45, boxY, pageWidth - 90, 74, 4, 4, 'F');
      doc.setDrawColor(18, 78, 57);
      doc.setLineWidth(1);
      doc.roundedRect(45, boxY, pageWidth - 90, 74, 4, 4, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(18, 78, 57);
      doc.text('FOR ACCOUNTS DEPARTMENT USE ONLY:', 58, boxY + 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text(
        '1. Calculate and fill Category A to B refund differential in "Amount" field above.',
        58,
        boxY + 34
      );
      doc.text(
        '2. Amount Refunded: $_________________________   Voucher / Receipt No: _________________________',
        58,
        boxY + 50
      );
      doc.text(
        '3. Verify shifted pax roster on Page 2 and reconcile against Faiz-e-Husaini Accommodation records.',
        58,
        boxY + 64
      );

      // Signatures Section at Bottom of Page 1
      const sigY = Math.max(boxY + 115, pageHeight - 105);
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
      doc.text('Refunded & Verified By: Accounts Cashier', pageWidth - 235, sigY + 30);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('Official Stamp & Signature', pageWidth - 235, sigY + 43);

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(120, 113, 108);
      doc.text(
        `Page 1 (Front Page) • Tour ID: ${group.tourId} • See Page 2 for Names of Shifted Pax`,
        pageWidth / 2,
        pageHeight - 38,
        { align: 'center' }
      );

      // ==================================================
      // PAGE 2 (SECOND PAGE: NAMES OF ALL PAX SENT TO A TO B FOR THIS TOUR ID)
      // ==================================================
      doc.addPage();
      drawPageBorder();

      doc.setFillColor(18, 78, 57);
      doc.rect(30, 30, pageWidth - 60, 62, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('FAIZ HUSAINI — ACCOMMODATION OFFICE', pageWidth / 2, 51, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158);
      doc.text('CATEGORY A TO B — SHIFTED PAX NAMES (PAGE 2)', pageWidth / 2, 68, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(215, 232, 222);
      doc.text(
        `Tour ID: ${group.tourId}   •   Office: ${group.officeName}   •   Total Pax: ${group.paxList.length}`,
        pageWidth / 2,
        82,
        { align: 'center' }
      );

      // Compact Summary Strip on Page 2
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(`Slip No: ${group.slipNo}`, 45, 112);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Arrival: ${formatDateTimeDisplay(group.arrivalDate, group.arrivalTime)}  |  Departure: ${formatDateTimeDisplay(group.departureDate, group.departureTime)}  |  ${group.nights} Nights`,
        pageWidth - 45,
        112,
        { align: 'right' }
      );

      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.75);
      doc.line(45, 120, pageWidth - 45, 120);

      const paxRows =
        group.paxList.length > 0
          ? group.paxList.map((z, idx) => [
              String(idx + 1),
              z.applicantName || '—',
              z.itsId || '—',
              z.age !== undefined && z.age !== '' ? `${z.age} yrs` : '—',
              z.gender === 'Female' ? 'F' : z.gender === 'Male' ? 'M' : String(z.gender || '—'),
              z.family ? `#${z.family}` : '—',
              z.roomNumber ? `${z.building || ''} Rm ${z.roomNumber}`.trim() : z.building || 'Pending',
            ])
          : [['—', 'No pax selected for this Tour ID', '—', '—', '—', '—', '—']];

      safeAutoTable(doc, {
        startY: 132,
        head: [['#', 'Zaer Name (Sent to A to B)', 'ITS ID', 'Age', 'Sex', 'Family', 'Room Allotted']],
        body: paxRows,
        margin: { left: 45, right: 45, bottom: 75 },
        theme: 'grid',
        styles: {
          fontSize: 8.5,
          cellPadding: 6,
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
          0: { cellWidth: 26, halign: 'center' },
          1: { fontStyle: 'bold', cellWidth: 160 },
          2: { fontStyle: 'bold', cellWidth: 74 },
          3: { halign: 'center', cellWidth: 44 },
          4: { halign: 'center', cellWidth: 32 },
          5: { halign: 'center', cellWidth: 48 },
          6: { cellWidth: 'auto' },
        },
        didDrawPage: () => {
          drawPageBorder();
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(7.5);
          doc.setTextColor(120, 113, 108);
          doc.text(
            `Page 2 (Pax Roster) • Tour ID: ${group.tourId} • ${group.paxList.length} Pax`,
            pageWidth / 2,
            pageHeight - 38,
            { align: 'center' }
          );
        },
      });
    });

    const singleName = groupsToRender[0]?.tourId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'Slip';
    const fileName =
      customFileName ||
      (groupsToRender.length === 1
        ? `Faiz_Husaini_A_to_B_Slip_${singleName}.pdf`
        : `Faiz_Husaini_A_to_B_Slips_${groupsToRender.length}_Tours.pdf`);
    saveOrDownloadPdf(doc, fileName);
  };

  const handleDownloadPdfSlip = () => {
    if (isAToB) {
      generateAToBPdfForGroups(tourSlipGroups);
      return;
    }
    recordBToASlip('pdf');

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
    doc.text('CATEGORY B TO A ACCOMMODATION SHIFT SLIP', pageWidth / 2, 71, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 225, 210);
    doc.text('ACCOUNTS DEPARTMENT PAYMENT & SHIFT RECORD', pageWidth / 2, 85, { align: 'center' });

    // Slip Meta Info
    doc.setTextColor(18, 78, 57);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`Slip No: ${slipNo}`, 45, 118);

    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Date of Issue: ${new Date().toLocaleDateString()}`, pageWidth - 45, 118, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(1);
    doc.line(45, 126, pageWidth - 45, 126);

    // Core Specification Rows
    const tableBody = [
      ['Tour ID', tourIdVal],
      ['Office Name', officeVal],
      ['Number of pax', `${paxVal} Pax`],
      ['Number of nights', `${nightsVal} Nights`],
      ['Amount (Keep it blank to be filled by accounts)', amountDisplayForPdf],
      ['Date of arrival', arrVal],
      ['Date of departure', depVal],
      ['Room given in', roomVal],
    ];

    safeAutoTable(doc, {
      startY: 138,
      head: [['SHIFT SLIP DETAIL', 'OFFICIAL SPECIFICATION']],
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
    doc.text('FOR ACCOUNTS DEPARTMENT USE ONLY:', 58, boxY + 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text('1. Calculate and fill B to A differential tariff in "Amount" field above.', 58, boxY + 34);
    doc.text('2. Amount Collected: $_________________________   Receipt No: _________________________', 58, boxY + 50);
    doc.text('3. Collect money and reconcile against Faiz-e-Husaini Accommodation records.', 58, boxY + 64);

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
    doc.text('Received & Verified By: Accounts Cashier', pageWidth - 235, sigY + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Official Stamp & Signature', pageWidth - 235, sigY + 43);

    const safeTourName = tourIdVal.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'Slip';
    const fileName = `Faiz_Husaini_B_to_A_Shift_Slip_${safeTourName}.pdf`;
    saveOrDownloadPdf(doc, fileName);
  };

  /* ---- On-screen chrome helpers (nothing here reaches the printed slip) ---- */
  const segWrap = 'flex items-center gap-0.5 p-0.5 rounded-lg bg-stone-100 ring-1 ring-inset ring-stone-200';
  const segBtn = (selected: boolean) =>
    `flex-1 inline-flex items-center justify-center gap-1.5 h-10 sm:h-8 px-3 rounded-md text-[13px] whitespace-nowrap cursor-pointer transition ${
      selected ? 'bg-white text-stone-950 font-semibold shadow-xs ring-1 ring-stone-300' : 'text-stone-600 font-medium hover:text-stone-950'
    }`;

  return (
    <div className="accounts-slip-modal-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-950/50 animate-in fade-in duration-150">
      {/* Print Specific CSS */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body * {
            visibility: hidden;
          }
          #accounts-slip-print-area, #accounts-slip-print-area * {
            visibility: visible;
          }
          /* The app-wide print rules hide everything under #root except the reception slip dialog.
             Let this dialog through and flatten its frame so only the slip paper reaches the page. */
          body > #root > div > .accounts-slip-modal-backdrop.accounts-slip-modal-backdrop {
            display: block !important;
            position: static !important;
            inset: auto !important;
            width: 100% !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
          }
          .accounts-slip-modal-card,
          .accounts-slip-body,
          .accounts-slip-preview,
          .accounts-slip-desk {
            display: block !important;
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            background: transparent !important;
          }
          #accounts-slip-print-area {
            position: static;
            width: 100%;
            margin: 0;
            padding: 15px;
            background: white !important;
          }
          .print-hidden {
            display: none !important;
          }
          .a2b-page-break {
            page-break-before: always !important;
            break-before: page !important;
          }
        }
      `,
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-slip-title"
        className="accounts-slip-modal-card bg-white rounded-t-2xl sm:rounded-2xl max-w-6xl w-full h-[96dvh] sm:h-[94vh] shadow-2xl relative text-stone-800 flex flex-col max-lg:overflow-y-auto lg:overflow-hidden animate-in zoom-in-95 duration-200"
      >
        {/* Title bar (hidden in print). On phones it stays put while the rest scrolls. */}
        <div className={`print-hidden ${modalHeader} shrink-0 bg-white rounded-t-2xl max-lg:sticky max-lg:top-0 max-lg:z-20`}>
          <div className="min-w-0">
            <h3 id="accounts-slip-title" className={modalTitle}>
              {isAToB ? 'A→B refund receipt' : 'B→A shift slip for Accounts'}
            </h3>
            <p className="mt-1 text-[13px] text-stone-600 tabular-nums">
              {isAToB ? (
                'Choose the zaereen shifting from Category A to B. The receipt lists name, ITS and age for the Accounts refund check.'
              ) : (
                <>
                  Tour reference:{' '}
                  <span className="font-semibold text-stone-900 break-all">
                    {selectedTourFilter !== 'ALL' ? selectedTourFilter : tourIdVal || 'Individual Allotment'}
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${modalClose} max-sm:w-10 max-sm:h-10`}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="accounts-slip-body flex-1 lg:min-h-0 flex flex-col lg:flex-row">
          {/* Left: who and what goes on the slip (hidden in print) */}
          <div className="print-hidden lg:w-[400px] lg:shrink-0 lg:min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-stone-200">
            <div className="px-4 sm:px-5 pt-4 pb-3 space-y-3.5">
              {/* Direction: B -> A vs A -> B */}
              <div role="group" aria-label="Shift direction" className={segWrap}>
                <button
                  type="button"
                  aria-pressed={direction === 'B_TO_A'}
                  onClick={() => setDirection('B_TO_A')}
                  className={segBtn(direction === 'B_TO_A')}
                >
                  <ArrowUpRight className="w-4 h-4 text-stone-500" />
                  <span>B→A (collect)</span>
                </button>
                <button
                  type="button"
                  aria-pressed={direction === 'A_TO_B'}
                  onClick={() => setDirection('A_TO_B')}
                  className={segBtn(direction === 'A_TO_B')}
                >
                  <ArrowDownLeft className="w-4 h-4 text-stone-500" />
                  <span>A→B (refund receipt)</span>
                </button>
              </div>

              <div>
                <label htmlFor="accounts-slip-tour" className={fieldLabel}>
                  Tour ID
                </label>
                <select
                  id="accounts-slip-tour"
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
                  className={`${field} tabular-nums truncate cursor-pointer`}
                >
                  <option value="ALL">All tours ({allReservations.length} pax)</option>
                  {distinctTourOptions.map((opt) => (
                    <option key={opt.tourId} value={opt.tourId}>
                      {opt.tourId} ({opt.count} pax)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span id="accounts-slip-scope-label" className={fieldLabel}>
                  Slip covers
                </span>
                <div role="group" aria-labelledby="accounts-slip-scope-label" className={segWrap}>
                  <button
                    type="button"
                    aria-pressed={slipMode === 'tour'}
                    onClick={() => setSlipMode('tour')}
                    className={segBtn(slipMode === 'tour')}
                  >
                    <Layers className="w-4 h-4 text-stone-500" />
                    <span>
                      Selected list <span className="tabular-nums font-normal text-stone-500">({selectedReservations.length})</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={slipMode === 'single'}
                    onClick={() => setSlipMode('single')}
                    className={segBtn(slipMode === 'single')}
                  >
                    <UserCheck className="w-4 h-4 text-stone-500" />
                    <span>Single pax</span>
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="accounts-slip-amount" className={fieldLabel}>
                  {isAToB ? 'Refund amount' : 'Amount note'}
                </label>
                <input
                  id="accounts-slip-amount"
                  type="text"
                  placeholder={
                    isAToB
                      ? 'Accounts refund amount (leave blank for Accounts to write)'
                      : 'Amount note (leave blank for Accounts to fill)'
                  }
                  value={accountsAmountNote}
                  onChange={(e) => setAccountsAmountNote(e.target.value)}
                  className={field}
                />
              </div>
            </div>

            {/* Pax selection: name, ITS, age, family, room */}
            <div className="border-t border-stone-200 px-4 sm:px-5 pt-3.5 pb-2 space-y-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-[15px] font-semibold text-stone-950">
                  {isAToB ? 'Pax shifting A→B' : 'Pax shifting B→A'}
                </h4>
                <span className="text-[13px] text-stone-600 tabular-nums whitespace-nowrap">
                  {selectedMemberIds.length} of {filteredPoolMembers.length} selected
                </span>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400 pointer-events-none" />
                <input
                  type="text"
                  aria-label="Search pax"
                  placeholder="Search name, ITS, age, family or room"
                  value={searchMemberQuery}
                  onChange={(e) => setSearchMemberQuery(e.target.value)}
                  className={`${field} pl-9`}
                />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button type="button" onClick={handleSelectAllFiltered} className={`${btnSm.secondary} max-sm:h-10`}>
                  Select all ({filteredPoolMembers.length})
                </button>
                {isAToB && savedAToBPax.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectSavedAToBPax}
                    className={`${btnSm.secondary} max-sm:h-10`}
                    title="Select all pax already marked as shifted A to B"
                  >
                    Saved A→B ({savedAToBPax.length})
                  </button>
                )}
                {!isAToB && savedBToAPax.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectSavedBToAPax}
                    className={`${btnSm.secondary} max-sm:h-10`}
                    title="Select all pax already marked as B to A"
                  >
                    Saved B→A ({savedBToAPax.length})
                  </button>
                )}
                {anchorReservation?.family && (
                  <button type="button" onClick={handleSelectSameFamily} className={`${btnSm.secondary} max-sm:h-10`}>
                    Family #{anchorReservation.family}
                  </button>
                )}
                <button type="button" onClick={handleClearSelection} className={`${btnSm.ghost} max-sm:h-10`}>
                  Clear
                </button>
              </div>
            </div>

            {/* Checklist of pax */}
            <div className="lg:flex-1 lg:min-h-0 max-lg:max-h-80 overflow-y-auto px-2 sm:px-3 pb-2">
              {filteredPoolMembers.length > 0 ? (
                <ul className="divide-y divide-stone-100">
                  {filteredPoolMembers.map((member) => {
                    const isSelected = selectedMemberIds.includes(member.id);
                    const isSettled = isAToB ? member.refundGiven === 'Yes' : member.moneyGiven === 'Yes';

                    return (
                      <li
                        key={member.id}
                        className={`flex items-center gap-2 pl-2 pr-1 rounded-lg transition-colors ${
                          isSelected ? 'bg-brand-50' : 'hover:bg-stone-50'
                        }`}
                      >
                        <label className="flex items-center gap-3 py-2 min-h-11 cursor-pointer flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleMember(member.id)}
                            className="w-4 h-4 rounded shrink-0 cursor-pointer"
                          />
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold text-stone-950 leading-snug">
                              {member.applicantName}
                            </span>
                            <span className="block text-xs text-stone-600 tabular-nums leading-snug">
                              ITS {member.itsId || '—'} · {member.age || '—'}y {member.gender === 'Female' ? 'F' : 'M'} · Fam #
                              {member.family || '—'} ·{' '}
                              {member.roomNumber ? `Rm ${member.roomNumber} (${member.building})` : 'Room pending'}
                            </span>
                          </span>
                        </label>

                        <div className="flex items-center shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSingleZaerId(member.id);
                              if (slipMode === 'single') setSlipMode('single');
                            }}
                            className={`${btnSm.ghost} max-sm:h-10 px-2`}
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
                            aria-pressed={isSettled}
                            title={
                              isAToB
                                ? isSettled
                                  ? 'Refunded. Click to mark refund pending'
                                  : 'Refund pending. Click to mark refunded'
                                : isSettled
                                ? 'Paid. Click to mark pending'
                                : 'Pending. Click to mark paid'
                            }
                            className="inline-flex items-center h-10 sm:h-8 px-1 rounded-lg cursor-pointer hover:bg-stone-100"
                          >
                            <span className={chip(isSettled ? 'ok' : 'wait')}>
                              {isAToB ? (isSettled ? 'Refunded' : 'Refund pending') : isSettled ? 'Paid' : 'Pending'}
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="py-8 px-3 text-center text-[13px] text-stone-500">
                  No zaereen match this search. Clear the search or choose another Tour ID.
                </div>
              )}
            </div>

            {/* Record the shift in the portal */}
            <div className="shrink-0 border-t border-stone-200 bg-stone-50 px-4 sm:px-5 py-3 space-y-2.5">
              {actionFeedback && (
                <div
                  role="status"
                  className="rounded-lg bg-emerald-50 ring-1 ring-inset ring-emerald-200 pl-3 pr-1 py-1 text-[13px] font-medium text-emerald-900 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>{actionFeedback}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActionFeedback(null)}
                    aria-label="Dismiss"
                    className="w-8 h-8 max-sm:w-10 max-sm:h-10 shrink-0 rounded-lg flex items-center justify-center text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleApplyShiftAction(true)}
                  disabled={selectedMemberIds.length === 0}
                  className={`${btnSm.primary} max-sm:h-10 max-sm:flex-1`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {isAToB
                      ? `Shift A→B (${selectedMemberIds.length}) and mark refunded`
                      : `Shift B→A (${selectedMemberIds.length}) and mark paid`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyShiftAction(false)}
                  disabled={selectedMemberIds.length === 0}
                  className={`${btnSm.secondary} max-sm:h-10`}
                >
                  {isAToB ? 'Shift A→B, refund pending' : 'Shift as pending'}
                </button>
              </div>
            </div>
          </div>

          {/* Right: the slip itself, with the output actions above it */}
          <div className="accounts-slip-preview flex-1 min-w-0 lg:min-h-0 flex flex-col">
            <div className="print-hidden shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-stone-200">
              <div className="min-w-0 text-[13px] text-stone-600">
                <span className="font-semibold text-stone-900">Slip preview</span>
                <span className="max-sm:hidden tabular-nums">
                  {' '}
                  ·{' '}
                  {isAToB
                    ? `${tourSlipGroups.length} tour ${tourSlipGroups.length === 1 ? 'slip' : 'slips'}, 2 pages each`
                    : `${effectiveSlipPaxList.length} pax`}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={handlePrint} className={btn.secondary}>
                  <Printer className="w-4 h-4" />
                  <span>{isAToB ? 'Print receipt' : 'Print slip'}</span>
                </button>
                <button type="button" onClick={handleDownloadPdfSlip} className={btn.primary}>
                  <Download className="w-4 h-4" />
                  <span>Download PDF</span>
                </button>
              </div>
            </div>

            {/* The desk: a neutral well with the paper on it. Print CSS flattens the desk and prints the paper alone. */}
            <div className="accounts-slip-desk bg-stone-100 p-3 sm:p-5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto sm:max-lg:rounded-b-2xl lg:rounded-br-2xl">
        {/* Printable Receipt / Slip Paper View */}
        <div
          id="accounts-slip-print-area"
          className="space-y-5"
        >
          {isAToB ? (
            <>
              {tourSlipGroups.map((group, groupIdx) => (
                <div
                  key={group.tourId}
                  className={`space-y-4 ${groupIdx > 0 ? 'a2b-page-break pt-2' : ''}`}
                >
                  {/* Tour Slip Header Bar (Hidden on print) */}
                  <div className="print-hidden flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1 text-[13px] text-stone-600">
                    <div className="min-w-0 tabular-nums">
                      <span className="font-semibold text-stone-950">
                        Slip {groupIdx + 1} of {tourSlipGroups.length}
                      </span>{' '}
                      · <span className="font-semibold text-stone-900 break-all">{group.tourId}</span> · {group.officeName} ·{' '}
                      {group.paxCount} pax · {group.nights} nights
                    </div>
                    <button
                      type="button"
                      onClick={() => generateAToBPdfForGroups([group])}
                      className={`${btnSm.secondary} max-sm:h-10`}
                    >
                      <Download className="w-4 h-4 text-stone-500" />
                      <span>Download this tour's PDF</span>
                    </button>
                  </div>

                  {/* PAGE 1: FRONT PAGE (Same structure as B to A slip) */}
                  <div className="p-4 sm:p-6 bg-white border border-stone-200 rounded-xl shadow-xs text-xs space-y-4">
                    <div className="print-hidden flex items-center justify-between gap-3 text-xs font-medium text-stone-500 border-b border-stone-100 pb-1.5">
                      <span>Page 1 · Front page (summary and Accounts)</span>
                      <span className="tabular-nums">{group.tourId}</span>
                    </div>

                    {/* Official Header */}
                    <div className="text-center pb-3 border-b-2 border-brand-700">
                      <div className="flex justify-center mb-1">
                        <FaizHusainiLogo size="md" />
                      </div>
                      <div className="inline-block font-bold text-xs uppercase px-3 py-1 rounded-md tracking-wider mt-1 bg-brand-700 text-white">
                        ACCOUNTS DEPARTMENT — CATEGORY A TO B SHIFT SLIP
                      </div>
                      <div className="text-xs font-semibold text-stone-600 mt-1">
                        Official Shift &amp; Refund Record:{' '}
                        <strong className="text-stone-900">Category A (Nizaam) ➔ Category B (Standard)</strong> · Faiz-e-Husaini Najaf
                      </div>
                    </div>

                    {/* Slip Reference & Date Header */}
                    <div className="flex items-center justify-between bg-stone-50 px-4 py-2 rounded-lg border border-stone-200 text-xs">
                      <div>
                        <span className="text-stone-500 text-[11px] block">Slip / Refund Receipt No:</span>
                        <span className="font-mono font-bold text-brand-700 text-sm tabular-nums">{group.slipNo}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-stone-500 text-[11px] block">Date of Issue:</span>
                        <span className="font-semibold text-stone-800 text-sm tabular-nums">
                          {new Date().toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {/* Front Page Core Specification Table (Same as B to A slip) */}
                    <div className="overflow-x-auto border-2 border-brand-700/30 rounded-xl shadow-xs">
                      <table className="w-full text-left text-sm border-collapse bg-white">
                        <thead>
                          <tr className="bg-brand-700 text-white">
                            <th className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider w-[44%]">
                              A to B Slip Detail
                            </th>
                            <th className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider w-[56%]">
                              Official Specification
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200">
                          <tr>
                            <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Tour ID</td>
                            <td className="py-2.5 px-4 font-mono font-bold text-base text-brand-700 break-all">
                              {group.tourId}
                            </td>
                          </tr>

                          <tr>
                            <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Office Name</td>
                            <td className="py-2.5 px-4 font-semibold text-stone-900 text-sm">{group.officeName}</td>
                          </tr>

                          <tr>
                            <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Number of pax</td>
                            <td className="py-2.5 px-4 font-bold text-stone-900 text-sm tabular-nums">
                              {group.paxCount} Pax
                            </td>
                          </tr>

                          <tr>
                            <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Number of nights</td>
                            <td className="py-2.5 px-4 font-bold text-stone-900 text-sm tabular-nums">
                              {group.nights} Nights
                            </td>
                          </tr>

                          <tr className="bg-amber-50/40">
                            <td className="py-2.5 px-4 font-semibold text-stone-800 bg-amber-50/60">
                              Amount{' '}
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
                              {formatDateTimeDisplay(group.arrivalDate, group.arrivalTime)}
                            </td>
                          </tr>

                          <tr>
                            <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Date of departure</td>
                            <td className="py-2.5 px-4 font-medium text-stone-900 text-sm tabular-nums">
                              {formatDateTimeDisplay(group.departureDate, group.departureTime)}
                            </td>
                          </tr>

                          <tr>
                            <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Room given in</td>
                            <td className="py-2.5 px-4 font-bold text-brand-700 text-sm">{group.roomSummary}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Accounts Notice (Same as B to A slip) */}
                    <div className="p-3 rounded-lg bg-stone-50 border border-stone-300 text-xs text-stone-700 space-y-1.5">
                      <div>
                        <strong>Accounts Department Directive:</strong> Please verify the shifted pax roster on Page 2, fill the approved Category A to B refund differential in the blank box, issue voucher/receipt, and reconcile against official group records.
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-[11px] text-stone-700">
                        <div>Amount Refunded ($): _______________________</div>
                        <div>Voucher / Receipt No: _______________________</div>
                      </div>
                    </div>

                    {/* Signatures (Same as B to A slip) */}
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
                        <div>Accounts Cashier Verification &amp; Stamp</div>
                      </div>
                    </div>
                  </div>

                  {/* PAGE 2: SECOND PAGE — NAMES OF ALL PAX SENT TO A TO B FOR THIS TOUR ID */}
                  <div className="a2b-page-break p-4 sm:p-6 bg-white border border-stone-200 rounded-xl shadow-xs text-xs space-y-4">
                    <div className="print-hidden flex items-center justify-between gap-3 text-xs font-medium text-stone-500 border-b border-stone-100 pb-1.5">
                      <span>Page 2 · Names of all pax sent to A to B</span>
                      <span className="tabular-nums">{group.tourId}</span>
                    </div>

                    {/* Page 2 Header */}
                    <div className="text-center pb-3 border-b-2 border-brand-700">
                      <div className="flex justify-center mb-1">
                        <FaizHusainiLogo size="sm" showSubtitle={false} />
                      </div>
                      <div className="inline-block font-bold text-xs uppercase px-3 py-1 rounded-md tracking-wider mt-1 bg-brand-700 text-white">
                        PAGE 2 — PAX NAMES SENT TO A TO B
                      </div>
                      <div className="text-xs text-stone-700 font-semibold mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                        <span>
                          Tour ID: <strong className="font-mono text-brand-700">{group.tourId}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Office: <strong className="text-stone-900">{group.officeName}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Total Pax: <strong className="text-stone-900 tabular-nums">{group.paxList.length} Pax</strong>
                        </span>
                      </div>
                    </div>

                    <div className="border-2 border-brand-700/25 rounded-xl overflow-hidden bg-white shadow-xs">
                      <div className="bg-brand-700 text-white px-4 py-2 flex items-center justify-between">
                        <span className="font-bold text-xs uppercase tracking-wider">
                          Shifted Pax Roster — {group.tourId}
                        </span>
                        <span className="font-mono font-bold text-xs tabular-nums text-gold-200">
                          {group.paxList.length} Pax
                        </span>
                      </div>

                      {group.paxList.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-stone-100 text-stone-700 uppercase text-[11px] font-bold border-b border-stone-200">
                              <tr>
                                <th className="py-2 px-3 w-10 text-center">#</th>
                                <th className="py-2 px-3">Zaer Name (Sent to A to B)</th>
                                <th className="py-2 px-3">ITS ID</th>
                                <th className="py-2 px-3 text-center">Age</th>
                                <th className="py-2 px-3 text-center">Sex</th>
                                <th className="py-2 px-3 text-center">Family</th>
                                <th className="py-2 px-3">Room Allotted</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-200">
                              {group.paxList.map((z, idx) => (
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
                        <div className="p-6 text-center text-xs text-stone-500 italic">
                          Select one or more zaereen above to populate the Page 2 pax list for this Tour ID.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="p-4 sm:p-6 bg-white border border-stone-200 rounded-xl shadow-xs text-xs space-y-4">
              {/* Official Header */}
              <div className="text-center pb-3 border-b-2 border-brand-700">
                <div className="flex justify-center mb-1">
                  <FaizHusainiLogo size="md" />
                </div>
                <div className="inline-block font-bold text-xs uppercase px-3 py-1 rounded-md tracking-wider mt-1 bg-brand-700 text-white">
                  {slipMode === 'tour' && effectiveSlipPaxList.length > 1
                    ? 'ACCOUNTS DEPARTMENT — CONSOLIDATED TOUR B TO A SHIFT PAYMENT SLIP'
                    : 'ACCOUNTS DEPARTMENT — PILGRIM B TO A SHIFT REQUEST SLIP'}
                </div>
                <div className="text-xs font-semibold text-stone-600 mt-1">
                  Official Shift Request:{' '}
                  <strong className="text-stone-900">Category B (Standard) ➔ Category A (Nizaam)</strong> · Faiz-e-Husaini Najaf
                </div>
              </div>

              {/* Slip Reference & Date Header */}
              <div className="flex items-center justify-between bg-stone-50 px-4 py-2 rounded-lg border border-stone-200 text-xs">
                <div>
                  <span className="text-stone-500 text-[11px] block">Slip Reference No:</span>
                  <span className="font-mono font-bold text-brand-700 text-sm tabular-nums">{slipNo}</span>
                </div>
                <div className="text-right">
                  <span className="text-stone-500 text-[11px] block">Date of Issue:</span>
                  <span className="font-semibold text-stone-800 text-sm tabular-nums">
                    {new Date().toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Core Specification Rows */}
              <div className="overflow-x-auto border-2 border-brand-700/30 rounded-xl shadow-xs">
                <table className="w-full text-left text-sm border-collapse bg-white">
                  <thead>
                    <tr className="bg-brand-700 text-white">
                      <th className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider w-[44%]">
                        Shift Slip Detail
                      </th>
                      <th className="py-2.5 px-4 font-bold text-xs uppercase tracking-wider w-[56%]">
                        Official Specification
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    <tr>
                      <td className="py-2.5 px-4 font-semibold text-stone-700 bg-stone-50/50">Tour ID</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-base text-brand-700 break-all">
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
                        Amount{' '}
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
                      <td className="py-2.5 px-4 font-bold text-brand-700 text-sm">{roomVal}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Accounts Notice */}
              <div className="p-3 rounded-lg bg-stone-50 border border-stone-300 text-xs text-stone-700 space-y-1.5">
                <div>
                  <strong>Accounts Department Directive:</strong> Please collect the category B to A differential tariff, issue payment receipt, and reconcile against official group records.
                </div>
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
                  <div>Accounts Cashier Verification &amp; Stamp</div>
                </div>
              </div>
            </div>
          )}
        </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
