import { useUI } from '../../../state/UIContext.jsx';
import { mergeAttribute } from '../../../logic/tags.js';
import { useCharBudget } from '../../../hooks/useCharBudget.js';
import EditableSpan from '../../EditableSpan.jsx';
import TagLabel from '../../TagLabel.jsx';
import DragNumber from '../../Dashboard/DragNumber.jsx';

// Editable item preview. Mirrors an expanded ItemRow but binds to a draft via
// onChange. Items will gain richer fields later; the layout is built to absorb
// that the same way ItemRow's body does.
export default function ItemPreview({ draft, onChange }) {
  const { openItemIcons, openTagRegistry } = useUI();
  const { ref: tagListRef, maxChars } = useCharBudget('tag-chip');

  return (
    <div className="item-row item-row--expanded library-preview-card">
      <div className="item-head">
        <div
          className="item-icon"
          title="Click to set icon"
          style={draft.icon ? { backgroundImage: `url("${draft.icon}")` } : {}}
          onClick={() => openItemIcons(url => onChange({ icon: url }))}
        />
        <EditableSpan
          className="item-name"
          value={draft.name}
          onCommit={v => onChange({ name: v || 'NEW ITEM' })}
        />
        <DragNumber
          className="item-qty mono"
          value={draft.quantity}
          min={0}
          onChange={n => onChange({ quantity: n })}
          onCommit={v => { const n = parseFloat(v); onChange({ quantity: isNaN(n) ? 0 : Math.max(0, n) }); }}
        />
        <span className="item-value mono">
          <DragNumber
            value={draft.value}
            min={0}
            onChange={n => onChange({ value: n })}
            onCommit={v => { const n = parseFloat(v); onChange({ value: isNaN(n) ? 0 : n }); }}
          /> GP
        </span>
      </div>

      <div className="item-body">
        <div className="tag-label">DESCRIPTION</div>
        <EditableSpan
          className="item-desc"
          value={draft.description}
          placeholder="description"
          onCommit={v => onChange({ description: v })}
        />
        <div className="tag-label">ATTRIBUTES</div>
        <div className="tag-list" ref={tagListRef}>
          {!draft.attributes.length && <span className="empty-inline">—</span>}
          {draft.attributes.map((tag, i) => (
            <span key={i} className="tag">
              <TagLabel tag={tag} maxChars={maxChars} />
              <span className="x" title="Remove" onClick={() => onChange({ attributes: draft.attributes.filter((_, attrIndex) => attrIndex !== i) })}>×</span>
            </span>
          ))}
          <button className="tag-add" title="Add attribute" onClick={() => openTagRegistry({
            onApply: (tag) => onChange({ attributes: mergeAttribute(draft.attributes, tag) }),
          })}>+</button>
        </div>
      </div>
    </div>
  );
}
