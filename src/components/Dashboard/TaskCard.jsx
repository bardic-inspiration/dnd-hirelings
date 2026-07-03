import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { agentsAssignedTo } from '../../logic/agents.js';
import { resetConditions } from '../../logic/conditions.js';
import { useCharBudget } from '../../hooks/useCharBudget.js';
import EditableSpan from '../EditableSpan.jsx';
import Tooltip from '../Tooltip.jsx';
import ProgressSection from './TaskSections/ProgressSection.jsx';
import RequirementsSection from './TaskSections/RequirementsSection.jsx';
import ResultsSection from './TaskSections/ResultsSection.jsx';
import TagRow from './TaskSections/TagRow.jsx';

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
  const { openTagRegistry } = useUI();
  const attrs = task.attributes || [];
  const { ref, maxChars } = useCharBudget('tag-row');

  const handleAdd = () => openTagRegistry({ target: { type: 'task', id: task.id } });

  return (
    <div className="task-section">
      <div className="tag-label">ATTRIBUTES</div>
      <div className="task-tag-list" ref={ref}>
        {!attrs.length && <div className="task-tag-list-empty">—</div>}
        {attrs.map((tag, index) => (
          <TagRow key={index} taskId={task.id} tagStr={tag} index={index} field="attributes" maxChars={maxChars} />
        ))}
      </div>
      <button className="tag-add" onClick={e => { e.stopPropagation(); handleAdd(); }}>+ TAG</button>
    </div>
  );
}

export default function TaskCard({ task }) {
  const { state, dispatch } = useGame();
  const { selectedTaskId, setSelectedTaskId, isExpanded, toggleExpanded } = useUI();

  const selected = selectedTaskId === task.id;
  const expanded = isExpanded('task', task.id);
  const assigned = agentsAssignedTo(task.id, state.agents);

  const handleCardClick = () => {
    setSelectedTaskId(selected ? null : task.id);
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    toggleExpanded('task', task.id);
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
        <Tooltip content="Expand / collapse">
          <span className="task-toggle" onClick={handleToggle}>
            {expanded ? '−' : '+'}
          </span>
        </Tooltip>
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
          <Tooltip content={task.isComplete ? 'Reset task' : 'Mark complete'}>
            <button
              className="tag-add"
              onClick={handleComplete}
            >{task.isComplete ? '↻' : '✓'}</button>
          </Tooltip>
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
