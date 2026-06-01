import { useGame } from '../../state/GameContext.jsx';
import ItemRow from './ItemRow.jsx';
import BankPanel from './BankPanel.jsx';

export default function InventoryList() {
  const { state, dispatch } = useGame();

  return (
    <div className="pane" id="inventory-pane">
      <div className="col-label">INVENTORY</div>
      <div id="inventory-list">
        {!state.inventory.length && <div className="empty">—</div>}
        {state.inventory.map(item => <ItemRow key={item.id} item={item} />)}
        <button className="add-inline" onClick={e => { e.stopPropagation(); dispatch({ type: 'INVENTORY_ADD' }); }}>+ ITEM</button>
      </div>
      <BankPanel />
    </div>
  );
}
