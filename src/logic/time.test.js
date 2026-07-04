import { describe, it, expect } from 'vitest';
import { formatClockParts, clockMinutesFromParts, DAYS_PER_YEAR } from './time.js';

describe('formatClockParts', () => {
  it('is 1-indexed: 0 minutes is year 1, day 1', () => {
    expect(formatClockParts(0)).toEqual({ year: 1, day: 1 });
  });

  it('advances one day per 1440 minutes', () => {
    expect(formatClockParts(1440)).toEqual({ year: 1, day: 2 });
  });

  it('rolls to the next year after a full calendar year', () => {
    expect(formatClockParts(DAYS_PER_YEAR * 1440)).toEqual({ year: 2, day: 1 });
  });

  it('clamps negatives and non-numbers to the start', () => {
    expect(formatClockParts(-5000)).toEqual({ year: 1, day: 1 });
    expect(formatClockParts(NaN)).toEqual({ year: 1, day: 1 });
  });
});

describe('clockMinutesFromParts', () => {
  it('is the inverse of formatClockParts', () => {
    for (const [year, day] of [[1, 1], [1, 50], [2, 1], [5, 200]]) {
      expect(formatClockParts(clockMinutesFromParts(year, day))).toEqual({ year, day });
    }
  });
});
