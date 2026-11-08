import { describe, it, expect } from 'vitest';
import { routeTaskTag, checkTaskComplete, completeTask, computeBlockedTaskIds } from './tasks.js';
import { lowerTask } from './taskModel.js';

describe('routeTaskTag', () => {
  it('routes req/block modifiers to requirements, everything else to attributes', () => {
    expect(routeTaskTag('req,skill:arcana=2')).toBe('requirements');
    expect(routeTaskTag('block,trait:undead')).toBe('requirements');
    expect(routeTaskTag('skill:arcana=3')).toBe('attributes');
    expect(routeTaskTag('bonus,ability:str=2')).toBe('attributes');
  });
});

describe('checkTaskComplete', () => {
  // Lowered from legacy conditions, so each condition is a vessel.
  const withConditions = (conditions) => lowerTask({
    id: 't', conditions: conditions.map((condition, index) => ({
      id: `c${index}`, name: 'C', tracker: { kind: 'work', tagPath: null, compare: null }, ...condition,
    })),
  });

  it('completes only when every condition meets its target', () => {
    expect(checkTaskComplete(withConditions([
      { progress: 5, target: 5 }, { progress: 10, target: 8 },
    ]))).toBe(true);
    expect(checkTaskComplete(withConditions([
      { progress: 5, target: 5 }, { progress: 2, target: 8 },
    ]))).toBe(false);
  });

  it('a zero-condition task defers to the clockAdvanced flag', () => {
    expect(checkTaskComplete(withConditions([]), true)).toBe(true);
    expect(checkTaskComplete(withConditions([]), false)).toBe(false);
  });

  it('counts only success vessels, and treats a task with none as zero-condition', () => {
    const task = lowerTask({ id: 't', vessels: {
      found: { fullWhen: '>= 2' }, clock: { fullWhen: '>= 9', success: false },
    }, blackboard: { found: 2 } });
    expect(checkTaskComplete(task)).toBe(true);
    const tally = lowerTask({ id: 't', vessels: { tally: { fullWhen: '>= 1', success: false } } });
    expect(checkTaskComplete(tally, false)).toBe(false);
    expect(checkTaskComplete(tally, true)).toBe(true);
  });
});

describe('completeTask', () => {
  const world = (results) => ({
    session: { bank: 10 },
    tasks: [lowerTask({ id: 't1', name: 'T', isComplete: false, results }), lowerTask({ id: 't2', isComplete: false })],
    agents: [
      { id: 'a1', activities: ['task:t1', 'item:sword=1'], attributes: [] },
      { id: 'a2', activities: ['task:t2'], attributes: [] },
    ],
    inventory: [{ id: 'i1', name: 'ring', quantity: 1, attributes: [] }],
    tagRegistry: {},
  });

  it('marks the task complete and unassigns every agent from it', () => {
    const { world: next, records } = completeTask(world({ gold: 0, items: [], agents: [] }), 't1');
    expect(next.tasks[0].isComplete).toBe(true);
    expect(next.agents[0].activities).toEqual(['item:sword=1']);
    expect(next.agents[1].activities).toEqual(['task:t2']);
    expect(records).toEqual([expect.objectContaining({ kind: 'agent.unassign', deltas: { agentIds: ['a1'], taskId: 't1' } })]);
  });

  it('pays the results view: items merge into a stack by name, agents spawn, gold lands', () => {
    const { world: next, records } = completeTask(world({
      gold: 25, items: [{ name: 'Ring', quantity: 2 }], agents: [{ template: { name: 'GOBLIN' }, quantity: 2 }],
    }), 't1');
    expect(next.inventory).toHaveLength(1);
    expect(next.inventory[0].quantity).toBe(3);
    expect(next.agents.slice(2).map(agent => agent.name)).toEqual(['GOBLIN', 'GOBLIN']);
    expect(next.session.bank).toBe(35);
    expect(records.map(record => record.kind)).toEqual(['agent.unassign', 'bank.adjust', 'inventory.add', 'agent.spawn']);
  });

  it('is a no-op for an unknown task id', () => {
    const before = world({ gold: 5 });
    const result = completeTask(before, 'nope');
    expect(result.world).toBe(before);
    expect(result.records).toEqual([]);
  });
});

describe('computeBlockedTaskIds', () => {
  it('blocks a task whose req,item cannot be satisfied by inventory', () => {
    const tasks = [{ id: 't1', createdAt: 1, requirements: ['req,item:sword=2'] }];
    expect(computeBlockedTaskIds(tasks, [{ name: 'sword', quantity: 1 }]).has('t1')).toBe(true);
    expect(computeBlockedTaskIds(tasks, [{ name: 'sword', quantity: 2 }]).has('t1')).toBe(false);
  });

  it('ignores non-item and non-req tags', () => {
    const tasks = [{ id: 't1', createdAt: 1, requirements: ['req,skill:arcana=2', 'block,item:cursed'] }];
    expect(computeBlockedTaskIds(tasks, []).has('t1')).toBe(false);
  });
});
