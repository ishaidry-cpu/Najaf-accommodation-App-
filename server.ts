import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateSaifeeBurhani114Rooms, INITIAL_RESERVATIONS } from './src/services/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isDev = process.env.NODE_ENV !== 'production';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Persistent Data Directory
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// File helper functions with atomic writes
function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filePath, fallback);
      return fallback;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return fallback;
  }
}

function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    const tempFile = `${filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, filePath);
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Initialize seed data if not present
function initializeData() {
  if (!fs.existsSync(ROOMS_FILE)) {
    console.log('Seeding initial 114 rooms to server backend storage...');
    const initialRooms = generateSaifeeBurhani114Rooms();
    writeJsonFile(ROOMS_FILE, initialRooms);
  }

  if (!fs.existsSync(RESERVATIONS_FILE)) {
    console.log('Seeding initial zaereen reservations to server backend storage...');
    writeJsonFile(RESERVATIONS_FILE, INITIAL_RESERVATIONS);
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    const initialConfig = {
      sheetsConfig: {
        spreadsheetId: '',
        sheetName: 'Zaereen Accommodation',
        roomsSheetName: 'Rooms Inventory',
        autoSync: true,
        isSyncing: false,
        lastSyncedAt: null,
        syncError: null,
      },
      categories: ['Mumineen', 'Muntasbeen', 'Qasreali', 'Baitezainy'],
      userRole: 'admin',
      adminPin: '1234',
    };
    writeJsonFile(CONFIG_FILE, initialConfig);
  }
}

initializeData();

// ==========================================
// REST API ROUTES (/api/*)
// ==========================================

// Health & Status
app.get('/api/status', (req, res) => {
  const reservations = readJsonFile<any[]>(RESERVATIONS_FILE, []);
  const rooms = readJsonFile<any[]>(ROOMS_FILE, []);
  res.json({
    status: 'ok',
    liveBackend: true,
    serverTime: new Date().toISOString(),
    reservationsCount: reservations.length,
    roomsCount: rooms.length,
    storageLocation: DATA_DIR,
  });
});

// GET all reservations
app.get('/api/reservations', (req, res) => {
  const reservations = readJsonFile<any[]>(RESERVATIONS_FILE, []);
  res.json(reservations);
});

// POST all reservations (Replace / Bulk import)
app.post('/api/reservations', (req, res) => {
  const { reservations } = req.body;
  if (!Array.isArray(reservations)) {
    return res.status(400).json({ error: 'Expected array of reservations in { reservations: [...] }' });
  }
  writeJsonFile(RESERVATIONS_FILE, reservations);
  console.log(`[API] Saved ${reservations.length} reservations to backend data store.`);
  res.json({ success: true, count: reservations.length });
});

// POST single reservation upsert (Add or Update)
app.post('/api/reservations/upsert', (req, res) => {
  const updatedRes = req.body;
  if (!updatedRes || !updatedRes.id) {
    return res.status(400).json({ error: 'Missing reservation ID in body' });
  }

  const current = readJsonFile<any[]>(RESERVATIONS_FILE, []);
  const index = current.findIndex((r) => r.id === updatedRes.id);

  if (index >= 0) {
    current[index] = { ...current[index], ...updatedRes, updatedAt: new Date().toISOString() };
  } else {
    current.push({ ...updatedRes, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }

  writeJsonFile(RESERVATIONS_FILE, current);
  res.json({ success: true, reservation: updatedRes, total: current.length });
});

// DELETE single reservation
app.delete('/api/reservations/:id', (req, res) => {
  const { id } = req.params;
  const current = readJsonFile<any[]>(RESERVATIONS_FILE, []);
  const filtered = current.filter((r) => r.id !== id);

  writeJsonFile(RESERVATIONS_FILE, filtered);
  console.log(`[API] Deleted reservation ${id}. Total remaining: ${filtered.length}`);
  res.json({ success: true, remaining: filtered.length });
});

// POST batch delete reservations
app.post('/api/reservations/batch-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'Expected { ids: string[] }' });
  }

  const idSet = new Set(ids);
  const current = readJsonFile<any[]>(RESERVATIONS_FILE, []);
  const filtered = current.filter((r) => !idSet.has(r.id));

  writeJsonFile(RESERVATIONS_FILE, filtered);
  console.log(`[API] Batch deleted ${ids.length} reservations. Total remaining: ${filtered.length}`);
  res.json({ success: true, deleted: ids.length, remaining: filtered.length });
});

// GET all rooms
app.get('/api/rooms', (req, res) => {
  const rooms = readJsonFile<any[]>(ROOMS_FILE, []);
  res.json(rooms);
});

// POST all rooms (Bulk update)
app.post('/api/rooms', (req, res) => {
  const { rooms } = req.body;
  if (!Array.isArray(rooms)) {
    return res.status(400).json({ error: 'Expected array of rooms in { rooms: [...] }' });
  }
  writeJsonFile(ROOMS_FILE, rooms);
  res.json({ success: true, count: rooms.length });
});

// PUT update individual room
app.put('/api/rooms/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const rooms = readJsonFile<any[]>(ROOMS_FILE, []);
  const index = rooms.findIndex((r) => r.id === id);

  if (index >= 0) {
    rooms[index] = { ...rooms[index], ...updates };
    writeJsonFile(ROOMS_FILE, rooms);
    res.json({ success: true, room: rooms[index] });
  } else {
    res.status(404).json({ error: `Room ${id} not found` });
  }
});

// POST reset rooms to official 114
app.post('/api/rooms/reset', (req, res) => {
  const freshRooms = generateSaifeeBurhani114Rooms();
  writeJsonFile(ROOMS_FILE, freshRooms);
  console.log('[API] Reset rooms to official 114 inventory.');
  res.json({ success: true, rooms: freshRooms });
});

// GET settings (config, categories, userRole, adminPin)
app.get('/api/settings', (req, res) => {
  const config = readJsonFile<any>(CONFIG_FILE, {});
  res.json(config);
});

// POST update settings
app.post('/api/settings', (req, res) => {
  const updates = req.body;
  const current = readJsonFile<any>(CONFIG_FILE, {});
  const merged = { ...current, ...updates };
  writeJsonFile(CONFIG_FILE, merged);
  res.json({ success: true, config: merged });
});

// ==========================================
// VITE SPA MIDDLEWARE / STATIC ASSETS
// ==========================================
async function startServer() {
  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[Dev] Vite middleware attached to Express server.');
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
    console.log('[Prod] Serving static build from dist directory.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Zaereen Accommodation Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
