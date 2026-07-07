import { describe, it, expect } from 'vitest';
import { parseTag, buildTag, tagSyntaxWarning } from './tags.js';

describe('parseTag', () => {
  it('parses plain paths, values, and modifiers', () => {
    expect(parseTag('skill:arcana')).toEqual({ modifier: null, segments: ['skill', 'arcana'], value: null });
    expect(parseTag('ability:str=14')).toEqual({ modifier: null, segments: ['ability', 'str'], value: '14' });
    expect(parseTag('req,skill:arcana=2')).toEqual({ modifier: 'req', segments: ['skill', 'arcana'], value: '2' });
    expect(parseTag('bind:slot:item:rope')).toEqual({ modifier: null, segments: ['bind', 'slot', 'item', 'rope'], value: null });
    expect(parseTag('item:rope=3')).toEqual({ modifier: null, segments: ['item', 'rope'], value: '3' });
  });

  it('treats everything after the first = as the value', () => {
    expect(parseTag('dyn,ac=10+floor(({ability:dex}-10)/2)'))
      .toEqual({ modifier: 'dyn', segments: ['ac'], value: '10+floor(({ability:dex}-10)/2)' });
    expect(parseTag('level=a:b').value).toBe('a:b');
    expect(parseTag('level=a=b').value).toBe('a=b');
  });

  it('only splits a modifier on a comma that precedes the first =', () => {
    expect(parseTag('dyn,level=max(1, {xp}/125)'))
      .toEqual({ modifier: 'dyn', segments: ['level'], value: 'max(1, {xp}/125)' });
    expect(parseTag('level=max(1,2)')).toEqual({ modifier: null, segments: ['level'], value: 'max(1,2)' });
  });

  it('round-trips through buildTag', () => {
    const expr = 'max(1, floor(0.5*(1+sqrt(1+{xp}/125))))';
    const tag = buildTag(['level'], expr, 'dyn');
    expect(tag).toBe(`dyn,level=${expr}`);
    expect(parseTag(tag)).toEqual({ modifier: 'dyn', segments: ['level'], value: expr });
  });
});

describe('tagSyntaxWarning', () => {
  it('flags empty path segments from stray colons', () => {
    expect(tagSyntaxWarning('skill:')).toMatch(/empty path segment/);
    expect(tagSyntaxWarning(':skill')).toMatch(/empty path segment/);
    expect(tagSyntaxWarning('a::b')).toMatch(/empty path segment/);
    expect(tagSyntaxWarning('a: :b')).toMatch(/empty path segment/);
  });

  it('accepts well-formed paths', () => {
    expect(tagSyntaxWarning('skill')).toBeNull();
    expect(tagSyntaxWarning('skill:arcana')).toBeNull();
    expect(tagSyntaxWarning('hp:max')).toBeNull();
  });

  it('strips modifier and =value the way parseTag does', () => {
    expect(tagSyntaxWarning('req,skill:arcana=2')).toBeNull();
    expect(tagSyntaxWarning('req,skill:')).toMatch(/empty path segment/);
    expect(tagSyntaxWarning('skill:arcana=')).toBeNull(); // empty value, path intact
  });

  it('ignores colons and commas inside expression payloads', () => {
    expect(tagSyntaxWarning('dyn,ac=10+floor(({ability:dex}-10)/2)')).toBeNull();
    expect(tagSyntaxWarning('dyn,level=max(1, {xp}/125)')).toBeNull();
    expect(tagSyntaxWarning('dyn,ac:=1+1')).toMatch(/empty path segment/);
  });

  it('leaves the entirely-empty case to callers', () => {
    expect(tagSyntaxWarning('')).toBeNull();
    expect(tagSyntaxWarning('   ')).toBeNull();
    expect(tagSyntaxWarning(null)).toBeNull();
  });
});
