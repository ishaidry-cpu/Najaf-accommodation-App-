/**
 * The Google Sheet side of the sync:
 *   - 'Zaereen Lodging & Room Allotment Grid'  read only, the whole tab
 *   - 'Sync History'                           append only: the log of every applied run AND the memory of
 *                                              what earlier runs saw (it decides who may be deallocated)
 * Nothing else in the spreadsheet is ever touched.
 */
import { fetchJson, Rejected, withTransportRetry } from './http.js';
import { GoogleSignInError, type GoogleTokenSource } from './googleAuth.js';
import type { HistoryRow, MemoryEntry, SheetRow } from './types.js';
import { familyNo, norm, parseArrival, pyRepr, tupleKey } from './util.js';

export const DEFAULT_SHEET_ID = '1kOWtRpUF9yeN52MmaiWMW7q8ddDEsIyYrvZgv0_t0uw';
export const SHEET_TAB = 'Zaereen Lodging & Room Allotment Grid';
export const HISTORY_TAB = 'Sync History';
export const HISTORY_COLUMNS = ['Run At', 'Action', 'Result', 'Tour ID', 'ITS', 'Name', 'Arrival', 'Sheet Building',
  'Sheet Room', 'NKERP Before', 'NKERP After', 'Nights', 'Details', 'Run ID'];

const HEADERS: Record<string, string[]> = {
  its: ['ITS'], name: ['NAME'], family: ['FAMILY'], ref: ['TOUR ID'], building: ['BUILDING'],
  room: ['ROOM ALLOTTMENT', 'ROOM ALLOTMENT'], arrival: ['ARRIVAL'],
};
const REQUIRED = ['its', 'family', 'ref', 'building', 'room', 'arrival'];

/** A configuration / data problem that must stop the run before anything is planned. */
export class SheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetError';
  }
}

/** A1 range for a tab, quoted the way the Sheets API expects ('It''s' doubles quotes). */
export function a1(tab: string, range?: string): string {
  const quoted = `'${tab.replace(/'/g, "''")}'`;
  return encodeURIComponent(range ? `${quoted}!${range}` : quoted);
}

/** Header lookup + row normalisation (pure; the skill's parse_sheet). */
export function parseSheet(shown: unknown[][], raw: unknown[][]): SheetRow[] {
  if (!shown || !shown.length) throw new SheetError('Sheet tab is empty or unreadable');
  const head = (shown[0] || []).map((h) => norm(h));
  const col: Record<string, number | null> = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const hit = names.map((n) => head.indexOf(n)).find((i) => i >= 0);
    col[key] = hit === undefined ? null : hit;
  }
  const missing = REQUIRED.filter((k) => col[k] === null).map((k) => HEADERS[k][0]);
  if (missing.length) throw new SheetError(`Sheet header changed; missing ${pyRepr(missing)}`);
  const rows: SheetRow[] = [];
  for (let i = 1; i < shown.length; i++) {
    const n = i + 1;
    const vals = shown[i] || [];
    const rvals = i < raw.length ? raw[i] || [] : [];
    const cell = (k: string): unknown => {
      const c = col[k];
      return c !== null && c < vals.length ? vals[c] : '';
    };
    const arrivalCol = col.arrival as number;
    const rcell = arrivalCol < rvals.length ? rvals[arrivalCol] : undefined;
    const textArrival = String(cell('arrival') ?? '').trim();
    rows.push({
      row: n,
      its: String(cell('its') ?? '').trim(),
      name: String(cell('name') ?? '').trim(),
      family: familyNo(cell('family')),
      ref: norm(cell('ref')),
      building: norm(cell('building')),
      room: norm(cell('room')),
      arrival: parseArrival(textArrival, rcell),
      arrival_text: textArrival,
    });
  }
  return rows;
}

/** Thin, authenticated Sheets v4 client for one spreadsheet. */
export class SheetsApi {
  readonly base: string;

  constructor(readonly sheetId: string, private readonly tokens: GoogleTokenSource) {
    this.base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  }

  /** One authenticated call; a 401 refreshes the token once. */
  async call<T = any>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.getToken();
      try {
        const res = await fetchJson<T>(url, {
          method: init.method, body: init.body, timeoutMs: 120_000,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        return res.body;
      } catch (err) {
        if (err instanceof Rejected && err.status === 401 && attempt === 0) {
          this.tokens.invalidate();
          continue;
        }
        throw err;
      }
    }
  }

  async values(tab: string, render: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE', range?: string): Promise<unknown[][]> {
    const q = `valueRenderOption=${render}${render === 'UNFORMATTED_VALUE' ? '&dateTimeRenderOption=SERIAL_NUMBER' : ''}`;
    const body = await withTransportRetry(() => this.call<{ values?: unknown[][] }>(`${this.base}/values/${a1(tab, range)}?${q}`));
    return body?.values ?? [];
  }

  /** The grid tab, parsed. Two reads: what staff see, and raw serials for real date cells in ARRIVAL. */
  async readGrid(): Promise<SheetRow[]> {
    const shown = await this.values(SHEET_TAB, 'FORMATTED_VALUE');
    const raw = await this.values(SHEET_TAB, 'UNFORMATTED_VALUE');
    return parseSheet(shown, raw);
  }
}

/**
 * True only for Google Sheets' answer to a range on a tab that does not exist ("Unable to parse range"). A 400
 * from the Google sign-in, or any other 400, is a real error.
 */
export function isMissingTab(err: unknown): boolean {
  return err instanceof Rejected && !(err instanceof GoogleSignInError) && err.status === 400
    && /unable to parse range/i.test(err.message);
}

/** What the engine needs from the Sync History tab (a fake implements this in tests). */
export interface HistoryStore {
  read(): Promise<HistoryRow[]>;
  /** null when writable, otherwise the reason. */
  ensureWritable(): Promise<string | null>;
  append(rows: HistoryRow[]): Promise<number>;
}

export class SyncHistoryTab implements HistoryStore {
  constructor(private readonly api: SheetsApi) {}

  async read(): Promise<HistoryRow[]> {
    let vals: unknown[][];
    try {
      vals = await withTransportRetry(async () => (await this.api.call<{ values?: unknown[][] }>(
        `${this.api.base}/values/${a1(HISTORY_TAB, 'A:N')}?valueRenderOption=FORMATTED_VALUE`))?.values ?? []);
    } catch (err) {
      if (isMissingTab(err)) return [];   // no Sync History tab yet: the first applied run creates it
      throw err;                           // anything else (a refused Google sign-in above all) must not look empty
    }
    if (!vals.length) return [];
    const head = vals[0].map((h) => String(h ?? '').trim());
    return vals.slice(1).map((row) => {
      const out: HistoryRow = {};
      head.forEach((h, i) => {
        out[h] = i < row.length && row[i] !== null && row[i] !== undefined ? String(row[i]) : '';
      });
      return out;
    });
  }

  async ensureWritable(): Promise<string | null> {
    try {
      const meta = await this.api.call<{ sheets?: { properties: { title: string } }[] }>(
        `${this.api.base}?fields=sheets.properties.title`);
      const titles = (meta.sheets ?? []).map((s) => s.properties.title);
      if (!titles.includes(HISTORY_TAB)) {
        await this.api.call(`${this.api.base}:batchUpdate`, {
          method: 'POST',
          body: { requests: [{ addSheet: { properties: { title: HISTORY_TAB, gridProperties: {
            rowCount: 2000, columnCount: HISTORY_COLUMNS.length, frozenRowCount: 1 } } } }] },
        });
      }
      // A harmless write that proves edit access.
      await this.api.call(`${this.api.base}/values/${a1(HISTORY_TAB, 'A1:N1')}?valueInputOption=RAW`,
        { method: 'PUT', body: { values: [HISTORY_COLUMNS] } });
      return null;
    } catch (err) {
      if (err instanceof GoogleSignInError) return err.message;
      if (err instanceof Rejected) {
        if (err.status === 403) {
          return 'the Google service account can only view the Sheet; share the Sheet with it as Editor so runs '
            + 'can write the Sync History tab';
        }
        return `Sync History tab not writable (HTTP ${err.status})`;
      }
      throw err;
    }
  }

  async append(rows: HistoryRow[]): Promise<number> {
    if (!rows.length) return 0;
    const values = rows.map((r) => HISTORY_COLUMNS.map((c) => (r[c] === undefined || r[c] === null ? '' : String(r[c]))));
    // Never retried: a timed-out append may have landed, and duplicate rows would only add noise.
    await this.api.call(`${this.api.base}/values/${a1(HISTORY_TAB, 'A:N')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: { values } });
    return rows.length;
  }
}

const STATEFUL = new Set(['ALLOCATE', 'REALLOCATE', 'SEEN']);
const CLEARING = new Set([tupleKey('DEALLOCATE', 'done'), tupleKey('CLEARED', 'recorded')]);

/**
 * (TOUR ID, ITS) -> the room the Sheet last showed for that person in earlier runs ('' when cleared).
 * Latest stateful row wins. Only stays arriving on or after `since` are kept. Keys are tupleKey(ref, its).
 */
export function memory(rows: HistoryRow[], since: string): Map<string, MemoryEntry> {
  const mem = new Map<string, MemoryEntry>();
  for (const r of rows) {
    const act = norm(r['Action']);
    const res = String(r['Result'] ?? '').trim().toLowerCase();
    if (!STATEFUL.has(act) && !CLEARING.has(tupleKey(act, res))) continue;
    const ref = norm(r['Tour ID']);
    const its = norm(r['ITS']);
    if (!ref || !its) continue;
    const k = tupleKey(ref, its);
    mem.set(k, {                                     // like a Python dict: the latest row wins, first-seen order kept
      building: norm(r['Sheet Building']), room: norm(r['Sheet Room']),
      arrival: String(r['Arrival'] ?? '').trim().slice(0, 10), name: String(r['Name'] ?? '').trim(),
    });
  }
  for (const [k, v] of mem) {
    if (v.arrival && v.arrival < since) mem.delete(k);
  }
  return mem;
}
