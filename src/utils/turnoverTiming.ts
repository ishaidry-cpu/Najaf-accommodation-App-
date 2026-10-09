/**
 * Turnover timing utilities and conflict checks for Faiz Husaini hotel operations.
 * 
 * Rules:
 * 1. When departure and arrival are on the same date and departure time is later than
 *    arrival time, issue a notification and give an option to force allocate after warning.
 * 2. When departure time is later than arrival time by MORE THAN 15 HOURS,
 *    force allocation is strictly NOT allowed!
 */

/**
 * Standardizes any time input (string, number, Date) to minutes from midnight (0..1439).
 */
export function parseTimeToMinutes(val: any, defaultMinutes: number = 720): number {
  if (val === undefined || val === null || val === '') return defaultMinutes;

  if (typeof val === 'number') {
    // If it's an Excel time fraction between 0 and 1 (e.g. 0.5 = 12:00 PM)
    if (val >= 0 && val < 1) {
      return Math.round(val * 1440) % 1440;
    }
    // If it's already minute count or serial
    if (val >= 1 && val < 1440) return Math.round(val);
  }

  if (val instanceof Date) {
    return val.getHours() * 60 + val.getMinutes();
  }

  const str = String(val).trim().replace(/^['"’‘\s]+|['"’‘\s]+$/g, '');
  if (!str) return defaultMinutes;

  // 12-hour format: "11:00 AM", "01:30 pm", "1:15pm"
  const match12 = str.match(/(\d{1,2})[:.](\d{2})\s*(AM|PM|am|pm)/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const isPM = match12[3].toUpperCase() === 'PM';
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // 24-hour format: "14:30", "01:00", "23:45", or within ISO "2026-10-01T14:30"
  const match24 = str.match(/(?:^|\s|T)(\d{1,2})[:.](\d{2})(?::\d{2})?(?:\s|$)/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return hours * 60 + minutes;
    }
  }

  return defaultMinutes;
}

/**
 * Formats minutes from midnight into 12-hour format (e.g. "11:00 AM", "02:30 PM").
 */
export function formatMinutesToTime12(totalMinutes: number): string {
  const norm = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  let hours = Math.floor(norm / 60);
  const minutes = norm % 60;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  if (hours > 12) hours -= 12;
  if (hours === 0) hours = 12;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

/**
 * Extracts a clean 12-hour formatted time string from candidates (e.g. "11:00 AM").
 */
export function extractCleanTime(
  explicitTime?: any,
  rawStr?: any,
  dateTimeStr?: any,
  defaultFallback: string = ''
): string {
  const candidates = [explicitTime, rawStr, dateTimeStr].filter(
    (c) => c !== undefined && c !== null && String(c).trim() !== ''
  );

  for (const c of candidates) {
    if (typeof c === 'number' && c >= 0 && c < 1) {
      return formatMinutesToTime12(c * 1440);
    }
    if (c instanceof Date) {
      return formatMinutesToTime12(c.getHours() * 60 + c.getMinutes());
    }
    const cleaned = String(c).trim().replace(/^['"’‘\s]+|['"’‘\s]+$/g, '');
    const match12 = cleaned.match(/(\d{1,2})[:.](\d{2})\s*(AM|PM|am|pm)/i);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = match12[2];
      const ampm = match12[3].toUpperCase();
      return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
    }
    const match24 = cleaned.match(/(?:^|\s|T)(\d{1,2})[:.](\d{2})(?::\d{2})?(?:\s|$)/);
    if (match24) {
      let h = parseInt(match24[1], 10);
      const m = match24[2];
      if (h >= 0 && h < 24) {
        const ampm = h >= 12 ? 'PM' : 'AM';
        if (h > 12) h -= 12;
        if (h === 0) h = 12;
        return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
      }
    }
  }

  return defaultFallback;
}

export interface TurnoverTimingResult {
  isSameDateTurnover: boolean;
  date?: string;
  depTimeFormatted: string;
  arrTimeFormatted: string;
  depMinutes: number;
  arrMinutes: number;
  isDepLaterThanArr: boolean;
  diffMinutes: number;
  diffHours: number;
  isSevereConflict: boolean; // diffHours > 15
  canForceAllocate: boolean; // false if diffHours > 15
  warningLevel: 'none' | 'warning' | 'severe';
  message?: string;
}

/**
 * Checks turnover timing when a departure and an arrival meet on the same room.
 *
 * @param depDate YYYY-MM-DD string of departing reservation
 * @param depTime departure time string (or raw string containing time)
 * @param arrDate YYYY-MM-DD string of arriving reservation
 * @param arrTime arrival time string (or raw string containing time)
 * @param depGuestName optional departing guest name for clear messaging
 * @param arrGuestName optional arriving guest name for clear messaging
 */
export function checkTurnoverTimingConflict(
  depDate?: string,
  depTime?: string,
  arrDate?: string,
  arrTime?: string,
  depGuestName?: string,
  arrGuestName?: string
): TurnoverTimingResult {
  if (!depDate || !arrDate) {
    return {
      isSameDateTurnover: false,
      depTimeFormatted: '',
      arrTimeFormatted: '',
      depMinutes: 600,
      arrMinutes: 840,
      isDepLaterThanArr: false,
      diffMinutes: 0,
      diffHours: 0,
      isSevereConflict: false,
      canForceAllocate: true,
      warningLevel: 'none',
    };
  }

  const dDate = depDate.slice(0, 10);
  const aDate = arrDate.slice(0, 10);

  // Turnover occurs when checkout date equals checkin date
  if (dDate !== aDate) {
    return {
      isSameDateTurnover: false,
      depTimeFormatted: '',
      arrTimeFormatted: '',
      depMinutes: 600,
      arrMinutes: 840,
      isDepLaterThanArr: false,
      diffMinutes: 0,
      diffHours: 0,
      isSevereConflict: false,
      canForceAllocate: true,
      warningLevel: 'none',
    };
  }

  // Parse minutes from midnight (default checkout: 10:00 AM = 600, default checkin: 02:00 PM = 840)
  const depMinutes = parseTimeToMinutes(depTime, 600);
  const arrMinutes = parseTimeToMinutes(arrTime, 840);

  const depFormatted = formatMinutesToTime12(depMinutes);
  const arrFormatted = formatMinutesToTime12(arrMinutes);

  // If departure is earlier than or equal to arrival, standard same-day turnover
  if (depMinutes <= arrMinutes) {
    const gapMinutes = Math.max(0, arrMinutes - depMinutes);
    const gapHours = Math.round((gapMinutes / 60) * 10) / 10;
    const gapText = Number.isInteger(gapHours) ? `${gapHours}` : gapHours.toFixed(1);
    const depName = depGuestName ? `"${depGuestName}"` : 'Departing guest';
    const arrName = arrGuestName ? `"${arrGuestName}"` : 'Arriving guest';
    return {
      isSameDateTurnover: true,
      date: dDate,
      depTimeFormatted: depFormatted,
      arrTimeFormatted: arrFormatted,
      depMinutes,
      arrMinutes,
      isDepLaterThanArr: false,
      diffMinutes: gapMinutes,
      diffHours: gapHours,
      isSevereConflict: false,
      canForceAllocate: true,
      warningLevel: 'warning',
      message: `Same-Day Turnover Notice on ${dDate}: Departing pax ${depName} leaves at ${depFormatted} and arriving pax ${arrName} arrives at ${arrFormatted} (${gapText} hour difference). Click Okay to allow allocation.`,
    };
  }

  // Departure is LATER than arrival on the same date!
  const diffMinutes = depMinutes - arrMinutes;
  const rawDiffHours = diffMinutes / 60;
  const diffHours = Math.round(rawDiffHours * 10) / 10;
  const diffHoursText = Number.isInteger(diffHours) ? `${diffHours}` : diffHours.toFixed(1);

  const depName = depGuestName ? `"${depGuestName}"` : 'Departing guest';
  const arrName = arrGuestName ? `"${arrGuestName}"` : 'Arriving guest';

  // Always allow allocation with notice mentioning hour difference
  const message = `Same-Day Turnover Notice on ${dDate}: Departing pax ${depName} departs at ${depFormatted} and arriving pax ${arrName} arrives at ${arrFormatted} (${diffHoursText} hour difference, departure is ${diffHoursText}h later than arrival). Click Okay to allow allocation.`;
  return {
    isSameDateTurnover: true,
    date: dDate,
    depTimeFormatted: depFormatted,
    arrTimeFormatted: arrFormatted,
    depMinutes,
    arrMinutes,
    isDepLaterThanArr: true,
    diffMinutes,
    diffHours,
    isSevereConflict: false,
    canForceAllocate: true,
    warningLevel: 'warning',
    message,
  };
}

/**
 * Checks whether a person is an infant (under three years old, e.g. age < 3).
 * According to allocation rules:
 * "do not allocate infant (under three years) when allocating a room. If room max capacity is 5
 * and there are 6 pax out of which one is 2 years old he/she should be not counted and pax should be counted as 5"
 */
export function isInfant(item?: { age?: number | string } | null): boolean {
  if (!item || item.age === undefined || item.age === null) return false;
  const ageStr = String(item.age).trim().toLowerCase();
  if (ageStr === '' || ageStr === '—' || ageStr === '-') return false;
  if (ageStr.includes('infant') || ageStr.includes('baby') || ageStr.includes('month') || ageStr.includes('mo')) {
    return true;
  }
  const num = parseFloat(ageStr);
  if (!isNaN(num) && num < 3) {
    return true;
  }
  return false;
}

/**
 * Returns the effective room capacity pax count for a reservation (infants under 3 count as 0 pax).
 */
export function getReservationEffectivePax(
  r?: { age?: number | string; pax?: number; paxCount?: number } | null
): number {
  if (!r) return 0;
  if (isInfant(r)) return 0;
  return (r as any).pax || (r as any).paxCount || 1;
}

/**
 * Calculates total effective pax count across a list of reservations, excluding infants under 3 years old.
 */
export function countEffectivePax(
  reservations: ({ age?: number | string; pax?: number; paxCount?: number } | null | undefined)[]
): number {
  if (!Array.isArray(reservations)) return 0;
  return reservations.reduce((sum, r) => sum + (r ? getReservationEffectivePax(r) : 0), 0);
}

