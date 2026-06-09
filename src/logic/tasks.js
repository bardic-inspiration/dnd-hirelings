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
    .map(r => parseTag(r))
    .filter(p => p.segments[0] === 'work' && p.value !== null && parseFloat(p.value) > 0);
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
    const key = req.segments[1] ?? '';
    return (task.workProgress?.[key] ?? 0) >= parseFloat(req.value ?? 1);
  });
}

/**
 * Applies a task's reward payload to the world state.
 *
 * Steps:
 * 1. Consumes `req,consumable` inputs from inventory (qty decremented; depletions stay in list).
 * 2. Merges `results.items` into inventory (adds to existing stack or creates new row).
 * 3. Spawns `results.agents` from their templates.
 * 4. Computes gold delta from `results.gold`.
 *
 * Does NOT mark the task complete or unassign agents — that is `applyTaskComplete`'s job.
 *
 * @param {Task} task
 * @param {InventoryItem[]} inventory
 * @param {Agent[]} agents
 * @returns {{ newInventory: InventoryItem[], newAgents: Agent[], bankDelta: number }}
 */
export function applyResults(task, inventory, agents) {
  // 1. Consume req,consumable inputs.
  let newInventory = inventory.map(i => ({ ...i }));
  for (const req of task.requirements || []) {
    const p = parseTag(req);
    if (p.modifier !== 'req' || p.segments[0] !== 'consumable') continue;
    const name = p.segments[1];
    if (!name) continue;
    const item = newInventory.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (item) item.qty = Math.max(0, item.qty - (parseFloat(p.value) || 1));
  }
  // Depleted items remain in the inventory (shown grayed); they are not pruned.

  // 2. Merge result items into inventory.
  for (const reward of task.results?.items || []) {
    const qty = Number(reward.qty) || 0;
    if (!reward.name || qty <= 0) continue;
    const existing = newInventory.find(i => i.name.toLowerCase() === reward.name.toLowerCase());
    if (existing) existing.qty += qty;
    else newInventory.push({ id: uid(), name: reward.name, qty, icon: '', description: '', value: 0, attributes: [] });
  }

  // 2. Spawn result agents from templates.
  let newAgents = agents;
  const spawned = [];
  for (const spawn of task.results?.agents || []) {
    const qty = Math.max(0, Math.floor(Number(spawn.qty) || 0));
    const tmpl = spawn.template || {};
    for (let i = 0; i < qty; i++) {
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
  const task = tasks.find(t => t.id === taskId);
  if (!task) return { newTasks: tasks, newAgents: agents, newInventory: inventory, bankDelta: 0 };

  const newTasks = tasks.map(t => t.id !== taskId ? t : { ...t, isComplete: true });
  const unassigned = agents.map(a => ({ ...a, activities: a.activities.filter(act => act !== taskTag) }));

  const { newInventory, newAgents, bankDelta } = applyResults(task, inventory, unassigned);

  return { newTasks, newAgents, newInventory, bankDelta };
}

/**
 * Returns a Set of task IDs whose `req,item` or `req,consumable` requirements
 * cannot be satisfied by the current inventory. Tasks are evaluated in creation
 * order so earlier tasks have priority over shared consumable pools.
 *
 * ⚠️ Known bug: the first-pass `consumable` branch references an undefined `pool`
 * variable and will throw a ReferenceError if a task has a `req,consumable` tag
 * without an `item` requirement preceding it.
 *
 * @param {Task[]} activeTasks - Incomplete tasks only
 * @param {InventoryItem[]} inventory
 * @returns {Set<string>} IDs of blocked tasks
 */
export function computeBlockedTaskIds(activeTasks, inventory) {
  const blocked = new Set();
  for (const task of [...activeTasks].sort((a, b) => a.createdAt - b.createdAt)) {
    let pass = true;
    for (const req of task.requirements) {
      const p = parseTag(req);
      if (p.modifier !== 'req') continue;
      const kind = p.segments[0];
      const name = p.segments[1];
      if (!name) continue;
      if (kind === 'item') {
        const inv = inventory.find(i => i.name.toLowerCase() === name.toLowerCase());
        if (!inv || inv.qty < (parseFloat(p.value) || 1)) { pass = false; break; }
      } else if (kind === 'consumable') {
        if ((pool[name.toLowerCase()] ?? 0) < (parseFloat(p.value) || 1)) { pass = false; break; }
      }
    }
    if (!pass) { blocked.add(task.id); continue; }
    for (const req of task.requirements) {
      const p = parseTag(req);
      if (p.modifier !== 'req' || p.segments[0] !== 'consumable') continue;
      const name = p.segments[1];
      if (!name) continue;
      const inv = inventory.find(i => i.name.toLowerCase() === name.toLowerCase());
      if (!inv || inv.qty < (parseFloat(p.value) || 1)) { blocked.add(task.id); break; }
    }
  }
  return blocked;
}
