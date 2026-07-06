// A library "order" — the shopping-list payload the library modal assembles from
// its selected rows and submits in one shot (issue #92). The document is kept
// transport-agnostic on purpose: `submitOrder` expands it into reducer dispatches
// today, but the same `{ type, lines }` shape is serializable and could be POSTed
// to a server backend unchanged. Each line carries a full preset snapshot (not an
// id), so an endpoint needs no shared preset store to interpret the order — it
// resembles the preset files the library already reads and writes.

/** Drop runtime library bookkeeping so a line carries only communicable preset data. */
const linePreset = ({ id, source, ...fields }) => fields;

/**
 * Builds an order document from candidate cart lines, keeping only rows the user
 * actually ordered. Quantities are floored to whole copies and non-positive lines
 * are dropped, so the result is always ready to submit or serialize.
 *
 * @param {string} type - Library type: `'agent'` | `'task'` | `'item'`
 * @param {{ preset: object, quantity: number }[]} lines - One entry per candidate row
 * @returns {{ type: string, lines: { preset: object, quantity: number }[] }}
 */
export function buildOrder(type, lines) {
  return {
    type,
    lines: lines
      .map(line => ({ preset: linePreset(line.preset), quantity: Math.floor(line.quantity) }))
      .filter(line => line.quantity > 0),
  };
}

/**
 * Delivers an order to the game via `dispatch`, one create action per line (the
 * action carries the line's `quantity` as its copy count). This is the sole
 * coupling between the order document and the reducer; retargeting the order to a
 * network endpoint later means replacing only this function.
 *
 * @param {{ lines: { preset: object, quantity: number }[] }} order - From `buildOrder`
 * @param {(action: object) => void} dispatch - Game store dispatch
 * @param {{ toCreateAction: (preset: object, count: number) => object }} config -
 *   The order's library config, supplying the per-type create action
 * @param {object} [options] - Dispatch-time policy fields spread onto every
 *   create action (today: `{ locked }` from the tags config). Policy is not
 *   order content, so the order document stays transport-agnostic.
 * @returns {number} How many lines were submitted
 */
export function submitOrder(order, dispatch, config, options = {}) {
  for (const line of order.lines) {
    dispatch({ ...config.toCreateAction(line.preset, line.quantity), ...options });
  }
  return order.lines.length;
}
