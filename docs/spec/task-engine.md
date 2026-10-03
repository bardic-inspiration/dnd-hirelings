# Task Engine

**`Planned (#117):`** this whole area. It replaces conditions and results
([`tasks.md`](tasks.md)) with one engine: ordered **operators** gate and
modulate per-tick **flow** into **vessels**; **actions** are the universal
effect primitive; a task-local **blackboard** carries written state; dice are
**seeded** and replay-derived; rollback stays best-effort through per-kind
reverses. Part of [`SPEC.md`](../../SPEC.md).

## The model

Each tick, flow passes through every active task. Everything is admitted by
default; **gates** admit or reject it, **modulators** scale it, and flow that
clears them is **deposited** into a vessel. A task completes when its success
vessels are full. Effects — progress, rewards, death, writes — are all
actions.

- Nothing is privileged: there is no special reward or failure path.
- An unmet condition is not a failure. There is no timeout branch; an expired
  window simply stops mattering.
- Blackboard entries are inert until an operator reads them.
- Today's conditions-plus-results schema is a special case of this engine
  and is lowered into it on load ([Migration](#migration)).

## Shapes

```ts
interface Task {                     // stored shape from storage key -v7
  id: string; name: string; icon: string; description: string;
  requirements: string[]; attributes: string[];
  isComplete: boolean; createdAt: number;
  duration: { kind: 'open'|'fixed', ticks?: number, cap?: number } | null;
  operators: Operator[];             // ordered: the fold
  vessels: { [key: string]: Vessel };  // key is also the DOM and log id
  effects: Effect[];                 // task-level, on: 'completion'
  blackboard: { [key: string]: number|string|boolean };  // plain JSON only
}

interface Operator {
  id: string;
  kind: string;                      // OPERATOR_REGISTRY key
  quantifier?: string;               // QUANTIFIER_REGISTRY key; absent = per agent
  read?: string;                     // 'flow' | 'flag:<key>' | a tag path
  compare?: { op: string, value: string };
  expr?: string;                     // expression source: dice, arithmetic, refs
  combine?: string;                  // scale only: '*' | '+' | an expression
  target?: string;                   // contribute only: vessel key
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
missing fields default to `operators: []`, `vessels: {}`, `effects: []`,
`blackboard: {}`, `duration: null`.

## Operators

`OPERATOR_REGISTRY` (`src/logic/operators.js`) maps a kind to
`(op, flow, ctx) => flow`. It subsumes `TRACKER_REGISTRY`.

| Kind | Role | Semantics |
|---|---|---|
| `gate` | Admit or reject | Test `read` + `compare` (a tag term) or `expr` + `compare` (a check). Pass → flow continues, `matchedValue` set from the matched tag's numeric value (0 if non-numeric). Fail → `admitted = false`; nothing downstream fires. |
| `scale` | Transform | `flow.value = combine(flow.value, evaluate(expr))`. Never re-admits rejected flow. |
| `contribute` | Deposit | Add `evaluate(expr)` (default 1) to `blackboard[target]`; one `work_contribution` row per depositing agent. |
| `roll` | Seeded die | `flow.value = evaluateCheck(expr)`; appends a `RollRecord`. |
| `write` | Write the blackboard | The state half of deferral. |
| `effect` | Fire actions | Fires its `effects` by outcome through `ACTION_REGISTRY`. |

**Quantifiers** (`QUANTIFIER_REGISTRY`). With no quantifier the fold runs
independently per engaged agent — today's semantics, and what lowering emits.
A quantifier collapses the per-agent pass/fail vector to one outcome per task:
`all`; `any` (= `atLeast(1)`); `atLeast(n)`; `count`, which deposits the
number of passers once instead of once per passer. Order is author-controlled
and literal. A contribute deposits its `expr` (or 1) unless `count` is set.

## The tick

`advanceTick` keeps its envelope — one new state per tick, committed whole by
`APPLY_TICK` — but replaces the per-condition loop with the fold:

```
snapshot = start-of-tick state                       // phase 1: reads
for each active task:
  for each engaged agent:
    flow = { admitted: true, value: 0, matchedValue: 0, rolls: [] }
    for op in task.operators: flow = OPERATOR_REGISTRY[op.kind](op, flow, ctx)
  collapse quantified operators; collect deltas and log rows
apply accumulated deltas                             // phase 2: writes
for each task: if every success vessel is full → fire its completion effects
emit the tick boundary row; cap the log
```

- **Two-phase rule.** Every predicate reads the start-of-tick snapshot; every
  write applies after. A flag read never depends on sibling order within a
  tick; only operators consuming the running `flow` depend on author order.
  Writing in one tick and reading in a later one is how multi-step tasks work.
  An agent spawned mid-tick is engaged from the next tick.
- **Completion:** every `success: true` vessel's `fullWhen` passes against its
  fill, checked once per tick after writes. A task with no vessels completes
  as a zero-condition task does today. The ✓ button fires completion effects
  through the same `applyActions`.
- **`duration`** compiles at load into a countdown operator and vessel:
  `fixed` counts toward its own expiry; `open` with a `cap` likewise, with no
  completion tie-in. Expiry fires nothing.
- `fullWhen` is a `VALUE_COMPARE_REGISTRY` term (`== >= <= > <`, ordered
  comparisons numeric and fail-closed, no `!=`).

## Event log and rollback

The log is at once the rollback substrate, the CSV contract, and a DOM-key
source, so it changes additively:

- **Columns.** `actionKind` (string, default `''`) and `reverseData` (JSON,
  default `{}`) are appended after `data`. `reverseData` carries the reverse
  recipe, including pre-images for writes whose inverse restores a prior
  value. Older builds importing a newer CSV drop the two columns; those rows
  fall back to the legacy reverse.
- **Rows**, in the order `work* → task_complete* → action* → tick`:

  | Type | For | Notes |
  |---|---|---|
  | `work_contribution` | Every vessel deposit, per agent | `conditionId` = vessel key, `progress` = new fill, `target` = the `fullWhen` bound, `actionKind: 'vessel.deposit'`. |
  | `action` | Every other action delta, mid-tick or on completion | `actionKind`, `data: { params, deltas }`, `reverseData`. |
  | `task_complete` | A completion | Audit only; its state changes are its `action` rows. |
  | `tick` | The boundary | `data` gains `rolls: RollRecord[]`, for audit only. |

- **DOM continuity.** Vessels migrated from conditions reuse the condition
  id, so the progress interpolation's `[data-task-id][data-condition-id]`
  selectors and the focus guard keep working. `ProgressSection` reads
  `task.vessels` (fill from the blackboard, target from `fullWhen`).
- **Rollback dispatch.** `rollbackTick` keeps its reverse walk; a row with an
  `actionKind` reverses through `ACTION_REGISTRY[kind].reverse`, any other row
  through the legacy path. Reverses stay best-effort (clamp ≥ 0, skip missing
  entities); a `reverse: null` kind is skipped. Boundary handling is unchanged.
- **Switchboard.** `rollback.yml`'s seven `reverse.*` flags stay; the
  `reverse` map also accepts any action kind. A row is reversed when
  `reverse[actionKind] ?? reverse[legacyCategory] ?? true`, with
  `workProgress → vessel.deposit`, `rewardGold → bank.adjust`,
  `rewardItems → inventory.*`, `spawnedAgents → agent.spawn`,
  `agentReassignment → agent.assign/unassign`; `taskCompletion` and `wages`
  keep their boundary meanings.

## Expressions

`src/logic/expressions.js` is extended in place. Why not a math library: the
parser already resolves references first and evaluates second, the new
surface is a small grammar addition, and a dependency needs approval.

- **Grammar**, loosest to tightest: `||`, `&&`, `== != >= <= > <`, `+ -`,
  `* / %`, unary `! -`, primary. Booleans are `1` / `0`; non-finite operands
  propagate. A dice literal `NdM` (`d20` = `1d20`) is one node.
- A dice node calls `roll(n, m)` from the active function table; with no
  `roll`, it evaluates to `NaN`.
- **API:** `evaluateExpression(ast, resolve, functions = EXPRESSION_FUNCTIONS)`;
  `evaluateCheck(source, { resolve, roll })` for operators;
  `evaluateDynamic` for dynamic tags, which never receives `roll`.
- **Determinism (tested):** `EXPRESSION_FUNCTIONS` never contains randomness;
  a dice expression on the dynamic path warns and defaults to 1; reconcile
  stays idempotent. Why: dynamic payloads are stored, so a random value would
  churn saves, loop the reconcile effect, and corrupt rollback.

## References

Operators resolve references through their own resolver, separate from the
dynamic-tag resolver:

| Reference | Resolves to |
|---|---|
| `{skill:arcana}`, `{class:*}`, … | The engaged agent's effective attribute values (wildcards sum), from the snapshot. |
| `{session:workRate}`, … | Session scalars: `workRate`, `skillBonus`, `rateMultiplier`, `clock`. |
| `{flag:<key>}` | `task.blackboard[key]` from the snapshot. |
| `{flow}` | `flow.value`. |
| `{value}` | `flow.matchedValue`. |

## Randomness

`src/logic/rng.js`: a string-hash seed feeding a small PRNG, with no
dependency.

- **Seed key:** `` `${clock}|${taskId}|${operatorId}|${agentId}|${rollIndex}` ``.
  One stream per key; `NdM` draws N values from it (one literal, one
  `rollIndex`).
- `rollIndex` counts up per `(taskId, operatorId, agentId)` within a tick, so
  follow-up and effect-fired rolls get distinct indices.
- **Replay re-derives every roll:** results repeat when rules and
  participants are unchanged and change when the author edits the operator.
  The log records outcomes for audit, never as a source of truth.

## Actions

`ACTION_REGISTRY` (`src/logic/actions.js`) maps a kind to
`{ apply(action, ctx) → { deltas, logRow }, reverse(row, ctx) → deltas | null }`.
`applyActions` folds the deltas into the tick's single new state. Why: effects
never re-dispatch reducer actions, so a tick stays one atomic, logged step.

| Kind | Reverse |
|---|---|
| `vessel.deposit` | Subtract the deposit. |
| `bank.adjust` | Negate. |
| `inventory.add` / `inventory.remove` | Inverse operation, clamped ≥ 0. |
| `agent.spawn` | Delete the agent. |
| `agent.remove` | **None** — held items are not returned. |
| `agent.assign` / `agent.unassign` | Inverse. |
| `tag.apply` / `tag.remove` / `tag.adjust` | Inverse; `adjust` restores its pre-image. |
| `flag.set` / `flag.clear` | Restore the pre-image. |
| `object.create` | Delete. |

Selectors reuse the tag-matching engine
(`{ scope: 'assigned' | 'operator' | 'entity', … }`). New kinds are additive.

- **Results become a derived view:** completion effects mapped back to
  `{ gold, items, agents }`, so the results section renders unchanged.
  `TASK_UPDATE_RESULTS` and `TASK_CONDITION_ADD/UPDATE/REMOVE` remain as sugar
  verbs that lower at dispatch; a condition draft `path[op value][=target]`
  becomes a `gate` + `contribute` pair and a vessel.
- **Locked mode covers tag-writing actions** (`tag.apply`, `tag.adjust`,
  `agent.spawn` templates, `object.create`) through `unregisteredEntityTags`.
  Unlocked, their literal paths register; locked and unregistered, the action
  is skipped and its row marked `data.skipped: 'locked'` — the tick never
  fails.

## Migration

The storage key becomes `dnd-hirelings-state-v7`. `loadState` reads `-v7`,
else reads `-v6` and lowers it through `normalizeState`. Lowering is
idempotent:

```
condition { id, name, progress, target, tracker: { kind: 'work', tagPath, compare } }
  → if tagPath: operators += { id: `${id}-gate`, kind: 'gate', read: tagPath, compare }
  → operators += { id, kind: 'contribute', target: id,
                   expr: '{session:workRate} + {value} * {session:skillBonus}' }
  → vessels[id] = { name, fullWhen: `>= ${target}` }
  → blackboard[id] = progress

results { gold, items, agents }
  → effects += { on: 'completion', actions: [ bank.adjust, inventory.add per item,
                 agent.spawn per agent ] }
```

The one contribute expression reproduces all four `work` branches, because
`{value}` is 0 when there is no gate or the matched tag is non-numeric, and a
failed gate fires nothing. An unknown tracker kind lowers to an inert `write`
operator carrying its payload, so nothing is dropped.

## Authoring

- A `tasks` entry in `CONFIG_FILES` (`kind: 'state'`, bound to `state.tasks`)
  with a `TASKS_SCHEMA`: operators as a list, vessels as an `anyKey` map,
  `expr` and `fullWhen` checked softly through `parseExpression`.
- Task presets may carry the full shape.
- The registry modal's condition mode, `+ CONDITION`, and the results section
  keep working through the sugar verbs.

## Worked examples

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
