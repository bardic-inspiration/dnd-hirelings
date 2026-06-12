# Architecture

Guild Manager is a client-side SPA with no backend. All state lives in the browser. The codebase is organized into four distinct tiers that communicate in one direction: UI → state → logic → utilities.

## Directory Map

```
src/
├── main.jsx          # React bootstrap; mounts providers
├── App.jsx           # Root shell; owns modal rendering and global click handler
├── utils.js          # uid(), now() — no dependencies
├── state/            # React context providers, reducer, storage
├── logic/            # Pure business logic (no React imports)
├── hooks/            # Custom hooks (bridge between state and UI concerns)
├── constants/        # Static configuration and theme data
├── components/       # React UI tree
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
| `UIContext` | Ephemeral UI state: selection, modal props, playing flag | No |
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
  equip:weapon:item:sword activity tag — agent has Sword equipped in weapon slot
  task:abc1234            activity tag — agent assigned to task with this id
```

Tags are stored as raw strings in arrays on each object. `parseTag()` / `buildTag()` in `src/logic/tags.js` are the canonical codec. All matching and merging goes through these functions. The tag registry (`state.tagRegistry`) is a keys-only tree that defines the valid tag structure — it influences autocomplete and the tree editor but does not gate tag creation.

### Task Conditions

Task progress is **not** tag-encoded. Each task carries `conditions: Condition[]` — structured progress subcategories with their own `target` and `progress`, all of which must be satisfied for the task to complete. A condition relates to the tag system through `tracker.tagPath`, a pattern path matched against agents' effective attributes to gate and modulate their per-tick contribution. Matching goes through the mode-based engine in `src/logic/tagMatching.js` (`MATCH_MODE_REGISTRY`: exact / numbered / open, with `*` and `**` wildcards and an escape character); condition links use exact mode. Trackers are modular: `TRACKER_REGISTRY` in `src/logic/conditions.js` maps each `tracker.kind` to a contribution function, so future event- or rule-driven progress logic plugs in without touching the clock loop. See `docs/gotchas.md` → Conditions and Tag-Path Match Modes for semantics.

### Redux-style State Management

`GameContext` wraps `useReducer(reducer, null, loadState)`. Every game mutation is an action dispatched through `useGame().dispatch`. The reducer in `src/state/reducer.js` handles 30+ action types and is the only place that writes new state. After every state change, a `useEffect` in `GameProvider` persists to localStorage.

The reducer also auto-registers new tag paths into `state.tagRegistry` whenever an agent or task tag is authored (via `registerTags()`), keeping the registry in sync with authored content without requiring explicit registry management.

### Real-time Interpolated Display

The game clock advances in discrete ticks (one `setInterval` per play interval). Between ticks, a `requestAnimationFrame` loop in `usePlayClock` calls `updateClockDisplayDOM()`, which directly manipulates the DOM to interpolate the clock year/day display and task progress bars. This bypasses React state for the interpolation so 60fps visuals don't force 60fps re-renders.

### Preset System with Source Forking

The library modal merges two preset pools:
- **Standard presets**: fetched from `public/presets/*.json` at modal open, cached in memory, read-only.
- **User presets**: persisted to localStorage, editable.

Editing a standard preset implicitly forks it into the user pool. `usePresets` in `src/hooks/usePresets.js` manages this; mutation functions guard that only `source === 'user'` entries are ever written back.

### CSS Class Naming

Classes follow a loose kebab-case convention but mix two structural patterns without a declared rule:

**Flat compound names** (most common): `.agent-card`, `.task-card`, `.item-row`, `.tag-list` — parent and child share a prefix but no separator signals the relationship.

**Implicit BEM-like hierarchy**: `.vital-bar-fill--hp`, `.vital-bar-fill--xp`, `.condition-item-bar-fill` — double hyphens appear for some modifiers but not others; double underscores for sub-elements are absent.

**Bare modifier classes**: `.active`, `.expanded`, `.selected`, `.depleted`, `.empty-state` — applied alongside block classes but not namespaced to a block, so their meaning depends on context.

> ⚠️ **Naming:** The stylesheet should declare one pattern and follow it. Flat compound names (`.agent-card-name`, `.task-card-header`) are simpler and already dominant — formalizing that choice would mean removing the isolated `--modifier` suffixes and replacing bare state classes with namespaced ones (`.agent-card--active`, `.task-card--expanded`).

### Virtual Asset Manifests

Vite's build step runs two custom plugins (`imageManifestPlugin` in `vite.config.js`) that scan `public/assets/portraits/` and `public/assets/items/` at build time and expose the file lists as virtual modules (`virtual:portrait-manifest`, `virtual:item-manifest`). In dev, file-system watches trigger hot-reload when images are added or removed. This means the portrait and item pickers require no manual manifest maintenance.

Served images are **WebP**: portraits, item icons, and the five theme background images were converted from JPEG (~58% smaller overall) for faster first paint and picker load. Pre-conversion JPEG originals are retained under each directory's `originals/` subfolder (not scanned by the manifest, and git-ignored). The display font is served as **WOFF2** (`BNBreezy.woff2`, ~68% smaller than the OTF) with the OTF kept as a fallback in the `@font-face` `src`. When adding new assets, drop WebP files directly into the scanned directories — the manifest's `IMAGE_EXTS` set already includes `webp`.

See `docs/assets.md` for the full asset pipeline: directory layout, formats, manifest scanning rules, hard-coded reference points, and the conversion workflow.

---

## Library Choices

| Library | Why |
|---------|-----|
| **React 18** | Component model; `useReducer` for Redux-like state without the boilerplate of an external store |
| **js-yaml** | Tag registry YAML I/O; chosen over hand-rolled parsing because YAML handles indentation-based nesting cleanly and the library is small |
| **Vite** | Fast HMR, native ESM, and a simple plugin API that made the virtual manifest pattern straightforward |

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
     │  advanceTime(state) → dispatch(APPLY_TICK)
     ▼
requestAnimationFrame loop
     │  updateClockDisplayDOM() → direct DOM writes
     ▼
Clock display / progress bars (visual only, no React re-render)
```
