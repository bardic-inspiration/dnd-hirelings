import { describe, it, expect } from 'vitest';
import { advanceTime, getStepMinutes, getPlayIntervalMs } from './clock.js';

// A minimal one-agent / one-task world. `overrides` deep-merges the pieces a
// given test cares about; everything else uses sane defaults.
function makeState({ session, agent, task } = {}) {
  return {
    session: {
      clock: 0, timeStep: 1, bank: 100, rateMultiplier: 1,
      workRate: 1, skillBonus: 1, logging: { enabled: true, maxRows: 50000 }, ...session,
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

describe('getStepMinutes / getPlayIntervalMs', () => {
  it('converts timeStep days to minutes, defaulting to one day', () => {
    expect(getStepMinutes({ timeStep: 1 })).toBe(1440);
    expect(getStepMinutes({ timeStep: 2 })).toBe(2880);
    expect(getStepMinutes({ timeStep: 0 })).toBe(1440);
  });

  it('shortens the wall interval as rateMultiplier rises, with a 16ms floor', () => {
    expect(getPlayIntervalMs({ timeStep: 1, rateMultiplier: 1 })).toBe(1000);
    expect(getPlayIntervalMs({ timeStep: 1, rateMultiplier: 1000 })).toBe(16);
  });
});

describe('advanceTime', () => {
  it('deducts agent rate, accrues condition progress, and advances the clock', () => {
    const { newState, flashAgentIds, taskProgressPerTick } = advanceTime(makeState());
    expect(newState.session.bank).toBe(98);          // 100 − rate 2
    expect(newState.tasks[0].conditions[0].progress).toBe(4); // (1 + 3*1) * 1
    expect(newState.session.clock).toBe(1440);
    expect(flashAgentIds).toEqual([]);
    expect(taskProgressPerTick.t1.c1).toBe(4);
  });

  it('appends one work_contribution event per game day', () => {
    const { newState } = advanceTime(makeState());
    expect(newState.eventLog).toHaveLength(1);
    expect(newState.eventLog[0]).toMatchObject({ eventType: 'work_contribution', delta: 4, progress: 4 });
  });

  it('splits a multi-day tick into one per-day row with divided deltas', () => {
    const { newState } = advanceTime(makeState({ session: { timeStep: 2 } }));
    const rows = newState.eventLog;
    expect(rows).toHaveLength(2);                       // dayCount = 2
    expect(rows.map(row => row.delta)).toEqual([4, 4]); // rate 8 / 2 days
    expect(newState.tasks[0].conditions[0].progress).toBe(8);
  });

  it('flashes and makes no progress when the bank cannot cover the tick', () => {
    const { newState, flashAgentIds } = advanceTime(makeState({ session: { bank: 1 } }));
    expect(flashAgentIds).toEqual(['a1']);
    expect(newState.session.bank).toBe(1);
    expect(newState.tasks[0].conditions[0].progress).toBe(0);
    expect(newState.eventLog).toHaveLength(0);
  });

  it('completes a zero-condition task that was worked and applies its rewards', () => {
    const { newState } = advanceTime(makeState({
      task: { conditions: [], results: { gold: 50, items: [], agents: [] } },
    }));
    expect(newState.tasks[0].isComplete).toBe(true);
    expect(newState.agents[0].activities).toEqual([]);   // unassigned on completion
    expect(newState.session.bank).toBe(148);             // 100 − 2 + 50
    expect(newState.eventLog.some(row => row.eventType === 'task_complete')).toBe(true);
  });

  it('advances progress identically but logs nothing when logging is disabled', () => {
    const { newState } = advanceTime(makeState({ session: { logging: { enabled: false, maxRows: 50000 } } }));
    expect(newState.tasks[0].conditions[0].progress).toBe(4);
    expect(newState.eventLog).toHaveLength(0);
  });

  it('does not mutate the input state', () => {
    const state = makeState();
    advanceTime(state);
    expect(state.session.bank).toBe(100);
    expect(state.tasks[0].conditions[0].progress).toBe(0);
    expect(state.eventLog).toHaveLength(0);
  });
});
