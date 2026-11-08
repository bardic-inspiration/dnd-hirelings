import { describe, it, expect } from 'vitest';
import {
  defaultConditionName, createConditionTemplate,
  conditionTemplateFromDraft, formatConditionLink, migrateLegacyWork,
  normalizeConditionTemplate, splitConditionDraft,
} from './conditions.js';

describe('defaultConditionName', () => {
  it('derives a label from the tag path, wildcard-aware', () => {
    expect(defaultConditionName(null)).toBe('WORK');
    expect(defaultConditionName('skill:arcana')).toBe('ARCANA');
    expect(defaultConditionName('skill:*')).toBe('ANY SKILL');
    expect(defaultConditionName('*')).toBe('ANY');
    expect(defaultConditionName('skill:animal_handling')).toBe('ANIMAL HANDLING');
  });
});

describe('createConditionTemplate', () => {
  it('normalizes the path, defaults a non-positive target to 1, derives a blank name', () => {
    expect(createConditionTemplate({ tagPath: 'Skill:Arcana', target: '30' })).toEqual({
      name: 'ARCANA', target: 30, tracker: { kind: 'work', tagPath: 'skill:arcana', compare: null },
    });
    expect(createConditionTemplate({ tagPath: 'skill:arcana', target: 0 }).target).toBe(1);
  });

  it('normalizes valid compare terms and collapses malformed ones to null', () => {
    expect(createConditionTemplate({ tagPath: 'skill:arcana', compare: { op: '>=', value: ' 3 ' } }).tracker.compare)
      .toEqual({ op: '>=', value: '3' });
    expect(createConditionTemplate({ tagPath: 'class', compare: { op: '==', value: 'Druid' } }).tracker.compare)
      .toEqual({ op: '==', value: 'druid' });
    expect(createConditionTemplate({ tagPath: 'skill:arcana', compare: { op: '~=', value: '3' } }).tracker.compare).toBe(null);
    expect(createConditionTemplate({ tagPath: 'skill:arcana', compare: { op: '>=', value: '' } }).tracker.compare).toBe(null);
    expect(createConditionTemplate({ compare: { op: '>=', value: '3' } }).tracker.compare).toBe(null); // no path
  });
});

describe('normalizeConditionTemplate', () => {
  it('defaults conditions stored before the compare field to compare: null', () => {
    const legacy = { name: 'ARCANA', target: 30, tracker: { kind: 'work', tagPath: 'skill:arcana' } };
    expect(normalizeConditionTemplate(legacy).tracker.compare).toBe(null);
  });

  it('round-trips a valid compare term', () => {
    const stored = { name: 'ARCANA', target: 30, tracker: { kind: 'work', tagPath: 'skill:arcana', compare: { op: '>=', value: '3' } } };
    expect(normalizeConditionTemplate(stored).tracker.compare).toEqual({ op: '>=', value: '3' });
  });
});

describe('splitConditionDraft', () => {
  it('splits path[op value][=target], keeping the last = as the target delimiter', () => {
    expect(splitConditionDraft('skill:arcana>=3=30'))
      .toEqual({ path: 'skill:arcana', compare: { op: '>=', value: '3' }, target: '30' });
    expect(splitConditionDraft('class==druid'))
      .toEqual({ path: 'class', compare: { op: '==', value: 'druid' }, target: null });
    expect(splitConditionDraft('class==druid=30'))
      .toEqual({ path: 'class', compare: { op: '==', value: 'druid' }, target: '30' });
    expect(splitConditionDraft('skill:*>=3=30'))
      .toEqual({ path: 'skill:*', compare: { op: '>=', value: '3' }, target: '30' });
  });

  it('falls through to the plain last-= split when no operator is present', () => {
    expect(splitConditionDraft('skill:arcana=30')).toEqual({ path: 'skill:arcana', compare: null, target: '30' });
    expect(splitConditionDraft('skill:*')).toEqual({ path: 'skill:*', compare: null, target: null });
    expect(splitConditionDraft('=20')).toEqual({ path: '', compare: null, target: '20' });
  });

  it('keeps escaped characters inside the path', () => {
    expect(splitConditionDraft('weird\\:name>=2=10'))
      .toEqual({ path: 'weird\\:name', compare: { op: '>=', value: '2' }, target: '10' });
    expect(splitConditionDraft('skill:\\*>=1'))
      .toEqual({ path: 'skill:\\*', compare: { op: '>=', value: '1' }, target: null });
  });

  it('pins degenerate multi-= drafts to the last-= split (invalid path fails later)', () => {
    expect(splitConditionDraft('a=b=c')).toEqual({ path: 'a=b', compare: null, target: 'c' });
  });
});

describe('conditionTemplateFromDraft', () => {
  it('splits path[=target] on the last =, defaulting target to 1', () => {
    expect(conditionTemplateFromDraft('skill:arcana=30')).toMatchObject({
      target: 30, tracker: { tagPath: 'skill:arcana', compare: null },
    });
    expect(conditionTemplateFromDraft('skill:*')).toMatchObject({
      target: 1, tracker: { tagPath: 'skill:*' },
    });
    expect(conditionTemplateFromDraft('=20')).toMatchObject({
      target: 20, tracker: { tagPath: null },
    });
  });

  it('carries an operator draft into a normalized compare term and derived name', () => {
    expect(conditionTemplateFromDraft('skill:arcana>=3=30')).toMatchObject({
      name: 'ARCANA ≥ 3', target: 30,
      tracker: { tagPath: 'skill:arcana', compare: { op: '>=', value: '3' } },
    });
    expect(conditionTemplateFromDraft('class==Druid')).toMatchObject({
      name: 'CLASS = DRUID', target: 1,
      tracker: { tagPath: 'class', compare: { op: '==', value: 'druid' } },
    });
  });
});

describe('formatConditionLink', () => {
  it('renders the pattern label plus the comparison term', () => {
    expect(formatConditionLink(null)).toBe('any agent');
    expect(formatConditionLink({ tagPath: null, compare: null })).toBe('any agent');
    expect(formatConditionLink({ tagPath: 'skill:arcana', compare: null })).toBe('skill:arcana');
    expect(formatConditionLink({ tagPath: 'skill:*', compare: { op: '>=', value: '3' } })).toBe('skill:‹any› ≥ 3');
    expect(formatConditionLink({ tagPath: 'class', compare: { op: '==', value: 'druid' } })).toBe('class = druid');
  });
});

describe('migrateLegacyWork', () => {
  it('converts work tags to conditions and carries progress from the bucket key', () => {
    expect(migrateLegacyWork(['work=5'])).toMatchObject([
      { target: 5, progress: 0, tracker: { tagPath: null } },
    ]);
    const migrated = migrateLegacyWork(['work:skill:arcana=10'], { 'skill:arcana': 4 });
    expect(migrated[0]).toMatchObject({ target: 10, progress: 4, tracker: { tagPath: 'skill:arcana' } });
  });

  it('skips non-work tags and targets that are not positive', () => {
    expect(migrateLegacyWork(['skill:arcana=3', 'work=0'])).toEqual([]);
  });
});
