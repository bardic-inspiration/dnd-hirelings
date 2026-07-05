import { usePressHoldDrag } from '../../hooks/usePressHoldDrag.js';
import Tooltip from '../Tooltip.jsx';

/**
 * A control button combining a quick click with a press-hold-drag adjustment
 * gesture (see `usePressHoldDrag`). `disabled` dims the button and suppresses
 * `onClick` only — the hold-drag `onAdjust` gesture stays live, which is why
 * the native `disabled` attribute (which blocks all pointer events) is not used.
 *
 * @param {{ className?: string, onClick?: () => void, onAdjust?: (delta: number) => void,
 *   disabled?: boolean, title?: string, children?: import('react').ReactNode }} props
 * @returns {JSX.Element}
 */
export default function HoldButton({ className = '', onClick, onAdjust, disabled = false, title, children }) {
  const { holding, onPointerDown } = usePressHoldDrag({ onClick: disabled ? undefined : onClick, onAdjust });
  return (
    <Tooltip content={title}>
      <button
        type="button"
        className={`${className}${holding ? ' ctrl--holding' : ''}${disabled ? ' ctrl--disabled' : ''}`}
        onPointerDown={onPointerDown}
      >
        {children}
      </button>
    </Tooltip>
  );
}
