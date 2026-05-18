import { useEffect } from 'react';
import { useUI } from './state/UIContext.jsx';
import { useGame } from './state/GameContext.jsx';
import { usePalette } from './hooks/usePalette.js';
import { usePlayClock } from './hooks/usePlayClock.js';
import TopBar from './components/TopBar/TopBar.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
import TagBuilderModal from './components/Modals/TagBuilderModal.jsx';
import InventoryModal from './components/Modals/InventoryModal.jsx';
import ConfigModal from './components/Modals/ConfigModal.jsx';
import PortraitsModal from './components/Modals/PortraitsModal.jsx';


export default function App() {
  const { tagBuilderProps, closeTagBuilder, showInventory, showConfig, portraitsProps, setSelectedTaskId } = useUI();
  const { start, stop, advance } = usePlayClock();

  usePalette();

  // Deselect the focused task when the user clicks outside any task or agent card.
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
      {showInventory    && <InventoryModal />}
      {showConfig       && <ConfigModal onRestartPlay={() => { stop(); start(); }} />}
      {portraitsProps   && <PortraitsModal />}
    </>
  );
}
