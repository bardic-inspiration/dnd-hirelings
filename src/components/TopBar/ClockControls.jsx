import HoldButton from './HoldButton.jsx';
import Tooltip from '../Tooltip.jsx';

/**
 * The play clock's buttons — play (hold-drag: rate), pause, step back
 * (hold-drag: distance), step forward (hold-drag: step) — shared by the top
 * bar and the review viewer. Purely presentational: the caller decides what
 * each control may do, from its clock's `bounds` and its mode's permissions.
 *
 * @param {{
 *   session: { rateMultiplier: number, stepBack: number, timeStep: number },
 *   playing: boolean,
 *   onPlay: () => void, onStop: () => void, onStepBack: () => void, onAdvance: () => void,
 *   canPlay: boolean, canStepBack: boolean, canStepForward: boolean,
 *   showStepBack?: boolean,
 *   adjust?: { rate?: (delta: number) => void, stepBack?: (delta: number) => void, step?: (delta: number) => void },
 * }} props `adjust` entries left out render their control without hold-drag.
 */
export default function ClockControls({
  session, playing, onPlay, onStop, onStepBack, onAdvance,
  canPlay, canStepBack, canStepForward, showStepBack = true, adjust = {},
}) {
  return (
    <div className="clock-controls">
      <HoldButton
        className={`ctrl ctrl--combo${playing ? ' ctrl--active' : ''}`}
        onClick={onPlay}
        onAdjust={adjust.rate}
        disabled={!canPlay}
        title="Click to play. Hold and drag up/down to adjust rate."
      >
        <span className="combo-glyph">▶</span>
        <span className="combo-value mono">{session.rateMultiplier}</span>
      </HoldButton>
      <Tooltip content="Pause">
        <button
          className={`ctrl${!playing ? ' ctrl--active' : ''}`}
          onClick={onStop}
        >⏸</button>
      </Tooltip>
      {showStepBack && (
        <HoldButton
          className="ctrl ctrl--combo"
          onClick={onStepBack}
          onAdjust={adjust.stepBack}
          disabled={!canStepBack}
          title="Click to step back by the shown number of days. Hold and drag up/down to adjust the step-back distance."
        >
          <span className="combo-glyph">|◀</span>
          <span className="combo-value mono">{session.stepBack}</span>
        </HoldButton>
      )}
      <HoldButton
        className="ctrl ctrl--combo"
        onClick={onAdvance}
        onAdjust={adjust.step}
        disabled={!canStepForward}
        title="Click to step forward. Hold and drag up/down to adjust step."
      >
        <span className="combo-glyph">▶|</span>
        <span className="combo-value mono">{session.timeStep}</span>
      </HoldButton>
    </div>
  );
}
