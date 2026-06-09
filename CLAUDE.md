# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

- **Guild Manager** is a single-page dashboard for managing NPC agents in roleplaying games. 
- Players create **agents**, assign **tasks**, and operate a **game clock** that drives automated progress.

## UI principles: 
- Minimalist: Less is more. No duplicate functions.
- Versatile: Components serve multiple functions.
- Modular
- Intuitive
- Transparent: UI structure mirrors data schema
- No page scroll

## Engineering principles: 
- Legible code
- "Don't Repeat Yourself"
- Configurable
- Extensible
- Modular architecture
- Lightweight
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
