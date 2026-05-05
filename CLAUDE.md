# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

D&D Hirelings is a single-page dashboard for managing NPC agents (hirelings) during D&D downtime. Players create agents, assign tasks, and advance a game clock that drives automated progress.

**Design principles:** Lightweight. Configurable. Versatile. Intuitive. No page scroll. Less is more.

**Engineering principles:** Vanilla JS, no build step, no bundler. Mutate `state`, call `save(); render();`.

## File Structure

```
index.html   - Menu bar + 3:1 dashboard (agents | tasks)
styles.css   - All styling via CSS custom properties on :root
app.js       - All logic: state, render, event wiring
```

## Architecture

### State

Two objects:
- `state` — persisted to `localStorage` (`dnd-hirelings-state-v1`). Shape: `{ session, agents[], tasks[], inventory[] }`. Never persist `ui`.
- `ui` — transient: `{ selectedTaskId, expandedTasks, playing, playInterval }`.

Every mutation: `save(); render();` — `render()` does a full DOM rebuild from scratch.

`state.inventory` items: `{ id, name, qty }`. Items are auto-removed when `qty` reaches 0.

### Agents

```js
{ id, name, icon, rate, rateUnit, description, attributes[], activities[], createdAt, lastAssigned }
```

- `attributes[]` — tag strings describing what an agent IS/HAS (`#skill:archery=3`)
- `activities[]` — tag strings linking to tasks (`#task:id`); first incomplete task is current work
- `lastAssigned` — `null` if never assigned; used for sort order alongside `createdAt`
- `agentDefaults(DEFAULT_CONFIG)` — single source of default field values; used by `createAgent()` and `duplicateAgent()`

### Tasks

```js
{ id, name, description, requirements[], workProgress{}, isComplete, createdAt }
```

- `requirements[]` — tag strings encoding work targets, agent requirements, inventory checks, rewards
- `workProgress` — object keyed by skill name (or `''` for nameless work); accumulates per clock step
- `completeTask(task)` — canonical completion path: sets `isComplete`, prunes agents, consumes items, executes rewards
- All tasks auto-complete: `getWorkReqs()` returns a synthetic `{ value: 1 }` default when no work tags exist

**Task card sections (expanded view):**
- **PROGRESS** — one row per `#work` tag (or a default General row); shows label, progress bar, value, × remove. No add button.
- **REQUIREMENTS** — rows for `isReq` tags (skill/tool/trait/class/race/item/consumable). No add button.
- **RESULTS** — rows for reward tags. No add button.
- **ATTRIBUTES** — catch-all for remaining tags (not work, not req, not reward). Has `+ TAG` button.

### Tags

Format: `#[req:]type[:name][=value]` — parsed by `parseTag()`, built by `buildTag()`.

**`TAG_SCHEMA`** is the single source of truth for all recognized tag patterns. Flat map keyed by pattern ID:

| Key | Format | Context | fn |
|---|---|---|---|
| `skill`, `tool`, `trait`, `class`, `race`, `level` | `#type:name[=value]` | `attribute` | — |
| `req:skill`, `req:tool`, `req:trait`, `req:class`, `req:race` | `#req:type:name[=value]` | `requirement` | `require` |
| `req:item`, `req:consumable` | `#req:type:name=qty` | `requirement` | `block` / `consume` |
| `work` | `#work=N` | `work` | `work` |
| `work:skill` | `#work:skillname=N` | `work` | `work-skill` |
| `reward:gold` | `#reward:gold=N` | `reward` | `reward-gold` |

Each entry carries `{ label, context, type, isReq, hasName, hasValue, nameLabel?, valueLabel?, nameFixed?, fn? }`.

**Schema helpers:**
- `getSchemaEntry(parsed)` — resolve a parsed tag to its schema entry (null for custom/unknown)
- `tagFn(parsed)` — return the `fn` key; used by all logic functions instead of hardcoded type strings
- `getSchemaByContext(...contexts)` — filter entries by context for UI generation

**Work logic:**
- Named work (`#work:skill=N`): agents with a matching `#skill` attribute contribute at `(workRate + skillVal × skillBonus) × stepDays`; others contribute at base rate
- Nameless/default work: all agents contribute at `workRate × stepDays`

**Item/consumable logic:**
- `block` (item): task blocked if inventory qty is insufficient; non-depleting
- `consume` (consumable): greedy reservation per tick (oldest tasks first); quantity deducted on completion

### Active State

"Active" is computed each render — never stored. `isAttributeActive()` and `isActivityActive()` use `tagFn()` to match agent attributes against task requirements.

Agents split into ACTIVE / IDLE columns by `activeTaskCount(agent) > 0`. Sorted by `lastAssigned ?? createdAt` desc.

### UI Patterns

- `editable(text, oncommit)` — `contenteditable` span; commits on blur/Enter, reverts on Escape. Click is `stopPropagation`'d.
- Click-to-assign: clicking a task sets `ui.selectedTaskId`, outlines agent cards (`.assignable`). Clicking an agent pushes `#task:<id>` to activities.
- Panels (inventory, settings, tag builder) are overlays rendered into a dynamically created element; dismissed by clicking outside or pressing Escape.
- `showTagBuilder({ context, onSave, onCancel })` — unified builder for both agent attributes (`context: 'attribute'`) and task tags (`context: 'task'`). Task context groups patterns by `context` field derived dynamically from schema; includes a Custom option for free-form types.

### Palettes

Multiple built-in color themes in `PALETTES` object. Stored separately in `localStorage` (`dnd-hirelings-palette`). Applied via `applyPalette(name)` which sets all CSS custom properties on `:root`.

## Common Extension Patterns

**Add agent property:** `agentDefaults()` → `load()` backfill with `??=` → `renderAgentCard()`.

**Add state field:** Initialize in state literal + backfill with `??=` in `load()`.

**Add attribute type** (agent): add entry to `TAG_SCHEMA` with `context: 'attribute'`. Appears in builder automatically.

**Add requirement type** (agent-matching): add entry with `context: 'requirement'`, `isReq: true`, `fn: 'require'`. Logic functions pick it up via `tagFn()` automatically.

**Add inventory-blocking type**: add entry with `fn: 'block'` (non-depleting) or `fn: 'consume'` (depleted on completion). Logic picks it up automatically.

**Add reward type**: add entry with a new `fn` key (e.g. `'reward-xp'`) + one case in `executeTaskRewards()`.

**Add work subtype**: add entry with `context: 'work'`, `type: 'work'`. Work logic handles all `type === 'work'` tags automatically.

**Add color:** add to `PALETTES` in app.js + `--name` in `:root` in styles.css.

**Migrate state shape:** Bump `STORAGE_KEY` (e.g. `-v1` → `-v2`). Old data silently abandoned — preferable to silent corruption.

## Development

```bash
python -m http.server 8000
```

State reset: `localStorage.removeItem('dnd-hirelings-state-v1')` in DevTools.

## Git

Commit messages: 50–100 characters, imperative.
