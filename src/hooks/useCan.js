import { useCallback } from 'react';
import { useNetSession } from '../state/NetSessionContext.jsx';
import { isActionAllowed } from '../logic/permissions.js';

/**
 * Returns `can(action)`: whether this client's derived mode allows a reducer
 * action — the same predicate the dispatch gate applies
 * (docs/spec/multiplayer.md "Permissions"), so a control's pre-check and the
 * gate's backstop cannot disagree. `action` is an action object, or a bare
 * type string for actions with no payload rule (everything but
 * `SESSION_UPDATE`, whose payload keys decide). Offline the mode is `gm`, so
 * everything is allowed.
 *
 * @returns {(action: string|{ type: string }) => boolean}
 */
export function useCan() {
  const { mode } = useNetSession();
  return useCallback(
    (action) => isActionAllowed(mode, typeof action === 'string' ? { type: action } : action),
    [mode],
  );
}
