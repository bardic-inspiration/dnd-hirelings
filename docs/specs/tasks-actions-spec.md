# Tasks, Conditions, Actions & Results — Implementation Spec

**Status:** Approved for implementation. Self-contained: supersedes the design
draft (`docs/specs/tasks-actions.md`) and the refined plan
(`docs/specs/tasks-actions-refined-plan.md`); every open question in both is
resolved here (see Decision log). Written against `docs/architecture.md`,
`docs/api.md`, `docs/gotchas.md`, `docs/tag-values.md` and `/src` as of commit
`4f108c2`.

**Scope:** Replace the fixed conditions-accrual + `results` struct with one
engine: ordered **operators** gate/modulate/deposit per-tick **flow** into
**vessels**; **actions** are the universal effect primitive; a task-local
**blackboard** carries written state; dice are **seeded** and replay-derived;
rollback stays best-effort via per-kind reverses. Authoring in v1 is data-first
(config tree + presets); the existing condition draft grammar survives as sugar.

**Non-scope:** An operator-builder UI (Phase 4, separate workstream); a
`phases[]` lifecycle engine; task-level `successExpr` over vessels; `!=` in
comparison terms; `journal.*` / `map.*` / `roster.*` action kinds (future
registry entries — additive, no schema change); any server or multiplayer
concern.

---

## The model: fluid authentication

> The tick is a coarse refresh rate for game state. Each tick, flow passes
> through every active task. Everything is admitted by default; conditions
> **gate** the flow (boolean) and modulators **modulate** it (scalar); flow that
> clears the gates enters a **vessel**, where data is consumed and **actions
> proliferate**. A task completes when its vessels are filled.

Consequences: nothing is privileged (progress, rewards, death, and journal
entries are all actions); an unmet condition is not a failure (no
timeout/failure branch — an expired window just stops mattering); meaning lives
in the reader, not the data (blackboard entries are inert until an operator
reads them — the same stance `docs/tag-values.md` took for registry-bounded
values). The current schema (fixed `conditions` accrual + `results:
{gold, items, agents}`) is a narrow special case and is subsumed, not extended.

---

## Decision log

### The ten governing decisions (inlined from the draft, verbatim in substance)

| # | Question | Decision |
|---|----------|----------|
| 1 | How do effects mutate state in the tick loop? | **Delta descriptors in pure logic.** Actions lower into serializable deltas that `applyActions` accumulates into the single `newState` inside `advanceTick`; each delta is logged for rollback. Actions never re-enter the reducer. |
| 2 | Do conditions fire actions? | **Yes.** Operators carry effects (fire actions on pass/fail/threshold) through the *one* action pipeline. Effects **chain**: an effect writes task-local state that a later operator reads → deferral emerges from a read/write graph, no scheduler. |
| 3 | Where does that written state live? | **A task-local blackboard** — an arbitrary key/value namespace, *not* overloaded onto `progress`/`satisfied`. Effects write it; predicates read it. |
| 4 | What language do predicates read through? | **Both, layered.** The expression engine (arithmetic, comparisons, dice) runs *under* the bespoke `{ref}`/`{dyn,}`/wildcard resolution; **tag comparisons stay in the bespoke tag-matching engine**; the blackboard is a resolver source. |
| 5 | How do per-tick agent interactions produce progress? | The per-(agent, task) tick interaction is an **event distribution node**: it engages operators and fires actions. Contribution is an *action*; no action → nothing logged → no progress. Filled vessels = completion. |
| 6 | Conditions vs vessels — distinct objects? | **Roles in one flow, not rivals.** Fully-general engine (gate → modulate → contribute → vessel); "a gated contribution to my own target" is authoring **sugar** over it. |
| 7 | Are modulators a separate primitive; how compose? | **A single ordered `OPERATOR_REGISTRY`.** Conditions and modulators are operator *kinds* (`gate` / `scale` / `contribute` / …), folded in author-declared order; each carries its own combine expression. Subsumes `TRACKER_REGISTRY`. |
| 8 | How do dice survive rollback/replay? | **Seeded PRNG.** A roll is a pure function of a seed keyed on `(clock, taskId, operatorId, agentId, rollIndex)`; replay re-derives it; the log records outcomes for audit/UI only. |
| 9 | How does time fit the model? | **Tick = coarse refresh rate.** A task persists for N ticks. `duration` is sugar compiling to a countdown operator; unfilled vessels at window's end just don't fire (non-resetting; no failure state). |
| 10 | Irreversible actions & rollback? | **Per-kind `reverse`, `null` allowed.** Reversible deltas invert best-effort; `reverse: null` is skipped; rollback never blocks. The `rollback.yml` switchboard generalizes to per-action-kind flags. |

**One deliberate reversal from the draft:** decision 4's lean toward adopting a
sandboxed math dependency is overruled — **extend `src/logic/expressions.js` in
place; no new dependency** (§4). The draft's "first runtime logic dep" framing
was factually off (js-yaml already ships at runtime); the real reasons stand on
their own: the parser/evaluator already exists with exactly the
"resolve-braces-first, evaluate-second" contract needed, and the new surface
(dice + comparison/boolean operators) is a narrow, incremental AST extension.

### Interview resolutions (2026-07-13)

| # | Question | Decision |
|---|---|---|
| Q-source | Spec self-containment | **Self-contained.** The draft and refined plan are committed as design records; this spec inlines the decisions and worked examples and depends on nothing outside the repo. |
| Q-logsubstrate | Where do generic delta records live? | **New additive `EVENT_LOG_COLUMNS`** (`actionKind`, `reverseData` — §3). Known caveat, accepted: `normalizeEvent` in *older* app versions drops unknown columns, so a newer CSV imported into an older build loses action-row rollback fidelity. Documented limitation, not a blocker. |
| Q-migration | Phase 1 migration posture | **Lower everything in Phase 1.** All existing conditions are the single `work` tracker kind, so one lowering rule covers the entire installed base. `normalizeState` lowers every condition on load; the legacy tick path is deleted in the same phase; the exit test is tick-for-tick parity. No dual engine. Consequence: the `-v6 → -v7` storage bump moves to Phase 1 (§8), since that is when the stored `Task` shape changes. |
| Q-authoring | v1 authoring surface | **Config + presets only.** A new `tasks` entry in `CONFIG_FILES` (schema-guided tree) plus preset JSON; the task card keeps its current condition/results UI, which now compiles to operators/actions underneath. Builder UI deferred to Phase 4. |

### Resolutions carried from the refined plan

| Question | Resolution |
|---|---|
| What is `flow` between operators? | The struct in §1.2. `gate` sets `admitted` (and `matchedValue`); `scale` transforms `value`; `roll` writes its result to `value` and appends to `rolls`; `contribute` deposits into a vessel. `read: flow` resolves to `flow.value`. |
| Vessel full-test grammar | Reuse the condition draft term `op value` via `VALUE_COMPARE_REGISTRY` / `matchTagValue` for scalar tests (`fullWhen: ">= 4"`); escalate to the expression engine only when a full-test references other keys (deferred until needed). Inherits the registry's limits: `== >= <= > <`, ordered comparisons numeric and fail-closed, no `!=` (`src/logic/tagMatching.js:206`). |
| Fold order vs `flow` | Author order is significant only for operators that consume the running `flow`; the two-phase snapshot (§2) makes blackboard reads order-independent within a tick. |
| Multi-roll seeding | Per-`(clock, taskId, operatorId, agentId)` monotonic `rollIndex` counter in the tick eval context; mid-tick spawns can't roll until the next tick (§6). |
| Quantifier × contribution | Deposit defaults to the operator's `expr` (or `1`); `quantifier: 'count'` opts into depositing the passer count once per node (§1.3). |
| Success-predicate scope | All success-vessels full. Task-level `successExpr` stays deferred. |
| Locked-mode gate for action-authored tags | Extended to tag-writing actions (§7.3) — closes the standing `docs/gotchas.md` "paths that bypass the gate" note. |

---

## 1. Shapes

### 1.1 Task (v7)

Assembled in `normalizeState` (`src/state/storage.js`), replacing the current
task map (`src/state/storage.js:271-285`):

```ts
interface Task {
  id: string; name: string; icon: string; description: string;
  requirements: string[]; attributes: string[];
  isComplete: boolean; createdAt: number;
  duration: { kind: 'open'|'fixed', ticks?: number, cap?: number } | null;
  operators: Operator[];                    // ordered; the fold
  vessels: { [key: string]: Vessel };       // key doubles as DOM/log id (§3.3)
  effects: Effect[];                        // task-level; on:'completion'
  blackboard: { [key: string]: number|string|boolean };  // plain JSON only
}
```

`conditions` and `results` are **no longer stored** — lowered on load (§8).
Every field is plain-JSON-serializable; session export/import
(`src/logic/session.js`) and localStorage round-trip need no special handling
beyond `normalizeState` defaults (`operators: []`, `vessels: {}`,
`effects: []`, `blackboard: {}`, `duration: null`).

### 1.2 Operator, Flow, Vessel, Effect

```ts
interface Operator {
  id: string;
  kind: string;             // key into OPERATOR_REGISTRY
  quantifier?: string;      // key into QUANTIFIER_REGISTRY; ABSENT = per-agent (§1.3)
  read?: string;            // 'flow' | 'flag:<key>' | tag path — via the op resolver (§5)
  compare?: { op: string, value: string };  // VALUE_COMPARE term for the read
  expr?: string;            // expression source (dice, arithmetic, refs)
  combine?: string;         // scale only: '*' | '+' | expr
  target?: string;          // contribute only: vessel key
  effects?: Effect[];       // fire on this operator's outcome
}

interface Flow {
  admitted: boolean;        // gates clear this; nothing downstream fires once false
  value: number;            // running scalar; roll/scale write it
  matchedValue: number;     // numeric value of the most recent gate-matched tag; 0 if none/non-numeric
  rolls: RollRecord[];      // audit trail, copied to the tick row (§3.2)
}
// initial per (agent, task, tick): { admitted: true, value: 0, matchedValue: 0, rolls: [] }

interface Vessel {
  name?: string;            // display label; defaults to the key
  fullWhen: string;         // 'op value' term, e.g. '>= 4' (VALUE_COMPARE grammar)
  success?: boolean;        // counts toward completion; default true
}
// A vessel's FILL is not stored on the vessel: it is task.blackboard[key] (number, default 0).

interface Effect { on: 'pass'|'fail'|'threshold'|'completion'; actions: Action[]; }
interface Action { kind: string; params: object; }   // serializable; key into ACTION_REGISTRY
interface RollRecord { operatorId: string; agentId: string; rollIndex: number;
                       notation: string; result: number; }
```

`matchedValue` is a spec-level refinement of the refined plan's three-field
`flow` struct: it is what the `{value}` resolver source reads, and it is how the
lowered legacy formula reproduces all four accrual branches (§5.1).

### 1.3 Operator kinds and quantifiers

`OPERATOR_REGISTRY` in new `src/logic/operators.js` — one ordered list per task,
one registry of kinds, pluggable exactly like `MATCH_MODE_REGISTRY`; subsumes
`TRACKER_REGISTRY` (`src/logic/conditions.js:95`, today exactly one kind,
`work`, with interface `(condition, context) => number`).

```ts
OPERATOR_REGISTRY: { [kind: string]: (op: Operator, flow: Flow, ctx: OpContext) => Flow }
```

| Kind | Role | Semantics |
|------|------|-----------|
| `gate` | boolean admit/reject | Evaluate `read`+`compare` (tag term) or `expr`+`compare` (check). Pass → flow continues, `matchedValue` set from the matched tag's numeric value (0 if non-numeric). Fail → `admitted = false`; nothing downstream fires. |
| `scale` | scalar transform | `flow.value = combine(flow.value, evaluate(expr))`; `combine` is `'*'`, `'+'`, or an expr over `{flow}`. Never resurrects rejected flow. |
| `contribute` | deposit into a vessel | Deposit `evaluate(expr)` (default `1`) into `blackboard[target]`; emits one `work_contribution` row per depositing agent (§3.2). The generalized `work` tracker. |
| `roll` | seeded die into flow | `flow.value = evaluateCheck(expr)`; appends a `RollRecord` (§6). |
| `write` | write the blackboard | `flag.set` as an operator — the state half of deferral. |
| `effect` | fire actions | Bridges to `ACTION_REGISTRY` (§7); fires its `effects` by outcome. |

`QUANTIFIER_REGISTRY` (same module): **absent quantifier = per-agent** — the
fold runs independently per engaged agent, which is exactly the legacy
semantics and what lowering emits. A present quantifier collapses the per-agent
pass/fail vector to one node-level outcome: `all`, `any` (= `atLeast(1)`),
`atLeast(n)`, `count` (deposits the passer count once per node instead of per
passer). Order is author-controlled and literal.

---

## 2. The tick pipeline

`advanceTick` (`src/logic/clock.js:56`) keeps its exact envelope — one
`newState` per tick, committed whole by `APPLY_TICK`
(`src/hooks/usePlayClock.js:63`, `src/state/reducer.js:488`), row ordering
contract `work* → task_complete* → action* → tick` (one new row family, §3) —
but the per-condition loop is replaced by the operator fold:

```
for each tick:
  snapshot = start-of-tick state (blackboards, entities, session)   // phase 1: reads
  for each active task:
    for each engaged agent:                        // per-agent fold (default)
      flow = { admitted: true, value: 0, matchedValue: 0, rolls: [] }
      for op in task.operators:  flow = OPERATOR_REGISTRY[op.kind](op, flow, ctx)
    collapse quantified nodes; collect deltas + log rows
  apply accumulated deltas (blackboard writes, action deltas)        // phase 2: writes
  for each task: if every success-vessel is full → fire on:'completion' effects
  emit tick boundary row; cap log
```

**Two-phase discipline (hard rule):** all predicates evaluate against the
start-of-tick snapshot; all writes apply after. A condition reading a flag never
depends on sibling order within the tick — only the fold's author order matters,
and only for operators consuming the running `flow`. Cross-tick deferral (write
this tick, read a later tick) is the intended multi-step mechanism; an agent
spawned mid-tick is not engaged (and cannot be rolled for) until the next tick,
whose clock value is stable (§6).

**Completion** = every `success: true` vessel's `fullWhen` passes against
`blackboard[key]`, evaluated once per tick after writes (unchanged cadence).
Zero-vessel tasks keep the current implied behavior. The manual ✓ button
(`TASK_SET_COMPLETE`) routes `on:'completion'` effects through the same
`applyActions`. `duration` compiles to a countdown operator + vessel at load
(fixed: contributes toward its own expiry vessel; open with `cap`: same, no
completion tie-in); expiry fires nothing — no failure branch.

---

## 3. Event log & rollback contract

The riskiest seam in the whole change (`src/logic/eventLog.js` is
simultaneously the rollback substrate, the CSV contract, and the DOM-key
source). The transition is dual-track: a generic action substrate is added;
the three typed rows survive as an enriched projection.

### 3.1 Columns

`EVENT_LOG_COLUMNS` (`src/logic/eventLog.js:21`) gains two columns **appended
after `data`** (never reorder or drop — import maps by the file's own header):

```
seq, eventType, clock, agentId, agentName, taskId, taskName,
conditionId, conditionName, delta, progress, target, data, actionKind, reverseData
```

- `actionKind` — string, `''` default; the `ACTION_REGISTRY` key that produced
  the row's state change (`'vessel.deposit'` on work rows).
- `reverseData` — JSON blob, `{}` default; the per-kind reverse recipe,
  **including pre-images** for writes whose inverse is "restore prior value"
  (blackboard flags, `tag.adjust`).

`normalizeEvent` learns both (string default / JSON-parse-with-`{}`-fallback,
mirroring `data`); `NUMERIC_COLUMNS` unchanged. Accepted limitation
(Q-logsubstrate): older builds importing a newer CSV silently drop these
columns — such rows fall back to the legacy rollback switch below.

### 3.2 Row families

| eventType | Emitted for | Key fields |
|---|---|---|
| `work_contribution` | every vessel deposit, per depositing agent (unchanged shape) | `conditionId` = vessel key, `delta` = deposit, `progress` = new fill, `target` = fullWhen bound; `actionKind: 'vessel.deposit'` |
| `action` **(new)** | every non-deposit action delta — effect-fired mid-tick and completion actions alike | `actionKind`, `data: { params, deltas }`, `reverseData` |
| `task_complete` | completion state change (audit + legacy import only) | `data: { isComplete, attributes }`; its state changes live in its `action` rows — no double substrate |
| `tick` | boundary, unchanged | `data: { wagesTotal, wages, rolls: RollRecord[] }` (rolls appended for audit; never a source of truth) |

### 3.3 DOM and CSV continuity

Vessel keys migrated from legacy conditions **reuse the condition id**, so the
RAF interpolation path — `.condition-item-bar-fill` / `.condition-item-progress`
addressed by `[data-task-id][data-condition-id]`, with the focus guard
protecting the click-to-edit span (`src/logic/clock.js:239-277`,
`src/components/Dashboard/TaskSections/ProgressSection.jsx`) — needs no rewrite.
`ProgressSection` switches its row source from `task.conditions` to
`task.vessels` (fill from `blackboard[key]`, target parsed from `fullWhen`),
keeping the same selectors and `EditableSpan` behavior. Rollback still reads
only what it reads today plus the new substrate: `conditionId` + `delta` on work
rows, `data.wagesTotal` on the boundary, and now `actionKind`/`reverseData`
(`progress`/`target` remain write-only denormalization).

### 3.4 Rollback dispatch

`rollbackTick` (`src/logic/rollback.js:186`) keeps its group scan and backward
LIFO iteration, but the three-type switch generalizes:

```
row.actionKind ? ACTION_REGISTRY[row.actionKind].reverse(row, ctx)   // generic path
               : legacyReverse(row)                                  // pre-v7 CSVs only
```

All reverses stay best-effort: clamp ≥ 0, skip missing entities, never block.
`reverse: null` kinds are skipped. Boundary handling (clock decrement + wage
refund) is unchanged. The switchboard (§7.2) gates both paths.

---

## 4. Expression engine — extend in place

`src/logic/expressions.js` already has the required contract: `parseExpression`
never throws (`{ ast, error }`), `evaluateExpression(ast, resolveReference)`
takes caller-injected reference resolution, non-finite propagates to the caller,
and `EXPRESSION_FUNCTIONS` is the pluggable function table. Extensions:

**Grammar** (new precedence tiers, loosest → tightest; booleans are `1`/`0`;
any non-finite operand propagates):

```
||  <  &&  <  == != >= <= > <  <  + -  <  * / %  <  unary ! -  <  primary
```

plus a **dice literal** `NdM` (`d20` ≡ `1d20`), tokenized as a single node.
Evaluating a dice node calls `roll(n, m)` from the *active function table*; if
the table has no `roll`, the node evaluates to `NaN` — which propagates and, on
the dyn path, hits the existing default-to-1-plus-warning behavior.

**API** (additive):

- `evaluateExpression(ast, resolveReference, functions = EXPRESSION_FUNCTIONS)`
  — third parameter makes the function table per-call context; existing callers
  are untouched.
- `evaluateCheck(source, { resolve, roll })` — the operator entry point:
  parses, evaluates with `{ ...EXPRESSION_FUNCTIONS, roll }`.
- `evaluateDynamic` — alias for the existing dyn path; never receives `roll`.

**Determinism invariant (tested, not conventional):** `EXPRESSION_FUNCTIONS`
never contains `roll`/randomness; a dice expression through the dyn path yields
the warn-and-default-1 behavior; `reconcileDynamicTags` stays idempotent
(`DYN_RECONCILE` returns the same reference when nothing changed —
`src/state/reducer.js:482-485`, relied on by `src/hooks/useDynReconcile.js` to
avoid a render loop; dyn payloads are materialized into state and saves, so a
stochastic dyn value would churn saves and corrupt rollback).

---

## 5. Resolver namespaces (operator context)

The operator resolver is a **new resolver**, separate from the dyn resolver in
`src/logic/dynamicTags.js:130-147` (which stays strictly two-scope and
object-local). Sources, all through one interface (mirroring
`VALUE_RESOLVER_REGISTRY`):

| Ref | Resolves to |
|---|---|
| `{skill:arcana}`, `{class:*}` … | the engaged agent's effective-attribute tags, numeric resolution, wildcard-sum — same semantics as today's dyn static scope, but against the snapshot |
| `{session:workRate}` etc. | session scalars (`workRate`, `skillBonus`, `rateMultiplier`, `clock`) — **new grammar**; session values are scalars, not tags (`src/logic/conditions.js:70-71`) |
| `{flag:<key>}` | `task.blackboard[key]` from the start-of-tick snapshot |
| `{flow}` | `flow.value` |
| `{value}` | `flow.matchedValue` (§1.2) |

### 5.1 The lowered legacy formula

The `work` tracker's four branches (`src/logic/conditions.js:69-85`): no
`tagPath` → `workRate`; matched tag with numeric value →
`workRate + value * skillBonus`; matched tag non-numeric → `workRate`; no match
→ `0`; all × `stepDays`. The lowering (§8) reproduces all four with one
expression because `{value}` is defined as *0 when the gate-matched tag is
non-numeric or there is no gate*:

```
contribute expr: "{session:workRate} + {value} * {session:skillBonus}"
```

- no `tagPath` → no gate emitted → `{value}` = 0 → `workRate` ✓
- matched numeric → `{value}` = value → `workRate + value * skillBonus` ✓
- matched non-numeric → gate passes, `matchedValue` = 0 → `workRate` ✓
- no match → gate fails → nothing fires → 0 ✓

`stepDays` stays a fold-context multiplier applied to deposits (it is constant 1
per tick today; parity preserved).

---

## 6. Seeded randomness — `src/logic/rng.js` (new)

No RNG utility exists today; the only randomness is `uid()`
(`src/utils.js:2`, `Math.random`-based). New module:

- String-hash seed (xmur3-class) → small PRNG (mulberry32-class); zero deps.
- Seed key: `` `${session.clock}|${taskId}|${operatorId}|${agentId}|${rollIndex}` ``.
- One seeded stream per key; `NdM` draws N values from that one stream (one
  dice literal = one `rollIndex`).
- `rollIndex` is a per-`(taskId, operatorId, agentId)` monotonic counter in the
  tick eval context, so an operator's follow-up roll and any effect-fired
  sub-roll get distinct indices within the tick.

Replay re-derives every roll (rollback decrements the clock; replay restores
it), so results are identical when rules/participants are unchanged and
naturally fresh if the author edited the operator — inheriting the existing
"replaying forward regenerates fresh rows" stance. Spawned-agent ids remain
random `uid()`; determinism is unaffected because the two-phase rule (§2) keeps
mid-tick spawns out of the current tick's rolls. The log records outcomes for
audit only (§3.2).

---

## 7. Actions — `src/logic/actions.js` (new)

### 7.1 Registry

```ts
ACTION_REGISTRY: { [kind: string]: {
  apply:   (action: Action, ctx) => { deltas: StateDelta[], logRow: Partial<EventLogEntry> },
  reverse: ((row: EventLogEntry, ctx) => StateDelta[]) | null,
} }
```

`applyActions` accumulates deltas into the tick's `newState` — generalizing
`applyResults` / `applyTaskComplete` (`src/logic/tasks.js:52,106`). Note the
current functions return **full new arrays** (`newAgents`, `newInventory`,
`newTasks`) plus `bankDelta` and id lists — the delta-list refactor is a real
restructuring of that seam, not a rename.

Built-in kinds (v1): `vessel.deposit` (the contribute substrate), `bank.adjust`
(negate), `inventory.add`/`.remove` (inverse op, clamp ≥ 0), `agent.spawn`
(reverse deletes) / `agent.remove` (**`reverse: null`** — held items not
returned, matching the current gotcha), `agent.assign`/`.unassign` (inverse),
`tag.apply`/`.remove`/`.adjust` (inverse; `adjust` carries pre-image),
`flag.set`/`.clear` (pre-image restore), `object.create` (delete). Selectors
reuse the tag-matching engine — `{ scope: 'assigned'|'operator'|'entity', … }` —
no new grammar. Future kinds are additive registry entries.

`results` becomes a **derived read-only view**: `effects` filtered to
`on:'completion'`, mapped to `{gold, items, agents}` so `ResultsSection.jsx`
survives unchanged; `TASK_UPDATE_RESULTS` and `TASK_CONDITION_ADD/UPDATE/REMOVE`
are retained as **sugar verbs that lower at dispatch** into
effects/operators/vessel edits (the condition draft grammar
`path[op value][=target]` — `splitConditionDraft`, `src/logic/conditions.js:207`
— compiles to a `gate + contribute` pair + vessel).

### 7.2 Switchboard generalization

`rollback.yml`'s seven `reverse.*` flags stay as recognized defaults;
`ROLLBACK_SCHEMA` (`src/logic/rollback.js:48`) drops `closed` on the `reverse`
map and gains `anyKey: boolean` so per-action-kind flags sit alongside them
(the config-editor grammar already supports `anyKey` —
`src/logic/configEditor.js:42`). Lookup: `reverse[actionKind] ?? legacy-category
?? true` (unknown kinds default reversible-on). Legacy category mapping:
`workProgress → vessel.deposit`, `rewardGold → bank.adjust`, `rewardItems →
inventory.*`, `spawnedAgents → agent.spawn`, `agentReassignment →
agent.assign/unassign`; `taskCompletion` and `wages` keep their current
boundary-row meanings.

### 7.3 Locked-gate extension

Tag-writing actions (`tag.apply`, `tag.adjust`, `agent.spawn` templates,
`object.create`) are a new write path — the right time to close the
`docs/gotchas.md → Locked Tags Gate Creation Only` gap rather than widen it.
`applyActions` routes them through the same shared checker used for entity
creation (`unregisteredEntityTags`, `src/logic/tagRegistry.js:325`): registry
unlocked → register literal paths (never `=value` — registry-bounded values
rules 1–2); locked + unregistered → the **action is skipped and its log row
marked** (`data.skipped: 'locked'`) — consistent with "rollback never blocks":
the tick itself never fails. Free-form edits and session import remain out of
scope for the gate (unchanged from today).

---

## 8. Migration (Phase 1, all at once)

Storage key bumps `dnd-hirelings-state-v6 → -v7` (`src/state/storage.js:17`)
**with an explicit fallback read** — the first *migrating* bump: `loadState`
reads `-v7`, else reads `-v6` raw and lowers it through `normalizeState`
(contrast every previous bump, which abandoned; the same-version normalization
machinery — `migrateLegacyWork`, `migrateTag` — is the precedent for the
lowering itself). This moves the bump from the refined plan's Phase 3 to Phase
1, because Phase 1 is when the stored `Task` shape changes (Q-migration).

Lowering rules (in `normalizeState`, idempotent):

```
condition { id, name, progress, target, tracker: { kind:'work', tagPath, compare } }
  → tagPath ? operators += { id: `${id}-gate`, kind:'gate', read: tagPath, compare } : nothing
  → operators += { id, kind:'contribute', target: id,
                   expr: '{session:workRate} + {value} * {session:skillBonus}' }
  → vessels[id] = { name, fullWhen: `>= ${target}` }
  → blackboard[id] = progress

results { gold, items, agents }
  → effects += { on:'completion', actions: [ bank.adjust{amount:gold},
                 inventory.add{…} per item, agent.spawn{template,quantity} per agent ] }

duration (new authoring) → countdown operator + vessel at load (§2)
```

Unknown tracker kinds (none exist in practice) lower to an inert `write`
operator carrying the original payload, so nothing is silently dropped.
`session.workRate`/`skillBonus` remain live session fields, untouched.

---

## 9. Authoring surface (v1)

- **`CONFIG_FILES`** (`src/logic/configRegistry.js:48`) gains a `tasks` entry —
  `kind: 'state'` (like `session`), bound to `state.tasks`, with a
  `TASKS_SCHEMA` descriptor: list of task maps; `operators` a list node;
  `vessels` an `anyKey` map; `expr`/`fullWhen` scalar strings validated
  non-blocking via `parseExpression`'s `{ error }` (warnings never block, SAVE
  never writes `public/` — existing Config Modal ethos).
- **Presets**: `public/presets/task_presets.json` entries may carry the full v7
  shape; `loadPresetsFromFile` stays lenient.
- **Sugar**: the Tag Registry modal's condition mode and the `+ CONDITION` /
  results-section flows keep working verbatim — their verbs lower at dispatch
  (§7.1).
- The bespoke in-card operator builder is Phase 4 — a separate workstream; the
  engine must not block on it.

---

## 10. Worked examples

The three tasks from the draft, in v7 authored form. `journal.addEntry` and
`map.reveal` are future kinds (non-scope); v1 exit criteria substitute
`bank.adjust`/`inventory.add` completions.

**1 — Find Victor and Zellen** (fixed window, 4 ticks)
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
  - { on: completion, actions: [ { kind: journal.addEntry,   # future kind
        params: { text: "Location & info on Victor and Zellen" } } ] }
```

**2 — Infiltrate the City Watch** (open, cap 30)
```yaml
duration: { kind: open, cap: 30 }
operators:
  - { id: perform,     kind: gate, quantifier: all,
      expr: "d20 + {skill:performance}",   compare: { op: ">=", value: "12" } }
  - { id: investigate, kind: gate, quantifier: any,
      expr: "d20 + {skill:investigation}", compare: { op: ">=", value: "28" } }
  - { id: progress, kind: contribute, target: infiltration, expr: "1" }
vessels: { infiltration: { fullWhen: ">= 30" } }
```

**3 — Explore the GUA Tunnels** (open, cap 10; lethal hazard via chained effect)
```yaml
duration: { kind: open, cap: 10 }
operators:
  - { id: hazard,    kind: roll, expr: "d6" }
  - { id: hazardHit, kind: gate, read: flow, compare: { op: "==", value: "1" } }
  - { id: combat,    kind: gate, quantifier: any,
      expr: "d20 + {skill:combat}", compare: { op: ">=", value: "13" },
      effects: [ { on: fail, actions: [ { kind: agent.remove,
        params: { selector: { scope: operator, operatorId: combat, outcome: fail } } } ] } ] }
  - { id: investigate, kind: gate, quantifier: any,
      expr: "d20 + {skill:investigation}", compare: { op: ">=", value: "32" } }
  - { id: progress, kind: contribute, target: mapped, expr: "1" }
vessels: { mapped: { fullWhen: ">= 10" } }
```

The lethal chain: `hazard` rolls (seeded) → `hazardHit` admits only on a 1 →
`combat` rolls per agent; its `on:fail` effect fires `agent.remove` against each
failing agent. `agent.remove` is `reverse: null` — the death survives rollback,
everything else rewinds.

---

## 11. Contract-survival walk (the go/no-go vertical)

`bank.adjust`, end to end — every step must hold in Phase 1's exit test:

1. **Author**: a completion effect `{ kind: 'bank.adjust', params: { amount: 50 } }`
   (via lowering of `results.gold` or the config tree).
2. **Fire**: task completes in `advanceTick`; `applyActions` produces
   `deltas: [{ path: 'session.bank', delta: +50 }]` folded into the one
   `newState`; `APPLY_TICK` commits it.
3. **Log**: one `action` row — `actionKind: 'bank.adjust'`,
   `data: { params, deltas }`, `reverseData: {}` — sequenced inside the tick
   group before the `tick` boundary; `seq` monotonic, FIFO cap unaffected.
4. **Export**: `serializeEventLog` writes the 15-column CSV; the two new
   columns serialize like `data`.
5. **Import**: `parseEventLog` maps by header; `normalizeEvent` restores
   `actionKind`/`reverseData` (older builds: dropped — accepted limitation).
6. **Rollback**: `rollbackTick` walks the group backward; the row dispatches
   `ACTION_REGISTRY['bank.adjust'].reverse` → `-50`, clamp ≥ 0, gated by
   `reverse['bank.adjust'] ?? reverse.rewardGold ?? true`; boundary then refunds
   wages and decrements the clock; group truncated from the log.
7. **DOM**: untouched throughout — bank renders from state; vessel rows keep
   their `[data-condition-id]` keys.

---

## 12. Build plan

Vitest infra exists (23 test files, including `conditions/tasks/clock/rollback/
eventLog/expressions/reducer.test.js`) — every phase lands with companion tests.

**Phase 0 — Foundations (no behavior change).**
`src/logic/rng.js`; expression grammar + `evaluateCheck`/`evaluateDynamic`
(§4); `Flow` and log-column shapes pinned by tests.
*Exit:* new pieces unit-tested; dyn path byte-identical (existing
`expressions.test.js` + `dynamicTags.test.js` green; determinism invariant
tests in).

**Phase 1 — Vertical slice + full lowering (go/no-go).**
`operators.js` (`gate`, `contribute`, per-agent default, `QUANTIFIER_REGISTRY`);
`actions.js` (`vessel.deposit`, `bank.adjust` with reverse); full
`normalizeState` lowering + `-v7` bump with v6 fallback read (§8); legacy
condition path deleted from `clock.js`; `ProgressSection` renders vessels
(same selectors); log rows enriched; `rollbackTick` generic dispatch with
legacy fallback.
*Exit:* parity fixture — a v6 save advanced N ticks then rolled back N ticks
produces identical state and identical log rows (modulo the two new columns)
pre/post refactor; the §11 walk passes.

**Phase 2 — Actions breadth, effects, blackboard.**
Remaining v1 action kinds; `effect` operator + outcome-fired effects;
blackboard as resolver source; locked-gate extension (§7.3); `results` as
derived view + sugar-verb lowering.
*Exit:* example 3's lethal chain works (`effect` → `agent.remove`); `results`
migration lossless against `ResultsSection`.

**Phase 3 — Time, dice sugar, switchboard.**
`scale`/`roll`/`write` kinds; `duration` → countdown lowering; `fullWhen`
grammar wiring; switchboard `anyKey` generalization (§7.2).
*Exit:* all three worked examples run from authored preset data; open/fixed
durations behave with no failure branch.

**Phase 4 — Builder UI (separate workstream, not part of this spec's
acceptance).**

---

## 13. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Event-log generalization breaks CSV round-trip, rollback LIFO, or progress-bar DOM keys | **High** | Dual-track substrate (§3); columns appended only; vessel keys = legacy condition ids; §11 walk is the Phase 1 gate. |
| Stochastic value reaches the dyn reconciler → render loop / save churn / rollback corruption | **High** | Function table per-call; `roll` absent from `EXPRESSION_FUNCTIONS`; tested invariant (§4). |
| Migration silently changes accrual | **Med** | Four-branch reproduction via `{value}` (§5.1); parity fixture in Phase 1's exit. |
| Delta-list refactor of `applyResults`/`applyTaskComplete` regresses completion edge cases | **Med** | Existing `tasks.test.js` retained against the derived `results` view; completion actions go through the same `action`-row walk. |
| Blackboard writes not invertible | **Med** | `reverseData` carries pre-images; blackboard stays plain JSON (§1.1). |
| Scope blowout via builder UI | **Med** | v1 is config + presets only (Q-authoring); Phase 4 separate. |
| Newer CSV → older build loses action rollback fidelity | **Low (accepted)** | Documented limitation (Q-logsubstrate); legacy rows still reverse via fallback. |
| Seeded rolls non-reproducible for mid-tick spawns / sub-rolls | **Low** | Two-phase snapshot + per-context `rollIndex` (§6). |

---

## 14. Rejected / deferred (carried from the draft)

Rejected: re-dispatching reducer actions for effects (decision 1); overloading
`progress`/`satisfied` for designer flags (decision 3); one mega expression
language covering tags (decision 4 — re-merges the structure/value separation
`tag-values.md` made); a staged lifecycle with timeout/failure branch
(decision 9); recording every roll as immutable history (decision 8);
irreversible actions shortening the rollback horizon (decision 10); **adopting
an expression-library dependency** (reversed — see Decision log).

Deferred: internal `phases[]` engine (chained tasks + blackboard hand-off cover
it); task-level `successExpr` (default all-vessels-full); expression-based
`fullWhen`; reusable action/operator templates in presets; `journal.*` /
`map.*` / `roster.*` kinds; builder UI (Phase 4).
