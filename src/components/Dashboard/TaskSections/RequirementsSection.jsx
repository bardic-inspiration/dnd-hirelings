import { useGame } from '../../../state/GameContext.jsx';
import { parseTag, getSchemaEntry } from '../../../logic/tags.js';

function TagRow({ taskId, tagStr, index }) {
  const { dispatch } = useGame();
  const p = parseTag(tagStr);
  const entry = getSchemaEntry(p);
  const typeLabel = entry ? entry.label.toUpperCase() : p.type.toUpperCase();
  const showName  = p.name && !entry?.nameFixed;
  const label     = showName ? `${typeLabel}: ${p.name.toUpperCase()}` : typeLabel;
  const params    = p.value !== null ? ` =${p.value}` : '';
  return (
    <div className="tag-list-item">
      <span className="tag-content">
        <strong>{label}</strong>{params}
      </span>
      <span className="x" onClick={e => { e.stopPropagation(); dispatch({ type: 'TASK_REMOVE_REQUIREMENT', id: taskId, index }); }}>×</span>
    </div>
  );
}

export default function RequirementsSection({ task }) {
  const { dispatch } = useGame();
  const reqs = task.requirements
    .map((tag, i) => ({ tag, i }))
    .filter(({ tag }) => parseTag(tag).isReq);

  return (
    <div className="task-section">
      <div className="tag-label">REQUIREMENTS</div>
      <div className="task-tag-list">
        {!reqs.length && <div className="empty-state">—</div>}
        {reqs.map(({ tag, i }) => <TagRow key={i} taskId={task.id} tagStr={tag} index={i} />)}
      </div>
    </div>
  );
}
