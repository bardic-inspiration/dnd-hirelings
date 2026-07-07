// Calendar — a purely presentational mapping from the simulation's base time
// unit (the tick) to a human year/day label. The game loop counts ticks and
// knows nothing about calendars; only the UI converts a tick count for display.
// One tick equals one day. Runtime overrides (e.g. `daysPerYear`) come from
// `public/config/clock.yml` via `normalizeClockConfig` (logic/clockConfig.js).

/**
 * Fallback calendar used when no clock config is supplied.
 *
 * @type {{ daysPerYear: number }}
 */
export const DEFAULT_CALENDAR = { daysPerYear: 364 };

/**
 * Converts an elapsed tick count to a calendar year and day. One tick = one day.
 * Year and day are 1-indexed (tick 0 = year 1, day 1).
 *
 * @param {number} totalTicks
 * @param {{ daysPerYear: number }} [calendar]
 * @returns {{ year: number, day: number }}
 */
export function formatClockParts(totalTicks, calendar = DEFAULT_CALENDAR) {
  const days = Math.floor(Math.max(0, totalTicks || 0));
  const year = Math.floor(days / calendar.daysPerYear) + 1;
  const day  = (days % calendar.daysPerYear) + 1;
  return { year, day };
}

/**
 * Converts a year + day pair back to an elapsed tick count.
 * Inverse of `formatClockParts`.
 *
 * @param {number} year - 1-indexed
 * @param {number} day - 1-indexed
 * @param {{ daysPerYear: number }} [calendar]
 * @returns {number} Elapsed ticks
 */
export function clockTicksFromParts(year, day, calendar = DEFAULT_CALENDAR) {
  return (year - 1) * calendar.daysPerYear + (day - 1);
}
