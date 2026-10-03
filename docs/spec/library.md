# Library

Presets for new agents, tasks, and items, and the library modal that orders
them onto the board. Part of [`SPEC.md`](../../SPEC.md).

## Opening it

The board's `+ AGENT`, `+ TASK`, and `+ ITEM` buttons open the library for
that type on **left-click**; **right-click** creates one blank object
directly.

## Presets

Two pools merge into one list:

- **Standard presets** — bundled in `public/presets/{agent,task,item}_presets.json`,
  fetched when the modal opens, cached in memory, read-only.
- **User presets** — kept in `localStorage`, editable.

Selecting a row opens it in an editable preview pane. **Editing a standard
preset forks it** into a user copy that saves automatically; only user
presets are ever written. SAVE / LOAD export or import a `.json` preset file;
loading is lenient.

Each preset carries a runtime-only `source` (`'standard'` or `'user'`). It is
stripped whenever presets are saved or exported, so data from outside the app
may lack it.

## Orders

The library is a cart. Every row carries an order count:

- **Left-click** a row adds one; **right-click** removes one (floored at 0).
  The count is also directly editable, displayed through `formatCount`.
- A row with a count renders selected; the row open in the preview is marked
  separately (`--focused`).
- Forking a standard preset carries its count onto the fork.

**ADD** submits the whole cart. `buildOrder` turns it into an **order**
document — `{ type, lines: { preset, quantity }[] }` — from every row with a
positive count across the full list (so an active search filter never drops a
queued row), flooring quantities and stripping runtime fields (`id`,
`source`) so each line resembles a preset file. `submitOrder` is the only
code that couples an order to the reducer: it dispatches one create action per
line, carrying the line's quantity as `count`. Why: the order is plain
serializable data, so a different backend would replace only `submitOrder`.

Before submitting, the library runs the locked-mode check on the whole order
([`tags.md`](tags.md) "The tag registry").

**Count semantics** (`AGENT_CREATE`, `TASK_CREATE`, `INVENTORY_ADD`; `count`
defaults to 1 and anything non-positive or non-finite becomes 1):

| Type | A count of N |
|---|---|
| Items | One row of N × the preset's own `quantity` (then stacks as usual). |
| Agents, tasks | N distinct entities. |

The UI doesn't cap counts: item quantities legitimately reach the large
numbers `formatCount` exists to display. An absurd agent or task count
allocates that many entities.
