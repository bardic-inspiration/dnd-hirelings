import { createContext, useContext, useReducer, useEffect } from 'react';
import { reducer } from './reducer.js';
import { loadState, saveState } from './storage.js';

const GameContext = createContext(null);

/**
 * Provides the central game state and dispatch function to the component tree.
 * State is initialized from localStorage via `loadState` and persisted on every change.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, loadState);

  useEffect(() => {
    saveState(state);
  }, [state]);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

/**
 * Returns `{ state, dispatch }` from the nearest `GameProvider`.
 *
 * @returns {{ state: GameState, dispatch: (action: object) => void }}
 */
export function useGame() {
  return useContext(GameContext);
}
