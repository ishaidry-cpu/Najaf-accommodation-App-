/**
 * Differential test: the TypeScript engine against the skill's own Python implementation
 * (../reference/najaf_alloc.py), on hundreds of randomly generated but realistic scenarios: Sheets with
 * typed and serial dates, duplicates, family splits, blank and deleted rows; NKERP with pending applicants,
 * allocated guests, other tours occupying rooms, infants, multi-stay itineraries; Sync History memory; save
 * outcomes that succeed, are refused, time out and land, or time out and are lost; and every run option.
 *
 * For each scenario both engines must produce the same report, the same Sync History rows and the same
 * NKERP save payloads, byte for byte. Needs python3 (standard library only); skipped without it.
 *   PARITY_CASES=2000 PARITY_SEED=7 npm run test:sync
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runSync } from '../engine';
import { parseSheet } from '../sheets';
import type { HistoryRow, NkRecord, RunOptions, SyncAction } from '../types';
import { addDays } from '../util';
import { FakeNKERP, FakeTab, nights, type Occ } from './fakes';

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES = parseInt(process.env.PARITY_CASES || '400', 10);
const SEED = parseInt(process.env.PARITY_SEED || '20261116', 10);

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

const TOURS = ['NKERP/TOUR/2026/2211', 'NKERP/TOUR/2026/3044', 'NKERP/TOUR/2026/4100', 'NKERP/TOUR/2026/5120'];
const OTHER = 'NKERP/TOUR/2026/9999';
const REAL_ROOMS: [string, string][] = [['SAIFEE', '107'], ['SAIFEE', '108'], ['BURHANI', '201']];
const BAD_ROOMS: [string, string][] = [['SAIFEE', '109'], ['BADRI', '103']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HEADER = ['SR', 'ITS', 'NAME', 'AGE', 'FAMILY', 'TOUR ID', 'BUILDING', 'ROOM ALLOTTMENT', 'ARRIVAL'];

function serial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86_400_000);
}

interface Scenario {
  shown: unknown[][];
  raw: unknown[][];
  apps: NkRecord[];
  occ: Occ[];
  mode: string | string[];
  capacity: number;
  history: HistoryRow[];
  hist_error: string | null;
  options: RunOptions & { today: string };
}

function scenario(seed: number): Scenario {
  const r = rng(seed);
  const today = addDays('2026-11-16', r.int(-2, 3));
  const shown: unknown[][] = [HEADER];
  const raw: unknown[][] = [HEADER];
  const apps: NkRecord[] = [];
  const occ: Occ[] = [];
  const history: HistoryRow[] = [];
  let aid = 1;
  let its = 40000000;
  const tours = TOURS.slice(0, r.int(1, TOURS.length));
  const roomFor = (): [string, string] => (r.chance(0.08) ? r.pick(BAD_ROOMS) : r.pick(REAL_ROOMS));
  const arrivalText = (iso: string): [unknown, unknown] => {
    const [y, m, d] = iso.split('-');
    switch (r.int(0, 7)) {
      case 0: return [iso, iso];
      case 1: return [`${d}-${m}-${y}`, `${d}-${m}-${y}`];
      case 2: return [`${d}/${m}/${y}`, `${d}/${m}/${y}`];
      case 3: return [`${d}-${MONTHS[+m - 1]}-${y}`, `${d}-${MONTHS[+m - 1]}-${y}`];
      case 4: return [`${iso} 10:30`, `${iso} 10:30`];
      case 5: return [`${+m}/${+d}/${y}`, serial(iso)];          // a real date cell shown US-style
      case 6: return [r.chance(0.5) ? 'TBC' : '', r.chance(0.5) ? 'TBC' : ''];
      default: return [`${d}.${m}.${y}`, `${d}.${m}.${y}`];
    }
  };
  for (const ref of tours) {
    const tourId = parseInt(ref.split('/').pop()!, 10);
    const arrival = addDays(today, r.int(-6, 6));
    const n = r.int(1, 6);
    for (let k = 0; k < n; k++) {
      const personIts = String(its++);
      const id = aid++;
      const fam = r.chance(0.7) ? `F-${r.int(1, 3)}` : null;
      const myArrival = r.chance(0.85) ? arrival : addDays(arrival, r.int(-2, 2));
      const departure = addDays(myArrival, r.int(0, 3));
      const room = roomFor();
      const infant = r.chance(0.1);
      // ---- NKERP state
      const state = r.pick(['pending', 'pending', 'allocated', 'allocated', 'absent'] as const);
      if (state === 'pending') {
        const sub = nights(myArrival, departure).map((x) => ({ ...x, isPreviousAssigned: r.chance(0.1), isFull: r.chance(0.05) }));
        const stays = [{ ArrivalDate: `${myArrival}T11:00:00`, DepartureDate: `${departure}T08:00:00` }];
        if (r.chance(0.1)) stays.push({ ArrivalDate: `${addDays(departure, 5)}T11:00:00`, DepartureDate: `${addDays(departure, 6)}T08:00:00` });
        apps.push({ ApplicantinTourId: id, TourID: tourId, TourRefenceNO: r.chance(0.1) ? ref.toLowerCase() : ref, ITSId: personIts,
          FamilyName: fam, ApplicantName: ` P${id} `, GenderName: r.pick(['Male', 'Female']), IsInfant: infant,
          TourIternaryDates: stays, lstSubVenueDates: sub });
      } else if (state === 'allocated') {
        const isReal = REAL_ROOMS.some(([b, rm]) => b === room[0] && rm === room[1]);
        const where = isReal && r.chance(0.5) ? room : r.pick(REAL_ROOMS);
        for (let d = myArrival; d <= departure; d = addDays(d, 1)) occ.push([where[0], where[1], d, id, personIts, ref]);
      }
      // ---- Sheet rows
      const sheetShape = r.pick(['room', 'room', 'room', 'blank', 'missing', 'dupe', 'noits'] as const);
      const [shownArr, rawArr] = arrivalText(myArrival);
      const famCell = fam ? r.pick([fam, fam.replace('-', ''), fam.replace('F-', '')]) : '';
      const base = (b: string, rm: string, itsCell = personIts) => [String(shown.length), itsCell, `P${id}`, '30', famCell, ref,
        b, rm];
      if (sheetShape !== 'missing') {
        const [b, rm] = sheetShape === 'blank' ? ['', ''] : room;
        const titleB = b ? b[0] + b.slice(1).toLowerCase() : '';
        shown.push([...base(titleB, rm, sheetShape === 'noits' ? '' : personIts), shownArr]);
        raw.push([...base(titleB, rm, sheetShape === 'noits' ? '' : personIts), rawArr]);
        if (sheetShape === 'dupe') {
          const other = r.pick(REAL_ROOMS);
          shown.push([...base(other[0], other[1]), shownArr]);
          raw.push([...base(other[0], other[1]), rawArr]);
        }
      }
      // ---- Sync History memory
      if (r.chance(0.45)) {
        const [b, rm] = r.chance(0.6) ? room : r.pick([...REAL_ROOMS, ['', ''] as [string, string]]);
        const [action, result] = r.pick([['SEEN', 'recorded'], ['ALLOCATE', 'done'], ['REALLOCATE', 'held'],
          ['DEALLOCATE', 'done'], ['DEALLOCATE', 'refused'], ['CLEARED', 'recorded'], ['ALLOCATE', 'refused']] as const);
        history.push({ 'Run At': '2026-11-10 09:00', Action: action, Result: result, 'Tour ID': ref, ITS: personIts,
          Name: `P${id}`, Arrival: r.chance(0.9) ? myArrival : addDays(today, -40), 'Sheet Building': b ? b[0] + b.slice(1).toLowerCase() : '',
          'Sheet Room': rm, 'NKERP Before': '', 'NKERP After': '', Nights: '', Details: '', 'Run ID': '20261110-090000' });
      }
    }
  }
  // other tours already in rooms (capacity clashes and turnovers)
  for (let k = 0, n = r.int(0, 4); k < n; k++) {
    const [b, rm] = r.pick(REAL_ROOMS);
    const start = addDays(today, r.int(-3, 5));
    const id = 900 + k;
    for (let d = start, end = addDays(start, r.int(0, 3)); d <= end; d = addDays(d, 1)) occ.push([b, rm, d, id, String(99000 + k), OTHER]);
  }
  // a busy Sheet has many old rows (the "fewer than 10 rooms" guard)
  if (r.chance(0.7)) {
    for (let k = 0; k < 10; k++) {
      const old = ['x', String(91000 + k), 'Old', '40', 'F-1', 'NKERP/TOUR/2025/1', 'Saifee', '107', '2025-01-01'];
      shown.push(old);
      raw.push(old);
    }
  }
  const modes = ['ok', 'ok', 'ok', 'refused', 'timeout_landed', 'timeout_lost'];
  const only: SyncAction[] | undefined = r.chance(0.2)
    ? (['allocate', 'reallocate', 'deallocate'] as SyncAction[]).filter(() => r.chance(0.6)) : undefined;
  return {
    shown, raw, apps, occ,
    mode: r.chance(0.75) ? 'ok' : Array.from({ length: 60 }, () => r.pick(modes)),
    capacity: r.int(1, 4),
    history,
    hist_error: r.chance(0.08) ? 'view only' : null,
    options: {
      apply: r.chance(0.7), today,
      ...(only && only.length ? { only } : {}),
      ...(r.chance(0.15) ? { limit: r.int(1, 3) } : {}),
      ...(r.chance(0.1) ? { allowOverCapacity: true } : {}),
      ...(r.chance(0.2) ? { maxDeallocations: r.int(0, 2) } : {}),
      ...(r.chance(0.1) ? { allowMassDeallocation: true } : {}),
    },
  };
}

async function runTs(sc: Scenario) {
  const fake = new FakeNKERP({ apps: structuredClone(sc.apps), mode: sc.mode as any, capacity: sc.capacity, occ: structuredClone(sc.occ) });
  const tab = new FakeTab(structuredClone(sc.history), sc.hist_error);
  try {
    const sheet = parseSheet(sc.shown, sc.raw);
    const { report } = await runSync(sc.options, { nkerp: fake, readSheet: async () => sheet, history: tab, concurrency: 3 });
    for (const h of tab.appended) {
      delete h['Run At'];
      delete h['Run ID'];
    }
    return JSON.parse(JSON.stringify({ report, writes: fake.writes, appended: tab.appended }));
  } catch (err) {
    return { error: `${(err as Error).name}: ${(err as Error).message}` };
  }
}

function firstDiff(a: unknown, b: unknown, at = '$'): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      const d = firstDiff((a as any)[k], (b as any)[k], `${at}.${k}`);
      if (d) return d;
    }
    return null;          // same content, different key order (not a difference for JSON consumers)
  }
  return `${at}: ts=${JSON.stringify(a)} py=${JSON.stringify(b)}`;
}

const python = spawnSync('python3', ['--version']);

it(`matches the skill's Python implementation on ${CASES} random scenarios`, { skip: python.status !== 0 && 'python3 not available' }, async () => {
  const scenarios = Array.from({ length: CASES }, (_, i) => scenario(SEED + i));
  // The Python reference reads parsed rows; give it the same grid through its own parse_sheet.
  const forPy = scenarios.map((sc) => ({ ...sc, sheet: null }));
  const py = spawnSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(here)})
import parity_driver as d
scs = json.load(sys.stdin)
out = []
for sc in scs:
    try:
        sc['sheet'] = d.m.parse_sheet(sc['shown'], sc['raw'])
    except BaseException as exc:
        out.append({'error': type(exc).__name__ + ': ' + str(exc)})
        continue
    out.append(d.one(sc))
json.dump(out, sys.stdout, ensure_ascii=False)
`], { input: JSON.stringify(forPy), maxBuffer: 1 << 30, encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const expected = JSON.parse(py.stdout);
  let compared = 0;
  const stats = { writes: 0, done: 0, planned: 0, problems: 0, history: 0, stopped: 0, errors: 0 };
  for (let i = 0; i < scenarios.length; i++) {
    const got = await runTs(scenarios[i]);
    const want = expected[i];
    if (want.error || got.error) {
      stats.errors++;
      assert.ok(want.error && got.error, `case ${SEED + i}: only one side failed: ts=${got.error} py=${want.error}`);
      continue;
    }
    const diff = firstDiff(got, want);
    assert.equal(diff, null, `case seed ${SEED + i} differs at ${diff}`);
    compared++;
    stats.writes += want.writes.length;
    stats.done += want.report.done.length;
    stats.planned += want.report.planned.length;
    stats.problems += want.report.problems.length;
    stats.history += want.appended.length;
    stats.stopped += want.report.stopped ? 1 : 0;
  }
  // The generator must actually exercise the engine, not produce trivial scenarios.
  assert.ok(stats.writes > CASES / 2 && stats.planned > CASES / 4 && stats.problems > CASES / 4 && stats.stopped > 3,
    `scenarios too trivial: ${JSON.stringify(stats)}`);
  console.log(`parity: ${compared} scenarios identical; ${JSON.stringify(stats)}`);
});
