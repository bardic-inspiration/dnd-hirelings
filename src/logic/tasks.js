import { parseTag, tagFn } from './tags.js';

export function getWorkReqs(task) {
  const all = task.requirements
    .map(r => parseTag(r))
    .filter(p => p.type === 'work' && !p.isReq && p.value !== null && p.value > 0);
  return all.length > 0 ? all : [{ type: 'work', name: null, value: 1, isReq: false }];
}

export function checkTaskComplete(task) {
  const reqs = getWorkReqs(task);
  const totalRequired = reqs.reduce((sum, e) => sum + e.value, 0);
  const totalProgress = reqs.reduce((sum, e) => sum + (task.workProgress?.[e.name || ''] ?? 0), 0);
  return totalProgress >= totalRequired;
}

// Applies task completion: marks done, prunes agents, consumes items, applies rewards.
// Returns { newTasks, newAgents, newInventory, bankDelta }
export function applyTaskComplete(taskId, tasks, agents, inventory) {
  const taskTag = `#task:${taskId}`;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return { newTasks: tasks, newAgents: agents, newInventory: inventory, bankDelta: 0 };

  const newTasks = tasks.map(t => t.id !== taskId ? t : { ...t, isComplete: true });
  const newAgents = agents.map(a => ({ ...a, activities: a.activities.filter(act => act !== taskTag) }));

  let newInventory = inventory.map(i => ({ ...i }));
  for (const req of task.requirements) {
    const p = parseTag(req);
    if (tagFn(p) !== 'consume' || !p.name) continue;
    const item = newInventory.find(i => i.name.toLowerCase() === p.name.toLowerCase());
    if (item) item.qty = Math.max(0, item.qty - (p.value ?? 1));
  }
  newInventory = newInventory.filter(i => i.qty > 0);

  let bankDelta = 0;
  for (const req of task.requirements) {
    const p = parseTag(req);
    if (tagFn(p) === 'reward-gold' && p.value > 0) bankDelta += p.value;
  }

  return { newTasks, newAgents, newInventory, bankDelta };
}

// Returns a Set of task IDs whose item/consumable requirements cannot be met.
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
