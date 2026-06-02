import { useEffect, useState } from 'react';

// Tracks load state for a group of asset URLs locally.
// Designed for modal-scoped gates: starts loading on mount, resolves independently
// of the global app gate (does not block app rendering).
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
