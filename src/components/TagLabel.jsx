import { Fragment, useState } from 'react';
import { parseTag, buildTag } from '../logic/tags.js';
import { truncateTagParts } from '../logic/truncation.js';
import { TRUNCATION_CONFIG } from '../constants/truncation.js';
import Tooltip from './Tooltip.jsx';

/**
 * Inline editor for a tag's scalar value. Autofocuses, sizes to its content,
 * commits on Enter/blur, cancels on Escape, and stops click/dblclick from
 * bubbling to the card or the tag's replace handler.
 *
 * @param {object} props
 * @param {string} props.initial - Raw value to seed the field with
 * @param {(raw: string) => void} props.onCommit - Called with the edited text
 * @param {() => void} props.onCancel - Called on Escape (no commit)
 * @returns {JSX.Element}
 */
function TagValueInput({ initial, onCommit, onCancel }) {
  const [text, setText] = useState(initial);
  return (
    <input
      className="tag-value-input mono"
      type="text"
      autoFocus
      size={Math.max(1, text.length)}
      value={text}
      spellCheck={false}
      onChange={event => setText(event.target.value)}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); onCommit(text); }
        else if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
      }}
      onBlur={() => onCommit(text)}
    />
  );
}

/**
 * Canonical tag display. Runs a tag string through the structural truncation
 * ladder (`logic/truncation.js`) and renders the typed parts, wrapping them
 * in the standard Tooltip (full raw tag) whenever the display differs from
 * the data — structural collapse or number shorthand. Truncation, tooltip,
 * and shorthand are ON by default; components opt out per prop.
 *
 * The parent owns the surrounding chrome (`.tag` chip / `.tag-content` row,
 * active states, remove button); this renders only the label span, so the
 * tooltip triggers on the label rather than its controls.
 *
 * Editing (issue #75) is opt-in via callbacks — the tag *string* is never
 * directly editable, only its value:
 * - `onValueCommit`: single-clicking the value swaps it for an inline editor;
 *   a value that round-trips cleanly (non-empty, doesn't corrupt the grammar)
 *   commits, anything else is discarded ("invalid value → no change").
 * - `onReplace`: double-clicking the tag string fires it (host opens the Tag
 *   Registry to pick a replacement). Double-clicking the value edits instead.
 *
 * @param {object} props
 * @param {string} props.tag - Raw tag string (parsed internally via `parseTag`)
 * @param {number} [props.maxChars] - Character budget (from `useCharBudget`);
 *   omitted = the variant's `fallbackChars` from `config/truncation.yml`
 * @param {'chip'|'row'} [props.variant='chip'] - Display style (`TAG_LABEL_VARIANTS`)
 * @param {boolean} [props.truncate=true] - Structural truncation toggle
 * @param {boolean} [props.tooltip=true] - Tooltip-on-difference toggle
 * @param {boolean} [props.shorthand=true] - Number shorthand on the value
 * @param {(value: string) => void} [props.onValueCommit] - Commit an edited value
 * @param {() => void} [props.onReplace] - Open a replacement picker for the whole tag
 * @returns {JSX.Element}
 */
export default function TagLabel({ tag, maxChars, variant = 'chip', truncate = true, tooltip = true, shorthand = true, onValueCommit, onReplace }) {
  const [editing, setEditing] = useState(false);
  const parsed = parseTag(tag);
  const fallbackChars = TRUNCATION_CONFIG.charBudget.components[variant === 'row' ? 'tag-row' : 'tag-chip'].fallbackChars;
  const budget = truncate ? (maxChars ?? fallbackChars) : Infinity;
  const { parts, truncated, valueShortened } = truncateTagParts(parsed, budget, { variant, shorthand });

  // Split off the value (and its separator) so each variant can keep its
  // existing markup: chips put "=value" in .tag-value, rows embolden the path.
  const valueIndex = parts.findIndex(part => part.kind === 'value' || part.placeholder === 'value');
  const pathParts = valueIndex === -1 ? parts : parts.slice(0, valueIndex - 1);
  const valueParts = valueIndex === -1 ? [] : parts.slice(valueIndex - 1);

  const renderParts = (list) => list.map((part, i) => part.kind === 'placeholder'
    ? <span key={i} className="tag-string-placeholder">{part.text}</span>
    : <Fragment key={i}>{part.text}</Fragment>);

  const canEditValue = typeof onValueCommit === 'function' && parsed.value !== null;

  // Accept the edit only if it round-trips through the tag grammar unchanged
  // apart from the value — this rejects empty input and values that would
  // corrupt the tag (e.g. a comma, which parseTag reads as a modifier).
  const commitValue = (raw) => {
    setEditing(false);
    const next = raw.trim();
    if (next === '' || next === String(parsed.value)) return;
    const reparsed = parseTag(buildTag(parsed.segments, next, parsed.modifier));
    const clean = reparsed.value === next
      && reparsed.segments.join(':') === parsed.segments.join(':')
      && reparsed.modifier === parsed.modifier;
    if (clean) onValueCommit(next);
  };

  const startEdit = (event) => {
    if (!canEditValue || editing) return;
    event.stopPropagation();
    setEditing(true);
  };

  const handleReplace = onReplace
    ? (event) => { event.stopPropagation(); onReplace(); }
    : undefined;

  const valueContent = editing
    ? <><span className="tag-value-eq">=</span><TagValueInput initial={String(parsed.value)} onCommit={commitValue} onCancel={() => setEditing(false)} /></>
    : renderParts(valueParts);

  // The value gets its own click target (edit) and swallows dblclick so a
  // double-click there never also triggers the tag's replace handler.
  const valueNode = valueParts.length > 0 && (
    <span
      className={`${variant === 'row' ? '' : 'tag-value '}${canEditValue ? 'tag-value--editable' : ''}`.trim() || undefined}
      onClick={canEditValue ? startEdit : undefined}
      onDoubleClick={canEditValue ? (event => event.stopPropagation()) : undefined}
    >
      {valueContent}
    </span>
  );

  const differs = truncated || valueShortened;
  const label = (
    <span
      className={`tag-string${differs ? ' tag-string--truncated' : ''}`}
      onDoubleClick={handleReplace}
    >
      {variant === 'row' ? <strong>{renderParts(pathParts)}</strong> : renderParts(pathParts)}
      {valueNode}
    </span>
  );

  return <Tooltip content={tag} disabled={editing || !(tooltip && differs)}>{label}</Tooltip>;
}
