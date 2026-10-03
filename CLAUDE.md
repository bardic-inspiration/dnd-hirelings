# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
- **Guild Manager** is a single-page dashboard for managing NPC agents in roleplaying games. 
- Players create **agents**, assign **tasks**, transact **items**, and operate a **game clock** that drives automated progress.
- [`SPEC.md`](SPEC.md) is the source of truth for what the app does: purpose, invariants, architecture, and an area file per subsystem under `docs/spec/`. UI principles are in `docs/spec/ui.md` "Principles".

## Code Conventions

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
- Before adding any external tool or library, evaluate if the task can be completed using the existing environment. 
- Request approval before introducing new dependencies.

### Clean As You Go:
- After implementing and/or refactoring features, prune resulting dead code and delete resulting obsolete files.

## Documentation Practices:

### Goals:
- Maintain a clear repository map
- Eliminate documentation drift
- Optimize LLM context usage

### 1. Scope Partitioning
*   **Source Code (`/src`):** The sole source of truth for implementation intent. Every exported function, hook, context, and component must include standard docstrings (e.g., JSDoc) detailing purpose, parameters, return values, and side effects. Keep logic context local; do not explain individual function mechanics in markdown files.
*   **Spec (`SPEC.md`, `docs/spec/`):** The sole source of truth for what the system does: architecture, cross-module data flows, data contracts and file formats, and known edge cases. Present tense only; planned work is marked `Planned (#N):` and history stays in git. Do not duplicate source code logic here.

### 2. Operational Rules
*   **Synchronized Commits:** If a code change alters a public interface, cross-module boundary, or structural behavior, update `SPEC.md` or the matching `docs/spec/` file within the same pass to prevent architectural drift.
*   **Visible Gaps:** Proactively document ambiguities, incomplete implementations, or architectural gaps directly within the relevant code file or markdown doc rather than leaving them unaddressed; undecided behavior goes in `SPEC.md` "Open questions".
*   **No Redundancy:** Do not generate explanatory prose in the spec for self-evident code or logic fully captured by inline docstrings.

## Git Practices:
Commits, pull requests and issues chart the project's evolution and inform iteration.

### Branch Management
- If the user requests changes while on **master**, always create a new branch.
- Delete feature branches upon successful merge.

### Atomic Commits
- Rule: One isolated logical unit per commit. No multi-feature blobs.
- Length: 50–70 characters max.
- Format: ```(<type>(<scope>): <description> [#issue])```
- Allowed Types: feat | fix | enhancement | refactor | docs | chore
- No Merge Commits: Maintain a strictly flat, linear history via fast-forward merges or rebasing to reduce graph traversal overhead for LLMs.

### Pull Requests
- PRs link the intent (Issue/Prompt/Spec Document) to the execution (Commits). 
- PRs form the core historical context block for agents reading repository lineage.
- Title Format: Same as commit format ```(<type>(<scope>): <summary>)```
- Automatic Closure: When addressing issues, PR description must include Closes #X or Fixes #X.


