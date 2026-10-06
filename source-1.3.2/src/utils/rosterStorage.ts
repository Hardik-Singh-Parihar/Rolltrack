// Using `sheetjs-ce-unofficial` instead of the `xlsx` package on npm: the
// official `xlsx` package is stuck at 0.18.5 on the npm registry due to a
// publishing issue on SheetJS's end (their actual fix for a prototype-
// pollution + ReDoS advisory only ships via their own CDN, cdn.sheetjs.com,
// not npm). This package is a faithful, unmodified republish of that fixed
// source (0.20.2) — same API, clean audit. If you'd rather install directly
// from SheetJS's own CDN yourself, see https://docs.sheetjs.com/docs/getting-started/installation/nodejs
import * as XLSX from 'sheetjs-ce-unofficial';
import { MasterListSheet, MasterStudent, Attendee } from '../types';

const STORAGE_KEY = 'rolltrack_master_roster_sheets';
const ACTIVE_ROSTER_KEY = 'rolltrack_active_roster_id'; // legacy: a single id
const ACTIVE_ROSTERS_KEY = 'rolltrack_active_roster_ids'; // JSON array of ids

/**
 * Get all stored rosters from localStorage
 */
export function getStoredRosters(): MasterListSheet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.warn('Could not read master rosters from storage:', err);
    return [];
  }
}

/**
 * Save rosters array to localStorage
 */
export function saveStoredRosters(rosters: MasterListSheet[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rosters));
  } catch (err) {
    console.error('Failed to save master rosters to storage:', err);
  }
}

// The ids the user has explicitly selected, exactly as stored (may name files
// that no longer exist). Migrates the old single-id key once.
function readExplicitIds(sheets: MasterListSheet[]): string[] {
  try {
    const raw = localStorage.getItem(ACTIVE_ROSTERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    }
    // First run after upgrade: keep whatever was active before. The old code
    // treated the first file as active when nothing was chosen.
    const legacy = localStorage.getItem(ACTIVE_ROSTER_KEY);
    const carried = legacy && sheets.some((r) => r.id === legacy) ? [legacy] : sheets.length > 0 ? [sheets[0].id] : [];
    if (sheets.length > 0) localStorage.setItem(ACTIVE_ROSTERS_KEY, JSON.stringify(carried));
    return carried;
  } catch {
    return [];
  }
}

/**
 * The roster files currently selected, in the order they were selected (the
 * file selected first takes priority when a student appears in two files).
 *
 * Rules:
 *  - exactly one file stored  -> it is the roster automatically
 *  - several files stored     -> only what the user selected; NOTHING is
 *                                picked silently (an empty list = "no roster")
 */
export function getActiveRosterIds(): string[] {
  const sheets = getStoredRosters();
  if (sheets.length === 0) return [];
  if (sheets.length === 1) return [sheets[0].id];
  const ids = readExplicitIds(sheets);
  return ids.filter((id, i) => ids.indexOf(id) === i && sheets.some((r) => r.id === id));
}

export function setActiveRosterIds(ids: string[]): void {
  try {
    localStorage.setItem(ACTIVE_ROSTERS_KEY, JSON.stringify(ids));
  } catch (err) {
    console.error('Failed to set active roster IDs:', err);
  }
}

/** The selected roster files themselves, in selection order. */
export function getActiveRosters(): MasterListSheet[] {
  const sheets = getStoredRosters();
  return getActiveRosterIds()
    .map((id) => sheets.find((r) => r.id === id))
    .filter((r): r is MasterListSheet => !!r);
}

/** Select or deselect one roster file. Returns the new selection. */
export function toggleActiveRoster(id: string): string[] {
  const sheets = getStoredRosters();
  const current = getActiveRosterIds();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  // With a single stored file the selection is automatic, nothing to store.
  if (sheets.length > 1) setActiveRosterIds(next);
  return next;
}

/**
 * Add a new roster file WITHOUT disturbing the current selection.
 *  - first file ever          -> becomes the roster automatically
 *  - otherwise                -> selected only if `setAsRoster` is true
 * If a single file was selected only because it was the only one, that
 * selection is made explicit first, so adding a second file can't drop it.
 */
export function addRosterSheet(sheet: MasterListSheet, setAsRoster: boolean): MasterListSheet[] {
  const before = getStoredRosters();
  const selected = getActiveRosterIds();
  if (before.length === 1) setActiveRosterIds(selected);

  const updated = [sheet, ...before.filter((r) => r.id !== sheet.id)];
  saveStoredRosters(updated);

  if (before.length === 0) setActiveRosterIds([sheet.id]);
  else if (setAsRoster && !selected.includes(sheet.id)) setActiveRosterIds([...selected, sheet.id]);
  return updated;
}

/** Delete a roster file. Never promotes another file silently. */
export function deleteRosterSheet(id: string): MasterListSheet[] {
  const before = getStoredRosters();
  const explicit = readExplicitIds(before);
  const remaining = before.filter((r) => r.id !== id);
  saveStoredRosters(remaining);
  setActiveRosterIds(explicit.filter((x) => x !== id));
  return remaining;
}

// Kept for older call sites: the first selected roster id, or ''.
export function getActiveRosterId(): string {
  return getActiveRosterIds()[0] || '';
}

/** Stable text for "which files are selected", used to remember acknowledgements. */
export function rosterSignature(sheets: MasterListSheet[]): string {
  return sheets.map((r) => r.id).join('|');
}

/**
 * Merge the selected files into one list for matching. Nothing is de-duplicated
 * here (see findRosterDuplicates): a student in two files appears twice, and
 * the matcher takes the first hit, i.e. the file selected first.
 */
export function combineRosters(sheets: MasterListSheet[]): MasterListSheet | null {
  if (sheets.length === 0) return null;
  if (sheets.length === 1) return sheets[0];
  const divisions = Array.from(new Set(sheets.flatMap((r) => r.divisions || []))).sort();
  return {
    id: 'combined-' + rosterSignature(sheets),
    name: sheets.map((r) => r.name).join(' + '),
    fileName: sheets.map((r) => r.fileName).join(' + '),
    uploadedAt: '',
    totalRecords: sheets.reduce((n, r) => n + r.students.length, 0),
    divisions,
    students: sheets.flatMap((r) => r.students),
  };
}

export interface RosterDuplicateEntry {
  sheetName: string;
  rollNo: number;
  division: string;
}
export interface RosterDuplicateGroup {
  // exact:    same name, division and roll number (a plain duplicate)
  // possible: same name but a different division or roll number
  kind: 'exact' | 'possible';
  name: string;
  entries: RosterDuplicateEntry[];
}

/**
 * Students that appear more than once across the selected files (or twice in
 * one file). Reported to the user BEFORE matching; never merged silently.
 * Roll numbers alone are not a key: they repeat across divisions.
 */
export function findRosterDuplicates(sheets: MasterListSheet[]): RosterDuplicateGroup[] {
  const byName = new Map<string, { name: string; entries: RosterDuplicateEntry[] }>();
  for (const sheet of sheets) {
    for (const st of sheet.students) {
      const key = cleanName(st.name);
      if (!key) continue;
      let g = byName.get(key);
      if (!g) {
        g = { name: st.name, entries: [] };
        byName.set(key, g);
      }
      g.entries.push({ sheetName: sheet.name, rollNo: st.rollNo, division: st.division || 'Division A' });
    }
  }
  const out: RosterDuplicateGroup[] = [];
  for (const g of byName.values()) {
    if (g.entries.length < 2) continue;
    const seen = new Set<string>();
    let exact = false;
    for (const e of g.entries) {
      const k = `${e.division.toLowerCase().trim()}#${e.rollNo}`;
      if (seen.has(k)) exact = true;
      seen.add(k);
    }
    out.push({ kind: exact ? 'exact' : 'possible', name: g.name, entries: g.entries });
  }
  // Exact duplicates first, then by name.
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'exact' ? -1 : 1));
}

/**
 * Parse an Excel (.xlsx, .xls) File strictly from user PC
 */
export async function parseExcelOrCsvFile(file: File): Promise<MasterListSheet> {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  if (!isExcel) {
    throw new Error('Only Excel files (.xlsx or .xls) are allowed. Please upload an Excel spreadsheet.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

  if (jsonData.length === 0) {
    throw new Error('The uploaded Excel spreadsheet contains no data rows.');
  }

  const students: MasterStudent[] = [];
  const divisionSet = new Set<string>();

  jsonData.forEach((row, idx) => {
    // Flexible header resolution
    const keys = Object.keys(row);

    const nameKey = keys.find((k) =>
      /^(name|student\s*name|attendee\s*name|full\s*name)$/i.test(k.trim())
    ) || keys.find((k) => /name/i.test(k));

    const rollKey = keys.find((k) =>
      /^(roll|roll\s*no|roll\s*number|id|student\s*id|rollno)$/i.test(k.trim())
    ) || keys.find((k) => /roll/i.test(k));

    const divKey = keys.find((k) =>
      /^(division|div|section|class|batch)$/i.test(k.trim())
    ) || keys.find((k) => /div/i.test(k));

    const emailKey = keys.find((k) => /email/i.test(k));

    const rawName = nameKey ? String(row[nameKey]).trim() : '';
    const rawRoll = rollKey ? String(row[rollKey]).trim().replace(/\D/g, '') : '';
    const rawDiv = divKey ? String(row[divKey]).trim() : 'Division A';
    const rawEmail = emailKey ? String(row[emailKey]).trim() : '';

    if (rawName) {
      const rollNo = rawRoll ? parseInt(rawRoll, 10) : 100 + idx + 1;
      const division = rawDiv || 'Division A';
      divisionSet.add(division);

      students.push({
        id: `std-${Date.now()}-${idx}`,
        name: rawName,
        rollNo,
        division,
        email: rawEmail || `${rawName.toLowerCase().replace(/\s+/g, '.')}@college.edu`,
      });
    }
  });

  if (students.length === 0) {
    throw new Error('No valid student rows found. Please check columns: Name, Roll No, Division.');
  }

  const sheetName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
  const newRoster: MasterListSheet = {
    id: `roster-${Date.now()}`,
    name: sheetName || 'Uploaded Master Roster',
    fileName: file.name,
    uploadedAt: new Date().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    totalRecords: students.length,
    divisions: Array.from(divisionSet).sort(),
    students,
  };

  return newRoster;
}

/**
 * Download a starter template Excel file (.xlsx) with sample rows
 */
export function downloadExcelTemplate(): void {
  const sampleData = [
    { 'Name': 'Alice Walker', 'Roll No': 101, 'Division': 'Division A', 'Email': 'a.walker@college.edu' },
    { 'Name': 'Brian Smith', 'Roll No': 102, 'Division': 'Division A', 'Email': 'b.smith@college.edu' },
    { 'Name': 'Chloe Davies', 'Roll No': 103, 'Division': 'Division A', 'Email': 'c.davies@college.edu' },
    { 'Name': 'Daniel Miller', 'Roll No': 201, 'Division': 'Division B', 'Email': 'd.miller@college.edu' },
    { 'Name': 'Emma Watson', 'Roll No': 202, 'Division': 'Division B', 'Email': 'e.watson@college.edu' },
    { 'Name': 'Felix Patel', 'Roll No': 203, 'Division': 'Division B', 'Email': 'f.patel@college.edu' },
    { 'Name': 'Priya Sharma', 'Roll No': 301, 'Division': 'Division C', 'Email': 'p.sharma@college.edu' },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master Roster');
  XLSX.writeFile(wb, 'RollTrack_Master_Roster_Template.xlsx');
}

/**
 * Normalization helper for name matching
 */
function cleanName(str: string): string {
  return str
    .toLowerCase()
    .replace(/^(dr\.|prof\.|mr\.|ms\.|mrs\.)\s*/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matching result structure
 */
export interface DivisionMatchGroup {
  division: string;
  totalMatched: number;
  metAttendees: Attendee[];
  missedAttendees: Attendee[];
  metRolls: number[];
  missedRolls: number[];
}

export interface MatchingResult {
  roster: MasterListSheet;
  divisionGroups: Record<string, DivisionMatchGroup>;
  divisions: string[];
  matchedAttendees: Attendee[];
  unmatchedAttendees: Attendee[];
  totalMeetingAttendees: number;
  matchPercentage: number;
}

/**
 * Core Matching Algorithm:
 * Matches meeting attendees against the active master roster.
 * Groups matched students by Division with their roll numbers,
 * and collects attendees who do not match any division/roll into the unmatched group.
 */
export function matchAttendeesWithRoster(
  meetingAttendees: Attendee[],
  roster: MasterListSheet | undefined | null,
  attendanceGoalPercentage: number
): MatchingResult {
  const divisionGroups: Record<string, DivisionMatchGroup> = {};

  if (!roster) {
    return {
      roster: {
        id: 'no-roster',
        name: 'No Roster Selected',
        fileName: '',
        uploadedAt: '',
        totalRecords: 0,
        divisions: [],
        students: [],
      },
      divisionGroups: {},
      divisions: [],
      matchedAttendees: [],
      unmatchedAttendees: meetingAttendees.map((a) => ({ ...a, isMatched: false })),
      totalMeetingAttendees: meetingAttendees.length,
      matchPercentage: 0,
    };
  }

  // Initialize all divisions known in this roster
  (roster.divisions || []).forEach((div) => {
    divisionGroups[div] = {
      division: div,
      totalMatched: 0,
      metAttendees: [],
      missedAttendees: [],
      metRolls: [],
      missedRolls: [],
    };
  });

  const matchedAttendees: Attendee[] = [];
  const unmatchedAttendees: Attendee[] = [];

  meetingAttendees.forEach((att) => {
    const cleanedAttName = cleanName(att.name);

    // Look for exact match or normalized match
    let match = roster.students.find((s) => cleanName(s.name) === cleanedAttName);

    // Substring match if full name includes or is included (e.g. "Sarah Lin" in "Dr. Sarah Lin")
    if (!match) {
      match = roster.students.find((s) => {
        const cS = cleanName(s.name);
        return cleanedAttName.includes(cS) || cS.includes(cleanedAttName);
      });
    }

    if (match) {
      const division = match.division || 'Division A';
      if (!divisionGroups[division]) {
        divisionGroups[division] = {
          division,
          totalMatched: 0,
          metAttendees: [],
          missedAttendees: [],
          metRolls: [],
          missedRolls: [],
        };
      }

      const updatedAttendee: Attendee = {
        ...att,
        rollNo: match.rollNo,
        division,
        isMatched: true,
        matchedName: match.name,
      };

      matchedAttendees.push(updatedAttendee);
      divisionGroups[division].totalMatched += 1;

      if (att.presencePercentage >= attendanceGoalPercentage) {
        divisionGroups[division].metAttendees.push(updatedAttendee);
        divisionGroups[division].metRolls.push(match.rollNo);
      } else {
        divisionGroups[division].missedAttendees.push(updatedAttendee);
        divisionGroups[division].missedRolls.push(match.rollNo);
      }
    } else {
      unmatchedAttendees.push({
        ...att,
        isMatched: false,
        division: undefined,
      });
    }
  });

  // Sort roll numbers ascending in each division
  Object.values(divisionGroups).forEach((grp) => {
    grp.metRolls.sort((a, b) => a - b);
    grp.missedRolls.sort((a, b) => a - b);
  });

  const total = meetingAttendees.length;
  const matchPercentage = total > 0 ? Math.round((matchedAttendees.length / total) * 100) : 0;
  const activeDivisions = Object.keys(divisionGroups).filter(
    (div) => divisionGroups[div].totalMatched > 0 || roster.divisions.includes(div)
  );

  return {
    roster,
    divisionGroups,
    divisions: activeDivisions,
    matchedAttendees,
    unmatchedAttendees,
    totalMeetingAttendees: total,
    matchPercentage,
  };
}
