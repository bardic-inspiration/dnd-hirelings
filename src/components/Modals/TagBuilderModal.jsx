import { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { buildTag, MODIFIER_REGISTRY } from '../../logic/tags.js';

const PRESETS = {
  attribute: [
    { label: 'Skill',  prefix: '',    path: 'skill',       hasValue: true  },
    { label: 'Trait',  prefix: '',    path: 'trait',       hasValue: false },
    { label: 'Class',  prefix: '',    path: 'class',       hasValue: false },
    { label: 'Race',   prefix: '',    path: 'race',        hasValue: false },
    { label: 'Level',  prefix: '',    path: 'level',       hasValue: true  },
  ],
  requirement: [
    { label: 'Skill',        prefix: 'req',   path: 'skill',  hasValue: true  },
    { label: 'Tool',         prefix: 'req',   path: 'tool',   hasValue: false },
    { label: 'Trait',        prefix: 'req',   path: 'trait',  hasValue: false },
    { label: 'Class',        prefix: 'req',   path: 'class',  hasValue: false },
    { label: 'Race',         prefix: 'req',   path: 'race',   hasValue: false },
    { label: 'Item',         prefix: 'req',   path: 'item',   hasValue: true  },
    { label: 'Block Trait',  prefix: 'block', path: 'trait',  hasValue: false },
    { label: 'Block Class',  prefix: 'block', path: 'class',  hasValue: false },
    { label: 'Block Race',   prefix: 'block', path: 'race',   hasValue: false },
    { label: 'Block Skill',  prefix: 'block', path: 'skill',  hasValue: false },
  ],
  work: [
    { label: 'General', prefix: '',     path: 'work',  hasValue: true },
    { label: 'Skill',   prefix: 'work', path: 'skill', hasValue: true },
  ],
};

export default function TagBuilderModal({ context, onSave, onClose }) {
  const presets = (() => {
    if (context === 'requirement') return PRESETS.requirement;
    if (context === 'work')        return PRESETS.work;
    if (context === 'task')        return [...PRESETS.requirement, ...PRESETS.work];
    return PRESETS.attribute;
  })();

  const title = context === 'attribute' ? 'NEW ATTRIBUTE'
    : context === 'work'               ? 'ADD WORK'
    : 'ADD TAG';

  const defaultPreset = presets[0];

  const [presetIndex, setPresetIndex] = useState(0);
  const [prefixVal,  setPrefixVal]  = useState(defaultPreset?.prefix ?? '');
  const [pathVal,    setPathVal]    = useState(defaultPreset?.path   ?? '');
  const [nameVal,    setNameVal]    = useState('');
  const [valueVal,   setValueVal]   = useState('');
  const [pathError,  setPathError]  = useState(false);

  const presetRef = useRef(null);

  function buildCurrentTag() {
    const prefix = prefixVal.trim();
    const path   = pathVal.trim();
    if (!path) return null;
    const isModifier = !!MODIFIER_REGISTRY[prefix.toLowerCase()];
    const pathSegs = [
      ...(isModifier ? [] : prefix.split(':').filter(Boolean)),
      ...path.split(':').filter(Boolean),
    ];
    const name = nameVal.trim();
    if (name) pathSegs.push(name);
    return buildTag(pathSegs, valueVal.trim() || null, isModifier ? prefix : null);
  }

  const preview = buildCurrentTag() ?? '—';

  function applyPreset(preset) {
    setPrefixVal(preset?.prefix ?? '');
    setPathVal(preset?.path   ?? '');
    setNameVal('');
    setValueVal('');
    setPathError(false);
  }

  useEffect(() => { applyPreset(defaultPreset); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { presetRef.current?.focus(); }, []);

  function handlePresetChange(e) {
    const index = Number(e.target.value);
    setPresetIndex(index);
    applyPreset(index === -1 ? null : presets[index]);
  }

  function save() {
    const tag = buildCurrentTag();
    if (!tag) { setPathError(true); return; }
    onSave(tag);
    onClose();
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <Modal onClose={onClose} overlayClass="tag-builder-overlay">
      <div className="tag-builder-card" onClick={e => e.stopPropagation()}>
        <div className="tag-builder-title">{title}</div>
        <div className="tag-builder-fields">

          <div className="tag-builder-row">
            <label className="tag-builder-label">PRESET</label>
            <select ref={presetRef} className="tag-builder-field" value={presetIndex} onChange={handlePresetChange} onKeyDown={onKeyDown}>
              <option value={-1}>— custom —</option>
              {presets.map((preset, index) => (
                <option key={index} value={index}>{preset.label}</option>
              ))}
            </select>
          </div>

          <div className="tag-builder-row">
            <label className="tag-builder-label">PREFIX</label>
            <input
              className="tag-builder-field"
              placeholder="optional"
              spellCheck={false}
              value={prefixVal}
              onChange={e => setPrefixVal(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="tag-builder-row">
            <label className="tag-builder-label">PATH</label>
            <input
              className={`tag-builder-field${pathError ? ' error' : ''}`}
              placeholder="e.g. skill"
              spellCheck={false}
              value={pathVal}
              onChange={e => { setPathVal(e.target.value); setPathError(false); }}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="tag-builder-row">
            <label className="tag-builder-label">NAME</label>
            <input
              className="tag-builder-field"
              placeholder="optional"
              spellCheck={false}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="tag-builder-row">
            <label className="tag-builder-label">VALUE</label>
            <input
              className="tag-builder-field"
              placeholder="optional"
              spellCheck={false}
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
