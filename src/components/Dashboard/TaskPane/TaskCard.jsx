import { useGame } from '../../../state/GameContext.jsx';
import { useUI } from '../../../state/UIContext.jsx';
import { agentsAssignedTo } from '../../../logic/agents.js';
import { getWorkReqs, applyTaskComplete } from '../../../logic/tasks.js';
import { parseTag, getSchemaEntry } from '../../../logic/tags.js';
import EditableSpan from '../../EditableSpan.jsx';
import ProgressSection from './ProgressSection.jsx';
import RequirementsSection from './RequirementsSection.jsx';
import ResultsSection from './ResultsSection.jsx';

function TaskProgressBar({ task }) {
  const reqs = getWorkReqs(task);
  const totalRequired = reqs.reduce((s, e) => s + e.value, 0);
  const totalProgress = task.isComplete
    ? totalRequired
    : reqs.reduce((s, e) => s + (task.workProgress?.[e.name || ''] ?? 0), 0);
  const pct = totalRequired > 0 ? Math.min(100, (totalProgress / totalRequired) * 100) : 0;
  return (
    <div className="task-progress">
      <div
        className="task-progress-fill"
        data-task-id={task.id}
        style={{ width: `${pct.toFixed(1)}%` }}
      />
    </div>
  );
}

function AttributesSection({ task }) {
  const { dispatch } = useGame();
  const { openTagBuilder } = useUI();
  const attrs = task.requirements
    .map((tag, i) => ({ tag, i }))
    .filter(({ tag }) => {
      const p = parseTag(tag);
      return !p.isReq && p.type !== 'work' && p.type !== 'reward';
    });

  const handleAdd = () => openTagBuilder({
    context: 'task',
    onSave: (tag) => dispatch({ type: 'TASK_ADD_REQUIREMENT', id: task.id, tag }),
  });

  return (
    <div className="task-section">
      <div className="tag-label">ATTRIBUTES</div>
      <div className="task-tag-list">
        {!attrs.length && <div className="empty-state">—</div>}
        {attrs.map(({ tag, i }) => {
          const p = parseTag(tag);
          const entry = getSchemaEntry(p);
          const typeLabel = entry ? entry.label.toUpperCase() : p.type.toUpperCase();
          const showName  = p.name && !entry?.nameFixed;
          const label     = showName ? `${typeLabel}: ${p.name.toUpperCase()}` : typeLabel;
          const params    = p.value !== null ? ` =${p.value}` : '';
          return (
            <div key={i} className="tag-list-item">
              <span className="tag-content"><strong>{label}</strong>{params}</span>
              <span className="x" onClick={e => { e.stopPropagation(); dispatch({ type: 'TASK_REMOVE_REQUIREMENT', id: task.id, index: i }); }}>×</span>
            </div>
          );
        })}
      </div>
      <button className="tag-add" onClick={e => { e.stopPropagation(); handleAdd(); }}>+ TAG</button>
    </div>
  );
}

export default function TaskCard({ task }) {
  const { state, dispatch } = useGame();
  const { selectedTaskId, setSelectedTaskId, expandedTasks, toggleExpanded } = useUI();

  const selected = selectedTaskId === task.id;
  const expanded = expandedTasks.has(task.id);
  const assigned = agentsAssignedTo(task.id, state.agents);

  const handleCardClick = () => {
    setSelectedTaskId(selected ? null : task.id);
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    toggleExpanded(task.id);
  };

  const handleComplete = (e) => {
    e.stopPropagation();
    dispatch({ type: 'TASK_SET_COMPLETE', id: task.id, isComplete: !task.isComplete });
  };

  return (
    <div
      className={`task-card${selected ? ' selected' : ''}${task.isComplete ? ' complete' : ''}${expanded ? ' expanded' : ''}`}
      data-id={task.id}
      onClick={handleCardClick}
    >
      <div className="task-header">
        <EditableSpan
          className="task-name"
          value={task.name}
          onCommit={v => dispatch({ type: 'TASK_UPDATE', id: task.id, changes: { name: v || 'NEW TASK' } })}
        />
        <span className="task-toggle" title="Expand / collapse" onClick={handleToggle}>
          {expanded ? '−' : '+'}
        </span>
      </div>

      <TaskProgressBar task={task} />

      <div className="task-body">
        <div className="tag-label">DESCRIPTION</div>
        <EditableSpan
          className="task-desc"
          value={task.description}
          onCommit={v => dispatch({ type: 'TASK_UPDATE', id: task.id, changes: { description: v } })}
        />
        <ProgressSection task={task} />
        <RequirementsSection task={task} />
        <ResultsSection task={task} />
        <AttributesSection task={task} />

        {assigned.length > 0 && (
          <div className="assigned-list">
            ASSIGNED: {assigned.map((a, i) => (
              <span key={a.id}>{i > 0 ? ' ' : ''}<strong>{a.name}</strong></span>
            ))}
          </div>
        )}

        <div className="task-status-row action-row">
          <span className="tag-label">STATUS:</span>
          <button
            className="tag-add"
            title={task.isComplete ? 'Mark incomplete' : 'Mark complete'}
            onClick={handleComplete}
          >{task.isComplete ? '↻' : '✓'}</button>
          <span>{task.isComplete ? 'COMPLETE' : 'INCOMPLETE'}</span>
          <button className="delete-btn" onClick={e => { e.stopPropagation(); dispatch({ type: 'TASK_DUPLICATE', id: task.id }); }}>⎘ COPY</button>
          <button className="delete-btn" onClick={e => {
            e.stopPropagation();
            if (confirm(`Delete task "${task.name}"?`)) dispatch({ type: 'TASK_DELETE', id: task.id });
          }}>× DELETE</button>
        </div>
      </div>
    </div>
  );
}
