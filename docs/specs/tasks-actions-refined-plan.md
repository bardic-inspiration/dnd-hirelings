# Tasks / Conditions / Actions / Results — Refined Plan (issue #TBD)

**Status: refinement layer.** This document sits between the design draft
(`tasks-actions_1.md`) and the spec. It does *not* re-derive the ten governing
decisions — those are settled and carried forward as the spine (§1). Its job is
the two things the draft has not yet done:

1. **Balance the draft against the actual codebase** (`docs/architecture.md`,
   `api.md`, `gotchas.md`, `environment.md`, `tag-values.md`) — marking each
   design claim as *aligns*, *adjust*, or *cost*, and naming the concrete seam
   or invariant it lands on (§2).
2. **Resolve the open questions** the draft and the design review left hanging,
   using repo facts rather than preference (§3), then order the work into a
   vertical-slice-first build plan (§4) with a risk register (§5).

Idiom follows `docs/tag-values.md` (Problem → Decision → Consequences → Open
questions) and reuses the plug-in registry pattern already load-bearing in the
code (`MATCH_MODE_REGISTRY`, `VALUE_RESOLVER_REGISTRY`, `TRACKER_REGISTRY`,
`MODIFIER_REGISTRY`, `VALUE_COMPARE_REGISTRY`, `CONFIG_FILES`).

---

## 1. What is settled (the spine)

The draft's ten decisions stand. Restated as one line each so the plan is
self-contained:

1. **Effects → serializable deltas in pure logic**, accumulated into one
   `newState` per `advanceTick`; never re-enter the reducer; each delta logged.
2. **Conditions fire actions**, and effects chain through a task-local store
   (deferral is a read/write graph, not a scheduler).
3. **A task-local blackboard** holds that written state — not overloaded onto
   `progress`/`satisfied`.
4. **Layered predicates**: an arithmetic/dice expression engine *under* the
   bespoke `{ref}`/`{dyn,}`/wildcard resolver; tag comparison stays in the
   bespoke matching engine; the blackboard is a resolver source.
5. **The per-(agent, task) tick is an event-distribution node**; contribution
   is just an action.
6. **Conditions and vessels are roles in one flow**, not rival objects; the
   simple case is authoring sugar.
7. **One ordered `OPERATOR_REGISTRY`** (`gate` / `scale` / `contribute` /
   `roll` / `write` / `effect`) subsumes `TRACKER_REGISTRY`.
8. **Seeded PRNG**; a roll is a pure function of `(clock, task, operator, agent,
   rollIndex)`; replay re-derives; the log records outcomes for audit only.
9. **Tick = coarse refresh rate**; `duration` is sugar compiling to a countdown
   operator; no failure branch.
10. **Per-kind `reverse`, `null` allowed**; rollback stays best-effort and never
    blocks; the `rollback.yml` switchboard generalizes to per-kind flags.

These are the invariants everything below must preserve. Where a decision meets
a codebase reality it did not fully account for, the reconciliation adjusts the
*implementation*, never the decision.

---

## 2. Reconciliation with the codebase

Legend: **✅ aligns** — the design maps onto an existing seam with no friction;
**🟡 adjust** — sound, but the draft's mechanism needs a specific change to fit;
**🔴 cost** — lands on a load-bearing invariant with real integration expense
that the draft under-weights.

### 2.1 The tick loop and delta model — ✅ aligns

The draft's engine matches the existing loop almost exactly. `advanceTime`
already loops a single-tick `advanceTick`, produces one `newState`, and commits
it via `APPLY_TICK { newState }`; `applyResults` / `applyTaskComplete` already
live in pure logic (`logic/tasks.js`) and already return delta-shaped results
(`{ newInventory, newAgents, bankDelta, spawnedAgentIds }`). "Fold an ordered
operator list per (agent, task), accumulate deltas, commit once" is a
generalization of what `computeConditionContribution` + `applyResults` do today,
not a new architecture. The two-phase (reads-then-writes) discipline is
compatible with the current "completion evaluated once per tick" cadence.

**Do:** build `advanceTick` around a fold that yields a delta list; keep the
one-`newState`-per-tick / one-`'tick'`-boundary contract untouched.

### 2.2 The event log is the crux — 🔴 cost (the single biggest item)

`EventLogEntry` is not just a rollback substrate. It is simultaneously:

- **The rollback substrate** — `rollbackTick` reverses a tick's group in a fixed
  LIFO order (work/completion rows → wage refund → clock decrement), reading
  *typed* fields (`conditionId`, `delta`, `progress`, `target`, `data`).
- **The CSV contract** — `EVENT_LOG_COLUMNS` is the single source of truth for
  export/import; a foreign CSV is trusted verbatim on import.
- **The DOM-interpolation key source** — the RAF loop addresses
  `.condition-item-bar-fill` / `.condition-item-progress` by
  `[data-task-id][data-condition-id]`.
- **FIFO-capped** at `MAX_LOG_ROWS` (50000), with `seq` stable across trim.

The draft's "each delta is logged for rollback" quietly assumes a *generic*
delta log. Generalizing `EventLogEntry` therefore touches rollback
interpretation, the CSV column set, and the progress-bar DOM contract at once —
this is where an "engine swap" turns into a schema migration.

**Do (transition, not big-bang):**
- Introduce a generic per-delta record — `{ kind, deltas, reverse-recipe }` —
  carried inside the tick group as the *new* rollback substrate for action
  kinds. `rollbackTick` learns to replay this list (per-kind `reverse`,
  best-effort, clamp ≥ 0) instead of switching on three hard-coded event types.
- **Keep the three typed rows (`work_contribution`, `task_complete`, `tick`) as
  a derived projection** over the deltas, so the CSV columns and the
  `[data-condition-id]` DOM selectors keep working during and after migration.
  Vessels that migrate 1:1 from conditions reuse the existing condition id as
  their DOM/log key, so interpolation needs no rewrite in Phase 1.
- Bump `EVENT_LOG_COLUMNS` additively (new columns tolerated by
  `normalizeEvent`); never reorder or drop existing ones.

### 2.3 Expression engine: **extend, do not import** — 🟡 adjust (correct the draft's lean)

The draft's decision 4 is right; its §6/§13 lean toward *adopting a sandboxed
math dependency* is the one place the plan should overrule it, because two repo
facts cut against it:

- **`expressions.js` already is that engine.** It ships `parseExpression`
  (never throws), `evaluateExpression`, `collectReferences`, and a pluggable
  `EXPRESSION_FUNCTIONS` table, with `+ - * / %`, parens, `floor ceil round sqrt
  min max`, brace refs and wildcards, and **caller-injected reference
  resolution**. The "resolve braces to numbers first, then evaluate" split the
  draft wants is the module's current contract.
- **The repo is deliberately zero-runtime-logic-dependency.** The README states
  "No external dependencies beyond React and Vite"; `CLAUDE.md` keeps even the
  asset converters (Pillow/fontTools/brotli) dev-only and out of
  `package.json`. Adding the *first* runtime logic dep is a values decision, not
  a size decision — and here it buys little, because the parser already exists.

The actual new surface is narrow: **dice** and **comparison/boolean operators**.
Both are incremental extensions of the existing AST + `EXPRESSION_FUNCTIONS`,
not a reason to import a parser.

**Do:** extend `expressions.js` in place. Add `d`/dice as an
`EXPRESSION_FUNCTIONS` entry (or a small grammar addition) and comparison/boolean
operators to the AST. Preserve "never throws / non-finite propagates to caller."

### 2.4 Determinism boundary — ✅ aligns (elevate to a hard invariant)

The draft's §6 note that `roll()` must be registered **only** into the
operator-evaluation context and **never** the dyn-tag evaluator is not a detail —
it is the load-bearing correctness constraint, and it is exactly right against
the repo. `reconcileDynamicTags` is contractually idempotent (`DYN_RECONCILE`
returns the same state reference when nothing changed; `hooks/useDynReconcile.js`
depends on this to avoid a render loop) and dyn payloads are **materialized into
state and saves**. A stochastic dyn tag would churn state every reconcile and
corrupt rollback.

**Do:** two entry points over one arithmetic core — `evaluateCheck` (dice
exposed, operator context only) and `evaluateDynamic` (dice absent, the existing
dyn path). Make "dice functions are absent from the dyn resolver" a tested
invariant, not a convention.

### 2.5 Conditions → operators: the logic is cheap, the *authoring surface* is not — 🔴 cost

Folding `TRACKER_REGISTRY` into `OPERATOR_REGISTRY` is a clean logic move. But a
`condition` is wired into far more than its contribution function:

- the event log / DOM contract (§2.2);
- the click-to-edit progress field (an `EditableSpan` the RAF loop must not
  clobber — `updateClockDisplayDOM`'s focus guard);
- the **condition draft grammar** `path[op value][=target]` (`splitConditionDraft`,
  `defaultConditionName`, `formatConditionLink`) and the **Tag Registry modal's
  condition mode**, which is the *only* authoring surface for conditions today;
- reducer verbs `TASK_CONDITION_ADD/UPDATE/REMOVE`.

The draft is an engine/logic design; it barely specifies how a user authors an
operator list, a vessel, an effect, or an action. The repo's ethos is
"build within the app" (Config Modal, Tag Registry modal), so a full operator
builder is a **large, separate workstream** — deferred behind the engine.

**Do:** in v1, author operators/actions as **data** — a `tasks` entry in
`CONFIG_FILES` (the draft's §9 already gestures at this) plus preset JSON —
reusing the config-editor's schema-guided tree rather than building a bespoke
UI. The condition draft grammar and registry condition-mode stay as sugar that
compiles a `gate + contribute` pair, so existing condition authoring keeps
working unchanged.

### 2.6 The `work` formula and session scalars — 🟡 adjust

The migrated `contribute` operator must reproduce today's per-tick accrual:
`workRate + value * skillBonus` for a value-bearing matched tag, `workRate`
alone otherwise (leaf strings never become rate bonuses — see
`gotchas.md → Conditions`). But `session.workRate` / `session.skillBonus` are
**session scalars, not tags**, and the expression engine resolves only
brace-refs through the injected resolver.

**Do:** expose session scalars (and the blackboard) as **resolver sources**
alongside tag paths, so a migrated `contribute` expr like
`{session:workRate} + {value} * {session:skillBonus}` resolves. This is the same
"blackboard is a resolver source" seam from decision 4, widened by one namespace.
Keep the legacy field names (`normalizeState` already documents they are kept
for save compatibility).

### 2.7 Seeded rolls and mid-tick spawns — 🟡 adjust (sharpen open q #5)

Seeding on `(session.clock, taskId, operatorId, agentId, rollIndex)` re-derives
correctly on replay-forward because rollback decrements the clock and
replay restores it. Two edges the draft's open question gestures at:

- **Spawned-agent ids are random** (`uid()`), so a roll keyed on an agent
  *created this tick* would not reproduce on replay. The **two-phase discipline
  neutralizes this**: operators run against the start-of-tick snapshot, so an
  agent spawned mid-tick isn't engaged (and can't be rolled for) until the next
  tick, whose clock value is stable. Make this explicit in the spec.
- **`effect`-fired sub-rolls** need `rollIndex` uniqueness *within* a tick. Keep
  a per-`(clock, task, operator, agent)` monotonic counter in the eval context
  so a hazard's follow-up `d20` and any action-fired roll get distinct indices.

### 2.8 Locked-mode gate for action-authored tags — ✅ aligns (resolves a standing gotcha)

The draft's open question here maps onto the exact "paths that bypass the gate"
warning in `gotchas.md → Locked Tags Gate Creation Only` (spawned-agent
templates, free-form edits, session import). Action-authored tags (`tag.apply`,
`agent.spawn` templates) are a *new* write path — the right time to close the
gap rather than widen it.

**Do:** route tag-writing actions through `unregisteredEntityTags` /
register-on-apply, so they obey rules 1–2 of registry-bounded values (register
paths, never register `=value`) and honor `tags.yml` `locked` consistently with
entity creation. One shared checker keeps pre-check and backstop from
disagreeing, as it already does for creation.

### 2.9 Blackboard persistence and rollback — 🟡 adjust

A `task.blackboard` field is new state: it is serialized to localStorage with
everything else, must round-trip through session JSON export/import, and its
writes must be rollback-invertible. `flag.set`/`flag.clear` invert by restoring
the prior value — which means **the prior value must be captured in the delta
record** (§2.2), not recomputed.

**Do:** add `blackboard` to the `Task` shape with a `normalizeState` default
(`{}`); make every blackboard delta carry its pre-image for the inverse. Keep it
plain-JSON-serializable (no functions, no class instances) — the same
constraint session export already enforces.

### 2.10 Switchboard generalization — 🟡 adjust (minor)

Generalizing `rollback.yml`'s fixed `reverse.*` categories to per-action-kind
flags is a schema change: `ROLLBACK_SCHEMA` moves from named keys to an
`anyKey` map (the config-editor grammar already supports this). Existing named
flags may already live in a user's localStorage overlay, so retain them as
recognized keys during transition.

**Do:** keep the seven current flags as defaults; add per-kind flags as
`anyKey` siblings; default unknown kinds to reversible-on.

---

## 3. Resolved open questions

The draft's §13 plus the three loose ends flagged at the end of the design
review, each resolved against a repo fact.

| Question | Resolution |
|---|---|
| **What is `flow` between operators?** (the review's #1 loose end) | A struct `{ admitted: boolean, value: number, rolls: RollRecord[] }`. `gate` sets `admitted`; `scale` transforms `value`; `roll` writes its result to `value` and appends to `rolls`; `contribute` deposits `value` into a vessel. `read: flow` resolves to `flow.value` (this is what example 3's `read: flow` reads after the hazard roll). Blackboard writes are separate from `flow` and survive across operators via the snapshot. |
| **Expression-library dependency** (loose end #2) | **No new dependency.** Extend `expressions.js` with dice + comparison/boolean operators (§2.3). Revisit a dependency only if a genuinely un-hand-rollable need appears; it has not. |
| **Vessel full-test grammar** (loose end #3) | Reuse the **condition draft grammar** `op value` for scalar full-tests via the existing `VALUE_COMPARE_REGISTRY` / `matchTagValue` — zero new grammar for the common case (`fullWhen: ">= 4"`). Escalate to the expression engine only when a full-test references *other* keys. |
| **Fold order vs `flow` semantics** | Author order is significant only for operators that consume the running `flow`; the two-phase snapshot makes blackboard reads order-independent within a tick. Formalized by the `flow` struct above. |
| **Multi-roll seeding uniqueness** | Per-`(clock, task, operator, agent)` monotonic `rollIndex` counter in the eval context; mid-tick spawns can't roll until next tick (§2.7). |
| **Quantifier × contribution** | Default deposit is `+1` (or the operator's `expr`); `quantifier: count` opts into depositing the passer count. Matches the draft's lean. |
| **Success-predicate scope** | Default: all success-vessels full. Task-level `successExpr` over vessels stays **deferred** (needed only for optional / either-or vessels; add when a feature needs it, mirroring the "typed schema deferred until needed" stance in `tag-values.md`). |
| **Locked-mode gate for action-authored tags** | Extend the gate (§2.8) — closes the standing gotcha. |

---

## 4. Refined build plan (vertical-slice first)

Ordered to validate the model against the real codebase early — the exact "take
one operator kind all the way down" pass the design review recommended — and to
keep every phase shippable behind the existing config surfaces.

### Phase 0 — Foundations (no behavior change)
- `src/logic/rng.js`: seeded PRNG from `session.clock` + key tuple.
- Extend `src/logic/expressions.js`: dice + comparison/boolean operators; two
  entry points (`evaluateCheck` dice-on / `evaluateDynamic` dice-off). Invariant
  test: dice functions absent from the dyn resolver.
- Pin the `flow` struct and the generic delta-record shape (§2.2, §3).
- **Exit:** new engine pieces unit-tested in isolation; dyn path byte-identical.

### Phase 1 — Vertical slice: `gate` + `contribute` (prove the model)
- `src/logic/operators.js`: `OPERATOR_REGISTRY` + `QUANTIFIER_REGISTRY`; fold in
  `advanceTick`.
- Implement exactly two kinds (`gate`, `contribute`) and one action
  (`bank.adjust` **or** `inventory.add`) with a working `reverse`.
- Migrate **one** legacy condition to a `gate + contribute` pair via in-place
  `normalizeState` lowering; reuse its condition id as the vessel/DOM/log key so
  the progress-bar RAF path and CSV are untouched.
- Generic delta record feeds `rollbackTick`; typed rows derived over it (§2.2).
- **Exit:** the "Find Victor and Zellen" example runs, completes, logs, and
  rolls back tick-for-tick identically to the current conditions path. This is
  the go/no-go for the whole model against the actual event-log + rollback +
  DOM contracts.

### Phase 2 — Actions breadth + effects + blackboard
- `src/logic/actions.js`: `ACTION_REGISTRY` (`bank.adjust`, `inventory.add/remove`,
  `agent.spawn/remove`, `agent.assign/unassign`, `tag.apply/remove/adjust`,
  `flag.set/clear`, `object.create`) generalizing `applyResults`.
- `results` retained as a **derived read-only view** (`actions.filter(on ==
  'completion')`) so existing UI survives.
- `src/logic/blackboard.js` + blackboard as resolver source; `effect` operator;
  effects chain via read/write graph.
- Extend the locked-mode gate to tag-writing actions (§2.8).
- **Exit:** the lethal-hazard chain (example 3) works via `effect` → `agent.remove`;
  `results` migration is lossless.

### Phase 3 — Time, vessels, dice sugar
- `scale`, `roll`, `write` kinds; `duration` sugar → countdown operator; vessel
  full-test grammar (§3); switchboard generalization (§2.10).
- Storage key bump `-v6 → -v7` (in-place normalize, **not** abandonment — there
  is a clean lowering; contrast the v6 bump, which abandoned).
- **Exit:** all three worked examples run from authored data; open/fixed
  durations behave with no failure branch.

### Phase 4 — Authoring surface (separate workstream)
- Operator/action/vessel authoring via the `tasks` `CONFIG_FILES` entry + preset
  JSON first (schema-guided config tree). A bespoke in-card builder is a later,
  independent effort — do not block the engine on it.

---

## 5. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Event-log generalization breaks CSV round-trip, rollback LIFO, or progress-bar DOM keys | **High** | Dual-track: generic delta substrate + typed rows as a derived projection; additive columns only; reuse condition ids as vessel keys in Phase 1 (§2.2). |
| Runtime dependency creep against a zero-dep repo | **Med** | Extend `expressions.js`; no import (§2.3). |
| Stochastic value leaks into the dyn reconciler → render loop / save churn / rollback corruption | **High** | Two entry points; dice absent from `evaluateDynamic` as a tested invariant (§2.4). |
| Scope blowout via an operator-builder UI | **Med** | Author as config/preset data first; defer the builder to Phase 4 (§2.5). |
| Migration silently changes accrual (workRate/skillBonus) | **Med** | Session scalars as resolver sources; migrated `contribute` expr reproduces the exact per-tick formula (§2.6). |
| Blackboard writes not invertible | **Med** | Deltas carry pre-images; blackboard stays plain-JSON (§2.9). |
| Seeded rolls non-reproducible for mid-tick spawns / sub-rolls | **Low** | Two-phase snapshot + per-context `rollIndex` counter (§2.7). |

---

## 6. Into the spec / grill-me pass

Blocking items are resolved (§3); what remains for the spec are **shapes to pin,
not decisions to make**: the exact generic delta-record fields and their inverse
recipes, the additive `EVENT_LOG_COLUMNS`, the `OPERATOR_REGISTRY` /
`ACTION_REGISTRY` schemas, and the `tasks` `CONFIG_FILES` schema. The sharpest
thing to stress-test in a grill pass is **§2.2** — walk one action kind through
authoring → delta → log row → CSV export → import → rollback and confirm every
existing contract survives. If that vertical holds, the model holds.

The one decision this plan *changes* from the draft is the expression-library
dependency (§2.3): the draft leans toward importing one; the codebase's existing
engine and zero-dependency stance say extend in place. Flag it explicitly so the
reversal is a conscious call, not an oversight.
