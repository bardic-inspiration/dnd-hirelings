import { parseTag, buildTag, MODIFIER_REGISTRY } from './tags.js';
import { uid, now } from '../utils.js';

/**
 * Routes a tag string to the task list that stores it. Routing is the task's
 * own concern — applicators (tag registry APPLY, selection mode) just hand the
 * task a tag. Modifiers whose `MODIFIER_REGISTRY` entry declares a `taskField`
 * go there (`req`/`block` → `'requirements'`); everything else → `'attributes'`.
 *
 * @param {string} tagString
 * @returns {'requirements'|'attributes'}
 */
export function routeTaskTag(tagString) {
  const modifier = parseTag(tagString).modifier;
  return MODIFIER_REGISTRY[modifier]?.taskField ?? 'attributes';
}

/**
 * Returns true when the task should complete at the end of a tick.
 * Each condition is checked independently — overshooting one cannot satisfy a
 * deficit in another. A task with zero conditions carries an implied
 * "clock advanced" condition: it completes whenever `clockAdvanced` is true
 * (i.e. at least one eligible agent worked it this tick).
 *
 * @param {Task} task
 * @param {boolean} [clockAdvanced] - True when an eligible agent worked the task this tick
 * @returns {boolean}
 */
export function checkTaskComplete(task, clockAdvanced = false) {
  const conditions = task.conditions || [];
  if (conditions.length === 0) return clockAdvanced;
  return conditions.every(condition => condition.progress >= condition.target);
}

/**
 * Applies a task's reward payload to the world state.
 *
 * Steps:
 * 1. Merges `results.items` into inventory (adds to existing stack or creates new row).
 * 2. Spawns `results.agents` from their templates.
 * 3. Computes gold delta from `results.gold`.
 *
 * Does NOT mark the task complete or unassign agents — that is `applyTaskComplete`'s job.
 *
 * @param {Task} task
 * @param {InventoryItem[]} inventory
 * @param {Agent[]} agents
 * @returns {{ newInventory: InventoryItem[], newAgents: Agent[], bankDelta: number }}
 */
export function applyResults(task, inventory, agents) {
  let newInventory = inventory.map(item => ({ ...item }));

  // 1. Merge result items into inventory.
  for (const reward of task.results?.items || []) {
    const quantity = Number(reward.quantity) || 0;
    if (!reward.name || quantity <= 0) continue;
    const existing = newInventory.find(item => item.name.toLowerCase() === reward.name.toLowerCase());
    if (existing) existing.quantity += quantity;
    else newInventory.push({ id: uid(), name: reward.name, quantity, icon: '', description: '', value: 0, attributes: [] });
  }

  // 2. Spawn result agents from templates.
  let newAgents = agents;
  const spawned = [];
  for (const spawn of task.results?.agents || []) {
    const quantity = Math.max(0, Math.floor(Number(spawn.quantity) || 0));
    const tmpl = spawn.template || {};
    for (let index = 0; index < quantity; index++) {
      spawned.push({
        id: uid(),
        name:        tmpl.name        || 'NEW HIRELING',
        icon:        tmpl.icon        || '',
        rate:        tmpl.rate        ?? 1,
        rateUnit:    tmpl.rateUnit    || 'GP/DAY',
        description: tmpl.description || '',
        attributes:  Array.isArray(tmpl.attributes) ? [...tmpl.attributes] : [],
        activities:  [],
        createdAt:   now(),
        lastAssigned: null,
      });
    }
  }
  if (spawned.length) newAgents = [...agents, ...spawned];

  // 3. Gold reward.
  const bankDelta = Number(task.results?.gold) || 0;

  return { newInventory, newAgents, bankDelta };
}

/**
 * Orchestrates task completion: marks the task done, removes all agent assignments
 * to it, then calls `applyResults` to distribute rewards.
 *
 * @param {string} taskId
 * @param {Task[]} tasks
 * @param {Agent[]} agents
 * @param {InventoryItem[]} inventory
 * @returns {{ newTasks: Task[], newAgents: Agent[], newInventory: InventoryItem[], bankDelta: number }}
 */
export function applyTaskComplete(taskId, tasks, agents, inventory) {
  const taskTag = buildTag(['task', taskId]);
  const task = tasks.find(task => task.id === taskId);
  if (!task) return { newTasks: tasks, newAgents: agents, newInventory: inventory, bankDelta: 0 };

  const newTasks = tasks.map(task => task.id !== taskId ? task : { ...task, isComplete: true });
  const unassigned = agents.map(agent => ({ ...agent, activities: agent.activities.filter(act => act !== taskTag) }));

  const { newInventory, newAgents, bankDelta } = applyResults(task, inventory, unassigned);

  return { newTasks, newAgents, newInventory, bankDelta };
}

/**
 * Returns a Set of task IDs whose `req,item` requirements cannot be satisfied
 * by the current inventory. Each task is checked independently against the full
 * inventory — no stock is reserved across tasks — so evaluation order is
 * irrelevant to the result.
 *
 * @param {Task[]} activeTasks - Incomplete tasks only
 * @param {InventoryItem[]} inventory
 * @returns {Set<string>} IDs of blocked tasks
 */
export function computeBlockedTaskIds(activeTasks, inventory) {
  const blocked = new Set();
  for (const task of activeTasks) {
    for (const req of task.requirements) {
      const parsed = parseTag(req);
      if (parsed.modifier !== 'req' || parsed.segments[0] !== 'item') continue;
      const name = parsed.segments[1];
      if (!name) continue;
      const inv = inventory.find(item => item.name.toLowerCase() === name.toLowerCase());
      if (!inv || inv.quantity < (parseFloat(parsed.value) || 1)) { blocked.add(task.id); break; }
    }
  }
  return blocked;
}
