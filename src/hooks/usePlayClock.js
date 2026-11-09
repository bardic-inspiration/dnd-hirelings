import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useGame } from '../state/GameContext.jsx';
import { useUI } from '../state/UIContext.jsx';
import { getPlayIntervalMs, updateClockDisplayDOM } from '../logic/clock.js';
import { flashAgentCard } from '../logic/dom.js';
import { getClockSource } from '../logic/clockSources.js';
import { useClockConfig } from './useClockConfig.js';
import { useRollbackConfig } from './useRollbackConfig.js';
import { useTagsConfig } from './useTagsConfig.js';

/**
 * Manages the game loop: a `setInterval` for discrete ticks and a `requestAnimationFrame`
 * loop for smooth clock/progress interpolation between ticks.
 *
 * Supports pluggable clock sources (via `CLOCK_SOURCE_REGISTRY`):
 * - `live`: discrete simulation advances via `advanceTime` and reverses via `rollbackTime`.
 *   Interpolates DOM progress bars between ticks.
 * - `recorded`: steps through recorded turn snapshots via `stateAt`. Frame interpolation
 *   is disabled, and controls dim at recording bounds `[0, max]`.
 *
 * Automatically pauses the interval while any `[contenteditable]` or `.req-field`
 * element has focus, and resumes 100ms after blur. Restarts a running interval
 * when the clock config changes, so real-time pacing edits apply immediately.
 *
 * Side effects:
 * - Dispatches `APPLY_TICK` on every tick and `APPLY_ROLLBACK` on `retreat`
 * - Adds/removes `agent-card--flash-error` CSS class on agent cards
 * - Directly mutates progress-bar DOM nodes every frame (when source interpolates)
 *
 * The play interval advances exactly one tick per fire; the manual step-forward
 * button advances `session.timeStep` ticks and step-back reverses
 * `session.stepBack` ticks.
 *
 * @param {{ source?: string, sourceContext?: object }} [options] Clock source options.
 * @returns {{ start: () => void, stop: () => void, advance: () => void,
 *   retreat: () => void, resync: () => void, bounds: object }}
 */
export function usePlayClock({ source = 'live', sourceContext } = {}) {
  const { state, dispatch } = useGame();
  const { playing, setPlaying } = useUI();
  const clockConfig = useClockConfig();
  const rollbackConfig = useRollbackConfig();
  const { locked } = useTagsConfig();

  const clockSource = getClockSource(source);

  const stateRef          = useRef(state);
  const playingRef        = useRef(playing);
  const clockSourceRef    = useRef(clockSource);
  const sourceContextRef  = useRef(sourceContext);
  // Interval/RAF callbacks read configs through refs so they never close over
  // stale values between config edits and the next (re)start.
  const clockConfigRef    = useRef(clockConfig);
  const rollbackConfigRef = useRef(rollbackConfig);
  const lockedRef         = useRef(locked);
  const tickInfoRef       = useRef({ lastTickWallTime: 0, tickIntervalMs: 1000, taskProgressPerTick: {} });
  const intervalRef       = useRef(null);
  const rafRef            = useRef(null);

  const [recordedIndex, setRecordedIndex] = useState(() => {
    return typeof sourceContext?.index === 'number' ? sourceContext.index : 0;
  });
  const recordedIndexRef = useRef(recordedIndex);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { clockSourceRef.current = clockSource; }, [clockSource]);
  useEffect(() => { sourceContextRef.current = sourceContext; }, [sourceContext]);
  useEffect(() => { rollbackConfigRef.current = rollbackConfig; }, [rollbackConfig]);
  useEffect(() => { lockedRef.current = locked; }, [locked]);

  useEffect(() => {
    if (typeof sourceContext?.index === 'number') {
      setRecordedIndex(sourceContext.index);
      recordedIndexRef.current = sourceContext.index;
    }
  }, [sourceContext?.index]);

  const bounds = useMemo(() => {
    return clockSource.getBounds(state, {
      sourceContext: { ...sourceContext, index: recordedIndex },
    });
  }, [clockSource, state, sourceContext, recordedIndex]);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (rafRef.current)       { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setPlaying(false);
  }, [setPlaying]);

  // Advance `count` ticks / snapshots:
  // - For `recorded`: steps through stateAt; pauses and returns when at max bound.
  // - For `live`: advances simulation state, sets RAF interpolation rate, and commits.
  const runTick = useCallback((resetWallTime, count) => {
    const activeSource = clockSourceRef.current;
    if (activeSource.name === 'recorded') {
      const result = activeSource.stepForward(stateRef.current, {
        count,
        sourceContext: sourceContextRef.current,
        index: recordedIndexRef.current,
      });
      if (!result) {
        if (playingRef.current) {
          stop();
        }
        return;
      }
      recordedIndexRef.current = result.nextIndex;
      setRecordedIndex(result.nextIndex);
      sourceContextRef.current?.onIndexChange?.(result.nextIndex);
      sourceContextRef.current?.setIndex?.(result.nextIndex);
      stateRef.current = result.newState;
      dispatch({ type: 'APPLY_TICK', newState: result.newState });
      return;
    }

    const result = activeSource.stepForward(stateRef.current, {
      count,
      rollbackConfig: rollbackConfigRef.current,
      locked: lockedRef.current,
    });
    stateRef.current = result.newState;
    if (resetWallTime) tickInfoRef.current.lastTickWallTime = Date.now();
    tickInfoRef.current.taskProgressPerTick = result.taskProgressPerTick;
    dispatch({ type: 'APPLY_TICK', newState: result.newState });
    result.flashAgentIds.forEach(flashAgentCard);
  }, [dispatch, stop]);

  // Play interval fires one tick; the manual button advances the full step.
  const tick    = useCallback(() => runTick(true, 1), [runTick]);
  const advance = useCallback(() => runTick(false, stateRef.current.session.timeStep), [runTick]);

  const rafLoop = useCallback(() => {
    if (!playingRef.current || !clockSourceRef.current.interpolates) return;
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
    const currentBounds = clockSourceRef.current.getBounds(stateRef.current, {
      sourceContext: { ...sourceContextRef.current, index: recordedIndexRef.current },
    });
    if (currentBounds && !currentBounds.canPlay) return;

    startInterval();
    if (clockSourceRef.current.interpolates) {
      rafRef.current = requestAnimationFrame(rafLoop);
    }
    setPlaying(true);
  }, [startInterval, rafLoop, setPlaying]);

  // Step back: pause first, then reverse logged ticks (or rewind recorded snapshots).
  // No-ops when at the lower bound.
  const retreat = useCallback(() => {
    stop();
    const activeSource = clockSourceRef.current;
    if (activeSource.name === 'recorded') {
      const result = activeSource.stepBack(stateRef.current, {
        count: stateRef.current?.session?.stepBack ?? 1,
        sourceContext: sourceContextRef.current,
        index: recordedIndexRef.current,
      });
      if (!result) return;
      recordedIndexRef.current = result.nextIndex;
      setRecordedIndex(result.nextIndex);
      sourceContextRef.current?.onIndexChange?.(result.nextIndex);
      sourceContextRef.current?.setIndex?.(result.nextIndex);
      stateRef.current = result.newState;
      dispatch({ type: 'APPLY_ROLLBACK', newState: result.newState });
      return;
    }

    const result = activeSource.stepBack(stateRef.current, {
      count: stateRef.current.session.stepBack,
      rollbackConfig: rollbackConfigRef.current,
    });
    if (!result) return;
    stateRef.current = result.newState;
    tickInfoRef.current.taskProgressPerTick = {};
    dispatch({ type: 'APPLY_ROLLBACK', newState: result.newState });
  }, [stop, dispatch]);

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

  return { start, stop, advance, retreat, resync, bounds };
}
