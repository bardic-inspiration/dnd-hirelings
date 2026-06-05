import { parseTag, buildTag, tagMatches, mergeAttribute } from './tags.js';

export function getCurrentTask(agent, tasks) {
  for (const tag of agent.activities) {
    const p = parseTag(tag);
    if (p.segments[0] !== 'task') continue;
    const task = tasks.find(t => t.id === p.segments[1]);
    if (task && !task.isComplete) return task;
  }
  return null;
}

export function activeTaskCount(agent, tasks) {
  return agent.activities.filter(a => {
    const p = parseTag(a);
    if (p.segments[0] !== 'task') return false;
    const t = tasks.find(x => x.id === p.segments[1]);
    return t && !t.isComplete;
  }).length;
}

// Bidirectional check: agent's attributes must satisfy the task's requirements,
// AND the agent's own required-attributes must be offered by the task.
export function validateAssignment(agent, task) {
  for (const req of task.requirements) {
    const reqP = parseTag(req);
    if (reqP.modifier !== 'req') continue;
    // item/consumable requirements are inventory concerns, not agent-attribute concerns
    if (reqP.segments[0] === 'item' || reqP.segments[0] === 'consumable') continue;
    const allTags = [...agent.attributes, ...agent.activities];
    const match = allTags.find(t => tagMatches(parseTag(t), { segments: reqP.segments }));
    if (!match) return false;
    if (reqP.value !== null) {
      const attrVal = parseFloat(parseTag(match).value);
      if (isNaN(attrVal) || attrVal < parseFloat(reqP.value)) return false;
    }
  }
  for (const req of task.requirements) {
    const reqP = parseTag(req);
    if (reqP.modifier !== 'block') continue;
    const allTags = [...agent.attributes, ...agent.activities];
    if (allTags.some(t => tagMatches(parseTag(t), { segments: reqP.segments }))) return false;
  }
  for (const attr of agent.attributes) {
    const attrP = parseTag(attr);
    if (attrP.modifier !== 'req') continue;
    const match = task.requirements.find(t => {
      const tp = parseTag(t);
      return tp.modifier === 'req' && tagMatches(tp, { segments: attrP.segments });
    });
    if (!match) return false;
    if (attrP.value !== null) {
      const reqVal = parseFloat(parseTag(match).value);
      if (isNaN(reqVal) || reqVal < parseFloat(attrP.value)) return false;
    }
  }
  return true;
}

// Returns 'assigned' | 'already-assigned' | 'invalid' | 'no-task'
export function tryAssignTask(agent, selectedTaskId, tasks) {
  if (!selectedTaskId) return 'no-task';
  const task = tasks.find(t => t.id === selectedTaskId);
  if (!task) return 'no-task';
  if (!validateAssignment(agent, task)) return 'invalid';
  if (agent.activities.includes(buildTag(['task', task.id]))) return 'already-assigned';
  return 'assigned';
}

export function isActivityActive(activityTag, tasks) {
  const p = parseTag(activityTag);
  if (p.segments[0] === 'task') {
    const task = tasks.find(t => t.id === p.segments[1]);
    return !!(task && !task.isComplete);
  }
  return true;
}

// True if this attribute is currently being exercised by any of the agent's in-progress tasks.
export function isAttributeActive(attrTag, agent, tasks) {
  const attrP = parseTag(attrTag);
  for (const act of agent.activities) {
    const actP = parseTag(act);
    if (actP.segments[0] !== 'task') continue;
    const task = tasks.find(t => t.id === actP.segments[1]);
    if (!task || task.isComplete) continue;
    for (const req of task.requirements) {
      const reqP = parseTag(req);
      if (reqP.modifier !== 'req') continue;
      if (reqP.segments[0] === 'item' || reqP.segments[0] === 'consumable') continue;
      if (tagMatches(attrP, { segments: reqP.segments })) return true;
    }
  }
  return false;
}

export function agentsAssignedTo(taskId, agents) {
  const taskTag = buildTag(['task', taskId]);
  return agents.filter(a => a.activities.includes(taskTag));
}

// Returns [{name, qty, tag}] for item:* activities (excludes equip: prefixed items).
export function getPersonalItems(activities) {
  return activities
    .filter(t => parseTag(t).segments[0] === 'item')
    .map(tag => {
      const p = parseTag(tag);
      return { name: p.segments[1], qty: Number(p.value) || 1, tag };
    });
}

// Returns [{slot, name, tag}] for equip:<slot>:item:<name> activities.
export function getEquippedItems(activities) {
  return activities
    .filter(t => {
      const p = parseTag(t);
      return p.segments[0] === 'equip' && p.segments[2] === 'item' && p.segments.length >= 4;
    })
    .map(tag => {
      const p = parseTag(tag);
      return { slot: p.segments[1], name: p.segments[3], tag };
    });
}

// Returns a {name → qty} map covering all items an agent holds (bag + equipped).
// Equipped items count as qty 1 each.
export function collectAllHeldItems(activities) {
  const totals = {};
  for (const { name, qty } of getPersonalItems(activities)) {
    totals[name] = (totals[name] || 0) + qty;
  }
  for (const { name } of getEquippedItems(activities)) {
    totals[name] = (totals[name] || 0) + 1;
  }
  return totals;
}

// Returns agent.attributes merged with additive bonus,* values from all equipped items.
// For each equipped item, any tag with modifier 'bonus' is matched by segment path against
// the agent's attribute tags; matching tags have their value increased by the bonus amount.
// Unmatched bonus paths are injected as new tags so future dynamic consumers pick them up.
export function getEffectiveAttributes(agentAttributes, activities, inventory) {
  const equipped = getEquippedItems(activities);
  if (!equipped.length) return agentAttributes;

  const bonusMap = {}; // { 'ability:str': 2, 'skill:arcana': 1, ... }
  for (const { name } of equipped) {
    const item = inventory.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (!item) continue;
    for (const tag of (item.attributes ?? [])) {
      const p = parseTag(tag);
      if (p.modifier !== 'bonus') continue;
      const n = parseFloat(p.value);
      if (isNaN(n)) continue;
      const key = p.segments.join(':').toLowerCase();
      bonusMap[key] = (bonusMap[key] ?? 0) + n;
    }
  }

  if (!Object.keys(bonusMap).length) return agentAttributes;

  const applied = new Set();
  const result = agentAttributes.map(attr => {
    const p = parseTag(attr);
    if (p.modifier) return attr;
    const key = p.segments.join(':').toLowerCase();
    if (!(key in bonusMap)) return attr;
    applied.add(key);
    return buildTag(p.segments, (parseFloat(p.value) ?? 0) + bonusMap[key], null);
  });

  for (const [key, val] of Object.entries(bonusMap)) {
    if (!applied.has(key)) result.push(buildTag(key.split(':'), val));
  }

  return result;
}

// Returns updated activities array after adjusting item:<name> qty by delta.
// Removes the tag if qty reaches 0. Creates it if it doesn't exist.
export function mergeItemQty(activities, name, delta) {
  const key = `item:${name.toLowerCase()}`;
  const existing = activities.find(t => parseTag(t).segments.join(':').toLowerCase() === key);
  const currentQty = existing ? Number(parseTag(existing).value) || 1 : 0;
  const newQty = currentQty + delta;
  const without = existing ? activities.filter(t => t !== existing) : [...activities];
  if (newQty <= 0) return without;
  return mergeAttribute(without, buildTag(['item', name], newQty));
}
