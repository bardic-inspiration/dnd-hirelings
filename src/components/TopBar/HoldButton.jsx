import { usePressHoldDrag } from '../../hooks/usePressHoldDrag.js';

export default function HoldButton({ className = '', onClick, onAdjust, title, children }) {
  const { holding, onPointerDown } = usePressHoldDrag({ onClick, onAdjust });
  return (
    <button
      type="button"
      className={`${className}${holding ? ' ctrl--holding' : ''}`}
      onPointerDown={onPointerDown}
      title={title}
    >
      {children}
    </button>
  );
}
