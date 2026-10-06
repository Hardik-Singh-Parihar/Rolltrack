import React, { useState } from 'react';
import { FileSpreadsheet, Trash2, ArrowRight, Check, X } from 'lucide-react';
import { Meeting } from '../types';

interface RecentMeetingsCardProps {
  meetings: Meeting[];
  // How many meetings are saved in total (including ones hidden from this list).
  savedCount?: number;
  onOpenAddListModal: () => void;
  onClearMeetings: () => void;
  onSelectMeeting: (meetingId: string) => void;
}

export const RecentMeetingsCard: React.FC<RecentMeetingsCardProps> = ({
  meetings,
  savedCount = meetings.length,
  onOpenAddListModal,
  onClearMeetings,
  onSelectMeeting,
}) => {
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const handleConfirmClear = () => {
    onClearMeetings();
    setShowConfirmClear(false);
  };

  return (
    <div className="w-full bg-[#111722] border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <h2 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
          <span>Recent Meetings</span>
          <span className="text-slate-400 font-mono text-sm font-normal">({meetings.length})</span>
        </h2>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenAddListModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Add List</span>
          </button>

          {/* In-app Clear Confirmation (no window.alert / window.confirm) */}
          {showConfirmClear ? (
            <div className="flex items-center gap-1.5 bg-red-950/60 border border-red-800/80 px-2 py-1 rounded-lg text-xs animate-fadeIn">
              <span className="text-red-300 font-medium mr-1" title="Your meetings are not deleted">Clear list?</span>
              <button
                onClick={handleConfirmClear}
                className="flex items-center gap-0.5 px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded cursor-pointer transition-colors"
                title="Confirm clear"
              >
                <Check className="w-3 h-3" />
                <span>Yes</span>
              </button>
              <button
                onClick={() => setShowConfirmClear(false)}
                className="flex items-center gap-0.5 px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer transition-colors"
                title="Cancel"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirmClear(true)}
              disabled={meetings.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-950/20 hover:bg-red-950/40 border border-red-900/40 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all cursor-pointer"
              title="Empty this list. Your meetings stay saved and open from the calendar."
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Meeting list */}
      <div className="mt-2 divide-y divide-slate-800/60">
        {meetings.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            {savedCount > 0 ? (
              <>
                The recent list is cleared. Your {savedCount} saved meeting{savedCount === 1 ? '' : 's'} {savedCount === 1 ? 'is' : 'are'} still
                available from the calendar below: pick a date to open {savedCount === 1 ? 'it' : 'them'}.
              </>
            ) : (
              <>No recent meetings recorded yet. Start a live meeting or click "Add List" to import sessions.</>
            )}
          </div>
        ) : (
          meetings.map((meeting) => (
            <div
              key={meeting.id}
              onClick={() => onSelectMeeting(meeting.id)}
              className="py-3.5 sm:py-4 px-2 -mx-2 rounded-xl hover:bg-slate-800/40 transition-colors flex items-center justify-between gap-3 group cursor-pointer"
            >
              {/* Left Details */}
              <div className="flex-1 min-w-0 pr-2">
                <h4 className="text-sm sm:text-base font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate">
                  {meeting.title}
                </h4>
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 font-mono">
                  <span>{meeting.date}</span>
                  <span className="text-slate-600 font-sans">·</span>
                  <span>{meeting.durationMinutes} mins</span>
                  <span className="text-slate-600 font-sans">·</span>
                  <span>{meeting.attendeeCount} attendees</span>
                </div>
              </div>

              {/* Right Action button: Arrow ONLY (Log option removed as requested) */}
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="p-2 text-slate-400 group-hover:text-white bg-slate-800/60 group-hover:bg-blue-600/30 border border-slate-700/60 group-hover:border-blue-500/50 rounded-lg transition-all"
                  title="View attendance details"
                >
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
