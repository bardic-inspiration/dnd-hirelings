import { createContext, useContext, useState, useCallback } from 'react';

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [expandedTasks, setExpandedTasks]   = useState(new Set());
  const [playing, setPlaying]               = useState(false);
  const [tagBuilderProps, setTagBuilderProps] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [showConfig, setShowConfig]         = useState(false);
  const [portraitsProps, setPortraitsProps] = useState(null);
  const [itemIconsProps, setItemIconsProps] = useState(null);
  const [libraryProps, setLibraryProps]     = useState(null);
  const [tagManagerProps, setTagManagerProps] = useState(null);

  const toggleExpanded = useCallback((id) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const openTagBuilder  = useCallback((props) => setTagBuilderProps(props), []);
  const closeTagBuilder = useCallback(() => setTagBuilderProps(null), []);

  const openPortraits  = useCallback((onSelect) => setPortraitsProps({ onSelect }), []);
  const closePortraits = useCallback(() => setPortraitsProps(null), []);

  const openItemIcons  = useCallback((onSelect) => setItemIconsProps({ onSelect }), []);
  const closeItemIcons = useCallback(() => setItemIconsProps(null), []);

  const openLibrary  = useCallback((type) => setLibraryProps({ type }), []);
  const closeLibrary = useCallback(() => setLibraryProps(null), []);

  const openTagManager  = useCallback(() => setTagManagerProps({}), []);
  const closeTagManager = useCallback(() => setTagManagerProps(null), []);

  return (
    <UIContext.Provider value={{
      selectedTaskId, setSelectedTaskId,
      expandedTasks, toggleExpanded,
      playing, setPlaying,
      tagBuilderProps, openTagBuilder, closeTagBuilder,
      selectedItemId, setSelectedItemId,
      showConfig, setShowConfig,
      portraitsProps, openPortraits, closePortraits,
      itemIconsProps, openItemIcons, closeItemIcons,
      libraryProps, openLibrary, closeLibrary,
      tagManagerProps, openTagManager, closeTagManager,
    }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  return useContext(UIContext);
}
