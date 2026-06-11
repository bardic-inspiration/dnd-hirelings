import { useState, useRef, useCallback } from 'react';
import Modal from './Modal.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { PORTRAIT_URLS, isValidImageFile } from '../../constants/portraits.js';
import { useAssetGroup } from '../../hooks/useAssetGroup.js';
import { highlight } from '../../logic/text.jsx';

export default function PortraitsModal() {
  const { portraitsProps, closePortraits } = useUI();
  const [query, setQuery]                 = useState('');
  const fileInputRef                      = useRef(null);
  const { readySet }                      = useAssetGroup(PORTRAIT_URLS.map(p => p.url));

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
              <PortraitFrame
                key={p.url}
                url={p.url}
                name={p.name}
                query={query.trim()}
                ready={readySet.has(p.url)}
                onSelect={handleSelect}
              />
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

function PortraitFrame({ url, name, query, ready, onSelect }) {
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
  const loadingCls = ready ? '' : ' portrait-frame--loading';

  return (
    <div
      className={`portrait-frame${cls}${loadingCls}`}
      onClick={handleClick}
      style={ready ? { backgroundImage: `url("${url}")` } : undefined}
    >
      <span className="portrait-caption">{highlight(name, query)}</span>
    </div>
  );
}
