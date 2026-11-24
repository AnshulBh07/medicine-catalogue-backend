import { AppError } from './errors/app-error.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface CalendarDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Extracts year, month (1-12), and day (1-31) in India Standard Time (IST, UTC+05:30).
 */
export const getIstDateParts = (date: Date = new Date()): CalendarDateParts => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
  };
};

/**
 * Formats a Date instant as YYYY-MM-DD in India Standard Time (IST, UTC+05:30).
 */
export const getIstDateString = (date: Date = new Date()): string => {
  const { year, month, day } = getIstDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/**
 * Validates that a YYYY-MM-DD string represents a real calendar date (no rollover like 2026-02-31).
 */
export const isValidCalendarDateString = (dateStr: string): boolean => {
  if (!DATE_ONLY_REGEX.test(dateStr)) return false;
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

/**
 * Parses a validated YYYY-MM-DD business date into UTC midnight (matching PostgreSQL @db.Date).
 */
export const parseDateOnlyToUtc = (dateStr: string): Date => {
  if (!isValidCalendarDateString(dateStr)) {
    throw new AppError(400, 'INVALID_DATE', `Invalid calendar date: ${dateStr}`);
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  return new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
};

/**
 * Adds calendar months to a date-only (year, month, day) while clamping to the last valid
 * day of the target month (e.g., Dec 31 + 2 months -> Feb 28/29, never Mar 3).
 */
export const addCalendarMonthsUtc = (
  year: number,
  month: number,
  day: number,
  monthsToAdd: number,
): Date => {
  const totalMonths = (year * 12 + (month - 1)) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12; // 0-11
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonthIndex, clampedDay));
};

/**
 * Formats a UTC midnight @db.Date as "DD Mon YYYY" without local-timezone shifting.
 */
export const formatDateOnlyUtc = (date: Date): string => {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = SHORT_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
};

/**
 * Formats a UTC midnight @db.Date as "YYYY-MM-DD".
 */
export const formatDateOnlyIsoUtc = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
