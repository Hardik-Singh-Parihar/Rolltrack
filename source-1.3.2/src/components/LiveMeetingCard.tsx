import React, { useState, useEffect } from 'react';
import {
  Radio,
  Clock,
  Plus,
  Trash2,
  Copy,
  Check,
  Hash,
  Users,
  ChevronUp,
  ChevronDown,
  Wifi,
} from 'lucide-react';
import { getLiveTabs, onLiveTabsUpdate, isExtensionContext, setTrackingForTab, LiveTabState, Headcount } from '../utils/liveTracking';

// Raw attendee presence window, as actually detected for a tab-linked
// session. This — not any fabricated roster — is what gets handed to the
// save modal so a saved meeting only ever contains people genuinely seen.
export interface RawAttendeeWindow {
  name: string;
  firstSeenAt: number;
  lastSeenAt: number;
  presentMs?: number;
}

export interface LiveSession {
  id: string;
  code: string; // Meeting code shown as title until saved
  title: string;
  platform: 'Google Meet' | 'Zoom' | 'Microsoft Teams';
  isRollTrackActive: boolean;
  seconds: number;
  startTime: string;
  participantsCount: number;
  // Real detected attendee presence windows for this session (tab-linked
  // sessions only). Always empty for manually-created rooms — there is no
  // detection to back them, so we never invent attendees for those.
  rawAttendees: RawAttendeeWindow[];
  // Exact moment tracking turned ON for this session (tab-linked only).
  // The save modal uses this as the presence window's start; falls back to
  // "now - durationSeconds" when null (manual rooms).
  trackingStartedAt: number | null;
  // When set, this session is backed by a real detected browser tab
  // (see src/utils/liveTracking.ts) rather than manually created.
  tabId?: number;
}

// Converts a real detected tab's attendee map into raw presence windows for
// the save modal — the actual names and first/last-seen timestamps content.js
// detected, nothing invented.
function rawAttendeesFromLiveTab(tab: LiveTabState): RawAttendeeWindow[] {
  return Object.entries(tab.attendees).map(([key, info]) => ({
    name: info.name ?? key,
    firstSeenAt: info.firstSeenAt,
    lastSeenAt: info.lastSeenAt,
    presentMs: info.presentMs,
  }));
}

interface LiveMeetingCardProps {
  onOpenSaveModal: (recordedData: {
    durationSeconds: number;
    title: string;
    platform: 'Google Meet' | 'Zoom' | 'Microsoft Teams';
    attendees: RawAttendeeWindow[];
    trackingStartedAt: number | null;
    trackingEndedAt: number | null;
    headcount?: Headcount | null;
  }) => void;
}

export const LiveMeetingCard: React.FC<LiveMeetingCardProps> = ({
  onOpenSaveModal,
}) => {
  // Concurrent live sessions - starts empty (no demo data)
  const [sessions, setSessions] = useState<LiveSession[]>([]);

  // Selected meeting - box in white circle shows when a meeting is clicked
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // New room modal / form state
  const [showNewRoomInput, setShowNewRoomInput] = useState(false);
  const [newRoomPlatform, setNewRoomPlatform] = useState<'Google Meet' | 'Zoom' | 'Microsoft Teams'>('Google Meet');
  const [copiedCode, setCopiedCode] = useState(false);

  // Real detected meeting tabs, reported by content.js via the background
  // service worker. Empty (and harmless) outside the installed extension.
  const [detectedTabs, setDetectedTabs] = useState<LiveTabState[]>([]);

  useEffect(() => {
    let cancelled = false;
    getLiveTabs().then((tabs) => {
      if (!cancelled) setDetectedTabs(tabs);
    });
    const unsubscribe = onLiveTabsUpdate((tabs) => setDetectedTabs(tabs));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Timer for all sessions with RollTrack ACTIVE.
  // Tab-linked sessions recompute elapsed time from trackingStartedAt — the
  // exact moment tracking was turned ON — not the tab's own startedAt (when
  // it was first detected), so turning tracking on late never inherits time
  // from before you asked for it. Manually-created (demo/offline) sessions
  // have no real tab behind them, so they just tick up locally.
  useEffect(() => {
    const timer = setInterval(() => {
      setSessions((prev) =>
        prev.map((s) => {
          if (!s.isRollTrackActive) return s;
          if (s.tabId != null) {
            const tab = detectedTabs.find((t) => t.tabId === s.tabId);
            if (tab && tab.trackingStartedAt) {
              return { ...s, seconds: Math.floor((Date.now() - tab.trackingStartedAt) / 1000) };
            }
          }
          return { ...s, seconds: s.seconds + 1 };
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [detectedTabs]);

  // Sync tab-linked sessions from the real detected data whenever the
  // background worker reports an update. This is the SINGLE place that:
  //   - auto-creates a session the moment a tab's tracking turns on
  //     (from the widget, this popup, or a previous popup session — there's
  //     no separate "promote to tracked" step anymore)
  //   - updates isRollTrackActive from the real trackingOn state
  //   - detects an ON->OFF transition and opens the save modal, no matter
  //     which UI (widget or popup) caused it, exactly once
  const prevTrackingRef = React.useRef<Record<number, boolean>>({});
  useEffect(() => {
    setSessions((prev) => {
      let next = prev;

      for (const tab of detectedTabs) {
        const wasOn = prevTrackingRef.current[tab.tabId] ?? false;
        const isOn = !!tab.trackingOn;

        const existingIdx = next.findIndex((s) => s.tabId === tab.tabId);
        const participantsCount = Object.keys(tab.attendees).length;
        const rawAttendees = rawAttendeesFromLiveTab(tab);

        if (existingIdx === -1 && isOn) {
          // Tracking just turned on for a tab with no session yet — create one.
          const nowTime = tab.trackingStartedAt
            ? new Date(tab.trackingStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const newSession: LiveSession = {
            id: `live-tab-${tab.tabId}`,
            code: tab.title || tab.platform,
            title: tab.title || tab.platform,
            platform: tab.platform as 'Google Meet' | 'Zoom' | 'Microsoft Teams',
            isRollTrackActive: true,
            seconds: tab.trackingStartedAt ? Math.floor((Date.now() - tab.trackingStartedAt) / 1000) : 0,
            startTime: nowTime,
            participantsCount,
            rawAttendees,
            trackingStartedAt: tab.trackingStartedAt || null,
            tabId: tab.tabId,
          };
          next = [newSession, ...next];
          setSelectedSessionId(newSession.id);
        } else if (existingIdx !== -1) {
          const existing = next[existingIdx];
          const justTurnedOn = !wasOn && isOn;
          const updated = {
            ...existing,
            isRollTrackActive: isOn,
            participantsCount,
            rawAttendees,
            // Turning ON again starts a brand-new session: fresh clock and
            // start time, never the previous session's values.
            seconds: justTurnedOn
              ? tab.trackingStartedAt
                ? Math.floor((Date.now() - tab.trackingStartedAt) / 1000)
                : 0
              : existing.seconds,
            startTime:
              justTurnedOn && tab.trackingStartedAt
                ? new Date(tab.trackingStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : existing.startTime,
            trackingStartedAt: isOn ? tab.trackingStartedAt ?? null : existing.trackingStartedAt,
          };
          next = [...next.slice(0, existingIdx), updated, ...next.slice(existingIdx + 1)];
          // NOTE: the Save prompt for tab-linked sessions is NOT opened here
          // any more. background.js freezes each finished session into a
          // "pending save" and App.tsx shows the prompt from that — so it
          // also works when OFF came from the on-page widget while this
          // dashboard was closed, and can't fire twice.
        }

        prevTrackingRef.current[tab.tabId] = isOn;
      }

      return next;
    });
  }, [detectedTabs]);

  // Handler: Toggle RollTrack ON / OFF for that specific meeting.
  // For a real detected tab, this ONLY sends the command to background.js —
  // it does not flip local state or open the save modal itself. The sync
  // effect above is the single place that reacts to the resulting change,
  // so the widget, this button, and any other trigger all behave identically.
  // Manually-created (demo/offline) sessions have no real tab, so they keep
  // their own local on/off + save-modal trigger here.
  const handleToggleRollTrack = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    if (session.tabId != null) {
      setTrackingForTab(session.tabId, !session.isRollTrackActive, session.platform);
      return;
    }

    if (session.isRollTrackActive) {
      // Manual/offline rooms have no real tab behind them, so there is no
      // genuine attendee detection to report — save with an honest empty
      // attendee list rather than inventing names.
      onOpenSaveModal({
        durationSeconds: session.seconds,
        title: session.title,
        platform: session.platform,
        attendees: session.rawAttendees,
        trackingStartedAt: session.trackingStartedAt,
        trackingEndedAt: null,
      });
      // Reset the clock so the next ON starts from zero, not from this run.
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, isRollTrackActive: false, seconds: 0 } : s))
      );
    } else {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, isRollTrackActive: true, seconds: 0, startTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
            : s
        )
      );
      setSelectedSessionId(sessionId);
    }
  };

  // Helper to generate a realistic meeting code
  const generateMeetingCode = (plat: 'Google Meet' | 'Zoom' | 'Microsoft Teams') => {
    if (plat === 'Google Meet') {
      const letters = 'abcdefghijklmnopqrstuvwxyz';
      const part = (len: number) =>
        Array.from({ length: len }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
      return `${part(3)}-${part(4)}-${part(3)}`;
    }
    if (plat === 'Zoom') {
      const r = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));
      return `${r(800, 999)}-${r(1000, 9999)}-${r(1000, 9999)}`;
    }
    return `mtg-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;
  };

  // Handler: Create new live meeting with meeting code as title
  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    const code = generateMeetingCode(newRoomPlatform);
    const newId = `live-room-${Date.now()}`;
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Manual/offline room: no real tab backs this, so it starts genuinely
    // empty — no seeded host, no placeholder participant count. Attendees
    // only ever appear here if a real detection mechanism is wired to it.
    const newSession: LiveSession = {
      id: newId,
      code,
      title: code, // Meeting code as title until saved!
      platform: newRoomPlatform,
      isRollTrackActive: false,
      seconds: 0,
      startTime: nowTime,
      participantsCount: 0,
      rawAttendees: [],
      trackingStartedAt: null,
    };

    setSessions((prev) => [...prev, newSession]);
    setSelectedSessionId(newId);
    setShowNewRoomInput(false);
  };

  // Handler: Remove a room
  const handleRemoveSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
      return remaining;
    });
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || null;

  const activeRollTrackCount = sessions.filter((s) => s.isRollTrackActive).length;

  return (
    <div className="w-full bg-[#111722] border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all ${
              activeRollTrackCount > 0
                ? 'bg-red-500/15 border-red-500/40 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.3)]'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}
          >
            <Radio className="w-5 h-5" />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-white">Live Meetings</h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-950/60 text-blue-400 border border-blue-800/50">
                {sessions.length} Live Room{sessions.length !== 1 ? 's' : ''} Open
              </span>
              {activeRollTrackCount > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-950/80 text-red-400 border border-red-800/60 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                  <span>{activeRollTrackCount} ROLLTRACK ACTIVE</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Click any live meeting below to view its logs, attendees, and meeting code.
            </p>
          </div>
        </div>

        {/* Action to create another concurrent room */}
        <button
          onClick={() => setShowNewRoomInput(!showNewRoomInput)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 rounded-lg shadow-sm transition-all cursor-pointer self-start sm:self-auto shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>+ Manual / Offline Room</span>
        </button>
      </div>

      {/* Real detected meeting tabs that aren't being tracked yet (extension context only).
          Turning tracking on here calls the exact same background.js command as the
          on-page widget — there's no separate "promote to tracked" step anymore. */}
      {isExtensionContext() && detectedTabs.filter((t) => !t.trackingOn).length > 0 && (
        <div className="p-3.5 bg-emerald-950/20 border border-emerald-900/50 rounded-xl space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
            <Wifi className="w-3.5 h-3.5" />
            <span>Detected meeting tab — not tracking yet</span>
          </div>
          <div className="space-y-2">
            {detectedTabs
              .filter((t) => !t.trackingOn)
              .map((tab) => (
                <div
                  key={tab.tabId}
                  className="flex items-center justify-between gap-3 px-3 py-2 bg-[#0c1017] border border-slate-800/80 rounded-lg"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{tab.title}</p>
                    <p className="text-[11px] text-slate-400">
                      {tab.platform} · {Object.keys(tab.attendees).length} attendee
                      {Object.keys(tab.attendees).length !== 1 ? 's' : ''} detected · same toggle as the on-page widget
                    </p>
                  </div>
                  <button
                    onClick={() => setTrackingForTab(tab.tabId, true, tab.platform)}
                    className="shrink-0 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    Start tracking
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Inline form to launch a new room with code */}
      {showNewRoomInput && (
        <form
          onSubmit={handleCreateSession}
          className="p-3.5 bg-[#0c1017] border border-blue-900/50 rounded-xl space-y-3 animate-fadeIn"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Launch Concurrent Live Meeting Room
            </span>
            <button
              type="button"
              onClick={() => setShowNewRoomInput(false)}
              className="text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex-1 w-full">
              <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                Select Platform (Meeting code generated automatically)
              </label>
              <select
                value={newRoomPlatform}
                onChange={(e) => setNewRoomPlatform(e.target.value as any)}
                className="w-full px-3 py-1.5 text-xs bg-[#111722] border border-slate-700 rounded-lg text-slate-200"
              >
                <option value="Google Meet">Google Meet</option>
                <option value="Zoom">Zoom</option>
                <option value="Microsoft Teams">Microsoft Teams</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full sm:w-auto mt-auto px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm cursor-pointer whitespace-nowrap"
            >
              Generate Code & Launch Room
            </button>
          </div>
        </form>
      )}

      {/* Concurrent Meeting Cards Row */}
      {sessions.length === 0 ? (
        <div className="py-6 px-4 text-center rounded-xl bg-[#0c1017] border border-slate-800/80">
          <p className="text-xs sm:text-sm text-slate-400">
            No active live rooms running. Click <span className="text-blue-400 font-semibold">"+ Add Room"</span> to start or connect a live meeting room.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 overflow-x-auto pb-1 custom-scrollbar">
          {sessions.map((sess) => {
            const isSelected = selectedSessionId === sess.id;
            return (
              <div
                key={sess.id}
                onClick={() => {
                  // Click to open/close details box
                  setSelectedSessionId(isSelected ? null : sess.id);
                }}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium cursor-pointer transition-all shrink-0 border ${
                  isSelected
                    ? sess.isRollTrackActive
                      ? 'bg-red-950/40 border-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.25)]'
                      : 'bg-[#172030] border-blue-500 text-white shadow-md'
                    : 'bg-[#0d121c] border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {/* Status pulse dot */}
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    sess.isRollTrackActive ? 'bg-red-400 animate-ping' : 'bg-slate-500'
                  }`}
                />

                {/* Title shows MEETING CODE until saved! */}
                <div className="flex flex-col text-left max-w-[160px] sm:max-w-[210px]">
                  <div className="flex items-center gap-1.5 truncate font-mono font-bold text-slate-100">
                    <Hash className="w-3 h-3 text-blue-400 shrink-0" />
                    <span className="truncate">{sess.code}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 font-sans mt-0.5">
                    <span className="font-semibold text-slate-300">{sess.platform}</span>
                    <span>·</span>
                    <span>{sess.isRollTrackActive ? `REC • ${formatTimer(sess.seconds)}` : 'RollTrack: Standby'}</span>
                  </div>
                </div>

                {/* Dedicated Toggle Button specifically for THIS single meeting */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleRollTrack(sess.id);
                  }}
                  role="switch"
                  aria-checked={sess.isRollTrackActive}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out ml-1.5 ${
                    sess.isRollTrackActive ? 'bg-red-600' : 'bg-slate-700'
                  }`}
                  title={`Toggle RollTrack ${sess.isRollTrackActive ? 'OFF' : 'ON'} for ${sess.code}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out mt-0.5 ${
                      sess.isRollTrackActive ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>

                {/* Delete / End room button */}
                <button
                  onClick={(e) => handleRemoveSession(sess.id, e)}
                  className="p-1 hover:text-red-400 text-slate-500 transition-colors ml-0.5"
                  title="Close room"
                >
                  <Trash2 className="w-3 h-3" />
                </button>

                {/* Expand indicator icon */}
                <div className="text-slate-500 ml-0.5">
                  {isSelected ? <ChevronUp className="w-3.5 h-3.5 text-blue-400" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* THE BOX IN WHITE CIRCLE: ONLY SHOWN WHEN A MEETING IS CLICKED! */}
      {selectedSession ? (
        <div
          className={`rounded-xl p-4 sm:p-5 transition-all border animate-fadeIn ${
            selectedSession.isRollTrackActive
              ? 'bg-[#0d121c] border-red-900/60 shadow-[0_0_20px_rgba(220,38,38,0.12)]'
              : 'bg-[#0d121c] border-slate-800'
          }`}
        >
          {/* Top Session Details Row: NO BUTTON IN RED CIRCLE (duplicate button removed) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/60">
            <div>
              {/* Platform & Participants & Start Time */}
              <div className="flex flex-wrap items-center gap-2 mb-1.5 text-xs text-slate-400">
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-blue-950/70 text-blue-400 border border-blue-800/50 rounded">
                  {selectedSession.platform}
                </span>

                <span className="flex items-center gap-1 font-mono text-slate-300">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>{selectedSession.participantsCount} participants in room</span>
                </span>

                <span>·</span>

                <span className="flex items-center gap-1 font-mono text-slate-400">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Started at {selectedSession.startTime}</span>
                </span>
              </div>

              {/* Title shows MEETING CODE until user saves it */}
              <div className="flex items-center gap-2.5">
                <h4 className="text-base sm:text-lg font-mono font-bold text-white tracking-wide">
                  {selectedSession.code}
                </h4>

                <button
                  onClick={() => handleCopyCode(selectedSession.code)}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono text-blue-300 bg-blue-950/50 hover:bg-blue-900/60 border border-blue-800/50 rounded cursor-pointer transition-colors"
                  title="Copy meeting code"
                >
                  {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                </button>
              </div>

              <p className="text-xs text-slate-400 mt-1">
                {selectedSession.isRollTrackActive
                  ? 'Recording the live meeting in real time. Use toggle button above to stop & save.'
                  : 'Room is live in standby. Use toggle button on this meeting above to start RollTrack.'}
              </p>
            </div>

            {/* Close button for details box */}
            <button
              onClick={() => setSelectedSessionId(null)}
              className="text-xs text-slate-400 hover:text-white px-2.5 py-1 bg-[#111722] hover:bg-slate-800 border border-slate-800 rounded-lg cursor-pointer transition-colors self-start sm:self-auto"
            >
              Hide Details
            </button>
          </div>

          {/* MEETING LOGS, NO. OF ATTENDEES, TIME, AND CODE */}
          {selectedSession.isRollTrackActive ? (
            /* ACTIVE ROLLTRACK METRICS & LOGS (from user screenshot) */
            <div className="mt-4 space-y-4">
              {/* Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Card 1: ELAPSED TIME */}
                <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-3.5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-950/50 border border-red-900/60 flex items-center justify-center text-red-400 shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      ELAPSED TIME
                    </span>
                    <span className="text-base sm:text-lg font-bold text-white font-mono tracking-wider">
                      {formatTimer(selectedSession.seconds)}
                    </span>
                  </div>
                </div>

                {/* Card 2: END & SAVE */}
                <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-3.5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      END & SAVE
                    </span>
                    <span className="text-xs sm:text-sm font-medium text-slate-300">
                      Toggle switch above to OFF
                    </span>
                  </div>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-500/20 animate-pulse shrink-0" />
                </div>
              </div>

            </div>
          ) : (
            /* STANDBY DETAILS */
            <div className="mt-4 space-y-3">
              {/* Helper note */}
              <div className="pt-2 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span>
                    Toggle switch on <strong className="text-slate-300 font-mono">{selectedSession.code}</strong> above to start recording the live meeting.
                  </span>
                </div>
                <span className="text-slate-500 italic">
                  When toggled OFF, a popup asks whether to save the meeting.
                </span>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Hint when no meeting is clicked */
        <div className="text-center py-3 text-xs text-slate-500 bg-[#0c1017] rounded-xl border border-slate-800/60">
          Click on any live meeting above to inspect its code and time.
        </div>
      )}
    </div>
  );
};
