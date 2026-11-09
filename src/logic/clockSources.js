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
 * Extracts the active playhead index from a recorded context or fallback.
 *
 * @param {object} ctx Recording context or commit document.
 * @param {number} fallbackIndex Index to return if not found on context.
 * @returns {number}
 */
function getRecordedIndex(ctx, fallbackIndex = 0) {
  if (!ctx || typeof ctx !== 'object') return fallbackIndex;
  if (typeof ctx.index === 'number') return ctx.index;
  if (typeof ctx.getIndex === 'function') return ctx.getIndex();
  if (ctx.indexRef && typeof ctx.indexRef.current === 'number') return ctx.indexRef.current;
  return fallbackIndex;
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
     * @returns {object} Advance result from `advanceTime`.
     */
    stepForward(state, { count = 1, rollbackConfig, locked } = {}) {
      return advanceTime(state, { count, rollbackConfig, locked });
    },

    /**
     * Steps back live game state by the requested count of ticks.
     *
     * @param {object} state Current GameState.
     * @param {{ count?: number, rollbackConfig?: object }} [options]
     * @returns {object|null} Rollback result from `rollbackTime`, or null if at horizon.
     */
    stepBack(state, { count = 1, rollbackConfig } = {}) {
      return rollbackTime(state, { count, rollbackConfig });
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
     * @returns {{ newState: object, nextIndex: number }|null}
     */
    stepForward(state, { count = 1, sourceContext, index } = {}) {
      const ctx = sourceContext;
      const max = getRecordedMax(ctx);
      const currentIndex = getRecordedIndex(ctx, index ?? 0);
      if (currentIndex >= max) {
        return null;
      }
      const nextIndex = Math.min(max, currentIndex + count);
      const newState = stateAt(ctx, nextIndex);
      return { newState, nextIndex };
    },

    /**
     * Steps back by `count` snapshots in a recorded turn.
     * Returns null if already at or below index 0.
     *
     * @param {object} state Current GameState.
     * @param {{ count?: number, sourceContext?: object, index?: number }} [options]
     * @returns {{ newState: object, nextIndex: number }|null}
     */
    stepBack(state, { count = 1, sourceContext, index } = {}) {
      const ctx = sourceContext;
      const currentIndex = getRecordedIndex(ctx, index ?? 0);
      if (currentIndex <= 0) {
        return null;
      }
      const nextIndex = Math.max(0, currentIndex - count);
      const newState = stateAt(ctx, nextIndex);
      return { newState, nextIndex };
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
      const currentIndex = getRecordedIndex(ctx, index ?? 0);
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
