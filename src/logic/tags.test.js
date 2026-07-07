import { describe, it, expect } from 'vitest';
import { tagSyntaxWarning } from './tags.js';

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
    expect(tagSyntaxWarning('dynamic:hp-max')).toBeNull();
  });

  it('strips modifier and =value the way parseTag does', () => {
    expect(tagSyntaxWarning('req,skill:arcana=2')).toBeNull();
    expect(tagSyntaxWarning('req,skill:')).toMatch(/empty path segment/);
    expect(tagSyntaxWarning('skill:arcana=')).toBeNull(); // empty value, path intact
  });

  it('leaves the entirely-empty case to callers', () => {
    expect(tagSyntaxWarning('')).toBeNull();
    expect(tagSyntaxWarning('   ')).toBeNull();
    expect(tagSyntaxWarning(null)).toBeNull();
  });
});
