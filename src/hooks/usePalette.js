import { useEffect } from 'react';
import { PALETTES } from '../palettes.js';
import { PALETTE_KEY } from '../state/storage.js';

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
  if (p.backgroundImage) {
    const img = new Image();
    img.onload  = () => root.style.setProperty('--bg-image', `url('${p.backgroundImage}')`);
    img.onerror = () => root.style.setProperty('--bg-image', 'none');
    img.src = p.backgroundImage;
  } else {
    root.style.setProperty('--bg-image', 'none');
  }
  localStorage.setItem(PALETTE_KEY, name);
}

export function getStoredPalette() {
  return localStorage.getItem(PALETTE_KEY) || 'dark';
}

export function usePalette() {
  useEffect(() => {
    applyPalette(getStoredPalette());
  }, []);
}
