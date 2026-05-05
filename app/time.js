// Pure clock math — no state dependencies.
// Year = 364 days (52 × 7), week = 7 days. All values 1-indexed.

export function formatClockParts(totalMinutes) {
  const totalDays = Math.floor(Math.max(0, totalMinutes || 0) / 1440);
  const year = Math.floor(totalDays / 364) + 1;
  const week = Math.floor((totalDays % 364) / 7) + 1;
  const day  = (totalDays % 7) + 1;
  return { year, week, day };
}

export function clockMinutesFromParts(year, week, day) {
  return ((year - 1) * 364 + (week - 1) * 7 + (day - 1)) * 1440;
}
