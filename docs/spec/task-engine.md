# Task Engine

How tasks make progress and pay out: ordered **operators** gate and modulate
per-tick **flow** into **vessels**; **actions** are the universal effect
primitive; a task-local **blackboard** carries written state; dice are
**seeded** and replay-derived; rollback stays best-effort through per-kind
reverses. Conditions and results ([`tasks.md`](tasks.md)) are authoring forms
lowered into this engine. Part of [`SPEC.md`](../../SPEC.md).

`Planned (#117):` the `scale`, `roll`, and `write` operators, `duration`,
per-action-kind rollback switches, and the authoring surface — each marked
where it appears.

## The model

Each tick, flow passes through every worked task. Everything is admitted by
default; **gates** admit or reject it, and flow that clears them is
**deposited** into a vessel. A task completes when its success vessels are
full. Effects — progress, rewards, death, writes — are all actions.

- Nothing is privileged: there is no special reward or failure path.
- An unmet condition is not a failure. There is no timeout branch.
- Blackboard entries are inert until an operator reads them.
- The conditions-plus-results schema is a special case of this engine and is
  lowered into it on load ([Migration](#migration)).

## Shapes

```ts
interface Task {                     // stored shape from storage key -v7
  id: string; name: string; description: string;
  requirements: string[]; attributes: string[];
  isComplete: boolean; createdAt: number;
  duration: { kind: 'open'|'fixed', ticks?: number, cap?: number } | null;  // Planned (#117): read
  operators: Operator[];             // ordered: the fold
  vessels: { [key: string]: Vessel };  // key is also the DOM and log id
  effects: Effect[];                 // task-level, on: 'completion'
  blackboard: { [key: string]: number|string|boolean };  // plain JSON only
}

interface Operator {
  id: string;
  kind: string;                      // OPERATOR_REGISTRY key
  quantifier?: string;               // QUANTIFIER_REGISTRY key or 'atLeast(n)'; absent = per agent
  read?: string;                     // gate: 'flow' | 'flag:<key>' | a tag path
  compare?: { op: string, value: string };
  expr?: string;                     // expression source: dice, arithmetic, refs
  combine?: string;                  // Planned (#117): scale only
  target?: string;                   // contribute only: vessel key
  payload?: object;                  // write only: a lowered unknown tracker
  effects?: Effect[];                // fired on this operator's outcome
}

interface Flow {                     // per (agent, task, tick), starts
  admitted: boolean;                 //   { admitted: true, value: 0,
  value: number;                     //     matchedValue: 0, rolls: [] }
  matchedValue: number;              // numeric value of the last gate-matched tag; 0 if none or non-numeric
  rolls: RollRecord[];
}

interface Vessel {
  name?: string;                     // display label; defaults to the key
  fullWhen: string;                  // 'op value', e.g. '>= 4'
  success?: boolean;                 // counts toward completion; default true
}
// A vessel's fill is task.blackboard[key] (number, default 0), not a vessel field.

interface Effect { on: 'pass'|'fail'|'threshold'|'completion'; actions: Action[]; }
interface Action { kind: string; params: object; }    // ACTION_REGISTRY key
interface RollRecord { operatorId: string; agentId: string; rollIndex: number;
                       notation: string; result: number; }
```

`conditions` and `results` are not stored. Every field is plain JSON;
`lowerTask` (`src/logic/taskModel.js`) defaults missing fields to
`operators: []`, `vessels: {}`, `effects: []`, `blackboard: {}`,
`duration: null`, drops operators and actions without a `kind`, keeps only
scalar blackboard values, and gives a vessel without a `fullWhen` `'>= 1'`.

## Operators

`OPERATOR_REGISTRY` (`src/logic/operators.js`) maps a kind to a per-agent step
`(op, flow, ctx) => flow`, called only for an admitted flow. An unknown kind
passes the flow through.

| Kind | Role | Semantics |
|---|---|---|
| `gate` | Admit or reject | See below. Pass → flow continues; fail → `admitted = false`, and nothing downstream fires for that agent. |
| `contribute` | Deposit | Add `evaluate(expr)` (default `1`) to `blackboard[target]` — only a positive, finite amount; one `work_contribution` row per depositing agent. |
| `effect` | Fire actions | Fires its `pass` effects when an admitted flow reaches it. |
| `scale` | Transform | `Planned (#117):` `flow.value = combine(flow.value, evaluate(expr))`. Never re-admits rejected flow. |
| `roll` | Seeded die | `Planned (#117):` `flow.value = evaluateCheck(expr)`. |
| `write` | Write the blackboard | Inert; lowering emits it for an unknown tracker. `Planned (#117):` writes the blackboard, the state half of deferral. |

**Gates** test one of:

- `read: <tag path>` — the first plain effective attribute matching the path
  (`open` mode) whose display value passes `compare` (none = any match).
  `matchedValue` becomes the matched tag's numeric value, 0 if non-numeric.
- `read: 'flow'` or `read: 'flag:<key>'` — the running `flow.value`, or the
  start-of-tick blackboard entry (a non-number reads 0).
- `expr` — an `evaluateCheck`, rolling its dice.

A number passes when `compare` (a `VALUE_COMPARE_REGISTRY` term) holds, or,
with no `compare`, when it is nonzero and finite. An `expr` that fails to
parse fails the gate. A gate with neither `read` nor `expr` passes.

**Segments.** A `contribute` closes a segment: the operators after it start
from a fresh flow (rolls carry over). Why: lowering emits one gate +
contribute per condition in sequence, and conditions stay independent — a
failed gate or a matched value never reaches the next condition.

**Quantifiers** (`QUANTIFIER_REGISTRY`), on gates. With none, each engaged
agent passes or fails alone — what lowering emits. A quantifier collapses the
outcomes of the agents that reached the gate into one: `all`; `any`;
`atLeast(n)`; `count`, which admits like `any` and makes the segment's
contribute deposit the number of passers once (a row with no agent) instead
of once per passer. Agents rejected upstream are never re-admitted. Order is
author-controlled and literal.

**Operator effects.** A gate's `pass` and `fail` effects fire once per tick
when any agent reached that outcome, judged before the quantifier collapses
them; actions pick their targets by selector ([Actions](#actions)). A
contribute's `threshold` effects fire on the tick its vessel goes from not
full to full.

## The tick

`advanceTick` (`src/logic/clock.js`) produces one new state per tick,
committed whole by `APPLY_TICK`:

```
pay wages; the paid agents are engaged on their current task
for each worked task (board order):                  // phase 1: reads
  run its operators across its engaged agents at once, operator by operator
  collect deposits, outcomes, fired effects, threshold effects, rolls
apply deposits → fired effects → threshold effects   // phase 2: writes
for each task (board order): if complete → completeTask
log work* → task_complete* → action* → tick; cap the log
```

- **Two-phase rule.** Every operator reads the start-of-tick state; every
  write applies after. A flag read never depends on sibling order within a
  tick; only operators consuming the running `flow` depend on author order.
  Writing in one tick and reading in a later one is how multi-step tasks work.
  An agent spawned mid-tick is engaged from the next tick.
- **Deposits** apply, and log, in board order of the depositing agent, then
  operator order, counted deposits last. Each row's `progress` is the fill
  after that deposit.
- **Flashes.** An engaged agent flashes when its task has a contribute and it
  deposited nothing; on a task without one, presence alone counts. Blocked
  tasks and an unaffordable wage bill flash as before
  ([`clock.md`](clock.md) "Ticks").
- **Completion:** every success vessel's `fullWhen` passes against its fill,
  checked once per tick after writes. A task with no success vessels
  completes as a zero-condition task does: at the end of any tick an engaged
  agent worked it. `completeTask` (`src/logic/tasks.js`) marks it complete,
  then applies `agent.unassign` (every assigned agent) and its completion
  effects. The ✓ button (`TASK_SET_COMPLETE`) runs the same `completeTask`,
  unlogged.
- `fullWhen` is a `VALUE_COMPARE_REGISTRY` term (`== >= <= > <`, ordered
  comparisons numeric and fail-closed, no `!=`); a malformed one is never full.
- `Planned (#117):` **`duration`** compiles at load into a countdown operator
  and vessel: `fixed` counts toward its own expiry; `open` with a `cap`
  likewise, with no completion tie-in. Expiry fires nothing.

## Event log and rollback

The log is at once the rollback substrate, the CSV contract, and a DOM-key
source, so it changes additively:

- **Columns.** `actionKind` (string, default `''`) and `reverseData` (JSON,
  default `{}`) are appended after `data`. `reverseData` carries the reverse
  recipe, including pre-images for writes whose inverse restores a prior
  value. A row that records no action carries the defaults, and a row or CSV
  without the columns normalizes to them. Older builds importing a newer CSV
  drop the two columns; those rows fall back to the legacy reverse.
- **Rows**, in the order `work* → task_complete* → action* → tick`:

  | Type | For | Notes |
  |---|---|---|
  | `work_contribution` | Every vessel deposit | `conditionId` = vessel key, `conditionName` = vessel name, `progress` = new fill, `target` = the `fullWhen` bound, `actionKind: 'vessel.deposit'`. A counted deposit has no agent. |
  | `task_complete` | A completion | `data: { isComplete, attributes }`. Rollback un-completes the task through it; every other change is an `action` row. |
  | `action` | Every other action, fired mid-tick or on completion | `actionKind`, `data: { params, deltas, skipped? }`, `reverseData`. An action that changed nothing is not logged. |
  | `tick` | The boundary | `data.rolls: RollRecord[]` when the tick rolled, for audit only. |

- **DOM continuity.** Vessels lowered from conditions reuse the condition
  id, so the progress interpolation's `[data-task-id][data-condition-id]`
  selectors and the focus guard keep working. `ProgressSection` and
  `updateClockDisplayDOM` read `conditionsView(task)`: fill from the
  blackboard, target from `fullWhen`.
- **Rollback dispatch.** `rollbackTick` keeps its reverse walk. A row with an
  `actionKind` reverses through `ACTION_REGISTRY[kind].reverse`
  (`reverseActionRow`); a `work_contribution` row without one, written before
  the engine, reverses as `vessel.deposit`; a `task_complete` row
  un-completes its task, and one written before the engine also reverses the
  rewards, spawns, and assignments it recorded. Reverses stay best-effort
  (clamp ≥ 0, skip missing entities); a skipped row and a `reverse: null`
  kind change nothing. Boundary handling is unchanged.
- **Switchboard.** `rollback.yml`'s seven `reverse.*` flags gate the kinds:
  `workProgress → vessel.deposit`, `rewardGold → bank.adjust`,
  `rewardItems → inventory.*`, `spawnedAgents → agent.spawn`,
  `agentReassignment → agent.assign/unassign`; other kinds always reverse;
  `taskCompletion` and `wages` keep their boundary meanings.
  `Planned (#117):` the `reverse` map also accepts any action kind; a row is
  reversed when `reverse[actionKind] ?? reverse[legacyCategory] ?? true`.

## Expressions

`src/logic/expressions.js` is extended in place. Why not a math library: the
parser already resolves references first and evaluates second, the new
surface is a small grammar addition, and a dependency needs approval.

- **Grammar**, loosest to tightest: `||`, `&&`, `== != >= <= > <`, `+ -`,
  `* / %`, unary `! -`, primary. Comparisons and `&& || !` yield `1` / `0`,
  reading any nonzero operand as true; a non-finite operand makes them `NaN`,
  and arithmetic propagates non-finite values. Both sides of `&&` and `||`
  always evaluate. Why: how many dice an expression rolls never depends on
  its values. A dice literal `NdM` (`d20` = `1d20`) is one node; N and M are
  positive integers, else a parse error. A lone `=`, `&`, or `|` is a parse
  error.
- A dice node calls the `roll` entry (`apply(n, m)`) of the active function
  table; with no `roll`, it evaluates to `NaN`. `roll(…)` is not callable
  syntax.
- **API:** `evaluateExpression(ast, resolve, functions = EXPRESSION_FUNCTIONS)`;
  `evaluateCheck(source, { resolve, roll })` for operators, returning
  `{ value, error }` — `NaN` and the parse error on bad source, with nothing
  rolled; `evaluateDynamic(ast, resolve)` for dynamic tags, returning
  `{ value, warning }`, which never receives `roll`.
- **Determinism (tested):** `EXPRESSION_FUNCTIONS` never contains randomness;
  a dice expression on the dynamic path warns and defaults to 1; reconcile
  stays idempotent. Why: dynamic payloads are stored, so a random value would
  churn saves, loop the reconcile effect, and corrupt rollback.

## References

Operators resolve references through their own resolver, separate from the
dynamic-tag resolver. Anything unresolved reads 0.

| Reference | Resolves to |
|---|---|
| `{skill:arcana}`, `{class:*}`, … | The engaged agent's effective plain tags at the path, from the snapshot; numeric values sum, so wildcards sum. |
| `{dyn,ac}`, … | The same over the agent's `dyn,` tags (their materialized totals). |
| `{session:workRate}`, … | Session scalars: `workRate` and `skillBonus` (default 1), `rateMultiplier`, `clock`. |
| `{flag:<key>}` | `task.blackboard[key]` from the snapshot (keys match case-insensitively; non-numbers read 0). |
| `{flow}` | `flow.value`. |
| `{value}` | `flow.matchedValue`. |

## Randomness

`src/logic/rng.js`: a string-hash seed (FNV-1a with MurmurHash3's
finalizer) feeding mulberry32, with no dependency. `createRng(key)` returns a
key's stream of values in `[0, 1)`; `rollDice(key, n, m)` draws N dice from
it and returns `{ result, values }`; `rollSeedKey(parts)` builds the key.
Golden-value tests pin both algorithms. Why: changing either changes every
replayed roll.

- **Seed key:** `` `${clock}|${taskId}|${operatorId}|${agentId}|${rollIndex}` ``,
  where `clock` is the tick's clock after it advances (its log stamp). One
  stream per key; `NdM` draws N values from it (one literal, one `rollIndex`).
- `rollIndex` counts up per `(taskId, operatorId, agentId)` within a tick, so
  each literal an operator evaluates gets its own index.
- **Replay re-derives every roll:** results repeat when rules and
  participants are unchanged and change when the author edits the operator.
  The log records outcomes for audit, never as a source of truth.

## Actions

`ACTION_REGISTRY` (`src/logic/actions.js`) maps a kind to
`{ apply(world, params, ctx) → { world, deltas, reverseData }, reverse(world, row) → world | null, category?, tagWrites? }`,
where a world is `{ agents, tasks, inventory, session, tagRegistry }`.
`applyActions` folds actions in order into one new world and returns a record
per action for the log. Why: effects never re-dispatch reducer actions, so a
tick stays one atomic, logged step. An unknown kind is recorded as
`skipped: 'unknown'`; an action that changes nothing (`deltas: null`) is not
recorded.

| Kind | Params | Applies | Reverse |
|---|---|---|---|
| `vessel.deposit` | `vessel, amount` | Adds to the fill. | Subtract the row's delta, clamped ≥ 0. |
| `bank.adjust` | `amount` | Adds to the bank. | Subtract, clamped ≥ 0, to the cent. |
| `inventory.add` | `name, quantity` | Adds to the stack by case-insensitive name, or creates a blank row; skips no name or quantity ≤ 0. | Remove the quantity, clamped ≥ 0. |
| `inventory.remove` | `name, quantity` | Removes up to the stock. | Return what was removed. |
| `agent.spawn` | `template, quantity` | Spawns agents from the template. | Delete them. |
| `agent.remove` | `selector` | Removes the agents. | **None** — held items are not returned. |
| `agent.assign` / `agent.unassign` | `selector, taskId?` (default: this task) | Adds or removes `task:<id>` on the agents that lack or carry it. | Inverse; reassigning skips a deleted task. |
| `tag.apply` / `tag.remove` | `selector, tag` | Merges the tag, or removes the agents' tag at its identity (modifier + path). | Restore each agent's pre-image. |
| `tag.adjust` | `selector, path, by` | Adds `by` to the numeric value at the path (creating it). | Restore the pre-image. |
| `flag.set` / `flag.clear` | `key, value?, taskId?` | Writes or deletes a blackboard entry. | Restore the pre-image. |
| `object.create` | `kind` (`item`, `agent`, or `task`), `template` | Creates the entity (a task is lowered). | Delete it (a task's assignments with it). |

**Selectors** pick agents, in board order, skipping missing ones:
`{ scope: 'assigned', match? }` (the default) — agents assigned to the task,
optionally only those with an effective plain tag matching the `match`
pattern; `{ scope: 'operator', operatorId, outcome }` — agents whose outcome at
that operator this tick was `pass` or `fail`; `{ scope: 'entity', id }`. New
kinds are additive.

- **Results are a derived view** (`resultsView`): the completion effects'
  `bank.adjust` amounts summed as `gold`, and their `inventory.add` and
  `agent.spawn` actions as `items` and `agents`, values as stored — so the
  results section renders unchanged, and v6 results round-trip losslessly.
- **Sugar verbs** lower at dispatch (`src/logic/taskModel.js`):
  `TASK_UPDATE_RESULTS` merges into the view and rewrites those three kinds,
  leading the first completion effect and keeping other actions;
  `TASK_CONDITION_ADD` lowers a template under a fresh key;
  `TASK_CONDITION_UPDATE` sets the vessel's name, its `fullWhen` bound
  (keeping the operator), or its fill; `TASK_CONDITION_REMOVE` drops the
  vessel, its fill, and its `<key>` / `<key>-gate` operators.
- **Locked mode covers tag-writing actions** (`tag.apply`, `tag.adjust`,
  `agent.spawn` templates, `object.create` templates) through
  `unregisteredEntityTags`; `advanceTime` takes `locked` from `tags.yml`.
  Unlocked, their literal paths register; locked and unregistered, the action
  is skipped and its row marked `data.skipped: 'locked'` — the tick never
  fails.

## Migration

The storage key is `dnd-hirelings-state-v7`. `loadState` reads `-v7`, else
reads `-v6` and lowers it through `normalizeState` (`lowerTask`). Lowering is
idempotent — a condition whose vessel already exists is skipped:

```
condition { id, name, progress, target, tracker: { kind: 'work', tagPath, compare } }
  → if tagPath: operators += { id: `${id}-gate`, kind: 'gate', read: tagPath, compare? }
  → operators += { id, kind: 'contribute', target: id,
                   expr: '{session:workRate} + {value} * {session:skillBonus}' }
  → vessels[id] = { name, fullWhen: `>= ${target}` }
  → blackboard[id] = progress

results { gold, items, agents }
  → effects += { on: 'completion', actions: [ bank.adjust (when gold ≠ 0),
                 inventory.add per item, agent.spawn per agent ] }
```

The one contribute expression reproduces all four `work` branches, because
`{value}` is 0 when there is no gate or the matched tag is non-numeric, and a
failed gate fires nothing. An unknown tracker kind lowers to an inert `write`
operator carrying its tracker as `payload`, so nothing is dropped.
A parity fixture (`src/fixtures/v6-parity-*.json`) pins the lowering: a v6
save advances and rolls back tick for tick as it did before the engine.

## Authoring

- `Planned (#117):` a `tasks` entry in `CONFIG_FILES` (`kind: 'state'`,
  bound to `state.tasks`) with a `TASKS_SCHEMA`: operators as a list, vessels
  as an `anyKey` map, `expr` and `fullWhen` checked softly through
  `parseExpression`.
- Task presets carry condition templates, which `TASK_CREATE` lowers.
  `Planned (#117):` presets may carry the full shape.
- The registry modal's condition mode, `+ CONDITION`, and the results section
  keep working through the sugar verbs.

## Worked examples

`Planned (#117):` running these from authored preset data. The third
example's `combat` → `agent.remove` chain is built
(`src/logic/taskEngine.test.js`).

**Find Victor and Zellen** — fixed window, 4 ticks:

```yaml
duration: { kind: fixed, ticks: 4 }
operators:
  - { id: stealth, kind: gate, quantifier: all,
      expr: "d20 + {skill:stealth}", compare: { op: ">=", value: "11" } }
  - { id: investigate, kind: gate, quantifier: any,
      expr: "d20 + {skill:investigation}", compare: { op: ">=", value: "24" } }
  - { id: progress, kind: contribute, target: found, expr: "1" }
vessels: { found: { fullWhen: ">= 4" } }
effects:
  - { on: completion, actions: [ { kind: bank.adjust, params: { amount: 50 } } ] }
```

**Infiltrate the City Watch** — open, cap 30:

```yaml
duration: { kind: open, cap: 30 }
operators:
  - { id: perform, kind: gate, quantifier: all,
      expr: "d20 + {skill:performance}", compare: { op: ">=", value: "12" } }
  - { id: investigate, kind: gate, quantifier: any,
      expr: "d20 + {skill:investigation}", compare: { op: ">=", value: "28" } }
  - { id: progress, kind: contribute, target: infiltration, expr: "1" }
vessels: { infiltration: { fullWhen: ">= 30" } }
```

**Explore the GUA Tunnels** — open, cap 10, with a lethal hazard:

```yaml
duration: { kind: open, cap: 10 }
operators:
  - { id: hazard, kind: roll, expr: "d6" }
  - { id: hazardHit, kind: gate, read: flow, compare: { op: "==", value: "1" } }
  - { id: combat, kind: gate, quantifier: any,
      expr: "d20 + {skill:combat}", compare: { op: ">=", value: "13" },
      effects: [ { on: fail, actions: [ { kind: agent.remove,
        params: { selector: { scope: operator, operatorId: combat, outcome: fail } } } ] } ] }
  - { id: investigate, kind: gate, quantifier: any,
      expr: "d20 + {skill:investigation}", compare: { op: ">=", value: "32" } }
  - { id: progress, kind: contribute, target: mapped, expr: "1" }
vessels: { mapped: { fullWhen: ">= 10" } }
```

The hazard rolls (seeded); `hazardHit` admits only on a 1; `combat` rolls per
agent, and its `fail` effect removes each failing agent. `agent.remove` has no
reverse, so the death survives rollback while everything else rewinds.

**Contract walk** (`bank.adjust`, end to end): a completion effect
`{ kind: 'bank.adjust', params: { amount: 50 } }` fires in `advanceTick`; the
delta `+50` folds into the tick's state; one `action` row records `actionKind`,
`data: { params, deltas }`, `reverseData: {}` inside the tick group; the CSV
round-trips both new columns; rollback dispatches the kind's reverse (`−50`,
clamped, gated by the switchboard) before the boundary refund and clock
decrement; the DOM is untouched throughout.
