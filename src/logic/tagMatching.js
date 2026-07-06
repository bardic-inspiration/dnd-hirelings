// Tag-path matching: a modular engine for comparing a *pattern* path against a
// tag's segment path. Match modes live in MATCH_MODE_REGISTRY, mirroring the
// conditions system's TRACKER_REGISTRY — new modes plug in without touching
// callers. Built for extensibility: only the 'exact' mode is exercised today
// (condition tag links), but all modes are wired and tested.
//
// Asymmetry rule: wildcards and escapes exist ONLY on the pattern side. Tag
// segments are always literal text, so a tag that happens to contain an
// asterisk (it shouldn't, but user-derived names make it possible) can never
// be misread as a wildcard. To match such a tag, escape the asterisk in the
// pattern (`\*`) or build the pattern with `escapePatternSegment`.

/** Pattern segment that passes exactly one tag segment. */
export const SINGLE_WILDCARD = '*';
/** Pattern segment that passes any run of tag segments (open mode only). */
export const MULTI_WILDCARD = '**';
/** Escape character: `\*` is a literal asterisk, `\:` a literal colon, `\\` a literal backslash. */
export const ESCAPE_CHARACTER = '\\';

/**
 * Escapes literal text for safe embedding as one pattern segment: backslashes,
 * asterisks, and colons are prefixed with the escape character so the segment
 * can only ever match itself.
 *
 * @param {string} text - Literal segment text (e.g. a user-derived name)
 * @returns {string} Escaped pattern segment
 */
export function escapePatternSegment(text) {
  return String(text).replace(/[\\*:]/g, (character) => ESCAPE_CHARACTER + character);
}

// Splits a pattern path on ':' while honoring the escape character, so '\:'
// stays inside its segment. Returns raw (still-escaped) segment strings.
function splitPatternPath(patternPath) {
  const rawSegments = [];
  let buffer = '';
  for (let index = 0; index < patternPath.length; index++) {
    const character = patternPath[index];
    if (character === ESCAPE_CHARACTER && index + 1 < patternPath.length) {
      buffer += character + patternPath[index + 1];
      index += 1;
    } else if (character === ':') {
      rawSegments.push(buffer);
      buffer = '';
    } else {
      buffer += character;
    }
  }
  rawSegments.push(buffer);
  return rawSegments.filter(segment => segment !== '');
}

// Resolves escape sequences in a raw segment: the character after each escape
// is taken literally; a trailing escape character is kept as-is.
function unescapeSegment(rawSegment) {
  let out = '';
  for (let index = 0; index < rawSegment.length; index++) {
    const character = rawSegment[index];
    if (character === ESCAPE_CHARACTER && index + 1 < rawSegment.length) {
      out += rawSegment[index + 1];
      index += 1;
    } else {
      out += character;
    }
  }
  return out;
}

/**
 * @typedef {object} PatternPart
 * @property {'literal'|'single'|'multi'} kind - `'single'` for `*`, `'multi'` for `**`,
 *   `'literal'` otherwise
 * @property {string} [value] - Unescaped, lowercased text (literal parts only)
 */

/**
 * Parses a pattern path into typed parts. Wildcards are recognized from the
 * raw (pre-unescape) segment text, so `\*` and `\*\*` parse as literal
 * asterisk segments, never as wildcards.
 *
 * @param {string|string[]} patternPath - Colon-joined path (e.g. `'skill:*'`) or
 *   pre-split raw segments
 * @returns {PatternPart[]}
 */
export function parsePattern(patternPath) {
  const rawSegments = Array.isArray(patternPath)
    ? patternPath.map(String).filter(segment => segment !== '')
    : splitPatternPath(String(patternPath ?? ''));
  return rawSegments.map(raw => {
    if (raw === SINGLE_WILDCARD) return { kind: 'single' };
    if (raw === MULTI_WILDCARD) return { kind: 'multi' };
    return { kind: 'literal', value: unescapeSegment(raw).toLowerCase() };
  });
}

// One pattern part against one tag segment. In the pairwise modes (exact,
// numbered) a 'multi' part cannot expand, so it degrades to a single pass.
function partMatchesSegment(part, segment) {
  if (part.kind !== 'literal') return true;
  return part.value === String(segment).toLowerCase();
}

/**
 * `'exact'` mode: the pattern and the tag have the same number of segments and
 * every part matches pairwise. `*` passes its segment; `**` cannot expand here
 * and degrades to a single-segment pass.
 *
 * @param {PatternPart[]} pattern
 * @param {string[]} segments - Tag segment path (literal text)
 * @returns {boolean}
 */
function matchExact(pattern, segments) {
  if (pattern.length !== segments.length) return false;
  return pattern.every((part, index) => partMatchesSegment(part, segments[index]));
}

/**
 * `'numbered'` mode: only the first `depth` segments are compared pairwise;
 * both paths must be at least `depth` long. With no explicit depth it defaults
 * to the pattern's length, which makes it prefix matching (`skill` matches
 * `skill:arcana`). `**` degrades to a single-segment pass, as in exact mode.
 *
 * @param {PatternPart[]} pattern
 * @param {string[]} segments - Tag segment path (literal text)
 * @param {{ depth?: number }} [options]
 * @returns {boolean}
 */
function matchNumbered(pattern, segments, { depth } = {}) {
  const compared = Number.isInteger(depth) && depth >= 0 ? depth : pattern.length;
  if (pattern.length < compared || segments.length < compared) return false;
  for (let index = 0; index < compared; index++) {
    if (!partMatchesSegment(pattern[index], segments[index])) return false;
  }
  return true;
}

/**
 * `'open'` mode: glob-style alignment over the whole path. `*` passes exactly
 * one segment; `**` passes any run of segments **including zero** (so
 * `tag:**:potato` matches `tag:potato` as well as `tag:my:computer:is:a:potato`;
 * require at least one with `tag:*:**:potato`). Suffix and contains matching
 * fall out of this mode (`**:potato`, `**:potato:**`) rather than needing
 * modes of their own.
 *
 * @param {PatternPart[]} pattern
 * @param {string[]} segments - Tag segment path (literal text)
 * @returns {boolean}
 */
function matchOpen(pattern, segments) {
  const matchFrom = (patternIndex, segmentIndex) => {
    if (patternIndex === pattern.length) return segmentIndex === segments.length;
    const part = pattern[patternIndex];
    if (part.kind === 'multi') {
      for (let skipTo = segmentIndex; skipTo <= segments.length; skipTo++) {
        if (matchFrom(patternIndex + 1, skipTo)) return true;
      }
      return false;
    }
    if (segmentIndex >= segments.length) return false;
    return partMatchesSegment(part, segments[segmentIndex]) && matchFrom(patternIndex + 1, segmentIndex + 1);
  };
  return matchFrom(0, 0);
}

/**
 * Maps mode name to its matcher — the extension point for future match modes.
 * Each matcher receives `(pattern: PatternPart[], segments: string[], options)`.
 *
 * @type {{ [mode: string]: (pattern: PatternPart[], segments: string[], options?: object) => boolean }}
 */
export const MATCH_MODE_REGISTRY = {
  exact: matchExact,
  numbered: matchNumbered,
  open: matchOpen,
};

// --- Value comparison term ---

// Ordered comparisons are numeric-only: either side failing coercion fails the
// comparison (fail closed), so leaf strings never order-compare. Only numbers
// and non-empty strings may coerce — null/undefined/booleans never do (Number
// would silently turn them into 0/1).
const toComparableNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};

const numericComparison = (evaluate) => (tagValue, compareValue) => {
  const left = toComparableNumber(tagValue);
  const right = toComparableNumber(compareValue);
  return Number.isFinite(left) && Number.isFinite(right) && evaluate(left, right);
};

/**
 * Maps comparison operator to its evaluator — the extension point for value
 * comparisons. `'=='` is case-insensitive string equality; the ordered
 * operators compare numerically and fail when either side is non-numeric.
 * Available to any pattern consumer; only condition tag links wire it in the
 * first pass. Consumers choose which value resolver feeds the tag side
 * deliberately (conditions use `'display'` — see `logic/conditions.js`);
 * the `'match'` resolver's `true` would stringify to `'true'` under `'=='`.
 *
 * @type {{ [operator: string]: (tagValue: *, compareValue: *) => boolean }}
 */
export const VALUE_COMPARE_REGISTRY = {
  '==': (tagValue, compareValue) => String(tagValue).toLowerCase() === String(compareValue).toLowerCase(),
  '>=': numericComparison((left, right) => left >= right),
  '<=': numericComparison((left, right) => left <= right),
  '>':  numericComparison((left, right) => left > right),
  '<':  numericComparison((left, right) => left < right),
};

/**
 * Applies a structured comparison term to a tag's resolved value. The term is
 * kept separate from the pattern path so wildcard/escape parsing never
 * interacts with operator parsing.
 *
 * @param {{ op: string, value: string }|null|undefined} compare - Comparison
 *   term; `null`/`undefined` means "no constraint" and always passes
 * @param {*} value - The tag's value, resolved by the consumer's chosen
 *   resolver (`logic/tagValues.js`)
 * @returns {boolean} True when unconstrained or the comparison passes;
 *   unknown operators match nothing
 */
export function matchTagValue(compare, value) {
  if (compare === null || compare === undefined) return true;
  const comparator = VALUE_COMPARE_REGISTRY[compare.op];
  return comparator ? comparator(value, compare.value) : false;
}

/**
 * Renders a pattern path as a human-readable interpretation: literal segments
 * appear as their unescaped text, `*` as `‹any›`, `**` as `‹any…›`. Shows the
 * pattern as the engine will read it (escapes resolved), so `skill:\*` renders
 * as `skill:*` only when the asterisk is literal text.
 *
 * @param {string|string[]} patternPath
 * @returns {string} Colon-joined interpretation (empty string for an empty pattern)
 */
export function formatPatternLabel(patternPath) {
  return parsePattern(patternPath)
    .map(part => part.kind === 'single' ? '‹any›' : part.kind === 'multi' ? '‹any…›' : part.value)
    .join(':');
}

/**
 * Matches a pattern path against a tag's segment path using the given mode.
 * Comparison is case-insensitive. Unknown modes match nothing. An empty
 * pattern only matches an empty path (exact/open) or anything at depth 0
 * (numbered).
 *
 * @param {string|string[]} patternPath - Wildcard-capable pattern (see module header)
 * @param {string[]} tagSegments - Literal tag segments, e.g. from `parseTag().segments`
 * @param {{ mode?: 'exact'|'numbered'|'open', depth?: number }} [options] - Defaults to exact mode
 * @returns {boolean}
 */
export function matchTagPath(patternPath, tagSegments, { mode = 'exact', depth } = {}) {
  const matcher = MATCH_MODE_REGISTRY[mode];
  if (!matcher) return false;
  return matcher(parsePattern(patternPath), tagSegments || [], { depth });
}
