import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import ItemRow from './ItemRow.jsx';
import BankPanel from './BankPanel.jsx';

export default function InventoryList() {
  const { state, dispatch } = useGame();
  const { openLibrary } = useUI();

  return (
    <div className="pane" id="inventory-pane">
      <div className="col-label">INVENTORY</div>
      <div id="inventory-list">
        {!state.inventory.length && <div className="empty">—</div>}
        {state.inventory.map(item => <ItemRow key={item.id} item={item} />)}
        <button
          className="add-card add-item"
          onClick={e => { e.stopPropagation(); dispatch({ type: 'INVENTORY_ADD' }); }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openLibrary('item'); }}
          title="Click to add. Right click for the library."
        >+ ITEM</button>
      </div>
      <BankPanel />
    </div>
  );
}
