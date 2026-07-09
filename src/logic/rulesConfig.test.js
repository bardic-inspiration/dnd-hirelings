import { describe, it, expect } from 'vitest';
import { normalizeRulesConfig, DEFAULT_RULES_CONFIG } from './rulesConfig.js';

describe('normalizeRulesConfig', () => {
  it('strips the bracket envelope and keeps valid expressions', () => {
    const { dynamic } = normalizeRulesConfig({
      dynamic: {
        ac: '[10+floor(({ability:dex}-10)/2)]',
        level: '[max(1, floor(0.5*(1+sqrt(1+{xp}/125))))]',
      },
    });
    expect(dynamic.ac).toEqual({ expression: '10+floor(({ability:dex}-10)/2)', error: null });
    expect(dynamic.level.error).toBeNull();
  });

  it('flags entries missing the envelope', () => {
    const { dynamic } = normalizeRulesConfig({ dynamic: { ac: '10+{ability:dex}' } });
    expect(dynamic.ac.expression).toBeNull();
    expect(dynamic.ac.error).toMatch(/wrapped in \[brackets\]/);
  });

  it('flags entries whose inner expression fails to parse', () => {
    const { dynamic } = normalizeRulesConfig({ dynamic: { ac: '[1+]' } });
    expect(dynamic.ac.expression).toBeNull();
    expect(dynamic.ac.error).toMatch(/unexpected end/);
  });

  it('flags non-string entries and lowercases address keys', () => {
    const { dynamic } = normalizeRulesConfig({ dynamic: { 'HP-Max': '[1]', bad: { nested: true } } });
    expect(dynamic['hp-max']).toEqual({ expression: '1', error: null });
    expect(dynamic.bad.error).toMatch(/expected/);
  });

  it('degrades malformed documents to no rules', () => {
    expect(normalizeRulesConfig(null)).toEqual({ dynamic: {} });
    expect(normalizeRulesConfig({ dynamic: [1, 2] })).toEqual({ dynamic: {} });
    expect(normalizeRulesConfig('scalar')).toEqual({ dynamic: {} });
  });

  it('ships an empty default', () => {
    expect(DEFAULT_RULES_CONFIG).toEqual({ dynamic: {} });
  });
});
