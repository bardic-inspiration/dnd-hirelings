// Rollback — event-based clock rewind. A step-back finds the most recent
// `'tick'` boundary event in `state.eventLog`, applies the INVERSE of every
// event in that tick's group (switchboard-gated per effect category), and
// truncates the group off the log, so replaying forward regenerates fresh
// events and the log tail always ends at a tick boundary (or is empty).
//
// Rollback reverses TICK EFFECTS ONLY. Manual edits made since a tick (renamed
// tasks, adjusted progress, bank spending) survive: inverses subtract recorded
// deltas rather than restoring snapshots, and every inverse is best-effort —
// missing entities are skipped and quantities clamp at zero, never blocking.

import { buildTag } from './tags.js';
import { MAX_LOG_ROWS } from './eventLog.js';

/**
 * Fallback rollback configuration used by pure logic functions when no
 * document is supplied. Runtime overrides come from `public/config/rollback.yml`
 * via `normalizeRollbackConfig`.
 *
 * @type {{ enabled: boolean,
 *   reverse: { workProgress: boolean, wages: boolean, taskCompletion: boolean,
 *     rewardGold: boolean, rewardItems: boolean, spawnedAgents: boolean,
 *     agentReassignment: boolean },
 *   log: { enabled: boolean, maxRows: number } }}
 */
export const DEFAULT_ROLLBACK_CONFIG = Object.freeze({
  enabled: true,
  reverse: Object.freeze({
    workProgress: true,
    wages: true,
    taskCompletion: true,
    rewardGold: true,
    rewardItems: true,
    spawnedAgents: true,
    agentReassignment: true,
  }),
  log: Object.freeze({ enabled: true, maxRows: MAX_LOG_ROWS }),
});

const REVERSE_KEYS = Object.keys(DEFAULT_ROLLBACK_CONFIG.reverse);

const booleanScalar = (label) => ({ kind: 'scalar', value: 'boolean', label });

/**
 * Config-editor schema for `public/config/rollback.yml` (see logic/configEditor.js
 * for the descriptor grammar).
 */
export const ROLLBACK_SCHEMA = {
  kind: 'map',
  closed: true,
  keys: {
    enabled: booleanScalar('ROLLBACK'),
    reverse: {
      kind: 'map',
      closed: true,
      keys: {
        workProgress:      booleanScalar('WORK PROGRESS'),
        wages:             booleanScalar('WAGES'),
        taskCompletion:    booleanScalar('TASK COMPLETION'),
        rewardGold:        booleanScalar('REWARD GOLD'),
        rewardItems:       booleanScalar('REWARD ITEMS'),
        spawnedAgents:     booleanScalar('SPAWNED AGENTS'),
        agentReassignment: booleanScalar('REASSIGNMENT'),
      },
    },
    log: {
      kind: 'map',
      closed: true,
      keys: {
        enabled: booleanScalar('LOGGING'),
        maxRows: { kind: 'scalar', value: 'number', min: 1, label: 'MAX ROWS' },
      },
    },
  },
};

/**
 * Guards a raw rollback config document (from fetch, overlay, or storage).
 * Every switch defaults to `true` unless explicitly `false`; `maxRows` falls
 * back to `MAX_LOG_ROWS` when missing or malformed. Lenient — never throws.
 *
 * @param {object} doc - Raw document from `yaml.load` (may be `null`/partial)
 * @returns {typeof DEFAULT_ROLLBACK_CONFIG} A fully-populated rollback config
 */
export function normalizeRollbackConfig(doc) {
  const source = doc && typeof doc === 'object' ? doc : {};
  const reverseIn = source.reverse && typeof source.reverse === 'object' ? source.reverse : {};
  const logIn = source.log && typeof source.log === 'object' ? source.log : {};
  const reverse = {};
  for (const key of REVERSE_KEYS) reverse[key] = reverseIn[key] !== false;
  const maxRows = Number(logIn.maxRows);
  return {
    enabled: source.enabled !== false,
    reverse,
    log: {
      enabled: logIn.enabled !== false,
      maxRows: Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : MAX_LOG_ROWS,
    },
  };
}

/**
 * Computes how far back the event log allows the clock to wind.
 * The horizon is log-limited: since every tick advances the clock by one, the
 * earliest reachable time is one tick before the oldest logged tick's stamp
 * (`clock − 1`). Legacy logs without `'tick'` events have no reachable history.
 *
 * @param {EventLogEntry[]} eventLog
 * @returns {{ canStepBack: boolean, earliestClock: number|null }}
 */
export function getRollbackHorizon(eventLog) {
  const firstTick = (eventLog ?? []).find(event => event.eventType === 'tick');
  if (!firstTick) return { canStepBack: false, earliestClock: null };
  return { canStepBack: true, earliestClock: Math.max(0, firstTick.clock - 1) };
}

// Rounds a bank amount to whole cents, matching `advanceTime`'s wage math.
const roundGold = (amount) => Math.round(amount * 100) / 100;

// Reverses a task completion: un-completes the task and removes its rewards
// per the switchboard, using the ids recorded in the event's `data`.
function reverseCompletion(event, { tasks, agents, inventory, session, reverse }) {
  const data = event.data ?? {};
  const results = data.results ?? {};

  if (reverse.taskCompletion) {
    const task = tasks.find(task => task.id === event.taskId);
    if (task) task.isComplete = false;
  }

  if (reverse.rewardGold) {
    const gold = Number(results.gold) || 0;
    if (gold) session.bank = Math.max(0, roundGold((session.bank ?? 0) - gold));
  }

  if (reverse.rewardItems) {
    for (const reward of results.items ?? []) {
      const quantity = Number(reward.quantity) || 0;
      if (!reward.name || quantity <= 0) continue;
      const stock = inventory.find(item => item.name.toLowerCase() === reward.name.toLowerCase());
      if (stock) stock.quantity = Math.max(0, stock.quantity - quantity);
    }
  }

  let newAgents = agents;
  if (reverse.spawnedAgents && Array.isArray(data.spawnedAgentIds) && data.spawnedAgentIds.length) {
    const spawnedIds = new Set(data.spawnedAgentIds);
    newAgents = newAgents.filter(agent => !spawnedIds.has(agent.id));
  }

  if (reverse.agentReassignment && Array.isArray(data.unassignedAgentIds)) {
    const taskExists = tasks.some(task => task.id === event.taskId);
    const taskTag = buildTag(['task', event.taskId]);
    if (taskExists) {
      for (const agentId of data.unassignedAgentIds) {
        const agent = newAgents.find(agent => agent.id === agentId);
        if (agent && !agent.activities.includes(taskTag)) agent.activities.push(taskTag);
      }
    }
  }

  return newAgents;
}

/**
 * Pure inverse of one `advanceTime` tick. Finds the most recent `'tick'`
 * boundary in `state.eventLog` and reverses that tick's event group:
 *
 * - `'tick'` — decrements the clock by one and, per `reverse.wages`, refunds the
 *   recorded wage total (exact, since it captured the rounded bank delta).
 * - `'task_complete'` — per switchboard: un-completes the task, removes reward
 *   gold/items (clamped at 0), deletes recorded spawned agents (even if edited
 *   since), and restores recorded task assignments.
 * - `'work_contribution'` — per `reverse.workProgress`: subtracts the recorded
 *   delta from the condition's progress, clamped at 0 (never snapshot-restored,
 *   so manual progress edits made since the tick survive).
 *
 * Every inverse is best-effort: entities deleted since the tick are skipped.
 * The reverted group is truncated off the returned log.
 *
 * @param {GameState} state
 * @param {typeof DEFAULT_ROLLBACK_CONFIG} [rollbackConfig]
 * @returns {{ newState: GameState }|null} `null` when no tick boundary exists
 *   (log start, cleared log, or legacy pre-rollback history)
 */
export function rollbackTick(state, rollbackConfig = DEFAULT_ROLLBACK_CONFIG) {
  const log = state.eventLog ?? [];
  let tickIndex = -1;
  for (let index = log.length - 1; index >= 0; index--) {
    if (log[index].eventType === 'tick') { tickIndex = index; break; }
  }
  if (tickIndex === -1) return null;

  let groupStart = 0;
  for (let index = tickIndex - 1; index >= 0; index--) {
    if (log[index].eventType === 'tick') { groupStart = index + 1; break; }
  }

  const reverse = rollbackConfig.reverse ?? DEFAULT_ROLLBACK_CONFIG.reverse;
  const tasks = state.tasks.map(task => ({
    ...task,
    conditions: (task.conditions || []).map(condition => ({ ...condition })),
  }));
  const inventory = state.inventory.map(item => ({ ...item }));
  const session = { ...state.session };
  let agents = state.agents.map(agent => ({ ...agent, activities: [...agent.activities] }));

  // Strict LIFO: completions and work rows (which mutated state after wages
  // were paid) reverse first; the boundary event's wage refund and clock
  // decrement come last, so the reward-gold clamp can't swallow the refund.
  for (let index = tickIndex - 1; index >= groupStart; index--) {
    const event = log[index];
    if (event.eventType === 'task_complete') {
      agents = reverseCompletion(event, { tasks, agents, inventory, session, reverse });
    } else if (event.eventType === 'work_contribution' && reverse.workProgress) {
      const task = tasks.find(task => task.id === event.taskId);
      const condition = task?.conditions.find(condition => condition.id === event.conditionId);
      if (condition) condition.progress = Math.max(0, condition.progress - (Number(event.delta) || 0));
    }
  }

  const boundary = log[tickIndex];
  session.clock = Math.max(0, (parseFloat(session.clock) || 0) - 1);
  if (reverse.wages) {
    const wagesTotal = Number(boundary.data?.wagesTotal) || 0;
    if (wagesTotal) session.bank = roundGold((session.bank ?? 0) + wagesTotal);
  }

  return {
    newState: { ...state, agents, tasks, inventory, session, eventLog: log.slice(0, groupStart) },
  };
}

/**
 * Reverses up to `count` ticks by looping `rollbackTick`, threading state and
 * stopping early at the horizon. The symmetric inverse of `advanceTime`: the
 * step-back button calls it with `count: session.stepBack`.
 *
 * @param {GameState} state
 * @param {{ count?: number, rollbackConfig?: typeof DEFAULT_ROLLBACK_CONFIG }} [options]
 *   `count` defaults to `session.stepBack`.
 * @returns {{ newState: GameState }|null} `null` when nothing could be reversed
 *   (already at the horizon, or a cleared/legacy log)
 */
export function rollbackTime(state, { count, rollbackConfig = DEFAULT_ROLLBACK_CONFIG } = {}) {
  const ticks = Math.max(1, Math.round(Number(count ?? state.session.stepBack) || 1));
  let current = state;
  let reversed = false;
  for (let i = 0; i < ticks; i++) {
    const result = rollbackTick(current, rollbackConfig);
    if (!result) break;
    current = result.newState;
    reversed = true;
  }
  return reversed ? { newState: current } : null;
}
