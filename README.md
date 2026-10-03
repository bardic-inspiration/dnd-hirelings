# Guild Manager

A single-page dashboard for running a guild of NPC hirelings in a tabletop RPG
campaign. Create hirelings, give them tasks, and run a game clock that pays
wages, applies their work, and turns finished tasks into rewards. Everything
runs in the browser; sessions save to local storage and to files.

## Features

- **Agents** — hirelings (characters, not AI agents) with portraits, daily
  rates, skills, and stats.
- **Tasks** — jobs with requirements, progress conditions, and rewards.
- **Game clock** — play, pause, and step through days; step back to undo them.
- **Tags** — one `modifier,path:path=value` grammar describes every property,
  requirement, bonus, and assignment, indexed by a live, editable Tag
  Registry.
- **Items** — an inventory and bank; give and sell items, and equip them into
  agents' slots for stat bonuses.
- **Rules as data** — computed stats, the agent card's layout, and clock
  pacing are YAML config, editable in the app.
- **Preset library** — order agents, tasks, and items onto the board from a
  searchable library of bundled and personal presets.

## AI Disclosure

I'm a n00b learning about web development & design.  I use Claude Code, OpenCode, maybe a few other things.  This is an educational project for myself.  My goal is to learn coding, experiment with system design, and learn how to use the latest tools to produce a high quality webapp.

| Human | Human & AI | AI |
|-------|------------|----|
| Design, Write Specs, Edit Code | Code Review, Git Mgmt, Testing | Generate Plans, Generate Code, Flag Issues |

## Status

Playable as a single-player tool. Larger work in progress is tracked as open
[plan issues](https://github.com/bardic-inspiration/dnd-hirelings/issues?q=is%3Aissue+is%3Aopen+label%3Aplan).

## Documentation

[`SPEC.md`](SPEC.md) is the source of truth for how the app behaves, with an
area file for each part of the system under [`docs/spec/`](docs/spec/).

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Credits

Portrait assets: Neverwinter Nights, BioWare and Obsidian Entertainment, 2002
