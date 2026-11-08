import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadState, normalizeState, STORAGE_KEYS, DEFAULT_STATE } from './storage.js';

const v6Task = {
  id: 't1', name: 'T', requirements: [], attributes: [], isComplete: false, createdAt: 1,
  conditions: [{ id: 'c1', name: 'WORK', target: 4, progress: 2, tracker: { kind: 'work', tagPath: null, compare: null } }],
  results: { gold: 5, items: [], agents: [] },
};

describe('normalizeState task lowering', () => {
  it('lowers v6 tasks into the engine shape', () => {
    const [task] = normalizeState({ tasks: [v6Task] }).tasks;
    expect(task).not.toHaveProperty('conditions');
    expect(task).not.toHaveProperty('results');
    expect(task.vessels).toEqual({ c1: { name: 'WORK', fullWhen: '>= 4' } });
    expect(task.blackboard).toEqual({ c1: 2 });
    expect(task.effects).toEqual([{ on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 5 } }] }]);
  });

  it('migrates pre-v4 work tags through conditions into vessels', () => {
    const [task] = normalizeState({ tasks: [{ id: 't1', work: ['work:skill:arcana=10'], workProgress: { 'skill:arcana': 3 } }] }).tasks;
    expect(Object.values(task.vessels)).toEqual([{ name: 'ARCANA', fullWhen: '>= 10' }]);
    expect(Object.values(task.blackboard)).toEqual([3]);
  });

  it('is idempotent: a normalized state normalizes to itself', () => {
    const once = normalizeState({ tasks: [v6Task] });
    expect(normalizeState(JSON.parse(JSON.stringify(once))).tasks).toEqual(once.tasks);
  });
});

describe('loadState', () => {
  let store;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', { getItem: (key) => store[key] ?? null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads the v7 save first', () => {
    store[STORAGE_KEYS.STATE] = JSON.stringify({ session: { title: 'SEVEN' } });
    store[STORAGE_KEYS.LEGACY_STATE] = JSON.stringify({ session: { title: 'SIX' } });
    expect(loadState().session.title).toBe('SEVEN');
  });

  it('falls back to the v6 save and lowers it', () => {
    store[STORAGE_KEYS.LEGACY_STATE] = JSON.stringify({ tasks: [v6Task] });
    expect(STORAGE_KEYS.STATE).toBe('dnd-hirelings-state-v7');
    expect(loadState().tasks[0].vessels).toEqual({ c1: { name: 'WORK', fullWhen: '>= 4' } });
  });

  it('returns the default state when neither exists', () => {
    expect(loadState()).toBe(DEFAULT_STATE);
  });
});
