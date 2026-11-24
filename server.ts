import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toWebRequest, sendWebResponse } from './server/nkerp-sync/routes.js';
import { accommodationApi } from './server/accommodation-api.js';
import { withStore } from './server/accommodation-store.js';
import { localStore, setup } from './server/local-store.js';
import { importWorkbook } from './server/sheet-cutover.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? process.argv.find(a => a.startsWith(name+'='))?.slice(name.length+1) : process.argv[index+1];
};
setup();
const workbook = arg('--import-workbook');
if (workbook) {
  console.log(withStore(localStore, () => importWorkbook(workbook, arg('--legacy-reservations'))));
  process.exit(0);
}

const app = express();
const port = Number(arg('--port') || process.env.PORT || process.env.APP_PORT || 3000);
const host = arg('--host') || process.env.HOST || '0.0.0.0';
const clients = new Set<express.Response>();
function notify() {
  for (const client of clients) client.write('data: {"type":"DATA_UPDATED"}\n\n');
}
const api = accommodationApi(notify);
app.use('/api', (req,res,next) => {
  const origin = req.get('origin');
  const requestHost = req.get('x-forwarded-host') || req.get('host');
  if (
    origin &&
    requestHost &&
    origin !== `http://${requestHost}` &&
    origin !== `https://${requestHost}`
  ) {
    return res.status(403).json({ error: 'Cross-origin API request blocked.' });
  }
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
app.use('/api', async (req,res) => {
  try {
    const webRequest = toWebRequest(req,new AbortController().signal);
    await sendWebResponse(await withStore(localStore, () => api.fetch(webRequest)),res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({error:(err as Error).message});
    else res.end();
  }
});

const server = http.createServer(app);
if (process.env.NODE_ENV !== 'production') {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: {
      middlewareMode: true,
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root,'dist')));
  app.get('*', (_req,res)=>res.sendFile(path.join(root,'dist/index.html')));
}
const tick = () => void withStore(localStore, () => api.tick()).catch(() => console.error('Accommodation refresh failed.'));
server.listen(port,host,() => {
  console.log(`Najaf Accommodation listening on http://${host}:${port}`);
  tick();
});
const timer = setInterval(tick,60_000);
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => {
  clearInterval(timer);
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});
