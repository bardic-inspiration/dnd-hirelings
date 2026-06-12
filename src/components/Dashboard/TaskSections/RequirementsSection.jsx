import { useGame } from '../../../state/GameContext.jsx';
import { useUI } from '../../../state/UIContext.jsx';
import TagRow from './TagRow.jsx';

export default function RequirementsSection({ task }) {
  const { dispatch } = useGame();
  const { openTagRegistry } = useUI();

  const handleAdd = () => openTagRegistry({ target: { type: 'task', id: task.id }, initialModifier: 'req' });

  const reqs = task.requirements || [];

  return (
    <div className="task-section">
      <div className="tag-label">REQUIREMENTS</div>
      <div className="task-tag-list">
        {!reqs.length && <div className="task-tag-list-empty">—</div>}
        {reqs.map((tag, index) => (
          <TagRow key={index} taskId={task.id} tagStr={tag} index={index} field="requirements" />
        ))}
      </div>
      <button className="tag-add" onClick={e => { e.stopPropagation(); handleAdd(); }}>+ REQ</button>
    </div>
  );
}
