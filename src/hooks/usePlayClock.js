import { useRef, useEffect, useCallback } from 'react';
import { useGame } from '../state/GameContext.jsx';
import { useUI } from '../state/UIContext.jsx';
import { advanceTime, getPlayIntervalMs, updateClockDisplayDOM } from '../logic/clock.js';

function flashAgentCard(agentId) {
  const card = document.querySelector(`.agent-card[data-id="${agentId}"]`);
  if (!card) return;
  card.classList.remove('flash-error');
  void card.offsetWidth;
  card.classList.add('flash-error');
  card.addEventListener('animationend', () => card.classList.remove('flash-error'), { once: true });
}

export function usePlayClock() {
  const { state, dispatch } = useGame();
  const { playing, setPlaying } = useUI();

  const stateRef   = useRef(state);
  const playingRef = useRef(playing);
  const tickInfoRef = useRef({ lastTickWallTime: 0, tickIntervalMs: 1000, taskWorkPerTick: {} });
  const intervalRef = useRef(null);
  const rafRef      = useRef(null);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const tick = useCallback(() => {
    const result = advanceTime(stateRef.current);
    stateRef.current = result.newState;
    tickInfoRef.current.lastTickWallTime = Date.now();
    tickInfoRef.current.taskWorkPerTick  = result.taskWorkPerTick;
    dispatch({ type: 'APPLY_TICK', newState: result.newState });
    result.flashAgentIds.forEach(flashAgentCard);
  }, [dispatch]);

  const rafLoop = useCallback(() => {
    if (!playingRef.current) return;
    updateClockDisplayDOM(stateRef.current, tickInfoRef.current);
    rafRef.current = requestAnimationFrame(rafLoop);
  }, []);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    const ms = getPlayIntervalMs(stateRef.current.session);
    tickInfoRef.current.tickIntervalMs   = ms;
    tickInfoRef.current.lastTickWallTime = Date.now();
    intervalRef.current = setInterval(tick, ms);
    rafRef.current      = requestAnimationFrame(rafLoop);
    setPlaying(true);
  }, [tick, rafLoop, setPlaying]);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (rafRef.current)       { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setPlaying(false);
  }, [setPlaying]);

  const advance = useCallback(() => {
    const result = advanceTime(stateRef.current);
    stateRef.current = result.newState;
    tickInfoRef.current.taskWorkPerTick = result.taskWorkPerTick;
    dispatch({ type: 'APPLY_TICK', newState: result.newState });
    result.flashAgentIds.forEach(flashAgentCard);
  }, [dispatch]);

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
        if (playingRef.current && !intervalRef.current) {
          const ms = getPlayIntervalMs(stateRef.current.session);
          tickInfoRef.current.tickIntervalMs   = ms;
          tickInfoRef.current.lastTickWallTime = Date.now();
          intervalRef.current = setInterval(tick, ms);
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
  }, [tick]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (rafRef.current)      cancelAnimationFrame(rafRef.current);
  }, []);

  return { start, stop, advance };
}
