import { useState } from 'react';
import Modal from './Modal.jsx';
import { useUI } from '../../state/UIContext.jsx';

/**
 * Generic stand-in for native `confirm`/`alert`/`prompt` dialogs, driven by
 * `useUI().confirmProps` (set via `openConfirm`). `type` selects the shape:
 * `'confirm'` (OK/Cancel), `'alert'` (OK only), `'prompt'` (text input +
 * OK/Cancel). `onConfirm` fires only on OK; Cancel/Escape/overlay-click closes
 * without calling it, matching native dialog cancel semantics.
 */
export default function ConfirmModal() {
  const { confirmProps, closeConfirm } = useUI();
  const { message, type = 'confirm', defaultValue = '', danger, onConfirm } = confirmProps;
  const [value, setValue] = useState(defaultValue);

  const handleConfirm = () => {
    onConfirm?.(type === 'prompt' ? value : undefined);
    closeConfirm();
  };

  return (
    <Modal onClose={closeConfirm} overlayClass="confirm-overlay">
      <div className="confirm-panel" onClick={e => e.stopPropagation()}>
        <div className="confirm-message">{message}</div>
        {type === 'prompt' && (
          <input
            className="confirm-input"
            value={value}
            onChange={e => setValue(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
          />
        )}
        <div className="confirm-actions">
          {type !== 'alert' && (
            <button className="ctrl" onClick={closeConfirm}>CANCEL</button>
          )}
          <button
            className={`ctrl${danger ? ' confirm-btn--danger' : ''}`}
            onClick={handleConfirm}
            autoFocus={type !== 'prompt'}
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
