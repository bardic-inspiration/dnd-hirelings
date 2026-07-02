import { describe, it, expect } from 'vitest';
import { formatNumberShorthand, formatGold } from './format.js';

describe('formatNumberShorthand', () => {
  it('matches every example from issue #69', () => {
    expect(formatNumberShorthand(1420)).toBe('1.42K');
    expect(formatNumberShorthand(56500)).toBe('56.5K');
    expect(formatNumberShorthand(203000)).toBe('203K');
    expect(formatNumberShorthand(1250000)).toBe('1.25M');
    expect(formatNumberShorthand(13800000)).toBe('13.8M');
    expect(formatNumberShorthand(259000000)).toBe('259M');
    expect(formatNumberShorthand(6000000000)).toBe('6.00B');
    expect(formatNumberShorthand(10900000000)).toBe('10.9B');
    expect(formatNumberShorthand(994000000000)).toBe('994B');
  });

  it('renders numbers below the first tier verbatim', () => {
    expect(formatNumberShorthand(0)).toBe('0');
    expect(formatNumberShorthand(999)).toBe('999');
    expect(formatNumberShorthand(999.5)).toBe('999.5');
    expect(formatNumberShorthand(-999)).toBe('-999');
  });

  it('renders overflow past the last tier', () => {
    expect(formatNumberShorthand(1e12)).toBe('NaN');
    expect(formatNumberShorthand(999999999999)).toBe('NaN'); // carry across 1e12
    expect(formatNumberShorthand(1e15)).toBe('NaN');
  });

  it('promotes a tier when rounding carries the mantissa to 1000', () => {
    expect(formatNumberShorthand(999950)).toBe('1.00M');
    expect(formatNumberShorthand(999500)).toBe('1.00M');
    expect(formatNumberShorthand(999499)).toBe('999K');
  });

  it('re-derives precision when rounding gains an integer digit', () => {
    expect(formatNumberShorthand(9996)).toBe('10.0K');
    expect(formatNumberShorthand(99960)).toBe('100K');
  });

  it('keeps the sign on negatives', () => {
    expect(formatNumberShorthand(-1420)).toBe('-1.42K');
    expect(formatNumberShorthand(-6000000000)).toBe('-6.00B');
  });

  it('renders overflow for non-finite input', () => {
    expect(formatNumberShorthand(NaN)).toBe('NaN');
    expect(formatNumberShorthand(Infinity)).toBe('NaN');
    expect(formatNumberShorthand(-Infinity)).toBe('NaN');
  });

  it('extends by config alone (added T tier)', () => {
    const config = {
      significantFigures: 3,
      overflow: 'NaN',
      tiers: [
        { threshold: 1000, suffix: 'K' },
        { threshold: 1000000, suffix: 'M' },
        { threshold: 1000000000, suffix: 'B' },
        { threshold: 1000000000000, suffix: 'T' },
      ],
    };
    expect(formatNumberShorthand(1e12, config)).toBe('1.00T');
    expect(formatNumberShorthand(999999999999, config)).toBe('1.00T');
    expect(formatNumberShorthand(1e15, config)).toBe('NaN');
  });
});

describe('formatGold', () => {
  it('shows one decimal below the first tier', () => {
    expect(formatGold(0)).toBe('0.0');
    expect(formatGold(12.34)).toBe('12.3');
    expect(formatGold(999.9)).toBe('999.9');
  });

  it('switches to shorthand at the first tier', () => {
    expect(formatGold(1420)).toBe('1.42K');
    expect(formatGold(1420000)).toBe('1.42M');
  });

  it('renders overflow for non-finite input', () => {
    expect(formatGold(NaN)).toBe('NaN');
  });
});
