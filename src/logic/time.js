/**
 * Fallback calendar used when no clock config is supplied: how in-game minutes
 * (the clock's base unit) roll up into days and years. Runtime overrides come
 * from `public/config/clock.yml` via `normalizeClockConfig` (logic/clockConfig.js).
 *
 * @type {{ minutesPerDay: number, daysPerYear: number }}
 */
export const DEFAULT_CALENDAR = { minutesPerDay: 1440, daysPerYear: 364 };

/**
 * Converts total elapsed minutes to calendar year and day.
 * Year and day are 1-indexed (year 1, day 1 = 0 minutes).
 *
 * @param {number} totalMinutes
 * @param {{ minutesPerDay: number, daysPerYear: number }} [calendar]
 * @returns {{ year: number, day: number }}
 */
export function formatClockParts(totalMinutes, calendar = DEFAULT_CALENDAR) {
  const totalDays = Math.floor(Math.max(0, totalMinutes || 0) / calendar.minutesPerDay);
  const year = Math.floor(totalDays / calendar.daysPerYear) + 1;
  const day  = (totalDays % calendar.daysPerYear) + 1;
  return { year, day };
}

/**
 * Converts a year + day pair back to total elapsed minutes. Inverse of `formatClockParts`.
 *
 * @param {number} year - 1-indexed
 * @param {number} day - 1-indexed
 * @param {{ minutesPerDay: number, daysPerYear: number }} [calendar]
 * @returns {number} Total minutes
 */
export function clockMinutesFromParts(year, day, calendar = DEFAULT_CALENDAR) {
  return ((year - 1) * calendar.daysPerYear + (day - 1)) * calendar.minutesPerDay;
}
