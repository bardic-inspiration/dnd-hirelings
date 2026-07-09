import { useMemo } from 'react';
import { useConfig } from '../state/ConfigContext.jsx';
import { normalizeRulesConfig } from '../logic/rulesConfig.js';

/**
 * Returns the live normalized rules registry (the shipped
 * `public/config/rules.yml` merged with any Configuration Modal overlay — see
 * ConfigContext). Until the base fetch settles, returns an empty ruleset, so
 * callers can render unconditionally (markers resolve invalid until rules
 * arrive, then the reconciler fills payloads in).
 *
 * @returns {ReturnType<typeof normalizeRulesConfig>} Normalized rules config
 */
export function useRulesConfig() {
  const { getDoc } = useConfig();
  const doc = getDoc('rules');
  return useMemo(() => normalizeRulesConfig(doc), [doc]);
}
