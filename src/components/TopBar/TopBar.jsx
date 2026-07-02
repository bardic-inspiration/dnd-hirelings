import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { PALETTES } from '../../constants/palettes.js';
import { applyPalette, getStoredPalette } from '../../hooks/usePalette.js';
import { formatClockParts, clockMinutesFromParts, DAYS_PER_YEAR } from '../../logic/time.js';
import { saveStateToFile, loadStateFromFile } from '../../logic/session.js';
import { saveEventLogToFile } from '../../logic/eventLog.js';
import EditableSpan from '../EditableSpan.jsx';
import HoldButton from './HoldButton.jsx';

export default function TopBar({ onPlay, onStop, onAdvance }) {
  const { state, dispatch } = useGame();
  const { playing, openConfig, openTagRegistry } = useUI();
  const { session } = state;
  const [palette, setPalette] = useState(getStoredPalette);

  const { year, day } = formatClockParts(session.clock);
  const updateSession = (changes) => dispatch({ type: 'SESSION_UPDATE', payload: changes });

  const handleApplyPalette = (name) => {
    applyPalette(name);
    setPalette(name);
  };

  const handleTogglePalette = () => {
    handleApplyPalette(palette === 'light' ? 'dark' : 'light');
  };

  const setClock = (y, d) => updateSession({
    clock: clockMinutesFromParts(Math.max(1, y), Math.max(1, Math.min(DAYS_PER_YEAR, d))),
  });

  const adjustRate = (delta) => {
    const next = Math.max(0.1, Math.round((session.rateMultiplier + delta * 0.1) * 10) / 10);
    updateSession({ rateMultiplier: next });
  };

  const adjustStep = (delta) => {
    const cur  = Number(session.timeStep) || 1;
    const next = Math.max(1, Math.min(DAYS_PER_YEAR, Math.round(cur + delta)));
    updateSession({ timeStep: next });
  };

  const handleSave = () => saveStateToFile(state);

  const handleSaveLog = () => saveEventLogToFile(state.eventLog, session.id);

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadStateFromFile(file)
      .then(data => dispatch({ type: 'REPLACE_STATE', newState: data }))
      .catch(err => alert(err.message));
    e.target.value = '';
  };

  const handleNew = () => {
    const newId = prompt('Enter new session ID:', '');
    if (newId === null) return;
    onStop();
    dispatch({ type: 'RESET' });
    if (newId.trim()) dispatch({ type: 'SESSION_UPDATE', payload: { id: newId.trim() } });
  };

  return (
    <nav id="topbar">
      {/* Clock display */}
      <div className="inset-panel clock-display">
        <span className="label">YEAR</span>
        <EditableSpan
          className="value bright mono"
          value={String(year)}
          onCommit={v => setClock(parseInt(v) || 1, day)}
        />
        <span className="label">DAY</span>
        <EditableSpan
          className="value bright mono"
          value={String(day)}
          onCommit={v => setClock(year, parseInt(v) || 1)}
        />
      </div>

      {/* Clock controls */}
      <div className="clock-controls">
        <HoldButton
          className={`ctrl ctrl--combo${playing ? ' ctrl--active' : ''}`}
          onClick={onPlay}
          onAdjust={adjustRate}
          title="Click to play. Hold and drag up/down to adjust rate."
        >
          <span className="combo-glyph">▶</span>
          <span className="combo-value mono">{session.rateMultiplier}</span>
        </HoldButton>
        <button
          className={`ctrl${!playing ? ' ctrl--active' : ''}`}
          onClick={onStop}
          title="Pause"
        >⏸</button>
        <HoldButton
          className="ctrl ctrl--combo"
          onClick={onAdvance}
          onAdjust={adjustStep}
          title="Click to step forward. Hold and drag up/down to adjust step."
        >
          <span className="combo-glyph">▶|</span>
          <span className="combo-value mono">{session.timeStep}</span>
        </HoldButton>
      </div>

      {/* Palette picker */}
      <button
        className="palette-switch"
        title={PALETTES[palette].label}
        onClick={e => { e.stopPropagation(); handleTogglePalette(); }}
      >
        <span className={`palette-switch-cell${palette === 'light' ? ' palette-switch-cell--filled' : ''}`}>☼</span>
        <span className={`palette-switch-cell${palette === 'dark' ? ' palette-switch-cell--filled' : ''}`}>☽</span>
      </button>

      {/* Session controls */}
      <div className="inset-panel session-controls right">
        <span className="value bright mono">{session.id}</span>
        <button className="ctrl" onClick={handleNew}>NEW</button>
        <button className="ctrl" onClick={handleSave}>SAVE</button>
        <label className="ctrl" style={{ cursor: 'pointer' }}>
          LOAD
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoad} />
        </label>
        <button className="ctrl" onClick={handleSaveLog} title="Export the per-day progress event log as CSV">LOG</button>
        <button className="ctrl" onClick={() => openTagRegistry()}>TAG REGISTRY</button>
        <button className="ctrl" onClick={openConfig}>SETTINGS</button>
      </div>
    </nav>
  );
}
