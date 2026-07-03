import { useGame } from '../../../state/GameContext.jsx';
import { useUI } from '../../../state/UIContext.jsx';
import { parseTag, buildTag } from '../../../logic/tags.js';
import TagLabel from '../../TagLabel.jsx';

/**
 * One removable tag row in a task-card section (requirements / attributes).
 * Renders the tag through TagLabel's `row` variant — structural truncation
 * and full-string tooltip on by default — inside the standard
 * `.tag-list-item` / `.tag-content` chrome. Dispatches `TASK_REMOVE_TAG`.
 *
 * The tag value is click-to-edit and the tag is double-click-to-replace via
 * the registry (issue #75); both go through `TAG_APPLY`, which routes by the
 * tag's modifier and dedupe-merges into the right list.
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
  const { state, dispatch } = useGame();
  const { openTagRegistry } = useUI();
  const { segments, modifier } = parseTag(tagStr);

  const remove = () => dispatch({ type: 'TASK_REMOVE_TAG', id: taskId, field, index });
  // Rewrite the value in place (order preserved); the path is unchanged so it
  // can't collide with a sibling tag in the same field.
  const commitValue = (value) => {
    const task = state.tasks.find(candidate => candidate.id === taskId);
    const list = (task?.[field] || []).map((current, i) => i === index ? buildTag(segments, value, modifier) : current);
    dispatch({ type: 'TASK_UPDATE', id: taskId, changes: { [field]: list } });
  };

  return (
    <div className="tag-list-item">
      <span className="tag-content">
        <TagLabel
          tag={tagStr}
          maxChars={maxChars}
          variant="row"
          onValueCommit={commitValue}
          onReplace={() => openTagRegistry({ onApply: (newTag) => { remove(); dispatch({ type: 'TAG_APPLY', target: { type: 'task', id: taskId }, tag: newTag }); } })}
        />
      </span>
      <span
        className="x"
        onClick={e => { e.stopPropagation(); remove(); }}
      >×</span>
    </div>
  );
}
