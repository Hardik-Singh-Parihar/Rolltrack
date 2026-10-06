// RollTrack Chrome Extension Background Service Worker (Manifest V3)
//
// Responsibility: aggregate attendee snapshots pushed by content.js (one per
// open meeting tab), persist them to chrome.storage.local so the popup can
// read the current state the moment it opens, and broadcast live updates to
// the popup while it's open.
//
// Tracking on/off is a DELIBERATE ACT, not a byproduct of detection: it is
// only ever set by an explicit ROLLTRACK_SET_TRACKING message from the
// on-page widget or the popup/dashboard — both call the same code path here.
//
// People are identified by the platform's participant ID (falling back to the
// name), so two students with the same display name stay separate and a
// renamed student is not split. Turning tracking ON or OFF takes a FRESH
// headcount (asked of the meeting page at that instant), so everyone present
// at the start is registered from the start, and everyone present at the end
// is closed out at the end, regardless of when the teacher joined.
//
// Each ON -> OFF span is one "tracking session":
//   * turning ON always starts a FRESH session (new trackingStartedAt, fresh
//     attendee windows) — it never resumes a previous one.
//   * turning OFF finalizes the session into a "pending save" stored in
//     chrome.storage.local. The dashboard consumes pending saves and shows
//     the Save Meeting prompt, so it works even when the OFF came from the
//     on-page widget while the dashboard was closed.

const STORAGE_KEY = 'rolltrack_live_tabs';
const PENDING_KEY = 'rolltrack_pending_saves';
const MEETINGS_KEY = 'rolltrack_meetings';

// Two snapshots further apart than this are treated as "left and came back",
// so the gap is not counted as presence.
const MAX_PRESENCE_GAP_MS = 30000;
// An attendee seen this recently before tracking was switched on is treated
// as "already in the room" and counted from the moment tracking starts.
const STILL_PRESENT_MS = 15000;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[RollTrack] Extension installed successfully.');
  // Tabs that were open before this install/update get a working page script.
  ready.then(() => ensureContentScripts()).catch(() => {});
});

// In-memory mirror of chrome.storage.local[STORAGE_KEY] for fast merges.
// Shape: { [tabId: string]: LiveTabState }
// LiveTabState: {
//   tabId, platform, url, title, startedAt,
//   attendees: { [name]: { firstSeenAt, lastSeenAt, presentMs } },
//   trackingOn, trackingStartedAt, trackingEndedAt,
//   lastUpdated
// }
let liveTabs = {};

async function loadState() {
  const res = await chrome.storage.local.get([STORAGE_KEY]);
  liveTabs = res[STORAGE_KEY] || {};
}

async function persistState() {
  clearTimeout(persistTimer);
  persistTimer = null;
  await chrome.storage.local.set({ [STORAGE_KEY]: liveTabs });
}

// Heartbeats arrive every 2 s per tab. Writing storage on every one is wasteful,
// so they are batched into one write (state-changing actions still write at once).
let persistTimer = null;
function persistStateSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    chrome.storage.local.set({ [STORAGE_KEY]: liveTabs }).catch(() => {});
  }, 1500);
}

// Small local error log (last 50) so problems can be exported from the dashboard.
const ERROR_LOG_KEY = 'rolltrack_error_log';
async function logError(where, err) {
  try {
    const res = await chrome.storage.local.get([ERROR_LOG_KEY]);
    const list = Array.isArray(res[ERROR_LOG_KEY]) ? res[ERROR_LOG_KEY] : [];
    list.push({ at: new Date().toISOString(), where, message: String((err && err.message) || err) });
    await chrome.storage.local.set({ [ERROR_LOG_KEY]: list.slice(-50) });
  } catch (e) {
    // never throw from the logger
  }
}
self.addEventListener('unhandledrejection', (e) => logError('unhandledrejection', e.reason));
self.addEventListener('error', (e) => logError('error', e.error || e.message));

// Every handler waits for this before touching liveTabs. Without it, a message
// arriving right after the service worker restarts sees an empty map, creates
// a blank tab entry (trackingOn: false) and persists it over the real state —
// silently switching tracking off / losing the session start time.
const ready = loadState();

function broadcast(type, payload) {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
    // No listener currently open (popup closed) — safe to ignore.
  });
}

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Content script may not be ready yet, or the tab navigated away — fine.
  });
}

// ---------------------------------------------------------------------
// People, headcounts
// ---------------------------------------------------------------------
function normName(n) {
  return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Accepts the new [{id,name}] shape and (defensively) plain name strings.
function normalizeList(list) {
  const out = [];
  const seen = new Set();
  for (const a of list || []) {
    const person = typeof a === 'string' ? { id: 'n:' + normName(a), name: a } : a;
    if (!person || !person.name) continue;
    const id = person.id || 'n:' + normName(person.name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: person.name });
  }
  return out;
}

// Merge one look at the room into the attendee map. Anyone in `list` counts as
// present at `now`. `concurrent` collects names that were seen under two
// different IDs in the SAME look: those are two real people, never merged.
function applyScan(attendees, list, now, concurrent) {
  const out = { ...attendees };
  const idsByName = {};
  for (const p of list) {
    const prev = out[p.id];
    if (prev) {
      const gap = now - prev.lastSeenAt;
      out[p.id] = {
        ...prev,
        id: p.id,
        name: p.name,
        lastSeenAt: now,
        presentMs: (prev.presentMs || 0) + (gap > 0 && gap <= MAX_PRESENCE_GAP_MS ? gap : 0),
      };
    } else {
      out[p.id] = { id: p.id, name: p.name, firstSeenAt: now, lastSeenAt: now, presentMs: 0 };
    }
    const norm = normName(p.name);
    (idsByName[norm] = idsByName[norm] || new Set()).add(p.id);
  }
  for (const norm of Object.keys(idsByName)) {
    if (idsByName[norm].size > 1) concurrent[norm] = true;
  }
  return out;
}

// People Meet says are in the call but we could not identify. null = unknown.
function missingFrom(reportedCount, capturedCount) {
  if (reportedCount == null || capturedCount == null) return null;
  return Math.max(0, reportedCount - capturedCount);
}

// Ask the meeting page for a fresh headcount. null if it does not answer.
function requestScan(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'ROLLTRACK_SCAN_NOW' }, (res) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res && Array.isArray(res.attendees) ? res : null);
      });
    } catch (e) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------
// Keeping meeting pages connected
//
// When the extension is reloaded, updated, or switched off and on again, Chrome
// leaves the OLD content script running in already-open meeting tabs with a
// dead connection (the widget still reacts, nothing reaches the extension) and
// never injects a new one. So whenever this service worker starts, and when
// asked to start tracking, each meeting tab is checked and a fresh copy is
// injected where the page does not answer. The fresh copy replaces the dead
// widget by itself (see the guard at the top of content.js): no tab refresh.
// ---------------------------------------------------------------------
const MEETING_URL_PATTERNS = ['https://meet.google.com/*', 'https://*.zoom.us/*', 'https://teams.microsoft.com/*'];

function pingTab(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 800);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'ROLLTRACK_PING' }, (res) => {
        clearTimeout(timer);
        resolve(!chrome.runtime.lastError && !!(res && res.alive));
      });
    } catch (e) {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

// true = a working copy of the page script is (now) running in that tab.
async function ensureContentScript(tabId) {
  if (await pingTab(tabId)) return true;
  if (!chrome.scripting || !chrome.scripting.executeScript) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (e) {
    // Not injectable (discarded tab, error page, permission): nothing to do.
    return false;
  }
}

async function ensureContentScripts() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: MEETING_URL_PATTERNS });
  } catch (e) {
    return;
  }
  for (const tab of tabs) {
    if (tab.id == null || tab.discarded) continue;
    await ensureContentScript(tab.id);
  }
}

// ---------------------------------------------------------------------
// Saved meetings (written here so the Save popup on the meeting page can save)
// ---------------------------------------------------------------------
let meetingsChain = Promise.resolve();

function addMeeting(meeting) {
  meetingsChain = meetingsChain
    .then(async () => {
      const res = await chrome.storage.local.get([MEETINGS_KEY]);
      const list = Array.isArray(res[MEETINGS_KEY]) ? res[MEETINGS_KEY] : [];
      await chrome.storage.local.set({ [MEETINGS_KEY]: [meeting, ...list.filter((m) => m.id !== meeting.id)] });
    })
    .catch((e) => console.warn('[RollTrack] add meeting failed', e));
  return meetingsChain;
}

const pad2 = (n) => String(n).padStart(2, '0');
// Local date/time (toISOString() is UTC and files late-night meetings under the wrong day).
const localDate = (ts) => {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
};

// Turn a finished tracking session (pending save) into a saved Meeting.
// Mirrors SaveMeetingModal.handleSave so both save paths produce the same
// record. Raw attendance only: no roster matching happens at save time.
function buildMeetingFromPending(pend, title, addPlaceholders) {
  const windowStart = pend.trackingStartedAt;
  const windowEnd = pend.trackingEndedAt;
  const windowMs = Math.max(1, windowEnd - windowStart);
  const durationMins = Math.max(1, Math.round((pend.durationSeconds || 0) / 60));
  const stamp = Date.now();

  const sorted = (pend.attendees || []).slice().sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  const attendees = sorted.map((a, idx) => {
    const presentMs =
      a.presentMs != null
        ? Math.min(Math.max(0, a.presentMs), windowMs)
        : Math.max(0, Math.min(a.lastSeenAt, windowEnd) - Math.max(a.firstSeenAt, windowStart));
    return {
      id: 'att-' + stamp + '-' + idx,
      rollNo: 0,
      name: a.name,
      email: '',
      durationMinutes: Math.max(1, Math.round(presentMs / 60000)),
      totalMinutes: durationMins,
      presencePercentage: Math.min(100, Math.round((presentMs / windowMs) * 100)),
      joinedAfterMin: Math.max(0, Math.round((a.firstSeenAt - windowStart) / 60000)),
      leftBeforeEndMin: Math.max(0, Math.round((windowEnd - Math.min(a.lastSeenAt, windowEnd)) / 60000)),
    };
  });
  const missing = pend.missingAtEnd || 0;
  if (addPlaceholders && missing > 0) {
    for (let i = 1; i <= missing; i++) {
      attendees.push({
        id: 'att-unidentified-' + stamp + '-' + i,
        rollNo: 0,
        name: 'Unidentified participant ' + i,
        email: '',
        durationMinutes: 0,
        totalMinutes: durationMins,
        presencePercentage: 0,
      });
    }
  }

  const timeFmt = { hour: '2-digit', minute: '2-digit' };
  return {
    id: 'live-' + stamp,
    title: String(title || '').trim() || pend.title || 'Live Recorded Session',
    platform: pend.platform,
    date: localDate(windowStart),
    startTime: new Date(windowStart).toLocaleTimeString([], timeFmt),
    endTime: new Date(windowEnd).toLocaleTimeString([], timeFmt),
    durationMinutes: durationMins,
    attendeeCount: attendees.length,
    hostName: 'Meeting Host',
    hostEmail: '',
    attendanceGoal: 75,
    isGoalConfirmed: false,
    attendees,
    activityLog: [],
    metrics: { screenShares: 0, micsUnmuted: 0, camerasTurnedOn: 0, handsRaised: 0 },
  };
}

// ---------------------------------------------------------------------
// Pending saves: finished tracking sessions waiting for the Save prompt.
// Serialized through one promise chain so two quick OFFs can't overwrite
// each other's read-modify-write.
// ---------------------------------------------------------------------
let pendingChain = Promise.resolve();

function updatePendingSaves(mutator) {
  pendingChain = pendingChain
    .then(async () => {
      const res = await chrome.storage.local.get([PENDING_KEY]);
      const next = mutator(res[PENDING_KEY] || []);
      await chrome.storage.local.set({ [PENDING_KEY]: next });
      broadcast('ROLLTRACK_PENDING_SAVES_CHANGED', next);
      return next;
    })
    .catch((e) => console.warn('[RollTrack] pending-save update failed', e));
  return pendingChain;
}

// Freeze a finished session into a self-contained record. Attendee windows
// are clamped to [start, end] so nothing from before tracking was turned on
// (or after it was turned off) can leak into the saved meeting.
//
// Entries that share a name are ONE person who dropped and rejoined under a
// new ID: their time is added up. The exception is a name that was ever seen
// under two IDs in the same look (two real people): those stay separate and
// get a "(2)", "(3)" suffix.
function buildPendingSave(tab, endedAt) {
  const start = tab.trackingStartedAt;
  if (!start) return null;
  const windowMs = Math.max(0, endedAt - start);
  const entries = Object.entries(tab.attendees || {})
    .filter(([, a]) => a.lastSeenAt >= start)
    .map(([key, a]) => ({
      name: a.name || key,
      firstSeenAt: Math.max(a.firstSeenAt, start),
      lastSeenAt: Math.min(a.lastSeenAt, endedAt),
      presentMs: Math.min(a.presentMs || 0, windowMs),
    }))
    .sort((x, y) => x.firstSeenAt - y.firstSeenAt);

  const groups = new Map();
  for (const e of entries) {
    const norm = normName(e.name);
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm).push(e);
  }
  const concurrent = tab.concurrentNames || {};
  const attendees = [];
  for (const [norm, list] of groups) {
    if (list.length === 1) {
      attendees.push(list[0]);
    } else if (concurrent[norm]) {
      list.forEach((e, i) => attendees.push({ ...e, name: i === 0 ? e.name : e.name + ' (' + (i + 1) + ')' }));
    } else {
      attendees.push({
        name: list[0].name,
        firstSeenAt: Math.min(...list.map((e) => e.firstSeenAt)),
        lastSeenAt: Math.max(...list.map((e) => e.lastSeenAt)),
        presentMs: Math.min(
          list.reduce((sum, e) => sum + e.presentMs, 0),
          windowMs
        ),
      });
    }
  }
  attendees.sort((x, y) => x.firstSeenAt - y.firstSeenAt);

  return {
    id: `${tab.tabId}-${start}`,
    tabId: tab.tabId,
    title: tab.title || tab.platform,
    platform: tab.platform,
    trackingStartedAt: start,
    trackingEndedAt: endedAt,
    durationSeconds: Math.max(0, Math.round((endedAt - start) / 1000)),
    attendees,
    // Headcount check: people Meet reported but we could not identify.
    reportedCount: tab.reportedCount ?? null,
    missingAtStart: tab.missingAtStart ?? null,
    missingAtEnd: tab.missingAtEnd ?? null,
    peakMissing: tab.peakMissing ?? null,
  };
}

// Focus the dashboard tab if it's already open, otherwise open a new one.
async function openHome() {
  const homeUrl = chrome.runtime.getURL('index.html');
  try {
    const tabs = await chrome.tabs.query({ url: homeUrl });
    const existing = tabs && tabs[0];
    if (existing && existing.id != null) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId != null) {
        await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
      }
    } else {
      await chrome.tabs.create({ url: homeUrl });
    }
  } catch (e) {
    // Querying/focusing can fail in some Chrome versions even for the
    // extension's own page — a fresh tab is always a safe fallback.
    chrome.tabs.create({ url: homeUrl }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  // Content script pushed a fresh snapshot of who it currently sees on the page.
  if (message.type === 'ROLLTRACK_ATTENDEES_SNAPSHOT') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) return;

    ready.then(() => {
      const key = String(tabId);
      const now = Date.now();
      const existing = liveTabs[key];
      const list = normalizeList(message.attendees);
      const concurrent = existing ? { ...(existing.concurrentNames || {}) } : {};
      const attendees = applyScan(existing ? existing.attendees : {}, list, now, concurrent);

      const reportedCount = message.reportedCount == null ? null : message.reportedCount;
      const missing = missingFrom(reportedCount, list.length);
      const tracking = existing ? !!existing.trackingOn : false;

      liveTabs[key] = {
        tabId,
        platform: message.platform,
        url: message.url,
        title: (sender.tab && sender.tab.title) || message.platform,
        startedAt: existing ? existing.startedAt : now,
        attendees,
        concurrentNames: concurrent,
        trackingOn: tracking,
        trackingStartedAt: existing ? existing.trackingStartedAt || null : null,
        trackingEndedAt: existing ? existing.trackingEndedAt || null : null,
        reportedCount,
        capturedCount: list.length,
        missingAtStart: existing ? existing.missingAtStart ?? null : null,
        missingAtEnd: existing ? existing.missingAtEnd ?? null : null,
        peakMissing: tracking
          ? Math.max((existing && existing.peakMissing) || 0, missing || 0)
          : existing
            ? existing.peakMissing ?? null
            : null,
        lastUpdated: now,
      };

      persistStateSoon();
      broadcast('ROLLTRACK_LIVE_UPDATE', liveTabs);
    });
    return;
  }

  // Explicit on/off from either the on-page widget (content.js) or the
  // popup/dashboard toggle — same handler either way, one source of truth.
  if (message.type === 'ROLLTRACK_SET_TRACKING') {
    const tabId = message.tabId;
    if (tabId == null) return;

    ready.then(async () => {
      const key = String(tabId);
      const now = Date.now();
      const on = !!message.on;
      // Create the entry if this is flipped before any attendee has been
      // scanned yet — tracking intent shouldn't depend on detection succeeding.
      const existing = liveTabs[key] || {
        tabId,
        platform: message.platform || 'Unknown',
        url: '',
        title: message.platform || 'Meeting',
        startedAt: now,
        attendees: {},
        trackingOn: false,
        trackingStartedAt: null,
        trackingEndedAt: null,
      };
      const wasOn = !!existing.trackingOn;

      if (on && wasOn) return; // already tracking — don't restart the clock
      if (!on && !wasOn) return; // already off — nothing to finalize

      // A fresh headcount taken at this exact moment: the widget sends one with
      // the click; for a toggle from the dashboard we ask the meeting page.
      let raw = message.snapshot || (await requestScan(tabId));
      if (!raw && !message.snapshot) {
        // The page did not answer: its script is probably a dead leftover from an
        // extension reload / switch-off. Bring a fresh copy in and ask once more,
        // so a session is not started from stale data (an empty room).
        if (await ensureContentScript(tabId)) {
          await new Promise((r) => setTimeout(r, 700));
          raw = await requestScan(tabId);
        }
      }
      const scan = raw ? { list: normalizeList(raw.attendees), reported: raw.reportedCount == null ? null : raw.reportedCount } : null;

      if (on) {
        // FRESH session: new start time and clean attendee windows. Everyone
        // on the page right now is registered from NOW — whether the teacher
        // joined first or last — and nobody from a previous session carries over.
        const concurrent = {};
        let attendees = {};
        if (scan) {
          attendees = applyScan({}, scan.list, now, concurrent);
        } else {
          // Page did not answer: fall back to "seen a moment ago".
          for (const [k, a] of Object.entries(existing.attendees || {})) {
            if (now - a.lastSeenAt <= STILL_PRESENT_MS) {
              attendees[k] = { id: a.id || k, name: a.name || k, firstSeenAt: now, lastSeenAt: now, presentMs: 0 };
            }
          }
        }
        const missing = scan ? missingFrom(scan.reported, scan.list.length) : null;
        liveTabs[key] = {
          ...existing,
          attendees,
          concurrentNames: concurrent,
          trackingOn: true,
          trackingStartedAt: now,
          trackingEndedAt: null,
          reportedCount: scan ? scan.reported : existing.reportedCount ?? null,
          capturedCount: scan ? scan.list.length : existing.capturedCount ?? null,
          missingAtStart: missing,
          missingAtEnd: null,
          peakMissing: missing || 0,
          lastUpdated: now,
        };
      } else {
        // Session over. Close out everyone still present at this instant, then
        // freeze it into a pending save and clear the live start time.
        let closing = existing;
        if (scan) {
          const concurrent = { ...(existing.concurrentNames || {}) };
          const missing = missingFrom(scan.reported, scan.list.length);
          closing = {
            ...existing,
            attendees: applyScan(existing.attendees || {}, scan.list, now, concurrent),
            concurrentNames: concurrent,
            reportedCount: scan.reported,
            capturedCount: scan.list.length,
            missingAtEnd: missing,
            peakMissing: Math.max(existing.peakMissing || 0, missing || 0),
          };
        }
        const pending = buildPendingSave(closing, now);
        if (pending) pending.origin = message.source === 'widget' ? 'widget' : 'dashboard';

        liveTabs[key] = {
          ...closing,
          trackingOn: false,
          trackingStartedAt: null,
          trackingEndedAt: now,
          lastUpdated: now,
        };
        if (pending) await updatePendingSaves((list) => [...list.filter((p) => p.id !== pending.id), pending]);
        // OFF from the on-page widget: the Save popup appears ON THE MEETING
        // PAGE. The dashboard is not opened or focused. (OFF from the dashboard
        // shows its own prompt there.)
        if (message.source === 'widget' && pending) sendToTab(tabId, { type: 'ROLLTRACK_SHOW_SAVE', pending });
      }

      persistState();
      broadcast('ROLLTRACK_LIVE_UPDATE', liveTabs);
      sendToTab(tabId, {
        type: 'ROLLTRACK_TRACKING_CHANGED',
        on,
        trackingStartedAt: liveTabs[key].trackingStartedAt,
      });
    });
    return;
  }

  // Content script asking "who am I and what's my current tracking state".
  if (message.type === 'ROLLTRACK_WHOAMI') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse(null);
      return;
    }
    ready.then(() => pendingChain).then(async () => {
      const existing = liveTabs[String(tabId)];
      const res = await chrome.storage.local.get([PENDING_KEY]);
      sendResponse({
        tabId,
        trackingOn: existing ? !!existing.trackingOn : false,
        trackingStartedAt: existing ? existing.trackingStartedAt || null : null,
        // Finished sessions turned OFF on THIS page that still need their Save
        // popup (also covers a page reload while the popup was open).
        pending: (res[PENDING_KEY] || []).filter((p) => p.tabId === tabId && p.origin === 'widget'),
      });
    });
    return true; // async sendResponse
  }

  // Popup/dashboard asking for whatever we currently know.
  if (message.type === 'ROLLTRACK_GET_LIVE_TABS') {
    // In-memory state is authoritative once loaded; do not re-read storage (it
    // can be a moment behind).
    ready.then(() => sendResponse({ status: 'ok', liveTabs }));
    return true;
  }

  // Dashboard asking for finished sessions still waiting for a Save prompt.
  if (message.type === 'ROLLTRACK_GET_PENDING_SAVES') {
    pendingChain.then(async () => {
      const res = await chrome.storage.local.get([PENDING_KEY]);
      sendResponse({ status: 'ok', pending: res[PENDING_KEY] || [] });
    });
    return true;
  }

  // Dashboard finished with a pending save (saved OR dismissed) — drop it.
  if (message.type === 'ROLLTRACK_REMOVE_PENDING_SAVE') {
    updatePendingSaves((list) => list.filter((p) => p.id !== message.id));
    return;
  }

  // Save popup on the meeting page: turn the pending session into a saved
  // meeting (raw attendance, no roster matching) and drop the pending entry.
  if (message.type === 'ROLLTRACK_SAVE_PENDING') {
    (async () => {
      await pendingChain;
      const res = await chrome.storage.local.get([PENDING_KEY]);
      const pend = (res[PENDING_KEY] || []).find((p) => p.id === message.id);
      if (!pend) {
        sendResponse({ ok: false, reason: 'not-found' });
        return;
      }
      const meeting = buildMeetingFromPending(pend, message.title, !!message.addPlaceholders);
      await addMeeting(meeting);
      await updatePendingSaves((list) => list.filter((p) => p.id !== message.id));
      sendResponse({ ok: true, meetingId: meeting.id });
    })().catch((e) => {
      console.warn('[RollTrack] save pending failed', e);
      sendResponse({ ok: false, reason: 'error' });
    });
    return true;
  }

  // Dashboard added a meeting (its own Save prompt): the background is the
  // single writer for new meetings so two saves can't overwrite each other.
  if (message.type === 'ROLLTRACK_ADD_MEETING') {
    addMeeting(message.meeting).then(() => sendResponse({ ok: true }));
    return true;
  }

  // "Open home page" from the on-page widget.
  if (message.type === 'ROLLTRACK_OPEN_HOME') {
    openHome();
    return;
  }
});

// On every service-worker start:
//  1. entries for tabs that no longer exist are dropped (they would show phantom
//     "detected" meetings). A session that was still marked ON in such a tab (Chrome
//     closed or crashed, or the extension was off) is kept as a pending save for the
//     dashboard, ending at the last time we heard from that tab, instead of being lost;
//  2. every open meeting tab is checked and reconnected if its page script is dead.
ready.then(async () => {
  try {
    let changed = false;
    for (const key of Object.keys(liveTabs)) {
      const tab = liveTabs[key];
      if (!tab) continue;
      let exists = true;
      try {
        await chrome.tabs.get(Number(key));
      } catch (e) {
        exists = false;
      }
      if (exists) continue;
      if (tab.trackingOn) {
        const pending = buildPendingSave(tab, tab.lastUpdated || Date.now());
        if (pending) {
          pending.origin = 'dashboard';
          await updatePendingSaves((list) => [...list.filter((p) => p.id !== pending.id), pending]);
        }
      }
      delete liveTabs[key];
      changed = true;
    }
    if (changed) {
      await persistState();
      broadcast('ROLLTRACK_LIVE_UPDATE', liveTabs);
    }
  } catch (e) {
    logError('recover-orphans', e);
  }
  try {
    await ensureContentScripts();
  } catch (e) {
    logError('reconnect-tabs', e);
  }
});

// If a meeting tab is closed while tracking is ON, keep what was recorded as a
// pending save instead of losing it. With no meeting page left to show a Save
// popup, any pending save that belonged to that page moves to the dashboard.
chrome.tabs.onRemoved.addListener((tabId) => {
  ready.then(async () => {
    const key = String(tabId);
    const tab = liveTabs[key];
    if (tab && tab.trackingOn) {
      const pending = buildPendingSave(tab, Date.now());
      if (pending) {
        pending.origin = 'dashboard';
        await updatePendingSaves((list) => [...list.filter((p) => p.id !== pending.id), pending]);
      }
    }
    await updatePendingSaves((list) =>
      list.some((p) => p.tabId === tabId && p.origin === 'widget')
        ? list.map((p) => (p.tabId === tabId && p.origin === 'widget' ? { ...p, origin: 'dashboard' } : p))
        : list
    );
    if (!tab) return;
    delete liveTabs[key];
    persistState();
    broadcast('ROLLTRACK_LIVE_UPDATE', liveTabs);
  });
});
