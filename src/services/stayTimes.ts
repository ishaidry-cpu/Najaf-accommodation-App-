/**
 * Default subvenue (Najaf) timings: zaereen check in at 10:00 AM and check out at 8:00 AM.
 * NKERP stays take these times unless someone has changed a stay's time in the app.
 */
export const SUBVENUE_ARRIVAL_TIME = '10:00 AM';
export const SUBVENUE_DEPARTURE_TIME = '08:00 AM';

/** Times offered in the arrival and departure time dropdowns: every half hour, from 12:00 AM. */
export const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${i % 2 ? '30' : '00'} ${h24 < 12 ? 'AM' : 'PM'}`;
});

/** `8:00 am`, `08:00`, `20:00` and the like as `08:00 AM` / `08:00 PM`; anything unreadable as it is. */
export function normalizeTime(value?: string): string {
  const text = String(value ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(text);
  if (!m) return text;
  let h = Number(m[1]);
  const meridiem = m[3]?.toUpperCase();
  if (h > 23 || Number(m[2]) > 59) return text;
  if (!meridiem) {
    const pm = h >= 12;
    h = h % 12 === 0 ? 12 : h % 12;
    return `${String(h).padStart(2, '0')}:${m[2]} ${pm ? 'PM' : 'AM'}`;
  }
  if (h === 0 || h > 12) return text;
  return `${String(h).padStart(2, '0')}:${m[2]} ${meridiem}`;
}

/** The dropdown's choices, keeping a stay's own time when it is not on the half hour. */
export function timeOptionsWith(current?: string): string[] {
  const value = normalizeTime(current);
  return value && !TIME_OPTIONS.includes(value) ? [value, ...TIME_OPTIONS] : TIME_OPTIONS;
}
