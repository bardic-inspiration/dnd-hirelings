import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import yaml from 'js-yaml';
import { CONFIG_FILES } from '../logic/configRegistry.js';
import { loadConfigOverlays, saveConfigOverlays } from './storage.js';

const ConfigContext = createContext(null);

// Module-level single-flight fetch per URL (mirrors useUIConfig's old cache):
// StrictMode double-mounts and remounts share one fetch + parse per file.
const basePromises = new Map();

// Fetches and parses one runtime config file, degrading a missing or
// unparseable file to an empty document (console.warn, never throws) — the
// lenient runtime-input contract from docs/gotchas.md.
function fetchBaseDoc(url) {
  if (!basePromises.has(url)) {
    basePromises.set(url, fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then(text => yaml.load(text))
      .then(doc => (doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}))
      .catch(error => {
        console.warn(`config unavailable (${url}):`, error);
        return {};
      }));
  }
  return basePromises.get(url);
}

/**
 * Provides runtime config documents to the component tree. For every
 * `kind: 'file'` entry in the CONFIG_FILES manifest, holds the fetched base
 * document plus an optional user-edit overlay (a whole-document replacement,
 * persisted to localStorage under `CONFIG_OVERLAYS`) — the merged view is what
 * consumers render, so Configuration Modal edits live-apply everywhere.
 * State-bound (`kind: 'state'`) manifest entries never pass through here; the
 * game reducer is their storage.
 *
 * Context value:
 * - `getDoc(id)` → the raw document (`overlay ?? base ?? {}`)
 * - `updateDoc(id, nextDoc)` → replaces the overlay (side effect: persists)
 * - `resetAllDocs()` → drops every overlay, reverting to the shipped files
 *   (the modal's registry-wide RESET)
 * - `isOverridden(id)` → whether an overlay currently shadows the base
 *
 * @param {{ children: React.ReactNode }} props
 */
export function ConfigProvider({ children }) {
  const [bases, setBases] = useState({});
  const [overlays, setOverlays] = useState(loadConfigOverlays);

  useEffect(() => {
    let live = true;
    for (const entry of CONFIG_FILES) {
      if (entry.kind !== 'file') continue;
      fetchBaseDoc(entry.url).then(doc => {
        if (live) setBases(prev => (prev[entry.id] ? prev : { ...prev, [entry.id]: doc }));
      });
    }
    return () => { live = false; };
  }, []);

  // Persist overlays on every change (mirrors GameProvider's saveState effect).
  useEffect(() => {
    saveConfigOverlays(overlays);
  }, [overlays]);

  const getDoc = useCallback((id) => overlays[id] ?? bases[id] ?? {}, [overlays, bases]);
  const updateDoc = useCallback((id, nextDoc) => {
    setOverlays(prev => ({ ...prev, [id]: nextDoc }));
  }, []);
  const resetAllDocs = useCallback(() => {
    setOverlays(prev => (Object.keys(prev).length ? {} : prev));
  }, []);
  const isOverridden = useCallback((id) => id in overlays, [overlays]);

  const value = useMemo(
    () => ({ getDoc, updateDoc, resetAllDocs, isOverridden }),
    [getDoc, updateDoc, resetAllDocs, isOverridden],
  );
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

/**
 * Returns the config context value from the nearest `ConfigProvider`.
 *
 * @returns {{ getDoc: (id: string) => object, updateDoc: (id: string, nextDoc: object) => void,
 *   resetAllDocs: () => void, isOverridden: (id: string) => boolean }}
 */
export function useConfig() {
  return useContext(ConfigContext);
}
