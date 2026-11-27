/**
 * The app database: one SQLite row per record for the big collections, a JSON value per key for everything else.
 *
 * Before, every collection was one JSON blob, so a single edit (or each minute's NKERP pull) re-read and rewrote
 * every reservation. Now `write('reservations', list)` compares each record with what is stored and only
 * inserts, updates or deletes the records that changed (a moved record only gets its position updated). Reads
 * come from an in-memory copy of the stored JSON, parsed fresh for each caller so nobody can change the cache.
 *
 * The callers keep the same read/write API. The first time a collection is used, its old blob is copied into
 * rows inside one transaction; the old blob stays where it was, untouched, as the backup.
 */
import { createHash } from 'node:crypto';
import type { StorageDriver } from './accommodation-store.js';

/** How each collection is split into rows. */
export const ROW_COLLECTIONS: Record<string, 'array-id' | 'array' | 'map'> = {
  reservations: 'array-id', rooms: 'array-id', slips: 'array-id', history: 'array',
  'approval-records': 'map', 'removed-stays': 'map', 'approval-chat-cache': 'map', 'approval-detail-cache': 'map',
};

/** What a database must offer: SQL with the `rows` table, plus the old per-key values. */
export interface SqlBackend {
  all(sql: string, ...params: unknown[]): Record<string, unknown>[];
  run(sql: string, ...params: unknown[]): void;
  transaction<T>(fn: () => T): T;
  readBlob(key: string): string | null;
  writeBlob(key: string, json: string): void;
  removeBlob(key: string): void;
  /** True when another process changed the database since the last call (local SQLite only). */
  changedElsewhere?(): boolean;
}

export const ROWS_TABLE = 'CREATE TABLE IF NOT EXISTS rows (collection TEXT NOT NULL, id TEXT NOT NULL, pos INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, id))';
const MARK = (c: string) => `rows:${c}`;

interface Cached { order: string[]; json: Map<string, string>; pos: Map<string, number> }

export function rowStore(db: SqlBackend): StorageDriver & { stats(): { rowWrites: number; rowDeletes: number } } {
  const cache = new Map<string, Cached>();
  let depth = 0;
  const touched = new Set<string>();
  const stats = { rowWrites: 0, rowDeletes: 0 };

  function tx<T>(fn: () => T): T {
    if (depth > 0) return fn();
    if (db.changedElsewhere?.()) cache.clear();
    depth++;
    try { return db.transaction(fn); }
    catch (err) { for (const c of touched) cache.delete(c); throw err; }
    finally { depth--; touched.clear(); }
  }

  function load(collection: string): Cached | null {
    if (depth === 0 && db.changedElsewhere?.()) cache.clear();
    const hit = cache.get(collection);
    if (hit) return hit;
    if (db.readBlob(MARK(collection)) === null) {
      const legacy = db.readBlob(collection);
      if (legacy === null) return null;
      // First use since the switch to rows: copy the old blob into rows. The blob itself is left in place as the
      // backup, so code from before this change (if it were ever deployed again) still finds its data.
      tx(() => {
        if (db.readBlob(MARK(collection)) !== null) return;
        store(collection, JSON.parse(legacy), { order: [], json: new Map(), pos: new Map() });
      });
      return cache.get(collection) ?? null;
    }
    const rows = db.all('SELECT id, pos, value FROM rows WHERE collection=? ORDER BY pos', collection);
    const c: Cached = { order: [], json: new Map(), pos: new Map() };
    for (const r of rows) {
      const id = String(r.id);
      c.order.push(id); c.json.set(id, String(r.value)); c.pos.set(id, Number(r.pos));
    }
    cache.set(collection, c);
    return c;
  }

  function entries(collection: string, value: unknown): [string, string][] {
    const kind = ROW_COLLECTIONS[collection];
    if (kind === 'map') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${collection} must be an object`);
      return Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, JSON.stringify(v)]);
    }
    if (!Array.isArray(value)) throw new Error(`${collection} must be a list`);
    const seen = new Map<string, number>();
    return value.map(v => {
      const json = JSON.stringify(v ?? null);
      const own = kind === 'array-id' && v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : '';
      const base = own || createHash('sha256').update(json).digest('hex').slice(0, 20);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return [n === 1 ? base : `${base}#${n}`, json];
    });
  }

  function store(collection: string, value: unknown, before: Cached) {
    const next = entries(collection, value);
    const c: Cached = { order: [], json: new Map(), pos: new Map() };
    next.forEach(([id, json], i) => {
      if (before.json.get(id) !== json) {
        db.run('INSERT INTO rows (collection,id,pos,value) VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET pos=excluded.pos, value=excluded.value', collection, id, i, json);
        stats.rowWrites++;
      } else if (before.pos.get(id) !== i) {
        db.run('UPDATE rows SET pos=? WHERE collection=? AND id=?', i, collection, id);
      }
      c.order.push(id); c.json.set(id, json); c.pos.set(id, i);
    });
    for (const id of before.order) if (!c.json.has(id)) { db.run('DELETE FROM rows WHERE collection=? AND id=?', collection, id); stats.rowDeletes++; }
    if (db.readBlob(MARK(collection)) === null) db.writeBlob(MARK(collection), '1');
    touched.add(collection);
    cache.set(collection, c);
  }

  return {
    read<T>(key: string, fallback: T): T {
      if (!ROW_COLLECTIONS[key]) {
        const raw = db.readBlob(key);
        return raw === null ? fallback : JSON.parse(raw);
      }
      const c = load(key);
      if (!c) return fallback;
      if (ROW_COLLECTIONS[key] === 'map') return Object.fromEntries(c.order.map(id => [id, JSON.parse(c.json.get(id)!)])) as T;
      return c.order.map(id => JSON.parse(c.json.get(id)!)) as T;
    },
    write(key, value) {
      if (!ROW_COLLECTIONS[key]) { db.writeBlob(key, JSON.stringify(value)); return; }
      tx(() => store(key, value, load(key) ?? { order: [], json: new Map(), pos: new Map() }));
    },
    remove(key) {
      if (!ROW_COLLECTIONS[key]) { db.removeBlob(key); return; }
      tx(() => {
        db.run('DELETE FROM rows WHERE collection=?', key);
        db.removeBlob(MARK(key));
        db.removeBlob(key);
        touched.add(key);
        cache.delete(key);
      });
    },
    transaction: tx,
    stats: () => ({ ...stats }),
  };
}
