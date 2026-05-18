import { useGame } from '../../../state/GameContext.jsx';
import { parseTag, formatTagLabel } from '../../../logic/tags.js';

export default function TagRow({ taskId, tagStr, index }) {
  const { dispatch } = useGame();
  const { label, params } = formatTagLabel(parseTag(tagStr));
  return (
    <div className="tag-list-item">
      <span className="tag-content">
        <strong>{label}</strong>{params}
      </span>
      <span
        className="x"
        onClick={e => {
          e.stopPropagation();
          dispatch({ type: 'TASK_REMOVE_REQUIREMENT', id: taskId, index });
        }}
      >×</span>
    </div>
  );
}
