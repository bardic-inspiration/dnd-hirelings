// Relational meta-prefixes. Modifier is the segment before the ',' separator.
// Kept flat — modifiers are always a single token.
export const MODIFIER_REGISTRY = {
  req:   { prefix: 'Req',   description: 'Counterpart must carry this' },
  block: { prefix: 'Block', description: 'Counterpart must not carry this' },
};

// Content path namespace. Each node is { label, ...childNodes }.
// 'label' is display metadata; every other key is a child node — mirrors YAML indentation.
// Non-exhaustive: tags outside this registry are valid, displayed with raw segment text.
export const TAG_REGISTRY = {
  task:  { label: 'Task' },
  ability: {
    label: 'Ability',
    str: { label: 'STR' },
    dex: { label: 'DEX' },
    con: { label: 'CON' },
    int: { label: 'INT' },
    wis: { label: 'WIS' },
    cha: { label: 'CHA' },
  },
  skill: {
    label: 'Skill',
    acrobatics:     { label: 'Acrobatics' },
    animalhandling: { label: 'Animal Handling' },
    arcana:         { label: 'Arcana' },
    athletics:      { label: 'Athletics' },
    deception:      { label: 'Deception' },
    history:        { label: 'History' },
    insight:        { label: 'Insight' },
    intimidation:   { label: 'Intimidation' },
    investigation:  { label: 'Investigation' },
    medicine:       { label: 'Medicine' },
    nature:         { label: 'Nature' },
    perception:     { label: 'Perception' },
    performance:    { label: 'Performance' },
    persuasion:     { label: 'Persuasion' },
    religion:       { label: 'Religion' },
    sleightofhand:  { label: 'Sleight of Hand' },
    stealth:        { label: 'Stealth' },
    survival:       { label: 'Survival' },
  },
  tool:  { label: 'Tool' },
  trait: { label: 'Trait' },
  class: { label: 'Class' },
  race:  { label: 'Race' },
  level: { label: 'Level' },
  item:  { label: 'Item' },
  work: {
    label: 'Work',
    skill: { label: 'Work: Skill' },
  },
  equip: {
    label: 'Equipped',
    weapon:  { label: 'Weapon' },
    armor:   { label: 'Armor' },
    offhand: { label: 'Off Hand' },
    ring:    { label: 'Ring' },
    head:    { label: 'Head' },
    feet:    { label: 'Feet' },
  },
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

// Walks TAG_REGISTRY depth-first. Returns the deepest matched node and any
// remaining (unmatched) segments.
function traverseRegistry(segments) {
  let node = null;
  let current = TAG_REGISTRY;
  let i = 0;
  for (; i < segments.length; i++) {
    const child = current[segments[i].toLowerCase()];
    if (!child || typeof child !== 'object') break;
    node = child;
    current = child;
  }
  return { node, remaining: segments.slice(i) };
}

// Returns { label, params } for display.
// Strategy: deepest registered node label + last unregistered segment (if any).
// Falls back to raw path string for fully unregistered tags.
export function formatTagLabel(parsed) {
  const { node, remaining } = traverseRegistry(parsed.segments);
  let pathLabel;
  if (node) {
    pathLabel = node.label + (remaining.length > 0 ? `: ${remaining[remaining.length - 1]}` : '');
  } else {
    pathLabel = parsed.segments.join(':');
  }
  const modEntry = parsed.modifier ? MODIFIER_REGISTRY[parsed.modifier] : null;
  const modPrefix = modEntry ? modEntry.prefix : parsed.modifier;
  const label = parsed.modifier ? `${modPrefix}: ${pathLabel}` : pathLabel;
  const params = parsed.value !== null && parsed.value !== undefined ? ` =${parsed.value}` : '';
  return { label: label.toUpperCase(), params };
}
