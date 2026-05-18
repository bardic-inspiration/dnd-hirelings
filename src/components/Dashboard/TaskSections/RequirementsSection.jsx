import { parseTag } from '../../../logic/tags.js';
import TagRow from './TagRow.jsx';

export default function RequirementsSection({ task }) {
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
