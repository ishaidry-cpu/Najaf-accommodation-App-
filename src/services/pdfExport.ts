import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Reservation, Room } from '../types';
import { normalizeDate } from './excelService';

export interface PdfExportOptions {
  reportType: 'all_reservations' | 'category_upgrades' | 'rooms_inventory' | 'tour_manifest';
  tourIdFilter?: string;
  buildingFilter?: string;
  arrivalDateFilter?: string;
  includeSignatures?: boolean;
}

export function generateAdministrativePdf(
  reservations: Reservation[],
  rooms: Room[],
  options: PdfExportOptions
) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const generatedDate = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Filter reservations based on options
  let filteredReservations = [...reservations];
  if (options.reportType === 'category_upgrades') {
    filteredReservations = filteredReservations.filter((r) => r.isUpgradedFromBToA);
  }
  if (options.tourIdFilter && options.tourIdFilter !== 'ALL') {
    filteredReservations = filteredReservations.filter((r) => r.tourId === options.tourIdFilter || r.tourRefNo === options.tourIdFilter);
  }
  if (options.buildingFilter && options.buildingFilter !== 'ALL') {
    filteredReservations = filteredReservations.filter((r) => r.building === options.buildingFilter);
  }
  if (options.arrivalDateFilter && options.arrivalDateFilter !== 'ALL') {
    filteredReservations = filteredReservations.filter((r) => {
      const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
      return arr === options.arrivalDateFilter;
    });
  }

  // Header banner background
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 68, 'F');

  // Decorative gold/amber stripe
  doc.setFillColor(217, 119, 6); // amber-600
  doc.rect(0, 68, pageWidth, 4, 'F');

  // Header Titles
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ZAEREEN ACCOMMODATION & RESERVATION MANAGEMENT SYSTEM', 40, 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225); // slate-300
  let subtitle = 'OFFICIAL ADMINISTRATIVE DOCUMENTATION';
  if (options.reportType === 'category_upgrades') {
    subtitle = 'ZAEREEN CATEGORY B TO A (NIZAAM) UPGRADE & BALANCE SETTLEMENT REPORT';
  } else if (options.reportType === 'rooms_inventory') {
    subtitle = 'ROOM INVENTORY, AVAILABILITY STATUS & BLOCKED ROOMS AUDIT';
  } else if (options.reportType === 'tour_manifest') {
    subtitle = `TOUR ID MANIFEST: ${options.tourIdFilter || 'ALL TOURS'}`;
  }
  if (options.arrivalDateFilter && options.arrivalDateFilter !== 'ALL') {
    subtitle += ` • ARRIVAL DATE: ${options.arrivalDateFilter} (${filteredReservations.length} ZAEREEN)`;
  }
  doc.text(subtitle, 40, 48);

  // Metadata top right
  doc.setFontSize(8);
  doc.setTextColor(226, 232, 240);
  doc.text(`Doc Ref: ADM-${Date.now().toString().slice(-6)}`, pageWidth - 200, 26);
  doc.text(`Generated: ${generatedDate}`, pageWidth - 200, 39);
  doc.text(`Authority: Accommodation Directorate`, pageWidth - 200, 52);

  let currentY = 90;

  // Summary Metrics Banner
  if (options.reportType !== 'rooms_inventory') {
    const totalRecords = filteredReservations.length;
    const totalZaereen = filteredReservations.reduce((sum, r) => sum + (r.totalGuests || r.paxCount || 1), 0);
    const upgradedCount = filteredReservations.filter((r) => r.isUpgradedFromBToA || r.category === 'B to A').length;
    const totalBilled = filteredReservations.reduce((sum, r) => sum + (r.totalCost || 0), 0);
    const totalCollected = filteredReservations.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
    const totalBalanceDue = filteredReservations.reduce((sum, r) => sum + (r.balanceDue || 0), 0);

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(40, currentY, pageWidth - 80, 44, 4, 4, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, currentY, pageWidth - 80, 44, 4, 4, 'S');

    const colWidth = (pageWidth - 80) / 6;
    const statCards = [
      { label: 'RESERVATIONS', val: totalRecords.toString() },
      { label: 'TOTAL ZAEREEN', val: totalZaereen.toString() },
      { label: 'B ➔ A UPGRADES', val: upgradedCount.toString() },
      { label: 'TOTAL BILLED', val: `$${totalBilled.toLocaleString()}` },
      { label: 'COLLECTED', val: `$${totalCollected.toLocaleString()}` },
      { label: 'BALANCE OUTSTANDING', val: `$${totalBalanceDue.toLocaleString()}`, highlight: totalBalanceDue > 0 },
    ];

    statCards.forEach((stat, idx) => {
      const x = 40 + idx * colWidth + 12;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text(stat.label, x, currentY + 16);

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      if (stat.highlight) {
        doc.setTextColor(220, 38, 38); // red-600
      } else {
        doc.setTextColor(15, 23, 42);
      }
      doc.text(stat.val, x, currentY + 34);
    });

    currentY += 56;
  } else {
    // Rooms metrics banner
    const totalRooms = rooms.length;
    const availableRooms = rooms.filter((r) => r.status === 'available').length;
    const occupiedRooms = rooms.filter((r) => r.status === 'occupied').length;
    const blockedRooms = rooms.filter((r) => r.status === 'blocked').length;
    const cleaningRooms = rooms.filter((r) => r.status === 'cleaning').length;

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(40, currentY, pageWidth - 80, 44, 4, 4, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, currentY, pageWidth - 80, 44, 4, 4, 'S');

    const colWidth = (pageWidth - 80) / 5;
    const statCards = [
      { label: 'TOTAL ROOM INVENTORY', val: totalRooms.toString() },
      { label: 'AVAILABLE ROOMS', val: availableRooms.toString(), color: [22, 101, 52] },
      { label: 'CURRENTLY OCCUPIED', val: occupiedRooms.toString(), color: [30, 64, 175] },
      { label: 'BLOCKED ROOMS', val: blockedRooms.toString(), color: [185, 28, 28] },
      { label: 'IN CLEANING / TURNOVER', val: cleaningRooms.toString(), color: [194, 65, 12] },
    ];

    statCards.forEach((stat, idx) => {
      const x = 40 + idx * colWidth + 12;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text(stat.label, x, currentY + 16);

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      if (stat.color) {
        doc.setTextColor(stat.color[0], stat.color[1], stat.color[2]);
      } else {
        doc.setTextColor(15, 23, 42);
      }
      doc.text(stat.val, x, currentY + 34);
    });

    currentY += 56;
  }

  // Generate Table based on report type
  if (options.reportType === 'rooms_inventory') {
    const renderInventoryTable = (hotelTitle: string, roomList: Room[], startAtY: number) => {
      doc.setFillColor(18, 78, 57); // #124E39
      doc.roundedRect(30, startAtY, pageWidth - 60, 24, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158); // Gold #EBD59E
      doc.text(hotelTitle, 40, startAtY + 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text(`Total Rooms in Section: ${roomList.length}`, pageWidth - 160, startAtY + 16);

      const tableBody = roomList.map((rm) => [
        rm.building,
        `Room ${rm.roomNumber}`,
        `Floor ${rm.floor}`,
        `${rm.capacity} beds`,
        rm.category,
        rm.status.toUpperCase(),
        rm.status === 'blocked' ? (rm.blockedReason || 'Maintenance') : '—',
        rm.expectedUnblockDate || '—',
        rm.amenities.slice(0, 3).join(', '),
      ]);

      autoTable(doc, {
        startY: startAtY + 28,
        head: [
          [
            'Building',
            'Room Number',
            'Floor',
            'Capacity',
            'Category',
            'Status',
            'Blocked Reason (If Blocked)',
            'Expected Unblock Date',
            'Amenities',
          ],
        ],
        body: tableBody.length > 0 ? tableBody : [['No rooms found for this hotel section', '', '', '', '', '', '', '', '']],
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 8,
          cellPadding: 4,
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 5) {
            const val = data.cell.raw as string;
            if (val === 'BLOCKED') {
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [254, 242, 242];
            } else if (val === 'AVAILABLE') {
              data.cell.styles.textColor = [22, 101, 52];
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [240, 253, 244];
            } else if (val === 'OCCUPIED') {
              data.cell.styles.textColor = [30, 64, 175];
              data.cell.styles.fillColor = [239, 246, 255];
            }
          }
        },
        margin: { left: 30, right: 30 },
      });

      return (doc as any).lastAutoTable.finalY + 20;
    };

    if (options.buildingFilter === 'Saifee') {
      const saifeeRooms = rooms.filter((r) => (r.building || '').toLowerCase().includes('saifee'));
      renderInventoryTable('SAIFEE HOTEL — ROOM INVENTORY AUDIT (70 ROOMS)', saifeeRooms, currentY);
    } else if (options.buildingFilter === 'Burhani') {
      const burhaniRooms = rooms.filter((r) => (r.building || '').toLowerCase().includes('burhani'));
      renderInventoryTable('BURHANI HOTEL — ROOM INVENTORY AUDIT (44 ROOMS)', burhaniRooms, currentY);
    } else {
      // Joined & Bifurcated with page break
      const saifeeRooms = rooms.filter((r) => (r.building || '').toLowerCase().includes('saifee'));
      const burhaniRooms = rooms.filter((r) => (r.building || '').toLowerCase().includes('burhani'));

      renderInventoryTable('PART 1: SAIFEE HOTEL (70 ROOMS) — INVENTORY & AVAILABILITY', saifeeRooms, currentY);
      doc.addPage();
      currentY = 40;
      renderInventoryTable('PART 2: BURHANI HOTEL (44 ROOMS) — INVENTORY & AVAILABILITY', burhaniRooms, currentY);
    }
  } else if (options.reportType === 'category_upgrades') {
    const renderUpgradesTable = (hotelTitle: string, list: Reservation[], startAtY: number) => {
      doc.setFillColor(18, 78, 57); // #124E39
      doc.roundedRect(30, startAtY, pageWidth - 60, 24, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158); // Gold #EBD59E
      doc.text(hotelTitle, 40, startAtY + 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text(`Total Upgrades in Section: ${list.length}`, pageWidth - 160, startAtY + 16);

      const tableBody = list.map((res) => [
        res.tourRefNo || res.tourId || '',
        res.applicantName || res.guestLeaderName || '',
        res.family || res.familyNumber || '',
        `${res.building || '—'} - Rm ${res.roomNumber || '—'}`,
        (res.arrivalDate || res.arrivalDateTime || '').replace('T', ' '),
        (res.departureDate || res.departureDateTime || '').replace('T', ' '),
        res.upgradeReason || 'Requested Category B to A (Nizaam)',
        `$${(res.upgradeFee || 350).toLocaleString()}`,
        `$${(res.totalCost || 1350).toLocaleString()}`,
        `$${(res.amountPaid || 0).toLocaleString()}`,
        `$${(res.balanceDue || 0).toLocaleString()}`,
        res.moneyGiven === 'Yes' ? 'Paid (Yes)' : 'Pending (No)',
      ]);

      autoTable(doc, {
        startY: startAtY + 28,
        head: [
          [
            'Tour ID',
            'Zaereen Guest Leader',
            'Family #',
            'Room & Building',
            'Arrival Date & Time',
            'Departure Date & Time',
            'Upgrade Justification',
            'Upgrade Surcharge',
            'Total Cost',
            'Paid',
            'Balance Due',
            'Payment Status',
          ],
        ],
        body: tableBody.length > 0 ? tableBody : [['No category upgrades found for this hotel section', '', '', '', '', '', '', '', '', '', '', '']],
        theme: 'grid',
        headStyles: {
          fillColor: [180, 83, 9], // amber-700
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 8,
          cellPadding: 4,
        },
        didParseCell: (data) => {
          if (data.section === 'body') {
            if (data.column.index === 10) {
              const text = data.cell.raw as string;
              if (text !== '$0') {
                data.cell.styles.textColor = [185, 28, 28];
                data.cell.styles.fontStyle = 'bold';
              }
            }
            if (data.column.index === 11) {
              const status = data.cell.raw as string;
              if (status.includes('Paid')) {
                data.cell.styles.textColor = [22, 101, 52];
                data.cell.styles.fontStyle = 'bold';
              } else {
                data.cell.styles.textColor = [185, 28, 28];
                data.cell.styles.fontStyle = 'bold';
              }
            }
          }
        },
        margin: { left: 30, right: 30 },
      });

      return (doc as any).lastAutoTable.finalY + 20;
    };

    if (options.buildingFilter === 'Saifee') {
      const saifeeList = filteredReservations.filter((r) => (r.building || '').toLowerCase().includes('saifee'));
      renderUpgradesTable('SAIFEE HOTEL — CATEGORY B TO A UPGRADES (70 ROOMS)', saifeeList, currentY);
    } else if (options.buildingFilter === 'Burhani') {
      const burhaniList = filteredReservations.filter((r) => (r.building || '').toLowerCase().includes('burhani'));
      renderUpgradesTable('BURHANI HOTEL — CATEGORY B TO A UPGRADES (44 ROOMS)', burhaniList, currentY);
    } else {
      // Joined & Bifurcated
      const saifeeList = filteredReservations.filter((r) => (r.building || '').toLowerCase().includes('saifee'));
      const burhaniList = filteredReservations.filter((r) => (r.building || '').toLowerCase().includes('burhani'));
      const unallottedList = filteredReservations.filter(
        (r) => !r.building || (!r.building.toLowerCase().includes('saifee') && !r.building.toLowerCase().includes('burhani'))
      );

      renderUpgradesTable('PART 1: SAIFEE HOTEL — CATEGORY B TO A UPGRADE AUDIT', saifeeList, currentY);
      doc.addPage();
      currentY = 40;
      renderUpgradesTable('PART 2: BURHANI HOTEL — CATEGORY B TO A UPGRADE AUDIT', burhaniList, currentY);

      if (unallottedList.length > 0) {
        doc.addPage();
        currentY = 40;
        renderUpgradesTable('PART 3: UNALLOTTED ZAEREEN UPGRADES', unallottedList, currentY);
      }
    }
  } else {
    // All reservations / Tour manifest - BIFURCATED AS PER HOTELS (Prompt: "pdf should be bifurcated as per hotels. different buildings can be printed seperately and when joined it can be done too")
    const renderManifestTable = (hotelTitle: string, list: Reservation[], startAtY: number) => {
      // Sub-section hotel banner
      doc.setFillColor(18, 78, 57); // #124E39
      doc.roundedRect(30, startAtY, pageWidth - 60, 24, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(235, 213, 158); // Gold #EBD59E
      doc.text(hotelTitle, 40, startAtY + 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text(`Total Zaereen in Section: ${list.length}`, pageWidth - 160, startAtY + 16);

      const tableBody = list.map((res) => [
        res.tourRefNo || res.tourId || '',
        res.family || res.familyNumber || res.familyNo || '',
        res.officeName || '—',
        `${res.paxCount || res.pax || res.totalGuests || 1} Pax`,
        (res.arrivalDate || res.arrivalDateTime || '').replace('T', ' '),
        res.entryPort || 'Najaf (NJF)',
        (res.departureDate || res.departureDateTime || '').replace('T', ' '),
        res.exitPort || 'Najaf (NJF)',
        `${res.building || 'Unallotted'}\nRm ${res.roomNumber || '—'}`,
        res.category || (res.shiftToCategoryA ? 'B ➔ A (NIZAAM)' : 'Category A'),
        res.moneyGiven === 'Yes' ? 'YES (Given)' : 'NO (Pending)',
      ]);

      autoTable(doc, {
        startY: startAtY + 28,
        head: [
          [
            'Tour Ref No.',
            'Family No.',
            'Office Name',
            'Pax',
            'Arrival Date & Time',
            'Entry Port',
            'Departure Date & Time',
            'Exit Port',
            'Building & Room',
            'Shift Status',
            'Money Given?',
          ],
        ],
        body: tableBody.length > 0 ? tableBody : [['No zaereen records found for this hotel section', '', '', '', '', '', '', '', '', '', '']],
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: {
          fontSize: 8,
          cellPadding: 4,
        },
        didParseCell: (data) => {
          if (data.section === 'body') {
            if (data.column.index === 9) {
              data.cell.styles.textColor = [180, 83, 9];
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [254, 243, 199];
            }
            if (data.column.index === 10) {
              const val = data.cell.raw as string;
              if (val.includes('YES')) {
                data.cell.styles.textColor = [22, 101, 52];
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = [240, 253, 244];
              } else {
                data.cell.styles.textColor = [185, 28, 28];
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = [254, 242, 242];
              }
            }
          }
        },
        margin: { left: 30, right: 30 },
      });

      return (doc as any).lastAutoTable.finalY + 20;
    };

    if (options.buildingFilter === 'Saifee') {
      const saifeeList = filteredReservations.filter((r) => (r.building || '').toLowerCase().includes('saifee'));
      renderManifestTable('SAIFEE HOTEL — SEPARATE BUILDING LODGING MANIFEST (70 ROOMS)', saifeeList, currentY);
    } else if (options.buildingFilter === 'Burhani') {
      const burhaniList = filteredReservations.filter((r) => (r.building || '').toLowerCase().includes('burhani'));
      renderManifestTable('BURHANI HOTEL — SEPARATE BUILDING LODGING MANIFEST (44 ROOMS)', burhaniList, currentY);
    } else {
      // ALL HOTELS: JOINED & BIFURCATED WITH PAGE BREAKS (Prompt: "different buildings can be printed seperately and when joined it can be done too")
      const saifeeList = filteredReservations.filter((r) => (r.building || '').toLowerCase().includes('saifee'));
      const burhaniList = filteredReservations.filter((r) => (r.building || '').toLowerCase().includes('burhani'));
      const unallottedList = filteredReservations.filter(
        (r) => !r.building || (!r.building.toLowerCase().includes('saifee') && !r.building.toLowerCase().includes('burhani'))
      );

      // Part 1: Saifee Hotel
      renderManifestTable('PART 1: SAIFEE HOTEL (70 ROOMS) — LODGING MANIFEST', saifeeList, currentY);

      // Page break for Part 2: Burhani Hotel
      doc.addPage();
      currentY = 40;
      renderManifestTable('PART 2: BURHANI HOTEL (44 ROOMS) — LODGING MANIFEST', burhaniList, currentY);

      // If any unallotted zaereen exist, add Part 3 on clean page
      if (unallottedList.length > 0) {
        doc.addPage();
        currentY = 40;
        renderManifestTable('PART 3: UNALLOTTED ZAEREEN (PENDING HOTEL ALLOTMENT)', unallottedList, currentY);
      }
    }
  }

  // Footer / Signatures
  const finalY = (doc as any).lastAutoTable.finalY + 24;
  if (options.includeSignatures !== false && finalY < pageHeight - 60) {
    const signY = Math.min(finalY, pageHeight - 50);
    doc.setDrawColor(203, 213, 225);
    doc.setLineDashPattern([2, 2], 0);

    // Signature Box 1: Prepared by
    doc.line(50, signY + 20, 200, signY + 20);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Prepared by: Accommodation Desk Officer', 50, signY + 30);

    // Signature Box 2: Finance & Balance Audited
    doc.line(pageWidth / 2 - 75, signY + 20, pageWidth / 2 + 75, signY + 20);
    doc.text('Financial Balance Audited & Verified', pageWidth / 2 - 75, signY + 30);

    // Signature Box 3: Approved Director
    doc.line(pageWidth - 200, signY + 20, pageWidth - 50, signY + 20);
    doc.text('Authorized Directorate Stamp / Approval', pageWidth - 200, signY + 30);
  }

  // Page numbering
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Zaereen Accommodation & Google Sheets Reservation Management System — Page ${i} of ${totalPages}`,
      40,
      pageHeight - 12
    );
    doc.text(`CONFIDENTIAL ADMINISTRATIVE RECORD`, pageWidth - 200, pageHeight - 12);
  }

  const hotelSuffix = options.buildingFilter && options.buildingFilter !== 'ALL'
    ? `_${options.buildingFilter}_Hotel`
    : '_Joined_Bifurcated_Hotels';
  const arrivalSuffix = options.arrivalDateFilter && options.arrivalDateFilter !== 'ALL'
    ? `_Arrival_${options.arrivalDateFilter}`
    : '';
  const fileName = `Zaereen_${options.reportType}${hotelSuffix}${arrivalSuffix}_${new Date().toISOString().slice(0, 10)}.pdf`;
  saveOrDownloadPdf(doc, fileName);
}

export interface PdfDownloadResult {
  fileName: string;
  blobUrl: string;
  success: boolean;
}

export function saveOrDownloadPdf(doc: jsPDF, fileName: string): PdfDownloadResult {
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = doc.output('blob');
      const blobUrl = URL.createObjectURL(blob);

      // Primary: DOM download link
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        try {
          document.body.removeChild(link);
        } catch (e) {}
      }, 2000);

      return { fileName, blobUrl, success: true };
    } else {
      return { fileName, blobUrl: '', success: true };
    }
  } catch (err) {
    console.error('saveOrDownloadPdf error:', err);
    try {
      doc.save(fileName);
      return { fileName, blobUrl: '', success: true };
    } catch (e2) {
      console.error('doc.save also failed:', e2);
      return { fileName, blobUrl: '', success: false };
    }
  }
}

/**
 * Dedicated Arrivals PDF Generator for chosen arrival date
 * Bifurcated as per hotels: Saifee Hotel, Burhani Hotel, or Joined (with page breaks)
 * Requirements:
 * 1. "I want the downloaded pdf of the date of arrival I have chosen"
 * 2. "pdf should be bifurcated as per hotels. different buildings can be printed seperately and when joined it can be done too"
 */
export function generateArrivalsPdfForDate(
  reservations: Reservation[],
  rooms: Room[],
  arrivalDate: string,
  buildingFilter: 'ALL' | 'Saifee' | 'Burhani' = 'ALL'
): PdfDownloadResult {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Filter reservations for the chosen arrival date
  const arrivalsOnDate = reservations.filter((r) => {
    const arr = normalizeDate(r.arrivalDate || r.arrivalDateTime || r.rawArrivalStr);
    return arr === arrivalDate;
  });

  const saifeeArrivals = arrivalsOnDate.filter((r) => (r.building || '').toLowerCase().includes('saifee'));
  const burhaniArrivals = arrivalsOnDate.filter((r) => (r.building || '').toLowerCase().includes('burhani'));
  const unallottedArrivals = arrivalsOnDate.filter(
    (r) => !r.building || (!r.building.toLowerCase().includes('saifee') && !r.building.toLowerCase().includes('burhani'))
  );

  // Group reservations by Tour ID
  const groupByTour = (list: Reservation[]) => {
    const map = new Map<string, Reservation[]>();
    list.forEach((r) => {
      const tour = (r.tourRefNo || r.tourId || 'Unassigned Tour').trim();
      const existing = map.get(tour) || [];
      existing.push(r);
      map.set(tour, existing);
    });

    const groups: { tourRefNo: string; officeName: string; list: Reservation[] }[] = [];
    map.forEach((items, tourRefNo) => {
      // Sort chronologically by arrival time
      const sorted = [...items].sort((a, b) => {
        const tA = (a.arrivalDateTime || a.arrivalDate || '').slice(11, 16) || '11:00';
        const tB = (b.arrivalDateTime || b.arrivalDate || '').slice(11, 16) || '11:00';
        return tA.localeCompare(tB);
      });
      groups.push({
        tourRefNo,
        officeName: items[0]?.officeName || '—',
        list: sorted,
      });
    });
    return groups;
  };

  const renderHotelSection = (
    hotelTitle: string,
    list: Reservation[],
    startAtY: number,
    roomCapacity: number,
    badgeColor: [number, number, number] = [18, 78, 57]
  ) => {
    // Header Banner for this hotel
    doc.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2]);
    doc.roundedRect(30, startAtY, pageWidth - 60, 26, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(235, 213, 158); // Gold #EBD59E
    doc.text(hotelTitle, 40, startAtY + 17);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    const tourCount = new Set(list.map((r) => r.tourRefNo || r.tourId)).size;
    const famCount = new Set(list.map((r) => r.family)).size;
    doc.text(
      `Total Zaereen: ${list.length} • Families: ${famCount} • Tours: ${tourCount} • Capacity: ${roomCapacity} Rooms`,
      pageWidth - 280,
      startAtY + 17
    );

    // Build rows grouped by tour
    const tourGroups = groupByTour(list);
    const rows: string[][] = [];
    let counter = 1;

    tourGroups.forEach((group) => {
      group.list.forEach((r) => {
        const timeStr = (r.arrivalDateTime || r.arrivalDate || '').replace('T', ' ').slice(11, 16) || '11:00 AM';
        rows.push([
          String(counter++),
          `Tour: ${group.tourRefNo}\nOffice: ${group.officeName}`,
          r.roomNumber ? `Room ${r.roomNumber}\n(${r.building || ''})` : 'UNALLOTTED\n[Assign Rm]',
          `Fam #${r.family || '—'}\n(${r.paxCount || 1} Pax)`,
          `${r.applicantName || r.guestLeaderName || '—'}\nITS: ${r.itsId || '—'}`,
          `Time: ${timeStr}`,
          (r.departureDate || r.departureDateTime || '').replace('T', ' ').slice(0, 10) || '—',
          r.category || (r.shiftToCategoryA ? 'B ➔ A (NIZAAM)' : 'Standard'),
          r.moneyGiven === 'Yes' ? 'Paid ✓' : (r.shiftToCategoryA ? 'Pending' : '—'),
          '[ ] ID Verified\n[ ] Keys Handed\n[ ] Wajba Given',
        ]);
      });
    });

    autoTable(doc, {
      startY: startAtY + 30,
      head: [
        [
          '#',
          'Tour ID & Office',
          'Room & Building',
          'Family & Pax',
          'Applicant / Guest & ITS',
          'Arrival Time',
          'Departure Date',
          'Category',
          'Money (B➔A)',
          'Reception Check-in Checklist',
        ],
      ],
      body: rows.length > 0 ? rows : [[`No zaereen arrivals scheduled for this hotel on ${arrivalDate}`, '', '', '', '', '', '', '', '', '']],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4, textColor: [30, 30, 30], overflow: 'linebreak' },
      headStyles: { fillColor: badgeColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { halign: 'center', cellWidth: 25 },
        1: { fontStyle: 'bold' },
        2: { fontStyle: 'bold', halign: 'center' },
        4: { fontStyle: 'bold' },
        5: { fontStyle: 'bold', halign: 'center' },
        6: { halign: 'center' },
        7: { halign: 'center' },
        8: { halign: 'center' },
      },
      margin: { left: 30, right: 30 },
    });

    return (doc as any).lastAutoTable.finalY + 20;
  };

  // Main Top Banner on Page 1
  const renderTopBanner = (titleText: string, subText: string) => {
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 56, 'F');
    doc.setFillColor(217, 119, 6); // amber-600
    doc.rect(0, 56, pageWidth, 3, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(titleText, 40, 26);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(235, 213, 158); // Gold
    doc.text(subText, 40, 44);

    doc.setFontSize(8);
    doc.setTextColor(226, 232, 240);
    doc.text(`Arrival Date: ${arrivalDate}`, pageWidth - 180, 25);
    doc.text(`Printed: ${new Date().toLocaleDateString()}`, pageWidth - 180, 42);
  };

  let currentY = 75;

  if (buildingFilter === 'Saifee') {
    renderTopBanner(
      'FAIZ-E-HUSAINI — SAIFEE HOTEL (70 ROOMS) ARRIVALS MANIFEST',
      `OFFICIAL ARRIVAL DATE: ${arrivalDate} • SEPARATE BUILDING PRINT • ${saifeeArrivals.length} ZAEREEN`
    );
    renderHotelSection('SAIFEE HOTEL — SCHEDULED ARRIVALS & GUEST ALLOTMENT', saifeeArrivals, currentY, 70);
  } else if (buildingFilter === 'Burhani') {
    renderTopBanner(
      'FAIZ-E-HUSAINI — BURHANI HOTEL (44 ROOMS) ARRIVALS MANIFEST',
      `OFFICIAL ARRIVAL DATE: ${arrivalDate} • SEPARATE BUILDING PRINT • ${burhaniArrivals.length} ZAEREEN`
    );
    renderHotelSection('BURHANI HOTEL — SCHEDULED ARRIVALS & GUEST ALLOTMENT', burhaniArrivals, currentY, 44);
  } else {
    // JOINED & BIFURCATED WITH PAGE BREAKS (Prompt: "pdf should be bifurcated as per hotels. different buildings can be printed seperately and when joined it can be done too")
    renderTopBanner(
      'FAIZ-E-HUSAINI — SCHEDULED ARRIVALS MANIFEST (JOINED & BIFURCATED AS PER HOTELS)',
      `OFFICIAL ARRIVAL DATE: ${arrivalDate} • TOTAL ZAEREEN: ${arrivalsOnDate.length} (SAIFEE: ${saifeeArrivals.length} | BURHANI: ${burhaniArrivals.length})`
    );

    // Part 1: Saifee Hotel
    renderHotelSection('PART 1: SAIFEE HOTEL (70 ROOMS) — ARRIVALS MANIFEST & GUEST ALLOTMENT', saifeeArrivals, currentY, 70);

    // Page Break for Part 2: Burhani Hotel (So each hotel can be printed separately from this PDF or joined together)
    doc.addPage();
    renderTopBanner(
      'FAIZ-E-HUSAINI — SCHEDULED ARRIVALS MANIFEST (PART 2: BURHANI HOTEL)',
      `OFFICIAL ARRIVAL DATE: ${arrivalDate} • BURHANI HOTEL (44 ROOMS) • ${burhaniArrivals.length} ZAEREEN`
    );
    currentY = 75;
    renderHotelSection('PART 2: BURHANI HOTEL (44 ROOMS) — ARRIVALS MANIFEST & GUEST ALLOTMENT', burhaniArrivals, currentY, 44);

    // If unallotted zaereen exist, add Part 3 on clean page
    if (unallottedArrivals.length > 0) {
      doc.addPage();
      renderTopBanner(
        'FAIZ-E-HUSAINI — UNALLOTTED ZAEREEN ARRIVALS (ATTENTION REQUIRED)',
        `OFFICIAL ARRIVAL DATE: ${arrivalDate} • PENDING ROOM ALLOTMENT • ${unallottedArrivals.length} ZAEREEN`
      );
      currentY = 75;
      renderHotelSection(
        'PART 3: UNALLOTTED ZAEREEN (PENDING HOTEL & ROOM ALLOTMENT)',
        unallottedArrivals,
        currentY,
        0,
        [185, 28, 28] // red badge
      );
    }
  }

  // Footer / Signatures on final page
  const finalY = (doc as any).lastAutoTable.finalY + 20;
  if (finalY < pageHeight - 50) {
    const signY = Math.min(finalY, pageHeight - 45);
    doc.setDrawColor(203, 213, 225);
    doc.line(50, signY + 15, 220, signY + 15);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Reception In-Charge Sign-off (Date: ${arrivalDate})`, 50, signY + 25);

    doc.line(pageWidth - 250, signY + 15, pageWidth - 50, signY + 15);
    doc.text('Tour Coordinator Received & Confirmed', pageWidth - 250, signY + 25);
  }

  // Page numbering
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Faiz-e-Husaini Arrivals Manifest — Date: ${arrivalDate} — Page ${i} of ${totalPages}`,
      40,
      pageHeight - 12
    );
    doc.text(`BIFURCATED ADMINISTRATIVE RECORD`, pageWidth - 200, pageHeight - 12);
  }

  const hotelSuffix = buildingFilter !== 'ALL' ? `_${buildingFilter}_Hotel` : '_Joined_Bifurcated_Hotels';
  const fileName = `Faiz_Husaini_Arrivals_Manifest_${arrivalDate}${hotelSuffix}.pdf`;
  return saveOrDownloadPdf(doc, fileName);
}
