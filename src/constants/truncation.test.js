import { describe, it, expect } from 'vitest';
import { parseTruncationConfig, TRUNCATION_CONFIG } from './truncation.js';

const VALID_YML = `
numberShorthand:
  significantFigures: 3
  exponent: { enabled: true, symbol: "e" }
  overflow: "NaN"
  tiers:
    - { threshold: 1000, suffix: "K" }
    - { threshold: 1000000, suffix: "M" }
placeholders:
  prefix: "<PRE>"
  segment: "<TAG>"
  segments: "<TAGS>"
  value: "<VAL>"
charBudget:
  fonts: { ui: 0.55 }
  minChars: 10
  components:
    tag-chip: { font: ui, allowancePx: 30, fallbackChars: 24 }
`;

describe('parseTruncationConfig', () => {
  it('parses a valid config and freezes it', () => {
    const config = parseTruncationConfig(VALID_YML);
    expect(config.numberShorthand.tiers).toHaveLength(2);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.numberShorthand.tiers[0])).toBe(true);
  });

  it('throws when a placeholder is missing', () => {
    expect(() => parseTruncationConfig(VALID_YML.replace('value: "<VAL>"', '')))
      .toThrow(/placeholders\.value/);
  });

  it('accepts an absent exponent section (disabled) and rejects a malformed one', () => {
    expect(() => parseTruncationConfig(VALID_YML.replace('exponent: { enabled: true, symbol: "e" }', '')))
      .not.toThrow();
    expect(() => parseTruncationConfig(VALID_YML.replace('symbol: "e"', 'symbol: ""')))
      .toThrow(/exponent\.symbol/);
    expect(() => parseTruncationConfig(VALID_YML.replace('enabled: true', 'enabled: 1')))
      .toThrow(/exponent\.enabled/);
  });

  it('throws when tiers are not strictly ascending', () => {
    expect(() => parseTruncationConfig(VALID_YML.replace('threshold: 1000000', 'threshold: 500')))
      .toThrow(/ascending/);
  });

  it('throws when tiers are empty', () => {
    const noTiers = VALID_YML
      .replace(/tiers:[\s\S]*?placeholders:/, 'tiers: []\nplaceholders:');
    expect(() => parseTruncationConfig(noTiers)).toThrow(/tiers/);
  });

  it('throws when a component references an undeclared font', () => {
    expect(() => parseTruncationConfig(VALID_YML.replace('{ font: ui, allowancePx', '{ font: mono, allowancePx')))
      .toThrow(/undeclared font/);
  });
});

describe('TRUNCATION_CONFIG (bundled config/truncation.yml)', () => {
  it('loads and validates at module init', () => {
    expect(TRUNCATION_CONFIG.numberShorthand.tiers.map(tier => tier.suffix)).toEqual(['K', 'M', 'B']);
    expect(TRUNCATION_CONFIG.placeholders.segments).toBe('<TAGS>');
    expect(TRUNCATION_CONFIG.charBudget.components['tag-chip'].fallbackChars).toBeGreaterThan(0);
  });
});
