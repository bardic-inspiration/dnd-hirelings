import { useEffect } from 'react';
import { useAssets } from '../state/AssetContext.jsx';

/**
 * Registers asset URLs with the global `AssetProvider` on mount (runs once).
 * The app will not render its children until all registered URLs have resolved.
 * Use `useAssetGroup` instead for modal-scoped images that should load lazily.
 *
 * @param {string[]} urls
 */
export function useRegisterAssets(urls) {
  const { registerAssets } = useAssets();
  useEffect(() => {
    if (urls?.length) registerAssets(urls);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount
}
