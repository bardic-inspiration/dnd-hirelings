# Tasks, Conditions, Actions & Results (design draft — issue #TBD)

Status: **draft / design record.** Rough draft to be refined into a spec. This
revision folds in the ten governing decisions taken during design review (§1);
every later section elaborates one of them. Follows the idiom of
`docs/tag-values.md` (Problem → Decision → Consequences → Open questions) and
reuses the plug-in registry pattern (`MATCH_MODE_REGISTRY`,
`VALUE_RESOLVER_REGISTRY`, `MODIFIER_REGISTRY`, `VALUE_COMPARE_REGISTRY`,
`CONFIG_FILES`).

Cross-refs: `docs/architecture.md` → Task Conditions, Game Clock, Event Log,
Rollback, Dynamic Tags; `docs/api.md` → `logic/tasks.js`, `logic/conditions.js`,
`logic/clock.js`; `docs/gotchas.md` → Conditions, Tag-Path Match Modes;
`docs/tag-values.md` → registry-bounded values.

---

## 0. Governing principle: *fluid authentication*

The whole system is one idea:

> **The tick is a coarse refresh rate for game state. Each tick, flow passes
> through every active task. Everything is admitted by default; conditions
> **gate** the flow (boolean) and modulators **modulate** it (scalar); flow that
> clears the gates enters a **vessel**, where data is consumed and **actions
> proliferate**. A task completes when its vessels are filled.**

Consequences that ripple through every section:

- **Nothing is privileged.** "Progress" is not a special mechanism — it is the
  most common *action* (a scalar contribution into a vessel). Rewards are
  actions. Death is an action. A journal entry is an action. (§4)
- **An unmet condition is not a failure.** It is simply flow passing through
  with nothing firing. There is **no timeout/failure branch** — a task that
  outlives its window just stops existing; whatever filled, filled. (§8)
- **Meaning lives in the reader, not the data.** Data written during a tick has
  no mechanical effect until some operator is designed to read it — the same
  stance `tag-values.md` took for registry-bounded values. (§5)

The current placeholder schema (fixed `conditions` accrual + a fixed
`results: {gold, items, agents}` struct) is a narrow special case of this and is
subsumed, not extended.

---

## 1. The ten governing decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | How do effects mutate state in the tick loop? | **Delta descriptors in pure logic.** Actions lower into serializable deltas that `applyActions` accumulates into the single `newState` inside `advanceTick`; each delta is logged for rollback. Actions never re-enter the reducer. |
| 2 | Do conditions fire actions? | **Yes.** Operators/conditions carry effects (fire actions on pass/fail/threshold) through the *one* action pipeline. Effects can **chain**: an effect writes task-local state that a later operator reads → deferral emerges from a read/write graph, no scheduler. |
| 3 | Where does that written state live? | **A task-local blackboard** — an arbitrary key/value namespace, *not* overloaded onto `progress`/`satisfied`. Effects write it; predicates read it. |
| 4 | What language do predicates read through? | **Both, layered.** Extend `expressions.js` into a full expression library (adopting a small, sandboxed math dependency rather than hand-rolling arithmetic) *under* the bespoke `{ref}`/`{dyn,}`/wildcard resolution; **tag comparisons stay in the bespoke tag-matching engine**; the blackboard is a resolver source. |
| 5 | How do per-tick agent interactions produce progress? | The per-(agent, task) tick interaction is an **event distribution node**: it engages conditions and fires actions. Contribution (boolean or scalar) is an *action*; no action → nothing logged → no progress. Filled vessels = completion. |
| 6 | Conditions vs vessels — distinct objects? | **Roles in one flow, not rivals.** Fully-general engine (gate → modulate → contribute → vessel); "a gated contribution to my own target" is authoring **sugar** over it. |
| 7 | Are modulators a separate primitive; how compose? | **A single ordered `OPERATOR_REGISTRY`.** Conditions and modulators are operator *kinds* (`gate` / `scale` / `contribute` / …), folded in author-declared order; each carries its own combine expression. Subsumes `TRACKER_REGISTRY`. |
| 8 | How do dice survive rollback/replay? | **Seeded PRNG.** A roll is a pure function of a seed keyed on `(clock, taskId, operatorId, agentId, rollIndex)`; replay re-derives it; the log records outcomes for audit/UI only. |
| 9 | How does time fit the model? | **Tick = coarse refresh rate.** A task simply persists for N ticks. `duration` is sugar that compiles to a countdown operator; unfilled vessels at window's end just don't fire (non-resetting; no failure state). |
| 10 | Irreversible actions & rollback? | **Per-kind `reverse`, `null` allowed.** Reversible deltas invert best-effort; `reverse: null` is skipped; rollback never blocks. The `rollback.yml` switchboard generalizes to per-action-kind flags. |

---

## 2. The tick pipeline (the engine)

### 2.1 The event distribution node

Each tick, for every (agent, task) engagement, the node runs the task's ordered
operator list once. This replaces the current hard-coded `computeConditionContribution`
loop; the clock loop itself learns nothing new — it folds an operator list, and
operator *kinds* live in a registry (§3).

```
for each tick (advancement vector):
  for each active task:
    snapshot = read blackboard + entity state at tick start   // phase 1: reads
    for each (agent engaged with task):
      flow = admit(agent, task)                 // fluid authentication: permissive
      for op in task.operators (author order):  // fold
        flow = OPERATOR_REGISTRY[op.kind](op, flow, ctx(snapshot))
      // flow that survived gates has been modulated and contributed
    apply all writes/deltas produced this tick   // phase 2: writes
    if every success-vessel is full: fire on:'completion' actions
```

> **Two-phase tick (reads then writes).** All predicates evaluate against the
> **start-of-tick snapshot**; all blackboard/state writes apply after. So a
> condition that reads a flag never depends on sibling operator order *within*
> the same tick — only author order of the *fold* is significant, and only for
> operators that consume the running `flow` value. Cross-**tick** deferral
> (write this tick, read a later tick) is unaffected and is the intended way to
> stage multi-step tasks (§5.3).

### 2.2 Vessels

A **vessel** is a fillable target with a "full-when" test. Vessels are not a new
storage primitive — a vessel is a **blackboard entry** the completion check
reads (§5). The common case (a scalar target like "4 successful days") is
authored as sugar; the general case (a vessel fed by several operators, or whose
full-test is an expression) falls out of the blackboard + reader model for free.

---

## 3. Operators (`OPERATOR_REGISTRY`)

One ordered list per task; one registry of kinds, pluggable exactly like
`MATCH_MODE_REGISTRY`. This **subsumes `TRACKER_REGISTRY`** — the legacy `work`
tracker becomes a `contribute` operator gated by a `gate` operator.

```ts
// src/logic/operators.js
OPERATOR_REGISTRY: { [kind: string]: OperatorFn }
type OperatorFn = (op: Operator, flow: Flow, ctx: OpContext) => Flow;

interface Operator {
  id: string;
  kind: string;            // 'gate' | 'scale' | 'contribute' | 'roll' | 'write' | 'effect' | …
  quantifier?: string;     // key into QUANTIFIER_REGISTRY: 'all' | 'any' | 'atLeast' | 'count'
  expr?: string;           // expression-library source (dice, arithmetic, refs)
  read?: Read;             // tag path / blackboard key / expression — via resolver
  compare?: { op, value }; // VALUE_COMPARE term for tag reads
  combine?: string;        // how a scale operator folds ('*', '+', or an expr) — decision 7
  target?: VesselRef;      // for contribute: which vessel receives flow
  effects?: Effect[];      // actions to fire (on pass/fail/threshold) — §4.3
}
```

Baseline kinds:

| Kind | Role | Notes |
|------|------|-------|
| `gate` | boolean admit/reject | pass → flow continues; fail → flow stops (nothing downstream fires) |
| `scale` (modulator) | scalar transform | multiplies/adds/expr-combines the flow value; **declares its own `combine`** (your `value * skillBonus` is `*`, `workRate +` is `+`) |
| `contribute` | deposit into a vessel | the generalized `work` tracker |
| `roll` | inject a seeded die result into `flow`/blackboard | §7 |
| `write` | write the blackboard | the state half of deferral (§5) |
| `effect` | fire actions | the bridge to §4 |

`QUANTIFIER_REGISTRY` collapses a per-agent pass/fail vector to a node-level
outcome — `all`, `any` (= `atLeast(1)`), `atLeast(n)`, `count` (contributes the
number of passers). "All must pass DC 24" and "at least one must pass" are
`all` / `any`.

> Order is **author-controlled and literal** — consistent with fluid
> authentication, the author owns the sequence. A failed `gate` means there is
> nothing for a downstream `scale` to modulate; modulators never resurrect
> rejected flow.

---

## 4. Actions (`ACTION_REGISTRY`) — the universal effect primitive

### 4.1 Shape

```ts
// src/logic/actions.js
ACTION_REGISTRY: { [kind: string]: ActionHandler }
type ActionHandler = (action: Action, ctx: ActionContext) => EffectResult;

interface Action { kind: string; params: object; }   // serializable
interface EffectResult {
  deltas: StateDelta[];                    // accumulated into newState (decision 1)
  logRows?: Partial<EventLogEntry>[];
  reverse: ((ctx) => StateDelta[]) | null; // null ⇒ not reversible, skipped (decision 10)
}
```

An action **never touches the reducer** (decision 1). It emits deltas that
`advanceTick` accumulates into the one `newState` committed by `APPLY_TICK`, and
each delta is logged so rollback inverts it by subtraction — mirroring how the
tick loop already works and how `applyResults` already lives in pure logic. The
manual ✓ button (`TASK_SET_COMPLETE`) routes `on:'completion'` actions through
the same `applyActions`.

### 4.2 Built-in kinds

Today's three result fields become three built-in actions; the enumerated
capabilities become the rest. Nothing is special-cased.

| Kind | Params | Covers | `reverse` |
|------|--------|--------|-----------|
| `bank.adjust` | `{ amount }` | `results.gold` | negate |
| `inventory.add` / `.remove` | `{ name, quantity, attributes? }` | `results.items` | inverse op, clamp ≥ 0 |
| `agent.spawn` / `.remove` | `{ template, quantity }` / `{ selector }` | `results.agents`; **hireling death** | spawn⁻¹ deletes; remove⁻¹ = `null` (held items not returned — matches current gotcha) |
| `agent.assign` / `.unassign` | `{ selector, taskId }` | chain into another task | inverse assign |
| `tag.apply` / `.remove` / `.adjust` | `{ selector, tag }` / `{ selector, path, delta\|expr }` | tag proliferation & value adjustment | inverse; `adjust` subtracts |
| `flag.set` / `.clear` | `{ key, value }` | write the blackboard (§5) | restore prior value |
| `object.create` | `{ type, template }` | generic escape hatch | delete |

Future kinds are additive (one registry entry + one reducer effect + optional
config schema, **no schema migration**): `journal.addEntry`, `roster.setRole` /
`roster.link`, `map.reveal` / `map.place`. Several of these are inherently
`reverse: null` (§10).

**Selectors** reuse the tag-matching engine (no new grammar):
`{ scope: 'assigned', tagPath?, compare? }`, `{ scope: 'operator', operatorId,
outcome: 'pass'|'fail' }`, `{ scope: 'entity', id }`. "Hireling dies on failure"
= `agent.remove` with `selector: { scope: 'operator', operatorId: <combat>,
outcome: 'fail' }`.

### 4.3 Effects, chaining, and deferral

An operator's `effects` fire actions on `pass` / `fail` / `threshold`. Because an
action can `flag.set` the blackboard and a later operator can read it (§5),
**deferral is a read/write graph, not a scheduler**: flag a condition satisfied
mid-task, read it at completion to decide whether another action fires. "Mark
condition satisfied" is just one convention over the general store.

### 4.4 `results` is a derived view

`results` is retained read-only as `actions.filter(on == 'completion')` mapped
to `{gold, items, agents}`, so existing UI survives the transition — the single
source of truth is the action/operator list.

---

## 5. The blackboard (task-local data)

### 5.1 Model

`task.blackboard: { [key]: value }` — an arbitrary namespace with **no built-in
mechanical function**. It is inert until a reader (an operator, a vessel's
full-test, a `when` predicate) invokes it. This is the same principle as
registry-bounded values: the *reader* supplies meaning; the store is a pure data
skeleton.

- **Vessels are blackboard entries** with a full-when test — no separate primitive.
- **"Flag a condition successful"** is a `flag.set` convention; every operator's
  own pass/fail outcome is *also* exposed as an automatically-readable blackboard
  key, so the "flag → read later" flow needs no bespoke plumbing.

### 5.2 Read/write discipline

Reads see the start-of-tick snapshot; writes apply after (§2.1). `flag.set` /
`flag.clear` deltas invert trivially (restore prior value), so the blackboard is
fully rollback-safe.

### 5.3 Deferral is the multi-step mechanism

Cross-tick: write this tick, read a later tick. This is how phases are built
without a phase engine (chained tasks + blackboard hand-off), which is why an
internal `phases[]` engine stays deferred (§13).

---

## 6. Predicates & expressions

Two layered engines, per decision 4:

1. **Expression library** (`src/logic/expressions.js`, extended) — arithmetic,
   booleans, comparisons, `min/max/floor/…`, and **dice** (§7). Adopts a small,
   **sandboxed, parser-based** math dependency for the arithmetic core (no
   `eval`; not the whole of a large lib). It runs **under** the existing bespoke
   resolution: braces (`{ref}`, `{dyn,addr}`, `{class:*}` wildcard-sum) are
   resolved to numbers *first* by the app's own resolver, then handed to the
   library. The library never sees tags.
2. **Tag-matching engine** (`src/logic/tagMatching.js`) — unchanged; the *only*
   path for tag path-selection + value comparison (`MATCH_MODE_REGISTRY` +
   `VALUE_COMPARE_REGISTRY`). Bespoke because it encodes this app's data model.

The **blackboard is a resolver source** alongside tag paths and expressions
(mirroring `VALUE_RESOLVER_REGISTRY`), so `read: flag:combat-survived` and
`read: skill:arcana` go through one resolver interface.

> **Determinism boundary (critical).** `roll()` is registered **only** into the
> operator-evaluation context, **never** the dyn-tag evaluator. Dynamic tags are
> materialized into state and saves and must stay pure/idempotent
> (`DYN_RECONCILE` returns the same reference when nothing changed); a
> stochastic dyn tag would churn state and corrupt rollback. Same arithmetic
> core, two entry points — `evaluateCheck` (dice exposed) vs `evaluateDynamic`
> (dice absent).

> ⚠️ **Dependency choice needs a security/size pass.** This would be the app's
> **first runtime logic dependency** (today only react / react-dom / js-yaml /
> vite ship; the Pillow/fontTools/brotli converters are explicitly dev-only per
> `CLAUDE.md`). Candidate shape: a small parser-evaluator (e.g. an `expr-eval`-
> class library) with no `eval`, custom-function injection for `roll`, and a
> constrained scope. Confirm the exact library, its size, and its sandbox
> guarantees before committing.

---

## 7. Dice & seeded randomness

A `roll` operator injects a die result. The roll is a **pure function of a seed**
keyed on `(session.clock, taskId, operatorId, agentId, rollIndex)` — `rollIndex`
disambiguates an operator that rolls more than once per agent per tick (e.g. a
`1d6` hazard that triggers a follow-up `d20`).

- **Replay re-derives** the roll from the seed → identical when rules/participants
  are unchanged, naturally fresh if the author edited the operator. This inherits
  the codebase's existing "replaying forward regenerates fresh rows" and "manual
  edits since the tick survive" stance — snapshot-free, horizon-independent.
- The event log records the **outcome** (rolled value, pass/fail) for UI/audit,
  not as the source of truth.

---

## 8. Time, duration, completion

- **Tick = coarse refresh rate.** A task is just something that persists across
  some ticks. "Lasts 4 ticks" = it sticks around 4 ticks; each tick, the flow
  runs; if conditions are met, things happen; if not, flow passes through.
- **`duration` is sugar** compiling to a **countdown operator** (a tick-counting
  vessel) so a deadline is not a lifecycle special-case — it's just more flow.

```ts
duration: { kind: 'open' | 'fixed', ticks?, cap? }   // → countdown operator
```

- **No failure branch.** Window elapses → the task stops existing; filled vessels
  stay filled, unfilled ones simply never fired their completion actions. A
  failed day contributes `+0` (non-resetting) because no gate passed, so no
  `contribute` action fired — this falls out of the model, it is not a rule.
- **Explicit consequences are opt-in operators** (an `effect` on `fail`, a
  reset-on-fail operator, a hard-fail operator) — never built in.
- **Completion** = every success-vessel full, evaluated once per tick inside
  `advanceTime` (unchanged cadence; zero-vessel tasks keep the current implied
  "clock advanced" behavior).

---

## 9. Where it lives (tiers & modules)

Stays inside the one-directional tier map (UI → state → logic → utils) and the
pure-delta tick loop.

| Concern | Home |
|---------|------|
| `OPERATOR_REGISTRY`, fold | new `src/logic/operators.js` (subsumes `conditions.js` trackers) |
| `QUANTIFIER_REGISTRY` | `src/logic/operators.js` |
| `ACTION_REGISTRY`, `applyActions` | new `src/logic/actions.js` (generalizes `applyResults`) |
| Blackboard read/write, resolver source | `src/logic/blackboard.js` + `VALUE_RESOLVER_REGISTRY` seam |
| Expression library + dice, `evaluateCheck` | `src/logic/expressions.js` (extended) |
| Seeded PRNG | `src/logic/rng.js` (seeded from `session.clock`) |
| Stage/duration → countdown operator, completion | `src/logic/tasks.js` |
| Reducer wiring | `advanceTick` folds operators → deltas → one `APPLY_TICK`; manual ✓ routes `completion` actions |
| Rollback | per-kind `reverse`; `rollback.yml` switchboard → per-action-kind flags |
| Config | a `tasks`/`operators` entry in `CONFIG_FILES`; ruleset dice/DC math in `public/config/rules.yml` |

---

## 10. Rollback

Per decision 10, consistent with the existing contract ("every inverse is
best-effort… rollback never blocks"):

- Each `ACTION_REGISTRY` entry supplies `reverse` (delta subtraction, clamp ≥ 0,
  skip missing entities) or `reverse: null`.
- `null` actions are **skipped** on rollback, not blocked — a task that awarded
  lore stays rewindable for everything else.
- The `rollback.yml` `reverse.*` switchboard generalizes from the fixed
  categories (`rewardGold`, `spawnedAgents`, …) to per-action-kind flags.
- Seeded rolls (§7) re-derive on replay, so the only genuinely irreversible thing
  is an action's **world effect**, never the randomness that produced it.

---

## 11. Worked examples (the three tasks, lowered)

Illustrative shapes, not literal transcriptions.

**1 — Find Victor and Zellen** (persists 4 ticks)
```yaml
duration: { kind: fixed, ticks: 4 }          # → countdown operator
operators:
  - { id: stealth, kind: gate, quantifier: all,
      read: skill:stealth, expr: "d20 + {skill:stealth}", compare: { op: ">=", value: 11 } }
  - { id: investigate, kind: gate, quantifier: any,
      read: skill:investigation, expr: "d20 + {skill:investigation}", compare: { op: ">=", value: 24 } }
  - { id: progress, kind: contribute, target: found, expr: "1" }   # +1/tick when gates pass
vessels: { found: { fullWhen: ">= 4" } }
effects:
  - { on: completion, actions: [ { kind: journal.addEntry, params: { text: "Location & info on Victor and Zellen" } } ] }
```

**2 — Infiltrate the City Watch** (open, cap 30)
```yaml
duration: { kind: open, cap: 30 }            # window elapses → no completion; not a "fail"
operators:
  - { id: perform,   kind: gate, quantifier: all, read: skill:performance,   expr: "d20 + {skill:performance}",   compare: { op: ">=", value: 12 } }
  - { id: investigate, kind: gate, quantifier: any, read: skill:investigation, expr: "d20 + {skill:investigation}", compare: { op: ">=", value: 28 } }
  - { id: progress, kind: contribute, target: infiltration, expr: "1" }
vessels: { infiltration: { fullWhen: ">= 30" } }
effects:
  - { on: completion, actions: [ { kind: journal.addEntry, params: { text: "Watch tips, insider info, connections" } } ] }
```

**3 — Explore the GUA Tunnels** (open, cap 10, lethal hazard via chained effect)
```yaml
duration: { kind: open, cap: 10 }
operators:
  - { id: hazard, kind: roll, expr: "d6" }                      # seeded; writes flow/blackboard
  - { id: hazardHit, kind: gate, read: flow, compare: { op: "==", value: 1 } }   # a 1 came up
  - { id: combat, kind: gate, quantifier: any, read: skill:combat,
      expr: "d20 + {skill:combat}", compare: { op: ">=", value: 13 },
      effects: [ { on: fail, actions: [ { kind: agent.remove,
                    params: { selector: { scope: operator, operatorId: combat, outcome: fail } } } ] } ] }
  - { id: investigate, kind: gate, quantifier: any, read: skill:investigation,
      expr: "d20 + {skill:investigation}", compare: { op: ">=", value: 32 } }
  - { id: progress, kind: contribute, target: mapped, expr: "1" }
vessels: { mapped: { fullWhen: ">= 10" } }
effects:
  - { on: completion, actions: [ { kind: map.reveal, params: { area: "GUA tunnels" } } ] }
```

The lethal chain reads: `hazard` rolls → `hazardHit` gate admits only on a 1 →
`combat` gate rolls, and its `on:fail` effect fires `agent.remove` against the
agent who failed. `agent.remove` is `reverse: null` (held items not returned),
consistent with the current spawned-agent gotcha.

---

## 12. Migration

- **`results` → actions.** `normalizeState` lowers the old struct in place into
  `on:'completion'` actions (`bank.adjust`, per-item `inventory.add`, per-agent
  `agent.spawn`) — same shape of change as the v6 `migrateLegacyWork` that turned
  `task.work` tags into `conditions`. `results` stays as a derived read-only view.
- **`conditions` → operators.** Each legacy condition becomes a `gate` (its
  `tracker.tagPath`/`compare`) + a `contribute` (its `target`/`progress`).
- **Storage key.** Bump `-v6` → `-v7` with an **in-place normalize** (not
  abandonment — there is a clean lowering here).
- **Registry-bounded values.** Tag-writing actions (`tag.apply`, `tag.adjust`,
  spawn templates) respect rules 1–2 (register paths, never register `=value`).

---

## 13. Open questions / Needs clarification

> ⚠️ **Expression-library dependency.** Exact library, size, and sandbox
> guarantees — first runtime logic dep (§6).

> ⚠️ **Fold order vs `flow` semantics.** Author order matters only for operators
> that consume the running `flow`; formalize what `flow` *is* between operators
> (a scalar? a struct of `{admitted, value, rolls}`?) so `read: flow` in example
> 3 is well-defined.

> ⚠️ **Vessel full-test grammar.** `fullWhen: ">= 4"` — does the full-test reuse
> the condition draft grammar (`op value`) or the expression library? Lean:
> draft grammar for scalars, expression library when it references other keys.

> ⚠️ **Locked-mode gate for action-authored tags.** Extend the creation gate to
> `tag.apply` / spawn templates, or keep the current "creation only" scope?
> Resolves the standing `docs/gotchas.md` "paths that bypass the gate" note.

> ⚠️ **Multi-roll seeding.** Confirm `(clock, task, operator, agent, rollIndex)`
> is unique for every roll a tick can emit, including operator-fired sub-rolls
> inside `effect` actions.

> ⚠️ **Quantifier × contribution.** When a gated `contribute` has `quantifier:
> count`, does it deposit the passer count, or `+1`? (Default `+1`; `count`
> opt-in.)

> ⚠️ **Success predicate scope.** Default "all success-vessels full" vs a
> task-level boolean over vessels (needed for optional / either-or vessels).

---

## 14. Rejected / deferred

- **Re-dispatching reducer actions for effects** — rejected (decision 1): the
  reducer can't re-enter mid-tick and rollback needs recorded deltas.
- **Overloading `progress`/`satisfied` to store designer flags** — rejected
  (decision 3): pollutes accrual semantics and the event log.
- **A single mega expression language covering tags too** — rejected (decision
  4): re-merges the structure/value separation `tag-values.md` deliberately made.
- **A staged task lifecycle with a timeout/failure branch** — rejected (decision
  9): time is a coarse refresh rate, not a state machine; consequences are opt-in
  operators.
- **Recording every roll as immutable history** — rejected (decision 8): couples
  fidelity to log retention and contradicts "fresh rows on replay."
- **Irreversible actions shortening the rollback horizon / forced deferral** —
  rejected (decision 10) in favor of best-effort skip.
- **Internal `phases[]` engine** — deferred: chained tasks + blackboard hand-off
  (§5.3) cover it.
- **Task-level `successExpr`** — deferred; default is all-vessels-full.
- **Reusable action/operator templates in the preset system** — deferred;
  inline authoring first.
