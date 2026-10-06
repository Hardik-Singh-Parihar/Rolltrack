import { Meeting } from '../types';
import { isExtensionContext } from './liveTracking';

declare const chrome: any;

/**
 * Saved meetings live in chrome.storage.local (not the dashboard's
 * localStorage) so the Save popup on the meeting page, which runs on another
 * origin, can save one too. Outside the extension (npm run dev) it falls back
 * to localStorage.
 */
const KEY = 'rolltrack_meetings';
const MIGRATED_KEY = 'rolltrack_meetings_migrated';

function readLocal(): Meeting[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * Load saved meetings. The first time this runs inside the extension it copies
 * any meetings saved by older versions (dashboard localStorage) across, merged
 * with anything already saved from a meeting page, and never runs again.
 */
export async function loadMeetings(): Promise<Meeting[]> {
  if (!isExtensionContext()) return readLocal();
  const res = await chrome.storage.local.get([KEY, MIGRATED_KEY]);
  const existing: Meeting[] = Array.isArray(res[KEY]) ? res[KEY] : [];
  if (res[MIGRATED_KEY]) return existing;

  const legacy = readLocal();
  const ids = new Set(existing.map((m) => m.id));
  const merged = [...existing, ...legacy.filter((m) => !ids.has(m.id))];
  await chrome.storage.local.set({ [KEY]: merged, [MIGRATED_KEY]: true });
  return merged;
}

/** Write the whole list (used for edits, deletes and Clear all). */
export async function persistMeetings(meetings: Meeting[]): Promise<void> {
  if (!isExtensionContext()) {
    try {
      localStorage.setItem(KEY, JSON.stringify(meetings));
    } catch (e) {
      console.warn('Could not save meetings', e);
    }
    return;
  }
  try {
    await chrome.storage.local.set({ [KEY]: meetings });
  } catch (e) {
    console.warn('Could not save meetings', e);
  }
}

/** Add a meeting through the background, the single writer for new meetings. */
export function addMeetingViaBackground(meeting: Meeting): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'ROLLTRACK_ADD_MEETING', meeting }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

/** Calls back with the new list whenever meetings change anywhere. */
export function onMeetingsChanged(callback: (meetings: Meeting[]) => void): () => void {
  if (!isExtensionContext()) return () => {};
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[KEY]) {
      const v = changes[KEY].newValue;
      callback(Array.isArray(v) ? (v as Meeting[]) : []);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
