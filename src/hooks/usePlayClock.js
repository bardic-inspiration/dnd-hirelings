import { useRef, useEffect, useCallback, useState } from 'react';
import { useGame } from '../state/GameContext.jsx';
import { useUI } from '../state/UIContext.jsx';
import { getPlayIntervalMs, updateClockDisplayDOM } from '../logic/clock.js';
import { flashAgentCard } from '../logic/dom.js';
import { clockSourceFor } from '../logic/clockSources.js';
import { useClockConfig } from './useClockConfig.js';
import { useRollbackConfig } from './useRollbackConfig.js';

/**
 * Manages the game loop: a `setInterval` for discrete ticks and a `requestAnimationFrame`
 * loop for smooth clock/progress interpolation between ticks.
 *
 * Automatically pauses the interval while any `[contenteditable]` or `.req-field`
 * element has focus, and resumes 100ms after blur. Restarts a running interval
 * when the clock config changes, so real-time pacing edits apply immediately.
 *
 * The clock is driven through a source from `CLOCK_SOURCE_REGISTRY` (see
 * logic/clockSources.js). `'live'` (default) is the existing
 * `advanceTime`/`rollbackTime` pair over `state`; `'recorded'` indexes into a
 * commit's per-tick snapshot array for turn replay. `runTick`/`retreat` route
 * through the source's `stepForward`/`stepBackward` but keep dispatching
 * `APPLY_TICK`/`APPLY_ROLLBACK` with the returned `newState`, so the reducer and
 * the manual-step path are source-agnostic. The RAF interpolator starts only
 * when the source's `interpolate` flag is set (never in `recorded` — the
 * interpolator writes toward an in-flight tick that does not exist in replay).
 *
 * Side effects:
 * - Dispatches `APPLY_TICK` on every tick and `APPLY_ROLLBACK` on `retreat`
 * - Adds/removes `agent-card--flash-error` CSS class on agent cards
 * - Directly mutates progress-bar DOM nodes every frame (live source only)
 *
 * The play interval advances exactly one tick per fire; the manual step-forward
 * button advances `session.timeStep` ticks and step-back reverses
 * `session.stepBack` ticks (in `recorded`, the same counts move the playhead).
 *
 * @param {{ source?: 'live'|'recorded', sourceContext?: object }} [options]
 *   `sourceContext` supplies the recorded source's `{ snapshots, endState,
 *   eventLog }` (read through a ref, mirroring `clockConfigRef`); the playhead
 *   `index` is owned here.
 * @returns {{ start: () => void, stop: () => void, advance: () => void,
 *   retreat: () => void, resync: () => void,
 *   bounds: { canStepBack: boolean, canStepForward: boolean }, index: number }}
 *   `resync` re-seeds a running interval after a pacing edit and no-ops while
 *   stopped; `bounds` drives control dimming; `index` is the recorded playhead.
 */
export function usePlayClock({ source = 'live', sourceContext } = {}) {
  const { state, dispatch } = useGame();
  const { playing, setPlaying } = useUI();
  const clockConfig = useClockConfig();
  const rollbackConfig = useRollbackConfig();
  const clockSource = clockSourceFor(source);

  const stateRef   = useRef(state);
  const playingRef = useRef(playing);
  // Interval/RAF callbacks read configs through refs so they never close over
  // stale values between config edits and the next (re)start.
  const clockConfigRef    = useRef(clockConfig);
  const rollbackConfigRef = useRef(rollbackConfig);
  // The recorded source's context (snapshots/endState/eventLog) is read through a
  // ref, matching the config-ref pattern; the playhead `index` is owned here.
  const sourceContextRef  = useRef(sourceContext);
  const indexRef          = useRef(sourceContext?.index ?? 0);
  const [recordedIndex, setRecordedIndex] = useState(indexRef.current);
  const tickInfoRef = useRef({ lastTickWallTime: 0, tickIntervalMs: 1000, taskProgressPerTick: {} });
  const intervalRef = useRef(null);
  const rafRef      = useRef(null);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { rollbackConfigRef.current = rollbackConfig; }, [rollbackConfig]);
  useEffect(() => { sourceContextRef.current = sourceContext; }, [sourceContext]);

  // Assembles the per-source step context: `live` reads live state + config;
  // `recorded` folds the current playhead into the snapshot context.
  const buildCtx = useCallback(() => source === 'recorded'
    ? { ...sourceContextRef.current, index: indexRef.current }
    : { state: stateRef.current, rollbackConfig: rollbackConfigRef.current },
  [source]);

  // Advance `count` ticks through the active source: step, publish per-tick
  // progress rates for the RAF loop (live only), commit, and flash agents that
  // couldn't contribute. A `null` result means the source hit its bound (recorded
  // upper/lower edge) — no-op. `resetWallTime` restarts the interpolation clock.
  const runTick = useCallback((resetWallTime, count) => {
    const result = clockSource.stepForward(buildCtx(), count);
    if (!result) return;
    stateRef.current = result.newState;
    if (result.index !== undefined) { indexRef.current = result.index; setRecordedIndex(result.index); }
    if (resetWallTime) tickInfoRef.current.lastTickWallTime = Date.now();
    tickInfoRef.current.taskProgressPerTick = result.taskProgressPerTick ?? {};
    dispatch({ type: 'APPLY_TICK', newState: result.newState });
    (result.flashAgentIds ?? []).forEach(flashAgentCard);
  }, [dispatch, clockSource, buildCtx]);

  // Play interval fires one tick; the manual button advances the full step.
  const tick    = useCallback(() => runTick(true, 1), [runTick]);
  const advance = useCallback(() => runTick(false, stateRef.current.session.timeStep), [runTick]);

  const rafLoop = useCallback(() => {
    if (!playingRef.current) return;
    updateClockDisplayDOM(stateRef.current, tickInfoRef.current);
    rafRef.current = requestAnimationFrame(rafLoop);
  }, []);

  // (Re)starts the tick interval, seeding the interpolation clock from the
  // current session rate. Shared by `start` and the post-edit focus resume.
  const startInterval = useCallback(() => {
    const intervalMs = getPlayIntervalMs(stateRef.current.session, clockConfigRef.current);
    tickInfoRef.current.tickIntervalMs   = intervalMs;
    tickInfoRef.current.lastTickWallTime = Date.now();
    intervalRef.current = setInterval(tick, intervalMs);
  }, [tick]);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    startInterval();
    // D-noraf: the interpolator only runs for sources that advance toward an
    // in-flight tick (live); recorded replay never starts it.
    if (clockSource.interpolate) rafRef.current = requestAnimationFrame(rafLoop);
    setPlaying(true);
  }, [startInterval, rafLoop, setPlaying, clockSource]);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (rafRef.current)       { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setPlaying(false);
  }, [setPlaying]);

  // Step back by `session.stepBack` ticks (or, in recorded, that many playhead
  // steps): pause first (so the RAF loop can't fight the rewound state), then
  // reverse through the source. No-ops (no dispatch) at the bound.
  const retreat = useCallback(() => {
    stop();
    const result = clockSource.stepBackward(buildCtx(), stateRef.current.session.stepBack);
    if (!result) return;
    stateRef.current = result.newState;
    if (result.index !== undefined) { indexRef.current = result.index; setRecordedIndex(result.index); }
    tickInfoRef.current.taskProgressPerTick = {};
    dispatch({ type: 'APPLY_ROLLBACK', newState: result.newState });
  }, [stop, dispatch, clockSource, buildCtx]);

  // Re-seeds a RUNNING play interval from the current session/clock config;
  // a no-op while stopped or paused — pacing edits must never change the
  // clock's run state (issue #102).
  const resync = useCallback(() => {
    if (!playingRef.current || !intervalRef.current) return;
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    startInterval();
  }, [startInterval]);

  // Apply pacing edits immediately: recompute the interval mid-play on clock
  // config changes (file configs have no binding effect to fire from the
  // modal) and on rate edits. The rateMultiplier dep matters — dispatch is
  // batched, so a synchronous resync from a modal commit would read the
  // PRE-edit rate through stateRef; this effect runs after stateRef updates.
  useEffect(() => {
    clockConfigRef.current = clockConfig;
    resync();
  }, [clockConfig, state.session.rateMultiplier, resync]);

  // Pause interval while any contenteditable has focus; resume after blur.
  useEffect(() => {
    let resumeTimer = null;
    const onFocusIn = (e) => {
      if (!e.target.matches('[contenteditable], .req-field')) return;
      clearTimeout(resumeTimer);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
    const onFocusOut = (e) => {
      if (!e.target.matches('[contenteditable], .req-field')) return;
      resumeTimer = setTimeout(() => {
        if (playingRef.current && !intervalRef.current) startInterval();
      }, 100);
    };
    document.addEventListener('focusin',  onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin',  onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      clearTimeout(resumeTimer);
    };
  }, [startInterval]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (rafRef.current)      cancelAnimationFrame(rafRef.current);
  }, []);

  // Bounds drive control dimming: "dim at the horizon" generalized to "dim at
  // `bounds`". Recomputed per render — recorded reads the reactive playhead so
  // the forward/back controls dim at the array edges.
  const bounds = clockSource.bounds(source === 'recorded'
    ? { ...sourceContext, index: recordedIndex }
    : { state });

  return { start, stop, advance, retreat, resync, bounds, index: recordedIndex };
}
