import { useEffect } from 'react';
import { PALETTES } from '../constants/palettes.js';
import { PALETTE_KEY } from '../state/storage.js';
import { useRegisterAssets } from './useRegisterAssets.js';

// Applies a named palette by writing CSS custom properties on :root and
// preloading the palette's background image. Persists the selection to localStorage.
export function applyPalette(name) {
  const p = PALETTES[name] || PALETTES.dark;
  const root = document.documentElement;

  root.style.setProperty('--bg',           p.bg);
  root.style.setProperty('--fg',           p.fg);
  root.style.setProperty('--border',       p.border);
  root.style.setProperty('--dim',          p.dim);
  root.style.setProperty('--dimmer',       p.dimmer);
  root.style.setProperty('--highlight',    p.highlight);
  root.style.setProperty('--highlight-bg', p.highlightBg);
  root.style.setProperty('--warn',         p.warn || '#e84040');

  root.style.setProperty('--bg-image', p.backgroundImage ? `url('${p.backgroundImage}')` : 'none');
  localStorage.setItem(PALETTE_KEY, name);
}

export function getStoredPalette() {
  return localStorage.getItem(PALETTE_KEY) || 'dark';
}

export function usePalette() {
  const storedName = getStoredPalette();
  const p = PALETTES[storedName] || PALETTES.dark;
  useRegisterAssets(p.backgroundImage ? [p.backgroundImage] : []);

  useEffect(() => {
    applyPalette(storedName);
  }, []);
}
