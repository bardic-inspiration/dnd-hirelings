import { useMemo } from 'react';
import { useConfig } from '../state/ConfigContext.jsx';
import { normalizeUIDoc, EMPTY_CARD_CONFIG } from '../logic/UI.js';

/**
 * Returns one card's UI element assignments from the live UI config document
 * (the shipped `public/config/UI.yml` merged with any Configuration Modal
 * overlay — see ConfigContext). Because the document lives in React state,
 * edits made in the modal re-render consumers immediately.
 *
 * Until the base fetch settles — and whenever the card has no entry in the
 * config — returns `EMPTY_CARD_CONFIG`, so callers can render unconditionally.
 *
 * @param {string} cardName - Card key under the config's `cards:` mapping (e.g. `'agentCard'`)
 * @returns {typeof EMPTY_CARD_CONFIG} The card's `{ medallion, boxes, bars, fields, values, slots }`
 */
export function useUIConfig(cardName) {
  const { getDoc } = useConfig();
  const doc = getDoc('ui');
  const config = useMemo(() => normalizeUIDoc(doc), [doc]);
  return config.cards[cardName] ?? EMPTY_CARD_CONFIG;
}
