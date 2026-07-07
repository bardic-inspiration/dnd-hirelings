# Architecture

Guild Manager is a client-side SPA with no backend. All state lives in the browser. The codebase is organized into four distinct tiers that communicate in one direction: UI → state → logic → utilities.

## Directory Map

```
config/
└── truncation.yml    # Text display config (build-time YAML; see Text Display Library below)
public/
└── config/
    └── UI.yml    # Card element → tag source assignments (runtime YAML; see Configurable Card Elements below)
src/
├── main.jsx          # React bootstrap; mounts providers
├── App.jsx           # Root shell; owns modal rendering, global click handler, tag-apply selection mode
├── utils.js          # uid(), now() — no dependencies
├── state/            # React context providers, reducer, storage
├── logic/            # Pure business logic (no React imports)
├── hooks/            # Custom hooks (bridge between state and UI concerns)
├── constants/        # Static configuration and theme data (incl. build-time YAML loaders)
├── components/       # React UI tree (shared components at the root)
│   ├── TopBar/
│   ├── Dashboard/
│   │   └── TaskSections/
│   └── Modals/
│       └── previews/
└── styles/
    └── index.css     # Single stylesheet; design-system tokens + all component styles
```

## Layered Architecture

### 1. Logic tier (`src/logic/`)

Pure functions with no React dependencies. Every game mechanic lives here: tag parsing, agent validation, task completion, clock simulation, XP math. Logic functions take plain JS objects and return new objects — no side effects, no context reads.

This makes them independently testable and safe to call from both React hooks and the reducer.

### 2. State tier (`src/state/`)

Three React contexts:

| Context | Contents | Persisted |
|---------|----------|-----------|
| `GameContext` | `{ state, dispatch }` — the full game world via `useReducer` | Yes, localStorage on every change |
| `UIContext` | Mostly ephemeral UI state: selection, modal props, playing flag | Card expand/collapse, plus each persistence-enabled modal's open state (`MODAL_PERSISTENCE`); rest ephemeral |
| `ConfigContext` | Runtime config documents: fetched base YAML per manifest entry + user-edit overlay | Overlays only (`CONFIG_OVERLAYS`); base docs re-fetched per load |

Images load without any blocking gate: the theme background is a decorative CSS background preloaded in `index.html`, and modal pickers preload their thumbnails locally via `useAssetGroup` (issue #90).

`GameContext` follows the Redux pattern: a single normalized state tree, a single reducer, dispatch-only mutations. The reducer is in `reducer.js`; persistence is in `storage.js`.

### 3. Hook tier (`src/hooks/`)

Hooks bridge the logic and state tiers with React's lifecycle. `usePlayClock` owns the game loop (interval + RAF). `usePressHoldDrag` encapsulates gesture detection. `usePresets` manages the preset library's async fetch + localStorage sync.

### 4. Component tier (`src/components/`)

Components read from `useGame()` and `useUI()` and dispatch actions. They contain no business logic — layout, event wiring, and display formatting only.

---

## Key Patterns

### Tag-based Attribute System

Every property of agents, tasks, and items is a **tag string** with a uniform grammar:

```
[modifier,]segment[:segment...][=value]

Examples:
  skill:arcana=3          plain tag — agent has Arcana 3
  req,skill:arcana=2      modifier tag — task requires Arcana ≥ 2
  block,trait:undead      modifier tag — task blocks undead agents
  bonus,ability:str=2     modifier tag — item grants +2 STR
  bind:weapon:item:sword  activity tag — agent has Sword bound in weapon slot
  bind:item:sword         activity tag — agent has Sword bound (no slot)
  task:abc1234            activity tag — agent assigned to task with this id
```

Tags are stored as raw strings in arrays on each object. `parseTag()` / `buildTag()` in `src/logic/tags.js` are the canonical codec. All matching and merging goes through these functions. The tag registry (`state.tagRegistry`) is a keys-only tree that defines the valid tag structure — **a live store of all tags currently in play and all tags allowed by the system**. It stays live through two registration paths: authoring (`TAG_APPLY` / `TASK_CONDITION_ADD`) and entity creation (`AGENT_CREATE` / `TASK_CREATE` / `INVENTORY_ADD` register preset tags on create). By default it does not gate tag creation; with `locked: true` in `public/config/tags.yml` (see `logic/tagsConfig.js`) the create actions block entities carrying unregistered tags instead — the library modal pre-checks whole orders and alerts, and the reducer enforces as a silent backstop.

**Registry-bounded values** (issue #104, design record in `docs/tag-values.md`): the registry is the boundary between structure and value. Three rules: (1) every segment in a tag string is registered — authoring flows through the Tag Registry modal, and free-typed endpoints register on apply; (2) explicit `=value` scalars are never registered — open categories live entirely in `=value`; (3) a tag ending on a registered **leaf** carries an implied value whose default varies by use case — `true` for matching, the leaf segment string for display (`class:fighter` → `fighter`), nothing for numeric card elements. Those defaults live in per-use-case resolver functions (`VALUE_RESOLVER_REGISTRY` in `src/logic/tagValues.js`), never in the registry or the data schema, so closed categories are simply categories whose preset values are registered leaf children. The display read is strict: no registry, an unregistered terminal, or a registered non-leaf all resolve `null`.

### Task Conditions

Task progress is **not** tag-encoded. Each task carries `conditions: Condition[]` — structured progress subcategories with their own `target` and `progress`, all of which must be satisfied for the task to complete. A condition relates to the tag system through `tracker.tagPath`, a pattern path matched against agents' effective attributes to gate and modulate their per-tick contribution. Matching goes through the mode-based engine in `src/logic/tagMatching.js` (`MATCH_MODE_REGISTRY`: exact / numbered / open, with `*` and `**` wildcards and an escape character); condition links use open mode, which behaves exactly until a pattern opts into wildcards. A tracker may also carry a structured `compare: { op, value }` term (`VALUE_COMPARE_REGISTRY` / `matchTagValue` in the same engine) tested against each path-matched tag's display-resolved value, so a link like `skill:arcana ≥ 3` gates contribution on the value, not just the path. Trackers are modular: `TRACKER_REGISTRY` in `src/logic/conditions.js` maps each `tracker.kind` to a contribution function, so future event- or rule-driven progress logic plugs in without touching the clock loop. See `docs/gotchas.md` → Conditions and Tag-Path Match Modes for semantics.

### Redux-style State Management

`GameContext` wraps `useReducer(reducer, null, loadState)`. Every game mutation is an action dispatched through `useGame().dispatch`. The reducer in `src/state/reducer.js` handles 30+ action types and is the only place that writes new state. After every state change, a `useEffect` in `GameProvider` persists to localStorage.

The reducer also auto-registers new tag paths into `state.tagRegistry` whenever an agent or task tag is authored (via `registerTags()`), keeping the registry in sync with authored content without requiring explicit registry management.

The Tag Registry modal is the single authoring/assignment surface for tags and condition templates: browsing, structure editing (ADD), assignment to board entities and library drafts (APPLY via `TAG_APPLY` / `TASK_CONDITION_ADD` / `onApply`), and pattern-linked conditions. Opened with no target, APPLY arms a **selection mode** hosted by App.jsx — the next board-entity click receives the pending tag or condition (`pendingApply` in UIContext).

### Click-Highlight-Assign Selection

Two persistent selections in UIContext drive the same "pick a source, then click a target" interaction across the board:

- **`selectedTaskId`** — selecting a task highlights agent cards as assignable / not, and clicking a card assigns it.
- **`selectedItemId`** — selecting an inventory item (`ItemRow`) arms a single **place-item** flow routed through the `ITEM_PLACE` reducer action. Agent cards become give-targets (`.agent-card--give-target`) and the BankPanel becomes a sell-target (`.bank-panel--sellable`). On an agent card, **left-click gives 1**, **right-click opens an inline quantity input**; clicking the BankPanel sells 1. The selection persists so you can give/sell repeatedly, clearing only on a true clickout (handled in App.jsx, which excludes `.agent-card`, `.item-row`, and `.bank-panel`) or once the stack is depleted. The two modes are mutually exclusive — give-target highlighting takes priority over task-assignment highlighting.

### Configurable Card Elements (UI config)

Instead of hardcoding which agent attributes the card displays, `AgentCard`
renders a set of **standard UI elements** whose value sources are assigned in
`public/config/UI.yml` (issue: agent card configurable UI elements):

| Element | Renders | Notes |
|---------|---------|-------|
| `medallion` | one value in a square badge beside the name | visible while collapsed |
| `boxes` | one value per square, four per row | sit directly above the bars |
| `bars` | `(current, max)` tuples as ratio bars | the pre-existing vital-bar format; current value editable when writable |
| `fields` | labelled editable values | writes back through the source |
| `values` | read-only `LABEL: value` entries | label = last path segment |
| `slots` | bind slot names for the card's item slots | not a value source — see below |

`slots` is a plain list of bind slot names (e.g. `weapon`, `armor`). It is the
**sole source** of a card's slot names — they are no longer hardcoded in the tag
registry (issue #84). Binding an item fills the first unoccupied configured slot
(`firstFreeSlot`), producing a `bind:<slot>:item:<name>` tag; with no slots
configured (or all full) the item binds without a slot. `parseUIConfig`
lowercases slot names so they compose cleanly into tag paths.

A source is a tag-like path: `dynamic:<key>` reads a computed stat from
`computeDynamicAttributes`; a bare field name (`rate`) reads an agent scalar;
any other path reads the numeric `=value` of the matching effective attribute
tag. Resolution, config normalization, and write-back mapping live in
`src/logic/UI.js`; `useUIConfig(cardName)` reads the live document from
`ConfigContext` (fetched base file merged with any Configuration Modal
overlay — see "Runtime Configuration System" below), so in-app edits re-render
cards immediately. Because the file lives in `public/`, it ships with the
deployed bundle and can be edited without a rebuild (unlike
`config/truncation.yml`, which is inlined at build time).

Two contract points from the spec:

- **Invalid sources** (unknown dynamic key, missing tag, non-numeric value)
  render their element with **no value** in an `--invalid` state that flashes
  the warning color and keeps warn-colored chrome.
- **Consumed tags**: an attribute tag whose path is assigned to any element is
  omitted from the ATTRIBUTES chip list — only tags *not* mentioned in the
  config render as chips (`getConsumedTagPaths` / `isTagConsumed`). Modifier
  tags (`req,` / `bonus,`) are never consumed.

### Runtime Configuration System (Config Modal)

The Configuration Modal (TopBar → CONFIG) is the single in-app surface for
editing every registered config file — the config counterpart of the Tag
Registry Modal, with the same philosophy: the schema shapes affordances
(autocomplete, warnings) but **never blocks** an edit. Long-term this is the
"build within the app" surface for data-driven UI and, eventually, game
mechanics.

Three cooperating pieces:

- **Manifest** — `src/logic/configRegistry.js` exports `CONFIG_FILES`, the
  single registration point. Adding a config file = one entry + one schema.
  Two entry kinds:
  - `kind: 'file'` — a runtime YAML asset under `public/config/` (`clock`,
    `rollback`, `tags`, `ui`), fetched by `ConfigContext` and shadowed by a
    localStorage overlay.
  - `kind: 'state'` — a virtual section bound to live game state via
    `binding: { select, commit, effects, defaults }` (e.g. `session`, the old
    SETTINGS numbers). No fetch, no overlay — the reducer is its storage.
    `effects` maps keys to effect *names* (`rateMultiplier: 'restartPlay'`)
    which the modal resolves to live callbacks from props, keeping the
    manifest pure.
- **Provider** — `src/state/ConfigContext.jsx` fetches each file entry's base
  document once (single-flight per URL, lenient degradation to `{}`) and holds
  the user-edit **overlay**: a whole-document replacement persisted under
  `STORAGE_KEYS.CONFIG_OVERLAYS`. `getDoc(id)` returns `overlay ?? base ?? {}`;
  because documents live in React state, modal edits live-apply to every
  consumer (e.g. `useUIConfig` → `AgentCard`). RESET drops the overlay.
- **Editor logic** — `src/logic/configEditor.js` is the pure tier: schema
  walking (`schemaNodeAt`), tree flattening for the editor view
  (`flattenConfigDoc`, insertion-order-preserving — deliberately separate from
  `flattenRegistry`'s sorted walk), immutable doc mutations (`setValueAt`,
  `deleteAt`, and `removeEntryAt` — the modal's delete, which clears entries
  named in their parent's schema `keys` to their empty shape instead of
  removing them; list items and user-added keys delete outright), soft
  validation (`checkConfigDoc` → warnings map), the
  pluggable `VALUE_KINDS` registry (string/number/boolean/slug/enum/
  `tagSource`), and YAML file I/O (`configSave`/`configLoad` via the shared
  `downloadFile`).

Schema descriptors are tiny recursive objects colocated with their file's
logic (`UI_SCHEMA` in `UI.js`, `CLOCK_SCHEMA` in `clockConfig.js`,
`ROLLBACK_SCHEMA` in `rollback.js`, `SESSION_SCHEMA` in `configRegistry.js`):

```js
// node := { kind: 'map', keys?, anyKey?, closed? }
//       | { kind: 'list', item } | { kind: 'tuple', size, item }
//       | { kind: 'scalar', value: 'string'|'number'|'boolean'|'slug'|'tagSource'|'enum',
//           options?, min?, step?, nullable?, label? }
```

The modal (`src/components/Modals/ConfigModal.jsx`) renders all manifest
sections as one continuous folding tree in the Tag Registry Modal's idiom
(line-number gutter, indent guides, fold boxes, ghost autocomplete in the
builder input). Scalars edit inline through `EditableSpan` and commit
immediately; out-of-schema keys and failing values draw warn styling with a
tooltip. SAVE / LOAD / RESET act on the **active section** (the one containing
the last-clicked key). Because a static-hosted SPA cannot write `public/`
files, SAVE exports the merged document as YAML for the user to drop back into
`public/config/`; LOAD imports one (rejecting only unparseable YAML or a
non-mapping root — schema mismatches import fine and warn in the tree).

> ⚠️ **Needs clarification:** state-bound sections (session) hide SAVE/LOAD —
> their values already round-trip through the session JSON export. A future
> option could export them as YAML too for symmetry.

### Agent Card Rendering Order

`AgentCard` renders its elements in one fixed **standard order**, independent of
which are always-visible and which are hidden when the card is collapsed:

`Name (+ Medallion) · Portrait · Fields (editable values) · Boxes · Bars ·
Values (read-only) · Description · Attributes · Bag · Bound · Tasks ·
Copy | Delete`

Only Name (with the medallion) and Bars are always visible; the rest are hidden
when collapsed. Because those hidden elements fall into two contiguous runs
around the always-visible Bars (Portrait + Fields + Boxes before; everything
from Values onward after), the JSX expresses the whole card as that flat
sequence with just **two `!isCollapsed` guards** — no wrapper element and no
per-element conditional. A collapsed card therefore shows exactly Name +
Medallion + Bars. Preserve this order when adding card elements (e.g. future
editable/non-editable values slot in with their group).

### Real-time Interpolated Display

The game clock advances in discrete ticks (one `setInterval` per play interval). Between ticks, a `requestAnimationFrame` loop in `usePlayClock` calls `updateClockDisplayDOM()`, which directly manipulates the DOM to interpolate task progress bars. This bypasses React state for the interpolation so 60fps visuals don't force 60fps re-renders. The clock year/day display is not interpolated — one tick is one day, so it simply advances via React on each committed tick.

### Event Log

`advanceTime` records every contribution to (sub)task progress in `state.eventLog`, one **tick** at a time (a step-forward of `timeStep` ticks loops the internal single-tick `advanceTick`): per tick, one `work_contribution` entry per **(agent, condition)**, one `task_complete` entry per task that finishes that tick, and one `'tick'` boundary entry sealing the batch. The **ordering contract** is `work* → task_complete* → tick`; the tick entry appends on every tick (even a no-op one) and records `data: { wagesTotal, wages }` — that tick's exact wage payments — so rollback refunds correctly even if agent rates change later. Every tick advances the clock by exactly one, so no step size is stored and rollback rewinds one tick per boundary. `task_complete` entries record the task's tags, `results`, and the exact `spawnedAgentIds` / `unassignedAgentIds` the completion produced. The log is the authoritative, in-state record — a browser SPA can't stream-append to a disk file, so the log lives in state (persisted to localStorage with everything else) and is exported to / imported from CSV on demand via `src/logic/eventLog.js` (`saveEventLogToFile` / `loadEventLogFromFile`, reusing the shared `src/logic/download.js` helper). Logging is configured by `public/config/rollback.yml` (`log.enabled`, `log.maxRows` FIFO cap).

### Game Clock & Tick Rollback

The simulation's base time unit is the **tick**: `session.clock` counts elapsed ticks and every advance moves it by whole ticks. Calendar concepts (days, years) are a UI-only presentation of that count and never enter the game loop — one tick equals one day. `public/config/clock.yml` (normalized by `src/logic/clockConfig.js`) configures:

- **calendar** — the display-only mapping from elapsed ticks to a year/day label (`daysPerYear`); read by the TopBar, not by `advanceTime`;
- **timeStep / rateMultiplier bounds** — the clamps applied by the TopBar hold-drag adjustments (the forward `session.timeStep` and backward `session.stepBack` increments are independent per-session values that share the `timeStep` bounds);
- **realTime** — wall-clock pacing (`msPerTick`, `minTickIntervalMs`).

`advanceTime(state, { count })` is the sole clock-advance entry point: it runs `count` independent single-tick simulations (`advanceTick`), so the event log is always tick-level no matter how many ticks a call spans. The play loop calls it with `count: 1` — **each play interval advances exactly one tick**, decoupling play speed (`getPlayIntervalMs` = `msPerTick / rateMultiplier`) from the manual step size — and the step-forward button with `count: session.timeStep`. Pure logic functions take normalized config **as a parameter** with `DEFAULT_CLOCK_CONFIG` fallbacks — no module singletons — threaded from the `useClockConfig()` / `useRollbackConfig()` hooks through `usePlayClock` refs (so interval callbacks never close over stale values; a clock-config edit restarts a running interval immediately).

**Rollback** (`src/logic/rollback.js`) makes the clock reversible, driven by the event log rather than snapshots. `rollbackTick(state, rollbackConfig)` finds the most recent `'tick'` boundary (one tick), reverses that tick's event group in strict LIFO order (completions and work rows first, then the boundary's wage refund and the one-tick clock decrement), and truncates the group off the log — so the log tail always ends at a tick boundary and replaying forward regenerates fresh rows with continuing `seq`. `rollbackTime(state, { count })` is the symmetric inverse of `advanceTime`: the step-back button rewinds `session.stepBack` ticks by looping `rollbackTick` (`usePlayClock`'s `retreat`). Rollback reverses **tick effects only**: inverses subtract recorded deltas (never restore snapshots), so manual edits made since the tick survive; every inverse is best-effort (missing entities skip, bank and quantities clamp at 0) so rollback never blocks. `public/config/rollback.yml` provides a per-category **switchboard** (`reverse.workProgress` / `wages` / `taskCompletion` / `rewardGold` / `rewardItems` / `spawnedAgents` / `agentReassignment`) plus the master `enabled` flag that shows/hides the TopBar step-back button. `getRollbackHorizon(eventLog)` derives the earliest reachable time (log-limited — one tick before the oldest `'tick'` entry); the step-back button dims at the horizon and the clock panel shows the earliest reachable YEAR/DAY.

### Preset System with Source Forking

The library modal merges two preset pools:
- **Standard presets**: fetched from `public/presets/*.json` at modal open, cached in memory, read-only.
- **User presets**: persisted to localStorage, editable.

Editing a standard preset implicitly forks it into the user pool. `usePresets` in `src/hooks/usePresets.js` manages this; mutation functions guard that only `source === 'user'` entries are ever written back.

### Library Shopping List (Orders)

The library modal is a **cart**, not a single-picker (issue #92). Every row carries an editable order count (`src/components/Modals/LibraryModal.jsx` keeps a `quantities` map keyed by preset id): left-clicking a row adds one copy, right-clicking removes one (clamped at 0), and the count is also directly type-editable, displayed through `formatCount` so large numbers never spill. A row with count > 0 renders selected; the row open in the preview pane for editing is marked independently (`--focused`). Editing a standard preset forks it and carries its cart count onto the fork, so a customized item keeps its place in the order.

`ADD` submits the whole cart at once. The modal builds a transport-agnostic **order** document (`buildOrder` in `src/logic/order.js`) — `{ type, lines: { preset, quantity }[] }` — from every row with a positive count (the full preset list, so an active search filter never drops a queued row), then hands it to `submitOrder`, the single point that expands lines into `AGENT_CREATE` / `TASK_CREATE` / `INVENTORY_ADD` dispatches (each carrying its line's `quantity` as a copy count). Because the order is plain serializable data resembling the preset files, wiring it to a server backend later means swapping only `submitOrder`. For items, a count of _N_ stacks _N_ packs of the preset's own quantity into one inventory row; for agents and tasks, _N_ mints _N_ distinct entities.

### Text Display Library

A small cross-tier library keeps long strings and large numbers from spilling their containers (issue #69), designed so **future components get safe display by default and opt out per prop**:

- **Config**: `config/truncation.yml` (repo root) declares the number-shorthand table, `<PRE>`/`<TAG>`/`<TAGS>`/`<VAL>` placeholder strings, and char-budget parameters. Inlined at build time via a Vite `?raw` import and validated fail-fast by `src/constants/truncation.js` — extending display behavior (a `T` tier, new component budgets) is a config-only change.
- **Logic**: `src/logic/format.js` (number shorthand, gold) and `src/logic/truncation.js` (structural tag truncation ladder, middle ellipsis, budget math). `TAG_LABEL_VARIANTS` is the extension point for new tag display styles, mirroring `MATCH_MODE_REGISTRY`.
- **Hook**: `useCharBudget(component)` measures a chip/row **container** (one shared ResizeObserver) and converts width + computed font size into a character budget, so truncation tracks the UI's actual scale.
- **Components**: `<Tooltip>` (the app-standard hover/focus bubble), `<TagLabel>` (the canonical tag renderer; every tag display goes through it), `<TruncatedText>` (plain-text sibling). Truncation, tooltips, and shorthand are **on by default** with `truncate` / `tooltip` / `shorthand` toggle props.

The guiding rule: the user always sees the structure of a tag — modifier, first segment, and value survive every stage of collapse, and the full string is one hover away.

### CSS Class Naming

Classes follow the **flat compound** convention (declared in `CLAUDE.md` and the stylesheet header):

- **Block**: `.agent-card`, `.task-card`, `.tooltip`
- **Sub-element**: `.agent-name`, `.tag-string-placeholder` — block prefix, single hyphens
- **State**: `.task-card--expanded`, `.tag--active`, `.tag-string--truncated` — double-hyphen modifier applied as a second class in JSX; never a bare unnamespaced state class
- **Utilities**: `.mono`, `.bright`, `.dim`, `.label`, `.value`, `.right` — the only intentionally global, unprefixed classes

### Virtual Asset Manifests

Vite's build step runs two custom plugins (`imageManifestPlugin` in `vite.config.js`) that scan `public/assets/portraits/` and `public/assets/items/` at build time and expose the file lists as virtual modules (`virtual:portrait-manifest`, `virtual:item-manifest`). In dev, file-system watches trigger hot-reload when images are added or removed. This means the portrait and item pickers require no manual manifest maintenance.

Served images are **WebP**: portraits, item icons, and the five theme background images were converted from JPEG (~58% smaller overall) for faster first paint and picker load. Pre-conversion JPEG originals are retained under each directory's `originals/` subfolder (not scanned by the manifest, and git-ignored). The display font is served as **WOFF2** (`BNBreezy.woff2`, ~68% smaller than the OTF) with the OTF kept as a fallback in the `@font-face` `src`. When adding new assets, drop WebP files directly into the scanned directories — the manifest's `IMAGE_EXTS` set already includes `webp`.

See `docs/assets.md` for the full asset pipeline: directory layout, formats, manifest scanning rules, hard-coded reference points, and the conversion workflow.

---

## Library Choices

| Library | Why |
|---------|-----|
| **React 18** | Component model; `useReducer` for Redux-like state without the boilerplate of an external store |
| **js-yaml** | Tag registry YAML I/O and build-time config parsing; chosen over hand-rolled parsing because YAML handles indentation-based nesting cleanly and the library is small |
| **Vite** | Fast HMR, native ESM, and a simple plugin API that made the virtual manifest pattern straightforward |
| **vitest** (dev) | Unit tests for the pure logic/constants tiers; runs on Vite's own transform pipeline so build-time imports (`?raw`) resolve without mocking |

No routing library (single page, no routes), no CSS framework (single bespoke stylesheet), no state management library (React's `useReducer` is sufficient for this scale).

---

## Data Flow

```
User interaction
     │
     ▼
Component (reads useGame, useUI)
     │  dispatch(action)
     ▼
reducer.js  ──── logic/tasks.js, logic/agents.js (pure)
     │
     ▼
GameContext state
     │  useEffect → saveState()
     ▼
localStorage
```

The game loop bypasses this flow for display interpolation:

```
setInterval (play)                        Step-back button
     │  advanceTime(state, { count: 1 })       │  rollbackTime({ count: stepBack })
     │  (one tick per interval)                │  (loops rollbackTick, one tick each)
     │  → dispatch(APPLY_TICK)                 │  → dispatch(APPLY_ROLLBACK)
     ▼                                         ▼   (reversed eventLog groups truncated)
requestAnimationFrame loop
     │  updateClockDisplayDOM() → direct DOM writes
     ▼
Progress bars (visual only, no React re-render)
```
