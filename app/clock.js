import { state, ui, save } from './state.js';
import { formatClockParts } from './time.js';
import { parseTag } from './tags.js';
import { getCurrentTask, agentsAssignedTo } from './agents.js';
import { getWorkReqs, checkTaskComplete, completeTask, getItemBlockedTasks } from './tasks.js';
import { render } from './render.js';
import { flashError, updatePlayButtons } from './ui.js';

// Advances the game clock by one step, and processes work done by agents during that step. This is called automatically when the clock is running, but can also be triggered manually for testing or debugging.
export function getStepMinutes() {
  const m = String(state.session.timeStep).match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) * 1440 : 1440;
}

// Calculates the appropriate interval for the game loop based on the current time step and rate multiplier. This determines how often the advanceTime function is called when the clock is running.
export function getPlayIntervalMs() {
  // rate = game-days per real second; stepDays = game-days per tick
  const rate     = state.session.rateMultiplier || 1;
  const stepDays = getStepMinutes() / 1440;
  return Math.max(16, (stepDays / rate) * 1000);
}

// Advances the game clock by one step, and processes work done by agents during that step. This is called automatically when the clock is running, but can also be triggered manually for testing or debugging.
export function advanceTime() {
  ui.lastTickWallTime = Date.now();
  ui.taskWorkPerTick  = {};
  const stepMins = getStepMinutes();
  const stepDays = stepMins / 1440;

  const working = state.agents.filter(a => getCurrentTask(a) !== null);

  if (working.length) {
    const activeTasks = [...new Set(working.map(a => getCurrentTask(a)).filter(Boolean))];
    const blockedIds  = getItemBlockedTasks(activeTasks);
    const eligible    = working.filter(a => !blockedIds.has(getCurrentTask(a)?.id));
    working.filter(a => blockedIds.has(getCurrentTask(a)?.id)).forEach(a => flashError(a.id));

    if (eligible.length) {
      const totalCost = eligible.reduce((sum, a) => sum + (parseFloat(a.rate) || 0) * stepDays, 0);

      if (totalCost > (state.session.bank ?? 0)) {
        eligible.forEach(a => flashError(a.id));
      } else {
        state.session.bank = Math.round(((state.session.bank ?? 0) - totalCost) * 100) / 100;

        const workRate   = state.session.workRate   ?? 1;
        const skillBonus = state.session.skillBonus ?? 1;
        const tasksWithWork = new Set();

        for (const agent of eligible) {
          const task = getCurrentTask(agent);
          if (!task) continue;
          let agentContributed = false;

          for (const req of getWorkReqs(task)) {
            const key = req.name || '';
            let rate;
            if (req.name) {
              const skillTag = agent.attributes.find(attr => {
                const ap = parseTag(attr);
                return ap.type === 'skill' && ap.name.toLowerCase() === req.name.toLowerCase();
              });
              if (!skillTag) continue;
              const skillVal = parseTag(skillTag).value ?? 1;
              rate = (workRate + skillVal * skillBonus) * stepDays;
            } else {
              rate = workRate * stepDays;
            }
            task.workProgress[key]           = (task.workProgress[key] ?? 0) + rate;
            ui.taskWorkPerTick[task.id]      ??= {};
            ui.taskWorkPerTick[task.id][key]  = (ui.taskWorkPerTick[task.id][key] ?? 0) + rate;
            agentContributed = true;
            tasksWithWork.add(task.id);
          }

          if (!agentContributed) flashError(agent.id);
        }

        for (const agent of eligible) {
          const task = getCurrentTask(agent);
          if (task && !tasksWithWork.has(task.id)) flashError(agent.id);
        }

        let anyCompleted = false;
        for (const task of state.tasks) {
          if (!task.isComplete && checkTaskComplete(task)) {
            completeTask(task);
            anyCompleted = true;
          }
        }
        if (anyCompleted) {
          state.session.clock = (parseFloat(state.session.clock) || 0) + stepMins;
          save();
          render();
          return;
        }
      }
    }
  }

  state.session.clock = (parseFloat(state.session.clock) || 0) + stepMins;
  save();
  if (ui.playing) {
    updateTickDisplay();
  } else {
    render();
  }
}

// Lightweight DOM patch for fields that change every tick without rebuilding the DOM.
function updateTickDisplay() {
  const bankEl = document.getElementById('bank');
  if (bankEl && document.activeElement !== bankEl)
    bankEl.textContent = (state.session.bank ?? 0).toFixed(1);
}

//Game clock control functions: startPlay, stopPlay, and the RAF loop for interpolating the clock display and progress bars between discrete ticks.

// RAF loop: interpolates clock display and progress bars between discrete ticks.
export function updateClockDisplay() {
  if (!ui.playing) return;
  const elapsed  = Date.now() - ui.lastTickWallTime;
  const frac     = Math.min(1, elapsed / ui.tickIntervalMs);
  const stepMins = getStepMinutes();

  const { year, week, day } = formatClockParts(state.session.clock + frac * stepMins);
  const yearEl = document.getElementById('clock-year');
  const weekEl = document.getElementById('clock-week');
  const dayEl  = document.getElementById('clock-day');
  if (yearEl && document.activeElement !== yearEl) yearEl.textContent = year;
  if (weekEl && document.activeElement !== weekEl) weekEl.textContent = week;
  if (dayEl  && document.activeElement !== dayEl)  dayEl.textContent  = day;

  const rates = ui.taskWorkPerTick || {};
  for (const task of state.tasks) {
    if (task.isComplete) continue;
    const buckets = rates[task.id];
    if (!buckets) continue;
    const reqs = getWorkReqs(task);
    const totalRequired = reqs.reduce((sum, e) => sum + e.value, 0);
    if (!totalRequired) continue;

    let totalStored = 0, totalRate = 0;
    for (const req of reqs) {
      const key = req.name || '';
      totalStored += task.workProgress?.[key] ?? 0;
      totalRate   += buckets[key] ?? 0;
    }
    const headerPct  = Math.min(100, ((totalStored - totalRate + frac * totalRate) / totalRequired) * 100);
    const headerFill = document.querySelector(`.task-progress-fill[data-task-id="${task.id}"]`);
    if (headerFill) headerFill.style.width = `${headerPct.toFixed(1)}%`;

    for (const req of reqs) {
      const key    = req.name || '';
      const stored = task.workProgress?.[key] ?? 0;
      const rate   = buckets[key] ?? 0;
      const interp = Math.max(0, stored - rate + frac * rate);
      const pct    = Math.min(100, (interp / req.value) * 100);
      const sel    = `[data-task-id="${task.id}"][data-work-key="${key}"]`;
      const barFill = document.querySelector(`.work-item-bar-fill${sel}`);
      if (barFill) barFill.style.width = `${pct.toFixed(1)}%`;
      const valEl = document.querySelector(`.work-item-value${sel}`);
      if (valEl)   valEl.textContent = `${Math.floor(interp)} / ${req.value}`;
    }
  }

  ui.animationFrameId = requestAnimationFrame(updateClockDisplay);
}

export function startPlay() {
  if (ui.playing) return;
  ui.playing = true;
  const interval = getPlayIntervalMs();
  ui.tickIntervalMs    = interval;
  ui.lastTickWallTime  = Date.now();
  ui.playInterval      = setInterval(advanceTime, interval);
  updateClockDisplay();
  updatePlayButtons();
}

export function stopPlay() {
  if (!ui.playing) return;
  ui.playing = false;
  clearInterval(ui.playInterval);
  ui.playInterval = null;
  if (ui.animationFrameId) {
    cancelAnimationFrame(ui.animationFrameId);
    ui.animationFrameId = null;
  }
  render();
  updatePlayButtons();
}
