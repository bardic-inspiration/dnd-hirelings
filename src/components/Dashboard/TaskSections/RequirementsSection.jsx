import { useGame } from '../../../state/GameContext.jsx';
import { useUI } from '../../../state/UIContext.jsx';
import TagRow from './TagRow.jsx';

export default function RequirementsSection({ task }) {
  const { dispatch } = useGame();
  const { openTagBuilder } = useUI();

  const handleAdd = () => openTagBuilder({
    context: 'requirement',
    onSave: (tag) => dispatch({ type: 'TASK_ADD_TAG', id: task.id, field: 'requirements', tag }),
  });

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
