import { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { createConditionTemplate, defaultConditionName } from '../../logic/conditions.js';
import { parsePattern, formatPatternLabel } from '../../logic/tagMatching.js';

// Each preset prefills the TAG LINK field; the pattern stays editable, so the
// `*` in 'skill:*' can be replaced with a specific name ('skill:arcana') or
// widened to '**' for a whole subtree.
const PRESETS = [
  { label: 'General (any agent)', tagPath: ''        },
  { label: 'Any skill',           tagPath: 'skill:*' },
  { label: 'Any tool',            tagPath: 'tool:*'  },
  { label: 'Any trait',           tagPath: 'trait:*' },
];

/**
 * Modal form for authoring a condition template: a tag-link pattern, a display
 * name, and a required positive target. Mirrors the TagBuilderModal shell but
 * outputs a structured `ConditionTemplate` object, not a tag string.
 *
 * The tag link accepts the full pattern grammar from `logic/tagMatching.js`
 * (`*` one-segment pass, `**` any run, `\*` literal asterisk); when the
 * pattern contains wildcards or escapes, the preview shows the engine's
 * interpretation (`skill:‹any›`) instead of the raw text.
 *
 * @param {{ onSave: (template: ConditionTemplate) => void, onClose: () => void }} props
 * Side effects: calls `onSave` with the sanitized template, then `onClose`.
 */
export default function ConditionBuilderModal({ onSave, onClose }) {
  const [presetIndex, setPresetIndex] = useState(0);
  const [pathVal,     setPathVal]     = useState(PRESETS[0].tagPath);
  const [nameVal,     setNameVal]     = useState('');
  const [targetVal,   setTargetVal]   = useState('');
  const [targetError, setTargetError] = useState(false);

  const presetRef = useRef(null);
  useEffect(() => { presetRef.current?.focus(); }, []);

  const tagPath = pathVal.trim().toLowerCase() || null;
  const namePlaceholder = defaultConditionName(tagPath);

  function buildCurrentTemplate() {
    const target = parseFloat(targetVal);
    if (!Number.isFinite(target) || target <= 0) return null;
    return createConditionTemplate({ name: nameVal, target, tagPath });
  }

  // Show the raw pattern unless it carries wildcards or escapes — then show the
  // engine's interpretation so the player sees what will actually match.
  const linkLabel = (() => {
    if (!tagPath) return 'any agent';
    const interpreted = formatPatternLabel(tagPath);
    const isPlainPath = parsePattern(tagPath).every(part => part.kind === 'literal') && interpreted === tagPath;
    return isPlainPath ? tagPath : interpreted;
  })();

  const preview = `${nameVal.trim() || namePlaceholder} =${targetVal.trim() || '?'} ← ${linkLabel}`;

  function handlePresetChange(e) {
    const index = Number(e.target.value);
    setPresetIndex(index);
    setPathVal(index === -1 ? '' : PRESETS[index].tagPath);
    setNameVal('');
    setTargetError(false);
  }

  function save() {
    const template = buildCurrentTemplate();
    if (!template) { setTargetError(true); return; }
    onSave(template);
    onClose();
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <Modal onClose={onClose} overlayClass="condition-builder-overlay">
      <div className="condition-builder-card" onClick={e => e.stopPropagation()}>
        <div className="condition-builder-title">NEW CONDITION</div>
        <div className="condition-builder-fields">

          <div className="condition-builder-row">
            <label className="condition-builder-label">PRESET</label>
            <select ref={presetRef} className="condition-builder-field" value={presetIndex} onChange={handlePresetChange} onKeyDown={onKeyDown}>
              <option value={-1}>— custom —</option>
              {PRESETS.map((preset, index) => (
                <option key={index} value={index}>{preset.label}</option>
              ))}
            </select>
          </div>

          <div className="condition-builder-row">
            <label className="condition-builder-label">TAG LINK</label>
            <input
              className="condition-builder-field"
              placeholder="skill:arcana · skill:* · empty = any agent"
              spellCheck={false}
              value={pathVal}
              onChange={e => setPathVal(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="condition-builder-row">
            <label className="condition-builder-label">NAME</label>
            <input
              className="condition-builder-field"
              placeholder={namePlaceholder}
              spellCheck={false}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="condition-builder-row">
            <label className="condition-builder-label">TARGET</label>
            <input
              className={`condition-builder-field${targetError ? ' condition-builder-field--error' : ''}`}
              placeholder="required, > 0"
              spellCheck={false}
              value={targetVal}
              onChange={e => { setTargetVal(e.target.value); setTargetError(false); }}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="condition-builder-row">
            <label className="condition-builder-label">PREVIEW</label>
            <div className="condition-builder-preview">{preview}</div>
          </div>
        </div>

        <div className="condition-builder-buttons">
          <button className="ctrl" onClick={onClose}>CANCEL</button>
          <button className="ctrl" onClick={save}>SAVE</button>
        </div>
      </div>
    </Modal>
  );
}
