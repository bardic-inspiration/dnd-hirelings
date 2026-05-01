# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

D&D Hirelings is a single-page dashboard for managing NPC agents (hirelings) during D&D downtime. Players create agents, assign tasks, and advance a game clock that drives automated progress.

**Design principles:** Ultra-minimalist (black bg, 1px frames, configurable palettes). No page scroll. Single-line menu bar. No heavy frameworks.

**Engineering principles:** Vanilla JS, no build step, no bundler. Mutate `state`, call `save(); render();`. Don't introduce a diff layer.

## File Structure

```
index.html   - Menu bar + 3:1 dashboard (agents | tasks)
styles.css   - All styling via CSS custom properties on :root
app.js       - All logic: state, render, event wiring
config.json  - Optional theme overrides (HTTP only; file:// uses DEFAULT_CONFIG)
```

## Architecture

### State

Two objects:
- `state` — persisted to `localStorage` (`dnd-hirelings-state-v1`). Shape: `{ session, agents[], tasks[], inventory[] }`. Never persist `ui`.
- `ui` — transient: `{ selectedTaskId, expandedTasks, playing, playInterval }`.

Every mutation: `save(); render();` — `render()` does a full DOM rebuild from scratch.

`state.inventory` items: `{ id, name, qty }`. Items are auto-removed when `qty` reaches 0.

### Tags

Tags are strings: `#type:name[=value]` or `#req:type:name[=value]`. Parsed via `parseTag()` → `{ type, name, value, isReq }`. Built via `buildTag()`.

Agent attributes use tags. Task requirements use `isReq=true` tags.

**Tag types:**
- `skill`, `tool`, `trait`, `class`, `race`, `level` — agent attributes; drive assignment validation and active-highlight
- `effort:name=N` — task effort requirement (named skill); contributes to progress bar
- `effort=N` — nameless effort requirement; any agent contributes
- `task:id` — stored on agent `activities[]`; the canonical agent↔task link
- `req:item:name[=qty]` — task blocks if item missing/insufficient; non-depleting
- `req:consumable:name=qty` — same as item, but consumed on completion

### Effort Logic

`getEffortReqs(task)` always returns ≥1 element — if no effort tags exist, returns synthetic `{ name: null, value: 1 }`. This means all tasks auto-complete and render progress bars.

Effort progress stored in `task.effortProgress` keyed by skill name (or `''` for nameless/default).

**Contribution per agent per step:**
- Named effort (`#effort:arcane=100`): base = `stepDays`. If agent has matching skill with value > 0, rate = `skillVal × stepDays`. Otherwise rate = `stepDays` (base).
- Nameless/default effort: always `stepDays`.

### Item & Consumable Requirements

`getItemBlockedTasks(activeTasks)` — greedy algorithm: sorts tasks by `createdAt` (oldest first), checks each against a running pool. `item` reqs check actual inventory (non-depleting). `consumable` reqs deduct from pool. Blocked tasks → flash error, no progress.

`consumeTaskItems(task)` — called on completion (auto or manual); deducts consumable quantities from `state.inventory`.

### Active State

"Active" is computed each render via `isActivityActive()` / `isAttributeActive()`. Don't store an `active` flag.

Agents split into ACTIVE / IDLE columns by `activeTaskCount(agent) > 0`. Sorted by `lastAssigned || createdAt` desc.

### UI Patterns

- `editable(text, oncommit)` — `contenteditable` span; commits on blur/Enter, reverts on Escape. Click is `stopPropagation`'d.
- Click-to-assign: clicking a task sets `ui.selectedTaskId`, outlines agent cards (`.assignable`). Clicking an agent pushes `#task:<id>` to activities.
- Panels (inventory, config, tag builder) are overlays rendered into a dynamically created element; toggled off by clicking outside or pressing Escape.

### Palettes

Multiple built-in color themes in `PALETTES` object. Stored separately in `localStorage` (`dnd-hirelings-palette`). Applied via `applyPalette(name)` which sets all CSS custom properties on `:root`.

## Common Extension Patterns

**Add agent property:** `createAgent()` → `load()` backfill → `renderAgentCard()` → optionally `DEFAULT_CONFIG.defaults`.

**Add state field:** Initialize in state literal + backfill with `??=` in `load()`.

**Add tag type:** Free-form — no schema change. Update `isAttributeActive()` / `isActivityActive()` if it should affect highlighting. Update `TAG_SCHEMA` if it needs builder UI support.

**Add color:** `DEFAULT_CONFIG.colors` in app.js + `--name` in `:root` in styles.css + optional entry in config.json.

**Migrate state shape:** Bump `STORAGE_KEY` (e.g. `-v1` → `-v2`). Old data silently abandoned — preferable to silent corruption.

## Development

```bash
python -m http.server 8000   # config.json loads; file:// uses built-in defaults
```

State reset: `localStorage.removeItem('dnd-hirelings-state-v1')` in DevTools.

Manual testing checklist:
- Add/assign/complete agents and tasks
- Advance clock — verify effort accumulates, cost deducted, tasks auto-complete
- Item/consumable reqs — verify blocking and depletion
- Export → clear localStorage → import round-trip
- Page never scrolls (only inner grids/task list)

## Git

Commit messages: 50–100 characters, imperative.
