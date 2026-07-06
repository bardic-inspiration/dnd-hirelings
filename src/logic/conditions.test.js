import { describe, it, expect } from 'vitest';
import {
  computeConditionContribution, defaultConditionName, createConditionTemplate,
  conditionTemplateFromDraft, migrateLegacyWork, normalizeConditionTemplate, resetConditions,
} from './conditions.js';

const session = { workRate: 1, skillBonus: 1 };
const workCondition = (tagPath, compare = null) => ({ tracker: { kind: 'work', tagPath, compare } });

describe('computeConditionContribution — work tracker', () => {
  it('a null tag path grants the base rate to any agent', () => {
    const contribution = computeConditionContribution(workCondition(null),
      { effectiveAttributes: [], session, stepDays: 1 });
    expect(contribution).toBe(1);
  });

  it('a matched valued tag adds value × skillBonus to the base rate', () => {
    const contribution = computeConditionContribution(workCondition('skill:arcana'),
      { effectiveAttributes: ['skill:arcana=3'], session, stepDays: 1 });
    expect(contribution).toBe(4); // (1 + 3*1) * 1
  });

  it('applies skillBonus and stepDays multipliers', () => {
    const contribution = computeConditionContribution(workCondition('skill:arcana'),
      { effectiveAttributes: ['skill:arcana=3'], session: { workRate: 1, skillBonus: 2 }, stepDays: 2 });
    expect(contribution).toBe(14); // (1 + 3*2) * 2
  });

  it('a matched valueless tag contributes only the base rate', () => {
    const contribution = computeConditionContribution(workCondition('skill:arcana'),
      { effectiveAttributes: ['skill:arcana'], session, stepDays: 1 });
    expect(contribution).toBe(1);
  });

  it('contributes 0 when no attribute matches, or the match is a modifier tag', () => {
    expect(computeConditionContribution(workCondition('skill:arcana'),
      { effectiveAttributes: ['skill:history=2'], session, stepDays: 1 })).toBe(0);
    expect(computeConditionContribution(workCondition('skill:arcana'),
      { effectiveAttributes: ['req,skill:arcana=3'], session, stepDays: 1 })).toBe(0);
  });

  it('an unknown tracker kind contributes 0', () => {
    expect(computeConditionContribution({ tracker: { kind: 'mystery' } },
      { effectiveAttributes: [], session, stepDays: 1 })).toBe(0);
  });
});

describe('computeConditionContribution — compare terms', () => {
  const registry = { class: { fighter: {}, druid: { circle: {} } }, skill: { arcana: {}, history: {} } };

  it('gates the contribution on the comparison passing', () => {
    const condition = workCondition('skill:arcana', { op: '>=', value: '3' });
    expect(computeConditionContribution(condition,
      { effectiveAttributes: ['skill:arcana=3'], session, stepDays: 1, registry })).toBe(4);
    expect(computeConditionContribution(condition,
      { effectiveAttributes: ['skill:arcana=2'], session, stepDays: 1, registry })).toBe(0);
  });

  it('compares equality against the display-resolved leaf value', () => {
    const condition = workCondition('class:*', { op: '==', value: 'fighter' });
    expect(computeConditionContribution(condition,
      { effectiveAttributes: ['class:fighter'], session, stepDays: 1, registry })).toBe(1); // no numeric bonus
    expect(computeConditionContribution(condition,
      { effectiveAttributes: ['class:druid'], session, stepDays: 1, registry })).toBe(0);
  });

  it('fails ordered comparisons closed against non-numeric leaf values', () => {
    const condition = workCondition('class:*', { op: '>=', value: '3' });
    expect(computeConditionContribution(condition,
      { effectiveAttributes: ['class:fighter'], session, stepDays: 1, registry })).toBe(0);
  });

  it('lets a wildcard link select the first qualifying tag among path matches', () => {
    const condition = workCondition('skill:*', { op: '>=', value: '3' });
    expect(computeConditionContribution(condition,
      { effectiveAttributes: ['skill:history=1', 'skill:arcana=5'], session, stepDays: 1, registry })).toBe(6);
  });
});

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

describe('conditionTemplateFromDraft', () => {
  it('splits path[=target] on the last =, defaulting target to 1', () => {
    expect(conditionTemplateFromDraft('skill:arcana=30')).toMatchObject({
      target: 30, tracker: { tagPath: 'skill:arcana' },
    });
    expect(conditionTemplateFromDraft('skill:*')).toMatchObject({
      target: 1, tracker: { tagPath: 'skill:*' },
    });
    expect(conditionTemplateFromDraft('=20')).toMatchObject({
      target: 20, tracker: { tagPath: null },
    });
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

describe('resetConditions', () => {
  it('zeroes progress while preserving ids', () => {
    const reset = resetConditions([{ id: 'c1', progress: 40, target: 100 }]);
    expect(reset).toEqual([{ id: 'c1', progress: 0, target: 100 }]);
  });
});
