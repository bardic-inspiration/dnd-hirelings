import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useTagsConfig } from '../../hooks/useTagsConfig.js';
import { useCan } from '../../hooks/useCan.js';
import Tooltip from '../Tooltip.jsx';
import ItemRow from './ItemRow.jsx';
import BankPanel from './BankPanel.jsx';

export default function InventoryList() {
  const { state, dispatch } = useGame();
  const { locked } = useTagsConfig();
  // The library and right-click add both create entities.
  const canAdd = useCan()('INVENTORY_ADD');
  const { openLibrary } = useUI();

  return (
    <div className="pane" id="inventory-pane">
      <div className="col-label">INVENTORY</div>
      <div id="inventory-list">
        {!state.inventory.length && <div className="empty">—</div>}
        {state.inventory.map(item => <ItemRow key={item.id} item={item} />)}
        {canAdd && (
          <Tooltip content="Click for the library. Right click to add.">
            <button
              className="add-card add-item"
              onClick={e => { e.stopPropagation(); openLibrary('item'); }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'INVENTORY_ADD', locked }); }}
            >+ ITEM</button>
          </Tooltip>
        )}
      </div>
      <BankPanel />
    </div>
  );
}
