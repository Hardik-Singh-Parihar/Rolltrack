import React, { useState, useEffect } from 'react';
import { X, Download, Save, Radio } from 'lucide-react';
import { Meeting, Attendee, PlatformType } from '../types';
import { Headcount } from '../utils/liveTracking';
import { toLocalDateStr } from '../utils/dateUtils';

interface RawAttendeeWindow {
  name: string;
  firstSeenAt: number;
  lastSeenAt: number;
  // Accumulated time genuinely seen in the room (excludes gaps where they left).
  presentMs?: number;
}

interface SaveMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  durationSeconds: number;
  initialTitle?: string;
  initialPlatform?: PlatformType;
  // The attendees actually detected during this tracked session — real
  // names with real first/last-seen timestamps, never fabricated. Empty for
  // manual/offline rooms, which have no detection behind them.
  attendees: RawAttendeeWindow[];
  // Exact moment tracking turned ON (tab-linked sessions). Falls back to
  // "now - durationSeconds" when null, so presence % still makes sense for
  // manual/offline rooms.
  trackingStartedAt: number | null;
  // Exact moment tracking turned OFF. Without it the end of the window would
  // be "whenever Save is clicked", inflating duration if the prompt sits open.
  trackingEndedAt?: number | null;
  // Detected vs. the platform's own participant count. Null for sessions with
  // no live detection behind them (manual rooms).
  headcount?: Headcount | null;
  onSaveMeeting: (meeting: Meeting) => void;
}

export const SaveMeetingModal: React.FC<SaveMeetingModalProps> = ({
  isOpen,
  onClose,
  durationSeconds,
  initialTitle,
  initialPlatform = 'Google Meet',
  attendees,
  trackingStartedAt,
  trackingEndedAt = null,
  headcount = null,
  onSaveMeeting,
}) => {
  const [title, setTitle] = useState(initialTitle || 'Live Recorded Session');
  const [addPlaceholders, setAddPlaceholders] = useState(false);

  useEffect(() => {
    if (initialTitle) {
      setTitle(initialTitle);
    }
  }, [initialTitle, isOpen]);

  if (!isOpen) return null;

  const durationMins = Math.max(1, Math.round(durationSeconds / 60));

  // People the platform said were in the call when tracking stopped that we
  // could not identify. Saving them as placeholders keeps the total honest.
  const missingAtEnd = headcount?.missingAtEnd ?? 0;
  const peakMissing = headcount?.peakMissing ?? 0;
  const missingAtStart = headcount?.missingAtStart ?? 0;
  const showHeadcountWarning = !!headcount && (missingAtEnd > 0 || missingAtStart > 0 || peakMissing > 0);

  const handleSave = () => {
    // Build the saved record entirely from what content.js actually detected
    // during this tracked session — no invented names, no invented activity.
    const windowEnd = trackingEndedAt ?? Date.now();
    const windowStart = trackingStartedAt ?? windowEnd - durationSeconds * 1000;
    const windowMs = Math.max(1, windowEnd - windowStart);

    const sortedAttendees = [...attendees].sort((a, b) => a.firstSeenAt - b.firstSeenAt);

    const realAttendees: Attendee[] = sortedAttendees.map((a, idx) => {
      const presentStart = Math.max(a.firstSeenAt, windowStart);
      const presentEnd = Math.min(a.lastSeenAt, windowEnd);
      // Prefer the accumulated time-in-room (handles leave & rejoin); fall
      // back to first->last window only when it isn't available.
      const presentMs =
        a.presentMs != null
          ? Math.min(Math.max(0, a.presentMs), windowMs)
          : Math.max(0, presentEnd - presentStart);
      const presenceMinutes = Math.max(1, Math.round(presentMs / 60000));
      const presencePercentage = Math.min(100, Math.round((presentMs / windowMs) * 100));
      return {
        id: `att-${Date.now()}-${idx}`,
        // rollNo/division are filled in later by matchAttendeesWithRoster
        // once this meeting is opened against the active master roster.
        rollNo: 0,
        name: a.name,
        email: '',
        durationMinutes: presenceMinutes,
        totalMinutes: durationMins,
        presencePercentage,
      };
    });

    // Optional placeholders for people in the call we could not identify.
    // Their time is unknown, so they are saved with 0 minutes.
    if (addPlaceholders && missingAtEnd > 0) {
      for (let i = 1; i <= missingAtEnd; i++) {
        realAttendees.push({
          id: `att-unidentified-${Date.now()}-${i}`,
          rollNo: 0,
          name: `Unidentified participant ${i}`,
          email: '',
          durationMinutes: 0,
          totalMinutes: durationMins,
          presencePercentage: 0,
        });
      }
    }

    const newMeeting: Meeting = {
      id: `live-${Date.now()}`,
      title: title.trim() || 'Live Recorded Session',
      platform: initialPlatform,
      // Local date of when tracking started (toISOString() is UTC and filed
      // late-night meetings under the wrong day in India).
      date: toLocalDateStr(windowStart),
      startTime: new Date(windowStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      endTime: new Date(windowEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      durationMinutes: durationMins,
      attendeeCount: realAttendees.length,
      hostName: 'Meeting Host',
      hostEmail: '',
      attendanceGoal: 75,
      isGoalConfirmed: false,
      attendees: realAttendees,
      activityLog: [],
      metrics: {
        screenShares: 0,
        micsUnmuted: 0,
        camerasTurnedOn: 0,
        handsRaised: 0,
      },
    };

    onSaveMeeting(newMeeting);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-[#111722] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0d121c]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Save Live Meeting</h3>
              <p className="text-[11px] text-slate-400">
                Session ended · Recorded {durationSeconds}s · {initialPlatform}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Meeting Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2 text-xs sm:text-sm bg-[#0b0e14] border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="bg-[#0c1017] p-3 rounded-xl border border-slate-800/80 space-y-1 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Platform:</span>
              <span className="text-blue-400 font-semibold">{initialPlatform}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Duration recorded:</span>
              <span className="text-white font-mono font-semibold">{durationMins} minutes</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Logged participants:</span>
              <span className="text-blue-400 font-mono font-semibold">
                {attendees.length} attendee{attendees.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {attendees.length === 0 && (
            <p className="text-[11px] text-amber-400/90 bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-2">
              No attendees were detected during this session, so this meeting will be saved with an empty attendee list.
            </p>
          )}

          {showHeadcountWarning && headcount && (
            <div className="text-[11px] text-amber-300 bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-2 space-y-1.5">
              {headcount.reported != null && (
                <p className="font-semibold">
                  Identified {attendees.length} name{attendees.length !== 1 ? 's' : ''}; the call had {headcount.reported} when
                  you stopped.
                </p>
              )}
              {missingAtStart > 0 && (
                <p>{missingAtStart} in the call could not be identified when tracking started.</p>
              )}
              {missingAtEnd > 0 && (
                <p>{missingAtEnd} in the call could not be identified when tracking stopped.</p>
              )}
              {missingAtEnd === 0 && peakMissing > 0 && (
                <p>At one point during tracking up to {peakMissing} could not be identified (they may have left since).</p>
              )}
              <p className="text-amber-400/70">Tip: keep the People panel open during the meeting.</p>
              {missingAtEnd > 0 && (
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-200">
                  <input
                    type="checkbox"
                    checked={addPlaceholders}
                    onChange={(e) => setAddPlaceholders(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-700 bg-[#0b0e14]"
                  />
                  <span>Add {missingAtEnd} “Unidentified participant” entr{missingAtEnd === 1 ? 'y' : 'ies'} (0 min, time unknown)</span>
                </label>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Meeting</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
