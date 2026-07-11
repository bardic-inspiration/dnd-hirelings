// Network transport for GM/Player mode (see docs/specs/gm-player-mode.md §2).
// Plain `fetch` wrappers over the route table (§4), all rooted at `/api`, plus
// `buildCommit`. This module is the network analog of logic/session.js (file
// save/load) and follows buildOrder/submitOrder's transport-document pattern:
// the commit document is serializable and transport-agnostic.

const API_ROOT = '/api/session';

/** Milliseconds between light baton polls (Q-refresh). */
export const BATON_POLL_MS = 3000;

/**
 * Reads the session declaration from the URL (Q-join): `?session=<id>&role=gm|party`.
 * Offline is the default — a missing `session` param yields `{ enabled: false }`,
 * which keeps exactly today's app (no networking, no polling, no mode panel).
 * An unrecognized role degrades to `party` (honor-system trust model).
 *
 * @param {string} [search] - A `location.search` string; defaults to the live one.
 * @returns {{ enabled: boolean, sessionId: string|null, role: 'gm'|'party' }}
 */
export function readSessionParams(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  const sessionId = params.get('session');
  const role = params.get('role') === 'gm' ? 'gm' : 'party';
  return { enabled: !!sessionId, sessionId, role };
}

// Every route carries the caller's role as a query param (honor-system trust
// model, matching the server). Errors reject with `{ status }` attached so
// callers can branch on 403/404/409.
async function request(method, path, { role, body } = {}) {
  const url = `${API_ROOT}/${path}${role ? `?role=${encodeURIComponent(role)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `${res.status} ${res.statusText}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

/** `GET /session/:id` → `{ headRev, head, baton, lastReview }`. Rejects 404 when absent. */
export const fetchSession = (id) => request('GET', encodeURIComponent(id), {});

/** `PUT /session/:id` (GM) — create/seed a session from the GM's local state. */
export const putSession = (id, head) => request('PUT', encodeURIComponent(id), { role: 'gm', body: { head } });

/** `GET /session/:id/baton` → `{ headRev, baton }`. The cheap poll body. */
export const fetchBaton = (id) => request('GET', `${encodeURIComponent(id)}/baton`, {});

/** `POST /session/:id/claim` (party) → `{ holder, baton }`. Rejects 409 if taken. */
export const claimPen = (id) => request('POST', `${encodeURIComponent(id)}/claim`, { role: 'party', body: {} });

/** `POST /session/:id/commit` (party) — body is a commit document + `holder`. */
export const postCommit = (id, commit) => request('POST', `${encodeURIComponent(id)}/commit`, { role: 'party', body: commit });

/** `GET /session/:id/pending` (GM) → the commit document. Rejects 404 if none. */
export const fetchPending = (id) => request('GET', `${encodeURIComponent(id)}/pending`, { role: 'gm' });

/** `POST /session/:id/finalize` (GM) — body `{ cutIndex, message?, head }`. */
export const postFinalize = (id, payload) => request('POST', `${encodeURIComponent(id)}/finalize`, { role: 'gm', body: payload });

/** `POST /session/:id/baton` (GM) — body `{ turnOwner, head? }`. */
export const postBaton = (id, payload) => request('POST', `${encodeURIComponent(id)}/baton`, { role: 'gm', body: payload });

/**
 * Assembles a commit document from a completed party turn. Snapshots ship
 * stripped of `eventLog` (shipped once as a whole-turn slice) and `tagRegistry`
 * (invariant across a party turn — every registry/create action is GM-only, and
 * dynamic instance tags are exempt from registration). `endState` ships complete
 * and is the single source for both at review time.
 *
 * @param {{ base: number, snapshots: object[], eventLog: object[], endState: object }} params
 *   `base` is the headRev the party pulled; `snapshots[0]` is the turn-start state.
 * @returns {{ base: number, snapshots: object[], eventLog: object[], endState: object }}
 */
export function buildCommit({ base, snapshots, eventLog, endState }) {
  const strip = ({ eventLog: _log, tagRegistry: _reg, ...rest }) => rest;
  return {
    base,
    snapshots: (snapshots ?? []).map(strip),
    eventLog: eventLog ?? [],
    endState,
  };
}
