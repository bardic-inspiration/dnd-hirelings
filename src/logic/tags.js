// Relational meta-prefixes. Modifier is the segment before the ',' separator.
// Kept flat — modifiers are always a single token.
export const MODIFIER_REGISTRY = {
  req:   { prefix: 'Req',   description: 'Counterpart must carry this' },
  block: { prefix: 'Block', description: 'Counterpart must not carry this' },
  bonus: { prefix: 'Bonus', description: 'Adds value to matching agent tag when equipped' },
};

// Content path namespace — the keys-only skeleton seeded into a fresh tag library
// (see logic/tagRegistry.js). Every key is a child node; a leaf is {}. Mirrors YAML
// indentation. Non-exhaustive: tags outside it are valid; display derives labels
// from the segments themselves, so the live library is the sole structure source.
export const TAG_REGISTRY = {
  task: {},
  ability: { str: {}, dex: {}, con: {}, int: {}, wis: {}, cha: {} },
  skill: {
    acrobatics: {}, animalhandling: {}, arcana: {}, athletics: {},
    deception: {}, history: {}, insight: {}, intimidation: {},
    investigation: {}, medicine: {}, nature: {}, perception: {},
    performance: {}, persuasion: {}, religion: {}, sleightofhand: {},
    stealth: {}, survival: {},
  },
  tool: {}, trait: {}, class: {}, race: {}, level: {}, item: {},
  work: { skill: {} },
  equip: { weapon: {}, armor: {}, offhand: {}, ring: {}, head: {}, feet: {} },
};

// Parses a tag string into { modifier, segments, value }.
// Grammar:
//   modifier,path:path:...:path=value  — modifier tag (',' separates modifier from content)
//   path:path:...:path=value           — plain tag with value
//   path:path:...:path                 — plain tag without value
// modifier  — whatever precedes the first ',' (null if absent)
// segments  — content path only, never includes modifier
// value     — scalar after '=' in the content, or null
/**
 * Parses a tag string into its constituent parts.
 *
 * Grammar: `[modifier,]segment[:segment...][=value]`
 * - `modifier` — token before the first comma, or null if absent
 * - `segments` — the content path only (modifier excluded)
 * - `value` — scalar after `=` in the last segment, or null
 *
 * @param {string} s - Raw tag string
 * @returns {{ modifier: string|null, segments: string[], value: string|null }}
 */
export function parseTag(s) {
  const commaIdx = s.indexOf(',');
  let modifier = null;
  let raw = s;
  if (commaIdx >= 0) {
    modifier = s.slice(0, commaIdx);
    raw = s.slice(commaIdx + 1);
  }
  const parts = raw.split(':');
  const last = parts[parts.length - 1];
  const eqIdx = last.indexOf('=');
  if (eqIdx >= 0) {
    parts[parts.length - 1] = last.slice(0, eqIdx);
    const value = last.slice(eqIdx + 1);
    return { modifier, segments: parts.filter(Boolean), value: value !== '' ? value : null };
  }
  return { modifier, segments: parts.filter(Boolean), value: null };
}

/**
 * Serializes a parsed tag back into a tag string.
 *
 * @param {string[]} segments - Content path segments
 * @param {string|number|null} [value] - Optional scalar value
 * @param {string|null} [modifier] - Optional modifier prefix (e.g. 'req', 'bonus')
 * @returns {string}
 */
export function buildTag(segments, value, modifier = null) {
  const path = segments.join(':');
  const valueStr = value !== null && value !== undefined && String(value) !== '' ? `=${value}` : '';
  const content = path + valueStr;
  return modifier ? `${modifier},${content}` : content;
}

/**
 * Returns true if `tag`'s segments begin with all of `prefix`'s segments (case-insensitive).
 *
 * @param {{ segments: string[] }} tag
 * @param {{ segments: string[] }} prefix
 * @returns {boolean}
 */
export function tagMatches(tag, prefix) {
  if (prefix.segments.length > tag.segments.length) return false;
  return prefix.segments.every((seg, i) => seg.toLowerCase() === tag.segments[i].toLowerCase());
}

/**
 * Appends `tag` to an attribute list, replacing any existing entry with the same
 * modifier + full segment path. Deduplicates by identity key; the incoming value wins.
 *
 * @param {string[]} attrs - Existing attribute tag strings
 * @param {string} tag - Tag string to merge in
 * @returns {string[]} New array with the tag added or replaced
 */
export function mergeAttribute(attrs, tag) {
  const incoming = parseTag(tag);
  const inKey = (incoming.modifier ? `${incoming.modifier},` : '') + incoming.segments.join(':').toLowerCase();
  return [
    ...attrs.filter(t => {
      const p = parseTag(t);
      const key = (p.modifier ? `${p.modifier},` : '') + p.segments.join(':').toLowerCase();
      return key !== inKey;
    }),
    tag,
  ];
}

/**
 * Derives a human-readable display label from a parsed tag without consulting the registry.
 *
 * Single-segment path → the segment itself. Deeper paths → "FIRST: LAST".
 * Modifier is prepended as its registry prefix (e.g. `req` → "REQ: ").
 * Underscores and hyphens render as spaces.
 *
 * @param {{ modifier: string|null, segments: string[], value: string|null }} parsed
 * @returns {{ label: string, params: string }} `label` is uppercase; `params` is `" =value"` or `""`
 */
export function formatTagLabel(parsed) {
  const pretty = (seg) => seg.replace(/[_-]/g, ' ');
  const segs = parsed.segments;
  const pathLabel = segs.length === 0 ? ''
    : segs.length === 1 ? pretty(segs[0])
    : `${pretty(segs[0])}: ${pretty(segs[segs.length - 1])}`;
  const modEntry = parsed.modifier ? MODIFIER_REGISTRY[parsed.modifier] : null;
  const modPrefix = modEntry ? modEntry.prefix : parsed.modifier;
  const label = parsed.modifier ? `${modPrefix}: ${pathLabel}` : pathLabel;
  const params = parsed.value !== null && parsed.value !== undefined ? ` =${parsed.value}` : '';
  return { label: label.toUpperCase(), params };
}
