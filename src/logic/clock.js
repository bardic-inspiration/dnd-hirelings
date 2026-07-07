import { DEFAULT_CLOCK_CONFIG } from './clockConfig.js';
import { DEFAULT_ROLLBACK_CONFIG } from './rollback.js';
import { getCurrentTask, getEffectiveAttributes } from './agents.js';
import { checkTaskComplete, computeBlockedTaskIds, applyTaskComplete } from './tasks.js';
import { computeConditionContribution } from './conditions.js';
import { makeWorkEvent, makeCompleteEvent, makeTickEvent, capEventLog } from './eventLog.js';
import { formatCount } from './format.js';

// The clock's base unit is the tick: `session.clock` counts elapsed ticks and
// every advance moves it by whole ticks. Calendar concepts (days, years) are a
// UI-only presentation of that count (see logic/time.js) and never enter the
// simulation here. One tick equals one day of game progress.

/**
 * Returns the wall-clock milliseconds between play-mode ticks. Each tick costs
 * `realTime.msPerTick` real milliseconds, scaled down by `rateMultiplier` and
 * floored at `realTime.minTickIntervalMs`. Play speed is thus decoupled from the
 * manual step size — every play interval advances exactly one tick.
 *
 * @param {Session} session
 * @param {typeof DEFAULT_CLOCK_CONFIG} [clockConfig]
 * @returns {number} Milliseconds between ticks
 */
export function getPlayIntervalMs(session, clockConfig = DEFAULT_CLOCK_CONFIG) {
  const { msPerTick, minTickIntervalMs } = clockConfig.realTime;
  const rate = session.rateMultiplier || 1;
  return Math.max(minTickIntervalMs, msPerTick / rate);
}

/**
 * Pure simulation of ONE tick — the atomic unit `advanceTime` loops over.
 * Advances the clock by exactly one and computes all side effects.
 *
 * For each eligible working agent:
 * - Deducts their per-tick rate from the bank.
 * - Applies progress to each condition of their current task via the condition's tracker.
 * - Queues flash animations for agents that couldn't contribute (no bank, blocked task,
 *   no condition matched their attributes).
 *
 * Completion is evaluated for every task at the end of the tick, so a task that
 * reaches its target mid-step completes on the correct tick and stops accruing
 * work/wages afterward; manually edited progress completes on the next tick.
 *
 * When `rollbackConfig.log.enabled` is true, appends one `work_contribution`
 * event per (agent, condition), one `task_complete` event per task that finishes
 * this tick, and one `'tick'` boundary event sealing the batch (ordering
 * contract: `work* → task_complete* → tick`) to `newState.eventLog` (FIFO-capped
 * at `rollbackConfig.log.maxRows`). The tick event records the exact wage total
 * so `rollbackTick` can reverse the tick precisely. Task progress is mutated
 * identically whether or not logging is enabled.
 *
 * @param {GameState} state
 * @param {typeof DEFAULT_ROLLBACK_CONFIG} rollbackConfig
 * @returns {{ newState: GameState, flashAgentIds: string[], taskProgressPerTick: object }}
 */
function advanceTick(state, rollbackConfig) {
  const { agents, session } = state;
  const flashAgentIds = [];
  // { [taskId]: { [conditionId]: progressUnitsThisTick } }
  const taskProgressPerTick = {};

  // One tick == one day of contribution; trackers are still parameterized by a
  // day count, which is always 1 here.
  const stepDays = 1;

  // Event-log accumulation. `seq` continues from the last retained entry's id so
  // ids stay monotonic even after FIFO trimming (the live length can lag the
  // total appended). Every event this tick is stamped with the post-tick clock.
  const logEnabled = rollbackConfig.log.enabled;
  const maxRows    = rollbackConfig.log.maxRows;
  const newEvents = [];
  const lastEntry = state.eventLog?.[state.eventLog.length - 1];
  let seq = (lastEntry && Number.isFinite(lastEntry.seq) ? lastEntry.seq : -1) + 1;
  const clockAfter = (parseFloat(session.clock) || 0) + 1;

  let tasks = state.tasks.map(task => ({
    ...task,
    conditions: (task.conditions || []).map(condition => ({ ...condition })),
  }));
  let inventory = state.inventory.map(item => ({ ...item }));
  let newSession = { ...session };
  let newAgents = agents.map(agent => ({ ...agent, activities: [...agent.activities] }));

  const getTask  = agent => getCurrentTask(agent, tasks);

  const working = newAgents.filter(agent => getTask(agent) !== null);
  // Tasks that received eligible work this tick — drives the implied
  // "clock advanced" completion of zero-condition tasks.
  const tasksWithEligibleAgents = new Set();

  // Wage payments recorded on this tick's boundary event so rollback can
  // refund exactly what was deducted (zero/empty when payment was skipped).
  let wagesTotal = 0;
  let wages = [];

  if (working.length) {
    const activeTasks = [...new Set(working.map(agent => getTask(agent)).filter(Boolean))];
    const blockedIds  = computeBlockedTaskIds(activeTasks, inventory);
    const eligible    = working.filter(agent => !blockedIds.has(getTask(agent)?.id));

    working.filter(agent => blockedIds.has(getTask(agent)?.id)).forEach(agent => flashAgentIds.push(agent.id));

    if (eligible.length) {
      const totalCost = eligible.reduce((sum, agent) => sum + (parseFloat(agent.rate) || 0) * stepDays, 0);

      if (totalCost > (newSession.bank ?? 0)) {
        eligible.forEach(agent => flashAgentIds.push(agent.id));
      } else {
        const bankBefore = newSession.bank ?? 0;
        newSession.bank = Math.round((bankBefore - totalCost) * 100) / 100;
        wagesTotal = Math.round((bankBefore - newSession.bank) * 100) / 100;
        wages = eligible.map(agent => ({
          agentId: agent.id,
          agentName: agent.name,
          amount: (parseFloat(agent.rate) || 0) * stepDays,
        }));

        for (const agent of eligible) {
          const task = getTask(agent);
          if (!task) continue;
          tasksWithEligibleAgents.add(task.id);
          // On a zero-condition task, presence alone counts as contributing.
          let agentContributed = task.conditions.length === 0;

          const effectiveAttributes = getEffectiveAttributes(agent.attributes, agent.activities, inventory);
          for (const condition of task.conditions) {
            const rate = computeConditionContribution(condition, { effectiveAttributes, session: newSession, stepDays, registry: state.tagRegistry });
            if (rate <= 0) continue;
            const startProgress = condition.progress;
            condition.progress += rate;
            if (logEnabled) {
              newEvents.push(makeWorkEvent({
                seq: seq++, clock: clockAfter,
                agent, task, condition, delta: rate, progress: startProgress + rate,
              }));
            }
            taskProgressPerTick[task.id]              ??= {};
            taskProgressPerTick[task.id][condition.id]  = (taskProgressPerTick[task.id][condition.id] ?? 0) + rate;
            agentContributed = true;
          }

          if (!agentContributed) flashAgentIds.push(agent.id);
        }
      }
    }
  }

  // Complete finished tasks. `applyTaskComplete` runs BEFORE the event is
  // built so the event can record the spawned/unassigned agent ids rollback
  // needs (the pre-completion `task` reference still supplies name/results).
  for (const task of tasks) {
    if (!task.isComplete && checkTaskComplete(task, tasksWithEligibleAgents.has(task.id))) {
      const result = applyTaskComplete(task.id, tasks, newAgents, inventory);
      tasks     = result.newTasks;
      newAgents = result.newAgents;
      inventory = result.newInventory;
      newSession.bank = (newSession.bank ?? 0) + result.bankDelta;
      if (logEnabled) {
        newEvents.push(makeCompleteEvent({
          seq: seq++, clock: clockAfter, task,
          spawnedAgentIds: result.spawnedAgentIds, unassignedAgentIds: result.unassignedAgentIds,
        }));
      }
    }
  }

  // Seal the tick with the boundary event — appended on every tick so
  // rollback is uniformly tick-granular even when no work happened.
  if (logEnabled) {
    newEvents.push(makeTickEvent({ seq, clock: clockAfter, wagesTotal, wages }));
  }

  newSession.clock = clockAfter;
  const eventLog = capEventLog([...(state.eventLog ?? []), ...newEvents], maxRows);

  return {
    newState: { ...state, agents: newAgents, tasks, inventory, session: newSession, eventLog },
    flashAgentIds,
    taskProgressPerTick,
  };
}

/**
 * Advances the clock by `count` ticks, running `count` independent single-tick
 * simulations (`advanceTick`) so the event log is always tick-level regardless
 * of how many ticks a single call spans. This is the sole clock-advance entry
 * point: the play loop calls it with `count: 1` (one tick per interval) and the
 * manual step-forward button with `count: session.timeStep`.
 *
 * The returned `taskProgressPerTick` sums each tick's per-condition rates so the
 * RAF interpolation animates the whole call's contribution; `flashAgentIds`
 * concatenates every tick's flashes.
 *
 * @param {GameState} state
 * @param {{ count?: number, rollbackConfig?: typeof DEFAULT_ROLLBACK_CONFIG }} [options]
 *   `count` defaults to `session.timeStep`.
 * @returns {{ newState: GameState, flashAgentIds: string[], taskProgressPerTick: object }}
 */
export function advanceTime(state, { count, rollbackConfig = DEFAULT_ROLLBACK_CONFIG } = {}) {
  const ticks = Math.max(1, Math.round(Number(count ?? state.session.timeStep) || 1));

  let current = state;
  const flashAgentIds = [];
  const taskProgressPerTick = {};

  for (let i = 0; i < ticks; i++) {
    const result = advanceTick(current, rollbackConfig);
    current = result.newState;
    for (const id of result.flashAgentIds) flashAgentIds.push(id);
    for (const taskId in result.taskProgressPerTick) {
      taskProgressPerTick[taskId] ??= {};
      const conditionRates = result.taskProgressPerTick[taskId];
      for (const conditionId in conditionRates) {
        taskProgressPerTick[taskId][conditionId] =
          (taskProgressPerTick[taskId][conditionId] ?? 0) + conditionRates[conditionId];
      }
    }
  }

  return { newState: current, flashAgentIds, taskProgressPerTick };
}

/**
 * Interpolates task progress bars between discrete ticks. Called every animation
 * frame from `usePlayClock`'s RAF loop. Writes directly to the DOM — does not go
 * through React state. Skips any element that currently has focus, so
 * click-to-edit condition progress is never clobbered mid-edit.
 *
 * The clock year/day display is not interpolated: one tick = one day, so it has
 * no sub-tick granularity and simply advances via React on each committed tick.
 *
 * Interpolation fraction is `elapsed / tickIntervalMs`, clamped to [0, 1].
 * Progress is capped per-condition at the condition's own target to prevent one
 * overachieving condition from visually inflating the total bar past 100%.
 *
 * @param {GameState} state - Current (last committed) game state
 * @param {{ lastTickWallTime: number, tickIntervalMs: number, taskProgressPerTick: object }} tickInfo
 */
export function updateClockDisplayDOM(state, tickInfo) {
  const elapsed = Date.now() - tickInfo.lastTickWallTime;
  const frac    = Math.min(1, elapsed / tickInfo.tickIntervalMs);

  const rates = tickInfo.taskProgressPerTick || {};
  for (const task of state.tasks) {
    if (task.isComplete) continue;
    const conditionRates = rates[task.id];
    if (!conditionRates) continue;
    const conditions = task.conditions || [];
    const totalRequired = conditions.reduce((sum, condition) => sum + condition.target, 0);
    if (!totalRequired) continue;

    // Cap each condition at its own target so overshoot in one condition can't
    // inflate the overall bar past the sum-of-targets denominator.
    let totalCapped = 0;
    for (const condition of conditions) {
      const rate   = conditionRates[condition.id] ?? 0;
      const interp = Math.max(0, condition.progress - rate + frac * rate);
      totalCapped += Math.min(condition.target, interp);
    }
    const headerPct = Math.min(100, (totalCapped / totalRequired) * 100);
    const headerFill = document.querySelector(`.task-progress-fill[data-task-id="${task.id}"]`);
    if (headerFill) headerFill.style.width = `${headerPct.toFixed(1)}%`;

    for (const condition of conditions) {
      const rate   = conditionRates[condition.id] ?? 0;
      const interp = Math.max(0, condition.progress - rate + frac * rate);
      const pct    = Math.min(100, (interp / condition.target) * 100);
      const sel    = `[data-task-id="${task.id}"][data-condition-id="${condition.id}"]`;
      const conditionFill = document.querySelector(`.condition-item-bar-fill${sel}`);
      if (conditionFill) conditionFill.style.width = `${pct.toFixed(1)}%`;
      const progressDisplay = document.querySelector(`.condition-item-progress${sel}`);
      if (progressDisplay && document.activeElement !== progressDisplay) {
        progressDisplay.textContent = formatCount(Math.floor(Math.min(interp, condition.target)));
      }
    }
  }
}
