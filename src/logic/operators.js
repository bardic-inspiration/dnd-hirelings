// Task-engine operators (docs/spec/task-engine.md "Operators"). Each tick, a
// task's operators fold over one `Flow` per engaged agent.

/**
 * @typedef {object} RollRecord
 * @property {string} operatorId
 * @property {string} agentId
 * @property {number} rollIndex - Counts up per (task, operator, agent) within a tick
 * @property {string} notation - The dice literal, e.g. `'1d20'`
 * @property {number} result
 */

/**
 * @typedef {object} Flow
 * @property {boolean} admitted - False once a gate rejects; nothing downstream fires
 * @property {number} value - The running value modulators scale and checks read as `{flow}`
 * @property {number} matchedValue - Numeric value of the last gate-matched tag
 *   (`{value}`); 0 if none or non-numeric
 * @property {RollRecord[]} rolls - Rolls made during this fold
 */

/**
 * Creates the flow one agent's fold starts from.
 *
 * @returns {Flow} `{ admitted: true, value: 0, matchedValue: 0, rolls: [] }`, fresh each call
 */
export function createFlow() {
  return { admitted: true, value: 0, matchedValue: 0, rolls: [] };
}
