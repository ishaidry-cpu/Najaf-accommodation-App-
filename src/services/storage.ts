import { Room, Reservation, GoogleSheetsConfig, DEFAULT_ZAEREEN_CATEGORIES, UserRole, RoomOccupancyDetail, RoomAllotmentCheck } from '../types';

const ROOMS_STORAGE_KEY = 'zaereen_accommodation_rooms_saifee_burhani_v6';
const RESERVATIONS_STORAGE_KEY = 'zaereen_accommodation_reservations_saifee_burhani_v7';
const SHEETS_CONFIG_KEY = 'zaereen_accommodation_sheets_config_saifee_burhani_v5';
const CATEGORIES_STORAGE_KEY = 'zaereen_accommodation_categories_v1';

export const INITIAL_BUILDINGS = ['Burhani', 'Saifee'];

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

export const INITIAL_ROOMS: Room[] = generateSaifeeBurhani114Rooms();

/**
 * Initial Zaereen matching user's exact work process fields and user's Excel sheet screenshot:
 * ITS Id | Applicant Name | Age | Jamaat | Rotation Id | Category | Gender | Family | Idara | HOF_ID | GroupAdmin | GROUP_ID | Tour Reference No. | Office Name | Group Lead Name | Arrival Date | Departure Date
 */
export const INITIAL_RESERVATIONS: Reservation[] = [
  {
    id: 'res-sb-101',
    itsId: '30318214',
    applicantName: 'Nafisa Abbas Fatehi',
    age: 65,
    jamaat: 'HATEMI MOHALLA (MUMBAI)',
    rotationId: '',
    category: 'Mumineen',
    gender: 'Female',
    family: 'F-1',
    idara: 'Fayz E Husayni Trust Mumbai',
    hofId: '20304504',
    groupAdmin: '',
    groupId: '1766839506',
    tourRefNo: 'NKERP/TOUR/2026/1333',
    officeName: 'Fayz E Husayni Trust Mumbai',
    groupLeadName: 'Husain Shaikh Asgar Arsiwala',
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-06',
    rawArrivalStr: "'01-10-2026 11:00 AM",
    rawDepartureStr: "'06-10-2026 01:00 AM",
    // Accommodation shift
    shiftToCategoryA: true,
    accommodationCategory: 'Category A (Nizaam)',
    requestSlipNo: 'SLIP-F1-1333',
    requestSlipDate: '2026-09-28',
    moneyGiven: 'Yes',
    building: 'Saifee',
    roomNumber: '101',
    isUploadedToPortal: true,
    // helpers
    familyNumber: 'F-1',
    familyNo: 'F-1',
    tourId: 'NKERP/TOUR/2026/1333',
    paxCount: 3,
    pax: 3,
    totalGuests: 3,
    arrivalDateTime: '2026-10-01T11:00',
    departureDateTime: '2026-10-06T01:00',
    guestLeaderName: 'Husain Shaikh Asgar Arsiwala',
    isUpgradedFromBToA: true,
    assignedCategory: 'Category A (Nizaam)',
    createdAt: '2026-09-28T08:00:00Z',
    updatedAt: '2026-09-28T08:00:00Z',
  },
  {
    id: 'res-sb-102',
    itsId: '30423690',
    applicantName: 'Munira Mustafa Vohra',
    age: 47,
    jamaat: 'VALSAD (BALSAR)',
    rotationId: '',
    category: 'Mumineen',
    gender: 'Female',
    family: 'F-2',
    idara: 'Fayz E Husayni Trust Mumbai',
    hofId: '30423689',
    groupAdmin: '',
    groupId: '1766839507',
    tourRefNo: 'NKERP/TOUR/2026/1333',
    officeName: 'Fayz E Husayni Trust Mumbai',
    groupLeadName: 'Husain Shaikh Asgar Arsiwala',
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-06',
    rawArrivalStr: "'01-10-2026 11:00 AM",
    rawDepartureStr: "'06-10-2026 01:00 AM",
    shiftToCategoryA: false,
    accommodationCategory: 'Category B (Standard)',
    moneyGiven: 'No',
    building: 'Saifee',
    roomNumber: '102',
    isUploadedToPortal: true,
    familyNumber: 'F-2',
    familyNo: 'F-2',
    tourId: 'NKERP/TOUR/2026/1333',
    paxCount: 2,
    pax: 2,
    totalGuests: 2,
    arrivalDateTime: '2026-10-01T11:00',
    departureDateTime: '2026-10-06T01:00',
    guestLeaderName: 'Husain Shaikh Asgar Arsiwala',
    isUpgradedFromBToA: false,
    assignedCategory: 'Category B (Standard)',
    createdAt: '2026-09-28T08:05:00Z',
    updatedAt: '2026-09-28T08:05:00Z',
  },
  {
    id: 'res-sb-103',
    itsId: '20304504',
    applicantName: 'Husain Shaikh Asgar Arsiwala',
    age: 52,
    jamaat: 'HATEMI MOHALLA (MUMBAI)',
    rotationId: '',
    category: 'Muntasbeen',
    gender: 'Male',
    family: 'F-1',
    idara: 'Fayz E Husayni Trust Mumbai',
    hofId: '20304504',
    groupAdmin: 'Yes',
    groupId: '1766839506',
    tourRefNo: 'NKERP/TOUR/2026/1333',
    officeName: 'Fayz E Husayni Trust Mumbai',
    groupLeadName: 'Husain Shaikh Asgar Arsiwala',
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-06',
    rawArrivalStr: "'01-10-2026 11:00 AM",
    rawDepartureStr: "'06-10-2026 01:00 AM",
    shiftToCategoryA: true,
    accommodationCategory: 'Category A (Nizaam)',
    requestSlipNo: 'SLIP-F1-1333',
    requestSlipDate: '2026-09-28',
    moneyGiven: 'Yes',
    building: 'Saifee',
    roomNumber: '101',
    isUploadedToPortal: true,
    familyNumber: 'F-1',
    familyNo: 'F-1',
    tourId: 'NKERP/TOUR/2026/1333',
    paxCount: 3,
    pax: 3,
    totalGuests: 3,
    arrivalDateTime: '2026-10-01T11:00',
    departureDateTime: '2026-10-06T01:00',
    guestLeaderName: 'Husain Shaikh Asgar Arsiwala',
    isUpgradedFromBToA: true,
    assignedCategory: 'Category A (Nizaam)',
    createdAt: '2026-09-28T08:10:00Z',
    updatedAt: '2026-09-28T08:10:00Z',
  },
  {
    id: 'res-sb-104',
    itsId: '40912301',
    applicantName: 'Mustafa Bhai Ebrahim',
    age: 47,
    jamaat: 'DUBAI (UAE)',
    category: 'Qasreali',
    idara: 'Faiz-e-Husaini',
    gender: 'Male',
    family: 'F-3',
    tourRefNo: 'NKERP/TOUR/2026/1334',
    officeName: 'Dubai Jamaat Office',
    groupLeadName: 'Mustafa Bhai Ebrahim',
    arrivalDate: '2026-10-02',
    departureDate: '2026-10-08',
    rawArrivalStr: "'02-10-2026 02:00 PM",
    rawDepartureStr: "'08-10-2026 10:00 AM",
    shiftToCategoryA: true,
    accommodationCategory: 'Category A (Nizaam)',
    requestSlipNo: 'SLIP-F3-9821',
    requestSlipDate: '2026-09-28',
    moneyGiven: 'No', // Request slip generated, accounts taking money
    building: 'Burhani',
    roomNumber: '101',
    isUploadedToPortal: false,
    familyNumber: 'F-3',
    familyNo: 'F-3',
    tourId: 'NKERP/TOUR/2026/1334',
    paxCount: 4,
    pax: 4,
    totalGuests: 4,
    arrivalDateTime: '2026-10-02T14:00',
    departureDateTime: '2026-10-08T10:00',
    guestLeaderName: 'Mustafa Bhai Ebrahim',
    isUpgradedFromBToA: true,
    assignedCategory: 'Category A (Nizaam)',
    createdAt: '2026-09-28T08:15:00Z',
    updatedAt: '2026-09-28T08:15:00Z',
  },
  {
    id: 'res-sb-105',
    itsId: '60124982',
    applicantName: 'Taher Bhai Hakimuddin',
    age: 34,
    jamaat: 'NAIROBI (KENYA)',
    category: 'Baitezainy',
    idara: 'Faiz-e-Husaini',
    gender: 'Male',
    family: 'F-4',
    tourRefNo: 'NKERP/TOUR/2026/1335',
    officeName: 'Nairobi Office',
    groupLeadName: 'Taher Bhai Hakimuddin',
    arrivalDate: '2026-10-03',
    departureDate: '2026-10-09',
    arrivalTime: '12:00 PM',
    departureTime: '08:00 AM',
    rawArrivalStr: "'03-10-2026 12:00 PM",
    rawDepartureStr: "'09-10-2026 08:00 AM",
    shiftToCategoryA: false,
    accommodationCategory: 'Category B (Standard)',
    moneyGiven: 'No',
    building: 'Burhani',
    roomNumber: '102',
    isUploadedToPortal: false,
    familyNumber: 'F-4',
    familyNo: 'F-4',
    tourId: 'NKERP/TOUR/2026/1335',
    paxCount: 2,
    pax: 2,
    totalGuests: 2,
    arrivalDateTime: '2026-10-03T12:00',
    departureDateTime: '2026-10-09T08:00',
    guestLeaderName: 'Taher Bhai Hakimuddin',
    isUpgradedFromBToA: false,
    assignedCategory: 'Category B (Standard)',
    createdAt: '2026-09-28T08:20:00Z',
    updatedAt: '2026-09-28T08:20:00Z',
  },
  // Operational Turnovers & Activity on 2026-10-02 (Priority Turnovers, Checkouts & Arrivals)
  {
    id: 'res-sb-106',
    itsId: '20456102',
    applicantName: 'Sakina Ben Murtaza',
    age: 58,
    jamaat: 'HATEMI MOHALLA (MUMBAI)',
    category: 'Mumineen',
    idara: 'Faiz-e-Husaini',
    moneyGiven: 'No',
    gender: 'Female',
    family: 'F-7',
    tourRefNo: 'NKERP/TOUR/2026/1330',
    officeName: 'Fayz E Husayni Trust Mumbai',
    groupLeadName: 'Murtaza Bhai Kalimuddin',
    arrivalDate: '2026-09-27',
    departureDate: '2026-10-02',
    arrivalTime: '02:00 PM',
    departureTime: '09:30 AM',
    rawArrivalStr: "'27-09-2026 02:00 PM",
    rawDepartureStr: "'02-10-2026 09:30 AM",
    building: 'Saifee',
    roomNumber: '101',
    isUploadedToPortal: true,
    familyNumber: 'F-7',
    familyNo: 'F-7',
    tourId: 'NKERP/TOUR/2026/1330',
    paxCount: 2,
    pax: 2,
    totalGuests: 2,
    arrivalDateTime: '2026-09-27T14:00',
    departureDateTime: '2026-10-02T09:30',
    createdAt: '2026-09-25T08:00:00Z',
    updatedAt: '2026-09-25T08:00:00Z',
  },
  {
    id: 'res-sb-107',
    itsId: '30891234',
    applicantName: 'Zahra Ben Shabbir',
    age: 42,
    jamaat: 'DUBAI (UAE)',
    category: 'Mumineen',
    idara: 'Faiz-e-Husaini',
    moneyGiven: 'No',
    gender: 'Female',
    family: 'F-8',
    tourRefNo: 'NKERP/TOUR/2026/1334',
    officeName: 'Dubai Jamaat Office',
    groupLeadName: 'Mustafa Bhai Ebrahim',
    arrivalDate: '2026-10-02',
    departureDate: '2026-10-07',
    arrivalTime: '11:30 AM',
    departureTime: '01:00 PM',
    rawArrivalStr: "'02-10-2026 11:30 AM",
    rawDepartureStr: "'07-10-2026 01:00 PM",
    building: 'Saifee',
    roomNumber: '101',
    isUploadedToPortal: true,
    familyNumber: 'F-8',
    familyNo: 'F-8',
    tourId: 'NKERP/TOUR/2026/1334',
    paxCount: 2,
    pax: 2,
    totalGuests: 2,
    arrivalDateTime: '2026-10-02T11:30',
    departureDateTime: '2026-10-07T13:00',
    createdAt: '2026-09-28T09:00:00Z',
    updatedAt: '2026-09-28T09:00:00Z',
  },
  {
    id: 'res-sb-108',
    itsId: '50123984',
    applicantName: 'Idris Bhai Saifuddin',
    age: 61,
    jamaat: 'SADDAR (KARACHI)',
    category: 'Mumineen',
    idara: 'Faiz-e-Husaini',
    moneyGiven: 'No',
    gender: 'Male',
    family: 'F-9',
    tourRefNo: 'NKERP/TOUR/2026/1331',
    officeName: 'Karachi Central Office',
    groupLeadName: 'Idris Bhai Saifuddin',
    arrivalDate: '2026-09-26',
    departureDate: '2026-10-02',
    arrivalTime: '10:00 AM',
    departureTime: '10:00 AM',
    rawArrivalStr: "'26-09-2026 10:00 AM",
    rawDepartureStr: "'02-10-2026 10:00 AM",
    building: 'Burhani',
    roomNumber: '201',
    isUploadedToPortal: true,
    familyNumber: 'F-9',
    familyNo: 'F-9',
    tourId: 'NKERP/TOUR/2026/1331',
    paxCount: 2,
    pax: 2,
    totalGuests: 2,
    arrivalDateTime: '2026-09-26T10:00',
    departureDateTime: '2026-10-02T10:00',
    createdAt: '2026-09-24T08:00:00Z',
    updatedAt: '2026-09-24T08:00:00Z',
  },
  {
    id: 'res-sb-109',
    itsId: '70234561',
    applicantName: 'Fatema Ben Moiz',
    age: 39,
    jamaat: 'KUWAIT',
    category: 'Mumineen',
    idara: 'Faiz-e-Husaini',
    moneyGiven: 'No',
    gender: 'Female',
    family: 'F-10',
    tourRefNo: 'NKERP/TOUR/2026/1336',
    officeName: 'Kuwait Office',
    groupLeadName: 'Moiz Bhai Shujauddin',
    arrivalDate: '2026-10-02',
    departureDate: '2026-10-08',
    arrivalTime: '01:15 PM',
    departureTime: '11:00 AM',
    rawArrivalStr: "'02-10-2026 01:15 PM",
    rawDepartureStr: "'08-10-2026 11:00 AM",
    building: 'Burhani',
    roomNumber: '201',
    isUploadedToPortal: false,
    familyNumber: 'F-10',
    familyNo: 'F-10',
    tourId: 'NKERP/TOUR/2026/1336',
    paxCount: 2,
    pax: 2,
    totalGuests: 2,
    arrivalDateTime: '2026-10-02T13:15',
    departureDateTime: '2026-10-08T11:00',
    createdAt: '2026-09-29T10:00:00Z',
    updatedAt: '2026-09-29T10:00:00Z',
  },
  {
    id: 'res-sb-110',
    itsId: '60192837',
    applicantName: 'Yusuf Bhai Taherali',
    age: 49,
    jamaat: 'HATEMI MOHALLA (MUMBAI)',
    category: 'Mumineen',
    idara: 'Faiz-e-Husaini',
    moneyGiven: 'No',
    gender: 'Male',
    family: 'F-5',
    tourRefNo: 'NKERP/TOUR/2026/1332',
    officeName: 'Fayz E Husayni Trust Mumbai',
    groupLeadName: 'Yusuf Bhai Taherali',
    arrivalDate: '2026-09-25',
    departureDate: '2026-10-02',
    arrivalTime: '03:00 PM',
    departureTime: '11:00 AM',
    rawArrivalStr: "'25-09-2026 03:00 PM",
    rawDepartureStr: "'02-10-2026 11:00 AM",
    building: 'Burhani',
    roomNumber: '301',
    isUploadedToPortal: true,
    familyNumber: 'F-5',
    familyNo: 'F-5',
    tourId: 'NKERP/TOUR/2026/1332',
    paxCount: 3,
    pax: 3,
    totalGuests: 3,
    arrivalDateTime: '2026-09-25T15:00',
    departureDateTime: '2026-10-02T11:00',
    createdAt: '2026-09-23T08:00:00Z',
    updatedAt: '2026-09-23T08:00:00Z',
  },
  {
    id: 'res-sb-111',
    itsId: '80345612',
    applicantName: 'Batul Ben Burhanuddin',
    age: 31,
    jamaat: 'DUBAI (UAE)',
    category: 'Mumineen',
    idara: 'Faiz-e-Husaini',
    moneyGiven: 'No',
    gender: 'Female',
    family: 'F-11',
    tourRefNo: 'NKERP/TOUR/2026/1334',
    officeName: 'Dubai Jamaat Office',
    groupLeadName: 'Mustafa Bhai Ebrahim',
    arrivalDate: '2026-10-02',
    departureDate: '2026-10-07',
    arrivalTime: '04:00 PM',
    departureTime: '09:00 AM',
    rawArrivalStr: "'02-10-2026 04:00 PM",
    rawDepartureStr: "'07-10-2026 09:00 AM",
    building: '',
    roomNumber: '',
    isUploadedToPortal: false,
    familyNumber: 'F-11',
    familyNo: 'F-11',
    tourId: 'NKERP/TOUR/2026/1334',
    paxCount: 2,
    pax: 2,
    totalGuests: 2,
    arrivalDateTime: '2026-10-02T16:00',
    departureDateTime: '2026-10-07T09:00',
    createdAt: '2026-09-29T11:00:00Z',
    updatedAt: '2026-09-29T11:00:00Z',
  },
];

export const INITIAL_SHEETS_CONFIG: GoogleSheetsConfig = {
  spreadsheetId: null,
  spreadsheetUrl: null,
  spreadsheetName: 'Faiz Husaini Zaereen Accommodation (Saifee & Burhani)',
  lastSyncedAt: null,
  autoSync: false,
  isSyncing: false,
  syncError: null,
  customCategories: DEFAULT_ZAEREEN_CATEGORIES,
};

// ========================
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
  const a1 = arr1.slice(0, 10);
  const d1 = dep1.slice(0, 10);
  const a2 = arr2.slice(0, 10);
  const d2 = dep2.slice(0, 10);

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
  const currentOccupancy = occupants.reduce((sum, r) => sum + (r.pax || r.paxCount || 1), 0);
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
  const currentOccupancy = occupants.reduce((sum, r) => sum + (r.pax || r.paxCount || 1), 0);
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
  const bNorm = building.trim().toLowerCase();
  const rNorm = roomNumber.trim().toLowerCase();

  return reservations.filter((res) => {
    if (excludeReservationId && res.id === excludeReservationId) return false;
    const resB = (res.building || '').trim().toLowerCase();
    const resR = (res.roomNumber || '').trim().toLowerCase();
    if (resB !== bNorm || resR !== rNorm) return false;
    return doDatesOverlap(res.arrivalDate, res.departureDate, arrivalDate, departureDate);
  });
}

/**
 * Checks whether a room can accommodate an additional guest/reservation
 * up to max capacity with buffer included.
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
  forceAllocate: boolean = false
): RoomAllotmentCheck {
  const bNorm = (building || '').trim().toLowerCase();
  const rNorm = (roomNumber || '').trim().toLowerCase();
  
  const targetRoom = rooms.find(
    (r) => (r.building || '').trim().toLowerCase() === bNorm && (r.roomNumber || '').trim().toLowerCase() === rNorm
  );

  if (!targetRoom) {
    return {
      allowed: false,
      reason: `Room ${roomNumber} in ${building} Hotel was not found.`,
      maxCapacity: 0,
      currentOccupancy: 0,
      remainingSlots: 0,
      occupants: [],
    };
  }

  if (targetRoom.status === 'blocked' && !forceAllocate) {
    return {
      allowed: false,
      reason: `Room ${roomNumber} is currently blocked: ${targetRoom.blockedReason || 'Maintenance hold'}.`,
      room: targetRoom,
      maxCapacity: getRoomMaxCapacity(targetRoom),
      currentOccupancy: 0,
      remainingSlots: 0,
      occupants: [],
    };
  }

  const baseCapacity = targetRoom.capacity || targetRoom.pax || 2;
  const bufferCapacity = targetRoom.buffer || 0;
  const maxCapacity = baseCapacity + bufferCapacity;

  const overlappingReservations = getRoomBookingsForDuration(
    building,
    roomNumber,
    arrivalDate,
    departureDate,
    reservations,
    excludeReservationId
  );

  const currentOccupancy = overlappingReservations.reduce((sum, r) => sum + (r.pax || r.paxCount || 1), 0);
  const remainingSlots = Math.max(0, maxCapacity - currentOccupancy);

  if (currentOccupancy + requestedPax > maxCapacity) {
    const occupantNames = overlappingReservations.map((r) => `${r.applicantName} (${r.family})`).join(', ');
    if (forceAllocate) {
      return {
        allowed: true,
        reason: `Force Allocated (Quota/Capacity Overridden): ${currentOccupancy + requestedPax}/${maxCapacity} Pax.`,
        room: targetRoom,
        maxCapacity,
        currentOccupancy,
        remainingSlots: 0,
        occupants: overlappingReservations,
      };
    }
    return {
      allowed: false,
      reason: `Room ${roomNumber} (${building}) max capacity with buffer reached (${currentOccupancy}/${maxCapacity} Pax). Base: ${baseCapacity}, Buffer: ${bufferCapacity}. Already booked by: ${occupantNames || 'Other guests'}. Allotting ${requestedPax} more guest(s) exceeds quota.`,
      room: targetRoom,
      maxCapacity,
      currentOccupancy,
      remainingSlots,
      occupants: overlappingReservations,
    };
  }

  return {
    allowed: true,
    room: targetRoom,
    maxCapacity,
    currentOccupancy,
    remainingSlots,
    occupants: overlappingReservations,
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
  requestedPax: number = 1
): Reservation | undefined {
  if (!building || !roomNumber || !arrivalDate || !departureDate) return undefined;
  
  // If rooms list is provided or accessible from storage
  const allRooms = rooms || getStoredRooms();
  const check = checkRoomAllotmentAvailability(
    building,
    roomNumber,
    arrivalDate,
    departureDate,
    allRooms,
    reservations,
    requestedPax,
    excludeReservationId
  );

  if (!check.allowed && check.occupants.length > 0) {
    return check.occupants[0];
  }
  return undefined;
}

/**
 * Returns all rooms in a building that have remaining capacity (including buffer) for the entire duration.
 */
export function getVacantRoomsForDuration(
  building: string,
  arrivalDate: string,
  departureDate: string,
  rooms: Room[],
  reservations: Reservation[],
  excludeReservationId?: string,
  requestedPax: number = 1
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
      excludeReservationId
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
    return parsed;
  } catch {
    return INITIAL_ROOMS;
  }
}

export function saveRooms(rooms: Room[]): void {
  try {
    localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms));
  } catch (err) {
    console.error('Failed to save rooms to localStorage', err);
  }
}

export function resetToSaifeeBurhani114Rooms(): Room[] {
  const rooms = generateSaifeeBurhani114Rooms();
  saveRooms(rooms);
  return rooms;
}

export function getStoredReservations(): Reservation[] {
  try {
    const raw = localStorage.getItem(RESERVATIONS_STORAGE_KEY);
    if (!raw) {
      saveReservations(INITIAL_RESERVATIONS);
      return INITIAL_RESERVATIONS;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      saveReservations(INITIAL_RESERVATIONS);
      return INITIAL_RESERVATIONS;
    }
    return parsed.map((item: any) => ({
      ...item,
      itsId: item.itsId || `30${Math.floor(100000 + Math.random() * 900000)}`,
      applicantName: item.applicantName || item.guestLeaderName || 'Zaer Guest',
      age: item.age || 38,
      category: item.category || 'Mumineen',
      jamaat: item.jamaat || '',
      idara: item.idara || 'Faiz-e-Husaini',
      gender: item.gender || 'Male',
      family: item.family || item.familyNumber || 'F-1',
      tourRefNo: item.tourRefNo || item.tourId || 'NKERP/TOUR/2026/1333',
      officeName: item.officeName || 'Fayz E Husayni Trust Mumbai',
      groupLeadName: item.groupLeadName || item.guestLeaderName || item.applicantName || 'Group Lead',
      arrivalDate: item.arrivalDate || (item.arrivalDateTime ? item.arrivalDateTime.slice(0, 10) : '2026-10-01'),
      departureDate: item.departureDate || (item.departureDateTime ? item.departureDateTime.slice(0, 10) : '2026-10-06'),
      shiftToCategoryA: item.shiftToCategoryA ?? false,
      accommodationCategory: item.accommodationCategory || (item.shiftToCategoryA ? 'Category A (Nizaam)' : 'Category B (Standard)'),
      moneyGiven: item.moneyGiven || 'No',
      building: item.building || 'Saifee',
      roomNumber: item.roomNumber || '',
      isUploadedToPortal: item.isUploadedToPortal ?? false,
    }));
  } catch {
    return INITIAL_RESERVATIONS;
  }
}

export function saveReservations(reservations: Reservation[]): void {
  try {
    localStorage.setItem(RESERVATIONS_STORAGE_KEY, JSON.stringify(reservations));
  } catch (err) {
    console.error('Failed to save reservations to localStorage', err);
  }
}

export function getStoredSheetsConfig(): GoogleSheetsConfig {
  try {
    const raw = localStorage.getItem(SHEETS_CONFIG_KEY);
    if (!raw) {
      saveSheetsConfig(INITIAL_SHEETS_CONFIG);
      return INITIAL_SHEETS_CONFIG;
    }
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      customCategories: parsed.customCategories || DEFAULT_ZAEREEN_CATEGORIES,
    };
  } catch {
    return INITIAL_SHEETS_CONFIG;
  }
}

export function saveSheetsConfig(config: GoogleSheetsConfig): void {
  try {
    localStorage.setItem(SHEETS_CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save Google Sheets config', err);
  }
}

const USER_ROLE_STORAGE_KEY = 'zaereen_user_role_v1';
const ADMIN_PIN_STORAGE_KEY = 'zaereen_admin_pin_v1';

export function getStoredUserRole(): UserRole {
  try {
    const val = localStorage.getItem(USER_ROLE_STORAGE_KEY);
    return val === 'receptionist' ? 'receptionist' : 'admin';
  } catch {
    return 'admin';
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

