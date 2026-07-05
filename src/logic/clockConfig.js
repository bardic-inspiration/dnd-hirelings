// Clock config — expresses game time as the relationship between three layers:
//
//   calendar   how in-game minutes (the clock's base unit) roll up into days
//              and years; minutes stay the base unit for future granularity
//   timeStep   bounds on the per-tick step (in days) the TopBar hold-drag edits
//   realTime   wall-clock pacing: milliseconds of real time per stepped day,
//              floored at a minimum tick interval
//
// The shipped defaults live in `public/config/clock.yml`; this module owns the
// schema, the defaults, and the normalizer that guards a raw fetched document.

import { DEFAULT_CALENDAR } from './time.js';

/**
 * Fallback clock configuration used by pure logic functions when no document
 * is supplied (keeps `advanceTime` etc. callable without React context).
 *
 * @type {{ calendar: { minutesPerDay: number, daysPerYear: number },
 *   timeStep: { min: number, max: number },
 *   rateMultiplier: { min: number, max: number },
 *   realTime: { msPerStepDay: number, minTickIntervalMs: number } }}
 */
export const DEFAULT_CLOCK_CONFIG = Object.freeze({
  calendar: Object.freeze({ ...DEFAULT_CALENDAR }),
  timeStep: Object.freeze({ min: 1, max: 364 }),
  rateMultiplier: Object.freeze({ min: 0.1, max: 100 }),
  realTime: Object.freeze({ msPerStepDay: 1000, minTickIntervalMs: 16 }),
});

/**
 * Config-editor schema for `public/config/clock.yml` (see logic/configEditor.js
 * for the descriptor grammar).
 */
export const CLOCK_SCHEMA = {
  kind: 'map',
  closed: true,
  keys: {
    calendar: {
      kind: 'map',
      closed: true,
      keys: {
        minutesPerDay: { kind: 'scalar', value: 'number', min: 1, label: 'MINUTES / DAY' },
        daysPerYear:   { kind: 'scalar', value: 'number', min: 1, label: 'DAYS / YEAR' },
      },
    },
    timeStep: {
      kind: 'map',
      closed: true,
      keys: {
        min: { kind: 'scalar', value: 'number', min: 1, label: 'STEP MIN (DAYS)' },
        max: { kind: 'scalar', value: 'number', min: 1, label: 'STEP MAX (DAYS)' },
      },
    },
    rateMultiplier: {
      kind: 'map',
      closed: true,
      keys: {
        min: { kind: 'scalar', value: 'number', min: 0.1, step: 0.1, label: 'RATE MIN' },
        max: { kind: 'scalar', value: 'number', min: 0.1, step: 0.1, label: 'RATE MAX' },
      },
    },
    realTime: {
      kind: 'map',
      closed: true,
      keys: {
        msPerStepDay:      { kind: 'scalar', value: 'number', min: 1, label: 'MS / STEP DAY' },
        minTickIntervalMs: { kind: 'scalar', value: 'number', min: 1, label: 'MIN TICK MS' },
      },
    },
  },
};

// Reads one positive finite number off a raw section, else the default.
function positiveNumber(raw, fallback, minimum = 0) {
  const value = Number(raw);
  return Number.isFinite(value) && value > minimum ? value : fallback;
}

// Guards one { min, max } bounds section: both positive, min <= max.
function normalizeBounds(raw, defaults) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const min = positiveNumber(source.min, defaults.min);
  const max = positiveNumber(source.max, defaults.max);
  return max >= min ? { min, max } : { ...defaults };
}

/**
 * Guards a raw clock config document (from fetch, overlay, or storage).
 * Missing or malformed fields fall back per-field to `DEFAULT_CLOCK_CONFIG`;
 * a bounds pair with `min > max` reverts wholesale. Lenient — never throws.
 *
 * @param {object} doc - Raw document from `yaml.load` (may be `null`/partial)
 * @returns {typeof DEFAULT_CLOCK_CONFIG} A fully-populated clock config
 */
export function normalizeClockConfig(doc) {
  const source = doc && typeof doc === 'object' ? doc : {};
  const calendar = source.calendar && typeof source.calendar === 'object' ? source.calendar : {};
  const realTime = source.realTime && typeof source.realTime === 'object' ? source.realTime : {};
  return {
    calendar: {
      minutesPerDay: positiveNumber(calendar.minutesPerDay, DEFAULT_CALENDAR.minutesPerDay),
      daysPerYear:   positiveNumber(calendar.daysPerYear, DEFAULT_CALENDAR.daysPerYear),
    },
    timeStep:       normalizeBounds(source.timeStep, DEFAULT_CLOCK_CONFIG.timeStep),
    rateMultiplier: normalizeBounds(source.rateMultiplier, DEFAULT_CLOCK_CONFIG.rateMultiplier),
    realTime: {
      msPerStepDay:      positiveNumber(realTime.msPerStepDay, DEFAULT_CLOCK_CONFIG.realTime.msPerStepDay),
      minTickIntervalMs: positiveNumber(realTime.minTickIntervalMs, DEFAULT_CLOCK_CONFIG.realTime.minTickIntervalMs),
    },
  };
}
