import { useEffect } from 'react';
import { useUI } from './state/UIContext.jsx';
import { useGame } from './state/GameContext.jsx';
import { usePalette } from './hooks/usePalette.js';
import { usePlayClock } from './hooks/usePlayClock.js';
import TopBar from './components/TopBar/TopBar.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
import TagBuilderModal from './components/Modals/TagBuilderModal.jsx';
import InventoryPanel from './components/Modals/InventoryPanel.jsx';
import ConfigPanel from './components/Modals/ConfigPanel.jsx';
import PortraitsPanel from './components/Modals/PortraitsPanel.jsx';

export default function App() {
  const { tagBuilderProps, closeTagBuilder, showInventory, showConfig, portraitsProps, setSelectedTaskId } = useUI();
  const { start, stop, advance } = usePlayClock();

  usePalette();

  // Click outside cards clears task selection
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.task-card') && !e.target.closest('.agent-card')) {
        setSelectedTaskId(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [setSelectedTaskId]);

  return (
    <>
      <div id="page-title">GUILD MANAGER</div>
      <TopBar onPlay={start} onStop={stop} onAdvance={advance} />
      <Dashboard />

      {tagBuilderProps && (
        <TagBuilderModal
          context={tagBuilderProps.context}
          onSave={tagBuilderProps.onSave}
          onClose={closeTagBuilder}
        />
      )}
      {showInventory    && <InventoryPanel />}
      {showConfig       && <ConfigPanel onRestartPlay={() => { stop(); start(); }} />}
      {portraitsProps   && <PortraitsPanel />}
    </>
  );
}
