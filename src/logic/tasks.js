import { parseTag, buildTag } from './tags.js';
import { uid, now } from '../utils.js';

// Returns an array of work definitions for the task, or a default of 1 generic work if none specified.
export function getWorkRequirements(task) {
  const all = (task.work || [])
    .map(r => parseTag(r))
    .filter(p => p.segments[0] === 'work' && p.value !== null && parseFloat(p.value) > 0);
  return all.length > 0 ? all : [{ segments: ['work'], value: null }];
}

// Task is complete only when every work requirement is independently satisfied —
// overshooting one skill must not mask a deficit in another.
export function checkTaskComplete(task) {
  return getWorkRequirements(task).every(req => {
    const key = req.segments[1] ?? '';
    return (task.workProgress?.[key] ?? 0) >= parseFloat(req.value ?? 1);
  });
}

// Applies the task's structured results to the world: adds results.items into inventory
// (merging by name), spawns results.agents, and returns the gold delta to add to the bank.
// Returns { newInventory, newAgents, bankDelta }.
export function applyResults(task, inventory, agents) {
  // 1. Merge result items into inventory.
  let newInventory = inventory.map(i => ({ ...i }));
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

// Applies task completion: marks done, prunes assignments, and applies results.
// Returns { newTasks, newAgents, newInventory, bankDelta }
export function applyTaskComplete(taskId, tasks, agents, inventory) {
  const taskTag = buildTag(['task', taskId]);
  const task = tasks.find(t => t.id === taskId);
  if (!task) return { newTasks: tasks, newAgents: agents, newInventory: inventory, bankDelta: 0 };

  const newTasks = tasks.map(t => t.id !== taskId ? t : { ...t, isComplete: true });
  const unassigned = agents.map(a => ({ ...a, activities: a.activities.filter(act => act !== taskTag) }));

  const { newInventory, newAgents, bankDelta } = applyResults(task, inventory, unassigned);

  return { newTasks, newAgents, newInventory, bankDelta };
}

// Returns a Set of task IDs whose item requirements cannot be met.
export function computeBlockedTaskIds(activeTasks, inventory) {
  const blocked = new Set();
  for (const task of activeTasks) {
    for (const req of task.requirements) {
      const p = parseTag(req);
      if (p.segments[0] !== 'req' || p.segments[1] !== 'item') continue;
      const name = p.segments[2];
      if (!name) continue;
      const inv = inventory.find(i => i.name.toLowerCase() === name.toLowerCase());
      if (!inv || inv.qty < (parseFloat(p.value) || 1)) { blocked.add(task.id); break; }
    }
  }
  return blocked;
}
