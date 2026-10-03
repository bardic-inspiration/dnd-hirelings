# Tasks

How tasks gate agents, accrue progress through conditions, and complete into
results. Part of [`SPEC.md`](../../SPEC.md); the tick that drives them is in
[`clock.md`](clock.md).

`Planned (#117):` conditions and results are replaced by the operator /
vessel / action engine in [`task-engine.md`](task-engine.md); this file
describes the system until that plan lands.

## Requirements

A task's `requirements` hold `req,` and `block,` tags.

- **`req,<path>[=n]`** — an agent qualifies only if a tag in its attributes or
  activities matches the path literally; with a value, the agent's value must
  be numeric and ≥ `n`.
- **`block,<path>`** — an agent carrying the path does not qualify.
- **Reverse requirements.** A `req,` tag on an *agent* must be matched by a
  `req,` on the task with a value ≥ the agent's. An agent can demand context
  from the tasks it takes.
- **`req,item:<name>[=n]`** is an inventory requirement, not an agent one.
  While inventory holds fewer than `n` (default 1) of that item by
  case-insensitive name, the task is **blocked**: its agents do no work and
  are paid nothing. Each task checks the full inventory independently — no
  stock is reserved across tasks, and nothing is consumed.

## Assignment

Selecting a task highlights each agent card as assignable or not. Clicking an
agent then:

- **assigns** it (adds `task:<id>` to its activities and stamps
  `lastAssigned`) when it qualifies and isn't already assigned;
- **flashes** the card when it doesn't qualify;
- does nothing when it is already assigned or no task is selected.

An agent may hold several assignments. It works only its **current task**:
the first incomplete task among its `task:` activities, in order. Deleting a
task removes its assignments from every agent. Completing a task unassigns
its agents.

## Conditions

A task's progress lives in `task.conditions` — structured objects, not tags.
Each condition has a `target`, a `progress`, and a `tracker`; the task
completes only when **every** condition's `progress ≥ target`. Conditions
track independently: overshooting one never covers a deficit in another.

Per-tick accrual dispatches through `TRACKER_REGISTRY` by `tracker.kind`; the
clock loop never special-cases a kind. The one kind, **`work`**, links to
agents through `tracker.tagPath` (an `open`-mode pattern) and an optional
`tracker.compare` term ([`tags.md`](tags.md) "Pattern matching"). For each
eligible agent, each tick:

| Link | Contribution |
|---|---|
| `tagPath: null` | `workRate` |
| matches a tag with a numeric value `v` | `workRate + v × skillBonus` |
| matches a tag with no numeric value | `workRate` |
| no match (or the compare fails) | `0` |

`workRate` and `skillBonus` are session fields. `skillBonus` multiplies the
value of any matched tag, not only skills; the names are kept for save
compatibility. A leaf string never becomes a rate bonus.

**Condition drafts.** The registry modal's condition mode and the card's
`+ CONDITION` accept `path[op value][=target]`. The **last** `=` is always
the target, so bare equality is spelled `==`: `skill:arcana>=3=30` is
"Arcana ≥ 3, target 30"; `class==druid=30` is "class equals druid, target
30". The target defaults to 1. A bare `=20` makes an "any agent" condition
and registers nothing.

**Editing.** A condition's progress and target are click-to-edit on the
card. Hand-edited progress is not logged and is not reversed by rollback.

## Completion

Completion is checked for every task once per tick, after work is applied,
and by the card's ✓ button (`TASK_SET_COMPLETE`):

- A task reaching its targets mid-step completes on that tick and stops
  accruing work and wages for the rest of the step.
- Progress edited to ≥ target completes the task on the **next** tick, not
  instantly.
- A task with **zero conditions** completes at the end of any tick in which at
  least one eligible agent worked it; it never completes on its own.
- An agent that contributed to nothing on its task flashes.

On completion the task is marked complete, its agents are unassigned, and
its results apply.

## Results

`task.results` holds the rewards a completion pays out:

- **`gold`** — added to the bank.
- **`items`** — `{ name, quantity }[]`, added to inventory by case-insensitive
  name (a missing item is created blank).
- **`agents`** — `{ template, quantity }[]`, spawning `quantity` new agents
  from each template. Spawned agents are not checked against locked mode
  ([`SPEC.md`](../../SPEC.md) "Open questions").

Unchecking ✓ marks the task incomplete; it does not reverse its results.
Rollback reverses a completion that happened during a tick
([`clock.md`](clock.md) "Rollback").

## Duplicating

`TASK_DUPLICATE` deep-copies a task with fresh condition ids, zero progress,
and `isComplete: false`.
