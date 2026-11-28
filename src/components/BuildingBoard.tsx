import React, { useMemo } from 'react';
import { Reservation, Room } from '../types';
import { getDistinctBuildings, normalizeBuildingName } from '../services/storage';
import { LogIn, LogOut, ArrowLeftRight } from 'lucide-react';
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

/** How full a room is on the chosen day. The cell colour says this and nothing else. */
type Occupancy = BoardRoomState['status'];
/** Movement on the chosen day, shown as a small mark in the cell's corner. */
type Movement = 'leaving' | 'arriving' | 'turnover';

export const HATCH: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 4px, var(--color-stone-300) 4px 5px)',
};

/**
 * Room colours shared by the Buildings board and the Overview room grid:
 * green = vacant, orange = occupied with space, red = full, hatched grey = blocked.
 * The fills also step from light to dark (vacant lightest, full darkest) so they read without colour.
 */
export const ROOM_LOOK: Record<Occupancy, string> = {
  available: 'bg-emerald-100 text-emerald-900 font-bold ring-2 ring-inset ring-emerald-500',
  partial: 'bg-orange-200 text-orange-950 font-semibold ring-2 ring-inset ring-orange-500',
  full: 'bg-rose-600 text-white font-semibold ring-2 ring-inset ring-rose-700',
  blocked: 'bg-stone-100 text-stone-500 font-medium',
};

/** A legend swatch in the room colours. */
export const RoomSwatch: React.FC<{ status: Occupancy; className?: string }> = ({ status, className = 'w-3.5 h-3.5 rounded-[4px]' }) => (
  <span
    aria-hidden="true"
    className={`shrink-0 ${className} ${ROOM_LOOK[status].replace(/ring-2/, 'ring-[1.5px]')}`}
    style={status === 'blocked' ? HATCH : undefined}
  />
);

const MOVEMENT_ICON: Record<Movement, React.FC<{ className?: string; 'aria-hidden'?: boolean }>> = {
  leaving: LogOut,
  arriving: LogIn,
  turnover: ArrowLeftRight,
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
  occupancy: Occupancy;
  movement: Movement | null;
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

  const { buildings, totals, moves } = useMemo(() => {
    const totals: Record<Occupancy, number> = { available: 0, partial: 0, full: 0, blocked: 0 };
    const moves: Record<Movement, number> = { leaving: 0, arriving: 0, turnover: 0 };
    const when = isToday ? 'today' : `on ${formatDay(date)}`;

    const toCell = (room: Room, buildingName: string): BoardCell => {
      const st = getRoomState(room);
      const who = st.occupants;
      const leavers = who.filter((o) => dayOf(o.departureDate) === date);
      const arrivers = who.filter((o) => dayOf(o.arrivalDate) === date && dayOf(o.departureDate) !== date);
      const lastOut = who.reduce((max, o) => (dayOf(o.departureDate) > max ? dayOf(o.departureDate) : max), '');

      const occupancy: Occupancy = st.status;
      const movement: Movement | null =
        occupancy === 'blocked' || who.length === 0
          ? null
          : leavers.length > 0 && arrivers.length > 0
          ? 'turnover'
          : leavers.length > 0
          ? 'leaving'
          : arrivers.length > 0
          ? 'arriving'
          : null;

      const parts: string[] = [];
      if (occupancy === 'blocked') {
        parts.push(`blocked${room.blockedReason ? `, ${room.blockedReason}` : ''}`);
      } else if (occupancy === 'available') {
        const base = room.capacity || room.pax || 2;
        parts.push(`vacant, sleeps ${base}${room.buffer ? ` plus ${room.buffer}` : ''}`);
        if (who.length > 0) parts.push(`${people(who.length)} not taking a bed`);
      } else {
        parts.push(occupancy === 'full' ? 'full' : `has space for ${st.remainingSlots} more`);
        parts.push(people(who.length));
        if (tourList(who)) parts.push(tourList(who));
        if (lastOut) parts.push(`leaves ${formatDay(lastOut)}`);
      }
      if (leavers.length > 0) parts.push(`${people(leavers.length)} leaving ${when}`);
      if (arrivers.length > 0) parts.push(`${people(arrivers.length)} arriving ${when}`);

      totals[occupancy] += 1;
      if (movement) moves[movement] += 1;
      return { room, occupancy, movement, name: `${buildingName} ${room.roomNumber}, ${parts.join(', ')}` };
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
        free: floors.reduce((n, f) => n + f.cells.filter((c) => c.occupancy === 'available').length, 0),
        columns: Math.min(10, Math.max(1, ...floors.map((f) => f.cells.length))),
        floors,
      });
    });

    return { buildings, totals, moves };
  }, [rooms, getRoomState, date, isToday]);

  const legend: { status: Occupancy; label: string }[] = [
    { status: 'available', label: 'Vacant' },
    { status: 'partial', label: 'Has space' },
    { status: 'full', label: 'Full' },
    { status: 'blocked', label: 'Blocked' },
  ];
  const movementLegend: { kind: Movement; label: string }[] = [
    { kind: 'leaving', label: `Leaving ${dayWord}` },
    { kind: 'arriving', label: `Arriving ${dayWord}` },
    // Same-day turnover only earns a place in the legend on days that have one.
    ...(moves.turnover > 0 ? [{ kind: 'turnover' as Movement, label: `Turnover ${dayWord}` }] : []),
  ];

  if (buildings.length === 0) return null;

  return (
    <section aria-label={`Buildings ${dayWord}`} className={`${card} p-4 sm:p-6`}>
      <div className="grid grid-cols-1 xl:grid-cols-[auto_minmax(0,1fr)] gap-x-6">
        <h2 className="text-lg font-semibold leading-tight text-stone-950">Buildings {dayWord}</h2>
        <p className="mt-1 text-[13px] text-stone-600 xl:order-3 xl:col-span-2">
          Every room, floor by floor.{onSelectRoom ? ' Choose a room to see who is in it and when they depart.' : ''}
        </p>
        <ul className="mt-3 xl:mt-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 xl:order-2 xl:justify-end" aria-label="Room states">
          {legend.map((l) => (
            <li key={l.status} className="flex items-center gap-1.5 text-[13px] text-stone-700">
              <RoomSwatch status={l.status} />
              <span>{l.label}</span>
              <span className="tabular-nums text-stone-500">{totals[l.status]}</span>
            </li>
          ))}
          {movementLegend.map((l) => {
            const Icon = MOVEMENT_ICON[l.kind];
            return (
              <li key={l.kind} className="flex items-center gap-1.5 text-[13px] text-stone-700">
                <Icon aria-hidden className="w-3.5 h-3.5 shrink-0 text-stone-600" />
                <span>{l.label}</span>
                <span className="tabular-nums text-stone-500">{moves[l.kind]}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-6 border-t border-stone-200 pt-5">
        {buildings.map((b) => (
          <section key={b.name} aria-label={b.name} className="flex flex-col min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-stone-950">{b.name}</h3>
              <p className="text-[13px] text-stone-600 tabular-nums">
                <span className={b.free > 0 ? 'font-semibold text-emerald-800' : 'font-medium text-stone-700'}>{b.free} vacant</span> of {b.total}
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
                      const cls = `relative h-10 sm:h-8 rounded-md flex items-center justify-center text-xs tabular-nums ${ROOM_LOOK[c.occupancy]}`;
                      const style = c.occupancy === 'blocked' ? HATCH : undefined;
                      const Mark = c.movement ? MOVEMENT_ICON[c.movement] : null;
                      const content = (
                        <>
                          {c.room.roomNumber}
                          {Mark && <Mark aria-hidden className="absolute top-0.5 right-0.5 w-2.5 h-2.5 opacity-90" />}
                        </>
                      );
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
                          {content}
                        </button>
                      ) : (
                        <div key={c.room.id} role="img" title={c.name} aria-label={c.name} style={style} className={cls}>
                          {content}
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
