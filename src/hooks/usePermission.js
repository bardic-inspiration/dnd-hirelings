import { useCallback } from 'react';
import { useGame } from '../state/GameContext.jsx';
import { isActionAllowed } from '../logic/permissions.js';

/**
 * Returns a predicate `can(action)` that reports whether this client's current
 * permission mode may dispatch `action` (see logic/permissions.js). The same
 * predicate the dispatch gate uses as its backstop, so an affordance hidden here
 * and a dispatch dropped there can never disagree. Offline the mode is `'gm'`,
 * so every affordance shows — today's app, unchanged.
 *
 * @returns {(action: { type: string, payload?: object }) => boolean}
 */
export function usePermission() {
  const { mode } = useGame();
  return useCallback((action) => isActionAllowed(mode, action), [mode]);
}
