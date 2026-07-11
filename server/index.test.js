import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { route } from './index.js';

// Drive the routing table directly against a fresh temp data dir per test — no
// live socket needed (the handlers are the unit under test).
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hirelings-srv-'));
  process.env.HIRELINGS_DATA_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.HIRELINGS_DATA_DIR;
});

const q = (role) => new URLSearchParams(role ? { role } : {});
const call = (method, p, role, body) => route(method, `/api/session/${p}`, q(role), body ?? {});
const readFile = (id) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));

// Seeds a session and hands the turn to the party, returning the party's token.
function toPartyTurn(id, head = { session: { clock: 0 }, marker: 'gm-head' }) {
  call('PUT', id, 'gm', { head });
  call('POST', `${id}/baton`, 'gm', { turnOwner: 'party', head });
  return call('POST', `${id}/claim`, 'party').body.holder;
}

describe('session lifecycle', () => {
  it('GET 404s an absent session; PUT seeds it (GM only)', () => {
    expect(call('GET', 'S1').status).toBe(404);
    expect(call('PUT', 'S1', 'party', { head: {} }).status).toBe(403);
    const put = call('PUT', 'S1', 'gm', { head: { marker: 'seed' } });
    expect(put.status).toBe(201);
    const got = call('GET', 'S1');
    expect(got.status).toBe(200);
    expect(got.body.head).toEqual({ marker: 'seed' });
    expect(got.body.baton).toEqual({ turnOwner: 'gm', status: 'gm-editing', holder: null });
  });

  it('baton poll returns only headRev + baton', () => {
    call('PUT', 'S1', 'gm', { head: {} });
    const { status, body } = call('GET', 'S1/baton');
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['baton', 'headRev']);
  });
});

describe('claim', () => {
  it('rejects a claim outside the party turn (403)', () => {
    call('PUT', 'S1', 'gm', { head: {} });
    expect(call('POST', 'S1/claim', 'party').status).toBe(403);
  });

  it('mints a token, then 409s a second claim', () => {
    call('PUT', 'S1', 'gm', { head: {} });
    call('POST', 'S1/baton', 'gm', { turnOwner: 'party', head: {} });
    const first = call('POST', 'S1/claim', 'party');
    expect(first.status).toBe(200);
    expect(first.body.holder).toBeTruthy();
    expect(call('POST', 'S1/claim', 'party').status).toBe(409);
  });
});

describe('commit', () => {
  const commitDoc = (holder, base) => ({
    holder, base,
    snapshots: [{ session: { clock: 0 } }, { session: { clock: 1 } }],
    eventLog: [{ eventType: 'tick', seq: 0 }],
    endState: { session: { clock: 1 }, marker: 'end' },
  });

  it('403s a non-holder and 409s a stale base', () => {
    const token = toPartyTurn('S1');
    const rev = readFile('S1').headRev;
    expect(call('POST', 'S1/commit', 'party', commitDoc('wrong-token', rev)).status).toBe(403);
    expect(call('POST', 'S1/commit', 'party', commitDoc(token, rev + 99)).status).toBe(409);
  });

  it('stores the commit, flips to pending-review, frees the pen, and archives', () => {
    const token = toPartyTurn('S1');
    const before = readFile('S1');
    const res = call('POST', 'S1/commit', 'party', commitDoc(token, before.headRev));
    expect(res.status).toBe(200);
    const after = readFile('S1');
    expect(after.baton).toEqual({ turnOwner: 'gm', status: 'pending-review', holder: null });
    expect(after.pendingCommit.endState.marker).toBe('end');
    // snapshot-then-mutate: the pre-commit head was archived.
    expect(after.archive.length).toBe(before.archive.length + 1);
    // GM can read the pending commit; party cannot.
    expect(call('GET', 'S1/pending', 'party').status).toBe(403);
    expect(call('GET', 'S1/pending', 'gm').body.endState.marker).toBe('end');
  });
});

describe('finalize', () => {
  it('advances head/rev, records lastReview, clears the commit, archives', () => {
    const token = toPartyTurn('S1');
    const rev = readFile('S1').headRev;
    call('POST', 'S1/commit', 'party', {
      holder: token, base: rev,
      snapshots: [{ session: { clock: 0 } }, { session: { clock: 1 } }, { session: { clock: 2 } }],
      eventLog: [],
      endState: { session: { clock: 2 } },
    });
    const before = readFile('S1');
    const res = call('POST', 'S1/finalize', 'gm', { cutIndex: 1, message: 'nice', head: { session: { clock: 1 }, marker: 'cut' } });
    expect(res.status).toBe(200);
    const after = readFile('S1');
    expect(after.headRev).toBe(before.headRev + 1);
    expect(after.head.marker).toBe('cut');
    expect(after.pendingCommit).toBeNull();
    expect(after.baton.status).toBe('gm-editing');
    expect(after.archive.length).toBe(before.archive.length + 1);
    // lastReview computed from the stored commit: 2 ticks, cut at day 1 of 2.
    expect(after.lastReview).toMatchObject({
      cutIndex: 1, tickCount: 2, clockAtCut: 1, clockAtEnd: 2, message: 'nice',
    });
  });

  it('reports whole-turn-kept when cutIndex equals tickCount', () => {
    const token = toPartyTurn('S1');
    const rev = readFile('S1').headRev;
    call('POST', 'S1/commit', 'party', {
      holder: token, base: rev,
      snapshots: [{ session: { clock: 0 } }, { session: { clock: 1 } }],
      eventLog: [], endState: { session: { clock: 1 } },
    });
    call('POST', 'S1/finalize', 'gm', { cutIndex: 1, head: { session: { clock: 1 } } });
    const lr = readFile('S1').lastReview;
    expect(lr.cutIndex).toBe(lr.tickCount);
    expect(lr.clockAtCut).toBe(1);
  });
});

describe('take-back', () => {
  it('frees the lock and discards a pending commit', () => {
    const token = toPartyTurn('S1');
    const rev = readFile('S1').headRev;
    call('POST', 'S1/commit', 'party', {
      holder: token, base: rev,
      snapshots: [{ session: { clock: 0 } }], eventLog: [], endState: { session: { clock: 0 } },
    });
    expect(readFile('S1').pendingCommit).not.toBeNull();
    const res = call('POST', 'S1/baton', 'gm', { turnOwner: 'gm' });
    expect(res.status).toBe(200);
    const after = readFile('S1');
    expect(after.pendingCommit).toBeNull();
    expect(after.baton).toEqual({ turnOwner: 'gm', status: 'gm-editing', holder: null });
  });
});

describe('role + routing guards', () => {
  it('405s an unknown method and 404s an unknown path', () => {
    call('PUT', 'S1', 'gm', { head: {} });
    expect(route('DELETE', '/api/session/S1', q('gm'), {}).status).toBe(405);
    expect(route('GET', '/api/nope', q('gm'), {}).status).toBe(404);
  });
});
