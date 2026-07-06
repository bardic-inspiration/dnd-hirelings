import { useMemo } from 'react';
import { useConfig } from '../state/ConfigContext.jsx';
import { normalizeTagsConfig } from '../logic/tagsConfig.js';

/**
 * Returns the live normalized tag-system configuration (the shipped
 * `public/config/tags.yml` merged with any Configuration Modal overlay — see
 * ConfigContext). Until the base fetch settles, returns `DEFAULT_TAGS_CONFIG`
 * values (unlocked), so callers can render unconditionally.
 *
 * @returns {import('../logic/tagsConfig.js').DEFAULT_TAGS_CONFIG} Normalized tags config
 */
export function useTagsConfig() {
  const { getDoc } = useConfig();
  const doc = getDoc('tags');
  return useMemo(() => normalizeTagsConfig(doc), [doc]);
}
