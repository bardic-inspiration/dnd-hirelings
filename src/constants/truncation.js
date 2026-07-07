// Build-time loader for config/truncation.yml — the contract every module of
// the text display library (logic/format.js, logic/truncation.js,
// hooks/useCharBudget.js) reads from. The YAML is inlined by Vite's `?raw`
// import, so parsing happens once at module init with no fetch or async state.
import yaml from 'js-yaml';
import truncationYml from '../../config/truncation.yml?raw';

/** Recursively freezes an object so the shared config cannot be mutated. */
function deepFreeze(object) {
  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(object);
}

function assert(condition, message) {
  if (!condition) throw new Error(`truncation.yml: ${message}`);
}

/**
 * Parses and validates a truncation-library YAML config string.
 *
 * Validates that shorthand tiers are non-empty and strictly ascending, all
 * four placeholder strings are present, font ratios are positive, and every
 * char-budget component entry is complete and references a declared font.
 * The config file is developer-controlled build input, not user data, so
 * failures throw a descriptive Error at module init (fail fast).
 *
 * @param {string} ymlText - Raw YAML text of a truncation config
 * @returns {object} Deep-frozen config `{ numberShorthand, placeholders, charBudget }`
 */
export function parseTruncationConfig(ymlText) {
  const config = yaml.load(ymlText);
  assert(config && typeof config === 'object', 'root must be a mapping');

  const { numberShorthand, placeholders, charBudget } = config;

  assert(numberShorthand, 'missing numberShorthand section');
  assert(Number.isInteger(numberShorthand.significantFigures) && numberShorthand.significantFigures > 0,
    'numberShorthand.significantFigures must be a positive integer');
  assert(typeof numberShorthand.overflow === 'string', 'numberShorthand.overflow must be a string');
  if (numberShorthand.exponent !== undefined) {
    // Optional section: absent means exponent notation is disabled and
    // past-the-table values render `overflow` (the pre-exponent behavior).
    assert(numberShorthand.exponent && typeof numberShorthand.exponent === 'object',
      'numberShorthand.exponent must be a mapping');
    assert(typeof numberShorthand.exponent.enabled === 'boolean',
      'numberShorthand.exponent.enabled must be a boolean');
    assert(typeof numberShorthand.exponent.symbol === 'string' && numberShorthand.exponent.symbol.length > 0,
      'numberShorthand.exponent.symbol must be a non-empty string');
  }
  assert(Array.isArray(numberShorthand.tiers) && numberShorthand.tiers.length > 0,
    'numberShorthand.tiers must be a non-empty list');
  numberShorthand.tiers.forEach((tier, index) => {
    assert(Number.isFinite(tier.threshold) && tier.threshold > 0,
      `tier ${index} threshold must be a positive number`);
    assert(typeof tier.suffix === 'string' && tier.suffix.length > 0,
      `tier ${index} suffix must be a non-empty string`);
    assert(index === 0 || tier.threshold > numberShorthand.tiers[index - 1].threshold,
      'tier thresholds must be strictly ascending');
  });

  assert(placeholders, 'missing placeholders section');
  for (const key of ['prefix', 'segment', 'segments', 'value']) {
    assert(typeof placeholders[key] === 'string' && placeholders[key].length > 0,
      `placeholders.${key} must be a non-empty string`);
  }

  assert(charBudget, 'missing charBudget section');
  assert(charBudget.fonts && typeof charBudget.fonts === 'object', 'charBudget.fonts must be a mapping');
  for (const [font, ratio] of Object.entries(charBudget.fonts)) {
    assert(Number.isFinite(ratio) && ratio > 0, `charBudget.fonts.${font} must be a positive number`);
  }
  assert(Number.isInteger(charBudget.minChars) && charBudget.minChars > 0,
    'charBudget.minChars must be a positive integer');
  assert(charBudget.components && typeof charBudget.components === 'object',
    'charBudget.components must be a mapping');
  for (const [component, entry] of Object.entries(charBudget.components)) {
    assert(entry.font in charBudget.fonts,
      `charBudget.components.${component}.font references undeclared font "${entry.font}"`);
    assert(Number.isFinite(entry.allowancePx) && entry.allowancePx >= 0,
      `charBudget.components.${component}.allowancePx must be a non-negative number`);
    assert(Number.isInteger(entry.fallbackChars) && entry.fallbackChars > 0,
      `charBudget.components.${component}.fallbackChars must be a positive integer`);
    if (entry.minChars !== undefined) {
      assert(Number.isInteger(entry.minChars) && entry.minChars > 0,
        `charBudget.components.${component}.minChars must be a positive integer`);
    }
  }

  return deepFreeze(config);
}

/** The app-wide truncation/format configuration, parsed once at module init. */
export const TRUNCATION_CONFIG = parseTruncationConfig(truncationYml);
