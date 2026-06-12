import { createContext, useContext, useState, useCallback } from 'react';

const UIContext = createContext(null);

/**
 * Provides ephemeral UI state to the component tree: modal open/close state,
 * selection state, and playing flag. Nothing here is persisted.
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
 * @param {{ children: React.ReactNode }} props
 */
export function UIProvider({ children }) {
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [expandedTasks, setExpandedTasks]   = useState(new Set());
  const [playing, setPlaying]               = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [configProps, setConfigProps]       = useState(null);
  const [portraitsProps, setPortraitsProps] = useState(null);
  const [itemIconsProps, setItemIconsProps] = useState(null);
  const [libraryProps, setLibraryProps]     = useState(null);
  const [tagRegistryProps, setTagRegistryProps] = useState(null);
  const [pendingApply, setPendingApply]     = useState(null);

  const toggleExpanded = useCallback((id) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
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
      expandedTasks, toggleExpanded,
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
