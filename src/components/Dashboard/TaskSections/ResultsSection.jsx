import { parseTag } from '../../../logic/tags.js';
import TagRow from './TagRow.jsx';

export default function ResultsSection({ task }) {
  const rewards = task.requirements
    .map((tag, i) => ({ tag, i }))
    .filter(({ tag }) => {
      const p = parseTag(tag);
      return !p.isReq && p.type === 'reward';
    });

  return (
    <div className="task-section">
      <div className="tag-label">RESULTS</div>
      <div className="task-tag-list">
        {!rewards.length && <div className="empty-state">—</div>}
        {rewards.map(({ tag, i }) => <TagRow key={i} taskId={task.id} tagStr={tag} index={i} />)}
      </div>
    </div>
  );
}
