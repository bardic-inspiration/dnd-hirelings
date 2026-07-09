import { describe, it, expect } from 'vitest';
import { parseTag, buildTag, tagSyntaxWarning, compareTagsByPrefix } from './tags.js';

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
    expect(tagSyntaxWarning('hp-max')).toBeNull();
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

describe('compareTagsByPrefix', () => {
  const sorted = (tags) => [...tags].sort(compareTagsByPrefix);

  it('orders plain (un-prefixed) tags ahead of every modifier group', () => {
    expect(sorted(['req,skill:arcana=2', 'hp=10', 'dyn,level=1']))
      .toEqual(['hp=10', 'dyn,level=1', 'req,skill:arcana=2']);
  });

  it('orders modifier groups alphabetically by prefix', () => {
    expect(sorted(['req,a', 'block,a', 'dyn,a', 'bonus,a']))
      .toEqual(['block,a', 'bonus,a', 'dyn,a', 'req,a']);
  });

  it('orders alphabetically by content path within a group', () => {
    expect(sorted(['skill:stealth=1', 'ac=12', 'ability:str=14', 'hp=10']))
      .toEqual(['ability:str=14', 'ac=12', 'hp=10', 'skill:stealth=1']);
  });

  it('compares both keys case-insensitively', () => {
    expect(sorted(['skill:Arcana', 'ability:STR', 'Skill:athletics']))
      .toEqual(['ability:STR', 'skill:Arcana', 'Skill:athletics']);
  });
});
