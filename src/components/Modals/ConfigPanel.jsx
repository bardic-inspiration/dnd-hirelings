import Modal from './Modal.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';

export default function ConfigPanel({ onRestartPlay }) {
  const { state, dispatch } = useGame();
  const { setShowConfig }   = useUI();
  const { session } = state;

  const close = () => setShowConfig(false);

  const update = (key, rawValue) => {
    const v = parseFloat(rawValue);
    if (isNaN(v) || v <= 0) return;
    dispatch({ type: 'SESSION_UPDATE', payload: { [key]: v } });
    if (key === 'rateMultiplier') onRestartPlay?.();
  };

  return (
    <Modal onClose={close}>
      <div className="config-panel" onClick={e => e.stopPropagation()}>
        <h2>SETTINGS</h2>
        {[
          { label: 'TIME RATE',   key: 'rateMultiplier', min: '0.1', step: '0.1' },
          { label: 'WORK RATE',   key: 'workRate',        min: '0',   step: '0.1' },
          { label: 'SKILL BONUS', key: 'skillBonus',      min: '0',   step: '0.1' },
        ].map(({ label, key, min, step }) => (
          <div key={key} className="config-row">
            <label>{label}</label>
            <input
              type="number"
              min={min}
              step={step}
              defaultValue={String(session[key] ?? 1)}
              onChange={e => update(key, e.target.value)}
            />
          </div>
        ))}
        <button className="ctrl" style={{ alignSelf: 'flex-end', marginTop: '8px' }} onClick={close}>CLOSE</button>
      </div>
    </Modal>
  );
}
