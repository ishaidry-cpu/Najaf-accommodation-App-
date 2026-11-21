import type { HistoryRow, MemoryEntry, SheetRow } from './types.js';
import { familyNo, norm, parseArrival, pyRepr, tupleKey } from './util.js';

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

export interface HistoryStore {
  read(): Promise<HistoryRow[]>;
  /** null when writable, otherwise the reason. */
  ensureWritable(): Promise<string | null>;
  append(rows: HistoryRow[]): Promise<number>;
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
