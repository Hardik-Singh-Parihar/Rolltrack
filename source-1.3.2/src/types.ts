export type PlatformType = 'Zoom' | 'Google Meet' | 'Microsoft Teams';

export interface Attendee {
  id: string;
  rollNo: number;
  name: string;
  email: string;
  durationMinutes: number;
  totalMinutes: number;
  presencePercentage: number;
  note?: string;
  division?: string;
  isMatched?: boolean;
  matchedName?: string;
}

export interface MasterStudent {
  id: string;
  name: string; // The full name as joined in the meeting
  rollNo: number;
  division: string; // e.g. "Division A", "Division B", "Div C"
  email?: string;
}

export interface MasterListSheet {
  id: string;
  name: string;
  fileName: string;
  uploadedAt: string;
  totalRecords: number;
  divisions: string[];
  students: MasterStudent[];
}

export type ActionType =
  | 'screen_share'
  | 'mic_unmute'
  | 'mic_mute'
  | 'camera_on'
  | 'camera_off'
  | 'join'
  | 'leave'
  | 'hand_raise';

export interface ActivityEvent {
  id: string;
  attendeeName: string;
  type: ActionType;
  actionText: string;
  badgeTag?: string;
  timestampFormatted: string;
  timestampMinutes: number;
}

export interface Meeting {
  id: string;
  title: string;
  platform: PlatformType;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  durationMinutes: number;
  attendeeCount: number;
  hostName: string;
  hostEmail: string;
  attendanceGoal: number; // percentage, e.g. 75
  isGoalConfirmed: boolean;
  activeRosterId?: string; // legacy, no longer written
  // The roster files that were selected when Confirm was pressed.
  rosterIds?: string[];
  // True after "Clear" on the Recent Meetings list. The meeting is NOT deleted:
  // it is only hidden from that list and stays in storage and in the calendar.
  hiddenFromRecent?: boolean;
  attendees: Attendee[];
  activityLog: ActivityEvent[];
  metrics: {
    screenShares: number;
    micsUnmuted: number;
    camerasTurnedOn: number;
    handsRaised: number;
  };
}
