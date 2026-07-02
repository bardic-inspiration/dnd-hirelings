import { useCharBudget } from '../../../hooks/useCharBudget.js';
import TagRow from './TagRow.jsx';

/**
 * Read-only list of a task's requirement tags with per-row removal.
 * Requirements are added through the card's single `+ TAG` shortcut
 * (AttributesSection): a `req`/`block`-modified tag routes here on apply.
 * The list container is measured once for all rows' character budgets.
 *
 * @param {{ task: object }} props - Task whose `requirements` array is shown.
 * @returns {JSX.Element} Requirements section of the task card.
 */
export default function RequirementsSection({ task }) {
  const reqs = task.requirements || [];
  const { ref, maxChars } = useCharBudget('tag-row');

  return (
    <div className="task-section">
      <div className="tag-label">REQUIREMENTS</div>
      <div className="task-tag-list" ref={ref}>
        {!reqs.length && <div className="task-tag-list-empty">—</div>}
        {reqs.map((tag, index) => (
          <TagRow key={index} taskId={task.id} tagStr={tag} index={index} field="requirements" maxChars={maxChars} />
        ))}
      </div>
    </div>
  );
}
