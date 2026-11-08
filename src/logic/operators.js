// Task-engine operators (docs/spec/task-engine.md "Operators"). Each tick, a
// task's operators fold over one `Flow` per engaged agent, in author order.
// The fold runs operator by operator across every engaged agent at once, so a
// quantifier can collapse the agents' pass/fail outcomes into one.
//
// Operators only read: they return the deposits, outcomes, fired effects, and
// rolls of one task's tick, and the clock applies them afterwards.

import { parseTag } from './tags.js';
import { matchTagPath, matchTagValue } from './tagMatching.js';
import { resolveTagValue } from './tagValues.js';
import { evaluateCheck } from './expressions.js';
import { rollDice, rollSeedKey } from './rng.js';

/**
 * @typedef {object} RollRecord
 * @property {string} operatorId
 * @property {string} agentId
 * @property {number} rollIndex - Counts up per (task, operator, agent) within a tick
 * @property {string} notation - The dice literal, e.g. `'1d20'`
 * @property {number} result
 */

/**
 * @typedef {object} Flow
 * @property {boolean} admitted - False once a gate rejects; nothing downstream fires
 * @property {number} value - The running value modulators scale and checks read as `{flow}`
 * @property {number} matchedValue - Numeric value of the last gate-matched tag
 *   (`{value}`); 0 if none or non-numeric
 * @property {RollRecord[]} rolls - Rolls made during this fold
 */

/**
 * Creates the flow one agent's fold starts from.
 *
 * @returns {Flow} `{ admitted: true, value: 0, matchedValue: 0, rolls: [] }`, fresh each call
 */
export function createFlow() {
  return { admitted: true, value: 0, matchedValue: 0, rolls: [] };
}

// Session scalars a `{session:…}` reference can read (references are lowercased).
const SESSION_REFERENCES = {
  workrate:       (session) => session.workRate ?? 1,
  skillbonus:     (session) => session.skillBonus ?? 1,
  ratemultiplier: (session) => session.rateMultiplier ?? 1,
  clock:          (session) => session.clock ?? 0,
};

const isPattern = (path) => /[*\\]/.test(path);

// Reads a blackboard entry by key, case-insensitively (references are lowercased).
const readFlag = (blackboard, key) => {
  if (Object.prototype.hasOwnProperty.call(blackboard, key)) return blackboard[key];
  const match = Object.keys(blackboard).find(name => name.toLowerCase() === key);
  return match === undefined ? undefined : blackboard[match];
};

const toNumber = (value) => Number(value) || 0;

/**
 * Builds the reference resolver for one agent's check (docs/spec/task-engine.md
 * "References"): `{flow}`, `{value}`, `{session:…}`, `{flag:…}`, and the
 * agent's effective tags — `{path}` sums the numeric values of plain tags
 * matching the path (`open` mode, so wildcards sum), `{dyn,path}` the same
 * over `dyn,` tags. Anything unresolved reads 0.
 */
function makeResolver({ attributes, session, blackboard, flow }) {
  return (path, scope) => {
    if (scope === 'static' && path === 'flow') return flow.value;
    if (scope === 'static' && path === 'value') return flow.matchedValue;
    if (scope === 'static' && path.startsWith('session:')) {
      const read = SESSION_REFERENCES[path.slice('session:'.length)];
      return read ? toNumber(read(session)) : 0;
    }
    if (scope === 'static' && path.startsWith('flag:')) return toNumber(readFlag(blackboard, path.slice('flag:'.length)));
    const modifier = scope === 'dyn' ? 'dyn' : null;
    let sum = 0;
    for (const tag of attributes) {
      const parsed = parseTag(tag);
      if ((parsed.modifier ?? null) !== modifier) continue;
      if (!matchTagPath(path, parsed.segments, { mode: 'open' })) continue;
      sum += toNumber(resolveTagValue('numeric', parsed, null));
      if (!isPattern(path)) break;
    }
    return sum;
  };
}

// Evaluates an expression for one agent, rolling dice through the seeded
// stream and recording each roll on the flow.
function evaluate(source, op, flow, ctx) {
  const roll = (count, sides) => {
    const rollIndex = ctx.nextRollIndex(op.id);
    const key = rollSeedKey({ clock: ctx.clock, taskId: ctx.task.id, operatorId: op.id, agentId: ctx.agent.id, rollIndex });
    const { result } = rollDice(key, count, sides);
    flow.rolls.push({ operatorId: op.id, agentId: ctx.agent.id, rollIndex, notation: `${count}d${sides}`, result });
    return result;
  };
  return evaluateCheck(source, { resolve: makeResolver({ ...ctx, flow }), roll }).value;
}

// A gate on a tag path: the first plain effective attribute matching the path
// (`open` mode) whose display value passes `compare`.
function gateOnTag(op, flow, ctx) {
  const match = ctx.attributes
    .map(tag => parseTag(tag))
    .find(parsed => !parsed.modifier
      && matchTagPath(op.read, parsed.segments, { mode: 'open' })
      && matchTagValue(op.compare ?? null, resolveTagValue('display', parsed, ctx.registry)));
  if (!match) return { ...flow, admitted: false };
  return { ...flow, matchedValue: resolveTagValue('numeric', match, ctx.registry) ?? 0 };
}

// A gate on a number: compared when `compare` is set, else passes when nonzero.
const gateOnValue = (op, flow, value) => {
  const passes = op.compare ? matchTagValue(op.compare, value) : Number.isFinite(value) && value !== 0;
  return passes ? flow : { ...flow, admitted: false };
};

function gate(op, flow, ctx) {
  if (op.expr !== undefined) return gateOnValue(op, flow, evaluate(op.expr, op, flow, ctx));
  if (op.read === 'flow') return gateOnValue(op, flow, flow.value);
  if (typeof op.read === 'string' && op.read.startsWith('flag:')) {
    return gateOnValue(op, flow, toNumber(readFlag(ctx.blackboard, op.read.slice('flag:'.length).toLowerCase())));
  }
  if (typeof op.read === 'string' && op.read) return gateOnTag(op, flow, ctx);
  return flow;
}

// Deposits `expr` (default 1) into the target vessel: positive, finite amounts only.
function contribute(op, flow, ctx) {
  if (!op.target) return flow;
  const amount = evaluate(op.expr ?? '1', op, flow, ctx);
  if (Number.isFinite(amount) && amount > 0) ctx.deposit(op.target, amount);
  return flow;
}

/**
 * Maps an operator kind to its per-agent step `(op, flow, ctx) => flow`. A
 * step is only called for an admitted flow. Unknown kinds (including the
 * inert `write` that lowering emits for an unknown tracker) pass the flow
 * through.
 *
 * @type {Object<string, (op: object, flow: Flow, ctx: object) => Flow>}
 */
export const OPERATOR_REGISTRY = {
  gate,
  contribute,
  effect: (op, flow) => flow,
};

/**
 * Maps a quantifier to how it collapses a gate's outcomes: `test(passed,
 * reached)` decides whether every agent that reached the gate is admitted.
 * `count` also makes the segment's contribute deposit the passer count once.
 */
export const QUANTIFIER_REGISTRY = {
  all: { test: (passed, reached) => reached > 0 && passed === reached },
  any: { test: (passed) => passed >= 1 },
  count: { test: (passed) => passed >= 1, count: true },
  atLeast: (n) => ({ test: (passed) => passed >= n }),
};

/**
 * Resolves an operator's `quantifier` string: a `QUANTIFIER_REGISTRY` key or
 * `atLeast(n)`.
 *
 * @param {string|undefined} quantifier
 * @returns {{ test: Function, count?: boolean }|null} `null` — no quantifier, or
 *   an unknown one: the gate runs per agent
 */
export function parseQuantifier(quantifier) {
  if (typeof quantifier !== 'string') return null;
  const atLeast = quantifier.match(/^atLeast\((\d+)\)$/);
  if (atLeast) return QUANTIFIER_REGISTRY.atLeast(Number(atLeast[1]));
  const entry = QUANTIFIER_REGISTRY[quantifier];
  return entry && typeof entry !== 'function' ? entry : null;
}

/**
 * Runs one task's operators for its engaged agents on one tick. Reads only
 * the snapshot it is given; returns what the tick should write.
 *
 * - Gates reject per agent; a quantified gate then admits or rejects every
 *   agent that reached it at once. Outcomes are recorded before the collapse.
 * - A `contribute` closes a segment: the operators after it start from a
 *   fresh flow (rolls carry over), so lowered conditions stay independent.
 * - A gate's `pass` / `fail` effects fire once if any agent reached that
 *   outcome; an `effect` operator's `pass` effects fire once if any admitted
 *   flow reaches it; a contribute's `threshold` effects are returned for the
 *   clock to check once the tick's writes apply.
 *
 * @param {Task} task - The task as of the start of the tick
 * @param {{ agent: Agent, attributes: string[] }[]} engaged - Engaged agents
 *   in board order, with their effective attributes
 * @param {{ session: Session, registry: TagRegistry, clock: number }} context -
 *   `clock` seeds the rolls (the tick's post-advance clock)
 * @returns {{ deposits: { agentId: string, opIndex: number, vessel: string, amount: number }[],
 *   outcomes: Object<string, { pass: string[], fail: string[] }>,
 *   fired: { operatorId: string, on: string, actions: object[] }[],
 *   thresholds: { operatorId: string, vessel: string, actions: object[] }[],
 *   rolls: RollRecord[], contributors: Set<string> }}
 */
export function runTaskOperators(task, engaged, { session, registry, clock }) {
  const deposits = [];
  const outcomes = {};
  const fired = [];
  const thresholds = [];
  const contributors = new Set();
  const rollCounters = new Map();
  const blackboard = task.blackboard ?? {};

  const contexts = engaged.map(({ agent, attributes }) => ({
    task, agent, attributes, session, registry, blackboard, clock,
    nextRollIndex: (operatorId) => {
      const key = `${operatorId}|${agent.id}`;
      const index = rollCounters.get(key) ?? 0;
      rollCounters.set(key, index + 1);
      return index;
    },
  }));

  const fire = (op, on, agentIds) => {
    if (!agentIds.length) return;
    for (const effect of op.effects ?? []) {
      if (effect.on === on) fired.push({ operatorId: op.id, on, actions: effect.actions });
    }
  };

  let flows = engaged.map(() => createFlow());
  let countedPassers = null;

  (task.operators ?? []).forEach((op, opIndex) => {
    const step = OPERATOR_REGISTRY[op.kind];
    if (!step) return;
    const reached = flows.map(flow => flow.admitted);

    if (op.kind === 'contribute' && countedPassers !== null) {
      if (op.target && countedPassers.length) {
        deposits.push({ agentId: '', opIndex, vessel: op.target, amount: countedPassers.length });
        countedPassers.forEach(id => contributors.add(id));
      }
    } else {
      flows = flows.map((flow, index) => {
        if (!flow.admitted) return flow;
        const ctx = {
          ...contexts[index],
          deposit: (vessel, amount) => {
            deposits.push({ agentId: engaged[index].agent.id, opIndex, vessel, amount });
            contributors.add(engaged[index].agent.id);
          },
        };
        return step(op, flow, ctx);
      });
    }

    if (op.kind === 'gate') {
      const pass = engaged.filter((_, index) => reached[index] && flows[index].admitted).map(({ agent }) => agent.id);
      const fail = engaged.filter((_, index) => reached[index] && !flows[index].admitted).map(({ agent }) => agent.id);
      outcomes[op.id] = { pass, fail };
      fire(op, 'pass', pass);
      fire(op, 'fail', fail);
      const quantifier = parseQuantifier(op.quantifier);
      if (quantifier) {
        const admitted = quantifier.test(pass.length, pass.length + fail.length);
        flows = flows.map((flow, index) => (reached[index] ? { ...flow, admitted } : flow));
        if (quantifier.count) countedPassers = admitted ? pass : [];
      }
    }

    if (op.kind === 'effect') {
      const pass = engaged.filter((_, index) => reached[index]).map(({ agent }) => agent.id);
      outcomes[op.id] = { pass, fail: [] };
      fire(op, 'pass', pass);
    }

    if (op.kind === 'contribute') {
      for (const effect of op.effects ?? []) {
        if (effect.on === 'threshold' && op.target) thresholds.push({ operatorId: op.id, vessel: op.target, actions: effect.actions });
      }
      flows = flows.map(flow => ({ ...createFlow(), rolls: flow.rolls }));
      countedPassers = null;
    }
  });

  return { deposits, outcomes, fired, thresholds, rolls: flows.flatMap(flow => flow.rolls), contributors };
}
