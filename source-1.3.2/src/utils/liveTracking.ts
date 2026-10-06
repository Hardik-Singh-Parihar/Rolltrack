/**
 * Bridge between the popup UI and the background service worker's real,
 * detected meeting-tab data. Feature-detected so the same UI code still runs
 * fine when previewed as a plain web page (e.g. `npm run dev`) outside the
 * installed extension — in that case these all resolve to "nothing detected"
 * rather than throwing.
 */

export interface LiveAttendee {
  // Platform participant ID (falls back to the name) and the display name.
  // The map key is the ID, so the name has to be read from here.
  id?: string;
  name?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  // Accumulated time actually seen in the room during the tracked session
  // (gaps where they left and came back are not counted).
  presentMs?: number;
}

// A finished ON -> OFF tracking session, frozen by background.js and waiting
// for the Save Meeting prompt. Stored in chrome.storage.local so the prompt
// still appears when tracking was turned OFF from the on-page widget while the
// dashboard was closed.
export interface PendingSave {
  id: string;
  tabId: number;
  title: string;
  platform: 'Google Meet' | 'Zoom' | 'Microsoft Teams';
  trackingStartedAt: number;
  trackingEndedAt: number;
  durationSeconds: number;
  attendees: { name: string; firstSeenAt: number; lastSeenAt: number; presentMs?: number }[];
  // Headcount check: people the platform reported that RollTrack could not
  // identify. null = the platform's participant count could not be read.
  reportedCount?: number | null;
  missingAtStart?: number | null;
  missingAtEnd?: number | null;
  peakMissing?: number | null;
  // Where the Save prompt belongs: 'widget' = the meeting page it was turned
  // OFF on (the page shows it); 'dashboard' = shown here in the dashboard.
  origin?: 'widget' | 'dashboard';
}

// Headcount check shown in the Save prompt.
export interface Headcount {
  reported: number | null;
  missingAtStart: number | null;
  missingAtEnd: number | null;
  peakMissing: number | null;
}

export interface LiveTabState {
  tabId: number;
  platform: 'Google Meet' | 'Zoom' | 'Microsoft Teams' | 'Unknown';
  url: string;
  title: string;
  startedAt: number;
  attendees: Record<string, LiveAttendee>;
  // Tracking on/off is a deliberate act, not a byproduct of detection —
  // set only via setTrackingForTab() below (called by either the on-page
  // widget or this same popup UI), never inferred locally. trackingStartedAt
  // is the exact moment tracking was turned on, and is what duration/
  // percentage calculations should use — not `startedAt` above, which is
  // just "when this tab was first detected."
  trackingOn: boolean;
  trackingStartedAt: number | null;
  trackingEndedAt: number | null;
  // Latest headcount look: what the platform says vs. what we identified.
  reportedCount?: number | null;
  capturedCount?: number | null;
  lastUpdated: number;
}

type LiveTabsMap = Record<string, LiveTabState>;

declare const chrome: any;

export function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
}

export async function getLiveTabs(): Promise<LiveTabState[]> {
  if (!isExtensionContext()) return [];

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'ROLLTRACK_GET_LIVE_TABS' }, (response: any) => {
        if (chrome.runtime.lastError || !response) {
          resolve([]);
          return;
        }
        const map: LiveTabsMap = response.liveTabs || {};
        resolve(Object.values(map));
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * Turns tracking on/off for a specific detected tab. This is the ONLY way
 * trackingOn should change — called identically from the popup's toggle and
 * from the on-page widget (content.js), so both always agree. Background.js
 * stamps trackingStartedAt at the exact moment `on` becomes true.
 */
export function setTrackingForTab(tabId: number, on: boolean, platform?: string): void {
  if (!isExtensionContext()) return;
  try {
    chrome.runtime.sendMessage({ type: 'ROLLTRACK_SET_TRACKING', tabId, on, platform });
  } catch {
    // Extension context invalidated mid-call — nothing more we can do here;
    // the next getLiveTabs()/onLiveTabsUpdate() will simply reflect whatever
    // background.js's last known state was.
  }
}

/**
 * Subscribes to live updates broadcast by the background worker. Returns an
 * unsubscribe function. No-ops outside the extension context.
 */
export function onLiveTabsUpdate(callback: (tabs: LiveTabState[]) => void): () => void {
  if (!isExtensionContext()) return () => {};

  const listener = (message: any) => {
    if (message?.type === 'ROLLTRACK_LIVE_UPDATE') {
      const map: LiveTabsMap = message.payload || {};
      callback(Object.values(map));
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** Finished tracking sessions still waiting for the Save prompt. */
export async function getPendingSaves(): Promise<PendingSave[]> {
  if (!isExtensionContext()) return [];
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'ROLLTRACK_GET_PENDING_SAVES' }, (response: any) => {
        if (chrome.runtime.lastError || !response) {
          resolve([]);
          return;
        }
        resolve(response.pending || []);
      });
    } catch {
      resolve([]);
    }
  });
}

/** Drop a pending save once it has been saved or dismissed. */
export function removePendingSave(id: string): void {
  if (!isExtensionContext()) return;
  try {
    chrome.runtime.sendMessage({ type: 'ROLLTRACK_REMOVE_PENDING_SAVE', id });
  } catch {
    // Extension context invalidated — nothing more to do.
  }
}

/** Subscribes to pending-save list changes. Returns an unsubscribe function. */
export function onPendingSavesChange(callback: (pending: PendingSave[]) => void): () => void {
  if (!isExtensionContext()) return () => {};
  const listener = (message: any) => {
    if (message?.type === 'ROLLTRACK_PENDING_SAVES_CHANGED') {
      callback(message.payload || []);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
