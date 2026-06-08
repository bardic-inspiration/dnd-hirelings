// Relational meta-prefixes. Modifier is the segment before the ',' separator.
// Kept flat — modifiers are always a single token.
export const MODIFIER_REGISTRY = {
  req:   { prefix: 'Req',   description: 'Counterpart must carry this' },
  block: { prefix: 'Block', description: 'Counterpart must not carry this' },
  bonus: { prefix: 'Bonus', description: 'Adds value to matching agent tag when equipped' },
};

// Content path namespace — the keys-only skeleton seeded into a fresh tag library
// (see logic/tagLibrary.js). Every key is a child node; a leaf is {}. Mirrors YAML
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

// Builds a tag string from segments, optional value, and optional modifier.
export function buildTag(segments, value, modifier = null) {
  const path = segments.join(':');
  const valueStr = value !== null && value !== undefined && String(value) !== '' ? `=${value}` : '';
  const content = path + valueStr;
  return modifier ? `${modifier},${content}` : content;
}

// Returns true if tag's segments start with all of prefix's segments.
export function tagMatches(tag, prefix) {
  if (prefix.segments.length > tag.segments.length) return false;
  return prefix.segments.every((seg, i) => seg.toLowerCase() === tag.segments[i].toLowerCase());
}

// Appends tag to an attribute list, replacing any existing tag with the same
// modifier + full segment path (deduplicates by identity, ignoring value).
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

// Returns { label, params } for display, deriving the label from the tag's own
// segments (no registry lookup). Single segment → that segment; deeper paths →
// "first: last". Underscores/hyphens render as spaces; modifiers prefix the label.
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
