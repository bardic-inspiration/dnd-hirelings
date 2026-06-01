import { useRef } from 'react';
import EditableSpan from '../EditableSpan.jsx';

const DRAG_THRESHOLD_PX = 4;
const PX_PER_UNIT = 12;

// A numeric field that can be edited by clicking (type a value) or adjusted by
// dragging vertically (up = increase, down = decrease) by `step` per PX_PER_UNIT.
// Unlike usePressHoldDrag (drag-only), a plain click falls through to the inline
// editor, so pointerdown is not prevent-defaulted.
export default function DragNumber({ value, onChange, onCommit, className, step = 1, min }) {
  const startY    = useRef(0);
  const lastDelta = useRef(0);
  const dragging  = useRef(false);
  const valueRef  = useRef(value);
  valueRef.current = value;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    startY.current   = e.clientY;
    lastDelta.current = 0;
    dragging.current = false;

    const onMove = (ev) => {
      const dyPx = startY.current - ev.clientY;
      if (!dragging.current && Math.abs(dyPx) <= DRAG_THRESHOLD_PX) return;
      // Drag detected: suppress text selection in the editable field.
      if (!dragging.current) window.getSelection()?.removeAllRanges();
      dragging.current = true;
      ev.preventDefault();
      const delta  = Math.trunc(dyPx / PX_PER_UNIT);
      const change = delta - lastDelta.current;
      if (change !== 0) {
        let next = valueRef.current + change * step;
        if (min !== undefined) next = Math.max(min, next);
        next = Math.round(next * 100) / 100;
        onChange(next);
        lastDelta.current = delta;
      }
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  // After a drag, swallow the synthetic click so it doesn't focus the editor.
  const onClickCapture = (e) => {
    if (dragging.current) {
      e.stopPropagation();
      e.preventDefault();
      dragging.current = false;
    }
  };

  return (
    <span
      className="drag-number"
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      title="Click to edit. Drag up/down to adjust."
    >
      <EditableSpan className={className} value={String(value)} onCommit={onCommit} />
    </span>
  );
}
