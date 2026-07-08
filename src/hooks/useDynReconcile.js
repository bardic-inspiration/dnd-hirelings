import { useEffect } from 'react';
import { useGame } from '../state/GameContext.jsx';
import { useRulesConfig } from './useRulesConfig.js';

/**
 * Keeps every dyn tag payload materialized (logic/dynamicTags.js). Dispatches
 * `DYN_RECONCILE` whenever game state or the rules registry changes — which
 * covers initial load, every game action (tag edits, bind/unbind, ticks,
 * rollback, LOADed session JSON), and Config Modal rule edits. Loop-safe: the
 * reducer returns the same state reference when no payload changed, so a
 * no-op dispatch never re-renders and the effect settles after one pass.
 *
 * Mounted once in App.jsx — the reducer itself cannot read the rules registry
 * (GameProvider wraps ConfigProvider), so this hook is the bridge.
 */
export function useDynReconcile() {
  const { state, dispatch } = useGame();
  const rules = useRulesConfig();
  useEffect(() => {
    dispatch({ type: 'DYN_RECONCILE', rules });
  }, [state, rules, dispatch]);
}
