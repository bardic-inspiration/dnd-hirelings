import { describe, it, expect } from 'vitest';
import { createFlow, runTaskOperators, QUANTIFIER_REGISTRY, parseQuantifier } from './operators.js';
import { lowerTask } from './taskModel.js';

const session = { workRate: 1, skillBonus: 1, clock: 0 };
const registry = { class: { fighter: {}, druid: { circle: {} } }, skill: { arcana: {}, history: {} } };

// Runs a task's operators for the given agents' attribute lists.
const run = (task, attributeLists, overrides = {}) => runTaskOperators(
  lowerTask({ id: 't1', ...task }),
  attributeLists.map((attributes, index) => ({ agent: { id: `a${index + 1}` }, attributes })),
  { session, registry, clock: 1, ...overrides },
);

// A lowered single-condition task: the old `work` tracker as gate + contribute.
const workTask = (tagPath, compare = null) => ({
  conditions: [{ id: 'c1', name: 'C', target: 100, progress: 0, tracker: { kind: 'work', tagPath, compare } }],
});

const total = (result) => result.deposits.reduce((sum, deposit) => sum + deposit.amount, 0);

describe('createFlow', () => {
  it('starts admitted, at zero, with no matched value and no rolls', () => {
    expect(createFlow()).toEqual({ admitted: true, value: 0, matchedValue: 0, rolls: [] });
  });

  it('returns a fresh object each call, so one agent\'s fold never leaks into another\'s', () => {
    const first = createFlow();
    first.rolls.push({});
    expect(createFlow().rolls).toEqual([]);
    expect(createFlow()).not.toBe(createFlow());
  });
});

describe('lowered work conditions (gate + contribute)', () => {
  it('a null tag path grants the base rate to any agent', () => {
    expect(total(run(workTask(null), [[]]))).toBe(1);
  });

  it('a matched valued tag adds value × skillBonus to the base rate', () => {
    expect(total(run(workTask('skill:arcana'), [['skill:arcana=3']]))).toBe(4);
    expect(total(run(workTask('skill:arcana'), [['skill:arcana=3']], { session: { ...session, skillBonus: 2 } }))).toBe(7);
  });

  it('a matched valueless tag contributes only the base rate', () => {
    expect(total(run(workTask('skill:arcana'), [['skill:arcana']]))).toBe(1);
  });

  it('contributes nothing when no attribute matches, or the match is a modifier tag', () => {
    expect(run(workTask('skill:arcana'), [['skill:history=2']]).deposits).toEqual([]);
    expect(run(workTask('skill:arcana'), [['req,skill:arcana=3']]).deposits).toEqual([]);
  });

  it('gates on the comparison passing', () => {
    const task = workTask('skill:arcana', { op: '>=', value: '3' });
    expect(total(run(task, [['skill:arcana=3']]))).toBe(4);
    expect(run(task, [['skill:arcana=2']]).deposits).toEqual([]);
  });

  it('compares equality against the display-resolved leaf value', () => {
    const task = workTask('class:*', { op: '==', value: 'fighter' });
    expect(total(run(task, [['class:fighter']]))).toBe(1);
    expect(run(task, [['class:druid']]).deposits).toEqual([]);
  });

  it('fails ordered comparisons closed against non-numeric leaf values', () => {
    expect(run(workTask('class:*', { op: '>=', value: '3' }), [['class:fighter']]).deposits).toEqual([]);
  });

  it('lets a wildcard link select the first qualifying tag among path matches', () => {
    expect(total(run(workTask('skill:*', { op: '>=', value: '3' }), [['skill:history=1', 'skill:arcana=5']]))).toBe(6);
  });

  it('keeps conditions independent: a failed gate and a matched value never reach the next condition', () => {
    const result = run({ conditions: [
      { id: 'c1', name: 'A', target: 9, progress: 0, tracker: { kind: 'work', tagPath: 'skill:history', compare: null } },
      { id: 'c2', name: 'B', target: 9, progress: 0, tracker: { kind: 'work', tagPath: 'skill:arcana', compare: null } },
      { id: 'c3', name: 'C', target: 9, progress: 0, tracker: { kind: 'work', tagPath: null, compare: null } },
    ] }, [['skill:arcana=5']]);
    expect(result.deposits.map(({ vessel, amount }) => [vessel, amount])).toEqual([['c2', 6], ['c3', 1]]);
  });

  it('records one deposit per agent, tagged with the agent and operator', () => {
    const result = run(workTask(null), [[], []]);
    expect(result.deposits).toEqual([
      { agentId: 'a1', opIndex: 0, vessel: 'c1', amount: 1 },
      { agentId: 'a2', opIndex: 0, vessel: 'c1', amount: 1 },
    ]);
    expect([...result.contributors]).toEqual(['a1', 'a2']);
  });
});

describe('gates', () => {
  it('reads the flow, a flag, or an expression check', () => {
    const flag = { operators: [{ id: 'g', kind: 'gate', read: 'flag:alarm', compare: { op: '>=', value: '2' } },
      { id: 'p', kind: 'contribute', target: 'v' }], blackboard: { alarm: 3 } };
    expect(total(run(flag, [[]]))).toBe(1);
    const expr = { operators: [{ id: 'g', kind: 'gate', expr: '{skill:arcana} * 2', compare: { op: '>', value: '5' } },
      { id: 'p', kind: 'contribute', target: 'v' }] };
    expect(run(expr, [['skill:arcana=3'], ['skill:arcana=2']]).deposits.map(deposit => deposit.agentId)).toEqual(['a1']);
    const truthy = { operators: [{ id: 'g', kind: 'gate', expr: '{skill:arcana} >= 3' }, { id: 'p', kind: 'contribute', target: 'v' }] };
    expect(run(truthy, [['skill:arcana=3'], ['skill:arcana=2']]).deposits.map(deposit => deposit.agentId)).toEqual(['a1']);
  });

  it('fails closed on an expression that does not parse', () => {
    const task = { operators: [{ id: 'g', kind: 'gate', expr: '1 +' }, { id: 'p', kind: 'contribute', target: 'v' }] };
    expect(run(task, [[]]).deposits).toEqual([]);
  });

  it('records each agent\'s outcome', () => {
    const task = { operators: [{ id: 'g', kind: 'gate', read: 'skill:arcana' }] };
    expect(run(task, [['skill:arcana=1'], []]).outcomes).toEqual({ g: { pass: ['a1'], fail: ['a2'] } });
  });
});

describe('quantifiers', () => {
  const gated = (quantifier) => ({ operators: [
    { id: 'g', kind: 'gate', read: 'skill:arcana', quantifier },
    { id: 'p', kind: 'contribute', target: 'v' },
  ] });
  const depositors = (quantifier, lists) => run(gated(quantifier), lists).deposits.map(deposit => deposit.agentId);

  it('parses registry keys and atLeast(n), and rejects anything else', () => {
    expect(parseQuantifier('any')).toBe(QUANTIFIER_REGISTRY.any);
    expect(parseQuantifier('atLeast(2)').test(2, 3)).toBe(true);
    expect(parseQuantifier('atLeast(2)').test(1, 3)).toBe(false);
    expect(parseQuantifier('most')).toBeNull();
    expect(parseQuantifier(undefined)).toBeNull();
  });

  it('all: everyone passes or everyone is rejected', () => {
    expect(depositors('all', [['skill:arcana'], ['skill:arcana']])).toEqual(['a1', 'a2']);
    expect(depositors('all', [['skill:arcana'], []])).toEqual([]);
  });

  it('any and atLeast(n): enough passers admit every agent that reached the gate', () => {
    expect(depositors('any', [['skill:arcana'], []])).toEqual(['a1', 'a2']);
    expect(depositors('any', [[], []])).toEqual([]);
    expect(depositors('atLeast(2)', [['skill:arcana'], [], ['skill:arcana']])).toEqual(['a1', 'a2', 'a3']);
    expect(depositors('atLeast(2)', [['skill:arcana'], [], []])).toEqual([]);
  });

  it('count: deposits the number of passers once', () => {
    const result = run(gated('count'), [['skill:arcana'], [], ['skill:arcana']]);
    expect(result.deposits).toEqual([{ agentId: '', opIndex: 1, vessel: 'v', amount: 2 }]);
    expect([...result.contributors]).toEqual(['a1', 'a3']);
  });

  it('never re-admits an agent rejected upstream', () => {
    const task = { operators: [
      { id: 'g1', kind: 'gate', read: 'skill:history' },
      { id: 'g2', kind: 'gate', read: 'skill:arcana', quantifier: 'any' },
      { id: 'p', kind: 'contribute', target: 'v' },
    ] };
    expect(run(task, [['skill:history', 'skill:arcana'], ['skill:arcana']]).deposits.map(deposit => deposit.agentId)).toEqual(['a1']);
  });

  it('records outcomes before the collapse', () => {
    expect(run(gated('any'), [['skill:arcana'], []]).outcomes.g).toEqual({ pass: ['a1'], fail: ['a2'] });
  });
});

describe('references', () => {
  const amount = (expr, attributes = [], overrides = {}) => total(run(
    { operators: [{ id: 'p', kind: 'contribute', target: 'v', expr }], ...overrides.task },
    [attributes], overrides,
  ));

  it('resolves session scalars, flags, and agent tags (wildcards sum, missing reads 0)', () => {
    expect(amount('{session:workRate} + {session:skillBonus}', [], { session: { workRate: 2, skillBonus: 3 } })).toBe(5);
    expect(amount('{flag:found} + 1', [], { task: { blackboard: { found: 2 } } })).toBe(3);
    expect(amount('{skill:*}', ['skill:arcana=2', 'skill:history=3'])).toBe(5);
    expect(amount('{skill:nothing} + 1')).toBe(1);
    expect(amount('{dyn,ac}', ['ac=2', 'dyn,ac=14'])).toBe(14);
  });

  it('reads {value} from the last gate-matched tag and {flow} from the running flow', () => {
    const task = { operators: [
      { id: 'g', kind: 'gate', read: 'skill:arcana' },
      { id: 'p', kind: 'contribute', target: 'v', expr: '{value} * 10 + {flow}' },
    ] };
    expect(total(run(task, [['skill:arcana=3']]))).toBe(30);
  });

  it('deposits only a positive, finite amount', () => {
    expect(amount('0')).toBe(0);
    expect(amount('-2')).toBe(0);
    expect(amount('1/0')).toBe(0);
  });
});

describe('dice', () => {
  const diceTask = { operators: [
    { id: 'check', kind: 'gate', expr: 'd20 + 2d6', compare: { op: '>=', value: '1' } },
  ] };

  it('rolls through the seeded stream, recording each literal with a rising roll index', () => {
    const { rolls } = run(diceTask, [[], []]);
    expect(rolls.map(({ operatorId, agentId, rollIndex, notation }) => [operatorId, agentId, rollIndex, notation])).toEqual([
      ['check', 'a1', 0, '1d20'], ['check', 'a1', 1, '2d6'],
      ['check', 'a2', 0, '1d20'], ['check', 'a2', 1, '2d6'],
    ]);
    for (const roll of rolls) expect(roll.result).toBeGreaterThanOrEqual(1);
  });

  it('replays identically for the same clock, task, operator, and agent', () => {
    expect(run(diceTask, [[], []]).rolls).toEqual(run(diceTask, [[], []]).rolls);
    const resultsAcrossClocks = new Set();
    for (let clock = 1; clock <= 20; clock++) resultsAcrossClocks.add(run(diceTask, [[]], { clock }).rolls[0].result);
    expect(resultsAcrossClocks.size).toBeGreaterThan(1);
  });
});

describe('effects', () => {
  it('fires a gate\'s pass and fail effects once each when any agent reached that outcome', () => {
    const pay = { kind: 'bank.adjust', params: { amount: 1 } };
    const task = { operators: [{ id: 'g', kind: 'gate', read: 'skill:arcana', quantifier: 'any',
      effects: [{ on: 'pass', actions: [pay] }, { on: 'fail', actions: [pay, pay] }] }] };
    expect(run(task, [['skill:arcana'], [], []]).fired).toEqual([
      { operatorId: 'g', on: 'pass', actions: [pay] },
      { operatorId: 'g', on: 'fail', actions: [pay, pay] },
    ]);
    expect(run(task, [['skill:arcana']]).fired.map(fire => fire.on)).toEqual(['pass']);
  });

  it('fires an effect operator\'s pass effects when an admitted flow reaches it', () => {
    const flag = { kind: 'flag.set', params: { key: 'seen', value: true } };
    const task = { operators: [
      { id: 'g', kind: 'gate', read: 'skill:arcana' },
      { id: 'e', kind: 'effect', effects: [{ on: 'pass', actions: [flag] }] },
    ] };
    expect(run(task, [['skill:arcana']]).fired).toEqual([{ operatorId: 'e', on: 'pass', actions: [flag] }]);
    expect(run(task, [[]]).fired).toEqual([]);
  });

  it('collects a contribute\'s threshold effects for the clock to check after writes', () => {
    const pay = { kind: 'bank.adjust', params: { amount: 5 } };
    const task = { operators: [{ id: 'p', kind: 'contribute', target: 'v', effects: [{ on: 'threshold', actions: [pay] }] }] };
    expect(run(task, [[]]).thresholds).toEqual([{ operatorId: 'p', vessel: 'v', actions: [pay] }]);
  });
});

describe('unknown operators', () => {
  it('pass the flow through untouched', () => {
    const task = { operators: [{ id: 'x', kind: 'teleport' }, { id: 'p', kind: 'contribute', target: 'v' }] };
    expect(total(run(task, [[]]))).toBe(1);
  });
});
