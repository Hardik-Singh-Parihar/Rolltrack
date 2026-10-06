/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { InteractiveEyes } from './components/InteractiveEyes';
import { LiveMeetingCard } from './components/LiveMeetingCard';
import { RecentMeetingsCard } from './components/RecentMeetingsCard';
import { MeetingCalendarCard } from './components/MeetingCalendarCard';
import { MeetingAttendanceView } from './components/MeetingAttendanceView';
import { AddListModal } from './components/AddListModal';
import { SaveMeetingModal } from './components/SaveMeetingModal';
import { Meeting } from './types';
import { getPendingSaves, removePendingSave, onPendingSavesChange, PendingSave, Headcount, isExtensionContext } from './utils/liveTracking';
import { loadMeetings, persistMeetings, addMeetingViaBackground, onMeetingsChanged } from './utils/meetingStorage';

type ViewMode = 'dashboard' | 'attendance';

export default function App() {
  // Saved meetings live in chrome.storage.local so the Save popup on the
  // meeting page can add one too; we follow changes from there.
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const meetingsLoaded = useRef(false);
  // Bumped whenever roster files or the selection change (views re-read them).
  const [rosterVersion, setRosterVersion] = useState(0);
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  // Meeting list in calendar is kept closed until user clicks on one of the days
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Modals state
  const [isAddListOpen, setIsAddListOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveSessionMeta, setSaveSessionMeta] = useState<{
    durationSeconds: number;
    title: string;
    platform: 'Google Meet' | 'Zoom' | 'Microsoft Teams';
    attendees: { name: string; firstSeenAt: number; lastSeenAt: number; presentMs?: number }[];
    trackingStartedAt: number | null;
    trackingEndedAt: number | null;
    headcount: Headcount | null;
  }>({
    durationSeconds: 0,
    title: 'Live Recorded Session',
    platform: 'Google Meet',
    attendees: [],
    trackingStartedAt: null,
    trackingEndedAt: null,
    headcount: null,
  });

  // Finished tracking sessions (tracking turned OFF from the on-page widget,
  // the popup, or the meeting tab being closed) waiting for the Save prompt.
  // background.js owns this list; we just show the prompt for each entry.
  const [pendingSaves, setPendingSaves] = useState<PendingSave[]>([]);
  const [activePendingId, setActivePendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPendingSaves().then((list) => {
      if (!cancelled) setPendingSaves(list);
    });
    const unsubscribe = onPendingSavesChange(setPendingSaves);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Open the Save prompt for the next finished session, one at a time.
  useEffect(() => {
    // A session turned OFF on the meeting page is saved THERE (popup on that
    // page). The dashboard only shows sessions that belong to it, plus any
    // whose meeting page is gone (background re-labels those 'dashboard').
    const mine = pendingSaves.filter((p) => p.origin !== 'widget');
    if (isSaveModalOpen || mine.length === 0) return;
    const next = mine[0];
    setSaveSessionMeta({
      durationSeconds: next.durationSeconds,
      title: next.title,
      platform: next.platform,
      attendees: next.attendees,
      trackingStartedAt: next.trackingStartedAt,
      trackingEndedAt: next.trackingEndedAt,
      headcount: {
        reported: next.reportedCount ?? null,
        missingAtStart: next.missingAtStart ?? null,
        missingAtEnd: next.missingAtEnd ?? null,
        peakMissing: next.peakMissing ?? null,
      },
    });
    setActivePendingId(next.id);
    setIsSaveModalOpen(true);
  }, [pendingSaves, isSaveModalOpen]);

  // Called whether the prompt was saved or dismissed: that session is done.
  const handleCloseSaveModal = () => {
    setIsSaveModalOpen(false);
    if (activePendingId) {
      const id = activePendingId;
      setPendingSaves((prev) => prev.filter((p) => p.id !== id));
      removePendingSave(id);
      setActivePendingId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadMeetings().then((list) => {
      if (cancelled) return;
      meetingsLoaded.current = true;
      setMeetings(list);
    });
    const unsubscribe = onMeetingsChanged((list) => setMeetings(list));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Active meeting object
  const currentMeeting =
    meetings.find((m) => m.id === selectedMeetingId) || (meetings.length > 0 ? meetings[0] : null);

  // Edits, deletes and Clear all: update the screen and write the whole list.
  const updateMeetings = (newMeetings: Meeting[]) => {
    setMeetings(newMeetings);
    // Never write before the first load finished, or an empty list could
    // overwrite the saved meetings.
    if (meetingsLoaded.current) persistMeetings(newMeetings);
  };

  // Handler: Select meeting to activate move to Attendance Meeting page
  const handleSelectMeeting = (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    setCurrentView('attendance');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handler: Update meeting goal
  const handleUpdateMeetingGoal = (meetingId: string, newGoal: number, rosterIds?: string[]) => {
    updateMeetings(
      meetings.map((m) =>
        m.id === meetingId
          ? { ...m, attendanceGoal: newGoal, isGoalConfirmed: true, ...(rosterIds ? { rosterIds } : {}) }
          : m
      )
    );
  };

  // Handler: Update full meeting details (e.g. rename meeting)
  const handleUpdateMeeting = (updated: Meeting) => {
    updateMeetings(meetings.map((m) => (m.id === updated.id ? updated : m)));
  };

  // Handler: Delete meeting
  const handleDeleteMeeting = (meetingId: string) => {
    updateMeetings(meetings.filter((m) => m.id !== meetingId));
    setSelectedMeetingId(null);
    setCurrentView('dashboard');
  };

  // Handler: "Clear" on the Recent Meetings list. This ONLY empties that list:
  // every meeting stays in storage and stays reachable from the calendar.
  // Real deletion happens from a meeting's own page or from the calendar's list.
  const handleClearMeetings = () => {
    updateMeetings(meetings.map((m) => (m.hiddenFromRecent ? m : { ...m, hiddenFromRecent: true })));
  };

  // Handler: delete one meeting for good (from the calendar's list)
  const handleDeleteFromCalendar = (meetingId: string) => {
    updateMeetings(meetings.filter((m) => m.id !== meetingId));
  };

  // Handler: Trigger save live meeting modal
  const handleOpenSaveModal = (data: {
    durationSeconds: number;
    title: string;
    platform: 'Google Meet' | 'Zoom' | 'Microsoft Teams';
    attendees: { name: string; firstSeenAt: number; lastSeenAt: number; presentMs?: number }[];
    trackingStartedAt: number | null;
    trackingEndedAt: number | null;
    headcount?: Headcount | null;
  }) => {
    setActivePendingId(null);
    setSaveSessionMeta({ ...data, headcount: data.headcount ?? null });
    setIsSaveModalOpen(true);
  };

  // Handler: Save live meeting result. Stays on the current page: no jump to
  // the attendance view after saving.
  const handleSaveLiveMeeting = (newMeeting: Meeting) => {
    setMeetings((prev) => [newMeeting, ...prev.filter((m) => m.id !== newMeeting.id)]);
    if (isExtensionContext()) {
      // The background is the single writer for new meetings.
      addMeetingViaBackground(newMeeting);
    } else {
      persistMeetings([newMeeting, ...meetings]);
    }
    setSelectedDate(newMeeting.date);
  };

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col antialiased selection:bg-blue-600 selection:text-white">
      {/* Clean Navbar */}
      <Navbar
        onAddListClick={() => setIsAddListOpen(true)}
        onHomeClick={() => setCurrentView('dashboard')}
      />

      {/* Main Content Area - Native Responsive for Mobile & PC */}
      <main className="flex-1 px-3 sm:px-6 py-4 sm:py-6">
        {currentView === 'attendance' && currentMeeting ? (
          <MeetingAttendanceView
            meeting={currentMeeting}
            onBack={() => setCurrentView('dashboard')}
            onDeleteMeeting={handleDeleteMeeting}
            onUpdateMeetingGoal={handleUpdateMeetingGoal}
            onUpdateMeeting={handleUpdateMeeting}
            onOpenAddList={() => setIsAddListOpen(true)}
            rosterVersion={rosterVersion}
          />
        ) : (
          /* Dashboard Home View */
          <div className="w-full max-w-4xl mx-auto space-y-5 sm:space-y-6">
            {/* Hero Section */}
            <div className="text-center pt-2 pb-1 px-2">
              <h1 className="text-xl sm:text-3xl font-extrabold text-white tracking-tight leading-tight">
                RollTrack — Attendance &amp; Meeting Dashboard
              </h1>

              {/* Interactive Eyes: Pupils move smoothly following mouse cursor arrow */}
              <InteractiveEyes />

              <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
                Manage live meetings, match master Excel rosters by division, and view scheduled sessions.
              </p>
            </div>

            {/* 1. Live Meetings Section - Multiple concurrent live rooms with RollTrack option */}
            <LiveMeetingCard onOpenSaveModal={handleOpenSaveModal} />

            {/* 2. Recent Meetings Card */}
            <RecentMeetingsCard
              meetings={meetings.filter((m) => !m.hiddenFromRecent)}
              savedCount={meetings.length}
              onOpenAddListModal={() => setIsAddListOpen(true)}
              onClearMeetings={handleClearMeetings}
              onSelectMeeting={handleSelectMeeting}
            />

            {/* 3. Meeting Calendar Card - Keeps meeting list closed until a date is clicked */}
            <MeetingCalendarCard
              meetings={meetings}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onViewAttendance={handleSelectMeeting}
              onDeleteMeeting={handleDeleteFromCalendar}
            />
          </div>
        )}
      </main>

      {/* Modals */}
      <AddListModal
        isOpen={isAddListOpen}
        onClose={() => setIsAddListOpen(false)}
        onRosterUpdated={() => {
          // Roster files or the selection changed: views re-read them.
          setRosterVersion((v) => v + 1);
        }}
      />

      <SaveMeetingModal
        isOpen={isSaveModalOpen}
        onClose={handleCloseSaveModal}
        durationSeconds={saveSessionMeta.durationSeconds}
        initialTitle={saveSessionMeta.title}
        initialPlatform={saveSessionMeta.platform}
        attendees={saveSessionMeta.attendees}
        trackingStartedAt={saveSessionMeta.trackingStartedAt}
        trackingEndedAt={saveSessionMeta.trackingEndedAt}
        headcount={saveSessionMeta.headcount}
        onSaveMeeting={handleSaveLiveMeeting}
      />
    </div>
  );
}
