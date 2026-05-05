import { parseTag, tagFn } from './tags.js';

export function getCurrentTask(agent, tasks) {
  for (const tag of agent.activities) {
    const p = parseTag(tag);
    if (p.type !== 'task') continue;
    const task = tasks.find(t => t.id === p.name);
    if (task && !task.isComplete) return task;
  }
  return null;
}

export function activeTaskCount(agent, tasks) {
  return agent.activities.filter(a => {
    const p = parseTag(a);
    if (p.type !== 'task') return false;
    const t = tasks.find(x => x.id === p.name);
    return t && !t.isComplete;
  }).length;
}

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

// Returns 'assigned' | 'already-assigned' | 'invalid' | 'no-task'
export function tryAssignTask(agent, selectedTaskId, tasks) {
  if (!selectedTaskId) return 'no-task';
  const task = tasks.find(t => t.id === selectedTaskId);
  if (!task) return 'no-task';
  if (!validateAssignment(agent, task)) return 'invalid';
  if (agent.activities.includes(`#task:${task.id}`)) return 'already-assigned';
  return 'assigned';
}

export function isActivityActive(activityTag, tasks) {
  const p = parseTag(activityTag);
  if (p.type === 'task') {
    const task = tasks.find(t => t.id === p.name);
    return !!(task && !task.isComplete);
  }
  return true;
}

export function isAttributeActive(attrTag, agent, tasks) {
  const attrP = parseTag(attrTag);
  for (const act of agent.activities) {
    const actP = parseTag(act);
    if (actP.type !== 'task') continue;
    const task = tasks.find(t => t.id === actP.name);
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

export function agentsAssignedTo(taskId, agents) {
  return agents.filter(a => a.activities.includes(`#task:${taskId}`));
}
