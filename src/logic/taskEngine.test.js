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

describe('durations (fixed and open)', () => {
  it('fixed duration counts 1 per tick across a party, waits for the window, and expires with no failure branch when a vessel is unfilled', () => {
    const fixedTask = {
      duration: { kind: 'fixed', ticks: 4 },
      operators: [
        { id: 'check', kind: 'gate', quantifier: 'all', read: 'skill:stealth', compare: { op: '>=', value: '2' } },
        { id: 'progress', kind: 'contribute', target: 'found', expr: '1' },
      ],
      vessels: { found: { fullWhen: '>= 4' } },
      effects: [{ on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 40 } }] }],
    };

    // Two passing agents deposit 2/tick into `found` (reaching 4 on tick 2),
    // but `duration` counts 1/tick and is a success vessel, so completion waits until tick 4.
    const passingParty = [agent('a1', ['skill:stealth=2']), agent('a2', ['skill:stealth=2'])];
    const after2 = advanceTime(world(fixedTask, passingParty), { count: 2 }).newState;
    expect(after2.tasks[0].blackboard).toEqual({ found: 4, duration: 2 });
    expect(after2.tasks[0].isComplete).toBe(false);

    const after4 = advanceTime(after2, { count: 2 }).newState;
    expect(after4.tasks[0].blackboard).toEqual({ found: 8, duration: 4 });
    expect(after4.tasks[0].isComplete).toBe(true);
    expect(after4.session.bank).toBe(100 - 8 + 40);

    // When gates fail, `duration` still counts up to 4; at expiry `found` is 0,
    // so the task neither completes nor fires a failure branch, and later ticks do not advance it.
    const failing = advanceTime(world(fixedTask, [agent('a1', ['skill:stealth=1'])]), { count: 4 }).newState;
    expect(failing.tasks[0].blackboard).toEqual({ duration: 4 });
    expect(failing.tasks[0].isComplete).toBe(false);
    expect(failing.session.bank).toBe(96);

    // Even if the agent gains the skill after the window elapsed, the expired task accepts no further work.
    const lateUpgrade = {
      ...failing,
      agents: [{ ...failing.agents[0], attributes: ['skill:stealth=5'] }],
    };
    const after5 = advanceTime(lateUpgrade).newState;
    expect(after5.tasks[0].blackboard).toEqual({ duration: 4 });
    expect(after5.tasks[0].isComplete).toBe(false);

    // Rolling back tick 4 re-opens the window.
    const rewound = rollbackTick(failing).newState;
    expect(rewound.tasks[0].blackboard.duration).toBe(3);
  });

  it('open duration with cap completes early as soon as success vessels fill, and expires silently at the cap', () => {
    const openTask = {
      duration: { kind: 'open', cap: 4 },
      operators: [
        { id: 'check', kind: 'gate', read: 'skill:arcana' },
        { id: 'progress', kind: 'contribute', target: 'research', expr: '2' },
      ],
      vessels: { research: { fullWhen: '>= 4' } },
      effects: [{ on: 'completion', actions: [{ kind: 'bank.adjust', params: { amount: 25 } }] }],
    };

    // Completes on tick 2 (`research` = 4 >= 4) without waiting for `duration` to reach 4.
    const early = advanceTime(world(openTask, [agent('a1', ['skill:arcana=1'])]), { count: 2 }).newState;
    expect(early.tasks[0].blackboard).toEqual({ research: 4, duration: 2 });
    expect(early.tasks[0].isComplete).toBe(true);
    expect(early.session.bank).toBe(100 - 2 + 25);

    // When `research` stays unfilled across all 4 ticks, the cap elapses with no completion and stops.
    const expired = advanceTime(world(openTask, [agent('a1', [])]), { count: 4 }).newState;
    expect(expired.tasks[0].blackboard).toEqual({ duration: 4 });
    expect(expired.tasks[0].isComplete).toBe(false);
    const afterCap = advanceTime({
      ...expired,
      agents: [{ ...expired.agents[0], attributes: ['skill:arcana=1'] }],
    }).newState;
    expect(afterCap.tasks[0].blackboard).toEqual({ duration: 4 });
  });
});

describe('authored preset worked examples (public/presets/task_presets.json)', () => {
  it('loads and runs all three worked examples from authored preset data', async () => {
    const { default: taskPresets } = await import('../../public/presets/task_presets.json');
    const { LIBRARY_CONFIGS } = await import('../constants/libraries.jsx');
    const { reducer } = await import('../state/reducer.js');

    const spawnPreset = (name, agents) => {
      const raw = taskPresets.find(entry => entry.name === name);
      expect(raw).toBeDefined();
      const preset = LIBRARY_CONFIGS.task.normalize(raw);
      const created = reducer(world({}, []), { type: 'TASK_CREATE', preset });
      const task = created.tasks.at(-1);
      const assigned = agents.map(member => ({ ...member, activities: [`task:${task.id}`] }));
      return { ...created, tasks: [task], agents: assigned };
    };

    // 1 — Find Victor and Zellen (fixed window, 4 ticks)
    const victorState = spawnPreset('FIND VICTOR AND ZELLEN', [
      agent('scout', ['skill:stealth=20', 'skill:investigation=30']),
    ]);
    const victorDone = advanceTime(victorState, { count: 4 }).newState;
    expect(victorDone.tasks[0].isComplete).toBe(true);
    expect(victorDone.tasks[0].blackboard).toEqual({ found: 4, duration: 4 });

    // 2 — Infiltrate the City Watch (open, cap 30)
    const watchState = spawnPreset('INFILTRATE THE CITY WATCH', [
      agent('bard1', ['skill:performance=20', 'skill:investigation=30']),
      agent('bard2', ['skill:performance=20', 'skill:investigation=30']),
    ]);
    // Two passing agents deposit 2/tick into `infiltration` (>= 30), completing in 15 ticks well before the 30-tick cap.
    const watchDone = advanceTime(watchState, { count: 15 }).newState;
    expect(watchDone.tasks[0].isComplete).toBe(true);
    expect(watchDone.tasks[0].blackboard).toEqual({ infiltration: 30, duration: 15 });

    // 3 — Explore the GUA Tunnels (open, cap 10; lethal hazard on d6 == 1)
    let tunnelsState = spawnPreset('EXPLORE THE GUA TUNNELS', [
      agent('hero', ['skill:combat=20', 'skill:investigation=40']),
      agent('doomed', ['skill:combat=-20', 'skill:investigation=40']),
    ]);
    // Advance tick by tick until `hazard` (1d6) rolls 1 for both agents, or force the clock where hero rolls 1.
    const { rollDice, rollSeedKey } = await import('./rng.js');
    const taskId = tunnelsState.tasks[0].id;
    let hazardClock = 1;
    while (
      rollDice(rollSeedKey({ clock: hazardClock, taskId, operatorId: 'hazard', agentId: 'hero', rollIndex: 0 }), 1, 6).result !== 1 ||
      rollDice(rollSeedKey({ clock: hazardClock, taskId, operatorId: 'hazard', agentId: 'doomed', rollIndex: 0 }), 1, 6).result !== 1
    ) {
      hazardClock += 1;
    }
    tunnelsState = { ...tunnelsState, session: { ...tunnelsState.session, clock: hazardClock - 1 } };
    const afterHazard = advanceTime(tunnelsState).newState;
    expect(afterHazard.agents.map(member => member.id)).toEqual(['hero']);
    expect(afterHazard.tasks[0].blackboard.mapped).toBeGreaterThanOrEqual(1);
    expect(afterHazard.tasks[0].blackboard.duration).toBe(1);
  });
});


