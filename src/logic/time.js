export const DAYS_PER_YEAR = 364;

export function formatClockParts(totalMinutes) {
  const totalDays = Math.floor(Math.max(0, totalMinutes || 0) / 1440);
  const year = Math.floor(totalDays / DAYS_PER_YEAR) + 1;
  const day  = (totalDays % DAYS_PER_YEAR) + 1;
  return { year, day };
}

export function clockMinutesFromParts(year, day) {
  return ((year - 1) * DAYS_PER_YEAR + (day - 1)) * 1440;
}
