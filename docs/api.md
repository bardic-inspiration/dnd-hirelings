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

Mostly ephemeral UI state. The one persisted slice is card expansion (see below);
everything else resets on refresh. All fields below are part of the returned object.

| Field | Type | Description |
|-------|------|-------------|
| `selectedTaskId` | `string \| null` | Currently selected task |
| `setSelectedTaskId` | `(id: string \| null) => void` | Select or deselect a task |
| `selectedItemId` | `string \| null` | Currently selected inventory item |
| `setSelectedItemId` | `(id: string \| null) => void` | Select or deselect an item |
| `isExpanded` | `(type: 'agent' \| 'task' \| 'item', id: string) => boolean` | Whether a card is expanded, resolving its type's default (agents expand by default; tasks/items collapse by default) |
| `toggleExpanded` | `(type: 'agent' \| 'task' \| 'item', id: string) => void` | Toggle a card's expand/collapse state; **persisted** to localStorage (survives refresh) |
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

> **Card expansion:** `isExpanded`/`toggleExpanded` back all three card types (agents, tasks, items) through one persisted store in `UIContext`. Only IDs toggled *away* from their type's default are stored (`STORAGE_KEYS.CARD_EXPANSION`), so the payload stays bounded to user actions. Per-type defaults live in `CARD_DEFAULT_EXPANDED` (UIContext) — add a card type there to extend the store.
>
> ⚠️ **Needs clarification:** The deviation Sets retain IDs of deleted entities (harmless, but grows unbounded over the app's lifetime). Pruning is deferred because `UIContext` has no access to the live entity list; a future reducer-side or startup reconciliation could clear orphaned IDs.

### `useConfig()` → `ConfigContext`

Runtime config documents (see `docs/architecture.md` → "Runtime Configuration
System"): the fetched base YAML of every `kind: 'file'` entry in
`CONFIG_FILES`, shadowed by a per-file user-edit overlay persisted under
`STORAGE_KEYS.CONFIG_OVERLAYS`.

| Field | Type | Description |
|-------|------|-------------|
| `getDoc` | `(id: string) => object` | The raw merged document: `overlay ?? base ?? {}` |
| `updateDoc` | `(id: string, nextDoc: object) => void` | Replace the overlay (whole-document); **persisted** |
| `resetDoc` | `(id: string) => void` | Drop the overlay, reverting to the deployed file |
| `isOverridden` | `(id: string) => boolean` | Whether an overlay currently shadows the base |

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
| `AGENT_CREATE` | `{ preset?: AgentPreset, count?: number, locked?: boolean }` | Create `count` agents (default 1) from blank or preset. `count > 1` is the library's shopping-list order (issue #92). `locked: true` blocks (no-op) when the preset carries unregistered tags; otherwise preset tags register on create |
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
| `TASK_CREATE` | `{ preset?: TaskPreset, count?: number, locked?: boolean }` | Create `count` tasks (default 1) from blank or preset. Locked-mode gate and creation-time registration as `AGENT_CREATE`, covering requirements, attributes, and condition tag paths |
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
| `INVENTORY_ADD` | `{ preset?: ItemPreset, count?: number, locked?: boolean }` | Add an item from blank or preset. Locked-mode gate and creation-time registration as `AGENT_CREATE`. `count` (default 1) stacks that many packs of the preset's own `quantity` into one row (a shopping-list order of `count` — issue #92). Then stacks onto an existing row with the same name **and** the same tag set (issue #91). Differing tags → a separate row; unnamed `NEW ITEM` placeholders never stack |
| `INVENTORY_UPDATE_ITEM` | `{ id, changes: Partial<InventoryItem> }` | Patch item; an identity change (name **or** attributes) re-normalizes the inventory via `mergeInventoryByIdentity`, so an item edited to match another row stacks onto it (issue #91). Other field edits skip the merge |
| `INVENTORY_REMOVE_ITEM` | `{ id }` | Delete item from inventory |
| `INVENTORY_REMOVE_ATTRIBUTE` | `{ id, index: number }` | Remove attribute by index from item; re-normalizes the inventory, so an item left matching another row stacks onto it (issue #91) |
| `ITEM_PLACE` | `{ target: { type: 'agent'\|'bank', id? }, itemId: string, quantity?: number }` | Draw `quantity` (default 1, clamped to stock) of a selected item from inventory and route it: `agent` gives into the agent's bag (`mergeItemQty`); `bank` sells it (value × qty → gold). The single click-highlight-assign path shared by give (AgentCard) and sell (BankPanel). Depleted items stay in the list (grayed) |

### Tags

| Action | Fields | Description |
|--------|--------|-------------|
| `TAG_APPLY` | `{ target: { type: 'agent'\|'task'\|'item', id }, tag: string }` | Apply a tag to any board entity; the single assignment path for the registry's APPLY button and selection mode. Tasks route by modifier (`routeTaskTag`: `req`/`block` → `requirements`, else `attributes`). Every entity dedupe-merges into its target field (`mergeAttribute`): one instance per tag string, incoming value wins (issue #82). Applying to an item re-normalizes the inventory, so an item whose new tag makes it match another row stacks onto it (issue #91). Registers the tag's path |

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
| `APPLY_ROLLBACK` | `{ newState: GameState }` | Replace state with a pre-computed `rollbackTick` result (reverted tick group truncated off `eventLog`) |
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
```

Tag display formatting lives in `src/logic/truncation.js` (the `row` variant
absorbed the retired `formatTagLabel`); components render tags through
`<TagLabel>`.

### `src/logic/tagMatching.js`

```js
MATCH_MODE_REGISTRY: { [mode: string]: (pattern, segments, options?) => boolean }
matchTagPath(patternPath: string|string[], tagSegments: string[], options?: { mode?: 'exact'|'numbered'|'open', depth?: number }): boolean
VALUE_COMPARE_REGISTRY: { [operator: string]: (tagValue, compareValue) => boolean }  // '==', '>=', '<=', '>', '<'
matchTagValue(compare: { op: string, value: string }|null, value: *): boolean  // null compare always passes
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

`matchTagValue` applies a structured comparison term to a tag's resolved value
(the term is kept separate from the pattern string, so operator parsing never
interacts with wildcard escapes). `'=='` is case-insensitive string equality;
the ordered operators compare numerically and fail closed when either side is
non-numeric. Available to any pattern consumer; only condition tag links wire
it up today, feeding it `display`-resolved values (see `tagValues.js`).

### `src/logic/tagValues.js`

```js
VALUE_RESOLVER_REGISTRY: { [useCase: string]: (parsedTag, registry) => * }  // 'match', 'display', 'numeric'
resolveTagValue(useCase: string, parsedTag: ParsedTag, registry: TagRegistry): *  // unknown use case → null
getRegistryNode(registry: TagRegistry, segments: string[]): TagRegistry|undefined
isRegisteredLeaf(registry: TagRegistry, segments: string[]): boolean
```

Registry-bounded value resolvers (see `docs/architecture.md` → Tag-based
Attribute System). A tag's implied value varies by use case; each resolver owns
its own default, so new use cases add an attachment here — never a registry or
data-schema change:

| resolver  | explicit `=value` | leaf-terminal tag (no `=`)                | otherwise |
|-----------|-------------------|-------------------------------------------|-----------|
| `match`   | the value         | `true` (presence)                         | `true`    |
| `display` | the value         | last segment, **registered leaf only**    | `null`    |
| `numeric` | `Number()` if finite, else `null` | `null` — leaf strings never coerce | `null` |

The `display` resolver is strict: no registry supplied, an unregistered
terminal, or a registered non-leaf (structural reference) all resolve `null`.
`getRegistryNode` / `isRegisteredLeaf` are the shared registry-reading supports
the resolvers compose from.

### `src/logic/expressions.js`

```js
EXPRESSION_FUNCTIONS: { [name: string]: { arity?: number, variadic?: boolean, apply: (...args) => number } }
parseExpression(source: string): { ast: AstNode|null, error: string|null }   // never throws
evaluateExpression(ast: AstNode, resolveReference: (path: string) => number): number
collectReferences(ast: AstNode): string[]   // unique lowercase ref paths, first-appearance order
```

Arithmetic engine for `dyn,` tag payloads. Operators `+ - * / %` and parens;
functions `floor ceil round sqrt min max` (`EXPRESSION_FUNCTIONS` is the
extension point); tag references are brace-wrapped paths (`{ability:dex}`,
wildcards allowed: `{class:*}`). Bare identifiers are parse errors unless they
are function calls. Parsing is context-free — reference resolution and
defaulting policy live in the caller (`logic/dynamicTags.js`), which injects
`resolveReference`. Non-finite results (division by zero) propagate to the
caller.

### `src/logic/dynamicTags.js`

```js
evaluateDynamicTags(effectiveAttributes: string[], registry: TagRegistry): Map<string, DynResult>
collectDynTagWarnings(state: GameState): Map<string, string[]>  // lowercase path → deduped messages
// DynResult: { value: number|null, exprValue: number|null, expression: string,
//              valid: boolean, warnings: string[] }
```

Evaluates every `dyn,` tag in an attribute list (entity-generic: agents pass
effective attributes, items their attributes, tasks attributes+requirements).
Resolution policy: literal refs read the same object's tags (`numeric`
resolver); wildcard refs sum matching plain tags (open-mode glob);
undefined/invalid/non-numeric refs default to 1 with a warning; dyn→dyn
chains evaluate in dependency order with cycles collapsing to 1; a plain tag
at a dyn path ADDS to the expression result (`value = exprValue + plain`),
which is how bound-item `bonus,` injections stack onto computed stats.
`valid: false` only on parse errors (element renders `--invalid`); warnings
with `valid: true` render the warn state. `collectDynTagWarnings` feeds the
registry modal's row flags.

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
firstFreeSlot(slots: string[], boundItems: { slot: string|null }[]): string|null  // first unoccupied configured bind slot, else null
collectAllHeldItems(activities: string[]): { [name: string]: number }
getEffectiveAttributes(agentAttributes: string[], activities: string[], inventory: InventoryItem[]): string[]
mergeItemQty(activities: string[], name: string, delta: number): string[]
```

### `src/logic/tasks.js`

```js
routeTaskTag(tagString: string): 'requirements' | 'attributes'  // by the modifier's MODIFIER_REGISTRY taskField
checkTaskComplete(task: Task, clockAdvanced?: boolean): boolean
applyResults(task: Task, inventory: InventoryItem[], agents: Agent[]): { newInventory, newAgents, bankDelta, spawnedAgentIds }
applyTaskComplete(taskId: string, tasks: Task[], agents: Agent[], inventory: InventoryItem[]): { newTasks, newAgents, newInventory, bankDelta, spawnedAgentIds, unassignedAgentIds }
computeBlockedTaskIds(activeTasks: Task[], inventory: InventoryItem[]): Set<string>
```

### `src/logic/conditions.js`

```js
TRACKER_REGISTRY: { [kind: string]: (condition, context) => number }
computeConditionContribution(condition: Condition, context: { effectiveAttributes, session, stepDays, registry }): number
defaultConditionName(tagPath: string|null, compare?: { op, value }|null): string
formatConditionLink(tracker: ConditionTracker|null): string  // 'any agent' | pattern label [+ ' ≥ 3']
createConditionTemplate(input: { name?, target?, tagPath?, kind?, compare? }): ConditionTemplate
splitConditionDraft(draft: string): { path, compare: { op, value }|null, target }  // 'path[op value][=target]', escape-safe
conditionTemplateFromDraft(draft: string): ConditionTemplate  // splitConditionDraft + createConditionTemplate guards
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

A tracker may carry a `compare: { op, value }|null` term applied to each
path-matched tag's `display`-resolved value inside the match search (so a
wildcard link selects the first *qualifying* tag). Draft grammar:
`path[op value][=target]` with the last `=` reserved for the completion target
— bare equality is spelled `==` (`'skill:arcana>=3=30'`, `'class==druid=30'`).
Conditions stored before the field normalize to `compare: null` on load.

### `src/logic/clock.js`

```js
getPlayIntervalMs(session: Session, clockConfig?: ClockConfig): number
advanceTime(state: GameState, options?: { count?: number, rollbackConfig?: RollbackConfig }): { newState: GameState, flashAgentIds: string[], taskProgressPerTick: { [taskId]: { [conditionId]: number } } }
updateClockDisplayDOM(state: GameState, tickInfo: TickInfo): void
```

The clock's base unit is the tick (one tick = one day); `session.clock` is an
integer tick count and the simulation never touches the calendar. `advanceTime`
advances `count` ticks (default `session.timeStep`) by looping an internal
single-tick simulation, so the event log stays tick-level regardless of how many
ticks a call spans — the play loop passes `count: 1`, the step-forward button
`count: session.timeStep`. `getPlayIntervalMs` is `max(minTickIntervalMs,
msPerTick / rateMultiplier)`, independent of step size. When
`rollbackConfig.log.enabled`, each tick appends to `newState.eventLog`: one
`work_contribution` entry per (agent, condition), one `task_complete` entry per
task finishing that tick, and one `'tick'` boundary entry sealing it (`work* →
task_complete* → tick`). A 10-tick step therefore logs 10 tick groups. See
`eventLog.js`.

### `src/logic/clockConfig.js`

```js
DEFAULT_CLOCK_CONFIG  // { calendar: { daysPerYear }, timeStep: { min, max },
                      //   rateMultiplier: { min, max }, realTime: { msPerTick, minTickIntervalMs } }
CLOCK_SCHEMA          // config-editor schema for public/config/clock.yml
normalizeClockConfig(doc: object): ClockConfig   // lenient per-field guard, min<=max enforced
```

### `src/logic/rollback.js`

```js
DEFAULT_ROLLBACK_CONFIG  // { enabled, reverse: { workProgress, wages, taskCompletion, rewardGold,
                         //   rewardItems, spawnedAgents, agentReassignment }, log: { enabled, maxRows } }
ROLLBACK_SCHEMA          // config-editor schema for public/config/rollback.yml
normalizeRollbackConfig(doc: object): RollbackConfig
getRollbackHorizon(eventLog: EventLogEntry[]): { canStepBack: boolean, earliestClock: number|null }
rollbackTick(state: GameState, rollbackConfig?: RollbackConfig): { newState: GameState } | null
rollbackTime(state: GameState, options?: { count?: number, rollbackConfig?: RollbackConfig }): { newState: GameState } | null
```

`rollbackTick` is the pure inverse of one tick (`advanceTick`): it reverses the
most recent `'tick'` group in strict LIFO order (switchboard-gated, best-effort
with clamps), decrements the clock by one, and truncates the group off the log.
Returns `null` at the horizon (no `'tick'` boundary in the log). `rollbackTime`
is the symmetric inverse of `advanceTime`: it loops `rollbackTick` `count` times
(default `session.stepBack`), stopping at the horizon (see `usePlayClock`'s
`retreat`).

### `src/logic/tagsConfig.js`

```js
DEFAULT_TAGS_CONFIG   // { locked: false } (frozen)
TAGS_SCHEMA           // config-editor schema for public/config/tags.yml
normalizeTagsConfig(doc: object): TagsConfig  // locked true only on explicit boolean true
```

The `locked` switch governs creation-time tag entry (see `docs/gotchas.md` →
Locked Tags Gate Creation Only): locked mode validates every new entity's tags
against the live tag registry and blocks creation on unregistered tags;
unlocked mode (the default) registers them on creation.

### `src/logic/UI.js`

Pure tier of the configurable card element system (config: `public/config/UI.yml`).

```js
EMPTY_CARD_CONFIG   // frozen { medallion: null, boxes: [], bars: [], fields: [], values: [], slots: [] }
AGENT_FIELD_SOURCE_KEYS   // frozen list of known bare agent-field sources
UI_SCHEMA            // config-editor schema descriptor for UI.yml
normalizeUIDoc(doc: object): { cards: { [cardName]: CardConfig } }
parseUIConfig(ymlText: string): { cards: { [cardName]: CardConfig } }  // yaml.load + normalize
resolveTagSource(source: string, context: { agent, dynamics, attributes, registry }): {
  label: string,            // last path segment, uppercased
  value: number|null,
  valid: boolean,           // false → element renders empty in warning state
  set: ((value) => changes)|null,   // AGENT_UPDATE changes when writable
  unitField: string|null,   // editable unit sibling field (e.g. 'rateUnit')
  warn: boolean             // dyn value evaluated with defaulted refs/cycles → warn state
}
getConsumedTagPaths(cardConfig: CardConfig): Set<string>  // lowercase seg:seg paths
isTagConsumed(tag: string, consumedPaths: Set<string>): boolean  // plain + dyn tags
```

Source grammar (resolution order): bare agent field (`rate`); a path carrying
a `dyn,` tag on the agent (computed value from `evaluateDynamicTags` —
read-only, `set: null`; `context.dynamics` is that evaluation's Map); else an
attribute tag path matched case-insensitively against the agent's effective
attributes, resolved through the `numeric` value resolver (`tagValues.js` —
only an explicit numeric `=value` displays; leaf strings stay invalid).
`normalizeUIDoc` is lenient: malformed sections degrade to empty element
lists, and bar entries accept `[current, max]` lists or `"(current, max)"`
strings; `parseUIConfig` throws only on unparseable YAML.

### `src/logic/time.js`

A UI-only calendar mapping elapsed ticks (one tick = one day) to a year/day
label; the simulation never uses it.

```js
DEFAULT_CALENDAR  // { daysPerYear: 364 }
formatClockParts(totalTicks: number, calendar?: Calendar): { year: number, day: number }
clockTicksFromParts(year: number, day: number, calendar?: Calendar): number
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
collectPresetTags(entityType: 'agent'|'task'|'item', preset?: object): { literalTags: string[], patternPaths: string[] }
unregisteredEntityTags(registry: TagRegistry, entityType: 'agent'|'task'|'item', preset?: object): string[]
flattenRegistry(registry: TagRegistry, expanded: Set<string>): RegistryRow[]
tagRegistrySave(registry: TagRegistry, sessionId: string): Promise<void>
tagRegistryLoad(file: File): Promise<TagRegistry>
```

`collectPresetTags` gathers the authored tags a create-action preset would
bring into play (agent/item `attributes`; task `requirements` + `attributes` +
condition `tracker.tagPath`s), classifying wildcard/escaped strings as pattern
paths and skipping dynamic instance tags (`task:…`, `bind:…`).
`unregisteredEntityTags` returns the tags the registry does not allow —
literals via `pathExists` on the stripped segment path, patterns via
`patternMatchesRegistry` — and is shared by the library pre-check and the
reducer's locked-mode backstop so the two cannot disagree.

### `src/logic/configRegistry.js`

The config file manifest — the single registration point for every surface the
Configuration Modal edits. Adding a config file = one `CONFIG_FILES` entry +
one schema.

```js
CONFIG_FILES  // ordered manifest entries:
// { id, label, kind: 'file'|'state', url?, schema,
//   binding?: { select(state), commit(dispatch, key, value),
//               effects?: { [key]: effectName }, defaults } }
SESSION_SCHEMA                    // schema for the state-bound SESSION section
configFileById(id: string): object|null
```

Registered file entries: `clock` (`public/config/clock.yml`, schema in
`clockConfig.js`), `rollback` (`public/config/rollback.yml`, schema in
`rollback.js`), `tags` (`public/config/tags.yml`, schema in `tagsConfig.js`),
and `ui` (`public/config/UI.yml`, schema in `UI.js`).

`kind: 'file'` entries are fetched/overlaid by `ConfigContext`; `kind: 'state'`
entries bind to game state through `binding` (no fetch, no overlay). `effects`
maps keys to effect *names* the modal resolves to callbacks (e.g.
`rateMultiplier: 'restartPlay'` → the `onRestartPlay` prop).

### `src/logic/configEditor.js`

Pure logic tier behind the Configuration Modal: schema-guided flattening,
soft validation, immutable document mutations, and YAML file I/O over raw
config documents. The schema descriptor grammar is documented in the module
header and `docs/architecture.md` → "Runtime Configuration System".

```js
schemaChild(schemaNode: object|null, keyOrIndex: string|number): object|null
schemaNodeAt(schema: object|null, path: (string|number)[]): object|null
VALUE_KINDS   // { string, number, boolean, slug, enum, tagSource } — each { suggest(prefix, schemaNode, context), check(value, schemaNode, context) }
coerceScalarInput(raw: string, schemaNode: object|null): string|number|boolean|null
flattenConfigDoc(doc: object, schema: object|null, expanded: Set<string>): ConfigRow[]
checkConfigDoc(doc: object, schema: object|null, context?: { tagRegistry }): Map<string, string>  // pathStr → warning
getAt(doc: object, path: (string|number)[]): any
setValueAt(doc: object, path: (string|number)[], value: any): object   // new root
deleteAt(doc: object, path: (string|number)[]): object                  // new root
appendItemAt(doc: object, path: (string|number)[], item: any): object   // new root
emptyValueFor(schemaNode: object|null): any
serializeConfigDoc(doc: object): string          // yaml.dump + generated header
configSave(fileId: string, doc: object): Promise<void>   // via downloadFile, <fileId>.yml
configLoad(file: File): Promise<object>          // rejects only bad YAML / non-mapping root
```

`flattenConfigDoc` preserves insertion order (config order is meaningful),
unlike `flattenRegistry`'s sorted walk — the two flatteners are deliberately
separate. `checkConfigDoc` warnings are advisory: nothing is removed or
blocked. Mutations return new roots and no-op by returning the same reference.

### `src/logic/download.js`

```js
downloadFile(contents: string | Blob, suggestedName: string,
             options?: { mime?: string, pickerTypes?: object[] }): Promise<void>
```

Shared file-write helper: native Save As dialog (File System Access API) with an
`<a>.download` fallback. Used by `session.js`, `eventLog.js`, `tagRegistry.js`,
`configEditor.js`, etc.

### `src/logic/session.js`

```js
saveStateToFile(state: GameState): Promise<void>
loadStateFromFile(file: File): Promise<GameState>
```

### `src/logic/eventLog.js`

```js
EVENT_LOG_COLUMNS: string[]          // CSV column order (single source of truth)
MAX_LOG_ROWS: number                 // default FIFO cap on the live log (50000)
makeWorkEvent({ seq, clock, agent, task, condition, delta, progress }): EventLogEntry
makeCompleteEvent({ seq, clock, task, spawnedAgentIds?, unassignedAgentIds? }): EventLogEntry
makeTickEvent({ seq, clock, wagesTotal, wages }): EventLogEntry
normalizeEvent(raw: object): EventLogEntry | null   // null if missing taskId (tick rows exempt)
capEventLog(eventLog: EventLogEntry[], maxRows?: number): EventLogEntry[]
serializeEventLog(eventLog: EventLogEntry[]): string                // → CSV
parseEventLog(csvText: string): EventLogEntry[]                     // ← CSV
saveEventLogToFile(eventLog: EventLogEntry[], sessionId: string): Promise<void>
loadEventLogFromFile(file: File): Promise<EventLogEntry[]>
```

Logging config (`enabled`, `maxRows`) lives in `public/config/rollback.yml`
(see `rollback.js`), not in session state.

### `src/logic/presets.js`

```js
savePresetToFile(preset: object, type?: string): Promise<void>
savePresetListToFile(presets: object[], type?: string): Promise<void>
loadPresetsFromFile(file: File): Promise<object[]>
```

### `src/logic/order.js`

```js
buildOrder(type: string, lines: { preset: object, quantity: number }[]): Order
submitOrder(order: Order, dispatch: (action) => void, config: LibraryConfig, options?: object): number
```

The library modal's shopping-list transport layer (issue #92). `buildOrder`
turns the modal's candidate rows into a serializable `Order`
(`{ type, lines: { preset, quantity }[] }`), keeping only rows with a positive
count, flooring quantities to whole copies, and stripping runtime bookkeeping
(`id`/`source`) from each line's preset so the document resembles the preset
files the library already reads and writes. `submitOrder` is the **sole**
coupling between an order and the reducer: it dispatches one `config.toCreateAction(preset, quantity)`
per line, spreading `options` (dispatch-time policy such as `{ locked }` —
never order content) onto each action. The `Order` shape is deliberately
endpoint-agnostic — retargeting it to a server backend later means replacing
only `submitOrder`, not the modal.

### `src/logic/format.js`

```js
formatNumberShorthand(value: number, config?: NumberShorthandConfig): string
formatGold(value: number, config?: NumberShorthandConfig): string
formatCount(value: number | string, config?: NumberShorthandConfig): string
formatCountFit(value: number | string, maxChars?: number, config?: NumberShorthandConfig): string
```

Table-driven number shorthand (`1.42K`, `56.5K`, `1.25M`, `6.00B`; three
significant figures). Below the first tier numbers render verbatim; rounding
that carries a mantissa to 1000 promotes it one tier (`999950` → `1.00M`).
Past the last tier, order-of-magnitude notation takes over at the same
precision when `exponent` is enabled (`7800000000000` → `7.80e12`, i.e.
7.8 × 10^12 — covers every representable number). The configured `overflow`
string (`"NaN"`) is the safeguard of last resort: it renders for anything no
notation can represent — NaN, ±Infinity, non-numbers, failed parses — and
for past-the-table values when `exponent` is disabled or absent. `formatGold`
keeps the bank's one-decimal display below the first tier and switches to
shorthand above it. `formatCount` is the general display helper for any count or
stat number that could overflow its UI slot (item quantities/values, agent
stats, condition progress/target, reward amounts — issue #93): numeric input
runs through `formatNumberShorthand`, while an empty or non-numeric string passes
through unchanged so an editable span keeps its raw/placeholder text. The default
table is `TRUNCATION_CONFIG.numberShorthand` (from `config/truncation.yml`); pass
a `config` to extend it (e.g. a `T` tier or a different exponent symbol) without
code changes. `formatCountFit` fits a count into a fixed-width slot (`CardMedallion`,
`StatBox` — issue #98) by re-rendering at progressively fewer significant figures
(`"1.42K"` → `"1.4K"` → `"1K"`) until the output is `<= maxChars`, flooring at 1
significant figure rather than chopping the string with an ellipsis.

### `src/logic/truncation.js`

```js
TAG_LABEL_VARIANTS: { [variant: string]: { modifierText, segmentText, valueText, modifierSeparator, segmentSeparator, valueSeparator } }
computeCharBudget({ widthPx, fontSizePx, charWidthRatio, allowancePx?, minChars?, fallbackChars }): number
truncateMiddle(text: string, maxChars: number): { text: string, truncated: boolean }
truncateEnd(text: string, maxChars: number): { text: string, truncated: boolean }
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
what renders. `truncateMiddle` and `truncateEnd` are the plain-text siblings —
middle ellipsis (keeps head and tail) and end ellipsis (keeps the leading
`maxChars-1`, e.g. agent names where the prefix identifies the string);
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
    exponent?: { enabled: boolean, symbol: string };  // past-the-table notation (7.80e12); absent = disabled
    overflow: string;                          // safeguard of last resort ("NaN"): non-finite, non-number, exponent disabled
    tiers: { threshold: number, suffix: string }[];   // ascending (1000 "K", 1e6 "M", 1e9 "B")
  };
  placeholders: { prefix: string, segment: string, segments: string, value: string };
  charBudget: {
    fonts: { [font: string]: number };         // average glyph width / font-size
    minChars: number;                          // lower clamp on computed budgets
    components: { [component: string]: { font: string, allowancePx: number, fallbackChars: number, minChars?: number } };
    // minChars, per component, overrides the top-level clamp above — used by
    // `stat-box` (issue #98), whose fixed 34px square needs a real ~3-4 char
    // floor rather than the shared text-oriented one.
  };
}
```

---

## Hooks

### `usePlayClock()` → `{ start, stop, advance, retreat }`

| Method | Description |
|--------|-------------|
| `start()` | Begin the game loop (interval + RAF) |
| `stop()` | Halt the game loop |
| `advance()` | Advance `session.timeStep` days manually (step-forward button) |
| `retreat()` | Pause, then reverse `session.stepBack` ticks via `rollbackTime` (step-back button); stops early at the horizon, no-op if already there |

Reads the live clock/rollback configs through refs; a clock config edit
restarts a running interval so pacing changes apply immediately.

### `useClockConfig()` → `ClockConfig`

Returns the live normalized clock configuration (deployed
`public/config/clock.yml` merged with any Configuration Modal overlay),
normalized via `normalizeClockConfig`.

### `useRollbackConfig()` → `RollbackConfig`

Returns the live normalized rollback configuration (deployed
`public/config/rollback.yml` merged with any overlay), normalized via
`normalizeRollbackConfig`.

### `useTagsConfig()` → `TagsConfig`

Returns the live normalized tag-system configuration (deployed
`public/config/tags.yml` merged with any overlay), normalized via
`normalizeTagsConfig`. Its `locked` flag is attached to the three create
actions at dispatch sites (the reducer cannot read config).

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

Side-effect hook. Applies the stored palette name to `:root` CSS custom properties on mount. The theme background is a decorative CSS background (`--bg-image`) preloaded in `index.html`, not a gated asset — it never blocks the app (issue #90). No return value.

### `useCharBudget(component: string)` → `{ ref, maxChars }`

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `(element) => void` | Attach to the **container** that constrains the text (e.g. a `.tag-list`) |
| `maxChars` | `number` | Character budget for text inside that container |

Derives dynamic character budgets for the text display library from the
container's measured width and computed font size, using the parameters of
the named `charBudget.components` entry in `config/truncation.yml`
(`'tag-chip'`, `'tag-row'`, `'text'`, `'agent-name'`, `'stat-box'`). One shared
module-level ResizeObserver serves all instances; re-renders only when the
whole-character budget changes. Returns `fallbackChars` until the first
usable measurement and keeps the last budget while hidden. Throws on an
unknown component key.

### `useUIConfig(cardName: string)` → `CardConfig`

Returns one card's element assignments (`{ medallion, boxes, bars, fields,
values, slots }`) from the live UI config document — the deployed
`public/config/UI.yml` merged with any Configuration Modal overlay, read
from `ConfigContext` and normalized via `normalizeUIDoc`. Because the
document lives in React state, in-app config edits re-render consumers
immediately. Until the base fetch settles — or if it fails, or the card has no
entry — returns `EMPTY_CARD_CONFIG`, so callers render unconditionally. A
failed fetch or unparseable file logs a `console.warn` and degrades to bare
cards.

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

All in-app hover hints go through this component (issue #73 migrated the last
native `title=` attributes). The sole intentional exception is `title` on
`<option>` elements (`TagRegistryModal`'s modifier picker): options render in
the OS-native dropdown, which a portal tooltip cannot anchor to. Wrapping an
`EditableSpan` is safe — it composes an injected `onFocus`/`onBlur` ahead of
its own select-all / commit handlers rather than letting them be clobbered.

### `<TagLabel tag maxChars? variant? truncate? tooltip? shorthand? onValueCommit? onReplace? />`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tag` | `string` | — | Raw tag string (parsed internally) |
| `maxChars` | `number` | variant `fallbackChars` | Character budget, usually from `useCharBudget` |
| `variant` | `'chip' \| 'row'` | `'chip'` | Display style from `TAG_LABEL_VARIANTS` |
| `truncate` | `boolean` | `true` | Structural truncation toggle |
| `tooltip` | `boolean` | `true` | Tooltip-on-difference toggle |
| `shorthand` | `boolean` | `true` | Number shorthand on the value |
| `onValueCommit` | `(value: string) => void` | — | Makes the **value** click-to-edit (issue #75); called with the edited value only when it round-trips cleanly (non-empty, grammar-safe) |
| `onReplace` | `() => void` | — | Makes the **tag string** double-click-to-replace; the host opens the Tag Registry to pick a replacement |

Canonical tag display: every component that shows a tag string renders it
through this. Runs the structural truncation ladder and wraps the label in a
Tooltip carrying the full raw tag whenever display differs from data
(collapse or shorthand); `.tag-string--truncated` adds the hover highlight
and `cursor: help`. The parent owns the surrounding chrome (`.tag` chip,
`.tag-content` row, active states, remove buttons). **Default-on contract:**
future tag-displaying components get safe text display for free and opt out
per prop.

**Editing (issue #75):** the tag *string* is never directly editable, only its
value. When `onValueCommit` is set, single-clicking the value swaps it for an
inline input (`.tag-value-input`); Enter/blur commits, Escape cancels, and an
edit that would corrupt the grammar (empty, or a value containing `,`) is
discarded — "invalid value → no change." When `onReplace` is set,
double-clicking the tag string fires it; double-clicking the value edits
instead (the value swallows its own `dblclick`). Hosts wire value commits as an
**in-place** array rewrite (order preserved) and replacement as remove-then-
`TAG_APPLY`. Wired on the Agent, Item, and Task board cards (`AgentCard` chips,
`ItemRow`, `TagRow`).

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

Click-to-edit inline span used across cards and rows (see the component's JSDoc
for the full prop set). While unfocused it shows the value passed through
`format` (identity by default; pass `formatCount` for compact numbers — issue
#93) and end-truncated to `maxChars` (`truncateEnd`); focus reveals the full raw
value for editing and blur re-formats/re-truncates. `singleLine` forbids line breaks — Enter always commits
(Shift+Enter included) and pasted/committed whitespace collapses to spaces — so
the name span stays one line and never distorts the card during entry.
`innerRef` forwards a ref onto the span (the agent name passes a `useCharBudget`
measuring ref so the span's own width sets its budget).

### Card elements (`src/components/Dashboard/AgentCardElements.jsx`)

The standard configurable card elements, each rendering one source string from
the UI config against a shared resolution `context`
(`{ agent, dynamics, attributes }`); see `src/logic/UI.js` for resolution.
An invalid source renders the element with no value in its `--invalid` state
(warning flash); a dyn value that evaluated with defaulted references or a
cycle renders in its `--warn` state (value shown, warn chrome); the native
`title` always exposes the assigned source.

```jsx
<CardMedallion source context />          // square badge beside the name; visible collapsed
<StatBox source context />                // square value box, rows of four above the bars
<StatBar current max context fillVariant /> // ratio bar; editable current when writable
<StatField source context />              // labelled editable value (+ unit for `rate`)
<StatValue source context />              // read-only "LABEL: value"
```

`StatBar`, `StatField` dispatch `AGENT_UPDATE` with the resolution's `set`
changes on commit; non-numeric input is ignored. Every displayed stat number
goes through `formatCount`, so large values render compactly (`1.42K`) instead
of spilling their slot (issue #93); editing an editable one reveals the raw value.
`CardMedallion` and `StatBox` are the exception: their fixed 34px square measures
its own width via `useCharBudget('stat-box')` and renders through `formatCountFit`
instead, reducing significant figures rather than `formatCount`'s fixed precision
when the shorthand output would otherwise overflow the box (issue #98).

---

## State Shape

```ts
interface GameState {
  session: {
    id: string;           // user-defined session identifier
    title: string;        // guild name shown in TopBar
    clock: number;        // elapsed ticks (one tick = one day)
    timeStep: number;     // ticks per forward step (e.g. 1)
    stepBack: number;     // ticks per backward step (independent of timeStep)
    bank: number;         // gold balance
    rateMultiplier: number; // play-speed multiplier (ticks per msPerTick)
    workRate: number;     // base progress units per tick
    skillBonus: number;   // multiplier applied to a matched tag link's value
  };
  agents: Agent[];
  tasks: Task[];
  inventory: InventoryItem[];
  tagRegistry: TagRegistry; // nested keys-only tree
  eventLog: EventLogEntry[]; // append-only per-tick progress log (FIFO-capped)
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
  attributes: string[];   // tag strings (skills, abilities, traits, xp=…/hp=… values, dyn,… expressions)
  activities: string[];   // task:<id>, item:<name>=<qty>, bind:[<slot>:]item:<name>
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
  eventType: string;    // 'work_contribution' | 'task_complete' | 'tick'
  clock: number;        // elapsed ticks this row represents (for 'tick', after the tick)
  agentId: string;      // contributing agent ('' for task_complete/tick)
  agentName: string;
  taskId: string;
  taskName: string;
  conditionId: string;  // target condition ('' for task_complete/tick)
  conditionName: string;
  delta: number;        // progress added this tick to this condition (0 for completion)
  progress: number;     // resulting condition.progress snapshot (0 for completion)
  target: number;       // condition.target, denormalized (0 for completion)
  data: object;         // extension payload — work: {} ;
                        // task_complete: { isComplete, attributes, results, spawnedAgentIds, unassignedAgentIds } ;
                        // tick: { wagesTotal, wages }
}
```

> **Migration note:** `normalizeState` handles several schema changes from older saves: (1) `qty` → `quantity` on `InventoryItem` and `Task.results.items`/`agents`; (2) `session.timeStep` / `session.stepBack` coerced to positive numbers and `session.clock` to a non-negative integer tick count; (3) legacy `task.work` tags + `task.workProgress` buckets → `task.conditions` via `migrateLegacyWork` — `work=5` → tagPath `null`, `work:skill=8` → `'skill'`, `work:skill:arcana=10` → `'skill:arcana'`, with progress carried over from the matching bucket key; the deprecated `work` namespace is also pruned from stored tag registries. The storage key was bumped to `dnd-hirelings-state-v6` (agent `xp`/`hp` fields became plain valued tags and dynamic stats became `dyn,` tags; pre-v6 saves are abandoned without migration — no legacy-key fallback remains). Stale agent `xp`/`hp` fields in imported session JSON are stripped on load. The quantity in `item:<name>=<qty>` activity tags is a tag-grammar value, not a field, and is unaffected. (4) `eventLog` is defaulted to `[]` for saves that predate the event-log feature; rows are guarded via `normalizeEvent` and any lacking a `taskId` are dropped.

> ⚠️ **Naming:** `session.workRate` and `session.skillBonus` predate the conditions system; the field names are kept for save compatibility. `workRate` is the base per-tick rate of every `'work'` tracker, and `skillBonus` multiplies the value of *any* matched tag link (not just skills).
