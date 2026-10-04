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

  // If departure is earlier than or equal to arrival, standard turnover is fine
  if (depMinutes <= arrMinutes) {
    return {
      isSameDateTurnover: true,
      date: dDate,
      depTimeFormatted: depFormatted,
      arrTimeFormatted: arrFormatted,
      depMinutes,
      arrMinutes,
      isDepLaterThanArr: false,
      diffMinutes: 0,
      diffHours: 0,
      isSevereConflict: false,
      canForceAllocate: true,
      warningLevel: 'none',
      message: `Standard Turnover on ${dDate}: Checkout (${depFormatted}) ➔ Checkin (${arrFormatted}).`,
    };
  }

  // Departure is LATER than arrival on the same date!
  const diffMinutes = depMinutes - arrMinutes;
  const rawDiffHours = diffMinutes / 60;
  const diffHours = Math.round(rawDiffHours * 10) / 10;
  const diffHoursText = Number.isInteger(diffHours) ? `${diffHours}` : diffHours.toFixed(1);

  const depName = depGuestName ? `"${depGuestName}"` : 'Departing guest';
  const arrName = arrGuestName ? `"${arrGuestName}"` : 'Arriving guest';

  // Rule: When difference is > 15 hours, DO NOT allow force allocation!
  if (rawDiffHours > 15) {
    const message = `CRITICAL TIMING CONFLICT on ${dDate}: Departure time (${depFormatted} for ${depName}) is ${diffHoursText} hours later than arrival time (${arrFormatted} for ${arrName}). Because departure is late than arrival with a difference of MORE THAN 15 hours, force allocation is strictly BLOCKED.`;
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
      isSevereConflict: true,
      canForceAllocate: false,
      warningLevel: 'severe',
      message,
    };
  }

  // Rule: When difference is <= 15 hours, issue warning notification and give option to force allocate!
  const message = `TIMING OVERLAP WARNING on ${dDate}: Departure time (${depFormatted} for ${depName}) is ${diffHoursText} hours later than arrival time (${arrFormatted} for ${arrName}). ${depName} will still be occupying the room when ${arrName} arrives. Force allocation requires operational confirmation.`;
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
