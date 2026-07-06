import { useState, useRef, useMemo, useCallback } from 'react';
import Modal from './Modal.jsx';
import Tooltip from '../Tooltip.jsx';
import EditableSpan from '../EditableSpan.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { usePresets } from '../../hooks/usePresets.js';
import { LIBRARY_CONFIGS } from '../../constants/libraries.jsx';
import { highlight } from '../../logic/text.jsx';
import { formatCount } from '../../logic/format.js';
import { buildOrder, submitOrder } from '../../logic/order.js';
import { unregisteredEntityTags } from '../../logic/tagRegistry.js';
import { useTagsConfig } from '../../hooks/useTagsConfig.js';
import { savePresetToFile, savePresetListToFile, loadPresetsFromFile } from '../../logic/presets.js';

export default function LibraryModal() {
  const { libraryProps } = useUI();
  const config = LIBRARY_CONFIGS[libraryProps?.type];
  // A persisted-but-unknown type (issue #81 rehydration of a corrupt entry) has
  // no config — render nothing rather than crash. Split from the body so the
  // body's hooks always run unconditionally.
  if (!config) return null;
  return <LibraryModalBody config={config} />;
}

function LibraryModalBody({ config }) {
  const { closeLibrary } = useUI();
  const { state, dispatch } = useGame();
  const { locked } = useTagsConfig();

  const { presets, ready, addBlank, addPreset, updatePreset, deletePreset, importPresets } = usePresets(config);
  const [query, setQuery]           = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft]           = useState(null);
  // The shopping list: preset id → ordered copy count (issue #92). A row with a
  // count > 0 is "in the cart" and renders selected; ADD submits every such row.
  const [quantities, setQuantities] = useState({});
  const fileInputRef                = useRef(null);
  // Mirror of `selectedId` for focusPreset, which must read the live selection
  // without re-cloning the draft on every repeat click of the same row.
  const selectedIdRef               = useRef(null);
  selectedIdRef.current = selectedId;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? presets.filter(preset => preset.name.toLowerCase().includes(needle)) : presets;
  }, [presets, query]);

  const hasOrder = presets.some(preset => (quantities[preset.id] ?? 0) > 0);

  // Open a preset in the preview for editing. Re-cloning only when the target
  // differs keeps repeat increment/decrement clicks on the focused row from
  // discarding in-progress edits.
  const focusPreset = useCallback((preset) => {
    if (selectedIdRef.current === preset.id) return;
    setSelectedId(preset.id);
    setDraft(structuredClone(preset));
  }, []);

  const setQuantity = useCallback((id, value) => {
    setQuantities(prev => ({ ...prev, [id]: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0 }));
  }, []);

  const adjustQuantity = useCallback((id, delta) => {
    setQuantities(prev => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }));
  }, []);

  // Carry a row's ordered count onto its fork when editing forks a standard
  // preset (below), so a customized item keeps its place in the cart. Idempotent:
  // a no-op once the source row is already emptied.
  const moveQuantity = useCallback((fromId, toId) => {
    setQuantities(prev => {
      const moved = prev[fromId] ?? 0;
      if (moved <= 0 || fromId === toId) return prev;
      const { [fromId]: _removed, ...rest } = prev;
      return { ...rest, [toId]: (rest[toId] ?? 0) + moved };
    });
  }, []);

  // Edit the draft. User presets autosave in place; editing a standard preset
  // forks it into a new user preset (carrying the edit and the cart count) and
  // selects the fork, keeping bundled presets read-only.
  const patchDraft = useCallback((changes) => {
    if (!draft) return;
    const next = { ...draft, ...changes };
    if (draft.source === 'user') {
      updatePreset(draft.id, changes);
      setDraft(next);
      return;
    }
    const { id, source, ...rest } = next;
    const fork = addPreset(rest);
    setSelectedId(fork.id);
    moveQuantity(draft.id, fork.id);
    setDraft({ ...rest, id: fork.id, source: 'user' });
  }, [draft, updatePreset, addPreset, moveQuantity]);

  // Left click a row adds one copy to the cart; right click removes one. Both
  // also focus the row so the preview reflects what was just clicked.
  const handleRowClick = useCallback((preset) => {
    adjustQuantity(preset.id, +1);
    focusPreset(preset);
  }, [adjustQuantity, focusPreset]);

  const handleRowContext = useCallback((e, preset) => {
    e.preventDefault();
    adjustQuantity(preset.id, -1);
    focusPreset(preset);
  }, [adjustQuantity, focusPreset]);

  // A freshly built preset starts at one copy so it is immediately orderable.
  const handleNew = () => {
    const preset = addBlank();
    focusPreset(preset);
    setQuantity(preset.id, 1);
  };

  const handleDelete = (e, id) => {
    e.stopPropagation();
    deletePreset(id);
    setQuantities(prev => { const { [id]: _removed, ...rest } = prev; return rest; });
    if (id === selectedId) { setSelectedId(null); setDraft(null); }
  };

  // Submit the whole cart at once: one order document, expanded to create
  // actions by submitOrder. Built from `presets` (not the filtered view) so a
  // search that hides a row never drops it from the order. Locked mode
  // pre-checks the WHOLE order before dispatching anything — submitOrder
  // dispatches per line, so a mid-order reducer block would partially fill
  // the cart; here it is all-or-nothing with an explanation. The `locked`
  // flag still rides on every action so the reducer backstop stays honest.
  const handleAdd = () => {
    const order = buildOrder(config.type, presets.map(preset => ({ preset, quantity: quantities[preset.id] ?? 0 })));
    if (!order.lines.length) return;
    if (locked) {
      const offending = [...new Set(order.lines.flatMap(line =>
        unregisteredEntityTags(state.tagRegistry, config.type, line.preset)))];
      if (offending.length) {
        alert(`TAGS LOCKED — order not submitted.\nUnregistered tags:\n  ${offending.join('\n  ')}\nRegister them in the TAG REGISTRY, or set locked: false in CONFIG → TAGS.`);
        return; // keep the modal open so the cart can be fixed
      }
    }
    submitOrder(order, dispatch, config, { locked });
    closeLibrary();
  };

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadPresetsFromFile(file).then(raw => {
      const added = importPresets(raw);
      if (added.length) focusPreset(added[0]);
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
            {ready && filtered.map(preset => {
              const quantity = quantities[preset.id] ?? 0;
              return (
                <div
                  key={preset.id}
                  className={`library-row${quantity > 0 ? ' library-row--selected' : ''}${preset.id === selectedId ? ' library-row--focused' : ''}`}
                  onClick={() => handleRowClick(preset)}
                  onContextMenu={e => handleRowContext(e, preset)}
                >
                  <div
                    className="library-row-icon"
                    style={config.rowIcon(preset) ? { backgroundImage: `url("${config.rowIcon(preset)}")` } : {}}
                  />
                  <span className="library-row-name">{highlight(preset.name, query.trim())}</span>
                  <Tooltip content="Click row +1 · right-click −1 · type to set">
                    <EditableSpan
                      className={`library-row-qty${quantity > 0 ? '' : ' library-row-qty--zero'}`}
                      value={String(quantity)}
                      format={formatCount}
                      singleLine
                      onCommit={v => setQuantity(preset.id, parseInt(v, 10))}
                    />
                  </Tooltip>
                  <Tooltip content="Delete preset">
                    <span className="x" onClick={e => handleDelete(e, preset.id)}>×</span>
                  </Tooltip>
                </div>
              );
            })}
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
          <Tooltip content="Click: save selected. Right click: save filtered list.">
            <button
              className="ctrl"
              onClick={handleSave}
              onContextMenu={handleSave}
            >SAVE</button>
          </Tooltip>
          <button className="ctrl" disabled={!hasOrder} onClick={handleAdd}>ADD</button>
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
