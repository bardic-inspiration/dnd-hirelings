import { createContext, useContext, useReducer, useEffect, useMemo, useRef } from 'react';
import { reducer } from './reducer.js';
import { loadState, normalizeState, saveState } from './storage.js';

const GameContext = createContext(null);

// Seeds the reducer: a given `initialState` (normalized like any external
// state) instead of the localStorage save.
function initGameState(initialState) {
  return initialState ? normalizeState(initialState) : loadState();
}

/**
 * Provides the central game state and dispatch function to the component tree.
 *
 * @param {{ children: React.ReactNode, initialState?: object, persist?: boolean,
 *   net?: { attach: (game: object) => void, wrapDispatch: (rawDispatch: Function) => Function } }} props
 *   - `initialState`: seed state instead of loading localStorage.
 *   - `persist` (default `true`): `false` skips saving, so a second provider
 *     never overwrites the live save.
 *   - `net`: a networked session's binding (`NetSessionProvider`). Its
 *     `wrapDispatch` gates and records the dispatch consumers get; `attach`
 *     receives `{ rawDispatch, getState }`, so the net layer's own pulls
 *     bypass the gate.
 */
export function GameProvider({ children, initialState, persist = true, net }) {
  const [state, rawDispatch] = useReducer(reducer, initialState, initGameState);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
    if (persist) saveState(state);
  }, [state, persist]);

  const dispatch = useMemo(() => (net ? net.wrapDispatch(rawDispatch) : rawDispatch), [net]);

  useEffect(() => {
    net?.attach({ rawDispatch, getState: () => stateRef.current });
  }, [net]);

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
