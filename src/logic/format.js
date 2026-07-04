// Number formatting for the text display library. Pure functions; the
// shorthand table comes from config/truncation.yml (see constants/truncation.js)
// and is injectable per call so tests can exercise alternate tables.
import { TRUNCATION_CONFIG } from '../constants/truncation.js';

/**
 * Formats a number with the table-driven significant-figure shorthand
 * (1.42K, 56.5K, 203K, 1.25M, …, 994B). Numbers below the first tier render
 * as `String(value)`. Rounding that carries a mantissa to 1000 promotes the
 * number one tier (999950 → "1.00M"). Past the last tier, order-of-magnitude
 * notation takes over when `config.exponent` is enabled (7.8e12 → "7.80e12",
 * covering every representable number); otherwise — and for any input that
 * is not a finite number (NaN, ±Infinity, non-numbers, failed parses) —
 * `config.overflow` ("NaN") renders as the safeguard of last resort.
 * Negatives keep their sign. No side effects.
 *
 * @param {number} value - Number to format
 * @param {object} [config=TRUNCATION_CONFIG.numberShorthand] - Shorthand table
 *   `{ significantFigures, exponent?, overflow, tiers: [{ threshold, suffix }] }`
 * @returns {string}
 */
export function formatNumberShorthand(value, config = TRUNCATION_CONFIG.numberShorthand) {
  const { significantFigures, exponent, overflow, tiers } = config;
  if (!Number.isFinite(value)) return overflow;
  const magnitude = Math.abs(value);
  if (magnitude < tiers[0].threshold) return String(value);
  const sign = value < 0 ? '-' : '';

  let tierIndex = tiers.findLastIndex(tier => magnitude >= tier.threshold);
  while (tierIndex < tiers.length) {
    const mantissa = magnitude / tiers[tierIndex].threshold;
    const integerDigits = String(Math.floor(mantissa)).length;
    let decimals = Math.max(0, significantFigures - integerDigits);
    let rendered = mantissa.toFixed(decimals);
    // Rounding can add an integer digit (9.996 → "10.00"); re-derive the
    // precision from the rounded result so significant figures hold.
    const renderedDigits = String(Math.trunc(Number(rendered))).length;
    if (renderedDigits > integerDigits) {
      decimals = Math.max(0, significantFigures - renderedDigits);
      rendered = mantissa.toFixed(decimals);
    }
    if (Number(rendered) < 1000) return `${sign}${rendered}${tiers[tierIndex].suffix}`;
    tierIndex += 1;
  }

  // Past the tier table. The exponent mantissa always has one integer digit,
  // so `significantFigures - 1` decimals holds the table's precision; JS
  // renders "7.80e+12" — swap "e+" for the configured symbol.
  if (exponent?.enabled) {
    return value.toExponential(significantFigures - 1).replace('e+', exponent.symbol);
  }
  return overflow;
}

/**
 * Compact display for an arbitrary count/stat number that may spill its UI slot
 * (issue #93). Numeric input renders through `formatNumberShorthand` (so large
 * values collapse to `1.42K` / `7.80e12` and small ones are untouched); an empty
 * or non-numeric string passes through unchanged so editable spans keep showing
 * their raw text (e.g. a placeholder or a half-typed value). No side effects.
 *
 * @param {number|string} value - Number, or a string that may parse to one
 * @param {object} [config=TRUNCATION_CONFIG.numberShorthand] - Shorthand table
 * @returns {string}
 */
export function formatCount(value, config = TRUNCATION_CONFIG.numberShorthand) {
  if (value === '' || value === null || value === undefined) return String(value ?? '');
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? formatNumberShorthand(number, config) : String(value);
}

/**
 * Formats a gold amount: one decimal place below the first shorthand tier
 * (matching the bank's historical `toFixed(1)` display), shorthand at or
 * above it. Non-finite input renders `config.overflow`. No side effects.
 *
 * @param {number} value - Gold amount
 * @param {object} [config=TRUNCATION_CONFIG.numberShorthand] - Shorthand table
 * @returns {string}
 */
export function formatGold(value, config = TRUNCATION_CONFIG.numberShorthand) {
  if (!Number.isFinite(value)) return config.overflow;
  if (Math.abs(value) < config.tiers[0].threshold) return value.toFixed(1);
  return formatNumberShorthand(value, config);
}
