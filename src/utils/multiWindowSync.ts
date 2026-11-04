/**
 * Real-time Multi-Window Synchronization Service
 * Coordinates live updates across multiple browser windows, tabs, and sessions on the same computer
 * using BroadcastChannel, localStorage storage events, and Server-Sent Events (SSE).
 */

const SYNC_CHANNEL_NAME = 'zaereen_multiwindow_sync_channel';

// Singleton BroadcastChannel instance
let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
  }
} catch (e) {
  console.warn('[Sync] BroadcastChannel not supported in this environment', e);
}

export interface SyncEventPayload {
  type: string;
  source?: string;
  timestamp: number;
  [key: string]: any;
}

/**
 * Broadcast an update event to all other open tabs/windows on the same computer
 */
export function broadcastLiveSync(payload: Partial<SyncEventPayload> = {}): void {
  const fullPayload: SyncEventPayload = {
    type: 'DATA_UPDATED',
    source: 'client_mutation',
    timestamp: Date.now(),
    ...payload,
  };

  // 1. Send via BroadcastChannel (instant <1ms to all other tabs/windows in same browser)
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(fullPayload);
    } catch (err) {
      console.warn('[Sync] BroadcastChannel postMessage error:', err);
    }
  }

  // 2. Touch a heartbeat timestamp in localStorage to trigger storage events in other windows
  try {
    localStorage.setItem('zaereen_live_sync_ping', String(Date.now()));
  } catch {
    // Ignore localStorage quota or private mode issues
  }
}

/**
 * Subscribe to live changes occurring from any other window or server mutation
 */
export function subscribeToMultiWindowSync(
  onSync: (detail: SyncEventPayload) => void
): () => void {
  let isSubscribed = true;
  let lastProcessedTimestamp = 0;

  // Debounced wrapper to prevent double-firing in rapid succession
  const handleTrigger = (detail: SyncEventPayload) => {
    if (!isSubscribed) return;
    const now = Date.now();
    // Allow calls if timestamp is newer or at least 150ms apart
    if (detail.timestamp && detail.timestamp <= lastProcessedTimestamp && now - lastProcessedTimestamp < 150) {
      return;
    }
    lastProcessedTimestamp = now;
    onSync(detail);
  };

  // 1. BroadcastChannel Listener
  const handleBroadcastMessage = (event: MessageEvent) => {
    if (!event.data) return;
    handleTrigger(event.data);
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handleBroadcastMessage);
  }

  // 2. Window Storage Event Listener (Fires in all other windows on the same computer)
  const handleStorageEvent = (event: StorageEvent) => {
    if (!event.key) return;
    if (
      event.key === 'zaereen_live_sync_ping' ||
      event.key.includes('zaereen_accommodation_rooms') ||
      event.key.includes('zaereen_accommodation_reservations') ||
      event.key.includes('zaereen_accommodation_sheets')
    ) {
      handleTrigger({
        type: 'STORAGE_CHANGE',
        key: event.key,
        timestamp: Date.now(),
      });
    }
  };

  window.addEventListener('storage', handleStorageEvent);

  // 3. Window Focus Listener (When user clicks into an open background window)
  const handleWindowFocus = () => {
    handleTrigger({
      type: 'WINDOW_FOCUS',
      timestamp: Date.now(),
    });
  };

  window.addEventListener('focus', handleWindowFocus);

  // 4. Server-Sent Events (SSE) Listener
  let eventSource: EventSource | null = null;
  try {
    eventSource = new EventSource('/api/events');
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type && parsed.type !== 'CONNECTED') {
          handleTrigger(parsed);
        }
      } catch (err) {
        console.warn('[Sync] Failed to parse SSE event data', err);
      }
    };
    eventSource.onerror = () => {
      // Browser EventSource automatically attempts reconnection
    };
  } catch (err) {
    console.warn('[Sync] SSE not supported or connection error:', err);
  }

  // Return cleanup function
  return () => {
    isSubscribed = false;
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handleBroadcastMessage);
    }
    window.removeEventListener('storage', handleStorageEvent);
    window.removeEventListener('focus', handleWindowFocus);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}
