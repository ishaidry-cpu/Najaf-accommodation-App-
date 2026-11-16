/**
 * Save payloads, built exactly as the NKERP screens build them, plus the capacity and readback checks.
 * Pure functions (except `persisted`, which re-reads NKERP through the given client).
 */
import { NAJAF, VENUE, type NkerpApi } from './nkerpClient';
import type { AllocItem, Move, Night, NkRecord } from './types';
import { day, pyTitle, sortBy, tuple } from './util';

/** Python's dict.get(): a missing field is sent as null, never dropped from the JSON payload. */
const g = (o: NkRecord | undefined | null, k: string): any => (o == null || o[k] === undefined ? null : o[k]);

/** Assign Room save for one room and the selected applicants (Manage Room Allocation). */
export function allocPayload(room: NkRecord, items: AllocItem[]) {
  const perDate = new Map<string, NkRecord>();
  for (const it of items) {
    const a = it.app;
    for (const d of it.dates) {
      let e = perDate.get(d.ArrivalDate);
      if (!e) {
        e = {
          RoomDetailId: room.Id, TotalCapacity: room.TotalCapacity, OccupiedDate: d.ArrivalDate,
          ApplicantName: a.ApplicantName, RoomAllocatedDates_Current: [], AssignedCapacity: 0, IsFull: false,
          RoomAllocationStatus: [], VenueId: VENUE, SubvenueId: NAJAF,
        };
        perDate.set(d.ArrivalDate, e);
      }
      e.RoomAllocatedDates_Current.push({ ApplicantId: a.ApplicantinTourId, ApplicantName: a.ApplicantName,
        GenderName: a.GenderName, IsInfant: a.IsInfant });
      e.AssignedCapacity += a.IsInfant ? 0 : 1;
    }
  }
  const dates = sortBy(perDate.keys(), (k) => k).map((k) => perDate.get(k)!);
  for (const e of dates) {
    e.RoomAllocationStatus = [{ TotalCapacity: e.TotalCapacity, AssignedCapacity: e.AssignedCapacity,
      RemainingCapacity: e.TotalCapacity - e.AssignedCapacity }];
  }
  const status = items.map((it) => {
    const a = it.app;
    const mine = new Set(it.dates.map((d) => d.ArrivalDate));
    const full = (a.lstSubVenueDates || []).every((d: NkRecord) => d.isPreviousAssigned || mine.has(d.ArrivalDate));
    return { ApplicantId: a.ApplicantinTourId, IsFullyAssigned: full, VenueId: VENUE, SubvenueId: NAJAF, TourID: a.TourID };
  });
  return { lstAccomodationRoomAllocatedDates: dates, lstApplicantsAllocationStatus: status };
}

/**
 * Manage Room Reallocation save: the selected people's nights into one new room. Built exactly as the
 * screen's Save handler: AssignedCapacity stays 0, PrevRoomAllocatedDatesId is the old room-night's Id.
 */
export function reallocPayload(room: NkRecord, building: string, moves: Move[]) {
  const rno = room.RoomNumber;
  const pname = room.PropertyName || pyTitle(building);
  const perDate = new Map<string, NkRecord>();
  for (const mv of moves) {
    const p = mv.person;
    for (const n of mv.nights) {
      const x = n.entry;
      const occ = n.row.OccupiedDate;
      const entry: NkRecord = {
        ApplicantId: p.aid ?? null, AppicantITSId: g(x, 'AppicantITSId'), PrevRoomAllocatedDatesId: g(n.row, 'Id'),
        ApplicantName: g(x, 'ApplicantName'), GenderName: g(x, 'GenderName'), IsInfant: g(x, 'IsInfant'),
        TourId: g(x, 'TourId'), TourReferenceNo: g(x, 'TourReferenceNo'), RoomNumber: rno, PropertyName: pname,
      };
      const e = perDate.get(occ);
      if (!e) {
        perDate.set(occ, {
          RoomDetailId: room.Id, TotalCapacity: room.TotalCapacity, OccupiedDate: occ, AssignedCapacity: 0,
          RoomAllocatedDates_Current: [entry], RoomAllocatedDates_Prev: [], RoomAllocationStatus: [], VenueId: VENUE,
          SubvenueId: NAJAF, SubVenueName: 'NAJAF', PropertyName: pname, RoomNumber: rno,
        });
      } else {
        e.RoomAllocatedDates_Current.push({ ...entry, AssignedCapacity: 0 });
      }
    }
  }
  const out = sortBy(perDate.keys(), (k) => day(k)).map((k) => perDate.get(k)!);
  for (const e of out) {
    e.RoomAllocationStatus = [{ TotalCapacity: e.TotalCapacity, AssignedCapacity: 0, RemainingCapacity: e.TotalCapacity }];
  }
  return { DeallocateList: out, EmailOption: 0 };
}

/** Manage Room Deallocation: each room-night row with only this person ticked (Checkbox true). */
export function deallocPayload(nights: Night[]) {
  const out = sortBy(nights, (n) => n.day).map((n) => {
    const r = n.row;
    return {
      Id: g(r, 'Id'), IsFull: g(r, 'IsFull'), OccupiedDate: g(r, 'OccupiedDate'), PropertyId: g(r, 'PropertyId'),
      PropertyName: g(r, 'PropertyName'), RoomAllocatedDates_Current: [{ ...n.entry, Checkbox: true }],
      RoomDetailId: g(r, 'RoomDetailId'), RoomNo: g(r, 'RoomNo'), RoomTypeId: g(r, 'RoomTypeId'),
      SubvenueId: g(r, 'SubvenueId'), SubvenueName: g(r, 'SubvenueName'), VenueId: g(r, 'VenueId'),
    };
  });
  return { DeallocateList: out, EmailOption: 0 };
}

// ------------------------------------------------------------------------------------------------ capacity

/** Planned (day, applicant) -> infant, for a dry run that must count rooms it has already planned. */
export type PlannedLoad = Map<string, boolean>;

/** Counted occupancy per day in this room and who is there, plus this dry run's planned guests. */
export function occupancy(room: NkRecord, extra?: PlannedLoad) {
  const used = new Map<string, number>();
  const who = new Map<string, Set<unknown>>();
  const whoOf = (d: string) => {
    let s = who.get(d);
    if (!s) who.set(d, (s = new Set()));
    return s;
  };
  for (const e of room.AccomodationRoomAllocatedDatesNew || []) {
    if (e.IsActive === false) continue;
    const cur = (e.RoomAllocatedDates_Current || []).filter((x: NkRecord) => x.IsActive !== false);
    const d = day(e.OccupiedDate);
    used.set(d, (used.get(d) ?? 0) + cur.filter((x: NkRecord) => !x.IsInfant).length);
    const s = whoOf(d);
    for (const x of cur) s.add(x.ApplicantId);
  }
  for (const [k, infant] of extra ?? []) {
    const [d, applicant] = JSON.parse(k) as [string, unknown];
    const s = whoOf(d);
    if (!s.has(applicant)) {
      used.set(d, (used.get(d) ?? 0) + (infant ? 0 : 1));
      s.add(applicant);
    }
  }
  return { used, who };
}

/**
 * newPerDay: [(day, beds needed)] in date order. Over-capacity days, except a checkout/check-in turnover on
 * the first day (the room's current guests have their last night there that day).
 */
export function capacityProblems(room: NkRecord, newPerDay: [string, number][], extra?: PlannedLoad): string[] {
  const { used, who } = occupancy(room, extra);
  const days = newPerDay.map(([d]) => d);
  const bad: string[] = [];
  newPerDay.forEach(([d, need], i) => {
    const u = used.get(d) ?? 0;
    if (u + need <= room.TotalCapacity) return;
    const first = who.get(d) ?? new Set();
    const second = days.length > 1 ? who.get(days[1]) ?? new Set() : new Set();
    const turnover = i === 0 && days.length > 1 && ![...first].some((x) => second.has(x));
    if (!turnover) bad.push(`${d}: ${u} already + ${need} new > ${room.TotalCapacity} beds`);
  });
  return bad;
}

export function allocNeed(body: ReturnType<typeof allocPayload>): [string, number][] {
  return body.lstAccomodationRoomAllocatedDates.map((e) => [day(e.OccupiedDate), e.AssignedCapacity] as [string, number]);
}

/** Readback after an allocation: (missing (name, day) pairs, how many (person, day) pairs are present). */
export async function persisted(c: NkerpApi, pid: unknown, tids: unknown[], dates: string[], rno: string, items: AllocItem[]):
  Promise<[unknown[], number]> {
  const fresh = (await c.rooms(pid, tids, dates))[rno] || {};
  const got = new Map<string, Set<unknown>>();
  for (const e of fresh.AccomodationRoomAllocatedDatesNew || []) {
    if (e.IsActive === false) continue;
    for (const x of e.RoomAllocatedDates_Current || []) {
      if (x.IsActive !== false) {
        const d = day(e.OccupiedDate);
        let s = got.get(d);
        if (!s) got.set(d, (s = new Set()));
        s.add(x.ApplicantId);
      }
    }
  }
  const want = items.flatMap((it) => it.dates.map((d) => [it.app.ApplicantinTourId, String(it.app.ApplicantName).trim(),
    day(d.ArrivalDate)] as const));
  const missing = want.filter(([aid, , d]) => !got.get(d)?.has(aid)).map(([, n, d]) => tuple(n, d));
  return [missing, want.length - missing.length];
}
