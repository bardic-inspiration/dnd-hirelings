// Tag UI system — maps configurable card UI elements (medallion, boxes, bars,
// fields, values) to tag-value sources, replacing hardcoded attribute displays.
// The config lives in public/config/tagUI.yml (runtime-fetched by
// hooks/useTagUIConfig.js); this module is the pure tier: config parsing,
// source resolution, and consumed-tag bookkeeping.
import yaml from 'js-yaml';
import { parseTag, buildTag, mergeAttribute } from './tags.js';

/** An element list set with nothing assigned — the shape every card config normalizes to. */
export const EMPTY_CARD_CONFIG = Object.freeze({
  medallion: null,
  boxes: Object.freeze([]),
  bars: Object.freeze([]),
  fields: Object.freeze([]),
  values: Object.freeze([]),
  slots: Object.freeze([]),
});

// Sources under the `dynamic:` namespace — computed stats from
// computeDynamicAttributes rather than authored tags. `key` names the field on
// the computed object; `set` (optional) converts an edited display value into
// an AGENT_UPDATE changes object, making the source writable.
const DYNAMIC_SOURCE_REGISTRY = {
  'level':      { key: 'level' },
  'hp':         { key: 'hp',    set: (value) => ({ hp: Math.max(0, value) }) },
  'hp-max':     { key: 'hpMax' },
  'xp':         { key: 'xp',    set: (value) => ({ xp: Math.max(0, value) }) },
  // Editing per-level XP rebases the raw total around the current level threshold.
  'xp-lvl':     { key: 'xpLvl', set: (value, dyn) => ({ xp: Math.max(0, dyn.xp - dyn.xpLvl + value) }) },
  'xp-lvl-max': { key: 'xpLvlMax' },
  'ac':         { key: 'ac' },
  'pb':         { key: 'proficiency' },
};

// Bare (single-segment) sources that read/write a scalar field on the agent
// object itself. `unitField` names a sibling text field rendered as an
// editable unit suffix (e.g. rate's "gp/day").
const AGENT_FIELD_SOURCES = {
  rate: { set: (value) => ({ rate: value }), unitField: 'rateUnit' },
};

/** Known `dynamic:<key>` source keys, exposed for schema autocomplete/validation. */
export const DYNAMIC_SOURCE_KEYS = Object.freeze(Object.keys(DYNAMIC_SOURCE_REGISTRY));

/** Known bare agent-field source names, exposed for schema autocomplete/validation. */
export const AGENT_FIELD_SOURCE_KEYS = Object.freeze(Object.keys(AGENT_FIELD_SOURCES));

/**
 * Config-editor schema for `public/config/tagUI.yml` (see logic/configEditor.js
 * for the descriptor grammar). Any card name is a valid key under `cards:`, but
 * each card's element set is closed — unknown elements draw a soft warning in
 * the Configuration Modal without being rejected.
 */
export const TAG_UI_SCHEMA = {
  kind: 'map',
  closed: true,
  keys: {
    cards: {
      kind: 'map',
      anyKey: {
        kind: 'map',
        closed: true,
        keys: {
          medallion: { kind: 'scalar', value: 'tagSource', nullable: true },
          boxes:     { kind: 'list', item: { kind: 'scalar', value: 'tagSource' } },
          bars:      { kind: 'list', item: { kind: 'tuple', size: 2, item: { kind: 'scalar', value: 'tagSource' } } },
          fields:    { kind: 'list', item: { kind: 'scalar', value: 'tagSource' } },
          values:    { kind: 'list', item: { kind: 'scalar', value: 'tagSource' } },
          slots:     { kind: 'list', item: { kind: 'scalar', value: 'slug' } },
        },
      },
    },
  },
};

// Normalizes one bar entry into a [current, max] source tuple. Accepts a
// two-element list or the spec's string form "(current, max)". Anything else
// still yields a tuple (of empty strings) so the element renders — and flags
// itself invalid — rather than silently disappearing.
function normalizeBarEntry(entry) {
  if (Array.isArray(entry)) {
    return [String(entry[0] ?? ''), String(entry[1] ?? '')];
  }
  if (typeof entry === 'string') {
    const match = entry.match(/^\s*\(\s*"?([^",)]*)"?\s*,\s*"?([^",)]*)"?\s*\)\s*$/);
    if (match) return [match[1].trim(), match[2].trim()];
    return [entry.trim(), ''];
  }
  return ['', ''];
}

// Normalizes a config list of source strings, coercing scalars and dropping
// structural garbage (objects/arrays can't name a source).
function normalizeSourceList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(entry => entry !== null && typeof entry !== 'object')
    .map(String);
}

/**
 * Normalizes a parsed tag UI config document (plain object from `yaml.load`)
 * into per-card element assignments.
 *
 * Lenient by design — the file is a deployed, user-editable asset, so
 * malformed sections degrade to empty element lists instead of throwing.
 * Bar entries accept both `[current, max]` lists and `"(current, max)"`
 * strings. Unknown or unresolvable sources are kept: resolution (not parsing)
 * decides validity, so a bad source renders its element in the warning state.
 * `slots` is a plain string list of bind slot names (lowercased).
 *
 * @param {object} root - Raw config document (e.g. from `yaml.load` or the config overlay)
 * @returns {{ cards: Object<string, typeof EMPTY_CARD_CONFIG> }} Normalized
 *   config; `cards` maps card names (e.g. `agentCard`) to element assignments
 */
export function normalizeTagUIDoc(root) {
  const isMapping = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const cardsIn = isMapping(root) && isMapping(root.cards) ? root.cards : {};
  const cards = {};
  for (const [cardName, card] of Object.entries(cardsIn)) {
    if (!isMapping(card)) { cards[cardName] = EMPTY_CARD_CONFIG; continue; }
    cards[cardName] = {
      medallion: typeof card.medallion === 'string' && card.medallion.trim() ? card.medallion.trim() : null,
      boxes: normalizeSourceList(card.boxes),
      bars: Array.isArray(card.bars) ? card.bars.map(normalizeBarEntry) : [],
      fields: normalizeSourceList(card.fields),
      values: normalizeSourceList(card.values),
      // Bind slot names for the card's item slots (see AGENT_BIND_ITEM). Lowercased
      // so they compose cleanly into `bind:<slot>:item:<name>` tag paths.
      slots: normalizeSourceList(card.slots).map(slot => slot.trim().toLowerCase()).filter(Boolean),
    };
  }
  return { cards };
}

/**
 * Parses tag UI YAML text into normalized per-card element assignments.
 * Thin wrapper over `normalizeTagUIDoc` for callers holding raw YAML.
 *
 * @param {string} ymlText - Raw YAML text of a tag UI config
 * @returns {{ cards: Object<string, typeof EMPTY_CARD_CONFIG> }}
 * @throws {Error} If the text is not parseable YAML (caller decides fallback)
 */
export function parseTagUIConfig(ymlText) {
  return normalizeTagUIDoc(yaml.load(ymlText));
}

/**
 * Resolves a config source string to a numeric value on one agent.
 *
 * Source grammar (matched in order):
 * 1. `dynamic:<key>` — computed stat from `DYNAMIC_SOURCE_REGISTRY`
 * 2. `<field>` — bare agent scalar field from `AGENT_FIELD_SOURCES`
 * 3. `<seg>:<seg>...` — attribute tag path, matched case-insensitively against
 *    the agent's effective (bonus-applied) plain attributes; uses its `=value`
 *
 * A source is `valid` only when it yields a finite number; per the config
 * contract, invalid sources display no value and flash the warning color.
 *
 * @param {string} source - Source string from the tag UI config
 * @param {object} context - Per-agent resolution context
 * @param {Agent} context.agent - The agent (raw fields + raw attributes)
 * @param {object} context.dyn - Output of `computeDynamicAttributes(agent, …)`
 * @param {string[]} context.attributes - The agent's effective attribute tags
 * @returns {{
 *   label: string,
 *   value: number|null,
 *   valid: boolean,
 *   set: ((value: number) => object)|null,
 *   unitField: string|null
 * }} `label` is the last path segment uppercased; `set` (when writable) maps a
 *   new value to an `AGENT_UPDATE` changes object; `unitField` names an
 *   editable unit sibling field, if any
 */
export function resolveTagSource(source, { agent, dyn, attributes }) {
  const segments = parseTag(source).segments.map(segment => segment.toLowerCase());
  const label = (segments[segments.length - 1] ?? '').toUpperCase();
  const invalid = { label, value: null, valid: false, set: null, unitField: null };
  if (!segments.length) return invalid;

  if (segments[0] === 'dynamic') {
    const entry = DYNAMIC_SOURCE_REGISTRY[segments[1]];
    if (!entry || segments.length !== 2) return invalid;
    const value = dyn[entry.key];
    return {
      label,
      value: Number.isFinite(value) ? value : null,
      valid: Number.isFinite(value),
      set: entry.set ? (newValue) => entry.set(newValue, dyn) : null,
      unitField: null,
    };
  }

  if (segments.length === 1 && AGENT_FIELD_SOURCES[segments[0]]) {
    const entry = AGENT_FIELD_SOURCES[segments[0]];
    const value = agent[segments[0]];
    return {
      label,
      value: Number.isFinite(value) ? value : null,
      valid: Number.isFinite(value),
      set: entry.set,
      unitField: entry.unitField ?? null,
    };
  }

  const path = segments.join(':');
  for (const tag of attributes) {
    const parsed = parseTag(tag);
    if (parsed.modifier) continue;
    if (parsed.segments.join(':').toLowerCase() !== path) continue;
    const value = parsed.value !== null && parsed.value !== '' ? Number(parsed.value) : NaN;
    if (!Number.isFinite(value)) return invalid;
    return {
      label,
      value,
      valid: true,
      // Writes back to the raw attribute list; the incoming value replaces the
      // tag's authored value (bonus-applied display deltas are not unwound).
      set: (newValue) => ({ attributes: mergeAttribute(agent.attributes, buildTag(segments, newValue)) }),
      unitField: null,
    };
  }
  return invalid;
}

/**
 * Collects every source path a card config displays, as lowercase tag paths.
 *
 * Used to keep configured attributes out of the generic tag-chip list: per the
 * config contract, tags mentioned in the config render through their assigned
 * element, and only unmentioned tags render as chips.
 *
 * @param {typeof EMPTY_CARD_CONFIG} cardConfig - One card's element assignments
 * @returns {Set<string>} Lowercase `seg:seg` paths of all configured sources
 */
export function getConsumedTagPaths(cardConfig) {
  const sources = [
    ...(cardConfig.medallion ? [cardConfig.medallion] : []),
    ...cardConfig.boxes,
    ...cardConfig.bars.flat(),
    ...cardConfig.fields,
    ...cardConfig.values,
  ];
  const paths = new Set();
  for (const source of sources) {
    const segments = parseTag(source).segments;
    if (segments.length) paths.add(segments.join(':').toLowerCase());
  }
  return paths;
}

/**
 * Returns true if a tag is displayed by a configured card element and should
 * therefore be omitted from the generic tag-chip list.
 *
 * Only plain (modifier-less) tags are ever consumed — `req,`/`bonus,` tags
 * carry relational semantics the value elements don't express.
 *
 * @param {string} tag - Raw tag string from an agent's attribute list
 * @param {Set<string>} consumedPaths - Output of `getConsumedTagPaths`
 * @returns {boolean}
 */
export function isTagConsumed(tag, consumedPaths) {
  const parsed = parseTag(tag);
  if (parsed.modifier) return false;
  return consumedPaths.has(parsed.segments.join(':').toLowerCase());
}
