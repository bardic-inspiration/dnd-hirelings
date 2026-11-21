// The mode sub-panel's view logic (docs/spec/multiplayer.md "Mode sub-panel"):
// what the indicator, the GM turn control, and the party slot show for a
// given baton. Plain data — `ModePanel` renders it and maps each `action` to
// a network call, never a reducer action.

/**
 * The mode indicator's three read-only cells, in display order, keyed by the
 * derived permission mode (`deriveMode`).
 *
 * @type {ReadonlyArray<{ mode: 'gm'|'player'|'spectator', label: string }>}
 */
export const MODE_CELLS = Object.freeze([
  { mode: 'gm', label: 'GM' },
  { mode: 'player', label: 'PLAYER' },
  { mode: 'spectator', label: 'OBS' },
]);

// GM turn control by baton status.
const GM_CONTROLS = {
  'gm-editing': { action: 'handOff', label: 'HAND TO PARTY' },
  'party-turn': { action: 'takeBack', label: 'TAKE BACK' },
  'pending-review': { action: 'review', label: 'REVIEW' },
};

/**
 * The GM's turn control for the current baton: `handOff` while editing,
 * `takeBack` during the party turn, `review` while a turn is pending.
 *
 * @param {{ status: string }|null} baton
 * @returns {{ action: 'handOff'|'takeBack'|'review', label: string }|null}
 *   `null` before the baton is known or for an unknown status.
 */
export function gmTurnControl(baton) {
  return GM_CONTROLS[baton?.status] ?? null;
}

const slot = (status, action = null, label = null) => ({ action, label, status });

/**
 * The party slot for the current baton and pen: a control (`claim`,
 * `commit`, or none) and a status line.
 *
 * @param {{ turnOwner: string, status: string, holder: string|null }|null} baton
 * @param {boolean} holdsWriteLock Whether this client holds the pen.
 * @returns {{ action: 'claim'|'commit'|null, label: string|null, status: string }}
 */
export function partySlot(baton, holdsWriteLock) {
  if (!baton) return slot('connecting…');
  if (baton.turnOwner !== 'party') {
    return slot(baton.status === 'pending-review' ? 'awaiting review' : "GM's turn");
  }
  if (holdsWriteLock) return slot("you're playing", 'commit', 'COMMIT / END TURN');
  if (baton.holder) return slot('a party member is playing');
  return slot("party's turn — open", 'claim', 'CLAIM PEN');
}
