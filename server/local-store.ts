import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { deduplicateRooms, pruneLegacyBadriRooms, reconcileOfficialSaifeeBurhaniRooms } from '../src/services/storage.js';
import type { StorageDriver } from './accommodation-store.js';

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
export function remove(key: string) {
  db().prepare('DELETE FROM state WHERE key=?').run(key);
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

export const localStore: StorageDriver = { read, write, remove, transaction };
export { guests, rooms, expiry, stayKey, identityHash, prune, localHistory } from './accommodation-store.js';
