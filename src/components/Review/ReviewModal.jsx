import { useEffect, useMemo, useState } from 'react';
import Modal from '../Modals/Modal.jsx';
import Dashboard from '../Dashboard/Dashboard.jsx';
import ClockControls from '../TopBar/ClockControls.jsx';
import { GameProvider, useGame } from '../../state/GameContext.jsx';
import { PinnedModeProvider, useNetSession } from '../../state/NetSessionContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { usePlayClock } from '../../hooks/usePlayClock.js';
import { useClockConfig } from '../../hooks/useClockConfig.js';
import { stateAt } from '../../logic/clockSources.js';
import { formatClockParts } from '../../logic/time.js';
import { finalizePrompt } from '../../logic/review.js';

/**
 * The GM's review viewer (docs/spec/multiplayer.md "Review viewer"): a
 * full-screen modal over the pending commit. It mounts the live dashboard in
 * a **second, sandboxed `GameProvider`** — seeded with the turn start,
 * `persist: false`, its mode pinned to `spectator` — whose clock runs on the
 * `recorded` source, so scrubbing never touches the GM's live state or save.
 * **Finalize** is a separate control: it keeps the turn up to the playhead.
 *
 * Closes itself when the turn stops pending review (finalized, or taken back).
 */
export default function ReviewModal() {
  const net = useNetSession();
  const { closeReview, confirmProps } = useUI();
  const [commit, setCommit] = useState(undefined);

  useEffect(() => {
    let current = true;
    net.loadPending().then(pending => { if (current) setCommit(pending); });
    return () => { current = false; };
    // Fetch once per open; the pending commit can't change while it's pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingReview = net.baton?.status === 'pending-review';
  useEffect(() => {
    if (net.baton && !pendingReview) closeReview();
  }, [net.baton, pendingReview, closeReview]);

  const turnStart = useMemo(() => (commit ? stateAt(commit, 0) : null), [commit]);

  // Escape belongs to the finalize prompt while it's open.
  const onClose = confirmProps ? () => {} : closeReview;

  return (
    <Modal onClose={onClose} overlayClass="review-overlay">
      <div className="review-modal">
        {turnStart
          ? (
            <GameProvider initialState={turnStart} persist={false}>
              <PinnedModeProvider mode="spectator">
                <ReviewViewer commit={commit} onClose={closeReview} />
              </PinnedModeProvider>
            </GameProvider>
          )
          : (
            <div className="review-header">
              <span className="review-title">REVIEW</span>
              <span className="review-status">
                {commit === undefined ? 'loading the pending turn…' : (net.error ?? 'no turn is pending review')}
              </span>
              <button className="ctrl right" onClick={closeReview}>CLOSE</button>
            </div>
          )}
      </div>
    </Modal>
  );
}

// Inside the sandbox: `useGame()` here is the sandbox's provider.
function ReviewViewer({ commit, onClose }) {
  const net = useNetSession();
  const { openConfirm } = useUI();
  const { state } = useGame();
  const { calendar } = useClockConfig();
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  // Stable for the commit's lifetime: a new context resets the clock driver.
  const sourceContext = useMemo(() => ({ commit, index: 0, onIndexChange: setIndex }), [commit]);
  const clock = usePlayClock({ source: 'recorded', sourceContext, playState: { playing, setPlaying } });

  const tickCount = commit.snapshots.length - 1;
  const { year, day } = formatClockParts(state.session.clock, calendar);

  const finalize = () => {
    clock.stop();
    openConfirm({
      type: 'prompt',
      message: finalizePrompt(index, tickCount),
      defaultValue: '',
      onConfirm: async (message) => {
        setBusy(true);
        const ok = await net.finalize(index, (message ?? '').trim());
        setBusy(false);
        if (ok) onClose();
      },
    });
  };

  return (
    <>
      <div className="review-header">
        <span className="review-title">REVIEW</span>
        <div className="inset-panel clock-display">
          <span className="label">YEAR</span>
          <span className="value bright mono">{year}</span>
          <span className="label">DAY</span>
          <span className="value bright mono">{day}</span>
        </div>
        <ClockControls
          session={state.session}
          playing={playing}
          onPlay={clock.start}
          onStop={clock.stop}
          onStepBack={clock.retreat}
          onAdvance={clock.advance}
          canPlay={clock.bounds.canPlay}
          canStepBack={clock.bounds.canStepBack}
          canStepForward={clock.bounds.canStepForward}
        />
        <label className="review-scrubber">
          <input
            type="range"
            min={0}
            max={tickCount}
            step={1}
            value={index}
            disabled={tickCount === 0}
            onChange={e => clock.seek(Number(e.target.value))}
          />
          <span className="mono">{index} / {tickCount}</span>
        </label>
        {net.error && <span className="review-status review-status--error">{net.error}</span>}
        <div className="review-actions right">
          <button className="ctrl" onClick={finalize} disabled={busy}>FINALIZE AT {index}</button>
          <button className="ctrl" onClick={onClose}>CLOSE</button>
        </div>
      </div>
      <div className="review-body">
        <Dashboard />
      </div>
    </>
  );
}
