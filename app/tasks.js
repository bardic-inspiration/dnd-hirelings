import { state, ui, now, uid, DEFAULT_CONFIG } from './state.js';
import { parseTag, tagFn } from './tags.js';

// Task management: create, delete, duplicate, check completion, etc.
export function createTask() {
  state.tasks.push({
    id: uid(),
    name: DEFAULT_CONFIG.defaults.taskName,
    description: '',
    requirements: [],
    workProgress: {},
    isComplete: false,
    createdAt: now(),
  });
}

export function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  pruneTaskFromAgents(id);
  if (ui.selectedTaskId === id) ui.selectedTaskId = null;
  ui.expandedTasks.delete(id);
}

export function duplicateTask(id) {
  const orig = state.tasks.find(t => t.id === id);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.workProgress = {};
  copy.isComplete = false;
  copy.createdAt = now();
  state.tasks.push(copy);
}

// Find all work tags on a task. Returns a synthetic default of { value: 1 } when none present.
export function getWorkReqs(task) {
  const all = task.requirements
    .map(r => parseTag(r))
    .filter(p => p.type === 'work' && !p.isReq && p.value !== null && p.value > 0);
  return all.length > 0 ? all : [{ type: 'work', name: null, value: 1, isReq: false }];
}

// Check if a task's work requirements are satisfied, and if so mark it complete and process rewards/consumptions. This should be called after any change to a task's workProgress or requirements.
export function checkTaskComplete(task) {
  const reqs = getWorkReqs(task);
  const totalRequired = reqs.reduce((sum, e) => sum + e.value, 0);
  const totalProgress = reqs.reduce((sum, e) => sum + (task.workProgress?.[e.name || ''] ?? 0), 0);
  return totalProgress >= totalRequired;
}

// Mark a task complete, remove it from agents, deduct consumables, and apply rewards. This should only be called from checkTaskComplete after verifying that the task is indeed complete.
export function completeTask(task) {
  task.isComplete = true;
  pruneTaskFromAgents(task.id);
  consumeTaskItems(task);
  executeTaskRewards(task);
}

// Remove all #task:<id> tags from every agent's activities.
function pruneTaskFromAgents(taskId) {
  const tag = `#task:${taskId}`;
  for (const a of state.agents) {
    a.activities = a.activities.filter(act => act !== tag);
  }
}

// Deduct consumable requirements from inventory on task completion.
function consumeTaskItems(task) {
  for (const req of task.requirements) {
    const p = parseTag(req);
    if (tagFn(p) !== 'consume' || !p.name) continue;
    const item = state.inventory.find(i => i.name.toLowerCase() === p.name.toLowerCase());
    if (!item) continue;
    item.qty = Math.max(0, item.qty - (p.value ?? 1));
  }
  state.inventory = state.inventory.filter(i => i.qty > 0);
}

// Apply rewards from task completion, such as adding gold to the bank.
function executeTaskRewards(task) {
  if (!task.isComplete) return;
  for (const req of task.requirements) {
    const p = parseTag(req);
    if (tagFn(p) === 'reward-gold' && p.value > 0) {
      state.session.bank = (state.session.bank ?? 0) + p.value;
    }
  }
}

// Returns a Set of task IDs whose item/consumable requirements cannot be met.
// Sorts tasks oldest-first so earlier tasks get reservation priority on shared consumables.
export function getItemBlockedTasks(activeTasks) {
  const pool = {};
  for (const item of state.inventory) pool[item.name.toLowerCase()] = item.qty;
  const blocked = new Set();
  for (const task of [...activeTasks].sort((a, b) => a.createdAt - b.createdAt)) {
    let pass = true;
    for (const req of task.requirements) {
      const p = parseTag(req);
      const fn = tagFn(p);
      if (!p.name) continue;
      if (fn === 'block') {
        const inv = state.inventory.find(i => i.name.toLowerCase() === p.name.toLowerCase());
        if (!inv || inv.qty < (p.value ?? 1)) { pass = false; break; }
      } else if (fn === 'consume') {
        if ((pool[p.name.toLowerCase()] ?? 0) < (p.value ?? 1)) { pass = false; break; }
      }
    }
    if (!pass) { blocked.add(task.id); continue; }
    for (const req of task.requirements) {
      const p = parseTag(req);
      if (tagFn(p) !== 'consume' || !p.name) continue;
      const key = p.name.toLowerCase();
      pool[key] = (pool[key] ?? 0) - (p.value ?? 1);
    }
  }
  return blocked;
}
