import { useEffect } from 'react';
import { PALETTES } from '../constants/palettes.js';
import { PALETTE_KEY } from '../state/storage.js';
import { useRegisterAssets } from './useRegisterAssets.js';

/**
 * Applies a named palette immediately by writing all CSS custom properties to `:root`
 * and persisting the name to localStorage. Valid names are keys of `PALETTES`; falls
 * back to `'dark'` for unknown names.
 *
 * @param {string} name - Palette name ('dark' | 'light' | 'vale' | 'ember' | 'arcane')
 */
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

/**
 * Returns the palette name stored in localStorage, defaulting to `'dark'`.
 *
 * @returns {string}
 */
export function getStoredPalette() {
  return localStorage.getItem(PALETTE_KEY) || 'dark';
}

/**
 * Applies the stored theme on mount and registers the background image with the
 * global asset gate so the app doesn't render before the background has loaded.
 * No return value — purely a side-effect hook.
 */
export function usePalette() {
  const storedName = getStoredPalette();
  const p = PALETTES[storedName] || PALETTES.dark;
  useRegisterAssets(p.backgroundImage ? [p.backgroundImage] : []);

  useEffect(() => {
    applyPalette(storedName);
  }, []);
}
