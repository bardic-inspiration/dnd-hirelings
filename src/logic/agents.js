import { parseTag, buildTag, tagMatches, mergeAttribute } from './tags.js';

/**
 * Returns the first in-progress task the agent is assigned to, or null.
 * Skips completed tasks — an agent remains assigned to a task's ID after completion
 * until the reducer unlinks them, so the completion check is essential.
 *
 * @param {Agent} agent
 * @param {Task[]} tasks
 * @returns {Task|null}
 */
export function getCurrentTask(agent, tasks) {
  for (const tag of agent.activities) {
    const parsed = parseTag(tag);
    if (parsed.segments[0] !== 'task') continue;
    const task = tasks.find(task => task.id === parsed.segments[1]);
    if (task && !task.isComplete) return task;
  }
  return null;
}

/**
 * Returns the number of incomplete tasks the agent is currently assigned to.
 *
 * @param {Agent} agent
 * @param {Task[]} tasks
 * @returns {number}
 */
export function activeTaskCount(agent, tasks) {
  return agent.activities.filter(tag => {
    const parsed = parseTag(tag);
    if (parsed.segments[0] !== 'task') return false;
    const task = tasks.find(task => task.id === parsed.segments[1]);
    return task && !task.isComplete;
  }).length;
}

/**
 * Bidirectional assignment validator.
 *
 * Forward check: every `req,*` tag on the task must be satisfied by the agent's
 * attributes + activities (value comparisons are ≥). Block tags must not match.
 * Item requirements are inventory concerns and are skipped here.
 *
 * Reverse check: every `req,*` tag on the agent must be matched by a corresponding
 * requirement on the task (the agent "requires" that context).
 *
 * @param {Agent} agent
 * @param {Task} task
 * @returns {boolean} True if the assignment is valid
 */
export function validateAssignment(agent, task) {
  for (const req of task.requirements) {
    const parsedReq = parseTag(req);
    if (parsedReq.modifier !== 'req') continue;
    // item requirements are inventory concerns, not agent-attribute concerns
    if (parsedReq.segments[0] === 'item') continue;
    const allTags = [...agent.attributes, ...agent.activities];
    const match = allTags.find(tag => tagMatches(parseTag(tag), { segments: parsedReq.segments }));
    if (!match) return false;
    if (parsedReq.value !== null) {
      const attrVal = parseFloat(parseTag(match).value);
      if (isNaN(attrVal) || attrVal < parseFloat(parsedReq.value)) return false;
    }
  }
  for (const req of task.requirements) {
    const parsedReq = parseTag(req);
    if (parsedReq.modifier !== 'block') continue;
    const allTags = [...agent.attributes, ...agent.activities];
    if (allTags.some(tag => tagMatches(parseTag(tag), { segments: parsedReq.segments }))) return false;
  }
  for (const attr of agent.attributes) {
    const parsedAttr = parseTag(attr);
    if (parsedAttr.modifier !== 'req') continue;
    const match = task.requirements.find(req => {
      const parsedReq = parseTag(req);
      return parsedReq.modifier === 'req' && tagMatches(parsedReq, { segments: parsedAttr.segments });
    });
    if (!match) return false;
    if (parsedAttr.value !== null) {
      const reqVal = parseFloat(parseTag(match).value);
      if (isNaN(reqVal) || reqVal < parseFloat(parsedAttr.value)) return false;
    }
  }
  return true;
}

/**
 * Attempts to assign an agent to a task and returns the outcome.
 *
 * @param {Agent} agent
 * @param {string|null} selectedTaskId
 * @param {Task[]} tasks
 * @returns {'assigned'|'already-assigned'|'invalid'|'no-task'}
 */
export function tryAssignTask(agent, selectedTaskId, tasks) {
  if (!selectedTaskId) return 'no-task';
  const task = tasks.find(task => task.id === selectedTaskId);
  if (!task) return 'no-task';
  if (!validateAssignment(agent, task)) return 'invalid';
  if (agent.activities.includes(buildTag(['task', task.id]))) return 'already-assigned';
  return 'assigned';
}

/**
 * Returns true if the activity tag represents something currently in-progress.
 * For `task:<id>` activities, checks that the task exists and is not complete.
 * Non-task activities (items, bound items) are always considered active.
 *
 * @param {string} activityTag
 * @param {Task[]} tasks
 * @returns {boolean}
 */
export function isActivityActive(activityTag, tasks) {
  const parsed = parseTag(activityTag);
  if (parsed.segments[0] === 'task') {
    const task = tasks.find(task => task.id === parsed.segments[1]);
    return !!(task && !task.isComplete);
  }
  return true;
}

/**
 * Returns true if this attribute tag is actively required by at least one of the
 * agent's in-progress task assignments. Used to highlight "active" attributes in the UI.
 *
 * @param {string} attrTag
 * @param {Agent} agent
 * @param {Task[]} tasks
 * @returns {boolean}
 */
export function isAttributeActive(attrTag, agent, tasks) {
  const parsedAttr = parseTag(attrTag);
  for (const act of agent.activities) {
    const parsedAct = parseTag(act);
    if (parsedAct.segments[0] !== 'task') continue;
    const task = tasks.find(task => task.id === parsedAct.segments[1]);
    if (!task || task.isComplete) continue;
    for (const req of task.requirements) {
      const parsedReq = parseTag(req);
      if (parsedReq.modifier !== 'req') continue;
      if (parsedReq.segments[0] === 'item') continue;
      if (tagMatches(parsedAttr, { segments: parsedReq.segments })) return true;
    }
  }
  return false;
}

/**
 * Returns all agents that have a `task:<taskId>` activity tag.
 *
 * @param {string} taskId
 * @param {Agent[]} agents
 * @returns {Agent[]}
 */
export function agentsAssignedTo(taskId, agents) {
  const taskTag = buildTag(['task', taskId]);
  return agents.filter(a => a.activities.includes(taskTag));
}

/**
 * Returns items carried in the agent's bag (excludes bound items).
 * Reads `item:<name>=<qty>` activity tags only; `bind:*` tags are excluded.
 *
 * @param {string[]} activities
 * @returns {{ name: string, quantity: number, tag: string }[]}
 */
export function getPersonalItems(activities) {
  return activities
    .filter(tag => parseTag(tag).segments[0] === 'item')
    .map(tag => {
      const parsed = parseTag(tag);
      return { name: parsed.segments[1], quantity: Number(parsed.value) || 1, tag };
    });
}

/**
 * Returns items the agent has bound, parsed from `bind:[<slot>:]item:<name>` activity tags.
 *
 * Slot is optional: `bind:item:<name>` yields `slot: null`, while
 * `bind:<slot>:item:<name>` yields the slot name.
 *
 * @param {string[]} activities
 * @returns {{ slot: string|null, name: string, tag: string }[]}
 */
export function getBoundItems(activities) {
  return activities
    .map(tag => ({ tag, parsed: parseTag(tag) }))
    .filter(({ parsed }) => {
      if (parsed.segments[0] !== 'bind') return false;
      // `bind:item:<name>` (no slot) or `bind:<slot>:item:<name>` (slotted).
      return (parsed.segments[1] === 'item' && parsed.segments.length >= 3)
        || (parsed.segments[2] === 'item' && parsed.segments.length >= 4);
    })
    .map(({ tag, parsed }) => parsed.segments[1] === 'item'
      ? { slot: null, name: parsed.segments[2], tag }
      : { slot: parsed.segments[1], name: parsed.segments[3], tag });
}

/**
 * Returns the first configured bind slot not already occupied by a bound item,
 * or `null` when the card defines no slots or they are all full. Slot names come
 * from the card config (`tagUI.yml → cards.<card>.slots`), never the tag registry
 * (issue #84). Callers fall back to a slotless bind on `null`, so binding never
 * dead-ends.
 *
 * @param {string[]} slots - Configured slot names for the card
 * @param {{ slot: string|null }[]} boundItems - Output of `getBoundItems`
 * @returns {string|null} A free slot name, or null
 */
export function firstFreeSlot(slots, boundItems) {
  const occupied = new Set(boundItems.map(bound => bound.slot).filter(Boolean));
  return (slots ?? []).find(slot => !occupied.has(slot)) ?? null;
}

/**
 * Returns a `{ name → totalQty }` map for everything the agent holds (bag + bound slots).
 * Bound items each count as 1 unit regardless of any qty value.
 * Used by `AGENT_DELETE` to return items to inventory.
 *
 * @param {string[]} activities
 * @returns {{ [name: string]: number }}
 */
export function collectAllHeldItems(activities) {
  const totals = {};
  for (const { name, quantity } of getPersonalItems(activities)) {
    totals[name] = (totals[name] || 0) + quantity;
  }
  for (const { name } of getBoundItems(activities)) {
    totals[name] = (totals[name] || 0) + 1;
  }
  return totals;
}

/**
 * Returns the agent's effective attribute list, applying additive `bonus,*` values
 * from all currently bound items.
 *
 * For each bound item in inventory, `bonus,<path>=<n>` tags are summed by path key
 * and added to the matching agent attribute value. If no agent attribute exists for a
 * bonus path, the bonus is injected as a new tag so downstream consumers (e.g. work
 * computation) can find it.
 *
 * @param {string[]} agentAttributes - Agent's `attributes` array
 * @param {string[]} activities - Agent's `activities` array (used to find bound items)
 * @param {InventoryItem[]} inventory - Full inventory (used to read item `attributes`)
 * @returns {string[]} New attribute array with bonuses applied
 */
export function getEffectiveAttributes(agentAttributes, activities, inventory) {
  const bound = getBoundItems(activities);
  if (!bound.length) return agentAttributes;

  const bonusMap = {}; // { 'ability:str': 2, 'skill:arcana': 1, ... }
  for (const { name } of bound) {
    const item = inventory.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!item) continue;
    for (const tag of (item.attributes ?? [])) {
      const parsed = parseTag(tag);
      if (parsed.modifier !== 'bonus') continue;
      const n = parseFloat(parsed.value);
      if (isNaN(n)) continue;
      const key = parsed.segments.join(':').toLowerCase();
      bonusMap[key] = (bonusMap[key] ?? 0) + n;
    }
  }

  if (!Object.keys(bonusMap).length) return agentAttributes;

  const applied = new Set();
  const result = agentAttributes.map(attr => {
    const parsed = parseTag(attr);
    if (parsed.modifier) return attr;
    const key = parsed.segments.join(':').toLowerCase();
    if (!(key in bonusMap)) return attr;
    applied.add(key);
    // `|| 0` (not `??`) because a valueless attribute parses to NaN, which `??`
    // would pass through — a matched bonus must treat a missing value as 0.
    return buildTag(parsed.segments, (parseFloat(parsed.value) || 0) + bonusMap[key], null);
  });

  for (const [key, val] of Object.entries(bonusMap)) {
    if (!applied.has(key)) result.push(buildTag(key.split(':'), val));
  }

  return result;
}

/**
 * Adjusts the quantity of an `item:<name>=<qty>` activity tag by `delta`.
 * Removes the tag entirely if the resulting qty reaches 0 or below.
 * Creates the tag if it does not exist (delta must be positive in that case).
 *
 * @param {string[]} activities
 * @param {string} name - Item name (case-insensitive)
 * @param {number} delta - Quantity change (positive to add, negative to remove)
 * @returns {string[]} Updated activities array
 */
export function mergeItemQty(activities, name, delta) {
  const key = `item:${name.toLowerCase()}`;
  const existing = activities.find(tag => parseTag(tag).segments.join(':').toLowerCase() === key);
  const currentQty = existing ? Number(parseTag(existing).value) || 1 : 0;
  const newQty = currentQty + delta;
  const without = existing ? activities.filter(tag => tag !== existing) : [...activities];
  if (newQty <= 0) return without;
  return mergeAttribute(without, buildTag(['item', name], newQty));
}
