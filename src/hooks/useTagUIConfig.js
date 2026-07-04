import { useMemo } from 'react';
import { useConfig } from '../state/ConfigContext.jsx';
import { normalizeTagUIDoc, EMPTY_CARD_CONFIG } from '../logic/tagUI.js';

/**
 * Returns one card's tag UI element assignments from the live tagUI config
 * document (the shipped `public/config/tagUI.yml` merged with any Configuration
 * Modal overlay — see ConfigContext). Because the document lives in React
 * state, edits made in the modal re-render consumers immediately.
 *
 * Until the base fetch settles — and whenever the card has no entry in the
 * config — returns `EMPTY_CARD_CONFIG`, so callers can render unconditionally.
 *
 * @param {string} cardName - Card key under the config's `cards:` mapping (e.g. `'agentCard'`)
 * @returns {typeof EMPTY_CARD_CONFIG} The card's `{ medallion, boxes, bars, fields, values, slots }`
 */
export function useTagUIConfig(cardName) {
  const { getDoc } = useConfig();
  const doc = getDoc('tagUI');
  const config = useMemo(() => normalizeTagUIDoc(doc), [doc]);
  return config.cards[cardName] ?? EMPTY_CARD_CONFIG;
}
