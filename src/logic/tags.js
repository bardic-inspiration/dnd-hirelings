// Relational meta-prefixes. Modifier is the segment before the ',' separator.
// Kept flat — modifiers are always a single token. `taskField` names the task
// list a tag carrying the modifier routes into (see logic/tasks.js routeTaskTag);
// modifiers without it route to `attributes`.
export const MODIFIER_REGISTRY = {
  req:   { prefix: 'Req',   description: 'Counterpart must carry this',     taskField: 'requirements' },
  block: { prefix: 'Block', description: 'Counterpart must not carry this', taskField: 'requirements' },
  bonus: { prefix: 'Bonus', description: 'Adds value to matching agent tag when bound' },
  dyn:   { prefix: 'Dyn',   description: 'Value computed from an expression over sibling tags' },
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
  // Stat addresses for the reference D&D ruleset — flat hyphenated leaves so
  // they double as unquoted rule keys in config/rules.yml. `xp`, `hp`, and
  // `hitdie` carry plain values; `level`, `ac`, `pb`, `hp-max`, and
  // `xp-lvl(-max)` are governed by the rules registry and applied as `dyn,`
  // markers (see docs/architecture.md → Dynamic Tags). Structure only — no
  // expressions live in the tag registry.
  ac: {}, pb: {}, hitdie: {},
  hp: {}, 'hp-max': {},
  xp: {}, 'xp-lvl': {}, 'xp-lvl-max': {},
  // `bind` slots an item into the agent. Slot is optional (`bind:item:<name>`).
  // Slot NAMES are not hardcoded here — they are configured per card under
  // `cards.<card>.slots` in config/UI.yml (see logic/UI.js), so the registry
  // stays a pure structure skeleton (issue #84).
  bind: {},
};

// Parses a tag string into { modifier, segments, value }.
// Grammar:
//   modifier,path:path:...:path=value  — modifier tag (',' separates modifier from content)
//   path:path:...:path=value           — plain tag with value
//   path:path:...:path                 — plain tag without value
// modifier  — whatever precedes the first ',' when that comma precedes the first '='
//             (null if absent; commas after '=' belong to the value)
// segments  — content path only, never includes modifier
// value     — everything after the first '=', or null
/**
 * Parses a tag string into its constituent parts.
 *
 * Grammar: `[modifier,]segment[:segment...][=value]`
 * - `modifier` — token before the first comma, or null if absent. A comma
 *   counts as the modifier separator only when it precedes the first `=`;
 *   commas inside a value (e.g. `dyn,x=max(1,2)`) never split a modifier.
 * - `segments` — the content path only (modifier excluded)
 * - `value` — everything after the first `=`, or null. Values are opaque and
 *   may contain any character, including `:`, `,`, spaces, and operators
 *   (`dyn,` expression payloads rely on this).
 *
 * @param {string} tagString - Raw tag string
 * @returns {{ modifier: string|null, segments: string[], value: string|null }}
 */
export function parseTag(tagString) {
  const eqIdx = tagString.indexOf('=');
  const commaIdx = tagString.indexOf(',');
  let modifier = null;
  let raw = tagString;
  if (commaIdx >= 0 && (eqIdx < 0 || commaIdx < eqIdx)) {
    modifier = tagString.slice(0, commaIdx);
    raw = tagString.slice(commaIdx + 1);
  }
  const rawEqIdx = raw.indexOf('=');
  if (rawEqIdx >= 0) {
    const value = raw.slice(rawEqIdx + 1);
    const parts = raw.slice(0, rawEqIdx).split(':');
    return { modifier, segments: parts.filter(Boolean), value: value !== '' ? value : null };
  }
  return { modifier, segments: raw.split(':').filter(Boolean), value: null };
}

/**
 * Checks RAW tag syntax ahead of `parseTag`'s lenient segment-dropping
 * (`"skill:"` and `"skill"` both parse to `['skill']`, so malformations are
 * invisible after parsing). Strips the modifier and `=value` exactly as
 * `parseTag` does, then flags any empty or whitespace-only path segment —
 * leading/trailing/double colons (`"skill:"`, `":skill"`, `"a::b"`). An
 * entirely empty path returns `null`; callers report that as their own
 * "empty" case. Warning-only by design: parsing never rejects these strings.
 *
 * @param {string} tagString - Raw tag string as typed
 * @returns {string|null} Warning message, or `null` when well-formed
 */
export function tagSyntaxWarning(tagString) {
  const text = String(tagString ?? '');
  const eqIdx = text.indexOf('=');
  const commaIdx = text.indexOf(',');
  const raw = commaIdx >= 0 && (eqIdx < 0 || commaIdx < eqIdx) ? text.slice(commaIdx + 1) : text;
  const rawEqIdx = raw.indexOf('=');
  const parts = (rawEqIdx >= 0 ? raw.slice(0, rawEqIdx) : raw).split(':');
  if (parts.every(part => part.trim() === '')) return null;
  return parts.some(part => part.trim() === '') ? 'malformed tag — empty path segment' : null;
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
    ...attrs.filter(tag => {
      const parsed = parseTag(tag);
      const key = (parsed.modifier ? `${parsed.modifier},` : '') + parsed.segments.join(':').toLowerCase();
      return key !== inKey;
    }),
    tag,
  ];
}
