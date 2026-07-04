# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Model Selection
When spawning subagents or workflow agents:
- Haiku 4.5: Exploration
- Sonnet 5: Analysis, reporting, file/code search, documentation, browser automation
- Opus 4.8: Refactoring, complex execution, code review
- Fable 5: Architecture, planning, new features, orchestration

## Project Overview
- **Guild Manager** is a single-page dashboard for managing NPC agents in roleplaying games. 
- Players create **agents**, assign **tasks**, transact **items**, and operate a **game clock** that drives automated progress.

## UI Principles: 
- Versatile: Components serve multiple functions.
- Transparent: UI structure mirrors data schema
- Modular: Components are pluggable and reusable.
- Configurable
- Consistent: Reuse standard styles and processes throughout.
- Anticipate and solve text spillage
- No page scroll

### CSS class naming (flat compound):
- Block: `.block` · Sub-element: `.block-element` · State: `.block--state` (double-hyphen modifier applied as a second class).
- No bare unnamespaced state classes. Cross-cutting utilities (`.mono`, `.bright`, `.dim`, `.label`, `.value`, `.right`) are the only exception.
- Index variables: `index` for named params/props; `i` only in short inline `.map()` callbacks; never `idx`.

## Engineering Principles:
- Legible code
- DRY
- Build reusable functions for the entire program that unite it structurally
- Project schema export communicable data
- Data structures resemble each other, forming a flexible and transmutable namespace
- Features are extensible and pluggable
- Modular architecture
- Observe modern best practices for coding and annotation

### Dependencies: 
Before adding any external tool or library, evaluate if the task can be completed using the existing environment. 
Request approval before introducing new dependencies.

### Development Practices: 
After implementing and/or refactoring features, prune resulting dead code and delete resulting obsolete files.

### Documentation:
- Every exported function, hook, context, and component gets a JSDoc comment covering purpose, params, return value, and side effects.
- `docs/` is the source of truth for architecture, API, environment, and gotchas — update the relevant file whenever behaviour, structure, or a public interface changes.
- Flag ambiguities or incomplete implementations with a `> ⚠️` blockquote in the relevant doc rather than leaving them undocumented.
- Naming flags use `> ⚠️ **Naming:**`; clarification flags use `> ⚠️ **Needs clarification:**`.
- Index variables: `index` in named parameters and props; `i` only in short anonymous `.map()` callbacks. Never `idx`.
- Use full words for all variable names — no single-letter abbreviations except `i` per the rule above.

## Git:
Commit messages: 50–100 characters.
Atomic commits. One logical unit per commit.
When addressing issues, ensure PRs close them on merge.
