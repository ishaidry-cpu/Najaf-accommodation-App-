import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Reservation, Room } from '../src/types/index.js';
import { parseArrival } from './nkerp-sync/util.js';
import type { HistoryRow } from './nkerp-sync/types.js';

export interface StorageDriver {
  read<T>(key: string, fallback: T): T;
  write(key: string, value: unknown): void;
  remove(key: string): void;
  transaction<T>(fn: () => T): T;
}

const active = new AsyncLocalStorage<StorageDriver>();
export const withStore = <T>(store: StorageDriver, fn: () => T) => active.run(store, fn);
function store() {
  const driver = active.getStore();
  if (!driver) throw new Error('Accommodation storage is unavailable.');
  return driver;
}
export const read = <T>(key: string, fallback: T): T => store().read(key, fallback);
export const write = (key: string, value: unknown) => store().write(key, value);
export const remove = (key: string) => store().remove(key);
export const transaction = <T>(fn: () => T): T => store().transaction(fn);

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
  async ensureWritable() { store(); return null; },
  async append(rows: HistoryRow[]) {
    transaction(() => { write('history', [...read<HistoryRow[]>('history', []), ...rows]); prune(); });
    return rows.length;
  },
};
