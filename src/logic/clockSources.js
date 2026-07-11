// Clock-source registry (see docs/specs/gm-player-mode.md §5). The second of the
// two axes over the existing clock machinery: where the play clock's step/bounds
// come from. `live` is the existing advanceTime/rollbackTime pair; `recorded`
// indexes into a commit's per-tick snapshot array to replay a finished turn.
//
// Mirrors the established registry idiom (TRACKER_REGISTRY, CLOCK is object
// literal keyed by source name, uniform member shape, dispatcher with graceful
// fallback (unknown source → live).

import { advanceTime } from './clock.js';
import { rollbackTime, getRollbackHorizon } from './rollback.js';

/**
 * The highest reachable index in a recorded context: `snapshots.length - 1`,
 * which resolves to `endState` (the turn-end state, manual edits included).
 *
 * @param {{ snapshots: object[], max?: number }} ctx
 * @returns {number}
 */
const recordedMax = (ctx) => ctx.max ?? (ctx.snapshots.length - 1);

/**
 * Cuts a commit's turn-slice event log at the `i`-th `'tick'` boundary, reusing
 * the tick-group walk `rollback.js` established. `i` is a tick count: `0` yields
 * an empty prefix (turn start, before any tick), `i` yields every entry up to and
 * including the `i`-th tick boundary. Fewer than `i` ticks returns the whole log.
 *
 * @param {{ eventLog?: import('./eventLog.js').EventLogEntry[] }} ctx
 * @param {number} i
 * @returns {import('./eventLog.js').EventLogEntry[]}
 */
export function logPrefix(ctx, i) {
  if (i <= 0) return [];
  const log = ctx.eventLog ?? [];
  let ticksSeen = 0;
  for (let index = 0; index < log.length; index++) {
    if (log[index].eventType === 'tick') {
      ticksSeen++;
      if (ticksSeen === i) return log.slice(0, index + 1);
    }
  }
  return log.slice();
}

/**
 * Reconstructs the full replay state at index `i` from a recorded context,
 * clamping `i` to `[0, max]`. Snapshots ship stripped of `eventLog`/`tagRegistry`
 * (both invariant across a party turn or shipped whole once), so both are folded
 * back from `endState` here. The top index (`max`) is `endState` verbatim — it
 * carries any manual edits made after the last tick, which no intermediate
 * snapshot holds.
 *
 * @param {{ snapshots: object[], endState: object, eventLog?: object[], max?: number }} ctx
 * @param {number} i
 * @returns {{ newState: object, index: number }}
 */
export function stateAt(ctx, i) {
  const max = recordedMax(ctx);
  const index = Math.max(0, Math.min(max, i));
  if (index >= max) return { newState: ctx.endState, index: max };
  return {
    newState: { ...ctx.snapshots[index], tagRegistry: ctx.endState.tagRegistry, eventLog: logPrefix(ctx, index) },
    index,
  };
}

// Steps the recorded playhead to `target`, returning `null` when the clamp
// leaves the index unmoved (already at a bound) — matching `rollbackTime`'s
// null-at-the-horizon contract so `usePlayClock` can treat both sources alike.
function stepRecorded(ctx, target) {
  const result = stateAt(ctx, target);
  return result.index === ctx.index ? null : result;
}

/**
 * Clock-source registry. Each source supplies:
 * - `stepForward(ctx, count)` / `stepBackward(ctx, count)` → `{ newState, … }`
 *   or `null` at the bound. `live` returns `advanceTime`/`rollbackTime`'s shape
 *   (`{ newState, flashAgentIds, taskProgressPerTick }`); `recorded` returns
 *   `{ newState, index }`.
 * - `bounds(ctx)` → `{ canStepBack, canStepForward }` for control dimming.
 * - `interpolate` — whether the RAF interpolation loop may run (never in
 *   `recorded`: the interpolator writes toward an in-flight tick that does not
 *   exist in replay — D-noraf).
 *
 * @type {{ [source: string]: {
 *   stepForward: (ctx: object, count: number) => object|null,
 *   stepBackward: (ctx: object, count: number) => object|null,
 *   bounds: (ctx: object) => { canStepBack: boolean, canStepForward: boolean },
 *   interpolate: boolean } }}
 */
export const CLOCK_SOURCE_REGISTRY = {
  live: {
    stepForward:  ({ state, rollbackConfig }, count) => advanceTime(state, { count, rollbackConfig }),
    stepBackward: ({ state, rollbackConfig }, count) => rollbackTime(state, { count, rollbackConfig }),
    bounds:       ({ state }) => ({ canStepBack: getRollbackHorizon(state.eventLog).canStepBack, canStepForward: true }),
    interpolate:  true,
  },
  recorded: {
    stepForward:  (ctx, count) => stepRecorded(ctx, ctx.index + count),
    stepBackward: (ctx, count) => stepRecorded(ctx, ctx.index - count),
    bounds:       (ctx) => ({ canStepBack: ctx.index > 0, canStepForward: ctx.index < recordedMax(ctx) }),
    interpolate:  false,
  },
};

/**
 * Looks up a clock source by name, falling back to `live` for an unknown source
 * (registry convention — graceful fallback).
 *
 * @param {string} source
 * @returns {(typeof CLOCK_SOURCE_REGISTRY)['live']}
 */
export function clockSourceFor(source) {
  return CLOCK_SOURCE_REGISTRY[source] ?? CLOCK_SOURCE_REGISTRY.live;
}
