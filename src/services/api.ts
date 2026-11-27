import type { Reservation, Room } from '../types';

export interface PullStatus {
  running: boolean;
  lastSyncedAt: string | null;
  error: string | null;
}
interface BackendSettings {
  categories: string[];
  adminPin: string;
  /** AI Planner rules and chat-box instructions (see allocationRules). */
  plannerRules?: unknown;
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/'+path, body === undefined ? undefined : {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),
  });
  if (response.status === 401) window.location.reload();
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || 'The local app could not save or load data.');
  }
  return response.json();
}
export async function loadAccommodation() {
  const [reservations,rooms,settings,photos] = await Promise.all([
    request<Reservation[]>('reservations'),
    request<Room[]>('rooms'),
    request<BackendSettings>('settings'),
    // Photos are extra: the app still loads if the photo index cannot be read.
    request<Record<string,string>>('photos').catch(() => ({} as Record<string,string>)),
  ]);
  return {reservations,rooms,settings,photos};
}
export const fetchBackendStatus = () => request<{ pull: PullStatus; revision: number; events: boolean; hiddenStays?: number }>('status');

/** A stay NKERP still lists that the app hides because it was deleted here. */
export interface HiddenStay {
  key: string; tour: string; its: string; name: string; office: string;
  arrival: string; departure: string; deletedAt: string | null;
}
export const fetchHiddenStays = () => request<HiddenStay[]>('hidden-stays');
export const restoreHiddenStays = (keys: string[]) => request<{ restored: number }>('hidden-stays/restore', { keys });
export const pullNkerp = () => request<{
  received: number;
  changed: number;
  expired: number;
  travel: { changed: number; checked: number; pending: number; failed: number };
}>('nkerp/pull', {});

export async function saveChanges<T extends {id:string}>(collection: 'rooms' | 'reservations', before: T[], after: T[]) {
  const old = new Map(before.map(row => [row.id,row]));
  const changes: {id:string; before:object|null; after:object|null}[] = [];
  for (const row of after) {
    const previous = old.get(row.id);
    old.delete(row.id);
    if (!previous) {
      changes.push({id:row.id,before:null,after:row});
      continue;
    }
    const patch: Record<string,unknown> = {};
    for (const key of new Set([...Object.keys(row),...Object.keys(previous)])) {
      if (['updatedAt','createdAt'].includes(key)) continue;
      const prev = previous[key as keyof T];
      const next = row[key as keyof T];
      if (JSON.stringify(prev) !== JSON.stringify(next)) patch[key] = next ?? null;
    }
    if (Object.keys(patch).length) changes.push({id:row.id,before:previous,after:patch});
  }
  for (const row of old.values()) changes.push({id:row.id,before:row,after:null});
  if (changes.length) await request('changes',{collection,changes});
}
export async function resetBackendRooms(): Promise<Room[] | null> {
  try { return (await request<{rooms:Room[]}>('rooms/reset',{})).rooms; }
  catch { return null; }
}
export async function saveBackendSettings(settings: Partial<BackendSettings>) {
  try { await request('settings',settings); return true; }
  catch { return false; }
}

/** A B→A slip as recorded when it was printed or downloaded (see server/slips.ts). */
export interface SlipRecord {
  id: string; slipNo: string; direction: 'B_TO_A'; createdAt: string;
  issues: { at: string; action: 'print' | 'pdf' }[]; tours: string[]; offices: string[]; paxCount: number; amountNote: string;
  pax: { reservationId: string; its: string; name: string; tour: string; office: string; arrival: string; departure: string;
    room: string; category: string; moneyGiven: string }[];
}
export const fetchSlips = () => request<SlipRecord[]>('slips');
export const recordSlip = (slip: { slipNo: string; reservationIds: string[]; amountNote: string; action: 'print' | 'pdf' }) =>
  request<SlipRecord>('slips', { ...slip, direction: 'B_TO_A' });

export type { RoomDrafts, DraftTour } from './roomDrafts';
export const fetchRoomDrafts = () => request<import('./roomDrafts').RoomDrafts>('room-drafts');
export const refreshRoomDrafts = () => request<import('./roomDrafts').RoomDrafts>('room-drafts/refresh', {});
export const dismissRoomDraft = (tourRef: string, basis: string) => request<import('./roomDrafts').RoomDrafts>('room-drafts/dismiss', { tourRef, basis });
export const restoreRoomDraft = (tourRef: string) => request<import('./roomDrafts').RoomDrafts>('room-drafts/restore', { tourRef });
export const saveRoomDraftSettings = (settings: import('./roomDrafts').RoomDraftSettings) => request<import('./roomDrafts').RoomDrafts>('room-drafts/settings', settings);
