import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Reservation, Room } from '../types';

export interface PdfExportOptions {
  reportType: 'all_reservations' | 'category_upgrades' | 'rooms_inventory' | 'tour_manifest';
  tourIdFilter?: string;
  buildingFilter?: string;
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
    filteredReservations = filteredReservations.filter((r) => r.tourId === options.tourIdFilter);
  }
  if (options.buildingFilter && options.buildingFilter !== 'ALL') {
    filteredReservations = filteredReservations.filter((r) => r.building === options.buildingFilter);
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
    const tableBody = rooms.map((rm) => [
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
      startY: currentY,
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
      body: tableBody,
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
      margin: { left: 40, right: 40 },
    });
  } else if (options.reportType === 'category_upgrades') {
    const tableBody = filteredReservations.map((res) => [
      res.tourRefNo || res.tourId || '',
      res.applicantName || res.guestLeaderName || '',
      res.family || res.familyNumber || '',
      `${res.building} - Rm ${res.roomNumber}`,
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
      startY: currentY,
      head: [
        [
          'Tour ID',
          'Zaereen Guest Leader',
          'Contact',
          'Assigned Room & Building',
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
      body: tableBody,
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
            // Balance due column
            const text = data.cell.raw as string;
            if (text !== '$0') {
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = 'bold';
            }
          }
          if (data.column.index === 11) {
            // Payment status column
            const status = data.cell.raw as string;
            if (status === 'Paid') {
              data.cell.styles.textColor = [22, 101, 52];
              data.cell.styles.fontStyle = 'bold';
            } else if (status === 'Pending') {
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = 'bold';
            } else if (status === 'Partial') {
              data.cell.styles.textColor = [194, 65, 12];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
      margin: { left: 40, right: 40 },
    });
  } else {
    // All reservations / Tour manifest
    const tableBody = filteredReservations.map((res) => [
      res.tourRefNo || res.tourId || '',
      res.family || res.familyNumber || res.familyNo || '',
      res.officeName || '—',
      `${res.paxCount || res.pax || res.totalGuests || 1} Pax`,
      (res.arrivalDate || res.arrivalDateTime || '').replace('T', ' '),
      res.entryPort || 'Najaf (NJF)',
      (res.departureDate || res.departureDateTime || '').replace('T', ' '),
      res.exitPort || 'Najaf (NJF)',
      `${res.building}\nRm ${res.roomNumber}`,
      res.category || (res.shiftToCategoryA ? 'B ➔ A (NIZAAM)' : 'Category A'),
      res.moneyGiven === 'Yes' ? 'YES (Given)' : 'NO (Pending)',
    ]);

    autoTable(doc, {
      startY: currentY,
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
      body: tableBody,
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

  const fileName = `Zaereen_${options.reportType}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}
