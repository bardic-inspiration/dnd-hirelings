import { parseTag, tagFn } from './tags.js';
import { uid, now } from '../utils.js';

// Returns an array of work definitions for the task, or a default of 1 generic work if none specified.
export function getWorkRequirements(task) {
  const all = (task.work || [])
    .map(r => parseTag(r))
    .filter(p => p.type === 'work' && !p.isReq && p.value !== null && p.value > 0);
  return all.length > 0 ? all : [{ type: 'work', name: null, value: 1, isReq: false }];
}

// Task is complete only when every work requirement is independently satisfied —
// overshooting one skill must not mask a deficit in another.
export function checkTaskComplete(task) {
  return getWorkRequirements(task).every(req => (task.workProgress?.[req.name || ''] ?? 0) >= req.value);
}

// Applies the task's structured results to the world: consumes #req:consumable inputs,
// adds results.items into inventory (merging by name), spawns results.agents, and
// returns the gold delta to add to the bank.
// Returns { newInventory, newAgents, bankDelta }.
export function applyResults(task, inventory, agents) {
  // 1. Consume #req:consumable inputs.
  let newInventory = inventory.map(i => ({ ...i }));
  for (const req of task.requirements || []) {
    const p = parseTag(req);
    if (tagFn(p) !== 'consume' || !p.name) continue;
    const item = newInventory.find(i => i.name.toLowerCase() === p.name.toLowerCase());
    if (item) item.qty = Math.max(0, item.qty - (p.value ?? 1));
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

  // 3. Spawn result agents from templates.
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

  // 4. Gold reward.
  const bankDelta = Number(task.results?.gold) || 0;

  return { newInventory, newAgents, bankDelta };
}

// Applies task completion: marks done, prunes assignments, and applies results.
// Returns { newTasks, newAgents, newInventory, bankDelta }
export function applyTaskComplete(taskId, tasks, agents, inventory) {
  const taskTag = `#task:${taskId}`;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return { newTasks: tasks, newAgents: agents, newInventory: inventory, bankDelta: 0 };

  const newTasks = tasks.map(t => t.id !== taskId ? t : { ...t, isComplete: true });
  const unassigned = agents.map(a => ({ ...a, activities: a.activities.filter(act => act !== taskTag) }));

  const { newInventory, newAgents, bankDelta } = applyResults(task, inventory, unassigned);

  return { newTasks, newAgents, newInventory, bankDelta };
}

// Returns a Set of task IDs whose item/consumable requirements cannot be met.
// Iterates in createdAt order so earlier tasks claim consumables first
// and later tasks correctly see a depleted pool.
export function computeBlockedTaskIds(activeTasks, inventory) {
  const pool = {};
  for (const item of inventory) pool[item.name.toLowerCase()] = item.qty;
  const blocked = new Set();
  for (const task of [...activeTasks].sort((a, b) => a.createdAt - b.createdAt)) {
    let pass = true;
    for (const req of task.requirements) {
      const p = parseTag(req);
      const fn = tagFn(p);
      if (!p.name) continue;
      if (fn === 'block') {
        const inv = inventory.find(i => i.name.toLowerCase() === p.name.toLowerCase());
        if (!inv || inv.qty < (p.value ?? 1)) { pass = false; break; }
      } else if (fn === 'consume') {
        if ((pool[p.name.toLowerCase()] ?? 0) < (p.value ?? 1)) { pass = false; break; }
      }
    }
    if (!pass) { blocked.add(task.id); continue; }
    for (const req of task.requirements) {
      const p = parseTag(req);
      if (tagFn(p) !== 'consume' || !p.name) continue;
      pool[p.name.toLowerCase()] = (pool[p.name.toLowerCase()] ?? 0) - (p.value ?? 1);
    }
  }
  return blocked;
}
