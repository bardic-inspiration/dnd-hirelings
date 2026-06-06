# Guild Manager

A lightweight single-page dashboard for managing NPC agents and tasks in tabletop RPG campaigns.

## Overview

Guild Manager lets players create hirelings, assign them tasks, and run a game clock that automatically distributes work and tracks progress. State persists to localStorage between sessions.

## Features

- **Agents** — Create and customize hirelings with skills, rates, descriptions, and portraits
- **Tasks** — Define jobs with work requirements and gold rewards
- **Game clock** — Play/pause/step time; the clock assigns work to available agents and resolves completed tasks
- **Tag system** — Path-based `modifier,type:subtype=value` tags drive agent attributes, task requirements, and rewards
- **Equipment** — Agents carry items in a personal Bag and equip them to named slots (weapon, armor, off-hand, ring, head, feet)
- **Preset library** — Right-click any `+AGENT`, `+TASK`, or `+ITEM` button to open a searchable library with an editable preview; left-click still creates a blank object
- **UI** — Editable fields, drag-select, color palettes, no page scroll

## Tag Grammar

Tags follow the form `modifier,path:path=value` where modifier and value are optional:

| Part | Example | Meaning |
|------|---------|---------|
| Plain | `skill:arcana=4` | Agent has Arcana 4 |
| With modifier | `req,skill:arcana=4` | Task requires Arcana ≥ 4 |
| Block modifier | `block,trait:undead` | Task blocks agents with the undead trait |
| Work tag | `work:skill:arcana=8` | Task costs 8 skill (Arcana) work |

Registered namespaces: `ability` (STR/DEX/CON/INT/WIS/CHA), `skill` (all 18), `task`, `tool`, `trait`, `class`, `race`, `level`, `item`, `work`, `equip`. Tags outside the registry are valid and displayed as raw text.

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

No external dependencies beyond React and Vite.

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
└── presets/      # Bundled agent, task, and item presets
```

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Credits
Portrait assets: Neverwinter Nights, BioWare and Obsidian Entertainment, 2002
