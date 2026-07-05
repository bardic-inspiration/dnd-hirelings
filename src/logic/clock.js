import { formatClockParts } from './time.js';
import { DEFAULT_CLOCK_CONFIG } from './clockConfig.js';
import { DEFAULT_ROLLBACK_CONFIG } from './rollback.js';
import { getCurrentTask, getEffectiveAttributes } from './agents.js';
import { checkTaskComplete, computeBlockedTaskIds, applyTaskComplete } from './tasks.js';
import { computeConditionContribution } from './conditions.js';
import { makeWorkEvent, makeCompleteEvent, makeTickEvent, capEventLog } from './eventLog.js';
import { formatCount } from './format.js';

/**
 * Returns the number of in-game minutes that one tick advances the clock.
 * Reads `session.timeStep` as days, converts to minutes via the configured
 * calendar. Defaults to 1 day if the value is missing or non-numeric.
 *
 * @param {Session} session
 * @param {typeof DEFAULT_CLOCK_CONFIG} [clockConfig]
 * @returns {number} Minutes per tick
 */
export function getStepMinutes(session, clockConfig = DEFAULT_CLOCK_CONFIG) {
  const { minutesPerDay } = clockConfig.calendar;
  const days = Number(session.timeStep);
  return days > 0 ? days * minutesPerDay : minutesPerDay;
}

/**
 * Returns the wall-clock milliseconds between game ticks.
 * Each stepped day costs `realTime.msPerStepDay` real milliseconds, scaled
 * down by `rateMultiplier` and floored at `realTime.minTickIntervalMs`.
 *
 * @param {Session} session
 * @param {typeof DEFAULT_CLOCK_CONFIG} [clockConfig]
 * @returns {number} Milliseconds between ticks
 */
export function getPlayIntervalMs(session, clockConfig = DEFAULT_CLOCK_CONFIG) {
  const { msPerStepDay, minTickIntervalMs } = clockConfig.realTime;
  const rate     = session.rateMultiplier || 1;
  const stepDays = getStepMinutes(session, clockConfig) / clockConfig.calendar.minutesPerDay;
  return Math.max(minTickIntervalMs, (stepDays / rate) * msPerStepDay);
}

/**
 * Pure simulation tick. Advances the clock by one step and computes all side effects.
 *
 * For each eligible working agent:
 * - Deducts their daily rate from the bank (proportional to stepDays).
 * - Applies progress to each condition of their current task via the condition's tracker.
 * - Queues flash animations for agents that couldn't contribute (no bank, blocked task,
 *   no condition matched their attributes).
 *
 * Completion is evaluated for every task at the end of every tick, so manually
 * edited condition progress also completes on the next tick.
 *
 * When `rollbackConfig.log.enabled` is true, appends one `work_contribution`
 * event per (agent, condition, game day), one `task_complete` event per task
 * that finishes this tick, and one `'tick'` boundary event sealing the batch
 * (ordering contract: `work* → task_complete* → tick`) to `newState.eventLog`
 * (FIFO-capped at `rollbackConfig.log.maxRows`). A multi-day tick is split into
 * one work row per day. The tick event records the step size and exact wage
 * total so `rollbackTick` can reverse the tick precisely. Task progress is
 * mutated identically whether or not logging is enabled.
 *
 * Returns the accumulated per-condition progress rates for the RAF interpolation loop.
 *
 * @param {GameState} state
 * @param {{ clockConfig?: typeof DEFAULT_CLOCK_CONFIG,
 *   rollbackConfig?: typeof DEFAULT_ROLLBACK_CONFIG }} [configs]
 * @returns {{ newState: GameState, flashAgentIds: string[], taskProgressPerTick: object }}
 */
export function advanceTime(state, { clockConfig = DEFAULT_CLOCK_CONFIG, rollbackConfig = DEFAULT_ROLLBACK_CONFIG } = {}) {
  const { agents, session } = state;
  const flashAgentIds = [];
  // { [taskId]: { [conditionId]: progressUnitsThisTick } }
  const taskProgressPerTick = {};

  const { minutesPerDay } = clockConfig.calendar;
  const stepMins = getStepMinutes(session, clockConfig);
  const stepDays = stepMins / minutesPerDay;

  // Event-log accumulation. `seq` continues from the last retained entry's id so
  // ids stay monotonic even after FIFO trimming (the live length can lag the
  // total appended). `dayCount` splits a multi-day tick into per-day rows.
  const logEnabled = rollbackConfig.log.enabled;
  const maxRows    = rollbackConfig.log.maxRows;
  const newEvents = [];
  const lastEntry = state.eventLog?.[state.eventLog.length - 1];
  let seq = (lastEntry && Number.isFinite(lastEntry.seq) ? lastEntry.seq : -1) + 1;
  const clockBefore = parseFloat(session.clock) || 0;
  const dayCount = Math.max(1, Math.round(stepDays));

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
            const rate = computeConditionContribution(condition, { effectiveAttributes, session: newSession, stepDays });
            if (rate <= 0) continue;
            const startProgress = condition.progress;
            condition.progress += rate;
            // When logging is enabled, split the tick's contribution into per-day
            // rows so the log is day-granular even when timeStep spans several days.
            // Snapshots derive from startProgress, so progress is mutated once and
            // is identical whether or not logging is on.
            if (logEnabled) {
              const perDay = rate / dayCount;
              for (let day = 1; day <= dayCount; day++) {
                const clock = clockBefore + day * minutesPerDay;
                newEvents.push(makeWorkEvent({
                  seq: seq++, clock, day: Math.floor(clock / minutesPerDay),
                  agent, task, condition, delta: perDay, progress: startProgress + day * perDay,
                }));
              }
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
  const completionClock = clockBefore + stepMins;
  for (const task of tasks) {
    if (!task.isComplete && checkTaskComplete(task, tasksWithEligibleAgents.has(task.id))) {
      const result = applyTaskComplete(task.id, tasks, newAgents, inventory);
      tasks     = result.newTasks;
      newAgents = result.newAgents;
      inventory = result.newInventory;
      newSession.bank = (newSession.bank ?? 0) + result.bankDelta;
      if (logEnabled) {
        newEvents.push(makeCompleteEvent({
          seq: seq++, clock: completionClock, day: Math.floor(completionClock / minutesPerDay), task,
          spawnedAgentIds: result.spawnedAgentIds, unassignedAgentIds: result.unassignedAgentIds,
        }));
      }
    }
  }

  // Seal the batch with the tick boundary event — appended on every tick so
  // rollback is uniformly tick-granular even when no work happened.
  if (logEnabled) {
    newEvents.push(makeTickEvent({
      seq, clock: completionClock, day: Math.floor(completionClock / minutesPerDay),
      stepMins, wagesTotal, wages,
    }));
  }

  newSession.clock = (parseFloat(newSession.clock) || 0) + stepMins;
  const eventLog = capEventLog([...(state.eventLog ?? []), ...newEvents], maxRows);

  return {
    newState: { ...state, agents: newAgents, tasks, inventory, session: newSession, eventLog },
    flashAgentIds,
    taskProgressPerTick,
  };
}

/**
 * Interpolates the clock display and task progress bars between discrete game ticks.
 * Called every animation frame from `usePlayClock`'s RAF loop. Writes directly to the
 * DOM — does not go through React state. Skips any element that currently has focus,
 * so click-to-edit condition progress is never clobbered mid-edit.
 *
 * Interpolation fraction is `elapsed / tickIntervalMs`, clamped to [0, 1].
 * Progress is capped per-condition at the condition's own target to prevent one
 * overachieving condition from visually inflating the total bar past 100%.
 *
 * @param {GameState} state - Current (last committed) game state
 * @param {{ lastTickWallTime: number, tickIntervalMs: number, taskProgressPerTick: object }} tickInfo
 * @param {typeof DEFAULT_CLOCK_CONFIG} [clockConfig]
 */
export function updateClockDisplayDOM(state, tickInfo, clockConfig = DEFAULT_CLOCK_CONFIG) {
  const elapsed  = Date.now() - tickInfo.lastTickWallTime;
  const frac     = Math.min(1, elapsed / tickInfo.tickIntervalMs);
  const stepMins = getStepMinutes(state.session, clockConfig);

  const { year, day } = formatClockParts(state.session.clock + frac * stepMins, clockConfig.calendar);
  const set = (id, val) => {
    const element = document.getElementById(id);
    if (element && document.activeElement !== element) element.textContent = val;
  };
  set('clock-year', year);
  set('clock-day', day);

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
