// Clock sources: registry for time advancement mechanisms (live simulation vs
// recorded turn playback), state reconstruction from snapshots, and event log slicing.

import { advanceTime } from './clock.js';
import { rollbackTime, getRollbackHorizon } from './rollback.js';

/**
 * Extracts the maximum snapshot index available in a recorded context.
 *
 * @param {object} ctx Recording context or commit document.
 * @returns {number}
 */
function getRecordedMax(ctx) {
  if (!ctx || typeof ctx !== 'object') return 0;
  const snapshots = ctx.snapshots ?? ctx.commit?.snapshots;
  if (Array.isArray(snapshots) && snapshots.length > 0) {
    return snapshots.length - 1;
  }
  if (typeof ctx.max === 'number') {
    return ctx.max;
  }
  return 0;
}

/**
 * Extracts the active playhead index from an explicit index or recorded context.
 *
 * @param {object} ctx Recording context or commit document.
 * @param {number} [explicitIndex] Explicit index from caller.
 * @returns {number}
 */
function getRecordedIndex(ctx, explicitIndex) {
  if (typeof explicitIndex === 'number') return explicitIndex;
  if (ctx && typeof ctx === 'object' && typeof ctx.index === 'number') {
    return ctx.index;
  }
  return 0;
}

/**
 * Cuts a turn's event log at the specified tick boundary.
 *
 * A single tick's log ends with an entry of `eventType: 'tick'`. Cutting at `tickCount`
 * returns all log entries up to and including the `tickCount`-th `'tick'` row.
 *
 * @param {Array<object>|object} eventLogOrCtx Event log array or object with `.eventLog`.
 * @param {number} tickCount Number of ticks to include in the prefix.
 * @returns {Array<object>} Sliced event log rows.
 */
export function logPrefix(eventLogOrCtx, tickCount) {
  let eventLog = [];
  let count = 0;

  if (Array.isArray(eventLogOrCtx)) {
    eventLog = eventLogOrCtx;
    count = Number(tickCount) || 0;
  } else if (eventLogOrCtx && typeof eventLogOrCtx === 'object') {
    eventLog = Array.isArray(eventLogOrCtx.eventLog) ? eventLogOrCtx.eventLog : [];
    count = Number(tickCount) || 0;
  }

  if (count <= 0 || !eventLog.length) {
    return [];
  }

  let ticksSeen = 0;
  for (let i = 0; i < eventLog.length; i++) {
    if (eventLog[i]?.eventType === 'tick') {
      ticksSeen += 1;
      if (ticksSeen === count) {
        return eventLog.slice(0, i + 1);
      }
    }
  }

  return eventLog.slice();
}

/**
 * Reconstructs a full GameState from recorded turn snapshots at the given index.
 *
 * Clamps the index to `0 … max`.
 * - For index `< max`: rebuilds `{ ...snapshots[i], tagRegistry: endState.tagRegistry, eventLog: logPrefix(i) }`.
 * - For index `=== max`: resolves directly to `endState` (preserving manual edits after last tick).
 *
 * @param {object} ctx Context carrying `snapshots`, `eventLog`, and `endState` (or `.commit`).
 * @param {number} index Target snapshot index.
 * @returns {object|null} Reconstructed GameState or null if context is invalid.
 */
export function stateAt(ctx, index) {
  if (!ctx || typeof ctx !== 'object') {
    return null;
  }
  const snapshots = ctx.snapshots ?? ctx.commit?.snapshots ?? [];
  const endState = ctx.endState ?? ctx.commit?.endState ?? snapshots[snapshots.length - 1];
  const eventLog = ctx.eventLog ?? ctx.commit?.eventLog ?? endState?.eventLog ?? [];

  if (!snapshots.length && !endState) {
    return null;
  }

  const max = Math.max(0, snapshots.length - 1);
  const clampedIndex = Math.max(0, Math.min(max, Math.round(Number(index) || 0)));

  if (clampedIndex === max && endState) {
    return endState;
  }

  const snapshot = snapshots[clampedIndex] ?? {};
  return {
    ...snapshot,
    tagRegistry: endState?.tagRegistry ?? snapshot.tagRegistry,
    eventLog: logPrefix(eventLog, clampedIndex),
  };
}

/**
 * Registry of available clock sources for stepping time forward/back and checking bounds.
 *
 * - `live`: Runs live simulation via `advanceTime` and `rollbackTime`. Interpolates UI progress.
 * - `recorded`: Steps through committed snapshots via `stateAt`. Does not interpolate.
 *
 * @type {Record<string, object>}
 */
export const CLOCK_SOURCE_REGISTRY = {
  live: {
    name: 'live',
    interpolates: true,

    /**
     * Advances live game state by the requested count of ticks.
     *
     * @param {object} state Current GameState.
     * @param {{ count?: number, rollbackConfig?: object, locked?: boolean }} [options]
     * @returns {{ newState: object, action: object, flashAgentIds: Array<string>, taskProgressPerTick: object }}
     */
    stepForward(state, { count = 1, rollbackConfig, locked } = {}) {
      const { newState, flashAgentIds, taskProgressPerTick } = advanceTime(state, { count, rollbackConfig, locked });
      return {
        newState,
        action: { type: 'APPLY_TICK', newState },
        flashAgentIds,
        taskProgressPerTick,
      };
    },

    /**
     * Steps back live game state by the requested count of ticks.
     *
     * @param {object} state Current GameState.
     * @param {{ count?: number, rollbackConfig?: object }} [options]
     * @returns {{ newState: object, action: object, resetProgress: boolean }|null}
     */
    stepBack(state, { count = 1, rollbackConfig } = {}) {
      const result = rollbackTime(state, { count, rollbackConfig });
      if (!result) return null;
      return {
        newState: result.newState,
        action: { type: 'APPLY_ROLLBACK', newState: result.newState },
        resetProgress: true,
      };
    },

    /**
     * Checks bounds for live play: step back dims at rollback horizon; forward and play are unbounded.
     *
     * @param {object} state Current GameState.
     * @returns {{ canStepBack: boolean, canStepForward: boolean, canPlay: boolean, earliestClock?: number }}
     */
    getBounds(state) {
      const horizon = getRollbackHorizon(state?.eventLog);
      return {
        canStepBack: Boolean(horizon?.canStepBack),
        canStepForward: true,
        canPlay: true,
        earliestClock: horizon?.earliestClock,
      };
    },
  },

  recorded: {
    name: 'recorded',
    interpolates: false,

    /**
     * Steps forward by `count` snapshots in a recorded turn.
     * Returns null if already at or beyond the maximum snapshot index.
     *
     * @param {object} state Current GameState.
     * @param {{ count?: number, sourceContext?: object, index?: number }} [options]
     * @returns {{ newState: object, action: object, nextIndex: number, atMax: boolean }|null}
     */
    stepForward(state, { count = 1, sourceContext, index } = {}) {
      const ctx = sourceContext;
      const max = getRecordedMax(ctx);
      const currentIndex = getRecordedIndex(ctx, index);
      if (currentIndex >= max) {
        return null;
      }
      const nextIndex = Math.min(max, currentIndex + count);
      const newState = stateAt(ctx, nextIndex);
      return {
        newState,
        action: { type: 'APPLY_TICK', newState },
        nextIndex,
        atMax: nextIndex >= max,
      };
    },

    /**
     * Steps back by `count` snapshots in a recorded turn.
     * Returns null if already at or below index 0.
     *
     * @param {object} state Current GameState.
     * @param {{ count?: number, sourceContext?: object, index?: number }} [options]
     * @returns {{ newState: object, action: object, nextIndex: number }|null}
     */
    stepBack(state, { count = 1, sourceContext, index } = {}) {
      const ctx = sourceContext;
      const currentIndex = getRecordedIndex(ctx, index);
      if (currentIndex <= 0) {
        return null;
      }
      const nextIndex = Math.max(0, currentIndex - count);
      const newState = stateAt(ctx, nextIndex);
      return {
        newState,
        action: { type: 'APPLY_ROLLBACK', newState },
        nextIndex,
      };
    },

    /**
     * Checks bounds for recorded play: bounds are [0, max].
     *
     * @param {object} state Current GameState.
     * @param {{ sourceContext?: object, index?: number }} [options]
     * @returns {{ canStepBack: boolean, canStepForward: boolean, canPlay: boolean, index: number, max: number }}
     */
    getBounds(state, { sourceContext, index } = {}) {
      const ctx = sourceContext;
      const max = getRecordedMax(ctx);
      const currentIndex = getRecordedIndex(ctx, index);
      return {
        canStepBack: currentIndex > 0,
        canStepForward: currentIndex < max,
        canPlay: currentIndex < max,
        index: currentIndex,
        max,
      };
    },
  },
};

/**
 * Retrieves the clock source by name, falling back to `live` if unknown or omitted.
 *
 * @param {string} [name='live'] Name of the clock source.
 * @returns {object} The resolved clock source object.
 */
export function getClockSource(name = 'live') {
  if (typeof name === 'string' && CLOCK_SOURCE_REGISTRY[name]) {
    return CLOCK_SOURCE_REGISTRY[name];
  }
  return CLOCK_SOURCE_REGISTRY.live;
}

/**
 * Pure driver coordinating play-clock ticks, bounds, and playback controls
 * through the active clock source without branching on source name.
 *
 * @param {object} options
 * @param {string} [options.source='live'] Clock source name.
 * @param {object} [options.sourceContext] Source context for recorded play.
 * @param {() => object} options.getState Returns current GameState.
 * @param {(action: object) => void} options.dispatch Reducer dispatch.
 * @param {(agentId: string) => void} [options.flashAgent] Flash error handler.
 * @param {() => object} [options.getRollbackConfig] Returns rollback configuration.
 * @param {() => boolean} [options.getLocked] Returns locked configuration.
 * @param {() => number} [options.getIntervalMs] Returns interval ms for current session rate.
 * @param {(tickFn: () => void, intervalMs: number) => any} [options.scheduleInterval] Starts interval timer.
 * @param {(handle: any) => void} [options.cancelInterval] Cancels interval timer.
 * @param {(rafFn: () => void) => any} [options.scheduleRaf] Schedules animation frame.
 * @param {(handle: any) => void} [options.cancelRaf] Cancels animation frame.
 * @param {(state: object, tickInfo: object) => void} [options.onInterpolate] Interpolation callback.
 * @param {(playing: boolean) => void} [options.onPlayingChange] Playing state callback.
 * @returns {object} Controller exposing play/step controls and bounds inspection.
 */
export function createPlayClockDriver({
  source = 'live',
  sourceContext,
  getState,
  dispatch,
  flashAgent,
  getRollbackConfig = () => ({}),
  getLocked = () => false,
  getIntervalMs = () => 1000,
  scheduleInterval = setInterval,
  cancelInterval = clearInterval,
  scheduleRaf = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null),
  cancelRaf = (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : null),
  onInterpolate,
  onPlayingChange,
}) {
  let activeSource = getClockSource(source);
  let activeContext = sourceContext;
  let currentIndex = typeof sourceContext?.index === 'number' ? sourceContext.index : 0;
  let isPlaying = false;
  let intervalHandle = null;
  let rafHandle = null;
  const tickInfo = { lastTickWallTime: 0, tickIntervalMs: 1000, taskProgressPerTick: {} };

  function getBounds() {
    return activeSource.getBounds(getState(), {
      sourceContext: { ...activeContext, index: currentIndex },
      index: currentIndex,
    });
  }

  function stop() {
    if (intervalHandle) {
      cancelInterval(intervalHandle);
      intervalHandle = null;
    }
    if (rafHandle && cancelRaf) {
      cancelRaf(rafHandle);
      rafHandle = null;
    }
    if (isPlaying) {
      isPlaying = false;
      onPlayingChange?.(false);
    }
  }

  function rafLoop() {
    if (!isPlaying || !activeSource.interpolates) return;
    onInterpolate?.(getState(), tickInfo);
    if (scheduleRaf) {
      rafHandle = scheduleRaf(rafLoop);
    }
  }

  function applyStepResult(result, resetWallTime) {
    if (!result) {
      if (isPlaying) stop();
      return null;
    }
    if (typeof result.nextIndex === 'number') {
      currentIndex = result.nextIndex;
      activeContext?.onIndexChange?.(result.nextIndex);
    }
    if (result.flashAgentIds && flashAgent) {
      result.flashAgentIds.forEach(flashAgent);
    }
    if (resetWallTime) {
      tickInfo.lastTickWallTime = Date.now();
    }
    if (result.taskProgressPerTick) {
      tickInfo.taskProgressPerTick = result.taskProgressPerTick;
    }
    if (result.resetProgress) {
      tickInfo.taskProgressPerTick = {};
    }
    if (result.action) {
      dispatch(result.action);
    }
    if (result.atMax && isPlaying) {
      stop();
    }
    return result;
  }

  function stepForward(count = 1, resetWallTime = false) {
    const result = activeSource.stepForward(getState(), {
      count,
      sourceContext: activeContext,
      index: currentIndex,
      rollbackConfig: getRollbackConfig(),
      locked: getLocked(),
    });
    return applyStepResult(result, resetWallTime);
  }

  function stepBack(count = 1) {
    stop();
    const result = activeSource.stepBack(getState(), {
      count,
      sourceContext: activeContext,
      index: currentIndex,
      rollbackConfig: getRollbackConfig(),
    });
    return applyStepResult(result, false);
  }

  function tick() {
    return stepForward(1, true);
  }

  function advance() {
    const step = getState()?.session?.timeStep ?? 1;
    return stepForward(step, false);
  }

  function retreat() {
    const step = getState()?.session?.stepBack ?? 1;
    return stepBack(step);
  }

  function startInterval() {
    const intervalMs = getIntervalMs(getState()?.session);
    tickInfo.tickIntervalMs = intervalMs;
    tickInfo.lastTickWallTime = Date.now();
    intervalHandle = scheduleInterval(tick, intervalMs);
  }

  function start() {
    if (intervalHandle) return false;
    const bounds = getBounds();
    if (bounds && !bounds.canPlay) return false;

    isPlaying = true;
    onPlayingChange?.(true);
    startInterval();
    if (activeSource.interpolates && scheduleRaf) {
      rafHandle = scheduleRaf(rafLoop);
    }
    return true;
  }

  function resync() {
    if (!isPlaying || !intervalHandle) return;
    cancelInterval(intervalHandle);
    intervalHandle = null;
    startInterval();
  }

  function syncIndex(newIndex) {
    if (typeof newIndex === 'number') {
      currentIndex = newIndex;
      tickInfo.taskProgressPerTick = {};
    }
  }

  function switchSource(newSourceName, newSourceContext) {
    stop();
    activeSource = getClockSource(newSourceName);
    activeContext = newSourceContext;
    currentIndex = typeof newSourceContext?.index === 'number' ? newSourceContext.index : 0;
    tickInfo.lastTickWallTime = 0;
    tickInfo.tickIntervalMs = 1000;
    tickInfo.taskProgressPerTick = {};
  }

  return {
    start,
    stop,
    advance,
    retreat,
    tick,
    stepForward,
    stepBack,
    resync,
    getBounds,
    syncIndex,
    switchSource,
    getIndex: () => currentIndex,
    isPlaying: () => isPlaying,
    getTickInfo: () => tickInfo,
  };
}
