import { describe, it, expect } from 'vitest';
import { advanceTime } from './clock.js';
import {
  rollbackTick, getRollbackHorizon, normalizeRollbackConfig, DEFAULT_ROLLBACK_CONFIG,
} from './rollback.js';

// Same minimal world as clock.test.js: one agent working one single-condition task.
function makeState({ session, agent, task } = {}) {
  return {
    session: {
      clock: 0, timeStep: 1, bank: 100, rateMultiplier: 1,
      workRate: 1, skillBonus: 1, ...session,
    },
    agents: [{
      id: 'a1', name: 'A', rate: 2, attributes: ['skill:arcana=3'], activities: ['task:t1'],
      hp: null, xp: 0, ...agent,
    }],
    tasks: [{
      id: 't1', name: 'T', requirements: [], attributes: [],
      conditions: [{ id: 'c1', name: 'ARCANA', target: 100, progress: 0, tracker: { kind: 'work', tagPath: 'skill:arcana' } }],
      isComplete: false, results: { gold: 0, items: [], agents: [] }, ...task,
    }],
    inventory: [],
    tagRegistry: {},
    eventLog: [],
  };
}

const configWithout = (key) => normalizeRollbackConfig({ reverse: { [key]: false } });

describe('normalizeRollbackConfig', () => {
  it('defaults every switch on and guards maxRows', () => {
    expect(normalizeRollbackConfig(undefined)).toEqual(JSON.parse(JSON.stringify(DEFAULT_ROLLBACK_CONFIG)));
    expect(normalizeRollbackConfig({ reverse: { wages: false }, log: { maxRows: -1 } }))
      .toMatchObject({ reverse: { wages: false, workProgress: true }, log: { maxRows: DEFAULT_ROLLBACK_CONFIG.log.maxRows } });
  });
});

describe('getRollbackHorizon', () => {
  it('reports no horizon for empty or legacy (tickless) logs', () => {
    expect(getRollbackHorizon([])).toEqual({ canStepBack: false, earliestClock: null });
    expect(getRollbackHorizon([{ eventType: 'work_contribution', clock: 1440 }]))
      .toEqual({ canStepBack: false, earliestClock: null });
  });

  it('derives the earliest reachable clock from the oldest tick event', () => {
    const state = advanceTime(advanceTime(makeState()).newState).newState;
    expect(getRollbackHorizon(state.eventLog)).toEqual({ canStepBack: true, earliestClock: 0 });
  });
});

describe('rollbackTick', () => {
  it('returns null when the log has no tick boundary', () => {
    expect(rollbackTick(makeState())).toBeNull();
    const legacy = makeState();
    legacy.eventLog = [{ eventType: 'work_contribution', taskId: 't1', conditionId: 'c1', delta: 4 }];
    expect(rollbackTick(legacy)).toBeNull();
  });

  it('inverts one advanceTime tick exactly: progress, bank, clock, and log', () => {
    const before = makeState();
    const after = advanceTime(before).newState;
    const { newState } = rollbackTick(after);
    expect(newState.session.clock).toBe(0);
    expect(newState.session.bank).toBe(100);
    expect(newState.tasks[0].conditions[0].progress).toBe(0);
    expect(newState.eventLog).toHaveLength(0);
  });

  it('unwinds only the most recent tick group at a time', () => {
    const once = advanceTime(makeState()).newState;
    const twice = advanceTime(once).newState;
    const { newState } = rollbackTick(twice);
    expect(newState.session.clock).toBe(1440);
    expect(newState.tasks[0].conditions[0].progress).toBe(4);
    expect(newState.eventLog).toEqual(once.eventLog);
    expect(rollbackTick(newState).newState.session.clock).toBe(0);
  });

  it('makes each day of a multi-day step independently reversible', () => {
    const after = advanceTime(makeState({ session: { timeStep: 3 } })).newState;
    expect(after.session.clock).toBe(3 * 1440);
    expect(after.session.bank).toBe(94);                       // 100 − 2/day × 3
    expect(after.tasks[0].conditions[0].progress).toBe(12);   // 4/day × 3
    expect(after.eventLog.filter(row => row.eventType === 'tick')).toHaveLength(3);

    // Each step-back reverses exactly one day.
    const back1 = rollbackTick(after).newState;
    expect(back1.session.clock).toBe(2 * 1440);
    expect(back1.tasks[0].conditions[0].progress).toBe(8);
    const back2 = rollbackTick(back1).newState;
    expect(back2.session.clock).toBe(1440);
    const back3 = rollbackTick(back2).newState;
    expect(back3.session.clock).toBe(0);
    expect(back3.session.bank).toBe(100);
    expect(back3.tasks[0].conditions[0].progress).toBe(0);
    expect(back3.eventLog).toEqual([]);
    expect(rollbackTick(back3)).toBeNull();                    // horizon reached
  });

  it('reverses a completion: un-completes, removes rewards, deletes spawns, restores assignment', () => {
    const after = advanceTime(makeState({
      task: {
        conditions: [],
        results: { gold: 50, items: [{ name: 'Ring', quantity: 2 }], agents: [{ template: { name: 'GOBLIN' }, quantity: 1 }] },
      },
    })).newState;
    expect(after.agents).toHaveLength(2);
    const { newState } = rollbackTick(after);
    expect(newState.tasks[0].isComplete).toBe(false);
    expect(newState.session.bank).toBe(100);            // −50 gold reward, +2 wage refund
    expect(newState.inventory.find(item => item.name === 'Ring').quantity).toBe(0);
    expect(newState.agents).toHaveLength(1);
    expect(newState.agents[0].activities).toEqual(['task:t1']); // reassigned
  });

  it('honors each switchboard flag in isolation', () => {
    const completionState = () => advanceTime(makeState({
      task: {
        conditions: [],
        results: { gold: 50, items: [{ name: 'Ring', quantity: 2 }], agents: [{ template: { name: 'GOBLIN' }, quantity: 1 }] },
      },
    })).newState;

    expect(rollbackTick(completionState(), configWithout('taskCompletion')).newState.tasks[0].isComplete).toBe(true);
    expect(rollbackTick(completionState(), configWithout('rewardGold')).newState.session.bank).toBe(150); // 100 − 2 + 50 + 2 refund
    expect(rollbackTick(completionState(), configWithout('rewardItems')).newState
      .inventory.find(item => item.name === 'Ring').quantity).toBe(2);
    expect(rollbackTick(completionState(), configWithout('spawnedAgents')).newState.agents).toHaveLength(2);
    expect(rollbackTick(completionState(), configWithout('agentReassignment')).newState.agents[0].activities).toEqual([]);
    expect(rollbackTick(completionState(), configWithout('wages')).newState.session.bank).toBe(98); // no +2 refund

    const workState = advanceTime(makeState()).newState;
    const { newState } = rollbackTick(workState, configWithout('workProgress'));
    expect(newState.tasks[0].conditions[0].progress).toBe(4); // untouched
    expect(newState.session.clock).toBe(0);                   // clock still winds back
  });

  it('clamps instead of blocking when rewards were spent or consumed since', () => {
    const after = advanceTime(makeState({
      task: { conditions: [], results: { gold: 50, items: [{ name: 'Ring', quantity: 2 }], agents: [] } },
    })).newState;
    // Simulate manual spending: bank drained below the reward, ring stack reduced.
    after.session.bank = 10;
    after.inventory.find(item => item.name === 'Ring').quantity = 1;
    const { newState } = rollbackTick(after);
    expect(newState.session.bank).toBe(2);   // max(0, 10 − 50) then +2 wage refund
    expect(newState.inventory.find(item => item.name === 'Ring').quantity).toBe(0); // max(0, 1 − 2)
  });

  it('skips inverses for entities deleted or renamed since the tick', () => {
    const after = advanceTime(makeState({
      task: { conditions: [], results: { gold: 0, items: [{ name: 'Ring', quantity: 1 }], agents: [] } },
    })).newState;
    after.inventory = [];                                   // reward item deleted
    after.agents = [];                                      // assigned agent deleted
    after.tasks[0].conditions = [];                         // conditions removed
    expect(() => rollbackTick(after)).not.toThrow();
    expect(rollbackTick(after).newState.tasks[0].isComplete).toBe(false);
  });

  it('subtracts deltas rather than restoring snapshots, so manual edits survive', () => {
    const after = advanceTime(makeState()).newState;        // progress 4, delta 4 logged
    after.tasks[0].conditions[0].progress = 50;             // manual edit since
    const { newState } = rollbackTick(after);
    expect(newState.tasks[0].conditions[0].progress).toBe(46); // 50 − 4, not snapshot 0
  });

  it('uses the recorded stepMins even when timeStep changed since', () => {
    const after = advanceTime(makeState()).newState;        // 1-day tick recorded
    after.session.timeStep = 7;                             // changed afterwards
    expect(rollbackTick(after).newState.session.clock).toBe(0);
  });

  it('falls back to the log start when trimming swallowed the previous boundary', () => {
    const twice = advanceTime(advanceTime(makeState()).newState).newState;
    // FIFO trim dropped the whole first group (work + tick boundary).
    const trimmed = { ...twice, eventLog: twice.eventLog.slice(2) };
    const { newState } = rollbackTick(trimmed);
    expect(newState.session.clock).toBe(1440); // second tick fully reverts
    expect(newState.eventLog).toEqual([]);     // group start fell back to index 0
    expect(rollbackTick(newState)).toBeNull(); // horizon reached
  });
});
