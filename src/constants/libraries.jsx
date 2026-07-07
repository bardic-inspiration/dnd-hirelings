// Per-type configuration for the generic LibraryModal. Adding a new object type
// to the library system means adding one entry here plus a preview component —
// the modal shell, storage hook, and file I/O are all type-agnostic.

import { STORAGE_KEYS, migrateTag } from '../state/storage.js';
import { normalizeConditionTemplate, migrateLegacyWorkTemplates } from '../logic/conditions.js';
import AgentPreview from '../components/Modals/previews/AgentPreview.jsx';
import TaskPreview from '../components/Modals/previews/TaskPreview.jsx';
import ItemPreview from '../components/Modals/previews/ItemPreview.jsx';

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
// Preset tag arrays are legacy data too: run each through the same grammar
// migration state uses (strips the legacy `#` sigil, `equip:`→`bind:`, etc.) so
// presets display and instantiate in the current format regardless of source.
const tags = (v) => (Array.isArray(v) ? v.filter(tag => typeof tag === 'string' && tag).map(migrateTag) : []);

// A loaded entry must carry a non-empty string name to be a real preset.
// Entries that don't are bypassed (usePresets drops normalize() results that
// throw), so a malformed file degrades to "import the valid entries" rather
// than spawning blank placeholders.
const requireName = (raw) => {
  const name = raw?.name;
  if (typeof name !== 'string' || !name.trim()) throw new Error('preset missing name');
  return name;
};

export const LIBRARY_CONFIGS = {
  agent: {
    type: 'agent',
    label: 'HIRELINGS',
    storageKey: STORAGE_KEYS.PRESETS('agents'),
    bundledUrl: '/presets/agent_presets.json',
    panelClass: 'library-panel',
    makeBlank: () => ({ name: 'NEW HIRELING', icon: '', rate: 1, rateUnit: 'GP/DAY', description: '', attributes: [] }),
    // Stats (xp, hp, abilities, dyn expressions) live in `attributes` as
    // ordinary tags since v6; a legacy preset `xp` field is dropped on load.
    normalize: (raw) => ({
      name:        requireName(raw),
      icon:        str(raw?.icon),
      rate:        num(raw?.rate, 1),
      rateUnit:    str(raw?.rateUnit, 'GP/DAY'),
      description: str(raw?.description),
      attributes:  tags(raw?.attributes),
    }),
    rowIcon: (p) => p.icon,
    Preview: AgentPreview,
    toCreateAction: (preset, count = 1) => ({ type: 'AGENT_CREATE', preset, count }),
  },

  task: {
    type: 'task',
    label: 'TASKS',
    storageKey: STORAGE_KEYS.PRESETS('tasks'),
    bundledUrl: '/presets/task_presets.json',
    panelClass: 'library-panel',
    makeBlank: () => ({ name: 'NEW TASK', description: '', requirements: [], conditions: [], attributes: [] }),
    normalize: (raw) => ({
      name:         requireName(raw),
      description:  str(raw?.description),
      requirements: tags(raw?.requirements),
      // Presets store condition templates (no id/progress). Legacy preset files
      // carry `work` tag arrays instead; migrate them on load.
      conditions:   Array.isArray(raw?.conditions)
        ? raw.conditions.map(normalizeConditionTemplate)
        : migrateLegacyWorkTemplates(tags(raw?.work)),
      attributes:   tags(raw?.attributes),
    }),
    rowIcon: () => '',
    Preview: TaskPreview,
    toCreateAction: (preset, count = 1) => ({ type: 'TASK_CREATE', preset, count }),
  },

  item: {
    type: 'item',
    label: 'ITEMS',
    storageKey: STORAGE_KEYS.PRESETS('items'),
    bundledUrl: '/presets/item_presets.json',
    panelClass: 'library-panel library-panel--wide',
    makeBlank: () => ({ name: 'NEW ITEM', icon: '', quantity: 1, value: 0, description: '', attributes: [] }),
    normalize: (raw) => ({
      name:        requireName(raw),
      icon:        str(raw?.icon),
      quantity:    num(raw?.quantity ?? raw?.qty, 1),
      value:       num(raw?.value, 0),
      description: str(raw?.description),
      attributes:  tags(raw?.attributes),
    }),
    rowIcon: (p) => p.icon,
    Preview: ItemPreview,
    toCreateAction: (preset, count = 1) => ({ type: 'INVENTORY_ADD', preset, count }),
  },
};
