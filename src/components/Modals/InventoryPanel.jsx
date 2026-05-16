import Modal from './Modal.jsx';
import EditableSpan from '../EditableSpan.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';

export default function InventoryPanel() {
  const { state, dispatch } = useGame();
  const { setShowInventory } = useUI();
  const { inventory, session } = state;

  const close = () => setShowInventory(false);

  return (
    <Modal onClose={close}>
      <div className="config-panel inventory-panel" onClick={e => e.stopPropagation()}>
        <h2>INVENTORY</h2>
        <div className="bank-row">
          <span className="label">GP</span>
          <EditableSpan
            className="value bright mono bank-value"
            value={(session.bank ?? 0).toFixed(1)}
            onCommit={v => {
              const n = parseFloat(v);
              dispatch({
                type: 'SESSION_UPDATE',
                payload: { bank: isNaN(n) ? 0 : Math.round(n * 100) / 100 },
              });
            }}
          />
        </div>
        <div className="inventory-list">
          {!inventory.length && <div className="empty-state">No items</div>}
          {inventory.map(item => (
            <div key={item.id} className="inventory-row">
              <EditableSpan
                className="inventory-name"
                value={item.name}
                onCommit={v => dispatch({ type: 'INVENTORY_UPDATE_ITEM', id: item.id, changes: { name: v || 'ITEM' } })}
              />
              <span className="inventory-sep">|</span>
              <EditableSpan
                className="inventory-qty"
                value={String(item.qty)}
                onCommit={v => {
                  const n = parseFloat(v);
                  if (isNaN(n) || n <= 0) dispatch({ type: 'INVENTORY_REMOVE_ITEM', id: item.id });
                  else dispatch({ type: 'INVENTORY_UPDATE_ITEM', id: item.id, changes: { qty: n } });
                }}
              />
              <span
                className="x"
                title="Remove"
                onClick={e => { e.stopPropagation(); dispatch({ type: 'INVENTORY_REMOVE_ITEM', id: item.id }); }}
              >×</span>
            </div>
          ))}
        </div>
        <button className="add-inline" onClick={() => dispatch({ type: 'INVENTORY_ADD' })}>+ ITEM</button>
        <button className="ctrl" style={{ alignSelf: 'flex-end', marginTop: '4px' }} onClick={close}>CLOSE</button>
      </div>
    </Modal>
  );
}
