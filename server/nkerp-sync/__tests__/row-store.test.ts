/** One SQLite row per record: migration from the old blobs, writes that touch only changed records, rollback. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ROWS_TABLE, rowStore, type SqlBackend } from '../../row-store.js';

function backend(file = ':memory:') {
  const d = new DatabaseSync(file);
  d.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL); ' + ROWS_TABLE);
  let version = -1;
  const pragma = () => Number((d.prepare('PRAGMA data_version').get() as { data_version: number }).data_version);
  const b: SqlBackend & { d: DatabaseSync } = {
    d,
    all: (sql, ...p) => d.prepare(sql).all(...(p as never[])) as Record<string, unknown>[],
    run: (sql, ...p) => { d.prepare(sql).run(...(p as never[])); },
    transaction(fn) { d.exec('BEGIN IMMEDIATE'); try { const v = fn(); d.exec('COMMIT'); version = pragma(); return v; } catch (e) { d.exec('ROLLBACK'); throw e; } },
    readBlob: k => { const r = d.prepare('SELECT value FROM state WHERE key=?').get(k); return r ? String(r.value) : null; },
    writeBlob: (k, v) => { d.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v); },
    removeBlob: k => { d.prepare('DELETE FROM state WHERE key=?').run(k); },
    changedElsewhere() { const v = pragma(); const c = version !== -1 && v !== version; version = v; return c; },
  };
  return b;
}
const stay = (id: string, extra = {}) => ({ id, itsId: id, applicantName: 'Name ' + id, ...extra });

test('moves the old blob into rows once and keeps it as a backup', () => {
  const b = backend();
  const old = [stay('a'), stay('b'), stay('c')];
  b.writeBlob('reservations', JSON.stringify(old));
  b.writeBlob('settings', JSON.stringify({ categories: ['X'] }));
  const s = rowStore(b);
  assert.deepEqual(s.read('reservations', []), old);
  assert.deepEqual(s.read('settings', {}), { categories: ['X'] });
  assert.equal(b.readBlob('reservations'), null);
  assert.equal(b.readBlob('legacy:reservations'), JSON.stringify(old));
  assert.equal((b.all('SELECT COUNT(*) AS n FROM rows WHERE collection=?', 'reservations')[0].n), 3);
  // A fresh process reads the rows, not the backup.
  assert.deepEqual(rowStore(b).read('reservations', []), old);
});

test('writes only the records that changed', () => {
  const b = backend();
  const s = rowStore(b);
  const list = Array.from({ length: 500 }, (_, i) => stay('r' + i));
  s.write('reservations', list);
  const before = s.stats();
  const next = list.map(r => r.id === 'r42' ? { ...r, roomNumber: '101' } : r).filter(r => r.id !== 'r7');
  next.push(stay('new'));
  s.write('reservations', next);
  const after = s.stats();
  assert.equal(after.rowWrites - before.rowWrites, 2, 'one edited, one added');
  assert.equal(after.rowDeletes - before.rowDeletes, 1);
  assert.deepEqual(s.read('reservations', []), next);
  assert.deepEqual(rowStore(b).read('reservations', []), next, 'order and content survive a restart');
});

test('callers cannot change the cache, and maps, duplicates and empty lists round-trip', () => {
  const s = rowStore(backend());
  s.write('rooms', [stay('x')]);
  (s.read<{ applicantName: string }[]>('rooms', [])[0]).applicantName = 'changed';
  assert.equal(s.read<{ applicantName: string }[]>('rooms', [])[0].applicantName, 'Name x');
  s.write('approval-records', { '5': { status: 'new' }, '9': { status: 'approved' } });
  assert.deepEqual(s.read('approval-records', {}), { '5': { status: 'new' }, '9': { status: 'approved' } });
  const hist = [{ ITS: '1' }, { ITS: '1' }, { ITS: '2' }];
  s.write('history', hist);
  assert.deepEqual(s.read('history', []), hist, 'identical history rows are both kept');
  s.write('slips', []);
  assert.deepEqual(s.read('slips', ['fallback']), [], 'an empty list is stored, not the fallback');
  assert.deepEqual(s.read('removed-stays', { none: true }), { none: true });
});

test('a failed transaction leaves rows and cache as they were', () => {
  const b = backend();
  const s = rowStore(b);
  s.write('reservations', [stay('a')]);
  assert.throws(() => s.transaction(() => { s.write('reservations', [stay('a'), stay('b')]); throw new Error('boom'); }));
  assert.deepEqual(s.read('reservations', []), [stay('a')]);
  assert.deepEqual(rowStore(b).read('reservations', []), [stay('a')]);
});

test('two processes sharing a local database see each other\'s saves', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'rows-')), 'db.sqlite');
  const one = rowStore(backend(file));
  const two = rowStore(backend(file));
  one.write('reservations', [stay('a')]);
  assert.deepEqual(two.read('reservations', []), [stay('a')]);
  two.write('reservations', [stay('a'), stay('b')]);
  assert.equal(one.read<unknown[]>('reservations', []).length, 2);
});
