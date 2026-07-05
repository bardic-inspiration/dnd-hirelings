import { useMemo } from 'react';
import { useConfig } from '../state/ConfigContext.jsx';
import { normalizeRollbackConfig } from '../logic/rollback.js';

/**
 * Returns the live normalized rollback configuration (the shipped
 * `public/config/rollback.yml` merged with any Configuration Modal overlay —
 * see ConfigContext). Until the base fetch settles, returns
 * `DEFAULT_ROLLBACK_CONFIG` values, so callers can render unconditionally.
 *
 * @returns {import('../logic/rollback.js').DEFAULT_ROLLBACK_CONFIG} Normalized rollback config
 */
export function useRollbackConfig() {
  const { getDoc } = useConfig();
  const doc = getDoc('rollback');
  return useMemo(() => normalizeRollbackConfig(doc), [doc]);
}
