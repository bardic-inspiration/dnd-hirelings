# AGENTS.md — Canonical Guide for AI Coding Agents

This is the **authoritative guide** for how work is done in this repository, by
agents or humans. If another doc disagrees with this one, this one wins —
except that [`SPEC.md`](SPEC.md) is the source of truth for *what to build*;
this file is the source of truth for *how to work*.

Work is done by AI sessions that start with no memory of earlier ones.
Nothing carries over except what's in the repo and on GitHub — issues, PRs,
review threads, and the commit history — so every rule below exists to make
one session's work legible to the next.

## Purpose & scope

What the project is, and what it deliberately isn't, lives in one place:
[`SPEC.md`](SPEC.md) "Purpose & non-goals". Work bigger than one PR is
sequenced by open plan issues — issues labeled `plan`, with their tasks as
sub-issues ([`docs/spec-driven-development.md`](docs/spec-driven-development.md)
"Plans").

## How work happens

Two modes build; a spike explores. Every change reaches `main` the same way
— a PR, a green check, a human merge — whichever mode produced it. A spike
never reaches `main` at all ([`docs/workflow.md`](docs/workflow.md)
"Spikes").

| | Interactive session | Routine | Spike |
|---|---|---|---|
| Who's there | The user, in the loop | Nobody, until review | Usually the user |
| Where the task comes from | Chat, or an issue | An issue: handed to it, or the next in the queue | A question |
| Where the task is recorded | The PR description — file an issue only for work this session won't do | The issue | The findings, in a draft PR |
| When blocked | Ask the user | Say so on the issue or PR, and stop | Record it — a dead end is a finding |
| After opening the PR | Watch CI to green, and report | Watch CI to green | File the follow-ups, then close it unmerged |

The thread through all three: **the task is the prompt, the PR is the
response, review is the evaluation, and the squash commit on `main` is the
record** — for a spike, the closed PR's findings are the record.

## Hard rules

These hold for every change, whatever the task says. A change that breaks one
is wrong even if CI is green.

- **Red CI is never merged**, and tests are never skipped, disabled, or
  weakened to get green ([`docs/ci.md`](docs/ci.md)).
- **Don't silently invent behavior.** If the spec or the task is ambiguous or
  looks wrong, resolve it in the spec rather than guessing in code.
- **The project's invariants hold** — [`SPEC.md`](SPEC.md) "Invariants".
- **One concern per PR**, and only what its task asks for
  ([`docs/workflow.md`](docs/workflow.md) "Scope").
- **A PR you open is yours until it's merged or closed** — watch its CI and
  fix what fails ([`docs/workflow.md`](docs/workflow.md) "Watching CI").
- **Spike code never merges.** A spike's output is its findings; the real
  work is rebuilt through the working loop.
- **The repo is the memory.** Decisions, follow-ups, and open questions go
  into the spec, issues, and PR descriptions — never only into a chat the next
  session can't see.
- **New dependencies need the maintainer's approval.** First check whether
  the existing stack can do the job; then ask before adding a package or
  tool, even a dev-only one.

## Engineering principles

How code in this repo is shaped. The spec's "Architecture" names the
structures that embody them ([`SPEC.md`](SPEC.md)); naming and annotation
rules are in [`docs/documentation.md`](docs/documentation.md) "Code".

- **Legible over clever.** Code is read by sessions with no memory of it.
- **DRY, through shared functions.** Reuse what exists before writing more; a
  behavior two places need becomes one function that unites them.
- **Pluggable by registry.** Where behavior varies by kind, add an entry to
  the kind's registry rather than a branch in its caller.
- **Data structures resemble each other.** Agents, tasks, items, presets, and
  orders share shapes and vocabulary, so data moves between them.
- **Exports are communicable data.** What the app saves or exports is plain,
  documented data another tool could read.
- **Modular.** Each module owns one concern and depends in one direction
  (components → hooks → state → logic).

## Repo layout

```
/
├── AGENTS.md          # this file — how to work
├── SPEC.md            # what to build — index, invariants, architecture
├── CLAUDE.md          # Claude Code: imports this file, adds tool specifics
├── CONTRIBUTING.md    # setup for humans
├── docs/              # protocol docs (routing table below)
│   └── spec/          # the spec's area files (SPEC.md "Areas")
├── src/
│   ├── logic/         # game mechanics as plain functions
│   ├── state/         # contexts, reducer, storage
│   ├── hooks/         # state ↔ React lifecycle bridges
│   ├── components/    # UI
│   ├── constants/     # static data, build-time config loaders
│   └── styles/        # the single stylesheet
├── public/
│   ├── config/        # runtime YAML config
│   ├── presets/       # bundled presets
│   └── assets/        # images and fonts
├── config/            # build-time YAML config
├── .claude/           # Claude Code settings, hooks, skills
└── .github/           # CI, Dependabot, issue & PR templates
```

Tests sit beside the module they test (`foo.test.js`,
[`docs/testing.md`](docs/testing.md)).

## Working loop

1. **Take one task.** Interactive: from chat, or an issue. Routine: the issue
   you were handed, or the next in the queue
   ([`docs/workflow.md`](docs/workflow.md) "The queue").
2. **Read before you write:** the task, the `SPEC.md` sections it cites, and
   every doc it references. `git log` on the files you'll touch is context
   too — each commit on `main` is one whole PR, with its why in the body.
3. **Branch from `main`** ([`docs/workflow.md`](docs/workflow.md) "Branches").
4. **Test first.** A failing test, the minimal code to pass it, then refactor
   ([`docs/testing.md`](docs/testing.md)).
5. **Run `check`** (Commands, below). Green before every push.
6. **Open one PR.** Its title and description become the commit on `main`
   ([`docs/workflow.md`](docs/workflow.md) "Pull requests"). If it changes
   behavior, it updates `SPEC.md` too.
7. **Watch it to green** — fix red CI and conflicts on the same branch, answer
   review. A human merges.

Changing only Markdown? Steps 4–5 don't apply
([`docs/workflow.md`](docs/workflow.md) "Docs-only changes"). Running a spike?
This loop doesn't apply at all ([`docs/workflow.md`](docs/workflow.md)
"Spikes").

### Protocol docs — read when

| Read | When |
|---|---|
| [`docs/spec-driven-development.md`](docs/spec-driven-development.md) | Reading, writing, or changing `SPEC.md`; the spec is silent or wrong; a change is too big for one PR, so it needs a plan. |
| [`docs/workflow.md`](docs/workflow.md) | Anything Git or GitHub: taking or filing an issue, scope, branching, committing, opening or watching a PR, merging, docs-only changes, spikes. |
| [`docs/testing.md`](docs/testing.md) | Writing tests. |
| [`docs/ci.md`](docs/ci.md) | Changing CI or `check`; CI fails in a way you don't understand. |
| [`docs/documentation.md`](docs/documentation.md) | Writing or editing any doc, naming files, auditing docs for drift. |

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| **Check — the gate** | `npm run check` |
| Fix autofixable lint | `npm run fix` |
| Run one test, or a few | `npx vitest run <path>…` |
| Run the project | `npm run dev` (then `http://localhost:5173`) |

`check` runs everything the gate requires — lint, tests, build — and never
modifies files. There is no formatter, by design
([`docs/documentation.md`](docs/documentation.md) "Code"). CI runs this
one command ([`docs/ci.md`](docs/ci.md)), so green locally means green in CI.

## When in doubt

- **The spec is silent, ambiguous, or wrong** → don't guess. If proceeding
  means guessing at behavior or risking an invariant, stop: add an open
  question to `SPEC.md`, raise it (with the user, or on the issue), and
  resolve it by editing the spec before writing code that depends on it
  ([`docs/spec-driven-development.md`](docs/spec-driven-development.md)).
- **Adjacent work** — an edge case, a follow-on idea, tech debt — becomes its
  own issue, not a `TODO` and not part of this PR
  ([`docs/workflow.md`](docs/workflow.md) "Scope").
- **Doc drift you spot while working** → fix it in a separate docs-only PR,
  or file it ([`docs/documentation.md`](docs/documentation.md) "Doc audit").
