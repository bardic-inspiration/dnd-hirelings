// Networked session logic (docs/spec/multiplayer.md "Networked session",
// "Snapshots"): the URL join parameters, the HTTP transport to the session
// server, the turn's snapshot recorder, and the commit and cut documents built
// from it. Everything here except the transport is pure.

import { gateDispatch } from './permissions.js';
import { logPrefix, stateAt } from './clockSources.js';
import { rollbackTime } from './rollback.js';

/** How often a networked client polls the baton, in milliseconds. */
export const BATON_POLL_MS = 3000;

/** Root of the session server's routes; Vite proxies `/api` to the server in dev. */
export const SESSION_API_ROOT = '/api/session';

const ROLES = new Set(['gm', 'party']);

/**
 * Reads the join parameters from a URL query string.
 *
 * @param {string} search A query string such as `?session=T1&role=gm`.
 * @returns {{ sessionId: string, role: 'gm'|'party' }|null} `null` — offline —
 *   unless both `session` and a known `role` are present.
 */
export function parseSessionParams(search) {
  const params = new URLSearchParams(search ?? '');
  const sessionId = params.get('session');
  const role = params.get('role');
  if (!sessionId || !ROLES.has(role)) return null;
  return { sessionId, role };
}

/**
 * Creates the HTTP transport for one session and role — plain `fetch` over
 * the server's routes. Every call resolves `{ ok, status, body }`, so callers
 * branch on `404` / `409` / `403` without exceptions; only a network failure
 * rejects.
 *
 * @param {{ sessionId: string, role: string, fetchImpl?: typeof fetch, root?: string }} options
 */
export function createTransport({ sessionId, role, fetchImpl = (...args) => fetch(...args), root = SESSION_API_ROOT }) {
  const base = `${root}/${encodeURIComponent(sessionId)}`;

  async function request(method, route, body) {
    const res = await fetchImpl(`${base}${route}?role=${encodeURIComponent(role)}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body: parsed };
  }

  return {
    getSession: () => request('GET', ''),
    putSession: (head) => request('PUT', '', { head }),
    getBaton: () => request('GET', '/baton'),
    claim: () => request('POST', '/claim'),
    commit: (holder, commit) => request('POST', '/commit', { holder, commit }),
    getPending: () => request('GET', '/pending'),
    finalize: ({ cutIndex, message, head }) => request('POST', '/finalize', { cutIndex, message, head }),
    setBaton: ({ turnOwner, head }) => request('POST', '/baton', { turnOwner, head }),
  };
}

/**
 * Whether a polled baton differs from the last one seen in a way that calls
 * for pulling the whole session: its `turnOwner`, `status`, or `holder`.
 *
 * @param {object|null} previous
 * @param {object|null} next
 * @returns {boolean}
 */
export function batonChanged(previous, next) {
  if (!previous || !next) return previous !== next;
  return previous.turnOwner !== next.turnOwner
    || previous.status !== next.status
    || previous.holder !== next.holder;
}

/** Reads `session.clock` — the elapsed tick count — from a GameState. */
function clockOf(state) {
  return Number(state?.session?.clock) || 0;
}

/**
 * Starts a turn's recording: index 0 is the turn start, so a cut at 0 rejects
 * the whole turn.
 *
 * @param {object} state The GameState at claim.
 * @returns {object[]}
 */
export function startRecording(state) {
  return [state];
}

/**
 * Applies one dispatched action to a turn's recording, returning the new list
 * (or the same list when the action doesn't move the clock).
 *
 * - `APPLY_TICK` pushes one snapshot per tick the step spans, so index `i` is
 *   always the `i`-th tick boundary. A step spanning several ticks
 *   (`timeStep` > 1) only exposes its end state; the intermediate snapshots
 *   are rebuilt by rolling that end state back one tick at a time
 *   (best-effort, `INV-7`).
 * - `APPLY_ROLLBACK` pops one snapshot per reversed tick, never below index 0.
 *
 * Tick counts come from `session.clock`, which counts elapsed ticks.
 *
 * @param {object[]|null} snapshots The recording, or `null` when not recording.
 * @param {object} action The reducer action.
 * @returns {object[]|null}
 */
export function recordAction(snapshots, action) {
  if (!snapshots || !action?.newState) return snapshots;
  const lastClock = clockOf(snapshots[snapshots.length - 1]);
  const nextClock = clockOf(action.newState);

  if (action.type === 'APPLY_TICK') {
    const ticks = Math.max(1, nextClock - lastClock);
    const pushed = [action.newState];
    let current = action.newState;
    for (let i = 1; i < ticks; i++) {
      current = rollbackTime(current, { count: 1 })?.newState ?? current;
      pushed.unshift(current);
    }
    return [...snapshots, ...pushed];
  }

  if (action.type === 'APPLY_ROLLBACK') {
    const reversed = Math.max(0, lastClock - nextClock);
    return snapshots.slice(0, Math.max(1, snapshots.length - reversed));
  }

  return snapshots;
}

/**
 * Wraps a provider's raw dispatch for a networked session: the permission gate
 * first (`gateDispatch`), then — for every action the gate lets through — the
 * snapshot recorder, which updates `recording.current` while it holds a list.
 *
 * @param {{ rawDispatch: (action: object) => void, getMode: () => string,
 *   recording: { current: object[]|null } }} options
 * @returns {(action: object) => void}
 */
export function createNetDispatch({ rawDispatch, getMode, recording }) {
  return gateDispatch((action) => {
    recording.current = recordAction(recording.current, action);
    return rawDispatch(action);
  }, getMode);
}

/**
 * The rows of a full event log that belong to the last `tickCount` ticks.
 *
 * @param {object[]} eventLog
 * @param {number} tickCount
 * @returns {object[]}
 */
export function turnLogSlice(eventLog, tickCount) {
  const log = Array.isArray(eventLog) ? eventLog : [];
  const totalTicks = log.filter((row) => row?.eventType === 'tick').length;
  const before = totalTicks - Math.max(0, tickCount);
  if (before <= 0) return log.slice();
  return log.slice(logPrefix(log, before).length);
}

/** A snapshot as committed: the state without `eventLog` and `tagRegistry`. */
function stripSnapshot(state) {
  const { eventLog: _eventLog, tagRegistry: _tagRegistry, ...rest } = state ?? {};
  return rest;
}

/**
 * Builds the commit document a party posts at the end of its turn.
 *
 * @param {{ base: number, snapshots: object[], eventLog: object[], endState: object }} turn
 *   `base` — the head revision pulled; `snapshots` — the recording;
 *   `eventLog` — the turn's slice of the log; `endState` — the full current state.
 * @returns {{ base: number, snapshots: object[], eventLog: object[], endState: object }}
 *   Snapshots omit `eventLog` and `tagRegistry` (the registry can't change in a
 *   party turn).
 */
export function buildCommit({ base, snapshots, eventLog, endState }) {
  return {
    base,
    snapshots: (snapshots ?? []).map(stripSnapshot),
    eventLog: Array.isArray(eventLog) ? eventLog : [],
    endState,
  };
}

/**
 * The head a GM finalizes from a commit cut at `cutIndex`: the board at that
 * tick boundary (`stateAt`), with the full event log cut to match — the turn's
 * ticks after the cut are dropped from the end state's log. A cut at the end
 * resolves to `endState` itself.
 *
 * @param {{ snapshots: object[], eventLog: object[], endState: object }} commit
 * @param {number} cutIndex
 * @returns {object|null}
 */
export function cutState(commit, cutIndex) {
  const board = stateAt(commit, cutIndex);
  if (!board || !commit?.endState) return board;
  if (board === commit.endState) return board;
  const max = Math.max(0, (commit.snapshots?.length ?? 1) - 1);
  const dropped = max - Math.max(0, Math.min(max, Math.round(Number(cutIndex) || 0)));
  const fullLog = commit.endState.eventLog ?? [];
  const totalTicks = fullLog.filter((row) => row?.eventType === 'tick').length;
  // An unlogged turn (logging off) has no tick rows to drop.
  if (totalTicks === 0) return { ...board, eventLog: fullLog };
  return { ...board, eventLog: logPrefix(fullLog, totalTicks - dropped) };
}
