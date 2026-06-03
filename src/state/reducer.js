import { uid, now } from '../utils.js';
import { normalizeState, DEFAULT_STATE, DEFAULT_RESULTS } from './storage.js';
import { applyTaskComplete } from '../logic/tasks.js';
import { mergeAttribute, buildTag, parseTag } from '../logic/tags.js';
import { collectAllHeldItems, mergeItemQty } from '../logic/agents.js';

const TASK_TAG_FIELDS = new Set(['requirements', 'work', 'attributes']);

const DEFAULT_AGENT = {
  name: 'NEW HIRELING',
  icon: '',
  rate: 1,
  rateUnit: 'GP/DAY',
  description: '',
  attributes: [],
  activities: [],
};

const DEFAULT_ITEM_NAME = 'NEW ITEM';

const DEFAULT_ITEM = {
  name: DEFAULT_ITEM_NAME,
  qty: 1,
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
// fields (id, createdAt, activities, workProgress, isComplete, results) and
// library bookkeeping (source) are never taken from a preset — the create
// actions re-stamp those after spreading the picked fields.
const pickAgentFields = (p) => defined({
  name: p.name, icon: p.icon, rate: p.rate, rateUnit: p.rateUnit,
  description: p.description, attributes: p.attributes,
});
const pickTaskFields = (p) => defined({
  name: p.name, description: p.description,
  requirements: p.requirements, work: p.work, attributes: p.attributes,
});
const pickItemFields = (p) => defined({
  name: p.name, icon: p.icon, qty: p.qty, value: p.value,
  description: p.description, attributes: p.attributes,
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
      out[at] = { ...out[at], qty: out[at].qty + item.qty };
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
      return { ...state, agents: state.agents.map(a => a.id !== action.id ? a : { ...a, ...action.changes }) };

    case 'AGENT_DELETE': {
      const deleted = state.agents.find(a => a.id === action.id);
      if (!deleted) return state;
      const heldItems = collectAllHeldItems(deleted.activities);
      let inventory = state.inventory;
      for (const [name, qty] of Object.entries(heldItems)) {
        const existing = inventory.find(i => i.name.trim().toLowerCase() === name.toLowerCase());
        if (existing) {
          inventory = inventory.map(i => i === existing ? { ...i, qty: i.qty + qty } : i);
        } else {
          inventory = [...inventory, { ...DEFAULT_ITEM, id: uid(), name, qty }];
        }
      }
      return { ...state, agents: state.agents.filter(a => a.id !== action.id), inventory };
    }

    case 'AGENT_DUPLICATE': {
      const orig = state.agents.find(a => a.id === action.id);
      if (!orig) return state;
      const copy = { ...JSON.parse(JSON.stringify(orig)), id: uid(), activities: [], createdAt: now(), lastAssigned: null };
      return { ...state, agents: [...state.agents, copy] };
    }

    case 'AGENT_ADD_ATTRIBUTE':
      return {
        ...state,
        agents: state.agents.map(a => a.id !== action.id ? a : {
          ...a,
          attributes: mergeAttribute(a.attributes, action.tag),
        }),
      };

    case 'AGENT_REMOVE_ATTRIBUTE':
      return {
        ...state,
        agents: state.agents.map(a => a.id !== action.id ? a : {
          ...a,
          attributes: a.attributes.filter((_, i) => i !== action.index),
        }),
      };

    case 'AGENT_ADD_ACTIVITY':
      return {
        ...state,
        agents: state.agents.map(a => a.id !== action.id ? a : {
          ...a,
          activities: [...a.activities, action.tag],
          lastAssigned: now(),
        }),
      };

    case 'AGENT_REMOVE_ACTIVITY':
      return {
        ...state,
        agents: state.agents.map(a => a.id !== action.id ? a : {
          ...a,
          activities: a.activities.filter(t => t !== action.tag),
        }),
      };

    case 'AGENT_GIVE_ITEM': {
      const { id, itemName, qty } = action;
      const src = state.inventory.find(i => i.name.trim().toLowerCase() === itemName.trim().toLowerCase());
      if (!src || src.qty < qty) return state;
      const inventory = src.qty === qty
        ? state.inventory.filter(i => i !== src)
        : state.inventory.map(i => i === src ? { ...i, qty: i.qty - qty } : i);
      const agents = state.agents.map(a => a.id !== id ? a : {
        ...a, activities: mergeItemQty(a.activities, src.name, qty),
      });
      return { ...state, inventory, agents };
    }

    case 'AGENT_RETURN_ITEM': {
      const { id, itemName } = action;
      const agent = state.agents.find(a => a.id === id);
      if (!agent) return state;
      const key = `item:${itemName.toLowerCase()}`;
      const tag = agent.activities.find(t => parseTag(t).segments.join(':').toLowerCase() === key);
      if (!tag) return state;
      const qty = Number(parseTag(tag).value) || 1;
      const agents = state.agents.map(a => a.id !== id ? a : {
        ...a, activities: a.activities.filter(t => t !== tag),
      });
      const existing = state.inventory.find(i => i.name.trim().toLowerCase() === itemName.trim().toLowerCase());
      const inventory = existing
        ? state.inventory.map(i => i === existing ? { ...i, qty: i.qty + qty } : i)
        : [...state.inventory, { ...DEFAULT_ITEM, id: uid(), name: itemName, qty }];
      return { ...state, agents, inventory };
    }

    case 'EQUIP_ITEM': {
      const { id, itemName, slot } = action;
      const agents = state.agents.map(a => {
        if (a.id !== id) return a;
        const activities = mergeItemQty(a.activities, itemName, -1);
        const equipTag = buildTag(['equip', slot, 'item', itemName]);
        return { ...a, activities: mergeAttribute(activities, equipTag) };
      });
      return { ...state, agents };
    }

    case 'UNEQUIP_ITEM': {
      const { id, slot, itemName } = action;
      const agents = state.agents.map(a => {
        if (a.id !== id) return a;
        const equipTag = buildTag(['equip', slot, 'item', itemName]);
        const without = a.activities.filter(t => t !== equipTag);
        return { ...a, activities: mergeItemQty(without, itemName, 1) };
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
          work: [],
          attributes: [],
          ...(action.preset ? pickTaskFields(action.preset) : null),
          id: uid(),
          workProgress: {},
          results: { ...DEFAULT_RESULTS, items: [], agents: [] },
          isComplete: false,
          createdAt: now(),
        }],
      };

    case 'TASK_UPDATE':
      return { ...state, tasks: state.tasks.map(t => t.id !== action.id ? t : { ...t, ...action.changes }) };

    case 'TASK_DELETE': {
      const taskTag = `task:${action.id}`;
      return {
        ...state,
        tasks: state.tasks.filter(t => t.id !== action.id),
        agents: state.agents.map(a => ({ ...a, activities: a.activities.filter(act => act !== taskTag) })),
      };
    }

    case 'TASK_DUPLICATE': {
      const orig = state.tasks.find(t => t.id === action.id);
      if (!orig) return state;
      const copy = { ...JSON.parse(JSON.stringify(orig)), id: uid(), workProgress: {}, isComplete: false, createdAt: now() };
      return { ...state, tasks: [...state.tasks, copy] };
    }

    case 'TASK_SET_COMPLETE': {
      const { id, isComplete } = action;
      if (!isComplete) {
        return { ...state, tasks: state.tasks.map(t => t.id !== id ? t : { ...t, isComplete: false }) };
      }
      const task = state.tasks.find(t => t.id === id);
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

    case 'TASK_ADD_TAG': {
      const { field } = action;
      if (!TASK_TAG_FIELDS.has(field)) return state;
      return {
        ...state,
        tasks: state.tasks.map(t => t.id !== action.id ? t : { ...t, [field]: [...(t[field] || []), action.tag] }),
      };
    }

    case 'TASK_REMOVE_TAG': {
      const { field } = action;
      if (!TASK_TAG_FIELDS.has(field)) return state;
      return {
        ...state,
        tasks: state.tasks.map(t => t.id !== action.id ? t : {
          ...t,
          [field]: (t[field] || []).filter((_, i) => i !== action.index),
        }),
      };
    }

    case 'TASK_UPDATE_RESULTS':
      return {
        ...state,
        tasks: state.tasks.map(t => t.id !== action.id ? t : {
          ...t,
          results: { ...(t.results || DEFAULT_RESULTS), ...action.changes },
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

    case 'INVENTORY_ADD_ATTRIBUTE':
      return {
        ...state,
        inventory: state.inventory.map(item => item.id !== action.id ? item : {
          ...item,
          attributes: mergeAttribute(item.attributes, action.tag),
        }),
      };

    case 'INVENTORY_REMOVE_ATTRIBUTE':
      return {
        ...state,
        inventory: state.inventory.map(item => item.id !== action.id ? item : {
          ...item,
          attributes: item.attributes.filter((_, i) => i !== action.index),
        }),
      };

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
