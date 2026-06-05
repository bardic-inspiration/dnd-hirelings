import { parseTag } from './tags.js';
import { formatClockParts } from './time.js';
import { getCurrentTask, getCurrentAttributes } from './agents.js';
import { getWorkRequirements, checkTaskComplete, computeBlockedTaskIds, applyTaskComplete } from './tasks.js';

export function getStepMinutes(session) {
  const m = String(session.timeStep).match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) * 1440 : 1440;
}

export function getPlayIntervalMs(session) {
  const rate     = session.rateMultiplier || 1;
  const stepDays = getStepMinutes(session) / 1440;
  return Math.max(16, (stepDays / rate) * 1000);
}

// Pure tick: returns { newState, flashAgentIds, taskWorkPerTick }
export function advanceTime(state) {
  const { agents, session } = state;
  const flashAgentIds = [];
  const taskWorkPerTick = {};

  const stepMins = getStepMinutes(session);
  const stepDays = stepMins / 1440;

  let tasks     = state.tasks.map(t => ({ ...t, workProgress: { ...t.workProgress } }));
  let inventory = state.inventory.map(i => ({ ...i }));
  let newSession = { ...session };
  let newAgents = agents.map(a => ({ ...a, activities: [...a.activities] }));

  const findTask = id => tasks.find(t => t.id === id);
  const getTask  = agent => getCurrentTask(agent, tasks);

  const working = newAgents.filter(a => getTask(a) !== null);

  if (working.length) {
    const activeTasks = [...new Set(working.map(a => getTask(a)).filter(Boolean))];
    const blockedIds  = computeBlockedTaskIds(activeTasks, inventory);
    const eligible    = working.filter(a => !blockedIds.has(getTask(a)?.id));

    working.filter(a => blockedIds.has(getTask(a)?.id)).forEach(a => flashAgentIds.push(a.id));

    if (eligible.length) {
      const totalCost = eligible.reduce((sum, a) => sum + (parseFloat(a.rate) || 0) * stepDays, 0);

      if (totalCost > (newSession.bank ?? 0)) {
        eligible.forEach(a => flashAgentIds.push(a.id));
      } else {
        newSession.bank = Math.round(((newSession.bank ?? 0) - totalCost) * 100) / 100;

        const workRate   = newSession.workRate   ?? 1;
        const skillBonus = newSession.skillBonus ?? 1;
        const tasksWithWork = new Set();

        for (const agent of eligible) {
          const task = getTask(agent);
          if (!task) continue;
          let agentContributed = false;

          const currentAttrs = getCurrentAttributes(agent.attributes, agent.activities, inventory);
          for (const req of getWorkRequirements(task)) {
            const workType  = req.segments[1] ?? null;  // e.g. 'skill'
            const skillName = req.segments[2] ?? null;  // e.g. 'arcana', or null for any
            const key = workType || '';
            let rate;
            if (workType === 'skill') {
              const skillTag = currentAttrs.find(attr => {
                const ap = parseTag(attr);
                if (ap.segments[0] !== 'skill') return false;
                return !skillName || ap.segments[1]?.toLowerCase() === skillName.toLowerCase();
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

// Called from RAF loop — interpolates clock + per-task progress bars between
// game ticks so visuals advance smoothly even when state hasn't changed.
export function updateClockDisplayDOM(state, tickInfo) {
  const elapsed  = Date.now() - tickInfo.lastTickWallTime;
  const frac     = Math.min(1, elapsed / tickInfo.tickIntervalMs);
  const stepMins = getStepMinutes(state.session);

  const { year, day } = formatClockParts(state.session.clock + frac * stepMins);
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.textContent = val;
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
      const key    = req.segments[1] || '';
      const stored = task.workProgress?.[key] ?? 0;
      const rate   = buckets[key] ?? 0;
      const interp = Math.max(0, stored - rate + frac * rate);
      totalCapped += Math.min(req.value, interp);
    }
    const headerPct = Math.min(100, (totalCapped / totalRequired) * 100);
    const hFill = document.querySelector(`.task-progress-fill[data-task-id="${task.id}"]`);
    if (hFill) hFill.style.width = `${headerPct.toFixed(1)}%`;

    for (const req of reqs) {
      const key    = req.segments[1] || '';
      const stored = task.workProgress?.[key] ?? 0;
      const rate   = buckets[key] ?? 0;
      const interp = Math.max(0, stored - rate + frac * rate);
      const pct    = Math.min(100, (interp / req.value) * 100);
      const sel    = `[data-task-id="${task.id}"][data-work-key="${key}"]`;
      const bFill  = document.querySelector(`.work-item-bar-fill${sel}`);
      if (bFill) bFill.style.width = `${pct.toFixed(1)}%`;
      const valEl  = document.querySelector(`.work-item-value${sel}`);
      if (valEl)   valEl.textContent = `${Math.floor(Math.min(interp, req.value))} / ${req.value}`;
    }
  }
}
