import { useGame } from '../../../state/GameContext.jsx';
import TaskCard from './TaskCard.jsx';

export default function TaskList() {
  const { state, dispatch } = useGame();
  const sorted = [...state.tasks].sort((a, b) => (a.isComplete - b.isComplete) || (b.createdAt - a.createdAt));

  return (
    <div className="pane" id="tasks-pane">
      <div className="col-label">TASKS</div>
      <div id="task-list">
        {!state.tasks.length && <div className="empty">—</div>}
        {sorted.map(task => <TaskCard key={task.id} task={task} />)}
        <button className="add-inline" onClick={e => { e.stopPropagation(); dispatch({ type: 'TASK_CREATE' }); }}>+ TASK</button>
      </div>
    </div>
  );
}
