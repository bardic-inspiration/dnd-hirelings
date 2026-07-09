import { useGame } from '../../state/GameContext.jsx';
import { resolveTagSource } from '../../logic/UI.js';
import { formatCount, formatCountFit } from '../../logic/format.js';
import { useCharBudget } from '../../hooks/useCharBudget.js';
import EditableSpan from '../EditableSpan.jsx';

// Standard configurable card elements. Each one takes a `source` string from
// the UI config plus the per-card resolution `context`
// ({ agent, dynamics, attributes }) and renders one value. An unresolvable
// source renders the element with no value in the `--invalid` state (warning
// flash); a dyn value that evaluated with defaulted references or cycles
// renders its value in the `--warn` state (warn chrome, no flash). The native
// title always exposes the assigned source string.

// Commits an edited display string through a resolution's `set` mapping.
// Non-numeric input is ignored (the span snaps back to the resolved value).
function commitValue(dispatch, agentId, resolution, rawInput) {
  const value = parseFloat(rawInput);
  if (isNaN(value)) return;
  dispatch({ type: 'AGENT_UPDATE', id: agentId, changes: resolution.set(value) });
}

// Three-state element class: base, `--invalid` (no value), or `--warn`
// (value shown, warn chrome). Flat compound naming per element block.
const stateClass = (base, resolution) =>
  `${base}${!resolution.valid ? ` ${base}--invalid` : resolution.warn ? ` ${base}--warn` : ''}`;

/**
 * Square value badge beside the agent name; stays visible when the card is
 * collapsed.
 *
 * @param {object} props
 * @param {string} props.source - UI source string (e.g. `"level"`)
 * @param {object} props.context - Resolution context `{ agent, dynamics, attributes }`
 * @returns {JSX.Element}
 */
export function CardMedallion({ source, context }) {
  const resolution = resolveTagSource(source, context);
  const { ref, maxChars } = useCharBudget('stat-box');
  return (
    <div ref={ref} className={stateClass('medallion', resolution)} title={source}>
      {resolution.valid && formatCountFit(resolution.value, maxChars)}
    </div>
  );
}

/**
 * Square single-value box; boxes sit in rows of four above the bars.
 *
 * @param {object} props
 * @param {string} props.source - UI source string
 * @param {object} props.context - Resolution context `{ agent, dynamics, attributes }`
 * @returns {JSX.Element}
 */
export function StatBox({ source, context }) {
  const resolution = resolveTagSource(source, context);
  const { ref, maxChars } = useCharBudget('stat-box');
  return (
    <div ref={ref} className={stateClass('stat-box', resolution)} title={source}>
      {resolution.valid && formatCountFit(resolution.value, maxChars)}
    </div>
  );
}

/**
 * Ratio bar over a `(current, max)` source tuple, in the standard vital-bar
 * format: fill at `current / max`, centered current value (editable when the
 * source is writable), `/ max` on the right. Invalid tuples show an empty bar
 * in the warning state.
 *
 * @param {object} props
 * @param {string} props.current - Source string for the bar's current value
 * @param {string} props.max - Source string for the bar's maximum value
 * @param {object} props.context - Resolution context `{ agent, dynamics, attributes }`
 * @param {'primary'|'secondary'} props.fillVariant - Fill color variant
 * @returns {JSX.Element} Dispatches `AGENT_UPDATE` on edit of a writable current value
 */
export function StatBar({ current, max, context, fillVariant }) {
  const { dispatch } = useGame();
  const currentRes = resolveTagSource(current, context);
  const maxRes = resolveTagSource(max, context);
  const valid = currentRes.valid && maxRes.valid;
  const warn = currentRes.warn || maxRes.warn;
  const ratio = valid && maxRes.value > 0 ? Math.min(1, Math.max(0, currentRes.value / maxRes.value)) : 0;
  return (
    <div className={stateClass('vital-bar', { valid, warn })} title={`(${current}, ${max})`}>
      {valid && (
        <>
          <div className={`vital-bar-fill vital-bar-fill--${fillVariant}`} style={{ width: `${ratio * 100}%` }} />
          {currentRes.set
            ? <EditableSpan
                className="vital-bar-label"
                value={String(currentRes.value)}
                format={formatCount}
                onCommit={rawInput => commitValue(dispatch, context.agent.id, currentRes, rawInput)}
              />
            : <span className="vital-bar-label">{formatCount(currentRes.value)}</span>}
          <span className="vital-bar-max">/ {formatCount(maxRes.value)}</span>
        </>
      )}
    </div>
  );
}

/**
 * Labelled editable value row (e.g. `RATE 1 gp/day`). Writable sources commit
 * through `AGENT_UPDATE`; a source with a `unitField` also renders its unit as
 * a second editable span. Read-only sources render as plain text.
 *
 * @param {object} props
 * @param {string} props.source - UI source string
 * @param {object} props.context - Resolution context `{ agent, dynamics, attributes }`
 * @returns {JSX.Element} Dispatches `AGENT_UPDATE` on edits
 */
export function StatField({ source, context }) {
  const { dispatch } = useGame();
  const resolution = resolveTagSource(source, context);
  return (
    <div className={stateClass('stat-field', resolution)} title={source}>
      <span className="stat-field-label">{resolution.label}</span>
      {resolution.valid && (resolution.set
        ? <EditableSpan
            className="value"
            value={String(resolution.value)}
            format={formatCount}
            onCommit={rawInput => commitValue(dispatch, context.agent.id, resolution, rawInput)}
          />
        : <span className="value">{formatCount(resolution.value)}</span>)}
      {resolution.unitField && (
        <EditableSpan
          className="unit"
          value={context.agent[resolution.unitField]}
          onCommit={unit => dispatch({ type: 'AGENT_UPDATE', id: context.agent.id, changes: { [resolution.unitField]: unit } })}
        />
      )}
    </div>
  );
}

/**
 * Read-only `LABEL: value` entry; the label is the source's last path segment
 * (e.g. `"ac"` → `AC: 12`).
 *
 * @param {object} props
 * @param {string} props.source - UI source string
 * @param {object} props.context - Resolution context `{ agent, dynamics, attributes }`
 * @returns {JSX.Element}
 */
export function StatValue({ source, context }) {
  const resolution = resolveTagSource(source, context);
  return (
    <span className={stateClass('stat-value', resolution)} title={source}>
      {resolution.label}: {resolution.valid && formatCount(resolution.value)}
    </span>
  );
}
