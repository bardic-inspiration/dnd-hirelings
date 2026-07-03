import { MODIFIER_REGISTRY } from '../logic/tags.js';
import { seedTagRegistry } from '../logic/tagRegistry.js';
import { normalizeCondition, migrateLegacyWork } from '../logic/conditions.js';
import { normalizeEvent, normalizeLoggingConfig, DEFAULT_LOGGING_CONFIG } from '../logic/eventLog.js';

/**
 * Central registry of every localStorage key the app reads or writes.
 * Versioning strategy: all keys carry a version suffix; bump the suffix when
 * the stored format changes (not on every release). Migration code must be added
 * alongside any suffix bump.
 * v4: `task.work`/`task.workProgress` replaced by `task.conditions`. `loadState`
 * falls back to the v3 key; `normalizeState` migrates the legacy fields.
 */
export const STORAGE_KEYS = {
  STATE:        'dnd-hirelings-state-v4',
  STATE_LEGACY: 'dnd-hirelings-state-v3',
  PALETTE: 'dnd-hirelings-palette-v1',
  /** @param {string} type - 'agents' | 'tasks' | 'items' */
  PRESETS: (type) => `dnd-hirelings-presets-${type}-v1`,
  CARD_EXPANSION: 'dnd-hirelings-card-expansion-v1',
  OPEN_LIBRARY: 'dnd-hirelings-open-library-v1',
};

/** Library modal types whose open state is persisted across refresh. */
const LIBRARY_TYPES = ['agent', 'task', 'item'];

/**
 * Loads which library modal (if any) was open, so it can be reopened after a
 * page refresh (issue #81). Unknown or corrupt values yield null (no modal).
 *
 * @returns {'agent'|'task'|'item'|null}
 */
export function loadOpenLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OPEN_LIBRARY);
    return LIBRARY_TYPES.includes(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Persists which library modal is open (or clears it when none is). Best-effort:
 * storage errors are swallowed so a full/blocked quota never breaks the UI.
 *
 * @param {'agent'|'task'|'item'|null} type - Library type, or null to clear
 */
export function saveOpenLibrary(type) {
  try {
    if (LIBRARY_TYPES.includes(type)) localStorage.setItem(STORAGE_KEYS.OPEN_LIBRARY, type);
    else localStorage.removeItem(STORAGE_KEYS.OPEN_LIBRARY);
  } catch {
    // ignore quota / availability errors — persistence is best-effort
  }
}

/** Card types tracked by the expansion store; keys of a persisted deviation map. */
const CARD_TYPES = ['agent', 'task', 'item'];

/**
 * Loads the persisted card-expansion deviation map from localStorage.
 * Each entry is the set of entity IDs whose expand/collapse state has been
 * toggled away from its type's default (see `CARD_DEFAULT_EXPANDED` in UIContext).
 * Missing, malformed, or corrupt data yields empty Sets so the UI falls back to
 * per-type defaults.
 *
 * @returns {{ agent: Set<string>, task: Set<string>, item: Set<string> }}
 */
export function loadCardExpansion() {
  const empty = () => Object.fromEntries(CARD_TYPES.map(type => [type, new Set()]));
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CARD_EXPANSION);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    return Object.fromEntries(CARD_TYPES.map(type => [
      type,
      new Set(Array.isArray(parsed?.[type]) ? parsed[type] : []),
    ]));
  } catch {
    return empty();
  }
}

/**
 * Persists the card-expansion deviation map to localStorage, serializing each
 * Set as an array.
 *
 * @param {{ agent: Set<string>, task: Set<string>, item: Set<string> }} deviations
 */
export function saveCardExpansion(deviations) {
  const serialized = Object.fromEntries(
    CARD_TYPES.map(type => [type, [...(deviations[type] ?? [])]]),
  );
  localStorage.setItem(STORAGE_KEYS.CARD_EXPANSION, JSON.stringify(serialized));
}

export const DEFAULT_RESULTS = { gold: 0, items: [], agents: [] };

// Default state structure for the application
export const DEFAULT_STATE = {
  session: {
    id: '001',
    title: 'GUILD MANAGER',
    clock: 0,
    timeStep: 1,
    bank: 100,
    rateMultiplier: 1,
    workRate: 1,
    skillBonus: 1,
    logging: { ...DEFAULT_LOGGING_CONFIG },
  },
  agents: [],
  tasks: [],
  inventory: [],
  tagRegistry: seedTagRegistry(),
  eventLog: [],
};

// Guards a raw tagRegistry from storage/import: keeps only a pure object-of-objects
// tree so corrupt data can't poison the live structure. Returns null on mismatch.
function sanitizeRegistry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = (node) => {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : {};
    }
    return out;
  };
  return clean(raw);
}

function normalizeResults(r) {
  const src = r && typeof r === 'object' ? r : {};
  const gold = Number(src.gold);
  return {
    gold: Number.isFinite(gold) ? gold : 0,
    items: Array.isArray(src.items)
      ? src.items.map(item => ({
          name: String(item?.name ?? ''),
          quantity: Number(item?.quantity ?? item?.qty) || 0,
        })).filter(item => item.name)
      : [],
    agents: Array.isArray(src.agents)
      ? src.agents.map(spawn => ({
          template: {
            name:        spawn?.template?.name        ?? 'NEW HIRELING',
            icon:        spawn?.template?.icon        ?? '',
            rate:        spawn?.template?.rate        ?? 1,
            rateUnit:    spawn?.template?.rateUnit    ?? 'GP/DAY',
            description: spawn?.template?.description ?? '',
            attributes:  Array.isArray(spawn?.template?.attributes) ? spawn.template.attributes : [],
          },
          quantity: Number(spawn?.quantity ?? spawn?.qty) || 1,
        }))
      : [],
  };
}

// Migrates tag strings from older formats to the current grammar.
export function migrateTag(tag) {
  if (typeof tag !== 'string') return tag;
  // Strip legacy '#' sigil from pre-path-based format.
  if (tag.startsWith('#')) tag = tag.slice(1);
  // Rename the legacy `equip:` namespace to `bind:` (equip→bind refactor). Keeps
  // already-equipped items bound after the upgrade.
  if (tag.startsWith('equip:')) tag = `bind:${tag.slice('equip:'.length)}`;
  // Migrate modifier:path to modifier,path (comma separator introduced in v4 grammar).
  for (const mod of Object.keys(MODIFIER_REGISTRY)) {
    if (tag.startsWith(`${mod}:`)) return `${mod},${tag.slice(mod.length + 1)}`;
  }
  return tag;
}

/**
 * Normalizes a raw state object to the current schema.
 *
 * Handles:
 * - Missing fields (filled from `DEFAULT_STATE`)
 * - Legacy tag formats (`#tag` → `tag`, `modifier:path` → `modifier,path`, `equip:` → `bind:`)
 * - `tagLibrary` → `tagRegistry` field rename
 * - Corrupt or missing `tagRegistry` (falls back to `seedTagRegistry()`)
 * - `qty` → `quantity` field rename on inventory items and task result items
 * - `timeStep` coerced to a number (legacy string values are parsed); out-of-range clamped
 * - Legacy `task.work` tags + `task.workProgress` buckets migrated to `task.conditions`
 *   via `migrateLegacyWork` (v3 → v4); the deprecated `work` namespace is pruned from
 *   stored tag registries
 * - Missing `eventLog` (saves predating the event-log feature) defaults to `[]`; rows
 *   are guarded via `normalizeEvent` and any lacking a `taskId` are dropped
 * - `session.logging` is guarded via `normalizeLoggingConfig` (defaults to
 *   `DEFAULT_LOGGING_CONFIG`); a minimal stub today (`enabled`, `maxRows`)
 *
 * @param {object} raw - Potentially stale or partial state from localStorage or a file
 * @returns {GameState}
 */
export function normalizeState(raw) {
  const state = { ...DEFAULT_STATE, ...raw };
  state.agents = (raw.agents || []).map(agent => ({
    ...agent,
    attributes:   (agent.attributes  ?? []).map(migrateTag),
    activities:   (agent.activities  ?? []).map(migrateTag),
    description:  agent.description  ?? '',
    icon:         agent.icon         ?? '',
    createdAt:    agent.createdAt    ?? Date.now(),
    lastAssigned: agent.lastAssigned ?? null,
    xp:           agent.xp           ?? 0,
    hp:           agent.hp           ?? null,
  }));
  state.inventory = (raw.inventory || []).map(item => ({
    id:          item.id   ?? Math.random().toString(36).slice(2, 9),
    name:        item.name ?? 'ITEM',
    quantity:    Number(item.quantity ?? item.qty) || 1,
    icon:        item.icon        ?? '',
    description: item.description  ?? '',
    value:       Number(item.value) || 0,
    attributes:  Array.isArray(item.attributes) ? item.attributes.map(migrateTag) : [],
  }));
  state.tasks = (raw.tasks || []).map(task => {
    const { work, workProgress, ...rest } = task;
    return {
      ...rest,
      requirements: Array.isArray(task.requirements) ? task.requirements.filter(Boolean).map(migrateTag) : [],
      attributes:   Array.isArray(task.attributes)   ? task.attributes.filter(Boolean).map(migrateTag)   : [],
      description:  task.description  ?? '',
      isComplete:   task.isComplete   ?? false,
      createdAt:    task.createdAt    ?? Date.now(),
      conditions:   Array.isArray(task.conditions)
        ? task.conditions.map(normalizeCondition)
        : migrateLegacyWork(Array.isArray(work) ? work.filter(Boolean).map(migrateTag) : [], workProgress),
      results:      normalizeResults(task.results),
    };
  });
  // `tagLibrary` is the pre-rename field name; read it as a fallback so sessions
  // saved before the rename keep their registry.
  state.tagRegistry = sanitizeRegistry(raw.tagRegistry ?? raw.tagLibrary) ?? seedTagRegistry();
  // The `work` namespace was replaced by the conditions system; prune it from
  // stored registries so deprecated work tags can't be re-authored.
  delete state.tagRegistry.work;
  // The `equip` namespace was renamed to `bind`; migrate stored registries so the
  // old slot-name children carry over and no stale `equip` namespace lingers.
  if (state.tagRegistry.equip) {
    state.tagRegistry.bind = { ...state.tagRegistry.equip, ...(state.tagRegistry.bind ?? {}) };
    delete state.tagRegistry.equip;
  }
  const s = raw.session || {};
  // `timeStep` is stored as a number (days per tick). Legacy sessions persisted it
  // as a string, so coerce here; clamp out-of-range or non-numeric values to 1.
  const tsNum = parseFloat(s.timeStep);
  state.session = {
    ...DEFAULT_STATE.session,
    ...s,
    timeStep:       (isNaN(tsNum) || tsNum <= 0 || tsNum >= 30) ? 1 : tsNum,
    rateMultiplier: s.rateMultiplier ?? 1,
    workRate:       s.workRate       ?? 1,
    skillBonus:     s.skillBonus     ?? 1,
    bank:           s.bank           ?? 100,
    title:          s.title          ?? 'GUILD MANAGER',
    logging:        normalizeLoggingConfig(s.logging),
  };
  // Event log defaults to empty for saves that predate the feature; rows are
  // guarded and any missing a taskId are dropped.
  state.eventLog = Array.isArray(raw.eventLog)
    ? raw.eventLog.map(normalizeEvent).filter(Boolean)
    : [];
  return state;
}

/**
 * Loads and normalizes state from localStorage.
 * Falls back to the legacy v3 key (migrated by `normalizeState`) so existing
 * saves survive the v4 bump. Returns `DEFAULT_STATE` on first run or if the
 * stored value is corrupt.
 *
 * @returns {GameState}
 */
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STATE) ?? localStorage.getItem(STORAGE_KEYS.STATE_LEGACY);
    if (!raw) return DEFAULT_STATE;
    return normalizeState(JSON.parse(raw));
  } catch {
    return DEFAULT_STATE;
  }
}

/**
 * Persists the full game state to localStorage. Called after every state change
 * via a `useEffect` in `GameProvider`.
 *
 * @param {GameState} state
 */
export function saveState(state) {
  localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
}
