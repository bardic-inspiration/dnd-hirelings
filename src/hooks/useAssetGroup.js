import { useEffect, useState } from 'react';

/**
 * Tracks per-image load state for a local group of asset URLs.
 * Intended for modal-scoped lazy loading — does not register URLs with the global
 * `AssetProvider` gate and will not block app rendering.
 * Loading starts on mount and runs once.
 *
 * Readiness is tracked per URL rather than as an all-or-nothing counter, so the
 * caller can reveal each thumbnail the moment its own image settles instead of
 * waiting for the slowest (or a 404'd) image to hold up the entire group.
 *
 * @param {string[]} urls - Image URLs to preload
 * @returns {{ isReady: boolean, readySet: Set<string> }}
 *   `readySet` holds every URL that has loaded or errored; `isReady` is true once
 *   all URLs have settled.
 */
export function useAssetGroup(urls) {
  const [readySet, setReadySet] = useState(() => new Set());
  const total = urls?.length ?? 0;

  useEffect(() => {
    if (!total) return;
    urls.forEach(url => {
      const img = new Image();
      const done = () => setReadySet(prev => {
        if (prev.has(url)) return prev;
        const next = new Set(prev);
        next.add(url);
        return next;
      });
      img.onload  = done;
      img.onerror = done;
      img.src = url;
      if (img.complete) done(); // cached images resolve synchronously
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  return { isReady: total === 0 || readySet.size >= total, readySet };
}
