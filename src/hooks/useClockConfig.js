import { useMemo } from 'react';
import { useConfig } from '../state/ConfigContext.jsx';
import { normalizeClockConfig } from '../logic/clockConfig.js';

/**
 * Returns the live normalized clock configuration (the shipped
 * `public/config/clock.yml` merged with any Configuration Modal overlay — see
 * ConfigContext). Until the base fetch settles, returns `DEFAULT_CLOCK_CONFIG`
 * values, so callers can render unconditionally.
 *
 * @returns {import('../logic/clockConfig.js').DEFAULT_CLOCK_CONFIG} Normalized clock config
 */
export function useClockConfig() {
  const { getDoc } = useConfig();
  const doc = getDoc('clock');
  return useMemo(() => normalizeClockConfig(doc), [doc]);
}
