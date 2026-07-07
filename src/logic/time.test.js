import { describe, it, expect } from 'vitest';
import { formatClockParts, clockTicksFromParts, DEFAULT_CALENDAR } from './time.js';

describe('formatClockParts', () => {
  it('is 1-indexed: tick 0 is year 1, day 1', () => {
    expect(formatClockParts(0)).toEqual({ year: 1, day: 1 });
  });

  it('advances one day per tick', () => {
    expect(formatClockParts(1)).toEqual({ year: 1, day: 2 });
  });

  it('rolls to the next year after a full calendar year', () => {
    expect(formatClockParts(DEFAULT_CALENDAR.daysPerYear)).toEqual({ year: 2, day: 1 });
  });

  it('clamps negatives and non-numbers to the start', () => {
    expect(formatClockParts(-5)).toEqual({ year: 1, day: 1 });
    expect(formatClockParts(NaN)).toEqual({ year: 1, day: 1 });
  });

  it('honors a custom calendar', () => {
    const calendar = { daysPerYear: 10 };
    expect(formatClockParts(1, calendar)).toEqual({ year: 1, day: 2 });
    expect(formatClockParts(10, calendar)).toEqual({ year: 2, day: 1 });
  });
});

describe('clockTicksFromParts', () => {
  it('is the inverse of formatClockParts', () => {
    for (const [year, day] of [[1, 1], [1, 50], [2, 1], [5, 200]]) {
      expect(formatClockParts(clockTicksFromParts(year, day))).toEqual({ year, day });
    }
  });

  it('is the inverse under a custom calendar too', () => {
    const calendar = { daysPerYear: 12 };
    for (const [year, day] of [[1, 1], [1, 12], [3, 7]]) {
      expect(formatClockParts(clockTicksFromParts(year, day, calendar), calendar)).toEqual({ year, day });
    }
  });
});
