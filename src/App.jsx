import { useEffect } from 'react';
import { useUI } from './state/UIContext.jsx';
import { useGame } from './state/GameContext.jsx';
import { usePalette } from './hooks/usePalette.js';
import { usePlayClock } from './hooks/usePlayClock.js';
import TopBar from './components/TopBar/TopBar.jsx';
import PageTitle from './components/TopBar/PageTitle.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
import TagBuilderModal from './components/Modals/TagBuilderModal.jsx';
import ConfigModal from './components/Modals/ConfigModal.jsx';
import PortraitsModal from './components/Modals/PortraitsModal.jsx';
import ItemIconsModal from './components/Modals/ItemIconsModal.jsx';


export default function App() {
  const { tagBuilderProps, closeTagBuilder, showConfig, portraitsProps, itemIconsProps, setSelectedTaskId, setSelectedItemId } = useUI();
  const { start, stop, advance } = usePlayClock();

  usePalette();

  // Deselect the focused task / item when the user clicks outside the relevant cards.
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.task-card') && !e.target.closest('.agent-card')) {
        setSelectedTaskId(null);
      }
      if (!e.target.closest('.item-row') && !e.target.closest('.bank-panel')) {
        setSelectedItemId(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [setSelectedTaskId, setSelectedItemId]);

  return (
    <>
      <PageTitle />
      <TopBar onPlay={start} onStop={stop} onAdvance={advance} />
      <Dashboard />

      {tagBuilderProps && (
        <TagBuilderModal
          context={tagBuilderProps.context}
          onSave={tagBuilderProps.onSave}
          onClose={closeTagBuilder}
        />
      )}
      {showConfig       && <ConfigModal onRestartPlay={() => { stop(); start(); }} />}
      {portraitsProps   && <PortraitsModal />}
      {itemIconsProps   && <ItemIconsModal />}
    </>
  );
}
