// Task-engine actions (docs/spec/task-engine.md "Actions") — the one effect
// primitive. `ACTION_REGISTRY` maps a kind to how it applies to the world
// and how rollback reverses it. Effects never re-dispatch reducer actions:
// `applyActions` folds every action into one new world, so a tick stays one
// atomic, logged step.
//
// A world is the slice of game state actions touch:
// `{ agents, tasks, inventory, session, tagRegistry }`. Every function here
// returns a new world and never mutates its input.

import { parseTag, buildTag, mergeAttribute } from './tags.js';
import { matchTagPath } from './tagMatching.js';
import { getEffectiveAttributes } from './agents.js';
import { addTagToRegistry, collectPresetTags, unregisteredEntityTags } from './tagRegistry.js';
import { lowerTask } from './taskModel.js';
import { uid, now } from '../utils.js';

// Rounds a bank amount to whole cents, matching the wage math.
const roundGold = (amount) => Math.round(amount * 100) / 100;

const taskTag = (taskId) => buildTag(['task', taskId]);

// Identity of a tag for merge/remove: modifier + lowercase path, as `mergeAttribute` keys it.
const tagIdentity = (tag) => {
  const parsed = parseTag(tag);
  return (parsed.modifier ? `${parsed.modifier},` : '') + parsed.segments.join(':').toLowerCase();
};

const mapTask = (world, taskId, update) => ({
  ...world,
  tasks: world.tasks.map(task => (task.id === taskId ? update(task) : task)),
});

const mapAgents = (world, agentIds, update) => {
  const ids = new Set(agentIds);
  return { ...world, agents: world.agents.map(agent => (ids.has(agent.id) ? update(agent) : agent)) };
};

const findStock = (inventory, name) =>
  inventory.find(item => item.name.toLowerCase() === String(name).toLowerCase());

const newAgent = (template = {}) => ({
  id: uid(),
  name:        template.name        || 'NEW HIRELING',
  icon:        template.icon        || '',
  rate:        template.rate        ?? 1,
  rateUnit:    template.rateUnit    || 'GP/DAY',
  description: template.description || '',
  attributes:  Array.isArray(template.attributes) ? [...template.attributes] : [],
  activities:  [],
  createdAt:   now(),
  lastAssigned: null,
});

/**
 * Resolves an action's selector to agent ids, in board order.
 * - `{ scope: 'assigned', match? }` (the default) — agents assigned to the
 *   action's task; `match` keeps those with an effective attribute matching
 *   the pattern (`open` mode, modifier tags excluded).
 * - `{ scope: 'operator', operatorId, outcome }` — agents whose outcome at
 *   that operator this tick was `outcome` (`'pass'` | `'fail'`).
 * - `{ scope: 'entity', id }` — that agent.
 * Missing agents are skipped; an unknown scope selects nobody.
 *
 * @param {object} world
 * @param {object|undefined} selector
 * @param {{ taskId: string, outcomes?: object }} ctx
 * @returns {string[]}
 */
export function resolveSelector(world, selector, ctx) {
  const { scope = 'assigned' } = selector ?? {};
  if (scope === 'assigned') {
    const tag = taskTag(ctx.taskId);
    return world.agents
      .filter(agent => agent.activities.includes(tag))
      .filter(agent => !selector?.match || getEffectiveAttributes(agent.attributes, agent.activities, world.inventory)
        .some(attribute => {
          const parsed = parseTag(attribute);
          return !parsed.modifier && matchTagPath(selector.match, parsed.segments, { mode: 'open' });
        }))
      .map(agent => agent.id);
  }
  if (scope === 'operator') {
    const ids = new Set(ctx.outcomes?.[selector.operatorId]?.[selector.outcome] ?? []);
    return world.agents.filter(agent => ids.has(agent.id)).map(agent => agent.id);
  }
  if (scope === 'entity') {
    return world.agents.some(agent => agent.id === selector.id) ? [selector.id] : [];
  }
  return [];
}

// Replaces the agent's tag at `identity` with `replacement` (or removes it).
const restoreTag = (attributes, identity, replacement) => {
  const without = attributes.filter(tag => tagIdentity(tag) !== identity);
  return replacement ? [...without, replacement] : without;
};

// Restores each agent's pre-image tag recorded in `reverseData.before`.
const reverseTagWrite = (world, row) => {
  const { identity, before = {} } = row.reverseData ?? {};
  return mapAgents(world, Object.keys(before), agent => ({
    ...agent, attributes: restoreTag(agent.attributes, identity, before[agent.id]),
  }));
};

// Removes the given agents from the world.
const removeAgents = (world, agentIds) => {
  const ids = new Set(agentIds ?? []);
  return { ...world, agents: world.agents.filter(agent => !ids.has(agent.id)) };
};

// Reverses a blackboard write by restoring its pre-image.
const restoreFlag = (world, row) => {
  const { taskId, key, had, previous } = row.reverseData ?? {};
  return mapTask(world, taskId ?? row.taskId, task => {
    const blackboard = { ...task.blackboard };
    if (had) blackboard[key] = previous;
    else delete blackboard[key];
    return { ...task, blackboard };
  });
};

const flagPreImage = (world, taskId, key) => {
  const task = world.tasks.find(task => task.id === taskId);
  const had = Boolean(task) && Object.prototype.hasOwnProperty.call(task.blackboard ?? {}, key);
  return { taskId, key, had, previous: had ? task.blackboard[key] : null };
};

const DEFAULT_ITEM = { name: 'NEW ITEM', quantity: 1, icon: '', description: '', value: 0, attributes: [] };

const CREATORS = {
  item: (template) => ({ ...DEFAULT_ITEM, ...template, id: uid() }),
  agent: (template) => newAgent(template),
  task: (template) => lowerTask({
    name: 'NEW TASK', description: '', requirements: [], attributes: [],
    ...template, id: uid(), isComplete: false, createdAt: now(),
  }),
};

const COLLECTIONS = { item: 'inventory', agent: 'agents', task: 'tasks' };

/**
 * Maps an action kind to its implementation:
 * - `apply(world, params, ctx)` → `{ world, deltas, reverseData }`;
 *   `deltas: null` means the action changed nothing and is not recorded.
 * - `reverse(world, row)` → world, or `null` for an irreversible kind.
 * - `category` — the `rollback.yml` `reverse.*` switch that gates the reverse.
 * - `tagWrites(params)` — `{ entityType, preset }` for kinds that write tags,
 *   checked against locked mode.
 *
 * @type {Object<string, object>}
 */
export const ACTION_REGISTRY = {
  'vessel.deposit': {
    category: 'workProgress',
    apply: (world, { vessel, amount }, ctx) => ({
      world: mapTask(world, ctx.taskId, task => ({
        ...task, blackboard: { ...task.blackboard, [vessel]: (Number(task.blackboard?.[vessel]) || 0) + amount },
      })),
      deltas: { vessel, amount },
      reverseData: {},
    }),
    // Its rows are `work_contribution` rows: the vessel is `conditionId`, the amount `delta`.
    reverse: (world, row) => mapTask(world, row.taskId, task => {
      if (!task.vessels?.[row.conditionId]) return task;
      const fill = Number(task.blackboard?.[row.conditionId]) || 0;
      return { ...task, blackboard: { ...task.blackboard, [row.conditionId]: Math.max(0, fill - (Number(row.delta) || 0)) } };
    }),
  },

  'bank.adjust': {
    category: 'rewardGold',
    apply: (world, { amount }) => {
      const value = Number(amount) || 0;
      return {
        world: { ...world, session: { ...world.session, bank: (world.session.bank ?? 0) + value } },
        deltas: { amount: value },
        reverseData: {},
      };
    },
    reverse: (world, row) => {
      const amount = Number(row.data?.deltas?.amount) || 0;
      return { ...world, session: { ...world.session, bank: Math.max(0, roundGold((world.session.bank ?? 0) - amount)) } };
    },
  },

  'inventory.add': {
    category: 'rewardItems',
    apply: (world, { name, quantity }) => {
      const count = Number(quantity) || 0;
      if (!name || count <= 0) return { world, deltas: null, reverseData: {} };
      const stock = findStock(world.inventory, name);
      const inventory = stock
        ? world.inventory.map(item => (item === stock ? { ...item, quantity: item.quantity + count } : item))
        : [...world.inventory, { id: uid(), name, quantity: count, icon: '', description: '', value: 0, attributes: [] }];
      return { world: { ...world, inventory }, deltas: { name, quantity: count }, reverseData: {} };
    },
    reverse: (world, row) => {
      const { name, quantity } = row.data?.deltas ?? {};
      const stock = name ? findStock(world.inventory, name) : null;
      if (!stock) return world;
      return {
        ...world,
        inventory: world.inventory.map(item => (item === stock ? { ...item, quantity: Math.max(0, item.quantity - (Number(quantity) || 0)) } : item)),
      };
    },
  },

  'inventory.remove': {
    category: 'rewardItems',
    apply: (world, { name, quantity }) => {
      const stock = name ? findStock(world.inventory, name) : null;
      const removed = stock ? Math.min(stock.quantity, Math.max(0, Number(quantity) || 0)) : 0;
      if (!removed) return { world, deltas: null, reverseData: {} };
      return {
        world: { ...world, inventory: world.inventory.map(item => (item === stock ? { ...item, quantity: item.quantity - removed } : item)) },
        deltas: { name, quantity: removed },
        reverseData: {},
      };
    },
    reverse: (world, row) => {
      const { name, quantity } = row.data?.deltas ?? {};
      const stock = name ? findStock(world.inventory, name) : null;
      if (!stock) return world;
      return { ...world, inventory: world.inventory.map(item => (item === stock ? { ...item, quantity: item.quantity + (Number(quantity) || 0) } : item)) };
    },
  },

  'agent.spawn': {
    category: 'spawnedAgents',
    tagWrites: ({ template }) => ({ entityType: 'agent', preset: { attributes: template?.attributes ?? [] } }),
    apply: (world, { template, quantity }) => {
      const count = Math.max(0, Math.floor(Number(quantity) || 0));
      const spawned = Array.from({ length: count }, () => newAgent(template));
      if (!spawned.length) return { world, deltas: null, reverseData: {} };
      return {
        world: { ...world, agents: [...world.agents, ...spawned] },
        deltas: { agentIds: spawned.map(agent => agent.id) },
        reverseData: {},
      };
    },
    reverse: (world, row) => removeAgents(world, row.data?.deltas?.agentIds),
  },

  'agent.remove': {
    // Irreversible: a removed agent stays removed through rollback, and the
    // items it held are not returned.
    apply: (world, { selector }, ctx) => {
      const agentIds = resolveSelector(world, selector, ctx);
      if (!agentIds.length) return { world, deltas: null, reverseData: {} };
      return { world: removeAgents(world, agentIds), deltas: { agentIds }, reverseData: {} };
    },
    reverse: null,
  },

  'agent.assign': {
    category: 'agentReassignment',
    apply: (world, { selector, taskId }, ctx) => {
      const target = taskId ?? ctx.taskId;
      const tag = taskTag(target);
      const agentIds = resolveSelector(world, selector, ctx)
        .filter(id => !world.agents.find(agent => agent.id === id).activities.includes(tag));
      if (!agentIds.length) return { world, deltas: null, reverseData: {} };
      return {
        world: mapAgents(world, agentIds, agent => ({ ...agent, activities: [...agent.activities, tag] })),
        deltas: { agentIds, taskId: target },
        reverseData: {},
      };
    },
    reverse: (world, row) => {
      const { agentIds, taskId } = row.data?.deltas ?? {};
      const tag = taskTag(taskId);
      return mapAgents(world, agentIds ?? [], agent => ({ ...agent, activities: agent.activities.filter(act => act !== tag) }));
    },
  },

  'agent.unassign': {
    category: 'agentReassignment',
    apply: (world, { selector, taskId }, ctx) => {
      const target = taskId ?? ctx.taskId;
      const tag = taskTag(target);
      const agentIds = resolveSelector(world, selector, { ...ctx, taskId: target })
        .filter(id => world.agents.find(agent => agent.id === id).activities.includes(tag));
      if (!agentIds.length) return { world, deltas: null, reverseData: {} };
      return {
        world: mapAgents(world, agentIds, agent => ({ ...agent, activities: agent.activities.filter(act => act !== tag) })),
        deltas: { agentIds, taskId: target },
        reverseData: {},
      };
    },
    reverse: (world, row) => {
      const { agentIds, taskId } = row.data?.deltas ?? {};
      if (!world.tasks.some(task => task.id === taskId)) return world;
      const tag = taskTag(taskId);
      return mapAgents(world, agentIds ?? [], agent =>
        (agent.activities.includes(tag) ? agent : { ...agent, activities: [...agent.activities, tag] }));
    },
  },

  'tag.apply': {
    tagWrites: ({ tag }) => ({ entityType: 'agent', preset: { attributes: [tag] } }),
    apply: (world, { selector, tag }, ctx) => {
      const agentIds = typeof tag === 'string' && tag ? resolveSelector(world, selector, ctx) : [];
      if (!agentIds.length) return { world, deltas: null, reverseData: {} };
      const identity = tagIdentity(tag);
      const before = Object.fromEntries(agentIds.map(id => [id,
        world.agents.find(agent => agent.id === id).attributes.find(attribute => tagIdentity(attribute) === identity) ?? null]));
      return {
        world: mapAgents(world, agentIds, agent => ({ ...agent, attributes: mergeAttribute(agent.attributes, tag) })),
        deltas: { agentIds, tag },
        reverseData: { identity, before },
      };
    },
    reverse: reverseTagWrite,
  },

  'tag.remove': {
    apply: (world, { selector, tag }, ctx) => {
      const identity = typeof tag === 'string' && tag ? tagIdentity(tag) : null;
      const agentIds = identity ? resolveSelector(world, selector, ctx)
        .filter(id => world.agents.find(agent => agent.id === id).attributes.some(attribute => tagIdentity(attribute) === identity)) : [];
      if (!agentIds.length) return { world, deltas: null, reverseData: {} };
      const before = Object.fromEntries(agentIds.map(id => [id,
        world.agents.find(agent => agent.id === id).attributes.find(attribute => tagIdentity(attribute) === identity)]));
      return {
        world: mapAgents(world, agentIds, agent => ({ ...agent, attributes: restoreTag(agent.attributes, identity, null) })),
        deltas: { agentIds, tag },
        reverseData: { identity, before },
      };
    },
    reverse: reverseTagWrite,
  },

  'tag.adjust': {
    tagWrites: ({ path }) => ({ entityType: 'agent', preset: { attributes: [path] } }),
    apply: (world, { selector, path, by }, ctx) => {
      const step = Number(by) || 0;
      const agentIds = typeof path === 'string' && path && step ? resolveSelector(world, selector, ctx) : [];
      if (!agentIds.length) return { world, deltas: null, reverseData: {} };
      const segments = parseTag(path).segments;
      const identity = tagIdentity(path);
      const before = {};
      const next = mapAgents(world, agentIds, agent => {
        const current = agent.attributes.find(attribute => tagIdentity(attribute) === identity) ?? null;
        before[agent.id] = current;
        const value = (Number(current ? parseTag(current).value : 0) || 0) + step;
        const adjusted = buildTag(current ? parseTag(current).segments : segments, value);
        return {
          ...agent,
          attributes: current
            ? agent.attributes.map(attribute => (attribute === current ? adjusted : attribute))
            : [...agent.attributes, adjusted],
        };
      });
      return { world: next, deltas: { agentIds, path, by: step }, reverseData: { identity, before } };
    },
    reverse: reverseTagWrite,
  },

  'flag.set': {
    apply: (world, { key, value, taskId }, ctx) => {
      const target = taskId ?? ctx.taskId;
      if (typeof key !== 'string' || !key || !world.tasks.some(task => task.id === target)) return { world, deltas: null, reverseData: {} };
      const reverseData = flagPreImage(world, target, key);
      return {
        world: mapTask(world, target, task => ({ ...task, blackboard: { ...task.blackboard, [key]: value } })),
        deltas: { key, value },
        reverseData,
      };
    },
    reverse: restoreFlag,
  },

  'flag.clear': {
    apply: (world, { key, taskId }, ctx) => {
      const target = taskId ?? ctx.taskId;
      const reverseData = flagPreImage(world, target, key);
      if (!reverseData.had) return { world, deltas: null, reverseData: {} };
      return {
        world: mapTask(world, target, task => {
          const { [key]: _cleared, ...blackboard } = task.blackboard;
          return { ...task, blackboard };
        }),
        deltas: { key },
        reverseData,
      };
    },
    reverse: restoreFlag,
  },

  'object.create': {
    tagWrites: ({ kind, template }) => ({ entityType: kind, preset: template ?? {} }),
    apply: (world, { kind, template }) => {
      const create = CREATORS[kind];
      if (!create) return { world, deltas: null, reverseData: {} };
      const created = create(template ?? {});
      const collection = COLLECTIONS[kind];
      return {
        world: { ...world, [collection]: [...world[collection], created] },
        deltas: { kind, id: created.id },
        reverseData: {},
      };
    },
    reverse: (world, row) => {
      const { kind, id } = row.data?.deltas ?? {};
      const collection = COLLECTIONS[kind];
      if (!collection) return world;
      const next = { ...world, [collection]: world[collection].filter(entry => entry.id !== id) };
      if (kind !== 'task') return next;
      const tag = taskTag(id);
      return { ...next, agents: next.agents.map(agent => ({ ...agent, activities: agent.activities.filter(act => act !== tag) })) };
    },
  },
};

// Locked mode: a tag-writing action whose literal paths the registry doesn't
// allow is refused when locked; unlocked, those paths register.
function lockedOut(world, entry, params, locked) {
  if (!entry.tagWrites) return { refused: false, world };
  const { entityType, preset } = entry.tagWrites(params);
  if (locked) return { refused: unregisteredEntityTags(world.tagRegistry, entityType, preset).length > 0, world };
  let registry = world.tagRegistry;
  for (const tag of collectPresetTags(entityType, preset).literalTags) registry = addTagToRegistry(registry, tag);
  return { refused: false, world: registry === world.tagRegistry ? world : { ...world, tagRegistry: registry } };
}

/**
 * Applies actions in order, folding them into one new world.
 *
 * @param {object} world - `{ agents, tasks, inventory, session, tagRegistry }`
 * @param {{ kind: string, params: object }[]} actions
 * @param {{ taskId: string, locked?: boolean, outcomes?: object }} ctx
 * @returns {{ world: object, records: { kind: string, params: object, deltas: object|null,
 *   reverseData: object, skipped?: 'locked'|'unknown' }[] }} One record per action
 *   that changed something or was skipped; each becomes an `action` log row
 */
export function applyActions(world, actions, ctx) {
  let current = world;
  const records = [];
  for (const { kind, params = {} } of actions) {
    const entry = ACTION_REGISTRY[kind];
    if (!entry) {
      records.push({ kind, params, deltas: null, reverseData: {}, skipped: 'unknown' });
      continue;
    }
    const gate = lockedOut(current, entry, params, ctx.locked === true);
    if (gate.refused) {
      records.push({ kind, params, deltas: null, reverseData: {}, skipped: 'locked' });
      continue;
    }
    const result = entry.apply(gate.world, params, ctx);
    if (result.deltas === null) continue;
    current = result.world;
    records.push({ kind, params, deltas: result.deltas, reverseData: result.reverseData });
  }
  return { world: current, records };
}

/**
 * Reverses one log row that carries an `actionKind`, through that kind's
 * `reverse`. Best-effort: a skipped row, an unknown or irreversible kind, or
 * a kind whose `reverse.*` switch is off leaves the world as it is.
 *
 * @param {object} world
 * @param {EventLogEntry} row
 * @param {object} reverseSwitches - `rollbackConfig.reverse`
 * @returns {object} The new world
 */
export function reverseActionRow(world, row, reverseSwitches) {
  const entry = ACTION_REGISTRY[row.actionKind];
  if (!entry?.reverse || row.data?.skipped) return world;
  if (entry.category && reverseSwitches?.[entry.category] === false) return world;
  return entry.reverse(world, row);
}
