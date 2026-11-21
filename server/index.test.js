import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessionServer } from './index.js';

let server;
let dataDir;
let baseUrl;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'session-server-'));
  server = createSessionServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

const headAt = (clock) => ({ session: { clock }, agents: [], tasks: [], inventory: [], eventLog: [] });

async function call(method, route, role, body) {
  const query = role ? `?role=${role}` : '';
  const res = await fetch(`${baseUrl}/api/session/T1${route}${query}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function storedDoc() {
  return JSON.parse(await readFile(path.join(dataDir, 'T1.json'), 'utf8'));
}

async function seedPartyTurn() {
  await call('PUT', '', 'gm', { head: headAt(0) });
  await call('POST', '/baton', 'gm', { turnOwner: 'party', head: headAt(1) });
}

async function claimAndCommit() {
  await seedPartyTurn();
  const { body: claim } = await call('POST', '/claim', 'party');
  const commit = { base: claim.headRev, snapshots: [headAt(1), headAt(2), headAt(3)], eventLog: [], endState: headAt(3) };
  return call('POST', '/commit', 'party', { holder: claim.holder, commit });
}

describe('session server', () => {
  describe('GET /', () => {
    it('returns 404 for a session that does not exist', async () => {
      expect((await call('GET', '', 'party')).status).toBe(404);
    });

    it('returns headRev, head, baton, and lastReview for an existing session', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      const { status, body } = await call('GET', '', 'party');
      expect(status).toBe(200);
      expect(body).toEqual({
        headRev: 0,
        head: headAt(0),
        baton: { turnOwner: 'gm', status: 'gm-editing', holder: null },
        lastReview: null,
      });
    });

    it('rejects a session id that is not a safe file name', async () => {
      const res = await fetch(`${baseUrl}/api/session/..%2Fescape`);
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /', () => {
    it('lets the GM create a session, stored as one JSON file', async () => {
      const { status } = await call('PUT', '', 'gm', { head: headAt(0) });
      expect(status).toBe(201);
      expect(await readdir(dataDir)).toEqual(['T1.json']);
      expect((await storedDoc()).archive).toEqual([]);
    });

    it('re-seeds an existing session, bumping headRev and archiving the old head', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      const { status, body } = await call('PUT', '', 'gm', { head: headAt(5) });
      expect(status).toBe(200);
      expect(body.headRev).toBe(1);
      expect(body.head).toEqual(headAt(5));
      expect((await storedDoc()).archive).toEqual([{ headRev: 0, head: headAt(0) }]);
    });

    it('refuses a party caller with 403', async () => {
      expect((await call('PUT', '', 'party', { head: headAt(0) })).status).toBe(403);
    });

    it('rejects a body without a head with 400', async () => {
      expect((await call('PUT', '', 'gm', {})).status).toBe(400);
    });
  });

  describe('GET /baton', () => {
    it('returns { headRev, baton } — the poll', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      const { body } = await call('GET', '/baton', 'party');
      expect(body).toEqual({ headRev: 0, baton: { turnOwner: 'gm', status: 'gm-editing', holder: null } });
    });
  });

  describe('POST /claim', () => {
    it('returns 403 unless it is the party\'s turn', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      expect((await call('POST', '/claim', 'party')).status).toBe(403);
    });

    it('mints a holder token when the pen is free', async () => {
      await seedPartyTurn();
      const { status, body } = await call('POST', '/claim', 'party');
      expect(status).toBe(200);
      expect(typeof body.holder).toBe('string');
      expect(body.holder.length).toBeGreaterThan(0);
      expect(body.headRev).toBe(1);
      expect(body.baton).toEqual({ turnOwner: 'party', status: 'party-turn', holder: body.holder });
    });

    it('returns 409 when the pen is already taken', async () => {
      await seedPartyTurn();
      await call('POST', '/claim', 'party');
      expect((await call('POST', '/claim', 'party')).status).toBe(409);
    });

    it('lets only one of two simultaneous claims win', async () => {
      await seedPartyTurn();
      const results = await Promise.all([call('POST', '/claim', 'party'), call('POST', '/claim', 'party')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('refuses a GM caller with 403', async () => {
      await seedPartyTurn();
      expect((await call('POST', '/claim', 'gm')).status).toBe(403);
    });
  });

  describe('POST /commit', () => {
    it('stores the commit, sets pending-review, and clears the holder', async () => {
      const { status, body } = await claimAndCommit();
      expect(status).toBe(200);
      expect(body.baton).toEqual({ turnOwner: 'gm', status: 'pending-review', holder: null });
      expect((await storedDoc()).pendingCommit.endState).toEqual(headAt(3));
    });

    it('returns 403 for a non-holder token', async () => {
      await seedPartyTurn();
      const { body: claim } = await call('POST', '/claim', 'party');
      const commit = { base: claim.headRev, snapshots: [headAt(1)], eventLog: [], endState: headAt(1) };
      const { status } = await call('POST', '/commit', 'party', { holder: 'not-the-token', commit });
      expect(status).toBe(403);
    });

    it('returns 403 when nobody holds the pen', async () => {
      await seedPartyTurn();
      const commit = { base: 1, snapshots: [headAt(1)], eventLog: [], endState: headAt(1) };
      expect((await call('POST', '/commit', 'party', { holder: null, commit })).status).toBe(403);
    });

    it('returns 409 when the base revision is stale', async () => {
      await seedPartyTurn();
      const { body: claim } = await call('POST', '/claim', 'party');
      const commit = { base: claim.headRev - 1, snapshots: [headAt(1)], eventLog: [], endState: headAt(1) };
      const { status } = await call('POST', '/commit', 'party', { holder: claim.holder, commit });
      expect(status).toBe(409);
      expect((await storedDoc()).pendingCommit).toBeNull();
    });
  });

  describe('GET /pending', () => {
    it('returns 404 when there is no pending commit', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      expect((await call('GET', '/pending', 'gm')).status).toBe(404);
    });

    it('returns the pending commit to the GM', async () => {
      await claimAndCommit();
      const { status, body } = await call('GET', '/pending', 'gm');
      expect(status).toBe(200);
      expect(body.snapshots).toHaveLength(3);
      expect(body.endState).toEqual(headAt(3));
    });

    it('refuses a party caller with 403', async () => {
      await claimAndCommit();
      expect((await call('GET', '/pending', 'party')).status).toBe(403);
    });
  });

  describe('POST /finalize', () => {
    it('sets the head, advances headRev, records lastReview, clears the commit, and sets gm-editing', async () => {
      await claimAndCommit();
      const { status, body } = await call('POST', '/finalize', 'gm', { cutIndex: 1, message: 'kept day 2', head: headAt(2) });
      expect(status).toBe(200);
      expect(body.headRev).toBe(2);
      expect(body.head).toEqual(headAt(2));
      expect(body.baton).toEqual({ turnOwner: 'gm', status: 'gm-editing', holder: null });
      expect(body.lastReview).toEqual({
        rev: 2, message: 'kept day 2', cutIndex: 1, tickCount: 2, clockAtCut: 2, clockAtEnd: 3,
      });
      expect((await storedDoc()).pendingCommit).toBeNull();
    });

    it('returns 404 when there is nothing to finalize', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      expect((await call('POST', '/finalize', 'gm', { cutIndex: 0, head: headAt(0) })).status).toBe(404);
    });

    it('refuses a party caller with 403', async () => {
      await claimAndCommit();
      expect((await call('POST', '/finalize', 'party', { cutIndex: 0, head: headAt(1) })).status).toBe(403);
    });
  });

  describe('POST /baton', () => {
    it('hands the baton to the party with the GM\'s state as the new head', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      const { status, body } = await call('POST', '/baton', 'gm', { turnOwner: 'party', head: headAt(4) });
      expect(status).toBe(200);
      expect(body).toEqual({ headRev: 1, baton: { turnOwner: 'party', status: 'party-turn', holder: null } });
      expect((await call('GET', '', 'party')).body.head).toEqual(headAt(4));
    });

    it('requires the GM\'s state when handing to the party', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      expect((await call('POST', '/baton', 'gm', { turnOwner: 'party' })).status).toBe(400);
    });

    it('takes back the baton, freeing the pen and discarding any pending commit', async () => {
      await seedPartyTurn();
      await call('POST', '/claim', 'party');
      const { body } = await call('POST', '/baton', 'gm', { turnOwner: 'gm' });
      expect(body).toEqual({ headRev: 1, baton: { turnOwner: 'gm', status: 'gm-editing', holder: null } });

      await call('POST', '/baton', 'gm', { turnOwner: 'party', head: headAt(1) });
      const { body: claim } = await call('POST', '/claim', 'party');
      const commit = { base: claim.headRev, snapshots: [headAt(1)], eventLog: [], endState: headAt(1) };
      await call('POST', '/commit', 'party', { holder: claim.holder, commit });
      await call('POST', '/baton', 'gm', { turnOwner: 'gm' });
      expect((await call('GET', '/pending', 'gm')).status).toBe(404);
    });

    it('refuses a party caller with 403', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });
      expect((await call('POST', '/baton', 'party', { turnOwner: 'party', head: headAt(0) })).status).toBe(403);
    });
  });

  describe('archive', () => {
    it('appends the pre-mutation head on every mutating route', async () => {
      await call('PUT', '', 'gm', { head: headAt(0) });                                  // create: nothing to archive
      await call('PUT', '', 'gm', { head: headAt(1) });                                  // 1
      await call('POST', '/baton', 'gm', { turnOwner: 'party', head: headAt(2) });       // 2
      const { body: claim } = await call('POST', '/claim', 'party');                     // 3
      const commit = { base: claim.headRev, snapshots: [headAt(2), headAt(3)], eventLog: [], endState: headAt(3) };
      await call('POST', '/commit', 'party', { holder: claim.holder, commit });         // 4
      await call('POST', '/finalize', 'gm', { cutIndex: 1, head: headAt(3) });           // 5

      const { archive } = await storedDoc();
      expect(archive.map((entry) => entry.head.session.clock)).toEqual([0, 1, 2, 2, 2]);
      expect(archive.map((entry) => entry.headRev)).toEqual([0, 1, 2, 2, 2]);
    });

    it('does not grow on a rejected request', async () => {
      await seedPartyTurn();
      await call('POST', '/claim', 'party');
      const before = (await storedDoc()).archive.length;
      await call('POST', '/claim', 'party'); // 409
      expect((await storedDoc()).archive.length).toBe(before);
    });
  });
});
