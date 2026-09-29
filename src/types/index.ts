export type RoomCategory = 'Category A (Nizaam)' | 'Category B (Standard)' | 'B to A' | 'Executive Suite';

export type AccommodationCategory = 'Category B (Standard)' | 'Category A (Nizaam)';

export type RoomStatus = 'available' | 'occupied' | 'blocked' | 'cleaning';

export type MoneyGivenStatus = 'Yes' | 'No';

export type PaymentStatus = 'Paid' | 'Pending';

export const DEFAULT_ZAEREEN_CATEGORIES = [
  'Mumineen',
  'Muntasbeen',
  'Qasreali',
  'Baitezainy',
];

export type UserRole = 'admin' | 'receptionist';

export interface UserRoleSettings {
  role: UserRole;
  adminPin: string; // PIN required to switch from receptionist back to admin
  allowReceptionistPrinting: boolean;
}

export interface RoomOccupancyDetail {
  room: Room;
  currentOccupancy: number;
  baseCapacity: number;
  bufferCapacity: number;
  maxCapacity: number;
  remainingSlots: number;
  isFull: boolean;
  isBufferUtilized: boolean;
  occupants: Reservation[];
}

export interface RoomAllotmentCheck {
  allowed: boolean;
  reason?: string;
  room?: Room;
  maxCapacity: number;
  currentOccupancy: number;
  remainingSlots: number;
  occupants: Reservation[];
}

export interface Room {
  id: string;
  roomNumber: string;
  building: string; // 'Burhani' or 'Saifee' (also matches 'BURHANI' / 'SAIFEE')
  floor: number;
  floorLabel?: string; // e.g. 'Ground', 'Mezzanine', 'Floor 1'
  capacity: number; // Pax
  pax?: number;
  buffer?: number; // Buffer count
  toiletType?: string; // 'WESTERN' | 'INDIAN' | 'Both WESTERN & INDIAN'
  bedType?: string; // 'Single Beds' | 'Double Bed' | 'Both Single Bed & double Bed'
  category: RoomCategory;
  status: RoomStatus;
  blockedReason?: string;
  blockedSince?: string;
  expectedUnblockDate?: string;
  amenities: string[];
  notes?: string;
}

export interface ZaereenGuest {
  id: string;
  fullName: string;
  passportOrId: string;
  phone: string;
  gender: 'Male' | 'Female';
  nationality: string;
  isLeader?: boolean;
}

export interface Reservation {
  id: string;
  // Specific sequence from Excel sheet:
  itsId: string;            // ITS Id (e.g. '30318214')
  applicantName: string;    // Applicant Name (e.g. 'Nafisa Abbas Fatehi')
  age: number | string;     // Age (e.g. 65)
  jamaat?: string;          // Jamaat (e.g. 'HATEMI MOHALLA (MUMBAI)')
  rotationId?: string;      // Rotation Id
  category: string;         // Pilgrim Category: 'Mumineen', 'Muntasbeen', 'Qasreali', 'Baitezainy'
  gender: 'Male' | 'Female' | string; // Gender
  family: string;           // Family (e.g. 'F-1')
  idara: string;            // Idara
  hofId?: string;           // HOF_ID (e.g. '20304504')
  groupAdmin?: string;      // GroupAdmin
  groupId?: string;         // GROUP_ID (e.g. '1766839506')
  tourRefNo: string;        // Tour Reference No. (e.g. 'NKERP/TOUR/2026/1333')
  officeName: string;       // Office Name (e.g. 'Fayz E Husayni Trust Mumbai')
  groupLeadName: string;    // Group Lead Name (e.g. 'Husain Shaikh Asgar Arsiwala')
  arrivalDate: string;      // Arrival Date (YYYY-MM-DD or formatted)
  departureDate: string;    // Departure Date (YYYY-MM-DD or formatted)
  rawArrivalStr?: string;   // Original raw arrival text (e.g. '01-10-2026 11:00 AM')
  rawDepartureStr?: string; // Original raw departure text (e.g. '06-10-2026 01:00 AM')

  // Accommodation B to A Shift (Named Accommodation Category / B to A shift):
  shiftToCategoryA?: boolean;      // True if shifted from B to A (Nizaam)
  accommodationCategory?: AccommodationCategory; // 'Category B (Standard)' or 'Category A (Nizaam)'
  requestSlipNo?: string;          // Request slip generated for Accounts department
  requestSlipDate?: string;

  // Money Given: ONLY opens / editable for B to A accommodation shift!
  moneyGiven: MoneyGivenStatus;    // 'Yes' | 'No'
  moneyGivenDate?: string;
  moneyNotes?: string;

  // Building & Room Allotment:
  building: string;         // 'Saifee' or 'Burhani'
  roomNumber: string;       // e.g. '101'
  roomId?: string;

  // Tick button in the end to note if room allocation is uploaded on main portal:
  isUploadedToPortal: boolean; // true = uploaded / ticked, false = pending

  // Backwards compatibility helpers:
  familyNumber?: string;    // synced with family
  familyNo?: string;        // synced with family
  tourId?: string;          // synced with tourRefNo
  tourName?: string;
  paxCount?: number;        // guest count (defaults to 1 or family size)
  pax?: number;             // synced with paxCount
  totalGuests?: number;     // synced with paxCount
  arrivalDateTime?: string; // synced with arrivalDate
  departureDateTime?: string; // synced with departureDate
  entryPort?: string;       // optional legacy
  exitPort?: string;        // optional legacy
  guestLeaderName?: string; // synced with groupLeadName or applicantName
  guestContact?: string;
  zaereenGuests?: ZaereenGuest[];
  isUpgradedFromBToA?: boolean; // synced with shiftToCategoryA
  upgradeReason?: string;
  upgradeApprovalBy?: string;
  specialRequests?: string;
  paymentHistory?: any[];
  assignedCategory?: RoomCategory;
  baseCost?: number;
  upgradeFee?: number;
  totalCost?: number;
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus?: PaymentStatus;

  createdAt: string;
  updatedAt: string;
}

export interface GoogleSheetsConfig {
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
  spreadsheetName: string;
  lastSyncedAt: string | null;
  autoSync: boolean;
  isSyncing: boolean;
  syncError: string | null;
  customCategories?: string[]; // Categories fetched from Google Sheets or configured
}
