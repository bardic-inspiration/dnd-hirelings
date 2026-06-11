import { useGame } from '../../../state/GameContext.jsx';
import { useUI } from '../../../state/UIContext.jsx';
import { parseTag } from '../../../logic/tags.js';

function WorkRow({ label, taskId, workKey, target, progress, onRemove }) {
  const done = progress >= target;
  const pct  = target > 0 ? Math.min(100, (progress / target) * 100) : 0;
  return (
    <div className={`work-item${done ? ' work-item--done' : ''}`}>
      <span className="work-item-skill">{label}</span>
      <div className="work-item-bottom">
        <div className="work-item-bar">
          <div
            className="work-item-bar-fill"
            data-task-id={taskId}
            data-work-key={workKey}
            style={{ width: `${pct.toFixed(1)}%` }}
          />
        </div>
        <span
          className="work-item-value"
          data-task-id={taskId}
          data-work-key={workKey}
        >{Math.floor(Math.min(progress, target))} / {target}</span>
        {onRemove && <span className="x" onClick={e => { e.stopPropagation(); onRemove(); }}>×</span>}
      </div>
    </div>
  );
}

export default function ProgressSection({ task }) {
  const { dispatch } = useGame();
  const { openTagBuilder } = useUI();
  const workProgressMap = task.workProgress ?? {};
  const workEntries = (task.work || []).map((tagStr, index) => ({ parsed: parseTag(tagStr), index }));

  const handleAdd = () => openTagBuilder({
    context: 'work',
    onSave: (tag) => dispatch({ type: 'TASK_ADD_TAG', id: task.id, field: 'work', tag }),
  });

  return (
    <div className="task-section">
      <div className="tag-label">PROGRESS</div>
      <div className="work-list">
        {workEntries.length === 0 ? (
          <WorkRow
            label="GENERAL"
            taskId={task.id}
            workKey=""
            target={1}
            progress={workProgressMap[''] ?? 0}
            onRemove={null}
          />
        ) : workEntries.map(({ parsed, index }) => {
          const workKey = parsed.segments.slice(1).join(':');
          const subtypeSegs = parsed.segments.slice(1);
          const label = subtypeSegs.length >= 2
            ? `${subtypeSegs[0].toUpperCase()}: ${subtypeSegs[subtypeSegs.length - 1].toUpperCase()}`
            : subtypeSegs.length === 1
              ? subtypeSegs[0].toUpperCase()
              : parsed.segments[0].toUpperCase();
          return (
            <WorkRow
              key={index}
              label={label}
              taskId={task.id}
              workKey={workKey}
              target={parseFloat(parsed.value ?? 1)}
              progress={workProgressMap[workKey] ?? 0}
              onRemove={() => dispatch({ type: 'TASK_REMOVE_TAG', id: task.id, field: 'work', index })}
            />
          );
        })}
      </div>
      <button className="tag-add" onClick={e => { e.stopPropagation(); handleAdd(); }}>+ WORK</button>
    </div>
  );
}
