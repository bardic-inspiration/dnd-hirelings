// Permission layer: action predicates and dispatch gating for multiplayer roles
// and modes (GM, player, spectator).

/**
 * Action types permitted when the active client is in `player` mode.
 * Actions outside this set are silently dropped by the dispatch gate.
 * Excludes `TASK_CONDITION_UPDATE` and `TASK_SET_COMPLETE` to ensure turn
 * progress is logged and rollbackable.
 *
 * @type {Set<string>}
 */
export const PLAYER_ALLOWED_ACTIONS = new Set([
  'APPLY_TICK',
  'APPLY_ROLLBACK',
  'AGENT_ADD_ACTIVITY',
  'AGENT_REMOVE_ACTIVITY',
  'AGENT_BIND_ITEM',
  'AGENT_UNBIND_ITEM',
  'AGENT_RETURN_ITEM',
  'ITEM_PLACE',
  'SESSION_UPDATE',
  'DYN_RECONCILE',
]);

/**
 * Payload keys permitted on `SESSION_UPDATE` actions when in `player` mode.
 * Any other session keys (such as `bank`, `title`, or `clock`) are GM-only.
 *
 * @type {Set<string>}
 */
export const PLAYER_SESSION_KEYS = new Set([
  'timeStep',
  'stepBack',
  'rateMultiplier',
]);

/**
 * Action types permitted when the active client is in `spectator` mode.
 * Spectators can only run derived reconciliation to keep local dynamic tags
 * consistent with received board state.
 *
 * @type {Set<string>}
 */
export const SPECTATOR_ALLOWED_ACTIONS = new Set([
  'DYN_RECONCILE',
]);

/**
 * Determines whether a reducer action is permitted in the given permission mode.
 *
 * Mode rules:
 * - `gm`: always allowed (returns `true` for any valid action object).
 * - `player`: allowed if `action.type` is in `PLAYER_ALLOWED_ACTIONS`, and for
 *   `SESSION_UPDATE` every key in `action.payload` is in `PLAYER_SESSION_KEYS`.
 * - `spectator`: allowed if `action.type` is in `SPECTATOR_ALLOWED_ACTIONS`.
 * - unknown or missing mode: always rejected (returns `false`).
 *
 * @param {string} mode Active permission mode (`gm`, `player`, `spectator`).
 * @param {object} action Redux-style reducer action `{ type, ... }`.
 * @returns {boolean} `true` if the action is permitted in this mode.
 */
export function isActionAllowed(mode, action) {
  if (!action || typeof action !== 'object') {
    return false;
  }
  if (mode === 'gm') {
    return true;
  }
  if (mode === 'player') {
    if (!PLAYER_ALLOWED_ACTIONS.has(action.type)) {
      return false;
    }
    if (action.type === 'SESSION_UPDATE') {
      const payload = action.payload ?? {};
      if (typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
      }
      const keys = Object.keys(payload);
      return keys.every((key) => PLAYER_SESSION_KEYS.has(key));
    }
    return true;
  }
  if (mode === 'spectator') {
    return SPECTATOR_ALLOWED_ACTIONS.has(action.type);
  }
  return false;
}

/**
 * Checks whether the baton indicates it is currently the party's turn.
 *
 * @param {object} baton Current baton document `{ turnOwner, ... }`.
 * @returns {boolean}
 */
function isPartyTurn(baton) {
  return Boolean(baton) && typeof baton === 'object' && baton.turnOwner === 'party';
}

/**
 * Derives the client's active permission mode from its assigned role, the session
 * baton, and whether this client currently holds the pen (write lock).
 *
 * Rules:
 * - Role `gm` is always in `gm` mode.
 * - Any other role is in `player` mode when the party holds the baton AND this
 *   client holds the write lock.
 * - Otherwise (between turns, observing, or unheld), mode is `spectator`.
 *
 * @param {string} role Client role from URL (`gm` or `party`).
 * @param {object} baton Current baton document `{ turnOwner, ... }`.
 * @param {boolean} holdsWriteLock Whether this client holds the active pen token.
 * @returns {'gm'|'player'|'spectator'} The derived permission mode.
 */
export function deriveMode(role, baton, holdsWriteLock) {
  if (role === 'gm') {
    return 'gm';
  }
  if (isPartyTurn(baton) && Boolean(holdsWriteLock)) {
    return 'player';
  }
  return 'spectator';
}

/**
 * Wraps a dispatch function with a permission gate. Actions that are disallowed
 * in the active permission mode are silently dropped without invoking `rawDispatch`.
 *
 * @param {function(object): *} rawDispatch The underlying dispatch function.
 * @param {string|function(): string} getMode Static mode or getter returning the active mode.
 * @returns {function(object): *} Gated dispatch function.
 */
export function gateDispatch(rawDispatch, getMode) {
  return function gatedDispatch(action) {
    const mode = typeof getMode === 'function' ? getMode() : getMode;
    if (isActionAllowed(mode, action)) {
      return rawDispatch(action);
    }
    return undefined;
  };
}
