import { describe, it, expect } from 'vitest';
import { evaluateDynamicTags, collectDynTagWarnings } from './dynamicTags.js';

const registry = { ability: { str: {}, dex: {}, con: {} }, class: { fighter: {}, wizard: {} } };

describe('evaluateDynamicTags', () => {
  it('evaluates the canonical D&D formulas from sibling tags', () => {
    const results = evaluateDynamicTags([
      'xp=1000',
      'ability:dex=14',
      'ability:con=14',
      'hitdie=1',
      'dyn,level=max(1, floor(0.5*(1+sqrt(1+{xp}/125))))',
      'dyn,pb=2+floor(({level}-1)/4)',
      'dyn,ac=10+floor(({ability:dex}-10)/2)',
      'dyn,hp:max=max(1, 10+(5+{hitdie}+floor(({ability:con}-10)/2))*{level})',
    ], registry);
    expect(results.get('level').value).toBe(2);
    expect(results.get('pb').value).toBe(2);
    expect(results.get('ac').value).toBe(12);
    expect(results.get('hp:max').value).toBe(26); // (5+1+2)*2 + 10
    expect([...results.values()].every(result => result.valid && !result.warnings.length)).toBe(true);
  });

  it('chains dyn references regardless of tag order', () => {
    const results = evaluateDynamicTags([
      'dyn,pb=2+floor(({level}-1)/4)',   // references a dyn tag listed later
      'dyn,level=max(1, floor(0.5*(1+sqrt(1+{xp}/125))))',
      'xp=6000',
    ], registry);
    expect(results.get('level').value).toBe(4);
    expect(results.get('pb').value).toBe(2);
  });

  it('defaults unresolved references to 1 with a warning', () => {
    const results = evaluateDynamicTags(['dyn,x={missing}+1'], registry);
    expect(results.get('x').value).toBe(2);
    expect(results.get('x').valid).toBe(true);
    expect(results.get('x').warnings).toEqual(['unresolved reference "{missing}" (defaulted to 1)']);
  });

  it('defaults non-numeric references to 1 with a warning', () => {
    // A leaf-terminal tag has no numeric value (leaf strings never coerce).
    const results = evaluateDynamicTags(['class:fighter', 'dyn,x={class:fighter}*2'], registry);
    expect(results.get('x').value).toBe(2);
    expect(results.get('x').warnings).toHaveLength(1);
  });

  it('sums wildcard matches over plain tags', () => {
    const results = evaluateDynamicTags([
      'ability:str=2', 'ability:dex=3', 'skill:stealth=4',
      'dyn,total={ability:*}',
    ], registry);
    expect(results.get('total').value).toBe(5);
    expect(results.get('total').warnings).toEqual([]);
  });

  it('defaults empty wildcard matches to 1 with a warning', () => {
    const results = evaluateDynamicTags(['dyn,x={class:*}'], registry);
    expect(results.get('x').value).toBe(1);
    expect(results.get('x').warnings).toEqual(['no tags match "{class:*}" (defaulted to 1)']);
  });

  it('collapses cycles to 1 and warns every tag on the cycle', () => {
    const results = evaluateDynamicTags(['dyn,a={b}+5', 'dyn,b={a}+5'], registry);
    expect(results.get('a').value).toBe(1);
    expect(results.get('b').value).toBe(1);
    expect(results.get('a').warnings).toEqual(['circular reference (defaulted to 1)']);
    expect(results.get('b').warnings).toEqual(['circular reference (defaulted to 1)']);
  });

  it('collapses self-references to 1 with a warning', () => {
    const results = evaluateDynamicTags(['dyn,a={a}+1'], registry);
    expect(results.get('a').value).toBe(1);
    expect(results.get('a').warnings).toEqual(['circular reference (defaulted to 1)']);
  });

  it('warns transitively when referencing a tag that has warnings', () => {
    const results = evaluateDynamicTags(['dyn,a={missing}+1', 'dyn,c={a}*2'], registry);
    expect(results.get('c').value).toBe(4);
    expect(results.get('c').warnings).toEqual(['references "{a}" which has warnings']);
  });

  it('adds a plain tag at the same path to the expression result', () => {
    const results = evaluateDynamicTags(['dyn,ac=12', 'ac=2'], registry);
    expect(results.get('ac').exprValue).toBe(12);
    expect(results.get('ac').value).toBe(14);
  });

  it('resolves references to a dyn path as the combined value', () => {
    const results = evaluateDynamicTags(['dyn,b=3', 'b=2', 'dyn,c={b}'], registry);
    expect(results.get('c').value).toBe(5);
  });

  it('marks parse errors invalid with a null value', () => {
    const results = evaluateDynamicTags(['dyn,x=1+'], registry);
    expect(results.get('x').valid).toBe(false);
    expect(results.get('x').value).toBeNull();
    expect(results.get('x').exprValue).toBeNull();
    expect(results.get('x').warnings[0]).toMatch(/invalid expression/);
  });

  it('defaults non-finite results to 1 with a warning', () => {
    const results = evaluateDynamicTags(['dyn,x=1/0'], registry);
    expect(results.get('x').value).toBe(1);
    expect(results.get('x').warnings).toEqual(['non-finite result (defaulted to 1)']);
  });

  it('keeps decimal results', () => {
    const results = evaluateDynamicTags(['dyn,x=5/2'], registry);
    expect(results.get('x').value).toBe(2.5);
  });

  it('exposes the raw expression text', () => {
    const results = evaluateDynamicTags(['dyn,x=1+2'], registry);
    expect(results.get('x').expression).toBe('1+2');
  });

  it('is entity-generic over any attribute list', () => {
    const itemAttributes = ['quality=3', 'dyn,worth={quality}*10'];
    expect(evaluateDynamicTags(itemAttributes, registry).get('worth').value).toBe(30);
  });
});

describe('collectDynTagWarnings', () => {
  const baseState = { tagRegistry: registry, agents: [], tasks: [], inventory: [] };

  it('unions warnings per path across agents, items, and tasks', () => {
    const state = {
      ...baseState,
      agents: [{ attributes: ['dyn,ac={missing}+1'], activities: [] }],
      inventory: [{ name: 'orb', attributes: ['dyn,worth={quality}*10'] }],
      tasks: [{ attributes: ['dyn,pace=1+'], requirements: [] }],
    };
    const warnings = collectDynTagWarnings(state);
    expect(warnings.get('ac')).toEqual(['unresolved reference "{missing}" (defaulted to 1)']);
    expect(warnings.get('worth')).toEqual(['unresolved reference "{quality}" (defaulted to 1)']);
    expect(warnings.get('pace')[0]).toMatch(/invalid expression/);
  });

  it('dedupes identical warnings from multiple carriers', () => {
    const state = {
      ...baseState,
      agents: [
        { attributes: ['dyn,ac={missing}+1'], activities: [] },
        { attributes: ['dyn,ac={missing}+1'], activities: [] },
      ],
    };
    expect(collectDynTagWarnings(state).get('ac')).toHaveLength(1);
  });

  it('reports nothing for clean dyn tags', () => {
    const state = {
      ...baseState,
      agents: [{ attributes: ['ability:dex=14', 'dyn,ac=10+floor(({ability:dex}-10)/2)'], activities: [] }],
    };
    expect(collectDynTagWarnings(state).size).toBe(0);
  });
});
