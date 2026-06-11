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
| `tagBuilderProps` | `TagBuilderProps \| null` | Non-null when TagBuilderModal is open |
| `openTagBuilder` | `(props: TagBuilderProps) => void` | Open the tag builder modal |
| `closeTagBuilder` | `() => void` | Close the tag builder modal |
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
| `tagRegistryProps` | `{} \| null` | Non-null when TagRegistryModal is open |
| `openTagRegistry` | `() => void` | Open tag registry modal |
| `closeTagRegistry` | `() => void` | Close tag registry modal |

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
| `AGENT_ADD_ATTRIBUTE` | `{ id, tag: string }` | Add/replace attribute tag (deduplicates by path) |
| `AGENT_REMOVE_ATTRIBUTE` | `{ id, index: number }` | Remove attribute by index |
| `AGENT_ADD_ACTIVITY` | `{ id, tag: string }` | Add activity tag (task assignment or item grant) |
| `AGENT_REMOVE_ACTIVITY` | `{ id, tag: string }` | Remove exact activity tag |
| `AGENT_GIVE_ITEM` | `{ id, itemName: string, quantity: number }` | Move quantity of item from inventory to agent's bag |
| `AGENT_RETURN_ITEM` | `{ id, itemName: string }` | Move all of item from agent's bag back to inventory |
| `AGENT_EQUIP_ITEM` | `{ id, itemName: string, slot: string }` | Move item from bag to equipped slot |
| `AGENT_UNEQUIP_ITEM` | `{ id, slot: string, itemName: string }` | Move item from equipped slot back to bag |

### Tasks

| Action | Fields | Description |
|--------|--------|-------------|
| `TASK_CREATE` | `{ preset?: TaskPreset }` | Create task from blank or preset |
| `TASK_UPDATE` | `{ id, changes: Partial<Task> }` | Patch task fields |
| `TASK_DELETE` | `{ id }` | Delete task; removes all agent assignments |
| `TASK_DUPLICATE` | `{ id }` | Deep-copy task; resets progress and completion |
| `TASK_SET_COMPLETE` | `{ id, isComplete: boolean }` | Complete (runs `applyTaskComplete`) or un-complete a task |
| `TASK_ADD_TAG` | `{ id, field: 'requirements'\|'work'\|'attributes', tag: string }` | Append tag to task field |
| `TASK_REMOVE_TAG` | `{ id, field, index: number }` | Remove tag by index from task field |
| `TASK_UPDATE_RESULTS` | `{ id, changes: Partial<Task['results']> }` | Patch task result fields |

### Inventory

| Action | Fields | Description |
|--------|--------|-------------|
| `INVENTORY_ADD` | `{ preset?: ItemPreset }` | Add item from blank or preset |
| `INVENTORY_UPDATE_ITEM` | `{ id, changes: Partial<InventoryItem> }` | Patch item; renaming triggers quantity merge if name collides |
| `INVENTORY_REMOVE_ITEM` | `{ id }` | Delete item from inventory |
| `INVENTORY_ADD_ATTRIBUTE` | `{ id, tag: string }` | Add/replace attribute tag on item |
| `INVENTORY_REMOVE_ATTRIBUTE` | `{ id, index: number }` | Remove attribute by index from item |

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
| `APPLY_TICK` | `{ newState: GameState }` | Replace state with a pre-computed tick result |
| `REPLACE_STATE` | `{ newState: object }` | Load external state; runs through `normalizeState()` |
| `RESET` | — | Reset to `DEFAULT_STATE` |

---

## Logic Functions

### `src/logic/tags.js`

```js
parseTag(s: string): { modifier: string|null, segments: string[], value: string|null }
buildTag(segments: string[], value?: string|null, modifier?: string|null): string
tagMatches(tag: ParsedTag, prefix: { segments: string[] }): boolean
mergeAttribute(attrs: string[], tag: string): string[]
formatTagLabel(parsed: ParsedTag): { label: string, params: string }
```

> ⚠️ **Naming:** The `parseTag` parameter is named `s` — a single letter with no type signal. `tagString` or `rawTag` would be self-documenting, especially since this function is the codebase's primary entry point for tag handling. Similarly, internal loop variables throughout `tags.js` use `s` for raw string and `p` for the parsed result; both should be more descriptive.

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
getEquippedItems(activities: string[]): { slot: string, name: string, tag: string }[]
collectAllHeldItems(activities: string[]): { [name: string]: number }
getEffectiveAttributes(agentAttributes: string[], activities: string[], inventory: InventoryItem[]): string[]
mergeItemQty(activities: string[], name: string, delta: number): string[]
```

### `src/logic/tasks.js`

```js
getWorkRequirements(task: Task): ParsedTag[]
checkTaskComplete(task: Task): boolean
applyResults(task: Task, inventory: InventoryItem[], agents: Agent[]): { newInventory, newAgents, bankDelta }
applyTaskComplete(taskId: string, tasks: Task[], agents: Agent[], inventory: InventoryItem[]): { newTasks, newAgents, newInventory, bankDelta }
computeBlockedTaskIds(activeTasks: Task[], inventory: InventoryItem[]): Set<string>
```

### `src/logic/clock.js`

```js
getStepMinutes(session: Session): number
getPlayIntervalMs(session: Session): number
advanceTime(state: GameState): { newState: GameState, flashAgentIds: string[], taskWorkPerTick: object }
updateClockDisplayDOM(state: GameState, tickInfo: TickInfo): void
```

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
flattenRegistry(registry: TagRegistry, expanded: Set<string>): RegistryRow[]
tagRegistrySave(registry: TagRegistry, sessionId: string): Promise<void>
tagRegistryLoad(file: File): Promise<TagRegistry>
```

### `src/logic/session.js`

```js
saveStateToFile(state: GameState): Promise<void>
loadStateFromFile(file: File): Promise<GameState>
```

### `src/logic/presets.js`

```js
savePresetToFile(preset: object, type?: string): Promise<void>
savePresetListToFile(presets: object[], type?: string): Promise<void>
loadPresetsFromFile(file: File): Promise<object[]>
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
    workRate: number;     // base work units per tick-day
    skillBonus: number;   // multiplier applied to skill-derived work
  };
  agents: Agent[];
  tasks: Task[];
  inventory: InventoryItem[];
  tagRegistry: TagRegistry; // nested keys-only tree
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
  activities: string[];   // task:<id>, item:<name>=<qty>, equip:<slot>:item:<name>
  xp: number;
  hp: number | null;      // null = use computed hpMax
}

interface Task {
  id: string;
  createdAt: number;
  name: string;
  description: string;
  requirements: string[]; // req,* and block,* tag strings
  work: string[];         // work:* tag strings with =<target> values
  attributes: string[];   // tag strings
  workProgress: { [workKey: string]: number };
  isComplete: boolean;
  results: {
    gold: number;
    items: { name: string; quantity: number }[];
    agents: { template: Partial<Agent>; quantity: number }[];
  };
}

interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  icon: string;
  description: string;
  value: number;          // gold value per unit (for selling)
  attributes: string[];   // tag strings; bonus,* tags provide equipment bonuses
}

type TagRegistry = { [key: string]: TagRegistry }; // recursive keys-only tree
```

> **Migration note:** `quantity` (on `InventoryItem` and `Task.results.items`/`agents`) and the numeric `session.timeStep` are persisted to localStorage. `normalizeState` reads the legacy `qty` field and legacy string `timeStep` values as fallbacks, so older saves load cleanly. The quantity in `item:<name>=<qty>` activity tags is a tag-grammar value, not a field, and is unaffected.
