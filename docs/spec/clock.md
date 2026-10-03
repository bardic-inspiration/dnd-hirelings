# Clock

Ticks, pacing, the play loop, the event log, and rollback. Part of
[`SPEC.md`](../../SPEC.md); what a tick does to tasks is in
[`tasks.md`](tasks.md).

## Ticks

The simulation's unit of time is the **tick**; one tick is one day.
`session.clock` counts elapsed ticks as a non-negative integer, and every
advance moves it by whole ticks.

**Calendar.** Years and days are display only: `public/config/clock.yml`
`calendar.daysPerYear` (default 364) maps the tick count to a YEAR / DAY
label in the top bar. The simulation never reads the calendar. Editing the
YEAR / DAY spans sets `session.clock` directly, outside the tick loop: no
wages, no work, no log rows.

**`advanceTime(state, { count })` is the only way the clock moves forward.**
It runs `count` independent single-tick simulations, so the record is
tick-level however many ticks one call spans. Each tick:

1. **Find the working agents** — those with a current task
   ([`tasks.md`](tasks.md) "Assignment"). Agents on a blocked task are
   ineligible and flash.
2. **Pay wages.** The eligible agents' daily `rate`s sum to the tick's wage
   bill. If the bank can't cover it, no one works or is paid that tick, and
   every eligible agent flashes. Otherwise the bank is debited (rounded to
   cents).
3. **Apply work.** Each paid agent contributes to each condition of its
   current task ([`tasks.md`](tasks.md) "Conditions").
4. **Complete tasks** whose conditions are met, applying their results.
5. **Log** the tick ([Event log](#event-log)) and advance the clock by one.

## Pacing and controls

| Control | Click | Hold and drag vertically |
|---|---|---|
| Play / pause | Start or stop play | Adjust `session.rateMultiplier` within `clock.yml` `rateMultiplier.min/max` |
| Step forward | Advance `session.timeStep` ticks | Adjust `timeStep` within `clock.yml` `timeStep.min/max` |
| Step back | Rewind `session.stepBack` ticks | Adjust `stepBack` within the same `timeStep` bounds |

- **Play advances exactly one tick per interval**, where the interval is
  `max(realTime.minTickIntervalMs, realTime.msPerTick / rateMultiplier)`.
  Play speed is independent of the step size.
- `timeStep` and `stepBack` are independent per-session values that share
  bounds. The bounds are enforced where they are edited (the hold-drag), not
  on load: loading only guarantees positive numbers (falling back to 1). Why:
  config loads asynchronously and normalization is synchronous; a load-time
  clamp would also reset legitimate large steps. A hand-edited save may carry
  out-of-bounds values until the next adjustment clamps them.
- Editing the clock config restarts a running play interval immediately.
- Step back is shown only when `rollback.yml` `enabled` is true, and dims at
  the [rollback horizon](#rollback).

## Play loop

`usePlayClock` owns play. A `setInterval` commits one tick per interval
(`APPLY_TICK` with the precomputed new state). Between ticks, a
`requestAnimationFrame` loop interpolates task progress bars by writing the
DOM directly (`updateClockDisplayDOM`). Why: animating at display rate through
React state would re-render the board every frame.

- Interpolation advances each bar by `elapsed / interval` of the tick's
  contribution, capped per condition at its target.
- Condition rows are addressed by `[data-task-id][data-condition-id]` on
  `.condition-item-bar-fill` and `.condition-item-progress`.
- **A focused element is never written.** The condition progress number is a
  click-to-edit span; the loop skips it while it has focus.
- The YEAR / DAY display isn't interpolated; it updates on each committed
  tick.
- **Typing pauses the clock.** While any `[contenteditable]` or `.req-field`
  element has focus, the tick interval stops, so no wages are paid while the
  player types. It restarts 100 ms after blur. New editable fields that should
  pause the clock must match that selector.

`Planned (#116):` the loop reads its step functions and bounds from a clock
source — `live` (today's behavior) or `recorded` (replaying a committed turn)
([`multiplayer.md`](multiplayer.md) "Clock sources").

## Event log

`state.eventLog` is the authoritative record of what ticks did, kept in state
(and so in saves) and exported to CSV on demand
([`persistence.md`](persistence.md) "Files"). `advanceTime` is its only
writer.

- **One group per tick**, in the order `work* → task_complete* → tick`:
  - one `work_contribution` row per (agent, condition) that received
    progress, with that tick's `delta`;
  - one `task_complete` row per task completing that tick, recording its
    tags, results, and the exact `spawnedAgentIds` and `unassignedAgentIds`;
  - one `tick` boundary row, **always** — even on a tick where nothing
    happened — recording that tick's wage payments
    (`data: { wagesTotal, wages }`).
- So a 10-tick step logs 10 groups, and the log always ends on a `tick`
  boundary.
- **Only tick effects are logged.** Hand edits — progress, renames,
  assignments, bank changes — are not.
- **Capped FIFO** at `rollback.yml` `log.maxRows` (default 50,000). `seq` is a
  monotonic id that survives trimming; it is not an array index.
- `log.enabled: false` stops recording. `EVENTLOG_CLEAR` empties the log.

`Planned (#117):` the log gains `actionKind` and `reverseData` columns and an
`action` row family ([`task-engine.md`](task-engine.md) "Event log and
rollback").

## Rollback

Step back reverses ticks using the event log, not snapshots.
`rollbackTick(state, config)` reverses the most recent `tick` group: its rows
in strict reverse order (completions and work first), then the boundary's
wage refund and a one-tick clock decrement; then it truncates the group off
the log. `rollbackTime(state, { count })` loops it, stopping at the horizon.
Replaying forward afterwards regenerates fresh rows with continuing `seq`.

- **Only tick effects reverse.** Inverses subtract recorded deltas
  (`progress = max(0, progress − delta)`); they never restore snapshots, so
  edits made since the tick survive.
- **Best-effort, never blocking (`INV-7`).** Entities deleted since are
  skipped; the bank and item quantities clamp at 0. Spawned agents are deleted
  even if edited since; items they held are not returned.
- **The recorded wage total is authoritative**, so a step back refunds that
  tick's exact wages regardless of later rate, step, or calendar changes.
- **The horizon** is one tick before the oldest retained `tick` row
  (`getRollbackHorizon`). Step back dims there, and the clock panel shows the
  earliest reachable YEAR / DAY. With logging off the horizon freezes; after
  `EVENTLOG_CLEAR`, or with a log that has no `tick` rows (one recorded before
  boundaries existed), nothing is reachable.
- **An imported log is trusted as-is.** A log that doesn't match the live
  state degrades to clamped skips, never an error.

**Switchboard.** `public/config/rollback.yml`:

| Key | Effect |
|---|---|
| `enabled` | Shows or hides the step-back button. |
| `reverse.workProgress` | Subtract condition progress. |
| `reverse.wages` | Refund wages. |
| `reverse.taskCompletion` | Un-complete completed tasks. |
| `reverse.rewardGold` | Remove reward gold. |
| `reverse.rewardItems` | Remove reward items. |
| `reverse.spawnedAgents` | Delete agents spawned by results. |
| `reverse.agentReassignment` | Restore agents' task assignments. |
| `log.enabled`, `log.maxRows` | Event logging, above. |

A disabled switch leaves that effect in place when the clock winds back.

`Planned (#117):` rows carrying an `actionKind` reverse through that action's
own `reverse`, and the switchboard accepts per-action-kind flags
([`task-engine.md`](task-engine.md) "Event log and rollback").
