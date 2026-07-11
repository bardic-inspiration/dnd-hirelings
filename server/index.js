// Standalone session server for GM/Player mode (see docs/specs/gm-player-mode.md
// §4). Zero dependencies: node:http + JSON files, one file per session under
// server/data/<id>.json. Reached from the client through a vite `server.proxy`
// entry (`/api` → localhost:3001).
//
// Under commit-shape F1-B a commit carries a full GameState snapshot per tick, so
// the server runs NO game logic: it never simulates, rolls back, or runs a
// reducer. It stores blobs and enforces baton ownership + the write-lock at the
// route. Every mutating route is snapshot-then-mutate (the pre-mutation head is
// appended to an append-only archive before the head changes) and writes the
// session file atomically (write temp + rename).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

/** Data directory, read lazily so tests can point it at a temp dir per run. */
const dataDir = () => process.env.HIRELINGS_DATA_DIR || path.join(HERE, 'data');

/** Baton for a freshly seeded session: the GM holds the turn, no write-lock. */
const INITIAL_BATON = { turnOwner: 'gm', status: 'gm-editing', holder: null };

// ---- storage (atomic file per session) -----------------------------------

function sessionPath(id) {
  return path.join(dataDir(), `${encodeURIComponent(id)}.json`);
}

/** Reads a session document, or `null` when the file does not exist. */
function readSession(id) {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(id), 'utf8'));
  } catch {
    return null;
  }
}

/** Writes a session document atomically (temp file + rename). */
function writeSession(id, session) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const target = sessionPath(id);
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session));
  fs.renameSync(tmp, target);
}

// Appends the pre-mutation head to the append-only archive, then hands the
// session back for mutation — the snapshot-then-mutate discipline shared by
// every handoff route. Archives are never pruned.
function archiveHead(session) {
  session.archive = session.archive ?? [];
  session.archive.push({ rev: session.headRev, head: session.head });
  return session;
}

// ---- http plumbing --------------------------------------------------------

function send(res, status, body) {
  const json = JSON.stringify(body ?? {});
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

// ---- route handlers -------------------------------------------------------
//
// Each returns `{ status, body }`. `role` is asserted from the `?role=` query
// param (honor-system — same trust model as the client). Handlers that mutate
// call `archiveHead` before changing the head and `writeSession` after.

function getSession(id) {
  const session = readSession(id);
  if (!session) return { status: 404, body: { error: 'no such session' } };
  const { headRev, head, baton, lastReview } = session;
  return { status: 200, body: { headRev, head, baton, lastReview: lastReview ?? null } };
}

function putSession(id, role, body) {
  if (role !== 'gm') return { status: 403, body: { error: 'GM only' } };
  const existing = readSession(id);
  // Idempotent seed: re-PUT of an existing session leaves it untouched so a GM
  // rejoin never clobbers an in-flight turn.
  if (existing) return { status: 200, body: { headRev: existing.headRev } };
  const session = {
    headRev: 1,
    head: body.head ?? null,
    baton: { ...INITIAL_BATON },
    pendingCommit: null,
    lastReview: null,
    archive: [],
  };
  writeSession(id, session);
  return { status: 201, body: { headRev: session.headRev } };
}

function getBaton(id) {
  const session = readSession(id);
  if (!session) return { status: 404, body: { error: 'no such session' } };
  return { status: 200, body: { headRev: session.headRev, baton: session.baton } };
}

function postClaim(id, role) {
  if (role !== 'party') return { status: 403, body: { error: 'party only' } };
  const session = readSession(id);
  if (!session) return { status: 404, body: { error: 'no such session' } };
  if (session.baton.turnOwner !== 'party') return { status: 403, body: { error: 'not the party\'s turn' } };
  if (session.baton.holder) return { status: 409, body: { error: 'pen already held' } };
  const token = crypto.randomUUID();
  session.baton.holder = token;
  writeSession(id, session);
  return { status: 200, body: { holder: token, baton: session.baton } };
}

function postCommit(id, role, body) {
  if (role !== 'party') return { status: 403, body: { error: 'party only' } };
  const session = readSession(id);
  if (!session) return { status: 404, body: { error: 'no such session' } };
  if (!session.baton.holder || body.holder !== session.baton.holder) {
    return { status: 403, body: { error: 'not the write-lock holder' } };
  }
  if (body.base !== session.headRev) {
    return { status: 409, body: { error: 'stale base', headRev: session.headRev } };
  }
  archiveHead(session);
  session.pendingCommit = body;
  session.baton = { turnOwner: 'gm', status: 'pending-review', holder: null };
  writeSession(id, session);
  return { status: 200, body: { ok: true, baton: session.baton } };
}

function getPending(id, role) {
  if (role !== 'gm') return { status: 403, body: { error: 'GM only' } };
  const session = readSession(id);
  if (!session) return { status: 404, body: { error: 'no such session' } };
  if (!session.pendingCommit) return { status: 404, body: { error: 'no pending commit' } };
  return { status: 200, body: session.pendingCommit };
}

// Derives the review disclosure record from the stored commit + the chosen cut.
// This reads blob fields (a snapshot's session.clock) — it does not simulate.
function buildLastReview(commit, cutIndex, message, rev) {
  const snapshots = commit?.snapshots ?? [];
  const tickCount = Math.max(0, snapshots.length - 1);
  const endClock = commit?.endState?.session?.clock ?? 0;
  const cutSnap = cutIndex >= tickCount ? commit?.endState : snapshots[cutIndex];
  const clockAtCut = cutSnap?.session?.clock ?? 0;
  return { rev, message: message ?? '', cutIndex, tickCount, clockAtCut, clockAtEnd: endClock };
}

function postFinalize(id, role, body) {
  if (role !== 'gm') return { status: 403, body: { error: 'GM only' } };
  const session = readSession(id);
  if (!session) return { status: 404, body: { error: 'no such session' } };
  archiveHead(session);
  const rev = session.headRev + 1;
  session.lastReview = buildLastReview(session.pendingCommit, body.cutIndex, body.message, rev);
  session.head = body.head;
  session.headRev = rev;
  session.pendingCommit = null;
  session.baton = { turnOwner: 'gm', status: 'gm-editing', holder: null };
  writeSession(id, session);
  return { status: 200, body: { headRev: session.headRev, lastReview: session.lastReview } };
}

function postBaton(id, role, body) {
  if (role !== 'gm') return { status: 403, body: { error: 'GM only' } };
  const session = readSession(id);
  if (!session) return { status: 404, body: { error: 'no such session' } };
  archiveHead(session);
  if (body.turnOwner === 'party') {
    // Hand-off carries the GM's current state as the new HEAD — this is what the
    // party pulls at turn start (there is no separate GM push route).
    if (body.head !== undefined) { session.head = body.head; session.headRev += 1; }
    session.baton = { turnOwner: 'party', status: 'party-turn', holder: null };
  } else {
    // Take-back frees the lock and discards any pending commit (the AWOL path).
    session.pendingCommit = null;
    session.baton = { turnOwner: 'gm', status: 'gm-editing', holder: null };
  }
  writeSession(id, session);
  return { status: 200, body: { headRev: session.headRev, baton: session.baton } };
}

/**
 * Routes one request to a handler. Exported so tests can drive the routing table
 * directly without a live socket. Returns `{ status, body }`.
 *
 * @param {string} method
 * @param {string} pathname - e.g. `/api/session/T1/claim`
 * @param {URLSearchParams} query
 * @param {object} body - Parsed JSON request body
 * @returns {{ status: number, body: object }}
 */
export function route(method, pathname, query, body) {
  const match = pathname.match(/^\/api\/session\/([^/]+)(\/(baton|claim|commit|pending|finalize))?$/);
  if (!match) return { status: 404, body: { error: 'not found' } };
  const id = decodeURIComponent(match[1]);
  const sub = match[3] || '';
  const role = query.get('role');

  if (sub === '' && method === 'GET') return getSession(id);
  if (sub === '' && method === 'PUT') return putSession(id, role, body);
  if (sub === 'baton' && method === 'GET') return getBaton(id);
  if (sub === 'baton' && method === 'POST') return postBaton(id, role, body);
  if (sub === 'claim' && method === 'POST') return postClaim(id, role);
  if (sub === 'commit' && method === 'POST') return postCommit(id, role, body);
  if (sub === 'pending' && method === 'GET') return getPending(id, role);
  if (sub === 'finalize' && method === 'POST') return postFinalize(id, role, body);
  return { status: 405, body: { error: 'method not allowed' } };
}

// ---- server bootstrap -----------------------------------------------------

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = {};
    try {
      if (req.method === 'POST' || req.method === 'PUT') body = await readBody(req);
    } catch {
      return send(res, 400, { error: 'invalid JSON body' });
    }
    try {
      const result = route(req.method, url.pathname, url.searchParams, body);
      send(res, result.status, result.body);
    } catch (err) {
      send(res, 500, { error: String(err?.message || err) });
    }
  });
}

// Start only when run directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => {
    console.log(`hirelings session server on http://localhost:${PORT} (data: ${dataDir()})`);
  });
}
