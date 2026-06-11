import { createContext, useCallback, useContext, useRef, useState } from 'react';

const AssetContext = createContext(null);

/**
 * Tracks a registry of asset URLs and their load state.
 * Children render only after every registered URL has settled (loaded or errored).
 * Shows a full-screen "LOADING" placeholder while any URL is still pending.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function AssetProvider({ children }) {
  // Map<url, 'pending' | 'loaded' | 'error'>
  const [registry, setRegistry] = useState(() => new Map());
  // Stable ref so callbacks don't go stale
  const registryRef = useRef(registry);

  const registerAssets = useCallback((urls) => {
    const filtered = urls.filter(u => u && !registryRef.current.has(u));
    if (!filtered.length) return;

    const next = new Map(registryRef.current);
    filtered.forEach(url => next.set(url, 'pending'));
    registryRef.current = next;
    setRegistry(next);

    filtered.forEach(url => {
      const img = new Image();
      const settle = (status) => {
        // Guard against double-settling: a cached image fires both the async
        // load event and the synchronous `img.complete` path below.
        if (registryRef.current.get(url) !== 'pending') return;
        const updated = new Map(registryRef.current);
        updated.set(url, status);
        registryRef.current = updated;
        setRegistry(new Map(updated));
      };
      img.onload  = () => settle('loaded');
      img.onerror = () => settle('error');
      img.src = url;
      // If the browser already has this image (e.g. from <link rel="preload">
      // in index.html), the load event will not fire again — resolve the gate
      // synchronously to avoid a LOADING flash on repeat visits.
      if (img.complete) settle('loaded');
    });
  }, []);

  const isReady = registry.size === 0 ||
    [...registry.values()].every(s => s !== 'pending');

  return (
    <AssetContext.Provider value={{ registerAssets, isReady }}>
      {isReady ? children : <AssetLoadingScreen />}
    </AssetContext.Provider>
  );
}

/**
 * Returns `{ registerAssets, isReady }` from the nearest `AssetProvider`.
 *
 * @returns {{ registerAssets: (urls: string[]) => void, isReady: boolean }}
 */
export function useAssets() {
  return useContext(AssetContext);
}

function AssetLoadingScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #111114)',
      color: 'var(--dim, #5c5c68)',
      fontFamily: 'monospace',
      letterSpacing: '0.2em',
      fontSize: '0.75rem',
    }}>
      LOADING
    </div>
  );
}
