import { useGame } from '../../../state/GameContext.jsx';
import TagLabel from '../../TagLabel.jsx';

/**
 * One removable tag row in a task-card section (requirements / attributes).
 * Renders the tag through TagLabel's `row` variant — structural truncation
 * and full-string tooltip on by default — inside the standard
 * `.tag-list-item` / `.tag-content` chrome. Dispatches `TASK_REMOVE_TAG`.
 *
 * @param {object} props
 * @param {string} props.taskId - Owning task id
 * @param {string} props.tagStr - Raw tag string
 * @param {number} props.index - Position within the task's `field` array
 * @param {string} props.field - Task list the tag lives in (`'requirements'` | `'attributes'`)
 * @param {number} [props.maxChars] - Character budget from the section's `useCharBudget`
 * @returns {JSX.Element}
 */
export default function TagRow({ taskId, tagStr, index, field, maxChars }) {
  const { dispatch } = useGame();
  return (
    <div className="tag-list-item">
      <span className="tag-content">
        <TagLabel tag={tagStr} maxChars={maxChars} variant="row" />
      </span>
      <span
        className="x"
        onClick={e => {
          e.stopPropagation();
          dispatch({ type: 'TASK_REMOVE_TAG', id: taskId, field, index });
        }}
      >×</span>
    </div>
  );
}
