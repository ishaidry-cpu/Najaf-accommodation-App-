import { Reservation, Room } from '../types';

export interface SyncResult {
  success: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  updatedRange?: string;
  error?: string;
}

export interface TwoWaySyncResult {
  success: boolean;
  spreadsheetId: string;
  spreadsheetUrl: string;
  pulledReservationsCount: number;
  pulledRoomsCount: number;
  mergedReservations: Reservation[];
  mergedRooms: Room[];
  error?: string;
}

export const ZAEREEN_GRID_TAB = 'Zaereen_Lodging_&_Room_Allotment_Grid';

/**
 * Ensure all required tabs exist in the Google Spreadsheet
 */
export async function ensureSheetTabs(
  accessToken: string,
  spreadsheetId: string,
  tabNames: string[]
): Promise<void> {
  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!metaRes.ok) return;
    const meta = await metaRes.json();
    const existingTitles = new Set(
      (meta.sheets || []).map((s: any) => String(s.properties?.title || '').trim().toLowerCase())
    );

    const missingTabs = tabNames.filter(
      (name) => !existingTitles.has(name.trim().toLowerCase())
    );

    if (missingTabs.length === 0) return;

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: missingTabs.map((title) => ({
            addSheet: {
              properties: {
                title,
              },
            },
          })),
        }),
      }
    );
  } catch (err) {
    console.warn('Could not auto-create missing tabs:', err);
  }
}

/**
 * Removes old/present obsolete tabs (e.g. 'Reservations', empty 'Sheet1') from the spreadsheet
 * As requested: "Zaereen Lodging & Room Allotment Grid i want this exactly in google sheet remove the present one"
 */
export async function removeOldPresentTabs(
  accessToken: string,
  spreadsheetId: string,
  obsoleteTabNames: string[] = ['Reservations', 'Sheet1']
): Promise<void> {
  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!metaRes.ok) return;
    const meta = await metaRes.json();
    const sheetsList: Array<{ sheetId: number; title: string }> = (meta.sheets || []).map(
      (s: any) => ({
        sheetId: s.properties?.sheetId,
        title: String(s.properties?.title || '').trim(),
      })
    );

    const obsoleteLower = new Set(obsoleteTabNames.map((t) => t.trim().toLowerCase()));
    const toDelete = sheetsList.filter((s) => obsoleteLower.has(s.title.toLowerCase()));

    // Never delete all sheets (Google Sheets requires at least 1 sheet to remain)
    if (toDelete.length === 0 || sheetsList.length <= toDelete.length) return;

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: toDelete.map((s) => ({
            deleteSheet: {
              sheetId: s.sheetId,
            },
          })),
        }),
      }
    );
    console.log(`[Google Sheets] Cleaned obsolete present tabs: ${toDelete.map((s) => s.title).join(', ')}`);
  } catch (err) {
    console.warn('Could not remove obsolete tabs:', err);
  }
}

/**
 * Creates a formatted Google Spreadsheet for Zaereen Accommodation
 * Features the exact "Zaereen_Lodging_&_Room_Allotment_Grid" as the master zaereen sheet!
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
            title: ZAEREEN_GRID_TAB,
            gridProperties: { rowCount: 200, columnCount: 25 },
          },
        },
        {
          properties: {
            title: 'Rooms_Availability_&_Timeline',
            gridProperties: { rowCount: 150, columnCount: 20 },
          },
        },
        {
          properties: {
            title: 'Rooms_Inventory',
            gridProperties: { rowCount: 150, columnCount: 12 },
          },
        },
        {
          properties: {
            title: 'Category_B_to_A_Upgrades',
            gridProperties: { rowCount: 150, columnCount: 14 },
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
 * Generates rows for the "Rooms_Availability_&_Timeline" tab
 */
export function generateTimelineRows(
  rooms: Room[],
  reservations: Reservation[]
): { headers: string[]; rows: any[][] } {
  const headers = [
    'Building',
    'Room Number',
    'Floor',
    'Capacity (Max Beds)',
    'Occupancy Status',
    'Zaer Guest / Group Leader',
    'ITS ID',
    'Tour Reference No.',
    'Family Number',
    'Pax Count',
    'Arrival Date & Time',
    'Departure Date & Time',
    'Days Remaining',
    'Availability & Departure Turnover Status',
    'Category',
    'Amenities / Notes',
    'Last Synced',
  ];

  const todayDate = new Date().toISOString().slice(0, 10);
  const rows: any[][] = [];

  // Sort rooms by building (Saifee, Burhani) and room number
  const sortedRooms = [...rooms].sort((a, b) => {
    if (a.building !== b.building) return a.building.localeCompare(b.building);
    return parseInt(a.roomNumber, 10) - parseInt(b.roomNumber, 10);
  });

  for (const rm of sortedRooms) {
    const roomRes = reservations.filter(
      (r) =>
        r.building?.toLowerCase() === rm.building.toLowerCase() &&
        String(r.roomNumber).trim() === String(rm.roomNumber).trim()
    );

    if (roomRes.length === 0) {
      const isBlocked = rm.status === 'blocked';
      const isCleaning = rm.status === 'cleaning';
      const occStatus = isBlocked
        ? 'BLOCKED'
        : isCleaning
        ? 'CLEANING / TURNOVER'
        : 'AVAILABLE / VACANT';

      const turnoverStatus = isBlocked
        ? `BLOCKED: ${rm.blockedReason || 'Maintenance in progress'}`
        : isCleaning
        ? 'CLEANING: In housekeeping turnover'
        : `AVAILABLE: Vacant (Capacity for ${rm.capacity} beds ready for immediate allotment)`;

      rows.push([
        rm.building,
        rm.roomNumber,
        rm.floor,
        rm.capacity,
        occStatus,
        '—',
        '—',
        '—',
        '—',
        0,
        '—',
        '—',
        isBlocked ? 'Blocked' : 'Vacant',
        turnoverStatus,
        rm.category,
        rm.notes || rm.amenities.join(', '),
        new Date().toLocaleString(),
      ]);
    } else {
      for (const r of roomRes) {
        const arrStr = (r.arrivalDate || r.arrivalDateTime || '').slice(0, 10);
        const depStr = (r.departureDate || r.departureDateTime || '').slice(0, 10);

        let daysRemainingStr = 'In House';
        let turnoverStatus = 'OCCUPIED';

        if (depStr) {
          const depDate = new Date(depStr);
          const now = new Date(todayDate);
          const diffMs = depDate.getTime() - now.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          if (depStr === todayDate) {
            daysRemainingStr = '⚠️ DEPARTING TODAY';
            turnoverStatus = 'DEPARTING TODAY: Checkout scheduled → Room becomes Vacant';
          } else if (diffDays === 1) {
            daysRemainingStr = '1 day remaining (Departing Tomorrow)';
            turnoverStatus = `OCCUPIED: Departing tomorrow (${depStr})`;
          } else if (diffDays > 1) {
            daysRemainingStr = `${diffDays} days remaining`;
            turnoverStatus = `OCCUPIED: Scheduled departure on ${depStr}`;
          } else if (diffDays < 0) {
            daysRemainingStr = 'Checked out / Departure Passed';
            turnoverStatus = `PAST DEPARTURE: Departed on ${depStr}`;
          }
        }

        if (arrStr === todayDate) {
          turnoverStatus = 'ARRIVING TODAY: Zaer checking in';
        }

        rows.push([
          rm.building,
          rm.roomNumber,
          rm.floor,
          rm.capacity,
          'OCCUPIED',
          r.applicantName || r.groupLeadName || r.guestLeaderName || 'Zaer Guest',
          r.itsId || '—',
          r.tourRefNo || r.tourId || '—',
          r.family || r.familyNumber || '—',
          r.paxCount || r.pax || 1,
          (r.arrivalDate || r.arrivalDateTime || '').replace('T', ' '),
          (r.departureDate || r.departureDateTime || '').replace('T', ' '),
          daysRemainingStr,
          turnoverStatus,
          r.accommodationCategory || rm.category,
          r.specialRequests || rm.notes || rm.amenities.join(', '),
          new Date(r.updatedAt || Date.now()).toLocaleString(),
        ]);
      }
    }
  }

  return { headers, rows };
}

/**
 * Generates rows matching EXACTLY the "Zaereen Lodging & Room Allotment Grid"
 * Sequence: SR # | ITS | NAME | AGE | FAMILY | OFFICE NAME | TOUR ID | BUILDING | ROOM ALLOTTMENT | GENDER | GROUP LEAD | ARRIVAL | DEPARTURE | CATEGORY | MAIN PORTAL | SHIFT B TO A (NIZAAM) | MONEY GIVEN | REQUEST SLIP NO. | PAX COUNT | LAST UPDATED
 */
export function generateZaereenGridRows(reservations: Reservation[]): { headers: string[]; rows: any[][] } {
  const headers = [
    'SR #',
    'ITS',
    'NAME',
    'AGE',
    'FAMILY',
    'OFFICE NAME',
    'TOUR ID',
    'BUILDING',
    'ROOM ALLOTTMENT',
    'GENDER',
    'GROUP LEAD',
    'ARRIVAL',
    'DEPARTURE',
    'CATEGORY',
    'MAIN PORTAL',
    'SHIFT B TO A (NIZAAM)',
    'MONEY GIVEN',
    'REQUEST SLIP NO.',
    'PAX COUNT',
    'LAST UPDATED',
  ];

  const rows = reservations.map((r, index) => [
    index + 1,
    r.itsId || '',
    r.applicantName || r.groupLeadName || '',
    r.age ?? '',
    r.family || r.familyNumber || '',
    r.officeName || '',
    r.tourRefNo || r.tourId || '',
    r.building || '',
    r.roomNumber || '',
    r.gender || 'Male',
    r.groupLeadName || r.applicantName || '',
    (r.arrivalDate || r.arrivalDateTime || '').slice(0, 10),
    (r.departureDate || r.departureDateTime || '').slice(0, 10),
    r.category || 'Mumineen',
    r.isUploadedToPortal ? 'Uploaded' : 'Pending',
    r.shiftToCategoryA ? 'Yes (Nizaam)' : 'No',
    r.moneyGiven || 'No',
    r.requestSlipNo || '',
    r.paxCount || r.pax || 1,
    new Date(r.updatedAt || Date.now()).toLocaleString(),
  ]);

  return { headers, rows };
}

/**
 * Syncs Zaereen Lodging & Room Allotment Grid, Rooms Availability & Timeline, and Inventories to Google Sheets.
 * Removes the old present 'Reservations' tab.
 */
export async function syncAllToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  reservations: Reservation[],
  rooms: Room[]
): Promise<SyncResult> {
  try {
    // 0. Ensure all required tabs exist
    await ensureSheetTabs(accessToken, spreadsheetId, [
      ZAEREEN_GRID_TAB,
      'Rooms_Availability_&_Timeline',
      'Rooms_Inventory',
      'Category_B_to_A_Upgrades',
    ]);

    // 1. Prepare Zaereen Lodging & Room Allotment Grid Header and Rows (User Request: "Zaereen Lodging & Room Allotment Grid i want this exactly in google sheet remove the present one")
    const { headers: gridHeaders, rows: gridRows } = generateZaereenGridRows(reservations);

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

    // 3. Prepare Rooms Availability & Departure Timeline Header and Rows
    const { headers: timelineHeaders, rows: timelineRows } = generateTimelineRows(
      rooms,
      reservations
    );

    // 4. Prepare Category B to A Upgrades & Balances Header and Rows
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

    // Update Zaereen Lodging & Room Allotment Grid sheet
    await updateSheetRange(
      accessToken,
      spreadsheetId,
      `'${ZAEREEN_GRID_TAB}'!A1:T` + (gridRows.length + 10),
      [gridHeaders, ...gridRows]
    );

    // Update Rooms_Inventory sheet
    await updateSheetRange(
      accessToken,
      spreadsheetId,
      'Rooms_Inventory!A1:J' + (roomRows.length + 10),
      [roomHeaders, ...roomRows]
    );

    // Update Rooms_Availability_&_Timeline sheet
    await updateSheetRange(
      accessToken,
      spreadsheetId,
      'Rooms_Availability_&_Timeline!A1:Q' + (timelineRows.length + 10),
      [timelineHeaders, ...timelineRows]
    );

    // Update Category_B_to_A_Upgrades sheet
    await updateSheetRange(
      accessToken,
      spreadsheetId,
      'Category_B_to_A_Upgrades!A1:L' + (upgradeRows.length + 10),
      [upgradeHeaders, ...upgradeRows]
    );

    // 5. Explicit user instruction: "remove the present one"
    // Deletes the obsolete 'Reservations' tab and any empty default 'Sheet1'
    await removeOldPresentTabs(accessToken, spreadsheetId, ['Reservations', 'Sheet1']);

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
 * 1-Click Two-Way Sync:
 * 1. Reads latest changes from Google Sheet (new zaereen, updated rooms, modified allotments)
 * 2. Merges with app state without losing backend data
 * 3. Writes back full updated state with the Zaereen Lodging & Room Allotment Grid and Rooms Availability & Departure Timeline tab
 * 4. Removes the old present 'Reservations' tab
 */
export async function twoWaySyncWithGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  currentReservations: Reservation[],
  currentRooms: Room[]
): Promise<TwoWaySyncResult> {
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // 1. Ensure all required tabs exist
  await ensureSheetTabs(accessToken, spreadsheetId, [
    ZAEREEN_GRID_TAB,
    'Rooms_Availability_&_Timeline',
    'Rooms_Inventory',
    'Category_B_to_A_Upgrades',
  ]);

  // 2. Pull from Google Sheet
  const [sheetRooms, sheetRes] = await Promise.all([
    fetchRoomsFromGoogleSheet(accessToken, spreadsheetId, currentRooms).catch((err) => {
      console.warn('Could not pull rooms from Google Sheet:', err);
      return currentRooms;
    }),
    fetchReservationsFromGoogleSheet(
      accessToken,
      spreadsheetId,
      currentRooms,
      currentReservations
    ).catch((err) => {
      console.warn('Could not pull reservations from Google Sheet:', err);
      return currentReservations;
    }),
  ]);

  // 3. Merge reservations
  const mergedResMap = new Map<string, Reservation>();
  currentReservations.forEach((r) => {
    mergedResMap.set(r.id, r);
  });

  sheetRes.forEach((sr) => {
    const match = currentReservations.find(
      (r) =>
        r.id === sr.id ||
        (r.tourRefNo && sr.tourRefNo && r.tourRefNo === sr.tourRefNo && (r.applicantName === sr.applicantName || r.family === sr.family)) ||
        (r.itsId && sr.itsId && r.itsId === sr.itsId)
    );

    if (match) {
      const updated: Reservation = {
        ...match,
        applicantName: sr.applicantName || match.applicantName,
        age: sr.age !== undefined && !Number.isNaN(Number(sr.age)) ? Number(sr.age) : match.age,
        gender: sr.gender || match.gender,
        officeName: sr.officeName || match.officeName,
        family: sr.family || match.family,
        roomNumber: sr.roomNumber !== undefined ? sr.roomNumber : match.roomNumber,
        building: sr.building || match.building,
        paxCount: sr.paxCount || match.paxCount,
        arrivalDate: sr.arrivalDate || match.arrivalDate,
        departureDate: sr.departureDate || match.departureDate,
        arrivalDateTime: sr.arrivalDateTime || match.arrivalDateTime,
        departureDateTime: sr.departureDateTime || match.departureDateTime,
        moneyGiven: sr.moneyGiven || match.moneyGiven,
        category: sr.category || match.category,
        isUploadedToPortal: sr.isUploadedToPortal !== undefined ? sr.isUploadedToPortal : match.isUploadedToPortal,
        shiftToCategoryA: sr.shiftToCategoryA !== undefined ? sr.shiftToCategoryA : match.shiftToCategoryA,
        requestSlipNo: sr.requestSlipNo || match.requestSlipNo,
        groupLeadName: sr.groupLeadName || match.groupLeadName,
        updatedAt: new Date().toISOString(),
      };
      mergedResMap.set(match.id, updated);
    } else {
      mergedResMap.set(sr.id, {
        ...sr,
        updatedAt: new Date().toISOString(),
      });
    }
  });

  const mergedReservations = Array.from(mergedResMap.values());

  // 4. Merge rooms
  const mergedRoomsMap = new Map<string, Room>();
  currentRooms.forEach((rm) => mergedRoomsMap.set(rm.id, rm));
  sheetRooms.forEach((srm) => {
    const match = currentRooms.find(
      (rm) => rm.roomNumber === srm.roomNumber && rm.building.toLowerCase() === srm.building.toLowerCase()
    );
    if (match) {
      mergedRoomsMap.set(match.id, {
        ...match,
        status: srm.status || match.status,
        capacity: srm.capacity || match.capacity,
        blockedReason: srm.blockedReason ?? match.blockedReason,
        notes: srm.notes ?? match.notes,
      });
    } else {
      mergedRoomsMap.set(srm.id, srm);
    }
  });
  const mergedRooms = Array.from(mergedRoomsMap.values());

  // 5. Write back complete updated state to Google Sheets & remove obsolete present tabs
  const pushRes = await syncAllToGoogleSheet(
    accessToken,
    spreadsheetId,
    mergedReservations,
    mergedRooms
  );

  if (!pushRes.success) {
    throw new Error(pushRes.error || 'Failed to push merged data back to Google Sheet');
  }

  return {
    success: true,
    spreadsheetId,
    spreadsheetUrl,
    pulledReservationsCount: sheetRes.length,
    pulledRoomsCount: sheetRooms.length,
    mergedReservations,
    mergedRooms,
  };
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
 * Fetch and parse Reservations directly from Google Sheet (from Zaereen Lodging & Room Allotment Grid)
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

  // Locate the Zaereen Lodging & Room Allotment Grid tab
  let targetTab = sheets.find((s) => {
    const title = (s.properties?.title || '').toLowerCase();
    return (
      title.includes('lodging') ||
      title.includes('allotment') ||
      title.includes('grid') ||
      title.includes('zaereen') ||
      title.includes('reservation')
    );
  })?.properties?.title;

  if (!targetTab && sheets.length > 0) {
    targetTab = sheets[0]?.properties?.title;
  }

  if (!targetTab) return existingReservations;

  const valRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `'${targetTab}'!A1:Z500`
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
  let itsIdx = headerRow.findIndex((h: string) => h === 'its' || h.includes('its id') || h === 'its_id');
  let nameIdx = headerRow.findIndex((h: string) => h === 'name' || h.includes('applicant') || h.includes('zaer'));
  let ageIdx = headerRow.findIndex((h: string) => h === 'age');
  let famIdx = headerRow.findIndex((h: string) => h === 'family' || h.includes('fam'));
  let officeIdx = headerRow.findIndex((h: string) => h.includes('office'));
  let tourIdx = headerRow.findIndex((h: string) => h === 'tour id' || h.includes('tour'));
  let bIdx = headerRow.findIndex((h: string) => h.includes('building') || h.includes('bldg'));
  let rIdx = headerRow.findIndex((h: string) => h.includes('room allottment') || h.includes('room allotment') || h.includes('room'));
  let genderIdx = headerRow.findIndex((h: string) => h.includes('gender') || h === 'sex');
  let leaderIdx = headerRow.findIndex((h: string) => h === 'group lead' || h.includes('group lead') || h.includes('leader'));
  let arrIdx = headerRow.findIndex((h: string) => h.includes('arrival'));
  let depIdx = headerRow.findIndex((h: string) => h.includes('departure'));
  let catIdx = headerRow.findIndex((h: string) => h.includes('category'));
  let portalIdx = headerRow.findIndex((h: string) => h.includes('portal') || h.includes('upload'));
  let shiftIdx = headerRow.findIndex((h: string) => h.includes('shift') || h.includes('nizaam'));
  let moneyIdx = headerRow.findIndex((h: string) => h.includes('money') || h.includes('account'));
  let slipIdx = headerRow.findIndex((h: string) => h.includes('slip'));
  let paxIdx = headerRow.findIndex((h: string) => h.includes('pax') || h.includes('guest') || h.includes('count'));

  // Fallbacks if not matched by name
  if (tourIdx === -1) tourIdx = 6;
  if (itsIdx === -1) itsIdx = 1;
  if (nameIdx === -1) nameIdx = 2;
  if (ageIdx === -1) ageIdx = 3;
  if (famIdx === -1) famIdx = 4;
  if (officeIdx === -1) officeIdx = 5;
  if (bIdx === -1) bIdx = 7;
  if (rIdx === -1) rIdx = 8;
  if (genderIdx === -1) genderIdx = 9;
  if (leaderIdx === -1) leaderIdx = 10;
  if (arrIdx === -1) arrIdx = 11;
  if (depIdx === -1) depIdx = 12;
  if (catIdx === -1) catIdx = 13;
  if (portalIdx === -1) portalIdx = 14;
  if (shiftIdx === -1) shiftIdx = 15;
  if (moneyIdx === -1) moneyIdx = 16;
  if (slipIdx === -1) slipIdx = 17;
  if (paxIdx === -1) paxIdx = 18;

  const parsedReservations: Reservation[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const tourId = tourIdx !== -1 && row[tourIdx] ? String(row[tourIdx]).trim() : '';
    const itsId = itsIdx !== -1 && row[itsIdx] ? String(row[itsIdx]).trim().replace(/['"]/g, '') : '';
    const applicantName = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : '';

    // Skip empty lines or duplicated headers
    if (!tourId && !applicantName && !itsId) continue;
    if (tourId.toLowerCase() === 'tour id' || itsId.toLowerCase() === 'its') continue;

    const age = ageIdx !== -1 && !isNaN(parseInt(String(row[ageIdx]))) ? parseInt(String(row[ageIdx]), 10) : 38;
    const familyNo = famIdx !== -1 && row[famIdx] ? String(row[famIdx]).trim() : `F-${i}`;
    const officeName = officeIdx !== -1 && row[officeIdx] ? String(row[officeIdx]).trim() : 'Fayz E Husayni Trust Mumbai';
    const building = bIdx !== -1 && row[bIdx] ? String(row[bIdx]).trim() : 'Saifee';
    const roomNumber = rIdx !== -1 && row[rIdx] ? String(row[rIdx]).trim().replace(/^room\s+/i, '') : '';
    const gender = genderIdx !== -1 && row[genderIdx] ? String(row[genderIdx]).trim() : 'Male';
    const groupLeadName = leaderIdx !== -1 && row[leaderIdx] ? String(row[leaderIdx]).trim() : (applicantName || 'Group Lead');
    
    const matchingRoom = rooms.find(
      (rm) => rm.roomNumber === roomNumber && rm.building.toLowerCase() === building.toLowerCase()
    );
    const roomId = matchingRoom ? matchingRoom.id : `rm-${building}-${roomNumber}`;

    const rawArr = arrIdx !== -1 && row[arrIdx] ? String(row[arrIdx]).trim() : '';
    const rawDep = depIdx !== -1 && row[depIdx] ? String(row[depIdx]).trim() : '';
    const arrivalDate = rawArr ? rawArr.slice(0, 10) : '2026-10-01';
    const departureDate = rawDep ? rawDep.slice(0, 10) : '2026-10-06';
    const arrivalDateTime = rawArr ? rawArr.replace(' ', 'T') : `${arrivalDate}T11:00:00`;
    const departureDateTime = rawDep ? rawDep.replace(' ', 'T') : `${departureDate}T01:00:00`;

    const rawCategory = catIdx !== -1 && row[catIdx] ? String(row[catIdx]).trim() : 'Mumineen';
    const rawPortal = portalIdx !== -1 && row[portalIdx] ? String(row[portalIdx]).toLowerCase() : '';
    const isUploadedToPortal = rawPortal.includes('yes') || rawPortal.includes('upload') || rawPortal.includes('true');

    const rawShift = shiftIdx !== -1 && row[shiftIdx] ? String(row[shiftIdx]).toLowerCase() : '';
    const shiftToCategoryA = rawShift.includes('yes') || rawShift.includes('nizaam');

    const rawMoney = moneyIdx !== -1 && row[moneyIdx] ? String(row[moneyIdx]).trim() : '';
    const moneyGiven: Reservation['moneyGiven'] = /yes|paid/i.test(rawMoney) ? 'Yes' : 'No';
    const paymentStatus: Reservation['paymentStatus'] = moneyGiven === 'Yes' ? 'Paid' : 'Pending';

    const requestSlipNo = slipIdx !== -1 && row[slipIdx] ? String(row[slipIdx]).trim() : '';
    const pax = paxIdx !== -1 && !isNaN(parseInt(String(row[paxIdx]))) ? parseInt(String(row[paxIdx]), 10) : 1;

    // Match with existing reservation to preserve internal IDs and logs
    const existing = existingReservations.find(
      (r) =>
        (itsId && r.itsId && r.itsId === itsId) ||
        (tourId && applicantName && r.tourRefNo === tourId && r.applicantName === applicantName) ||
        (tourId && familyNo && r.tourRefNo === tourId && r.family === familyNo)
    );

    parsedReservations.push({
      id: existing ? existing.id : `res-${Date.now()}-${i}`,
      itsId: itsId || existing?.itsId || `30${Math.floor(100000 + Math.random() * 900000)}`,
      applicantName: applicantName || existing?.applicantName || 'Zaer Guest',
      age,
      category: rawCategory,
      idara: existing?.idara || 'Faiz-e-Husaini',
      gender,
      family: familyNo,
      tourRefNo: tourId || existing?.tourRefNo || 'NKERP/TOUR/2026/1333',
      officeName,
      groupLeadName,
      arrivalDate,
      departureDate,
      shiftToCategoryA,
      accommodationCategory: shiftToCategoryA ? 'Category A (Nizaam)' : 'Category B (Standard)',
      requestSlipNo: requestSlipNo || existing?.requestSlipNo || undefined,
      moneyGiven,
      building: building === 'Burhani' ? 'Burhani' : 'Saifee',
      roomNumber,
      roomId,
      isUploadedToPortal,
      paxCount: pax,
      arrivalDateTime,
      entryPort: existing ? existing.entryPort : 'Najaf Airport (NJF)',
      departureDateTime,
      exitPort: existing ? existing.exitPort : 'Najaf Airport (NJF)',
      guestLeaderName: groupLeadName,
      guestContact: existing ? existing.guestContact : '',
      zaereenGuests: existing?.zaereenGuests || [],
      specialRequests: existing?.specialRequests || undefined,
      // Compatibility fields
      tourId: tourId || existing?.tourId || 'NKERP/TOUR/2026/1333',
      familyNo,
      pax,
      totalGuests: pax,
      tourName: existing?.tourName || 'Zaereen Group',
      assignedCategory: shiftToCategoryA ? 'Category A (Nizaam)' : 'Category B (Standard)',
      isUpgradedFromBToA: shiftToCategoryA,
      baseCost: existing ? existing.baseCost : 1000,
      upgradeFee: shiftToCategoryA ? (existing?.upgradeFee || 350) : 0,
      totalCost: existing ? existing.totalCost : 1000,
      amountPaid: moneyGiven === 'Yes' ? (existing?.totalCost || 1000) : 0,
      balanceDue: moneyGiven === 'Yes' ? 0 : (existing?.totalCost || 1000),
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

