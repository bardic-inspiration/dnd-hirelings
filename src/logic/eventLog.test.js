import { describe, it, expect } from 'vitest';
import {
  makeWorkEvent, makeCompleteEvent, normalizeEvent, normalizeLoggingConfig,
  capEventLog, serializeEventLog, parseEventLog, MAX_LOG_ROWS,
} from './eventLog.js';

const agent = { id: 'a1', name: 'Ada' };
const task = { id: 't1', name: 'Task, One', attributes: ['skill:arcana'], results: { gold: 5 } };
const condition = { id: 'c1', name: 'ARCANA', target: 100 };

describe('normalizeLoggingConfig', () => {
  it('defaults missing/invalid fields and drops unknown keys', () => {
    expect(normalizeLoggingConfig(undefined)).toEqual({ enabled: true, maxRows: MAX_LOG_ROWS });
    expect(normalizeLoggingConfig({ enabled: false, maxRows: 10 })).toEqual({ enabled: false, maxRows: 10 });
    expect(normalizeLoggingConfig({ maxRows: -5 }).maxRows).toBe(MAX_LOG_ROWS);
    expect(normalizeLoggingConfig({ maxRows: 'x', extra: 1 })).toEqual({ enabled: true, maxRows: MAX_LOG_ROWS });
  });
});

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
});

describe('CSV round-trip', () => {
  it('serializes and re-parses work and completion events without loss', () => {
    const log = [
      makeWorkEvent({ seq: 0, clock: 1440, day: 1, agent, task, condition, delta: 4, progress: 4 }),
      makeCompleteEvent({ seq: 1, clock: 2880, day: 2, task }),
    ];
    const parsed = parseEventLog(serializeEventLog(log));
    expect(parsed).toEqual(log);
  });

  it('quotes and recovers fields containing a comma', () => {
    const log = [makeWorkEvent({ seq: 0, clock: 0, day: 0, agent, task, condition, delta: 1, progress: 1 })];
    const csv = serializeEventLog(log);
    expect(csv).toContain('"Task, One"');
    expect(parseEventLog(csv)[0].taskName).toBe('Task, One');
  });

  it('returns an empty log for header-only or blank input', () => {
    expect(parseEventLog('')).toEqual([]);
    expect(parseEventLog(serializeEventLog([]))).toEqual([]);
  });

  it('falls back to {} for a corrupt data cell rather than throwing', () => {
    const header = 'seq,eventType,clock,day,agentId,agentName,taskId,taskName,conditionId,conditionName,delta,progress,target,data';
    const row = '0,work_contribution,0,0,a1,Ada,t1,T,c1,ARCANA,1,1,100,{not json';
    expect(parseEventLog(`${header}\n${row}`)[0].data).toEqual({});
  });
});
