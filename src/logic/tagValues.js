// Tag value resolvers: registry-bounded values (docs/tag-values.md, issue #104).
// Every segment in a tag string is registered by definition; explicit `=values`
// are never registered. A tag ending on a registered LEAF carries an implied
// value whose default varies by use case — true for matching, the leaf segment
// string for display. Those defaults live here, in per-use-case resolver
// functions (interchangeable attachments, mirroring MATCH_MODE_REGISTRY and
// TRACKER_REGISTRY), never in the registry or the data schema. The registry
// walk supports below are the validation methods parsing functions call.

/**
 * Returns the registry node at a segment path, or `undefined` when the path is
 * absent. Segments are normalized (lowercased/trimmed) before walking, matching
 * `pathExists` in `logic/tagRegistry.js`; an empty path never resolves.
 *
 * @param {TagRegistry} registry
 * @param {string[]} segments - Literal tag segments, e.g. from `parseTag().segments`
 * @returns {TagRegistry|undefined} The node's children map, or `undefined`
 */
export function getRegistryNode(registry, segments) {
  const segs = (segments || []).map(segment => String(segment).toLowerCase().trim()).filter(Boolean);
  if (!segs.length) return undefined;
  let cur = registry;
  for (const seg of segs) {
    if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Returns true when the segment path resolves to a registered LEAF — a node
 * with no children. A leaf-terminal tag carries an implied value; a node with
 * children is a structural reference and carries none.
 *
 * @param {TagRegistry} registry
 * @param {string[]} segments
 * @returns {boolean}
 */
export function isRegisteredLeaf(registry, segments) {
  const node = getRegistryNode(registry, segments);
  return !!node && typeof node === 'object' && Object.keys(node).length === 0;
}

/**
 * Per-use-case value resolvers. Each maps a parsed tag (`parseTag()` output)
 * plus the tag registry to that use case's value, applying its own implied
 * default for leaf-terminal tags. An explicit `=value` always wins.
 *
 * - `match`   — explicit value, else `true` (presence).
 * - `display` — explicit value, else the terminal segment when it is a
 *   registered leaf, else `null` (strict: no registry, an unregistered
 *   terminal, or a registered non-leaf all resolve to `null`).
 * - `numeric` — explicit value coerced through `Number` when finite, else
 *   `null`. Leaf strings never coerce to numbers.
 *
 * @type {{ [useCase: string]: (parsedTag: { segments: string[], value: string|null }, registry: TagRegistry) => * }}
 */
export const VALUE_RESOLVER_REGISTRY = {
  match: (parsedTag) => (parsedTag.value !== null && parsedTag.value !== undefined ? parsedTag.value : true),
  display: (parsedTag, registry) => {
    if (parsedTag.value !== null && parsedTag.value !== undefined) return parsedTag.value;
    const segments = parsedTag.segments || [];
    if (!segments.length || !isRegisteredLeaf(registry, segments)) return null;
    return segments[segments.length - 1];
  },
  numeric: (parsedTag) => {
    if (parsedTag.value === null || parsedTag.value === undefined || parsedTag.value === '') return null;
    const numeric = Number(parsedTag.value);
    return Number.isFinite(numeric) ? numeric : null;
  },
};

/**
 * Resolves a parsed tag's value for a use case by dispatching into
 * `VALUE_RESOLVER_REGISTRY`. Unknown use cases resolve to `null`.
 *
 * @param {string} useCase - Key into `VALUE_RESOLVER_REGISTRY` (`'match'`, `'display'`, `'numeric'`)
 * @param {{ segments: string[], value: string|null }} parsedTag - Output of `parseTag`
 * @param {TagRegistry} registry
 * @returns {*} The resolved value, or `null` for unknown use cases
 */
export function resolveTagValue(useCase, parsedTag, registry) {
  const resolver = VALUE_RESOLVER_REGISTRY[useCase];
  return resolver ? resolver(parsedTag, registry) : null;
}
