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
 * A record is considered a duplicate if ANY of the following hold:
 * 1. Both have the same valid non-empty ITS ID.
 * 2. Both belong to the same Tour ID and have the exact same Applicant Name.
 * 3. Both have the exact same non-empty Request Slip Number.
 * 4. Both have the exact same internal record ID.
 * 5. Both have the same Tour ID, same Family, and same Applicant Name.
 */
export function isDuplicateReservation(a: Reservation, b: Reservation): boolean {
  // 1. Direct ID match
  if (a.id && b.id && a.id === b.id) {
    return true;
  }

  // 2. ITS ID match (ITS is the primary unique Dawoodi Bohra Mumineen identifier)
  const itsA = normalizeItsId(a.itsId);
  const itsB = normalizeItsId(b.itsId);
  if (itsA && itsB && itsA === itsB) {
    return true;
  }

  // 3. Tour Reference + Applicant Name match
  const tourA = normalizeText(a.tourRefNo || a.tourId);
  const tourB = normalizeText(b.tourRefNo || b.tourId);
  const nameA = normalizeText(a.applicantName || a.guestLeaderName);
  const nameB = normalizeText(b.applicantName || b.guestLeaderName);

  if (tourA && tourB && nameA && nameB && tourA === tourB && nameA === nameB) {
    return true;
  }

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
  /** Count of incoming items that were skipped because they already exist in the database */
  skippedExistingDuplicatesCount: number;
  /** Count of duplicate items found within the incoming batch itself */
  skippedInternalDuplicatesCount: number;
  /** Total duplicates skipped (existing + internal) */
  totalDuplicatesSkipped: number;
  /** The final combined list (existing + uniqueToAppend) */
  finalReservations: Reservation[];
  /** Detailed list of skipped duplicate names and reasons for user visibility */
  duplicateDetails: Array<{ name: string; itsId: string; reason: string }>;
}

/**
 * Deduplicates an incoming batch of reservations against existing database records.
 * Ensures: "When append dont append duplicates only unique should be added".
 */
export function deduplicateForAppend(
  existingReservations: Reservation[],
  incomingReservations: Reservation[]
): AppendDeduplicationResult {
  const uniqueToAppend: Reservation[] = [];
  const duplicateDetails: Array<{ name: string; itsId: string; reason: string }> = [];

  let skippedInternalDuplicatesCount = 0;
  let skippedExistingDuplicatesCount = 0;

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
    const existingMatch = existingReservations.find((existing) =>
      isDuplicateReservation(existing, incoming)
    );

    if (existingMatch) {
      skippedExistingDuplicatesCount++;
      const reason =
        normalizeItsId(existingMatch.itsId) === normalizeItsId(incoming.itsId) && incoming.itsId
          ? `Matches existing ITS ID: ${incoming.itsId}`
          : `Matches existing zaer "${existingMatch.applicantName}" in Tour ${existingMatch.tourRefNo || ''}`;

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

  const finalReservations = [...existingReservations, ...uniqueToAppend];

  return {
    uniqueToAppend,
    skippedExistingDuplicatesCount,
    skippedInternalDuplicatesCount,
    totalDuplicatesSkipped,
    finalReservations,
    duplicateDetails,
  };
}

/**
 * Deduplicates any arbitrary list of reservations, keeping only unique records.
 */
export function deduplicateReservationList(reservations: Reservation[]): Reservation[] {
  const result: Reservation[] = [];
  for (const r of reservations) {
    if (!result.some((existing) => isDuplicateReservation(existing, r))) {
      result.push(r);
    }
  }
  return result;
}
