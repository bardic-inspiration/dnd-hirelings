import { useState, useEffect, useMemo } from 'react';
import Modal from './Modal.jsx';
import { GameProvider, useGame } from '../../state/GameContext.jsx';
import { useNetSession } from '../../state/NetSessionContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { usePlayClock } from '../../hooks/usePlayClock.js';
import { useClockConfig } from '../../hooks/useClockConfig.js';
import { fetchPending } from '../../logic/netSession.js';
import { stateAt } from '../../logic/clockSources.js';
import { formatClockParts } from '../../logic/time.js';
import Dashboard from '../Dashboard/Dashboard.jsx';

/**
 * The `recorded + spectator` clock cluster + finalize chrome, mounted INSIDE the
 * sandbox provider so `usePlayClock` dispatches into the sandbox only. Scrubbing
 * never touches the GM's live working state.
 */
function ReviewControls({ ctx, onFinalize }) {
  const { start, stop, advance, retreat, bounds, index } = usePlayClock({ source: 'recorded', sourceContext: ctx });
  const { playing } = useUI();
  const { state } = useGame();          // sandbox state (read-only Year/Day)
  const { calendar } = useClockConfig();
  const { year, day } = formatClockParts(state.session.clock, calendar);

  return (
    <div className="review-controls">
      <div className="inset-panel clock-display">
        <span className="label">YEAR</span>
        <span className="value bright mono">{year}</span>
        <span className="label">DAY</span>
        <span className="value bright mono">{day}</span>
      </div>
      <div className="clock-controls">
        <button className={`ctrl${playing ? ' ctrl--active' : ''}${!bounds.canStepForward ? ' ctrl--disabled' : ''}`}
          onClick={bounds.canStepForward ? start : undefined}>▶</button>
        <button className={`ctrl${!playing ? ' ctrl--active' : ''}`} onClick={stop}>⏸</button>
        <button className={`ctrl${!bounds.canStepBack ? ' ctrl--disabled' : ''}`}
          onClick={bounds.canStepBack ? retreat : undefined}>|◀</button>
        <button className={`ctrl${!bounds.canStepForward ? ' ctrl--disabled' : ''}`}
          onClick={bounds.canStepForward ? advance : undefined}>▶|</button>
      </div>
      {/* Finalize is prefix-only: the playhead is the cut, the tail is discarded. */}
      <button className="ctrl review-finalize" onClick={() => onFinalize(index)}>FINALIZE AT THIS POINT</button>
    </div>
  );
}

/**
 * Review viewer (see docs/specs/gm-player-mode.md §6): the live dashboard mounted
 * in a sandboxed `GameProvider` seeded from a snapshot, clock source `recorded`,
 * mode `spectator`. The GM opens it at `pending-review`; it pulls the commit
 * document, replays it, and finalizes at the chosen prefix cut.
 */
export default function ReviewModal() {
  const net = useNetSession();
  const { closeReview, openConfirm } = useUI();
  const [commit, setCommit] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!net?.enabled) return;
    let cancelled = false;
    fetchPending(net.sessionId)
      .then(doc => { if (!cancelled) setCommit(doc); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [net?.enabled, net?.sessionId]);

  // The recorded-source context: snapshots ship stripped, so the registry/log are
  // folded back from endState inside `stateAt`.
  const ctx = useMemo(() => commit && {
    snapshots: commit.snapshots,
    eventLog: commit.eventLog,
    endState: commit.endState,
    max: commit.snapshots.length - 1,
  }, [commit]);

  const initialState = useMemo(() => ctx && stateAt(ctx, 0).newState, [ctx]);

  // Finalize: reconstruct the final head at the cut and POST it (the client
  // reconstructs so the server stays dumb). An always-optional note rides along.
  const handleFinalize = (cutIndex) => {
    openConfirm({
      message: 'Finalize the turn at this point? Days after the cut are discarded. Optional note to the party:',
      type: 'prompt',
      defaultValue: '',
      onConfirm: (message) => {
        const head = stateAt(ctx, cutIndex).newState;
        Promise.resolve(net.finalize(cutIndex, message, head))
          .then(() => closeReview())
          .catch(err => openConfirm({ message: err.message, type: 'alert' }));
      },
    });
  };

  return (
    <Modal onClose={closeReview} overlayClass="review-overlay">
      <div className="review-panel" onClick={e => e.stopPropagation()}>
        <div className="review-header">
          <span className="review-title">TURN REVIEW</span>
          <button className="ctrl" onClick={closeReview}>CLOSE</button>
        </div>
        {error && <div className="review-message dim">Could not load the pending turn: {error}</div>}
        {!error && !ctx && <div className="review-message dim">Loading pending turn…</div>}
        {ctx && (
          <GameProvider initialState={initialState} persist={false} mode="spectator">
            <ReviewControls ctx={ctx} onFinalize={handleFinalize} />
            <Dashboard />
          </GameProvider>
        )}
      </div>
    </Modal>
  );
}
