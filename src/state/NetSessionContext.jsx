import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GameProvider } from './GameContext.jsx';
import { normalizeState } from './storage.js';
import { deriveMode } from '../logic/permissions.js';
import {
  BATON_POLL_MS,
  batonChanged,
  buildCommit,
  createNetDispatch,
  createTransport,
  cutState,
  startRecording,
  turnLogSlice,
} from '../logic/netSession.js';

const noop = async () => false;

// What `useNetSession()` returns offline — no provider mounted. Mode `gm`
// matches the ungated dispatch an offline `GameProvider` hands out.
const OFFLINE = {
  enabled: false,
  role: null,
  baton: null,
  headRev: null,
  lastReview: null,
  holdsWriteLock: false,
  mode: 'gm',
  error: null,
  claimPen: noop,
  commitTurn: noop,
  setBaton: noop,
  finalize: noop,
  refresh: noop,
};

const NetSessionContext = createContext(OFFLINE);

/**
 * Joins a networked session and provides it (docs/spec/multiplayer.md
 * "Networked session"). Mounted above `GameProvider` only when the URL carries
 * `session` and `role`; it renders that `GameProvider` itself, bound so its
 * dispatch is gated by the derived mode and recorded while this client holds
 * the pen.
 *
 * - **Join:** fetch the session and load its head (`REPLACE_STATE`); a GM
 *   joining a session that doesn't exist creates it from the local state.
 * - **Baton poll:** every `BATON_POLL_MS`; a changed `turnOwner`, `status`,
 *   or `holder` pulls the whole session.
 * - **The pen:** the holder token lives in memory only, so a refresh mid-turn
 *   abandons it.
 *
 * @param {{ sessionId: string, role: 'gm'|'party', children: React.ReactNode }} props
 */
export function NetSessionProvider({ sessionId, role, children }) {
  const transport = useMemo(() => createTransport({ sessionId, role }), [sessionId, role]);

  const [baton, setBatonState] = useState(null);
  const [headRev, setHeadRev] = useState(null);
  const [lastReview, setLastReview] = useState(null);
  const [holder, setHolder] = useState(null);
  const [error, setError] = useState(null);

  const holdsWriteLock = Boolean(holder) && baton?.holder === holder;
  const mode = deriveMode(role, baton, holdsWriteLock);

  // Latest values for callbacks and the dispatch gate, which outlive renders.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const batonRef = useRef(null);
  const holderRef = useRef(null);
  const turnBaseRef = useRef(null);
  const recording = useRef(null);
  const gameRef = useRef(null);
  const joinStarted = useRef(false);

  const binding = useMemo(() => ({
    attach: (game) => { gameRef.current = game; },
    wrapDispatch: (rawDispatch) => createNetDispatch({ rawDispatch, getMode: () => modeRef.current, recording }),
  }), []);

  const setBatonBoth = useCallback((next) => {
    batonRef.current = next;
    setBatonState(next);
  }, []);

  const dropPen = useCallback(() => {
    holderRef.current = null;
    turnBaseRef.current = null;
    recording.current = null;
    setHolder(null);
  }, []);

  // Applies a pulled session. The pen holder's board is its own mid-turn
  // work, so a pull never replaces it while the server still names this
  // client as holder.
  const applySession = useCallback((doc) => {
    const stillHolder = holderRef.current && doc.baton?.holder === holderRef.current;
    if (!stillHolder && holderRef.current) dropPen();
    setBatonBoth(doc.baton);
    setHeadRev(doc.headRev);
    setLastReview(doc.lastReview ?? null);
    if (!stillHolder && doc.head) {
      gameRef.current?.rawDispatch({ type: 'REPLACE_STATE', newState: doc.head });
    }
  }, [dropPen, setBatonBoth]);

  const run = useCallback(async (task) => {
    try {
      return await task();
    } catch (caught) {
      setError(caught?.message ?? String(caught));
      return false;
    }
  }, []);

  const failed = useCallback((res) => {
    setError(res.body?.error ?? `request failed (${res.status})`);
    return false;
  }, []);

  const refresh = useCallback(() => run(async () => {
    const res = await transport.getSession();
    if (!res.ok) return failed(res);
    setError(null);
    applySession(res.body);
    return true;
  }), [run, transport, failed, applySession]);

  // Join once (StrictMode re-runs effects; the ref keeps it to one join).
  useEffect(() => {
    if (joinStarted.current) return;
    joinStarted.current = true;
    run(async () => {
      const res = await transport.getSession();
      if (res.ok) {
        applySession(res.body);
        return true;
      }
      if (res.status === 404 && role === 'gm') {
        const created = await transport.putSession(gameRef.current?.getState());
        if (!created.ok) return failed(created);
        applySession(created.body);
        return true;
      }
      return failed(res);
    });
  }, [run, transport, role, applySession, failed]);

  // Baton poll.
  useEffect(() => {
    const handle = setInterval(() => {
      run(async () => {
        const res = await transport.getBaton();
        if (!res.ok) return failed(res);
        if (batonChanged(batonRef.current, res.body.baton)) await refresh();
        return true;
      });
    }, BATON_POLL_MS);
    return () => clearInterval(handle);
  }, [run, transport, failed, refresh]);

  const claimPen = useCallback(() => run(async () => {
    const res = await transport.claim();
    if (!res.ok) return failed(res);
    // Start the turn from the head this claim is based on.
    const pulled = await transport.getSession();
    if (!pulled.ok) return failed(pulled);
    holderRef.current = res.body.holder;
    turnBaseRef.current = res.body.headRev;
    const turnStart = normalizeState(pulled.body.head);
    gameRef.current?.rawDispatch({ type: 'REPLACE_STATE', newState: pulled.body.head });
    recording.current = startRecording(turnStart);
    setHolder(res.body.holder);
    setBatonBoth(res.body.baton);
    setHeadRev(res.body.headRev);
    setError(null);
    return true;
  }), [run, transport, failed, setBatonBoth]);

  const commitTurn = useCallback(() => run(async () => {
    const snapshots = recording.current;
    if (!holderRef.current || !snapshots) return false;
    const endState = gameRef.current.getState();
    const commit = buildCommit({
      base: turnBaseRef.current,
      snapshots,
      eventLog: turnLogSlice(endState.eventLog, snapshots.length - 1),
      endState,
    });
    const res = await transport.commit(holderRef.current, commit);
    if (!res.ok) {
      if (res.status === 403) dropPen();
      return failed(res);
    }
    dropPen();
    setBatonBoth(res.body.baton);
    setError(null);
    return true;
  }), [run, transport, failed, dropPen, setBatonBoth]);

  const setBaton = useCallback((turnOwner) => run(async () => {
    const head = turnOwner === 'party' ? gameRef.current.getState() : undefined;
    const res = await transport.setBaton({ turnOwner, head });
    if (!res.ok) return failed(res);
    setBatonBoth(res.body.baton);
    setHeadRev(res.body.headRev);
    setError(null);
    return true;
  }), [run, transport, failed, setBatonBoth]);

  const finalize = useCallback((cutIndex, message) => run(async () => {
    const pending = await transport.getPending();
    if (!pending.ok) return failed(pending);
    const head = cutState(pending.body, cutIndex);
    const res = await transport.finalize({ cutIndex, message, head });
    if (!res.ok) return failed(res);
    applySession(res.body);
    setError(null);
    return true;
  }), [run, transport, failed, applySession]);

  const value = {
    enabled: true,
    role,
    baton,
    headRev,
    lastReview,
    holdsWriteLock,
    mode,
    error,
    claimPen,
    commitTurn,
    setBaton,
    finalize,
    refresh,
  };

  return (
    <NetSessionContext.Provider value={value}>
      <GameProvider net={binding}>{children}</GameProvider>
    </NetSessionContext.Provider>
  );
}

/**
 * Returns the networked session: `enabled`, `role`, `baton`, `headRev`,
 * `lastReview`, `holdsWriteLock`, `mode`, `error`, and `claimPen()`,
 * `commitTurn()`, `setBaton(turnOwner)`, `finalize(cutIndex, message)`,
 * `refresh()` — each resolving `true` on success. Offline (no provider), it
 * returns `enabled: false` and mode `gm`.
 */
export function useNetSession() {
  return useContext(NetSessionContext);
}
