import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createNkerpSyncRouter } from './server/nkerp-sync/routes.js';
import { NkerpClient } from './server/nkerp-sync/nkerpClient.js';
import { nkerpLogin, MissingCredentials } from './server/nkerp-sync/credentials.js';
import { norm, familyNo } from './server/nkerp-sync/util.js';
import { createPull, removalKey, type StoredReservation } from './server/nkerp-pull.js';
import { expiry, guests, localHistory, prune, read, rooms, setup, transaction, write } from './server/local-store.js';
import { importWorkbook } from './server/sheet-cutover.js';
import { generateSaifeeBurhani114Rooms, generateBadriRooms, reconcileOfficialSaifeeBurhaniRooms, pruneLegacyBadriRooms, deduplicateRooms } from './src/services/storage.js';
import type { Room } from './src/types/index.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? process.argv.find(a => a.startsWith(name+'='))?.slice(name.length+1) : process.argv[index+1];
};
setup();
const workbook = arg('--import-workbook');
if (workbook) {
  console.log(importWorkbook(workbook, arg('--legacy-reservations')));
  process.exit(0);
}

const app = express();
const port = Number(arg('--port') || process.env.APP_PORT || 3000);
const host = arg('--host') || '127.0.0.1';
const clients = new Set<express.Response>();
function notify() {
  for (const client of clients) client.write('data: {"type":"DATA_UPDATED"}\n\n');
}
const pull = createPull(notify);
app.use('/api', (req,res,next) => {
  const origin = req.get('origin');
  const requestHost = req.get('host');
  const directLocal = ['localhost','127.0.0.1','[::1]'].includes(req.hostname);
  const localPeer = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
  if (!localPeer || !directLocal || (origin && origin !== `http://${requestHost}` && origin !== `https://${requestHost}`) ||
      req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({error:'Open the app locally.'});
  res.setHeader('Cache-Control','no-store');
  next();
});
app.use(express.json({limit:'12mb'}));

app.get('/api/events', (req,res) => {
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.flushHeaders();
  res.write('data: {"type":"CONNECTED"}\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
app.get('/api/status', (_req,res) => res.json({ status:'ok', liveBackend:true,
  reservationsCount:guests().length, roomsCount:rooms().length, pull:pull.status }));
app.get('/api/reservations', (_req,res) => res.json(guests()));
app.get('/api/rooms', (_req,res) => res.json(rooms()));
app.get('/api/settings', (_req,res) => res.json(read('settings',{})));

interface RecordChange {
  id:string;
  before:Record<string,unknown> | null;
  after:Record<string,unknown> | null;
}
class SaveConflict extends Error {}
app.post('/api/changes', (req,res) => {
  const { collection, changes } = (req.body ?? {}) as {collection:'rooms'|'reservations'; changes:RecordChange[]};
  if (!['rooms','reservations'].includes(collection) || !Array.isArray(changes) ||
      changes.some(c => !c || typeof c.id !== 'string' || ![c.before,c.after].every(x => x === null || (x && typeof x === 'object' && !Array.isArray(x))))) {
    return res.status(400).json({error:'Invalid changes.'});
  }
  try {
    const output = transaction(() => {
      const current = new Map(read<(StoredReservation|Room)[]>(collection,[]).map(r => [r.id,r]));
      const deleted = read<Record<string,number>>('removed-stays',{});
      for (const {id,before,after} of changes) {
        const row = current.get(id);
        if (!after) {
          if (!row) continue;
          if (before?.updatedAt && 'updatedAt' in row && before.updatedAt !== row.updatedAt) {
            throw new SaveConflict('A reservation changed before it could be deleted. Reload and try again.');
          }
          current.delete(id);
          if (collection === 'reservations') {
            const stay = row as StoredReservation;
            const until = expiry(stay);
            if (Number.isFinite(until)) deleted[removalKey(stay)] = until;
          }
          continue;
        }
        if (!row && before) throw new SaveConflict('A record was removed before it could be saved.');
        if (row && !before && !isDeepStrictEqual(row,after)) throw new SaveConflict('A record with that ID already exists.');
        const existing = row as unknown as Record<string,unknown> | undefined;
        const next = {...row};
        for (const [key,value] of Object.entries(after)) {
          if (['id','localFields','nkerpBaseline','createdAt','updatedAt','__proto__','constructor','prototype'].includes(key)) continue;
          if (existing && !isDeepStrictEqual(existing[key] ?? null,before?.[key] ?? null) &&
              !isDeepStrictEqual(existing[key] ?? null,value)) throw new SaveConflict('This record changed. Reload the latest values and retry.');
          Object.assign(next,{[key]:value === null ? undefined : value});
        }
        if (collection === 'reservations') {
          const stay = next as StoredReservation;
          if ('building' in after || 'roomNumber' in after) stay.allocationObservedOnly = false;
          stay.localFields = [...new Set([...(stay.localFields || []), ...Object.keys(after).filter(k=>k !== 'id')])];
          stay.updatedAt = new Date().toISOString();
          stay.createdAt ||= stay.updatedAt;
          if (expiry(stay) <= Date.now()) throw new SaveConflict('This stay has passed the three-day retention window.');
          if (!stay.itsId || !stay.tourRefNo) {
            if (typeof stay.itsId !== 'string' || typeof stay.tourRefNo !== 'string') throw new Error('Invalid reservation identity.');
          }
          delete deleted[removalKey(stay)];
        }
        current.set(id,{...next,id} as StoredReservation|Room);
      }
      const list = [...current.values()];
      const saved = collection === 'rooms' ? deduplicateRooms(list as Room[]) : list;
      write(collection,saved);
      if (collection === 'reservations') write('removed-stays',deleted);
      return saved;
    });
    notify();
    res.json(output);
  } catch (err) {
    if (err instanceof SaveConflict) return res.status(409).json({error:err.message});
    console.error('Could not save app changes',err);
    res.status(500).json({error:'Changes could not be saved to the local database.'});
  }
});
app.post('/api/rooms/reset', (_req,res) => {
  const fresh = reconcileOfficialSaifeeBurhaniRooms(pruneLegacyBadriRooms(deduplicateRooms([
    ...generateSaifeeBurhani114Rooms(), ...generateBadriRooms(),
  ])));
  write('rooms',fresh);
  notify();
  res.json({rooms:fresh});
});
app.post('/api/settings', (req,res) => {
  const { categories, adminPin } = req.body;
  const current = read('settings',{});
  const saved = {...current,
    ...(Array.isArray(categories) ? {categories:categories.filter(c=>typeof c==='string')} : {}),
    ...(typeof adminPin === 'string' && adminPin.length >= 4 ? {adminPin} : {}),
  };
  write('settings',saved);
  notify();
  res.json({success:true,config:saved});
});
app.post('/api/nkerp/pull', async (_req,res) => {
  try { res.json(await pull.pull()); }
  catch (err) { res.status(err instanceof MissingCredentials ? 503 : 502).json({error:pull.status.error}); }
});

app.use('/api/nkerp-sync', createNkerpSyncRouter({
  credentials: () => {
    try { nkerpLogin(); return {nkerp:true,problem:null}; }
    catch (e) { return {nkerp:false,problem:(e as Error).message}; }
  },
  readHistory: localHistory.read,
  depsFactory: (apply,progress,signal) => ({
    nkerp: new NkerpClient({allowWrite:apply,signal}),
    readSheet: async () => (guests() as StoredReservation[]).filter(r => !r.allocationObservedOnly).map((r,i) => ({
      row:i+1, its:norm(r.itsId), name:r.applicantName, family:familyNo(r.family), ref:norm(r.tourRefNo),
      building:norm(r.building), room:norm(r.roomNumber), arrival:r.arrivalDate || null, arrival_text:r.rawArrivalStr || r.arrivalDate,
    })),
    history: localHistory, progress, signal, concurrency:6,
  }),
}));
app.use('/api', (_req,res) => res.status(404).json({error:'API route unavailable.'}));

const server = http.createServer(app);
if (process.env.NODE_ENV !== 'production') {
  const { createServer } = await import('vite');
  const vite = await createServer({server:{middlewareMode:true,hmr:{server}},appType:'spa'});
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root,'dist')));
  app.get('*', (_req,res)=>res.sendFile(path.join(root,'dist/index.html')));
}
const tick = () => {
  try { if (transaction(() => prune())) notify(); }
  catch (err) { console.error('Reservation retention failed:',err); }
  if (process.env.NAJAF_AUTO_PULL !== 'false') void pull.pull().catch(() => {});
};
server.listen(port,host,() => {
  console.log(`Najaf Accommodation listening on http://${host}:${port}`);
  tick();
});
const timer = setInterval(tick,60_000);
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => {
  clearInterval(timer);
  for (const client of clients) client.end();
  server.close();
});
