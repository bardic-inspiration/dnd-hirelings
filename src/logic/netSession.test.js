import { describe, expect, it, vi } from 'vitest';
import { advanceTime } from './clock.js';
import { rollbackTime } from './rollback.js';
import { stateAt } from './clockSources.js';
import { DEFAULT_STATE } from '../state/storage.js';
import {
  BATON_POLL_MS,
  batonChanged,
  buildCommit,
  createNetDispatch,
  createTransport,
  cutState,
  parseSessionParams,
  recordAction,
  startRecording,
  turnLogSlice,
} from './netSession.js';

const tick = (state, count = 1) => advanceTime(state, { count }).newState;
const clockOf = (state) => state.session.clock;

describe('parseSessionParams', () => {
  it('returns the session id and role when both are present', () => {
    expect(parseSessionParams('?session=T1&role=gm')).toEqual({ sessionId: 'T1', role: 'gm' });
    expect(parseSessionParams('?role=party&session=abc')).toEqual({ sessionId: 'abc', role: 'party' });
  });

  it('returns null — offline — without both parameters', () => {
    expect(parseSessionParams('')).toBeNull();
    expect(parseSessionParams('?session=T1')).toBeNull();
    expect(parseSessionParams('?role=gm')).toBeNull();
  });

  it('returns null for an unknown role', () => {
    expect(parseSessionParams('?session=T1&role=admin')).toBeNull();
  });
});

describe('createTransport', () => {
  function stubFetch(status, body) {
    return vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  }

  it('sends the role as a query parameter and JSON bodies on writes', async () => {
    const fetchImpl = stubFetch(200, { holder: 'h' });
    const transport = createTransport({ sessionId: 'T 1', role: 'party', fetchImpl });
    await transport.commit('h', { base: 0 });
    expect(fetchImpl).toHaveBeenCalledWith('/api/session/T%201/commit?role=party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holder: 'h', commit: { base: 0 } }),
    });
  });

  it('resolves error statuses instead of throwing', async () => {
    const transport = createTransport({ sessionId: 'T1', role: 'gm', fetchImpl: stubFetch(404, { error: 'no such session' }) });
    expect(await transport.getSession()).toEqual({ ok: false, status: 404, body: { error: 'no such session' } });
  });

  it('maps every route to its method and path', async () => {
    const fetchImpl = stubFetch(200, {});
    const transport = createTransport({ sessionId: 'T1', role: 'gm', fetchImpl });
    await transport.getSession();
    await transport.putSession({});
    await transport.getBaton();
    await transport.claim();
    await transport.getPending();
    await transport.finalize({ cutIndex: 0, head: {} });
    await transport.setBaton({ turnOwner: 'gm' });
    expect(fetchImpl.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET /api/session/T1?role=gm',
      'PUT /api/session/T1?role=gm',
      'GET /api/session/T1/baton?role=gm',
      'POST /api/session/T1/claim?role=gm',
      'GET /api/session/T1/pending?role=gm',
      'POST /api/session/T1/finalize?role=gm',
      'POST /api/session/T1/baton?role=gm',
    ]);
  });
});

describe('batonChanged', () => {
  const baton = { turnOwner: 'party', status: 'party-turn', holder: null };

  it('is false for an identical baton', () => {
    expect(batonChanged(baton, { ...baton })).toBe(false);
  });

  it('is true when turnOwner, status, or holder changes', () => {
    expect(batonChanged(baton, { ...baton, turnOwner: 'gm' })).toBe(true);
    expect(batonChanged(baton, { ...baton, status: 'pending-review' })).toBe(true);
    expect(batonChanged(baton, { ...baton, holder: 'h' })).toBe(true);
  });

  it('is true for the first baton seen', () => {
    expect(batonChanged(null, baton)).toBe(true);
  });

  it('polls every 3 seconds', () => {
    expect(BATON_POLL_MS).toBe(3000);
  });
});

describe('snapshot recording', () => {
  it('starts with the turn start at index 0', () => {
    expect(startRecording(DEFAULT_STATE)).toEqual([DEFAULT_STATE]);
  });

  it('pushes the new state on APPLY_TICK', () => {
    const next = tick(DEFAULT_STATE);
    const snapshots = recordAction(startRecording(DEFAULT_STATE), { type: 'APPLY_TICK', newState: next });
    expect(snapshots).toEqual([DEFAULT_STATE, next]);
  });

  it('pushes one snapshot per tick a multi-tick step spans, so index i is the i-th tick', () => {
    const next = tick(DEFAULT_STATE, 3);
    const snapshots = recordAction(startRecording(DEFAULT_STATE), { type: 'APPLY_TICK', newState: next });
    expect(snapshots.map(clockOf)).toEqual([0, 1, 2, 3]);
    expect(snapshots[3]).toBe(next);
  });

  it('pops one snapshot per reversed tick on APPLY_ROLLBACK', () => {
    let snapshots = startRecording(DEFAULT_STATE);
    let state = DEFAULT_STATE;
    for (let i = 0; i < 3; i++) {
      state = tick(state);
      snapshots = recordAction(snapshots, { type: 'APPLY_TICK', newState: state });
    }
    const rolled = rollbackTime(state, { count: 2 }).newState;
    snapshots = recordAction(snapshots, { type: 'APPLY_ROLLBACK', newState: rolled });
    expect(snapshots.map(clockOf)).toEqual([0, 1]);
  });

  it('never pops below index 0', () => {
    const start = tick(DEFAULT_STATE, 2);
    const rolled = rollbackTime(start, { count: 2 }).newState;
    const snapshots = recordAction(startRecording(start), { type: 'APPLY_ROLLBACK', newState: rolled });
    expect(snapshots).toEqual([start]);
  });

  it('ignores other actions, and records nothing when not recording', () => {
    const snapshots = startRecording(DEFAULT_STATE);
    expect(recordAction(snapshots, { type: 'AGENT_ADD_ACTIVITY', id: 'a', tag: 't' })).toBe(snapshots);
    expect(recordAction(null, { type: 'APPLY_TICK', newState: tick(DEFAULT_STATE) })).toBeNull();
  });
});

describe('createNetDispatch', () => {
  it('drops actions the mode disallows, without recording them', () => {
    const rawDispatch = vi.fn();
    const recording = { current: startRecording(DEFAULT_STATE) };
    const dispatch = createNetDispatch({ rawDispatch, getMode: () => 'spectator', recording });
    dispatch({ type: 'APPLY_TICK', newState: tick(DEFAULT_STATE) });
    expect(rawDispatch).not.toHaveBeenCalled();
    expect(recording.current).toHaveLength(1);
  });

  it('records and forwards allowed actions', () => {
    const rawDispatch = vi.fn();
    const recording = { current: startRecording(DEFAULT_STATE) };
    const dispatch = createNetDispatch({ rawDispatch, getMode: () => 'player', recording });
    const action = { type: 'APPLY_TICK', newState: tick(DEFAULT_STATE) };
    dispatch(action);
    expect(rawDispatch).toHaveBeenCalledWith(action);
    expect(recording.current).toHaveLength(2);
  });

  it('reads the mode at dispatch time', () => {
    const rawDispatch = vi.fn();
    let mode = 'spectator';
    const dispatch = createNetDispatch({ rawDispatch, getMode: () => mode, recording: { current: null } });
    dispatch({ type: 'AGENT_ADD_ACTIVITY' });
    mode = 'player';
    dispatch({ type: 'AGENT_ADD_ACTIVITY' });
    expect(rawDispatch).toHaveBeenCalledTimes(1);
  });
});

// A board with one prior tick, then a three-tick turn.
function playTurn() {
  const turnStart = tick(DEFAULT_STATE);
  let snapshots = startRecording(turnStart);
  let state = turnStart;
  for (let i = 0; i < 3; i++) {
    state = tick(state);
    snapshots = recordAction(snapshots, { type: 'APPLY_TICK', newState: state });
  }
  return { turnStart, snapshots, endState: { ...state, session: { ...state.session, bank: 999 } } };
}

describe('turnLogSlice', () => {
  it('returns the rows of the last N ticks', () => {
    const { endState } = playTurn();
    const slice = turnLogSlice(endState.eventLog, 3);
    expect(slice.map((row) => row.clock)).toEqual([2, 3, 4]);
  });

  it('returns nothing for a turn with no ticks, and everything when N covers the whole log', () => {
    const { endState } = playTurn();
    expect(turnLogSlice(endState.eventLog, 0)).toEqual([]);
    expect(turnLogSlice(endState.eventLog, 10)).toEqual(endState.eventLog);
  });
});

describe('buildCommit', () => {
  it('keeps base, the turn slice, and the full end state; snapshots omit eventLog and tagRegistry', () => {
    const { snapshots, endState } = playTurn();
    const eventLog = turnLogSlice(endState.eventLog, 3);
    const commit = buildCommit({ base: 4, snapshots, eventLog, endState });
    expect(commit.base).toBe(4);
    expect(commit.eventLog).toBe(eventLog);
    expect(commit.endState).toBe(endState);
    expect(commit.snapshots).toHaveLength(4);
    for (const snapshot of commit.snapshots) {
      expect(snapshot).not.toHaveProperty('eventLog');
      expect(snapshot).not.toHaveProperty('tagRegistry');
      expect(snapshot).toHaveProperty('session');
    }
  });

  it('replays through stateAt with the turn-relative log', () => {
    const { snapshots, endState } = playTurn();
    const commit = buildCommit({ base: 0, snapshots, eventLog: turnLogSlice(endState.eventLog, 3), endState });
    const atOne = stateAt(commit, 1);
    expect(atOne.session.clock).toBe(2);
    expect(atOne.eventLog.map((row) => row.clock)).toEqual([2]);
    expect(stateAt(commit, 3)).toBe(endState);
  });
});

describe('cutState', () => {
  it('rebuilds the board at the cut with the full log cut to match', () => {
    const { snapshots, endState } = playTurn();
    const commit = buildCommit({ base: 0, snapshots, eventLog: turnLogSlice(endState.eventLog, 3), endState });
    const head = cutState(commit, 1);
    expect(head.session.clock).toBe(2);
    expect(head.tagRegistry).toBe(endState.tagRegistry);
    expect(head.eventLog.map((row) => row.clock)).toEqual([1, 2]);
  });

  it('resolves a cut at 0 to the turn start, rejecting the whole turn', () => {
    const { snapshots, endState, turnStart } = playTurn();
    const commit = buildCommit({ base: 0, snapshots, eventLog: turnLogSlice(endState.eventLog, 3), endState });
    const head = cutState(commit, 0);
    expect(head.session).toEqual(turnStart.session);
    expect(head.eventLog).toEqual(turnStart.eventLog);
  });

  it('resolves a cut at the end to endState, including edits after the last tick', () => {
    const { snapshots, endState } = playTurn();
    const commit = buildCommit({ base: 0, snapshots, eventLog: turnLogSlice(endState.eventLog, 3), endState });
    expect(cutState(commit, 3)).toBe(endState);
    expect(cutState(commit, 3).session.bank).toBe(999);
  });
});
