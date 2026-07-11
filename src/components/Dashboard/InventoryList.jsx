import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useTagsConfig } from '../../hooks/useTagsConfig.js';
import { usePermission } from '../../hooks/usePermission.js';
import Tooltip from '../Tooltip.jsx';
import ItemRow from './ItemRow.jsx';
import BankPanel from './BankPanel.jsx';

export default function InventoryList() {
  const { state, dispatch } = useGame();
  const { locked } = useTagsConfig();
  const { openLibrary } = useUI();
  const can = usePermission();

  return (
    <div className="pane" id="inventory-pane">
      <div className="col-label">INVENTORY</div>
      <div id="inventory-list">
        {!state.inventory.length && <div className="empty">—</div>}
        {state.inventory.map(item => <ItemRow key={item.id} item={item} />)}
        {can({ type: 'INVENTORY_ADD' }) && (
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
