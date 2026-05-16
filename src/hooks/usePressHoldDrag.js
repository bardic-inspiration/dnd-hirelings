import { useRef, useCallback, useState, useEffect } from 'react';

const HOLD_MS = 200;
const DRAG_THRESHOLD_PX = 4;
const PX_PER_UNIT = 12;

// Click-to-act + click-hold-drag-to-modulate.
// onClick fires for a quick click without drag.
// onAdjust(delta) fires while dragging; delta is integer steps (positive = up).
export function usePressHoldDrag({ onClick, onAdjust }) {
  const [holding, setHolding] = useState(false);
  const cbRef     = useRef({ onClick, onAdjust });
  const holdTimer = useRef(null);
  const startY    = useRef(0);
  const lastDelta = useRef(0);
  const moved     = useRef(false);
  const held      = useRef(false);
  const movePtr   = useRef(null);
  const upPtr     = useRef(null);

  useEffect(() => { cbRef.current = { onClick, onAdjust }; }, [onClick, onAdjust]);

  const cleanup = useCallback(() => {
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (movePtr.current) document.removeEventListener('pointermove', movePtr.current);
    if (upPtr.current) {
      document.removeEventListener('pointerup',     upPtr.current);
      document.removeEventListener('pointercancel', upPtr.current);
    }
    movePtr.current = null;
    upPtr.current   = null;
    setHolding(false);
    held.current = false;
  }, []);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startY.current = e.clientY;
    lastDelta.current = 0;
    moved.current = false;
    held.current  = false;

    holdTimer.current = setTimeout(() => {
      held.current = true;
      setHolding(true);
    }, HOLD_MS);

    const onMove = (ev) => {
      if (!held.current) {
        if (Math.abs(ev.clientY - startY.current) > DRAG_THRESHOLD_PX) {
          moved.current = true;
        }
        return;
      }
      const dyPx   = startY.current - ev.clientY;
      const delta  = Math.trunc(dyPx / PX_PER_UNIT);
      const change = delta - lastDelta.current;
      if (change !== 0) {
        cbRef.current.onAdjust?.(change);
        lastDelta.current = delta;
      }
    };

    const onUp = () => {
      const wasHeld = held.current;
      cleanup();
      if (!wasHeld && !moved.current) cbRef.current.onClick?.();
    };

    movePtr.current = onMove;
    upPtr.current   = onUp;
    document.addEventListener('pointermove',   onMove);
    document.addEventListener('pointerup',     onUp);
    document.addEventListener('pointercancel', onUp);
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { holding, onPointerDown };
}
