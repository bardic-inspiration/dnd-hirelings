import { useRef } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { isAttributeActive, isActivityActive, tryAssignTask, validateAssignment } from '../../logic/agents.js';
import { parseTag } from '../../logic/tags.js';
import { flashAgentCard } from '../../utils.js';
import EditableSpan from '../EditableSpan.jsx';

function TagChip({ tagStr, active, onRemove }) {
  const p = parseTag(tagStr);
  const { state } = useGame();
  let label;
  if (p.type === 'task') {
    const task = state.tasks.find(t => t.id === p.name);
    label = task ? `#${task.name}` : `#${p.type}:${p.name}`;
  } else if (p.name === null) {
    label = `#${p.type}`;
  } else {
    label = `#${p.type}:${p.name}`;
  }
  return (
    <span className={`tag${active ? ' active' : ''}`}>
      {label}
      {p.value !== null && p.type !== 'task' && <span className="tag-value">={p.value}</span>}
      <span className="x" title="Remove" onClick={e => { e.stopPropagation(); onRemove(); }}>×</span>
    </span>
  );
}

export default function AgentCard({ agent }) {
  const { state, dispatch } = useGame();
  const { selectedTaskId, openTagBuilder } = useUI();
  const fileInputRef = useRef(null);

  const selectedTask = selectedTaskId ? state.tasks.find(t => t.id === selectedTaskId) : null;
  const assignClass = selectedTask
    ? (validateAssignment(agent, selectedTask) ? ' assignable' : ' not-assignable')
    : '';

  const handleCardClick = () => {
    const result = tryAssignTask(agent, selectedTaskId, state.tasks);
    if (result === 'invalid') {
      flashAgentCard(agent.id);
    } else if (result === 'assigned') {
      dispatch({ type: 'AGENT_ADD_ACTIVITY', id: agent.id, tag: `#task:${selectedTaskId}` });
    }
  };

  const handleIconClick = (e) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { icon: reader.result } });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Activities: show only non-complete task tags
  const visibleActivities = agent.activities.filter(tag => {
    const p = parseTag(tag);
    if (p.type !== 'task') return false;
    const task = state.tasks.find(t => t.id === p.name);
    return task && !task.isComplete;
  });

  let foundCurrent = false;

  return (
    <div
      className={`agent-card${assignClass}`}
      data-id={agent.id}
      onClick={handleCardClick}
    >
      <EditableSpan
        className="agent-name"
        value={agent.name}
        onCommit={v => dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { name: v || 'NEW HIRELING' } })}
      />

      <div
        className="agent-icon"
        title="Click to set image"
        style={agent.icon ? { backgroundImage: `url("${agent.icon}")` } : {}}
        onClick={handleIconClick}
      >
        {!agent.icon && 'NO IMAGE'}
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      <div className="agent-rate">
        <EditableSpan
          className="value"
          value={String(agent.rate)}
          onCommit={v => { const n = parseFloat(v); dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { rate: isNaN(n) ? 0 : n } }); }}
        />
        <EditableSpan
          className="unit"
          value={agent.rateUnit}
          onCommit={v => dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { rateUnit: v } })}
        />
      </div>

      <EditableSpan
        className="agent-desc"
        value={agent.description}
        placeholder="description"
        onCommit={v => dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { description: v } })}
      />

      {/* Attributes */}
      <div className="tag-section">
        <div className="tag-label">ATTRIBUTES</div>
        <div className="tag-list">
          {agent.attributes.map((tag, i) => (
            <TagChip
              key={i}
              tagStr={tag}
              active={isAttributeActive(tag, agent, state.tasks)}
              onRemove={() => dispatch({ type: 'AGENT_REMOVE_ATTRIBUTE', id: agent.id, index: i })}
            />
          ))}
          <button className="tag-add" title="Add attribute" onClick={e => {
            e.stopPropagation();
            openTagBuilder({
              context: 'attribute',
              onSave: (tag) => dispatch({ type: 'AGENT_ADD_ATTRIBUTE', id: agent.id, tag }),
            });
          }}>+</button>
        </div>
      </div>

      {/* Tasks */}
      <div className="tag-section">
        <div className="tag-label">TASKS</div>
        <div className="tag-list">
          {visibleActivities.length === 0 && <span className="empty-inline">—</span>}
          {visibleActivities.map((tag, i) => {
            const isCurrent = !foundCurrent;
            if (isCurrent) foundCurrent = true;
            return (
              <TagChip
                key={i}
                tagStr={tag}
                active={isCurrent}
                onRemove={() => dispatch({ type: 'AGENT_REMOVE_ACTIVITY', id: agent.id, tag })}
              />
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="tag-section action-row">
        <button className="delete-btn" title="Duplicate hireling" onClick={e => { e.stopPropagation(); dispatch({ type: 'AGENT_DUPLICATE', id: agent.id }); }}>⎘ COPY</button>
        <button className="delete-btn" onClick={e => {
          e.stopPropagation();
          if (confirm(`Delete hireling "${agent.name}"?`)) dispatch({ type: 'AGENT_DELETE', id: agent.id });
        }}>× DELETE</button>
      </div>
    </div>
  );
}
