# Multiplayer

One GM and a party of one or more players take turns on one shared board,
possibly online at once, and the GM reviews each party turn. Part of
[`SPEC.md`](../../SPEC.md).

## The model

Exactly two identities exist: `gm` and `party`. Individual players are never
modeled. Two independent axes sit over the existing machinery:

- **Permission mode** — a pure predicate applied to every dispatched action:
  `gm` (everything), `player` (the turn surface), `spectator` (nothing but
  derived reconciliation).
- **Clock source** — where the play clock's steps come from:
  `live` (today's `advanceTime` / `rollbackTime`) or `recorded` (an index into
  a committed turn's per-tick snapshots).

| | `gm` | `player` | `spectator` |
|---|---|---|---|
| `live` | The GM's turn | The party's turn (pen holder) | The party between turns, or a non-holder |
| `recorded` | `Planned (#116):` — | — | **The review viewer** |

`Planned (#116):` The review viewer is not a separate screen: it is the live
dashboard mounted in a sandboxed `GameProvider` seeded from a snapshot, with
clock source `recorded` and mode `spectator`. The logic tier and the component
tree cannot tell local play, spectating, and review apart.

**Offline stays the default.** With no `session` URL parameter the app is
exactly the single-player app: `localStorage` persistence, ungated dispatch,
no polling, no mode panel.

**Joining** is by URL: `?session=<id>&role=gm|party`. Roles
are honor-system: the trust model prevents accidents, not attacks. Nothing about
roles is stored; there are no accounts.

## Permissions

`src/logic/permissions.js`:

- **`isActionAllowed(mode, action)`**: `gm` → always; `player` → the action
  type is in `PLAYER_ALLOWED_ACTIONS`, and for `SESSION_UPDATE` every payload
  key is in `PLAYER_SESSION_KEYS`; `spectator` → the type is in
  `SPECTATOR_ALLOWED_ACTIONS`; an unknown mode → never.

  | Set | Members |
  |---|---|
  | `PLAYER_ALLOWED_ACTIONS` | `APPLY_TICK`, `APPLY_ROLLBACK`, `AGENT_ADD_ACTIVITY`, `AGENT_REMOVE_ACTIVITY`, `AGENT_BIND_ITEM`, `AGENT_UNBIND_ITEM`, `AGENT_RETURN_ITEM`, `ITEM_PLACE`, `SESSION_UPDATE`, `DYN_RECONCILE` |
  | `PLAYER_SESSION_KEYS` | `timeStep`, `stepBack`, `rateMultiplier` |
  | `SPECTATOR_ALLOWED_ACTIONS` | `DYN_RECONCILE` |

  Why the player set excludes `TASK_CONDITION_UPDATE` and `TASK_SET_COMPLETE`:
  both write progress outside the tick — unlogged and unrollbackable — which
  would make review dishonest. `AGENT_UPDATE` is GM-only. `session.clock` is
  GM-only because the YEAR / DAY spans bypass ticks, the log, and snapshots.
- **`deriveMode(role, baton, holdsWriteLock)`**: `gm` for the GM; otherwise
  `spectator` unless the baton is the party's **and** this client holds the
  pen, then `player`. Mode is derived on every render, never stored.
- **`gateDispatch(rawDispatch, getMode)`** silently drops a disallowed
  action. Every UI affordance checks the same predicate (`useCan()`), so
  pre-check and backstop cannot disagree: a control whose action the mode
  doesn't allow is disabled, read-only, or not rendered. Offline the mode is
  `gm`, so nothing is gated. The gate is the single enforcement
  point: `useGame().dispatch` is the only dispatch consumers get, and
  `submitOrder` and config bindings take dispatch as a parameter.

## Networked session

`src/state/NetSessionContext.jsx`, mounted above `GameProvider` only when the
URL carries `session` and `role`; it renders that `GameProvider` itself.
`useNetSession()` exposes `enabled`, `role`, `baton`, `headRev`,
`lastReview`, `holdsWriteLock`, `mode`, `error`, and `claimPen()`,
`commitTurn()`, `setBaton(turnOwner)`, `finalize(cutIndex, message)`,
`refresh()` — each call resolving `true` on success, or `false` with `error`
set. Offline (no provider) it returns `enabled: false` and mode `gm`.
Transport is plain `fetch` over the routes below (`src/logic/netSession.js`);
error statuses resolve rather than throw.

- **Join:** fetch the session and load its head with `REPLACE_STATE`. A GM
  joining a session that doesn't exist creates it from the GM's local state.
- **Baton poll:** every 3 s (`BATON_POLL_MS`), fetch the baton; when
  `turnOwner`, `status`, or `holder` changes, pull the whole session.
- **The pen:** `claimPen()` returns a holder token kept in memory only, so a
  refresh mid-turn abandons the pen; the GM takes it back. A claim re-pulls
  the head it is based on, so the turn starts from `headRev`. A pull never
  replaces the board of the client the server still names as holder; one
  that no longer names it drops the token.
- **`GameProvider`** gains `initialState` (seed instead of loading storage)
  and `persist` (`false` skips saving, so a second provider never overwrites
  the live save). Networked, its `dispatch` is gated and wrapped by the
  snapshot recorder; the net layer's own `REPLACE_STATE` pulls bypass the
  gate. `localStorage` saving stays on as a local cache.

## Snapshots

While networked, the party client records the turn:

- **On claim**, the snapshot list resets to `[currentState]`, so index 0 is
  the turn start and a cut at 0 rejects the whole turn.
- **On `APPLY_TICK`**, push the tick's new state; **on `APPLY_ROLLBACK`**,
  pop one snapshot per reversed tick, never below index 0. Ticks are counted
  from `session.clock`. A step spanning several ticks (`timeStep` > 1) pushes
  one snapshot per tick, so index `i` is always the `i`-th tick boundary; it
  only exposes its end state, so the intermediate snapshots are rebuilt by
  rolling that state back a tick at a time (best-effort, `INV-7`).
- Recording happens behind the gate, so only actions the mode allows are
  recorded (`createNetDispatch`).
- **Commit** (`buildCommit({ base, snapshots, eventLog, endState })`): `base`
  is the head revision pulled; snapshots omit `eventLog` and `tagRegistry`
  (the registry can't change in a party turn — every create and registry
  action is GM-only); `eventLog` is the turn's slice; `endState` is the full
  current state, including edits after the last tick.

A cut is tick-boundary-honest, not edit-inclusive: manual edits survive
rollback, so after a mid-turn rollback an intermediate snapshot lacks edits
made after it. A cut at the end resolves to `endState`.

The head a GM finalizes is `cutState(commit, cutIndex)`: the board from
`stateAt`, with the end state's full event log cut to match — the turn's
ticks after the cut are dropped — so the head keeps the log from before the
turn.

## Server

`server/index.js`: `node:http` and JSON files, no dependencies, run with
`npm run server`, reached through Vite's `/api` proxy to `localhost:3001`. One
file per session in `server/data/<id>.json` (gitignored), written atomically.
Every mutating route appends the pre-mutation head to the archive first. The
server never simulates or runs a reducer; it stores documents and enforces
the baton and the pen.

```js
{ headRev,        // integer, bumped on every head write
  head,           // last approved GameState
  baton,          // { turnOwner: 'gm'|'party',
                  //   status: 'gm-editing'|'party-turn'|'pending-review',
                  //   holder: string|null }
  pendingCommit,  // commit document or null
  lastReview,     // { rev, message, cutIndex, tickCount, clockAtCut, clockAtEnd } | null
  archive: [] }   // append-only; never pruned
```

All routes are under `/api/session/:id`; the caller's role comes from a
`?role=` parameter.

| Method | Route | Caller | Effect |
|---|---|---|---|
| `GET` | `/` | any | `{ headRev, head, baton, lastReview }`; `404` if absent. |
| `PUT` | `/` | GM | Create or seed with `{ head }`. |
| `GET` | `/baton` | any | `{ headRev, baton }` — the poll. |
| `POST` | `/claim` | party | Mint and return a holder token if the pen is free; `409` if taken; `403` unless it's the party's turn. |
| `POST` | `/commit` | party | Commit document + holder. `403` if not the holder; `409` if `base ≠ headRev`. Stores it, sets `pending-review`, clears the holder. |
| `GET` | `/pending` | GM | The pending commit; `404` if none. |
| `POST` | `/finalize` | GM | `{ cutIndex, message?, head }`: sets the head (built by the GM client), bumps `headRev`, records `lastReview`, clears the commit, sets `gm-editing`; `404` if no commit is pending. |
| `POST` | `/baton` | GM | `{ turnOwner, head? }`. Handing to the party must include the GM's state, which becomes the head. Taking back frees the pen and discards any pending commit. |

A stale commit is rejected, never merged: the party re-pulls and replays.

A caller with the wrong role gets `403`; a malformed body or a session id
outside `[A-Za-z0-9_-]{1,64}` gets `400`. Requests on one session are
serialized, so of two simultaneous claims exactly one wins. `lastReview`'s
`tickCount` is the turn's tick count (`snapshots.length − 1`); `clockAtCut`
and `clockAtEnd` are `session.clock` of the new head and of the commit's
`endState`.

## Clock sources

`CLOCK_SOURCE_REGISTRY` (`src/logic/clockSources.js`); an unknown source falls
back to `live`.

| Source | Step forward / back | Bounds | Interpolates |
|---|---|---|---|
| `live` | `advanceTime` / `rollbackTime` | Back: the rollback horizon; forward: unbounded | Yes |
| `recorded` | `stateAt(ctx, index ± count)` | `0 … max` | No |

`stateAt` clamps the index and rebuilds a full state from the commit:
`{ ...snapshots[i], tagRegistry: endState.tagRegistry, eventLog: logPrefix(i) }`,
or `endState` at the last index. `logPrefix(i)` cuts the log slice at the
i-th tick boundary. Steps return `null` at the bounds.

`sourceContext` contract: `{ index, onIndexChange?, snapshots, endState, eventLog }`
(or `{ index, onIndexChange?, commit: { snapshots, endState, eventLog } }`).
Index reading is narrowed to `sourceContext.index` and notifications fire
exclusively through `onIndexChange(nextIndex)`.

`usePlayClock({ source = 'live', sourceContext })` routes its steps through
the source and starts the frame interpolator only when the source
interpolates. Controls dim at the source's `bounds` — step back at the
rollback horizon as today, and step forward and play at a recording's end.
Play in `recorded` steps the index at the normal interval, automatically
stopping immediately when reaching the maximum bound.

**State isolation:** Recorded steps dispatch `APPLY_TICK` / `APPLY_ROLLBACK`
with the reconstructed historical `newState`, replacing state in the
enclosing `GameProvider`. In review mode, this is isolated from live play
because the review viewer mounts inside a separate sandboxed `GameProvider`
(`initialState` seeded from the turn start, `persist: false`, mode pinned to
`spectator`), so historical scrubbing cannot mutate or overwrite the
player's live state or localStorage.

## Review viewer

`Planned (#116):` this section.

`ReviewModal` is a full-screen modal holding a **second `GameProvider`**
(`initialState` = the turn start, `persist: false`, mode pinned to
`spectator`) with the top bar's clock controls on the `recorded` source. The
GM scrubs it without touching their live state. Its open state never
persists. It renders under the GM's own UI config.

**Finalize** is a distinct GM control, never implied by navigation: it takes
the playhead as `cutIndex`, confirms with an optional message, rebuilds that
state, and posts it. Only a prefix of a turn can be kept; the tail is
discarded.

## Mode sub-panel

Networked only, a panel in the top bar (`ModePanel`; its view logic is
`src/logic/modePanel.js`). Its controls make network calls, never reducer
actions. Handing off and committing stop the play clock first, and losing
the pen mid-play stops it too.

- **Mode indicator** (both roles): a read-only three-cell switch — GM,
  PLAYER, OBS — showing this client's derived mode. It is separate from the
  GM's turn control.
- **GM turn control**, by status: `gm-editing` → **hand to party**;
  `party-turn` → **take back**; `pending-review` → **review**.
  `Planned (#116):` **review** opens the review viewer; until it exists the
  control shows disabled.
- **Party slot**, by baton and pen:

  | Situation | Control | Status |
  |---|---|---|
  | GM's baton | — | "GM's turn" |
  | GM's baton, turn pending review | — | "awaiting review" |
  | Party's baton, pen free | **claim pen** | "party's turn — open" |
  | Party's baton, you hold it | **commit / end turn** | "you're playing" |
  | Party's baton, someone else holds it | — | "a party member is playing" |

- `Planned (#116):` **Review result:** when a pull brings a `lastReview`
  newer than the one this browser acknowledged (stored per browser), the
  party sees an alert with the GM's message, if any, and an always-shown
  notice of what was kept — "Days X–Y were not kept", or "your whole turn was
  kept". Dismissing acknowledges.
- `Planned (#116):` **Forced logging:** while this client is `player`,
  rollback logging reads as enabled whatever the overlay says, so a turn's
  log can't be switched off mid-turn.

## Turn states

| Status | Baton | Party client | GM |
|---|---|---|---|
| `gm-editing` | `gm` | `live` + `spectator` | Edits; **hand to party** |
| `party-turn` | `party` | Holder: `live` + `player`, then **commit**; others: `spectator` | **Take back** |
| `pending-review` | `gm` | `live` + `spectator`, "awaiting review" | **Review** → finalize (`Planned (#116)`) |

Hand-off → commit → finalize → repeat. The GM may override any state. The pen
has no lease or heartbeat; an absent holder is handled by take-back.
