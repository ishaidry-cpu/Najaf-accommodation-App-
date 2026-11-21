import type { Reservation, Room } from '../types';

export interface PullStatus {
  running: boolean;
  lastSyncedAt: string | null;
  error: string | null;
}
interface BackendSettings {
  categories: string[];
  adminPin: string;
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
  const [reservations,rooms,settings] = await Promise.all([
    request<Reservation[]>('reservations'),
    request<Room[]>('rooms'),
    request<BackendSettings>('settings'),
  ]);
  return {reservations,rooms,settings};
}
export const fetchBackendStatus = () => request<{ pull: PullStatus; revision: number; events: boolean }>('status');
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
