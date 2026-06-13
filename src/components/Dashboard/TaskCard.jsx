import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { agentsAssignedTo } from '../../logic/agents.js';
import { resetConditions } from '../../logic/conditions.js';
import { parseTag, formatTagLabel } from '../../logic/tags.js';
import EditableSpan from '../EditableSpan.jsx';
import ProgressSection from './TaskSections/ProgressSection.jsx';
import RequirementsSection from './TaskSections/RequirementsSection.jsx';
import ResultsSection from './TaskSections/ResultsSection.jsx';

function TaskProgressBar({ task }) {
  const conditions = task.conditions || [];
  const totalRequired = conditions.reduce((sum, condition) => sum + condition.target, 0);
  // Each condition is capped at its own target so overshoot in one cannot
  // inflate the overall bar.
  const totalProgress = task.isComplete
    ? totalRequired
    : conditions.reduce((sum, condition) => sum + Math.min(condition.target, condition.progress), 0);
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

// Hosts the card's single `+ TAG` shortcut to the tag registry. The applied
// tag routes by its own modifier (TAG_APPLY → routeTaskTag), so a `req`-
// modified tag built here still lands in the requirements list above.
function AttributesSection({ task }) {
  const { dispatch } = useGame();
  const { openTagRegistry } = useUI();
  const attrs = task.attributes || [];

  const handleAdd = () => openTagRegistry({ target: { type: 'task', id: task.id } });

  return (
    <div className="task-section">
      <div className="tag-label">ATTRIBUTES</div>
      <div className="task-tag-list">
        {!attrs.length && <div className="task-tag-list-empty">—</div>}
        {attrs.map((tag, index) => {
          const { label, params } = formatTagLabel(parseTag(tag));
          return (
            <div key={index} className="tag-list-item">
              <span className="tag-content"><strong>{label}</strong>{params}</span>
              <span className="x" onClick={e => { e.stopPropagation(); dispatch({ type: 'TASK_REMOVE_TAG', id: task.id, field: 'attributes', index }); }}>×</span>
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
    if (task.isComplete) {
      dispatch({ type: 'TASK_UPDATE', id: task.id, changes: { isComplete: false, conditions: resetConditions(task.conditions) } });
    } else {
      dispatch({ type: 'TASK_SET_COMPLETE', id: task.id, isComplete: true });
    }
  };

  return (
    <div
      className={`task-card${selected ? ' task-card--selected' : ''}${task.isComplete ? ' task-card--complete' : ''}${expanded ? ' task-card--expanded' : ''}`}
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
            ASSIGNED: {assigned.map((agent, index) => (
              <span key={agent.id}>{index > 0 ? ' ' : ''}<strong>{agent.name}</strong></span>
            ))}
          </div>
        )}

        <div className="task-status-row action-row">
          <span className="tag-label">STATUS:</span>
          <button
            className="tag-add"
            title={task.isComplete ? 'Reset task' : 'Mark complete'}
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
