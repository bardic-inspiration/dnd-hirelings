import { describe, it, expect } from 'vitest';
import { formatNumberShorthand, formatGold, formatCount } from './format.js';

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

  it('renders exponent notation past the last tier', () => {
    expect(formatNumberShorthand(7800000000000)).toBe('7.80e12');
    expect(formatNumberShorthand(1e12)).toBe('1.00e12');
    expect(formatNumberShorthand(999999999999)).toBe('1.00e12'); // carry across 1e12
    expect(formatNumberShorthand(1e15)).toBe('1.00e15');
    expect(formatNumberShorthand(9996000000000)).toBe('1.00e13'); // rounding carry inside exponent
    expect(formatNumberShorthand(-7800000000000)).toBe('-7.80e12');
    expect(formatNumberShorthand(1.5e300)).toBe('1.50e300');
  });

  it('renders overflow past the last tier when exponent is disabled or absent', () => {
    const disabled = {
      significantFigures: 3,
      exponent: { enabled: false, symbol: 'e' },
      overflow: 'NaN',
      tiers: [{ threshold: 1000, suffix: 'K' }],
    };
    expect(formatNumberShorthand(1e12, disabled)).toBe('NaN');
    const { exponent, ...absent } = disabled;
    expect(formatNumberShorthand(1e12, absent)).toBe('NaN');
    expect(formatNumberShorthand(999.9, disabled)).toBe('999.9'); // below-tier path unaffected
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

  it('renders overflow for anything that is not a number', () => {
    expect(formatNumberShorthand(null)).toBe('NaN');
    expect(formatNumberShorthand(undefined)).toBe('NaN');
    expect(formatNumberShorthand('1420')).toBe('NaN'); // no silent coercion
    expect(formatNumberShorthand({})).toBe('NaN');
  });

  it('extends by config alone (added T tier, no exponent section)', () => {
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

  it('extends by config alone (T and Q tiers, exponent past Q)', () => {
    const config = {
      significantFigures: 3,
      exponent: { enabled: true, symbol: 'e' },
      overflow: 'NaN',
      tiers: [
        { threshold: 1000, suffix: 'K' },
        { threshold: 1000000, suffix: 'M' },
        { threshold: 1000000000, suffix: 'B' },
        { threshold: 1000000000000, suffix: 'T' },
        { threshold: 1000000000000000, suffix: 'Q' },
      ],
    };
    expect(formatNumberShorthand(1e12, config)).toBe('1.00T');
    expect(formatNumberShorthand(56500000000000, config)).toBe('56.5T');
    expect(formatNumberShorthand(7800000000000000, config)).toBe('7.80Q');
    expect(formatNumberShorthand(994000000000000000, config)).toBe('994Q');
    expect(formatNumberShorthand(1e18, config)).toBe('1.00e18'); // mantissa carries past Q → exponent
    expect(formatNumberShorthand(1e21, config)).toBe('1.00e21');
  });

  it('tunes precision by config alone (significantFigures)', () => {
    const withPrecision = (significantFigures) => ({
      significantFigures,
      exponent: { enabled: true, symbol: 'e' },
      overflow: 'NaN',
      tiers: [{ threshold: 1000, suffix: 'K' }, { threshold: 1000000, suffix: 'M' }],
    });
    expect(formatNumberShorthand(1456000)).toBe('1.46M');                   // bundled default (3)
    expect(formatNumberShorthand(1456000, withPrecision(4))).toBe('1.456M');
    expect(formatNumberShorthand(1456000, withPrecision(2))).toBe('1.5M');
    expect(formatNumberShorthand(203000, withPrecision(4))).toBe('203.0K'); // significant figures, not fixed decimals
    expect(formatNumberShorthand(203000, withPrecision(2))).toBe('203K');   // integer digits are never dropped
    expect(formatNumberShorthand(7800000000000, withPrecision(4))).toBe('7.800e12'); // exponent inherits precision
    expect(formatNumberShorthand(7800000000000, withPrecision(2))).toBe('7.8e12');
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
    expect(formatGold(7800000000000)).toBe('7.80e12');
  });

  it('renders overflow for non-finite and non-number input', () => {
    expect(formatGold(NaN)).toBe('NaN');
    expect(formatGold(undefined)).toBe('NaN');
  });
});

describe('formatCount', () => {
  it('leaves small numbers untouched and shortens large ones', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(42)).toBe('42');
    expect(formatCount(1.5)).toBe('1.5');
    expect(formatCount(1420)).toBe('1.42K');
    expect(formatCount(2500000)).toBe('2.50M');
  });

  it('accepts numeric strings (editable-span display path)', () => {
    expect(formatCount('999')).toBe('999');
    expect(formatCount('1420')).toBe('1.42K');
    expect(formatCount('12.34')).toBe('12.34');
  });

  it('passes empty and non-numeric strings through unchanged', () => {
    expect(formatCount('')).toBe('');
    expect(formatCount('abc')).toBe('abc');
  });
});
