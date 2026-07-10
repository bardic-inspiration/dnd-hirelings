import { useEffect } from 'react';
import { useUI } from './state/UIContext.jsx';
import { useGame } from './state/GameContext.jsx';
import { usePalette } from './hooks/usePalette.js';
import { usePlayClock } from './hooks/usePlayClock.js';
import { useDynReconcile } from './hooks/useDynReconcile.js';
import TopBar from './components/TopBar/TopBar.jsx';
import PageTitle from './components/TopBar/PageTitle.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
import ConfigModal from './components/Modals/ConfigModal.jsx';
import PortraitsModal from './components/Modals/PortraitsModal.jsx';
import ItemIconsModal from './components/Modals/ItemIconsModal.jsx';
import LibraryModal from './components/Modals/LibraryModal.jsx';
import TagRegistryModal from './components/Modals/TagRegistryModal.jsx';
import ConfirmModal from './components/Modals/ConfirmModal.jsx';


export default function App() {
  const { configProps, portraitsProps, itemIconsProps, libraryProps, tagRegistryProps, confirmProps, setSelectedTaskId, setSelectedItemId, pendingApply, setPendingApply } = useUI();
  const { dispatch } = useGame();
  const { start, stop, advance, retreat, resync } = usePlayClock();

  usePalette();
  useDynReconcile();

  // Deselect the focused task / item when the user clicks outside the relevant cards.
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.task-card') && !e.target.closest('.agent-card')) {
        setSelectedTaskId(null);
      }
      // Agent cards are give-targets while an item is selected, so clicking one
      // gives without clearing the selection — letting you give to several agents
      // in a row. Selection clears only on a true clickout (or when stock runs out).
      if (!e.target.closest('.item-row') && !e.target.closest('.bank-panel') && !e.target.closest('.agent-card')) {
        setSelectedItemId(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [setSelectedTaskId, setSelectedItemId]);

  // Tag-apply selection mode: armed by the Tag Registry's APPLY when it has no
  // explicit target — the next board-entity click receives the pending tag or
  // condition. The listener runs in the CAPTURE phase so a valid hit can stop
  // propagation before the card's own onClick fires (otherwise clicking an
  // agent would also trigger task assignment). Any other click cancels without
  // stopping propagation, so normal deselection still runs. ESC also cancels.
  useEffect(() => {
    if (!pendingApply) return;
    const isCondition = pendingApply.kind === 'condition';
    document.body.classList.add('tag-apply-mode');
    if (isCondition) document.body.classList.add('tag-apply-mode--conditions');

    const onClick = (e) => {
      const selector = isCondition ? '.task-card' : '.agent-card, .task-card, .item-row';
      const card = e.target.closest(selector);
      if (card && card.dataset.id && !e.target.closest('.library-preview-card')) {
        e.stopPropagation();
        e.preventDefault();
        if (isCondition) {
          dispatch({ type: 'TASK_CONDITION_ADD', id: card.dataset.id, template: pendingApply.template });
        } else {
          const type = card.classList.contains('agent-card') ? 'agent'
            : card.classList.contains('task-card') ? 'task' : 'item';
          dispatch({ type: 'TAG_APPLY', target: { type, id: card.dataset.id }, tag: pendingApply.tag });
        }
      }
      setPendingApply(null);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setPendingApply(null); };

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('tag-apply-mode', 'tag-apply-mode--conditions');
    };
  }, [pendingApply, setPendingApply, dispatch]);

  return (
    <>
      <PageTitle />
      <TopBar onPlay={start} onStop={stop} onAdvance={advance} onStepBack={retreat} />
      <Dashboard />

      {configProps      && <ConfigModal onRestartPlay={resync} />}
      {portraitsProps   && <PortraitsModal />}
      {itemIconsProps   && <ItemIconsModal />}
      {libraryProps     && <LibraryModal />}
      {tagRegistryProps && <TagRegistryModal />}
      {confirmProps     && <ConfirmModal />}
    </>
  );
}
