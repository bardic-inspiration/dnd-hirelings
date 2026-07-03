import { describe, it, expect } from 'vitest';
import { parseTag } from './tags.js';
import { computeCharBudget, truncateMiddle, truncateEnd, truncateTagParts } from './truncation.js';

describe('computeCharBudget', () => {
  const base = { fontSizePx: 9, charWidthRatio: 0.55, allowancePx: 30, minChars: 10, fallbackChars: 24 };

  it('derives whole characters from width, font size, and ratio', () => {
    expect(computeCharBudget({ ...base, widthPx: 200 })).toBe(34); // floor(170 / 4.95)
  });

  it('clamps to minChars when the container is very narrow', () => {
    expect(computeCharBudget({ ...base, widthPx: 40 })).toBe(10);
  });

  it('falls back when the measurement is unusable', () => {
    expect(computeCharBudget({ ...base, widthPx: 0 })).toBe(24);
    expect(computeCharBudget({ ...base, widthPx: 200, fontSizePx: 0 })).toBe(24);
  });
});

describe('truncateMiddle', () => {
  it('returns fitting text unchanged', () => {
    expect(truncateMiddle('short', 10)).toEqual({ text: 'short', truncated: false });
    expect(truncateMiddle('exact', 5)).toEqual({ text: 'exact', truncated: false });
    expect(truncateMiddle('anything', Infinity).truncated).toBe(false);
  });

  it('keeps head and tail around a single ellipsis', () => {
    expect(truncateMiddle('abcdefghij', 5)).toEqual({ text: 'ab…ij', truncated: true });
    expect(truncateMiddle('abcdefghij', 4)).toEqual({ text: 'ab…j', truncated: true });
  });

  it('degrades to a bare ellipsis at tiny budgets', () => {
    expect(truncateMiddle('abcdef', 1)).toEqual({ text: '…', truncated: true });
    expect(truncateMiddle('abcdef', 0)).toEqual({ text: '…', truncated: true });
  });
});

describe('truncateEnd', () => {
  it('returns fitting text unchanged', () => {
    expect(truncateEnd('short', 10)).toEqual({ text: 'short', truncated: false });
    expect(truncateEnd('exact', 5)).toEqual({ text: 'exact', truncated: false });
    expect(truncateEnd('anything', Infinity).truncated).toBe(false);
  });

  it('keeps the leading characters and marks the dropped tail (issue example)', () => {
    expect(truncateEnd('Very-long-name-mephistopheles', 24))
      .toEqual({ text: 'Very-long-name-mephisto…', truncated: true });
  });

  it('degrades to a bare ellipsis at tiny budgets', () => {
    expect(truncateEnd('abcdef', 1)).toEqual({ text: '…', truncated: true });
    expect(truncateEnd('abcdef', 0)).toEqual({ text: '…', truncated: true });
  });
});

describe('truncateTagParts', () => {
  const LONG_TAG = 'req,skill:farming:planting:potatoes:russets:big-idaho-russet=150';

  it('renders fully when it fits', () => {
    const result = truncateTagParts(parseTag('skill:arcana=3'), 40);
    expect(result.text).toBe('skill:arcana=3');
    expect(result.truncated).toBe(false);
    expect(result.valueShortened).toBe(false);
  });

  it('renders fully with no budget (Infinity default)', () => {
    expect(truncateTagParts(parseTag(LONG_TAG)).text)
      .toBe('req,skill:farming:planting:potatoes:russets:big-idaho-russet=150');
  });

  it('collapses one omitted segment to the singular placeholder', () => {
    const result = truncateTagParts(parseTag('skill:farming:planting=150'), 24);
    expect(result.text).toBe('skill:farming:<TAG>=150');
    expect(result.truncated).toBe(true);
  });

  it('collapses a run of omitted segments to the plural placeholder (issue example)', () => {
    const result = truncateTagParts(parseTag(LONG_TAG), 20);
    expect(result.text).toBe('req,skill:<TAGS>=150');
    expect(result.truncated).toBe(true);
  });

  it('keeps as many leading segments as fit', () => {
    const result = truncateTagParts(parseTag(LONG_TAG), 28);
    expect(result.text).toBe('req,skill:farming:<TAGS>=150');
  });

  it('replaces overlong mandatory elements with typed placeholders', () => {
    const pathological = 'a-very-long-prefix,a-very-long-string-that-is-too-long-to-display:other-really-long-tags=some-very-long-textual-value';
    const result = truncateTagParts(parseTag(pathological), 24, { shorthand: false });
    expect(result.text).toBe('<PRE>,<TAG>:<TAG>=<VAL>');
    expect(result.truncated).toBe(true);
  });

  it('returns the floor form even when it exceeds the budget', () => {
    const pathological = 'a-very-long-prefix,segment-one:segment-two:segment-three=a-very-long-value-string';
    const result = truncateTagParts(parseTag(pathological), 5, { shorthand: false });
    expect(result.text).toBe('<PRE>,<TAG>:<TAGS>=<VAL>');
    expect(result.truncated).toBe(true);
  });

  it('shorthands numeric values and flags the change', () => {
    const result = truncateTagParts(parseTag('skill:farming=1250000'), Infinity);
    expect(result.text).toBe('skill:farming=1.25M');
    expect(result.valueShortened).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('renders exponent shorthand for values past the last tier', () => {
    const result = truncateTagParts(parseTag('skill=10000000000000000000000000000000'), Infinity);
    expect(result.text).toBe('skill=1.00e31');
    expect(result.valueShortened).toBe(true);
  });

  it('renders the overflow safeguard for values that parse beyond number range', () => {
    const result = truncateTagParts(parseTag('skill=1e500'), Infinity);
    expect(result.text).toBe('skill=NaN');
    expect(result.valueShortened).toBe(true);
  });

  it('leaves non-numeric values as literal text', () => {
    const result = truncateTagParts(parseTag('bind:weapon=longsword'), Infinity);
    expect(result.text).toBe('bind:weapon=longsword');
    expect(result.valueShortened).toBe(false);
  });

  it('leaves numeric values alone when shorthand is off', () => {
    const result = truncateTagParts(parseTag('skill=1250000'), Infinity, { shorthand: false });
    expect(result.text).toBe('skill=1250000');
    expect(result.valueShortened).toBe(false);
  });

  it('handles tags without modifier or value', () => {
    expect(truncateTagParts(parseTag('skill:farming:planting'), 12).text).toBe('skill:<TAGS>');
    expect(truncateTagParts(parseTag('skill'), 10).text).toBe('skill');
  });

  it('emits typed parts in render order', () => {
    const result = truncateTagParts(parseTag(LONG_TAG), 20);
    expect(result.parts.map(part => part.kind)).toEqual(
      ['modifier', 'separator', 'segment', 'separator', 'placeholder', 'separator', 'value'],
    );
    expect(result.parts.find(part => part.kind === 'placeholder').placeholder).toBe('segments');
  });

  it('renders the row variant with pretty uppercase and registry prefixes', () => {
    const full = truncateTagParts(parseTag('req,skill:animal_handling=150'), Infinity, { variant: 'row' });
    expect(full.text).toBe('REQ: SKILL: ANIMAL HANDLING =150');

    const collapsed = truncateTagParts(parseTag('req,skill:farming:planting=150'), 24, { variant: 'row' });
    expect(collapsed.text).toBe('REQ: SKILL: <TAGS> =150');
  });
});
