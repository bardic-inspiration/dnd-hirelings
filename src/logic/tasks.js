import { parseTag, buildTag } from './tags.js';
import { uid, now } from '../utils.js';

/**
 * Returns the parsed work requirement tags for a task.
 * Filters to `work:*` tags with a positive numeric value.
 * Falls back to a single generic work entry `[{ segments: ['work'], value: null }]`
 * when the task has no valid work tags — so every task always has at least one bucket.
 *
 * @param {Task} task
 * @returns {{ segments: string[], value: string|null }[]} Parsed work tags
 */
export function getWorkRequirements(task) {
  const all = (task.work || [])
    .map(tag => parseTag(tag))
    .filter(parsed => parsed.segments[0] === 'work' && parsed.value !== null && parseFloat(parsed.value) > 0);
  return all.length > 0 ? all : [{ segments: ['work'], value: null }];
}

/**
 * Returns true when every work bucket has reached its individual target.
 * Each requirement is checked independently — overshooting one bucket cannot
 * satisfy a deficit in another.
 *
 * @param {Task} task
 * @returns {boolean}
 */
export function checkTaskComplete(task) {
  return getWorkRequirements(task).every(req => {
    const key = req.segments.slice(1).join(':');
    return (task.workProgress?.[key] ?? 0) >= parseFloat(req.value ?? 1);
  });
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
 * by the current inventory. Tasks are evaluated in creation order.
 *
 * @param {Task[]} activeTasks - Incomplete tasks only
 * @param {InventoryItem[]} inventory
 * @returns {Set<string>} IDs of blocked tasks
 */
export function computeBlockedTaskIds(activeTasks, inventory) {
  const blocked = new Set();
  for (const task of [...activeTasks].sort((a, b) => a.createdAt - b.createdAt)) {
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
