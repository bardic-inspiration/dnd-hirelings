import { useUI } from '../../../state/UIContext.jsx';
import { mergeAttribute } from '../../../logic/tags.js';
import { useCharBudget } from '../../../hooks/useCharBudget.js';
import EditableSpan from '../../EditableSpan.jsx';
import TagLabel from '../../TagLabel.jsx';
import Tooltip from '../../Tooltip.jsx';

// Editable agent preview. Mirrors AgentCard's markup/CSS but binds to a draft
// preset via onChange instead of dispatching board actions. Attribute "active"
// highlighting and the TASKS section are board-only, so they're omitted here.
export default function AgentPreview({ draft, onChange }) {
  const { openPortraits, openTagRegistry } = useUI();
  const { ref: tagListRef, maxChars } = useCharBudget('tag-chip');

  return (
    <div className="agent-card library-preview-card">
      <EditableSpan
        className="agent-name"
        value={draft.name}
        onCommit={v => onChange({ name: v || 'NEW HIRELING' })}
      />

      <Tooltip content="Click to set image">
        <div
          className="agent-icon"
          style={draft.icon ? { backgroundImage: `url("${draft.icon}")` } : {}}
          onClick={() => openPortraits(url => onChange({ icon: url }))}
        >
          {!draft.icon && 'NO IMAGE'}
        </div>
      </Tooltip>

      <div className="agent-rate">
        <EditableSpan
          className="value"
          value={String(draft.rate)}
          onCommit={v => { const n = parseFloat(v); onChange({ rate: isNaN(n) ? 0 : n }); }}
        />
        <EditableSpan
          className="unit"
          value={draft.rateUnit}
          onCommit={v => onChange({ rateUnit: v })}
        />
      </div>

      {/* XP seeds the dynamic level/AC/HP computed once the agent is created
          (see logic/dynamicAttributes.js) — level itself is never an authored tag. */}
      <div className="agent-rate">
        <span className="unit">XP</span>
        <EditableSpan
          className="value"
          value={String(draft.xp ?? 0)}
          onCommit={v => { const n = parseFloat(v); onChange({ xp: isNaN(n) ? 0 : Math.max(0, n) }); }}
        />
      </div>

      <EditableSpan
        className="agent-desc"
        value={draft.description}
        placeholder="description"
        onCommit={v => onChange({ description: v })}
      />

      <div className="tag-section">
        <div className="tag-label">ATTRIBUTES</div>
        <div className="tag-list" ref={tagListRef}>
          {!draft.attributes.length && <span className="empty-inline">—</span>}
          {draft.attributes.map((tag, i) => (
            <span key={i} className="tag">
              <TagLabel tag={tag} maxChars={maxChars} />
              <Tooltip content="Remove">
                <span className="x" onClick={() => onChange({ attributes: draft.attributes.filter((_, j) => j !== i) })}>×</span>
              </Tooltip>
            </span>
          ))}
          <Tooltip content="Add attribute">
            <button className="tag-add" onClick={() => openTagRegistry({
              onApply: (tag) => onChange({ attributes: mergeAttribute(draft.attributes, tag) }),
            })}>+</button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
