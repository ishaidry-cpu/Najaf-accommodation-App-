/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { accommodationApi } from '../server/accommodation-api.js';
import { guests, prune, read, rooms, transaction, withStore, write, type StorageDriver } from '../server/accommodation-store.js';
import { json } from '../server/nkerp-sync/handlers.js';
import { deduplicateRooms, pruneLegacyBadriRooms, reconcileOfficialSaifeeBurhaniRooms } from '../src/services/storage.js';
import seedRooms from '../data/rooms.json';
import seedSettings from '../data/config.json';

interface Env {
  ASSETS: Fetcher;
  ACCOMMODATION: DurableObjectNamespace<Accommodation>;
  NAJAF_IMPORT_KEY?: string;
}

function signature(key: string, value: string) {
  return createHmac('sha256', key).update(value).digest('base64url');
}
function matches(key: string, input: string) {
  return timingSafeEqual(Buffer.from(signature(key, key)), Buffer.from(signature(key, input)));
}
export class Accommodation extends DurableObject<Env> {
  private readonly store: StorageDriver;
  private readonly api = accommodationApi();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const {sql} = ctx.storage;
    sql.exec('CREATE TABLE IF NOT EXISTS state (key TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (key,part))');
    this.store = {
      read<T>(key: string, fallback: T): T {
        const parts = sql.exec<{value:string}>('SELECT value FROM state WHERE key=? ORDER BY part',key).toArray();
        return parts.length ? JSON.parse(parts.map(p=>p.value).join('')) : fallback;
      },
      write(key,value) {
        ctx.storage.transactionSync(() => {
          sql.exec('DELETE FROM state WHERE key=?',key);
          const encoded = JSON.stringify(value);
          // Keep each individual SQLite value below the per-row size limit.
          for (let i=0; i<encoded.length; i+=200_000) {
            sql.exec('INSERT INTO state (key,part,value) VALUES (?,?,?)',key,i,encoded.slice(i,i+200_000));
          }
        });
      },
      transaction: fn => ctx.storage.transactionSync(fn),
    };
    withStore(this.store, () => transaction(() => {
      if (!read('rooms', null)) write('rooms', reconcileOfficialSaifeeBurhaniRooms(pruneLegacyBadriRooms(deduplicateRooms(seedRooms as never))));
      if (!read('settings', null)) write('settings', seedSettings);
    }));
  }

  async tick() {
    return withStore(this.store, () => read('hosted-import',null) ? this.api.tick() : Promise.resolve());
  }

  async fetch(req: Request) {
    return withStore(this.store, async () => {
      if (new URL(req.url).pathname === '/api/admin/import') {
        const snapshot = await req.json() as Record<string,unknown>;
        if (!Array.isArray(snapshot.reservations) || !Array.isArray(snapshot.rooms) ||
            !snapshot.rooms.length || !Array.isArray(snapshot.history) ||
            !snapshot.settings || typeof snapshot.settings !== 'object') {
          return json({error:'Invalid accommodation snapshot.'},400);
        }
        return transaction(() => {
          if (read('hosted-import',null)) return json({error:'This database has already been imported.'},409);
          for (const key of ['reservations','rooms','history','settings','removed-stays']) {
            if (snapshot[key] !== undefined) write(key,snapshot[key]);
          }
          const expired = prune();
          write('hosted-import',new Date().toISOString());
          return json({reservations:guests().length,rooms:rooms().length,expired});
        });
      }
      if (!read('hosted-import',null)) return json({error:'The accommodation database is awaiting its first import.'},503);
      return this.api.fetch(req,true,work => this.ctx.waitUntil(work));
    });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const database = () => env.ACCOMMODATION.getByName('najaf');
    if (url.pathname === '/api/admin/import') {
      const key = env.NAJAF_IMPORT_KEY;
      const bearer = req.headers.get('authorization')?.replace(/^Bearer /,'') || '';
      if (req.method !== 'POST' || !key || !matches(key,bearer)) return json({error:'API route unavailable.'},404);
      return database().fetch(req);
    }
    if (url.pathname.startsWith('/api/')) {
      if (origin && origin !== url.origin) return json({error:'Invalid app origin.'},403);
      return database().fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await env.ACCOMMODATION.getByName('najaf').tick();
  },
};
