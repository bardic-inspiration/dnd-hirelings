// Session server for networked GM/party play (docs/spec/multiplayer.md
// "Server"). `node:http` and JSON files only — no dependencies. It stores
// documents and enforces the baton and the pen; it never simulates or runs a
// reducer. Run with `npm run server`; the Vite dev server proxies `/api` here.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Port the server listens on when run directly; Vite's `/api` proxy targets it. */
export const DEFAULT_PORT = 3001;

/** Default storage directory: `server/data/` (gitignored). */
export const DEFAULT_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');

/** Largest request body accepted, in bytes. A 500-tick turn is ~14 MiB of JSON. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Session ids double as file names, so they are restricted to a safe alphabet. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const ROUTE_PATTERN = /^\/api\/session\/([^/]+)(?:\/(baton|claim|commit|pending|finalize))?\/?$/;

/** An error that maps straight to an HTTP status and a JSON `{ error }` body. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Builds a fresh session document around a seeded head.
 *
 * @param {object} head The GM's GameState.
 * @returns {object} `{ headRev, head, baton, pendingCommit, lastReview, archive }`
 */
export function createSessionDoc(head) {
  return {
    headRev: 0,
    head,
    baton: { turnOwner: 'gm', status: 'gm-editing', holder: null },
    pendingCommit: null,
    lastReview: null,
    archive: [],
  };
}

/** The read view of a session: everything but the pending commit and the archive. */
function publicView(doc) {
  return { headRev: doc.headRev, head: doc.head, baton: doc.baton, lastReview: doc.lastReview };
}

/** Appends the pre-mutation head to the archive — the first step of every mutating route. */
function archiveHead(doc) {
  if (doc.head !== undefined) doc.archive.push({ headRev: doc.headRev, head: doc.head });
}

function requireRole(role, expected) {
  if (role !== expected) throw new HttpError(403, `${expected} only`);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${name} must be an object`);
  }
}

/** Reads the session clock from a GameState, or null when it has none. */
function clockOf(state) {
  const clock = Number(state?.session?.clock);
  return Number.isFinite(clock) ? clock : null;
}

/**
 * Route handlers for the mutating and GM-only routes. Each takes the loaded
 * session document (already archived when it mutates), the caller's role, and
 * the parsed body, and returns `{ status?, body }`. Read routes are handled
 * before the registry, since they never write.
 */
const MUTATING_ROUTES = {
  'POST claim'(doc, role) {
    requireRole(role, 'party');
    if (doc.baton.turnOwner !== 'party' || doc.baton.status !== 'party-turn') {
      throw new HttpError(403, 'not the party\'s turn');
    }
    if (doc.baton.holder) throw new HttpError(409, 'pen taken');
    const holder = randomUUID();
    doc.baton = { ...doc.baton, holder };
    return { body: { holder, headRev: doc.headRev, baton: doc.baton } };
  },

  'POST commit'(doc, role, body) {
    requireRole(role, 'party');
    requireObject(body, 'body');
    if (!doc.baton.holder || body.holder !== doc.baton.holder) {
      throw new HttpError(403, 'not the pen holder');
    }
    requireObject(body.commit, 'commit');
    if (body.commit.base !== doc.headRev) throw new HttpError(409, 'stale base revision');
    doc.pendingCommit = body.commit;
    doc.baton = { turnOwner: 'gm', status: 'pending-review', holder: null };
    return { body: { headRev: doc.headRev, baton: doc.baton } };
  },

  'POST finalize'(doc, role, body) {
    requireRole(role, 'gm');
    requireObject(body, 'body');
    if (!doc.pendingCommit) throw new HttpError(404, 'no pending commit');
    requireObject(body.head, 'head');
    const commit = doc.pendingCommit;
    const cutIndex = Number(body.cutIndex);
    if (!Number.isInteger(cutIndex) || cutIndex < 0) {
      throw new HttpError(400, 'cutIndex must be a non-negative integer');
    }
    doc.head = body.head;
    doc.headRev += 1;
    doc.lastReview = {
      rev: doc.headRev,
      message: typeof body.message === 'string' ? body.message : '',
      cutIndex,
      tickCount: Math.max(0, (commit.snapshots?.length ?? 1) - 1),
      clockAtCut: clockOf(body.head),
      clockAtEnd: clockOf(commit.endState),
    };
    doc.pendingCommit = null;
    doc.baton = { turnOwner: 'gm', status: 'gm-editing', holder: null };
    return { body: publicView(doc) };
  },

  'POST baton'(doc, role, body) {
    requireRole(role, 'gm');
    requireObject(body, 'body');
    const { turnOwner, head } = body;
    if (turnOwner !== 'gm' && turnOwner !== 'party') {
      throw new HttpError(400, 'turnOwner must be gm or party');
    }
    if (turnOwner === 'party') requireObject(head, 'head');
    if (head !== undefined) {
      requireObject(head, 'head');
      doc.head = head;
      doc.headRev += 1;
    }
    doc.pendingCommit = null;
    doc.baton = turnOwner === 'party'
      ? { turnOwner: 'party', status: 'party-turn', holder: null }
      : { turnOwner: 'gm', status: 'gm-editing', holder: null };
    return { body: { headRev: doc.headRev, baton: doc.baton } };
  },
};

/**
 * Creates the session store over a data directory: one JSON file per session,
 * written atomically (temp file, then rename). Operations on one session run
 * one at a time, so concurrent claims can't both win.
 *
 * @param {string} dataDir
 */
function createStore(dataDir) {
  const queues = new Map();
  const fileOf = (id) => path.join(dataDir, `${id}.json`);

  async function read(id) {
    try {
      return JSON.parse(await readFile(fileOf(id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function write(id, doc) {
    await mkdir(dataDir, { recursive: true });
    const temp = `${fileOf(id)}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(doc));
    await rename(temp, fileOf(id));
  }

  /** Runs `task` after every earlier task on the same session has settled. */
  function serialize(id, task) {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(task, task);
    queues.set(id, next.catch(() => {}));
    return next;
  }

  return { read, write, serialize };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

/**
 * Handles one request against a store. Exported through `createSessionServer`.
 *
 * @returns {Promise<{ status: number, body: any }>}
 */
async function route(store, req) {
  const url = new URL(req.url, 'http://localhost');
  const match = ROUTE_PATTERN.exec(url.pathname);
  if (!match) throw new HttpError(404, 'no such route');
  const [, id, sub] = match;
  if (!SESSION_ID_PATTERN.test(id)) throw new HttpError(400, 'invalid session id');
  const role = url.searchParams.get('role');
  const key = `${req.method} ${sub ?? ''}`.trim();
  const body = req.method === 'GET' ? undefined : await readBody(req);

  return store.serialize(id, async () => {
    const doc = await store.read(id);

    if (key === 'PUT') {
      requireRole(role, 'gm');
      requireObject(body, 'body');
      requireObject(body.head, 'head');
      if (!doc) {
        const created = createSessionDoc(body.head);
        await store.write(id, created);
        return { status: 201, body: publicView(created) };
      }
      archiveHead(doc);
      doc.head = body.head;
      doc.headRev += 1;
      await store.write(id, doc);
      return { status: 200, body: publicView(doc) };
    }

    if (!doc) throw new HttpError(404, 'no such session');
    if (key === 'GET') return { status: 200, body: publicView(doc) };
    if (key === 'GET baton') return { status: 200, body: { headRev: doc.headRev, baton: doc.baton } };
    if (key === 'GET pending') {
      requireRole(role, 'gm');
      if (!doc.pendingCommit) throw new HttpError(404, 'no pending commit');
      return { status: 200, body: doc.pendingCommit };
    }

    const handler = MUTATING_ROUTES[key];
    if (!handler) throw new HttpError(405, 'method not allowed');
    archiveHead(doc);
    const result = handler(doc, role, body);
    await store.write(id, doc);
    return { status: result.status ?? 200, body: result.body };
  });
}

/**
 * Creates (but does not start) the session server.
 *
 * @param {{ dataDir?: string }} [options] `dataDir` defaults to `server/data/`.
 * @returns {import('node:http').Server}
 */
export function createSessionServer({ dataDir = DEFAULT_DATA_DIR } = {}) {
  const store = createStore(dataDir);
  return http.createServer((req, res) => {
    route(store, req).then(
      ({ status, body }) => send(res, status, body),
      (error) => {
        const status = error instanceof HttpError ? error.status : 500;
        send(res, status, { error: error.message });
      },
    );
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  createSessionServer().listen(port, () => {
    console.log(`Session server listening on http://localhost:${port} (data: ${DEFAULT_DATA_DIR})`);
  });
}
