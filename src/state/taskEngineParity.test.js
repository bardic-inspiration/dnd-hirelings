import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeState } from './storage.js';
import { advanceTime } from '../logic/clock.js';
import { rollbackTime } from '../logic/rollback.js';
import { conditionsView, resultsView } from '../logic/taskModel.js';
import save from '../fixtures/v6-parity-save.json';
import golden from '../fixtures/v6-parity-golden.json';

// Parity with the engine the task engine replaced (plan #117, Phase 1 exit).
// `v6-parity-save.json` is a v6 save: working, blocked, zero-condition, and
// already-complete tasks; gated, ungated, and compared conditions; rewards
// that spawn, stack, create, and unblock; a wage failure; and a pre-engine
// completion row in its log. `v6-parity-golden.json` is what the pre-engine
// code (main at 7c34cd6) produced from it, one tick at a time for 10 ticks and
// then one rollback at a time to the horizon, with ids and timestamps pinned.

let nextId = 0;
vi.mock('../utils.js', () => ({ uid: () => `uid-${++nextId}`, now: () => 1000 }));
beforeEach(() => { nextId = 0; });

// The comparable view of a state. Tasks are compared through their condition
// and results views, the shape the pre-engine code stored.
const project = (state) => ({
  session: state.session,
  agents: state.agents,
  inventory: state.inventory,
  tasks: state.tasks.map(task => ({
    id: task.id,
    isComplete: task.isComplete,
    progress: Object.fromEntries(conditionsView(task).map(row => [row.id, row.progress])),
    results: resultsView(task),
  })),
  logLength: state.eventLog.length,
});

// A log row as the pre-engine code wrote it: without the two task-engine
// columns, `seq` (action rows now take sequence numbers), or the reward
// details a completion row carried before they became action rows.
const legacyRow = ({ seq: _seq, actionKind: _kind, reverseData: _reverse, ...row }) => (row.eventType === 'task_complete'
  ? { ...row, data: { isComplete: row.data.isComplete, attributes: row.data.attributes } }
  : row);
const legacyRows = (log) => log.filter(row => row.eventType !== 'action').map(legacyRow);

describe('v6 save parity', () => {
  it('advances tick for tick like the pre-engine code', () => {
    let state = normalizeState(JSON.parse(JSON.stringify(save)));
    golden.forward.forEach((expected, index) => {
      const result = advanceTime(state, { count: 1 });
      state = result.newState;
      const { logLength: _length, ...comparable } = project(state);
      const { logLength: _expectedLength, ...expectedComparable } = expected;
      expect(comparable, `tick ${index + 1}`).toEqual(expectedComparable);
      expect(result.flashAgentIds, `tick ${index + 1} flashes`).toEqual(golden.flashes[index]);
      expect(result.taskProgressPerTick, `tick ${index + 1} rates`).toEqual(golden.perTick[index]);
    });
    expect(legacyRows(state.eventLog)).toEqual(legacyRows(golden.finalLog));
  });

  it('rolls back tick for tick to the same states, through the pre-engine rows too', () => {
    let state = normalizeState(JSON.parse(JSON.stringify(save)));
    for (let tick = 0; tick < golden.forward.length; tick++) state = advanceTime(state, { count: 1 }).newState;
    golden.backward.forEach((expected, index) => {
      const result = rollbackTime(state, { count: 1 });
      expect(result, `rollback ${index + 1}`).not.toBeNull();
      state = result.newState;
      const { logLength: _length, ...comparable } = project(state);
      const { logLength: expectedLength, ...expectedComparable } = expected;
      expect(comparable, `rollback ${index + 1}`).toEqual(expectedComparable);
      // The engine logs more rows per tick (actions), so compare the rows
      // left against what was left of the pre-engine log.
      expect(legacyRows(state.eventLog), `rollback ${index + 1} log`)
        .toEqual(legacyRows(golden.finalLog.slice(0, expectedLength)));
    });
    expect(rollbackTime(state, { count: 1 })).toBeNull();
  });
});
