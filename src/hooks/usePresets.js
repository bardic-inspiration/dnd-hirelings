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

// Standard presets carry no stable id (a fresh uid is minted on every fetch), so
// deletions are tombstoned by preset name — the same key the library searches and
// dedupes on. A name in this set hides the matching bundled default on load.
const tombstoneKey = (config) => `${config.storageKey}-deleted`;

function loadTombstones(config) {
  try {
    const raw = JSON.parse(localStorage.getItem(tombstoneKey(config)) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter(n => typeof n === 'string') : []);
  } catch {
    return new Set();
  }
}

function persistTombstones(config, names) {
  localStorage.setItem(tombstoneKey(config), JSON.stringify([...names]));
}

/**
 * Manages the preset library for one object type (agent, task, or item).
 *
 * Merges bundled (standard) presets fetched from `config.bundledUrl` with
 * user presets persisted in localStorage at `config.storageKey`. Standard presets
 * are read-only — editing one forks it into the user pool. Deleting one tombstones
 * it by name (persisted at `${storageKey}-deleted`) so it stays hidden on reload.
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
  const [standard, setStandard]   = useState([]);
  const [user, setUser]           = useState(() => loadUserPresets(config));
  const [deleted, setDeleted]     = useState(() => loadTombstones(config));
  const [ready, setReady]         = useState(false);
  const configRef = useRef(config);
  configRef.current = config;
  // Ref to the live standard list so deletePreset can resolve a standard preset's
  // name (for tombstoning) without taking `standard` as a callback dependency.
  const standardRef = useRef(standard);
  standardRef.current = standard;

  useEffect(() => {
    let live = true;
    setReady(false);
    fetchBundled(config).then(list => {
      if (!live) return;
      setStandard(list);
      setReady(true);
    });
    setUser(loadUserPresets(config));
    setDeleted(loadTombstones(config));
    return () => { live = false; };
  }, [config]);

  // Persist tombstones whenever a standard preset is deleted (or restored).
  useEffect(() => {
    persistTombstones(configRef.current, deleted);
  }, [deleted]);

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

  // Deletes a preset from either pool. User presets are dropped outright; standard
  // (bundled default) presets have no persistent store, so they are tombstoned by
  // name and stay hidden across reloads.
  const deletePreset = useCallback((id) => {
    const std = standardRef.current.find(p => p.id === id);
    if (std) {
      setDeleted(prev => prev.has(std.name) ? prev : new Set(prev).add(std.name));
      return;
    }
    setUser(prev => prev.filter(p => p.id !== id));
  }, []);

  // Import raw entries (from a loaded file) as user presets, skipping invalid.
  const importPresets = useCallback((raw) => {
    const normalized = normalizeMany(raw, configRef.current, 'user');
    setUser(prev => [...prev, ...normalized]);
    return normalized;
  }, []);

  return {
    // Hide tombstoned bundled defaults; user presets are always shown.
    presets: [...standard.filter(p => !deleted.has(p.name)), ...user],
    ready,
    addBlank,
    addPreset,
    updatePreset,
    deletePreset,
    importPresets,
  };
}
