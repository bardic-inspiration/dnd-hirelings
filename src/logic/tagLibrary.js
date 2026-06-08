// Tag Library: the live, editable registry of every tag *structure* available
// in the game (no payloads/values) — the "skeleton" of a game's ruleset. Serves
// as the source of structure that the future closed/config mode collapses into a
// single YAML file. This module owns the keys-only nested model, its YAML I/O
// (built on js-yaml), the security validator, and the pure tree mutations.

import yaml from 'js-yaml';
import { TAG_REGISTRY, parseTag } from './tags.js';

// A valid tag segment / library key: lowercase letters, digits, '-' or '_'.
const SEGMENT_RE = /^[a-z0-9_-]+$/;

const isLeaf = (node) =>
  node === null || node === undefined || node === '' ||
  (typeof node === 'object' && !Array.isArray(node) && Object.keys(node).length === 0);

// Deep-clones a registry/library tree into a keys-only structure, dropping any
// 'label' metadata. Leaves are {}. Used to seed a fresh library from TAG_REGISTRY.
export function registryToLibrary(registry = TAG_REGISTRY) {
  const out = {};
  for (const [key, node] of Object.entries(registry)) {
    if (key === 'label') continue;
    out[key] = node && typeof node === 'object' ? registryToLibrary(node) : {};
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

// Serializes the library to YAML. js-yaml renders empty-object leaves as "key: {}";
// we strip the "{}" so leaves read as bare "key:" (the spec's nested-list format).
export function serializeLibrary(library) {
  const dumped = yaml.dump(library ?? {}, { sortKeys: true, indent: 2, lineWidth: -1 });
  return dumped === '{}\n' ? '' : dumped.replace(/: \{\}$/gm, ':');
}

export function parseLibrary(ymlString) {
  return normalizeNode(yaml.load(ymlString));
}

// --- tagLibCheck: security validator ---

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
      return { valid: false, error: `Invalid value at "${here}" — the library may only contain nested keys, no values or lists.` };
    }
    const res = checkNode(child, [...path, key]);
    if (!res.valid) return res;
  }
  return { valid: true, error: null };
}

// Loops through a YAML string and confirms it is a nested list matching the tag
// format rules and that every line is valid. js-yaml throws on malformed YAML and
// on duplicate sibling keys, which we surface as validation errors.
export function tagLibCheck(ymlString) {
  let parsed;
  try {
    parsed = yaml.load(ymlString);
  } catch (err) {
    return { valid: false, error: 'Malformed YAML: ' + err.message };
  }
  if (parsed === null || parsed === undefined) return { valid: true, error: null }; // empty library
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'The library must be a nested list of tag keys.' };
  }
  return checkNode(parsed, []);
}

// --- Tree mutations (pure; return new objects) ---

const normSegs = (segments) => segments.map(s => String(s).toLowerCase().trim()).filter(Boolean);

// Adds a tag path into the library, creating intermediate nodes. Returns the SAME
// reference when the full path already exists, so reducers can no-op cheaply.
export function addTagToLibrary(library, tagString) {
  const segments = parseTag(tagString).segments; // drops modifier + value
  const segs = normSegs(segments);
  if (!segs.length) return library;
  let cur = library;
  let exists = true;
  for (const seg of segs) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) {
      cur = cur[seg];
    } else { exists = false; break; }
  }
  return exists ? library : addPath(library, segs);
}

export function addPath(library, segments) {
  const segs = normSegs(segments);
  if (!segs.length) return library;
  const root = { ...library };
  let cur = root;
  for (const seg of segs) {
    const existing = cur[seg];
    const next = existing && typeof existing === 'object' ? { ...existing } : {};
    cur[seg] = next;
    cur = next;
  }
  return root;
}

export function deleteNode(library, segments) {
  const segs = normSegs(segments);
  if (!segs.length) return library;
  const root = { ...library };
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const node = cur[segs[i]];
    if (!node || typeof node !== 'object') return library; // path absent
    cur[segs[i]] = { ...node };
    cur = cur[segs[i]];
  }
  if (!(segs[segs.length - 1] in cur)) return library;
  delete cur[segs[segs.length - 1]];
  return root;
}

export function renameNode(library, segments, newKey) {
  const segs = normSegs(segments);
  const key = String(newKey).toLowerCase().trim();
  if (!segs.length || !key) return library;
  const root = { ...library };
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const node = cur[segs[i]];
    if (!node || typeof node !== 'object') return library;
    cur[segs[i]] = { ...node };
    cur = cur[segs[i]];
  }
  const oldKey = segs[segs.length - 1];
  if (!(oldKey in cur) || key === oldKey) return library;
  const children = cur[oldKey];
  delete cur[oldKey];
  cur[key] = children; // preserve subtree under the new key
  return root;
}

// --- File I/O (mirrors src/logic/session.js) ---

const SAVE_TYPES = [{ description: 'Tag library config', accept: { 'application/x-yaml': ['.yml', '.yaml'] } }];

// tagLibSave: writes the current library as YAML; default name "[sessionID]-config.yml".
export async function tagLibSave(library, sessionId) {
  const yml = serializeLibrary(library);
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

// tagLibLoad: reads a YAML file, loads it only if tagLibCheck passes; else rejects
// (the caller leaves the library untouched — "pass").
export function tagLibLoad(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const { valid, error } = tagLibCheck(r.result);
      if (!valid) { reject(new Error(error)); return; }
      resolve(parseLibrary(r.result));
    };
    r.onerror = () => reject(new Error('Failed to read file.'));
    r.readAsText(file);
  });
}
