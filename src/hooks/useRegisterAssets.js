import { useEffect } from 'react';
import { useAssets } from '../state/AssetContext.jsx';

// Registers an array of asset URLs with the AssetProvider on mount.
// The provider will gate rendering until all registered URLs resolve.
export function useRegisterAssets(urls) {
  const { registerAssets } = useAssets();
  useEffect(() => {
    if (urls?.length) registerAssets(urls);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount
}
