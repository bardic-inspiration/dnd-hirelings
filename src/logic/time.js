export const DAYS_PER_YEAR = 364;

/**
 * Converts total elapsed minutes to calendar year and day.
 * Year and day are 1-indexed (year 1, day 1 = 0 minutes).
 *
 * @param {number} totalMinutes
 * @returns {{ year: number, day: number }}
 */
export function formatClockParts(totalMinutes) {
  const totalDays = Math.floor(Math.max(0, totalMinutes || 0) / 1440);
  const year = Math.floor(totalDays / DAYS_PER_YEAR) + 1;
  const day  = (totalDays % DAYS_PER_YEAR) + 1;
  return { year, day };
}

/**
 * Converts a year + day pair back to total elapsed minutes. Inverse of `formatClockParts`.
 *
 * @param {number} year - 1-indexed
 * @param {number} day - 1-indexed
 * @returns {number} Total minutes
 */
export function clockMinutesFromParts(year, day) {
  return ((year - 1) * DAYS_PER_YEAR + (day - 1)) * 1440;
}
