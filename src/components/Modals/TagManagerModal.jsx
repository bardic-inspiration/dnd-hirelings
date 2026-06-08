import { useState, useRef } from 'react';
import Modal from './Modal.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { parseTag } from '../../logic/tags.js';
import { tagLibSave, tagLibLoad } from '../../logic/tagLibrary.js';

// Recursive tree rows. Keys are sorted for stable display (mirrors the YAML dump).
// A branch (non-empty children) gets a caret; every node has a delete ×, since the
// library is only ever pruned here — never by removing a tag in game.
function TagTreeNodes({ node, path, expanded, toggle, onDelete }) {
  return Object.keys(node).sort().map(key => {
    const childPath = [...path, key];
    const pathStr = childPath.join(':');
    const children = node[key];
    const hasChildren = Object.keys(children).length > 0;
    const isOpen = expanded.has(pathStr);
    return (
      <div key={pathStr}>
        <div className="taglib-node" style={{ paddingLeft: `${path.length * 16 + 6}px` }}>
          <span
            className={`taglib-caret${hasChildren ? '' : ' empty'}`}
            onClick={() => hasChildren && toggle(pathStr)}
          >{hasChildren ? (isOpen ? '▾' : '▸') : ''}</span>
          <span className="taglib-key">{key}</span>
          <span className="x" title="Delete from library" onClick={() => onDelete(childPath)}>×</span>
        </div>
        {hasChildren && isOpen && (
          <TagTreeNodes node={children} path={childPath} expanded={expanded} toggle={toggle} onDelete={onDelete} />
        )}
      </div>
    );
  });
}

export default function TagManagerModal() {
  const { closeTagManager } = useUI();
  const { state, dispatch } = useGame();
  const library = state.tagLibrary;

  const [expanded, setExpanded] = useState(new Set());
  const [draft, setDraft] = useState('');
  const fileInputRef = useRef(null);

  const toggle = (pathStr) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(pathStr)) next.delete(pathStr); else next.add(pathStr);
    return next;
  });

  const handleDelete = (segments) => dispatch({ type: 'TAGLIB_DELETE_NODE', segments });

  const handleAdd = () => {
    const segments = parseTag(draft.trim()).segments; // modifier + value dropped
    if (!segments.length) return;
    dispatch({ type: 'TAGLIB_ADD_PATH', segments });
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

  const handleSave = () => tagLibSave(library, state.session.id);

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    tagLibLoad(file)
      .then(lib => dispatch({ type: 'TAGLIB_REPLACE', library: lib }))
      .catch(err => alert(err.message)); // invalid file: tagLibCheck failed — leave library untouched
    e.target.value = '';
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } };

  return (
    <Modal onClose={closeTagManager} overlayClass="config-overlay">
      <div className="library-panel" onClick={e => e.stopPropagation()}>
        <div className="taglib-top">
          <span className="library-heading">TAG MANAGER</span>
          <div className="taglib-top-actions">
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

        <div className="taglib-tree">
          {Object.keys(library).length === 0
            ? <div className="empty">LIBRARY EMPTY</div>
            : <TagTreeNodes node={library} path={[]} expanded={expanded} toggle={toggle} onDelete={handleDelete} />}
        </div>

        <div className="taglib-builder">
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
