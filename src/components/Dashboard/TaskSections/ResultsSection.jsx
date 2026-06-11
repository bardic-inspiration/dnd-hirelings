import { useGame } from '../../../state/GameContext.jsx';
import EditableSpan from '../../EditableSpan.jsx';

function updateResults(dispatch, task, changes) {
  dispatch({ type: 'TASK_UPDATE_RESULTS', id: task.id, changes });
}

function ItemRow({ item, index, dispatch, task, results }) {
  const setName = (v) => {
    const items = [...results.items];
    items[index] = { ...items[index], name: v };
    updateResults(dispatch, task, { items });
  };
  const setQty = (v) => {
    const n = parseInt(v, 10);
    const items = [...results.items];
    items[index] = { ...items[index], quantity: isNaN(n) ? 0 : n };
    updateResults(dispatch, task, { items });
  };
  const remove = () => {
    const items = results.items.filter((_, itemIndex) => itemIndex !== index);
    updateResults(dispatch, task, { items });
  };
  return (
    <div className="tag-list-item">
      <span className="tag-content">
        <strong>ITEM:</strong>{' '}
        <EditableSpan value={item.name} placeholder="item" onCommit={setName} />
        {' ×'}
        <EditableSpan value={String(item.quantity)} onCommit={setQty} />
      </span>
      <span className="x" onClick={e => { e.stopPropagation(); remove(); }}>×</span>
    </div>
  );
}

function AgentRow({ spawn, index, dispatch, task, results }) {
  const tmpl = spawn.template || {};
  const setName = (v) => {
    const agents = [...results.agents];
    agents[index] = { ...agents[index], template: { ...tmpl, name: v || 'NEW HIRELING' } };
    updateResults(dispatch, task, { agents });
  };
  const setQty = (v) => {
    const n = parseInt(v, 10);
    const agents = [...results.agents];
    agents[index] = { ...agents[index], quantity: isNaN(n) ? 0 : n };
    updateResults(dispatch, task, { agents });
  };
  const remove = () => {
    const agents = results.agents.filter((_, agentIndex) => agentIndex !== index);
    updateResults(dispatch, task, { agents });
  };
  return (
    <div className="tag-list-item">
      <span className="tag-content">
        <strong>HIRELING:</strong>{' '}
        <EditableSpan value={tmpl.name || ''} placeholder="hireling" onCommit={setName} />
        {' ×'}
        <EditableSpan value={String(spawn.quantity ?? 1)} onCommit={setQty} />
      </span>
      <span className="x" onClick={e => { e.stopPropagation(); remove(); }}>×</span>
    </div>
  );
}

export default function ResultsSection({ task }) {
  const { dispatch } = useGame();
  const results = task.results || { gold: 0, items: [], agents: [] };

  const setGold = (v) => {
    const n = parseFloat(v);
    updateResults(dispatch, task, { gold: isNaN(n) ? 0 : n });
  };
  const addItem = (e) => {
    e.stopPropagation();
    updateResults(dispatch, task, { items: [...results.items, { name: 'item', quantity: 1 }] });
  };
  const addAgent = (e) => {
    e.stopPropagation();
    updateResults(dispatch, task, {
      agents: [...results.agents, {
        template: { name: 'NEW HIRELING', icon: '', rate: 1, rateUnit: 'GP/DAY', description: '', attributes: [] },
        quantity: 1,
      }],
    });
  };

  return (
    <div className="task-section">
      <div className="tag-label">RESULTS</div>
      <div className="task-tag-list">
        <div className="tag-list-item">
          <span className="tag-content">
            <strong>GOLD</strong>{' ='}
            <EditableSpan value={String(results.gold ?? 0)} onCommit={setGold} />
          </span>
        </div>
        {results.items.map((item, index) => (
          <ItemRow key={`item-${index}`} item={item} index={index} dispatch={dispatch} task={task} results={results} />
        ))}
        {results.agents.map((spawn, index) => (
          <AgentRow key={`agent-${index}`} spawn={spawn} index={index} dispatch={dispatch} task={task} results={results} />
        ))}
      </div>
      <div className="action-row">
        <button className="tag-add" onClick={addItem}>+ ITEM</button>
        <button className="tag-add" onClick={addAgent}>+ HIRELING</button>
      </div>
    </div>
  );
}
