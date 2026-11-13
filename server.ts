import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateSaifeeBurhani114Rooms, generateBadriRooms, INITIAL_RESERVATIONS } from './src/services/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const getCliArg = (flag: string): string | undefined => {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
};
const portArg = getCliArg('--port');
const PORT = portArg
  ? parseInt(portArg, 10)
  : (process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : 3000);
const HOST = getCliArg('--host') || '0.0.0.0';
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

const DEFAULT_CSV_PATH = path.resolve(__dirname, 'public/assets/aistudio/Faiz_Husaini_Zaereen_Accommodation__Saifee___Burhani__6fba9a26');
const DEFAULT_SHEET_NAME = 'Faiz Husaini Zaereen Accommodation (Saifee & Burhani)';

// Robust CSV Line parser respecting double quotes
function parseCSVLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

// Parse attached CSV records into Reservation objects
export function parseAttachedCsvReservations(): any[] {
  if (!fs.existsSync(DEFAULT_CSV_PATH)) {
    console.warn(`[Server] Default CSV not found at: ${DEFAULT_CSV_PATH}`);
    return INITIAL_RESERVATIONS;
  }

  try {
    const content = fs.readFileSync(DEFAULT_CSV_PATH, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length <= 1) return INITIAL_RESERVATIONS;

    const reservations: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      if (!row || row.length < 5) continue;

      const sr = row[0] || String(i);
      const its = row[1] || '';
      const name = row[2] || 'Zaer Guest';
      const age = parseInt(row[3], 10) || 35;
      const family = row[4] || `F-${i}`;
      const officeName = row[5] || 'Faiz E Husayni';
      const tourId = row[6] || '';
      const building = row[7] || '';
      const roomAllotment = row[8] || '';
      const gender = row[9] === 'Female' ? 'Female' : 'Male';
      const groupLead = row[10] || name;
      const rawArrival = row[11] || '';
      const rawDeparture = row[12] || '';
      const rawCategory = row[13] || 'Mumineen';
      const rawSpecial = row[14] || '';
      const rawRemarks = row[15] || '';
      const rawPortal = row[16] || '';
      const requestSlipNo = row[17] || '';
      const paxCount = parseInt(row[18], 10) || 1;
      const lastUpdated = row[19] || '';

      // Extract exact arrival date and time
      const arrParts = rawArrival.split(' ');
      const arrivalDate = arrParts[0] || '2026-11-11';
      const arrivalTime = arrParts.slice(1).join(' ') || '11:00 AM';

      // Extract exact departure date and time
      const depParts = rawDeparture.split(' ');
      const departureDate = depParts[0] || '2026-11-14';
      const departureTime = depParts.slice(1).join(' ') || '01:00 AM';

      const isSpecialGuest = rawSpecial.includes('YES') || rawSpecial.includes('⭐');
      const isUploadedToPortal = /yes|true|uploaded/i.test(rawPortal);
      const category = (rawCategory === '—' || !rawCategory) ? 'Mumineen' : rawCategory;

      reservations.push({
        id: `res-csv-${sr}-${its || i}`,
        itsId: its || `30${100000 + i}`,
        applicantName: name,
        age,
        family,
        familyNo: family,
        officeName,
        tourId,
        tourRefNo: tourId,
        building,
        roomNumber: roomAllotment,
        gender,
        groupLeadName: groupLead,
        guestLeaderName: groupLead,
        arrivalDate,
        departureDate,
        arrivalTime,
        departureTime,
        rawArrivalStr: rawArrival,
        rawDepartureStr: rawDeparture,
        arrivalDateTime: `${arrivalDate}T${arrivalTime}`,
        departureDateTime: `${departureDate}T${departureTime}`,
        category,
        assignedCategory: category,
        isSpecialGuest,
        specialRemarks: rawRemarks || undefined,
        isUploadedToPortal,
        requestSlipNo,
        paxCount,
        pax: paxCount,
        totalGuests: paxCount,
        idara: '',
        shiftToCategoryA: category.includes('Category A') || category === 'B to A',
        moneyGiven: 'No',
        paymentStatus: 'Pending',
        createdAt: new Date().toISOString(),
        updatedAt: lastUpdated || new Date().toISOString(),
      });
    }

    console.log(`[Server] Parsed ${reservations.length} reservations from default attached CSV.`);
    return reservations;
  } catch (err) {
    console.error('[Server] Failed to parse default attached CSV:', err);
    return INITIAL_RESERVATIONS;
  }
}

// Initialize seed data if not present
function initializeData() {
  if (!fs.existsSync(ROOMS_FILE)) {
    console.log('Seeding initial rooms across Saifee, Burhani, Badri, and Qasr Nobola...');
    const initialRooms = [
      ...generateSaifeeBurhani114Rooms(),
      ...generateBadriRooms(),
      {
        id: 'rm-qasr-1',
        roomNumber: '1',
        building: 'Qasr Nobola',
        floor: 1,
        floorLabel: 'Floor 1',
        capacity: 4,
        pax: 4,
        buffer: 0,
        toiletType: 'WESTERN',
        bedType: 'Single Beds',
        category: 'Category A (Nizaam)',
        status: 'available',
        amenities: ['WESTERN Toilet', 'Single Beds', 'Air Conditioning', 'Wi-Fi'],
      },
    ];
    writeJsonFile(ROOMS_FILE, initialRooms);
  } else {
    const existingRooms = readJsonFile<any[]>(ROOMS_FILE, []);
    const hasBadri = existingRooms.some((r) => (r.building || '').toLowerCase() === 'badri');
    const hasQasr = existingRooms.some((r) => (r.building || '').toLowerCase() === 'qasr nobola');
    let updated = [...existingRooms];
    if (!hasBadri) {
      console.log('Adding Badri rooms to server rooms storage...');
      updated = [...updated, ...generateBadriRooms()];
    }
    if (!hasQasr) {
      console.log('Adding Qasr Nobola room to server rooms storage...');
      updated.push({
        id: 'rm-qasr-1',
        roomNumber: '1',
        building: 'Qasr Nobola',
        floor: 1,
        floorLabel: 'Floor 1',
        capacity: 4,
        pax: 4,
        buffer: 0,
        toiletType: 'WESTERN',
        bedType: 'Single Beds',
        category: 'Category A (Nizaam)',
        status: 'available',
        amenities: ['WESTERN Toilet', 'Single Beds', 'Air Conditioning', 'Wi-Fi'],
      });
    }
    if (updated.length !== existingRooms.length) {
      writeJsonFile(ROOMS_FILE, updated);
    }
  }

  // Check if reservations need seeding from the user's default attached Google Sheet
  const existingRes = readJsonFile<any[]>(RESERVATIONS_FILE, []);
  if (!fs.existsSync(RESERVATIONS_FILE) || existingRes.length < 500) {
    console.log('Seeding 1,074 reservations from default attached Google Sheet CSV...');
    const defaultReservations = parseAttachedCsvReservations();
    writeJsonFile(RESERVATIONS_FILE, defaultReservations);
  }

  // Ensure default Google Sheet config is configured
  const currentConfig = readJsonFile<any>(CONFIG_FILE, {});
  const defaultSheetsConfig = {
    spreadsheetId: 'faiz_husaini_attached_default',
    spreadsheetUrl: '/assets/aistudio/Faiz_Husaini_Zaereen_Accommodation__Saifee___Burhani__6fba9a26',
    spreadsheetName: DEFAULT_SHEET_NAME,
    autoSync: false,
    isSyncing: false,
    lastSyncedAt: new Date().toISOString(),
    syncError: null,
  };

  if (!fs.existsSync(CONFIG_FILE) || !currentConfig.sheetsConfig || !currentConfig.sheetsConfig.spreadsheetName) {
    const initialConfig = {
      sheetsConfig: defaultSheetsConfig,
      categories: ['Mumineen', 'Muntasbeen', 'Qasreali', 'Baitezainy'],
      userRole: 'admin',
      adminPin: '1234',
    };
    writeJsonFile(CONFIG_FILE, initialConfig);
  }
}

initializeData();

// Live Multi-Window SSE Clients registry
let sseClients: express.Response[] = [];

function broadcastLiveChange(eventType: string, payload: any = {}) {
  const message = `data: ${JSON.stringify({ type: eventType, timestamp: Date.now(), ...payload })}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(message);
    } catch {
      // client connection closed
    }
  });
}

// ==========================================
// REST API ROUTES (/api/*)
// ==========================================

// SSE stream for real-time live updates across all open windows on this computer
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);
  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

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
  broadcastLiveChange('RESERVATIONS_UPDATED');
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
  broadcastLiveChange('RESERVATIONS_UPDATED', { reservation: updatedRes });
  res.json({ success: true, reservation: updatedRes, total: current.length });
});

// DELETE single reservation
app.delete('/api/reservations/:id', (req, res) => {
  const { id } = req.params;
  const current = readJsonFile<any[]>(RESERVATIONS_FILE, []);
  const filtered = current.filter((r) => r.id !== id);

  writeJsonFile(RESERVATIONS_FILE, filtered);
  console.log(`[API] Deleted reservation ${id}. Total remaining: ${filtered.length}`);
  broadcastLiveChange('RESERVATIONS_UPDATED', { deletedId: id });
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
  broadcastLiveChange('RESERVATIONS_UPDATED', { deletedIds: ids });
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
  broadcastLiveChange('ROOMS_UPDATED');
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
    broadcastLiveChange('ROOMS_UPDATED', { roomId: id });
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
  broadcastLiveChange('ROOMS_UPDATED');
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
  broadcastLiveChange('CONFIG_UPDATED', { config: merged });
  res.json({ success: true, config: merged });
});

// GET default attached sheet info
app.get('/api/sheets/default', (req, res) => {
  const reservations = readJsonFile<any[]>(RESERVATIONS_FILE, []);
  res.json({
    defaultSheetName: DEFAULT_SHEET_NAME,
    spreadsheetId: 'faiz_husaini_attached_default',
    spreadsheetUrl: '/assets/aistudio/Faiz_Husaini_Zaereen_Accommodation__Saifee___Burhani__6fba9a26',
    fileName: 'Faiz_Husaini_Zaereen_Accommodation__Saifee___Burhani__6fba9a26',
    recordsCount: reservations.length,
    description: 'Faiz Husaini Zaereen Accommodation (Saifee & Burhani) Default Attached Google Sheet',
  });
});

// GET default reservations parsed directly from the attached sheet CSV
app.get('/api/sheets/default-reservations', (req, res) => {
  const defaultRes = parseAttachedCsvReservations();
  res.json(defaultRes);
});

// POST reset to default attached sheet
app.post('/api/sheets/reset-default', (req, res) => {
  console.log('[API] Resetting accommodation to default attached Google Sheet (1,074 records)...');
  const freshReservations = parseAttachedCsvReservations();
  writeJsonFile(RESERVATIONS_FILE, freshReservations);

  const defaultSheetsConfig = {
    spreadsheetId: 'faiz_husaini_attached_default',
    spreadsheetUrl: '/assets/aistudio/Faiz_Husaini_Zaereen_Accommodation__Saifee___Burhani__6fba9a26',
    spreadsheetName: DEFAULT_SHEET_NAME,
    autoSync: false,
    isSyncing: false,
    lastSyncedAt: new Date().toISOString(),
    syncError: null,
  };

  const currentConfig = readJsonFile<any>(CONFIG_FILE, {});
  currentConfig.sheetsConfig = defaultSheetsConfig;
  writeJsonFile(CONFIG_FILE, currentConfig);

  broadcastLiveChange('RESERVATIONS_UPDATED');
  broadcastLiveChange('CONFIG_UPDATED', { config: currentConfig });

  res.json({
    success: true,
    message: 'Reset to default attached Google Sheet successfully!',
    count: freshReservations.length,
    sheetsConfig: defaultSheetsConfig,
    reservations: freshReservations,
  });
});

// POST switch to new Google Sheet URL or ID
app.post('/api/sheets/switch', (req, res) => {
  const { spreadsheetId, spreadsheetUrl, spreadsheetName } = req.body;
  if (!spreadsheetId && !spreadsheetUrl) {
    return res.status(400).json({ error: 'Missing spreadsheetId or spreadsheetUrl' });
  }

  const currentConfig = readJsonFile<any>(CONFIG_FILE, {});
  currentConfig.sheetsConfig = {
    ...currentConfig.sheetsConfig,
    spreadsheetId: spreadsheetId || 'custom_sheet',
    spreadsheetUrl: spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    spreadsheetName: spreadsheetName || 'Custom Google Sheet',
    lastSyncedAt: new Date().toISOString(),
    syncError: null,
  };

  writeJsonFile(CONFIG_FILE, currentConfig);
  broadcastLiveChange('CONFIG_UPDATED', { config: currentConfig });
  res.json({ success: true, sheetsConfig: currentConfig.sheetsConfig });
});

// ==========================================
// VITE SPA MIDDLEWARE / STATIC ASSETS
// ==========================================
async function startServer() {
  const httpServer = http.createServer(app);

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
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

  httpServer.listen(PORT, HOST, () => {
    console.log(`🚀 Zaereen Accommodation Server listening on http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
