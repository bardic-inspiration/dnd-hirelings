import { useState, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { PALETTES } from '../../palettes.js';
import { applyPalette, getStoredPalette } from '../../hooks/usePalette.js';
import { formatClockParts, clockMinutesFromParts } from '../../logic/time.js';
import EditableSpan from '../EditableSpan.jsx';

export default function MenuBar({ onPlay, onStop, onAdvance }) {
  const { state, dispatch } = useGame();
  const { playing, setShowInventory, setShowConfig } = useUI();
  const { session } = state;
  const [palette, setPalette] = useState(getStoredPalette);

  const { year, week, day } = formatClockParts(session.clock);

  const handleApplyPalette = (name) => {
    applyPalette(name);
    setPalette(name);
  };

  const updateSession = (changes) => dispatch({ type: 'SESSION_UPDATE', payload: changes });

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hirelings-${session.id || 'export'}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data.session || !Array.isArray(data.agents) || !Array.isArray(data.tasks)) {
          alert('File does not contain valid hireling data.');
          return;
        }
        dispatch({ type: 'REPLACE_STATE', newState: data });
      } catch (err) { alert('Invalid JSON: ' + err.message); }
    };
    r.readAsText(file);
    e.target.value = '';
  };

  const handleReset = () => {
    if (!confirm('Reset everything to defaults? All agents, tasks, and inventory will be lost.')) return;
    onStop();
    dispatch({ type: 'RESET' });
  };

  const handleClockBlur = (field, val) => {
    const cur = formatClockParts(session.clock);
    const y = field === 'year' ? Math.max(1, parseInt(val) || 1) : cur.year;
    const w = field === 'week' ? Math.max(1, parseInt(val) || 1) : cur.week;
    const d = field === 'day'  ? Math.max(1, parseInt(val) || 1) : cur.day;
    updateSession({ clock: clockMinutesFromParts(y, w, d) });
  };

  return (
    <nav id="menu">
      {/* Session ID */}
      <div className="menu-section">
        <span className="label">SESSION</span>
        <EditableSpan
          className="value"
          value={session.id}
          onCommit={v => updateSession({ id: v || '001' })}
        />
      </div>

      {/* Clock */}
      <div className="menu-section">
        <span className="label">YEAR</span>
        <span id="clock-year" className="value mono" contentEditable suppressContentEditableWarning spellCheck={false}
          onBlur={e => handleClockBlur('year', e.currentTarget.textContent)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          onClick={e => e.stopPropagation()}
        >{year}</span>
        <span className="label">WK</span>
        <span id="clock-week" className="value mono" contentEditable suppressContentEditableWarning spellCheck={false}
          onBlur={e => handleClockBlur('week', e.currentTarget.textContent)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          onClick={e => e.stopPropagation()}
        >{week}</span>
        <span className="label">DAY</span>
        <span id="clock-day" className="value mono" contentEditable suppressContentEditableWarning spellCheck={false}
          onBlur={e => handleClockBlur('day', e.currentTarget.textContent)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          onClick={e => e.stopPropagation()}
        >{day}</span>
      </div>

      {/* Playback rate */}
      <div className="menu-section">
        <span className="label">×</span>
        <span id="playback-rate" className="value mono" contentEditable suppressContentEditableWarning spellCheck={false}
          onBlur={e => {
            const m = e.currentTarget.textContent.trim().match(/[\d.]+/);
            const mult = m ? parseFloat(m[0]) : 1;
            const rate = mult > 0 ? mult : 1;
            updateSession({ rateMultiplier: rate, playbackRate: String(rate) });
            e.currentTarget.textContent = String(rate);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { e.currentTarget.textContent = session.playbackRate; }
          }}
          onClick={e => e.stopPropagation()}
        >{session.playbackRate}</span>
      </div>

      {/* Time step */}
      <div className="menu-section">
        <span className="label">STEP</span>
        <EditableSpan
          className="value mono"
          value={session.timeStep}
          onCommit={v => updateSession({ timeStep: v || '1' })}
        />
        <span className="label">DAY</span>
      </div>

      {/* Clock controls */}
      <div className="menu-section">
        <button className={`ctrl${playing ? ' active-ctrl' : ''}`} id="play-btn"  onClick={onPlay}>▶</button>
        <button className={`ctrl${!playing ? ' active-ctrl' : ''}`} id="pause-btn" onClick={onStop}>⏸</button>
        <button className="ctrl" id="advance-time" onClick={onAdvance}>▶|</button>
      </div>

      {/* Bank */}
      <div className="menu-section">
        <span className="label">GP</span>
        <span id="bank" className="value mono" contentEditable suppressContentEditableWarning spellCheck={false}
          onBlur={e => {
            const v = parseFloat(e.currentTarget.textContent);
            updateSession({ bank: isNaN(v) ? 0 : Math.round(v * 100) / 100 });
          }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          onClick={e => e.stopPropagation()}
        >{(session.bank ?? 0).toFixed(1)}</span>
      </div>

      {/* Palette picker */}
      <div className="menu-section">
        {Object.entries(PALETTES).map(([name, p]) => (
          <button
            key={name}
            className={`palette-btn${palette === name ? ' active' : ''}`}
            title={p.label}
            onClick={e => { e.stopPropagation(); handleApplyPalette(name); }}
          >
            <span className="palette-dot" style={{ background: p.highlight }} />
            {p.label}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="menu-section right">
        <button className="ctrl" onClick={() => dispatch({ type: 'AGENT_CREATE' })}>+ AGENT</button>
        <button className="ctrl" onClick={() => dispatch({ type: 'TASK_CREATE' })}>+ TASK</button>
        <button className="ctrl" onClick={() => dispatch({ type: 'AGENTS_CLEAR_TASKS' })}>CLEAR</button>
        <button className="ctrl" onClick={handleExport}>SAVE</button>
        <label className="ctrl" style={{ cursor: 'pointer' }}>
          LOAD
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
        </label>
        <button className="ctrl" onClick={handleReset}>RESET</button>
        <button className="ctrl" id="inventory-btn" onClick={() => setShowInventory(true)}>INVENTORY</button>
        <button className="ctrl" id="config-btn"    onClick={() => setShowConfig(true)}>SETTINGS</button>
      </div>
    </nav>
  );
}
