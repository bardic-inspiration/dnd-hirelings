import { MODIFIER_REGISTRY } from '../logic/tags.js';
import { seedTagRegistry } from '../logic/tagRegistry.js';

export const STORAGE_KEY = 'dnd-hirelings-state-v3';
export const PALETTE_KEY = 'dnd-hirelings-palette';

export const DEFAULT_RESULTS = { gold: 0, items: [], agents: [] };

// Default state structure for the application
export const DEFAULT_STATE = {
  session: {
    id: '001',
    title: 'GUILD MANAGER',
    clock: 0,
    timeStep: '1',
    bank: 100,
    rateMultiplier: 1,
    workRate: 1,
    skillBonus: 1
  },
  agents: [],
  tasks: [],
  inventory: [],
  tagRegistry: seedTagRegistry(),
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
      ? src.items.map(it => ({ name: String(it?.name ?? ''), qty: Number(it?.qty) || 0 })).filter(it => it.name)
      : [],
    agents: Array.isArray(src.agents)
      ? src.agents.map(a => ({
          template: {
            name:        a?.template?.name        ?? 'NEW HIRELING',
            icon:        a?.template?.icon        ?? '',
            rate:        a?.template?.rate        ?? 1,
            rateUnit:    a?.template?.rateUnit    ?? 'GP/DAY',
            description: a?.template?.description ?? '',
            attributes:  Array.isArray(a?.template?.attributes) ? a.template.attributes : [],
          },
          qty: Number(a?.qty) || 1,
        }))
      : [],
  };
}

// Migrates tag strings from older formats to the current grammar.
function migrateTag(t) {
  if (typeof t !== 'string') return t;
  // Strip legacy '#' sigil from pre-path-based format.
  if (t.startsWith('#')) t = t.slice(1);
  // Migrate modifier:path to modifier,path (comma separator introduced in v4 grammar).
  for (const mod of Object.keys(MODIFIER_REGISTRY)) {
    if (t.startsWith(`${mod}:`)) return `${mod},${t.slice(mod.length + 1)}`;
  }
  return t;
}

// Normalizes a raw state object (e.g. from localStorage) to ensure all required fields are present and have valid values
export function normalizeState(raw) {
  const state = { ...DEFAULT_STATE, ...raw };
  state.agents = (raw.agents || []).map(a => ({
    ...a,
    attributes:   (a.attributes  ?? []).map(migrateTag),
    activities:   (a.activities  ?? []).map(migrateTag),
    description:  a.description  ?? '',
    icon:         a.icon         ?? '',
    createdAt:    a.createdAt    ?? Date.now(),
    lastAssigned: a.lastAssigned ?? null,
    xp:           a.xp           ?? 0,
    hp:           a.hp           ?? null,
  }));
  state.inventory = (raw.inventory || []).map(item => ({
    id:          item.id   ?? Math.random().toString(36).slice(2, 9),
    name:        item.name ?? 'ITEM',
    qty:         Number(item.qty)   || 1,
    icon:        item.icon        ?? '',
    description: item.description  ?? '',
    value:       Number(item.value) || 0,
    attributes:  Array.isArray(item.attributes) ? item.attributes.map(migrateTag) : [],
  }));
  state.tasks = (raw.tasks || []).map(t => ({
    ...t,
    requirements: Array.isArray(t.requirements) ? t.requirements.filter(Boolean).map(migrateTag) : [],
    work:         Array.isArray(t.work)         ? t.work.filter(Boolean).map(migrateTag)         : [],
    attributes:   Array.isArray(t.attributes)   ? t.attributes.filter(Boolean).map(migrateTag)   : [],
    description:  t.description  ?? '',
    isComplete:   t.isComplete   ?? false,
    createdAt:    t.createdAt    ?? Date.now(),
    workProgress: t.workProgress ?? {},
    results:      normalizeResults(t.results),
  }));
  // `tagLibrary` is the pre-rename field name; read it as a fallback so sessions
  // saved before the rename keep their registry.
  state.tagRegistry = sanitizeRegistry(raw.tagRegistry ?? raw.tagLibrary) ?? seedTagRegistry();
  const s = raw.session || {};
  const tsNum = parseFloat(s.timeStep ?? '0');
  state.session = {
    ...DEFAULT_STATE.session,
    ...s,
    timeStep:       (isNaN(tsNum) || tsNum >= 30) ? '1' : (s.timeStep ?? '1'),
    rateMultiplier: s.rateMultiplier ?? 1,
    workRate:       s.workRate       ?? 1,
    skillBonus:     s.skillBonus     ?? 1,
    bank:           s.bank           ?? 100,
    title:          s.title          ?? 'GUILD MANAGER',
  };
  return state;
}

// Loads state from localStorage, or returns default state if not found or on error
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return normalizeState(JSON.parse(raw));
  } catch {
    return DEFAULT_STATE;
  }
}

// Saves the given state to localStorage as a JSON string
export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
