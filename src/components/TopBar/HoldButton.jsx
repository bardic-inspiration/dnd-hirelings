import { usePressHoldDrag } from '../../hooks/usePressHoldDrag.js';
import Tooltip from '../Tooltip.jsx';

export default function HoldButton({ className = '', onClick, onAdjust, title, children }) {
  const { holding, onPointerDown } = usePressHoldDrag({ onClick, onAdjust });
  return (
    <Tooltip content={title}>
      <button
        type="button"
        className={`${className}${holding ? ' ctrl--holding' : ''}`}
        onPointerDown={onPointerDown}
      >
        {children}
      </button>
    </Tooltip>
  );
}
