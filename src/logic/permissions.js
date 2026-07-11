// Permission layer for GM/Player mode (see docs/specs/gm-player-mode.md). Two
// orthogonal axes govern a networked session; this module owns the first: a pure
// predicate `isActionAllowed(mode, action)` applied to every dispatched action.
//
// Registry-style data + a thin function, matching the TRACKER_REGISTRY /
// MATCH_MODE_REGISTRY idiom: the allow-sets are declarative tables and the
// predicate is a lookup with graceful fallback (unknown mode → deny).
//
// The predicate is shared verbatim by the dispatch gate (the backstop) and every
// UI affordance check (the pre-check), so the two can never disagree — the same
// generalization the `unregisteredEntityTags` create-block relies on.

/**
 * Action types a `player` (the turn-holding party) may dispatch: the ticks,
 * the party-facing agent/item/clock edits, and dynamic reconciliation. `SESSION_UPDATE`
 * is additionally key-gated (see `PLAYER_SESSION_KEYS`).
 *
 * `TASK_CONDITION_UPDATE` and `TASK_SET_COMPLETE` are deliberately absent: both
 * write task progress outside `advanceTime` — unlogged and unrollbackable — so
 * allowing them would make async review dishonest.
 *
 * @type {Set<string>}
 */
export const PLAYER_ALLOWED_ACTIONS = new Set([
  'APPLY_TICK', 'APPLY_ROLLBACK',
  'AGENT_ADD_ACTIVITY', 'AGENT_REMOVE_ACTIVITY',
  'AGENT_BIND_ITEM', 'AGENT_UNBIND_ITEM', 'AGENT_RETURN_ITEM',
  'ITEM_PLACE',
  'SESSION_UPDATE',        // per-key, see PLAYER_SESSION_KEYS
  'DYN_RECONCILE',
]);

/**
 * `session` keys a `player` may write via `SESSION_UPDATE` — the clock-pacing
 * numbers only. `clock` is GM-only (the editable Year/Day spans set it directly,
 * bypassing ticks/log/snapshots, which would falsify the review timeline);
 * `title`/`id`/`bank`/`workRate`/`skillBonus` are GM identity/economy.
 *
 * @type {Set<string>}
 */
export const PLAYER_SESSION_KEYS = new Set(['timeStep', 'stepBack', 'rateMultiplier']);

/**
 * Action types a `spectator` may dispatch: derived reconciliation only. A
 * spectator's board is a pure projection of pulled HEAD/snapshots, but dynamic
 * tags are recomputed locally (rules live outside game state), so `DYN_RECONCILE`
 * stays open.
 *
 * @type {Set<string>}
 */
export const SPECTATOR_ALLOWED_ACTIONS = new Set(['DYN_RECONCILE']);

/**
 * Pure predicate: may `mode` dispatch `action`? Shared verbatim by the dispatch
 * gate and every UI affordance check, so pre-check and backstop cannot disagree.
 *
 * - `gm` → always `true`.
 * - `player` → type in `PLAYER_ALLOWED_ACTIONS`; for `SESSION_UPDATE` every key
 *   of `action.payload` must additionally be in `PLAYER_SESSION_KEYS`.
 * - `spectator` → type in `SPECTATOR_ALLOWED_ACTIONS`.
 * - Unknown mode → `false` (graceful fallback, registry convention).
 *
 * @param {'gm'|'player'|'spectator'} mode
 * @param {{ type: string, payload?: object }} action
 * @returns {boolean}
 */
export function isActionAllowed(mode, action) {
  if (mode === 'gm') return true;
  const type = action?.type;
  if (mode === 'player') {
    if (!PLAYER_ALLOWED_ACTIONS.has(type)) return false;
    if (type === 'SESSION_UPDATE') {
      return Object.keys(action.payload ?? {}).every(key => PLAYER_SESSION_KEYS.has(key));
    }
    return true;
  }
  if (mode === 'spectator') return SPECTATOR_ALLOWED_ACTIONS.has(type);
  return false;
}

/**
 * Derives this client's permission mode from its declared role and the current
 * baton. Never stored — not in `GameState` — so nothing about mode travels with
 * HEAD or persists (D-nostate). Recomputed per render from the polled baton.
 *
 * - GM is always `gm`.
 * - A party client is `player` only when it is the party's turn AND it holds the
 *   write-lock; otherwise `spectator` (party between turns, or a non-holding
 *   second party member).
 *
 * @param {'gm'|'party'} role
 * @param {{ turnOwner?: 'gm'|'party' }|null} baton
 * @param {boolean} holdsWriteLock
 * @returns {'gm'|'player'|'spectator'}
 */
export function deriveMode(role, baton, holdsWriteLock) {
  return role === 'gm'                ? 'gm'
       : baton?.turnOwner !== 'party' ? 'spectator'
       : holdsWriteLock               ? 'player'
       :                                'spectator';
}

/**
 * Wraps a raw dispatch so disallowed actions are silently dropped — the single
 * enforcement backstop for a networked session. `getMode` is a getter (ref-backed)
 * because mode changes without remounting the provider, so the gate must read the
 * live value at dispatch time rather than close over a stale one.
 *
 * Offline (no `session` URL param) the provider skips wrapping entirely, so
 * today's app has zero behavior change. The net layer's own `REPLACE_STATE`
 * pulls call `rawDispatch` directly and therefore bypass the gate deliberately —
 * which is why `REPLACE_STATE` need not appear in any allowed set.
 *
 * @param {(action: object) => void} rawDispatch
 * @param {() => 'gm'|'player'|'spectator'} getMode
 * @returns {(action: object) => void}
 */
export function gateDispatch(rawDispatch, getMode) {
  return (action) => {
    if (!isActionAllowed(getMode(), action)) return;   // silent backstop
    rawDispatch(action);
  };
}
