/**
 * Date helpers. Everything here works in the user's LOCAL time zone.
 *
 * Meeting dates used to be built with `toISOString()`, which is UTC: in India
 * a meeting held between 12:00 am and 5:30 am IST was filed under yesterday.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for a Date (or timestamp) in local time. */
export function toLocalDateStr(d: Date | number = new Date()): string {
  const date = typeof d === 'number' ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface CalendarCell {
  day: number;
  dateStr: string;
  inMonth: boolean;
  isToday: boolean;
}

/**
 * Cells for a month grid (Sunday first), padded with the neighbouring months'
 * days so every row has 7 cells. `today` is a parameter so it can be tested.
 */
export function buildMonthCells(year: number, month: number, today: Date = new Date()): CalendarCell[] {
  const todayStr = toLocalDateStr(today);
  const first = new Date(year, month, 1);
  const lead = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(year, month, 1 - lead + i);
    const dateStr = toLocalDateStr(d);
    cells.push({
      day: d.getDate(),
      dateStr,
      inMonth: d.getMonth() === month,
      isToday: dateStr === todayStr,
    });
  }
  return cells;
}

/** "September 2026" */
export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}
