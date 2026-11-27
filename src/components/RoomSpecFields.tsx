import React, { useState } from 'react';
import { BedDouble, CheckCircle2, X } from 'lucide-react';
import { Room, RoomCategory, RoomStatus } from '../types';
import {
  ROOM_BED_TYPES,
  ROOM_CATEGORIES,
  ROOM_TOILET_TYPES,
  buildRoomAmenities,
  getRoomBedCount,
  getRoomCustomFeatures,
} from '../services/storage';

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

const inputClass =
  'w-full min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-900 font-semibold focus:outline-none focus:ring-1 focus:ring-brand-700';

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string }> = ({
  label,
  hint,
  children,
  className,
}) => (
  <label className={`block ${className || ''}`}>
    <span className="block text-stone-600 font-semibold mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-stone-400 mt-0.5">{hint}</span>}
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
    className={`${inputClass} tabular-nums`}
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
    <div className="space-y-4 text-xs">
      {showFloor && (
        <div className="grid grid-cols-2 gap-3">
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
              className={inputClass}
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
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
      <p className="-mt-2 text-[11px] text-stone-500">
        Allocation fills up to <strong className="text-stone-800 tabular-nums">{value.capacity || 0}</strong> guests
        {value.buffer ? <>, or <strong className="text-stone-800 tabular-nums">{maxGuests}</strong> using the buffer</> : null}.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Bed type">
          <select value={value.bedType} onChange={(e) => set('bedType', e.target.value)} className={inputClass}>
            {Array.from(new Set([...ROOM_BED_TYPES, value.bedType])).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </Field>
        <Field label="Toilet">
          <select value={value.toiletType} onChange={(e) => set('toiletType', e.target.value)} className={inputClass}>
            {ROOM_TOILET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
            {!ROOM_TOILET_TYPES.some((t) => t.value === value.toiletType) && (
              <option value={value.toiletType}>{value.toiletType}</option>
            )}
          </select>
        </Field>
        <Field label="Category">
          <select value={value.category} onChange={(e) => set('category', e.target.value as RoomCategory)} className={inputClass}>
            {Array.from(new Set([...ROOM_CATEGORIES, value.category])).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      {showStatus && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Status">
            <select value={value.status} onChange={(e) => set('status', e.target.value as RoomStatus)} className={inputClass}>
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
                className={inputClass}
              />
            </Field>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Other features" hint="Comma separated, e.g. Balcony, Wheelchair access">
          <input
            type="text"
            value={value.features}
            placeholder="Balcony, Near lift"
            onChange={(e) => set('features', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Notes">
          <input
            type="text"
            value={value.notes}
            placeholder="Anything reception should know"
            onChange={(e) => set('notes', e.target.value)}
            className={inputClass}
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
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-950/45 backdrop-blur-[2px] animate-in fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-edit-title"
        className="bg-stone-50 rounded-t-3xl sm:rounded-2xl max-w-2xl w-full shadow-2xl border border-stone-200 flex flex-col max-h-[92vh] overflow-hidden"
      >
        <div className="bg-brand-700 text-white px-5 py-4 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <BedDouble className="w-5 h-5 text-gold-200" />
            <div>
              <h2 id="room-edit-title" className="text-base font-bold">Edit room {room.roomNumber}</h2>
              <p className="text-xs text-stone-200">{room.building}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-stone-300 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          <div className="bg-white p-4 rounded-xl border border-stone-200">
            <RoomSpecFields value={spec} onChange={(next) => { setSpec(next); setError(null); }} />
          </div>
          {error && <p role="alert" className="mt-3 text-xs font-semibold text-red-700">{error}</p>}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-stone-200 bg-white flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="min-h-[40px] px-5 py-2 rounded-xl text-xs font-bold bg-brand-700 hover:bg-brand-800 text-white flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            Save room
          </button>
        </div>
      </div>
    </div>
  );
};
