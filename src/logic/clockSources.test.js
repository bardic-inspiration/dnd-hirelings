import { describe, it, expect } from 'vitest';
import { CLOCK_SOURCE_REGISTRY, clockSourceFor, stateAt, logPrefix } from './clockSources.js';

// A recorded context standing in for a commit document: three tick boundaries
// (turn start + two ticks), a turn-slice event log, and a distinct endState that
// carries a post-tick manual edit the last snapshot lacks.
function makeCtx() {
  const tag = (eventType, seq) => ({ eventType, seq, taskId: 't1' });
  return {
    snapshots: [
      { session: { clock: 0 }, marker: 'start' },
      { session: { clock: 1 }, marker: 'tick1' },
      { session: { clock: 2 }, marker: 'tick2' },
    ],
    // work → tick per tick group.
    eventLog: [
      tag('work_contribution', 0), tag('tick', 1),
      tag('work_contribution', 2), tag('tick', 3),
    ],
    endState: { session: { clock: 2 }, marker: 'end', tagRegistry: { skill: {} }, eventLog: ['full'] },
  };
}

describe('logPrefix', () => {
  it('cuts the turn-slice log at the i-th tick boundary', () => {
    const ctx = makeCtx();
    expect(logPrefix(ctx, 0)).toEqual([]);
    expect(logPrefix(ctx, 1).map(e => e.seq)).toEqual([0, 1]);
    expect(logPrefix(ctx, 2).map(e => e.seq)).toEqual([0, 1, 2, 3]);
  });

  it('returns the whole log when asked for more ticks than exist', () => {
    expect(logPrefix(makeCtx(), 9).length).toBe(4);
  });
});

describe('stateAt', () => {
  it('clamps the index to [0, max]', () => {
    const ctx = makeCtx();
    expect(stateAt(ctx, -5).index).toBe(0);
    expect(stateAt(ctx, 99).index).toBe(2);
  });

  it('reconstructs intermediate snapshots with folded-in registry and log prefix', () => {
    const ctx = makeCtx();
    const { newState } = stateAt(ctx, 1);
    expect(newState.marker).toBe('tick1');
    // tagRegistry folded back from endState.
    expect(newState.tagRegistry).toEqual({ skill: {} });
    // eventLog is the prefix through the 1st tick.
    expect(newState.eventLog.map(e => e.seq)).toEqual([0, 1]);
  });

  it('returns endState verbatim at the top index (manual edits included)', () => {
    const ctx = makeCtx();
    const { newState, index } = stateAt(ctx, 2);
    expect(index).toBe(2);
    expect(newState).toBe(ctx.endState);
    expect(newState.eventLog).toEqual(['full']);
  });
});

describe('recorded source', () => {
  const recorded = CLOCK_SOURCE_REGISTRY.recorded;

  it('never permits interpolation', () => {
    expect(recorded.interpolate).toBe(false);
  });

  it('steps forward/backward and returns null at the bounds', () => {
    const ctx = makeCtx();
    expect(recorded.stepForward({ ...ctx, index: 0 }, 1).index).toBe(1);
    expect(recorded.stepBackward({ ...ctx, index: 2 }, 1).index).toBe(1);
    // At the top, forward is a no-op → null; at the bottom, back is null.
    expect(recorded.stepForward({ ...ctx, index: 2 }, 1)).toBeNull();
    expect(recorded.stepBackward({ ...ctx, index: 0 }, 1)).toBeNull();
  });

  it('reports bounds at the array edges', () => {
    const ctx = makeCtx();
    expect(recorded.bounds({ ...ctx, index: 0 })).toEqual({ canStepBack: false, canStepForward: true });
    expect(recorded.bounds({ ...ctx, index: 2 })).toEqual({ canStepBack: true, canStepForward: false });
  });
});

describe('live source', () => {
  it('always permits step-forward and interpolation', () => {
    const live = CLOCK_SOURCE_REGISTRY.live;
    expect(live.interpolate).toBe(true);
    expect(live.bounds({ state: { eventLog: [] } }).canStepForward).toBe(true);
  });
});

describe('clockSourceFor', () => {
  it('falls back to live for an unknown source', () => {
    expect(clockSourceFor('bogus')).toBe(CLOCK_SOURCE_REGISTRY.live);
    expect(clockSourceFor('recorded')).toBe(CLOCK_SOURCE_REGISTRY.recorded);
  });
});
