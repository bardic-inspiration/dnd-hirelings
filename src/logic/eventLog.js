// Event log: an append-only record of every contribution to (sub)task progress,
// one row per (agent, condition, game day), a row whenever a task changes
// completion state, and one `'tick'` boundary row sealing each tick's batch
// (ordering contract: `work* → task_complete* → tick`). The live log lives in
// `state.eventLog` (persisted to localStorage with the rest of the game state);
// this module builds entries, (de)serializes the log as CSV, and trims it.
// Logging behavior (enabled, retention) is configured by
// `public/config/rollback.yml` (see logic/rollback.js), which also consumes the
// log to wind the clock back tick by tick.

import { downloadFile } from './download.js';

/** Maximum rows retained in the live log. Oldest rows are dropped FIFO. */
export const MAX_LOG_ROWS = 50000;

/**
 * CSV column order — the single source of truth shared by `serializeEventLog`
 * and `parseEventLog`. `data` is always last (it holds a JSON blob).
 * @type {string[]}
 */
export const EVENT_LOG_COLUMNS = [
  'seq', 'eventType', 'clock', 'day',
  'agentId', 'agentName', 'taskId', 'taskName',
  'conditionId', 'conditionName', 'delta', 'progress', 'target', 'data',
];

const NUMERIC_COLUMNS = new Set(['seq', 'clock', 'day', 'delta', 'progress', 'target']);

const CSV_TYPES = [{ description: 'Hireling event log', accept: { 'text/csv': ['.csv'] } }];

/**
 * @typedef {object} EventLogEntry
 * @property {number} seq - Monotonic id assigned at append time (stable across FIFO trim)
 * @property {string} eventType - `'work_contribution'` | `'task_complete'` | `'tick'`
 * @property {number} clock - In-game minutes the row represents (a day boundary;
 *   for `tick`, the clock AFTER the tick)
 * @property {number} day - Clock expressed in whole game days, denormalized for readability
 * @property {string} agentId - Contributing agent (`''` for `task_complete`/`tick`)
 * @property {string} agentName
 * @property {string} taskId - `''` for `tick`
 * @property {string} taskName
 * @property {string} conditionId - Target condition (`''` for `task_complete`/`tick`)
 * @property {string} conditionName
 * @property {number} delta - Progress added this day to this condition (`0` otherwise)
 * @property {number} progress - Resulting `condition.progress` snapshot (`0` otherwise)
 * @property {number} target - `condition.target`, denormalized (`0` otherwise)
 * @property {object} data - Extension payload. `work_contribution`: `{}`.
 *   `task_complete`: `{ isComplete, attributes, results, spawnedAgentIds, unassignedAgentIds }`.
 *   `tick`: `{ stepMins, wagesTotal, wages: [{ agentId, agentName, amount }] }`.
 */

/**
 * Builds a `work_contribution` entry: one agent's progress toward one condition
 * on one game day.
 *
 * @param {{ seq: number, clock: number, day: number, agent: object, task: object,
 *   condition: object, delta: number, progress: number }} params
 * @returns {EventLogEntry}
 */
export function makeWorkEvent({ seq, clock, day, agent, task, condition, delta, progress }) {
  return {
    seq,
    eventType: 'work_contribution',
    clock,
    day,
    agentId: agent.id ?? '',
    agentName: agent.name ?? '',
    taskId: task.id ?? '',
    taskName: task.name ?? '',
    conditionId: condition.id ?? '',
    conditionName: condition.name ?? '',
    delta,
    progress,
    target: condition.target ?? 0,
    data: {},
  };
}

/**
 * Builds a `task_complete` entry recording a task's transition to complete.
 * Captures the task's tags (`attributes`), reward `results`, and the exact ids
 * of agents spawned and unassigned by the completion, so `rollbackTick` can
 * reverse the completion precisely.
 *
 * @param {{ seq: number, clock: number, day: number, task: object,
 *   spawnedAgentIds?: string[], unassignedAgentIds?: string[] }} params
 * @returns {EventLogEntry}
 */
export function makeCompleteEvent({ seq, clock, day, task, spawnedAgentIds = [], unassignedAgentIds = [] }) {
  return {
    seq,
    eventType: 'task_complete',
    clock,
    day,
    agentId: '',
    agentName: '',
    taskId: task.id ?? '',
    taskName: task.name ?? '',
    conditionId: '',
    conditionName: '',
    delta: 0,
    progress: 0,
    target: 0,
    data: {
      isComplete: true,
      attributes: Array.isArray(task.attributes) ? task.attributes : [],
      results: task.results ?? null,
      spawnedAgentIds,
      unassignedAgentIds,
    },
  };
}

/**
 * Builds a `'tick'` boundary entry sealing one tick's event batch. Records the
 * step size and wage payments at the time of the tick, so rollback can reverse
 * the tick exactly even if `timeStep` or agent rates change later.
 * `wagesTotal` is the exact (cent-rounded) bank delta; `wages` itemizes it per
 * agent for log readability. Both are zero/empty when payment was skipped.
 *
 * @param {{ seq: number, clock: number, day: number, stepMins: number,
 *   wagesTotal: number, wages: { agentId: string, agentName: string, amount: number }[] }} params
 * @returns {EventLogEntry}
 */
export function makeTickEvent({ seq, clock, day, stepMins, wagesTotal, wages }) {
  return {
    seq,
    eventType: 'tick',
    clock,
    day,
    agentId: '',
    agentName: '',
    taskId: '',
    taskName: '',
    conditionId: '',
    conditionName: '',
    delta: 0,
    progress: 0,
    target: 0,
    data: { stepMins, wagesTotal, wages },
  };
}

/**
 * Guards a raw log entry from storage or an imported CSV. Coerces numeric
 * fields, defaults `eventType`/`data`, and returns `null` for rows missing a
 * `taskId` (callers should filter those out). `'tick'` boundary rows are exempt
 * from the `taskId` requirement — they never carry one.
 *
 * @param {object} raw
 * @returns {EventLogEntry|null}
 */
export function normalizeEvent(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (!source.taskId && source.eventType !== 'tick') return null;
  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    seq: num(source.seq),
    eventType: typeof source.eventType === 'string' && source.eventType ? source.eventType : 'work_contribution',
    clock: num(source.clock),
    day: num(source.day),
    agentId: String(source.agentId ?? ''),
    agentName: String(source.agentName ?? ''),
    taskId: String(source.taskId ?? ''),
    taskName: String(source.taskName ?? ''),
    conditionId: String(source.conditionId ?? ''),
    conditionName: String(source.conditionName ?? ''),
    delta: num(source.delta),
    progress: num(source.progress),
    target: num(source.target),
    data: source.data && typeof source.data === 'object' ? source.data : {},
  };
}

/**
 * Returns the log trimmed to at most `maxRows` entries, keeping the most recent
 * (FIFO eviction of the oldest). `seq` values are not renumbered, so they stay
 * monotonic across trims.
 *
 * @param {EventLogEntry[]} eventLog
 * @param {number} [maxRows=MAX_LOG_ROWS]
 * @returns {EventLogEntry[]}
 */
export function capEventLog(eventLog, maxRows = MAX_LOG_ROWS) {
  if (!Array.isArray(eventLog) || eventLog.length <= maxRows) return eventLog;
  return eventLog.slice(eventLog.length - maxRows);
}

// Wraps a CSV field in double quotes (doubling embedded quotes) only when it
// contains a delimiter, quote, or newline — per RFC 4180.
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serializes the log to an RFC-4180-style CSV string (header row + one row per
 * entry). The `data` object is JSON-encoded into its cell.
 *
 * @param {EventLogEntry[]} eventLog
 * @returns {string}
 */
export function serializeEventLog(eventLog) {
  const rows = [EVENT_LOG_COLUMNS.join(',')];
  for (const entry of eventLog || []) {
    const cells = EVENT_LOG_COLUMNS.map(column =>
      csvCell(column === 'data' ? JSON.stringify(entry.data ?? {}) : entry[column]));
    rows.push(cells.join(','));
  }
  return rows.join('\n');
}

// Splits one CSV line into fields, honoring double-quoted fields (with doubled
// quotes for literal quotes). Does not span newlines: callers split on rows
// first, which is safe because serialized cells never contain raw newlines
// (the only multiline candidate, `data`, is single-line JSON).
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields;
}

/**
 * Parses a CSV string produced by `serializeEventLog` back into entries.
 * Numeric columns are coerced; the `data` cell is JSON-parsed (falling back to
 * `{}` if malformed, so a hand-edited file can't crash the app). A trailing
 * newline / blank final line is ignored.
 *
 * @param {string} csvText
 * @returns {EventLogEntry[]}
 */
export function parseEventLog(csvText) {
  const lines = String(csvText ?? '').split(/\r?\n/).filter(line => line.length > 0);
  if (lines.length <= 1) return [];
  const header = parseCsvLine(lines[0]);
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const raw = {};
    header.forEach((column, index) => {
      const cell = cells[index] ?? '';
      if (column === 'data') {
        try { raw.data = JSON.parse(cell); } catch { raw.data = {}; }
      } else if (NUMERIC_COLUMNS.has(column)) {
        raw[column] = Number(cell);
      } else {
        raw[column] = cell;
      }
    });
    const entry = normalizeEvent(raw);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Exports the log to a CSV file via the shared `downloadFile` helper.
 *
 * @param {EventLogEntry[]} eventLog
 * @param {string} sessionId - Used in the suggested filename
 * @returns {Promise<void>}
 */
export async function saveEventLogToFile(eventLog, sessionId) {
  const csv = serializeEventLog(eventLog);
  const suggestedName = `hirelings-${sessionId || 'export'}-eventlog.csv`;
  await downloadFile(csv, suggestedName, { mime: 'text/csv', pickerTypes: CSV_TYPES });
}

/**
 * Reads and parses a user-selected CSV log file.
 *
 * @param {File} file
 * @returns {Promise<EventLogEntry[]>}
 */
export function loadEventLogFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(parseEventLog(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}
