import { useState, useEffect, useCallback, useRef } from 'react';
import { uid } from '../utils.js';

// Module-level cache of bundled (standard) presets, keyed by config.bundledUrl,
// so reopening a library doesn't refetch. Standard presets are read-only and
// tagged source:'standard'; they never persist to localStorage.
const bundledCache = new Map();

async function fetchBundled(config) {
  if (bundledCache.has(config.bundledUrl)) return bundledCache.get(config.bundledUrl);
  let list = [];
  try {
    const res = await fetch(config.bundledUrl);
    if (res.ok) {
      const raw = await res.json();
      if (Array.isArray(raw)) list = normalizeMany(raw, config, 'standard');
    }
  } catch {
    // Missing/malformed bundle degrades to no standard presets.
  }
  bundledCache.set(config.bundledUrl, list);
  return list;
}

// Run raw entries through the config normalizer, dropping any that throw or
// fail to produce a usable preset. Each surviving entry gets an id and source.
function normalizeMany(raw, config, source) {
  const out = [];
  for (const entry of raw) {
    try {
      const preset = config.normalize(entry);
      if (preset && preset.name) out.push({ ...preset, id: uid(), source });
    } catch {
      // Skip invalid entry (simple bypass).
    }
  }
  return out;
}

function loadUserPresets(config) {
  try {
    const raw = JSON.parse(localStorage.getItem(config.storageKey) || '[]');
    return Array.isArray(raw) ? normalizeMany(raw, config, 'user') : [];
  } catch {
    return [];
  }
}

function persistUserPresets(config, presets) {
  // Persist only the user pool, stripping runtime-only `source` tag.
  const userOnly = presets.filter(p => p.source === 'user').map(({ source, ...rest }) => rest);
  localStorage.setItem(config.storageKey, JSON.stringify(userOnly));
}

/**
 * Manages the preset library for one object type (agent, task, or item).
 *
 * Merges bundled (standard) presets fetched from `config.bundledUrl` with
 * user presets persisted in localStorage at `config.storageKey`. Standard presets
 * are read-only — editing one forks it into the user pool.
 *
 * Bundled presets are cached in a module-level Map after the first fetch, so
 * reopening the library modal doesn't re-fetch.
 *
 * @param {LibraryConfig} config - Shape defined in `src/constants/libraries.jsx`
 * @returns {{
 *   presets: Preset[],
 *   ready: boolean,
 *   addBlank: () => Preset,
 *   addPreset: (preset: object) => Preset,
 *   updatePreset: (id: string, changes: object) => void,
 *   deletePreset: (id: string) => void,
 *   importPresets: (raw: object[]) => Preset[]
 * }}
 */
export function usePresets(config) {
  const [standard, setStandard] = useState([]);
  const [user, setUser]         = useState(() => loadUserPresets(config));
  const [ready, setReady]       = useState(false);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    let live = true;
    setReady(false);
    fetchBundled(config).then(list => {
      if (!live) return;
      setStandard(list);
      setReady(true);
    });
    setUser(loadUserPresets(config));
    return () => { live = false; };
  }, [config]);

  // Persist user presets whenever they change.
  useEffect(() => {
    persistUserPresets(configRef.current, user);
  }, [user]);

  const addBlank = useCallback(() => {
    const preset = { ...configRef.current.makeBlank(), id: uid(), source: 'user' };
    setUser(prev => [...prev, preset]);
    return preset;
  }, []);

  // Append an arbitrary preset (e.g. a fork of a standard one). Returns it.
  const addPreset = useCallback((preset) => {
    const entry = { ...preset, id: uid(), source: 'user' };
    setUser(prev => [...prev, entry]);
    return entry;
  }, []);

  const updatePreset = useCallback((id, changes) => {
    setUser(prev => prev.map(p => p.id === id ? { ...p, ...changes } : p));
  }, []);

  const deletePreset = useCallback((id) => {
    setUser(prev => prev.filter(p => p.id !== id));
  }, []);

  // Import raw entries (from a loaded file) as user presets, skipping invalid.
  const importPresets = useCallback((raw) => {
    const normalized = normalizeMany(raw, configRef.current, 'user');
    setUser(prev => [...prev, ...normalized]);
    return normalized;
  }, []);

  return {
    presets: [...standard, ...user],
    ready,
    addBlank,
    addPreset,
    updatePreset,
    deletePreset,
    importPresets,
  };
}
