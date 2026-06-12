import { useUI } from '../../../state/UIContext.jsx';
import { parseTag, formatTagLabel } from '../../../logic/tags.js';
import EditableSpan from '../../EditableSpan.jsx';

// One editable tag list (requirements / attributes). Reuses the task-card
// section/tag classes but writes to the draft via onChange.
function TagListSection({ label, addLabel, context, field, tags, onChange }) {
  const { openTagBuilder } = useUI();

  const handleAdd = () => openTagBuilder({
    context,
    onSave: (tag) => onChange({ [field]: [...tags, tag] }),
  });

  return (
    <div className="task-section">
      <div className="tag-label">{label}</div>
      <div className="task-tag-list">
        {!tags.length && <div className="task-tag-list-empty">—</div>}
        {tags.map((tag, i) => {
          const { label: tl, params } = formatTagLabel(parseTag(tag));
          return (
            <div key={i} className="tag-list-item">
              <span className="tag-content"><strong>{tl}</strong>{params}</span>
              <span className="x" onClick={() => onChange({ [field]: tags.filter((_, j) => j !== i) })}>×</span>
            </div>
          );
        })}
      </div>
      <button className="tag-add" onClick={handleAdd}>{addLabel}</button>
    </div>
  );
}

// Editable list of the draft's condition templates. Templates carry no id or
// progress (those are stamped at task creation), so rows key by index and
// removal filters by index.
function ConditionTemplateSection({ conditions, onChange }) {
  const { openConditionBuilder } = useUI();

  const handleAdd = () => openConditionBuilder({
    onSave: (template) => onChange({ conditions: [...conditions, template] }),
  });

  return (
    <div className="task-section">
      <div className="tag-label">CONDITIONS</div>
      <div className="task-tag-list">
        {!conditions.length && <div className="task-tag-list-empty">—</div>}
        {conditions.map((template, i) => (
          <div key={i} className="tag-list-item">
            <span className="tag-content">
              <strong>{template.name}</strong> ={template.target}
              <span className="dim"> · {template.tracker?.tagPath ?? 'any agent'}</span>
            </span>
            <span className="x" onClick={() => onChange({ conditions: conditions.filter((_, j) => j !== i) })}>×</span>
          </div>
        ))}
      </div>
      <button className="tag-add" onClick={handleAdd}>+ CONDITION</button>
    </div>
  );
}

// Editable task preview. Tasks have no icon, so a solid filled placeholder
// square stands in for a future minimap display. Runtime progress/results are
// board-only and excluded from the preset.
export default function TaskPreview({ draft, onChange }) {
  return (
    <div className="task-card library-preview-card">
      <div className="task-header">
        <EditableSpan
          className="task-name"
          value={draft.name}
          onCommit={v => onChange({ name: v || 'NEW TASK' })}
        />
      </div>

      <div className="task-preview-frame" title="Map (coming soon)" />

      <div className="task-body">
        <div className="tag-label">DESCRIPTION</div>
        <EditableSpan
          className="task-desc"
          value={draft.description}
          placeholder="description"
          onCommit={v => onChange({ description: v })}
        />
        <TagListSection
          label="REQUIREMENTS" addLabel="+ REQ" context="requirement"
          field="requirements" tags={draft.requirements} onChange={onChange}
        />
        <ConditionTemplateSection conditions={draft.conditions || []} onChange={onChange} />
        <TagListSection
          label="ATTRIBUTES" addLabel="+ TAG" context="attribute"
          field="attributes" tags={draft.attributes} onChange={onChange}
        />
      </div>
    </div>
  );
}
