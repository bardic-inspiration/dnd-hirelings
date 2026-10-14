import { describe, it, expect } from 'vitest';
import {
  lowerTask, conditionsView, resultsView, addCondition, updateCondition, removeCondition,
  setResults, resetVessels, parseFullWhen, vesselFill, isVesselFull, WORK_EXPRESSION,
} from './taskModel.js';

const legacyTask = (overrides = {}) => ({
  id: 't1', name: 'T', description: '', requirements: [], attributes: [], isComplete: false, createdAt: 1,
  conditions: [
    { id: 'c1', name: 'ARCANA', target: 12, progress: 3, tracker: { kind: 'work', tagPath: 'skill:arcana', compare: null } },
    { id: 'c2', name: 'WORK', target: 4, progress: 0, tracker: { kind: 'work', tagPath: null, compare: null } },
    { id: 'c3', name: 'ANY ≥ 2', target: 9, progress: 0, tracker: { kind: 'work', tagPath: 'skill:*', compare: { op: '>=', value: '2' } } },
  ],
  results: {
    gold: 25,
    items: [{ name: 'rope', quantity: 2 }],
    agents: [{ template: { name: 'SQUIRE', icon: '', rate: 1, rateUnit: 'GP/DAY', description: '', attributes: [] }, quantity: 1 }],
  },
  ...overrides,
});

describe('lowerTask', () => {
  it('lowers each condition to a gate (when linked), a contribute, a vessel, and its fill', () => {
    const task = lowerTask(legacyTask());
    expect(task.operators).toEqual([
      { id: 'c1-gate', kind: 'gate', read: 'skill:arcana' },
      { id: 'c1', kind: 'contribute', target: 'c1', expr: WORK_EXPRESSION },
      { id: 'c2', kind: 'contribute', target: 'c2', expr: WORK_EXPRESSION },
      { id: 'c3-gate', kind: 'gate', read: 'skill:*', compare: { op: '>=', value: '2' } },
      { id: 'c3', kind: 'contribute', target: 'c3', expr: WORK_EXPRESSION },
    ]);
    expect(task.vessels).toEqual({
      c1: { name: 'ARCANA', fullWhen: '>= 12' },
      c2: { name: 'WORK', fullWhen: '>= 4' },
      c3: { name: 'ANY ≥ 2', fullWhen: '>= 9' },
    });
    expect(task.blackboard).toEqual({ c1: 3, c2: 0, c3: 0 });
  });

  it('lowers results to one completion effect: bank.adjust, inventory.add per item, agent.spawn per agent', () => {
    const task = lowerTask(legacyTask());
    expect(task.effects).toEqual([{ on: 'completion', actions: [
      { kind: 'bank.adjust', params: { amount: 25 } },
      { kind: 'inventory.add', params: { name: 'rope', quantity: 2 } },
      { kind: 'agent.spawn', params: { template: legacyTask().results.agents[0].template, quantity: 1 } },
    ] }]);
  });

  it('stores neither conditions nor results, and defaults the engine fields', () => {
    const task = lowerTask({ id: 't2', name: 'BLANK' });
    expect(task).not.toHaveProperty('conditions');
    expect(task).not.toHaveProperty('results');
    expect(task).toMatchObject({ operators: [], vessels: {}, effects: [], blackboard: {}, duration: null });
  });

  it('is idempotent', () => {
    const once = lowerTask(legacyTask());
    expect(lowerTask(once)).toEqual(once);
  });

  it('lowers an unknown tracker kind to an inert write operator carrying its payload', () => {
    const task = lowerTask(legacyTask({
      conditions: [{ id: 'c9', name: 'ODD', target: 2, progress: 1, tracker: { kind: 'tally', tagPath: null, compare: null } }],
    }));
    expect(task.operators).toEqual([{ id: 'c9', kind: 'write', payload: { kind: 'tally', tagPath: null, compare: null } }]);
    expect(task.vessels.c9).toEqual({ name: 'ODD', fullWhen: '>= 2' });
    expect(task.blackboard.c9).toBe(1);
  });

  it('keeps authored engine fields and drops malformed entries', () => {
    const task = lowerTask({
      id: 't3',
      operators: [{ id: 'g', kind: 'gate', expr: 'd20>=11' }, null, { kind: 'contribute' }],
      vessels: { found: { fullWhen: '>= 4' }, bad: 'x' },
      effects: [{ on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 50 } }, { params: {} }] }, 7],
      blackboard: { found: 2, note: 'x', ok: true, nested: { no: 1 } },
      duration: { kind: 'fixed', ticks: 4 },
    });
    expect(task.operators).toEqual([{ id: 'g', kind: 'gate', expr: 'd20>=11' }, { id: 'op-2', kind: 'contribute' }]);
    expect(task.vessels).toEqual({ found: { fullWhen: '>= 4' }, bad: { fullWhen: '>= 1' } });
    expect(task.effects).toEqual([{ on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 50 } }] }]);
    expect(task.blackboard).toEqual({ found: 2, note: 'x', ok: true });
    expect(task.duration).toEqual({ kind: 'fixed', ticks: 4 });
  });
});

describe('vessels', () => {
  it('parses fullWhen into a comparison term, or null when malformed', () => {
    expect(parseFullWhen('>= 4')).toEqual({ op: '>=', value: '4' });
    expect(parseFullWhen('==2')).toEqual({ op: '==', value: '2' });
    expect(parseFullWhen('!= 2')).toBeNull();
    expect(parseFullWhen('soon')).toBeNull();
  });

  it('reads the fill from the blackboard and tests fullWhen against it, failing closed', () => {
    const task = { vessels: { a: { fullWhen: '>= 4' }, b: { fullWhen: 'junk' } }, blackboard: { a: 4, b: 9 } };
    expect(vesselFill(task, 'a')).toBe(4);
    expect(vesselFill(task, 'missing')).toBe(0);
    expect(isVesselFull(task, 'a')).toBe(true);
    expect(isVesselFull(task, 'b')).toBe(false);
  });
});

describe('conditionsView', () => {
  it('maps lowered vessels back to the condition rows the card renders', () => {
    const view = conditionsView(lowerTask(legacyTask()));
    expect(view).toEqual([
      { id: 'c1', name: 'ARCANA', progress: 3, target: 12, tracker: { kind: 'work', tagPath: 'skill:arcana', compare: null } },
      { id: 'c2', name: 'WORK', progress: 0, target: 4, tracker: { kind: 'work', tagPath: null, compare: null } },
      { id: 'c3', name: 'ANY ≥ 2', progress: 0, target: 9, tracker: { kind: 'work', tagPath: 'skill:*', compare: { op: '>=', value: '2' } } },
    ]);
  });

  it('names an authored vessel by its key and reads its target from fullWhen', () => {
    const view = conditionsView(lowerTask({ id: 't', vessels: { found: { fullWhen: '>= 4' } }, blackboard: { found: 1 } }));
    expect(view).toEqual([{ id: 'found', name: 'found', progress: 1, target: 4, tracker: { kind: 'work', tagPath: null, compare: null } }]);
  });
});

describe('resultsView', () => {
  it('round-trips legacy results losslessly', () => {
    expect(resultsView(lowerTask(legacyTask()))).toEqual(legacyTask().results);
    expect(resultsView(lowerTask(legacyTask({ results: { gold: 0, items: [], agents: [] } }))))
      .toEqual({ gold: 0, items: [], agents: [] });
  });

  it('round-trips the raw values the results section writes, without normalizing them away', () => {
    const edited = setResults(lowerTask(legacyTask()), { items: [{ name: '', quantity: 0 }], gold: -5 });
    expect(resultsView(edited)).toEqual({ ...legacyTask().results, items: [{ name: '', quantity: 0 }], gold: -5 });
  });

  it('sums every completion bank.adjust and ignores non-completion effects', () => {
    const task = lowerTask({ id: 't', effects: [
      { on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 20 } }, { kind: 'flag.set', params: { key: 'x', value: 1 } }] },
      { on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 30 } }] },
      { on: 'pass', actions: [{ kind: 'bank.adjust', params: { amount: 99 } }] },
    ] });
    expect(resultsView(task).gold).toBe(50);
  });
});

describe('setResults', () => {
  it('rewrites only the result kinds, keeping other completion actions', () => {
    const task = lowerTask({ id: 't', effects: [
      { on: 'completion', actions: [{ kind: 'flag.set', params: { key: 'x', value: 1 } }, { kind: 'bank.adjust', params: { amount: 20 } }] },
    ] });
    expect(setResults(task, { gold: 7 }).effects).toEqual([{ on: 'completion', actions: [
      { kind: 'bank.adjust', params: { amount: 7 } },
      { kind: 'flag.set', params: { key: 'x', value: 1 } },
    ] }]);
  });

  it('adds a completion effect when there is none, and drops one left empty', () => {
    const withGold = setResults(lowerTask({ id: 't' }), { gold: 5 });
    expect(withGold.effects).toEqual([{ on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 5 } }] }]);
    expect(setResults(withGold, { gold: 0 }).effects).toEqual([]);
  });
});

describe('condition sugar', () => {
  it('addCondition lowers a template with a fresh key and zero fill', () => {
    const task = addCondition(lowerTask({ id: 't' }), { name: 'ARCANA', target: 30, tracker: { kind: 'work', tagPath: 'skill:arcana', compare: null } });
    const [row] = conditionsView(task);
    expect(row).toMatchObject({ name: 'ARCANA', progress: 0, target: 30, tracker: { tagPath: 'skill:arcana' } });
    expect(task.operators.map(op => op.id)).toEqual([`${row.id}-gate`, row.id]);
  });

  it('updateCondition edits name, target (keeping the operator), and progress', () => {
    let task = lowerTask(legacyTask());
    task = updateCondition(task, 'c1', { name: 'ARC', target: 20, progress: 5 });
    expect(task.vessels.c1).toEqual({ name: 'ARC', fullWhen: '>= 20' });
    expect(task.blackboard.c1).toBe(5);
    task = lowerTask({ id: 't', vessels: { v: { fullWhen: '== 3' } } });
    expect(updateCondition(task, 'v', { target: 6 }).vessels.v.fullWhen).toBe('== 6');
  });

  it('removeCondition drops the vessel, its fill, and its lowered operators', () => {
    const task = removeCondition(lowerTask(legacyTask()), 'c1');
    expect(Object.keys(task.vessels)).toEqual(['c2', 'c3']);
    expect(task.blackboard).not.toHaveProperty('c1');
    expect(task.operators.map(op => op.id)).toEqual(['c2', 'c3-gate', 'c3']);
  });

  it('resetVessels zeroes every fill and keeps other blackboard entries', () => {
    const task = lowerTask({ ...legacyTask(), blackboard: { note: 'x' } });
    expect(resetVessels(task)).toEqual({ note: 'x', c1: 0, c2: 0, c3: 0 });
  });
});
