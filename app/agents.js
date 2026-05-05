import { state, ui, now, uid, DEFAULT_CONFIG } from './state.js';
import { parseTag, tagFn } from './tags.js';

// Load agent defaults from config, for use when creating new agents.
export function agentDefaults() {
  const d = DEFAULT_CONFIG.defaults;
  return { name: d.agentName, icon: '', rate: d.rate, rateUnit: d.rateUnit, description: '', attributes: [] };
}

// Agent management: create, delete, duplicate, assign tasks, etc.
export function createAgent() {
  state.agents.push({ id: uid(), ...agentDefaults(), activities: [], createdAt: now(), lastAssigned: null });
}

export function deleteAgent(id) {
  state.agents = state.agents.filter(a => a.id !== id);
}

export function duplicateAgent(id) {
  const orig = state.agents.find(a => a.id === id);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.activities = [];
  copy.createdAt = now();
  copy.lastAssigned = null;
  state.agents.push(copy);
}

// Gets the currently active task for the agent, or null if none. Note that an agent may have multiple active tasks, but this will just return the first one it finds.
export function getCurrentTask(agent) {
  for (const tag of agent.activities) {
    const p = parseTag(tag);
    if (p.type !== 'task') continue;
    const task = state.tasks.find(t => t.id === p.name);
    if (task && !task.isComplete) return task;
  }
  return null;
}

// Gets the count of active (not completed) tasks for the agent.
export function activeTaskCount(agent) {
  return agent.activities.filter(a => {
    const p = parseTag(a);
    if (p.type !== 'task') return false;
    const t = state.tasks.find(x => x.id === p.name);
    return t && !t.isComplete;
  }).length;
}

// Validate that the agent satisfies all requirements for the task, and that the task satisfies all requirements for the agent. This is a symmetric check to ensure that both agent and task are compatible with each other.
// Returns: true if valid, false if not. Note that this does not check for blockers or consumptions, as those are handled separately in the UI.
export function validateAssignment(agent, task) {
  for (const req of task.requirements) {
    const reqP = parseTag(req);
    if (!reqP.isReq) continue;
    const fn = tagFn(reqP);
    if (fn === 'block' || fn === 'consume') continue;
    if (!reqP.name) continue;
    const match = agent.attributes.find(attr => {
      const p = parseTag(attr);
      return p.type === reqP.type && p.name && p.name.toLowerCase() === reqP.name.toLowerCase();
    });
    if (!match) return false;
    if (reqP.value !== null && (parseTag(match).value ?? 0) < reqP.value) return false;
  }
  for (const attr of agent.attributes) {
    const reqP = parseTag(attr);
    if (!reqP.isReq) continue;
    const match = task.requirements.find(t => {
      const p = parseTag(t);
      if (p.isReq) return false;
      return p.type === reqP.type && (reqP.name === null || (p.name && p.name.toLowerCase() === reqP.name.toLowerCase()));
    });
    if (!match) return false;
    if (reqP.value !== null && (parseTag(match).value ?? 0) < reqP.value) return false;
  }
  return true;
}

// Attempt to assign the currently selected task to agent.
// Returns: true = newly assigned, false = no-op, null = validation failed (caller should flash).
export function tryAssignTask(agent) {
  if (!ui.selectedTaskId) return false;
  const task = state.tasks.find(t => t.id === ui.selectedTaskId);
  if (!task) return false;
  if (!validateAssignment(agent, task)) return null;
  const tag = `#task:${task.id}`;
  if (agent.activities.includes(tag)) return false;
  agent.activities.push(tag);
  agent.lastAssigned = now();
  return true;
}

// Check if an activity is active. For tasks, this means the task is not completed. For other types, we assume it's active as long as it's assigned to the agent.
export function isActivityActive(activityTag) {
  const p = parseTag(activityTag);
  if (p.type === 'task') {
    const task = state.tasks.find(t => t.id === p.name);
    return !!(task && !task.isComplete);
  }
  return true;
}

// Check if an attribute is active for the agent. This means that there is at least one active task assigned to the agent that either has the attribute as a requirement, or has a requirement that matches the attribute. This allows for attributes to be active even if they are not directly required by the task, as long as they are relevant to the task's requirements.
export function isAttributeActive(attrTag, agent) {
  const attrP = parseTag(attrTag);
  for (const act of agent.activities) {
    const actP = parseTag(act);
    if (actP.type !== 'task') continue;
    const task = state.tasks.find(t => t.id === actP.name);
    if (!task || task.isComplete) continue;
    if (attrP.isReq) {
      const match = task.requirements.find(t => {
        const p = parseTag(t);
        if (p.isReq) return false;
        return p.type === attrP.type && (attrP.name === null || (p.name && p.name.toLowerCase() === attrP.name.toLowerCase()));
      });
      if (match && (attrP.value === null || (parseTag(match).value ?? 0) >= attrP.value)) return true;
    } else {
      for (const req of task.requirements) {
        const reqP = parseTag(req);
        if (!reqP.isReq) continue;
        const fn = tagFn(reqP);
        if (fn === 'block' || fn === 'consume') continue;
        if (!reqP.name || !attrP.name) continue;
        if (reqP.type === attrP.type && reqP.name.toLowerCase() === attrP.name.toLowerCase()) return true;
      }
    }
  }
  return false;
}

// Get all agents that are currently assigned to the given task (by task ID). This checks the agent's activities for a tag matching the task, and also verifies that the task is not completed.
export function agentsAssignedTo(taskId) {
  const tag = `#task:${taskId}`;
  return state.agents.filter(a => a.activities.includes(tag));
}
