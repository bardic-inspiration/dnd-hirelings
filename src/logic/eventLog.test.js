import { describe, it, expect } from 'vitest';
import {
  makeWorkEvent, makeCompleteEvent, makeTickEvent, normalizeEvent,
  capEventLog, serializeEventLog, parseEventLog,
} from './eventLog.js';

const agent = { id: 'a1', name: 'Ada' };
const task = { id: 't1', name: 'Task, One', attributes: ['skill:arcana'], results: { gold: 5 } };
const condition = { id: 'c1', name: 'ARCANA', target: 100 };

describe('capEventLog', () => {
  it('keeps the most recent rows and preserves their seq', () => {
    const log = [0, 1, 2, 3, 4].map(seq => ({ seq }));
    expect(capEventLog(log, 3)).toEqual([{ seq: 2 }, { seq: 3 }, { seq: 4 }]);
  });

  it('returns the same reference when already within the cap', () => {
    const log = [{ seq: 0 }];
    expect(capEventLog(log, 3)).toBe(log);
  });
});

describe('normalizeEvent', () => {
  it('drops rows without a taskId and coerces numerics', () => {
    expect(normalizeEvent({ agentId: 'a1' })).toBeNull();
    expect(normalizeEvent({ taskId: 't1', seq: '7', delta: 'x' })).toMatchObject({ seq: 7, delta: 0 });
  });

  it('keeps tick boundary rows despite their empty taskId', () => {
    const tick = makeTickEvent({ seq: 3, clock: 1, wagesTotal: 2, wages: [] });
    expect(normalizeEvent(tick)).toMatchObject({ eventType: 'tick', taskId: '', data: { wagesTotal: 2 } });
  });
});

describe('makeCompleteEvent', () => {
  it('records the spawn/unassign ids rollback needs, defaulting to empty', () => {
    expect(makeCompleteEvent({ seq: 0, clock: 0, task }).data)
      .toMatchObject({ spawnedAgentIds: [], unassignedAgentIds: [] });
    const event = makeCompleteEvent({
      seq: 0, clock: 0, task, spawnedAgentIds: ['s1'], unassignedAgentIds: ['a1'],
    });
    expect(event.data.spawnedAgentIds).toEqual(['s1']);
    expect(event.data.unassignedAgentIds).toEqual(['a1']);
  });
});

describe('CSV round-trip', () => {
  it('serializes and re-parses work, completion, and tick events without loss', () => {
    const log = [
      makeWorkEvent({ seq: 0, clock: 1, agent, task, condition, delta: 4, progress: 4 }),
      makeCompleteEvent({ seq: 1, clock: 2, task, spawnedAgentIds: ['s1'], unassignedAgentIds: ['a1'] }),
      makeTickEvent({
        seq: 2, clock: 2, wagesTotal: 2,
        wages: [{ agentId: 'a1', agentName: 'Ada', amount: 2 }],
      }),
    ];
    const parsed = parseEventLog(serializeEventLog(log));
    expect(parsed).toEqual(log);
  });

  it('quotes and recovers fields containing a comma', () => {
    const log = [makeWorkEvent({ seq: 0, clock: 0, agent, task, condition, delta: 1, progress: 1 })];
    const csv = serializeEventLog(log);
    expect(csv).toContain('"Task, One"');
    expect(parseEventLog(csv)[0].taskName).toBe('Task, One');
  });

  it('returns an empty log for header-only or blank input', () => {
    expect(parseEventLog('')).toEqual([]);
    expect(parseEventLog(serializeEventLog([]))).toEqual([]);
  });

  it('falls back to {} for a corrupt data cell rather than throwing', () => {
    const header = 'seq,eventType,clock,agentId,agentName,taskId,taskName,conditionId,conditionName,delta,progress,target,data';
    const row = '0,work_contribution,0,a1,Ada,t1,T,c1,ARCANA,1,1,100,{not json';
    expect(parseEventLog(`${header}\n${row}`)[0].data).toEqual({});
  });
});
