import React, { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { Room, RoomCategory, RoomStatus } from '../types';
import {
  ROOM_BED_TYPES,
  ROOM_CATEGORIES,
  ROOM_TOILET_TYPES,
  buildRoomAmenities,
  getRoomBedCount,
  getRoomCustomFeatures,
} from '../services/storage';
import { btn, field, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle } from './ui';

/** Everything about a room except its building and number. */
export interface RoomSpecDraft {
  floor: number;
  floorLabel: string;
  beds: number;
  capacity: number;
  buffer: number;
  bedType: string;
  toiletType: string;
  category: RoomCategory;
  status: RoomStatus;
  blockedReason: string;
  notes: string;
  features: string;
}

export const floorLabelFor = (floor: number) =>
  floor === 0 ? 'Ground' : floor === 0.5 ? 'Mezzanine' : `Floor ${floor}`;

export const DEFAULT_ROOM_SPEC: RoomSpecDraft = {
  floor: 1,
  floorLabel: 'Floor 1',
  beds: 3,
  capacity: 3,
  buffer: 0,
  bedType: 'Single Beds',
  toiletType: 'WESTERN',
  category: 'Category A (Nizaam)',
  status: 'available',
  blockedReason: '',
  notes: '',
  features: '',
};

export function specFromRoom(room: Room): RoomSpecDraft {
  return {
    floor: room.floor ?? 1,
    floorLabel: room.floorLabel || floorLabelFor(room.floor ?? 1),
    beds: getRoomBedCount(room),
    capacity: room.capacity || room.pax || 2,
    buffer: room.buffer || 0,
    bedType: room.bedType || 'Single Beds',
    toiletType: room.toiletType || 'WESTERN',
    category: room.category,
    status: room.status === 'occupied' ? 'available' : room.status,
    blockedReason: room.blockedReason || '',
    notes: room.notes || '',
    features: getRoomCustomFeatures(room).join(', '),
  };
}

/** Returns an error message when a spec can't be saved. */
export function validateRoomSpec(spec: RoomSpecDraft): string | null {
  if (!Number.isInteger(spec.beds) || spec.beds < 1 || spec.beds > 20) return 'Beds must be between 1 and 20.';
  if (!Number.isInteger(spec.capacity) || spec.capacity < 1 || spec.capacity > 20) return 'Sleeps must be between 1 and 20 guests.';
  if (!Number.isInteger(spec.buffer) || spec.buffer < 0 || spec.buffer > 10) return 'Buffer must be between 0 and 10.';
  if (!Number.isFinite(spec.floor) || spec.floor < 0 || spec.floor > 50) return 'Floor must be between 0 and 50.';
  return null;
}

/** Applies a spec to a room (new or existing). */
export function applyRoomSpec(base: Pick<Room, 'id' | 'building' | 'roomNumber'> & Partial<Room>, spec: RoomSpecDraft): Room {
  const features = spec.features.split(/[,;\n]+/).map((f) => f.trim()).filter(Boolean);
  const isBlocked = spec.status === 'blocked';
  return {
    ...base,
    floor: spec.floor,
    floorLabel: spec.floorLabel.trim() || floorLabelFor(spec.floor),
    beds: spec.beds,
    capacity: spec.capacity,
    pax: spec.capacity,
    buffer: spec.buffer,
    bedType: spec.bedType,
    toiletType: spec.toiletType,
    category: spec.category,
    status: spec.status,
    blockedReason: isBlocked ? spec.blockedReason.trim() || undefined : undefined,
    blockedSince: isBlocked ? base.blockedSince || new Date().toISOString().slice(0, 10) : undefined,
    expectedUnblockDate: isBlocked ? base.expectedUnblockDate : undefined,
    notes: spec.notes.trim() || undefined,
    amenities: buildRoomAmenities(spec, features),
  };
}

/**
 * One segmented control for the room screens (building, floor, capacity, range, status switches).
 * A stone track; the chosen option is a white tab. 40px tall on phones, 32px in desktop toolbars.
 */
export const segTrack = 'inline-flex items-center gap-0.5 rounded-lg bg-stone-100 p-0.5';
export const segBtn = (selected: boolean) =>
  `inline-flex items-center justify-center gap-1.5 h-10 sm:h-8 px-3 rounded-md text-[13px] whitespace-nowrap transition cursor-pointer ${
    selected
      ? 'bg-white text-stone-950 font-semibold shadow-xs ring-1 ring-stone-300/80'
      : 'font-medium text-stone-600 hover:text-stone-950 hover:bg-stone-200/60'
  }`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-28" reads as "28 Nov" (with the year when it is not this year). For display only. */
export const formatDay = (value?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!m) return value || '—';
  const text = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || m[2]}`;
  return Number(m[1]) === new Date().getFullYear() ? text : `${text} ${m[1]}`;
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string }> = ({
  label,
  hint,
  children,
  className,
}) => (
  <label className={`block min-w-0 ${className || ''}`}>
    <span className={fieldLabel}>{label}</span>
    {children}
    {hint && <span className="block mt-1 text-xs text-stone-500">{hint}</span>}
  </label>
);

const NumberInput: React.FC<{
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
}> = ({ value, min, max, step = 1, onChange }) => (
  <input
    type="number"
    inputMode="numeric"
    min={min}
    max={max}
    step={step}
    value={Number.isFinite(value) ? value : ''}
    onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
    className={`${field} tabular-nums`}
  />
);

export const RoomSpecFields: React.FC<{
  value: RoomSpecDraft;
  onChange: (next: RoomSpecDraft) => void;
  showFloor?: boolean;
  showStatus?: boolean;
}> = ({ value, onChange, showFloor = true, showStatus = true }) => {
  const set = <K extends keyof RoomSpecDraft>(key: K, v: RoomSpecDraft[K]) => onChange({ ...value, [key]: v });
  const maxGuests = (Number.isFinite(value.capacity) ? value.capacity : 0) + (Number.isFinite(value.buffer) ? value.buffer : 0);

  return (
    <div className="space-y-4">
      {showFloor && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Floor level" hint="0 = Ground">
            <NumberInput
              value={value.floor}
              min={0}
              max={50}
              step={0.5}
              onChange={(n) =>
                onChange({
                  ...value,
                  floor: n,
                  // Keep the label in step with the level unless someone typed their own.
                  floorLabel:
                    !value.floorLabel || value.floorLabel === floorLabelFor(value.floor) || /^floor \d/i.test(value.floorLabel)
                      ? Number.isFinite(n) ? floorLabelFor(n) : value.floorLabel
                      : value.floorLabel,
                })
              }
            />
          </Field>
          <Field label="Floor label">
            <input
              type="text"
              value={value.floorLabel}
              placeholder="e.g. Ground, Mezzanine, Floor 2"
              onChange={(e) => set('floorLabel', e.target.value)}
              className={field}
            />
          </Field>
        </div>
      )}

      <div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-4">
          <Field label="Beds *" hint="Physical beds">
            <NumberInput value={value.beds} min={1} max={20} onChange={(n) => set('beds', n)} />
          </Field>
          <Field label="Sleeps (pax) *" hint="Guests per room">
            <NumberInput value={value.capacity} min={1} max={20} onChange={(n) => set('capacity', n)} />
          </Field>
          <Field label="Buffer" hint="Extra guests allowed">
            <NumberInput value={value.buffer} min={0} max={10} onChange={(n) => set('buffer', n)} />
          </Field>
        </div>
        <p className="mt-2 text-[13px] text-stone-600">
          Allocation fills up to <strong className="font-semibold text-stone-900 tabular-nums">{value.capacity || 0}</strong> guests
          {value.buffer ? <>, or <strong className="font-semibold text-stone-900 tabular-nums">{maxGuests}</strong> using the buffer</> : null}.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-4">
        <Field label="Bed type">
          <select value={value.bedType} onChange={(e) => set('bedType', e.target.value)} className={field}>
            {Array.from(new Set([...ROOM_BED_TYPES, value.bedType])).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </Field>
        <Field label="Toilet">
          <select value={value.toiletType} onChange={(e) => set('toiletType', e.target.value)} className={field}>
            {ROOM_TOILET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
            {!ROOM_TOILET_TYPES.some((t) => t.value === value.toiletType) && (
              <option value={value.toiletType}>{value.toiletType}</option>
            )}
          </select>
        </Field>
        <Field label="Category">
          <select value={value.category} onChange={(e) => set('category', e.target.value as RoomCategory)} className={field}>
            {Array.from(new Set([...ROOM_CATEGORIES, value.category])).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      {showStatus && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-4">
          <Field label="Status">
            <select value={value.status} onChange={(e) => set('status', e.target.value as RoomStatus)} className={field}>
              <option value="available">Available</option>
              <option value="blocked">Blocked</option>
              <option value="cleaning">Cleaning</option>
            </select>
          </Field>
          {value.status === 'blocked' && (
            <Field label="Block reason" className="sm:col-span-2">
              <input
                type="text"
                value={value.blockedReason}
                placeholder="e.g. AC repair"
                onChange={(e) => set('blockedReason', e.target.value)}
                className={field}
              />
            </Field>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
        <Field label="Other features" hint="Comma separated, e.g. Balcony, Wheelchair access">
          <input
            type="text"
            value={value.features}
            placeholder="Balcony, Near lift"
            onChange={(e) => set('features', e.target.value)}
            className={field}
          />
        </Field>
        <Field label="Notes">
          <input
            type="text"
            value={value.notes}
            placeholder="Anything reception should know"
            onChange={(e) => set('notes', e.target.value)}
            className={field}
          />
        </Field>
      </div>
    </div>
  );
};

/** Edit every detail of an existing room. Building and room number stay fixed because allocations use them. */
export const RoomEditModal: React.FC<{
  room: Room;
  onClose: () => void;
  onSave: (room: Room) => void;
}> = ({ room, onClose, onSave }) => {
  const [spec, setSpec] = useState<RoomSpecDraft>(() => specFromRoom(room));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const problem = validateRoomSpec(spec);
    if (problem) return setError(problem);
    onSave(applyRoomSpec(room, spec));
    onClose();
  };

  return (
    <div className={`${modalScrim} z-[60]!`}>
      <div role="dialog" aria-modal="true" aria-labelledby="room-edit-title" className={`${modalCard} max-w-2xl`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h2 id="room-edit-title" className={modalTitle}>Edit room {room.roomNumber}</h2>
            <p className="mt-1 text-[13px] text-stone-600">
              {room.building}. The building and room number stay fixed because allotments use them.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={modalClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0">
          <RoomSpecFields value={spec} onChange={(next) => { setSpec(next); setError(null); }} />
          {error && <p role="alert" className="mt-4 text-[13px] font-medium text-rose-700">{error}</p>}
        </div>

        <div className={modalFooter}>
          <button type="button" onClick={onClose} className={btn.secondary}>
            Cancel
          </button>
          <button type="button" onClick={save} className={btn.primary}>
            <CheckCircle2 className="w-4 h-4" />
            Save room
          </button>
        </div>
      </div>
    </div>
  );
};
