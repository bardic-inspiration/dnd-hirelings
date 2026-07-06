import { describe, it, expect } from 'vitest';
import { DEFAULT_TAGS_CONFIG, normalizeTagsConfig } from './tagsConfig.js';

describe('normalizeTagsConfig', () => {
  it('defaults to unlocked for nullish or non-object documents', () => {
    expect(normalizeTagsConfig(null)).toEqual({ locked: false });
    expect(normalizeTagsConfig(undefined)).toEqual({ locked: false });
    expect(normalizeTagsConfig('locked')).toEqual({ locked: false });
  });

  it('locks only on an explicit boolean true', () => {
    expect(normalizeTagsConfig({ locked: true }).locked).toBe(true);
    expect(normalizeTagsConfig({ locked: false }).locked).toBe(false);
    expect(normalizeTagsConfig({}).locked).toBe(false);
    expect(normalizeTagsConfig({ locked: 'yes' }).locked).toBe(false);
    expect(normalizeTagsConfig({ locked: 1 }).locked).toBe(false);
  });

  it('ships a frozen unlocked default', () => {
    expect(DEFAULT_TAGS_CONFIG).toEqual({ locked: false });
    expect(Object.isFrozen(DEFAULT_TAGS_CONFIG)).toBe(true);
  });
});
