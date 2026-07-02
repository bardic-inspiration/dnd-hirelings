import { truncateMiddle } from '../logic/truncation.js';
import { TRUNCATION_CONFIG } from '../constants/truncation.js';
import Tooltip from './Tooltip.jsx';

/**
 * Generic truncating text span — the plain-string counterpart to `TagLabel`
 * for non-tag display text (task names in chips, item names). Applies a
 * middle ellipsis via `truncateMiddle` and wraps the result in the standard
 * Tooltip carrying the full text when truncated. Both behaviors are ON by
 * default; opt out per prop.
 *
 * @param {object} props
 * @param {string} props.text - Full display text
 * @param {number} [props.maxChars] - Character budget (from `useCharBudget`);
 *   omitted = the `text` component's `fallbackChars` from `config/truncation.yml`
 * @param {boolean} [props.truncate=true] - Truncation toggle
 * @param {boolean} [props.tooltip=true] - Tooltip-when-truncated toggle
 * @param {string} [props.className] - Extra classes for the span
 * @returns {JSX.Element}
 */
export default function TruncatedText({ text, maxChars, truncate = true, tooltip = true, className }) {
  const budget = truncate ? (maxChars ?? TRUNCATION_CONFIG.charBudget.components.text.fallbackChars) : Infinity;
  const { text: display, truncated } = truncateMiddle(text, budget);
  const classes = ['truncated-text', truncated && 'truncated-text--truncated', className]
    .filter(Boolean)
    .join(' ');

  return (
    <Tooltip content={text} disabled={!(tooltip && truncated)}>
      <span className={classes}>{display}</span>
    </Tooltip>
  );
}
