// Tag Registry: the live, editable registry of every tag *structure* available
// in the game (no payloads/values) — the "skeleton" of a game's ruleset. Serves
// as the source of structure that the future closed/config mode collapses into a
// single YAML file. This module owns the keys-only nested model, its YAML I/O
// (built on js-yaml), the security validator, and the pure tree mutations.

import yaml from 'js-yaml';
import { TAG_REGISTRY, parseTag } from './tags.js';

// A valid tag segment / registry key: lowercase letters, digits, '-' or '_'.
const SEGMENT_RE = /^[a-z0-9_-]+$/;

const isLeaf = (node) =>
  node === null || node === undefined || node === '' ||
  (typeof node === 'object' && !Array.isArray(node) && Object.keys(node).length === 0);

// Deep-clones the TAG_REGISTRY seed into a keys-only structure, dropping any
// 'label' metadata. Leaves are {}. Used to seed a fresh registry.
/**
 * Deep-clones the TAG_REGISTRY seed into a pure keys-only object (all leaves `{}`).
 * Used to initialize a fresh `state.tagRegistry`.
 *
 * @param {object} [seed] - Source tree; defaults to the built-in TAG_REGISTRY constant
 * @returns {TagRegistry}
 */
export function seedTagRegistry(seed = TAG_REGISTRY) {
  const out = {};
  for (const [key, node] of Object.entries(seed)) {
    if (key === 'label') continue;
    out[key] = node && typeof node === 'object' ? seedTagRegistry(node) : {};
  }
  return out;
}

// Normalizes a parsed YAML node into the keys-only model: every leaf becomes {}.
function normalizeNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return {};
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = normalizeNode(v);
  return out;
}

// --- YAML serialize / parse ---

// Serializes the registry to YAML. js-yaml renders empty-object leaves as "key: {}";
// we strip the "{}" so leaves read as bare "key:" (the spec's nested-list format).
/**
 * Serializes the registry tree to a YAML string.
 * Empty-object leaves are rendered as bare `key:` lines rather than `key: {}`,
 * matching YAML indented-list conventions.
 *
 * @param {TagRegistry} registry
 * @returns {string} YAML string (empty string for an empty registry)
 */
export function serializeRegistry(registry) {
  const dumped = yaml.dump(registry ?? {}, { sortKeys: true, indent: 2, lineWidth: -1 });
  return dumped === '{}\n' ? '' : dumped.replace(/: \{\}$/gm, ':');
}

/**
 * Parses a YAML string into a normalized registry tree.
 * All leaves are coerced to `{}` regardless of their YAML value.
 *
 * @param {string} ymlString
 * @returns {TagRegistry}
 */
export function parseRegistry(ymlString) {
  return normalizeNode(yaml.load(ymlString));
}

// --- tagRegistryCheck: security validator ---

// Recursively verifies a parsed tree is a pure nested map of valid segment keys:
// no values, no lists, no out-of-charset keys. Returns { valid, error }.
function checkNode(node, path) {
  for (const [key, child] of Object.entries(node)) {
    const here = [...path, key].join(':');
    if (!SEGMENT_RE.test(key)) {
      return { valid: false, error: `Invalid tag segment "${key}" — use lowercase letters, digits, "-" or "_".` };
    }
    if (isLeaf(child)) continue;
    if (typeof child !== 'object' || Array.isArray(child)) {
      return { valid: false, error: `Invalid value at "${here}" — the registry may only contain nested keys, no values or lists.` };
    }
    const res = checkNode(child, [...path, key]);
    if (!res.valid) return res;
  }
  return { valid: true, error: null };
}

// Loops through a YAML string and confirms it is a nested list matching the tag
// format rules and that every line is valid. js-yaml throws on malformed YAML and
// on duplicate sibling keys, which we surface as validation errors.
/**
 * Validates that a YAML string represents a pure nested key map with no values or lists,
 * and that every key matches the segment character set (`[a-z0-9_-]`).
 * js-yaml throws on malformed YAML and duplicate sibling keys; both are surfaced as errors.
 *
 * @param {string} ymlString
 * @returns {{ valid: boolean, error: string|null }}
 */
export function tagRegistryCheck(ymlString) {
  let parsed;
  try {
    parsed = yaml.load(ymlString);
  } catch (err) {
    return { valid: false, error: 'Malformed YAML: ' + err.message };
  }
  if (parsed === null || parsed === undefined) return { valid: true, error: null }; // empty registry
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'The registry must be a nested list of tag keys.' };
  }
  return checkNode(parsed, []);
}

// --- Tree mutations (pure; return new objects) ---

const normSegs = (segments) => segments.map(s => String(s).toLowerCase().trim()).filter(Boolean);

// Adds a tag path into the registry, creating intermediate nodes. Returns the SAME
// reference when the full path already exists, so reducers can no-op cheaply.
/**
 * Inserts the content path of a tag string into the registry, creating intermediate nodes.
 * Returns the same registry reference (no-op) if the full path already exists,
 * so reducers can cheaply skip a re-render.
 * Modifier and value are stripped; only the segment path is registered.
 *
 * @param {TagRegistry} registry
 * @param {string} tagString
 * @returns {TagRegistry}
 */
export function addTagToRegistry(registry, tagString) {
  const segments = parseTag(tagString).segments; // drops modifier + value
  const segs = normSegs(segments);
  if (!segs.length) return registry;
  let cur = registry;
  let exists = true;
  for (const seg of segs) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) {
      cur = cur[seg];
    } else { exists = false; break; }
  }
  return exists ? registry : addPath(registry, segs);
}

/**
 * Adds a path of segment strings to the registry, creating all intermediate nodes.
 * Always returns a new root object.
 *
 * @param {TagRegistry} registry
 * @param {string[]} segments
 * @returns {TagRegistry}
 */
export function addPath(registry, segments) {
  const segs = normSegs(segments);
  if (!segs.length) return registry;
  const root = { ...registry };
  let cur = root;
  for (const seg of segs) {
    const existing = cur[seg];
    const next = existing && typeof existing === 'object' ? { ...existing } : {};
    cur[seg] = next;
    cur = next;
  }
  return root;
}

/**
 * Removes the node at `segments` and its entire subtree.
 * Returns the original registry reference if the path does not exist.
 *
 * @param {TagRegistry} registry
 * @param {string[]} segments
 * @returns {TagRegistry}
 */
export function deleteNode(registry, segments) {
  const segs = normSegs(segments);
  if (!segs.length) return registry;
  const root = { ...registry };
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const node = cur[segs[i]];
    if (!node || typeof node !== 'object') return registry; // path absent
    cur[segs[i]] = { ...node };
    cur = cur[segs[i]];
  }
  if (!(segs[segs.length - 1] in cur)) return registry;
  delete cur[segs[segs.length - 1]];
  return root;
}

/**
 * Renames the terminal node of `segments` to `newKey`, preserving its children.
 * No-ops if the path is absent or `newKey === oldKey`. Returns the same reference
 * in those cases.
 *
 * @param {TagRegistry} registry
 * @param {string[]} segments
 * @param {string} newKey
 * @returns {TagRegistry}
 */
export function renameNode(registry, segments, newKey) {
  const segs = normSegs(segments);
  const key = String(newKey).toLowerCase().trim();
  if (!segs.length || !key) return registry;
  const root = { ...registry };
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const node = cur[segs[i]];
    if (!node || typeof node !== 'object') return registry;
    cur[segs[i]] = { ...node };
    cur = cur[segs[i]];
  }
  const oldKey = segs[segs.length - 1];
  if (!(oldKey in cur) || key === oldKey) return registry;
  const children = cur[oldKey];
  delete cur[oldKey];
  cur[key] = children; // preserve subtree under the new key
  return root;
}

// --- Tree view flattening ---

// Flattens the registry into an ordered list of VISIBLE rows for the editor-style
// tree view. DFS over sorted keys. A shared counter ticks on every node — collapsed
// or not — so line numbers reflect full-document position and skip over collapsed
// subtrees (Notepad++ folding behavior). `expanded` is a Set of colon-joined paths.
// Each row carries `ancestorIsLast` (one flag per ancestor level) to drive the
// nested vertical guide lines, and `isLast` for the last-child elbow.
/**
 * Flattens the registry into a sorted list of visible rows for the tree editor.
 *
 * DFS over alphabetically-sorted keys. A global line counter increments on every
 * node (including collapsed ones), so line numbers match a full-document view and
 * skip collapsed subtrees in the visible output — matching Notepad++ folding behavior.
 *
 * @param {TagRegistry} registry
 * @param {Set<string>} expanded - Colon-joined paths of currently expanded nodes
 * @returns {{ key: string, segments: string[], pathStr: string, depth: number, hasChildren: boolean, isOpen: boolean, isLast: boolean, lineNo: number, ancestorIsLast: boolean[] }[]}
 */
export function flattenRegistry(registry, expanded) {
  const rows = [];
  let counter = 0;
  const walk = (node, segments, ancestorIsLast, visible) => {
    const keys = Object.keys(node).sort();
    keys.forEach((key, i) => {
      counter += 1;
      const lineNo = counter;
      const childPath = [...segments, key];
      const pathStr = childPath.join(':');
      const children = node[key];
      const hasChildren = Object.keys(children).length > 0;
      const isLast = i === keys.length - 1;
      const isOpen = hasChildren && expanded.has(pathStr);
      if (visible) {
        rows.push({ key, segments: childPath, pathStr, depth: segments.length, hasChildren, isOpen, isLast, lineNo, ancestorIsLast });
      }
      // Always recurse so descendant line numbers advance the counter, even when
      // collapsed; gate child visibility on this node being open.
      walk(children, childPath, [...ancestorIsLast, isLast], visible && isOpen);
    });
  };
  walk(registry, [], [], true);
  return rows;
}

// --- Usage counts ---

// Collects every tag string currently applied across the game state: authored
// attribute tags AND dynamic activity tags (task assignments, carried & equipped
// items), so usage counts reflect all live tags. Order is irrelevant — the caller
// only counts occurrences.
export function tagsInUse(state) {
  const tags = [];
  for (const agent of state.agents || []) tags.push(...(agent.attributes || []), ...(agent.activities || []));
  for (const task of state.tasks || []) tags.push(...(task.requirements || []), ...(task.work || []), ...(task.attributes || []));
  for (const item of state.inventory || []) tags.push(...(item.attributes || []));
  return tags;
}

// Builds a count tree mirroring the registry: each node is { count, total, children }.
// `count` = in-use tags whose deepest matching segment lands on this node; a tag
// running deeper than the registry clamps to its nearest registered ancestor
// (`item:gold` → `item`, `task:<id>` → `task`). `total` rolls up `count` plus every
// descendant total, so the returned root's `total` is the grand total of all tags.
export function countTagsInUse(registry, tags) {
  const build = (node) => {
    const children = {};
    for (const [key, child] of Object.entries(node)) children[key] = build(child);
    return { count: 0, total: 0, children };
  };
  const root = build(registry || {});

  for (const tag of tags || []) {
    let cur = root;
    for (const seg of normSegs(parseTag(tag).segments)) {
      if (Object.prototype.hasOwnProperty.call(cur.children, seg)) cur = cur.children[seg];
      else break; // clamp at the deepest existing node
    }
    cur.count += 1;
  }

  const rollup = (node) => {
    node.total = node.count;
    for (const child of Object.values(node.children)) node.total += rollup(child);
    return node.total;
  };
  rollup(root);
  return root;
}

// --- File I/O (mirrors src/logic/session.js) ---

const SAVE_TYPES = [{ description: 'Tag registry config', accept: { 'application/x-yaml': ['.yml', '.yaml'] } }];

/**
 * Serializes the registry to YAML and writes it to disk via Save As dialog (with
 * `<a>.download` fallback). Suggested filename is `<sessionId>-config.yml`.
 *
 * @param {TagRegistry} registry
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function tagRegistrySave(registry, sessionId) {
  const yml = serializeRegistry(registry);
  const suggestedName = `${sessionId || 'session'}-config.yml`;

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: SAVE_TYPES });
      const writable = await handle.createWritable();
      await writable.write(yml);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Fall through to download fallback on any other failure.
    }
  }

  const blob = new Blob([yml], { type: 'application/x-yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

/**
 * Reads a YAML file and returns a parsed registry. Rejects if validation fails
 * (`tagRegistryCheck`), leaving the caller's existing registry untouched.
 *
 * @param {File} file
 * @returns {Promise<TagRegistry>}
 */
export function tagRegistryLoad(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const { valid, error } = tagRegistryCheck(r.result);
      if (!valid) { reject(new Error(error)); return; }
      resolve(parseRegistry(r.result));
    };
    r.onerror = () => reject(new Error('Failed to read file.'));
    r.readAsText(file);
  });
}
