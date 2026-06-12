import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { parseTag, formatTagLabel } from '../../logic/tags.js';
import EditableSpan from '../EditableSpan.jsx';
import DragNumber from './DragNumber.jsx';

export default function ItemRow({ item }) {
  const { dispatch } = useGame();
  const { selectedItemId, setSelectedItemId, openItemIcons, openTagRegistry } = useUI();
  const [expanded, setExpanded] = useState(false);

  const selected = selectedItemId === item.id;
  const update = (changes) => dispatch({ type: 'INVENTORY_UPDATE_ITEM', id: item.id, changes });

  const handleRowClick = () => setSelectedItemId(selected ? null : item.id);

  const handleIconClick = (e) => {
    e.stopPropagation();
    openItemIcons((url) => update({ icon: url }));
  };

  const handleQty = (v) => {
    const n = parseFloat(v);
    // Depleted items stay in the list (grayed out); only manual delete removes them.
    update({ quantity: isNaN(n) ? 0 : Math.max(0, n) });
  };

  const handleValue = (v) => {
    const n = parseFloat(v);
    update({ value: isNaN(n) ? 0 : n });
  };

  const handleAddAttr = (e) => {
    e.stopPropagation();
    openTagRegistry({ target: { type: 'item', id: item.id } });
  };

  return (
    <div
      className={`item-row${selected ? ' item-row--selected' : ''}${expanded ? ' item-row--expanded' : ''}${item.quantity <= 0 ? ' item-row--depleted' : ''}`}
      data-id={item.id}
      onClick={handleRowClick}
    >
      <div className="item-head">
        <div
          className="item-icon"
          title="Click to set icon"
          style={item.icon ? { backgroundImage: `url("${item.icon}")` } : {}}
          onClick={handleIconClick}
        />
        <EditableSpan
          className="item-name"
          value={item.name}
          onCommit={v => update({ name: v || 'ITEM' })}
        />
        <DragNumber
          className="item-qty mono"
          value={item.quantity}
          min={0}
          onChange={n => update({ quantity: n })}
          onCommit={handleQty}
        />
        <span className="item-value mono">
          <DragNumber
            value={item.value}
            min={0}
            onChange={n => update({ value: n })}
            onCommit={handleValue}
          /> GP
        </span>
        <span
          className="item-toggle"
          title="Expand / collapse"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
        >{expanded ? '−' : '+'}</span>
        <span
          className="x"
          title="Delete item"
          onClick={e => {
            e.stopPropagation();
            if (confirm(`Delete item "${item.name}"?`)) dispatch({ type: 'INVENTORY_REMOVE_ITEM', id: item.id });
          }}
        >×</span>
      </div>

      <div className="item-body">
        <div className="tag-label">DESCRIPTION</div>
        <EditableSpan
          className="item-desc"
          value={item.description}
          placeholder="description"
          onCommit={v => update({ description: v })}
        />
        <div className="tag-label">ATTRIBUTES</div>
        <div className="tag-list">
          {!item.attributes.length && <span className="empty-inline">—</span>}
          {item.attributes.map((tag, index) => {
            const { label, params } = formatTagLabel(parseTag(tag));
            return (
              <span key={index} className="tag">
                {label}{params}
                <span className="x" title="Remove" onClick={e => { e.stopPropagation(); dispatch({ type: 'INVENTORY_REMOVE_ATTRIBUTE', id: item.id, index }); }}>×</span>
              </span>
            );
          })}
          <button className="tag-add" title="Add attribute" onClick={handleAddAttr}>+</button>
        </div>
      </div>
    </div>
  );
}
