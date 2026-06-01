import AgentList from './AgentList.jsx';
import TaskList from './TaskList.jsx';
import InventoryList from './InventoryList.jsx';

export default function Dashboard() {
  return (
    <div id="dashboard">
      <AgentList />
      <div id="right-col">
        <TaskList />
        <InventoryList />
      </div>
    </div>
  );
}
