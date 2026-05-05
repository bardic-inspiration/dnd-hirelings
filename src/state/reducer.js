import { uid, now } from '../utils.js';
import { normalizeState, DEFAULT_STATE } from './storage.js';
import { applyTaskComplete } from '../logic/tasks.js';
import { parseTag } from '../logic/tags.js';

const DEFAULT_AGENT = {
  name: 'NEW HIRELING',
  icon: '',
  rate: 1,
  rateUnit: 'GP/DAY',
  description: '',
  attributes: [],
  activities: [],
};

export function reducer(state, action) {
  switch (action.type) {

    /* ---------- Session ---------- */
    case 'SESSION_UPDATE':
      return { ...state, session: { ...state.session, ...action.payload } };

    /* ---------- Agents ---------- */
    case 'AGENT_CREATE':
      return { ...state, agents: [...state.agents, { id: uid(), ...DEFAULT_AGENT, createdAt: now(), lastAssigned: null }] };

    case 'AGENT_UPDATE':
      return { ...state, agents: state.agents.map(a => a.id !== action.id ? a : { ...a, ...action.changes }) };

    case 'AGENT_DELETE':
      return { ...state, agents: state.agents.filter(a => a.id !== action.id) };

    case 'AGENT_DUPLICATE': {
      const orig = state.agents.find(a => a.id === action.id);
      if (!orig) return state;
      const copy = { ...JSON.parse(JSON.stringify(orig)), id: uid(), activities: [], createdAt: now(), lastAssigned: null };
      return { ...state, agents: [...state.agents, copy] };
    }

    case 'AGENT_ADD_ATTRIBUTE': {
      const incoming = parseTag(action.tag);
      return {
        ...state,
        agents: state.agents.map(a => a.id !== action.id ? a : {
          ...a,
          attributes: [
            ...a.attributes.filter(t => {
              const p = parseTag(t);
              return !(p.type === incoming.type && p.name === incoming.name);
            }),
            action.tag,
          ],
        }),
      };
    }

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

    case 'AGENTS_CLEAR_TASKS':
      return {
        ...state,
        agents: state.agents.map(a => ({
          ...a,
          activities: a.activities.filter(t => !t.startsWith('#task:')),
        })),
      };

    /* ---------- Tasks ---------- */
    case 'TASK_CREATE':
      return {
        ...state,
        tasks: [...state.tasks, {
          id: uid(),
          name: 'NEW TASK',
          description: '',
          requirements: [],
          workProgress: {},
          isComplete: false,
          createdAt: now(),
        }],
      };

    case 'TASK_UPDATE':
      return { ...state, tasks: state.tasks.map(t => t.id !== action.id ? t : { ...t, ...action.changes }) };

    case 'TASK_DELETE': {
      const taskTag = `#task:${action.id}`;
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

    case 'TASK_ADD_REQUIREMENT':
      return {
        ...state,
        tasks: state.tasks.map(t => t.id !== action.id ? t : { ...t, requirements: [...t.requirements, action.tag] }),
      };

    case 'TASK_REMOVE_REQUIREMENT':
      return {
        ...state,
        tasks: state.tasks.map(t => t.id !== action.id ? t : {
          ...t,
          requirements: t.requirements.filter((_, i) => i !== action.index),
        }),
      };

    /* ---------- Inventory ---------- */
    case 'INVENTORY_ADD':
      return { ...state, inventory: [...state.inventory, { id: uid(), name: 'NEW ITEM', qty: 1 }] };

    case 'INVENTORY_UPDATE_ITEM':
      return {
        ...state,
        inventory: state.inventory.map(item => item.id !== action.id ? item : { ...item, ...action.changes }),
      };

    case 'INVENTORY_REMOVE_ITEM':
      return { ...state, inventory: state.inventory.filter(item => item.id !== action.id) };

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
