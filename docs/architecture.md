# Architecture

Guild Manager is a client-side SPA with no backend. All state lives in the browser. The codebase is organized into four distinct tiers that communicate in one direction: UI → state → logic → utilities.

## Directory Map

```
config/
└── truncation.yml    # Text display config (build-time YAML; see Text Display Library below)
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
| `UIContext` | Mostly ephemeral UI state: selection, modal props, playing flag | Card expand/collapse only (localStorage on every toggle); rest not persisted |
| `AssetContext` | Image load registry; gates app render until assets settle | No |

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

Tags are stored as raw strings in arrays on each object. `parseTag()` / `buildTag()` in `src/logic/tags.js` are the canonical codec. All matching and merging goes through these functions. The tag registry (`state.tagRegistry`) is a keys-only tree that defines the valid tag structure — it influences autocomplete and the tree editor but does not gate tag creation.

### Task Conditions

Task progress is **not** tag-encoded. Each task carries `conditions: Condition[]` — structured progress subcategories with their own `target` and `progress`, all of which must be satisfied for the task to complete. A condition relates to the tag system through `tracker.tagPath`, a pattern path matched against agents' effective attributes to gate and modulate their per-tick contribution. Matching goes through the mode-based engine in `src/logic/tagMatching.js` (`MATCH_MODE_REGISTRY`: exact / numbered / open, with `*` and `**` wildcards and an escape character); condition links use open mode, which behaves exactly until a pattern opts into wildcards. Trackers are modular: `TRACKER_REGISTRY` in `src/logic/conditions.js` maps each `tracker.kind` to a contribution function, so future event- or rule-driven progress logic plugs in without touching the clock loop. See `docs/gotchas.md` → Conditions and Tag-Path Match Modes for semantics.

### Redux-style State Management

`GameContext` wraps `useReducer(reducer, null, loadState)`. Every game mutation is an action dispatched through `useGame().dispatch`. The reducer in `src/state/reducer.js` handles 30+ action types and is the only place that writes new state. After every state change, a `useEffect` in `GameProvider` persists to localStorage.

The reducer also auto-registers new tag paths into `state.tagRegistry` whenever an agent or task tag is authored (via `registerTags()`), keeping the registry in sync with authored content without requiring explicit registry management.

The Tag Registry modal is the single authoring/assignment surface for tags and condition templates: browsing, structure editing (ADD), assignment to board entities and library drafts (APPLY via `TAG_APPLY` / `TASK_CONDITION_ADD` / `onApply`), and pattern-linked conditions. Opened with no target, APPLY arms a **selection mode** hosted by App.jsx — the next board-entity click receives the pending tag or condition (`pendingApply` in UIContext).

### Click-Highlight-Assign Selection

Two persistent selections in UIContext drive the same "pick a source, then click a target" interaction across the board:

- **`selectedTaskId`** — selecting a task highlights agent cards as assignable / not, and clicking a card assigns it.
- **`selectedItemId`** — selecting an inventory item (`ItemRow`) arms a single **place-item** flow routed through the `ITEM_PLACE` reducer action. Agent cards become give-targets (`.agent-card--give-target`) and the BankPanel becomes a sell-target (`.bank-panel--sellable`). On an agent card, **left-click gives 1**, **right-click opens an inline quantity input**; clicking the BankPanel sells 1. The selection persists so you can give/sell repeatedly, clearing only on a true clickout (handled in App.jsx, which excludes `.agent-card`, `.item-row`, and `.bank-panel`) or once the stack is depleted. The two modes are mutually exclusive — give-target highlighting takes priority over task-assignment highlighting.

### Real-time Interpolated Display

The game clock advances in discrete ticks (one `setInterval` per play interval). Between ticks, a `requestAnimationFrame` loop in `usePlayClock` calls `updateClockDisplayDOM()`, which directly manipulates the DOM to interpolate the clock year/day display and task progress bars. This bypasses React state for the interpolation so 60fps visuals don't force 60fps re-renders.

### Event Log

`advanceTime` records every contribution to (sub)task progress in `state.eventLog`: one `work_contribution` entry per **(agent, condition, game day)** and one `task_complete` entry per task that finishes the tick (a multi-day tick is split into one row per day). The log is the authoritative, in-state record — a browser SPA can't stream-append to a disk file, so the log lives in state (persisted to localStorage with everything else) and is exported to / imported from CSV on demand via `src/logic/eventLog.js` (`saveEventLogToFile` / `loadEventLogFromFile`, reusing the shared `src/logic/download.js` helper). It is FIFO-capped at `MAX_LOG_ROWS`. The schema is deliberately forward-compatible — an `eventType` column and a free-form `data` payload let later features (a planned clock **rollback** that restores prior progress, and richer event kinds) extend it without a storage migration. Rollback is not yet implemented; `task_complete` rows capture the task's tags and `results` as a breadcrumb for it.

### Preset System with Source Forking

The library modal merges two preset pools:
- **Standard presets**: fetched from `public/presets/*.json` at modal open, cached in memory, read-only.
- **User presets**: persisted to localStorage, editable.

Editing a standard preset implicitly forks it into the user pool. `usePresets` in `src/hooks/usePresets.js` manages this; mutation functions guard that only `source === 'user'` entries are ever written back.

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
setInterval (tick)
     │  advanceTime(state) → dispatch(APPLY_TICK)   // newState includes appended eventLog rows
     ▼
requestAnimationFrame loop
     │  updateClockDisplayDOM() → direct DOM writes
     ▼
Clock display / progress bars (visual only, no React re-render)
```
