import type { Reservation, TravelLeg } from '../src/types/index.js';
import { expiry, guests, read, transaction, write } from './accommodation-store.js';
import { NAJAF, VENUE, type NkerpClient } from './nkerp-sync/nkerpClient.js';
import type { NkRecord } from './nkerp-sync/types.js';
import { addDays, norm, parseArrival } from './nkerp-sync/util.js';

const lists = {
  arrival: { path: 'api/vehicle/getArrivals', field: 'arrivalRequest', sort: 'ArrivalTime' },
  departure: { path: 'api/vehicle/getDepartures', field: 'departureRequest', sort: 'DepartureTime' },
  transfer: { path: 'api/vehicle/getSubVenueTransfers', field: 'subVenueTransferRequest', sort: 'DepartureTime' },
} as const;
export const travelEndpoints = { reads: Object.values(lists).map(list => list.path), writes: [] };
type Direction = 'arrival' | 'departure';
type ListName = keyof typeof lists;
type TravelRequest = { date: string; list: ListName; key: string };
type TourTravel = Partial<Record<Direction, TravelLeg[]>>;
type TravelResults = Map<string, Map<string, TourTravel>>;
const dateTime = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) ? value.slice(0, 16) : undefined;
const label = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const requestKey = (date: string, list: ListName) => `${date}/${list}`;

export function travelRequests(stays: Reservation[], now = Date.now()): TravelRequest[] {
  const requests = new Map<string, TravelRequest>();
  for (const stay of stays) {
    if (!stay.tourRefNo?.trim() || expiry(stay) <= now) continue;
    for (const direction of ['arrival', 'departure'] as const) {
      const date = parseArrival(direction === 'arrival' ? stay.arrivalDate : stay.departureDate);
      if (!date) continue;
      for (const list of [direction, 'transfer'] as const) {
        const key = requestKey(date, list);
        requests.set(key, { date, list, key });
      }
    }
  }
  return [...requests.values()];
}

export function prioritizeTravel(requests: TravelRequest[], today: string, checked: Record<string, number>) {
  const tomorrow = addDays(today, 1);
  const dayDistance = (date: string) => Math.abs(Date.parse(date) - Date.parse(today));
  // Today's and tomorrow's transport comes first. Rotate older and future dates by last successful read.
  const rank = (date: string) => date === today ? 0 : date === tomorrow ? 1 : 2;
  return [...requests].sort((a, b) => rank(a.date) - rank(b.date) ||
    (checked[a.key] ?? 0) - (checked[b.key] ?? 0) || dayDistance(a.date) - dayDistance(b.date));
}

function mapLeg(row: NkRecord, request: TravelRequest): [Direction, TravelLeg] | undefined {
  const { date: serviceDate, list } = request;
  if (list === 'transfer') {
    const from = label(row.SubVenueFrom);
    const to = label(row.SubVenueTo);
    const direction = norm(to) === 'NAJAF' ? 'arrival' : norm(from) === 'NAJAF' ? 'departure' : null;
    if (!direction || !from || !to || norm(from) === norm(to) || parseArrival(row.DepartureTime) !== serviceDate) return;
    const transferTime = dateTime(row.DepartureTime);
    const localTime = dateTime(row.ArrivalDepartureTime) || (transferTime?.slice(11) === '00:00' ? undefined : transferTime);
    return [direction, { kind: 'subvenue', serviceDate, location: direction === 'arrival' ? from : to, localTime }];
  }

  if (norm(row.SubVenue) !== 'NAJAF') return;
  const arriving = list === 'arrival';
  const localTime = dateTime(arriving ? row.ArrivalTimeWithTimeZone : row.DepartureTimeWithTimeZone);
  if (localTime?.slice(0, 10) !== serviceDate) return;
  const location = label(arriving ? row.ArrivalPort : row.DeparturePort);
  const code = label(row.FlightCode);
  const flightCode = code && !/^(?:N[./ ]?A\b|[-–—]+$)/i.test(code) ? code : undefined;
  const kind = /saff?wan|saff?an/i.test(location) ? 'saffan' : flightCode || /airport/i.test(location) ? 'flight' : 'land';
  if (!location && !flightCode) return;
  return [list, { kind, serviceDate, location: kind === 'saffan' ? 'Saffan' : location, localTime,
    ...(kind === 'flight' && flightCode ? { flightCode } : {}) }];
}

export async function readTravel(client: Pick<NkerpClient, 'read'>, requests: TravelRequest[], signal: AbortSignal) {
  const results: TravelResults = new Map();
  let failed = 0;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, requests.length) }, async () => {
    while (next < requests.length && !signal.aborted) {
      const request = requests[next++];
      const list = lists[request.list];
      try {
        const response = await client.read(list.path, {
          Date: `${request.date}T00:00:00.000Z`, VenueId: VENUE, SubVenueId: NAJAF, TimeZone: null, Timezone: 3,
          itemsPerPage: 10, maxSize: 10, totalItems: 0, currentPage: 1, reverse: false,
          IsForRoomAccomDashboard: false, EntryPort: null, ExitPort: null, sortBy: list.sort,
          ...(request.list === 'transfer' ? {} : { TransportCode: null }),
        });
        const rows = response[list.field];
        if (response.ReturnStatus !== true || !Array.isArray(rows)) throw new Error('Unexpected NKERP travel list');
        const tours = new Map<string, TourTravel>();
        for (const row of rows) {
          const ref = norm(row.TourReferenceNo);
          const matched = mapLeg(row, request);
          if (!ref || !matched) continue;
          const [direction, leg] = matched;
          const travel = tours.get(ref) ?? {};
          const legs = travel[direction] ??= [];
          if (!legs.some(previous => JSON.stringify(previous) === JSON.stringify(leg))) legs.push(leg);
          tours.set(ref, travel);
        }
        results.set(request.key, tours);
      } catch {
        failed++;
      }
    }
  }));
  return { results, failed };
}

export function reconcileTravel(results: TravelResults, failed: number, now = Date.now()) {
  return transaction(() => {
    const before = guests();
    const requests = travelRequests(before, now);
    const previous = read<Record<string, number>>('travel-checked', {});
    const checked = Object.fromEntries(requests.flatMap(({ key }) =>
      results.has(key) ? [[key, now]] : previous[key] ? [[key, previous[key]]] : []));
    if (JSON.stringify(checked) !== JSON.stringify(previous)) write('travel-checked', checked);
    let changed = 0;
    const reservations = before.map(stay => {
      const next = { ...stay };
      const ref = norm(stay.tourRefNo);
      for (const direction of ['arrival', 'departure'] as const) {
        const field = direction === 'arrival' ? 'arrivalTravel' : 'departureTravel';
        const date = parseArrival(direction === 'arrival' ? stay.arrivalDate : stay.departureDate);
        const existing = stay[field]?.filter(leg => leg.serviceDate === date) ?? [];
        const ports = date && results.get(requestKey(date, direction));
        const transfers = date && results.get(requestKey(date, 'transfer'));
        const legs = [
          ...(transfers ? transfers.get(ref)?.[direction] ?? [] : existing.filter(leg => leg.kind === 'subvenue')),
          ...(ports ? ports.get(ref)?.[direction] ?? [] : existing.filter(leg => leg.kind !== 'subvenue')),
        ].sort((a, b) => (a.localTime ?? '').localeCompare(b.localTime ?? '') || a.location.localeCompare(b.location) ||
          (a.flightCode ?? '').localeCompare(b.flightCode ?? '') || a.kind.localeCompare(b.kind));
        if (legs.length) next[field] = legs;
        else delete next[field];
      }
      if (JSON.stringify(next.arrivalTravel) === JSON.stringify(stay.arrivalTravel) &&
          JSON.stringify(next.departureTravel) === JSON.stringify(stay.departureTravel)) return stay;
      changed++;
      return next;
    });
    if (changed) write('reservations', reservations);
    return { changed, checked: results.size, pending: requests.length - Object.keys(checked).length, failed };
  });
}
