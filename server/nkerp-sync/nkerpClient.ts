/**
 * NKERP API client (https://to.najafkarbala.com/NKERPApi/), the same calls the Manage Accommodation
 * screens make. Endpoint contracts: the skill's references/nkerp-api.md.
 *
 * Safety properties:
 *   - Only endpoints on the READ or WRITE allow-lists can be called; anything else throws.
 *   - Writes are refused unless the client was built with allowWrite (a dry run can never write).
 *   - Reads are retried on transport failures and re-login once on 401; writes are NEVER retried.
 *   - Lists are paged defensively: a short or repeated page aborts instead of planning on partial data.
 *   - The session cookies live in memory only.
 */
import { BadResponse, fetchJson, Rejected, TransportError, withTransportRetry } from './http.js';
import { nkerpLogin } from './credentials.js';
import type { NkRecord } from './types.js';
import { norm } from './util.js';
import { harvestPhotos, type PhotoSink } from '../nkerp-photos.js';

export const BASE = 'https://to.najafkarbala.com/NKERPApi/';
const ORIGIN = 'https://to.najafkarbala.com';
export const ROLE = 74;      // Tour and Accomodation Admin
export const VENUE = 2;      // IRAQ
export const NAJAF = 3;      // NAJAF sub-venue (KARBALA is 4 and is never touched)

export const SEARCH = 'api/property/getRoomallocationSearchResult';            // Manage Room Allocation: unallocated people
export const BUILDINGS = 'api/Property/getPropertyDetailListForAllocation';
export const ROOMS = 'api/Property/getRoomsDetailsforAllocation';
export const CURRENT = 'api/Property/getRoomDetailsforDeallocation';           // Manage Room Deallocation search: who is where
export const PROPERTIES = `api/dropdown/getPropertybySubvenueId/${NAJAF}`;      // property names -> ids (Najaf)
export const SAVE = 'api/Property/saveRoomallocationApplicantsDetails';        // Assign Room
export const REALLOC = 'api/Property/saveRoomReallocationApplicantsDetails';   // Manage Room Reallocation save
export const DEALLOC = 'api/Property/DeallocateApplicants';                    // Manage Room Deallocation save
export const READS: readonly string[] = [SEARCH, BUILDINGS, ROOMS, CURRENT, PROPERTIES];
export const WRITES: readonly string[] = [SAVE, REALLOC, DEALLOC];

const LOGIN = 'api/accounts/Login';
const SECTION = `api/user/GetSectionIdByGroupId/${ROLE}`;

/** The engine's view of NKERP (the real client below, or a fake in tests). */
export interface NkerpApi {
  pending(): Promise<NkRecord[]>;
  current(ref: string): Promise<NkRecord[]>;
  properties(): Promise<Record<string, unknown>>;
  buildings(tourIds: unknown[], dates: string[]): Promise<Record<string, unknown>>;
  rooms(propertyId: unknown, tourIds: unknown[], dates: string[]): Promise<Record<string, NkRecord>>;
  save(payload: unknown): Promise<unknown>;
  reallocate(payload: unknown): Promise<unknown>;
  deallocate(payload: unknown): Promise<unknown>;
}

/** Minimal RFC 6265 cookie store for a single host. */
export class CookieJar {
  private readonly jar = new Map<string, { value: string; expires: number | null }>();

  set(name: string, value: string, expires: number | null = null): void {
    this.jar.set(name, { value, expires });
  }

  absorb(headers: Headers, now = Date.now()): void {
    const list = typeof (headers as any).getSetCookie === 'function'
      ? (headers as any).getSetCookie() as string[]
      : (headers.get('set-cookie') ? [headers.get('set-cookie') as string] : []);
    for (const line of list) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let expires: number | null = null;
      for (const attr of attrs) {
        const [k, ...v] = attr.split('=');
        const key = k.trim().toLowerCase();
        const val = v.join('=').trim();
        if (key === 'max-age') {
          const secs = parseInt(val, 10);
          if (!Number.isNaN(secs)) expires = now + secs * 1000;
        } else if (key === 'expires' && expires === null) {
          const t = Date.parse(val);
          if (!Number.isNaN(t)) expires = t;
        }
      }
      if (expires !== null && expires <= now) this.jar.delete(name);
      else this.jar.set(name, { value, expires });
    }
  }

  header(now = Date.now()): string {
    const out: string[] = [];
    for (const [name, c] of this.jar) {
      if (c.expires !== null && c.expires <= now) {
        this.jar.delete(name);
        continue;
      }
      out.push(`${name}=${c.value}`);
    }
    return out.join('; ');
  }

  clear(): void {
    this.jar.clear();
  }
}

export interface NkerpClientOptions {
  allowWrite?: boolean;
  /** The endpoints this client may call (default: the room sync's). The email client gets its own lists. */
  endpoints?: { reads: readonly string[]; writes: readonly string[] };
  /** Cancels in-flight *reads* (never writes). */
  signal?: AbortSignal;
  /** Read-only pulls: receives each zair photo (`ImageUrl`) found in listed rows. Without it photos are dropped. */
  onPhoto?: PhotoSink;
  /** Injection points for tests. */
  credentials?: () => { loginId: string; password: string };
  retryDelayMs?: number;
  timeoutMs?: number;
}

export class NkerpClient implements NkerpApi {
  readonly allowWrite: boolean;
  private readonly reads: readonly string[];
  private readonly writes: readonly string[];
  private cookies = new CookieJar();
  private ready = false;
  private loggingIn: Promise<void> | null = null;
  private readonly signal?: AbortSignal;
  private readonly onPhoto?: PhotoSink;
  private readonly creds: () => { loginId: string; password: string };
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  /** Count of HTTP calls by endpoint, for the run log. */
  readonly calls: Record<string, number> = {};

  constructor(opts: NkerpClientOptions = {}) {
    this.allowWrite = Boolean(opts.allowWrite);
    this.reads = opts.endpoints?.reads ?? READS;
    this.writes = opts.endpoints?.writes ?? WRITES;
    this.signal = opts.signal;
    this.onPhoto = opts.allowWrite ? undefined : opts.onPhoto;
    this.creds = opts.credentials ?? (() => nkerpLogin());
    this.retryDelayMs = opts.retryDelayMs ?? 3000;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
  }

  private reset(): void {
    this.cookies = new CookieJar();
    this.ready = false;
  }

  /** One HTTP call. Rejected = NKERP answered and refused (HTTP error or IsError). */
  private async req(path: string, body?: unknown, signal?: AbortSignal): Promise<NkRecord> {
    this.calls[path] = (this.calls[path] ?? 0) + 1;
    const headers: Record<string, string> = {
      Accept: 'application/json', 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`,
    };
    const cookie = this.cookies.header();
    if (cookie) headers.Cookie = cookie;
    let res;
    try {
      res = await fetchJson(BASE + path, { method: body === undefined ? 'GET' : 'POST', headers, body,
        timeoutMs: this.timeoutMs, signal });
    } catch (err) {
      if (err instanceof Rejected) throw new Rejected(`NKERP HTTP ${err.status} on ${path}`, err.status);
      throw err;
    }
    this.cookies.absorb(res.headers);
    const obj = res.body;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.IsError) {
      const msg = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj.ReturnMessage : undefined;
      throw new Rejected(`NKERP refused ${path}: ${msg === undefined || msg === null ? 'None' : msg}`);
    }
    return obj as NkRecord;
  }

  /** Log in once (concurrent callers share the same attempt). */
  async login(): Promise<void> {
    if (this.ready) return;
    if (!this.loggingIn) {
      this.loggingIn = this.doLogin().finally(() => {
        this.loggingIn = null;
      });
    }
    return this.loggingIn;
  }

  private async doLogin(): Promise<void> {
    const { loginId, password } = this.creds();
    let r: NkRecord;
    try {
      r = await withTransportRetry(() => this.req(LOGIN, {
        LocalUTCTime: new Date().toISOString(), LoginId: loginId, Password: password,
      }, this.signal), 3, this.retryDelayMs, this.signal);
    } catch (err) {
      if (err instanceof Rejected) {
        throw new Rejected(`NKERP login failed or the Tour and Accomodation Admin role is missing (NKERP answered ${err.message.replace(/^NKERP /, '')})`, err.status);
      }
      throw err;
    }
    const roles = String(r.Role ?? '').split(',');
    if (!(r.ReturnStatus && r.IsAuthenicated) || !roles.includes(String(ROLE))) {
      throw new Error('NKERP login failed or the Tour and Accomodation Admin role is missing');
    }
    await withTransportRetry(() => this.req(SECTION, undefined, this.signal), 3, this.retryDelayMs, this.signal);
    this.cookies.set('GroupId', String(ROLE));
    this.cookies.set('UserId', String(r.UserId));
    this.ready = true;
  }

  /** POST (or GET when body is undefined) to an allow-listed read endpoint, with retries. */
  async read(path: string, body?: unknown): Promise<NkRecord> {
    if (!this.reads.includes(path)) throw new Error('not a read endpoint');
    let relogged = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.signal?.aborted) throw new Error('cancelled');
      await this.login();
      try {
        return await this.req(path, body, this.signal);
      } catch (err) {
        if (err instanceof Rejected && err.status === 401 && !relogged) {   // expired session: log in again once
          this.reset();
          relogged = true;
          continue;
        }
        if (err instanceof TransportError && attempt < 2 && !this.signal?.aborted) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`NKERP read failed: ${path}`);
  }

  /** One write to an allow-listed write endpoint. Never retried, never aborted mid-flight. */
  async write(path: string, body: unknown): Promise<NkRecord> {
    if (!this.writes.includes(path)) throw new Error('not a write endpoint');
    if (!this.allowWrite) throw new Error('write disabled (dry run)');
    await this.login();
    return this.req(path, body);
  }

  /**
   * All pages of a list. `rawCount`: NKERP's total counts rows it sends twice (the tour accommodation list
   * repeats a tour as identical rows), so compare the rows received, not the unique ones, with TotalRows.
   */
  async paged(path: string, body: NkRecord, listKey: string, key: (a: NkRecord) => string,
    opts: { rawCount?: boolean } = {}): Promise<NkRecord[]> {
    const out: NkRecord[] = [];
    const seen = new Set<string>();
    let received = 0;
    let lastPage = '';
    for (let page = 1; ; page++) {
      const r = await this.read(path, { ...body, currentPage: page });
      const chunk: NkRecord[] = r[listKey] || [];
      const total = parseInt(String(r.TotalRows ?? 0), 10) || 0;
      received += chunk.length;
      let fresh = 0;
      for (const a of chunk) {
        if (this.onPhoto) harvestPhotos(a, this.onPhoto);
        delete a.ImageUrl;
        const k = key(a);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(a);
          fresh++;
        }
      }
      if ((opts.rawCount ? received : seen.size) >= total) return out;
      if (!chunk.length) throw new Error(`NKERP list stopped at ${opts.rawCount ? received : seen.size} of ${total} rows; not planning on a partial list`);
      const sig = JSON.stringify(chunk.map(key));
      if (opts.rawCount ? sig === lastPage : !fresh) throw new Error('NKERP repeated a page of a list; not planning on a partial list');
      lastPage = sig;
    }
  }

  /** Every Najaf applicant that still has unallocated dates (the Manage Room Allocation list). */
  pending(): Promise<NkRecord[]> {
    const body = {
      ArrivalFromDate: null, ArrivalToDate: null, Category: '', DepartureFromDate: null, DepartureToDate: null,
      FamilyID: '', GenderID: '', HOFID: null, RazaCode: null, Idara: '', IsRoomAllocationRole: false, OfficeName: '',
      PackageId: '', ItsID: '', PropertyId: null, SubVenueID: String(NAJAF), TimeZone: 3, TourRefenceNO: '',
      VenueID: String(VENUE), isDST: false, itemsPerPage: 200, maxSize: 10, reverse: true, sortBy: 'ModifiedOn',
    };
    return this.paged(SEARCH, body, 'lstAllocationApllicationDetails',
      (a) => JSON.stringify([a.ApplicantinTourId, a.TourID]));
  }

  /** One tour's allocated Najaf room-nights (Manage Room Deallocation search by Tour Reference No.). */
  current(ref: string): Promise<NkRecord[]> {
    return this.currentForTours([ref]);
  }

  currentForTours(refs: string[], from?: string): Promise<NkRecord[]> {
    if (!refs.length) return Promise.resolve([]);
    const body = {
      FamilyID: '', FloorNo: '', OccupiedDateFrom: from ?? null, OccupiedDateTo: null, PropertyId: [], RoomNo: '',
      RoomTypeId: '', SubVenueID: String(NAJAF), TimeZone: 3, TourRefenceNO: refs, VenueID: String(VENUE),
      itemsPerPage: 500, maxSize: 10, reverse: false, sortBy: 'OccupiedDate',
    };
    return this.paged(CURRENT, body, 'lstAllocationDetails',
      (r) => JSON.stringify(r.Id || [r.RoomDetailId ?? null, r.OccupiedDate ?? null]));
  }

  async properties(): Promise<Record<string, unknown>> {
    const r = await this.read(PROPERTIES);
    const out: Record<string, unknown> = {};
    for (const p of r.Properties || []) out[norm(p.Text)] = p.Value;
    return out;
  }

  async buildings(tourIds: unknown[], dates: string[]): Promise<Record<string, unknown>> {
    const r = await this.read(BUILDINGS, {
      IsGroundfloor: null, IsHouseKeepingAvailable: null, IsBasement: null, IsLift: null, IsRented: null,
      PersonTypeId: '', SubVenueId: NAJAF, PropertyGradeId: 0, VenueId: VENUE, maxSize: 10, reverse: false,
      sortBy: 'ModifiedOn', PropertyTypeId: 0, TourIds: tourIds, PropertyName: '', RoomTypeId: 0,
      AssignedDateList: dates, RentPeriodStartDate: dates[0], RentPeriodEndDate: dates[dates.length - 1],
      currentPage: 1, itemsPerPage: 100,
    });
    const rows: NkRecord[] = r.PropertyDetailListView || [];
    if ((parseInt(String(r.TotalRows ?? 0), 10) || 0) > rows.length) throw new Error('NKERP building list has more than one page');
    const out: Record<string, unknown> = {};
    for (const p of rows) out[norm(p.PropertyName)] = p.Id;
    return out;
  }

  /** All rooms of a building (Show Occupied on), with their existing allocations on these dates. */
  async rooms(propertyId: unknown, tourIds: unknown[], dates: string[]): Promise<Record<string, NkRecord>> {
    const r = await this.read(ROOMS, {
      AssignedDateList: dates, IsBasement: null, IsGroundfloor: null, IsHouseKeepingAvailable: null, IsLift: null,
      IsRented: null, IsRoomAllocationRole: false, PersonTypeId: '', PropertyGradeId: 0, PropertyId: propertyId,
      PropertyTypeId: 0, RentPeriodEndDate: dates[dates.length - 1], RentPeriodStartDate: dates[0], RoomTypeId: 0,
      ShowOccupied: true, SubVenueId: NAJAF, TourIds: tourIds, VenueId: VENUE, currentPage: 1, itemsPerPage: 500,
      maxSize: 10, reverse: false, sortBy: 'ModifiedOn',
    });
    const rows: NkRecord[] = r.lstRoomDetails || [];
    if ((parseInt(String(r.TotalRows ?? 0), 10) || 0) > rows.length) throw new Error('NKERP room list has more than one page');
    const out: Record<string, NkRecord> = {};
    for (const x of rows) out[norm(x.RoomNumber)] = x;
    return out;
  }

  save(payload: unknown) {
    return this.write(SAVE, payload);
  }

  reallocate(payload: unknown) {
    return this.write(REALLOC, payload);
  }

  deallocate(payload: unknown) {
    return this.write(DEALLOC, payload);
  }
}

export { BadResponse, Rejected, TransportError };
