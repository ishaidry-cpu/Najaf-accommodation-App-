import { Room, RoomCategory, Reservation,  DEFAULT_ZAEREEN_CATEGORIES, UserRole, RoomOccupancyDetail, RoomAllotmentCheck } from '../types';
import { 
  checkTurnoverTimingConflict, 
  TurnoverTimingResult, 
  extractCleanTime, 
  formatMinutesToTime12, 
  parseTimeToMinutes,
  isInfant,
  getReservationEffectivePax,
  countEffectivePax
} from '../utils/turnoverTiming';
import { normalizeDate } from './excelService';

export { isInfant, getReservationEffectivePax, countEffectivePax };

const ROOMS_STORAGE_KEY = 'zaereen_accommodation_rooms_saifee_burhani_v6';
const CATEGORIES_STORAGE_KEY = 'zaereen_accommodation_categories_v1';

export const OFFICIAL_THREE_BUILDINGS = ['Burhani', 'Saifee', 'Badri'] as const;
export const INITIAL_BUILDINGS = ['Burhani', 'Saifee', 'Badri'];

export function isOfficialThreeBuilding(building?: string): boolean {
  const nb = normalizeBuildingName(building).toLowerCase();
  return nb === 'burhani' || nb === 'saifee' || nb === 'badri';
}

/**
 * Returns the canonical list of buildings: the 3 core buildings (Burhani, Saifee, Badri)
 * followed by any additional custom buildings present in the rooms inventory.
 */
export function getDistinctBuildings(rooms: Room[] = []): string[] {
  const result: string[] = [...OFFICIAL_THREE_BUILDINGS];
  const seen = new Set(result.map((b) => b.toLowerCase()));
  for (const r of rooms) {
    const norm = normalizeBuildingName(r?.building);
    if (!norm) continue;
    const key = norm.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(norm);
    }
  }
  return result;
}

/**
 * Normalizes hotel/building names to prevent duplicate building sections or duplicate room keys
 * (e.g. "Saifee Hotel", "SAIFEE", "saifee " -> "Saifee").
 */
export function normalizeBuildingName(building?: string): string {
  if (!building) return '';
  let cleaned = String(building).trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';

  const lower = cleaned.toLowerCase();
  if (lower === 'saifee' || lower === 'saifee hotel' || lower === 'saifi' || lower === 'saifi hotel') {
    return 'Saifee';
  }
  if (lower === 'burhani' || lower === 'burhani hotel') {
    return 'Burhani';
  }
  if (lower === 'badri' || lower === 'badri hotel' || lower === 'badri manzil') {
    return 'Badri';
  }
  if (
    lower === 'qasr nobola' ||
    lower === 'qasr-e-nobola' ||
    lower === 'qasr e nobola' ||
    lower === 'qasre nobola' ||
    lower === 'qasr nobola hotel'
  ) {
    return 'Qasr Nobola';
  }

  // Strip trailing redundant " Hotel" on other custom buildings unless the entire name is "Hotel"
  if (/\s+hotel$/i.test(cleaned) && cleaned.length > 6) {
    cleaned = cleaned.replace(/\s+hotel$/i, '').trim();
  }
  return cleaned;
}

/**
 * Normalizes a room number string (e.g. "Room 101" -> "101", "g1" -> "G1").
 */
export function normalizeRoomNumber(roomNumber?: string): string {
  if (!roomNumber) return '';
  let cleaned = String(roomNumber)
    .trim()
    .replace(/^(?:room|rm)\s*#?\s*/i, '')
    .replace(/^#/, '')
    .trim();
  if (!cleaned) return '';
  if (/^[a-z]\d+$/i.test(cleaned)) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * True when a building + room pair looks like a real hotel room.
 * Guards against rows from the Zaereen list being read as rooms
 * (e.g. SR # "121" as the building and ITS "50498613" as the room number).
 */
export function isPlausibleRoom(building?: string, roomNumber?: string): boolean {
  const b = normalizeBuildingName(building);
  const n = normalizeRoomNumber(roomNumber);
  if (!b || !n) return false;
  // A building name always has letters (Saifee, Burhani, Badri, Qasr Nobola, ...).
  if (!/[a-z]/i.test(b)) return false;
  // Room numbers are short (1, 101, G1, M101). Long digit runs are ITS numbers or serials.
  if (n.length > 6 || /\d{5,}/.test(n)) return false;
  return true;
}

/**
 * Canonical deduplication key for a room (building + roomNumber, case/whitespace insensitive).
 */
export function getCanonicalRoomKey(building?: string, roomNumber?: string): string {
  const b = normalizeBuildingName(building).toLowerCase();
  const n = normalizeRoomNumber(roomNumber).toLowerCase();
  if (!b || !n) return '';
  return `${b}::${n}`;
}

const isCanonicalBuiltInRoomId = (id?: string): boolean =>
  !!id && /^rm-(?:bh|sf|bd|qasr)-/i.test(id);

/**
 * Removes duplicate rooms across buildings/room numbers (including ID prefix mismatches
 * like rm-sf-101 vs rm-saifee-101 or casing variants like "SAIFEE" vs "Saifee Hotel"),
 * merging useful metadata and ensuring unique IDs.
 */
export function deduplicateRooms(rooms: Room[]): Room[] {
  if (!Array.isArray(rooms)) return [];

  const roomMap = new Map<string, Room>();

  for (const raw of rooms) {
    if (!raw) continue;
    const building = normalizeBuildingName(raw.building);
    const roomNumber = normalizeRoomNumber(raw.roomNumber);
    if (!building || !roomNumber) continue;
    if (!isPlausibleRoom(building, roomNumber)) continue;

    // Ignore stray CSV header rows
    if (
      building.toLowerCase() === 'building' &&
      roomNumber.toLowerCase().includes('room')
    ) {
      continue;
    }

    const key = `${building.toLowerCase()}::${roomNumber.toLowerCase()}`;
    const existing = roomMap.get(key);

    const parsedCap = Number(raw.capacity || raw.pax || 3);
    const safeCap = !isNaN(parsedCap) && parsedCap > 0 && parsedCap <= 20 ? parsedCap : 3;
    const parsedBuffer = raw.buffer !== undefined ? Number(raw.buffer) : 0;
    const safeBuffer = !isNaN(parsedBuffer) && parsedBuffer >= 0 && parsedBuffer <= 10 ? parsedBuffer : 0;

    if (!existing) {
      const generatedId = `rm-${building.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${roomNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      roomMap.set(key, {
        ...raw,
        id: raw.id && String(raw.id).trim() ? String(raw.id).trim() : generatedId,
        building,
        roomNumber,
        capacity: safeCap,
        pax: safeCap,
        buffer: safeBuffer,
        floor: typeof raw.floor === 'number' && !isNaN(raw.floor) ? raw.floor : (parseInt(String(raw.floor || '1'), 10) || 1),
        floorLabel: raw.floorLabel || `Floor ${typeof raw.floor === 'number' ? raw.floor : 1}`,
        amenities: Array.from(new Set((Array.isArray(raw.amenities) ? raw.amenities : ['Air Conditioning', 'Wi-Fi']).filter(Boolean))),
      });
    } else {
      // Merge duplicate entry into the canonical record without creating a second entry.
      // Give structural precedence to canonical built-in records (rm-bh-*, rm-sf-*, rm-bd-*, rm-qasr-*).
      const existingCanonical = isCanonicalBuiltInRoomId(existing.id);
      const rawCanonical = isCanonicalBuiltInRoomId(raw.id);
      const primary = rawCanonical && !existingCanonical ? raw : existing;
      const secondary = primary === raw ? existing : raw;

      const primaryCap = Number(primary.capacity || primary.pax || 0);
      const secondaryCap = Number(secondary.capacity || secondary.pax || 0);
      const mergedCap =
        !isNaN(primaryCap) && primaryCap > 0 && primaryCap <= 20
          ? primaryCap
          : !isNaN(secondaryCap) && secondaryCap > 0 && secondaryCap <= 20
          ? secondaryCap
          : safeCap;

      const primaryBuf = primary.buffer !== undefined ? Number(primary.buffer) : NaN;
      const secondaryBuf = secondary.buffer !== undefined ? Number(secondary.buffer) : NaN;
      const mergedBuffer =
        !isNaN(primaryBuf) && primaryBuf >= 0 && primaryBuf <= 10
          ? primaryBuf
          : !isNaN(secondaryBuf) && secondaryBuf >= 0 && secondaryBuf <= 10
          ? secondaryBuf
          : 0;

      const isBlocked = existing.status === 'blocked' || raw.status === 'blocked';
      const mergedStatus = isBlocked
        ? 'blocked'
        : existing.status && existing.status !== 'available'
        ? existing.status
        : raw.status || existing.status || 'available';

      const mergedAmenities = Array.from(
        new Set([
          ...(Array.isArray(primary.amenities) ? primary.amenities : []),
          ...(Array.isArray(secondary.amenities) ? secondary.amenities : []),
        ].filter(Boolean))
      );

      roomMap.set(key, {
        ...secondary,
        ...primary,
        id: primary.id || secondary.id,
        building,
        roomNumber,
        capacity: mergedCap,
        pax: mergedCap,
        buffer: mergedBuffer,
        floor: primary.floor ?? secondary.floor ?? 1,
        floorLabel: primary.floorLabel || secondary.floorLabel || `Floor ${primary.floor ?? 1}`,
        toiletType: primary.toiletType || secondary.toiletType,
        bedType: primary.bedType || secondary.bedType,
        category: primary.category || secondary.category,
        status: mergedStatus,
        blockedReason: isBlocked ? (existing.blockedReason || raw.blockedReason) : undefined,
        blockedSince: isBlocked ? (existing.blockedSince || raw.blockedSince) : undefined,
        expectedUnblockDate: isBlocked ? (existing.expectedUnblockDate || raw.expectedUnblockDate) : undefined,
        notes: existing.notes || raw.notes,
        amenities: mergedAmenities.length > 0 ? mergedAmenities : ['Air Conditioning', 'Wi-Fi'],
      });
    }
  }

  // Ensure every room in the returned list also has a strictly unique id
  const seenIds = new Set<string>();
  const finalRooms: Room[] = [];
  for (const room of roomMap.values()) {
    let uniqueId = room.id;
    if (!uniqueId || seenIds.has(uniqueId)) {
      uniqueId = `rm-${room.building.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${room.roomNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    }
    let suffix = 2;
    while (seenIds.has(uniqueId)) {
      uniqueId = `${room.id}-${suffix++}`;
    }
    seenIds.add(uniqueId);
    finalRooms.push(uniqueId === room.id ? room : { ...room, id: uniqueId });
  }

  return finalRooms;
}

interface RawRoomConfig {
  building: 'BURHANI' | 'SAIFEE';
  roomNumber: string;
  pax: number;
  buffer: number;
  toiletType: string;
  bedType: string;
  floor: number;
  floorLabel: string;
}

const RAW_ROOM_SPECS: RawRoomConfig[] = [
  // ========================
  // BURHANI HOTEL (44 Rooms)
  // ========================
  // Ground Floor
  { building: 'BURHANI', roomNumber: 'G1', pax: 2, buffer: 1, toiletType: 'WESTERN', bedType: 'Single Beds', floor: 0, floorLabel: 'Ground' },
  { building: 'BURHANI', roomNumber: 'G2', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 0, floorLabel: 'Ground' },
  { building: 'BURHANI', roomNumber: 'G3', pax: 2, buffer: 1, toiletType: 'WESTERN', bedType: 'Single Beds', floor: 0, floorLabel: 'Ground' },
  // Mezzanine Floor
  { building: 'BURHANI', roomNumber: 'M101', pax: 2, buffer: 1, toiletType: 'WESTERN', bedType: 'Single Beds', floor: 0.5, floorLabel: 'Mezzanine' },
  // Floor 1
  { building: 'BURHANI', roomNumber: '101', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '102', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Double Bed', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '103', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '104', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '105', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '106', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '107', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '108', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '109', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'BURHANI', roomNumber: '110', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  // Floor 2
  { building: 'BURHANI', roomNumber: '201', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '202', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '203', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '204', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '205', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '206', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '207', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '208', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '209', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'BURHANI', roomNumber: '210', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  // Floor 3
  { building: 'BURHANI', roomNumber: '301', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '302', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '303', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '304', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '305', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '306', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '307', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '308', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '309', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'BURHANI', roomNumber: '310', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  // Floor 4
  { building: 'BURHANI', roomNumber: '401', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '402', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '403', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '404', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '405', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '406', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '407', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '408', pax: 4, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '409', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'BURHANI', roomNumber: '410', pax: 2, buffer: 1, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },

  // ========================
  // SAIFEE HOTEL (70 Rooms)
  // ========================
  // Floor 1
  { building: 'SAIFEE', roomNumber: '101', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '102', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '103', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '104', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '105', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Double Bed', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '106', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Both Single Bed & double Bed', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '107', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '108', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '109', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  { building: 'SAIFEE', roomNumber: '110', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 1, floorLabel: 'Floor 1' },
  // Floor 2
  { building: 'SAIFEE', roomNumber: '201', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '202', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '203', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '204', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '205', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Double Bed', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '206', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '207', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '208', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Both Single Bed & double Bed', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '209', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  { building: 'SAIFEE', roomNumber: '210', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 2, floorLabel: 'Floor 2' },
  // Floor 3
  { building: 'SAIFEE', roomNumber: '301', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Double Bed', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '302', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '303', pax: 2, buffer: 0, toiletType: 'WESTERN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '304', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '305', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Double Bed', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '306', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '307', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '308', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '309', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  { building: 'SAIFEE', roomNumber: '310', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 3, floorLabel: 'Floor 3' },
  // Floor 4
  { building: 'SAIFEE', roomNumber: '401', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '402', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '403', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '404', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '405', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Double Bed', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '406', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '407', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '408', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '409', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  { building: 'SAIFEE', roomNumber: '410', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 4, floorLabel: 'Floor 4' },
  // Floor 5
  { building: 'SAIFEE', roomNumber: '501', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '502', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '503', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '504', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '505', pax: 2, buffer: 0, toiletType: 'WESTERN', bedType: 'Double Bed', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '506', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '507', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '508', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '509', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  { building: 'SAIFEE', roomNumber: '510', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 5, floorLabel: 'Floor 5' },
  // Floor 6
  { building: 'SAIFEE', roomNumber: '601', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '602', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '603', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '604', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '605', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Double Bed', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '606', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '607', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '608', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '609', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  { building: 'SAIFEE', roomNumber: '610', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 6, floorLabel: 'Floor 6' },
  // Floor 7
  { building: 'SAIFEE', roomNumber: '701', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '702', pax: 2, buffer: 0, toiletType: 'INDIAN', bedType: 'Double Bed', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '703', pax: 3, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '704', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Both Single Bed & double Bed', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '705', pax: 2, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '706', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '707', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '708', pax: 4, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Both Single Bed & double Bed', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '709', pax: 3, buffer: 0, toiletType: 'INDIAN', bedType: 'Single Beds', floor: 7, floorLabel: 'Floor 7' },
  { building: 'SAIFEE', roomNumber: '710', pax: 3, buffer: 0, toiletType: 'Both WESTERN & INDIAN', bedType: 'Single Beds', floor: 7, floorLabel: 'Floor 7' },
];

/**
 * Generates official 114 rooms with exact buildings, room numbers, pax, buffer, toilet type, and bed types:
 * Burhani Hotel: 44 rooms (Ground: G1-G3, Mezzanine: M101, Floor 1: 101-110, Floor 2: 201-210, Floor 3: 301-310, Floor 4: 401-410)
 * Saifee Hotel: 70 rooms (Floors 1 to 7, each 101-110 to 701-710)
 * Total: 44 + 70 = 114 rooms
 */
export function generateSaifeeBurhani114Rooms(): Room[] {
  // Specific initial maintenance holds (optional)
  const blockedConfig: Record<string, { reason: string; since: string; unblock: string; notes?: string }> = {
    'Saifee-108': {
      reason: 'Air conditioning compressor overhaul & filter duct replacement',
      since: '2026-09-22',
      unblock: '2026-10-02',
      notes: 'Maintenance contractor on site.',
    },
    'Burhani-105': {
      reason: 'Official VIP delegation reserve hold',
      since: '2026-09-20',
      unblock: '2026-10-05',
      notes: 'Held for leadership committee.',
    },
  };

  return RAW_ROOM_SPECS.map((spec) => {
    // Normalize building display name ('Burhani' and 'Saifee')
    const bldgName = spec.building === 'BURHANI' ? 'Burhani' : 'Saifee';
    const prefix = spec.building === 'BURHANI' ? 'bh' : 'sf';
    const id = `rm-${prefix}-${spec.roomNumber.toLowerCase()}`;
    const key = `${bldgName}-${spec.roomNumber}`;

    const blockedInfo = blockedConfig[key];
    const status: 'available' | 'occupied' | 'blocked' | 'cleaning' = blockedInfo ? 'blocked' : 'available';

    // Category determination: Double bed or Western toilet or higher floor VIP is Category A (Nizaam)
    const isNizaam =
      spec.bedType.toLowerCase().includes('double') ||
      spec.toiletType.toLowerCase().includes('western') ||
      spec.floor >= 6;
    const category = isNizaam ? 'Category A (Nizaam)' : 'Category B (Standard)';

    const amenities = [
      spec.toiletType === 'Both WESTERN & INDIAN' ? 'Western & Indian Toilet' : `${spec.toiletType} Toilet`,
      spec.bedType,
      'Air Conditioning',
      'Wi-Fi',
      'Prayer Mats',
    ];

    if (spec.buffer > 0) {
      amenities.push(`Buffer: ${spec.buffer}`);
    }

    return {
      id,
      roomNumber: spec.roomNumber,
      building: bldgName,
      floor: spec.floor,
      floorLabel: spec.floorLabel,
      capacity: spec.pax,
      pax: spec.pax,
      buffer: spec.buffer,
      toiletType: spec.toiletType,
      bedType: spec.bedType,
      category,
      status,
      blockedReason: blockedInfo?.reason,
      blockedSince: blockedInfo?.since,
      expectedUnblockDate: blockedInfo?.unblock,
      notes: blockedInfo?.notes,
      amenities,
    };
  });
}

/**
 * Reconciles the official 114 rooms across Burhani (44) & Saifee (70) so their canonical
 * capacities, buffers, floors, toilet types, and bed types always match RAW_ROOM_SPECS
 * while preserving operational status (blocked/available/cleaning), block details, and notes.
 * Any additional custom rooms/buildings remain untouched.
 */
export function reconcileOfficialSaifeeBurhaniRooms(rooms: Room[]): Room[] {
  const deduped = deduplicateRooms(Array.isArray(rooms) ? rooms : []);
  const existingByKey = new Map<string, Room>();
  deduped.forEach((r) => {
    const key = getCanonicalRoomKey(r.building, r.roomNumber);
    if (key) existingByKey.set(key, r);
  });

  const official114 = generateSaifeeBurhani114Rooms();
  const officialKeys = new Set<string>();

  const reconciledOfficial = official114.map((specRoom) => {
    const key = getCanonicalRoomKey(specRoom.building, specRoom.roomNumber);
    officialKeys.add(key);
    const existing = existingByKey.get(key);
    if (!existing) return specRoom;

    const cleanExistingAmenities = (existing.amenities || []).filter(
      (a) => !/^buffer[:\s]*\d+/i.test(String(a || '').trim())
    );
    const baseAmenities = cleanExistingAmenities.length > 0
      ? cleanExistingAmenities
      : specRoom.amenities.filter((a) => !/^buffer[:\s]*\d+/i.test(a));
    const mergedAmenities = specRoom.buffer && specRoom.buffer > 0
      ? Array.from(new Set([...baseAmenities, `Buffer: ${specRoom.buffer}`]))
      : baseAmenities;

    const status = existing.status || specRoom.status || 'available';
    const isBlocked = status === 'blocked';

    return {
      ...existing,
      id: specRoom.id,
      roomNumber: specRoom.roomNumber,
      building: specRoom.building,
      floor: specRoom.floor,
      floorLabel: specRoom.floorLabel,
      capacity: specRoom.capacity,
      pax: specRoom.pax,
      buffer: specRoom.buffer,
      toiletType: specRoom.toiletType,
      bedType: specRoom.bedType,
      category: specRoom.category,
      status,
      blockedReason: isBlocked ? (existing.blockedReason || specRoom.blockedReason) : undefined,
      blockedSince: isBlocked ? (existing.blockedSince || specRoom.blockedSince) : undefined,
      expectedUnblockDate: isBlocked ? (existing.expectedUnblockDate || specRoom.expectedUnblockDate) : undefined,
      notes: existing.notes ?? specRoom.notes,
      amenities: mergedAmenities,
    };
  });

  const nonOfficialRooms = deduped.filter((r) => {
    const key = getCanonicalRoomKey(r.building, r.roomNumber);
    return key && !officialKeys.has(key);
  });

  return pruneLegacyBadriRooms(deduplicateRooms([...reconciledOfficial, ...nonOfficialRooms]));
}

export const BADRI_OFFICIAL_ROOM_NUMBERS = ['103', '104', '105', '106', '107', '201'] as const;

/**
 * Generates Badri Hotel rooms: 6 official rooms (103, 104, 105, 106, 107 on Floor 1; 201 on Floor 2)
 */
export function generateBadriRooms(): Room[] {
  const specs: Array<{ roomNumber: string; floor: number }> = [
    { roomNumber: '103', floor: 1 },
    { roomNumber: '104', floor: 1 },
    { roomNumber: '105', floor: 1 },
    { roomNumber: '106', floor: 1 },
    { roomNumber: '107', floor: 1 },
    { roomNumber: '201', floor: 2 },
  ];

  return specs.map(({ roomNumber, floor }) => {
    const num = parseInt(roomNumber, 10);
    const isEven = num % 2 === 0;
    const pax = isEven ? 4 : 3;
    const buffer = isEven ? 1 : 0;
    const toiletType = isEven ? 'Both WESTERN & INDIAN' : 'WESTERN';
    const bedType = isEven ? 'Both Single Bed & double Bed' : 'Single Beds';
    const category: RoomCategory = isEven ? 'Category A (Nizaam)' : 'Category B (Standard)';

    return {
      id: `rm-bd-${roomNumber.toLowerCase()}`,
      roomNumber,
      building: 'Badri',
      floor,
      floorLabel: `Floor ${floor}`,
      capacity: pax,
      pax,
      buffer,
      toiletType,
      bedType,
      category,
      status: 'available',
      amenities: [
        `${toiletType} Toilet`,
        bedType,
        'Air Conditioning',
        'Wi-Fi',
        'Prayer Mats',
        ...(buffer > 0 ? [`Buffer: ${buffer}`] : []),
      ],
    };
  });
}

/**
 * Removes legacy auto-generated Badri rooms (e.g. 101, 102, 108-110, 202-210, 301-310)
 * so Badri strictly contains rooms 103, 104, 105, 106, 107, 201.
 */
export function pruneLegacyBadriRooms(rooms: Room[]): Room[] {
  const allowedSet = new Set<string>(BADRI_OFFICIAL_ROOM_NUMBERS);
  const filtered = rooms.filter((r) => {
    if (normalizeBuildingName(r.building).toLowerCase() !== 'badri') return true;
    const num = normalizeRoomNumber(r.roomNumber);
    return allowedSet.has(num);
  });
  return deduplicateRooms([...filtered, ...generateBadriRooms()]);
}

export const INITIAL_ROOMS: Room[] = deduplicateRooms([
  ...generateSaifeeBurhani114Rooms(),
  ...generateBadriRooms(),
]);

/**
 * Initial Zaereen matching user's exact work process fields and user's Excel sheet screenshot:
 * ITS Id | Applicant Name | Age | Jamaat | Rotation Id | Category | Gender | Family | Idara | HOF_ID | GroupAdmin | GROUP_ID | Tour Reference No. | Office Name | Group Lead Name | Arrival Date | Departure Date
 */
// CATEGORIES ACCESSORS
// ========================

export function getStoredCategories(): string[] {
  try {
    const raw = localStorage.getItem(CATEGORIES_STORAGE_KEY);
    if (!raw) return DEFAULT_ZAEREEN_CATEGORIES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_ZAEREEN_CATEGORIES;
  } catch {
    return DEFAULT_ZAEREEN_CATEGORIES;
  }
}

export function saveStoredCategories(categories: string[]): void {
  try {
    localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
  } catch (err) {
    console.error('Failed to save categories', err);
  }
}

// ========================
// DATE & DURATION OVERLAP UTILITIES
// ========================

/**
 * Checks whether two date ranges [arr1, dep1] and [arr2, dep2] overlap.
 * Format expected: YYYY-MM-DD or ISO string.
 * Same-day departure and arrival (d1 === a2 or d2 === a1) is turnover day and NOT an overlap.
 */
export function doDatesOverlap(arr1?: string, dep1?: string, arr2?: string, dep2?: string): boolean {
  if (!arr1 || !dep1 || !arr2 || !dep2) return false;
  const a1 = normalizeDate(arr1) || arr1.slice(0, 10);
  const d1 = normalizeDate(dep1) || dep1.slice(0, 10);
  const a2 = normalizeDate(arr2) || arr2.slice(0, 10);
  const d2 = normalizeDate(dep2) || dep2.slice(0, 10);

  // If both are single-day bookings on the exact same date:
  if (a1 === d1 && a2 === d2) {
    return a1 === a2;
  }
  // If reservation 1 is a single-day booking:
  if (a1 === d1) {
    return a1 >= a2 && a1 < d2;
  }
  // If reservation 2 is a single-day booking:
  if (a2 === d2) {
    return a2 >= a1 && a2 < d1;
  }

  // Same-day departure and arrival (e.g. d1 === a2 or d2 === a1) is turnover day (morning checkout ➔ afternoon checkin).
  // Standard hotel night occupancy: guest 1 occupies nights [a1, d1-1], guest 2 occupies nights [a2, d2-1].
  // An overlap of nights occurs only when arrival of one is strictly before departure of the other:
  return a1 < d2 && d1 > a2;
}

/**
 * Calculate maximum allowable capacity for a room including buffer
 */
export function getRoomMaxCapacity(room: Room): number {
  const base = room.capacity || room.pax || 2;
  const buf = room.buffer || 0;
  return base + buf;
}

export const ROOM_TOILET_TYPES = [
  { value: 'WESTERN', label: 'Western' },
  { value: 'INDIAN', label: 'Indian' },
  { value: 'Both WESTERN & INDIAN', label: 'Western & Indian' },
] as const;

export const ROOM_BED_TYPES = ['Single Beds', 'Double Bed', 'Both Single Bed & double Bed', 'Suite Beds'] as const;

export const ROOM_CATEGORIES: RoomCategory[] = ['Category A (Nizaam)', 'Category B (Standard)', 'Executive Suite'];

/** Physical beds in a room. Rooms saved before bed counts existed fall back to their pax capacity. */
export function getRoomBedCount(room: Room): number {
  const beds = Number(room.beds);
  return Number.isFinite(beds) && beds > 0 ? beds : (room.capacity || room.pax || 2);
}

/** Short spec line used across the app, e.g. "3 beds · Sleeps 4 +1". */
export function describeRoomCapacity(room: Room): string {
  const beds = getRoomBedCount(room);
  const sleeps = room.capacity || room.pax || 2;
  return `${beds} ${beds === 1 ? 'bed' : 'beds'} · Sleeps ${sleeps}${room.buffer ? ` +${room.buffer}` : ''}`;
}

/** Amenity tags derived from a room's specs plus any custom features. */
export function buildRoomAmenities(spec: Pick<Room, 'toiletType' | 'bedType' | 'buffer'>, features: string[] = []): string[] {
  const toilet = spec.toiletType === 'Both WESTERN & INDIAN'
    ? 'Western & Indian Toilet'
    : spec.toiletType ? `${spec.toiletType} Toilet` : '';
  return Array.from(new Set([
    toilet,
    spec.bedType || '',
    'Air Conditioning',
    'Wi-Fi',
    'Prayer Mats',
    ...features.map((f) => f.trim()),
    ...(spec.buffer ? [`Buffer: ${spec.buffer}`] : []),
  ].filter(Boolean)));
}

/** Custom features of a room: its amenities minus the tags derived from its specs. */
export function getRoomCustomFeatures(room: Room): string[] {
  const derived = new Set(buildRoomAmenities(room).map((a) => a.toLowerCase()));
  return (room.amenities || []).filter((a) => {
    const t = String(a || '').trim();
    if (!t || derived.has(t.toLowerCase())) return false;
    if (/^buffer[:\s]*\d+/i.test(t) || /toilet$/i.test(t)) return false;
    if (/^(wi-?fi|air conditioning|clean linens|prayer mats)$/i.test(t)) return false;
    return !(ROOM_BED_TYPES as readonly string[]).some((b) => b.toLowerCase() === t.toLowerCase());
  });
}

/**
 * Merges added or edited rooms into the inventory by building + room number.
 * An existing room keeps its id and any details the incoming room does not set.
 * Custom rooms and edited specs are kept as entered.
 */
export function mergeRoomsIntoInventory(existing: Room[], incoming: Room[]): Room[] {
  const roomMap = new Map<string, Room>();
  existing.forEach((r) => {
    const key = getCanonicalRoomKey(r.building, r.roomNumber) || `id::${r.id}`;
    roomMap.set(key, r);
  });
  deduplicateRooms(incoming).forEach((nr) => {
    const key = getCanonicalRoomKey(nr.building, nr.roomNumber);
    if (!key) return;
    const current = roomMap.get(key);
    roomMap.set(key, current ? { ...current, ...nr, id: current.id } : nr);
  });
  return Array.from(roomMap.values());
}

/**
 * Checks all reservations occupying a room on a specific calendar date (YYYY-MM-DD)
 */
export function getRoomBookingsOnDate(
  room: Room,
  dateStr: string,
  reservations: Reservation[]
): Reservation[] {
  const targetDate = dateStr.slice(0, 10);
  const rBldg = (room.building || '').trim().toLowerCase();
  const rNum = (room.roomNumber || '').trim().toLowerCase();

  return reservations.filter(
    (res) =>
      (res.building || '').trim().toLowerCase() === rBldg &&
      (res.roomNumber || '').trim().toLowerCase() === rNum &&
      res.roomNumber !== '' &&
      (res.arrivalDate || '').slice(0, 10) <= targetDate &&
      (res.departureDate || '').slice(0, 10) >= targetDate
  );
}

/**
 * Returns single booking for backwards compatibility
 */
export function getRoomBookingOnDate(
  room: Room,
  dateStr: string,
  reservations: Reservation[]
): Reservation | undefined {
  const all = getRoomBookingsOnDate(room, dateStr, reservations);
  return all[0];
}

/**
 * Detailed occupancy information for a room on a specific date
 */
export function getRoomOccupancyDetailOnDate(
  room: Room,
  dateStr: string,
  reservations: Reservation[]
): RoomOccupancyDetail {
  const occupants = getRoomBookingsOnDate(room, dateStr, reservations);
  const currentOccupancy = countEffectivePax(occupants);
  const baseCapacity = room.capacity || room.pax || 2;
  const bufferCapacity = room.buffer || 0;
  const maxCapacity = baseCapacity + bufferCapacity;
  const remainingSlots = Math.max(0, maxCapacity - currentOccupancy);

  return {
    room,
    currentOccupancy,
    baseCapacity,
    bufferCapacity,
    maxCapacity,
    remainingSlots,
    isFull: currentOccupancy >= maxCapacity,
    isBufferUtilized: currentOccupancy > baseCapacity && currentOccupancy <= maxCapacity,
    occupants,
  };
}

/**
 * Get dynamic room status on a specific date: 'blocked' | 'occupied' | 'available'
 */
export function getRoomStatusOnDate(
  room: Room,
  dateStr: string,
  reservations: Reservation[]
): 'blocked' | 'occupied' | 'available' {
  if (room.status === 'blocked') {
    return 'blocked';
  }
  const occupants = getRoomBookingsOnDate(room, dateStr, reservations);
  const currentOccupancy = countEffectivePax(occupants);
  const maxCapacity = getRoomMaxCapacity(room);

  if (currentOccupancy >= maxCapacity && maxCapacity > 0) {
    return 'occupied';
  }
  return 'available';
}

/**
 * Get all reservations in a specific room that overlap with the date duration [arrivalDate, departureDate].
 */
export function getRoomBookingsForDuration(
  building: string,
  roomNumber: string,
  arrivalDate: string,
  departureDate: string,
  reservations: Reservation[],
  excludeReservationId?: string
): Reservation[] {
  if (!building || !roomNumber || !arrivalDate || !departureDate) return [];
  const bNorm = String(building || '').trim().toLowerCase();
  const rNorm = String(roomNumber || '').trim().toLowerCase();

  return reservations.filter((res) => {
    if (excludeReservationId && res.id === excludeReservationId) return false;
    const resB = String(res.building || '').trim().toLowerCase();
    const resR = String(res.roomNumber || '').trim().toLowerCase();
    if (resB !== bNorm || resR !== rNorm) return false;
    return doDatesOverlap(res.arrivalDate, res.departureDate, arrivalDate, departureDate);
  });
}

/**
 * Checks whether a room can accommodate an additional guest/reservation
 * up to max capacity with buffer included, and verifies same-day turnover timing rules:
 * 
 * 1. When departure and arrival are on the same date and departure time is later than arrival time,
 *    issue a notification / warning and allow force allocation.
 * 2. When departure time is later than arrival time with a difference of MORE THAN 15 HOURS,
 *    force allocation is strictly BLOCKED (canForceAllocate: false).
 */
export function checkRoomAllotmentAvailability(
  building: string,
  roomNumber: string,
  arrivalDate: string,
  departureDate: string,
  rooms: Room[],
  reservations: Reservation[],
  requestedPax: number = 1,
  excludeReservationId?: string,
  forceAllocate: boolean = false,
  arrivalTime?: string,
  departureTime?: string,
  applicantName?: string,
  candidateFamily?: string,
  candidateTour?: string
): RoomAllotmentCheck {
  const bNorm = String(building || '').trim().toLowerCase();
  const rNorm = String(roomNumber || '').trim().toLowerCase();
  
  const targetRoom = rooms.find(
    (r) => String(r.building || '').trim().toLowerCase() === bNorm && String(r.roomNumber || '').trim().toLowerCase() === rNorm
  );

  if (!targetRoom) {
    return {
      allowed: false,
      reason: `Room ${roomNumber} in ${building} Hotel was not found.`,
      maxCapacity: 0,
      currentOccupancy: 0,
      remainingSlots: 0,
      occupants: [],
      canForceAllocate: false,
    };
  }

  const baseCapacity = targetRoom.capacity || targetRoom.pax || 2;
  const bufferCapacity = targetRoom.buffer || 0;
  const maxCapacity = baseCapacity + bufferCapacity;

  if (targetRoom.status === 'blocked' && !forceAllocate) {
    return {
      allowed: false,
      reason: `Room ${roomNumber} is currently blocked: ${targetRoom.blockedReason || 'Maintenance hold'}.`,
      room: targetRoom,
      maxCapacity,
      currentOccupancy: 0,
      remainingSlots: 0,
      occupants: [],
      canForceAllocate: true,
    };
  }

  // =========================================================================
  // SAME-DAY TURNOVER TIMING CONFLICT CHECK
  // "When there is departure and arrival on same and the departure time is late
  // than the arrival time give a notification. and give an option to force allocate
  // after giving a warning. When departure and arrival has more than 15 hours difference
  // means departure is late than arrival with a difference of 15 hours dont allow force allocation too"
  // =========================================================================
  const candidateArrDate = normalizeDate(arrivalDate) || (arrivalDate || '').slice(0, 10);
  const candidateDepDate = normalizeDate(departureDate) || (departureDate || '').slice(0, 10);

  const roomReservations = reservations.filter((res) => {
    if (excludeReservationId && res.id === excludeReservationId) return false;
    const resB = String(res.building || '').trim().toLowerCase();
    const resR = String(res.roomNumber || '').trim().toLowerCase();
    return resB === bNorm && resR === rNorm;
  });

  let worstTimingConflict: TurnoverTimingResult | null = null;
  let conflictingReservation: Reservation | null = null;

  for (const existingRes of roomReservations) {
    const existArrDate = normalizeDate(existingRes.arrivalDate || existingRes.arrivalDateTime || existingRes.rawArrivalStr) || '';
    const existDepDate = normalizeDate(existingRes.departureDate || existingRes.departureDateTime || existingRes.rawDepartureStr) || '';

    // Scenario A: Existing reservation departs on candidate's arrival date (turnover day!)
    // Existing is departing, candidate is arriving.
    if (existDepDate === candidateArrDate && candidateArrDate !== '') {
      const conflict = checkTurnoverTimingConflict(
        existDepDate,
        existingRes.departureTime || existingRes.rawDepartureStr,
        candidateArrDate,
        arrivalTime,
        existingRes.applicantName,
        applicantName || 'New Guest'
      );
      // Only record as conflict if departure is later than arrival!
      if (conflict.isSameDateTurnover && conflict.isDepLaterThanArr) {
        if (!worstTimingConflict || conflict.diffHours > worstTimingConflict.diffHours) {
          worstTimingConflict = conflict;
          conflictingReservation = existingRes;
        }
      }
    }

    // Scenario B: Candidate departs on existing reservation's arrival date (turnover day!)
    // Candidate is departing, existing is arriving.
    if (candidateDepDate === existArrDate && candidateDepDate !== '') {
      const conflict = checkTurnoverTimingConflict(
        candidateDepDate,
        departureTime,
        existArrDate,
        existingRes.arrivalTime || existingRes.rawArrivalStr,
        applicantName || 'New Guest',
        existingRes.applicantName
      );
      // Only record as conflict if departure is later than arrival!
      if (conflict.isSameDateTurnover && conflict.isDepLaterThanArr) {
        if (!worstTimingConflict || conflict.diffHours > worstTimingConflict.diffHours) {
          worstTimingConflict = conflict;
          conflictingReservation = existingRes;
        }
      }
    }
  }

  // =========================================================================
  // NIGHT OVERLAP & CAPACITY/BUFFER CHECK
  // User requirement: "show the room in allocation when the capicity not reached"
  // =========================================================================
  const overlappingReservations = getRoomBookingsForDuration(
    building,
    roomNumber,
    arrivalDate,
    departureDate,
    reservations,
    excludeReservationId
  );

  const currentOccupancy = countEffectivePax(overlappingReservations);
  const remainingSlots = Math.max(0, maxCapacity - currentOccupancy);

  // Check if max capacity is exceeded
  const isOverPaxLimit = currentOccupancy + requestedPax > maxCapacity;

  // Same-Day Turnover Notice (Only flags when departure time is LATER than arrival time on same date!)
  const hasTurnoverNotice = !!(worstTimingConflict && worstTimingConflict.isSameDateTurnover && worstTimingConflict.isDepLaterThanArr);

  if (isOverPaxLimit && !forceAllocate) {
    const occupantNames = overlappingReservations.map((r) => `${r.applicantName} (Fam #${r.family || '—'})`).join(', ');
    const reason = `Notice: Room ${roomNumber} (${building} Hotel) capacity limit reached (${currentOccupancy}/${maxCapacity} Pax occupied by ${occupantNames || 'guests'}). Adding ${requestedPax} pax exceeds max capacity. Click Okay to allow force allocation.`;

    return {
      allowed: false,
      reason,
      room: targetRoom,
      maxCapacity,
      currentOccupancy,
      remainingSlots,
      occupants: overlappingReservations,
      canForceAllocate: true, // Always allow force allocation with notice!
      isSevereConflict: false,
      isOverPaxLimit: true,
      hasTimingConflict: hasTurnoverNotice,
      timingConflictDiffHours: worstTimingConflict?.diffHours,
      timingConflictMessage: worstTimingConflict?.message,
    };
  }

  // If force allocated after notice / warning:
  if (forceAllocate) {
    const occupantNames = overlappingReservations.map((r) => `${r.applicantName} (${r.family || 'Fam'})`).join(', ');
    return {
      allowed: true,
      reason: hasTurnoverNotice
        ? `Force Allocated (Turnover Notice Acknowledged): ${worstTimingConflict!.message}`
        : isOverPaxLimit
        ? `Force Allocated: Room ${roomNumber} (${building}) occupied by ${occupantNames || 'other guests'}.`
        : 'Allotted with confirmation.',
      room: targetRoom,
      maxCapacity,
      currentOccupancy,
      remainingSlots,
      occupants: overlappingReservations,
      canForceAllocate: true,
      hasTimingConflict: hasTurnoverNotice,
      isSevereConflict: false,
      isOverPaxLimit,
      timingConflictDiffHours: worstTimingConflict?.diffHours,
      timingConflictMessage: worstTimingConflict?.message,
    };
  }

  // When capacity is NOT reached -> Room is ALLOWED and available in allocation!
  return {
    allowed: true,
    reason: hasTurnoverNotice
      ? worstTimingConflict!.message
      : overlappingReservations.length > 0
      ? `Partially occupied (${currentOccupancy}/${maxCapacity} Pax, ${remainingSlots} slots remaining)`
      : worstTimingConflict
      ? `Turnover ready (${worstTimingConflict.depTimeFormatted} check-out)`
      : 'Vacant and ready',
    room: targetRoom,
    maxCapacity,
    currentOccupancy,
    remainingSlots,
    occupants: overlappingReservations,
    canForceAllocate: true,
    isSevereConflict: false,
    isOverPaxLimit: false,
    hasTimingConflict: hasTurnoverNotice,
    timingConflictDiffHours: worstTimingConflict?.diffHours,
    timingConflictMessage: worstTimingConflict?.message,
    depTime: worstTimingConflict?.depTimeFormatted,
    arrTime: worstTimingConflict?.arrTimeFormatted,
    conflictingGuestName: conflictingReservation?.applicantName,
  };
}

/**
 * Checks whether a room has reached or exceeded max capacity with buffer for the duration.
 * Returns the conflicting reservation ONLY if max capacity is exceeded!
 */
export function isRoomBookedForDuration(
  building: string,
  roomNumber: string,
  arrivalDate: string,
  departureDate: string,
  reservations: Reservation[],
  excludeReservationId?: string,
  rooms?: Room[],
  requestedPax: number = 1,
  arrivalTime?: string,
  departureTime?: string,
  applicantName?: string
): Reservation | undefined {
  if (!building || !roomNumber || !arrivalDate || !departureDate) return undefined;
  
  const allRooms = rooms || getStoredRooms();
  const check = checkRoomAllotmentAvailability(
    building,
    roomNumber,
    arrivalDate,
    departureDate,
    allRooms,
    reservations,
    requestedPax,
    excludeReservationId,
    false,
    arrivalTime,
    departureTime,
    applicantName
  );

  if (!check.allowed && check.occupants.length > 0) {
    return check.occupants[0];
  }
  return undefined;
}

/**
 * Returns all rooms in a building that have remaining capacity (including buffer) for the entire duration
 * and do not have un-overridden turnover timing conflicts.
 */
export function getVacantRoomsForDuration(
  building: string,
  arrivalDate: string,
  departureDate: string,
  rooms: Room[],
  reservations: Reservation[],
  excludeReservationId?: string,
  requestedPax: number = 1,
  arrivalTime?: string,
  departureTime?: string,
  applicantName?: string,
  candidateFamily?: string,
  candidateTour?: string
): Room[] {
  const bNorm = building.trim().toLowerCase();
  return rooms.filter((room) => {
    if ((room.building || '').trim().toLowerCase() !== bNorm) return false;
    if (room.status === 'blocked') return false;
    
    const check = checkRoomAllotmentAvailability(
      building,
      room.roomNumber,
      arrivalDate,
      departureDate,
      rooms,
      reservations,
      requestedPax,
      excludeReservationId,
      false,
      arrivalTime,
      departureTime,
      applicantName,
      candidateFamily,
      candidateTour
    );
    return check.allowed;
  });
}

// ========================
// STORAGE ACCESSORS
// ========================

export function getStoredRooms(): Room[] {
  try {
    const raw = localStorage.getItem(ROOMS_STORAGE_KEY);
    if (!raw) {
      saveRooms(INITIAL_ROOMS);
      return INITIAL_ROOMS;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0].toiletType) {
      saveRooms(INITIAL_ROOMS);
      return INITIAL_ROOMS;
    }
    let deduped = deduplicateRooms(parsed);
    const badriRooms = deduped.filter((r: Room) => normalizeBuildingName(r.building).toLowerCase() === 'badri');
    const allowedBadriSet = new Set<string>(BADRI_OFFICIAL_ROOM_NUMBERS);
    const hasLegacyOrMissingBadri =
      badriRooms.length !== BADRI_OFFICIAL_ROOM_NUMBERS.length ||
      badriRooms.some((r: Room) => !allowedBadriSet.has(normalizeRoomNumber(r.roomNumber)));
    if (hasLegacyOrMissingBadri) {
      deduped = pruneLegacyBadriRooms(deduped);
    }

    const reconciled = reconcileOfficialSaifeeBurhaniRooms(deduped);
    const needsSave =
      reconciled.length !== parsed.length ||
      hasLegacyOrMissingBadri ||
      JSON.stringify(reconciled) !== JSON.stringify(deduped);
    if (needsSave) {
      saveRooms(reconciled);
    }
    return reconciled;
  } catch {
    return INITIAL_ROOMS;
  }
}

export function saveRooms(rooms: Room[]): void {
  try {
    const deduped = reconcileOfficialSaifeeBurhaniRooms(pruneLegacyBadriRooms(deduplicateRooms(rooms)));
    localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(deduped));
  } catch (err) {
    console.error('Failed to save rooms to localStorage', err);
  }
}

export function resetToSaifeeBurhani114Rooms(): Room[] {
  const rooms = deduplicateRooms([
    ...generateSaifeeBurhani114Rooms(),
    ...generateBadriRooms(),
  ]);
  saveRooms(rooms);
  return rooms;
}

const USER_ROLE_STORAGE_KEY = 'zaereen_user_role_v1';
const ADMIN_PIN_STORAGE_KEY = 'zaereen_admin_pin_v1';

export function getStoredUserRole(): UserRole {
  try {
    const val = localStorage.getItem(USER_ROLE_STORAGE_KEY);
    return val === 'admin' ? 'admin' : 'receptionist';
  } catch {
    return 'receptionist';
  }
}

export function saveStoredUserRole(role: UserRole): void {
  try {
    localStorage.setItem(USER_ROLE_STORAGE_KEY, role);
  } catch (err) {
    console.error('Failed to save user role', err);
  }
}

export function getStoredAdminPin(): string {
  try {
    return localStorage.getItem(ADMIN_PIN_STORAGE_KEY) || '1234';
  } catch {
    return '1234';
  }
}

export function saveStoredAdminPin(pin: string): void {
  try {
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, pin);
  } catch (err) {
    console.error('Failed to save admin pin', err);
  }
}
