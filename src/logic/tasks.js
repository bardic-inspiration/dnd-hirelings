import { parseTag, MODIFIER_REGISTRY } from './tags.js';
import { successVesselKeys, isVesselFull } from './taskModel.js';
import { applyActions } from './actions.js';

/**
 * Routes a tag string to the task list that stores it. Routing is the task's
 * own concern — applicators (tag registry APPLY, selection mode) just hand the
 * task a tag. Modifiers whose `MODIFIER_REGISTRY` entry declares a `taskField`
 * go there (`req`/`block` → `'requirements'`); everything else → `'attributes'`.
 *
 * @param {string} tagString
 * @returns {'requirements'|'attributes'}
 */
export function routeTaskTag(tagString) {
  const modifier = parseTag(tagString).modifier;
  return MODIFIER_REGISTRY[modifier]?.taskField ?? 'attributes';
}

/**
 * Returns true when the task should complete at the end of a tick: every
 * success vessel's `fullWhen` passes against its fill. Vessels are checked
 * independently — overshooting one cannot cover a deficit in another. A task
 * with no success vessels carries an implied "clock advanced" condition: it
 * completes whenever `clockAdvanced` is true (an eligible agent worked it
 * this tick).
 *
 * @param {Task} task
 * @param {boolean} [clockAdvanced] - True when an eligible agent worked the task this tick
 * @returns {boolean}
 */
export function checkTaskComplete(task, clockAdvanced = false) {
  const keys = successVesselKeys(task);
  if (keys.length === 0) return clockAdvanced;
  return keys.every(key => isVesselFull(task, key));
}

/**
 * Completes a task: marks it complete, then applies `agent.unassign` (every
 * agent assigned to it) and its completion effects through `applyActions`.
 * The tick logs the returned records as `action` rows; the ✓ button
 * (`TASK_SET_COMPLETE`) discards them, since hand edits are not logged.
 *
 * @param {object} world - `{ agents, tasks, inventory, session, tagRegistry }`
 * @param {string} taskId
 * @param {{ locked?: boolean }} [options] - Locked mode for tag-writing actions
 * @returns {{ world: object, records: object[] }} The input world and no
 *   records for an unknown task id
 */
export function completeTask(world, taskId, { locked = false } = {}) {
  const task = world.tasks.find(task => task.id === taskId);
  if (!task) return { world, records: [] };
  const completed = { ...world, tasks: world.tasks.map(entry => (entry.id === taskId ? { ...entry, isComplete: true } : entry)) };
  const actions = [
    { kind: 'agent.unassign', params: { selector: { scope: 'assigned' } } },
    ...(task.effects ?? []).filter(effect => effect.on === 'completion').flatMap(effect => effect.actions),
  ];
  return applyActions(completed, actions, { taskId, locked });
}

/**
 * Returns a Set of task IDs whose `req,item` requirements cannot be satisfied
 * by the current inventory. Each task is checked independently against the full
 * inventory — no stock is reserved across tasks — so evaluation order is
 * irrelevant to the result.
 *
 * @param {Task[]} activeTasks - Incomplete tasks only
 * @param {InventoryItem[]} inventory
 * @returns {Set<string>} IDs of blocked tasks
 */
export function computeBlockedTaskIds(activeTasks, inventory) {
  const blocked = new Set();
  for (const task of activeTasks) {
    for (const req of task.requirements) {
      const parsed = parseTag(req);
      if (parsed.modifier !== 'req' || parsed.segments[0] !== 'item') continue;
      const name = parsed.segments[1];
      if (!name) continue;
      const stock = inventory.find(item => item.name.toLowerCase() === name.toLowerCase());
      if (!stock || stock.quantity < (parseFloat(parsed.value) || 1)) { blocked.add(task.id); break; }
    }
  }
  return blocked;
}
