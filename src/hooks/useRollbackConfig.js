import { useMemo } from 'react';
import { useConfig } from '../state/ConfigContext.jsx';
import { useNetSession } from '../state/NetSessionContext.jsx';
import { forceTurnLogging, normalizeRollbackConfig } from '../logic/rollback.js';

/**
 * Returns the live normalized rollback configuration (the shipped
 * `public/config/rollback.yml` merged with any Configuration Modal overlay —
 * see ConfigContext). Until the base fetch settles, returns
 * `DEFAULT_ROLLBACK_CONFIG` values, so callers can render unconditionally.
 * While this client is `player`, logging reads as enabled whatever the overlay
 * says (`forceTurnLogging`, docs/spec/multiplayer.md "Mode sub-panel").
 *
 * @returns {import('../logic/rollback.js').DEFAULT_ROLLBACK_CONFIG} Normalized rollback config
 */
export function useRollbackConfig() {
  const { getDoc } = useConfig();
  const { mode } = useNetSession();
  const doc = getDoc('rollback');
  return useMemo(() => forceTurnLogging(normalizeRollbackConfig(doc), mode), [doc, mode]);
}
