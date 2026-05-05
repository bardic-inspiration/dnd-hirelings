import { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { TAG_SCHEMA, buildTag, getSchemaByContext } from '../../logic/tags.js';

export default function TagBuilderModal({ context, onSave, onClose }) {
  const isTask = context === 'task';

  const defaultKey = isTask
    ? Object.keys(TAG_SCHEMA).find(k => TAG_SCHEMA[k].context !== 'attribute')
    : Object.keys(TAG_SCHEMA).find(k => TAG_SCHEMA[k].context === 'attribute');

  const [presetKey,  setPresetKey]  = useState(defaultKey ?? '');
  const [typeVal,    setTypeVal]    = useState('');
  const [nameVal,    setNameVal]    = useState('');
  const [valueVal,   setValueVal]   = useState('');
  const [reqActive,  setReqActive]  = useState(false);
  const [nameLabel,  setNameLabel]  = useState('NAME');
  const [valueLabel, setValueLabel] = useState('VALUE');
  const [namePlaceholder,  setNamePlaceholder]  = useState('optional');
  const [valuePlaceholder, setValuePlaceholder] = useState('optional');
  const [typeError,  setTypeError]  = useState(false);

  const presetRef = useRef(null);

  const preview = typeVal.trim()
    ? (buildTag(typeVal.trim(), nameVal.trim() || null, valueVal.trim() ? parseFloat(valueVal) : null, reqActive) ?? `#${reqActive ? 'req:' : ''}${typeVal.trim()}`)
    : '—';

  function applyPreset(key) {
    const entry = key ? TAG_SCHEMA[key] : null;
    if (entry) {
      setTypeVal(entry.type);
      setReqActive(entry.isReq);
      setNameLabel(entry.nameLabel  ?? 'NAME');
      setValueLabel(entry.valueLabel ?? 'VALUE');
      setNameVal(entry.nameFixed ?? '');
      setNamePlaceholder(entry.hasName  ? 'name'   : 'optional');
      setValuePlaceholder(entry.hasValue ? 'amount' : 'optional');
    } else {
      setTypeVal(''); setReqActive(false);
      setNameLabel('NAME'); setValueLabel('VALUE');
      setNameVal(''); setNamePlaceholder('optional'); setValuePlaceholder('optional');
    }
    setValueVal('');
    setTypeError(false);
  }

  useEffect(() => { applyPreset(defaultKey ?? ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { presetRef.current?.focus(); }, []);

  function handlePresetChange(e) {
    const key = e.target.value;
    setPresetKey(key);
    applyPreset(key);
  }

  function save() {
    if (!typeVal.trim()) { setTypeError(true); return; }
    const name = nameVal.trim() || null;
    const val  = valueVal.trim() ? parseFloat(valueVal) : null;
    onSave(buildTag(typeVal.trim(), name, val, reqActive) ?? `#${reqActive ? 'req:' : ''}${typeVal.trim()}`);
    onClose();
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const taskContexts = isTask
    ? [...new Set(Object.values(TAG_SCHEMA).filter(e => e.context !== 'attribute').map(e => e.context))]
    : [];

  return (
    <Modal onClose={onClose} overlayClass="tag-builder-overlay">
      <div className="tag-builder-card" onClick={e => e.stopPropagation()}>
        <div className="tag-builder-title">{isTask ? 'ADD TAG' : 'NEW ATTRIBUTE'}</div>
        <div className="tag-builder-fields">

          <div className="tag-builder-row">
            <label className="tag-builder-label">PRESET</label>
            <select ref={presetRef} className="tag-builder-field" value={presetKey} onChange={handlePresetChange} onKeyDown={onKeyDown}>
              <option value="">— custom —</option>
              {isTask ? taskContexts.map(ctx => (
                <optgroup key={ctx} label={ctx.toUpperCase()}>
                  {getSchemaByContext(ctx).map(([key, entry]) => (
                    <option key={key} value={key}>{entry.label}</option>
                  ))}
                </optgroup>
              )) : (
                <optgroup label="ATTRIBUTE">
                  {getSchemaByContext('attribute').map(([key, entry]) => (
                    <option key={key} value={key}>{entry.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="tag-builder-row">
            <label className="tag-builder-label">TYPE</label>
            <button
              className={`ctrl tag-builder-req-btn${reqActive ? ' active' : ''}`}
              title="Prepend req: prefix"
              onClick={e => { e.preventDefault(); setReqActive(v => !v); }}
            >REQ</button>
            <input
              className={`tag-builder-field${typeError ? ' error' : ''}`}
              placeholder="type"
              spellCheck={false}
              value={typeVal}
              onChange={e => { setTypeVal(e.target.value); setTypeError(false); }}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="tag-builder-row">
            <label className="tag-builder-label">{nameLabel}</label>
            <input
              className="tag-builder-field"
              placeholder={namePlaceholder}
              spellCheck={false}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="tag-builder-row">
            <label className="tag-builder-label">{valueLabel}</label>
            <input
              className="tag-builder-field"
              type="number"
              placeholder={valuePlaceholder}
              step="any"
              value={valueVal}
              onChange={e => setValueVal(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="tag-builder-row">
            <label className="tag-builder-label">TAG</label>
            <div className="tag-builder-preview">{preview}</div>
          </div>
        </div>

        <div className="tag-builder-buttons">
          <button className="ctrl" onClick={onClose}>CANCEL</button>
          <button className="ctrl" onClick={save}>SAVE</button>
        </div>
      </div>
    </Modal>
  );
}
