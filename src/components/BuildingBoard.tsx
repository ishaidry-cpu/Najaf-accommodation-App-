import React, { useMemo } from 'react';
import { Reservation, Room } from '../types';
import { getDistinctBuildings, normalizeBuildingName } from '../services/storage';
import { card } from './ui';

/* ------------------------------------------------------------------ */
/* "Buildings today": every building drawn floor by floor, highest      */
/* floor on top, so the free rooms can be seen at a glance.             */
/* ------------------------------------------------------------------ */

/** `2026-11-28` (or an ISO string starting with it) reads `28 Nov`; the year is added when it is not this year. */
export const formatDay = (value?: string | null): string => {
  const raw = (value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return raw;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};

/** What the Overview already works out for a room on its chosen date (Dashboard's `getMatrixState`). */
export interface BoardRoomState {
  status: 'blocked' | 'full' | 'partial' | 'available';
  occupants: Reservation[];
  currentOccupancy: number;
  maxCapacity: number;
  remainingSlots: number;
}

type CellKind = 'free' | 'occupied' | 'leaving' | 'arriving' | 'turnover' | 'blocked';

export const HATCH: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 4px, var(--color-stone-300) 4px 5px)',
};

const CELL_STYLE: Record<CellKind, string> = {
  free: 'bg-white text-emerald-800 font-bold ring-2 ring-inset ring-emerald-500',
  occupied: 'bg-stone-200 text-stone-600 font-medium',
  leaving: 'bg-amber-100 text-amber-900 font-medium ring-1 ring-inset ring-amber-400',
  arriving: 'bg-blue-100 text-blue-900 font-medium ring-1 ring-inset ring-blue-400',
  turnover: 'bg-purple-100 text-purple-900 font-medium ring-1 ring-inset ring-purple-400',
  blocked: 'bg-stone-100 text-stone-500 font-medium',
};

const dayOf = (v?: string) => (v || '').slice(0, 10);
const people = (n: number) => `${n} ${n === 1 ? 'zair' : 'zaereen'}`;
const roomNo = (r: Room) => parseInt((r.roomNumber || '').replace(/\D/g, ''), 10) || 0;

const tourList = (list: Reservation[]) => {
  const ids = Array.from(
    new Set(list.map((o) => (o.tourRefNo || o.tourId || '').trim().replace(/^NKERP\/TOUR\//i, '')).filter(Boolean))
  );
  if (ids.length === 0) return '';
  return ids.length > 2 ? `Tours ${ids.slice(0, 2).join(', ')} and ${ids.length - 2} more` : `${ids.length > 1 ? 'Tours' : 'Tour'} ${ids.join(', ')}`;
};

const floorLabelOf = (r: Room) =>
  (r.floorLabel || '').trim() || (r.floor === 0 ? 'Ground' : r.floor === 0.5 ? 'Mezzanine' : `Floor ${r.floor}`);

interface BoardCell {
  room: Room;
  kind: CellKind;
  name: string;
}

interface BoardBuilding {
  name: string;
  total: number;
  free: number;
  columns: number;
  floors: { key: string; label: string; cells: BoardCell[] }[];
}

interface BuildingBoardProps {
  rooms: Room[];
  /** The same per-room state the Overview uses for its Vacant / Occupied / Blocked figures and the room grid. */
  getRoomState: (room: Room) => BoardRoomState;
  /** The day the states are worked out for, `YYYY-MM-DD`. */
  date: string;
  isToday: boolean;
  /** Opens the room's details. Without it the cells are not interactive. */
  onSelectRoom?: (room: Room) => void;
}

export const BuildingBoard: React.FC<BuildingBoardProps> = ({ rooms, getRoomState, date, isToday, onSelectRoom }) => {
  const dayWord = isToday ? 'today' : `on ${formatDay(date)}`;

  const { buildings, totals } = useMemo(() => {
    const totals: Record<CellKind, number> = { free: 0, occupied: 0, leaving: 0, arriving: 0, turnover: 0, blocked: 0 };
    const when = isToday ? 'today' : `on ${formatDay(date)}`;

    const toCell = (room: Room, buildingName: string): BoardCell => {
      const st = getRoomState(room);
      const who = st.occupants;
      const leavers = who.filter((o) => dayOf(o.departureDate) === date);
      const arrivers = who.filter((o) => dayOf(o.arrivalDate) === date && dayOf(o.departureDate) !== date);
      const staying = who.length - leavers.length - arrivers.length;
      const lastOut = who.reduce((max, o) => (dayOf(o.departureDate) > max ? dayOf(o.departureDate) : max), '');

      let kind: CellKind;
      let detail: string;
      if (st.status === 'blocked') {
        kind = 'blocked';
        detail = `blocked${room.blockedReason ? `, ${room.blockedReason}` : ''}`;
      } else if (st.status === 'available') {
        // Counted as vacant by the Overview (nobody who takes a bed is in the room).
        kind = 'free';
        const base = room.capacity || room.pax || 2;
        detail = `free, sleeps ${base}${room.buffer ? ` plus ${room.buffer}` : ''}`;
        if (who.length > 0) detail += `, ${people(who.length)} not taking a bed`;
      } else if (staying > 0) {
        kind = 'occupied';
        detail = ['occupied', people(who.length), tourList(who), lastOut ? `leaves ${formatDay(lastOut)}` : '']
          .filter(Boolean)
          .join(', ');
        if (leavers.length > 0) detail += `, ${people(leavers.length)} leaving ${when}`;
        if (arrivers.length > 0) detail += `, ${people(arrivers.length)} arriving ${when}`;
        if (st.remainingSlots > 0) detail += `, room for ${st.remainingSlots} more`;
      } else if (leavers.length > 0 && arrivers.length > 0) {
        kind = 'turnover';
        detail = `turnover ${when}, ${people(leavers.length)} leaving${tourList(leavers) ? ` (${tourList(leavers)})` : ''}, ${people(arrivers.length)} arriving${tourList(arrivers) ? ` (${tourList(arrivers)})` : ''}`;
      } else if (leavers.length > 0) {
        kind = 'leaving';
        detail = [`leaving ${when}`, people(leavers.length), tourList(leavers)].filter(Boolean).join(', ');
      } else {
        kind = 'arriving';
        detail = [`arriving ${when}`, people(arrivers.length), tourList(arrivers), lastOut ? `leaves ${formatDay(lastOut)}` : '']
          .filter(Boolean)
          .join(', ');
      }
      totals[kind] += 1;
      return { room, kind, name: `${buildingName} ${room.roomNumber}, ${detail}` };
    };

    // Buildings in the order the rest of the app lists them, keeping only those that have rooms.
    const byBuilding = new Map<string, Room[]>();
    rooms.forEach((r) => {
      const key = (normalizeBuildingName(r.building) || (r.building || '').trim()).toLowerCase();
      if (!key) return;
      if (!byBuilding.has(key)) byBuilding.set(key, []);
      byBuilding.get(key)!.push(r);
    });

    const buildings: BoardBuilding[] = [];
    getDistinctBuildings(rooms).forEach((name) => {
      const list = byBuilding.get(name.toLowerCase());
      if (!list || list.length === 0) return;

      const floorMap = new Map<string, { floor: number; label: string; rooms: Room[] }>();
      list.forEach((r) => {
        const label = floorLabelOf(r);
        const key = `${r.floor}|${label}`;
        if (!floorMap.has(key)) floorMap.set(key, { floor: Number(r.floor) || 0, label, rooms: [] });
        floorMap.get(key)!.rooms.push(r);
      });

      const floors = Array.from(floorMap.entries())
        .sort((a, b) => b[1].floor - a[1].floor || a[1].label.localeCompare(b[1].label))
        .map(([key, f]) => ({
          key,
          label: f.label,
          cells: [...f.rooms]
            .sort((a, b) => roomNo(a) - roomNo(b) || a.roomNumber.localeCompare(b.roomNumber))
            .map((r) => toCell(r, name)),
        }));

      buildings.push({
        name,
        total: list.length,
        free: floors.reduce((n, f) => n + f.cells.filter((c) => c.kind === 'free').length, 0),
        columns: Math.min(10, Math.max(1, ...floors.map((f) => f.cells.length))),
        floors,
      });
    });

    return { buildings, totals };
  }, [rooms, getRoomState, date, isToday]);

  const legend: { kind: CellKind; label: string }[] = [
    { kind: 'free', label: 'Free' },
    { kind: 'occupied', label: 'Occupied' },
    { kind: 'leaving', label: `Leaving ${dayWord}` },
    { kind: 'arriving', label: `Arriving ${dayWord}` },
    // Same-day turnover only earns a place in the legend on days that have one.
    ...(totals.turnover > 0 ? [{ kind: 'turnover' as CellKind, label: `Turnover ${dayWord}` }] : []),
    { kind: 'blocked', label: 'Blocked' },
  ];

  if (buildings.length === 0) return null;

  return (
    <section aria-label={`Buildings ${dayWord}`} className={`${card} p-4 sm:p-6`}>
      <div className="grid grid-cols-1 xl:grid-cols-[auto_minmax(0,1fr)] gap-x-6">
        <h2 className="text-lg font-semibold leading-tight text-stone-950">Buildings {dayWord}</h2>
        <p className="mt-1 text-[13px] text-stone-600 xl:order-3 xl:col-span-2">
          Every room, floor by floor.{onSelectRoom ? ' Choose a room to see who is in it.' : ''}
        </p>
        <ul className="mt-3 xl:mt-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 xl:order-2 xl:justify-end" aria-label="Room states">
          {legend.map((l) => (
            <li key={l.kind} className="flex items-center gap-1.5 text-[13px] text-stone-700">
              <span
                aria-hidden="true"
                className={`w-3.5 h-3.5 rounded-[4px] shrink-0 ${CELL_STYLE[l.kind]}`}
                style={l.kind === 'blocked' ? HATCH : undefined}
              />
              <span>{l.label}</span>
              <span className="tabular-nums text-stone-500">{totals[l.kind]}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-6 border-t border-stone-200 pt-5">
        {buildings.map((b) => (
          <section key={b.name} aria-label={b.name} className="flex flex-col min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-stone-950">{b.name}</h3>
              <p className="text-[13px] text-stone-600 tabular-nums">
                <span className={b.free > 0 ? 'font-semibold text-emerald-800' : 'font-medium text-stone-700'}>{b.free} free</span> of {b.total}
              </p>
            </div>

            {/* Floors stand on the same ground line, so a shorter building leaves its space at the top. */}
            <div className="mt-auto pt-3 space-y-2.5 sm:space-y-1">
              {b.floors.map((f) => (
                <div key={f.key} role="group" aria-label={`${b.name}, ${f.label}`} className="flex items-start gap-2">
                  <div className="w-16 shrink-0 h-10 sm:h-8 flex items-center text-xs text-stone-500 truncate" title={f.label}>
                    {f.label}
                  </div>
                  <div
                    className="flex-1 min-w-0 grid gap-1 grid-cols-5 sm:grid-cols-[repeat(var(--board-cols),minmax(0,2.5rem))]"
                    style={{ '--board-cols': b.columns } as React.CSSProperties}
                  >
                    {f.cells.map((c) => {
                      const cls = `h-10 sm:h-8 rounded-md flex items-center justify-center text-xs tabular-nums ${CELL_STYLE[c.kind]}`;
                      const style = c.kind === 'blocked' ? HATCH : undefined;
                      return onSelectRoom ? (
                        <button
                          key={c.room.id}
                          type="button"
                          onClick={() => onSelectRoom(c.room)}
                          title={c.name}
                          aria-label={c.name}
                          style={style}
                          className={`${cls} cursor-pointer hover:outline-2 hover:outline-offset-1 hover:outline-brand-500/70`}
                        >
                          {c.room.roomNumber}
                        </button>
                      ) : (
                        <div key={c.room.id} role="img" title={c.name} aria-label={c.name} style={style} className={cls}>
                          {c.room.roomNumber}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
};
