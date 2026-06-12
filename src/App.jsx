import { useEffect } from 'react';
import { useUI } from './state/UIContext.jsx';
import { useGame } from './state/GameContext.jsx';
import { usePalette } from './hooks/usePalette.js';
import { usePlayClock } from './hooks/usePlayClock.js';
import TopBar from './components/TopBar/TopBar.jsx';
import PageTitle from './components/TopBar/PageTitle.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
import TagBuilderModal from './components/Modals/TagBuilderModal.jsx';
import ConditionBuilderModal from './components/Modals/ConditionBuilderModal.jsx';
import ConfigModal from './components/Modals/ConfigModal.jsx';
import PortraitsModal from './components/Modals/PortraitsModal.jsx';
import ItemIconsModal from './components/Modals/ItemIconsModal.jsx';
import LibraryModal from './components/Modals/LibraryModal.jsx';
import TagRegistryModal from './components/Modals/TagRegistryModal.jsx';


export default function App() {
  const { tagBuilderProps, closeTagBuilder, conditionBuilderProps, closeConditionBuilder, configProps, portraitsProps, itemIconsProps, libraryProps, tagRegistryProps, setSelectedTaskId, setSelectedItemId } = useUI();
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
      {conditionBuilderProps && (
        <ConditionBuilderModal
          onSave={conditionBuilderProps.onSave}
          onClose={closeConditionBuilder}
        />
      )}
      {configProps      && <ConfigModal onRestartPlay={() => { stop(); start(); }} />}
      {portraitsProps   && <PortraitsModal />}
      {itemIconsProps   && <ItemIconsModal />}
      {libraryProps     && <LibraryModal />}
      {tagRegistryProps && <TagRegistryModal />}
    </>
  );
}
