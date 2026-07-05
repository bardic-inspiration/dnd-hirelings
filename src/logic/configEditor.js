// Config editor — the pure logic tier behind the Configuration Modal. Operates
// on raw config documents (plain objects from `yaml.load`, not normalized
// configs, so unknown keys survive to be warned about) guided by lightweight
// schema descriptors:
//
//   node := { kind: 'map', keys?: {name: node}, anyKey?: node, closed?: bool }
//         | { kind: 'list', item: node }
//         | { kind: 'tuple', size: number, item: node }
//         | { kind: 'scalar', value: 'string'|'number'|'boolean'|'slug'|'tagSource'|'enum',
//             options?, min?, step?, nullable?, label? }
//
// Schemas shape affordances (autocomplete, warnings) but never gate edits —
// the config counterpart of the tag registry's soft enforcement. This module
// owns document flattening for the tree view, pure path-based mutations, the
// schema walker, value-kind suggestion/validation, and YAML file I/O.

import yaml from 'js-yaml';
import { parseTag } from './tags.js';
import { pathExists } from './tagRegistry.js';
import { downloadFile } from './download.js';
import { DYNAMIC_SOURCE_KEYS, AGENT_FIELD_SOURCE_KEYS } from './UI.js';

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A valid slug value (bind slot names, and any future key-like scalar).
const SLUG_RE = /^[a-z0-9_-]+$/;

// --- Schema walking ---

/**
 * Resolves the schema node governing one child of a container schema node:
 * a map's named (or `anyKey`) entry, or a list/tuple's item. `null` when the
 * child is outside the schema (the soft-warning case).
 *
 * @param {object|null} schemaNode - The container's schema node
 * @param {string|number} keyOrIndex - Map key or list index of the child
 * @returns {object|null}
 */
export function schemaChild(schemaNode, keyOrIndex) {
  if (!schemaNode) return null;
  if (schemaNode.kind === 'map') return schemaNode.keys?.[keyOrIndex] ?? schemaNode.anyKey ?? null;
  if (schemaNode.kind === 'list' || schemaNode.kind === 'tuple') return schemaNode.item ?? null;
  return null;
}

/**
 * Walks a schema from its root down a document path (map keys and list indices).
 *
 * @param {object|null} schema - Root schema node
 * @param {(string|number)[]} path - Document path
 * @returns {object|null} The schema node at that path, or `null` once off-schema
 */
export function schemaNodeAt(schema, path) {
  let node = schema ?? null;
  for (const step of path) node = schemaChild(node, step);
  return node;
}

// --- Value kinds (pluggable suggestion + soft validation) ---

// Collects every registered tag path (colon-joined, all tiers) for tagSource
// autocomplete against the live registry.
function registryPaths(tagRegistry) {
  const paths = [];
  const walk = (node, prefix) => {
    for (const [key, child] of Object.entries(node ?? {})) {
      const path = prefix ? `${prefix}:${key}` : key;
      paths.push(path);
      walk(child, path);
    }
  };
  walk(tagRegistry, '');
  return paths;
}

// Soft-validates one tag-source string against the source grammar
// (see logic/UI.js): dynamic:<key>, bare agent field, or attribute tag path.
// A bare single segment may also be a one-segment tag path, so it only warns
// when it is neither a known field nor a registered path.
function checkTagSource(value, context) {
  const segments = parseTag(String(value ?? '')).segments.map(segment => segment.toLowerCase());
  if (!segments.length) return 'empty source';
  if (segments[0] === 'dynamic') {
    return segments.length === 2 && DYNAMIC_SOURCE_KEYS.includes(segments[1])
      ? null
      : `unknown dynamic source — known: ${DYNAMIC_SOURCE_KEYS.join(', ')}`;
  }
  const registry = context?.tagRegistry ?? {};
  if (segments.length === 1) {
    return AGENT_FIELD_SOURCE_KEYS.includes(segments[0]) || pathExists(registry, segments)
      ? null
      : 'unknown agent field / unregistered tag path';
  }
  return pathExists(registry, segments) ? null : 'tag path not in the registry';
}

// All tag-source completions: dynamic keys, agent fields, live registry paths.
function tagSourceCandidates(context) {
  return [
    ...DYNAMIC_SOURCE_KEYS.map(key => `dynamic:${key}`),
    ...AGENT_FIELD_SOURCE_KEYS,
    ...registryPaths(context?.tagRegistry ?? {}),
  ];
}

const prefixMatches = (candidates, prefix) => {
  const lower = String(prefix ?? '').toLowerCase();
  return candidates
    .filter(candidate => candidate.toLowerCase().startsWith(lower) && candidate.toLowerCase() !== lower)
    .sort();
};

/**
 * Registry of scalar value kinds used by schema descriptors. Each kind offers
 * `suggest(prefix, schemaNode, context)` completions and a soft
 * `check(value, schemaNode, context)` returning a warning string or `null`.
 * `context` is `{ tagRegistry }` (the live registry, for tagSource kinds).
 * Extend here to add value kinds for future config files.
 */
export const VALUE_KINDS = {
  string: {
    suggest: () => [],
    check: () => null,
  },
  number: {
    suggest: () => [],
    check: (value, schemaNode) => {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) return 'not a number';
      if (schemaNode?.min !== undefined && num < schemaNode.min) return `minimum ${schemaNode.min}`;
      return null;
    },
  },
  boolean: {
    suggest: (prefix) => prefixMatches(['true', 'false'], prefix),
    check: (value) => (typeof value === 'boolean' ? null : 'true or false'),
  },
  slug: {
    suggest: () => [],
    check: (value) => (typeof value === 'string' && SLUG_RE.test(value)
      ? null
      : 'lowercase letters, digits, - and _ only'),
  },
  enum: {
    suggest: (prefix, schemaNode) => prefixMatches(schemaNode?.options ?? [], prefix),
    check: (value, schemaNode) => ((schemaNode?.options ?? []).includes(value)
      ? null
      : `one of: ${(schemaNode?.options ?? []).join(', ')}`),
  },
  tagSource: {
    suggest: (prefix, schemaNode, context) => prefixMatches(tagSourceCandidates(context), prefix),
    check: (value, schemaNode, context) => checkTagSource(value, context),
  },
};

/**
 * Coerces raw text (from an inline edit or the builder input) into the value a
 * schema node expects: numbers parse (falling back to the raw text so `check`
 * can warn), booleans map from `true`/`false` text, slugs lowercase, and with
 * no schema numeric-looking text becomes a number — matching what YAML would
 * have parsed. Never throws or rejects.
 *
 * @param {string} raw - Text as typed
 * @param {object|null} schemaNode - Governing scalar schema node, if any
 * @returns {string|number|boolean|null} The coerced value (`null` for empty nullable scalars)
 */
export function coerceScalarInput(raw, schemaNode) {
  const text = String(raw ?? '').trim();
  if (text === '' && schemaNode?.nullable) return null;
  const kind = schemaNode?.kind === 'scalar' ? schemaNode.value : null;
  if (kind === 'number' || (kind === null && text !== '' && Number.isFinite(Number(text)))) {
    const num = Number(text);
    return Number.isFinite(num) ? num : text;
  }
  if (kind === 'boolean') {
    const lower = text.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    return text;
  }
  if (kind === 'slug') return text.toLowerCase();
  return text;
}

// --- Tree view flattening ---

// Classifies a document value into the row kind the tree renders. An array is
// a 'tuple' leaf only when its schema says so — bare arrays of arrays stay
// generically foldable.
function rowKindOf(value, schemaNode) {
  if (isMapping(value)) return 'map';
  if (Array.isArray(value)) return schemaNode?.kind === 'tuple' ? 'tuple' : 'list';
  return 'scalar';
}

/**
 * Flattens a config document into the ordered list of VISIBLE rows for the
 * editor-style tree view, walking the schema alongside the data.
 *
 * Insertion order is preserved (config order is meaningful — bars render in
 * list order), unlike `flattenRegistry`'s sorted walk; the two flatteners stay
 * separate deliberately, sharing only the ~same counter/guide bookkeeping.
 * A shared line counter ticks on every node — collapsed or not — so line
 * numbers reflect full-document position (Notepad++ folding behavior).
 *
 * @param {object} doc - Raw config document (mapping root)
 * @param {object|null} schema - Root schema node, or `null` for schema-less docs
 * @param {Set<string>} expanded - Colon-joined `pathStr`s of open containers
 * @returns {{ key: string, keyOrIndex: string|number, path: (string|number)[],
 *   pathStr: string, depth: number, kind: 'map'|'list'|'tuple'|'scalar',
 *   value: *, schemaNode: object|null, hasChildren: boolean, isOpen: boolean,
 *   isLast: boolean, lineNo: number, ancestorIsLast: boolean[] }[]}
 *   `value` is the scalar or tuple payload for leaf rows, `null` for containers
 */
export function flattenConfigDoc(doc, schema, expanded) {
  const rows = [];
  let counter = 0;
  const walk = (node, schemaNode, path, ancestorIsLast, visible) => {
    const entries = Array.isArray(node)
      ? node.map((value, index) => [index, value])
      : Object.entries(node ?? {});
    entries.forEach(([keyOrIndex, value], i) => {
      counter += 1;
      const childPath = [...path, keyOrIndex];
      const pathStr = childPath.join(':');
      const childSchema = schemaChild(schemaNode, keyOrIndex);
      const kind = rowKindOf(value, childSchema);
      const isContainer = kind === 'map' || kind === 'list';
      const hasChildren = isContainer &&
        (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0);
      const isLast = i === entries.length - 1;
      const isOpen = hasChildren && expanded.has(pathStr);
      if (visible) {
        rows.push({
          key: String(keyOrIndex), keyOrIndex, path: childPath, pathStr,
          depth: path.length, kind, value: isContainer ? null : value,
          schemaNode: childSchema, hasChildren, isOpen, isLast,
          lineNo: counter, ancestorIsLast,
        });
      }
      // Always recurse so descendant line numbers advance the counter, even
      // when collapsed; gate child visibility on this node being open.
      if (isContainer) walk(value, childSchema, childPath, [...ancestorIsLast, isLast], visible && isOpen);
    });
  };
  walk(doc ?? {}, schema ?? null, [], [], true);
  return rows;
}

// --- Soft validation ---

/**
 * Soft-validates a config document against its schema. Returns a map of
 * colon-joined `pathStr` → warning string for entries that fall outside the
 * schema: unknown keys under `closed` maps, container/scalar shape mismatches,
 * wrong tuple sizes, and scalar values their kind's `check` rejects. Warnings
 * only — nothing is ever removed or blocked.
 *
 * @param {object} doc - Raw config document
 * @param {object|null} schema - Root schema node
 * @param {{ tagRegistry?: object }} [context] - Live data for value-kind checks
 * @returns {Map<string, string>}
 */
export function checkConfigDoc(doc, schema, context = {}) {
  const warnings = new Map();
  const walk = (node, schemaNode, path) => {
    const entries = Array.isArray(node)
      ? node.map((value, index) => [index, value])
      : Object.entries(node ?? {});
    for (const [keyOrIndex, value] of entries) {
      const childPath = [...path, keyOrIndex];
      const pathStr = childPath.join(':');
      const childSchema = schemaChild(schemaNode, keyOrIndex);
      if (!childSchema) {
        if (schemaNode?.kind === 'map' && schemaNode.closed) warnings.set(pathStr, 'unknown key');
      } else if (childSchema.kind === 'map' && !isMapping(value)) {
        warnings.set(pathStr, 'expected a mapping');
      } else if ((childSchema.kind === 'list' || childSchema.kind === 'tuple') && !Array.isArray(value)) {
        warnings.set(pathStr, childSchema.kind === 'list' ? 'expected a list' : 'expected a tuple');
      } else if (childSchema.kind === 'tuple' && value.length !== childSchema.size) {
        warnings.set(pathStr, `expected ${childSchema.size} entries`);
      } else if (childSchema.kind === 'scalar' && (isMapping(value) || Array.isArray(value))) {
        warnings.set(pathStr, 'expected a single value');
      } else if (childSchema.kind === 'scalar') {
        if (!(value === null && childSchema.nullable)) {
          const warning = VALUE_KINDS[childSchema.value]?.check(value, childSchema, context) ?? null;
          if (warning) warnings.set(pathStr, warning);
        }
      }
      if (isMapping(value) || Array.isArray(value)) walk(value, childSchema, childPath);
    }
  };
  walk(doc ?? {}, schema ?? null, []);
  return warnings;
}

// --- Pure document mutations (new roots; no-ops return the same reference) ---

// Clones the container chain down to `path`'s parent and returns
// [newRoot, parentContainer], or null when an intermediate step is missing.
function cloneChain(doc, path) {
  const root = Array.isArray(doc) ? [...doc] : { ...doc };
  let cursor = root;
  for (const step of path.slice(0, -1)) {
    const next = cursor[step];
    if (!next || typeof next !== 'object') return null;
    cursor[step] = Array.isArray(next) ? [...next] : { ...next };
    cursor = cursor[step];
  }
  return [root, cursor];
}

/**
 * Returns the value at a document path, or `undefined` when the path is absent.
 *
 * @param {object} doc - Raw config document
 * @param {(string|number)[]} path - Map keys / list indices
 * @returns {*}
 */
export function getAt(doc, path) {
  let cursor = doc;
  for (const step of path) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[step];
  }
  return cursor;
}

/**
 * Sets the value at a document path, returning a new root (`doc` untouched).
 * Setting an absent map key creates it; a broken intermediate path no-ops.
 *
 * @param {object} doc - Raw config document
 * @param {(string|number)[]} path - Destination path (non-empty)
 * @param {*} value - Value to place
 * @returns {object} New root, or the same `doc` on a no-op
 */
export function setValueAt(doc, path, value) {
  if (!path.length) return doc;
  const chain = cloneChain(doc, path);
  if (!chain) return doc;
  const [root, parent] = chain;
  parent[path[path.length - 1]] = value;
  return root;
}

/**
 * Deletes the entry at a document path, returning a new root. List entries are
 * spliced (later indices shift down); map keys are removed.
 *
 * @param {object} doc - Raw config document
 * @param {(string|number)[]} path - Path of the entry to delete (non-empty)
 * @returns {object} New root, or the same `doc` on a no-op
 */
export function deleteAt(doc, path) {
  if (!path.length) return doc;
  const chain = cloneChain(doc, path);
  if (!chain) return doc;
  const [root, parent] = chain;
  const last = path[path.length - 1];
  if (Array.isArray(parent)) {
    if (typeof last !== 'number' || last < 0 || last >= parent.length) return doc;
    parent.splice(last, 1);
  } else {
    if (!(last in parent)) return doc;
    delete parent[last];
  }
  return root;
}

/**
 * Appends an item to the list at a document path, returning a new root.
 * No-ops when the path does not hold an array.
 *
 * @param {object} doc - Raw config document
 * @param {(string|number)[]} path - Path of the target list
 * @param {*} item - Item to append
 * @returns {object} New root, or the same `doc` on a no-op
 */
export function appendItemAt(doc, path, item) {
  const list = path.length ? getAt(doc, path) : doc;
  if (!Array.isArray(list)) return doc;
  return path.length ? setValueAt(doc, path, [...list, item]) : [...doc, item];
}

/**
 * An empty value matching a schema node's shape, used when the builder adds a
 * new entry: maps `{}`, lists `[]`, tuples an array of empty strings, scalars `''`
 * (or `null` when nullable).
 *
 * @param {object|null} schemaNode
 * @returns {*}
 */
export function emptyValueFor(schemaNode) {
  if (schemaNode?.kind === 'map') return {};
  if (schemaNode?.kind === 'list') return [];
  if (schemaNode?.kind === 'tuple') return Array.from({ length: schemaNode.size ?? 0 }, () => '');
  if (schemaNode?.kind === 'scalar' && schemaNode.nullable) return null;
  return '';
}

// --- YAML file I/O ---

const SAVE_TYPES = [{ description: 'Guild Manager config', accept: { 'application/x-yaml': ['.yml', '.yaml'] } }];

/**
 * Serializes a config document to YAML with a generated header. The shipped
 * file's comments are NOT preserved — `yaml.dump` regenerates from data (see
 * docs/gotchas.md).
 *
 * @param {object} doc - Raw config document
 * @returns {string}
 */
export function serializeConfigDoc(doc) {
  const header = '# Guild Manager config — generated export (source comments are not preserved).\n'
    + '# See docs/architecture.md → "Runtime Configuration System".\n';
  return header + yaml.dump(doc ?? {}, { indent: 2, lineWidth: -1 });
}

/**
 * Serializes a config document and writes it to disk via the shared Save As
 * dialog / download fallback. Suggested filename is `<fileId>.yml` so the
 * export drops straight back into `public/config/`.
 *
 * @param {string} fileId - Manifest id of the config file (e.g. `'ui'`)
 * @param {object} doc - Raw config document
 * @returns {Promise<void>}
 */
export function configSave(fileId, doc) {
  return downloadFile(serializeConfigDoc(doc), `${fileId}.yml`, {
    mime: 'application/x-yaml',
    pickerTypes: SAVE_TYPES,
  });
}

/**
 * Reads a YAML file into a raw config document. Rejects only on unparseable
 * YAML or a non-mapping root — schema mismatches load fine and surface as tree
 * warnings (lenient-but-warn, mirroring the tag registry's LOAD contract).
 *
 * @param {File} file - User-picked YAML file
 * @returns {Promise<object>}
 */
export function configLoad(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      let doc;
      try {
        doc = yaml.load(reader.result);
      } catch (err) {
        reject(new Error(`Invalid YAML: ${err.message}`));
        return;
      }
      if (!isMapping(doc)) {
        reject(new Error('Config root must be a YAML mapping.'));
        return;
      }
      resolve(doc);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}
