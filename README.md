# Guild Manager

A lightweight single-page dashboard for managing NPC agents and tasks in tabletop RPG campaigns.

## Overview

Guild Manager lets players create hirelings, assign them tasks, and run a game clock that automatically distributes work and tracks progress. State persists to localStorage between sessions.

## Features

- **Agents** — Create and customize hirelings with skills, rates, descriptions, and portraits
- **Tasks** — Define jobs with work requirements, item costs, and gold rewards
- **Game clock** — Play/pause/step time; the clock assigns work to available agents and resolves completed tasks
- **Tag system** — Flexible `#type:name=value` tags drive agent attributes, task requirements, and rewards
- **Inventory** — Track consumable items consumed by tasks
- **UI** — Editable fields, drag-select, color palettes, no page scroll

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
├── hooks/        # Clock timing, drag, palettes
├── logic/        # Business logic (tasks, agents, clock, tags)
├── constants/    # Palettes, portrait data
└── styles/       # CSS
```

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Credits
Portrait assets: Neverwinter Nights, BioWare and Obsidian Entertainment, 2002
