import { useEffect } from 'react';
import { PALETTES } from '../constants/palettes.js';
import { STORAGE_KEYS } from '../state/storage.js';
import { useRegisterAssets } from './useRegisterAssets.js';

// Legacy key written before palette was versioned; read as fallback during migration.
const PALETTE_KEY_LEGACY = 'dnd-hirelings-palette';

/**
 * Applies a named palette immediately by writing all CSS custom properties to `:root`
 * and persisting the name to localStorage. Valid names are keys of `PALETTES`; falls
 * back to `'dark'` for unknown names.
 *
 * @param {string} name - Palette name ('light' | 'dark')
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
  root.style.setProperty('--accent',       p.accent || '#d2a24e');

  root.style.setProperty('--bg-image', p.backgroundImage ? `url('${p.backgroundImage}')` : 'none');
  localStorage.setItem(STORAGE_KEYS.PALETTE, name);
}

/**
 * Returns the palette name stored in localStorage, defaulting to `'dark'`.
 * Falls back to `'dark'` if the stored value is not a known palette (e.g. a
 * name retired in a later release, such as the pre-rename `'arcane'`).
 *
 * @returns {string}
 */
export function getStoredPalette() {
  const stored = localStorage.getItem(STORAGE_KEYS.PALETTE)
    || localStorage.getItem(PALETTE_KEY_LEGACY);
  return PALETTES[stored] ? stored : 'dark';
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
