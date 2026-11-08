import { describe, it, expect } from 'vitest';
import { withBase, publicUrl } from './paths.js';

describe('withBase', () => {
  it('leaves an app path unchanged when the base is the site root', () => {
    expect(withBase('/assets/portraits/portrait-001.webp', '/'))
      .toBe('/assets/portraits/portrait-001.webp');
  });

  it('prefixes an app path with a sub-path base', () => {
    expect(withBase('/config/clock.yml', '/dnd-hirelings/'))
      .toBe('/dnd-hirelings/config/clock.yml');
  });

  it('prefixes with a nested preview base', () => {
    expect(withBase('/presets/agent_presets.json', '/dnd-hirelings/pr-preview/pr-12/'))
      .toBe('/dnd-hirelings/pr-preview/pr-12/presets/agent_presets.json');
  });

  it('passes data, blob, and absolute URLs through unchanged', () => {
    const base = '/dnd-hirelings/';
    for (const url of [
      'data:image/png;base64,AAAA',
      'blob:https://example.com/1234',
      'https://example.com/a.webp',
      '//cdn.example.com/a.webp',
    ]) {
      expect(withBase(url, base)).toBe(url);
    }
  });

  it('passes relative paths and empty values through unchanged', () => {
    expect(withBase('assets/a.webp', '/dnd-hirelings/')).toBe('assets/a.webp');
    expect(withBase('', '/dnd-hirelings/')).toBe('');
    expect(withBase(undefined, '/dnd-hirelings/')).toBe(undefined);
    expect(withBase(null, '/dnd-hirelings/')).toBe(null);
  });
});

describe('publicUrl', () => {
  it('resolves against the build base, which is the root under test', () => {
    expect(publicUrl('/config/rules.yml')).toBe('/config/rules.yml');
  });
});
