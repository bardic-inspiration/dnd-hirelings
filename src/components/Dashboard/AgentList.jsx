import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { activeTaskCount } from '../../logic/agents.js';
import AgentCard from './AgentCard.jsx';

export default function AgentList() {
  const { state, dispatch } = useGame();
  const { openLibrary, isExpanded } = useUI();
  const { agents, tasks } = state;

  const active = [], idle = [];
  for (const a of agents) {
    (activeTaskCount(a, tasks) > 0 ? active : idle).push(a);
  }
  active.sort((a, b) => activeTaskCount(b, tasks) - activeTaskCount(a, tasks) || (b.lastAssigned ?? b.createdAt) - (a.lastAssigned ?? a.createdAt));
  idle.sort((a, b) => (b.lastAssigned ?? b.createdAt) - (a.lastAssigned ?? a.createdAt));

  const activeExpanded  = active.filter(a =>  isExpanded('agent', a.id));
  const activeCollapsed = active.filter(a => !isExpanded('agent', a.id));
  const idleExpanded    = idle.filter(a =>  isExpanded('agent', a.id));
  const idleCollapsed   = idle.filter(a => !isExpanded('agent', a.id));

  return (
    <div className="pane" id="agents-pane">
      <div className="column">
        <div className="col-label">ACTIVE</div>
        <div className="card-grid" id="active-agents">
          {!active.length && <div className="empty">—</div>}
          {activeExpanded.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
        {activeCollapsed.length > 0 && (
          <div className="card-grid card-grid--collapsed">
            {activeCollapsed.map(a => <AgentCard key={a.id} agent={a} />)}
          </div>
        )}
      </div>
      <div className="column">
        <div className="col-label col-label-row">
          <span>IDLE</span>
        </div>
        <div className="card-grid" id="idle-agents">
          {!idle.length && <div className="empty">—</div>}
          {idleExpanded.map(a => <AgentCard key={a.id} agent={a} />)}
          <button
            className="add-card add-agent"
            onClick={e => { e.stopPropagation(); openLibrary('agent'); }}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'AGENT_CREATE' }); }}
            title="Click for the library. Right click to add."
          >+ AGENT</button>
        </div>
        {idleCollapsed.length > 0 && (
          <div className="card-grid card-grid--collapsed">
            {idleCollapsed.map(a => <AgentCard key={a.id} agent={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
