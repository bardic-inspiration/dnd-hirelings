# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

D&D Hirelings is a lightweight, single-page dashboard for managing NPC agents (hirelings) in Dungeons and Dragons campaigns during downtime activities. It enables players to:
- Create, edit, and manage NPC agents
- Assign and track tasks for one or more agents
- Monitor game time and global environmental conditions
- Interact with agents in a minimal, distraction-free interface

**Design Principles:**
- Ultra-minimalistic: black background, 1px line frames, configurable colors
- No scrolling required on a standard display
- Clean, legible typography with no visual frills
- Self-contained single HTML file or minimal file structure

**Engineering Principles:**
- Minimal dependencies (vanilla JS preferred, avoid heavy frameworks)
- Highly configurable and modular
- Standard file formats (JSON for config/data)
- Well-annotated code for maintainability
- Simple, flat file structure

## Architecture & File Structure

```
index.html      - Markup shell: menu bar + 3:1 dashboard (agents pane | tasks pane)
styles.css      - All styling. Colors driven by CSS custom properties on :root
app.js          - All logic: state, persistence, rendering, event wiring
config.json     - Optional theme + default values (see "Configuration" below)
```

### Key Architectural Decisions

1. **Single render function.** `render()` in `app.js` clears the agent grids and task list and rebuilds them from `state` + `ui`. Mutations call `save(); render();` — there is no diff/patch layer. With expected counts (< 100 hirelings) this is fine; do not introduce a virtual DOM.
2. **Two state objects.** `state` (persisted to localStorage as `dnd-hirelings-state-v1`) holds the domain: `session`, `agents[]`, `tasks[]`. `ui` (transient) holds `selectedTaskId` and `expandedTasks`. Never persist `ui`.
3. **Tags are strings of the form `#type:content`.** Parsed via `parseTag()` into `{ type, content }`. Task assignments are stored on the agent as `#task:<taskId>` activity tags — this is the canonical link between agents and tasks. To find who's doing a task, scan `agent.activities`.
4. **"Active" is computed, not stored.** `isActivityActive()` and `isAttributeActive()` derive highlight state from the current task graph each render. Don't add an `active` flag to tags.
5. **Sorting is computed each render.** Agents split into ACTIVE / IDLE columns by `activeTaskCount(agent) > 0`, then ordered by `lastAssigned || createdAt` desc. `lastAssigned` is bumped only on assignment, not on edits.
6. **Editable fields are `contenteditable` spans built by `editable(text, oncommit)`.** Commits on blur or Enter; reverts on Escape. Click is `stopPropagation`'d so editing a field doesn't trigger the card's click-to-assign / click-to-select handler.
7. **Click-to-assign workflow.** Clicking a task card sets `ui.selectedTaskId` (and outlines all agent cards via `.assignable`). Clicking an agent card while a task is selected pushes `#task:<id>` onto that agent's activities. Clicking outside any card clears the selection.
8. **No build step.** Vanilla JS, no bundler, no transpiler. Keep it that way unless scope forces otherwise.

## Development Workflow

### Getting Started

1. Clone the repository
2. Open `index.html` directly in a browser (file:// protocol) or serve with a simple HTTP server:
   ```bash
   python -m http.server 8000
   # or
   npx http-server
   ```
3. Edit `index.html` and related JSON files; refresh browser to see changes

### Making Changes

- **Markup:** edit `index.html`. Keep the menu single-line and the dashboard 3:1.
- **Styling:** edit `styles.css`. Define new colors as CSS variables on `:root` so `config.json` can override them via `applyConfig()`.
- **Logic:** edit `app.js`. Mutate `state`, then call `save(); render();`.
- **Theme / defaults:** edit `config.json`. It only loads over HTTP — under `file://` the built-in defaults in `app.js` apply.
- **State reset:** `localStorage.removeItem('dnd-hirelings-state-v1')` in DevTools, then reload.

### Testing

Manual only. Open `index.html` in a browser and exercise:
  - Add / edit / delete agents and tasks
  - Click a task to select; click an agent to assign — agent should jump to ACTIVE column
  - Mark task complete — agent's `#task:` tag should grey out and agent should return to IDLE
  - Edit attribute matching a requirement of an assigned task — attribute should highlight
  - Advance the clock; reload the page and confirm everything persists
  - Export → clear localStorage → import; confirm full round-trip
  - Page itself never scrolls; only the inner card grids and task list scroll if overfull
  - Configuration changes take effect
- **No automated test suite initially**; prioritize working UI over test coverage

## Configuration (config.json)

Optional. Loaded at boot via `fetch('config.json')` — only works under HTTP. Under `file://` the fetch silently fails and `DEFAULT_CONFIG` from `app.js` is used.

Two sections:
- `colors` — keys map 1:1 to CSS custom properties on `:root` (e.g. `bg` → `--bg`).
- `defaults` — values used when creating new agents/tasks and the initial session.

When you add a new color, you must:
1. Add it to `DEFAULT_CONFIG.colors` in `app.js`
2. Add the matching `--name` to `:root` in `styles.css` and use it via `var(--name)`
3. (Optional) add it to `config.json` for documentation

## Common Tasks

### Add a new agent property
1. Add the field to the object in `createAgent()` in `app.js`
2. Backfill it in `load()` so older saves still work
3. Add a render hook in `renderAgentCard()` (use `editable()` for editable fields)
4. If user-configurable default, add it under `defaults` in `DEFAULT_CONFIG` and `config.json`

### Add a new tag type
Tags are free-form `#type:content` strings — no schema change needed. Just decide whether your new type should affect "active" highlighting and update `isAttributeActive()` / `isActivityActive()` accordingly.

### Migrate state shape
Bump the `STORAGE_KEY` in `app.js` (e.g. `-v1` → `-v2`) when the shape changes incompatibly. Old data is left in localStorage but ignored — that's preferable to silent corruption.

### Git
Make commit messages very concise (50-100 characters)