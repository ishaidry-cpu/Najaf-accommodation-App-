import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { deduplicateRooms, pruneLegacyBadriRooms, reconcileOfficialSaifeeBurhaniRooms } from '../src/services/storage.js';
import type { StorageDriver } from './accommodation-store.js';
import { ROWS_TABLE, rowStore } from './row-store.js';

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
let driver: ReturnType<typeof rowStore> | undefined;
let dataVersion = -1;
function store() {
  if (driver) return driver;
  const d = db();
  d.exec(ROWS_TABLE);
  const version = () => Number((d.prepare('PRAGMA data_version').get() as { data_version: number }).data_version);
  driver = rowStore({
    all: (sql, ...params) => d.prepare(sql).all(...(params as never[])) as Record<string, unknown>[],
    run: (sql, ...params) => { d.prepare(sql).run(...(params as never[])); },
    transaction<T>(fn: () => T): T {
      d.exec('BEGIN IMMEDIATE');
      try { const value = fn(); d.exec('COMMIT'); dataVersion = version(); return value; }
      catch (e) { d.exec('ROLLBACK'); throw e; }
    },
    readBlob: key => { const row = d.prepare('SELECT value FROM state WHERE key=?').get(key); return row ? String(row.value) : null; },
    writeBlob: (key, json) => { d.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, json); },
    removeBlob: key => { d.prepare('DELETE FROM state WHERE key=?').run(key); },
    // Other working copies on this computer share the database: drop the cache when one of them commits.
    changedElsewhere() { const v = version(); const changed = dataVersion !== -1 && v !== dataVersion; dataVersion = v; return changed; },
  });
  return driver;
}
export const read = <T>(key: string, fallback: T): T => store().read(key, fallback);
export const write = (key: string, value: unknown) => store().write(key, value);
export const remove = (key: string) => store().remove(key);
export const transaction = <T>(fn: () => T): T => store().transaction(fn);
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
