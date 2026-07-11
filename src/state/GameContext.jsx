import { createContext, useContext, useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
import { reducer } from './reducer.js';
import { loadState, saveState } from './storage.js';
import { useNetSession } from './NetSessionContext.jsx';
import { gateDispatch } from '../logic/permissions.js';
import { buildCommit } from '../logic/netSession.js';

const GameContext = createContext(null);

/**
 * Provides the central game state, dispatch, and permission mode to the tree.
 *
 * Offline (no `NetSessionProvider` above, or seeded as a sandbox) this is exactly
 * today's provider: state loads from localStorage, persists on every change, and
 * dispatch is ungated with mode `'gm'` (everything allowed).
 *
 * Networked (a `NetSessionProvider` is mounted and this is the top-level provider)
 * the context `dispatch` is wrapped by `gateDispatch` (silent backstop against the
 * client's derived mode) composed with a snapshot recorder (each `APPLY_TICK`
 * pushes its complete `newState`; each `APPLY_ROLLBACK` pops one snapshot per
 * reversed tick). Server HEAD pulls arrive through `NetSession.incoming` and are
 * applied via the ungated `rawDispatch` (`REPLACE_STATE` deliberately bypasses the
 * gate). localStorage persistence is kept as a local cache so a mid-turn refresh
 * still shows the board.
 *
 * @param {{ children: React.ReactNode, initialState?: object|null,
 *   persist?: boolean, mode?: 'gm'|'player'|'spectator' }} props
 *   `initialState` seeds the sandboxed review provider (§6); any provider with an
 *   explicit `initialState` is a sandbox and is never networked. `persist=false`
 *   skips the save effect so a second provider never fights the live one over the
 *   storage key. `mode` pins the affordance mode (the review sandbox pins
 *   `'spectator'`); otherwise it follows the net session, or `'gm'` offline.
 */
export function GameProvider({ children, initialState = null, persist = true, mode }) {
  const net = useNetSession();
  // Only the top-level provider (no explicit seed) participates in networking; a
  // sandbox seeded with `initialState` replays locally and is never gated.
  const networked = !!net?.enabled && initialState === null;

  const [state, rawDispatch] = useReducer(reducer, initialState, initialState ? (seed) => seed : loadState);

  const effectiveMode = mode ?? (networked ? net.mode : 'gm');
  const modeRef = useRef(effectiveMode);
  useEffect(() => { modeRef.current = effectiveMode; }, [effectiveMode]);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (persist) saveState(state);
  }, [state, persist]);

  // ---- snapshot capture + turn commit (networked player turns) -------------
  const snapshotsRef    = useRef([]);   // [turn-start, ...per-tick]; [0] = reject-all
  const baseRef         = useRef(0);    // headRev pulled at turn start
  const turnStartSeqRef = useRef(-1);   // last event seq before the turn (log slice cut)

  // Snapshot recorder wrapped by the gate. APPLY_TICK's payload is a complete
  // state (free snapshot); APPLY_ROLLBACK pops one per reversed tick, the reversed
  // count read from the clock delta (one tick = one clock unit).
  const recordingDispatch = useCallback((action) => {
    if (action.type === 'APPLY_TICK') {
      snapshotsRef.current = [...snapshotsRef.current, action.newState];
    } else if (action.type === 'APPLY_ROLLBACK') {
      const reversed = Math.max(0, (stateRef.current.session.clock ?? 0) - (action.newState.session.clock ?? 0));
      if (reversed > 0) {
        snapshotsRef.current = snapshotsRef.current.slice(0, Math.max(1, snapshotsRef.current.length - reversed));
      }
    }
    rawDispatch(action);
  }, [rawDispatch]);

  // Turn start (claim): reset snapshots to the turn-start state and capture the
  // base rev + log-slice cut. Fires on the write-lock's false→true transition.
  const prevHoldRef = useRef(false);
  useEffect(() => {
    if (!networked) return;
    if (net.holdsWriteLock && !prevHoldRef.current) {
      snapshotsRef.current = [stateRef.current];
      baseRef.current = net.headRev;
      const log = stateRef.current.eventLog ?? [];
      turnStartSeqRef.current = log.length ? log[log.length - 1].seq : -1;
    }
    prevHoldRef.current = net.holdsWriteLock;
  }, [networked, net?.holdsWriteLock, net?.headRev]);

  // Assembles the commit document from the turn's snapshots, log slice, and the
  // current full state (endState — captures manual edits after the last tick).
  const buildTurnCommit = useCallback(() => {
    const endState = stateRef.current;
    const eventLog = (endState.eventLog ?? []).filter(entry => entry.seq > turnStartSeqRef.current);
    return buildCommit({ base: baseRef.current, snapshots: snapshotsRef.current, eventLog, endState });
  }, []);

  // Bridge the two net→game seams: the commit source (party) and the local-state
  // seed (GM auto-create / hand-off).
  useEffect(() => {
    if (!networked) return;
    net.registerCommitSource(buildTurnCommit);
    net.registerSeed(() => stateRef.current);
  }, [networked, net, buildTurnCommit]);

  // Apply server HEAD pulls (join, hand-off, poll-triggered refresh). Bypasses the
  // gate by design — REPLACE_STATE need not be in any allowed set.
  const incomingSeqRef = useRef(0);
  useEffect(() => {
    if (!networked || !net.incoming) return;
    if (net.incoming.seq !== incomingSeqRef.current && net.incoming.head) {
      incomingSeqRef.current = net.incoming.seq;
      rawDispatch({ type: 'REPLACE_STATE', newState: net.incoming.head });
    }
  }, [networked, net?.incoming, rawDispatch]);

  const getMode = useCallback(() => modeRef.current, []);
  const dispatch = useMemo(
    () => (networked ? gateDispatch(recordingDispatch, getMode) : rawDispatch),
    [networked, recordingDispatch, getMode, rawDispatch],
  );

  const value = useMemo(
    () => ({ state, dispatch, mode: effectiveMode }),
    [state, dispatch, effectiveMode],
  );
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

/**
 * Returns `{ state, dispatch, mode }` from the nearest `GameProvider`. `mode` is
 * the client's permission mode (`'gm'` offline) — pass it with an action to
 * `isActionAllowed` for UI affordance checks.
 *
 * @returns {{ state: GameState, dispatch: (action: object) => void, mode: 'gm'|'player'|'spectator' }}
 */
export function useGame() {
  return useContext(GameContext);
}
