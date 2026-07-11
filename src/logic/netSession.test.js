import { describe, it, expect } from 'vitest';
import { buildCommit, readSessionParams, BATON_POLL_MS } from './netSession.js';

describe('buildCommit', () => {
  const endState = {
    session: { clock: 2 }, marker: 'end',
    eventLog: ['whole', 'turn', 'log'], tagRegistry: { skill: {} },
  };

  it('strips eventLog/tagRegistry from every snapshot but keeps endState whole', () => {
    const snapshots = [
      { session: { clock: 0 }, eventLog: ['a'], tagRegistry: { x: {} }, marker: 's0' },
      { session: { clock: 1 }, eventLog: ['b'], tagRegistry: { y: {} }, marker: 's1' },
    ];
    const commit = buildCommit({ base: 3, snapshots, eventLog: ['turn-slice'], endState });
    expect(commit.base).toBe(3);
    expect(commit.snapshots).toEqual([
      { session: { clock: 0 }, marker: 's0' },
      { session: { clock: 1 }, marker: 's1' },
    ]);
    // endState ships complete — the single source for log + registry at review.
    expect(commit.endState).toBe(endState);
    expect(commit.eventLog).toEqual(['turn-slice']);
  });

  it('tolerates missing snapshots/eventLog', () => {
    const commit = buildCommit({ base: 1, endState });
    expect(commit.snapshots).toEqual([]);
    expect(commit.eventLog).toEqual([]);
  });
});

describe('readSessionParams', () => {
  it('is offline by default (no session param)', () => {
    expect(readSessionParams('')).toEqual({ enabled: false, sessionId: null, role: 'party' });
    expect(readSessionParams('?foo=bar').enabled).toBe(false);
  });

  it('reads session id and role, defaulting an unknown role to party', () => {
    expect(readSessionParams('?session=T1&role=gm')).toEqual({ enabled: true, sessionId: 'T1', role: 'gm' });
    expect(readSessionParams('?session=T1&role=party')).toEqual({ enabled: true, sessionId: 'T1', role: 'party' });
    expect(readSessionParams('?session=T1&role=bogus').role).toBe('party');
    expect(readSessionParams('?session=T1').role).toBe('party');
  });

  it('exposes a poll interval constant', () => {
    expect(BATON_POLL_MS).toBeGreaterThan(0);
  });
});
