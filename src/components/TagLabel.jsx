import { Fragment } from 'react';
import { parseTag } from '../logic/tags.js';
import { truncateTagParts } from '../logic/truncation.js';
import { TRUNCATION_CONFIG } from '../constants/truncation.js';
import Tooltip from './Tooltip.jsx';

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
 * @param {object} props
 * @param {string} props.tag - Raw tag string (parsed internally via `parseTag`)
 * @param {number} [props.maxChars] - Character budget (from `useCharBudget`);
 *   omitted = the variant's `fallbackChars` from `config/truncation.yml`
 * @param {'chip'|'row'} [props.variant='chip'] - Display style (`TAG_LABEL_VARIANTS`)
 * @param {boolean} [props.truncate=true] - Structural truncation toggle
 * @param {boolean} [props.tooltip=true] - Tooltip-on-difference toggle
 * @param {boolean} [props.shorthand=true] - Number shorthand on the value
 * @returns {JSX.Element}
 */
export default function TagLabel({ tag, maxChars, variant = 'chip', truncate = true, tooltip = true, shorthand = true }) {
  const fallbackChars = TRUNCATION_CONFIG.charBudget.components[variant === 'row' ? 'tag-row' : 'tag-chip'].fallbackChars;
  const budget = truncate ? (maxChars ?? fallbackChars) : Infinity;
  const { parts, truncated, valueShortened } = truncateTagParts(parseTag(tag), budget, { variant, shorthand });

  // Split off the value (and its separator) so each variant can keep its
  // existing markup: chips put "=value" in .tag-value, rows embolden the path.
  const valueIndex = parts.findIndex(part => part.kind === 'value' || part.placeholder === 'value');
  const pathParts = valueIndex === -1 ? parts : parts.slice(0, valueIndex - 1);
  const valueParts = valueIndex === -1 ? [] : parts.slice(valueIndex - 1);

  const renderParts = (list) => list.map((part, i) => part.kind === 'placeholder'
    ? <span key={i} className="tag-string-placeholder">{part.text}</span>
    : <Fragment key={i}>{part.text}</Fragment>);

  const differs = truncated || valueShortened;
  const label = (
    <span className={`tag-string${differs ? ' tag-string--truncated' : ''}`}>
      {variant === 'row' ? <strong>{renderParts(pathParts)}</strong> : renderParts(pathParts)}
      {valueParts.length > 0 && (
        variant === 'row'
          ? renderParts(valueParts)
          : <span className="tag-value">{renderParts(valueParts)}</span>
      )}
    </span>
  );

  return <Tooltip content={tag} disabled={!(tooltip && differs)}>{label}</Tooltip>;
}
