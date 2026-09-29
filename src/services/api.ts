import { Reservation, Room, GoogleSheetsConfig, UserRole } from '../types';

export interface BackendStatus {
  status: string;
  liveBackend: boolean;
  serverTime: string;
  reservationsCount: number;
  roomsCount: number;
  storageLocation: string;
}

export interface BackendSettings {
  sheetsConfig: GoogleSheetsConfig;
  categories: string[];
  userRole: UserRole;
  adminPin: string;
}

/**
 * Check if the backend API is alive and responding
 */
export async function checkBackendHealth(): Promise<BackendStatus | null> {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Load all reservations from the live backend
 */
export async function fetchBackendReservations(): Promise<Reservation[] | null> {
  try {
    const res = await fetch('/api/reservations');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[API] Could not fetch reservations from backend:', err);
    return null;
  }
}

/**
 * Save all reservations to the live backend
 */
export async function saveBackendReservations(reservations: Reservation[]): Promise<boolean> {
  try {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservations }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Could not save reservations to backend:', err);
    return false;
  }
}

/**
 * Upsert a single reservation on the backend
 */
export async function upsertBackendReservation(reservation: Reservation): Promise<boolean> {
  try {
    const res = await fetch('/api/reservations/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reservation),
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Could not upsert reservation on backend:', err);
    return false;
  }
}

/**
 * Delete a single reservation on the backend
 */
export async function deleteBackendReservation(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/reservations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Could not delete reservation on backend:', err);
    return false;
  }
}

/**
 * Batch delete reservations on the backend
 */
export async function batchDeleteBackendReservations(ids: string[]): Promise<boolean> {
  try {
    const res = await fetch('/api/reservations/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Could not batch delete reservations on backend:', err);
    return false;
  }
}

/**
 * Load all 114 rooms from the live backend
 */
export async function fetchBackendRooms(): Promise<Room[] | null> {
  try {
    const res = await fetch('/api/rooms');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[API] Could not fetch rooms from backend:', err);
    return null;
  }
}

/**
 * Save all rooms to the live backend
 */
export async function saveBackendRooms(rooms: Room[]): Promise<boolean> {
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rooms }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Could not save rooms to backend:', err);
    return false;
  }
}

/**
 * Update an individual room on the backend
 */
export async function updateBackendRoom(id: string, updates: Partial<Room>): Promise<boolean> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Could not update room on backend:', err);
    return false;
  }
}

/**
 * Reset rooms on the backend to official 114 inventory
 */
export async function resetBackendRooms(): Promise<Room[] | null> {
  try {
    const res = await fetch('/api/rooms/reset', {
      method: 'POST',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.rooms || null;
  } catch (err) {
    console.warn('[API] Could not reset rooms on backend:', err);
    return null;
  }
}

/**
 * Load backend settings
 */
export async function fetchBackendSettings(): Promise<BackendSettings | null> {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[API] Could not fetch settings from backend:', err);
    return null;
  }
}

/**
 * Save backend settings
 */
export async function saveBackendSettings(settings: Partial<BackendSettings>): Promise<boolean> {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Could not save settings to backend:', err);
    return false;
  }
}
