import { describe, it, expect } from 'vitest';
import { reducer } from './reducer.js';
import { normalizeRulesConfig } from '../logic/rulesConfig.js';

// Minimal board state exercising the TAG_APPLY dedup path (issue #82).
const baseState = () => ({
  agents: [{ id: 'a1', attributes: [], activities: [] }],
  tasks: [{ id: 't1', requirements: [], attributes: [] }],
  inventory: [{ id: 'i1', attributes: [] }],
  tagRegistry: {},
});

const apply = (state, target, tag) => reducer(state, { type: 'TAG_APPLY', target, tag });

describe('TAG_APPLY dedup (issue #82)', () => {
  it('replaces a task attribute value instead of stacking a duplicate', () => {
    let state = baseState();
    state = apply(state, { type: 'task', id: 't1' }, 'skill:swords');
    state = apply(state, { type: 'task', id: 't1' }, 'skill:swords=50');
    expect(state.tasks[0].attributes).toEqual(['skill:swords=50']);
  });

  it('dedupes task requirements by modifier + path', () => {
    let state = baseState();
    state = apply(state, { type: 'task', id: 't1' }, 'req,skill:x');
    state = apply(state, { type: 'task', id: 't1' }, 'req,skill:x=3');
    expect(state.tasks[0].requirements).toEqual(['req,skill:x=3']);
  });

  it('keeps distinct tag paths on the same task field', () => {
    let state = baseState();
    state = apply(state, { type: 'task', id: 't1' }, 'skill:x=1');
    state = apply(state, { type: 'task', id: 't1' }, 'skill:y=2');
    expect(state.tasks[0].attributes).toEqual(['skill:x=1', 'skill:y=2']);
  });

  it('replaces an agent attribute value (unchanged behavior)', () => {
    let state = baseState();
    state = apply(state, { type: 'agent', id: 'a1' }, 'skill:swords');
    state = apply(state, { type: 'agent', id: 'a1' }, 'skill:swords=50');
    expect(state.agents[0].attributes).toEqual(['skill:swords=50']);
  });
});

describe('INVENTORY_ADD stacking (issue #91)', () => {
  const add = (state, preset) => reducer(state, { type: 'INVENTORY_ADD', preset });
  const inv = (items) => ({ inventory: items });

  it('stacks a duplicate (same name + same tags) onto the existing row', () => {
    const state = add(inv([{ id: 'i1', name: 'Rope', quantity: 2, attributes: ['item:gear'] }]),
      { name: 'Rope', quantity: 3, attributes: ['item:gear'] });
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].id).toBe('i1');
    expect(state.inventory[0].quantity).toBe(5);
  });

  it('keeps a same-name item with different tags as a separate row', () => {
    const state = add(inv([{ id: 'i1', name: 'Potion', quantity: 1, attributes: ['item:potion=1'] }]),
      { name: 'Potion', quantity: 1, attributes: ['item:potion=5'] });
    expect(state.inventory).toHaveLength(2);
  });

  it('stacks regardless of tag order', () => {
    const state = add(inv([{ id: 'i1', name: 'Kit', quantity: 1, attributes: ['a:1', 'b:2'] }]),
      { name: 'Kit', quantity: 1, attributes: ['b:2', 'a:1'] });
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].quantity).toBe(2);
  });

  it('matches names case-insensitively', () => {
    const state = add(inv([{ id: 'i1', name: 'Torch', quantity: 1, attributes: [] }]),
      { name: 'torch', quantity: 4, attributes: [] });
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].quantity).toBe(5);
  });

  it('never stacks unnamed placeholders (blank adds stay distinct)', () => {
    let state = inv([]);
    state = add(state); // blank → NEW ITEM
    state = add(state); // blank → NEW ITEM
    expect(state.inventory).toHaveLength(2);
  });
});

describe('shopping-list copy count (issue #92)', () => {
  const ids = (rows) => new Set(rows.map(row => row.id));

  it('AGENT_CREATE mints `count` distinct agents', () => {
    const state = reducer({ agents: [] }, { type: 'AGENT_CREATE', preset: { name: 'Guard' }, count: 3 });
    expect(state.agents).toHaveLength(3);
    expect(state.agents.every(agent => agent.name === 'Guard')).toBe(true);
    expect(ids(state.agents).size).toBe(3);
  });

  it('AGENT_CREATE without a count still creates exactly one', () => {
    expect(reducer({ agents: [] }, { type: 'AGENT_CREATE' }).agents).toHaveLength(1);
  });

  it('TASK_CREATE mints `count` distinct tasks', () => {
    const state = reducer({ tasks: [] }, { type: 'TASK_CREATE', preset: { name: 'Escort' }, count: 2 });
    expect(state.tasks).toHaveLength(2);
    expect(ids(state.tasks).size).toBe(2);
  });

  it('INVENTORY_ADD stacks `count` packs of the preset quantity into one row', () => {
    const state = reducer({ inventory: [] },
      { type: 'INVENTORY_ADD', preset: { name: 'Arrow', quantity: 20 }, count: 3 });
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].quantity).toBe(60);
  });

  it('INVENTORY_ADD without a count adds a single pack', () => {
    const state = reducer({ inventory: [] },
      { type: 'INVENTORY_ADD', preset: { name: 'Rope', quantity: 2 } });
    expect(state.inventory[0].quantity).toBe(2);
  });

  it('a non-positive or invalid count falls back to one copy', () => {
    expect(reducer({ agents: [] }, { type: 'AGENT_CREATE', count: 0 }).agents).toHaveLength(1);
    expect(reducer({ agents: [] }, { type: 'AGENT_CREATE', count: -4 }).agents).toHaveLength(1);
    expect(reducer({ tasks: [] }, { type: 'TASK_CREATE', count: NaN }).tasks).toHaveLength(1);
  });
});

describe('inventory identity merge on edit (issue #91)', () => {
  const inv = (items) => ({ inventory: items, tagRegistry: {} });
  const twoPotions = () => inv([
    { id: 'i1', name: 'Potion', quantity: 2, attributes: ['item:potion=1'], value: 0 },
    { id: 'i2', name: 'Potion', quantity: 3, attributes: ['item:potion=5'], value: 0 },
  ]);

  it('merges two same-name rows once a tag-value edit makes their tags match', () => {
    const state = reducer(twoPotions(),
      { type: 'INVENTORY_UPDATE_ITEM', id: 'i2', changes: { attributes: ['item:potion=1'] } });
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].id).toBe('i1');
    expect(state.inventory[0].quantity).toBe(5);
  });

  it('merges when a rename makes name AND tags match', () => {
    const state = reducer(
      inv([{ id: 'i1', name: 'Rope', quantity: 2, attributes: [] },
           { id: 'i2', name: 'Cord', quantity: 1, attributes: [] }]),
      { type: 'INVENTORY_UPDATE_ITEM', id: 'i2', changes: { name: 'Rope' } });
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].quantity).toBe(3);
  });

  it('does NOT merge on rename when tags still differ', () => {
    const state = reducer(
      inv([{ id: 'i1', name: 'Rope', quantity: 2, attributes: ['a:1'] },
           { id: 'i2', name: 'Cord', quantity: 1, attributes: ['b:2'] }]),
      { type: 'INVENTORY_UPDATE_ITEM', id: 'i2', changes: { name: 'Rope' } });
    expect(state.inventory).toHaveLength(2);
  });

  it('merges when adding a tag makes the item match another row', () => {
    const state = reducer(
      inv([{ id: 'i1', name: 'Kit', quantity: 2, attributes: ['tool:smith'] },
           { id: 'i2', name: 'Kit', quantity: 1, attributes: [] }]),
      { type: 'TAG_APPLY', target: { type: 'item', id: 'i2' }, tag: 'tool:smith' });
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].quantity).toBe(3);
  });

  it('merges when removing a tag makes the item match another row', () => {
    const state = reducer(
      inv([{ id: 'i1', name: 'Wand', quantity: 2, attributes: [] },
           { id: 'i2', name: 'Wand', quantity: 1, attributes: ['item:wand'] }]),
      { type: 'INVENTORY_REMOVE_ATTRIBUTE', id: 'i2', index: 0 });
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].quantity).toBe(3);
  });

  it('leaves distinct rows alone when a non-identity field (value) is edited', () => {
    const state = reducer(twoPotions(),
      { type: 'INVENTORY_UPDATE_ITEM', id: 'i2', changes: { value: 99 } });
    expect(state.inventory).toHaveLength(2);
  });
});

describe('locked-mode creation gate', () => {
  const lockedState = () => ({
    agents: [], tasks: [], inventory: [],
    tagRegistry: { skill: { arcana: {} }, trait: { brave: {} } },
  });

  it('blocks creation of entities carrying unregistered tags, same reference', () => {
    const state = lockedState();
    const preset = { attributes: ['rarity:common'] };
    expect(reducer(state, { type: 'AGENT_CREATE', preset, locked: true })).toBe(state);
    expect(reducer(state, { type: 'TASK_CREATE', preset, locked: true })).toBe(state);
    expect(reducer(state, { type: 'INVENTORY_ADD', preset, locked: true })).toBe(state);
  });

  it('creates when every tag is registered, stripping modifiers and values', () => {
    const next = reducer(lockedState(), {
      type: 'AGENT_CREATE',
      preset: { attributes: ['req,skill:arcana=2', 'trait:brave'] },
      locked: true,
    });
    expect(next.agents).toHaveLength(1);
  });

  it('always allows blank creates, locked or not', () => {
    const state = lockedState();
    const next = reducer(state, { type: 'AGENT_CREATE', locked: true });
    expect(next.agents).toHaveLength(1);
    expect(next.tagRegistry).toBe(state.tagRegistry); // registry untouched
  });

  it('registers unregistered preset tags when unlocked (missing locked field)', () => {
    const next = reducer(lockedState(), {
      type: 'AGENT_CREATE',
      preset: { attributes: ['class:fighter=1', 'req,rarity:common'] },
    });
    expect(next.agents).toHaveLength(1);
    expect(next.tagRegistry.class).toEqual({ fighter: {} }); // value stripped
    expect(next.tagRegistry.rarity).toEqual({ common: {} }); // modifier stripped
  });

  it('validates task condition pattern links against the registry', () => {
    const state = lockedState();
    const hollow = { conditions: [{ name: 'X', target: 1, tracker: { kind: 'work', tagPath: 'spell:*' } }] };
    const matching = { conditions: [{ name: 'X', target: 1, tracker: { kind: 'work', tagPath: 'skill:*' } }] };
    expect(reducer(state, { type: 'TASK_CREATE', preset: hollow, locked: true })).toBe(state);
    const next = reducer(state, { type: 'TASK_CREATE', preset: matching, locked: true });
    expect(next.tasks).toHaveLength(1);
    expect(next.tagRegistry).toEqual(state.tagRegistry); // patterns are never registered
  });

  it('registers literal condition tag paths on task creation', () => {
    const preset = { conditions: [{ name: 'X', target: 5, tracker: { kind: 'work', tagPath: 'skill:stealth' } }] };
    const next = reducer(lockedState(), { type: 'TASK_CREATE', preset });
    expect(next.tagRegistry.skill.stealth).toEqual({});
  });

  it('neither blocks nor registers dynamic instance tags', () => {
    const state = lockedState();
    const preset = { attributes: ['bind:weapon:item:sword', 'task:abc123'] };
    const blocked = reducer(state, { type: 'AGENT_CREATE', preset, locked: true });
    expect(blocked.agents).toHaveLength(1);
    expect(blocked.tagRegistry).toEqual(state.tagRegistry);
  });

  it('blocks all copies of a multi-count order atomically', () => {
    const state = lockedState();
    const next = reducer(state, { type: 'AGENT_CREATE', preset: { attributes: ['rarity:common'] }, count: 3, locked: true });
    expect(next).toBe(state);
  });
});

describe('DYN_RECONCILE', () => {
  const rules = normalizeRulesConfig({ dynamic: { ac: '[10+floor(({ability:dex}-10)/2)]' } });

  it('materializes dyn payloads from the rules riding on the action', () => {
    const state = {
      ...baseState(),
      agents: [{ id: 'a1', attributes: ['ability:dex=14', 'dyn,ac'], activities: [] }],
    };
    const next = reducer(state, { type: 'DYN_RECONCILE', rules });
    expect(next.agents[0].attributes).toContain('dyn,ac=12');
    expect(next.eventLog).toBe(state.eventLog); // never logs
  });

  it('returns the same state reference when nothing changes (loop safety)', () => {
    const state = {
      ...baseState(),
      agents: [{ id: 'a1', attributes: ['ability:dex=14', 'dyn,ac=12'], activities: [] }],
    };
    expect(reducer(state, { type: 'DYN_RECONCILE', rules })).toBe(state);
  });
});
