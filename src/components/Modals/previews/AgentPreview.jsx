import { useUI } from '../../../state/UIContext.jsx';
import { parseTag, formatTagLabel, mergeAttribute } from '../../../logic/tags.js';
import EditableSpan from '../../EditableSpan.jsx';

// Editable agent preview. Mirrors AgentCard's markup/CSS but binds to a draft
// preset via onChange instead of dispatching board actions. Attribute "active"
// highlighting and the TASKS section are board-only, so they're omitted here.
export default function AgentPreview({ draft, onChange }) {
  const { openPortraits, openTagRegistry } = useUI();

  return (
    <div className="agent-card library-preview-card">
      <EditableSpan
        className="agent-name"
        value={draft.name}
        onCommit={v => onChange({ name: v || 'NEW HIRELING' })}
      />

      <div
        className="agent-icon"
        title="Click to set image"
        style={draft.icon ? { backgroundImage: `url("${draft.icon}")` } : {}}
        onClick={() => openPortraits(url => onChange({ icon: url }))}
      >
        {!draft.icon && 'NO IMAGE'}
      </div>

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

      <EditableSpan
        className="agent-desc"
        value={draft.description}
        placeholder="description"
        onCommit={v => onChange({ description: v })}
      />

      <div className="tag-section">
        <div className="tag-label">ATTRIBUTES</div>
        <div className="tag-list">
          {!draft.attributes.length && <span className="empty-inline">—</span>}
          {draft.attributes.map((tag, i) => {
            const { label, params } = formatTagLabel(parseTag(tag));
            return (
              <span key={i} className="tag">
                {label}{params}
                <span className="x" title="Remove" onClick={() => onChange({ attributes: draft.attributes.filter((_, j) => j !== i) })}>×</span>
              </span>
            );
          })}
          <button className="tag-add" title="Add attribute" onClick={() => openTagRegistry({
            onApply: (tag) => onChange({ attributes: mergeAttribute(draft.attributes, tag) }),
          })}>+</button>
        </div>
      </div>
    </div>
  );
}
