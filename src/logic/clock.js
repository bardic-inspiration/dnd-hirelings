import { DEFAULT_CLOCK_CONFIG } from './clockConfig.js';
import { DEFAULT_ROLLBACK_CONFIG } from './rollback.js';
import { getCurrentTask, getEffectiveAttributes } from './agents.js';
import { checkTaskComplete, computeBlockedTaskIds, completeTask } from './tasks.js';
import { runTaskOperators } from './operators.js';
import { applyActions } from './actions.js';
import { conditionsView, isVesselFull, vesselFill, vesselTarget } from './taskModel.js';
import { makeWorkEvent, makeCompleteEvent, makeActionEvent, makeTickEvent, capEventLog } from './eventLog.js';
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
 * Advances the clock by exactly one and computes all side effects
 * (docs/spec/task-engine.md "The tick"):
 *
 * 1. Pays wages for the eligible working agents (blocked tasks and an
 *    unaffordable wage bill flash and do no work).
 * 2. Reads: runs each worked task's operators for its engaged agents against
 *    the start-of-tick state (`runTaskOperators`).
 * 3. Writes: applies the deposits, then the effects operators fired, then the
 *    `threshold` effects of vessels that became full.
 * 4. Completes every task whose success vessels are full (`completeTask`).
 * 5. Logs `work* → task_complete* → action* → tick` when logging is enabled.
 *
 * Agents engaged on a task with contribute operators flash when they
 * deposited nothing; on a task without any, presence counts.
 *
 * @param {GameState} state
 * @param {typeof DEFAULT_ROLLBACK_CONFIG} rollbackConfig
 * @param {boolean} locked - Locked mode for tag-writing actions
 * @returns {{ newState: GameState, flashAgentIds: string[], taskProgressPerTick: object }}
 */
function advanceTick(state, rollbackConfig, locked) {
  const { session } = state;
  const flashAgentIds = [];
  // { [taskId]: { [vesselKey]: amountThisTick } }
  const taskProgressPerTick = {};

  // Event-log accumulation. `seq` continues from the last retained entry's id so
  // ids stay monotonic even after FIFO trimming (the live length can lag the
  // total appended). Every event this tick is stamped with the post-tick clock.
  const logEnabled = rollbackConfig.log.enabled;
  const maxRows    = rollbackConfig.log.maxRows;
  const lastEntry = state.eventLog?.[state.eventLog.length - 1];
  let seq = (lastEntry && Number.isFinite(lastEntry.seq) ? lastEntry.seq : -1) + 1;
  const clockAfter = (parseFloat(session.clock) || 0) + 1;

  const newSession = { ...session };
  const getTask = agent => getCurrentTask(agent, state.tasks);
  const working = state.agents.filter(agent => getTask(agent) !== null);

  // Wage payments recorded on this tick's boundary event so rollback can
  // refund exactly what was deducted (zero/empty when payment was skipped).
  let wagesTotal = 0;
  let wages = [];
  let paid = [];

  if (working.length) {
    const activeTasks = [...new Set(working.map(getTask))];
    const blockedIds  = computeBlockedTaskIds(activeTasks, state.inventory);
    const eligible    = working.filter(agent => !blockedIds.has(getTask(agent).id));
    working.filter(agent => blockedIds.has(getTask(agent).id)).forEach(agent => flashAgentIds.push(agent.id));

    if (eligible.length) {
      const totalCost = eligible.reduce((sum, agent) => sum + (parseFloat(agent.rate) || 0), 0);
      if (totalCost > (newSession.bank ?? 0)) {
        eligible.forEach(agent => flashAgentIds.push(agent.id));
      } else {
        const bankBefore = newSession.bank ?? 0;
        newSession.bank = Math.round((bankBefore - totalCost) * 100) / 100;
        wagesTotal = Math.round((bankBefore - newSession.bank) * 100) / 100;
        wages = eligible.map(agent => ({ agentId: agent.id, agentName: agent.name, amount: parseFloat(agent.rate) || 0 }));
        paid = eligible;
      }
    }
  }

  // Phase 1 — reads. Every operator sees the start-of-tick state.
  const paidIndex = new Map(paid.map((agent, index) => [agent.id, index]));
  const runs = [];
  const idle = [];
  for (const task of state.tasks) {
    const engaged = paid
      .filter(agent => getTask(agent).id === task.id)
      .map(agent => ({ agent, attributes: getEffectiveAttributes(agent.attributes, agent.activities, state.inventory) }));
    if (!engaged.length) continue;
    const result = runTaskOperators(task, engaged, { session: state.session, registry: state.tagRegistry, clock: clockAfter });
    runs.push({ task, result });
    // On a task with nothing to deposit into, presence alone counts as contributing.
    const deposits = (task.operators ?? []).some(op => op.kind === 'contribute');
    for (const { agent } of engaged) {
      if (deposits && !result.contributors.has(agent.id)) idle.push(agent.id);
    }
  }
  flashAgentIds.push(...idle.sort((a, b) => paidIndex.get(a) - paidIndex.get(b)));

  // Phase 2 — writes. Deposits apply in board order of the depositing agent,
  // then operator order (counted deposits, which have no agent, last), so
  // each row's running fill matches the order rows are logged in.
  let world = {
    agents: state.agents, tasks: state.tasks, inventory: state.inventory,
    session: newSession, tagRegistry: state.tagRegistry,
  };
  const depositRank = (deposit) => [paidIndex.get(deposit.agentId) ?? Infinity, deposit.opIndex];
  const byRank = (a, b) => (a.rank[0] - b.rank[0]) || (a.rank[1] - b.rank[1]);
  const workEvents = [];      // { rank, event } — seq assigned once sorted
  const actionRecords = [];   // { task, record } in application order

  for (const { task, result } of runs) {
    const deposits = result.deposits.map(deposit => ({ deposit, rank: depositRank(deposit) })).sort(byRank);
    for (const { deposit, rank } of deposits) {
      world = applyActions(world, [{ kind: 'vessel.deposit', params: { vessel: deposit.vessel, amount: deposit.amount } }],
        { taskId: task.id, locked }).world;
      const current = world.tasks.find(entry => entry.id === task.id);
      taskProgressPerTick[task.id] ??= {};
      taskProgressPerTick[task.id][deposit.vessel] = (taskProgressPerTick[task.id][deposit.vessel] ?? 0) + deposit.amount;
      workEvents.push({
        rank,
        event: makeWorkEvent({
          seq: 0, clock: clockAfter,
          agent: paid.find(agent => agent.id === deposit.agentId) ?? { id: '', name: '' },
          task: current,
          condition: { id: deposit.vessel, name: current.vessels?.[deposit.vessel]?.name ?? deposit.vessel, target: vesselTarget(current, deposit.vessel) },
          delta: deposit.amount,
          progress: vesselFill(current, deposit.vessel),
          actionKind: 'vessel.deposit',
        }),
      });
    }
  }

  for (const { task, result } of runs) {
    const ctx = { taskId: task.id, locked, outcomes: result.outcomes };
    for (const { actions } of result.fired) {
      const applied = applyActions(world, actions, ctx);
      world = applied.world;
      applied.records.forEach(record => actionRecords.push({ task, record }));
    }
    for (const { vessel, actions } of result.thresholds) {
      const current = world.tasks.find(entry => entry.id === task.id);
      if (!current || isVesselFull(task, vessel) || !isVesselFull(current, vessel)) continue;
      const applied = applyActions(world, actions, ctx);
      world = applied.world;
      applied.records.forEach(record => actionRecords.push({ task, record }));
    }
  }

  // Complete finished tasks, in board order.
  const workedTaskIds = new Set(runs.map(run => run.task.id));
  const completed = [];
  for (const { id } of state.tasks) {
    const task = world.tasks.find(entry => entry.id === id);
    if (!task || task.isComplete || !checkTaskComplete(task, workedTaskIds.has(id))) continue;
    const result = completeTask(world, id, { locked });
    world = result.world;
    completed.push(task);
    result.records.forEach(record => actionRecords.push({ task, record }));
  }

  const newEvents = [];
  if (logEnabled) {
    for (const { event } of workEvents.sort(byRank)) newEvents.push({ ...event, seq: seq++ });
    for (const task of completed) newEvents.push(makeCompleteEvent({ seq: seq++, clock: clockAfter, task }));
    for (const { task, record } of actionRecords) newEvents.push(makeActionEvent({ seq: seq++, clock: clockAfter, task, record }));
    // Seal the tick with the boundary event — appended on every tick so
    // rollback is uniformly tick-granular even when no work happened.
    newEvents.push(makeTickEvent({ seq, clock: clockAfter, wagesTotal, wages, rolls: runs.flatMap(run => run.result.rolls) }));
  }
  const eventLog = capEventLog([...(state.eventLog ?? []), ...newEvents], maxRows);

  return {
    newState: { ...state, ...world, session: { ...world.session, clock: clockAfter }, eventLog },
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
 * The returned `taskProgressPerTick` sums each tick's per-vessel deposits so the
 * RAF interpolation animates the whole call's contribution; `flashAgentIds`
 * concatenates every tick's flashes.
 *
 * @param {GameState} state
 * @param {{ count?: number, rollbackConfig?: typeof DEFAULT_ROLLBACK_CONFIG, locked?: boolean }} [options]
 *   `count` defaults to `session.timeStep`; `locked` is `tags.yml` `locked`,
 *   gating tag-writing actions.
 * @returns {{ newState: GameState, flashAgentIds: string[], taskProgressPerTick: object }}
 */
export function advanceTime(state, { count, rollbackConfig = DEFAULT_ROLLBACK_CONFIG, locked = false } = {}) {
  const ticks = Math.max(1, Math.round(Number(count ?? state.session.timeStep) || 1));

  let current = state;
  const flashAgentIds = [];
  const taskProgressPerTick = {};

  for (let i = 0; i < ticks; i++) {
    const result = advanceTick(current, rollbackConfig, locked);
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
 * Interpolates task progress bars between discrete ticks. Rows are the task's
 * vessels (`conditionsView`), addressed by the vessel key as condition id. Called every animation
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
    const conditions = conditionsView(task);
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
