import { useGame } from '../../../state/GameContext.jsx';
import { useUI } from '../../../state/UIContext.jsx';
import EditableSpan from '../../EditableSpan.jsx';

/**
 * One condition row: name, interpolated progress bar, click-to-edit progress
 * and target numbers, and a remove control. The bar fill and progress number
 * carry `data-task-id` / `data-condition-id` so the RAF loop in
 * `updateClockDisplayDOM` can interpolate them between ticks.
 *
 * @param {{ taskId: string, condition: Condition,
 *           onUpdate: (changes: object) => void, onRemove: () => void }} props
 */
function ConditionRow({ taskId, condition, onUpdate, onRemove }) {
  const done = condition.progress >= condition.target;
  const pct  = condition.target > 0 ? Math.min(100, (condition.progress / condition.target) * 100) : 0;

  const commitProgress = (raw) => {
    const value = parseFloat(raw);
    if (Number.isFinite(value) && value >= 0) onUpdate({ progress: value });
  };
  const commitTarget = (raw) => {
    const value = parseFloat(raw);
    if (Number.isFinite(value) && value > 0) onUpdate({ target: value });
  };

  return (
    <div className={`condition-item${done ? ' condition-item--done' : ''}`}>
      <span className="condition-item-name" title={condition.tracker.tagPath ?? 'any agent'}>
        {condition.name}
      </span>
      <div className="condition-item-bottom">
        <div className="condition-item-bar">
          <div
            className="condition-item-bar-fill"
            data-task-id={taskId}
            data-condition-id={condition.id}
            style={{ width: `${pct.toFixed(1)}%` }}
          />
        </div>
        <span className="condition-item-value">
          <EditableSpan
            className="condition-item-progress"
            data-task-id={taskId}
            data-condition-id={condition.id}
            value={String(Math.floor(Math.min(condition.progress, condition.target)))}
            onCommit={commitProgress}
          />
          {' / '}
          <EditableSpan
            className="condition-item-target"
            value={String(condition.target)}
            onCommit={commitTarget}
          />
        </span>
        <span className="x" onClick={e => { e.stopPropagation(); onRemove(); }}>×</span>
      </div>
    </div>
  );
}

/**
 * Task-card section listing the task's conditions. A task with no conditions
 * shows the standard empty state and completes after one worked tick (the
 * implied "clock advanced" condition). `+ CONDITION` opens the condition
 * builder; saving dispatches `TASK_CONDITION_ADD`.
 *
 * @param {{ task: Task }} props
 */
export default function ProgressSection({ task }) {
  const { dispatch } = useGame();
  const { openConditionBuilder } = useUI();
  const conditions = task.conditions || [];

  const handleAdd = () => openConditionBuilder({
    onSave: (template) => dispatch({ type: 'TASK_CONDITION_ADD', id: task.id, template }),
  });

  return (
    <div className="task-section">
      <div className="tag-label">CONDITIONS</div>
      <div className="condition-list">
        {!conditions.length && (
          <div className="task-tag-list-empty" title="Completes after one worked tick">—</div>
        )}
        {conditions.map(condition => (
          <ConditionRow
            key={condition.id}
            taskId={task.id}
            condition={condition}
            onUpdate={(changes) => dispatch({ type: 'TASK_CONDITION_UPDATE', id: task.id, conditionId: condition.id, changes })}
            onRemove={() => dispatch({ type: 'TASK_CONDITION_REMOVE', id: task.id, conditionId: condition.id })}
          />
        ))}
      </div>
      <button className="tag-add" onClick={e => { e.stopPropagation(); handleAdd(); }}>+ CONDITION</button>
    </div>
  );
}
