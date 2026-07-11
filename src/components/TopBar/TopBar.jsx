import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { PALETTES } from '../../constants/palettes.js';
import { applyPalette, getStoredPalette } from '../../hooks/usePalette.js';
import { formatClockParts, clockTicksFromParts } from '../../logic/time.js';
import { getRollbackHorizon } from '../../logic/rollback.js';
import { saveStateToFile, loadStateFromFile } from '../../logic/session.js';
import { saveEventLogToFile } from '../../logic/eventLog.js';
import { useClockConfig } from '../../hooks/useClockConfig.js';
import { useRollbackConfig } from '../../hooks/useRollbackConfig.js';
import EditableSpan from '../EditableSpan.jsx';
import HoldButton from './HoldButton.jsx';
import Tooltip from '../Tooltip.jsx';

export default function TopBar({ onPlay, onStop, onAdvance, onStepBack, bounds = { canStepBack: true, canStepForward: true } }) {
  const { state, dispatch } = useGame();
  const { playing, openConfig, openTagRegistry, openConfirm } = useUI();
  const { session } = state;
  const [palette, setPalette] = useState(getStoredPalette);
  const clockConfig = useClockConfig();
  const rollbackConfig = useRollbackConfig();
  const { calendar, timeStep, rateMultiplier } = clockConfig;

  const { year, day } = formatClockParts(session.clock, calendar);
  const horizon = getRollbackHorizon(state.eventLog);
  const horizonParts = horizon.canStepBack ? formatClockParts(horizon.earliestClock, calendar) : null;
  const updateSession = (changes) => dispatch({ type: 'SESSION_UPDATE', payload: changes });

  const handleApplyPalette = (name) => {
    applyPalette(name);
    setPalette(name);
  };

  const handleTogglePalette = () => {
    handleApplyPalette(palette === 'light' ? 'dark' : 'light');
  };

  const setClock = (y, d) => updateSession({
    clock: clockTicksFromParts(Math.max(1, y), Math.max(1, Math.min(calendar.daysPerYear, d)), calendar),
  });

  const adjustRate = (delta) => {
    const raw  = Math.round((session.rateMultiplier + delta * 0.1) * 10) / 10;
    const next = Math.max(rateMultiplier.min, Math.min(rateMultiplier.max, raw));
    updateSession({ rateMultiplier: next });
  };

  const adjustStep = (delta) => {
    const cur  = Number(session.timeStep) || 1;
    const next = Math.max(timeStep.min, Math.min(timeStep.max, Math.round(cur + delta)));
    updateSession({ timeStep: next });
  };

  const adjustStepBack = (delta) => {
    const cur  = Number(session.stepBack) || 1;
    const next = Math.max(timeStep.min, Math.min(timeStep.max, Math.round(cur + delta)));
    updateSession({ stepBack: next });
  };

  const handleSave = () => saveStateToFile(state);

  const handleSaveLog = () => saveEventLogToFile(state.eventLog, session.id);

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadStateFromFile(file)
      .then(data => dispatch({ type: 'REPLACE_STATE', newState: data }))
      .catch(err => openConfirm({ message: err.message, type: 'alert' }));
    e.target.value = '';
  };

  const handleNew = () => {
    openConfirm({
      message: 'Enter new session ID:',
      type: 'prompt',
      defaultValue: '',
      onConfirm: (newId) => {
        onStop();
        dispatch({ type: 'RESET' });
        if (newId.trim()) dispatch({ type: 'SESSION_UPDATE', payload: { id: newId.trim() } });
      },
    });
  };

  return (
    <nav id="topbar">
      {/* Clock display */}
      <div className="inset-panel clock-display">
        <span className="label">YEAR</span>
        <EditableSpan
          id="clock-year"
          className="value bright mono"
          value={String(year)}
          onCommit={v => setClock(parseInt(v) || 1, day)}
        />
        <span className="label">DAY</span>
        <EditableSpan
          id="clock-day"
          className="value bright mono"
          value={String(day)}
          onCommit={v => setClock(year, parseInt(v) || 1)}
        />
        {rollbackConfig.enabled && horizonParts && (
          <Tooltip content="Earliest time reachable by step-back">
            <span className="clock-display-horizon mono">
              ⟲ Y{horizonParts.year} D{horizonParts.day}
            </span>
          </Tooltip>
        )}
      </div>

      {/* Clock controls */}
      <div className="clock-controls">
        <HoldButton
          className={`ctrl ctrl--combo${playing ? ' ctrl--active' : ''}`}
          onClick={onPlay}
          onAdjust={adjustRate}
          disabled={!bounds.canStepForward}
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
        {rollbackConfig.enabled && (
          <HoldButton
            className="ctrl ctrl--combo"
            onClick={onStepBack}
            onAdjust={adjustStepBack}
            disabled={!bounds.canStepBack}
            title="Click to step back by the shown number of days. Hold and drag up/down to adjust the step-back distance."
          >
            <span className="combo-glyph">|◀</span>
            <span className="combo-value mono">{session.stepBack}</span>
          </HoldButton>
        )}
        <HoldButton
          className="ctrl ctrl--combo"
          onClick={onAdvance}
          onAdjust={adjustStep}
          disabled={!bounds.canStepForward}
          title="Click to step forward. Hold and drag up/down to adjust step."
        >
          <span className="combo-glyph">▶|</span>
          <span className="combo-value mono">{session.timeStep}</span>
        </HoldButton>
      </div>

      {/* Palette picker */}
      <Tooltip content={PALETTES[palette].label}>
        <button
          className="palette-switch"
          onClick={e => { e.stopPropagation(); handleTogglePalette(); }}
        >
          <span className={`palette-switch-cell${palette === 'light' ? ' palette-switch-cell--filled' : ''}`}>☼</span>
          <span className={`palette-switch-cell${palette === 'dark' ? ' palette-switch-cell--filled' : ''}`}>☽</span>
        </button>
      </Tooltip>

      {/* Session controls */}
      <div className="inset-panel session-controls right">
        <span className="value bright mono">{session.id}</span>
        <button className="ctrl" onClick={handleNew}>NEW</button>
        <button className="ctrl" onClick={handleSave}>SAVE</button>
        <label className="ctrl" style={{ cursor: 'pointer' }}>
          LOAD
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoad} />
        </label>
        <Tooltip content="Export the per-day progress event log as CSV">
          <button className="ctrl" onClick={handleSaveLog}>LOG</button>
        </Tooltip>
        <button className="ctrl" onClick={() => openTagRegistry()}>TAG REGISTRY</button>
        <button className="ctrl" onClick={openConfig}>CONFIG</button>
      </div>
    </nav>
  );
}
