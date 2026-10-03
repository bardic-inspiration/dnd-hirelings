# Guild Manager — Specification

`status: current`

The source of truth for **what to build**. Written in the present tense: it
describes the system as it is on `main`, except text marked
`Planned (#N):`, where `#N` is the plan issue building it. Its history is in
git (`git log -- SPEC.md docs/spec`), not in these files.

This file holds the project-wide parts; each area of behavior has its own
file under [`docs/spec/`](docs/spec/) (routing table below).

## Purpose & non-goals

Guild Manager is a single-page dashboard for running a guild of NPC
hirelings in a tabletop RPG campaign. The player creates **agents**
(hirelings), defines **tasks**, keeps an **inventory** and a **bank**, and runs
a **game clock** that pays wages, applies work to tasks, and resolves completed
tasks into rewards. Everything an object is or needs is a **tag**; rules, UI
layout, and pacing are **config files**; new objects come from a **preset
library**. It runs entirely in the browser.

It is built for the maintainer's own table, and as a learning project in web
development and agent-assisted engineering.

**Non-goals:**

- **AI agents.** "Agents" are NPC characters, never LLM agents.
- **A backend, accounts, or cloud saves.** State lives in the browser and moves
  between browsers as files. `Planned (#116):` an optional localhost session
  server for turn-based GM/party play ([`multiplayer.md`](docs/spec/multiplayer.md)).
- **Live multi-user co-editing**, at any stage.
- **A game system hard-coded in source.** Rules are data: the D&D-style
  reference ruleset ships as config, not code.
- **Routing or multiple pages.** One dashboard, with modals.

## Invariants

These hold for every change. A change that breaks one is wrong even if CI is
green.

- **`INV-1` — Game-state transitions are pure.** The reducer and the
  simulation (`advanceTime`, `rollbackTime`, dynamic-tag reconciliation,
  `normalizeState`) take state and config as arguments and return new state;
  they never touch React, the DOM, storage, or the network. Fresh ids
  (`uid()`) and timestamps (`now()`) are their only nondeterminism.
- **`INV-2` — One tag codec.** Code that reads or writes a tag string goes
  through `parseTag` / `buildTag` ([`tags.md`](docs/spec/tags.md)), never raw
  string operations.
- **`INV-3` — One write path for game state.** Every change to the game world
  is a reducer action dispatched through `useGame().dispatch`; the reducer is
  the only code that produces new `GameState`.
- **`INV-4` — No page scroll.** The dashboard fills the viewport and never
  scrolls as a page; panels scroll inside themselves.
- **`INV-5` — Text never spills.** Every displayed tag, name, and number fits
  its container — truncated structurally, shortened numerically, or
  ellipsized — with the full value one hover away
  ([`ui.md`](docs/spec/ui.md) "Text display").
- **`INV-6` — Configuration warns, never blocks.** A config document or tag
  that fails its schema is kept, saved, and exported with a warning; nothing
  the user authors is silently discarded or refused for being off-schema.
  (State-bound values that would break clock math are the one exception —
  [`config.md`](docs/spec/config.md).)
- **`INV-7` — Rollback never blocks.** Reversing a tick is best-effort: a
  missing entity is skipped, quantities clamp at 0, and rollback never throws
  ([`clock.md`](docs/spec/clock.md)).

## Concepts

| Term | Meaning |
|---|---|
| **Agent** | An NPC hireling: name, portrait, daily `rate`, description, `attributes` and `activities` tag lists. |
| **Task** | A job: requirements, attributes, conditions (progress targets), and results (rewards). |
| **Item** | An inventory row: name, quantity, icon, unit value, attribute tags. Held items move into agents' bags. |
| **Bank** | The guild's gold (`session.bank`). Wages draw from it; sales and rewards add to it. |
| **Tag** | A string `[modifier,]segment[:segment…][=value]` describing a property, requirement, bonus, or activity. |
| **Modifier** | The token before the comma in a tag (`req`, `block`, `bonus`, `dyn`) that changes how the tag is read. |
| **Attribute / activity** | An object's authored tags vs. an agent's runtime tags (assignments, bag, bound items). |
| **Tag registry** | The keys-only tree of every tag path in play or allowed (`state.tagRegistry`). |
| **Dynamic tag** | A `dyn,<address>` tag whose value is computed from a rule and written into the tag. |
| **Rules registry** | `public/config/rules.yml`: the expressions that govern dynamic tags. |
| **Condition** | A task's progress subcategory: a `target`, a `progress`, and a tracker linking it to agent tags. |
| **Assign / bind** | Assign: an agent takes a task, or an item moves to an agent. Bind: an agent equips a bag item, optionally into a slot. |
| **Tick** | The simulation's unit of time; one tick is one day. |
| **Event log** | The per-tick record of work, completions, and wages that drives rollback. |
| **Preset** | A template for a new agent, task, or item — bundled (standard) or user-authored. |
| **Order** | The library's cart: preset lines with quantities, submitted at once. |
| **Config file** | A YAML document the app reads at runtime (`public/config/`) or build time (`config/`). |
| **Overlay** | The user's in-app edit of a config file, stored in the browser and shadowing the deployed file. |
| **Card element** | A configurable slot on the agent card (medallion, box, bar, field, value, slot) fed by a tag source. |

## Architecture

A client-side single-page app (React, Vite) with no backend. Four tiers
depend in one direction — components → hooks → state → logic:

| Tier | Path | Owns |
|---|---|---|
| Logic | `src/logic/` | Game mechanics as plain functions over plain objects: tags, matching, conditions, clock, rollback, expressions, config normalizers. |
| State | `src/state/` | `GameContext` (the game world, `useReducer`), `UIContext` (selection, modals, card expansion), `ConfigContext` (runtime config documents), and `storage.js` (persistence). |
| Hooks | `src/hooks/` | Bridges between state and React lifecycle: the play loop, config readers, presets, gestures, measurement. |
| Components | `src/components/` | Layout, event wiring, and display formatting only — no game rules. |

Supporting directories: `src/constants/` (static data and build-time config
loaders), `src/styles/index.css` (the single stylesheet), `public/config/`
(runtime config), `public/presets/` (bundled presets), `config/` (build-time
config), `public/assets/` ([`assets.md`](docs/spec/assets.md)).

**Data flow.** A component dispatches an action; the reducer computes new
state with logic-tier functions; `GameProvider` persists every new state to
`localStorage`. The play loop is the one deliberate bypass for display: it
interpolates progress bars between ticks by writing the DOM directly
([`clock.md`](docs/spec/clock.md) "Play loop").

**Extension points are registries.** Where behavior varies by kind, a plain
object maps the kind to its implementation, and adding a kind means adding an
entry — never a branch in the caller. Unknown keys fall back gracefully.

| Registry | Module | Maps |
|---|---|---|
| `MODIFIER_REGISTRY` | `logic/tags.js` | Tag modifier → label, meaning, task routing. |
| `MATCH_MODE_REGISTRY` | `logic/tagMatching.js` | Pattern match mode → matcher. |
| `VALUE_COMPARE_REGISTRY` | `logic/tagMatching.js` | Comparison operator → test. |
| `VALUE_RESOLVER_REGISTRY` | `logic/tagValues.js` | Use case → implied-value resolver. |
| `TRACKER_REGISTRY` | `logic/conditions.js` | Condition tracker kind → contribution function. |
| `EXPRESSION_FUNCTIONS` | `logic/expressions.js` | Expression function name → implementation. |
| `TAG_LABEL_VARIANTS` | `logic/truncation.js` | Tag display style → rendering parts. |
| `VALUE_KINDS` | `logic/configEditor.js` | Config scalar kind → suggest/check. |
| `CONFIG_FILES` | `logic/configRegistry.js` | Config section → source, schema, binding. |

**Dependencies are few by design.** Runtime: React, React DOM, js-yaml. Dev:
Vite, Vitest, ESLint. No router, CSS framework, state library, or formatter.
Why: `useReducer` is enough at this scale, the stylesheet is bespoke, and
ESLint is lint-only so it never fights the code's deliberate column alignment.
A new dependency needs the maintainer's approval.

## Quality bars

- **Toolchain:** Node.js ≥ 20.19 (Vite 8's floor), declared in `package.json`
  `engines`.
- **Browsers:** current evergreen browsers. Served images are WebP; file
  saves use the File System Access API where present and fall back to a
  download link.
- **Frame rate:** progress bars animate at display rate during play without
  re-rendering React per frame; the play interval floors at 16 ms.
- **Log size:** the event log keeps at most `log.maxRows` rows (default
  50,000), trimming oldest first.

## Areas

| Read | For |
|---|---|
| [`docs/spec/tags.md`](docs/spec/tags.md) | Tag grammar, the registry, implied values, pattern matching, dynamic tags and the rules registry. |
| [`docs/spec/tasks.md`](docs/spec/tasks.md) | Requirements, assignment, conditions, completion, results. |
| [`docs/spec/clock.md`](docs/spec/clock.md) | Ticks, pacing, the play loop, the event log, rollback. |
| [`docs/spec/inventory.md`](docs/spec/inventory.md) | Items, stacking, giving and selling, bags, binding and slots. |
| [`docs/spec/library.md`](docs/spec/library.md) | Presets, forking, orders. |
| [`docs/spec/config.md`](docs/spec/config.md) | The config files, the manifest, overlays, the Configuration Modal. |
| [`docs/spec/ui.md`](docs/spec/ui.md) | Layout, the agent card, selection, the Tag Registry modal, text display, modals, styling. |
| [`docs/spec/persistence.md`](docs/spec/persistence.md) | State shape, storage keys, save and file formats, the action vocabulary. |
| [`docs/spec/assets.md`](docs/spec/assets.md) | Images and fonts: layout, formats, manifests, loading. |
| [`docs/spec/task-engine.md`](docs/spec/task-engine.md) | `Planned (#117):` operators, vessels, and actions. |
| [`docs/spec/multiplayer.md`](docs/spec/multiplayer.md) | `Planned (#116):` GM/player mode and async turn review. |

## Open questions

Undecided, and **not contract** — don't build against these; resolve one by
editing the spec, then delete it here.

- **Leaf values flip when a leaf gains children.** An implied value requires
  a registered *leaf*, so registering `class:druid:circle` silently turns
  existing `class:druid` tags from value to structure (display resolves
  `null`). Warn in the registry editor, or read a tag's terminal segment as
  its value regardless of children?
- **Slots accept any item.** Binding fills the first free slot in config
  order, with no notion of which items a slot accepts (a shield can land in
  `weapon`). Should slots gain an acceptance schema?
- **Duplicate effective attributes.** An agent carries at most one attribute
  per path, so a condition's tag link never sees two matches today. If
  effective attributes ever stack duplicates, which one contributes?
- **Locked mode gates creation only.** Task-result spawns, free-form entity
  edits (`AGENT_UPDATE`, `TASK_UPDATE`, `INVENTORY_UPDATE_ITEM`), and session
  import (`REPLACE_STATE`) can introduce unregistered tags. Should the gate
  cover them? (`Planned (#117)` covers tag-writing actions only.)
- **Task orders.** A library order of N tasks creates N task instances, like
  agents. Is that the intended task behavior?
- **Stat-square sizing.** The medallion and boxes are a fixed 34 px square
  while card width is fluid. Should they scale with the card?
- **Invalid-element flash.** An invalid card element flashes once on render
  and keeps warn-colored chrome. Is a one-shot flash the intent, or a
  continuous pulse?
- **Card elements accept any finite number**, not just integers, because
  `rate` is fractional. Confirm.
- **State-bound config sections have no SAVE/LOAD**; their values travel in
  the session export. Should they export as YAML too, for symmetry?
- **Card-expansion ids outlive their entities.** The persisted expansion store
  keeps ids of deleted cards and grows without bound. Prune at startup or in
  the reducer?
- **Impure helpers live in `src/logic/`.** DOM writes (`dom.js`,
  `updateClockDisplayDOM`), file I/O (`download.js`, preset and session
  save/load), and JSX (`text.jsx`) sit beside the pure mechanics. Split them
  into their own tier, or narrow the tier's definition?
