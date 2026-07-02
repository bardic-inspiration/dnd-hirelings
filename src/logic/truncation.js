// Structural truncation for the text display library. Pure functions; the
// placeholder strings and budget parameters come from config/truncation.yml
// (see constants/truncation.js) and are injectable per call for tests.
//
// Guiding rule (issue #69): the user must always see the structure of a tag —
// the modifier prefix, the first path segment, and the value survive every
// stage of collapse; anything omitted or overlong is stood in for by a typed
// placeholder (<PRE> / <TAG> / <TAGS> / <VAL>), never silently clipped.
import { TRUNCATION_CONFIG } from '../constants/truncation.js';
import { MODIFIER_REGISTRY } from './tags.js';
import { formatNumberShorthand } from './format.js';

/**
 * Display-variant registry for tag rendering — the extension point for new
 * tag display styles (mirroring `MODIFIER_REGISTRY` / `MATCH_MODE_REGISTRY`).
 * Each variant supplies per-piece text transforms and separators; truncation
 * math runs on the transformed text, so char budgets measure exactly what
 * renders.
 *
 * - `chip` — literal lowercase, mirroring the tag string: `req,skill:farming=150`
 * - `row`  — pretty uppercase (block rows): `REQ: SKILL: FARMING =150`;
 *            modifier renders via its `MODIFIER_REGISTRY` prefix and `_`/`-`
 *            become spaces
 */
export const TAG_LABEL_VARIANTS = {
  chip: {
    modifierText: (modifier) => modifier,
    segmentText: (segment) => segment,
    valueText: (value) => value,
    modifierSeparator: ',',
    segmentSeparator: ':',
    valueSeparator: '=',
  },
  row: {
    modifierText: (modifier) => (MODIFIER_REGISTRY[modifier]?.prefix ?? modifier).toUpperCase(),
    segmentText: (segment) => segment.replace(/[_-]/g, ' ').toUpperCase(),
    valueText: (value) => value,
    modifierSeparator: ': ',
    segmentSeparator: ': ',
    valueSeparator: ' =',
  },
};

/**
 * Computes how many characters fit in a measured container:
 * `floor((widthPx - allowancePx) / (fontSizePx * charWidthRatio))`, clamped
 * to `minChars`. Returns `fallbackChars` when the container has no usable
 * measurement (zero/negative width or font size — hidden or unmounted).
 *
 * @param {object} input
 * @param {number} input.widthPx - Measured container width in px
 * @param {number} input.fontSizePx - Computed font size of the text in px
 * @param {number} input.charWidthRatio - Average glyph width as a fraction of font size
 * @param {number} [input.allowancePx=0] - Px reserved for padding, gaps, and affordances
 * @param {number} [input.minChars=1] - Lower clamp on the computed budget
 * @param {number} input.fallbackChars - Budget used when measurement is unusable
 * @returns {number} Whole-character budget
 */
export function computeCharBudget({ widthPx, fontSizePx, charWidthRatio, allowancePx = 0, minChars = 1, fallbackChars }) {
  if (!(widthPx > 0) || !(fontSizePx > 0)) return fallbackChars;
  return Math.max(minChars, Math.floor((widthPx - allowancePx) / (fontSizePx * charWidthRatio)));
}

/**
 * Generic middle-ellipsis for plain text. Keeps `ceil((maxChars-1)/2)` head
 * and `floor((maxChars-1)/2)` tail characters around a single `…`. Text at or
 * under the budget is returned unchanged; pass `Infinity` to disable.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {{ text: string, truncated: boolean }}
 */
export function truncateMiddle(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  if (maxChars <= 1) return { text: '…', truncated: true };
  const headLength = Math.ceil((maxChars - 1) / 2);
  const tailLength = Math.floor((maxChars - 1) / 2);
  return { text: `${text.slice(0, headLength)}…${tailLength > 0 ? text.slice(-tailLength) : ''}`, truncated: true };
}

/**
 * Structural tag truncation. Renders a parsed tag into typed display parts
 * that fit `maxChars` (pass `Infinity` to disable), always preserving the
 * tag's structure. The decision ladder, first fit wins:
 *
 * 1. Full render (value through number shorthand when numeric and enabled).
 * 2. Collapse trailing middle segments: keep `seg1..segk` (k = N−1 → 1); the
 *    omitted run renders `<TAG>` (one) or `<TAGS>` (two or more). Modifier
 *    and value are always kept: `req,skill:<TAGS>=150`.
 * 3. Replace the longest remaining literal element (value → `<VAL>`, first
 *    segment → `<TAG>`, modifier → `<PRE>`) — only where the placeholder is
 *    actually shorter — until it fits: `<PRE>,<TAG>:<TAGS>=<VAL>`.
 * 4. Floor: return the final form even when it still exceeds the budget
 *    (the CSS ellipsis on the container is the backstop; see docs/gotchas.md).
 *
 * Pure; no side effects.
 *
 * @param {{ modifier: string|null, segments: string[], value: string|null }} parsed - Output of `parseTag`
 * @param {number} [maxChars=Infinity] - Character budget (see `computeCharBudget`)
 * @param {object} [options]
 * @param {'chip'|'row'} [options.variant='chip'] - Key into `TAG_LABEL_VARIANTS`
 * @param {boolean} [options.shorthand=true] - Apply number shorthand to numeric values
 * @param {object} [options.config=TRUNCATION_CONFIG] - Truncation config (placeholders + shorthand table)
 * @returns {{
 *   parts: { kind: 'modifier'|'separator'|'segment'|'value'|'placeholder', text: string,
 *            placeholder?: 'prefix'|'segment'|'segments'|'value' }[],
 *   text: string,
 *   truncated: boolean,
 *   valueShortened: boolean,
 * }} `parts` render in order; `text` is their concatenation; `truncated` marks
 *   structural collapse or replacement; `valueShortened` marks shorthand alone.
 */
export function truncateTagParts(parsed, maxChars = Infinity, options = {}) {
  const { variant: variantName = 'chip', shorthand = true, config = TRUNCATION_CONFIG } = options;
  const variant = TAG_LABEL_VARIANTS[variantName];
  const { placeholders } = config;

  const modifierText = parsed.modifier !== null ? variant.modifierText(parsed.modifier) : null;
  const segmentTexts = parsed.segments.map(segment => variant.segmentText(segment));
  const totalSegments = segmentTexts.length;

  let valueText = null;
  let valueShortened = false;
  if (parsed.value !== null) {
    const numeric = parsed.value !== '' && Number.isFinite(Number(parsed.value));
    const display = shorthand && numeric
      ? formatNumberShorthand(Number(parsed.value), config.numberShorthand)
      : parsed.value;
    valueShortened = display !== parsed.value;
    valueText = variant.valueText(display);
  }

  // A form names which pieces render literally and which as placeholders.
  const buildParts = ({ keptSegments, omittedSegments, modifierReplaced, firstReplaced, valueReplaced }) => {
    const parts = [];
    if (modifierText !== null) {
      parts.push(modifierReplaced
        ? { kind: 'placeholder', text: placeholders.prefix, placeholder: 'prefix' }
        : { kind: 'modifier', text: modifierText });
      parts.push({ kind: 'separator', text: variant.modifierSeparator });
    }
    const pathPieces = [];
    for (let index = 0; index < keptSegments; index += 1) {
      pathPieces.push(index === 0 && firstReplaced
        ? { kind: 'placeholder', text: placeholders.segment, placeholder: 'segment' }
        : { kind: 'segment', text: segmentTexts[index] });
    }
    if (omittedSegments > 0) {
      pathPieces.push(omittedSegments === 1
        ? { kind: 'placeholder', text: placeholders.segment, placeholder: 'segment' }
        : { kind: 'placeholder', text: placeholders.segments, placeholder: 'segments' });
    }
    pathPieces.forEach((piece, i) => {
      if (i > 0) parts.push({ kind: 'separator', text: variant.segmentSeparator });
      parts.push(piece);
    });
    if (valueText !== null) {
      parts.push({ kind: 'separator', text: variant.valueSeparator });
      parts.push(valueReplaced
        ? { kind: 'placeholder', text: placeholders.value, placeholder: 'value' }
        : { kind: 'value', text: valueText });
    }
    return parts;
  };

  const fits = (parts) => parts.reduce((sum, part) => sum + part.text.length, 0) <= maxChars;
  const finish = (parts, form) => ({
    parts,
    text: parts.map(part => part.text).join(''),
    truncated: form.omittedSegments > 0 || form.modifierReplaced || form.firstReplaced || form.valueReplaced,
    valueShortened,
  });

  // Rungs 1 and 2: full render, then graded collapse of trailing segments.
  const minimumKept = Math.min(1, totalSegments);
  for (let keptSegments = totalSegments; keptSegments >= minimumKept; keptSegments -= 1) {
    const form = {
      keptSegments,
      omittedSegments: totalSegments - keptSegments,
      modifierReplaced: false,
      firstReplaced: false,
      valueReplaced: false,
    };
    const parts = buildParts(form);
    if (fits(parts)) return finish(parts, form);
  }

  // Rung 3: replace the longest literal elements with typed placeholders,
  // longest first, skipping any where the placeholder would not save space.
  const form = {
    keptSegments: minimumKept,
    omittedSegments: totalSegments - minimumKept,
    modifierReplaced: false,
    firstReplaced: false,
    valueReplaced: false,
  };
  const replacements = [
    valueText !== null && { flag: 'valueReplaced', literal: valueText, placeholder: placeholders.value },
    totalSegments > 0 && { flag: 'firstReplaced', literal: segmentTexts[0], placeholder: placeholders.segment },
    modifierText !== null && { flag: 'modifierReplaced', literal: modifierText, placeholder: placeholders.prefix },
  ]
    .filter(Boolean)
    .filter(candidate => candidate.placeholder.length < candidate.literal.length)
    .sort((a, b) => b.literal.length - a.literal.length);

  let parts = buildParts(form);
  for (const candidate of replacements) {
    form[candidate.flag] = true;
    parts = buildParts(form);
    if (fits(parts)) return finish(parts, form);
  }

  // Rung 4: nothing shorter exists — return the floor form regardless.
  return finish(parts, form);
}
