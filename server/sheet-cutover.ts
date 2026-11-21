import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import type { Reservation } from '../src/types/index.js';
import { normalizeBuildingName, normalizeRoomNumber } from '../src/services/storage.js';
import { extractCleanTime } from '../src/utils/turnoverTiming.js';
import { SHEET_TAB, HISTORY_TAB } from './nkerp-sync/sheets.js';
import { norm, parseArrival } from './nkerp-sync/util.js';
import type { HistoryRow } from './nkerp-sync/types.js';
import { guests, rooms, read, write, stayKey, transaction, prune } from './local-store.js';

function rows(book: XLSX.WorkBook, name: string, required: string[]) {
  const tab = book.Sheets[name] ?? book.Sheets[name.slice(0,31)];
  if (!tab) throw new Error(`Missing workbook tab: ${name}`);
  const [header, ...body] = XLSX.utils.sheet_to_json<string[]>(tab, { header: 1, raw: false, defval: '' });
  if (!header || required.some(column => !header.includes(column))) throw new Error(`Unexpected header in ${name}`);
  return body.filter(row => row.some(Boolean)).map(row =>
    Object.fromEntries(header.flatMap((key, i) => key ? [[key, String(row[i] ?? '').trim()]] : [])));
}

export function importWorkbook(filename: string, legacyPath?: string) {
  const bytes = readFileSync(filename);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const book = XLSX.read(bytes, {type:'buffer'});
  const grid = rows(book, SHEET_TAB, ['ITS','NAME','TOUR ID','ARRIVAL','DEPARTURE','ROOM ALLOTTMENT']);
  const upgrades = rows(book, 'Category_B_to_A_Upgrades', ['Tour ID','Zaereen Guest Leader','Assigned Room','Building']);
  const history = rows(book, HISTORY_TAB, ['Run At','Tour ID','ITS','Arrival','Run ID']);
  if (!grid.length) throw new Error('The reservation grid is empty.');
  const now = new Date().toISOString();
  const legacy = legacyPath ? JSON.parse(readFileSync(legacyPath,'utf8')) as Reservation[] : [];
  return transaction(() => {
    const previous = read<{ sha256: string } | null>('cutover', null);
    if (previous?.sha256 === sha256) return previous;
    if (previous) throw new Error('The workbook has already been imported into this app.');
    const byStay = new Map([...legacy, ...guests()].map(r => [stayKey(r), r]));
    let saved = 0;
    for (const [index, r] of grid.entries()) {
      if (!r.NAME && !r.ITS && !r['TOUR ID']) continue;
      const itsId = r.ITS.replace(/^'/,'');
      const tourRefNo = r['TOUR ID'];
      const arrivalDate = parseArrival(r.ARRIVAL) || '';
      const departureDate = parseArrival(r.DEPARTURE) || '';
      const building = normalizeBuildingName(r.BUILDING);
      const roomNumber = normalizeRoomNumber(r['ROOM ALLOTTMENT']);
      const roomId = rooms().find(room => room.building === building && room.roomNumber === roomNumber)?.id;
      const matches = upgrades.filter(u => norm(u['Tour ID']) === norm(tourRefNo) &&
        norm(u['Zaereen Guest Leader']) === norm(r['GROUP LEAD'] || r.NAME) &&
        normalizeBuildingName(u.Building) === building && normalizeRoomNumber(u['Assigned Room']) === roomNumber);
      const upgrade = matches[0];
      const pax = Number(r['PAX COUNT']) || 1;
      const category = r.CATEGORY || 'Mumineen';
      const arrivalTime = extractCleanTime(r.ARRIVAL, undefined, undefined, '');
      const departureTime = extractCleanTime(r.DEPARTURE, undefined, undefined, '');
      const parsed: Reservation = {
        id: `workbook-${index+2}`, itsId, tourRefNo, tourId: tourRefNo, applicantName: r.NAME, age: r.AGE,
        family: r.FAMILY, familyNo: r.FAMILY, officeName: r['OFFICE NAME'], gender: r.GENDER,
        groupLeadName: r['GROUP LEAD'], guestLeaderName: r['GROUP LEAD'],
        arrivalDate, departureDate, arrivalTime, departureTime, rawArrivalStr: r.ARRIVAL, rawDepartureStr: r.DEPARTURE,
        category, idara: '', building, roomNumber, roomId, moneyGiven: 'No', paxCount: pax, pax, totalGuests: pax,
        isSpecialGuest: /yes|true|⭐/i.test(r['SPECIAL GUEST']), specialRemarks: r['SPECIAL REMARKS'],
        isUploadedToPortal: /^(yes|uploaded|true)$/i.test(r['MAIN PORTAL']), requestSlipNo: r['REQUEST SLIP NO.'],
        createdAt: now, updatedAt: now,
      };
      const key = itsId && tourRefNo && arrivalDate ? stayKey(parsed) : parsed.id;
      const existing = byStay.get(key);
      const sheetUpdated = Date.parse(r['LAST UPDATED']);
      const localIsNewer = existing && Number.isFinite(sheetUpdated) && Date.parse(existing.updatedAt) > sheetUpdated;
      const merged = { ...existing, ...parsed, id: existing?.id || parsed.id, createdAt: existing?.createdAt || now };
      if (upgrade || category === 'B to A' || category === 'Category A (Nizaam)') {
        Object.assign(merged,{shiftToCategoryA:true, isUpgradedFromBToA:true, accommodationCategory:'Category A (Nizaam)'});
      }
      if (upgrade) Object.assign(merged,{
        guestContact: upgrade.Contact, upgradeReason: upgrade['Upgrade Reason / Notes'], upgradeApprovalBy: upgrade['Approved By'],
        upgradeFee: Number(upgrade['Upgrade Surcharge ($)']), totalCost: Number(upgrade['Total Bill ($)']),
        amountPaid: Number(upgrade['Amount Paid ($)']), balanceDue: Number(upgrade['Remaining Balance ($)']),
        paymentStatus: upgrade['Payment Status'] || existing?.paymentStatus,
      });
      byStay.set(key, localIsNewer ? {...merged,...existing} : merged);
      saved++;
    }
    write('reservations', [...byStay.values()]);
    write('history', history as HistoryRow[]);
    const expired = prune();
    const result = { sha256, importedAt: now, workbookRows: saved, reservations: guests().length, expired, historyRows: read<HistoryRow[]>('history', []).length };
    write('cutover', result);
    return result;
  });
}
