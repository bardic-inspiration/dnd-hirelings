import { useRef, useEffect, useCallback, useState } from 'react';
import { useGame } from '../state/GameContext.jsx';
import { useUI } from '../state/UIContext.jsx';
import { getPlayIntervalMs, updateClockDisplayDOM } from '../logic/clock.js';
import { flashAgentCard } from '../logic/dom.js';
import { createPlayClockDriver } from '../logic/clockSources.js';
import { useClockConfig } from './useClockConfig.js';
import { useRollbackConfig } from './useRollbackConfig.js';
import { useTagsConfig } from './useTagsConfig.js';

/**
 * Manages the game loop: an interval for discrete ticks and a `requestAnimationFrame`
 * loop for smooth clock/progress interpolation between ticks.
 *
 * Pluggable clock sources (`CLOCK_SOURCE_REGISTRY`) are coordinated through
 * `createPlayClockDriver`:
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

  const stateRef          = useRef(state);
  const rollbackConfigRef = useRef(rollbackConfig);
  const lockedRef         = useRef(locked);
  const clockConfigRef    = useRef(clockConfig);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { rollbackConfigRef.current = rollbackConfig; }, [rollbackConfig]);
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  useEffect(() => { clockConfigRef.current = clockConfig; }, [clockConfig]);

  const driverRef = useRef(null);
  const [bounds, setBounds] = useState(null);

  if (!driverRef.current) {
    driverRef.current = createPlayClockDriver({
      source,
      sourceContext,
      getState: () => stateRef.current,
      dispatch: (action) => {
        dispatch(action);
        setBounds(driverRef.current.getBounds());
      },
      flashAgent: flashAgentCard,
      getRollbackConfig: () => rollbackConfigRef.current,
      getLocked: () => lockedRef.current,
      getIntervalMs: (session) => getPlayIntervalMs(session, clockConfigRef.current),
      scheduleInterval: (tickFn, intervalMs) => setInterval(tickFn, intervalMs),
      cancelInterval: (handle) => clearInterval(handle),
      scheduleRaf: (rafFn) => requestAnimationFrame(rafFn),
      cancelRaf: (handle) => cancelAnimationFrame(handle),
      onInterpolate: (curState, tickInfo) => updateClockDisplayDOM(curState, tickInfo),
      onPlayingChange: (nextPlaying) => setPlaying(nextPlaying),
    });
  }

  // Keep bounds in sync with state or sourceContext updates
  useEffect(() => {
    setBounds(driverRef.current.getBounds());
  }, [state, sourceContext]);

  // Handle source switch or context replacement: stops any running interval
  // and resets the playhead index and tick info
  useEffect(() => {
    driverRef.current.switchSource(source, sourceContext);
    setBounds(driverRef.current.getBounds());
  }, [source, sourceContext]);

  // Handle external sourceContext.index sync
  useEffect(() => {
    if (typeof sourceContext?.index === 'number') {
      driverRef.current.syncIndex(sourceContext.index);
      setBounds(driverRef.current.getBounds());
    }
  }, [sourceContext?.index]);

  // Apply pacing edits immediately: recompute the interval mid-play on clock
  // config changes (file configs have no binding effect to fire from the
  // modal) and on rate edits. The rateMultiplier dep matters — dispatch is
  // batched, so a synchronous resync from a modal commit would read the
  // PRE-edit rate through stateRef; this effect runs after stateRef updates.
  useEffect(() => {
    driverRef.current.resync();
  }, [clockConfig, state.session.rateMultiplier]);

  // Pause interval while any contenteditable has focus; resume after blur.
  useEffect(() => {
    let resumeTimer = null;
    const onFocusIn = (e) => {
      if (!e.target.matches('[contenteditable], .req-field')) return;
      clearTimeout(resumeTimer);
      if (driverRef.current.isPlaying()) {
        driverRef.current.stop();
      }
    };
    const onFocusOut = (e) => {
      if (!e.target.matches('[contenteditable], .req-field')) return;
      resumeTimer = setTimeout(() => {
        if (playing && !driverRef.current.isPlaying()) {
          driverRef.current.start();
        }
      }, 100);
    };
    document.addEventListener('focusin',  onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin',  onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      clearTimeout(resumeTimer);
    };
  }, [playing]);

  // Cleanup on unmount
  useEffect(() => () => {
    driverRef.current.stop();
  }, []);

  const start   = useCallback(() => {
    driverRef.current.start();
    setBounds(driverRef.current.getBounds());
  }, []);
  const stop    = useCallback(() => {
    driverRef.current.stop();
    setBounds(driverRef.current.getBounds());
  }, []);
  const advance = useCallback(() => {
    driverRef.current.advance();
    setBounds(driverRef.current.getBounds());
  }, []);
  const retreat = useCallback(() => {
    driverRef.current.retreat();
    setBounds(driverRef.current.getBounds());
  }, []);
  const resync  = useCallback(() => {
    driverRef.current.resync();
  }, []);

  return { start, stop, advance, retreat, resync, bounds: bounds ?? driverRef.current.getBounds() };
}
