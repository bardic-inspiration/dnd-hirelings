import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  fetchSession, putSession, fetchBaton, claimPen as claimPenRequest,
  postCommit, postFinalize, postBaton, BATON_POLL_MS,
} from '../logic/netSession.js';
import { deriveMode } from '../logic/permissions.js';

const NetSessionContext = createContext(null);

/**
 * Networked-session state and turn control (see docs/specs/gm-player-mode.md §2).
 * Mounted (in main.jsx, above GameProvider) only when the URL carries
 * `?session=<id>&role=gm|party`; offline the app never renders it and
 * `useNetSession()` returns `null`.
 *
 * Owns the baton, the write-lock token, the last-review record, and the poll
 * loop; exposes the derived read-only view plus the turn-control methods every
 * ModePanel control calls. It never touches game state directly — the GM's local
 * state reaches it through `registerSeed` (auto-create / hand-off) and a party
 * turn's commit through `registerCommitSource`, both wired by GameProvider, which
 * alone holds `rawDispatch` and the snapshot ref.
 *
 * Context value:
 * - `enabled, role, sessionId` — session identity
 * - `baton, holder, holdsWriteLock, mode, headRev, lastReview, incoming` — derived, read-only
 * - `claimPen(), commitTurn(), setBaton(turnOwner), finalize(cutIndex, message, head), refresh()`
 * - `registerCommitSource(fn), registerSeed(fn)` — GameProvider bridges
 *
 * @param {{ role: 'gm'|'party', sessionId: string, children: React.ReactNode }} props
 */
export function NetSessionProvider({ role, sessionId, children }) {
  const [baton, setBaton] = useState(null);
  const [holder, setHolder] = useState(null);
  const [headRev, setHeadRev] = useState(0);
  const [lastReview, setLastReview] = useState(null);
  // `incoming` bumps its `seq` on every full pull; GameProvider watches it and
  // applies the carried HEAD as REPLACE_STATE (the one path that bypasses the gate).
  const [incoming, setIncoming] = useState({ seq: 0, head: null });

  const seqRef = useRef(0);
  const lastSeenRef = useRef(null);            // last baton seen by the poll
  const commitSourceRef = useRef(null);        // GameProvider: () => commit document
  const seedRef = useRef(null);                // GameProvider: () => current GameState

  const holdsWriteLock = !!(holder && baton?.holder === holder);
  const mode = deriveMode(role, baton, holdsWriteLock);

  // Applies a full session pull: refresh baton/headRev/lastReview and hand the
  // returned HEAD to GameProvider through `incoming`.
  const applyPull = useCallback((data) => {
    setHeadRev(data.headRev);
    setBaton(data.baton);
    if (data.lastReview !== undefined) setLastReview(data.lastReview);
    lastSeenRef.current = data.baton
      ? { turnOwner: data.baton.turnOwner, status: data.baton.status, holder: data.baton.holder }
      : null;
    seqRef.current += 1;
    setIncoming({ seq: seqRef.current, head: data.head });
  }, []);

  const refresh = useCallback(() => fetchSession(sessionId).then(applyPull), [sessionId, applyPull]);

  // Join on mount. A GM landing on a not-yet-created session seeds it from local
  // state (via the registered seed) then re-pulls; the party simply waits.
  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId)
      .then(data => { if (!cancelled) applyPull(data); })
      .catch(err => {
        if (cancelled || err.status !== 404 || role !== 'gm') return;
        const head = seedRef.current?.();
        putSession(sessionId, head)
          .then(() => fetchSession(sessionId))
          .then(data => { if (!cancelled) applyPull(data); })
          .catch(() => {});
      });
    return () => { cancelled = true; };
  }, [sessionId, role, applyPull]);

  // Light baton poll: a full pull only when turnOwner/status/holder changes
  // (Q-refresh). This is how a waiting party member's mode flips spectator→player
  // when the pen frees and how the party receives the review-result banner.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchBaton(sessionId).then(({ baton: next }) => {
        const prev = lastSeenRef.current;
        const changed = !prev || next.turnOwner !== prev.turnOwner
          || next.status !== prev.status || next.holder !== prev.holder;
        if (changed) refresh().catch(() => {});
      }).catch(() => {});
    }, BATON_POLL_MS);
    return () => clearInterval(interval);
  }, [sessionId, refresh]);

  const claimPen = useCallback(() => claimPenRequest(sessionId).then(({ holder: token, baton: next }) => {
    setHolder(token);
    setBaton(next);
    lastSeenRef.current = { turnOwner: next.turnOwner, status: next.status, holder: next.holder };
  }), [sessionId]);

  const commitTurn = useCallback(() => {
    const commit = commitSourceRef.current?.();
    if (!commit) return Promise.reject(new Error('no turn to commit'));
    return postCommit(sessionId, commit).then(() => { setHolder(null); return refresh(); });
  }, [sessionId, refresh]);

  // GM hand-off carries the GM's current state as the new HEAD; take-back sends
  // no head. The head is supplied by the caller (ModePanel, which reads game state).
  const setBatonOwner = useCallback((turnOwner, head) =>
    postBaton(sessionId, head !== undefined ? { turnOwner, head } : { turnOwner }).then(() => refresh()),
  [sessionId, refresh]);

  const finalize = useCallback((cutIndex, message, head) =>
    postFinalize(sessionId, { cutIndex, message, head }).then(() => refresh()),
  [sessionId, refresh]);

  const registerCommitSource = useCallback((fn) => { commitSourceRef.current = fn; }, []);
  const registerSeed = useCallback((fn) => { seedRef.current = fn; }, []);

  const value = useMemo(() => ({
    enabled: true, role, sessionId,
    baton, holder, holdsWriteLock, mode, headRev, lastReview, incoming,
    claimPen, commitTurn, setBaton: setBatonOwner, finalize, refresh,
    registerCommitSource, registerSeed,
  }), [
    role, sessionId, baton, holder, holdsWriteLock, mode, headRev, lastReview, incoming,
    claimPen, commitTurn, setBatonOwner, finalize, refresh, registerCommitSource, registerSeed,
  ]);

  return <NetSessionContext.Provider value={value}>{children}</NetSessionContext.Provider>;
}

/**
 * Returns the networked-session context, or `null` when offline (no
 * `NetSessionProvider` mounted). Callers must treat `null` as "offline, today's
 * ungated app".
 *
 * @returns {object|null}
 */
export function useNetSession() {
  return useContext(NetSessionContext);
}
