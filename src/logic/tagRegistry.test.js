import { describe, it, expect } from 'vitest';
import { collectPresetTags, unregisteredEntityTags } from './tagRegistry.js';

const registry = {
  skill: { arcana: {}, sword: {} },
  trait: { brave: {} },
  class: { fighter: {} },
};

describe('collectPresetTags', () => {
  it('reads attributes for agents and items', () => {
    expect(collectPresetTags('agent', { attributes: ['class:fighter', 'skill:arcana=3'] })).toEqual({
      literalTags: ['class:fighter', 'skill:arcana=3'], patternPaths: [],
    });
    expect(collectPresetTags('item', { attributes: ['rarity:common'] }).literalTags).toEqual(['rarity:common']);
  });

  it('reads requirements, attributes, and condition tag paths for tasks', () => {
    const preset = {
      requirements: ['req,skill:sword=1'],
      attributes: ['trait:combat'],
      conditions: [
        { tracker: { tagPath: 'skill:arcana' } },
        { tracker: { tagPath: null } },
        {},
      ],
    };
    expect(collectPresetTags('task', preset).literalTags)
      .toEqual(['trait:combat', 'req,skill:sword=1', 'skill:arcana']);
  });

  it('classifies wildcard and escaped paths as patterns', () => {
    const preset = { conditions: [{ tracker: { tagPath: 'skill:*' } }, { tracker: { tagPath: 'skill:\\*' } }] };
    expect(collectPresetTags('task', preset)).toEqual({
      literalTags: [], patternPaths: ['skill:*', 'skill:\\*'],
    });
  });

  it('skips dynamic instance tags and non-string entries', () => {
    const preset = { attributes: ['bind:weapon:item:sword', 'task:abc123', 'trait:brave', '', 7] };
    expect(collectPresetTags('agent', preset).literalTags).toEqual(['trait:brave']);
  });

  it('tolerates nullish presets and missing fields', () => {
    expect(collectPresetTags('agent', null)).toEqual({ literalTags: [], patternPaths: [] });
    expect(collectPresetTags('task', {})).toEqual({ literalTags: [], patternPaths: [] });
  });
});

describe('unregisteredEntityTags', () => {
  it('passes fully registered presets, stripping modifiers and values', () => {
    const preset = { attributes: ['req,skill:arcana=2', 'class:fighter', 'trait:brave'] };
    expect(unregisteredEntityTags(registry, 'agent', preset)).toEqual([]);
  });

  it('reports unregistered literal tags as their original strings, deduped', () => {
    const preset = { attributes: ['rarity:common', 'req,rarity:common=1', 'rarity:common', 'trait:brave'] };
    expect(unregisteredEntityTags(registry, 'item', preset))
      .toEqual(['rarity:common', 'req,rarity:common=1']);
  });

  it('requires pattern paths to match at least one registered node', () => {
    const matching = { conditions: [{ tracker: { tagPath: 'skill:*' } }] };
    const hollow = { conditions: [{ tracker: { tagPath: 'spell:*' } }] };
    expect(unregisteredEntityTags(registry, 'task', matching)).toEqual([]);
    expect(unregisteredEntityTags(registry, 'task', hollow)).toEqual(['spell:*']);
  });

  it('never reports dynamic instance tags', () => {
    const preset = { attributes: ['bind:weapon:item:sword', 'task:abc123'] };
    expect(unregisteredEntityTags(registry, 'agent', preset)).toEqual([]);
  });
});
