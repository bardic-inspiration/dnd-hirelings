import { describe, it, expect } from 'vitest';
import { formatClockParts, clockMinutesFromParts, DEFAULT_CALENDAR } from './time.js';

describe('formatClockParts', () => {
  it('is 1-indexed: 0 minutes is year 1, day 1', () => {
    expect(formatClockParts(0)).toEqual({ year: 1, day: 1 });
  });

  it('advances one day per 1440 minutes', () => {
    expect(formatClockParts(1440)).toEqual({ year: 1, day: 2 });
  });

  it('rolls to the next year after a full calendar year', () => {
    expect(formatClockParts(DEFAULT_CALENDAR.daysPerYear * 1440)).toEqual({ year: 2, day: 1 });
  });

  it('clamps negatives and non-numbers to the start', () => {
    expect(formatClockParts(-5000)).toEqual({ year: 1, day: 1 });
    expect(formatClockParts(NaN)).toEqual({ year: 1, day: 1 });
  });

  it('honors a custom calendar', () => {
    const calendar = { minutesPerDay: 100, daysPerYear: 10 };
    expect(formatClockParts(100, calendar)).toEqual({ year: 1, day: 2 });
    expect(formatClockParts(1000, calendar)).toEqual({ year: 2, day: 1 });
  });
});

describe('clockMinutesFromParts', () => {
  it('is the inverse of formatClockParts', () => {
    for (const [year, day] of [[1, 1], [1, 50], [2, 1], [5, 200]]) {
      expect(formatClockParts(clockMinutesFromParts(year, day))).toEqual({ year, day });
    }
  });

  it('is the inverse under a custom calendar too', () => {
    const calendar = { minutesPerDay: 60, daysPerYear: 12 };
    for (const [year, day] of [[1, 1], [1, 12], [3, 7]]) {
      expect(formatClockParts(clockMinutesFromParts(year, day, calendar), calendar)).toEqual({ year, day });
    }
  });
});
