import { uid, now } from '../utils.js';
import { normalizeState, DEFAULT_STATE, DEFAULT_RESULTS } from './storage.js';
import { applyTaskComplete, routeTaskTag } from '../logic/tasks.js';
import { mergeAttribute, buildTag, parseTag } from '../logic/tags.js';
import { addTagToRegistry, addPath, deleteNode, renameNode } from '../logic/tagRegistry.js';
import { conditionFromTemplate } from '../logic/conditions.js';
import { collectAllHeldItems, mergeItemQty } from '../logic/agents.js';

// Registers any newly authored tag structures into the live tag registry. Returns
// the same state reference when every path already exists, so it never forces an
// extra render. Removing a tag in game never prunes the registry (only the Tag
// Registry manager does); dynamic item-instance tags (equip/give) are intentionally
// not registered to avoid polluting the skeleton with per-item names.
const registerTags = (state, ...tags) => {
  let reg = state.tagRegistry;
  for (const tag of tags) reg = addTagToRegistry(reg, tag);
  return reg === state.tagRegistry ? state : { ...state, tagRegistry: reg };
};

const TASK_TAG_FIELDS = new Set(['requirements', 'attributes']);

const DEFAULT_AGENT = {
  name: 'NEW HIRELING',
  icon: '',
  rate: 1,
  rateUnit: 'GP/DAY',
  description: '',
  attributes: [],
  activities: [],
  xp: 0,
  hp: null,
};

const DEFAULT_ITEM_NAME = 'NEW ITEM';

const DEFAULT_ITEM = {
  name: DEFAULT_ITEM_NAME,
  quantity: 1,
  icon: '',
  description: '',
  value: 0,
  attributes: [],
};

// Merges any items sharing a case-insensitive name into the first occurrence,
// summing quantities. Keeps the surviving item's other fields. Used so renaming
// or adding an item with an existing name pools quantities instead of duplicating.
// Unnamed placeholders (the default "NEW ITEM") are never merged, so freshly
// added items stay distinct until the player gives them a real name.
// Drops keys whose value is undefined, so a preset that omits a field falls
// back to the object default rather than overwriting it with undefined.
const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// Whitelist the fields a preset may contribute to a new board object. Runtime
// fields (id, createdAt, activities, isComplete, results) and library
// bookkeeping (source) are never taken from a preset — the create actions
// re-stamp those after spreading the picked fields. Preset conditions are
// templates; TASK_CREATE stamps them into live instances separately.
const pickAgentFields = (preset) => defined({
  name: preset.name, icon: preset.icon, rate: preset.rate, rateUnit: preset.rateUnit,
  description: preset.description, attributes: preset.attributes,
});
const pickTaskFields = (preset) => defined({
  name: preset.name, description: preset.description,
  requirements: preset.requirements, attributes: preset.attributes,
});
const pickItemFields = (preset) => defined({
  name: preset.name, icon: preset.icon, quantity: preset.quantity, value: preset.value,
  description: preset.description, attributes: preset.attributes,
});

function mergeInventoryByName(inventory) {
  const out = [];
  const indexByName = new Map();
  for (const item of inventory) {
    const key = item.name.trim().toLowerCase();
    const at = key === DEFAULT_ITEM_NAME.toLowerCase() ? undefined : indexByName.get(key);
    if (at === undefined) {
      indexByName.set(key, out.length);
      out.push({ ...item });
    } else {
      out[at] = { ...out[at], quantity: out[at].quantity + item.quantity };
    }
  }
  return out;
}

export function reducer(state, action) {
  switch (action.type) {

    /* ---------- Session ---------- */
    case 'SESSION_UPDATE':
      return { ...state, session: { ...state.session, ...action.payload } };

    /* ---------- Agents ---------- */
    case 'AGENT_CREATE':
      return { ...state, agents: [...state.agents, {
        ...DEFAULT_AGENT,
        ...(action.preset ? pickAgentFields(action.preset) : null),
        id: uid(), createdAt: now(), lastAssigned: null, activities: [],
      }] };

    case 'AGENT_UPDATE':
      return { ...state, agents: state.agents.map(agent => agent.id !== action.id ? agent : { ...agent, ...action.changes }) };

    case 'AGENT_DELETE': {
      const deleted = state.agents.find(agent => agent.id === action.id);
      if (!deleted) return state;
      const heldItems = collectAllHeldItems(deleted.activities);
      let inventory = state.inventory;
      for (const [name, quantity] of Object.entries(heldItems)) {
        const existing = inventory.find(item => item.name.trim().toLowerCase() === name.toLowerCase());
        if (existing) {
          inventory = inventory.map(item => item === existing ? { ...item, quantity: item.quantity + quantity } : item);
        } else {
          inventory = [...inventory, { ...DEFAULT_ITEM, id: uid(), name, quantity }];
        }
      }
      return { ...state, agents: state.agents.filter(agent => agent.id !== action.id), inventory };
    }

    case 'AGENT_DUPLICATE': {
      const orig = state.agents.find(agent => agent.id === action.id);
      if (!orig) return state;
      const copy = { ...JSON.parse(JSON.stringify(orig)), id: uid(), activities: [], createdAt: now(), lastAssigned: null };
      return { ...state, agents: [...state.agents, copy] };
    }

    case 'AGENT_REMOVE_ATTRIBUTE':
      return {
        ...state,
        agents: state.agents.map(agent => agent.id !== action.id ? agent : {
          ...agent,
          attributes: agent.attributes.filter((_, index) => index !== action.index),
        }),
      };

    case 'AGENT_ADD_ACTIVITY':
      // Activities are task assignments (`task:<id>`) — dynamic instance refs, not
      // authored structure, so they are not registered into the library.
      return {
        ...state,
        agents: state.agents.map(agent => agent.id !== action.id ? agent : {
          ...agent,
          activities: [...agent.activities, action.tag],
          lastAssigned: now(),
        }),
      };

    case 'AGENT_REMOVE_ACTIVITY':
      return {
        ...state,
        agents: state.agents.map(agent => agent.id !== action.id ? agent : {
          ...agent,
          activities: agent.activities.filter(tag => tag !== action.tag),
        }),
      };

    case 'ITEM_PLACE': {
      // Unified "place item somewhere" path: a selected inventory item is pulled
      // from stock and routed by target type. `bank` sells (value → gold) and
      // `agent` gives (item → bag); both share the same draw-from-inventory step,
      // mirroring TAG_APPLY's single assignment path. Drawing more than is in
      // stock is clamped, so an over-large right-click quantity gives all of it.
      const { target, itemId } = action;
      const src = state.inventory.find(item => item.id === itemId);
      if (!src || src.quantity <= 0) return state;
      const quantity = Math.min(Math.max(1, action.quantity ?? 1), src.quantity);
      // Depleted items stay in the list (grayed) rather than being removed.
      const inventory = state.inventory.map(item =>
        item === src ? { ...item, quantity: item.quantity - quantity } : item);
      if (target.type === 'agent') {
        const agents = state.agents.map(agent => agent.id !== target.id ? agent : {
          ...agent, activities: mergeItemQty(agent.activities, src.name, quantity),
        });
        return { ...state, inventory, agents };
      }
      if (target.type === 'bank') {
        const bankDelta = (src.value || 0) * quantity;
        return { ...state, inventory, session: { ...state.session, bank: (state.session.bank ?? 0) + bankDelta } };
      }
      return state;
    }

    case 'AGENT_RETURN_ITEM': {
      const { id, itemName } = action;
      const agent = state.agents.find(agent => agent.id === id);
      if (!agent) return state;
      const key = `item:${itemName.toLowerCase()}`;
      const tag = agent.activities.find(tag => parseTag(tag).segments.join(':').toLowerCase() === key);
      if (!tag) return state;
      const quantity = Number(parseTag(tag).value) || 1;
      const agents = state.agents.map(agent => agent.id !== id ? agent : {
        ...agent, activities: agent.activities.filter(activityTag => activityTag !== tag),
      });
      const existing = state.inventory.find(item => item.name.trim().toLowerCase() === itemName.trim().toLowerCase());
      const inventory = existing
        ? state.inventory.map(item => item === existing ? { ...item, quantity: item.quantity + quantity } : item)
        : [...state.inventory, { ...DEFAULT_ITEM, id: uid(), name: itemName, quantity }];
      return { ...state, agents, inventory };
    }

    case 'AGENT_EQUIP_ITEM': {
      const { id, itemName, slot } = action;
      const agents = state.agents.map(agent => {
        if (agent.id !== id) return agent;
        const activities = mergeItemQty(agent.activities, itemName, -1);
        const equipTag = buildTag(['equip', slot, 'item', itemName]);
        return { ...agent, activities: mergeAttribute(activities, equipTag) };
      });
      return { ...state, agents };
    }

    case 'AGENT_UNEQUIP_ITEM': {
      const { id, slot, itemName } = action;
      const agents = state.agents.map(agent => {
        if (agent.id !== id) return agent;
        const equipTag = buildTag(['equip', slot, 'item', itemName]);
        const without = agent.activities.filter(tag => tag !== equipTag);
        return { ...agent, activities: mergeItemQty(without, itemName, 1) };
      });
      return { ...state, agents };
    }

    /* ---------- Tasks ---------- */
    case 'TASK_CREATE':
      return {
        ...state,
        tasks: [...state.tasks, {
          name: 'NEW TASK',
          description: '',
          requirements: [],
          attributes: [],
          ...(action.preset ? pickTaskFields(action.preset) : null),
          id: uid(),
          conditions: (action.preset?.conditions ?? []).map(conditionFromTemplate),
          results: { ...DEFAULT_RESULTS, items: [], agents: [] },
          isComplete: false,
          createdAt: now(),
        }],
      };

    case 'TASK_UPDATE':
      return { ...state, tasks: state.tasks.map(task => task.id !== action.id ? task : { ...task, ...action.changes }) };

    case 'TASK_DELETE': {
      const taskTag = `task:${action.id}`;
      return {
        ...state,
        tasks: state.tasks.filter(task => task.id !== action.id),
        agents: state.agents.map(agent => ({ ...agent, activities: agent.activities.filter(act => act !== taskTag) })),
      };
    }

    case 'TASK_DUPLICATE': {
      const orig = state.tasks.find(task => task.id === action.id);
      if (!orig) return state;
      const copy = {
        ...JSON.parse(JSON.stringify(orig)),
        id: uid(),
        // Re-stamp conditions: fresh ids, zero progress.
        conditions: (orig.conditions || []).map(conditionFromTemplate),
        isComplete: false,
        createdAt: now(),
      };
      return { ...state, tasks: [...state.tasks, copy] };
    }

    case 'TASK_SET_COMPLETE': {
      const { id, isComplete } = action;
      if (!isComplete) {
        return { ...state, tasks: state.tasks.map(task => task.id !== id ? task : { ...task, isComplete: false }) };
      }
      const task = state.tasks.find(task => task.id === id);
      if (!task || task.isComplete) return state;
      const { newTasks, newAgents, newInventory, bankDelta } = applyTaskComplete(id, state.tasks, state.agents, state.inventory);
      return {
        ...state,
        tasks: newTasks,
        agents: newAgents,
        inventory: newInventory,
        session: { ...state.session, bank: (state.session.bank ?? 0) + bankDelta },
      };
    }

    case 'TASK_REMOVE_TAG': {
      const { field } = action;
      if (!TASK_TAG_FIELDS.has(field)) return state;
      return {
        ...state,
        tasks: state.tasks.map(task => task.id !== action.id ? task : {
          ...task,
          [field]: (task[field] || []).filter((_, index) => index !== action.index),
        }),
      };
    }

    case 'TASK_CONDITION_ADD': {
      const condition = conditionFromTemplate(action.template);
      const next = {
        ...state,
        tasks: state.tasks.map(task => task.id !== action.id ? task : {
          ...task,
          conditions: [...(task.conditions || []), condition],
        }),
      };
      // A plain tracker tagPath is a valid tag string; register it so the
      // registry's usage counts and deletion warnings cover condition links.
      // Pattern paths (wildcards/escapes) are skipped — `*` is not a valid
      // registry key, and a pattern names a match, not a structure node.
      const tagPath = condition.tracker.tagPath;
      return tagPath && !/[\\*]/.test(tagPath) ? registerTags(next, tagPath) : next;
    }

    case 'TASK_CONDITION_UPDATE':
      return {
        ...state,
        tasks: state.tasks.map(task => task.id !== action.id ? task : {
          ...task,
          conditions: (task.conditions || []).map(condition =>
            condition.id !== action.conditionId ? condition : { ...condition, ...action.changes }),
        }),
      };

    case 'TASK_CONDITION_REMOVE':
      return {
        ...state,
        tasks: state.tasks.map(task => task.id !== action.id ? task : {
          ...task,
          conditions: (task.conditions || []).filter(condition => condition.id !== action.conditionId),
        }),
      };

    case 'TASK_UPDATE_RESULTS':
      return {
        ...state,
        tasks: state.tasks.map(task => task.id !== action.id ? task : {
          ...task,
          results: { ...(task.results || DEFAULT_RESULTS), ...action.changes },
        }),
      };

    /* ---------- Inventory ---------- */
    case 'INVENTORY_ADD':
      return { ...state, inventory: [...state.inventory, {
        ...DEFAULT_ITEM,
        ...(action.preset ? pickItemFields(action.preset) : null),
        id: uid(),
      }] };

    case 'INVENTORY_UPDATE_ITEM': {
      const next = state.inventory.map(item => item.id !== action.id ? item : { ...item, ...action.changes });
      // Renaming may collide with an existing item; pool quantities by name.
      return { ...state, inventory: 'name' in action.changes ? mergeInventoryByName(next) : next };
    }

    case 'INVENTORY_REMOVE_ITEM':
      return { ...state, inventory: state.inventory.filter(item => item.id !== action.id) };

    case 'INVENTORY_REMOVE_ATTRIBUTE':
      return {
        ...state,
        inventory: state.inventory.map(item => item.id !== action.id ? item : {
          ...item,
          attributes: item.attributes.filter((_, index) => index !== action.index),
        }),
      };

    /* ---------- Tags ---------- */
    // Applies a tag to any board entity; the single assignment path for the tag
    // registry's APPLY button and selection mode. Routing into a field is the
    // entity's concern: tasks sort by modifier via `routeTaskTag` (`req`/`block`
    // → requirements) and APPEND; agents/items always take attributes and
    // dedupe-merge by path (`mergeAttribute`) — the historical asymmetry between
    // task tag lists and attribute lists is preserved deliberately.
    case 'TAG_APPLY': {
      const { target, tag } = action;
      let next = state;
      if (target.type === 'agent') {
        next = {
          ...state,
          agents: state.agents.map(agent => agent.id !== target.id ? agent : {
            ...agent,
            attributes: mergeAttribute(agent.attributes, tag),
          }),
        };
      } else if (target.type === 'item') {
        next = {
          ...state,
          inventory: state.inventory.map(item => item.id !== target.id ? item : {
            ...item,
            attributes: mergeAttribute(item.attributes, tag),
          }),
        };
      } else if (target.type === 'task') {
        const field = routeTaskTag(tag);
        next = {
          ...state,
          tasks: state.tasks.map(task => task.id !== target.id ? task : {
            ...task,
            [field]: [...(task[field] || []), tag],
          }),
        };
      }
      return next === state ? state : registerTags(next, tag);
    }

    /* ---------- Tag Registry ---------- */
    case 'TAGREG_ADD_PATH':
      return { ...state, tagRegistry: addPath(state.tagRegistry, action.segments) };

    case 'TAGREG_DELETE_NODE':
      return { ...state, tagRegistry: deleteNode(state.tagRegistry, action.segments) };

    case 'TAGREG_RENAME_NODE':
      return { ...state, tagRegistry: renameNode(state.tagRegistry, action.segments, action.name) };

    case 'TAGREG_REPLACE':
      return { ...state, tagRegistry: action.registry };

    /* ---------- Bulk ---------- */
    case 'APPLY_TICK':
      return action.newState;

    case 'REPLACE_STATE':
      return normalizeState(action.newState);

    case 'RESET':
      return { ...DEFAULT_STATE };

    default:
      return state;
  }
}
