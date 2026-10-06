import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowLeft,
  Zap,
  Share2,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sliders,
  Database,
  Copy,
  Check,
  Search,
  Edit3,
  Users,
  HardDrive,
  FileSpreadsheet,
  AlertTriangle,
} from 'lucide-react';
import { Meeting } from '../types';
import { EditMeetingNameModal } from './EditMeetingNameModal';
import {
  getStoredRosters,
  getActiveRosters,
  combineRosters,
  findRosterDuplicates,
  rosterSignature,
  matchAttendeesWithRoster,
  MatchingResult,
  RosterDuplicateGroup,
} from '../utils/rosterStorage';

interface MeetingAttendanceViewProps {
  meeting: Meeting;
  onBack: () => void;
  onDeleteMeeting: (meetingId: string) => void;
  onUpdateMeetingGoal: (meetingId: string, goal: number, rosterIds?: string[]) => void;
  onUpdateMeeting?: (updatedMeeting: Meeting) => void;
  onOpenAddList?: () => void;
  // Bumped by the parent whenever roster files or the selection change, so
  // this view re-reads them (it used to read them once and go stale).
  rosterVersion?: number;
}

export const MeetingAttendanceView: React.FC<MeetingAttendanceViewProps> = ({
  meeting,
  onBack,
  onDeleteMeeting,
  onUpdateMeetingGoal,
  onUpdateMeeting,
  onOpenAddList,
  rosterVersion = 0,
}) => {
  const [goal, setGoal] = useState<number>(meeting.attendanceGoal || 75);
  const [isConfirmed, setIsConfirmed] = useState<boolean>(meeting.isGoalConfirmed);
  const [activeTab, setActiveTab] = useState<'all' | 'met' | 'missed' | 'unmatched'>('all');
  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [formatType, setFormatType] = useState<'comma' | 'newline' | 'space'>('comma');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [copiedKeys, setCopiedKeys] = useState<Record<string, boolean>>({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Roster resolution. Several files can be selected at once.
  //  - not confirmed yet: the CURRENT selection
  //  - confirmed: the files that were selected when Confirm was pressed, so
  //    changing the selection later doesn't silently rewrite an old meeting
  const globalSheets = useMemo(() => getActiveRosters(), [rosterVersion]);
  const usedSheets = useMemo(() => {
    if (meeting.isGoalConfirmed && meeting.rosterIds && meeting.rosterIds.length > 0) {
      const all = getStoredRosters();
      const kept = meeting.rosterIds
        .map((id) => all.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => !!r);
      if (kept.length > 0) return kept;
    }
    return globalSheets;
  }, [meeting.isGoalConfirmed, meeting.rosterIds, globalSheets, rosterVersion]);
  const activeRoster = useMemo(() => combineRosters(usedSheets), [usedSheets]);
  const selectionChangedSinceConfirm =
    isConfirmed && usedSheets.length > 0 && rosterSignature(usedSheets) !== rosterSignature(globalSheets);

  // Confirm-time checks (shown immediately, before any matching happens)
  const [showNoRoster, setShowNoRoster] = useState(false);
  const [dupWarning, setDupWarning] = useState<RosterDuplicateGroup[] | null>(null);
  const [ackSignature, setAckSignature] = useState('');
  useEffect(() => {
    // Once a roster file is selected the "no roster" notice is stale.
    if (globalSheets.length > 0) setShowNoRoster(false);
    // A changed selection invalidates a duplicate warning that was on screen.
    setDupWarning(null);
  }, [globalSheets]);

  // Execute matching algorithm with active master roster
  const matchingResult: MatchingResult = useMemo(() => {
    return matchAttendeesWithRoster(meeting.attendees, activeRoster, goal);
  }, [meeting.attendees, activeRoster, goal]);

  const { divisionGroups, divisions, matchedAttendees, unmatchedAttendees } = matchingResult;

  // Total met vs missed across matched
  const totalMet = useMemo(() => {
    return Object.values(divisionGroups).reduce((acc, grp) => acc + grp.metAttendees.length, 0);
  }, [divisionGroups]);

  const totalMissed = useMemo(() => {
    return Object.values(divisionGroups).reduce((acc, grp) => acc + grp.missedAttendees.length, 0);
  }, [divisionGroups]);

  const formatRolls = (rolls: number[], format: 'comma' | 'newline' | 'space') => {
    if (rolls.length === 0) return 'None';
    if (format === 'comma') return rolls.join(', ');
    if (format === 'newline') return rolls.join('\n');
    return rolls.join(' ');
  };

  // Do the actual confirm: remember the goal AND which files were used.
  const proceedConfirm = (sheets: typeof globalSheets) => {
    const roster = combineRosters(sheets);
    const result = matchAttendeesWithRoster(meeting.attendees, roster, goal);
    setShowNoRoster(false);
    setDupWarning(null);
    setIsConfirmed(true);
    onUpdateMeetingGoal(
      meeting.id,
      goal,
      sheets.map((r) => r.id)
    );

    setToastMessage(
      `✓ Goal set to ${goal}%. Matched ${result.matchedAttendees.length}/${meeting.attendees.length} attendees against \"${
        roster ? roster.name : 'No Roster'
      }\" across ${result.divisions.length} divisions.`
    );
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 4500);
  };

  const handleConfirmGoal = () => {
    const sheets = globalSheets;

    // 1. No roster file selected: say so right now and do NOT continue.
    if (sheets.length === 0) {
      setDupWarning(null);
      setShowNoRoster(true);
      return;
    }
    setShowNoRoster(false);

    // 2. Same student in several selected files: warn BEFORE matching.
    const dups = findRosterDuplicates(sheets);
    if (dups.length > 0 && ackSignature !== rosterSignature(sheets)) {
      setDupWarning(dups);
      return;
    }

    proceedConfirm(sheets);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeys((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setCopiedKeys((prev) => ({ ...prev, [key]: false }));
    }, 2000);
  };

  const handleDownloadCSV = () => {
    let csv = `RollTrack Meeting Attendance Report\n`;
    csv += `Meeting:,"${meeting.title}"\n`;
    csv += `Date:,${meeting.date}\n`;
    csv += `Platform:,${meeting.platform}\n`;
    csv += `Attendance Goal:,${goal}%\n`;
    const rosterDisplay = activeRoster ? `"${activeRoster.name} (${activeRoster.fileName})"` : `"None"`;
    csv += `Master Roster Used:,${rosterDisplay}\n\n`;

    // Division breakdown tables
    divisions.forEach((div) => {
      const grp = divisionGroups[div];
      if (!grp) return;

      csv += `--- ${div.toUpperCase()} ---\n`;
      csv += `Met Roll Numbers (${grp.metRolls.length}):,"${grp.metRolls.join(', ')}"\n`;
      csv += `Missed Roll Numbers (${grp.missedRolls.length}):,"${grp.missedRolls.join(', ')}"\n`;
      csv += `Division,Roll No,Name,Email,Duration (mins),Total (mins),Presence %,Status\n`;

      const allDivAttendees = [...grp.metAttendees, ...grp.missedAttendees];
      allDivAttendees.forEach((a) => {
        const status = a.presencePercentage >= goal ? 'MET' : 'MISSED';
        csv += `"${div}",${a.rollNo},"${a.name}","${a.email}",${a.durationMinutes},${a.totalMinutes},${a.presencePercentage}%,${status}\n`;
      });
      csv += `\n`;
    });

    // Unmatched Section
    if (unmatchedAttendees.length > 0) {
      csv += `--- UNMATCHED ATTENDEES (NOT IN MASTER ROSTER) ---\n`;
      csv += `Division,Roll No,Joined Name,Email,Duration (mins),Total (mins),Presence %,Status\n`;
      unmatchedAttendees.forEach((a) => {
        csv += `"NO_MATCH",N/A,"${a.name}","${a.email}",${a.durationMinutes},${a.totalMinutes},${a.presencePercentage}%,UNMATCHED\n`;
      });
      csv += `\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Attendance_${meeting.title.replace(/\s+/g, '_')}_MultiDivision.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setToastMessage('✓ CSV file with division breakdown downloaded.');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleSaveMeetingName = (newTitle: string) => {
    if (onUpdateMeeting) {
      onUpdateMeeting({
        ...meeting,
        title: newTitle,
      });
    }
    setToastMessage(`✓ Meeting name updated to "${newTitle}"`);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 4000);
  };

  // Filter attendees for list
  const allMeetingAttendees = useMemo(() => {
    return [...matchedAttendees, ...unmatchedAttendees];
  }, [matchedAttendees, unmatchedAttendees]);

  const filteredAttendees = allMeetingAttendees.filter((a) => {
    const isUnmatched = !a.isMatched;
    const isMet = Boolean(a.isMatched && a.presencePercentage >= goal);
    const isMissed = Boolean(a.isMatched && a.presencePercentage < goal);

    let matchesTab = true;
    if (activeTab === 'met') matchesTab = isMet;
    if (activeTab === 'missed') matchesTab = isMissed;
    if (activeTab === 'unmatched') matchesTab = isUnmatched;

    let matchesDiv = true;
    if (selectedDivisionFilter !== 'all') {
      if (selectedDivisionFilter === 'unmatched') {
        matchesDiv = isUnmatched;
      } else {
        matchesDiv = a.division === selectedDivisionFilter;
      }
    }

    const matchesSearch =
      searchQuery.trim() === ''
        ? true
        : a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.rollNo.toString().includes(searchQuery) ||
          (a.division && a.division.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesTab && matchesDiv && matchesSearch;
  });

  return (
    <div className="w-full max-w-4xl mx-auto space-y-5 pb-16">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-300 hover:text-white bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {/* EDIT MEETING NAME BUTTON */}
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-amber-300 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-800/60 rounded-lg transition-all cursor-pointer shadow-sm"
            title="Edit meeting name"
          >
            <Edit3 className="w-3.5 h-3.5 text-amber-400" />
            <span>Edit Name</span>
          </button>

          {/* Share CSV button */}
          <button
            onClick={handleDownloadCSV}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-emerald-300 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-800/60 rounded-lg transition-all cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Share (CSV)</span>
          </button>

          {/* Download CSV button */}
          <button
            onClick={handleDownloadCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>

          {/* Delete button */}
          <button
            onClick={() => onDeleteMeeting(meeting.id)}
            className="p-2 text-slate-400 hover:text-red-400 bg-slate-900/90 hover:bg-red-950/30 border border-slate-700/70 hover:border-red-900/50 rounded-lg transition-all cursor-pointer"
            title="Delete meeting"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Info Card */}
      <div className="bg-[#111722] border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          {/* Meeting Title & Host */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mb-2">
              <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-blue-950/60 text-blue-400 border border-blue-800/40 rounded">
                {meeting.platform}
              </span>
              <span>{meeting.date}</span>
              <span className="text-slate-600">·</span>
              <span>
                {meeting.startTime} - {meeting.endTime}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-snug">
                {meeting.title}
              </h1>
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="p-1 text-slate-500 hover:text-amber-400 hover:bg-slate-800/60 rounded-md transition-colors cursor-pointer"
                title="Edit title"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-400 mt-1.5">
              Host: <span className="text-slate-200 font-medium">{meeting.hostName}</span>{' '}
              <span className="text-slate-500">({meeting.hostEmail})</span>
            </p>

            {/* Master Roster Source Badge */}
            <div className="mt-3 flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#0c1017] border border-slate-800 rounded-lg text-slate-300">
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" />
                <span>Roster file{usedSheets.length > 1 ? 's' : ''}:</span>
                <strong className="text-white font-medium truncate max-w-[200px]">
                  {activeRoster ? activeRoster.name : 'No roster file selected'}
                </strong>
              </div>

              {onOpenAddList && (
                <button
                  onClick={onOpenAddList}
                  className="text-xs text-blue-400 hover:text-blue-300 underline cursor-pointer"
                >
                  {globalSheets.length > 0 ? 'Change roster files' : 'Select roster file'}
                </button>
              )}
            </div>
          </div>

          {/* Attendance Goal Bar Widget with Confirm Button */}
          <div className="w-full md:w-76 bg-[#0c1017] border border-slate-800/90 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-slate-400 uppercase mb-2">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-blue-400" />
                <span>Attendance Goal Bar</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={goal}
                onChange={(e) => setGoal(Number(e.target.value))}
                className="w-full cursor-pointer accent-blue-500"
              />
              <div className="min-w-[46px] px-2 py-1 bg-slate-900 border border-slate-700/80 rounded-md text-center text-xs font-bold font-mono text-blue-300">
                {goal}%
              </div>
              <button
                onClick={handleConfirmGoal}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-semibold rounded-md shadow-sm transition-all cursor-pointer shrink-0"
              >
                Confirm
              </button>
            </div>

            <div className="text-[11px] text-slate-500 mt-2 flex items-center justify-between">
              {isConfirmed && selectionChangedSinceConfirm ? (
                <span className="text-amber-300 flex items-center gap-1 font-medium">
                  <AlertTriangle className="w-3 h-3" /> Roster selection changed. Press Confirm to re-match.
                </span>
              ) : isConfirmed ? (
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <Check className="w-3 h-3" /> Division matching confirmed
                </span>
              ) : (
                <span>Set goal &amp; click Confirm to match divisions</span>
              )}
            </div>
          </div>
        </div>

        {/* No roster file selected: shown the moment Confirm is pressed, matching does not run */}
        {showNoRoster && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-red-950/30 border border-red-800/60 p-3.5 rounded-xl text-xs text-red-200 animate-fadeIn">
            <div className="flex items-start sm:items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <strong className="text-white">No roster file is selected.</strong>{' '}
                <span>Matching was not run. Select at least one Excel roster file, then press Confirm again.</span>
              </div>
            </div>
            {onOpenAddList && (
              <button
                onClick={onOpenAddList}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg cursor-pointer shrink-0"
              >
                Select roster file
              </button>
            )}
          </div>
        )}

        {/* Duplicate students across the selected roster files: warn before matching */}
        {dupWarning && (
          <div className="bg-amber-950/25 border border-amber-800/60 p-3.5 rounded-xl text-xs text-amber-100 space-y-2.5 animate-fadeIn">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white">
                  {dupWarning.length} student{dupWarning.length > 1 ? 's appear' : ' appears'} more than once in the selected roster files.
                </strong>{' '}
                <span>
                  Nothing was merged. {dupWarning.filter((d) => d.kind === 'exact').length} exact (same name, division and roll no.),{' '}
                  {dupWarning.filter((d) => d.kind === 'possible').length} possible (same name, different division or roll no.).
                  If you continue, the file selected first takes priority.
                </span>
              </div>
            </div>
            <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {dupWarning.slice(0, 12).map((d) => (
                <li key={d.name} className="bg-black/20 rounded-md px-2.5 py-1.5">
                  <span className="font-semibold text-white">{d.name}</span>{' '}
                  <span className={d.kind === 'exact' ? 'text-red-300' : 'text-amber-300'}>({d.kind})</span>
                  <span className="text-amber-200/80">
                    {' '}
                    {d.entries.map((e) => `${e.sheetName}: ${e.division} #${e.rollNo}`).join('  |  ')}
                  </span>
                </li>
              ))}
              {dupWarning.length > 12 && <li className="text-amber-300/80">…and {dupWarning.length - 12} more</li>}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setAckSignature(rosterSignature(globalSheets));
                  proceedConfirm(globalSheets);
                }}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Continue matching anyway
              </button>
              {onOpenAddList && (
                <button
                  onClick={onOpenAddList}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Change roster selection
                </button>
              )}
            </div>
          </div>
        )}

        {/* Backend Verified Banner (Visible when confirmed) */}
        {isConfirmed && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#081f18] border border-emerald-800/60 p-3.5 rounded-xl text-xs text-emerald-300 animate-fadeIn">
            <div className="flex items-start sm:items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span>
                  Extension matched attendee joining names against local PC Excel sheet:{' '}
                  <strong className="text-white">
                    {matchedAttendees.length} of {meeting.attendees.length} matched
                  </strong>{' '}
                  across <strong className="text-white">{divisions.length} divisions</strong>.
                </span>
                {unmatchedAttendees.length > 0 && (
                  <span className="block text-amber-300 text-[11px] mt-0.5">
                    Notice: {unmatchedAttendees.length} participant{unmatchedAttendees.length > 1 ? 's' : ''} did not match any division/roll in your Excel roster.
                  </span>
                )}
              </div>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 rounded self-start sm:self-auto shrink-0">
              Division Match Verified
            </span>
          </div>
        )}

        {/* 4 Stat Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {/* Meeting Length */}
          <div className="bg-[#0c1017] border border-slate-800/90 rounded-xl p-3 sm:p-4">
            <span className="text-[11px] text-slate-400 block font-medium">Meeting Length</span>
            <div className="text-base sm:text-lg font-bold text-white font-mono mt-1">
              {meeting.durationMinutes} <span className="text-xs font-normal text-slate-400">mins</span>
            </div>
          </div>

          {/* Total Attendees */}
          <div className="bg-[#0c1017] border border-slate-800/90 rounded-xl p-3 sm:p-4">
            <span className="text-[11px] text-slate-400 block font-medium">Total Attendees</span>
            <div className="text-base sm:text-lg font-bold text-white font-mono mt-1">
              {meeting.attendeeCount}
            </div>
          </div>

          {/* Met Goal */}
          <div className="bg-[#0c1017] border border-emerald-950/60 rounded-xl p-3 sm:p-4">
            <span className="text-[11px] text-slate-400 block font-medium">Met Goal</span>
            <div
              className={`text-base sm:text-lg font-bold font-mono mt-1 ${
                isConfirmed ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              {isConfirmed
                ? `${matchedAttendees.length > 0 ? Math.round((totalMet / matchedAttendees.length) * 100) : 0}% (${totalMet})`
                : 'Pending'}
            </div>
          </div>

          {/* Unmatched / Missed Goal */}
          <div className="bg-[#0c1017] border border-amber-950/60 rounded-xl p-3 sm:p-4">
            <span className="text-[11px] text-slate-400 block font-medium">
              {unmatchedAttendees.length > 0 ? 'Unmatched in Roster' : 'Missed Goal'}
            </span>
            <div
              className={`text-base sm:text-lg font-bold font-mono mt-1 ${
                isConfirmed
                  ? unmatchedAttendees.length > 0
                    ? 'text-amber-400'
                    : 'text-red-400'
                  : 'text-slate-500'
              }`}
            >
              {isConfirmed
                ? unmatchedAttendees.length > 0
                  ? `${unmatchedAttendees.length} non-roster`
                  : `${totalMissed} missed`
                : 'Pending'}
            </div>
          </div>
        </div>
      </div>

      {/* Middle Section: Unconfirmed prompt OR Confirmed Roll Lists Generated FOR EVERY NEW DIVISION */}
      {!isConfirmed ? (
        <div className="bg-[#111722] border border-slate-800/90 border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400 mb-3">
            <Database className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-white">Confirm Attendance Goal</h3>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mt-1.5">
            Select or drag the attendance goal slider above (e.g. 75%) and click{' '}
            <strong className="text-blue-400">"Confirm"</strong>. RollTrack will match the meeting participants with your PC's stored Excel sheet and generate roll number lists for every division!
          </p>
        </div>
      ) : (
        /* CONFIRMED: GENERATE AN ATTENDANCE SUMMARY & LISTS SECTION FOR EVERY DIVISION */
        <div className="space-y-5 animate-fadeIn">
          {/* Format Switcher Header */}
          <div className="bg-[#111722] border border-slate-800/90 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
            <div>
              <h3 className="text-base font-semibold text-white">Division Attendance Summaries &amp; Lists</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatically split by Division from your stored Excel sheet. Click Copy to paste roll numbers directly into your records.
              </p>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="text-xs text-slate-400">Rolls Format:</span>
              <div className="flex items-center bg-[#0c1017] border border-slate-800 rounded-lg p-0.5 text-xs">
                {(['comma', 'newline', 'space'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormatType(fmt)}
                    className={`px-2.5 py-1 rounded capitalize font-medium transition-all ${
                      formatType === fmt
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* GENERATE ATTENDANCE SUMMARY & LISTS FOR EVERY UNIQUE DIVISION */}
          {divisions.map((divisionName) => {
            const grp = divisionGroups[divisionName];
            if (!grp) return null;

            const metKey = `met-${divisionName}`;
            const missedKey = `missed-${divisionName}`;

            return (
              <div
                key={divisionName}
                className="bg-[#111722] border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4"
              >
                {/* Division Section Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <h4 className="text-base font-bold text-white tracking-wide">
                      {divisionName}
                    </h4>
                    <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-blue-950/70 text-blue-300 border border-blue-800/50 rounded-full">
                      {grp.totalMatched} Students Matched
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-emerald-400">
                      Met: {grp.metRolls.length}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-red-400">
                      Missed: {grp.missedRolls.length}
                    </span>
                  </div>
                </div>

                {/* Met list card for this division */}
                <div className="bg-[#081a14] border border-emerald-900/60 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {divisionName} — Met Required Time ({grp.metRolls.length}) · &gt;= {goal}%
                      </span>
                    </span>

                    <button
                      onClick={() =>
                        copyToClipboard(formatRolls(grp.metRolls, formatType), metKey)
                      }
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:text-white bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800/60 rounded-md transition-colors cursor-pointer"
                    >
                      {copiedKeys[metKey] ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedKeys[metKey] ? 'Copied Rolls' : 'Copy Rolls'}</span>
                    </button>
                  </div>

                  <div className="bg-[#05110d] p-3 rounded-lg font-mono text-xs sm:text-sm text-emerald-300 font-semibold tracking-wider select-all overflow-x-auto whitespace-pre-wrap">
                    {formatRolls(grp.metRolls, formatType)}
                  </div>
                </div>

                {/* Missed list card for this division */}
                <div className="bg-[#1b0d0f] border border-red-900/60 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>
                        {divisionName} — Missed Required Time ({grp.missedRolls.length}) · &lt; {goal}%
                      </span>
                    </span>

                    <button
                      onClick={() =>
                        copyToClipboard(formatRolls(grp.missedRolls, formatType), missedKey)
                      }
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-300 hover:text-white bg-red-950/80 hover:bg-red-900 border border-red-800/60 rounded-md transition-colors cursor-pointer"
                    >
                      {copiedKeys[missedKey] ? (
                        <Check className="w-3 h-3 text-red-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedKeys[missedKey] ? 'Copied Rolls' : 'Copy Rolls'}</span>
                    </button>
                  </div>

                  <div className="bg-[#120709] p-3 rounded-lg font-mono text-xs sm:text-sm text-red-300 font-semibold tracking-wider select-all overflow-x-auto whitespace-pre-wrap">
                    {formatRolls(grp.missedRolls, formatType)}
                  </div>
                </div>
              </div>
            );
          })}

          {/* PEOPLE WHO JOIN AND DON'T HAVE MATCH DIVISION AND ROLL: DIFFERENT NO MATCH BOX */}
          {unmatchedAttendees.length > 0 && (
            <div className="bg-[#1a140d] border border-amber-800/70 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-amber-900/50">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <h4 className="text-base font-bold text-amber-200">
                      Unmatched Attendees (No Division or Roll No Match)
                    </h4>
                    <p className="text-xs text-amber-400/80">
                      These {unmatchedAttendees.length} participant{unmatchedAttendees.length > 1 ? 's' : ''} joined the meeting, but their names were not found in the active master Excel sheet.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() =>
                    copyToClipboard(
                      unmatchedAttendees.map((a) => a.name).join('\n'),
                      'unmatched-all'
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-200 bg-amber-950/80 hover:bg-amber-900 border border-amber-700/60 rounded-lg transition-colors cursor-pointer self-start sm:self-auto shrink-0"
                >
                  {copiedKeys['unmatched-all'] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKeys['unmatched-all'] ? 'Copied Names' : 'Copy Unmatched Names'}</span>
                </button>
              </div>

              {/* Unmatched Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {unmatchedAttendees.map((att) => (
                  <div
                    key={att.id}
                    className="p-3 bg-[#110e08] border border-amber-900/50 rounded-xl space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-amber-100 truncate">
                        {att.name}
                      </span>
                      <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold uppercase bg-amber-950 text-amber-400 border border-amber-800/60 rounded">
                        No Roster Match
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      {att.email}
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-amber-900/30">
                      <span className="text-slate-400">
                        {att.durationMinutes}m / {att.totalMinutes}m
                      </span>
                      <span className="font-bold text-amber-300 font-mono">
                        {att.presencePercentage}% presence
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full Attendee List with Division Filters */}
      <div className="bg-[#111722] border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
        {/* Header and Filter Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div>
            <h3 className="text-base font-semibold text-white">Full Attendee Roster Breakdown</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Showing {filteredAttendees.length} of {meeting.attendees.length} attendees across divisions.
            </p>
          </div>

          {/* Filter segment tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Division dropdown filter */}
            <select
              value={selectedDivisionFilter}
              onChange={(e) => setSelectedDivisionFilter(e.target.value)}
              className="px-2.5 py-1 text-xs bg-[#0c1017] border border-slate-800 rounded-lg text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Divisions</option>
              {divisions.map((div) => (
                <option key={div} value={div}>
                  {div}
                </option>
              ))}
              {unmatchedAttendees.length > 0 && (
                <option value="unmatched">Unmatched Only ({unmatchedAttendees.length})</option>
              )}
            </select>

            <div className="flex items-center bg-[#0c1017] border border-slate-800 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === 'all'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setActiveTab('met')}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === 'met'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Met ({totalMet})
              </button>
              <button
                onClick={() => setActiveTab('missed')}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === 'missed'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Missed ({totalMissed})
              </button>
              {unmatchedAttendees.length > 0 && (
                <button
                  onClick={() => setActiveTab('unmatched')}
                  className={`px-2 py-1 rounded font-medium transition-all ${
                    activeTab === 'unmatched'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-amber-400 hover:text-amber-300'
                  }`}
                >
                  Unmatched ({unmatchedAttendees.length})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by attendee name, email, roll no, or division..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-[#0b0e14] border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 tracking-wider uppercase">
                <th className="py-2.5 px-3">ATTENDEE / JOINED NAME</th>
                <th className="py-2.5 px-3">DIVISION</th>
                <th className="py-2.5 px-3 text-right">DURATION</th>
                <th className="py-2.5 px-3 text-right">PRESENCE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredAttendees.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500 text-xs font-sans">
                    No attendees match the criteria.
                  </td>
                </tr>
              ) : (
                filteredAttendees.map((att) => {
                  const isMet = att.isMatched && att.presencePercentage >= goal;
                  const isMissed = att.isMatched && att.presencePercentage < goal;

                  return (
                    <tr
                      key={att.id}
                      className="hover:bg-slate-800/30 transition-colors group font-sans"
                    >
                      {/* Name & Roll */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          {att.isMatched ? (
                            <span className="font-mono font-bold text-blue-300 text-xs bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-900/60">
                              #{att.rollNo}
                            </span>
                          ) : (
                            <span className="font-mono text-amber-400 text-[10px] bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-900/60">
                              NO ROLL
                            </span>
                          )}

                          <span className="font-semibold text-slate-200 group-hover:text-white">
                            {att.name}
                          </span>
                        </div>

                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                          {att.email}
                        </div>
                      </td>

                      {/* Division */}
                      <td className="py-3 px-3 font-medium">
                        {att.isMatched && att.division ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-slate-800/90 text-slate-200 border border-slate-700">
                            {att.division}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-semibold text-amber-400 bg-amber-950/40 border border-amber-800/50 rounded">
                            Unmatched Roster
                          </span>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="py-3 px-3 text-right font-mono font-medium text-slate-300">
                        {att.durationMinutes}m / {att.totalMinutes}m
                      </td>

                      {/* Presence % */}
                      <td className="py-3 px-3 text-right font-mono">
                        <span
                          className={`font-bold text-sm ${
                            isMet
                              ? 'text-emerald-400'
                              : isMissed
                              ? 'text-red-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {att.presencePercentage}%
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Meeting Name Modal */}
      <EditMeetingNameModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        currentTitle={meeting.title}
        onSave={handleSaveMeetingName}
      />

      {/* Floating Toast */}
      {showToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-[#0c1815] border border-emerald-500/60 text-emerald-200 px-4 py-2.5 rounded-xl shadow-2xl text-xs sm:text-sm animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
