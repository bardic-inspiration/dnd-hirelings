import { useState, useRef, useCallback } from 'react';
import Modal from './Modal.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { PORTRAIT_URLS, isValidImageFile } from '../../portraits.js';

export default function PortraitsPanel() {
  const { portraitsProps, closePortraits } = useUI();
  const [query, setQuery]                 = useState('');
  const fileInputRef                      = useRef(null);

  const filtered = query.trim()
    ? PORTRAIT_URLS.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : PORTRAIT_URLS;

  const handleSelect = useCallback((url) => {
    portraitsProps?.onSelect(url);
    closePortraits();
  }, [portraitsProps, closePortraits]);

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !isValidImageFile(file)) return;
    const reader = new FileReader();
    reader.onload = () => handleSelect(reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <Modal onClose={closePortraits} overlayClass="config-overlay">
      <div className="portraits-panel" onClick={e => e.stopPropagation()}>
        <div className="portraits-grid-wrap">
          <div className="portraits-grid">
            {filtered.map(p => (
              <PortraitFrame key={p.url} url={p.url} name={p.name} query={query.trim()} onSelect={handleSelect} />
            ))}
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
          <button
            className="ctrl portraits-file-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            FILE
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
        </div>
      </div>
    </Modal>
  );
}

function highlight(name, query) {
  if (!query) return name;
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <span style={{ color: 'var(--highlight)' }}>{name.slice(idx, idx + query.length)}</span>
      {name.slice(idx + query.length)}
    </>
  );
}

function PortraitFrame({ url, name, query, onSelect }) {
  const [phase, setPhase] = useState(null); // null | 'lit' | 'decay'
  const timerRef          = useRef(null);
  const rafRef            = useRef(null);

  const handleClick = () => {
    clearTimeout(timerRef.current);
    cancelAnimationFrame(rafRef.current);
    setPhase('lit');
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setPhase('decay'));
    });
    timerRef.current = setTimeout(() => {
      setPhase(null);
      onSelect(url);
    }, 200);
  };

  const cls = phase === 'lit'   ? ' portrait-frame--lit'
            : phase === 'decay' ? ' portrait-frame--lit portrait-frame--decay'
            : '';

  return (
    <div
      className={`portrait-frame${cls}`}
      onClick={handleClick}
      style={{ backgroundImage: `url("${url}")` }}
    >
      <span className="portrait-caption">{highlight(name, query)}</span>
    </div>
  );
}
