import { useGame } from '../../../state/GameContext.jsx';
import { parseTag, getSchemaEntry } from '../../../logic/tags.js';
import { getWorkReqs } from '../../../logic/tasks.js';

function WorkRow({ label, taskId, workKey, target, progress, onRemove }) {
  const done = progress >= target;
  const pct  = target > 0 ? Math.min(100, (progress / target) * 100) : 0;
  return (
    <div className={`work-item${done ? ' done' : ''}`}>
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
        >{Math.floor(progress)} / {target}</span>
        {onRemove && <span className="x" onClick={e => { e.stopPropagation(); onRemove(); }}>×</span>}
      </div>
    </div>
  );
}

export default function ProgressSection({ task }) {
  const { dispatch } = useGame();
  const progMap = task.workProgress ?? {};
  const workEntries = [];
  task.requirements.forEach((tagStr, idx) => {
    const p = parseTag(tagStr);
    if (p.type === 'work' && !p.isReq) workEntries.push({ p, idx });
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
            progress={progMap[''] ?? 0}
            onRemove={null}
          />
        ) : workEntries.map(({ p, idx }) => {
          const entry = getSchemaEntry(p);
          const rawLabel = entry ? entry.label : 'Work';
          const label = p.name
            ? `${rawLabel.toUpperCase()}: ${p.name.toUpperCase()}`
            : rawLabel.toUpperCase();
          return (
            <WorkRow
              key={idx}
              label={label}
              taskId={task.id}
              workKey={p.name ?? ''}
              target={p.value ?? 1}
              progress={progMap[p.name || ''] ?? 0}
              onRemove={() => dispatch({ type: 'TASK_REMOVE_REQUIREMENT', id: task.id, index: idx })}
            />
          );
        })}
      </div>
    </div>
  );
}
