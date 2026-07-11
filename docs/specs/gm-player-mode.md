# GM/Player Mode + Async Turn Review — Implementation Spec

**Status:** Approved for implementation. Supersedes the v3 design doc
(*GM/Player Mode + Async Turn Review — Design Doc*); every open question in that
doc's register is resolved here (see Decision Log). Written against
`docs/architecture.md`, `docs/api.md`, `docs/gotchas.md`, `docs/environment.md`
as of commit `d39f4cf`.

**Scope:** Alpha testing — one GM and a party of one or more players, turn-based,
possibly online simultaneously. Exactly two identities: `gm` and `party`.
Individual players are never modeled.

**Non-scope:** Live-synced co-editing, per-player turns/identity, auth, security,
peer write-lock preemption, per-tick (non-prefix) approval, mid-replay editing,
restore UI over the snapshot archive, fog-of-war, presence indicators.

---

## The model

Two orthogonal axes over existing machinery:

- **Permission mode** — a pure predicate `isActionAllowed(mode, action)` applied
  to every dispatched action: `gm` (everything), `player` (the turn surface),
  `spectator` (nothing but derived reconciliation).
- **Clock source** — a registry supplying the play clock's step/bounds:
  `live` (existing `advanceTime`/`rollbackTime`) or `recorded` (index into a
  commit's per-tick snapshot array).

| | **gm** | **player** | **spectator** |
|---|---|---|---|
| **live** | GM's turn | Party's turn (lock holder) | Party between turns / non-holder |
| **recorded** | *(deferred)* | — | **The review viewer** |

The review viewer is not a screen — it is the live dashboard mounted in a
sandboxed `GameProvider` seeded from a snapshot, clock source `recorded`, mode
`spectator`. Success criterion: the logic tier and component tree cannot
distinguish local play, spectating, and review — only the provider's clock
source and mode differ.

**Commit shape is F1-B:** a commit carries a full `GameState` snapshot per tick
(snapshots come free — `APPLY_TICK`'s payload is already a complete `newState`,
`src/state/reducer.js:488`). The server therefore runs no game logic at all.

---

## Decision log

Resolutions of the design doc's open questions plus gaps surfaced during
codebase verification (interview of 2026-07-11):

| # | Question | Decision |
|---|---|---|
| Q-claim | Write-lock acquisition | **Explicit claim button** in the party sub-panel. Silent implicit claim surprises a second party member with a dead board. |
| Q-rollback | `APPLY_ROLLBACK` for players | **Allowed.** Snapshot capture pops one snapshot per reversed tick so the commit array and state never disagree. |
| Q-conflict | Commit against a stale base | **Reject on mismatch** — `409` when `commit.base !== headRev`. The party re-pulls and replays. No merge semantics. |
| Q-refresh | Stale spectators | **Light baton poll** — `GET /session/:id/baton` on an interval; full pull when `turnOwner`, `status`, or `holder` changes. |
| Q-agent | `AGENT_UPDATE` granularity | **GM-only entirely.** Players work through activities, items, and the clock; no per-key allowlist for now. |
| Q-rules | Rule-lock home (D-rules) | **Derived from baton** — nothing stored. While this client's mode is `player`, the client forces `log.enabled`. No `GameState` schema change. |
| Q-actor | Event-log actor column | **None.** A commit's log slice is by definition the party's; `EVENT_LOG_COLUMNS` and the CSV round-trip stay untouched. |
| Q-server | Server home | **Standalone `server/` dir** — `node:http` + JSON files, zero dependencies, `npm run server`, reached through a vite `server.proxy` entry (`/api` → `localhost:3001`). |
| Q-join | Role & session declaration | **URL params** — `?session=<id>&role=gm|party`. Honor-system (the trust model prevents accidents, not attacks); no stored role, no accounts. |
| Q-offline | Offline play | **Remains the default.** No `session` param → exactly today's app: localStorage persistence, ungated dispatch, no polling, no mode sub-panel. |
| Q-keys | `SESSION_UPDATE` player keys (D-session-keys) | **`timeStep`, `stepBack`, `rateMultiplier` only.** `clock` is GM-only — the editable Year/Day spans set it directly, bypassing ticks/log/snapshots, which would falsify the review timeline. `title`/`id`/`bank`/`workRate`/`skillBonus` are GM identity/economy. |
| Q-size | Snapshot payload sanity check | **Confirmed comfortable.** Measured against bundled presets at table scale (20 agents / 15 tasks / 40 inventory rows): ~28 KiB per snapshot (`eventLog` and `tagRegistry` omitted); a 200-tick turn ≈ 5.5 MiB, a 500-tick turn ≈ 14 MiB of JSON. Fine for localhost file storage. |

Decisions carried unchanged from the design doc: D-identities, D-modes, D-lock,
D-derive, D-nostate, D-filter, D-baton, D-online, D-override, D-uxsemantics,
D-roomcode, D-viewer, D-source, D-navigate, D-prefix, D-finalize, D-disclosure,
D-noraf, D-overlay, D-dumbserver, D-commit, D-archive, D-indicator, D-panels,
D-turnctl, D-commit-ctl.

---

## 1. Permission layer — `src/logic/permissions.js` (new)

One module exporting the predicate, the mode derivation, and the underlying
tables. Registry-style data + thin function, matching `TRACKER_REGISTRY` /
`MATCH_MODE_REGISTRY` idiom (`docs/api.md` → registries).

```js
export const PLAYER_ALLOWED_ACTIONS = new Set([
  'APPLY_TICK', 'APPLY_ROLLBACK',
  'AGENT_ADD_ACTIVITY', 'AGENT_REMOVE_ACTIVITY',
  'AGENT_BIND_ITEM', 'AGENT_UNBIND_ITEM', 'AGENT_RETURN_ITEM',
  'ITEM_PLACE',
  'SESSION_UPDATE',        // per-key, see below
  'DYN_RECONCILE',
]);

export const PLAYER_SESSION_KEYS = new Set(['timeStep', 'stepBack', 'rateMultiplier']);

export const SPECTATOR_ALLOWED_ACTIONS = new Set(['DYN_RECONCILE']);

/** Pure predicate: may `mode` dispatch `action`? Shared verbatim by the
 *  dispatch gate and every UI affordance check, so pre-check and backstop
 *  cannot disagree (the `unregisteredEntityTags` invariant, generalized). */
export function isActionAllowed(mode, action)
```

- `gm` → always `true`.
- `player` → type in `PLAYER_ALLOWED_ACTIONS`; for `SESSION_UPDATE`
  additionally every key of `action.payload` must be in `PLAYER_SESSION_KEYS`.
- `spectator` → type in `SPECTATOR_ALLOWED_ACTIONS`.
- Unknown mode → `false` (graceful fallback, registry convention).

`TASK_CONDITION_UPDATE` and `TASK_SET_COMPLETE` are deliberately absent from
the player set: both write progress outside `advanceTime` — unlogged and
unrollbackable — so allowing them would make review dishonest.

**Mode derivation** (never stored, not in `GameState` — D-nostate):

```js
export function deriveMode(role, baton, holdsWriteLock) {
  return role === 'gm'                    ? 'gm'
       : baton?.turnOwner !== 'party'     ? 'spectator'
       : holdsWriteLock                   ? 'player'
       :                                    'spectator';
}
```

**The gate:**

```js
export function gateDispatch(rawDispatch, getMode) {
  return (action) => {
    if (!isActionAllowed(getMode(), action)) return;   // silent backstop
    rawDispatch(action);
  };
}
```

`getMode` is a getter (ref-backed) because mode changes without remounting the
provider. Offline (no `session` URL param) the provider skips wrapping entirely
— zero behavior change to today's app.

Coverage argument: `useGame().dispatch` is the only dispatch consumers can
obtain (`src/state/GameContext.jsx:21`), and the two indirection points —
`submitOrder` (`src/logic/order.js:45`) and `configRegistry.commit`
(`src/logic/configRegistry.js:60`) — take dispatch as a parameter. One wrapper
covers every path. Nothing is added to `reducer.js`.

---

## 2. Networked session — `src/state/NetSessionContext.jsx` (new) + `src/logic/netSession.js` (new)

### `netSession.js` — transport

Plain `fetch` wrappers over the route table (§4), all rooted at `/api`, plus
`buildCommit` (below). This module is the network analog of
`src/logic/session.js` (file save/load) and follows `buildOrder`/`submitOrder`'s
transport-document pattern (`docs/architecture.md` → Library Shopping List).

### `NetSessionContext.jsx` — session state

Mounted (in `App.jsx`, above `GameProvider`) only when the URL carries
`?session=<id>&role=gm|party`. Exposes via `useNetSession()`:

```
{ enabled, role, baton, holdsWriteLock, mode,      // derived, read-only
  claimPen(), commitTurn(), setBaton(turnOwner), finalize(cutIndex, message),
  refresh() }                                      // manual full pull
```

- **Join:** on mount, `GET /session/:id` → `REPLACE_STATE` with the returned
  HEAD (runs `normalizeState`, `reducer.js:494`). A GM joining a session that
  does not exist yet creates it seeded from the GM's local state.
- **Baton poll:** `setInterval` on `GET /session/:id/baton` (constant
  `BATON_POLL_MS = 3000`); when `turnOwner`, `status`, or `holder` differs from
  the last seen value → full pull. This is also how a waiting party member's
  mode flips `spectator → player` when the pen frees, and how the party
  receives the review-result banner (§7).
- **Write-lock:** `claimPen()` → `POST /claim`; the returned `holder` token is
  kept in memory only (ephemeral by design — a refresh mid-turn abandons the
  pen; recovery is GM take-back, the AWOL path).
- **`holdsWriteLock`** = `baton.holder === myToken`.
- **Mode** = `deriveMode(role, baton, holdsWriteLock)`, recomputed per render,
  mirrored into a ref for `gateDispatch`.

### `GameProvider` changes (`src/state/GameContext.jsx`)

Two new optional props, both defaulting to today's behavior:

```jsx
export function GameProvider({ children, initialState = null, persist = true })
```

- `initialState` — seed for `useReducer(reducer, initialState, initialState ? (s) => s : loadState)`.
  Used by the sandboxed review provider (§6).
- `persist = false` — skips the `saveState` effect (`GameContext.jsx:17`) so a
  second provider never fights the live one over `STORAGE_KEYS.STATE`.
- When networked, the context value's `dispatch` is
  `gateDispatch(rawDispatch, getMode)` and is additionally wrapped by the
  snapshot recorder (§3). `rawDispatch` stays provider-internal — the net
  layer's own `REPLACE_STATE` pulls bypass the gate deliberately, which is why
  `REPLACE_STATE` need not appear in any allowed set.

Networked persistence: localStorage saving is kept as a local cache (wrapped,
not replaced) — a party client that refreshes mid-turn still has its board.

---

## 3. Snapshot capture (player client)

A dispatch wrapper installed only while networked, composed with the gate:

- On `APPLY_TICK` → push `action.newState` (a complete state, free) onto the
  turn's snapshot ref.
- On `APPLY_ROLLBACK` → pop one snapshot per reversed tick (the player-rollback
  decision; count = ticks actually reversed, which `retreat` knows).
- On claim (turn start) → reset the array to `[currentState]`, so
  `snapshots[0]` is the turn-start state and `cutIndex 0` means reject-all.

**Payload discipline:** before shipping, each snapshot drops `eventLog`
(shipped once, whole-turn slice) and `tagRegistry` (invariant across a party
turn — every `TAGREG_*` and create action is GM-only, and dynamic instance
tags are exempt from registration). `endState` ships complete and is the
single source for both at review time.

```js
buildCommit({ base, snapshots, eventLog, endState })
// base:      headRev the party client pulled
// snapshots: GameState[] minus eventLog/tagRegistry, [0] = turn start
// eventLog:  the turn's slice (entries with seq > seq at turn start)
// endState:  current full state (captures manual edits after the last tick)
```

**Known alpha caveat (stated, not discovered):** manual edits survive rollback
by design (`docs/gotchas.md` → Rollback), so after a mid-turn rollback an
intermediate snapshot is the tick-boundary state *without* later manual edits;
re-ticking re-pushes snapshots that include them. Intermediate cut points are
therefore tick-boundary-honest, not edit-inclusive. `cutIndex === N` resolves
to `endState`, which is always fully current.

---

## 4. Server — `server/index.js` (new, zero dependencies)

`node:http` + `JSON.parse`/`stringify`; one file per session under
`server/data/<id>.json` (gitignored), written atomically
(write temp + rename), **snapshot-then-mutate** on every mutating route
(append the pre-mutation head to the archive before changing it). The server
never simulates, rolls back, or runs a reducer — under F1-B there is nothing
for it to compute; it stores blobs and enforces baton ownership and the
write-lock at the route.

Session file shape:

```js
{ headRev,          // integer, bumped on every head write
  head,             // last approved GameState
  baton,            // { turnOwner: 'gm'|'party', status: 'gm-editing'|'party-turn'|'pending-review', holder: string|null }
  pendingCommit,    // commit document or null
  lastReview,       // { rev, message, cutIndex, tickCount, clockAtCut, clockAtEnd } | null   (§7)
  archive: []       // append-only snapshots on every handoff; no pruning
}
```

Routes (all `/api/session/:id…`; `role` asserted from a `?role=` query param —
honor-system, same trust model as the client):

| Method | Route | Actor | Effect / errors |
|---|---|---|---|
| `GET` | `/session/:id` | any | `{ headRev, head, baton, lastReview }`. `404` if absent (party); GM auto-creates via `PUT`. |
| `PUT` | `/session/:id` | GM | Create/seed session with `{ head }`. |
| `GET` | `/session/:id/baton` | any | `{ headRev, baton }` only — cheap poll body. |
| `POST` | `/session/:id/claim` | party | Set `holder` to a server-minted token if free; `409` if taken; `403` unless `turnOwner === 'party'`. Returns the token. |
| `POST` | `/session/:id/commit` | party | Body = commit document + `holder`. `403` if caller isn't current holder; `409` if `base !== headRev`. Stores `pendingCommit`, `status := 'pending-review'`, clears `holder`, archives. |
| `GET` | `/session/:id/pending` | GM | The commit document. `404` if none. |
| `POST` | `/session/:id/finalize` | GM | Body `{ cutIndex, message?, head }` — the **GM client** reconstructs the final head (§6) so the server stays dumb. Sets `head`, bumps `headRev`, records `lastReview`, clears `pendingCommit`, `status := 'gm-editing'`, archives. |
| `POST` | `/session/:id/baton` | GM | Body `{ turnOwner, head? }`. Hand to party **must include the GM's current state**, which becomes HEAD (bump `headRev`) — this is what the party pulls at turn start. Take-back frees `holder` (and, if a `pendingCommit` exists, discards it). |

Gap resolved beyond the design doc: the design doc's route table never said how
the GM's edits reach the party. Answer: hand-off carries the GM's state as the
new HEAD (there is no separate GM push route).

**Wiring:** `package.json` gains `"server": "node server/index.js"`;
`vite.config.js` gains `server: { proxy: { '/api': 'http://localhost:3001' } }`.
`server/data/` added to `.gitignore`.

---

## 5. Clock source registry — `src/logic/clockSources.js` (new)

Mirrors the established registry idiom (`TRACKER_REGISTRY`,
`src/logic/conditions.js:95`): object literal keyed by source name, uniform
member shape, dispatcher with graceful fallback (unknown source → `live`).

```js
export const CLOCK_SOURCE_REGISTRY = {
  live: {
    stepForward:  ({ state, rollbackConfig }, count) => advanceTime(state, { count, rollbackConfig }),
    stepBackward: ({ state, rollbackConfig }, count) => rollbackTime(state, { count, rollbackConfig }),
    bounds:       ({ state }) => ({ canStepBack: getRollbackHorizon(state.eventLog).canStepBack, canStepForward: true }),
    interpolate:  true,    // RAF loop permitted
  },
  recorded: {
    stepForward:  (ctx, count) => stateAt(ctx, ctx.index + count),
    stepBackward: (ctx, count) => stateAt(ctx, ctx.index - count),
    bounds:       (ctx) => ({ canStepBack: ctx.index > 0, canStepForward: ctx.index < ctx.max }),
    interpolate:  false,   // D-noraf: never start the RAF interpolator
  },
};
```

`stateAt(ctx, i)` (same module) clamps `i` to `[0, max]`, reconstructs a full
state from the commit document —
`{ ...snapshots[i], tagRegistry: endState.tagRegistry, eventLog: logPrefix(i) }`
(for `i === max`, simply `endState`) — and returns `{ newState, index }`.
`logPrefix(i)` cuts the log slice at the `i`-th `'tick'` boundary, reusing the
tick-group walk already established by `rollback.js`. Both step functions
return `null` at the bounds, matching `rollbackTime`'s contract.

### `usePlayClock` changes (`src/hooks/usePlayClock.js`)

Gains an options argument: `usePlayClock({ source = 'live', sourceContext } = {})`.

- `runTick`/`retreat` route through the source's `stepForward`/`stepBackward`
  instead of calling `advanceTime`/`rollbackTime` directly; both keep
  dispatching the returned `newState` (`APPLY_TICK` / `APPLY_ROLLBACK`), so the
  reducer and the interpolation-free manual-step path are untouched.
- The RAF loop starts only when the source's `interpolate` flag is set
  (D-noraf — the interpolator writes toward an in-flight tick that does not
  exist in replay).
- `sourceContext` is read through a ref, matching the existing
  `clockConfigRef`/`rollbackConfigRef` pattern (`usePlayClock.js:41-42`).
- `bounds` replaces the direct `getRollbackHorizon` read for control dimming:
  TopBar's step-back button already renders `.ctrl--disabled` from
  `horizon.canStepBack` (`TopBar.jsx:131-142`); the same affordance now also
  dims step-forward/play at `recorded`'s upper bound. "Dim at the horizon"
  generalizes to "dim at `bounds`" — concept unchanged, second implementation.

Interval play in `recorded` steps the index at the same
`getPlayIntervalMs`-derived pace, giving D-navigate's play/pause/step/rewind
for free.

---

## 6. Review viewer — `src/components/Modals/ReviewModal.jsx` (new)

The `recorded + spectator` cell made concrete:

- A full-screen `Modal` (`src/components/Modals/Modal.jsx`) with a new
  `overlayClass="review-overlay"` — own block in `index.css`, full-viewport
  panel (override the overlay's flex-center), z-index in the base modal band.
  Registered through `useUI()`'s `useModal` plumbing (`UIContext.jsx`),
  persistence **off** (it carries live callbacks), gated in `App.jsx` like the
  other modals.
- Inside: a **second `GameProvider`** with
  `initialState={stateAt(ctx, 0)}`, `persist={false}`, mode pinned to
  `'spectator'` — the sandbox. Scrubbing dispatches into this provider only;
  the GM's live working state is untouched. The dashboard component tree
  mounts unchanged inside it.
- Clock controls: the TopBar control cluster wired to
  `usePlayClock({ source: 'recorded', sourceContext })` from within the
  sandbox. Year/Day render read-only (spectator gate already blocks
  `SESSION_UPDATE.clock`).
- Replay renders under the GM's own `UI.yml` overlay (per-browser localStorage,
  not in `GameState`) — card layout may differ from what the player saw.
  Accepted for alpha (D-overlay).

**Finalize chrome** (GM-only, lives in this viewer — never implicit in
navigation, D-finalize): a distinct control reading the playhead as `cutIndex`,
opening a confirm (existing `ConfirmModal` prompt flavor) with an
always-optional message field. On confirm the client reconstructs the final
head — `stateAt(ctx, cutIndex)`'s full state — and `POST /finalize
{ cutIndex, message, head }`. Prefix-only: the tail is discarded, not stored as
"rejected" (D-prefix).

---

## 7. TopBar chrome — mode sub-panel

One new region in `<nav id="topbar">` (`src/components/TopBar/TopBar.jsx`),
rendered only when networked: `src/components/TopBar/ModePanel.jsx` (new), an
`.inset-panel` whose contents are chosen by `role`. Turn management is **not a
game action** — every control here writes network calls via `useNetSession()`,
never the reducer.

**Status element — the mode indicator** (both roles): a three-cell read-only
clone of the palette switch (`TopBar.jsx:155-163`, `index.css:253-282`) —
blocks `.mode-switch` / `.mode-switch-cell` / `.mode-switch-cell--filled`,
cells GM / PLAYER / OBS, filled cell = this client's derived mode. Indicator
only: it reads `deriveMode`, writes nothing, and is deliberately separate from
the GM's turn control (merged, a party client would watch a control slide on
its own and be dead when touched).

**GM sub-panel — turn controls**, contextual by `baton.status`:

| `status` | Control | Writes |
|---|---|---|
| `gm-editing` | **hand to party** | `POST /baton { turnOwner: 'party', head }` |
| `party-turn` | **take back** | `POST /baton { turnOwner: 'gm' }` (frees the lock) |
| `pending-review` | **review** | opens `ReviewModal` (finalize lives there) |

**Party sub-panel — write-control lifecycle**, one slot, contextual by
`(status, holder)`:

| Situation | Control | Status text |
|---|---|---|
| baton `gm` | — | "GM's turn" |
| baton `party`, pen free | **claim pen** → `POST /claim` | "party's turn — open" |
| baton `party`, you hold it | **commit / end turn** → `POST /commit` | "you're playing" |
| baton `party`, another holds it | — | "a party member is playing" |

Claim → commit is one slot with two states: the commit control is the claim's
necessary counterpart — without it a claimed turn could only end by GM
take-back, discarding the work (D-commit-ctl).

**Review-result banner (D-disclosure):** when a party client's poll-triggered
pull returns a `lastReview` with a `rev` newer than the last acknowledged one
(acknowledgment stored per-browser in localStorage, new `STORAGE_KEYS` entry),
show a `ConfirmModal` alert containing (a) the GM's message if any, and (b) the
**always-shown, non-skippable kept/cut notice**, computed exactly from
`lastReview`: "Days X–Y were not kept" (from `clockAtCut`/`clockAtEnd`), or
"your whole turn was kept" when `cutIndex === tickCount`. Dismiss = acknowledge.

**Rule locks (derived, D-rules):** while this client's mode is `player`, the
client treats rollback logging as forced-on (`log.enabled` read as `true`
regardless of the `rollback.yml` overlay) so the turn's log slice — and
therefore rollback and review honesty — cannot be switched off mid-turn.
Nothing is stored; nothing travels with HEAD. (Locked-tag enforcement needs no
forcing: every create action is GM-only under the filter.)

---

## 8. Turn state machine (reference)

| `status` | `turnOwner` | Party client | GM |
|---|---|---|---|
| `gm-editing` | `gm` | `live + spectator` — static board; poll refreshes on baton move | edits freely; **hand to party** |
| `party-turn` | `party` | holder: `live + player`, then **commit**; others: `live + spectator` | **take back** (frees lock, discards) |
| `pending-review` | `gm` | `live + spectator` — "awaiting review" | **review** → finalize; override |

Transitions: hand-off → commit → finalize → (loop); GM override: any → any.
No lease/heartbeat on the lock — AWOL holder is handled by GM take-back.

---

## 9. Implementation phases

Each phase is a working increment and a reviewable PR; earlier phases carry no
UI risk. Docs sync per phase where a public interface changes (CLAUDE.md →
Synchronized Commits).

1. **`feat(permissions)`** — `src/logic/permissions.js`
   (`isActionAllowed`, `deriveMode`, `gateDispatch`) + vitest coverage (pure
   logic, node env). No wiring yet.
2. **`feat(clock)`** — `src/logic/clockSources.js` + `usePlayClock` source
   option + bounds-driven control dimming. `live` remains the default;
   offline behavior identical.
3. **`feat(server)`** — `server/index.js`, `npm run server`, vite proxy,
   `netSession.js`, `NetSessionContext`, `GameProvider` props
   (`initialState`/`persist`), gate + snapshot-capture wiring, baton poll,
   claim/commit round-trip.
4. **`feat(ui)`** — `ModePanel` (indicator + GM turn controls + party
   claim/commit lifecycle) + affordance gating of existing controls via
   `isActionAllowed`.
5. **`feat(review)`** — `ReviewModal` (sandboxed provider + recorded clock +
   finalize) + disclosure banner + forced-logging rule lock.
6. **`docs`** — sync `architecture.md` (fourth context / networked tier,
   clock-source registry), `api.md` (permissions module, netSession, routes),
   `gotchas.md` (dispatch gate is the sole enforcement point; second
   `GameProvider` must set `persist=false`; never start the RAF interpolator
   in `recorded`).

---

## 10. Verification plan

- **Unit (vitest, node env):** `isActionAllowed` truth table incl.
  `SESSION_UPDATE` key split; `deriveMode` four-row table; recorded-source
  `stateAt` bounds/clamping and `logPrefix` tick-boundary cuts; server route
  handlers exercised over `node:http` with a temp data dir (claim `409`,
  non-holder commit `403`, stale-base `409`, finalize head/rev advance,
  snapshot-then-mutate archive growth).
- **End-to-end (manual, two browser windows):** GM at `?session=T1&role=gm`,
  party at `?session=T1&role=party`. Walk the full loop: hand off → claim →
  play ticks + manual actions + one rollback → commit → GM review scrub →
  finalize at a mid-turn cut with a message → party sees the kept/cut banner
  and the cut board. Confirm: spectator board refreshes on baton move; second
  party window stays OBS while the pen is held; GM take-back frees the pen;
  offline URL (no params) behaves exactly as before, including localStorage
  persistence and rollback horizon dimming.
