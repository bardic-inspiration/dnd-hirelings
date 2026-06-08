import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { isAttributeActive, isActivityActive, tryAssignTask, validateAssignment, getPersonalItems, getEquippedItems } from '../../logic/agents.js';
import { computeDynamicAttributes } from '../../logic/dynamicAttributes.js';
import { parseTag } from '../../logic/tags.js';
import EditableSpan from '../EditableSpan.jsx';

function flashAgentCard(agentId) {
  const card = document.querySelector(`.agent-card[data-id="${agentId}"]`);
  if (!card) return;
  card.classList.remove('flash-error');
  void card.offsetWidth;
  card.classList.add('flash-error');
  card.addEventListener('animationend', () => card.classList.remove('flash-error'), { once: true });
}

function TagChip({ tagStr, active, onRemove }) {
  const p = parseTag(tagStr);
  const { state } = useGame();
  let label;
  if (p.segments[0] === 'task') {
    const task = state.tasks.find(t => t.id === p.segments[1]);
    label = task ? `${task.name}` : p.segments.join(':');
  } else {
    label = p.segments.join(':');
  }
  return (
    <span className={`tag${active ? ' active' : ''}`}>
      {label}
      {p.value !== null && p.segments[0] !== 'task' && <span className="tag-value">={p.value}</span>}
      <span className="x" title="Remove" onClick={e => { e.stopPropagation(); onRemove(); }}>×</span>
    </span>
  );
}

const INLINE_INPUT_STYLE = {
  background: 'var(--dimmer)',
  border: 'var(--line) solid var(--border)',
  borderRadius: 'var(--radius-xs)',
  color: 'var(--fg)',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-xs)',
  padding: '2px 6px',
  outline: 'none',
};

export default function AgentCard({ agent }) {
  const { state, dispatch } = useGame();
  const { selectedTaskId, openTagBuilder, openPortraits } = useUI();

  const [giveOpen, setGiveOpen]     = useState(false);
  const [giveItemName, setGiveItemName] = useState('');
  const [giveQty, setGiveQty]       = useState(1);
  const [equipTarget, setEquipTarget] = useState(null);
  const [equipSlot, setEquipSlot]   = useState('');

  const selectedTask = selectedTaskId ? state.tasks.find(t => t.id === selectedTaskId) : null;
  const assignClass = selectedTask
    ? (validateAssignment(agent, selectedTask) ? ' assignable' : ' not-assignable')
    : '';

  const personalItems   = getPersonalItems(agent.activities);
  const equippedItems   = getEquippedItems(agent.activities);
  const availableInventory = state.inventory.filter(i => i.qty > 0);
  const dyn = computeDynamicAttributes(agent, state.inventory);

  const openGive = (e) => {
    e.stopPropagation();
    setGiveItemName(availableInventory[0]?.name ?? '');
    setGiveQty(1);
    setGiveOpen(true);
  };
  const handleGive = (e) => {
    e.stopPropagation();
    if (!giveItemName || giveQty < 1) return;
    dispatch({ type: 'AGENT_GIVE_ITEM', id: agent.id, itemName: giveItemName, qty: giveQty });
    setGiveOpen(false);
  };
  const openEquip = (e, name) => {
    e.stopPropagation();
    setEquipTarget(name);
    setEquipSlot('');
  };
  const handleEquip = (e) => {
    e.stopPropagation();
    if (!equipSlot.trim()) return;
    dispatch({ type: 'EQUIP_ITEM', id: agent.id, itemName: equipTarget, slot: equipSlot.trim().toLowerCase() });
    setEquipTarget(null);
  };

  const handleCardClick = () => {
    const result = tryAssignTask(agent, selectedTaskId, state.tasks);
    if (result === 'invalid') {
      flashAgentCard(agent.id);
    } else if (result === 'assigned') {
      dispatch({ type: 'AGENT_ADD_ACTIVITY', id: agent.id, tag: `task:${selectedTaskId}` });
    }
  };

  const handleIconClick = (e) => {
    e.stopPropagation();
    openPortraits((url) => dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { icon: url } }));
  };

  // Activities: show only non-complete task tags
  const visibleActivities = agent.activities.filter(tag => {
    const p = parseTag(tag);
    if (p.segments[0] !== 'task') return false;
    const task = state.tasks.find(t => t.id === p.segments[1]);
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
      </div>

      <div className="agent-vitals">
        <div className="vital-bar">
          <div className="vital-bar-fill vital-bar-fill--hp" style={{ width: `${Math.min(1, dyn.hp / dyn.hp_max) * 100}%` }} />
          <EditableSpan
            className="vital-bar-label"
            value={String(dyn.hp)}
            onCommit={v => {
              const n = parseInt(v, 10);
              dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { hp: isNaN(n) ? null : Math.max(0, n) } });
            }}
          />
          <span className="vital-bar-max">/ {dyn.hp_max}</span>
        </div>
        <div className="vital-bar">
          <div className="vital-bar-fill vital-bar-fill--xp" style={{ width: `${dyn.xpProgress * 100}%` }} />
          <EditableSpan
            className="vital-bar-label"
            value={String(dyn.xp)}
            onCommit={v => {
              const n = parseInt(v, 10);
              dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { xp: isNaN(n) ? 0 : Math.max(0, n) } });
            }}
          />
          <span className="vital-bar-max">LVL {dyn.level}</span>
        </div>
        <div className="vital-stats-row">
          <span>AC: {dyn.ac}</span>
          <span>PB: +{dyn.proficiency}</span>
        </div>
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

      {/* Bag */}
      <div className="tag-section">
        <div className="tag-label">BAG</div>
        <div className="tag-list">
          {personalItems.length === 0 && !giveOpen && <span className="empty-inline">—</span>}
          {personalItems.map(({ name, qty, tag }) => (
            <span key={tag} className="tag">
              {name}
              {qty > 1 && <span className="tag-value"> ×{qty}</span>}
              <span className="x" title="Equip" onClick={e => openEquip(e, name)}>⚔</span>
              <span className="x" title="Return to inventory" onClick={e => { e.stopPropagation(); dispatch({ type: 'AGENT_RETURN_ITEM', id: agent.id, itemName: name }); }}>↩</span>
            </span>
          ))}
          {!giveOpen && availableInventory.length > 0 && (
            <button className="tag-add" onClick={openGive}>+GIVE</button>
          )}
        </div>
        {giveOpen && (
          <div className="tag-list" onClick={e => e.stopPropagation()}>
            <select value={giveItemName} onChange={e => setGiveItemName(e.target.value)} style={INLINE_INPUT_STYLE}>
              {availableInventory.map(i => <option key={i.id} value={i.name}>{i.name} ({i.qty})</option>)}
            </select>
            <input type="number" min={1} max={availableInventory.find(i => i.name === giveItemName)?.qty ?? 1} value={giveQty} onChange={e => setGiveQty(Math.max(1, Number(e.target.value)))} style={{ ...INLINE_INPUT_STYLE, width: '48px' }} />
            <button className="ctrl" onClick={handleGive}>GIVE</button>
            <button className="ctrl" onClick={e => { e.stopPropagation(); setGiveOpen(false); }}>✕</button>
          </div>
        )}
        {equipTarget && (
          <div className="tag-list" onClick={e => e.stopPropagation()}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--dim)', whiteSpace: 'nowrap' }}>EQUIP {equipTarget}:</span>
            <input placeholder="slot" value={equipSlot} onChange={e => setEquipSlot(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleEquip(e); if (e.key === 'Escape') { e.stopPropagation(); setEquipTarget(null); } }} style={{ ...INLINE_INPUT_STYLE, width: '80px' }} />
            <button className="ctrl" onClick={handleEquip}>OK</button>
            <button className="ctrl" onClick={e => { e.stopPropagation(); setEquipTarget(null); }}>✕</button>
          </div>
        )}
      </div>

      {/* Equipped */}
      {equippedItems.length > 0 && (
        <div className="tag-section">
          <div className="tag-label">EQUIPPED</div>
          <div className="tag-list">
            {equippedItems.map(({ slot, name, tag }) => (
              <span key={tag} className="tag active">
                <span className="tag-value">[{slot}]</span>&nbsp;{name}
                <span className="x" title="Unequip" onClick={e => { e.stopPropagation(); dispatch({ type: 'UNEQUIP_ITEM', id: agent.id, slot, itemName: name }); }}>↩</span>
              </span>
            ))}
          </div>
        </div>
      )}

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
