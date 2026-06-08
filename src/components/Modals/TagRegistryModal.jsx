import { useState, useRef } from 'react';
import Modal from './Modal.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { parseTag } from '../../logic/tags.js';
import { tagRegistrySave, tagRegistryLoad } from '../../logic/tagRegistry.js';

// Recursive tree rows. Keys are sorted for stable display (mirrors the YAML dump).
// A branch (non-empty children) gets a caret; every node has a delete ×, since the
// registry is only ever pruned here — never by removing a tag in game. The caret
// column is fixed-width so leaf and branch rows at the same tier align their keys.
function TagTreeNodes({ node, path, expanded, toggle, onDelete }) {
  return Object.keys(node).sort().map(key => {
    const childPath = [...path, key];
    const pathStr = childPath.join(':');
    const children = node[key];
    const hasChildren = Object.keys(children).length > 0;
    const isOpen = expanded.has(pathStr);
    return (
      <div key={pathStr}>
        <div className="tagreg-node" style={{ paddingLeft: `${path.length * 16 + 6}px` }}>
          <span
            className={`tagreg-caret${hasChildren ? '' : ' empty'}`}
            onClick={() => hasChildren && toggle(pathStr)}
          >{hasChildren ? (isOpen ? '▾' : '▸') : ''}</span>
          <span className="tagreg-key">{key}</span>
          <span className="x" title="Delete from registry" onClick={() => onDelete(childPath)}>×</span>
        </div>
        {hasChildren && isOpen && (
          <TagTreeNodes node={children} path={childPath} expanded={expanded} toggle={toggle} onDelete={onDelete} />
        )}
      </div>
    );
  });
}

export default function TagRegistryModal() {
  const { closeTagRegistry } = useUI();
  const { state, dispatch } = useGame();
  const registry = state.tagRegistry;

  const [expanded, setExpanded] = useState(new Set());
  const [draft, setDraft] = useState('');
  const fileInputRef = useRef(null);

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
          {Object.keys(registry).length === 0
            ? <div className="empty">REGISTRY EMPTY</div>
            : <TagTreeNodes node={registry} path={[]} expanded={expanded} toggle={toggle} onDelete={handleDelete} />}
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
