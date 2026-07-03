import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { isAttributeActive, isActivityActive, tryAssignTask, validateAssignment, getPersonalItems, getBoundItems, hasSlotSchema, getEffectiveAttributes } from '../../logic/agents.js';
import { computeDynamicAttributes } from '../../logic/dynamicAttributes.js';
import { parseTag } from '../../logic/tags.js';
import { getConsumedTagPaths, isTagConsumed } from '../../logic/tagUI.js';
import { useCharBudget } from '../../hooks/useCharBudget.js';
import { useTagUIConfig } from '../../hooks/useTagUIConfig.js';
import { CardMedallion, StatBox, StatBar, StatField, StatValue } from './AgentCardElements.jsx';
import EditableSpan from '../EditableSpan.jsx';
import TagLabel from '../TagLabel.jsx';
import TruncatedText from '../TruncatedText.jsx';
import { flashAgentCard } from '../../logic/dom.js';

// Task activity chips show the resolved task name (plain text); every other
// tag renders through TagLabel's chip variant. Both truncate to the card's
// measured budget with the full string in a tooltip.
function TagChip({ tagStr, active, maxChars, onRemove }) {
  const parsed = parseTag(tagStr);
  const { state } = useGame();
  const task = parsed.segments[0] === 'task'
    ? state.tasks.find(task => task.id === parsed.segments[1])
    : null;
  return (
    <span className={`tag${active ? ' tag--active' : ''}`}>
      {task
        ? <TruncatedText text={task.name} maxChars={maxChars} />
        : <TagLabel tag={tagStr} maxChars={maxChars} />}
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
  const { selectedTaskId, selectedItemId, setSelectedItemId, openTagRegistry, openPortraits,
          isExpanded, toggleExpanded } = useUI();

  const [giveQtyOpen, setGiveQtyOpen] = useState(false);
  const [giveQty, setGiveQty]       = useState(1);

  const selectedTask = selectedTaskId ? state.tasks.find(task => task.id === selectedTaskId) : null;
  const selectedItem = selectedItemId ? state.inventory.find(item => item.id === selectedItemId) : null;
  // The qty input only shows when an item is selected; clearing the selection
  // (e.g. depleting stock or clicking out) implicitly dismisses it.
  const giveQtyVisible = giveQtyOpen && selectedItem;
  // A selected item turns every card into a give-target; that mode takes priority
  // over task-assignment highlighting (you can't select a task and item at once).
  const assignClass = selectedItem
    ? ' agent-card--give-target'
    : selectedTask
      ? (validateAssignment(agent, selectedTask) ? ' agent-card--assignable' : ' agent-card--not-assignable')
      : '';

  const isCollapsed = !isExpanded('agent', agent.id);

  const handleToggle = (e) => {
    e.stopPropagation(); // must not fire task-assign or item-give
    toggleExpanded('agent', agent.id);
  };

  const personalItems   = getPersonalItems(agent.activities);
  const boundItems      = getBoundItems(agent.activities);
  const dyn = computeDynamicAttributes(agent, state.inventory);
  // Configurable elements (medallion/boxes/bars/fields/values) resolve their
  // sources against this shared context; attribute-path sources read the
  // effective (bonus-applied) tags, matching how dyn itself is computed.
  const cardConfig = useTagUIConfig('agentCard');
  const elementContext = {
    agent,
    dyn,
    attributes: getEffectiveAttributes(agent.attributes ?? [], agent.activities ?? [], state.inventory),
  };
  // Tags assigned to a configured element render there, not as chips.
  const consumedPaths = getConsumedTagPaths(cardConfig);
  // One measured budget serves every chip list on the card — they share the
  // card's width. The ref sits on the ATTRIBUTES list; collapse keeps the
  // last measurement.
  const { ref: tagListRef, maxChars } = useCharBudget('tag-chip');

  // Give `quantity` units of the selected item to this agent (clamped to stock by
  // the reducer). Used by left-click (1) and the right-click quantity input. The
  // selection persists so you can give to several agents, clearing only once the
  // stack is depleted (mirrors the sell flow in BankPanel).
  const giveSelected = (quantity) => {
    if (!selectedItem) return;
    const given = Math.min(Math.max(1, quantity), selectedItem.quantity);
    dispatch({ type: 'ITEM_PLACE', target: { type: 'agent', id: agent.id }, itemId: selectedItem.id, quantity: given });
    setGiveQtyOpen(false);
    if (given >= selectedItem.quantity) setSelectedItemId(null);
  };
  // Left-click a bag item: return it to global inventory and select it, arming the
  // existing allocation flow (agent cards become transfer targets, bank a sell
  // target, item already back in inventory). The reducer merges the returned stack
  // into the matching inventory row by name, so select that row by name lookup.
  const allocateItem = (e, name) => {
    e.stopPropagation();
    dispatch({ type: 'AGENT_RETURN_ITEM', id: agent.id, itemName: name });
    const existing = state.inventory.find(item => item.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (existing) setSelectedItemId(existing.id);
  };
  // Right-click a bag item: bind it into the agent.
  const bindItem = (e, name) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasSlotSchema(agent)) {
      // TODO: agent has a slot schema — prompt the user to choose a Slot for this
      // item before binding. Slot schemas are not implemented yet.
    } else {
      // No slot schema: bind without a slot.
      dispatch({ type: 'AGENT_BIND_ITEM', id: agent.id, itemName: name });
    }
  };
  // Right-click a bound item: unbind it back to the bag.
  const unbindItem = (e, slot, name) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'AGENT_UNBIND_ITEM', id: agent.id, slot, itemName: name });
  };

  const handleCardClick = () => {
    // Give mode (an inventory item is selected) takes priority: left-click gives 1.
    if (selectedItem) { giveSelected(1); return; }
    const result = tryAssignTask(agent, selectedTaskId, state.tasks);
    if (result === 'invalid') {
      flashAgentCard(agent.id);
    } else if (result === 'assigned') {
      dispatch({ type: 'AGENT_ADD_ACTIVITY', id: agent.id, tag: `task:${selectedTaskId}` });
    }
  };

  // In give mode, right-click opens an inline quantity input instead of the
  // browser context menu; otherwise the context menu is left untouched.
  const handleCardContextMenu = (e) => {
    if (!selectedItem) return;
    e.preventDefault();
    setGiveQty(1);
    setGiveQtyOpen(true);
  };

  const handleIconClick = (e) => {
    e.stopPropagation();
    openPortraits((url) => dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { icon: url } }));
  };

  // Activities: show only non-complete task tags
  const visibleActivities = agent.activities.filter(tag => {
    const parsed = parseTag(tag);
    if (parsed.segments[0] !== 'task') return false;
    const task = state.tasks.find(task => task.id === parsed.segments[1]);
    return task && !task.isComplete;
  });

  let foundCurrent = false;

  return (
    <div
      className={`agent-card${assignClass}`}
      data-id={agent.id}
      onClick={handleCardClick}
      onContextMenu={handleCardContextMenu}
    >
      {/*
        Elements render in a single standard order regardless of visibility:
        Name · Portrait · Fields · Boxes · Bars · Values · Description ·
        Attributes · Bag · Bound · Tasks · Copy|Delete. The hidden-when-collapsed
        elements fall into two contiguous runs around the always-visible Bars, so
        two `!isCollapsed` guards suffice. Collapsed cards therefore show just
        Name (+ Medallion) + Bars. Which value each configurable element tracks
        comes from public/config/tagUI.yml (see useTagUIConfig).
      */}

      {/* 1. Name (always visible; hosts the medallion and collapse toggle) */}
      <div className="agent-card-header">
        {cardConfig.medallion && <CardMedallion source={cardConfig.medallion} context={elementContext} />}
        <EditableSpan
          className="agent-name"
          value={agent.name}
          onCommit={v => dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { name: v || 'NEW HIRELING' } })}
        />
        <button
          className="agent-toggle"
          title={isCollapsed ? 'Expand' : 'Collapse'}
          onClick={handleToggle}
        >
          {isCollapsed ? '+' : '−'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* 2. Portrait */}
          <div
            className="agent-icon"
            title="Click to set image"
            style={agent.icon ? { backgroundImage: `url("${agent.icon}")` } : {}}
            onClick={handleIconClick}
          >
            {!agent.icon && 'NO IMAGE'}
          </div>

          {/* 3. Fields (editable values) */}
          {cardConfig.fields.map(source => (
            <StatField key={source} source={source} context={elementContext} />
          ))}

          {/* 4. Boxes (above the bars) */}
          {cardConfig.boxes.length > 0 && (
            <div className="stat-box-grid">
              {cardConfig.boxes.map((source, i) => (
                <StatBox key={`${source}-${i}`} source={source} context={elementContext} />
              ))}
            </div>
          )}
        </>
      )}

      {/* 5. Bars (always visible) */}
      {cardConfig.bars.length > 0 && (
        <div className="agent-vitals">
          {cardConfig.bars.map(([current, max], i) => (
            <StatBar
              key={`${current}-${max}-${i}`}
              current={current}
              max={max}
              context={elementContext}
              fillVariant={i % 2 === 0 ? 'primary' : 'secondary'}
            />
          ))}
        </div>
      )}

      {!isCollapsed && (
        <>
          {/* 6. Values (read-only) */}
          {cardConfig.values.length > 0 && (
            <div className="stat-value-row">
              {cardConfig.values.map((source, i) => (
                <StatValue key={`${source}-${i}`} source={source} context={elementContext} />
              ))}
            </div>
          )}

          {/* 7. Description */}
          <EditableSpan
            className="agent-desc"
            value={agent.description}
            placeholder="description"
            onCommit={v => dispatch({ type: 'AGENT_UPDATE', id: agent.id, changes: { description: v } })}
          />

          {/* 8. Attributes — tags shown by a configured element are omitted here */}
          <div className="tag-section">
            <div className="tag-label">ATTRIBUTES</div>
            <div className="tag-list" ref={tagListRef}>
              {agent.attributes
                .map((tag, index) => ({ tag, index }))
                .filter(({ tag }) => !isTagConsumed(tag, consumedPaths))
                .map(({ tag, index }) => (
                  <TagChip
                    key={index}
                    tagStr={tag}
                    active={isAttributeActive(tag, agent, state.tasks)}
                    maxChars={maxChars}
                    onRemove={() => dispatch({ type: 'AGENT_REMOVE_ATTRIBUTE', id: agent.id, index })}
                  />
                ))}
              <button className="tag-add" title="Add attribute" onClick={e => {
                e.stopPropagation();
                openTagRegistry({ target: { type: 'agent', id: agent.id } });
              }}>+</button>
            </div>
          </div>

          {/* 9. Bag — select an inventory item, then left-click the card to give 1 or right-click to give a chosen quantity. */}
          <div className="tag-section">
            <div className="tag-label">BAG</div>
            <div className="tag-list">
              {personalItems.length === 0 && !giveQtyVisible && <span className="empty-inline">—</span>}
              {personalItems.map(({ name, quantity, tag }) => (
                <span
                  key={tag}
                  className="tag tag--action"
                  title="Left-click: allocate · Right-click: bind"
                  onClick={e => allocateItem(e, name)}
                  onContextMenu={e => bindItem(e, name)}
                >
                  <TruncatedText text={name} maxChars={maxChars} />
                  {quantity > 1 && <span className="tag-value"> ×{quantity}</span>}
                </span>
              ))}
            </div>
            {giveQtyVisible && (
              <div className="tag-list" onClick={e => e.stopPropagation()}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--dim)', whiteSpace: 'nowrap' }}>ASSIGN {selectedItem.name}:</span>
                <input
                  type="number"
                  autoFocus
                  min={1}
                  max={selectedItem.quantity}
                  value={giveQty}
                  onChange={e => setGiveQty(Math.max(1, Number(e.target.value)))}
                  onKeyDown={e => { if (e.key === 'Enter') giveSelected(giveQty); if (e.key === 'Escape') { e.stopPropagation(); setGiveQtyOpen(false); } }}
                  style={{ ...INLINE_INPUT_STYLE, width: '48px' }}
                />
                <button className="ctrl" onClick={() => giveSelected(giveQty)}>ASSIGN</button>
                <button className="ctrl" onClick={e => { e.stopPropagation(); setGiveQtyOpen(false); }}>✕</button>
              </div>
            )}
          </div>

          {/* 10. Bound — right-click a chip to unbind it back to the bag. */}
          {boundItems.length > 0 && (
            <div className="tag-section">
              <div className="tag-label">BOUND</div>
              <div className="tag-list">
                {boundItems.map(({ slot, name, tag }) => (
                  <span
                    key={tag}
                    className="tag tag--active tag--action"
                    title="Right-click: unbind"
                    onContextMenu={e => unbindItem(e, slot, name)}
                  >
                    {slot && <><span className="tag-value">[{slot}]</span>&nbsp;</>}
                    <TruncatedText text={name} maxChars={maxChars} />
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 11. Tasks */}
          <div className="tag-section">
            <div className="tag-label">TASKS</div>
            <div className="tag-list">
              {visibleActivities.length === 0 && <span className="empty-inline">—</span>}
              {visibleActivities.map((tag, index) => {
                const isCurrent = !foundCurrent;
                if (isCurrent) foundCurrent = true;
                return (
                  <TagChip
                    key={index}
                    tagStr={tag}
                    active={isCurrent}
                    maxChars={maxChars}
                    onRemove={() => dispatch({ type: 'AGENT_REMOVE_ACTIVITY', id: agent.id, tag })}
                  />
                );
              })}
            </div>
          </div>

          {/* 12. Copy | Delete */}
          <div className="tag-section action-row">
            <button className="delete-btn" title="Duplicate hireling" onClick={e => { e.stopPropagation(); dispatch({ type: 'AGENT_DUPLICATE', id: agent.id }); }}>⎘ COPY</button>
            <button className="delete-btn" onClick={e => {
              e.stopPropagation();
              if (confirm(`Delete hireling "${agent.name}"?`)) dispatch({ type: 'AGENT_DELETE', id: agent.id });
            }}>× DELETE</button>
          </div>
        </>
      )}
    </div>
  );
}
