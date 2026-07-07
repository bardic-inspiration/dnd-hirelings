import { useCallback, useRef, useState } from 'react';
import { TRUNCATION_CONFIG } from '../constants/truncation.js';
import { computeCharBudget } from '../logic/truncation.js';

// One shared observer serves every measured container (dozens of cards render
// at once); per-element callbacks are looked up when an entry fires.
let sharedObserver = null;
const measureCallbacks = new Map();

function getSharedObserver() {
  if (sharedObserver === null) {
    sharedObserver = new ResizeObserver((entries) => {
      for (const entry of entries) measureCallbacks.get(entry.target)?.();
    });
  }
  return sharedObserver;
}

/**
 * Measures a container element and derives the character budget for text
 * inside it, per the `charBudget` section of `config/truncation.yml`.
 *
 * Attach the returned `ref` to the container that constrains the text (a
 * `.tag-list` / `.task-tag-list`), not to each chip — one measurement serves
 * every chip within it. The budget re-derives on resize through a shared
 * module-level ResizeObserver and reads the computed font size at each
 * measure, so scale changes are picked up. Renders only when the
 * whole-character budget actually changes. Returns the component's
 * `fallbackChars` until the first usable (non-zero-width) measurement and
 * keeps the last budget while the container is hidden.
 *
 * Side effects: observes/unobserves the element on the shared ResizeObserver.
 *
 * @param {string} component - Key into `charBudget.components` (`'tag-chip'` | `'tag-row'` | `'text'` | `'agent-name'` | `'stat-box'`)
 * @returns {{ ref: (element: HTMLElement|null) => void, maxChars: number }}
 */
export function useCharBudget(component) {
  const { fonts, minChars, components } = TRUNCATION_CONFIG.charBudget;
  const componentEntry = components[component];
  if (!componentEntry) throw new Error(`useCharBudget: unknown component "${component}"`);

  const [maxChars, setMaxChars] = useState(componentEntry.fallbackChars);
  const elementRef = useRef(null);

  const measure = useCallback((element) => {
    if (!(element.clientWidth > 0)) return; // hidden/unmounted — keep the last budget
    setMaxChars(computeCharBudget({
      widthPx: element.clientWidth,
      fontSizePx: parseFloat(getComputedStyle(element).fontSize),
      charWidthRatio: fonts[componentEntry.font],
      allowancePx: componentEntry.allowancePx,
      minChars: componentEntry.minChars ?? minChars,
      fallbackChars: componentEntry.fallbackChars,
    }));
  }, [componentEntry, fonts, minChars]);

  const ref = useCallback((element) => {
    const observer = getSharedObserver();
    if (elementRef.current !== null) {
      observer.unobserve(elementRef.current);
      measureCallbacks.delete(elementRef.current);
    }
    elementRef.current = element;
    if (element !== null) {
      measureCallbacks.set(element, () => measure(element));
      observer.observe(element);
      measure(element); // synchronous first measure — no fallback flash
    }
  }, [measure]);

  return { ref, maxChars };
}
