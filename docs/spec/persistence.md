# Persistence

The game-state shape, the reducer's action vocabulary, browser storage, and
the files the app reads and writes. Part of [`SPEC.md`](../../SPEC.md).

## State shape

```ts
interface GameState {
  session: {
    id: string;              // user-chosen session id
    title: string;           // guild name in the top bar
    clock: number;           // elapsed ticks, non-negative integer
    timeStep: number;        // ticks per step forward
    stepBack: number;        // ticks per step back (independent of timeStep)
    bank: number;            // gold
    rateMultiplier: number;  // play speed
    workRate: number;        // base progress per tick of every 'work' tracker
    skillBonus: number;      // multiplier on a matched tag link's value
  };
  agents: Agent[];
  tasks: Task[];
  inventory: InventoryItem[];
  tagRegistry: TagRegistry;
  eventLog: EventLogEntry[];
}

interface Agent {
  id: string; createdAt: number; lastAssigned: number | null;
  name: string; icon: string;           // icon: URL
  rate: number; rateUnit: string;       // wage per tick, display unit ('GP/DAY')
  description: string;
  attributes: string[];                 // authored tags
  activities: string[];                 // task:<id>, item:<name>=<qty>, bind:[<slot>:]item:<name>
}

interface Task {
  id: string; createdAt: number;
  name: string; description: string;
  requirements: string[];               // req,… and block,… tags
  attributes: string[];
  conditions: Condition[];              // all must be met to complete
  isComplete: boolean;
  results: {
    gold: number;
    items: { name: string; quantity: number }[];
    agents: { template: Partial<Agent>; quantity: number }[];
  };
}

interface ConditionTemplate {           // preset and builder form
  name: string;
  target: number;                       // > 0
  tracker: {
    kind: string;                       // TRACKER_REGISTRY key; 'work'
    tagPath: string | null;             // open-mode pattern; null = any agent
    compare: { op: string; value: string } | null;
  };
}

interface Condition extends ConditionTemplate {
  id: string;                           // keys accrual and DOM interpolation
  progress: number;
}

interface InventoryItem {
  id: string; name: string; quantity: number;
  icon: string; description: string;
  value: number;                        // gold per unit when sold
  attributes: string[];
}

type TagRegistry = { [key: string]: TagRegistry };   // keys-only tree

interface EventLogEntry {
  seq: number;              // monotonic id, stable across FIFO trims
  eventType: 'work_contribution' | 'task_complete' | 'tick';
  clock: number;            // ticks after the tick this row belongs to
  agentId: string; agentName: string;        // '' on task_complete / tick
  taskId: string; taskName: string;
  conditionId: string; conditionName: string; // '' on task_complete / tick
  delta: number;            // progress added this tick (0 otherwise)
  progress: number;         // resulting progress (0 otherwise)
  target: number;           // condition target, denormalized (0 otherwise)
  data: object;             // work: {}
                            // task_complete: { isComplete, attributes, results,
                            //                  spawnedAgentIds, unassignedAgentIds }
                            // tick: { wagesTotal, wages }
}
```

`Planned (#117):` the stored `Task` replaces `conditions` and `results` with
`operators`, `vessels`, `effects`, `blackboard`, and `duration`, and the log
gains two columns ([`task-engine.md`](task-engine.md) "Shapes").

**Loading normalizes** every state, from storage or a file, through
`normalizeState`, which:

- coerces `timeStep` and `stepBack` to positive numbers (falling back to 1) and
  `clock` to a non-negative integer;
- renames `qty` to `quantity` on items and results;
- converts legacy `work` tags and progress buckets into conditions
  (`work=5` → any-agent, `work:skill:arcana=10` → `skill:arcana`, progress
  carried over) and prunes the `work` namespace from the registry;
- defaults a condition's missing `compare` to `null` and a missing `eventLog`
  to `[]`, dropping log rows that lack a `taskId` (tick rows exempt);
- reads a legacy `tagLibrary` field as the registry when `tagRegistry` is
  absent;
- normalizes legacy tag spellings ([`tags.md`](tags.md) "Grammar");
- strips agent `xp` / `hp` fields and any `session.logging` field (logging is
  configured in `rollback.yml`).

## Actions

Game state changes only through these reducer actions (`INV-3`), dispatched
via `useGame().dispatch`. Each has a `type`; the other fields follow.

| Area | Action | Fields | Effect |
|---|---|---|---|
| Session | `SESSION_UPDATE` | `payload: Partial<Session>` | Merge into `session`. |
| Agents | `AGENT_CREATE` | `preset?, count?, locked?` | Create `count` agents ([`library.md`](library.md)); locked-mode gate. |
| | `AGENT_UPDATE` | `id, changes` | Patch fields. |
| | `AGENT_DELETE` | `id` | Delete; held items return to inventory. |
| | `AGENT_DUPLICATE` | `id` | Deep copy without activities or timestamps. |
| | `AGENT_REMOVE_ATTRIBUTE` | `id, index` | Remove an attribute. |
| | `AGENT_ADD_ACTIVITY` / `AGENT_REMOVE_ACTIVITY` | `id, tag` | Add (stamping `lastAssigned`) or remove an activity tag. |
| | `AGENT_RETURN_ITEM` | `id, itemName` | Return a bag stack to inventory. |
| | `AGENT_BIND_ITEM` / `AGENT_UNBIND_ITEM` | `id, itemName, slot?` | Bind one from the bag, or unbind back. |
| Tasks | `TASK_CREATE` | `preset?, count?, locked?` | Create `count` tasks; locked-mode gate covers condition links. |
| | `TASK_UPDATE` | `id, changes` | Patch fields. |
| | `TASK_DELETE` | `id` | Delete and unassign. |
| | `TASK_DUPLICATE` | `id` | Copy with fresh conditions. |
| | `TASK_SET_COMPLETE` | `id, isComplete` | Complete (applying results) or un-complete. |
| | `TASK_REMOVE_TAG` | `id, field, index` | Remove a requirement or attribute. |
| | `TASK_CONDITION_ADD` | `id, template` | Append a condition; registers its link path. |
| | `TASK_CONDITION_UPDATE` | `id, conditionId, changes` | Patch a condition. |
| | `TASK_CONDITION_REMOVE` | `id, conditionId` | Remove a condition. |
| | `TASK_UPDATE_RESULTS` | `id, changes` | Patch results. |
| Inventory | `INVENTORY_ADD` | `preset?, count?, locked?` | Add a row, then stack. |
| | `INVENTORY_UPDATE_ITEM` | `id, changes` | Patch; identity changes re-stack. |
| | `INVENTORY_REMOVE_ITEM` | `id` | Delete a row. |
| | `INVENTORY_REMOVE_ATTRIBUTE` | `id, index` | Remove a tag; re-stack. |
| | `ITEM_PLACE` | `target: { type: 'agent' \| 'bank', id? }, itemId, quantity?` | Give to an agent's bag or sell to the bank. |
| Tags | `TAG_APPLY` | `target: { type, id }, tag` | Apply a tag to any entity, routing and registering it. |
| Registry | `TAGREG_ADD_PATH` | `segments` | Insert a path. |
| | `TAGREG_DELETE_NODE` | `segments` | Remove a node and its subtree. |
| | `TAGREG_RENAME_NODE` | `segments, name` | Rename a node. |
| | `TAGREG_REPLACE` | `registry` | Replace the registry (after YAML import). |
| System | `DYN_RECONCILE` | `rules` | Materialize dynamic tags; never logs. |
| | `APPLY_TICK` | `newState` | Commit a precomputed tick. |
| | `APPLY_ROLLBACK` | `newState` | Commit a precomputed rollback. |
| | `REPLACE_STATE` | `newState` | Load external state through `normalizeState`. |
| | `EVENTLOG_CLEAR` | — | Empty the event log. |
| | `RESET` | — | Restore the default state. |

## Storage keys

All persistent state is in `localStorage`; every key is defined in
`STORAGE_KEYS` (`src/state/storage.js`).

| Key | Holds |
|---|---|
| `dnd-hirelings-state-v6` | The whole `GameState`, saved on every change. |
| `dnd-hirelings-palette-v1` | Active palette name (`light` or `dark`; default `dark`). Falls back once to the unversioned `dnd-hirelings-palette`. |
| `dnd-hirelings-presets-{agents,tasks,items}-v1` | User presets per type. |
| `dnd-hirelings-card-expansion-v1` | Per type (`agent`, `task`, `item`, `agentTags`), the ids toggled away from their default. |
| `dnd-hirelings-open-modals-v1` | Open props of each persistence-enabled modal. |
| `dnd-hirelings-config-overlays-v1` | Config overlays, `{ [fileId]: document }`. |

**Versioning.** Every key carries a version suffix, bumped only when its
stored format changes incompatibly. A bump ships either migration code or an
explicit note in `STORAGE_KEYS` that older data is abandoned. Saves older than
`-v6` are abandoned.

`Planned (#117):` `-v7`, reading `-v6` as a fallback and lowering it — the first
migrating bump. `Planned (#116):` a key recording the last acknowledged turn
review ([`multiplayer.md`](multiplayer.md)).

## Files

The browser can't write served files, so everything leaves and enters through
Save As and file inputs. Saving uses the File System Access API where
available and falls back to a download link (`downloadFile`).

| File | Written by | Read by | Format |
|---|---|---|---|
| Session | Top bar SAVE | Top bar LOAD (`REPLACE_STATE`) | JSON `GameState`; the loaded registry is taken as-is. |
| Event log | Top bar LOG | `loadEventLogFromFile` (no UI control) | CSV, columns below. |
| Tag registry | Registry modal SAVE | Registry modal LOAD | YAML keys-only tree ([`tags.md`](tags.md)). |
| Presets | Library SAVE | Library LOAD | JSON preset array ([`library.md`](library.md)). |
| Config | Configuration Modal SAVE | Configuration Modal LOAD | YAML document ([`config.md`](config.md)). |

**Event log CSV.** Columns, in order (`EVENT_LOG_COLUMNS`):

```
seq, eventType, clock, agentId, agentName, taskId, taskName,
conditionId, conditionName, delta, progress, target, data
```

`data` is a JSON blob. Import maps columns by the file's own header, so
columns may only ever be appended — never reordered or removed.

**Icons are stored as absolute paths** (`/assets/portraits/…`) in saves and
presets. Renaming or re-encoding a served asset breaks existing references,
which fall back to the empty frame; there is no asset-path migration.

`Planned (#116):` a networked mode that seeds a second, non-persisting
`GameProvider` from a snapshot ([`multiplayer.md`](multiplayer.md)).
