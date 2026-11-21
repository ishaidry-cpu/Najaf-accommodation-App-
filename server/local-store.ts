import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { deduplicateRooms, pruneLegacyBadriRooms, reconcileOfficialSaifeeBurhaniRooms } from '../src/services/storage.js';
import type { Reservation, Room } from '../src/types/index.js';
import { parseArrival } from './nkerp-sync/util.js';
import type { HistoryRow } from './nkerp-sync/types.js';

export type Collection = 'reservations' | 'rooms';
export const dataDir = process.env.NAJAF_DATA_DIR || path.join(homedir(), '.local/share/najaf-accommodation');
let database: DatabaseSync;
export function db() {
  if (database) return database;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'accommodation.sqlite');
  database = new DatabaseSync(file);
  chmodSync(file, 0o600);
  database.exec('PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return database;
}
export function read<T>(key: string, fallback: T): T {
  const row = db().prepare('SELECT value FROM state WHERE key=?').get(key);
  return row ? JSON.parse(String(row.value)) : fallback;
}
export function write(key: string, value: unknown) {
  db().prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}
export function transaction<T>(fn: () => T): T {
  db().exec('BEGIN IMMEDIATE');
  try { const value = fn(); db().exec('COMMIT'); return value; }
  catch (e) { db().exec('ROLLBACK'); throw e; }
}
export function setup() {
  transaction(() => {
    if (!read('rooms', null)) {
      const legacyRooms = JSON.parse(readFileSync(new URL('../data/rooms.json', import.meta.url),'utf8'));
      write('rooms', reconcileOfficialSaifeeBurhaniRooms(pruneLegacyBadriRooms(deduplicateRooms(legacyRooms))));
    }
    if (!read('settings', null)) {
      const {categories, adminPin} = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url),'utf8'));
      write('settings', {categories, adminPin});
    }
  });
}
export const guests = () => read<Reservation[]>('reservations', []);
export const rooms = () => read<Room[]>('rooms', []);
export function expiry(r: Pick<Reservation,'departureDate'|'departureTime'>) {
  const departureDate = parseArrival(r.departureDate);
  if (!departureDate) return Infinity;
  const tm = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(r.departureTime?.trim() || '');
  let h = tm ? +tm[1] : 23;
  if (tm?.[3]) h = h % 12 + (tm[3].toLowerCase() === 'pm' ? 12 : 0);
  const when = Date.parse(departureDate+'T'+String(h).padStart(2,'0')+':'+(tm?.[2] || '59')+':00+03:00');
  return Number.isFinite(when) ? when + 3 * 86400000 : Infinity;
}
export const stayKey = (r: Reservation) => JSON.stringify([r.tourRefNo.trim().toUpperCase(),String(r.itsId ?? '').replace(/^['’]/,'').trim(),(parseArrival(r.arrivalDate) || r.arrivalDate)]);
export const identityHash = (key: string) => createHash('sha256').update(key).digest('hex');
export const historyKey = (r: HistoryRow) => JSON.stringify([r['Tour ID']?.trim().toUpperCase(),r.ITS?.trim(),r.Arrival?.slice(0,10)]);
export function prune(now = Date.now()) {
  const all = guests();
  const kept = all.filter(r => expiry(r) > now);
  const normalized = kept.map(r => ({...r, arrivalDate: parseArrival(r.arrivalDate) || r.arrivalDate,
    departureDate: parseArrival(r.departureDate) || r.departureDate}));
  if (JSON.stringify(all) !== JSON.stringify(normalized)) write('reservations', normalized);
  const ends = new Map(all.map(r => [stayKey(r), expiry(r)]));
  const removed = read<Record<string,number>>('removed-stays', {});
  const activeRemovals = Object.fromEntries(Object.entries(removed).filter(([,until]) => until > now));
  if (Object.keys(removed).length !== Object.keys(activeRemovals).length) write('removed-stays', activeRemovals);
  const hist = read<HistoryRow[]>('history', []);
  const recent = hist.filter(row => {
    const key = historyKey(row);
    const runAt = Date.parse(row['Run At']?.replace(' ', 'T') + '+03:00');
    const until = ends.get(key) ?? activeRemovals[identityHash(key)] ?? (runAt + 3 * 86400000);
    return until > now;
  });
  if (hist.length !== recent.length) write('history', recent);
  return all.length - kept.length;
}
export const localHistory = {
  async read() { return read<HistoryRow[]>('history', []); },
  async ensureWritable() { db(); return null; },
  async append(rows: HistoryRow[]) {
    transaction(() => { write('history', [...read<HistoryRow[]>('history', []), ...rows]); prune(); });
    return rows.length;
  },
};
