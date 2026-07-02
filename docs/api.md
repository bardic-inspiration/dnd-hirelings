# Internal API Reference

Guild Manager has no HTTP backend. "API" here means the public interfaces of each module: exported functions, hooks, context consumers, and the reducer's action vocabulary.

---

## Contexts

### `useGame()` → `{ state, dispatch }`

The primary game state interface. Provides the normalized state tree and dispatch.

| Field | Type | Description |
|-------|------|-------------|
| `state` | `GameState` | Full application state (see State Shape) |
| `dispatch` | `(action: Action) => void` | Dispatch a reducer action |

### `useUI()` → `UIContext`

Ephemeral UI state. Not persisted. All fields below are part of the returned object.

| Field | Type | Description |
|-------|------|-------------|
| `selectedTaskId` | `string \| null` | Currently selected task |
| `setSelectedTaskId` | `(id: string \| null) => void` | Select or deselect a task |
| `selectedItemId` | `string \| null` | Currently selected inventory item |
| `setSelectedItemId` | `(id: string \| null) => void` | Select or deselect an item |
| `expandedTasks` | `Set<string>` | IDs of expanded task cards |
| `toggleExpanded` | `(id: string) => void` | Toggle task card expansion |
| `playing` | `boolean` | Whether the game clock is running |
| `setPlaying` | `(v: boolean) => void` | Set playing state (prefer `usePlayClock` start/stop) |
| `portraitsProps` | `{ onSelect } \| null` | Non-null when PortraitsModal is open |
| `openPortraits` | `(onSelect: (url: string) => void) => void` | Open portrait picker |
| `closePortraits` | `() => void` | Close portrait picker |
| `itemIconsProps` | `{ onSelect } \| null` | Non-null when ItemIconsModal is open |
| `openItemIcons` | `(onSelect: (url: string) => void) => void` | Open icon picker |
| `closeItemIcons` | `() => void` | Close icon picker |
| `libraryProps` | `{ type: 'agent' \| 'task' \| 'item' } \| null` | Non-null when LibraryModal is open |
| `openLibrary` | `(type: 'agent' \| 'task' \| 'item') => void` | Open library modal for a given type |
| `closeLibrary` | `() => void` | Close library modal |
| `configProps` | `{} \| null` | Non-null when ConfigModal is open |
| `openConfig` | `() => void` | Open config modal |
| `closeConfig` | `() => void` | Close config modal |
| `tagRegistryProps` | `TagRegistryProps \| null` | Non-null when TagRegistryModal is open |
| `openTagRegistry` | `(props?: TagRegistryProps) => void` | Open tag registry modal (no props = global browse/define mode) |
| `closeTagRegistry` | `() => void` | Close tag registry modal |
| `pendingApply` | `{ kind: 'tag', tag } \| { kind: 'condition', template } \| null` | Tag/condition awaiting a board-entity click (selection mode, hosted by App.jsx) |
| `setPendingApply` | `(value) => void` | Arm or clear selection mode |

```ts
interface TagRegistryProps {       // all fields optional
  target?: { type: 'agent'|'task'|'item', id: string };  // board entity APPLY assigns to
  mode?: 'tag' | 'condition';      // 'condition': APPLY builds a ConditionTemplate
  onApply?: (tagString | template) => void;  // library preset drafts; elevates overlay
}
```

> **Modal state pattern:** All modals use the same nullable-object idiom — `*Props` is `null` when closed and a (possibly empty) object when open, paired with `open*`/`close*` callbacks. Props travel with the open signal.

### `useAssets()` → `{ registerAssets, isReady }`

Global asset load gate. Used by `useRegisterAssets`.

| Field | Type | Description |
|-------|------|-------------|
| `registerAssets` | `(urls: string[]) => void` | Register URLs; blocks render until they settle |
| `isReady` | `boolean` | False while any registered URL is still pending |

---

## Reducer Actions

Dispatch these via `useGame().dispatch`. All actions have a `type` field.

### Session

| Action | Payload | Description |
|--------|---------|-------------|
| `SESSION_UPDATE` | `{ payload: Partial<Session> }` | Merge partial changes into `state.session` |

### Agents

| Action | Fields | Description |
|--------|--------|-------------|
| `AGENT_CREATE` | `{ preset?: AgentPreset }` | Create agent from blank or preset |
| `AGENT_UPDATE` | `{ id, changes: Partial<Agent> }` | Patch agent fields |
| `AGENT_DELETE` | `{ id }` | Delete agent; returns held items to inventory |
| `AGENT_DUPLICATE` | `{ id }` | Deep-copy agent; clears activities and timestamps |
| `AGENT_REMOVE_ATTRIBUTE` | `{ id, index: number }` | Remove attribute by index |
| `AGENT_ADD_ACTIVITY` | `{ id, tag: string }` | Add activity tag (task assignment or item grant) |
| `AGENT_REMOVE_ACTIVITY` | `{ id, tag: string }` | Remove exact activity tag |
| `AGENT_RETURN_ITEM` | `{ id, itemName: string }` | Move all of item from agent's bag back to inventory |
| `AGENT_BIND_ITEM` | `{ id, itemName: string, slot?: string }` | Bind item from bag into the agent; `slot` optional |
| `AGENT_UNBIND_ITEM` | `{ id, itemName: string, slot?: string }` | Unbind item back to the bag; `slot` optional |

### Tasks

| Action | Fields | Description |
|--------|--------|-------------|
| `TASK_CREATE` | `{ preset?: TaskPreset }` | Create task from blank or preset |
| `TASK_UPDATE` | `{ id, changes: Partial<Task> }` | Patch task fields |
| `TASK_DELETE` | `{ id }` | Delete task; removes all agent assignments |
| `TASK_DUPLICATE` | `{ id }` | Deep-copy task; resets progress and completion |
| `TASK_SET_COMPLETE` | `{ id, isComplete: boolean }` | Complete (runs `applyTaskComplete`) or un-complete a task |
| `TASK_REMOVE_TAG` | `{ id, field: 'requirements'\|'attributes', index: number }` | Remove tag by index from task field |
| `TASK_CONDITION_ADD` | `{ id, template: ConditionTemplate }` | Append condition (stamped with fresh id, zero progress); registers a non-null `tracker.tagPath` into the tag registry |
| `TASK_CONDITION_UPDATE` | `{ id, conditionId, changes: Partial<Condition> }` | Patch a condition (click-to-edit progress/target) |
| `TASK_CONDITION_REMOVE` | `{ id, conditionId }` | Remove a condition by id |
| `TASK_UPDATE_RESULTS` | `{ id, changes: Partial<Task['results']> }` | Patch task result fields |

### Inventory

| Action | Fields | Description |
|--------|--------|-------------|
| `INVENTORY_ADD` | `{ preset?: ItemPreset }` | Add item from blank or preset |
| `INVENTORY_UPDATE_ITEM` | `{ id, changes: Partial<InventoryItem> }` | Patch item; renaming triggers quantity merge if name collides |
| `INVENTORY_REMOVE_ITEM` | `{ id }` | Delete item from inventory |
| `INVENTORY_REMOVE_ATTRIBUTE` | `{ id, index: number }` | Remove attribute by index from item |
| `ITEM_PLACE` | `{ target: { type: 'agent'\|'bank', id? }, itemId: string, quantity?: number }` | Draw `quantity` (default 1, clamped to stock) of a selected item from inventory and route it: `agent` gives into the agent's bag (`mergeItemQty`); `bank` sells it (value × qty → gold). The single click-highlight-assign path shared by give (AgentCard) and sell (BankPanel). Depleted items stay in the list (grayed) |

### Tags

| Action | Fields | Description |
|--------|--------|-------------|
| `TAG_APPLY` | `{ target: { type: 'agent'\|'task'\|'item', id }, tag: string }` | Apply a tag to any board entity; the single assignment path for the registry's APPLY button and selection mode. Tasks route by modifier (`routeTaskTag`: `req`/`block` → `requirements`, else `attributes`) and append; agents/items dedupe-merge into `attributes` (`mergeAttribute`). Registers the tag's path |

### Tag Registry

| Action | Fields | Description |
|--------|--------|-------------|
| `TAGREG_ADD_PATH` | `{ segments: string[] }` | Insert tag path into registry tree |
| `TAGREG_DELETE_NODE` | `{ segments: string[] }` | Remove node and its subtree |
| `TAGREG_RENAME_NODE` | `{ segments: string[], name: string }` | Rename a node in place |
| `TAGREG_REPLACE` | `{ registry: TagRegistry }` | Replace entire registry (used after YAML import) |

### Bulk / System

| Action | Fields | Description |
|--------|--------|-------------|
| `APPLY_TICK` | `{ newState: GameState }` | Replace state with a pre-computed tick result (includes the appended `eventLog`) |
| `REPLACE_STATE` | `{ newState: object }` | Load external state; runs through `normalizeState()` |
| `EVENTLOG_CLEAR` | — | Empty the event log (`eventLog: []`) |
| `RESET` | — | Reset to `DEFAULT_STATE` |

---

## Logic Functions

### `src/logic/tags.js`

```js
parseTag(tagString: string): { modifier: string|null, segments: string[], value: string|null }
buildTag(segments: string[], value?: string|null, modifier?: string|null): string
tagMatches(tag: ParsedTag, prefix: { segments: string[] }): boolean
mergeAttribute(attrs: string[], tag: string): string[]
formatTagLabel(parsed: ParsedTag): { label: string, params: string }
```

### `src/logic/tagMatching.js`

```js
MATCH_MODE_REGISTRY: { [mode: string]: (pattern, segments, options?) => boolean }
matchTagPath(patternPath: string|string[], tagSegments: string[], options?: { mode?: 'exact'|'numbered'|'open', depth?: number }): boolean
parsePattern(patternPath: string|string[]): { kind: 'literal'|'single'|'multi', value?: string }[]
formatPatternLabel(patternPath: string|string[]): string
escapePatternSegment(text: string): string
SINGLE_WILDCARD, MULTI_WILDCARD, ESCAPE_CHARACTER  // '*', '**', '\'
```

Pattern-vs-tag matching engine with pluggable modes (`MATCH_MODE_REGISTRY` is
the extension point, mirroring `TRACKER_REGISTRY`):

- `exact` — same segment count, pairwise match (the default mode)
- `numbered` — first `depth` segments pairwise; default depth = pattern length (prefix semantics)
- `open` — glob alignment: `*` passes exactly one segment, `**` passes zero or more (used by condition tag links; identical to exact for `**`-free patterns)

`formatPatternLabel` renders a pattern as the engine reads it (`'skill:*'` → `skill:‹any›`) for preview UI.

Wildcards and escapes exist only on the pattern side; tag segments are always
literal text. `\*`, `\:`, `\\` escape literal asterisks, colons, and backslashes
in patterns; `escapePatternSegment` builds safe literal segments from arbitrary
text. See `docs/gotchas.md` → Tag-Path Match Modes.

### `src/logic/agents.js`

```js
getCurrentTask(agent: Agent, tasks: Task[]): Task | null
activeTaskCount(agent: Agent, tasks: Task[]): number
validateAssignment(agent: Agent, task: Task): boolean
tryAssignTask(agent: Agent, selectedTaskId: string|null, tasks: Task[]): 'assigned'|'already-assigned'|'invalid'|'no-task'
isActivityActive(activityTag: string, tasks: Task[]): boolean
isAttributeActive(attrTag: string, agent: Agent, tasks: Task[]): boolean
agentsAssignedTo(taskId: string, agents: Agent[]): Agent[]
getPersonalItems(activities: string[]): { name: string, quantity: number, tag: string }[]
getBoundItems(activities: string[]): { slot: string|null, name: string, tag: string }[]
hasSlotSchema(agent: Agent): boolean
collectAllHeldItems(activities: string[]): { [name: string]: number }
getEffectiveAttributes(agentAttributes: string[], activities: string[], inventory: InventoryItem[]): string[]
mergeItemQty(activities: string[], name: string, delta: number): string[]
```

### `src/logic/tasks.js`

```js
routeTaskTag(tagString: string): 'requirements' | 'attributes'  // by the modifier's MODIFIER_REGISTRY taskField
checkTaskComplete(task: Task, clockAdvanced?: boolean): boolean
applyResults(task: Task, inventory: InventoryItem[], agents: Agent[]): { newInventory, newAgents, bankDelta }
applyTaskComplete(taskId: string, tasks: Task[], agents: Agent[], inventory: InventoryItem[]): { newTasks, newAgents, newInventory, bankDelta }
computeBlockedTaskIds(activeTasks: Task[], inventory: InventoryItem[]): Set<string>
```

### `src/logic/conditions.js`

```js
TRACKER_REGISTRY: { [kind: string]: (condition, context) => number }
computeConditionContribution(condition: Condition, context: { effectiveAttributes, session, stepDays }): number
defaultConditionName(tagPath: string|null): string
createConditionTemplate(input: { name?, target?, tagPath?, kind? }): ConditionTemplate
conditionTemplateFromDraft(draft: string): ConditionTemplate  // 'path[=target]', last-'=' split (escape-safe)
normalizeConditionTemplate(raw: object): ConditionTemplate
conditionFromTemplate(template: ConditionTemplate|Condition): Condition  // fresh id, zero progress
normalizeCondition(raw: object): Condition
migrateLegacyWorkTemplates(workTags: string[]): ConditionTemplate[]
migrateLegacyWork(workTags: string[], workProgress?: object): Condition[]
resetConditions(conditions: Condition[]): Condition[]
```

`TRACKER_REGISTRY` is the extension point for progress-tracking logic: each
`tracker.kind` maps to a contribution function, so future event- or rule-driven
trackers plug in without touching the clock loop.

### `src/logic/clock.js`

```js
getStepMinutes(session: Session): number
getPlayIntervalMs(session: Session): number
advanceTime(state: GameState): { newState: GameState, flashAgentIds: string[], taskProgressPerTick: { [taskId]: { [conditionId]: number } } }
updateClockDisplayDOM(state: GameState, tickInfo: TickInfo): void
```

`advanceTime` also appends to `newState.eventLog`: one `work_contribution` entry per
(agent, condition, game day) and one `task_complete` entry per task finishing this tick
(a multi-day tick is split into one row per day). See `eventLog.js`.

### `src/logic/dynamicAttributes.js`

```js
computeDynamicAttributes(agent: Agent, inventory?: InventoryItem[]): {
  xp: number, level: number, xpProgress: number,
  proficiency: number, ac: number, hp: number, hpMax: number
}
```

### `src/logic/time.js`

```js
formatClockParts(totalMinutes: number): { year: number, day: number }
clockMinutesFromParts(year: number, day: number): number
```

### `src/logic/tagRegistry.js`

```js
seedTagRegistry(seed?: object): TagRegistry
serializeRegistry(registry: TagRegistry): string        // → YAML
parseRegistry(ymlString: string): TagRegistry
tagRegistryCheck(ymlString: string): { valid: boolean, error: string|null }
addTagToRegistry(registry: TagRegistry, tagString: string): TagRegistry
addPath(registry: TagRegistry, segments: string[]): TagRegistry
deleteNode(registry: TagRegistry, segments: string[]): TagRegistry
renameNode(registry: TagRegistry, segments: string[], newKey: string): TagRegistry
pathExists(registry: TagRegistry, segments: string[]): boolean
patternMatchesRegistry(registry: TagRegistry, patternPath: string): boolean  // open-mode match vs any node path
flattenRegistry(registry: TagRegistry, expanded: Set<string>): RegistryRow[]
tagRegistrySave(registry: TagRegistry, sessionId: string): Promise<void>
tagRegistryLoad(file: File): Promise<TagRegistry>
```

### `src/logic/download.js`

```js
downloadFile(contents: string | Blob, suggestedName: string,
             options?: { mime?: string, pickerTypes?: object[] }): Promise<void>
```

Shared file-write helper: native Save As dialog (File System Access API) with an
`<a>.download` fallback. Used by `session.js`, `eventLog.js`, etc.

### `src/logic/session.js`

```js
saveStateToFile(state: GameState): Promise<void>
loadStateFromFile(file: File): Promise<GameState>
```

### `src/logic/eventLog.js`

```js
EVENT_LOG_COLUMNS: string[]          // CSV column order (single source of truth)
MAX_LOG_ROWS: number                 // default FIFO cap on the live log (50000)
DEFAULT_LOGGING_CONFIG: { enabled: boolean, maxRows: number }   // session.logging defaults
normalizeLoggingConfig(raw: object): { enabled: boolean, maxRows: number }
makeWorkEvent({ seq, clock, day, agent, task, condition, delta, progress }): EventLogEntry
makeCompleteEvent({ seq, clock, day, task }): EventLogEntry
normalizeEvent(raw: object): EventLogEntry | null   // null if missing taskId
capEventLog(eventLog: EventLogEntry[], maxRows?: number): EventLogEntry[]
serializeEventLog(eventLog: EventLogEntry[]): string                // → CSV
parseEventLog(csvText: string): EventLogEntry[]                     // ← CSV
saveEventLogToFile(eventLog: EventLogEntry[], sessionId: string): Promise<void>
loadEventLogFromFile(file: File): Promise<EventLogEntry[]>
```

### `src/logic/presets.js`

```js
savePresetToFile(preset: object, type?: string): Promise<void>
savePresetListToFile(presets: object[], type?: string): Promise<void>
loadPresetsFromFile(file: File): Promise<object[]>
```

### `src/logic/format.js`

```js
formatNumberShorthand(value: number, config?: NumberShorthandConfig): string
formatGold(value: number, config?: NumberShorthandConfig): string
```

Table-driven number shorthand (`1.42K`, `56.5K`, `1.25M`, `6.00B`; three
significant figures). Below the first tier numbers render verbatim; rounding
that carries a mantissa to 1000 promotes it one tier (`999950` → `1.00M`);
past the last tier — and for non-finite input — the configured `overflow`
string (`"NaN"`) renders. `formatGold` keeps the bank's one-decimal display
below the first tier and switches to shorthand above it. The default table is
`TRUNCATION_CONFIG.numberShorthand` (from `config/truncation.yml`); pass a
`config` to extend it (e.g. a `T` tier) without code changes.

### `src/logic/truncation.js`

```js
TAG_LABEL_VARIANTS: { [variant: string]: { modifierText, segmentText, valueText, modifierSeparator, segmentSeparator, valueSeparator } }
computeCharBudget({ widthPx, fontSizePx, charWidthRatio, allowancePx?, minChars?, fallbackChars }): number
truncateMiddle(text: string, maxChars: number): { text: string, truncated: boolean }
truncateTagParts(parsed: ParsedTag, maxChars?: number, options?: { variant?: 'chip'|'row', shorthand?: boolean, config?: TruncationConfig }):
  { parts: TagLabelPart[], text: string, truncated: boolean, valueShortened: boolean }
// TagLabelPart = { kind: 'modifier'|'separator'|'segment'|'value'|'placeholder', text: string,
//                  placeholder?: 'prefix'|'segment'|'segments'|'value' }
```

Structural tag truncation. `truncateTagParts` walks a decision ladder — full
render → collapse trailing middle segments to `<TAG>`/`<TAGS>` → replace
overlong mandatory elements (value, first segment, modifier) with
`<VAL>`/`<TAG>`/`<PRE>` — and returns the first form that fits `maxChars`,
always preserving the tag's structure. Pass `Infinity` to disable truncation.
`TAG_LABEL_VARIANTS` is the extension point for new display styles (mirrors
`MATCH_MODE_REGISTRY`): `chip` renders the literal tag string, `row` renders
the pretty uppercase block-row style (registry modifier prefixes, `_`/`-` as
spaces). Truncation measures the transformed text, so budgets are exact for
what renders. `truncateMiddle` is the plain-text sibling (middle ellipsis);
`computeCharBudget` is the pure math behind the `useCharBudget` hook.

---

## Constants

### `src/constants/truncation.js`

```js
parseTruncationConfig(ymlText: string): TruncationConfig   // throws on invalid config
TRUNCATION_CONFIG: TruncationConfig                        // parsed once at module init, deep-frozen
```

Build-time loader for `config/truncation.yml` — the contract for the text
display library (number shorthand table, `<PRE>`/`<TAG>`/`<TAGS>`/`<VAL>`
placeholder strings, char-budget parameters). The YAML is inlined via Vite's
`?raw` import; there is no runtime fetch. Validation is fail-fast at module
init: tiers must be non-empty and strictly ascending, all four placeholders
present, font ratios positive, every component entry complete.

```ts
interface TruncationConfig {
  numberShorthand: {
    significantFigures: number;               // display precision (3 → 1.42K)
    overflow: string;                          // rendered past the last tier ("NaN")
    tiers: { threshold: number, suffix: string }[];   // ascending (1000 "K", 1e6 "M", 1e9 "B")
  };
  placeholders: { prefix: string, segment: string, segments: string, value: string };
  charBudget: {
    fonts: { [font: string]: number };         // average glyph width / font-size
    minChars: number;                          // lower clamp on computed budgets
    components: { [component: string]: { font: string, allowancePx: number, fallbackChars: number } };
  };
}
```

---

## Hooks

### `usePlayClock()` → `{ start, stop, advance }`

| Method | Description |
|--------|-------------|
| `start()` | Begin the game loop (interval + RAF) |
| `stop()` | Halt the game loop |
| `advance()` | Fire one tick manually (step button) |

### `usePresets(config)` → `PresetLibrary`

| Field | Type | Description |
|-------|------|-------------|
| `presets` | `Preset[]` | Merged `[...standard, ...user]` |
| `ready` | `boolean` | False while bundled presets are fetching |
| `addBlank()` | `() => Preset` | Create and append a blank user preset |
| `addPreset(preset)` | `(p) => Preset` | Append arbitrary preset to user pool |
| `updatePreset(id, changes)` | `(id, changes) => void` | Patch a user preset |
| `deletePreset(id)` | `(id) => void` | Remove a user preset |
| `importPresets(raw)` | `(raw[]) => Preset[]` | Bulk-import and normalize entries |

The `config` parameter must conform to the `LibraryConfig` shape defined in `src/constants/libraries.jsx`.

### `usePressHoldDrag({ onClick, onAdjust })` → `{ holding, onPointerDown }`

| Field | Type | Description |
|-------|------|-------------|
| `holding` | `boolean` | True once hold threshold is reached |
| `onPointerDown` | `PointerEventHandler` | Attach to the element's `onPointerDown` |

Fires `onClick()` on quick release. Fires `onAdjust(delta)` (integer steps) during vertical drag after hold threshold.

### `useAssetGroup(urls: string[])` → `{ isReady: boolean, readySet: Set<string> }`

Local (not global) load gate for modal-scoped image grids. Tracks readiness **per URL** rather than all-or-nothing: `readySet` holds every URL that has loaded or errored, and `isReady` is true once all URLs have settled. Cached images resolve synchronously via `img.complete`.

The picker modals render every cell immediately and consult `readySet.has(url)` to reveal each thumbnail the moment its own image settles — so a single slow image or 404 no longer holds the whole grid behind a loading screen.

### `usePalette()`

Side-effect hook. Reads the stored palette name, applies it to `:root` CSS custom properties, and registers the background image URL with the global asset gate. No return value.

### `useRegisterAssets(urls: string[])`

Registers the URL list with `AssetProvider` once on mount. No return value.

### `useCharBudget(component: string)` → `{ ref, maxChars }`

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `(element) => void` | Attach to the **container** that constrains the text (e.g. a `.tag-list`) |
| `maxChars` | `number` | Character budget for text inside that container |

Derives dynamic character budgets for the text display library from the
container's measured width and computed font size, using the parameters of
the named `charBudget.components` entry in `config/truncation.yml`
(`'tag-chip'`, `'tag-row'`, `'text'`). One shared module-level ResizeObserver
serves all instances; re-renders only when the whole-character budget
changes. Returns `fallbackChars` until the first usable measurement and keeps
the last budget while hidden. Throws on an unknown component key.

---

## Shared Components

Reusable presentational components at the `src/components/` root.

### `<Tooltip content children disabled? delayMs? />`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `ReactNode` | — | Tooltip body; `null`/empty renders the child untouched |
| `children` | `ReactElement` | — | Single anchor element (cloned; no wrapper DOM node) |
| `disabled` | `boolean` | `false` | Render the child untouched |
| `delayMs` | `number` | `400` | Hover/focus delay before showing |

The app-standard tooltip (`role="tooltip"`, `aria-describedby` wiring). Shows
on hover and keyboard focus; hides on leave, blur, and Escape. Portals to
`document.body`, centered above the anchor, viewport-clamped, flipping below
when cramped (`.tooltip--below`). Width capped by the `--tooltip-max-width`
token with word wrap. Child event handlers are merged, never clobbered.
Native `title=` attributes should migrate to this component over time.

### `<TagLabel tag maxChars? variant? truncate? tooltip? shorthand? />`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tag` | `string` | — | Raw tag string (parsed internally) |
| `maxChars` | `number` | variant `fallbackChars` | Character budget, usually from `useCharBudget` |
| `variant` | `'chip' \| 'row'` | `'chip'` | Display style from `TAG_LABEL_VARIANTS` |
| `truncate` | `boolean` | `true` | Structural truncation toggle |
| `tooltip` | `boolean` | `true` | Tooltip-on-difference toggle |
| `shorthand` | `boolean` | `true` | Number shorthand on the value |

Canonical tag display: every component that shows a tag string renders it
through this. Runs the structural truncation ladder and wraps the label in a
Tooltip carrying the full raw tag whenever display differs from data
(collapse or shorthand); `.tag-string--truncated` adds the hover highlight
and `cursor: help`. The parent owns the surrounding chrome (`.tag` chip,
`.tag-content` row, active states, remove buttons). **Default-on contract:**
future tag-displaying components get safe text display for free and opt out
per prop.

> ⚠️ **Naming:** the component's CSS block is `.tag-string`, not
> `.tag-label` — that class was already taken by the section-heading style
> (`REQUIREMENTS`, `ATTRIBUTES`, …), which predates this component and is not
> a tag label. Renaming the heading class to `.section-label` would resolve
> the mismatch.

### `<TruncatedText text maxChars? truncate? tooltip? className? />`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `text` | `string` | — | Full display text |
| `maxChars` | `number` | `text` entry `fallbackChars` | Character budget, usually from `useCharBudget` |
| `truncate` | `boolean` | `true` | Truncation toggle |
| `tooltip` | `boolean` | `true` | Tooltip-when-truncated toggle |
| `className` | `string` | — | Extra classes for the span |

Plain-string counterpart to `TagLabel` for non-tag text (task names in chips,
item names): middle ellipsis via `truncateMiddle` plus the standard Tooltip
when truncated.

### `<EditableSpan value onCommit ... />`

Click-to-edit inline span used across cards and rows (pre-existing; see the
component's JSDoc for the full prop set).

---

## State Shape

```ts
interface GameState {
  session: {
    id: string;           // user-defined session identifier
    title: string;        // guild name shown in TopBar
    clock: number;        // total elapsed minutes
    timeStep: number;     // days per tick (e.g. 1)
    bank: number;         // gold balance
    rateMultiplier: number; // ticks-per-second multiplier
    workRate: number;     // base progress units per tick-day
    skillBonus: number;   // multiplier applied to a matched tag link's value
    logging: {            // event-log config — minimal stub (see note below)
      enabled: boolean;   // when false, advanceTime emits no event rows
      maxRows: number;    // FIFO retention cap for state.eventLog
    };
  };
  agents: Agent[];
  tasks: Task[];
  inventory: InventoryItem[];
  tagRegistry: TagRegistry; // nested keys-only tree
  eventLog: EventLogEntry[]; // append-only per-day progress log (FIFO-capped)
}

interface Agent {
  id: string;
  createdAt: number;
  lastAssigned: number | null;
  name: string;
  icon: string;           // URL
  rate: number;           // cost per day
  rateUnit: string;       // display label, e.g. 'GP/DAY'
  description: string;
  attributes: string[];   // tag strings (skills, abilities, traits…)
  activities: string[];   // task:<id>, item:<name>=<qty>, bind:[<slot>:]item:<name>
  xp: number;
  hp: number | null;      // null = use computed hpMax
}

interface Task {
  id: string;
  createdAt: number;
  name: string;
  description: string;
  requirements: string[]; // req,* and block,* tag strings
  attributes: string[];   // tag strings
  conditions: Condition[]; // progress subcategories; all must be satisfied to complete
  isComplete: boolean;
  results: {
    gold: number;
    items: { name: string; quantity: number }[];
    agents: { template: Partial<Agent>; quantity: number }[];
  };
}

interface ConditionTemplate {  // preset / builder form (no runtime fields)
  name: string;                // display label
  target: number;              // required progress total; > 0 (boolean = 1)
  tracker: {
    kind: string;              // key into TRACKER_REGISTRY; currently only 'work'
    tagPath: string | null;    // pattern matched (open mode) against agent attribute
                               // paths, e.g. 'skill:arcana', 'skill:*', 'skill:**';
                               // null = any agent
  };
}

interface Condition extends ConditionTemplate {
  id: string;                  // uid; keys progress accrual and DOM interpolation
  progress: number;            // current value; satisfied when >= target
}

interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  icon: string;
  description: string;
  value: number;          // gold value per unit (for selling)
  attributes: string[];   // tag strings; bonus,* tags provide bound-item bonuses
}

type TagRegistry = { [key: string]: TagRegistry }; // recursive keys-only tree

interface EventLogEntry {
  seq: number;          // monotonic id assigned at append (stable across FIFO trim)
  eventType: string;    // 'work_contribution' | 'task_complete'
  clock: number;        // in-game minutes this row represents (a day boundary)
  day: number;          // floor(clock / 1440), denormalized for readability
  agentId: string;      // contributing agent ('' for task_complete)
  agentName: string;
  taskId: string;
  taskName: string;
  conditionId: string;  // target condition ('' for task_complete)
  conditionName: string;
  delta: number;        // progress added this day to this condition (0 for completion)
  progress: number;     // resulting condition.progress snapshot (0 for completion)
  target: number;       // condition.target, denormalized (0 for completion)
  data: object;         // extension payload — work: {} ;
                        // task_complete: { isComplete, attributes, results }
}
```

> **Migration note:** `normalizeState` handles several schema changes from older saves: (1) `qty` → `quantity` on `InventoryItem` and `Task.results.items`/`agents`; (2) `session.timeStep` coerced from legacy string to `number`; (3) legacy `task.work` tags + `task.workProgress` buckets → `task.conditions` via `migrateLegacyWork` — `work=5` → tagPath `null`, `work:skill=8` → `'skill'`, `work:skill:arcana=10` → `'skill:arcana'`, with progress carried over from the matching bucket key; the deprecated `work` namespace is also pruned from stored tag registries. The storage key was bumped to `dnd-hirelings-state-v4`; `loadState` falls back to the v3 key. The quantity in `item:<name>=<qty>` activity tags is a tag-grammar value, not a field, and is unaffected. (4) `eventLog` is defaulted to `[]` for saves that predate the event-log feature; rows are guarded via `normalizeEvent` and any lacking a `taskId` are dropped. This is a backward-compatible additive field, so the storage key is **not** bumped.

> ⚠️ **Naming:** `session.workRate` and `session.skillBonus` predate the conditions system; the field names are kept for save compatibility. `workRate` is the base per-tick-day rate of every `'work'` tracker, and `skillBonus` multiplies the value of *any* matched tag link (not just skills).
