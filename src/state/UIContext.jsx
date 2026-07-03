import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { loadCardExpansion, saveCardExpansion, loadOpenLibrary, saveOpenLibrary } from './storage.js';

const UIContext = createContext(null);

/**
 * Whether each card type is expanded by default. The persisted expansion store
 * records only IDs whose state deviates from these defaults, so both
 * default-expanded (agents) and default-collapsed (tasks, items) types share one
 * mechanism. Add a card type here to extend the store.
 */
const CARD_DEFAULT_EXPANDED = { agent: true, task: false, item: false };

/**
 * Provides UI state to the component tree: modal open/close state, selection
 * state, and the playing flag — mostly ephemeral. Two slices are persisted to
 * localStorage and survive a refresh: the card expand/collapse store, and which
 * library modal is open (issue #81; other modals carry callbacks and stay
 * ephemeral).
 *
 * Tag registry modal props (`openTagRegistry(props)` — all fields optional):
 * - `target`: `{ type: 'agent'|'task'|'item', id }` board entity APPLY assigns to
 * - `mode`: `'tag'` (default) or `'condition'` (APPLY builds a condition template)
 * - `onApply`: `(tagString|template) => void` — library preset drafts take the
 *   applied value instead of a dispatch; also elevates the modal above the library
 *
 * `pendingApply` holds a tag/condition awaiting a board-entity click (selection
 * mode, hosted by App.jsx): `null | { kind: 'tag', tag } | { kind: 'condition', template }`.
 *
 * Card expansion: `isExpanded(type, id)` / `toggleExpanded(type, id)` drive every
 * card type (`'agent' | 'task' | 'item'`). State is a per-type Set of IDs toggled
 * away from `CARD_DEFAULT_EXPANDED`, persisted via `saveCardExpansion`.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function UIProvider({ children }) {
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [cardExpansion, setCardExpansion]   = useState(loadCardExpansion);
  const [playing, setPlaying]               = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [configProps, setConfigProps]       = useState(null);
  const [portraitsProps, setPortraitsProps] = useState(null);
  const [itemIconsProps, setItemIconsProps] = useState(null);
  // The open library modal is the one modal whose state survives a refresh: it
  // carries only a serializable `{ type }`, and asset loading it kicks off used
  // to read as a spurious refresh that closed it (issue #81). Rehydrate it here.
  const [libraryProps, setLibraryProps]     = useState(() => {
    const type = loadOpenLibrary();
    return type ? { type } : null;
  });
  const [tagRegistryProps, setTagRegistryProps] = useState(null);
  const [pendingApply, setPendingApply]     = useState(null);

  // Persist card expansion on every change (mirrors GameProvider's saveState effect).
  useEffect(() => {
    saveCardExpansion(cardExpansion);
  }, [cardExpansion]);

  // Persist which library modal is open so a refresh reopens it (issue #81).
  useEffect(() => {
    saveOpenLibrary(libraryProps?.type ?? null);
  }, [libraryProps]);

  /**
   * Whether a card is currently expanded, resolving its type's default against
   * the persisted deviation Set.
   *
   * @param {'agent'|'task'|'item'} type
   * @param {string} id - Entity ID
   * @returns {boolean}
   */
  const isExpanded = useCallback((type, id) => {
    const deviates = cardExpansion[type]?.has(id) ?? false;
    return CARD_DEFAULT_EXPANDED[type] ? !deviates : deviates;
  }, [cardExpansion]);

  /**
   * Toggles a card's expand/collapse state by flipping its ID's membership in the
   * type's deviation Set. Side effect: triggers persistence via the effect above.
   *
   * @param {'agent'|'task'|'item'} type
   * @param {string} id - Entity ID
   */
  const toggleExpanded = useCallback((type, id) => {
    setCardExpansion(prev => {
      const nextSet = new Set(prev[type]);
      if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
      return { ...prev, [type]: nextSet };
    });
  }, []);

  const openConfig  = useCallback(() => setConfigProps({}), []);
  const closeConfig = useCallback(() => setConfigProps(null), []);

  const openPortraits  = useCallback((onSelect) => setPortraitsProps({ onSelect }), []);
  const closePortraits = useCallback(() => setPortraitsProps(null), []);

  const openItemIcons  = useCallback((onSelect) => setItemIconsProps({ onSelect }), []);
  const closeItemIcons = useCallback(() => setItemIconsProps(null), []);

  const openLibrary  = useCallback((type) => setLibraryProps({ type }), []);
  const closeLibrary = useCallback(() => setLibraryProps(null), []);

  const openTagRegistry  = useCallback((props) => setTagRegistryProps(props ?? {}), []);
  const closeTagRegistry = useCallback(() => setTagRegistryProps(null), []);

  return (
    <UIContext.Provider value={{
      selectedTaskId, setSelectedTaskId,
      isExpanded, toggleExpanded,
      playing, setPlaying,
      selectedItemId, setSelectedItemId,
      configProps, openConfig, closeConfig,
      portraitsProps, openPortraits, closePortraits,
      itemIconsProps, openItemIcons, closeItemIcons,
      libraryProps, openLibrary, closeLibrary,
      tagRegistryProps, openTagRegistry, closeTagRegistry,
      pendingApply, setPendingApply,
    }}>
      {children}
    </UIContext.Provider>
  );
}

/**
 * Returns the full UI context value from the nearest `UIProvider`.
 *
 * @returns {UIContextValue}
 */
export function useUI() {
  return useContext(UIContext);
}
