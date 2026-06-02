// Namespace registry: known path prefixes with display labels.
// Non-exhaustive — tags outside this registry are valid.
export const TAG_REGISTRY = {
  'task':              { label: 'Task' },
  'skill':             { label: 'Skill' },
  'tool':              { label: 'Tool' },
  'trait':             { label: 'Trait' },
  'class':             { label: 'Class' },
  'race':              { label: 'Race' },
  'level':             { label: 'Level' },
  'req':               { label: 'Requirement' },
  'req:skill':         { label: 'Req: Skill' },
  'req:tool':          { label: 'Req: Tool' },
  'req:trait':         { label: 'Req: Trait' },
  'req:class':         { label: 'Req: Class' },
  'req:race':          { label: 'Req: Race' },
  'req:item':          { label: 'Req: Item' },
  'req:consumable':    { label: 'Req: Consumable' },
  'work':              { label: 'Work' },
  'work:skill':        { label: 'Work: Skill' },
};

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

// Returns { label, params } for display. Joins segments with ' : ', appends ' =value' if present.
export function formatTagLabel(parsed) {
  const path = parsed.segments.join(':');
  const entry = TAG_REGISTRY[path.toLowerCase()];
  const label = entry ? entry.label.toUpperCase() : path.toUpperCase();
  const params = parsed.value !== null && parsed.value !== undefined ? ` =${parsed.value}` : '';
  return { label, params };
}
