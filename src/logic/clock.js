import { parseTag } from './tags.js';
import { formatClockParts } from './time.js';
import { getCurrentTask, getEffectiveAttributes } from './agents.js';
import { getWorkRequirements, checkTaskComplete, computeBlockedTaskIds, applyTaskComplete } from './tasks.js';

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
 * - Applies work progress to their current task based on skill match.
 * - Queues flash animations for agents that couldn't contribute (no bank, blocked task, skill mismatch).
 * - Completes any tasks that now meet all work requirements.
 *
 * Returns the accumulated per-task work rates for the RAF interpolation loop.
 *
 * @param {GameState} state
 * @returns {{ newState: GameState, flashAgentIds: string[], taskWorkPerTick: object }}
 */
export function advanceTime(state) {
  const { agents, session } = state;
  const flashAgentIds = [];
  const taskWorkPerTick = {};

  const stepMins = getStepMinutes(session);
  const stepDays = stepMins / 1440;

  let tasks     = state.tasks.map(task => ({ ...task, workProgress: { ...task.workProgress } }));
  let inventory = state.inventory.map(item => ({ ...item }));
  let newSession = { ...session };
  let newAgents = agents.map(agent => ({ ...agent, activities: [...agent.activities] }));

  const getTask  = agent => getCurrentTask(agent, tasks);

  const working = newAgents.filter(agent => getTask(agent) !== null);

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

        const workRate   = newSession.workRate   ?? 1;
        const skillBonus = newSession.skillBonus ?? 1;
        const tasksWithWork = new Set();

        for (const agent of eligible) {
          const task = getTask(agent);
          if (!task) continue;
          let agentContributed = false;

          const currentAttrs = getEffectiveAttributes(agent.attributes, agent.activities, inventory);
          for (const req of getWorkRequirements(task)) {
            const workType  = req.segments[1] ?? null;  // e.g. 'skill'
            const skillName = req.segments[2] ?? null;  // e.g. 'arcana', or null for any
            const key = req.segments.slice(1).join(':');
            let rate;
            if (workType === 'skill') {
              const skillTag = currentAttrs.find(attr => {
                const parsedAttr = parseTag(attr);
                if (parsedAttr.segments[0] !== 'skill') return false;
                return !skillName || parsedAttr.segments[1]?.toLowerCase() === skillName.toLowerCase();
              });
              if (!skillTag) continue;
              const skillVal = parseFloat(parseTag(skillTag).value) || 1;
              rate = (workRate + skillVal * skillBonus) * stepDays;
            } else {
              rate = workRate * stepDays;
            }
            task.workProgress[key]        = (task.workProgress[key] ?? 0) + rate;
            taskWorkPerTick[task.id]    ??= {};
            taskWorkPerTick[task.id][key] = (taskWorkPerTick[task.id][key] ?? 0) + rate;
            agentContributed = true;
            tasksWithWork.add(task.id);
          }

          if (!agentContributed) flashAgentIds.push(agent.id);
        }

        for (const agent of eligible) {
          const task = getTask(agent);
          if (task && !tasksWithWork.has(task.id)) flashAgentIds.push(agent.id);
        }

        // Complete finished tasks
        for (const task of tasks) {
          if (!task.isComplete && checkTaskComplete(task)) {
            const result = applyTaskComplete(task.id, tasks, newAgents, inventory);
            tasks     = result.newTasks;
            newAgents = result.newAgents;
            inventory = result.newInventory;
            newSession.bank = (newSession.bank ?? 0) + result.bankDelta;
          }
        }
      }
    }
  }

  newSession.clock = (parseFloat(newSession.clock) || 0) + stepMins;

  return {
    newState: { ...state, agents: newAgents, tasks, inventory, session: newSession },
    flashAgentIds,
    taskWorkPerTick,
  };
}

/**
 * Interpolates the clock display and task progress bars between discrete game ticks.
 * Called every animation frame from `usePlayClock`'s RAF loop. Writes directly to the
 * DOM — does not go through React state.
 *
 * Interpolation fraction is `elapsed / tickIntervalMs`, clamped to [0, 1].
 * Progress is capped per-bucket at the bucket's own target to prevent one overachieving
 * skill from visually inflating the total bar past 100%.
 *
 * @param {GameState} state - Current (last committed) game state
 * @param {{ lastTickWallTime: number, tickIntervalMs: number, taskWorkPerTick: object }} tickInfo
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

  const rates = tickInfo.taskWorkPerTick || {};
  for (const task of state.tasks) {
    if (task.isComplete) continue;
    const buckets = rates[task.id];
    if (!buckets) continue;
    const reqs = getWorkRequirements(task);
    const totalRequired = reqs.reduce((sum, e) => sum + e.value, 0);
    if (!totalRequired) continue;

    // Cap each bucket at its own target so overshoot in one skill can't inflate
    // the overall bar past the sum-of-targets denominator.
    let totalCapped = 0;
    for (const req of reqs) {
      const key    = req.segments.slice(1).join(':');
      const stored = task.workProgress?.[key] ?? 0;
      const rate   = buckets[key] ?? 0;
      const interp = Math.max(0, stored - rate + frac * rate);
      totalCapped += Math.min(req.value, interp);
    }
    const headerPct = Math.min(100, (totalCapped / totalRequired) * 100);
    const headerFill = document.querySelector(`.task-progress-fill[data-task-id="${task.id}"]`);
    if (headerFill) headerFill.style.width = `${headerPct.toFixed(1)}%`;

    for (const req of reqs) {
      const key    = req.segments.slice(1).join(':');
      const stored = task.workProgress?.[key] ?? 0;
      const rate   = buckets[key] ?? 0;
      const interp = Math.max(0, stored - rate + frac * rate);
      const pct    = Math.min(100, (interp / req.value) * 100);
      const sel    = `[data-task-id="${task.id}"][data-work-key="${key}"]`;
      const bucketFill = document.querySelector(`.work-item-bar-fill${sel}`);
      if (bucketFill) bucketFill.style.width = `${pct.toFixed(1)}%`;
      const valueDisplay = document.querySelector(`.work-item-value${sel}`);
      if (valueDisplay) valueDisplay.textContent = `${Math.floor(Math.min(interp, req.value))} / ${req.value}`;
    }
  }
}
