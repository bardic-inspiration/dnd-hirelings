import { useGame } from '../../state/GameContext.jsx';
import { activeTaskCount } from '../../logic/agents.js';
import AgentCard from './AgentCard.jsx';

export default function AgentList() {
  const { state, dispatch } = useGame();
  const { agents, tasks } = state;

  const active = [], idle = [];
  for (const a of agents) {
    (activeTaskCount(a, tasks) > 0 ? active : idle).push(a);
  }
  active.sort((a, b) => activeTaskCount(b, tasks) - activeTaskCount(a, tasks) || (b.lastAssigned ?? b.createdAt) - (a.lastAssigned ?? a.createdAt));
  idle.sort((a, b) => (b.lastAssigned ?? b.createdAt) - (a.lastAssigned ?? a.createdAt));

  return (
    <div className="pane" id="agents-pane">
      <div className="column">
        <div className="col-label">ACTIVE</div>
        <div className="card-grid" id="active-agents">
          {!active.length && <div className="empty">—</div>}
          {active.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      </div>
      <div className="column">
        <div className="col-label col-label-row">
          <span>IDLE</span>
        </div>
        <div className="card-grid" id="idle-agents">
          {!idle.length && <div className="empty">—</div>}
          {idle.map(a => <AgentCard key={a.id} agent={a} />)}
          <button className="add-inline" onClick={e => { e.stopPropagation(); dispatch({ type: 'AGENT_CREATE' }); }}>+ AGENT</button>
        </div>
      </div>
    </div>
  );
}
