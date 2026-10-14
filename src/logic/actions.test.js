import { describe, it, expect } from 'vitest';
import { ACTION_REGISTRY, applyActions, reverseActionRow, resolveSelector } from './actions.js';
import { DEFAULT_ROLLBACK_CONFIG, normalizeRollbackConfig } from './rollback.js';

const makeWorld = (overrides = {}) => ({
  session: { bank: 100, clock: 3 },
  agents: [
    { id: 'a1', name: 'A', attributes: ['skill:arcana=3'], activities: ['task:t1'] },
    { id: 'a2', name: 'B', attributes: ['skill:combat=1'], activities: ['task:t1'] },
    { id: 'a3', name: 'C', attributes: [], activities: [] },
  ],
  tasks: [{ id: 't1', name: 'T', operators: [], vessels: { v: { fullWhen: '>= 4' } }, effects: [], blackboard: { v: 1 } }],
  inventory: [{ id: 'i1', name: 'Rope', quantity: 2, icon: '', description: '', value: 0, attributes: [] }],
  tagRegistry: { skill: { arcana: {}, combat: {} } },
  ...overrides,
});

const ctx = { taskId: 't1', locked: false, outcomes: { combat: { pass: ['a1'], fail: ['a2'] } } };

// Applies one action, then reverses its record as rollback would.
const roundTrip = (world, action, reverse = DEFAULT_ROLLBACK_CONFIG.reverse) => {
  const applied = applyActions(world, [action], ctx);
  const [record] = applied.records;
  const row = { taskId: 't1', actionKind: record.kind, data: { params: record.params, deltas: record.deltas }, reverseData: record.reverseData };
  return { applied, record, reversed: reverseActionRow(applied.world, row, reverse) };
};

describe('resolveSelector', () => {
  it('selects assigned agents, optionally narrowed by a tag pattern', () => {
    const world = makeWorld();
    expect(resolveSelector(world, { scope: 'assigned' }, ctx)).toEqual(['a1', 'a2']);
    expect(resolveSelector(world, { scope: 'assigned', match: 'skill:combat' }, ctx)).toEqual(['a2']);
    expect(resolveSelector(world, undefined, ctx)).toEqual(['a1', 'a2']);
  });

  it('selects by an operator outcome and by entity id, skipping missing agents', () => {
    const world = makeWorld();
    expect(resolveSelector(world, { scope: 'operator', operatorId: 'combat', outcome: 'fail' }, ctx)).toEqual(['a2']);
    expect(resolveSelector(world, { scope: 'entity', id: 'a3' }, ctx)).toEqual(['a3']);
    expect(resolveSelector(world, { scope: 'entity', id: 'gone' }, ctx)).toEqual([]);
    expect(resolveSelector(world, { scope: 'nowhere' }, ctx)).toEqual([]);
  });
});

describe('vessel.deposit', () => {
  it('adds to the fill and reverses by subtracting the row delta, clamped at 0', () => {
    const { world } = applyActions(makeWorld(), [{ kind: 'vessel.deposit', params: { vessel: 'v', amount: 3 } }], ctx);
    expect(world.tasks[0].blackboard.v).toBe(4);
    const row = { eventType: 'work_contribution', taskId: 't1', conditionId: 'v', delta: 9, actionKind: 'vessel.deposit' };
    expect(reverseActionRow(world, row, DEFAULT_ROLLBACK_CONFIG.reverse).tasks[0].blackboard.v).toBe(0);
  });
});

describe('bank.adjust', () => {
  it('adds the amount and reverses by negating, clamped at 0', () => {
    const { applied, record, reversed } = roundTrip(makeWorld(), { kind: 'bank.adjust', params: { amount: 50 } });
    expect(applied.world.session.bank).toBe(150);
    expect(record).toMatchObject({ kind: 'bank.adjust', deltas: { amount: 50 }, reverseData: {} });
    expect(reversed.session.bank).toBe(100);
    const spent = { ...applied.world, session: { bank: 20 } };
    const row = { taskId: 't1', actionKind: 'bank.adjust', data: { deltas: { amount: 50 } }, reverseData: {} };
    expect(reverseActionRow(spent, row, DEFAULT_ROLLBACK_CONFIG.reverse).session.bank).toBe(0);
  });

  it('is gated by reverse.rewardGold', () => {
    const { reversed } = roundTrip(makeWorld(), { kind: 'bank.adjust', params: { amount: 50 } },
      normalizeRollbackConfig({ reverse: { rewardGold: false } }).reverse);
    expect(reversed.session.bank).toBe(150);
  });
});

describe('inventory.add / inventory.remove', () => {
  it('adds by case-insensitive name, creating a blank row when missing', () => {
    const { world } = applyActions(makeWorld(), [
      { kind: 'inventory.add', params: { name: 'rope', quantity: 2 } },
      { kind: 'inventory.add', params: { name: 'Gem', quantity: 1 } },
    ], ctx);
    expect(world.inventory.map(item => [item.name, item.quantity])).toEqual([['Rope', 4], ['Gem', 1]]);
    expect(world.inventory[1]).toMatchObject({ icon: '', description: '', value: 0, attributes: [] });
  });

  it('skips a nameless or non-positive add without a record', () => {
    const { world, records } = applyActions(makeWorld(), [{ kind: 'inventory.add', params: { name: '', quantity: 2 } },
      { kind: 'inventory.add', params: { name: 'Rope', quantity: 0 } }], ctx);
    expect(records).toEqual([]);
    expect(world.inventory[0].quantity).toBe(2);
  });

  it('reverses an add by removing the quantity, clamped at 0', () => {
    const { reversed } = roundTrip(makeWorld(), { kind: 'inventory.add', params: { name: 'Rope', quantity: 5 } });
    expect(reversed.inventory[0].quantity).toBe(2);
  });

  it('removes at most the stock, and reverses by returning what it removed', () => {
    const { applied, record, reversed } = roundTrip(makeWorld(), { kind: 'inventory.remove', params: { name: 'rope', quantity: 5 } });
    expect(applied.world.inventory[0].quantity).toBe(0);
    expect(record.deltas).toEqual({ name: 'rope', quantity: 2 });
    expect(reversed.inventory[0].quantity).toBe(2);
  });
});

describe('agent.spawn / agent.remove', () => {
  it('spawns from a template and reverses by deleting the spawned agents', () => {
    const template = { name: 'SQUIRE', attributes: ['skill:arcana=1'] };
    const { applied, record, reversed } = roundTrip(makeWorld(), { kind: 'agent.spawn', params: { template, quantity: 2 } });
    expect(applied.world.agents).toHaveLength(5);
    expect(applied.world.agents[3]).toMatchObject({ name: 'SQUIRE', rate: 1, rateUnit: 'GP/DAY', activities: [], lastAssigned: null });
    expect(record.deltas.agentIds).toHaveLength(2);
    expect(reversed.agents.map(agent => agent.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('removes selected agents and has no reverse', () => {
    const { applied, reversed } = roundTrip(makeWorld(), {
      kind: 'agent.remove', params: { selector: { scope: 'operator', operatorId: 'combat', outcome: 'fail' } },
    });
    expect(applied.world.agents.map(agent => agent.id)).toEqual(['a1', 'a3']);
    expect(ACTION_REGISTRY['agent.remove'].reverse).toBeNull();
    expect(reversed.agents.map(agent => agent.id)).toEqual(['a1', 'a3']);
  });
});

describe('agent.assign / agent.unassign', () => {
  it('unassigns the selected agents and reverses by reassigning them', () => {
    const { applied, record, reversed } = roundTrip(makeWorld(), { kind: 'agent.unassign', params: { selector: { scope: 'assigned' } } });
    expect(applied.world.agents.map(agent => agent.activities)).toEqual([[], [], []]);
    expect(record.deltas).toEqual({ agentIds: ['a1', 'a2'], taskId: 't1' });
    expect(reversed.agents.map(agent => agent.activities)).toEqual([['task:t1'], ['task:t1'], []]);
  });

  it('assigns agents not yet assigned and reverses by unassigning only those', () => {
    const { applied, reversed } = roundTrip(makeWorld(), { kind: 'agent.assign', params: { selector: { scope: 'entity', id: 'a3' } } });
    expect(applied.world.agents[2].activities).toEqual(['task:t1']);
    expect(reversed.agents.map(agent => agent.activities)).toEqual([['task:t1'], ['task:t1'], []]);
  });

  it('is gated by reverse.agentReassignment', () => {
    const { reversed } = roundTrip(makeWorld(), { kind: 'agent.unassign', params: {} },
      normalizeRollbackConfig({ reverse: { agentReassignment: false } }).reverse);
    expect(reversed.agents[0].activities).toEqual([]);
  });
});

describe('tag actions', () => {
  it('tag.apply merges a tag and restores the pre-image on reverse', () => {
    const { applied, reversed } = roundTrip(makeWorld(), {
      kind: 'tag.apply', params: { selector: { scope: 'entity', id: 'a1' }, tag: 'skill:arcana=5' },
    });
    expect(applied.world.agents[0].attributes).toEqual(['skill:arcana=5']);
    expect(reversed.agents[0].attributes).toEqual(['skill:arcana=3']);
  });

  it('tag.remove drops the tag and re-adds it on reverse', () => {
    const { applied, reversed } = roundTrip(makeWorld(), {
      kind: 'tag.remove', params: { selector: { scope: 'entity', id: 'a1' }, tag: 'skill:arcana' },
    });
    expect(applied.world.agents[0].attributes).toEqual([]);
    expect(reversed.agents[0].attributes).toEqual(['skill:arcana=3']);
  });

  it('tag.adjust shifts a numeric value (creating it when missing) and restores the pre-image', () => {
    const { applied, reversed } = roundTrip(makeWorld(), {
      kind: 'tag.adjust', params: { selector: { scope: 'assigned' }, path: 'skill:arcana', by: 2 },
    });
    expect(applied.world.agents[0].attributes).toEqual(['skill:arcana=5']);
    expect(applied.world.agents[1].attributes).toEqual(['skill:combat=1', 'skill:arcana=2']);
    expect(reversed.agents[0].attributes).toEqual(['skill:arcana=3']);
    expect(reversed.agents[1].attributes).toEqual(['skill:combat=1']);
  });
});

describe('flag.set / flag.clear', () => {
  it('writes the blackboard and restores the pre-image on reverse', () => {
    const set = roundTrip(makeWorld(), { kind: 'flag.set', params: { key: 'alarm', value: true } });
    expect(set.applied.world.tasks[0].blackboard.alarm).toBe(true);
    expect(set.reversed.tasks[0].blackboard).toEqual({ v: 1 });
    const cleared = roundTrip(makeWorld(), { kind: 'flag.clear', params: { key: 'v' } });
    expect(cleared.applied.world.tasks[0].blackboard).toEqual({});
    expect(cleared.reversed.tasks[0].blackboard).toEqual({ v: 1 });
  });
});

describe('object.create', () => {
  it('creates an item, an agent, or a task, and deletes it on reverse', () => {
    const item = roundTrip(makeWorld(), { kind: 'object.create', params: { kind: 'item', template: { name: 'Map' } } });
    expect(item.applied.world.inventory[1]).toMatchObject({ name: 'Map', quantity: 1 });
    expect(item.reversed.inventory).toHaveLength(1);

    const task = roundTrip(makeWorld(), { kind: 'object.create', params: { kind: 'task', template: { name: 'NEXT' } } });
    expect(task.applied.world.tasks[1]).toMatchObject({ name: 'NEXT', isComplete: false, operators: [], vessels: {} });
    expect(task.reversed.tasks).toHaveLength(1);

    const agent = roundTrip(makeWorld(), { kind: 'object.create', params: { kind: 'agent', template: { name: 'GUIDE' } } });
    expect(agent.applied.world.agents[3]).toMatchObject({ name: 'GUIDE' });
    expect(agent.reversed.agents).toHaveLength(3);
  });
});

describe('locked mode', () => {
  const lockedCtx = { ...ctx, locked: true };

  it('skips a tag-writing action with an unregistered path and marks it locked', () => {
    const { world, records } = applyActions(makeWorld(), [
      { kind: 'tag.apply', params: { selector: { scope: 'entity', id: 'a1' }, tag: 'trait:brave' } },
      { kind: 'agent.spawn', params: { template: { name: 'X', attributes: ['skill:sword=1'] }, quantity: 1 } },
    ], lockedCtx);
    expect(world.agents).toEqual(makeWorld().agents);
    expect(records.map(record => record.skipped)).toEqual(['locked', 'locked']);
  });

  it('runs registered tag writes when locked, and registers new paths when unlocked', () => {
    const locked = applyActions(makeWorld(), [{ kind: 'tag.adjust', params: { selector: { scope: 'entity', id: 'a3' }, path: 'skill:arcana', by: 1 } }], lockedCtx);
    expect(locked.world.agents[2].attributes).toEqual(['skill:arcana=1']);
    const unlocked = applyActions(makeWorld(), [{ kind: 'tag.apply', params: { selector: { scope: 'entity', id: 'a3' }, tag: 'trait:brave' } }], ctx);
    expect(unlocked.world.tagRegistry.trait).toEqual({ brave: {} });
  });

  it('leaves the world untouched when reversing a skipped row', () => {
    const row = { taskId: 't1', actionKind: 'bank.adjust', data: { deltas: null, skipped: 'locked' }, reverseData: {} };
    expect(reverseActionRow(makeWorld(), row, DEFAULT_ROLLBACK_CONFIG.reverse)).toEqual(makeWorld());
  });
});

describe('applyActions', () => {
  it('records an unknown kind as skipped and never throws', () => {
    const { world, records } = applyActions(makeWorld(), [{ kind: 'journal.write', params: {} }], ctx);
    expect(world).toEqual(makeWorld());
    expect(records).toEqual([{ kind: 'journal.write', params: {}, deltas: null, reverseData: {}, skipped: 'unknown' }]);
  });

  it('does not mutate the input world', () => {
    const world = makeWorld();
    applyActions(world, [
      { kind: 'bank.adjust', params: { amount: 5 } },
      { kind: 'flag.set', params: { key: 'x', value: 1 } },
      { kind: 'inventory.add', params: { name: 'Rope', quantity: 1 } },
      { kind: 'agent.unassign', params: {} },
    ], ctx);
    expect(world).toEqual(makeWorld());
  });
});
