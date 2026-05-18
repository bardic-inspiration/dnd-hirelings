import AgentList from './AgentList.jsx';
import TaskList from './TaskList.jsx';

export default function Dashboard() {
  return (
    <div id="dashboard">
      <AgentList />
      <TaskList />
    </div>
  );
}
