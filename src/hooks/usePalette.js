import { useEffect } from 'react';
import { PALETTES } from '../palettes.js';
import { PALETTE_KEY } from '../state/storage.js';

// Manages color palette application and persistence
export function applyPalette(name) {
  
  // Retrieve the palette configuration, defaulting to 'dark' if not found
  const p = PALETTES[name] || PALETTES.dark;
  const root = document.documentElement;
  
  // Set CSS variables for the palette colors
  root.style.setProperty('--bg',           p.bg); // background color
  root.style.setProperty('--fg',           p.fg); // foreground color
  root.style.setProperty('--border',       p.border); // border color
  root.style.setProperty('--dim',          p.dim); // dimmed text color
  root.style.setProperty('--dimmer',       p.dimmer); // even dimmer text color
  root.style.setProperty('--highlight',    p.highlight); // highlight color for selected items
  root.style.setProperty('--highlight-bg', p.highlightBg); // background for highlighted items
  root.style.setProperty('--warn',         p.warn || '#e84040'); // warning color, default to red if not specified
  
  // Handle background image if specified in the palette
  if (p.backgroundImage) {
    const img = new Image();
    img.onload  = () => root.style.setProperty('--bg-image', `url('${p.backgroundImage}')`); // Set background image on successful load
    img.onerror = () => root.style.setProperty('--bg-image', 'none'); // Fallback to no background image if loading fails
    img.src = p.backgroundImage; // Start loading the image
  } else {
    root.style.setProperty('--bg-image', 'none'); // Ensure no background image if not specified
  }
  localStorage.setItem(PALETTE_KEY, name); // Persist the selected palette in localStorage
}

// Retrieves the currently stored palette name from localStorage, defaulting to 'dark' if not set
export function getStoredPalette() {
  return localStorage.getItem(PALETTE_KEY) || 'dark';
}

// Custom hook to apply the stored palette on component mount
export function usePalette() {
  useEffect(() => {
    applyPalette(getStoredPalette());
  }, []);
}
