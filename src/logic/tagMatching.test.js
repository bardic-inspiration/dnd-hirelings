import { describe, it, expect } from 'vitest';
import {
  matchTagPath, parsePattern, formatPatternLabel, escapePatternSegment,
} from './tagMatching.js';

describe('parsePattern', () => {
  it('types wildcards and lowercases literals', () => {
    expect(parsePattern('Skill:*')).toEqual([
      { kind: 'literal', value: 'skill' }, { kind: 'single' },
    ]);
    expect(parsePattern('skill:**')).toEqual([
      { kind: 'literal', value: 'skill' }, { kind: 'multi' },
    ]);
  });

  it('treats escaped wildcards as literal text (asymmetry rule)', () => {
    expect(parsePattern('skill:\\*')).toEqual([
      { kind: 'literal', value: 'skill' }, { kind: 'literal', value: '*' },
    ]);
  });

  it('accepts pre-split raw segments and drops empties', () => {
    expect(parsePattern(['skill', '', 'arcana'])).toEqual([
      { kind: 'literal', value: 'skill' }, { kind: 'literal', value: 'arcana' },
    ]);
  });
});

describe('matchTagPath — exact (default)', () => {
  it('requires equal length and pairwise match, case-insensitive', () => {
    expect(matchTagPath('skill:arcana', ['skill', 'arcana'])).toBe(true);
    expect(matchTagPath('Skill:Arcana', ['skill', 'arcana'])).toBe(true);
    expect(matchTagPath('skill', ['skill', 'arcana'])).toBe(false);
    expect(matchTagPath('skill:arcana', ['skill'])).toBe(false);
  });

  it('only matches an empty path with an empty pattern', () => {
    expect(matchTagPath('', [])).toBe(true);
    expect(matchTagPath('', ['skill'])).toBe(false);
  });
});

describe('matchTagPath — numbered', () => {
  it('defaults depth to the pattern length (prefix match)', () => {
    expect(matchTagPath('skill', ['skill', 'arcana'], { mode: 'numbered' })).toBe(true);
    expect(matchTagPath('skill:arcana', ['skill'], { mode: 'numbered' })).toBe(false);
  });

  it('compares only the first `depth` segments when given', () => {
    expect(matchTagPath('skill:arcana', ['skill', 'history'], { mode: 'numbered', depth: 1 })).toBe(true);
  });
});

describe('matchTagPath — open (glob)', () => {
  it('single wildcard passes exactly one segment', () => {
    expect(matchTagPath('skill:*', ['skill', 'arcana'], { mode: 'open' })).toBe(true);
    expect(matchTagPath('skill:*', ['skill'], { mode: 'open' })).toBe(false);
  });

  it('multi wildcard passes zero or more segments', () => {
    expect(matchTagPath('skill:**', ['skill'], { mode: 'open' })).toBe(true);
    expect(matchTagPath('skill:**', ['skill', 'arcana', 'fire'], { mode: 'open' })).toBe(true);
  });

  it('supports suffix matching via a leading **', () => {
    expect(matchTagPath('**:potato', ['tag', 'potato'], { mode: 'open' })).toBe(true);
    expect(matchTagPath('**:potato', ['potato'], { mode: 'open' })).toBe(true);
    expect(matchTagPath('**:potato', ['tag', 'carrot'], { mode: 'open' })).toBe(false);
  });

  it('is identical to exact for wildcard-free patterns', () => {
    expect(matchTagPath('skill:arcana', ['skill', 'arcana'], { mode: 'open' })).toBe(true);
    expect(matchTagPath('skill', ['skill', 'arcana'], { mode: 'open' })).toBe(false);
  });

  it('never promotes an escaped asterisk to a wildcard', () => {
    expect(matchTagPath('skill:\\*', ['skill', '*'], { mode: 'open' })).toBe(true);
    expect(matchTagPath('skill:\\*', ['skill', 'arcana'], { mode: 'open' })).toBe(false);
  });
});

describe('matchTagPath — unknown mode', () => {
  it('matches nothing', () => {
    expect(matchTagPath('skill', ['skill'], { mode: 'nope' })).toBe(false);
  });
});

describe('formatPatternLabel', () => {
  it('renders wildcards as the engine reads them', () => {
    expect(formatPatternLabel('skill:*')).toBe('skill:‹any›');
    expect(formatPatternLabel('skill:**')).toBe('skill:‹any…›');
    expect(formatPatternLabel('skill:arcana')).toBe('skill:arcana');
  });
});

describe('escapePatternSegment', () => {
  it('escapes backslash, asterisk, and colon so text matches only itself', () => {
    expect(escapePatternSegment('a*b:c')).toBe('a\\*b\\:c');
    // Round-trips: an escaped segment parses back to the original literal.
    expect(parsePattern(escapePatternSegment('a*b'))).toEqual([{ kind: 'literal', value: 'a*b' }]);
  });
});
