import { useRef, useEffect, useCallback } from 'react';
import { useGame } from '../state/GameContext.jsx';
import { useUI } from '../state/UIContext.jsx';
import { advanceTime, getPlayIntervalMs, updateClockDisplayDOM } from '../logic/clock.js';
import { rollbackTick } from '../logic/rollback.js';
import { flashAgentCard } from '../logic/dom.js';
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
 * Side effects:
 * - Dispatches `APPLY_TICK` on every tick and `APPLY_ROLLBACK` on `retreat`
 * - Adds/removes `agent-card--flash-error` CSS class on agent cards
 * - Directly mutates clock and progress-bar DOM nodes every frame
 *
 * @returns {{ start: () => void, stop: () => void, advance: () => void, retreat: () => void }}
 */
export function usePlayClock() {
  const { state, dispatch } = useGame();
  const { playing, setPlaying } = useUI();
  const clockConfig = useClockConfig();
  const rollbackConfig = useRollbackConfig();

  const stateRef   = useRef(state);
  const playingRef = useRef(playing);
  // Interval/RAF callbacks read configs through refs so they never close over
  // stale values between config edits and the next (re)start.
  const clockConfigRef    = useRef(clockConfig);
  const rollbackConfigRef = useRef(rollbackConfig);
  const tickInfoRef = useRef({ lastTickWallTime: 0, tickIntervalMs: 1000, taskProgressPerTick: {} });
  const intervalRef = useRef(null);
  const rafRef      = useRef(null);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { rollbackConfigRef.current = rollbackConfig; }, [rollbackConfig]);

  // One simulation tick: advance state, publish the per-tick progress rates for
  // the RAF loop, commit, and flash agents that couldn't contribute.
  // `resetWallTime` restarts the interpolation clock — true for interval ticks,
  // false for a manual step (the RAF loop only interpolates while playing).
  const runTick = useCallback((resetWallTime) => {
    const result = advanceTime(stateRef.current, {
      clockConfig: clockConfigRef.current,
      rollbackConfig: rollbackConfigRef.current,
    });
    stateRef.current = result.newState;
    if (resetWallTime) tickInfoRef.current.lastTickWallTime = Date.now();
    tickInfoRef.current.taskProgressPerTick = result.taskProgressPerTick;
    dispatch({ type: 'APPLY_TICK', newState: result.newState });
    result.flashAgentIds.forEach(flashAgentCard);
  }, [dispatch]);

  const tick    = useCallback(() => runTick(true), [runTick]);
  const advance = useCallback(() => runTick(false), [runTick]);

  const rafLoop = useCallback(() => {
    if (!playingRef.current) return;
    updateClockDisplayDOM(stateRef.current, tickInfoRef.current, clockConfigRef.current);
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
    rafRef.current = requestAnimationFrame(rafLoop);
    setPlaying(true);
  }, [startInterval, rafLoop, setPlaying]);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (rafRef.current)       { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setPlaying(false);
  }, [setPlaying]);

  // One step back: pause first (so the RAF loop can't fight the rewound
  // state), then reverse the most recent logged tick. No-ops at the horizon.
  const retreat = useCallback(() => {
    stop();
    const result = rollbackTick(stateRef.current, rollbackConfigRef.current);
    if (!result) return;
    stateRef.current = result.newState;
    tickInfoRef.current.taskProgressPerTick = {};
    dispatch({ type: 'APPLY_ROLLBACK', newState: result.newState });
  }, [stop, dispatch]);

  // Apply clock config edits immediately: recompute the interval mid-play
  // (file configs have no binding effect to fire a restart from the modal).
  useEffect(() => {
    clockConfigRef.current = clockConfig;
    if (playingRef.current && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      startInterval();
    }
  }, [clockConfig, startInterval]);

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

  return { start, stop, advance, retreat };
}
