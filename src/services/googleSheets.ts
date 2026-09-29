import { Reservation, Room } from '../types';

export interface SyncResult {
  success: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  updatedRange?: string;
  error?: string;
}

/**
 * Creates a formatted Google Spreadsheet for Zaereen Accommodation
 */
export async function createAccommodationSpreadsheet(
  accessToken: string,
  title: string = 'Zaereen Accommodation & Reservation System'
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title,
      },
      sheets: [
        {
          properties: {
            title: 'Reservations',
            gridProperties: { rowCount: 100, columnCount: 18 },
          },
        },
        {
          properties: {
            title: 'Rooms_Inventory',
            gridProperties: { rowCount: 100, columnCount: 10 },
          },
        },
        {
          properties: {
            title: 'Category_B_to_A_Upgrades',
            gridProperties: { rowCount: 100, columnCount: 12 },
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData?.error?.message || 'Failed to create Google Spreadsheet');
  }

  const data = await response.json();
  const spreadsheetId = data.spreadsheetId;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  return { spreadsheetId, spreadsheetUrl };
}

/**
 * Syncs Reservations, Rooms, and Category B->A Upgrades to Google Sheets
 */
export async function syncAllToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  reservations: Reservation[],
  rooms: Room[]
): Promise<SyncResult> {
  try {
    // 1. Prepare Reservations Header and Rows
    const reservationHeaders = [
      'Tour Reference No.',
      'Family Number',
      'Office Name',
      'Pax Count',
      'Arrival Date & Time',
      'Entry Port',
      'Departure Date & Time',
      'Exit Port',
      'Building Assigned',
      'Room Number',
      'Shift B to A (Nizaam)',
      'Money Given to Accounts',
      'Request Slip No.',
      'Last Updated',
    ];

    const reservationRows = reservations.map((r) => [
      r.tourRefNo || r.tourId || '',
      r.family || r.familyNumber || r.familyNo || '',
      r.officeName || '',
      r.paxCount || r.pax || r.totalGuests || 1,
      (r.arrivalDate || r.arrivalDateTime || '').replace('T', ' '),
      r.entryPort || 'Najaf Airport (NJF)',
      (r.departureDate || r.departureDateTime || '').replace('T', ' '),
      r.exitPort || 'Najaf Airport (NJF)',
      r.building || '',
      r.roomNumber || '',
      r.category || (r.shiftToCategoryA ? 'B to A' : 'Category A'),
      r.moneyGiven || 'No',
      r.requestSlipNo || '',
      new Date(r.updatedAt || Date.now()).toLocaleString(),
    ]);

    // 2. Prepare Rooms Header and Rows
    const roomHeaders = [
      'Building',
      'Room Number',
      'Floor',
      'Capacity (Beds)',
      'Category',
      'Current Status',
      'Blocked Reason (if applicable)',
      'Expected Unblock Date',
      'Amenities',
      'Notes',
    ];

    const roomRows = rooms.map((rm) => [
      rm.building,
      rm.roomNumber,
      rm.floor,
      rm.capacity,
      rm.category,
      rm.status.toUpperCase(),
      rm.blockedReason || (rm.status === 'blocked' ? 'Blocked' : 'N/A'),
      rm.expectedUnblockDate || 'N/A',
      rm.amenities.join(', '),
      rm.notes || '',
    ]);

    // 3. Prepare Category B to A Upgrades & Balances Header and Rows
    const upgradeHeaders = [
      'Tour ID',
      'Zaereen Guest Leader',
      'Contact',
      'Assigned Room',
      'Building',
      'Upgrade Reason / Notes',
      'Upgrade Surcharge ($)',
      'Total Bill ($)',
      'Amount Paid ($)',
      'Remaining Balance ($)',
      'Payment Status',
      'Approved By',
    ];

    const upgradeRows = reservations
      .filter((r) => r.isUpgradedFromBToA)
      .map((r) => [
        r.tourId,
        r.guestLeaderName,
        r.guestContact,
        r.roomNumber,
        r.building,
        r.upgradeReason || 'Requested B to A Nizaam upgrade',
        r.upgradeFee,
        r.totalCost,
        r.amountPaid,
        r.balanceDue,
        r.paymentStatus,
        r.upgradeApprovalBy || 'Front Desk Admin',
      ]);

    // Update Reservations sheet
    await updateSheetRange(
      accessToken,
      spreadsheetId,
      'Reservations!A1:R' + (reservationRows.length + 10),
      [reservationHeaders, ...reservationRows]
    );

    // Update Rooms_Inventory sheet
    await updateSheetRange(
      accessToken,
      spreadsheetId,
      'Rooms_Inventory!A1:J' + (roomRows.length + 10),
      [roomHeaders, ...roomRows]
    );

    // Update Category_B_to_A_Upgrades sheet
    await updateSheetRange(
      accessToken,
      spreadsheetId,
      'Category_B_to_A_Upgrades!A1:L' + (upgradeRows.length + 10),
      [upgradeHeaders, ...upgradeRows]
    );

    return {
      success: true,
      spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    };
  } catch (err: any) {
    console.error('Google Sheets Sync Error:', err);
    return {
      success: false,
      error: err.message || 'Error communicating with Google Sheets API',
    };
  }
}

/**
 * Fetch and parse Room and Building details directly from Google Sheet
 */
export async function fetchRoomsFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  existingRooms: Room[] = []
): Promise<Room[]> {
  // 1. Get spreadsheet metadata to locate the rooms tab
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) {
    const error = await metaRes.json();
    throw new Error(error?.error?.message || 'Failed to inspect Google Sheet tabs.');
  }

  const metaData = await metaRes.json();
  const sheets: any[] = metaData.sheets || [];

  // Locate the tab for rooms (e.g. Rooms_Inventory, Rooms, Room Inventory, or first available)
  let targetTab = sheets.find((s) => {
    const title = (s.properties?.title || '').toLowerCase();
    return title.includes('room') || title.includes('inventory');
  })?.properties?.title;

  if (!targetTab && sheets.length > 1) {
    targetTab = sheets[1].properties?.title;
  } else if (!targetTab && sheets.length > 0) {
    targetTab = sheets[0].properties?.title;
  }

  if (!targetTab) {
    throw new Error('No tab found in Google Sheet for Rooms Inventory.');
  }

  // 2. Read values from target tab
  const valRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      targetTab + '!A1:Z500'
    )}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!valRes.ok) {
    const error = await valRes.json();
    throw new Error(error?.error?.message || `Failed to read tab: ${targetTab}`);
  }

  const valData = await valRes.json();
  const rawRows: any[][] = valData.values || [];

  if (rawRows.length <= 1) {
    // Empty or only header
    return existingRooms;
  }

  // Detect header indices
  const headerRow = rawRows[0].map((h: any) => String(h || '').trim().toLowerCase());
  let bIdx = headerRow.findIndex((h: string) => h.includes('building'));
  let rIdx = headerRow.findIndex((h: string) => h.includes('room'));
  let fIdx = headerRow.findIndex((h: string) => h.includes('floor'));
  let cIdx = headerRow.findIndex((h: string) => h.includes('capacity') || h.includes('bed'));
  let catIdx = headerRow.findIndex((h: string) => h.includes('category'));
  let sIdx = headerRow.findIndex((h: string) => h.includes('status'));
  let brIdx = headerRow.findIndex((h: string) => h.includes('blocked') || h.includes('reason'));
  let unbIdx = headerRow.findIndex((h: string) => h.includes('unblock') || h.includes('reopen') || h.includes('date'));
  let amIdx = headerRow.findIndex((h: string) => h.includes('amenit'));
  let nIdx = headerRow.findIndex((h: string) => h.includes('note'));

  // Fallback if headers were not explicitly matched
  if (bIdx === -1) bIdx = 0;
  if (rIdx === -1) rIdx = 1;
  if (fIdx === -1) fIdx = 2;
  if (cIdx === -1) cIdx = 3;
  if (catIdx === -1) catIdx = 4;
  if (sIdx === -1) sIdx = 5;
  if (brIdx === -1) brIdx = 6;
  if (unbIdx === -1) unbIdx = 7;
  if (amIdx === -1) amIdx = 8;
  if (nIdx === -1) nIdx = 9;

  const parsedRooms: Room[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const building = String(row[bIdx] || '').trim();
    let roomNumber = String(row[rIdx] || '').trim().replace(/^room\s+/i, '');

    // Skip empty lines or duplicated headers
    if (!building || !roomNumber) continue;
    if (building.toLowerCase() === 'building' && roomNumber.toLowerCase().includes('room')) continue;

    const floor = parseInt(String(row[fIdx] || '1'), 10) || 1;
    const capacity = parseInt(String(row[cIdx] || '3'), 10) || 3;

    // Category parsing
    const rawCategory = String(row[catIdx] || '').toLowerCase();
    let category: Room['category'] = 'Category B (Standard)';
    if (rawCategory.includes('a') || rawCategory.includes('nizaam')) {
      category = 'Category A (Nizaam)';
    } else if (rawCategory.includes('suite') || rawCategory.includes('exec')) {
      category = 'Executive Suite';
    }

    // Status parsing
    const rawStatus = String(row[sIdx] || '').toLowerCase();
    let status: Room['status'] = 'available';
    if (rawStatus.includes('block')) {
      status = 'blocked';
    } else if (rawStatus.includes('occup')) {
      status = 'occupied';
    } else if (rawStatus.includes('clean')) {
      status = 'cleaning';
    }

    // Blocked details
    const rawBlockedReason = String(row[brIdx] || '').trim();
    const blockedReason = rawBlockedReason && rawBlockedReason !== 'N/A' && rawBlockedReason !== '—'
      ? rawBlockedReason
      : (status === 'blocked' ? 'Maintenance in progress' : undefined);

    const rawUnblockDate = String(row[unbIdx] || '').trim();
    const expectedUnblockDate = rawUnblockDate && rawUnblockDate !== 'N/A' && rawUnblockDate !== '—'
      ? rawUnblockDate
      : undefined;

    // Amenities parsing
    const rawAmenities = String(row[amIdx] || '').trim();
    const amenities = rawAmenities
      ? rawAmenities.split(',').map((a) => a.trim()).filter(Boolean)
      : ['Standard Amenities'];

    const notes = String(row[nIdx] || '').trim();

    // Look for matching existing room ID to maintain consistency
    const existing = existingRooms.find(
      (er) => er.roomNumber === roomNumber && er.building.toLowerCase() === building.toLowerCase()
    );

    const id = existing
      ? existing.id
      : `rm-${building.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${roomNumber.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    parsedRooms.push({
      id,
      roomNumber,
      building,
      floor,
      capacity,
      category,
      status,
      blockedReason,
      expectedUnblockDate,
      amenities,
      notes: notes || undefined,
    });
  }

  return parsedRooms;
}

/**
 * Fetch and parse Reservations from Google Sheet
 */
export async function fetchReservationsFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  rooms: Room[],
  existingReservations: Reservation[] = []
): Promise<Reservation[]> {
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) return existingReservations;

  const metaData = await metaRes.json();
  const sheets: any[] = metaData.sheets || [];

  const targetTab = sheets.find((s) => {
    const title = (s.properties?.title || '').toLowerCase();
    return title.includes('reservation');
  })?.properties?.title;

  if (!targetTab) return existingReservations;

  const valRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      targetTab + '!A1:Z500'
    )}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!valRes.ok) return existingReservations;

  const valData = await valRes.json();
  const rawRows: any[][] = valData.values || [];
  if (rawRows.length <= 1) return existingReservations;

  const headerRow = rawRows[0].map((h: any) => String(h || '').trim().toLowerCase());
  let famIdx = headerRow.findIndex((h: string) => h.includes('fam'));
  let tourIdx = headerRow.findIndex((h: string) => h.includes('tour'));
  let leaderIdx = headerRow.findIndex((h: string) => h.includes('leader') || h.includes('name'));
  let phoneIdx = headerRow.findIndex((h: string) => h.includes('phone') || h.includes('contact'));
  let paxIdx = headerRow.findIndex((h: string) => h.includes('pax') || h.includes('guest'));
  let bIdx = headerRow.findIndex((h: string) => h.includes('building'));
  let rIdx = headerRow.findIndex((h: string) => h.includes('room'));
  let arrIdx = headerRow.findIndex((h: string) => h.includes('arrival'));
  let depIdx = headerRow.findIndex((h: string) => h.includes('departure'));
  let catIdx = headerRow.findIndex((h: string) => h.includes('category'));
  let upgIdx = headerRow.findIndex((h: string) => h.includes('upgraded') || h.includes('nizaam'));
  let baseIdx = headerRow.findIndex((h: string) => h.includes('base'));
  let feeIdx = headerRow.findIndex((h: string) => h.includes('upgrade fee'));
  let totalIdx = headerRow.findIndex((h: string) => h.includes('total cost'));
  let paidIdx = headerRow.findIndex((h: string) => h.includes('paid'));
  let balIdx = headerRow.findIndex((h: string) => h.includes('balance'));
  let statIdx = headerRow.findIndex((h: string) => h.includes('status'));
  let noteIdx = headerRow.findIndex((h: string) => h.includes('note') || h.includes('request'));

  if (tourIdx === -1) tourIdx = famIdx !== -1 ? 1 : 0;
  if (leaderIdx === -1) leaderIdx = 15;
  if (phoneIdx === -1) phoneIdx = 16;
  if (paxIdx === -1) paxIdx = 2;
  if (bIdx === -1) bIdx = 5;
  if (rIdx === -1) rIdx = 6;
  if (arrIdx === -1) arrIdx = 3;
  if (depIdx === -1) depIdx = 4;
  if (catIdx === -1) catIdx = 7;
  if (upgIdx === -1) upgIdx = 8;
  if (baseIdx === -1) baseIdx = 9;
  if (feeIdx === -1) feeIdx = 10;
  if (totalIdx === -1) totalIdx = 11;
  if (paidIdx === -1) paidIdx = 12;
  if (balIdx === -1) balIdx = 13;
  if (statIdx === -1) statIdx = 14;
  if (noteIdx === -1) noteIdx = 17;

  const parsedReservations: Reservation[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const tourId = String(row[tourIdx] || '').trim();
    if (!tourId || tourId.toLowerCase() === 'tour id') continue;

    const familyNo = famIdx !== -1 ? String(row[famIdx] || '').trim() : `FAM-${i.toString().padStart(2, '0')}`;
    const guestLeaderName = leaderIdx !== -1 && row[leaderIdx] ? String(row[leaderIdx]).trim() : `Zaereen Family ${familyNo}`;
    const guestContact = phoneIdx !== -1 && row[phoneIdx] ? String(row[phoneIdx]).trim() : '';
    const pax = paxIdx !== -1 && !isNaN(parseInt(String(row[paxIdx]))) ? parseInt(String(row[paxIdx])) : 2;
    const totalGuests = pax;
    const building = String(row[bIdx] || '').trim();
    const roomNumber = String(row[rIdx] || '').trim().replace(/^room\s+/i, '');

    const matchingRoom = rooms.find(
      (rm) => rm.roomNumber === roomNumber && rm.building.toLowerCase() === building.toLowerCase()
    );
    const roomId = matchingRoom ? matchingRoom.id : `rm-${building}-${roomNumber}`;

    const rawArr = String(row[arrIdx] || '').trim();
    const rawDep = String(row[depIdx] || '').trim();
    const arrivalDateTime = rawArr ? rawArr.replace(' ', 'T') : new Date().toISOString();
    const departureDateTime = rawDep ? rawDep.replace(' ', 'T') : new Date(Date.now() + 7 * 86400000).toISOString();

    const rawUpg = String(row[upgIdx] || '').toLowerCase();
    const isUpgradedFromBToA = rawUpg.includes('yes') || rawUpg.includes('upgrade') || rawUpg.includes('nizaam');

    const rawCategory = String(row[catIdx] || '').toLowerCase();
    let assignedCategory: Reservation['assignedCategory'] = 'Category B (Standard)';
    if (isUpgradedFromBToA || rawCategory.includes('a') || rawCategory.includes('nizaam')) {
      assignedCategory = 'Category A (Nizaam)';
    }

    const baseCost = parseFloat(String(row[baseIdx] || '0').replace(/[^0-9.]/g, '')) || 1000;
    const upgradeFee = isUpgradedFromBToA
      ? parseFloat(String(row[feeIdx] || '0').replace(/[^0-9.]/g, '')) || 350
      : 0;
    const totalCost = parseFloat(String(row[totalIdx] || '0').replace(/[^0-9.]/g, '')) || (baseCost + upgradeFee);
    const amountPaid = parseFloat(String(row[paidIdx] || '0').replace(/[^0-9.]/g, '')) || 0;
    const balanceDue = Math.max(0, totalCost - amountPaid);

    const rawStat = String(row[statIdx] || '').trim();
    const moneyGiven = /yes|paid/i.test(rawStat) ? 'Yes' : 'No';
    const paymentStatus: Reservation['paymentStatus'] = moneyGiven === 'Yes' ? 'Paid' : 'Pending';

    const specialRequests = String(row[noteIdx] || '').trim();

    const existing = existingReservations.find(
      (r) => r.tourId === tourId && r.guestLeaderName === guestLeaderName
    );

    parsedReservations.push({
      id: existing ? existing.id : `res-${Date.now()}-${i}`,
      itsId: existing?.itsId || `30${Math.floor(100000 + Math.random() * 900000)}`,
      applicantName: guestLeaderName || existing?.applicantName || 'Zaer Guest',
      age: existing?.age || 38,
      category: isUpgradedFromBToA ? 'B to A' : 'Category A',
      idara: existing?.idara || 'Faiz-e-Husaini',
      gender: existing?.gender || 'Male',
      family: familyNo || existing?.family || 'FAM-01',
      tourRefNo: tourId,
      officeName: existing ? existing.officeName : 'Karachi Central Office',
      groupLeadName: guestLeaderName,
      arrivalDate: arrivalDateTime.slice(0, 10),
      departureDate: departureDateTime.slice(0, 10),
      shiftToCategoryA: isUpgradedFromBToA,
      requestSlipNo: existing ? existing.requestSlipNo : `SLIP-2026-${i.toString().padStart(3, '0')}`,
      moneyGiven,
      building: (building === 'Burhani' ? 'Burhani' : 'Saifee'),
      roomNumber,
      roomId,
      isUploadedToPortal: existing?.isUploadedToPortal || false,
      paxCount: pax,
      arrivalDateTime,
      entryPort: existing ? existing.entryPort : 'Najaf Airport (NJF)',
      departureDateTime,
      exitPort: existing ? existing.exitPort : 'Najaf Airport (NJF)',
      guestLeaderName,
      guestContact,
      zaereenGuests: existing?.zaereenGuests || [],
      specialRequests: specialRequests || undefined,
      // Compatibility fields
      tourId,
      familyNo,
      pax,
      totalGuests: pax,
      tourName: 'Zaereen Group',
      assignedCategory: 'Category A (Nizaam)',
      isUpgradedFromBToA,
      baseCost,
      upgradeFee,
      totalCost,
      amountPaid,
      balanceDue,
      paymentStatus,
      paymentHistory: existing ? existing.paymentHistory : [],
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return parsedReservations;
}

/**
 * Low-level write to Google Sheets range
 */
async function updateSheetRange(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: any[][]
) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}?valueInputOption=USER_ENTERED`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.error?.message || `Failed to update sheet range: ${range}`);
  }

  return response.json();
}

/**
 * Check if a spreadsheet is accessible
 */
export async function testSpreadsheetAccess(
  accessToken: string,
  spreadsheetId: string
): Promise<{ title: string; sheets: string[] }> {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.error?.message || 'Cannot access spreadsheet. Please verify ID & permissions.');
  }

  const data = await response.json();
  const sheets = data.sheets ? data.sheets.map((s: any) => s.properties?.title || 'Untitled') : [];
  return {
    title: data.properties?.title || 'Google Sheet',
    sheets,
  };
}

/**
 * Fetch Pilgrim Categories (Mumineen, Muntasbeen, Qasreali, Baitezainy, etc.) from Google Sheet
 */
export async function fetchCategoriesFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<string[]> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metaRes.ok) {
    const error = await metaRes.json();
    throw new Error(error?.error?.message || 'Failed to read Google Sheet tabs.');
  }

  const metaData = await metaRes.json();
  const sheetTitles: string[] = (metaData.sheets || []).map((s: any) => s.properties?.title || '');

  const categoryTab = sheetTitles.find((t) =>
    /categor/i.test(t) || /mumineen/i.test(t)
  );

  const categoryValues: string[] = [];

  if (categoryTab) {
    const valRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        categoryTab + '!A1:C100'
      )}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (valRes.ok) {
      const data = await valRes.json();
      const rows: any[][] = data.values || [];
      rows.forEach((r) => {
        const val = String(r[0] || '').trim();
        if (val && !/^(category|categories|name|title)$/i.test(val)) {
          categoryValues.push(val);
        }
      });
    }
  } else {
    // Scan zaereen sheet for Category column
    const zaereenTab = sheetTitles.find((t) =>
      /zaereen|reservation|pilgrim|sheet1/i.test(t)
    ) || sheetTitles[0];

    if (zaereenTab) {
      const valRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          zaereenTab + '!A1:Z200'
        )}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (valRes.ok) {
        const data = await valRes.json();
        const rows: any[][] = data.values || [];
        if (rows.length > 1) {
          const header = rows[0].map((h: any) => String(h || '').toLowerCase().trim());
          const catIdx = header.findIndex((h: string) => h === 'category' || h.includes('cat'));
          if (catIdx >= 0) {
            for (let i = 1; i < rows.length; i++) {
              const val = String(rows[i][catIdx] || '').trim();
              if (val && !categoryValues.includes(val) && !/^(category|cat)$/i.test(val)) {
                categoryValues.push(val);
              }
            }
          }
        }
      }
    }
  }

  const distinct = Array.from(new Set(categoryValues.filter((c) => c.length > 0)));
  return distinct.length > 0 ? distinct : ['Mumineen', 'Muntasbeen', 'Qasreali', 'Baitezainy'];
}

/**
 * Extract Spreadsheet ID from standard Google Sheets URLs or raw ID:
 * e.g., https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0
 */
export function extractSpreadsheetId(input: string): string {
  if (!input) return '';
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : input.trim();
}

/**
 * Parses distinct category names from CSV text (e.g. from Google Sheets export)
 */
export function parseCategoriesFromCsvText(csvText: string): string[] {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows: string[][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        cells.push(cur.trim().replace(/^["']|["']$/g, ''));
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim().replace(/^["']|["']$/g, ''));
    if (cells.some((cell) => cell.length > 0)) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return [];

  const foundCategories: string[] = [];
  const header = rows[0].map((h) => h.toLowerCase().trim());

  // Check if there is an explicit Category column
  const catColIdx = header.findIndex(
    (h) => h === 'category' || h === 'categories' || h.includes('categor') || h === 'class'
  );

  if (catColIdx >= 0 && rows.length > 1) {
    for (let r = 1; r < rows.length; r++) {
      const val = rows[r][catColIdx]?.trim();
      if (val && !/^(category|categories|name|title)$/i.test(val)) {
        foundCategories.push(val);
      }
    }
  } else {
    // If it's a simple 1-column list of categories
    for (let r = 0; r < rows.length; r++) {
      const val = rows[r][0]?.trim();
      if (val && !/^(category|categories|name|title|header)$/i.test(val)) {
        foundCategories.push(val);
      }
    }
  }

  const distinct = Array.from(new Set(foundCategories));
  return distinct;
}

/**
 * Versatile fetch that works with public Google Sheets (without login) OR with OAuth
 */
export async function fetchCategoriesFromGoogleSheetUrl(
  sheetUrlOrId: string,
  accessToken?: string | null
): Promise<string[]> {
  const sheetId = extractSpreadsheetId(sheetUrlOrId);
  if (!sheetId) {
    throw new Error('Please enter a valid Google Sheet URL or ID.');
  }

  // 1. Try public Google visualization CSV export (works if shared with link)
  try {
    const gvizRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`,
      { cache: 'no-store' }
    );
    if (gvizRes.ok) {
      const text = await gvizRes.text();
      if (!text.includes('<!DOCTYPE html>') && !text.includes('<html')) {
        const cats = parseCategoriesFromCsvText(text);
        if (cats.length > 0) {
          return cats;
        }
      }
    }
  } catch (err) {
    console.warn('gviz CSV export failed:', err);
  }

  // 2. Try export?format=csv
  try {
    const exportRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`,
      { cache: 'no-store' }
    );
    if (exportRes.ok) {
      const text = await exportRes.text();
      if (!text.includes('<!DOCTYPE html>') && !text.includes('<html')) {
        const cats = parseCategoriesFromCsvText(text);
        if (cats.length > 0) {
          return cats;
        }
      }
    }
  } catch (err) {
    console.warn('export?format=csv failed:', err);
  }

  // 3. If access token available, use official Google Sheets v4 API
  if (accessToken) {
    return await fetchCategoriesFromGoogleSheet(accessToken, sheetId);
  }

  throw new Error(
    'Unable to fetch categories. Please ensure your Google Sheet is shared with "Anyone with the link can view", or sign in with your Google account.'
  );
}

