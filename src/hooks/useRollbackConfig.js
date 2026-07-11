import { useMemo } from 'react';
import { useConfig } from '../state/ConfigContext.jsx';
import { useGame } from '../state/GameContext.jsx';
import { normalizeRollbackConfig } from '../logic/rollback.js';

/**
 * Returns the live normalized rollback configuration (the shipped
 * `public/config/rollback.yml` merged with any Configuration Modal overlay —
 * see ConfigContext). Until the base fetch settles, returns
 * `DEFAULT_ROLLBACK_CONFIG` values, so callers can render unconditionally.
 *
 * Rule lock (D-rules): while this client's mode is `'player'`, rollback logging
 * is forced on (`log.enabled` read as `true` regardless of the overlay) so the
 * turn's log slice — and therefore rollback and review honesty — cannot be
 * switched off mid-turn. Nothing is stored; nothing travels with HEAD.
 *
 * @returns {import('../logic/rollback.js').DEFAULT_ROLLBACK_CONFIG} Normalized rollback config
 */
export function useRollbackConfig() {
  const { getDoc } = useConfig();
  const { mode } = useGame();
  const doc = getDoc('rollback');
  return useMemo(() => {
    const config = normalizeRollbackConfig(doc);
    return mode === 'player'
      ? { ...config, log: { ...config.log, enabled: true } }
      : config;
  }, [doc, mode]);
}
