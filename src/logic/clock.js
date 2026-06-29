import { formatClockParts } from './time.js';
import { getCurrentTask, getEffectiveAttributes } from './agents.js';
import { checkTaskComplete, computeBlockedTaskIds, applyTaskComplete } from './tasks.js';
import { computeConditionContribution } from './conditions.js';
import { makeWorkEvent, makeCompleteEvent, capEventLog, MAX_LOG_ROWS } from './eventLog.js';

/**
 * Returns the number of in-game minutes that one tick advances the clock.
 * Reads `session.timeStep` as days, converts to minutes (× 1440).
 * Defaults to 1 day (1440 min) if the value is missing or non-numeric.
 *
 * @param {Session} session
 * @returns {number} Minutes per tick
 */
export function getStepMinutes(session) {
  const days = Number(session.timeStep);
  return days > 0 ? days * 1440 : 1440;
}

/**
 * Returns the wall-clock milliseconds between game ticks.
 * Scales by `rateMultiplier` so higher rates shorten the interval.
 * Minimum interval is 16ms (~60fps cap).
 *
 * @param {Session} session
 * @returns {number} Milliseconds between ticks
 */
export function getPlayIntervalMs(session) {
  const rate     = session.rateMultiplier || 1;
  const stepDays = getStepMinutes(session) / 1440;
  return Math.max(16, (stepDays / rate) * 1000);
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
 * Appends one `work_contribution` event per (agent, condition, game day) and one
 * `task_complete` event per task that finishes this tick to `newState.eventLog`
 * (FIFO-capped at `MAX_LOG_ROWS`). A multi-day tick is split into one row per day.
 *
 * Returns the accumulated per-condition progress rates for the RAF interpolation loop.
 *
 * @param {GameState} state
 * @returns {{ newState: GameState, flashAgentIds: string[], taskProgressPerTick: object }}
 */
export function advanceTime(state) {
  const { agents, session } = state;
  const flashAgentIds = [];
  // { [taskId]: { [conditionId]: progressUnitsThisTick } }
  const taskProgressPerTick = {};

  const stepMins = getStepMinutes(session);
  const stepDays = stepMins / 1440;

  // Event-log accumulation. `seq` continues from the live log length so ids stay
  // monotonic; `dayCount` splits a multi-day tick into per-day rows.
  const newEvents = [];
  let seq = state.eventLog?.length ?? 0;
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
        newSession.bank = Math.round(((newSession.bank ?? 0) - totalCost) * 100) / 100;

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
            // Split the tick's contribution into per-day rows so the log is
            // day-granular even when timeStep spans several days.
            const perDay = rate / dayCount;
            for (let day = 1; day <= dayCount; day++) {
              condition.progress += perDay;
              const clock = clockBefore + day * 1440;
              newEvents.push(makeWorkEvent({
                seq: seq++, clock, day: Math.floor(clock / 1440),
                agent, task, condition, delta: perDay, progress: condition.progress,
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

  // Complete finished tasks
  const completionClock = clockBefore + stepMins;
  for (const task of tasks) {
    if (!task.isComplete && checkTaskComplete(task, tasksWithEligibleAgents.has(task.id))) {
      newEvents.push(makeCompleteEvent({
        seq: seq++, clock: completionClock, day: Math.floor(completionClock / 1440), task,
      }));
      const result = applyTaskComplete(task.id, tasks, newAgents, inventory);
      tasks     = result.newTasks;
      newAgents = result.newAgents;
      inventory = result.newInventory;
      newSession.bank = (newSession.bank ?? 0) + result.bankDelta;
    }
  }

  newSession.clock = (parseFloat(newSession.clock) || 0) + stepMins;
  const eventLog = capEventLog([...(state.eventLog ?? []), ...newEvents], MAX_LOG_ROWS);

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
 */
export function updateClockDisplayDOM(state, tickInfo) {
  const elapsed  = Date.now() - tickInfo.lastTickWallTime;
  const frac     = Math.min(1, elapsed / tickInfo.tickIntervalMs);
  const stepMins = getStepMinutes(state.session);

  const { year, day } = formatClockParts(state.session.clock + frac * stepMins);
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
        progressDisplay.textContent = String(Math.floor(Math.min(interp, condition.target)));
      }
    }
  }
}
