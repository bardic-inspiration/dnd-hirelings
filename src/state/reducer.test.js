import { describe, it, expect } from 'vitest';
import { reducer } from './reducer.js';

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
