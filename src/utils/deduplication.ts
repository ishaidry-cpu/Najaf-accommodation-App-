import { Reservation } from '../types';

/**
 * Normalizes an ITS ID string:
 * Removes apostrophes, quotes, spaces, and non-alphanumeric characters.
 */
export function normalizeItsId(val?: string | number | null): string {
  if (val === undefined || val === null) return '';
  return String(val)
    .trim()
    .replace(/^['"’‘]+|['"’‘]+$/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/**
 * Normalizes text strings for comparison (case-insensitive, trims whitespace and punctuation).
 */
export function normalizeText(val?: string | number | null): string {
  if (val === undefined || val === null) return '';
  return String(val)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Checks whether two reservations represent the same person/entry (a duplicate).
 * An ITS ID can return with a different tour. Compare the tour and stay before
 * matching the guest, and keep allocation changes on the same reservation.
 */
export function isDuplicateReservation(a: Reservation, b: Reservation): boolean {
  // 1. Direct ID match
  if (a.id && b.id && a.id === b.id) {
    return true;
  }

  const tourA = normalizeText(a.tourRefNo || a.tourId);
  const tourB = normalizeText(b.tourRefNo || b.tourId);
  if (tourA && tourB && tourA !== tourB) return false;
  if (a.arrivalDate && b.arrivalDate && a.arrivalDate !== b.arrivalDate) return false;

  const itsA = normalizeItsId(a.itsId);
  const itsB = normalizeItsId(b.itsId);
  const nameA = normalizeText(a.applicantName || a.guestLeaderName);
  const nameB = normalizeText(b.applicantName || b.guestLeaderName);
  if (itsA && itsB) return itsA === itsB && (!nameA || !nameB || nameA === nameB);
  if (tourA && tourB && nameA && nameA === nameB) return true;

  // 4. Request Slip Number match (for accounts/shifts)
  const slipA = normalizeText(a.requestSlipNo);
  const slipB = normalizeText(b.requestSlipNo);
  if (slipA && slipB && slipA === slipB) {
    return true;
  }

  // 5. Tour ID + Family + Name match
  const famA = normalizeText(a.family || a.familyNo);
  const famB = normalizeText(b.family || b.familyNo);
  if (tourA && tourB && famA && famB && nameA && nameB) {
    if (tourA === tourB && famA === famB && nameA === nameB) {
      return true;
    }
  }

  return false;
}

export interface AppendDeduplicationResult {
  /** The incoming reservations that are completely unique and not present in existing */
  uniqueToAppend: Reservation[];
  /** Count of existing records whose arrival/departure dates/times were updated from the incoming file */
  updatedExistingCount: number;
  /** Count of incoming items that were skipped or merged because they already exist in the database */
  skippedExistingDuplicatesCount: number;
  /** Count of duplicate items found within the incoming batch itself */
  skippedInternalDuplicatesCount: number;
  /** Total duplicates skipped (existing + internal) */
  totalDuplicatesSkipped: number;
  /** The final combined list (existing updated with new dates/times + uniqueToAppend) */
  finalReservations: Reservation[];
  /** Detailed list of skipped duplicate names and reasons for user visibility */
  duplicateDetails: Array<{ name: string; itsId: string; reason: string }>;
}

/**
 * Deduplicates an incoming batch of reservations against existing database records.
 * Ensures: "When append dont append duplicates only unique should be added"
 * AND: "Departure and arrival time should be same as in the excel uploaded file update".
 */
export function deduplicateForAppend(
  existingReservations: Reservation[],
  incomingReservations: Reservation[]
): AppendDeduplicationResult {
  const uniqueToAppend: Reservation[] = [];
  const duplicateDetails: Array<{ name: string; itsId: string; reason: string }> = [];

  let skippedInternalDuplicatesCount = 0;
  let skippedExistingDuplicatesCount = 0;
  let updatedExistingCount = 0;

  // Clone existing reservations so we can update their arrival/departure times if present in the upload
  const updatedExisting: Reservation[] = existingReservations.map((r) => ({ ...r }));

  // 1. Deduplicate within the incoming batch itself
  const deduplicatedIncoming: Reservation[] = [];
  for (const incoming of incomingReservations) {
    const isInternalDup = deduplicatedIncoming.some((item) =>
      isDuplicateReservation(item, incoming)
    );
    if (isInternalDup) {
      skippedInternalDuplicatesCount++;
      duplicateDetails.push({
        name: incoming.applicantName || 'Unknown',
        itsId: incoming.itsId || '',
        reason: 'Duplicate entry within the uploaded batch',
      });
    } else {
      deduplicatedIncoming.push(incoming);
    }
  }

  // 2. Check each incoming against the existing database records
  for (const incoming of deduplicatedIncoming) {
    const existingIndex = updatedExisting.findIndex((existing) =>
      isDuplicateReservation(existing, incoming)
    );

    if (existingIndex !== -1) {
      skippedExistingDuplicatesCount++;
      const existingMatch = updatedExisting[existingIndex];

      // Update arrival and departure times & dates from the uploaded update file
      const timesOrDatesChanged =
        (incoming.arrivalTime && incoming.arrivalTime !== existingMatch.arrivalTime) ||
        (incoming.departureTime && incoming.departureTime !== existingMatch.departureTime) ||
        (incoming.arrivalDate && incoming.arrivalDate !== existingMatch.arrivalDate) ||
        (incoming.departureDate && incoming.departureDate !== existingMatch.departureDate);

      if (timesOrDatesChanged) {
        updatedExistingCount++;
      }

      // Preserve existing room allotment, star badge, and B-to-A shift status while updating arrival/departure details
      updatedExisting[existingIndex] = {
        ...existingMatch,
        isSpecialGuest: incoming.isSpecialGuest !== undefined ? incoming.isSpecialGuest : existingMatch.isSpecialGuest,
        specialRemarks: incoming.specialRemarks || existingMatch.specialRemarks,
        arrivalDate: incoming.arrivalDate || existingMatch.arrivalDate,
        departureDate: incoming.departureDate || existingMatch.departureDate,
        arrivalTime: incoming.arrivalTime || existingMatch.arrivalTime,
        departureTime: incoming.departureTime || existingMatch.departureTime,
        rawArrivalStr: incoming.rawArrivalStr || existingMatch.rawArrivalStr,
        rawDepartureStr: incoming.rawDepartureStr || existingMatch.rawDepartureStr,
        officeName: incoming.officeName || existingMatch.officeName,
        tourRefNo: incoming.tourRefNo || existingMatch.tourRefNo,
        tourId: incoming.tourRefNo || existingMatch.tourId,
        groupLeadName: incoming.groupLeadName || existingMatch.groupLeadName,
        jamaat: incoming.jamaat || existingMatch.jamaat,
        age: incoming.age !== undefined ? incoming.age : existingMatch.age,
        gender: incoming.gender || existingMatch.gender,
        family: incoming.family || existingMatch.family,
        updatedAt: new Date().toISOString(),
      };

      const reason =
        normalizeItsId(existingMatch.itsId) === normalizeItsId(incoming.itsId) && incoming.itsId
          ? `Updated arrival/departure time for existing ITS ID: ${incoming.itsId}`
          : `Updated arrival/departure time for "${existingMatch.applicantName}" in Tour ${existingMatch.tourRefNo || ''}`;

      duplicateDetails.push({
        name: incoming.applicantName || 'Unknown',
        itsId: incoming.itsId || '',
        reason,
      });
    } else {
      uniqueToAppend.push(incoming);
    }
  }

  const totalDuplicatesSkipped =
    skippedInternalDuplicatesCount + skippedExistingDuplicatesCount;

  const finalReservations = [...updatedExisting, ...uniqueToAppend];

  return {
    uniqueToAppend,
    updatedExistingCount,
    skippedExistingDuplicatesCount,
    skippedInternalDuplicatesCount,
    totalDuplicatesSkipped,
    finalReservations,
    duplicateDetails,
  };
}

/**
 * Deduplicates any arbitrary list of reservations, keeping only unique records.
 * If duplicate records occur, merges special guest star badges, remarks, and allotments.
 */
export function deduplicateReservationList(reservations: Reservation[]): Reservation[] {
  const result: Reservation[] = [];
  for (const r of reservations) {
    const existingIndex = result.findIndex((existing) => isDuplicateReservation(existing, r));
    if (existingIndex === -1) {
      result.push(r);
    } else {
      const existing = result[existingIndex];
      result[existingIndex] = {
        ...existing,
        isSpecialGuest: existing.isSpecialGuest || r.isSpecialGuest,
        specialRemarks: existing.specialRemarks || r.specialRemarks,
        roomNumber: existing.roomNumber || r.roomNumber,
        building: existing.building || r.building,
        shiftToCategoryA: existing.shiftToCategoryA || r.shiftToCategoryA,
      };
    }
  }
  return result;
}
