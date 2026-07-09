import { describe, it, expect } from 'vitest';
import { evaluateDynamicTags, reconcileDynamicTags, collectDynTagWarnings } from './dynamicTags.js';
import { normalizeRulesConfig } from './rulesConfig.js';

const registry = { ability: { str: {}, dex: {}, con: {} }, class: { fighter: {}, wizard: {} } };

// The canonical D&D ruleset (mirrors public/config/rules.yml).
const DND_RULES = normalizeRulesConfig({
  dynamic: {
    level: '[max(1, floor(0.5*(1+sqrt(1+{xp}/125))))]',
    pb: '[2+floor(({dyn,level}-1)/4)]',
    ac: '[10+floor(({ability:dex}-10)/2)]',
    'hp-max': '[max(1, 10+(5+{hitdie}+floor(({ability:con}-10)/2))*{dyn,level})]',
  },
});

const rules = (dynamic) => normalizeRulesConfig({ dynamic });

describe('evaluateDynamicTags', () => {
  it('evaluates the canonical D&D rules from sibling tags', () => {
    const results = evaluateDynamicTags([
      'xp=1000', 'ability:dex=14', 'ability:con=14', 'hitdie=1',
      'dyn,level', 'dyn,pb', 'dyn,ac', 'dyn,hp-max',
    ], DND_RULES, registry);
    expect(results.get('level').value).toBe(2);
    expect(results.get('pb').value).toBe(2);
    expect(results.get('ac').value).toBe(12);
    expect(results.get('hp-max').value).toBe(26); // 10 + (5+1+2)*2
    expect([...results.values()].every(result => result.valid && !result.warnings.length)).toBe(true);
  });

  it("folds static and bonus values at the address into the total (user's example)", () => {
    // rule [8+{ability:dex}], ability:dex=3, static ac=2, bonus-injected ac
    // arrives pre-folded via getEffectiveAttributes → ac=3 in the effective list.
    const results = evaluateDynamicTags(
      ['ability:dex=3', 'ac=3', 'dyn,ac'],
      rules({ ac: '[8+{ability:dex}]' }),
      registry,
    );
    expect(results.get('ac').value).toBe(14);
  });

  it('marks markers with no rule invalid', () => {
    const results = evaluateDynamicTags(['dyn,ac'], rules({}), registry);
    expect(results.get('ac')).toMatchObject({ value: null, valid: false, expression: null });
    expect(results.get('ac').warnings).toEqual(['no rule for "ac"']);
  });

  it('marks markers whose rule is broken invalid', () => {
    const results = evaluateDynamicTags(['dyn,ac'], rules({ ac: '[1+]' }), registry);
    expect(results.get('ac').valid).toBe(false);
    expect(results.get('ac').warnings[0]).toMatch(/broken rule/);
  });

  it('scopes references strictly: {addr} never reads a dyn total', () => {
    // b's rule reads STATIC {a}; the object has only a dyn marker at a.
    const results = evaluateDynamicTags(
      ['dyn,a', 'dyn,b'],
      rules({ a: '[7]', b: '[{a}+1]' }),
      registry,
    );
    expect(results.get('a').value).toBe(7);
    expect(results.get('b').value).toBe(2); // static {a} missing → 1, +1
    expect(results.get('b').warnings).toEqual(['unresolved reference "{a}" (defaulted to 1)']);
  });

  it('resolves {dyn,addr} to the referenced total in dependency order', () => {
    const results = evaluateDynamicTags(
      ['dyn,b', 'dyn,a', 'a=2'], // marker order should not matter; a has static +2
      rules({ a: '[7]', b: '[{dyn,a}*2]' }),
      registry,
    );
    expect(results.get('a').value).toBe(9);
    expect(results.get('b').value).toBe(18);
  });

  it('defaults {dyn,addr} to 1 when the object lacks the marker', () => {
    const results = evaluateDynamicTags(['dyn,b'], rules({ a: '[7]', b: '[{dyn,a}*2]' }), registry);
    expect(results.get('b').value).toBe(2);
    expect(results.get('b').warnings).toEqual(['unresolved reference "{dyn,a}" (defaulted to 1)']);
  });

  it('sums wildcards per scope', () => {
    const results = evaluateDynamicTags(
      ['ability:str=2', 'ability:dex=3', 'dyn,a', 'dyn,b', 'dyn,total', 'dyn,statics'],
      rules({ a: '[5]', b: '[6]', total: '[{dyn,a}+{dyn,b}]', statics: '[{ability:*}]' }),
      registry,
    );
    expect(results.get('statics').value).toBe(5);
    expect(results.get('total').value).toBe(11);
    const wild = evaluateDynamicTags(
      ['dyn,a', 'dyn,b', 'dyn,total'],
      rules({ a: '[5]', b: '[6]', total: '[{dyn,*}]' }),
      registry,
    );
    // {dyn,*} matches a, b, and total itself → total is on the cycle.
    expect(wild.get('total').warnings).toEqual(['circular reference (defaulted to 1)']);
  });

  it('collapses cycles to 1 and warns every marker on the cycle', () => {
    const results = evaluateDynamicTags(
      ['dyn,a', 'dyn,b'],
      rules({ a: '[{dyn,b}+5]', b: '[{dyn,a}+5]' }),
      registry,
    );
    expect(results.get('a').value).toBe(1);
    expect(results.get('b').value).toBe(1);
    expect(results.get('a').warnings).toEqual(['circular reference (defaulted to 1)']);
    expect(results.get('b').warnings).toEqual(['circular reference (defaulted to 1)']);
  });

  it('warns transitively when referencing a marker that has warnings', () => {
    const results = evaluateDynamicTags(
      ['dyn,a', 'dyn,c'],
      rules({ a: '[{missing}+1]', c: '[{dyn,a}*2]' }),
      registry,
    );
    expect(results.get('a').value).toBe(2);
    expect(results.get('c').value).toBe(4);
    expect(results.get('c').warnings).toEqual(['references "{dyn,a}" which has warnings']);
  });

  it('defaults non-finite results to 1 and keeps decimals otherwise', () => {
    const div = evaluateDynamicTags(['dyn,x'], rules({ x: '[1/0]' }), registry);
    expect(div.get('x').value).toBe(1);
    expect(div.get('x').warnings).toEqual(['non-finite result (defaulted to 1)']);
    const half = evaluateDynamicTags(['dyn,x'], rules({ x: '[5/2]' }), registry);
    expect(half.get('x').value).toBe(2.5);
  });

  it('exposes the governing expression text', () => {
    const results = evaluateDynamicTags(['dyn,x'], rules({ x: '[1+2]' }), registry);
    expect(results.get('x').expression).toBe('1+2');
  });
});

describe('reconcileDynamicTags', () => {
  const baseState = (overrides) => ({
    tagRegistry: registry,
    agents: [], tasks: [], inventory: [],
    ...overrides,
  });

  it('materializes totals into dyn tag payloads across entities', () => {
    const state = baseState({
      agents: [{ attributes: ['ability:dex=14', 'dyn,ac'], activities: [] }],
      inventory: [{ name: 'orb', attributes: ['quality=3', 'dyn,worth'] }],
      tasks: [{ attributes: ['dyn,pace'], requirements: [] }],
    });
    const config = rules({ ac: '[10+floor(({ability:dex}-10)/2)]', worth: '[{quality}*10]', pace: '[2]' });
    const { state: next, changed } = reconcileDynamicTags(state, config);
    expect(changed).toBe(true);
    expect(next.agents[0].attributes).toContain('dyn,ac=12');
    expect(next.inventory[0].attributes).toContain('dyn,worth=30');
    expect(next.tasks[0].attributes).toContain('dyn,pace=2');
  });

  it('folds bound-item bonuses into agent totals', () => {
    const state = baseState({
      agents: [{ attributes: ['ability:dex=3', 'ac=2', 'dyn,ac'], activities: ['bind:item:ring'] }],
      inventory: [{ name: 'ring', attributes: ['bonus,ac=1'] }],
    });
    const { state: next } = reconcileDynamicTags(state, rules({ ac: '[8+{ability:dex}]' }));
    expect(next.agents[0].attributes).toContain('dyn,ac=14');
  });

  it('strips payloads for invalid markers (missing rule)', () => {
    const state = baseState({
      agents: [{ attributes: ['dyn,ac=99'], activities: [] }],
    });
    const { state: next, changed } = reconcileDynamicTags(state, rules({}));
    expect(changed).toBe(true);
    expect(next.agents[0].attributes).toEqual(['dyn,ac']);
  });

  it('overwrites stale hand-edited payloads', () => {
    const state = baseState({
      agents: [{ attributes: ['dyn,ac=99'], activities: [] }],
    });
    const { state: next } = reconcileDynamicTags(state, rules({ ac: '[5]' }));
    expect(next.agents[0].attributes).toEqual(['dyn,ac=5']);
  });

  it('reaches a fixed point: a second pass changes nothing and keeps identity', () => {
    const state = baseState({
      agents: [{ attributes: ['ability:dex=14', 'dyn,ac'], activities: [] }],
    });
    const config = rules({ ac: '[10+floor(({ability:dex}-10)/2)]' });
    const first = reconcileDynamicTags(state, config);
    const second = reconcileDynamicTags(first.state, config);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.state).toBe(first.state);
    expect(second.state.agents[0]).toBe(first.state.agents[0]);
  });

  it('leaves non-dyn tags and untouched entities alone', () => {
    const untouched = { attributes: ['skill:arcana=3'], activities: [] };
    const state = baseState({
      agents: [untouched, { attributes: ['dyn,x'], activities: [] }],
    });
    const { state: next } = reconcileDynamicTags(state, rules({ x: '[1]' }));
    expect(next.agents[0]).toBe(untouched);
    expect(next.agents[1].attributes).toEqual(['dyn,x=1']);
  });
});

describe('collectDynTagWarnings', () => {
  const baseState = { tagRegistry: registry, agents: [], tasks: [], inventory: [] };

  it('unions warnings per address across agents, items, and tasks', () => {
    const state = {
      ...baseState,
      agents: [{ attributes: ['dyn,ac'], activities: [] }],
      inventory: [{ name: 'orb', attributes: ['dyn,worth'] }],
    };
    const config = rules({ ac: '[{missing}+1]' }); // worth has no rule
    const warnings = collectDynTagWarnings(state, config);
    expect(warnings.get('ac')).toEqual(['unresolved reference "{missing}" (defaulted to 1)']);
    expect(warnings.get('worth')).toEqual(['no rule for "worth"']);
  });

  it('dedupes identical warnings from multiple carriers', () => {
    const state = {
      ...baseState,
      agents: [
        { attributes: ['dyn,ac'], activities: [] },
        { attributes: ['dyn,ac'], activities: [] },
      ],
    };
    expect(collectDynTagWarnings(state, rules({ ac: '[{missing}+1]' })).get('ac')).toHaveLength(1);
  });

  it('reports nothing for clean markers', () => {
    const state = {
      ...baseState,
      agents: [{ attributes: ['ability:dex=14', 'dyn,ac'], activities: [] }],
    };
    expect(collectDynTagWarnings(state, rules({ ac: '[10+floor(({ability:dex}-10)/2)]' })).size).toBe(0);
  });
});
