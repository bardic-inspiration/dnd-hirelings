import { describe, it, expect } from 'vitest';
import {
  routeTaskTag, checkTaskComplete, applyResults, applyTaskComplete, computeBlockedTaskIds,
} from './tasks.js';

describe('routeTaskTag', () => {
  it('routes req/block modifiers to requirements, everything else to attributes', () => {
    expect(routeTaskTag('req,skill:arcana=2')).toBe('requirements');
    expect(routeTaskTag('block,trait:undead')).toBe('requirements');
    expect(routeTaskTag('skill:arcana=3')).toBe('attributes');
    expect(routeTaskTag('bonus,ability:str=2')).toBe('attributes');
  });
});

describe('checkTaskComplete', () => {
  const withConditions = (conditions) => ({ conditions });

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
});

describe('applyResults', () => {
  it('adds new reward items and merges into an existing stack by name', () => {
    const task = { results: { gold: 0, items: [{ name: 'Ring', quantity: 2 }], agents: [] } };
    const inventory = [{ id: 'i1', name: 'ring', quantity: 1, attributes: [] }];
    const { newInventory } = applyResults(task, inventory, []);
    expect(newInventory).toHaveLength(1);
    expect(newInventory[0].quantity).toBe(3);
  });

  it('spawns reward agents from templates and returns the gold delta', () => {
    const task = { results: {
      gold: 50,
      items: [],
      agents: [{ template: { name: 'GOBLIN' }, quantity: 2 }],
    } };
    const { newAgents, bankDelta, spawnedAgentIds } = applyResults(task, [], []);
    expect(bankDelta).toBe(50);
    expect(newAgents).toHaveLength(2);
    expect(newAgents.every(agent => agent.name === 'GOBLIN' && agent.id)).toBe(true);
    expect(spawnedAgentIds).toEqual(newAgents.map(agent => agent.id));
  });

  it('does not mutate the source inventory', () => {
    const inventory = [{ id: 'i1', name: 'ring', quantity: 1, attributes: [] }];
    applyResults({ results: { items: [{ name: 'ring', quantity: 1 }] } }, inventory, []);
    expect(inventory[0].quantity).toBe(1);
  });
});

describe('applyTaskComplete', () => {
  it('marks the task complete and unassigns every agent from it', () => {
    const tasks = [{ id: 't1', isComplete: false, results: { gold: 0, items: [], agents: [] } }];
    const agents = [
      { id: 'a1', activities: ['task:t1', 'item:sword=1'] },
      { id: 'a2', activities: ['task:t2'] },
    ];
    const { newTasks, newAgents, unassignedAgentIds } = applyTaskComplete('t1', tasks, agents, []);
    expect(newTasks[0].isComplete).toBe(true);
    expect(newAgents[0].activities).toEqual(['item:sword=1']);
    expect(newAgents[1].activities).toEqual(['task:t2']);
    expect(unassignedAgentIds).toEqual(['a1']);
  });

  it('is a no-op for an unknown task id', () => {
    const tasks = [{ id: 't1', isComplete: false }];
    const result = applyTaskComplete('nope', tasks, [], []);
    expect(result.newTasks).toBe(tasks);
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
