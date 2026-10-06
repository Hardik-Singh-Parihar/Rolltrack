import React, { useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Search, X, User, ArrowRight, Trash2, Check } from 'lucide-react';
import { Meeting } from '../types';
import { buildMonthCells, monthLabel } from '../utils/dateUtils';

interface MeetingCalendarCardProps {
  meetings: Meeting[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onViewAttendance: (meetingId: string) => void;
  // Deletes the meeting from storage for good.
  onDeleteMeeting?: (meetingId: string) => void;
}

export const MeetingCalendarCard: React.FC<MeetingCalendarCardProps> = ({
  meetings,
  selectedDate,
  onSelectDate,
  onViewAttendance,
  onDeleteMeeting,
}) => {
  const [filterText, setFilterText] = useState('');
  // The meeting whose delete is waiting for a second click (no window.confirm).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // The month being viewed. Starts on the current month; the arrows move by
  // real months (and years), and the grid is computed from the real calendar.
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // "Today" is re-read whenever the component renders, so the highlight moves
  // on at midnight without a reload.
  const calendarCells = buildMonthCells(view.year, view.month, new Date());
  const currentMonth = monthLabel(view.year, view.month);
  const shiftMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  const goToday = () => {
    const now = new Date();
    setView({ year: now.getFullYear(), month: now.getMonth() });
  };
  const isViewingThisMonth = (() => {
    const now = new Date();
    return view.year === now.getFullYear() && view.month === now.getMonth();
  })();

  // Group meetings by date
  const meetingsByDate: Record<string, Meeting[]> = {};
  meetings.forEach((m) => {
    if (!meetingsByDate[m.date]) {
      meetingsByDate[m.date] = [];
    }
    meetingsByDate[m.date].push(m);
  });

  const selectedMeetings = selectedDate
    ? (meetingsByDate[selectedDate] || []).filter((m) =>
        filterText.trim() === ''
          ? true
          : m.title.toLowerCase().includes(filterText.toLowerCase()) ||
            m.hostName.toLowerCase().includes(filterText.toLowerCase())
      )
    : [];

  return (
    <div className="w-full bg-[#111722] border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl">
      {/* Calendar Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <CalendarIcon className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-lg font-semibold text-white">Meeting Calendar</h3>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Click any highlighted date below to view scheduled meetings.
            </p>
          </div>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center self-start sm:self-auto gap-1 sm:gap-2 bg-[#0c1017] border border-slate-800 rounded-xl p-1">
          <button
            onClick={() => shiftMonth(-1)}
            className="p-1 sm:p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs sm:text-sm font-semibold text-slate-200 px-2 sm:px-3 tracking-wide min-w-[120px] text-center">
            {currentMonth}
          </span>
          <button
            onClick={() => shiftMonth(1)}
            className="p-1 sm:p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isViewingThisMonth && (
            <button
              onClick={goToday}
              className="px-2 py-1 text-[11px] font-semibold text-blue-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Jump to the current month"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Weekday Labels */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center text-[9px] sm:text-xs font-semibold text-slate-400 pt-3 pb-1 tracking-wider">
        <span>SUN</span>
        <span>MON</span>
        <span>TUE</span>
        <span>WED</span>
        <span>THU</span>
        <span>FRI</span>
        <span>SAT</span>
      </div>

      {/* Days Grid - Responsive for mobile and PC */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {calendarCells.map((cell, idx) => {
          const count = (meetingsByDate[cell.dateStr] || []).length;
          const isSelected = selectedDate === cell.dateStr;
          const isCurrentMonth = cell.inMonth;

          return (
            <button
              key={`${cell.dateStr}-${idx}`}
              onClick={() => {
                if (isSelected) {
                  onSelectDate(null); // Close when clicking again
                } else {
                  onSelectDate(cell.dateStr); // Open list of meetings for this date
                }
              }}
              className={`min-h-[48px] sm:min-h-[70px] p-1 sm:p-2 rounded-xl text-left flex flex-col justify-between transition-all cursor-pointer relative ${
                cell.isToday && !isSelected ? 'ring-2 ring-blue-400/80 ring-offset-1 ring-offset-[#111722] ' : ''
              }${
                isSelected
                  ? 'bg-blue-950/50 border-2 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)] z-10'
                  : count > 0
                  ? 'bg-[#151c2a] border border-slate-700/80 hover:border-blue-500/60 hover:bg-[#192335]'
                  : isCurrentMonth
                  ? 'bg-[#0f141e]/70 border border-slate-800/60 hover:border-slate-700'
                  : 'bg-[#0c0f16]/40 border border-slate-800/40 opacity-40'
              }`}
            >
              {/* Day Number and Today Indicator */}
              <div className="flex items-center justify-between w-full">
                <span
                  className={`text-[11px] sm:text-sm font-medium font-mono ${
                    isSelected
                      ? 'text-blue-300 font-bold'
                      : isCurrentMonth
                      ? 'text-slate-200'
                      : 'text-slate-600'
                  }`}
                >
                  {cell.day}
                </span>

                {cell.isToday && (
                  <span
                    className="px-1 py-px text-[8px] sm:text-[9px] font-bold uppercase tracking-wide text-white bg-blue-500 rounded"
                    title="Today"
                  >
                    Today
                  </span>
                )}
              </div>

              {/* Meeting count indicator */}
              {count > 0 && (
                <div className="mt-0.5 sm:mt-1">
                  <div className="inline-flex items-center gap-0.5 sm:gap-1 text-[8px] sm:text-[11px] font-medium text-emerald-400 bg-emerald-950/60 px-1 sm:px-1.5 py-0.5 rounded border border-emerald-800/40 whitespace-nowrap">
                    <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="hidden sm:inline">{count} meeting{count > 1 ? 's' : ''}</span>
                    <span className="sm:hidden">{count}</span>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Day Details Section: KEPT CLOSED until user clicks on one of the days */}
      {selectedDate ? (
        <div className="mt-5 pt-4 border-t border-slate-800/80 animate-fadeIn">
          {/* Header with clear and filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h4 className="text-xs sm:text-base font-semibold text-white">
                Meetings on <span className="font-mono text-blue-400">{selectedDate}</span>{' '}
                <span className="text-slate-400 font-normal">({selectedMeetings.length})</span>
              </h4>
              <button
                onClick={() => onSelectDate(null)}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                title="Close meeting list"
              >
                <X className="w-3 h-3" />
                <span>Close</span>
              </button>
            </div>

            {/* Filter search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Filter meetings..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0b0e14] border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* List of meetings for this day */}
          {selectedMeetings.length === 0 ? (
            <div className="py-6 text-center text-slate-500 text-xs sm:text-sm bg-[#0c1017] rounded-xl border border-slate-800">
              No meetings scheduled on {selectedDate}.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {selectedMeetings.map((meeting) => (
                <div
                  key={meeting.id}
                  onClick={() => onViewAttendance(meeting.id)}
                  className="p-4 bg-[#0d121c] hover:bg-[#121927] border border-slate-800 hover:border-blue-500/50 rounded-xl flex flex-col justify-between gap-3 transition-all cursor-pointer group shadow-sm hover:shadow-[0_0_15px_rgba(59,130,246,0.15)]"
                >
                  <div>
                    {/* Top line badge and time */}
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-blue-950/60 text-blue-400 border border-blue-800/40 rounded">
                        {meeting.platform}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-mono text-[11px]">
                          {meeting.startTime} - {meeting.endTime}
                        </span>
                        {onDeleteMeeting &&
                          (confirmDeleteId === meeting.id ? (
                            <span
                              className="flex items-center gap-1 bg-red-950/60 border border-red-800/80 px-1.5 py-0.5 rounded-md text-[11px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="text-red-300 font-medium">Delete for good?</span>
                              <button
                                onClick={() => {
                                  onDeleteMeeting(meeting.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded cursor-pointer"
                                title="Delete this meeting permanently"
                              >
                                <Check className="w-3 h-3" />
                                <span>Yes</span>
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
                                title="Keep it"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(meeting.id);
                              }}
                              className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded cursor-pointer"
                              title="Delete this meeting"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ))}
                      </div>
                    </div>

                    {/* Title */}
                    <h5 className="text-xs sm:text-sm font-semibold text-slate-100 group-hover:text-blue-400 transition-colors leading-snug">
                      {meeting.title}
                    </h5>

                    {/* Duration & attendees */}
                    <div className="text-[11px] sm:text-xs text-slate-400 font-mono mt-1">
                      {meeting.durationMinutes} mins · {meeting.attendeeCount} attendees
                    </div>
                  </div>

                  {/* Footer Host and Link */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-slate-400 truncate max-w-[160px] sm:max-w-[200px]">
                      <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{meeting.hostName}</span>
                    </div>

                    <div className="flex items-center gap-1 text-xs font-semibold text-blue-400 group-hover:text-blue-300 transition-colors">
                      <span>View Attendance</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Helper indicator when closed matching Screenshot 1 */
        <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-center gap-2 text-[11px] sm:text-xs text-slate-500">
          <CalendarIcon className="w-3.5 h-3.5 text-blue-400/80" />
          <span>Select any date on the calendar above to view its meetings</span>
        </div>
      )}
    </div>
  );
};
