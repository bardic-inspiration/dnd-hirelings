// Relational meta-prefixes. Modifiers are always the first segment and transform
// how the remaining path participates in system logic.
export const MODIFIER_REGISTRY = {
  req:   { prefix: 'Req',   description: 'Counterpart must carry this' },
  block: { prefix: 'Block', description: 'Counterpart must not carry this' },
};

// Namespace registry: known content paths with display labels.
// Non-exhaustive — tags outside this registry are valid.
// Each node: { label: string, children?: Record<string, node> }
export const TAG_REGISTRY = {
  task:  { label: 'Task' },
  skill: { label: 'Skill' },
  tool:  { label: 'Tool' },
  trait: { label: 'Trait' },
  class: { label: 'Class' },
  race:  { label: 'Race' },
  level: { label: 'Level' },
  item:  { label: 'Item' },
  work: {
    label: 'Work',
    children: {
      skill: { label: 'Work: Skill' },
    },
  },
  equip: {
    label: 'Equipped',
    children: {
      weapon:  { label: 'Weapon' },
      armor:   { label: 'Armor' },
      offhand: { label: 'Off Hand' },
      ring:    { label: 'Ring' },
      head:    { label: 'Head' },
      feet:    { label: 'Feet' },
    },
  },
};

// Walks the TAG_REGISTRY tree, returning the deepest matched node
// and any remaining (unmatched) segments.
function traverseRegistry(segments) {
  let node = null;
  let children = TAG_REGISTRY;
  let i = 0;
  for (; i < segments.length; i++) {
    const child = children?.[segments[i].toLowerCase()];
    if (!child) break;
    node = child;
    children = child.children;
  }
  return { node, remaining: segments.slice(i) };
}

// Parses a tag string into { segments: string[], value: string|null }.
// Grammar: segment:segment:...:segment=value
// The = is terminal — value is the raw string after the last =.
export function parseTag(s) {
  const parts = s.split(':');
  const last = parts[parts.length - 1];
  const eqIdx = last.indexOf('=');
  if (eqIdx >= 0) {
    parts[parts.length - 1] = last.slice(0, eqIdx);
    const value = last.slice(eqIdx + 1);
    return { segments: parts.filter(Boolean), value: value !== '' ? value : null };
  }
  return { segments: parts.filter(Boolean), value: null };
}

// Builds a tag string from segments array and optional value.
export function buildTag(segments, value) {
  const path = segments.join(':');
  return value !== null && value !== undefined && String(value) !== '' ? `${path}=${value}` : path;
}

// Returns true if tag's segments start with all of prefix's segments.
export function tagMatches(tag, prefix) {
  if (prefix.segments.length > tag.segments.length) return false;
  return prefix.segments.every((seg, i) => seg.toLowerCase() === tag.segments[i].toLowerCase());
}

// Appends tag to an attribute list, replacing any existing tag with the same
// full segment path (deduplicates by path, ignoring value).
export function mergeAttribute(attrs, tag) {
  const incoming = parseTag(tag);
  const inPath = incoming.segments.join(':').toLowerCase();
  return [
    ...attrs.filter(t => parseTag(t).segments.join(':').toLowerCase() !== inPath),
    tag,
  ];
}

// Returns { label, params } for display.
// Strips any modifier prefix, traverses the registry tree for the content path,
// then composes: "[modifier: ]<deepest-label>[: <last-unmatched-segment>][ =value]"
export function formatTagLabel(parsed) {
  const [first, ...rest] = parsed.segments;
  const mod = MODIFIER_REGISTRY[first?.toLowerCase()];
  const pathSegs = mod ? rest : parsed.segments;

  const { node, remaining } = traverseRegistry(pathSegs);
  let pathLabel;
  if (node) {
    pathLabel = node.label + (remaining.length > 0 ? `: ${remaining[remaining.length - 1]}` : '');
  } else {
    pathLabel = pathSegs.join(':');
  }

  const label = mod ? `${mod.prefix}: ${pathLabel}` : pathLabel;
  const params = parsed.value !== null && parsed.value !== undefined ? ` =${parsed.value}` : '';
  return { label: label.toUpperCase(), params };
}
