import { useEffect, useState } from 'react';

/**
 * Tracks load state for a local group of asset URLs.
 * Intended for modal-scoped lazy loading — does not register URLs with the global
 * `AssetProvider` gate and will not block app rendering.
 * Loading starts on mount and runs once.
 *
 * @param {string[]} urls - Image URLs to preload
 * @returns {{ isReady: boolean }} True once all URLs have loaded or errored
 */
export function useAssetGroup(urls) {
  const [loaded, setLoaded] = useState(0);
  const total = urls?.length ?? 0;

  useEffect(() => {
    if (!total) return;
    let count = 0;
    urls.forEach(url => {
      const img = new Image();
      const done = () => {
        count += 1;
        if (count === total) setLoaded(total);
      };
      img.onload  = done;
      img.onerror = done;
      img.src = url;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  return { isReady: total === 0 || loaded === total };
}
