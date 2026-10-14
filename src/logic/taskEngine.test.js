import { describe, it, expect } from 'vitest';
import { advanceTime } from './clock.js';
import { rollbackTick, normalizeRollbackConfig } from './rollback.js';
import { serializeEventLog, parseEventLog } from './eventLog.js';
import { lowerTask, conditionsView } from './taskModel.js';

// End-to-end task-engine behavior through the tick (docs/spec/task-engine.md):
// authored task data → advanceTime → the log → rollback.

const agent = (id, attributes, overrides = {}) => ({
  id, name: id.toUpperCase(), rate: 1, attributes, activities: ['task:t1'], ...overrides,
});

const world = (task, agents = [agent('a1', [])], overrides = {}) => ({
  session: { clock: 0, timeStep: 1, stepBack: 1, bank: 100, rateMultiplier: 1, workRate: 1, skillBonus: 1 },
  agents,
  tasks: [lowerTask({ id: 't1', name: 'T', requirements: [], attributes: [], isComplete: false, ...task })],
  inventory: [],
  tagRegistry: { skill: { combat: {} } },
  eventLog: [],
  ...overrides,
});

describe('contract walk: bank.adjust', () => {
  // Author → fire → log → CSV export → import → rollback → DOM.
  const authored = {
    vessels: { found: { fullWhen: '>= 1' } },
    operators: [{ id: 'progress', kind: 'contribute', target: 'found', expr: '1' }],
    effects: [{ on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 50 } }] }],
  };

  it('fires on completion, logs one action row in the tick group, round-trips CSV, and reverses', () => {
    const before = world(authored);
    const { newState: after, taskProgressPerTick } = advanceTime(before);

    // Fire: the +50 folds into the tick's one new state (100 − 1 wage + 50).
    expect(after.session.bank).toBe(149);
    expect(after.tasks[0].isComplete).toBe(true);

    // Log: one bank.adjust row, inside the tick group, before its boundary.
    const types = after.eventLog.map(row => [row.eventType, row.actionKind]);
    expect(types).toEqual([
      ['work_contribution', 'vessel.deposit'],
      ['task_complete', ''],
      ['action', 'agent.unassign'],
      ['action', 'bank.adjust'],
      ['tick', ''],
    ]);
    const row = after.eventLog[3];
    expect(row).toMatchObject({ taskId: 't1', data: { params: { amount: 50 }, deltas: { amount: 50 } }, reverseData: {} });

    // CSV: export and import carry both new columns.
    const imported = parseEventLog(serializeEventLog(after.eventLog));
    expect(imported).toEqual(after.eventLog);

    // Rollback from the imported log: −50 (clamped, switchboard-gated) before
    // the wage refund and the clock decrement.
    const { newState: back } = rollbackTick({ ...after, eventLog: imported });
    expect(back.session.bank).toBe(100);
    expect(back.session.clock).toBe(0);
    expect(back.tasks[0].isComplete).toBe(false);
    expect(back.tasks[0].blackboard.found).toBe(0);
    expect(back.agents[0].activities).toEqual(['task:t1']);
    expect(back.eventLog).toEqual([]);
    const gated = rollbackTick({ ...after, eventLog: imported }, normalizeRollbackConfig({ reverse: { rewardGold: false } }));
    expect(gated.newState.session.bank).toBe(150);

    // DOM: the action touches nothing the progress bars read — only the
    // vessel key moves, under the same task/condition ids as before.
    expect(taskProgressPerTick).toEqual({ t1: { found: 1 } });
    expect(conditionsView(after.tasks[0]).map(view => view.id)).toEqual(['found']);
  });
});

describe('worked example 3: the lethal chain', () => {
  // `combat` rolls per agent; its fail effect removes each failing agent.
  // Skill ±20 makes the d20 outcome certain whatever the seed.
  const tunnels = {
    vessels: { mapped: { fullWhen: '>= 10' } },
    operators: [
      { id: 'combat', kind: 'gate', quantifier: 'any',
        expr: 'd20 + {skill:combat}', compare: { op: '>=', value: '13' },
        effects: [{ on: 'fail', actions: [{ kind: 'agent.remove',
          params: { selector: { scope: 'operator', operatorId: 'combat', outcome: 'fail' } } }] }] },
      { id: 'progress', kind: 'contribute', target: 'mapped', expr: '1' },
    ],
  };
  const party = () => [agent('hero', ['skill:combat=20']), agent('doomed', ['skill:combat=-20'])];

  it('removes the failing agent, lets the passing one progress, and records the rolls', () => {
    const { newState } = advanceTime(world(tunnels, party()));
    expect(newState.agents.map(each => each.id)).toEqual(['hero']);
    // `any` admits everyone who reached the gate: both deposit this tick.
    expect(newState.tasks[0].blackboard.mapped).toBe(2);
    const tick = newState.eventLog.at(-1);
    expect(tick.data.rolls.map(roll => [roll.operatorId, roll.agentId, roll.notation])).toEqual([
      ['combat', 'hero', '1d20'], ['combat', 'doomed', '1d20'],
    ]);
    expect(newState.eventLog.find(row => row.actionKind === 'agent.remove').data.deltas).toEqual({ agentIds: ['doomed'] });
  });

  it('keeps the death through rollback while everything else rewinds', () => {
    const before = world(tunnels, party());
    const { newState: after } = advanceTime(before);
    const { newState: back } = rollbackTick(after);
    expect(back.agents.map(each => each.id)).toEqual(['hero']);
    expect(back.tasks[0].blackboard.mapped).toBe(0);
    expect(back.session.bank).toBe(100);
    expect(back.session.clock).toBe(0);
  });

  it('replays the same rolls after a rollback', () => {
    // Nobody can fail here, so the replay engages the same agents.
    const before = world(tunnels, [agent('a1', ['skill:combat=20']), agent('a2', ['skill:combat=20'])]);
    const first = advanceTime(before).newState;
    const replay = advanceTime(rollbackTick(first).newState).newState;
    expect(replay.eventLog.at(-1).data.rolls).toEqual(first.eventLog.at(-1).data.rolls);
  });
});

describe('the blackboard', () => {
  // An effect operator writes a flag; a gate reads it. The two-phase rule:
  // reads see the start of the tick, so the gate first passes a tick later.
  const multiStep = {
    vessels: { done: { fullWhen: '>= 1' } },
    operators: [
      { id: 'arrive', kind: 'effect', effects: [{ on: 'pass', actions: [{ kind: 'flag.set', params: { key: 'arrived', value: 1 } }] }] },
      { id: 'ready', kind: 'gate', read: 'flag:arrived', compare: { op: '>=', value: '1' } },
      { id: 'work', kind: 'contribute', target: 'done' },
    ],
  };

  it('writes in one tick and is read in the next', () => {
    const tick1 = advanceTime(world(multiStep)).newState;
    expect(tick1.tasks[0].blackboard).toEqual({ arrived: 1 });
    expect(tick1.tasks[0].isComplete).toBe(false);
    const tick2 = advanceTime(tick1).newState;
    expect(tick2.tasks[0].blackboard.done).toBe(1);
    expect(tick2.tasks[0].isComplete).toBe(true);
  });

  it('restores the pre-image on rollback', () => {
    const tick1 = advanceTime(world(multiStep)).newState;
    expect(rollbackTick(tick1).newState.tasks[0].blackboard).toEqual({});
  });
});

describe('threshold effects', () => {
  it('fire on the tick a vessel becomes full, once', () => {
    const task = {
      vessels: { gate: { fullWhen: '>= 2', success: false }, never: { fullWhen: '>= 99' } },
      operators: [{ id: 'push', kind: 'contribute', target: 'gate', expr: '1',
        effects: [{ on: 'threshold', actions: [{ kind: 'bank.adjust', params: { amount: 10 } }] }] }],
    };
    const tick1 = advanceTime(world(task)).newState;
    const tick2 = advanceTime(tick1).newState;
    const tick3 = advanceTime(tick2).newState;
    expect([tick1, tick2, tick3].map(state => state.session.bank)).toEqual([99, 108, 107]);
  });
});

describe('locked mode', () => {
  it('skips an unregistered tag write, marks its row, and still ticks', () => {
    const task = {
      operators: [{ id: 'mark', kind: 'effect', effects: [{ on: 'pass', actions: [
        { kind: 'tag.apply', params: { selector: { scope: 'assigned' }, tag: 'trait:marked' } },
      ] }] }],
      vessels: { never: { fullWhen: '>= 9' } },
    };
    const locked = advanceTime(world(task), { locked: true }).newState;
    expect(locked.agents[0].attributes).toEqual([]);
    expect(locked.eventLog.find(row => row.eventType === 'action')).toMatchObject({ actionKind: 'tag.apply', data: { skipped: 'locked' } });
    expect(locked.session.clock).toBe(1);

    const unlocked = advanceTime(world(task)).newState;
    expect(unlocked.agents[0].attributes).toEqual(['trait:marked']);
    expect(unlocked.tagRegistry.trait).toEqual({ marked: {} });
  });
});
