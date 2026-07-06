import { describe, it, expect } from 'vitest';
import { advanceTime, getStepMinutes, getPlayIntervalMs } from './clock.js';
import { DEFAULT_CLOCK_CONFIG, normalizeClockConfig } from './clockConfig.js';
import { DEFAULT_ROLLBACK_CONFIG, normalizeRollbackConfig } from './rollback.js';

// A minimal one-agent / one-task world. `overrides` deep-merges the pieces a
// given test cares about; everything else uses sane defaults.
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

describe('getStepMinutes / getPlayIntervalMs', () => {
  it('converts timeStep days to minutes, defaulting to one day', () => {
    expect(getStepMinutes({ timeStep: 1 })).toBe(1440);
    expect(getStepMinutes({ timeStep: 2 })).toBe(2880);
    expect(getStepMinutes({ timeStep: 0 })).toBe(1440);
  });

  it('shortens the wall interval as rateMultiplier rises, with a configurable floor', () => {
    expect(getPlayIntervalMs({ timeStep: 1, rateMultiplier: 1 })).toBe(1000);
    expect(getPlayIntervalMs({ timeStep: 1, rateMultiplier: 1000 })).toBe(16);
  });

  it('honors a custom calendar and real-time pacing', () => {
    const clockConfig = normalizeClockConfig({
      calendar: { minutesPerDay: 100, daysPerYear: 10 },
      realTime: { msPerStepDay: 500, minTickIntervalMs: 50 },
    });
    expect(getStepMinutes({ timeStep: 2 }, clockConfig)).toBe(200);
    expect(getPlayIntervalMs({ timeStep: 1, rateMultiplier: 1 }, clockConfig)).toBe(500);
    expect(getPlayIntervalMs({ timeStep: 1, rateMultiplier: 1000 }, clockConfig)).toBe(50);
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

  it('appends one work_contribution per game day and seals the batch with a tick event', () => {
    const { newState } = advanceTime(makeState());
    expect(newState.eventLog).toHaveLength(2);
    expect(newState.eventLog[0]).toMatchObject({ eventType: 'work_contribution', delta: 4, progress: 4 });
    expect(newState.eventLog[1]).toMatchObject({ eventType: 'tick', clock: 1440 });
    expect(newState.eventLog[1].data).toEqual({
      stepMins: 1440,
      wagesTotal: 2,
      wages: [{ agentId: 'a1', agentName: 'A', amount: 2 }],
    });
  });

  it('splits a multi-day step into one tick group per game day', () => {
    const { newState } = advanceTime(makeState({ session: { timeStep: 2 } }));
    const rows = newState.eventLog;
    // Each day is its own self-contained tick group: work → tick.
    expect(rows.map(row => row.eventType))
      .toEqual(['work_contribution', 'tick', 'work_contribution', 'tick']);
    expect([rows[0].delta, rows[2].delta]).toEqual([4, 4]); // rate 4 per day
    expect([rows[0].progress, rows[2].progress]).toEqual([4, 8]); // running snapshot
    // Every boundary reverses exactly one day and records that day's wages.
    expect(rows[1].data).toEqual({ stepMins: 1440, wagesTotal: 2, wages: [{ agentId: 'a1', agentName: 'A', amount: 2 }] });
    expect(rows[3].data).toEqual({ stepMins: 1440, wagesTotal: 2, wages: [{ agentId: 'a1', agentName: 'A', amount: 2 }] });
    expect(newState.session.clock).toBe(2880);
    expect(newState.session.bank).toBe(96);            // 100 − 2/day × 2
    expect(newState.tasks[0].conditions[0].progress).toBe(8);
  });

  it('completes a task on the day it finishes and stops paying wages afterward', () => {
    // Condition reaches its target (4) on day 1 of a 3-day step.
    const { newState } = advanceTime(makeState({
      session: { timeStep: 3 },
      task: { conditions: [{ id: 'c1', name: 'ARCANA', target: 4, progress: 0, tracker: { kind: 'work', tagPath: 'skill:arcana' } }] },
    }));
    expect(newState.tasks[0].isComplete).toBe(true);
    expect(newState.session.bank).toBe(98);            // only day 1's wage of 2
    expect(newState.session.clock).toBe(3 * 1440);     // clock still advances the full step
    // Completion lands in day 1's group; days 2-3 are empty tick boundaries.
    expect(newState.eventLog.map(row => row.eventType))
      .toEqual(['work_contribution', 'task_complete', 'tick', 'tick', 'tick']);
    expect(newState.eventLog.filter(row => row.eventType === 'tick').slice(1).map(row => row.data.wagesTotal))
      .toEqual([0, 0]);
  });

  it('flashes, makes no progress, and records zero wages when the bank cannot cover the tick', () => {
    const { newState, flashAgentIds } = advanceTime(makeState({ session: { bank: 1 } }));
    expect(flashAgentIds).toEqual(['a1']);
    expect(newState.session.bank).toBe(1);
    expect(newState.tasks[0].conditions[0].progress).toBe(0);
    expect(newState.eventLog).toHaveLength(1); // just the tick boundary
    expect(newState.eventLog[0].data).toEqual({ stepMins: 1440, wagesTotal: 0, wages: [] });
  });

  it('completes a zero-condition task, applies rewards, and records the ids rollback needs', () => {
    const { newState } = advanceTime(makeState({
      task: { conditions: [], results: { gold: 50, items: [], agents: [{ template: { name: 'GOBLIN' }, quantity: 1 }] } },
    }));
    expect(newState.tasks[0].isComplete).toBe(true);
    expect(newState.agents[0].activities).toEqual([]);   // unassigned on completion
    expect(newState.session.bank).toBe(148);             // 100 − 2 + 50
    const complete = newState.eventLog.find(row => row.eventType === 'task_complete');
    const spawned = newState.agents.find(agent => agent.name === 'GOBLIN');
    expect(complete.data.spawnedAgentIds).toEqual([spawned.id]);
    expect(complete.data.unassignedAgentIds).toEqual(['a1']);
    // Ordering contract: work* → task_complete* → tick.
    expect(newState.eventLog[newState.eventLog.length - 1].eventType).toBe('tick');
  });

  it('advances progress identically but logs nothing when logging is disabled', () => {
    const rollbackConfig = normalizeRollbackConfig({ log: { enabled: false } });
    const { newState } = advanceTime(makeState(), { rollbackConfig });
    expect(newState.tasks[0].conditions[0].progress).toBe(4);
    expect(newState.eventLog).toHaveLength(0);
  });

  it('uses the configured calendar for step minutes and day stamps', () => {
    const clockConfig = normalizeClockConfig({ calendar: { minutesPerDay: 100, daysPerYear: 10 } });
    const { newState } = advanceTime(makeState(), { clockConfig });
    expect(newState.session.clock).toBe(100);
    expect(newState.eventLog[0]).toMatchObject({ clock: 100, day: 1 });
  });

  it('does not mutate the input state', () => {
    const state = makeState();
    advanceTime(state, { clockConfig: DEFAULT_CLOCK_CONFIG, rollbackConfig: DEFAULT_ROLLBACK_CONFIG });
    expect(state.session.bank).toBe(100);
    expect(state.tasks[0].conditions[0].progress).toBe(0);
    expect(state.eventLog).toHaveLength(0);
  });
});
