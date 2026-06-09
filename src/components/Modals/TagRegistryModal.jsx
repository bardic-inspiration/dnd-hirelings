import { useState, useRef, useMemo } from 'react';
import Modal from './Modal.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { parseTag } from '../../logic/tags.js';
import { tagRegistrySave, tagRegistryLoad, flattenRegistry } from '../../logic/tagRegistry.js';

export default function TagRegistryModal() {
  const { closeTagRegistry } = useUI();
  const { state, dispatch } = useGame();
  const registry = state.tagRegistry;

  const [expanded, setExpanded] = useState(new Set());
  const [draft, setDraft] = useState('');
  const fileInputRef = useRef(null);

  // Flatten to ordered visible rows; line numbers reflect full-document position
  // (they skip over collapsed subtrees), matching a code editor's folding gutter.
  const rows = useMemo(() => flattenRegistry(registry, expanded), [registry, expanded]);

  const toggle = (pathStr) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(pathStr)) next.delete(pathStr); else next.add(pathStr);
    return next;
  });

  const handleDelete = (segments) => dispatch({ type: 'TAGREG_DELETE_NODE', segments });

  const handleAdd = () => {
    const segments = parseTag(draft.trim()).segments; // modifier + value dropped
    if (!segments.length) return;
    dispatch({ type: 'TAGREG_ADD_PATH', segments });
    // Reveal the new path by expanding its ancestors.
    setExpanded(prev => {
      const next = new Set(prev);
      for (let i = 1; i < segments.length; i++) {
        next.add(segments.slice(0, i).map(s => s.toLowerCase()).join(':'));
      }
      return next;
    });
    setDraft('');
  };

  const handleSave = () => tagRegistrySave(registry, state.session.id);

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    tagRegistryLoad(file)
      .then(reg => dispatch({ type: 'TAGREG_REPLACE', registry: reg }))
      .catch(err => alert(err.message)); // invalid file: check failed — leave registry untouched
    e.target.value = '';
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } };

  return (
    <Modal onClose={closeTagRegistry} overlayClass="config-overlay">
      <div className="library-panel" onClick={e => e.stopPropagation()}>
        <div className="tagreg-top">
          <span className="library-heading">TAG REGISTRY</span>
          <div className="tagreg-top-actions">
            <button className="ctrl" onClick={handleSave}>SAVE</button>
            <button className="ctrl" onClick={() => fileInputRef.current?.click()}>LOAD</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".yml,.yaml"
              style={{ display: 'none' }}
              onChange={handleLoad}
            />
          </div>
        </div>

        <div className="tagreg-tree">
          {rows.length === 0
            ? <div className="empty">REGISTRY EMPTY</div>
            : rows.map(row => (
              <div className="tagreg-row" key={row.pathStr}>
                <span className="tagreg-ln">{row.lineNo}</span>
                {row.ancestorIsLast.map((isLast, k) => (
                  <span key={k} className={`tagreg-guide${isLast ? '' : ' line'}`} />
                ))}
                {row.hasChildren ? (
                  <button
                    className={`tagreg-fold${row.isLast ? ' last' : ''}`}
                    onClick={() => toggle(row.pathStr)}
                    aria-label={row.isOpen ? 'Collapse' : 'Expand'}
                  >
                    <span className="tagreg-fold-box">{row.isOpen ? '−' : '+'}</span>
                  </button>
                ) : (
                  <span className={`tagreg-tick${row.isLast ? ' last' : ''}`} />
                )}
                <span className="tagreg-key">{row.key}<span className="tagreg-colon">:</span></span>
                <span className="tagreg-x" title="Delete from registry" onClick={() => handleDelete(row.segments)}>×</span>
              </div>
            ))}
        </div>

        <div className="tagreg-builder">
          <input
            className="portraits-search-input"
            type="text"
            placeholder="BUILD A TAG   e.g.   item:weapon:martial"
            value={draft}
            spellCheck={false}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
          <button className="ctrl" onClick={handleAdd}>ADD</button>
        </div>
      </div>
    </Modal>
  );
}
