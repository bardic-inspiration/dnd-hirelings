// Rollback — event-based clock rewind. A step-back finds the most recent
// `'tick'` boundary event in `state.eventLog`, applies the INVERSE of every
// event in that tick's group (switchboard-gated per effect category), and
// truncates the group off the log, so replaying forward regenerates fresh
// events and the log tail always ends at a tick boundary (or is empty).
//
// Rows that record an action reverse through that action kind's own
// `reverse` (logic/actions.js); rows written before the task engine fall back
// to the matching kind's reverse.
//
// Rollback reverses TICK EFFECTS ONLY. Manual edits made since a tick (renamed
// tasks, adjusted progress, bank spending) survive: inverses subtract recorded
// deltas rather than restoring snapshots, and every inverse is best-effort —
// missing entities are skipped and quantities clamp at zero, never blocking.

import { MAX_LOG_ROWS } from './eventLog.js';
import { reverseActionRow } from './actions.js';

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

// Reverses a `task_complete` row: un-completes the task. A row written before
// the task engine also carries the completion's rewards and id lists (its
// changes have no `action` rows), so those reverse here through the same
// action reverses, in the order the old engine undid them.
function reverseCompletion(world, row, reverse) {
  let next = world;
  if (reverse.taskCompletion) {
    next = { ...next, tasks: next.tasks.map(task => (task.id === row.taskId ? { ...task, isComplete: false } : task)) };
  }
  const data = row.data ?? {};
  if (!data.results) return next;
  const legacyRow = (actionKind, deltas) => ({ taskId: row.taskId, actionKind, data: { deltas }, reverseData: {} });
  const gold = Number(data.results.gold) || 0;
  if (gold) next = reverseActionRow(next, legacyRow('bank.adjust', { amount: gold }), reverse);
  for (const reward of data.results.items ?? []) {
    const quantity = Number(reward.quantity) || 0;
    if (reward.name && quantity > 0) next = reverseActionRow(next, legacyRow('inventory.add', { name: reward.name, quantity }), reverse);
  }
  if (Array.isArray(data.spawnedAgentIds) && data.spawnedAgentIds.length) {
    next = reverseActionRow(next, legacyRow('agent.spawn', { agentIds: data.spawnedAgentIds }), reverse);
  }
  if (Array.isArray(data.unassignedAgentIds)) {
    next = reverseActionRow(next, legacyRow('agent.unassign', { agentIds: data.unassignedAgentIds, taskId: row.taskId }), reverse);
  }
  return next;
}

/**
 * Pure inverse of one `advanceTime` tick. Finds the most recent `'tick'`
 * boundary in `state.eventLog` and reverses that tick's event group:
 *
 * - a row with an `actionKind` — through `ACTION_REGISTRY[kind].reverse`
 *   (`reverseActionRow`), gated by the kind's `reverse.*` switch. A
 *   `work_contribution` row without one (written before the task engine)
 *   reverses as `vessel.deposit`: the delta comes off the vessel's fill,
 *   clamped at 0 (never snapshot-restored, so manual edits made since survive).
 * - `'task_complete'` — per `reverse.taskCompletion`: un-completes the task;
 *   a pre-engine row also reverses the rewards and assignments it recorded.
 * - `'tick'` — decrements the clock by one and, per `reverse.wages`, refunds the
 *   recorded wage total (exact, since it captured the rounded bank delta).
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
  let world = {
    agents: state.agents, tasks: state.tasks, inventory: state.inventory,
    session: state.session, tagRegistry: state.tagRegistry,
  };

  // Strict LIFO: action, completion, and work rows (which changed state after
  // wages were paid) reverse first; the boundary event's wage refund and
  // clock decrement come last, so the reward-gold clamp can't swallow the refund.
  for (let index = tickIndex - 1; index >= groupStart; index--) {
    const event = log[index];
    if (event.eventType === 'task_complete') {
      world = reverseCompletion(world, event, reverse);
    } else if (event.actionKind || event.eventType === 'work_contribution') {
      world = reverseActionRow(world, { ...event, actionKind: event.actionKind || 'vessel.deposit' }, reverse);
    }
  }

  const boundary = log[tickIndex];
  const session = { ...world.session, clock: Math.max(0, (parseFloat(world.session.clock) || 0) - 1) };
  if (reverse.wages) {
    const wagesTotal = Number(boundary.data?.wagesTotal) || 0;
    if (wagesTotal) session.bank = roundGold((session.bank ?? 0) + wagesTotal);
  }

  return {
    newState: { ...state, ...world, session, eventLog: log.slice(0, groupStart) },
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
