# Guild Manager

A single-page dashboard for managing NPC agents and tasks in tabletop RPG campaigns.

## Overview

Guild Manager lets players create hirelings, assign them tasks, and run a game clock that automatically distributes work and tracks progress. State persists to localStorage between sessions.

## AI Disclosure

I'm a n00b learning about web development & design.  I use Claude Code, OpenCode, maybe a few other things.  This is an educational project for myself.  My goal is to learn coding, experiment with system design, and learn how to use the latest tools to produce a high quality webapp.

| Human | Human & AI | AI |
|-------|------------|----|
| Design, Write Specs, Edit Code | Code Review, Git Mgmt, Testing | Generate Plans, Generate Code, Flag Issues |

## Features

- **Agents** — Create and customize characters (hirelings, NPCs, not AI agents) with skills, rates, descriptions, and portraits
- **Tasks** — Define jobs with work requirements and gold rewards
- **Game clock** — Play/pause/step time; the clock assigns work to available agents and resolves completed tasks
- **Tag system** — Path-based `modifier,type:subtype=value` tags drive agent attributes, task requirements, and rewards
- **Bind** — Agents carry items in a personal Bag (left-click to allocate: transfer, sell, or return) and bind them to optional Slots (right-click to bind/unbind); bound items can grant attribute bonuses via `bonus,*` tags
- **Tag Registry** — A live, editable index of every tag structure in your game; auto-registers tags as you author them and supports YAML export/import
- **Preset library** — Left-click any `+AGENT`, `+TASK`, or `+ITEM` button to open a searchable library with an editable preview; right-click still creates a blank object
- **UI** — Editable fields, drag-select, color palettes, no page scroll

## Tag Grammar

Tags follow the form `modifier,path:path=value` where modifier and value are optional:

| Part | Example | Meaning |
|------|---------|---------|
| Plain | `skill:arcana=4` | Agent has Arcana 4 |
| With modifier | `req,skill:arcana=4` | Task requires Arcana ≥ 4 |
| Block modifier | `block,trait:undead` | Task blocks agents with the undead trait |
| Work tag | `work:skill:arcana=8` | Task costs 8 skill (Arcana) work |
| Bonus modifier | `bonus,ability:str=1` | Item grants +1 STR when bound |

Registered namespaces: `ability` (STR/DEX/CON/INT/WIS/CHA), `skill` (all 18), `task`, `tool`, `trait`, `class`, `race`, `level`, `item`, `work`, `bind`. Tags outside the registry are valid and displayed as raw text.

## Tag Registry

Open the Tag Registry with the `TAG REGISTRY` button in the top bar.

- **Folding tree view** — code-editor-style outline; click `+`/`−` to expand or collapse branches, `×` to delete a node
- **Auto-registration** — adding tags to agents or tasks automatically registers their path structure into the registry
- **YAML I/O** — `SAVE` exports the full registry as a `.yml` config file; `LOAD` imports and validates it (rejects non-map values, invalid key characters, and duplicate keys)
- Registry edits persist to localStorage; importing a YAML file replaces the current registry after validation

## Preset Library

Standard presets ship in `public/presets/`; user presets persist in localStorage. From the library modal:

- **Left-click** a preset to select and preview it
- **ADD** inserts a new board object from the selected preset
- **SAVE / LOAD** export or import a `.json` preset file
- Editing a standard preset forks a personal copy that auto-saves

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | React 18.3 |
| Build | Vite 5.4 |
| State | Context API + useReducer |
| Styling | Vanilla CSS |
| Persistence | localStorage |
| Config I/O | js-yaml 4.2 |

## Project Structure

```
src/
├── components/   # UI components
├── state/        # GameContext, UIContext, reducer
├── hooks/        # Clock timing, drag, palettes, presets
├── logic/        # Business logic (tasks, agents, clock, tags, presets)
├── constants/    # Palettes, portrait data, library configs
└── styles/       # CSS
public/
├── presets/      # Bundled agent, task, and item presets
└── assets/       # Portraits, item icons (WebP), theme backgrounds (WebP), fonts (WOFF2)
```

Served images are WebP and the display font is WOFF2; the portrait and item
pickers are populated automatically by a build-time manifest. See
[`docs/assets.md`](docs/assets.md) for the asset pipeline.

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Credits
Portrait assets: Neverwinter Nights, BioWare and Obsidian Entertainment, 2002
