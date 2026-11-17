/** Test doubles: an in-memory NKERP with the same behaviour as the skill's FakeNKERP, and a fake Sync History. */
import { runSync } from '../engine';
import { Rejected, type NkerpApi } from '../nkerpClient';
import type { HistoryStore } from '../sheets';
import type { HistoryRow, NkRecord, RunOptions, SheetRow } from '../types';
import { addDays, familyNo, norm, parseArrival } from '../util';

export const T1 = 'NKERP/TOUR/2026/2211';
export const T2 = 'NKERP/TOUR/2026/3044';
export const ROOMS: Record<string, number> = { 'SAIFEE|107': 1, 'SAIFEE|108': 2, 'BURHANI|201': 3 };
export const PIDS: Record<string, number> = { SAIFEE: 5, BURHANI: 6 };

export function nights(a: string, b: string) {
  const out: NkRecord[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) {
    out.push({ ArrivalDate: `${d}T00:00:00`, isAssigned: false, isPreviousAssigned: false, isFull: false });
  }
  return out;
}

export function days(a: string, b: string): string[] {
  return nights(a, b).map((n) => n.ArrivalDate.slice(0, 10));
}

export function app(aid: number, ref: string, its: string, fam: string | null = null, arr = '2026-11-20', dep = '2026-11-22',
  infant = false, tid?: number): NkRecord {
  return {
    ApplicantinTourId: aid, TourID: tid ?? parseInt(ref.split('/').pop()!, 10), TourRefenceNO: ref, ITSId: its,
    FamilyName: fam, ApplicantName: `P${aid} `, GenderName: 'Male', IsInfant: infant,
    TourIternaryDates: [{ ArrivalDate: `${arr}T11:00:00`, DepartureDate: `${dep}T08:00:00` }],
    lstSubVenueDates: nights(arr, dep),
  };
}

export function row(n: number, its: string, ref: string, building = 'SAIFEE', room = '107', arrival = '2026-11-20',
  family = 'F-1'): SheetRow {
  return { row: n, its, name: 'x', family: familyNo(family), ref: norm(ref), building: norm(building), room: norm(room),
    arrival: parseArrival(arrival), arrival_text: arrival };
}

export function hist(action: string, result: string, ref: string, its: string, building = 'Saifee', room = '107',
  arrival = '2026-11-20'): HistoryRow {
  return { Action: action, Result: result, 'Tour ID': ref, ITS: its, 'Sheet Building': building, 'Sheet Room': room,
    Arrival: arrival, Name: 'x' };
}

/** Ten old rows: a real Sheet has many; deallocation is held when the Sheet shows fewer than 10 rooms. */
export const FILL: SheetRow[] = Array.from({ length: 10 }, (_, i) =>
  row(100 + i, String(9000 + i), 'NKERP/TOUR/2025/1', 'SAIFEE', '107', '2025-01-01'));

/** (building, room, day, applicant id, ITS, tour ref) */
export type Occ = [string, string, string, number, string, string];

export function placed(b: string, rno: string, d1: string, d2: string, aid: number, its: string, ref: string): Occ[] {
  return days(d1, d2).map((d) => [b, rno, d, aid, its, ref] as Occ);
}

type Mode = 'ok' | 'refused' | 'timeout_landed' | 'timeout_lost';

function timeoutError(): Error {
  const e = new Error('');
  e.name = 'TimeoutError';
  return e;
}

export class FakeNKERP implements NkerpApi {
  readonly apps: NkRecord[];
  readonly mode: Mode | Mode[];
  readonly capacity: number;
  occ: Occ[];
  readonly writes: [string, any][] = [];
  private ids = new Map<string, number>();

  constructor({ apps = [], mode = 'ok', capacity = 4, occ = [] }:
    { apps?: NkRecord[]; mode?: Mode | Mode[]; capacity?: number; occ?: Occ[] } = {}) {
    this.apps = [...apps];
    this.mode = mode;
    this.capacity = capacity;
    this.occ = [...occ];
  }

  private currentMode(): Mode {
    const k = this.writes.length - 1;
    return Array.isArray(this.mode) ? this.mode[k] : this.mode;
  }

  private finish(mode: Mode) {
    if (mode.startsWith('timeout')) throw timeoutError();
    if (mode === 'refused') throw new Rejected('NKERP refused save: room locked');
    return { ReturnStatus: true };
  }

  private rowId(b: string, rno: string, d: string): number {
    const k = `${b}|${rno}|${d}`;
    if (!this.ids.has(k)) this.ids.set(k, 1000 + this.ids.size);
    return this.ids.get(k)!;
  }

  async pending() {
    return this.apps;
  }

  async buildings() {
    return { ...PIDS };
  }

  async properties() {
    return { ...PIDS };
  }

  async rooms(pid: unknown) {
    const b = Object.keys(PIDS).find((k) => PIDS[k] === pid)!;
    const out: Record<string, NkRecord> = {};
    for (const [key, rid] of Object.entries(ROOMS)) {
      const [bb, rno] = key.split('|');
      if (bb !== b) continue;
      const perDay = new Map<string, NkRecord[]>();
      for (const [ob, orr, d, aid, , ref] of this.occ) {
        if (ob === bb && orr === rno) {
          if (!perDay.has(d)) perDay.set(d, []);
          perDay.get(d)!.push({ ApplicantId: aid, IsInfant: false, TourReferenceNo: ref });
        }
      }
      out[rno] = { Id: rid, RoomNumber: rno, TotalCapacity: this.capacity, PropertyName: b[0] + b.slice(1).toLowerCase(),
        AccomodationRoomAllocatedDatesNew: [...perDay].map(([d, xs]) => ({ OccupiedDate: `${d}T00:00:00`, IsActive: true,
          RoomAllocatedDates_Current: xs })) };
    }
    return out;
  }

  async current(ref: string) {
    const rows = new Map<string, NkRecord>();
    for (const [b, rno, d, aid, its, r] of this.occ) {
      if (r !== ref) continue;
      const k = `${b}|${rno}|${d}`;
      if (!rows.has(k)) {
        rows.set(k, { Id: this.rowId(b, rno, d), OccupiedDate: `${d}T00:00:00`, PropertyName: b[0] + b.slice(1).toLowerCase(),
          RoomNo: rno, RoomDetailId: ROOMS[`${b}|${rno}`], PropertyId: PIDS[b], RoomAllocatedDates_Current: [] });
      }
      rows.get(k)!.RoomAllocatedDates_Current.push({ ApplicantId: aid, AppicantITSId: its, ApplicantName: `P${aid}`,
        TourReferenceNo: r, TourId: 1, IsInfant: false, Family: '' });
    }
    return [...rows.values()];
  }

  async save(body: any) {
    this.writes.push(['allocate', body]);
    const mode = this.currentMode();
    if (mode === 'ok' || mode === 'timeout_landed') {
      const rid = body.lstAccomodationRoomAllocatedDates[0].RoomDetailId;
      const [b, rno] = Object.keys(ROOMS).find((k) => ROOMS[k] === rid)!.split('|');
      for (const e of body.lstAccomodationRoomAllocatedDates) {
        for (const x of e.RoomAllocatedDates_Current) this.occ.push([b, rno, e.OccupiedDate.slice(0, 10), x.ApplicantId, '?', '?']);
      }
    }
    return this.finish(mode);
  }

  async reallocate(body: any) {
    this.writes.push(['reallocate', body]);
    const mode = this.currentMode();
    if (mode === 'ok' || mode === 'timeout_landed') {
      for (const e of body.DeallocateList) {
        const [b, rno] = Object.keys(ROOMS).find((k) => ROOMS[k] === e.RoomDetailId)!.split('|');
        for (const x of e.RoomAllocatedDates_Current) {
          const d = e.OccupiedDate.slice(0, 10);
          this.occ = this.occ.filter((o) => !(o[3] === x.ApplicantId && o[2] === d));
          this.occ.push([b, rno, d, x.ApplicantId, x.AppicantITSId, x.TourReferenceNo]);
        }
      }
    }
    return this.finish(mode);
  }

  async deallocate(body: any) {
    this.writes.push(['deallocate', body]);
    const mode = this.currentMode();
    if (mode === 'ok' || mode === 'timeout_landed') {
      for (const e of body.DeallocateList) {
        for (const x of e.RoomAllocatedDates_Current) {
          this.occ = this.occ.filter((o) => !(o[3] === x.ApplicantId && o[2] === e.OccupiedDate.slice(0, 10)));
        }
      }
    }
    return this.finish(mode);
  }
}

export class FakeTab implements HistoryStore {
  readonly rows: HistoryRow[];
  readonly appended: HistoryRow[] = [];
  constructor(rows: HistoryRow[] = [], readonly error: string | null = null) {
    this.rows = [...rows];
  }

  async read() {
    return this.rows;
  }

  async ensureWritable() {
    return this.error;
  }

  async append(rows: HistoryRow[]) {
    this.appended.push(...rows);
    return rows.length;
  }
}

export async function go(sheet: SheetRow[], fake: FakeNKERP, opts: Partial<RunOptions> & { tab?: FakeTab } = {}) {
  const tab = opts.tab ?? new FakeTab();
  const { tab: _t, ...rest } = opts;
  const { report } = await runSync({ apply: true, today: '2026-11-16', ...rest },
    { nkerp: fake, readSheet: async () => sheet, history: tab, concurrency: 2 });
  return { rep: report, tab };
}
