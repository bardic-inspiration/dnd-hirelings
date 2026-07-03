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
