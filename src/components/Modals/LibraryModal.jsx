import { useState, useRef, useMemo, useCallback } from 'react';
import Modal from './Modal.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { usePresets } from '../../hooks/usePresets.js';
import { LIBRARY_CONFIGS } from '../../constants/libraries.jsx';
import { highlight } from '../../logic/text.jsx';
import { savePresetToFile, savePresetListToFile, loadPresetsFromFile } from '../../logic/presets.js';

export default function LibraryModal() {
  const { libraryProps, closeLibrary } = useUI();
  const { dispatch } = useGame();
  const config = LIBRARY_CONFIGS[libraryProps.type];

  const { presets, ready, addBlank, addPreset, updatePreset, deletePreset, importPresets } = usePresets(config);
  const [query, setQuery]           = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft]           = useState(null);
  const fileInputRef                = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? presets.filter(p => p.name.toLowerCase().includes(q)) : presets;
  }, [presets, query]);

  // The draft holds its own id/source, so selection is driven explicitly rather
  // than by an effect watching `presets` (which would race with async writes).
  const selectPreset = useCallback((preset) => {
    setSelectedId(preset.id);
    setDraft(structuredClone(preset));
  }, []);

  // Edit the draft. User presets autosave in place; editing a standard preset
  // forks it into a new user preset (carrying the edit) and selects the fork,
  // keeping bundled presets read-only.
  const patchDraft = useCallback((changes) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...changes };
      if (prev.source === 'user') {
        updatePreset(prev.id, changes);
        return next;
      }
      const { id, source, ...rest } = next;
      const fork = addPreset(rest);
      setSelectedId(fork.id);
      return { ...rest, id: fork.id, source: 'user' };
    });
  }, [updatePreset, addPreset]);

  const handleNew = () => selectPreset(addBlank());

  const handleDelete = (e, id) => {
    e.stopPropagation();
    deletePreset(id);
    if (id === selectedId) { setSelectedId(null); setDraft(null); }
  };

  const handleAdd = () => {
    if (!draft) return;
    dispatch(config.toCreateAction(draft));
    closeLibrary();
  };

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadPresetsFromFile(file).then(raw => {
      const added = importPresets(raw);
      if (added.length) selectPreset(added[0]);
    });
    e.target.value = '';
  };

  // Left click saves the selected preset; right click saves the filtered list.
  const handleSave = (e) => {
    e.preventDefault();
    if (e.type === 'contextmenu') savePresetListToFile(filtered, config.type);
    else if (draft) savePresetToFile(draft, config.type);
  };

  const Preview = config.Preview;

  return (
    <Modal onClose={closeLibrary} overlayClass="config-overlay">
      <div className={config.panelClass} onClick={e => e.stopPropagation()}>
        <div className="library-heading">{config.label}</div>

        <div className="library-body">
          <div className="library-list">
            {!ready && <div className="empty">LOADING</div>}
            {ready && filtered.map(p => (
              <div
                key={p.id}
                className={`library-row${p.id === selectedId ? ' selected' : ''}`}
                onClick={() => selectPreset(p)}
              >
                <div
                  className="library-row-icon"
                  style={config.rowIcon(p) ? { backgroundImage: `url("${config.rowIcon(p)}")` } : {}}
                />
                <span className="library-row-name">{highlight(p.name, query.trim())}</span>
                <span className="x" title="Delete preset" onClick={e => handleDelete(e, p.id)}>×</span>
              </div>
            ))}
            {ready && (
              <button className="library-new-row" onClick={handleNew}>+ NEW</button>
            )}
          </div>

          <div className="library-preview">
            {draft
              ? <Preview draft={draft} onChange={patchDraft} />
              : <div className="empty">Select a preset</div>}
          </div>
        </div>

        <div className="portraits-search-bar">
          <input
            className="portraits-search-input"
            type="text"
            placeholder="SEARCH"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <button className="ctrl" onClick={() => fileInputRef.current?.click()}>LOAD</button>
          <button
            className="ctrl"
            title="Click: save selected. Right click: save filtered list."
            onClick={handleSave}
            onContextMenu={handleSave}
          >SAVE</button>
          <button className="ctrl" disabled={!draft} onClick={handleAdd}>ADD</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleLoad}
          />
        </div>
      </div>
    </Modal>
  );
}
