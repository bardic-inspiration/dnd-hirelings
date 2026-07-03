import { useEffect, useState } from 'react';
import { parseTagUIConfig, EMPTY_CARD_CONFIG } from '../logic/tagUI.js';

// Module-level single-flight fetch of the deployed config, mirroring the
// bundled-preset cache in usePresets: every card shares one fetch + parse,
// and remounts read the settled result synchronously.
const CONFIG_URL = '/config/tagUI.yml';
let configCache = null;
let configPromise = null;

function fetchTagUIConfig() {
  if (configCache) return Promise.resolve(configCache);
  if (!configPromise) {
    configPromise = fetch(CONFIG_URL)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then(text => parseTagUIConfig(text))
      .catch(error => {
        // A missing or unparseable config degrades to bare cards (no
        // configured elements) rather than breaking the dashboard.
        console.warn(`tagUI config unavailable (${CONFIG_URL}):`, error);
        return { cards: {} };
      })
      .then(config => { configCache = config; return config; });
  }
  return configPromise;
}

/**
 * Returns one card's tag UI element assignments from `public/config/tagUI.yml`.
 *
 * Fetches and parses the config once per page load (module-level cache shared
 * across all cards). Until the fetch settles — and whenever the card has no
 * entry in the config — returns `EMPTY_CARD_CONFIG`, so callers can render
 * unconditionally.
 *
 * @param {string} cardName - Card key under the config's `cards:` mapping (e.g. `'agentCard'`)
 * @returns {typeof EMPTY_CARD_CONFIG} The card's `{ medallion, boxes, bars, fields, values }`
 */
export function useTagUIConfig(cardName) {
  const [config, setConfig] = useState(configCache);

  useEffect(() => {
    if (configCache) return undefined;
    let live = true;
    fetchTagUIConfig().then(loaded => { if (live) setConfig(loaded); });
    return () => { live = false; };
  }, []);

  return config?.cards[cardName] ?? EMPTY_CARD_CONFIG;
}
