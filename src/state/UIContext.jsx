import { createContext, useContext, useState, useCallback } from 'react';

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [expandedTasks, setExpandedTasks]   = useState(new Set());
  const [playing, setPlaying]               = useState(false);
  const [tagBuilderProps, setTagBuilderProps] = useState(null);
  const [showInventory, setShowInventory]   = useState(false);
  const [showConfig, setShowConfig]         = useState(false);

  const toggleExpanded = useCallback((id) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const openTagBuilder  = useCallback((props) => setTagBuilderProps(props), []);
  const closeTagBuilder = useCallback(() => setTagBuilderProps(null), []);

  return (
    <UIContext.Provider value={{
      selectedTaskId, setSelectedTaskId,
      expandedTasks, toggleExpanded,
      playing, setPlaying,
      tagBuilderProps, openTagBuilder, closeTagBuilder,
      showInventory, setShowInventory,
      showConfig, setShowConfig,
    }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  return useContext(UIContext);
}
