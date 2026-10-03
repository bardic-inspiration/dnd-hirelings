# Workflow

How a change gets from an idea to `main` — issues, branches, commits, pull
requests, CI, and merging — and how a spike explores without getting there.
Everything Git and GitHub lives here.

Every change takes the same path, whichever mode produced it
([`AGENTS.md`](../AGENTS.md) "How work happens"): a task, a branch, a PR with
a green check, a human merge — and one squash commit on `main` as the record.

## Issues

An issue is a prompt that outlives its session: the task, written down where
the next session — or you, next month — can find it.

- **Routines always work from an issue.** An interactive session files one for
  work it won't finish itself; a task that comes from chat and lands in this
  session's PR needs no issue — the PR description carries it.
- **Sized for one PR.** If it won't fit, split it before starting.
- **Testable acceptance criteria**, derived from the `SPEC.md` section the
  issue cites. They're the failing tests to write first
  ([`testing.md`](testing.md)); if one can't become a test, it isn't specific
  enough yet.
- **Out of scope, stated** — the first guard against creep.
- **Dependencies** as a `Depends on #N` line, so the queue skips the issue
  until they close.
- **Ends with a `## TL;DR`:** a few plain-English bullets, no jargon — why it
  exists, and what changes once it's done.

The [templates](../.github/ISSUE_TEMPLATE/) lay these out — Feature / task,
Bug report, Docs change. They apply only in GitHub's web form; an agent filing
through the API writes the same sections itself.

### Labels

| Label | Meaning |
|---|---|
| `task` | A feature or change sized for one PR. In the queue. |
| `bug` | Behavior that contradicts the spec. In the queue. |
| `documentation` | A substantive docs-only change. |
| `plan` | A plan: phases and done-criteria for work bigger than one PR, with its tasks as sub-issues ([`spec-driven-development.md`](spec-driven-development.md) "Plans"). Not in the queue itself. |
| `needs-discussion` | Needs a human decision before anyone builds it — usually a design interview (`ask-me`, `grill-me`), with the decisions recorded as a comment and the acceptance criteria rewritten and confirmed. Out of the queue until the label comes off. |

Labels are lowercase, colon-scoped where hierarchical (`area:parser`).

### The queue

A routine that isn't handed an issue takes the **lowest-numbered open issue
labeled `task` or `bug`** that has no open PR linked to it, isn't labeled
`needs-discussion`, and has every "Depends on" issue closed. Filing order is
priority and dependency order — file prerequisites first.

The rule assumes one picker at a time. Routines that run in parallel each
work their own queue, split by a label such as `area:parser`. Plans don't
change the queue: a plan's tasks are filed only when their phase opens
([`spec-driven-development.md`](spec-driven-development.md) "Plans").

### Closing

Issues close through a merged PR carrying `Closes #N`, which keeps the trail
from issue to commit intact. One that turns out invalid or superseded is
closed with a comment saying why, and the matching reason ("not planned",
"duplicate") — never deleted or left to go stale.

## Scope

Sessions don't remember each other, so nobody cleans up "temporary" scope
creep later — it just becomes permanent drift. Every PR is one concern:

- **Do what the task asks — nothing more.** A file the acceptance criteria
  don't touch isn't part of this PR, even if the change is one line and
  obviously right. No drive-by refactors, no "while I'm in here" fixes.
- **File, don't fold.** Anything worth doing that's out of scope becomes a new
  issue saying where it came from ("Surfaced while working #N"), and the PR
  gets one line pointing at it — not a `TODO`, not a note buried in the PR.
- **A PR that outgrows its task means the task was under-scoped.** Split the
  extra ground into issues rather than growing the PR.
- **Clean up what your own change leaves behind.** Code your change made
  dead, and files it made obsolete, are deleted in the same PR — that is part
  of the task, not a drive-by.
- **Two lists name the tempting-but-out-of-scope work:** the spec's non-goals
  (what the project never does) and each open plan's "Out of scope" (what
  this stretch of work leaves for later).

**When something unplanned comes up,** ask one question: does proceeding mean
guessing at behavior, or risking an invariant? **Yes** → stop, and resolve it
in the spec first ([`spec-driven-development.md`](spec-driven-development.md)
"Using it"). **No** → keep going, and file the rest.

## Branches

- Branch from `main` as `type/short-description` (`feat/login-form`,
  `fix/empty-list-crash`), using the commit types below. If your agent
  platform assigns the branch name, use it as given.
- One branch per PR. A spike's branch is `spike/<question>`
  ([Spikes](#spikes)).
- **Once pushed, a branch's history is shared** — another session may have it
  checked out. Add commits; never amend, rebase, or force-push. To catch up
  with `main`, merge it in (or use GitHub's "Update branch"); the squash
  absorbs the merge commit.

## Commits

`main` gets **one commit per PR**, because PRs land by squash merge: the PR
title becomes the commit subject (with ` (#N)` appended) and the PR
description becomes its body. So `git log --oneline` reads as the project's
changelog, one line per change, and `git show` gives the why without leaving
the repo.

**PR titles are Conventional Commits subjects** — CI checks them, because
each becomes a commit subject on `main`:

```
type(scope): imperative subject
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`,
  `build`, `style`.
- **Scope** (optional): the lowercase name of the package, module, or area.
- **Breaking changes:** `!` after the type or scope (`feat(api)!: ...`), plus
  a `BREAKING CHANGE:` line in the PR description saying what breaks.
- **Subject:** imperative, lower-case, no trailing period, ≤ 72 characters
  including the ` (#N)` GitHub appends.

The commit's body is the PR description
([The PR is the record](#the-pr-is-the-record)).

**Branch commits** never reach `main`, so they need no particular format —
just a message that says what the step did, so a reviewer, or a session
picking the branch up mid-flight, can follow along.

### Versioned surfaces

Saved data outlives the code that wrote it, so these surfaces are versioned
([`spec/persistence.md`](spec/persistence.md) holds their contracts):

- **Browser storage** (`STORAGE_KEYS`): an incompatible change to a stored
  format bumps that key's version suffix in the same PR, shipping either
  migration code or an explicit note in `STORAGE_KEYS` that older data is
  abandoned.
- **Exported files** — session JSON, event-log CSV, registry YAML, preset
  JSON, config YAML: a change that stops an older file from loading is a
  breaking change (`!` in the title, `BREAKING CHANGE:` in the description),
  and the PR either keeps a load path for the old form or updates the spec to
  say it is abandoned. Event-log CSV columns are only ever appended.

A surface never changes silently.

## Pull requests

### The PR is the record

| PR field | Becomes | So write it as |
|---|---|---|
| Title | The commit subject on `main` | A Conventional Commits subject ([Commits](#commits)). |
| Description | The commit body | What a reader of `git log` needs a year from now: what, why, where it came from, how it was tested, the TL;DR. No leftover template comments. |

If review changes the approach, **update the description before merge**, so
the record matches what landed.

### Opening one

- **Open it when the work is ready.** A routine's run isn't done until it has
  produced a PR. (Exception: you're told not to.)
- **Run the pre-flight checklist** (below) first.
- **Fill in the [template](../.github/pull_request_template.md)**, then delete
  the sections that don't apply and every guidance comment.
- **Link its task:** `Closes #N` for an issue. A chat task with no issue
  states the task and its acceptance criteria in the Summary instead.
- **Say where it comes from** — the `SPEC.md` section it implements — so a
  reader can trace commit → PR → issue → spec.
- **End with a `## TL;DR`:** plain-English bullets — why, and what changes.
  It's the reviewer's fast path, and it lands in history as the plain-English
  line of the project.

### Pre-flight checklist

This lives here rather than in the PR template, so it doesn't repeat in every
commit on `main`.

**Code changes:**

- [ ] Tests written first, and passing; `check` green
      ([`AGENTS.md`](../AGENTS.md) "Commands").
- [ ] `SPEC.md` describes the behavior as merged — updated if behavior
      changed, and any `Planned` marker this PR fulfils removed.
- [ ] Other docs updated if behavior changed.
- [ ] One concern, scoped to its task; the invariants still hold.
- [ ] Screenshots attached, if the UI changed.
- [ ] Title and description written for `git log`.

**Docs-only changes:** every changed file is Markdown; the title is
`docs: ...`; links resolve and cross-references are updated; no process
narration in doc content ([`documentation.md`](documentation.md)).

### Screenshots (UI changes)

A PR that changes what users see includes 1–4 screenshots under
`## Screenshots` — before/after for fixes, plus a phone-width view if the
layout differs. Commit them, so a session with no upload path can attach them:
save to `dev/screenshots/pr-<N>/name.png` (open the PR first to get `<N>`), and
link by commit SHA so the link survives the folder being pruned —
`https://github.com/bardic-inspiration/dnd-hirelings/blob/<sha>/dev/screenshots/pr-<N>/<file>?raw=true`.

## Watching CI

**A PR you open is yours until it's merged or closed.** Opening it isn't the
end of the task: with several PRs open at once, each merge moves `main` under
the others, and a PR that was green an hour ago may not be now.

- **Red check** → read the log, fix the cause on the same branch, push. Never
  skip, disable, or weaken a test to get green. If the failure isn't this PR's
  (it's red on `main` too), say so once on the PR instead of fixing it here.
- **Behind `main`, or conflicting** → merge `main` in, resolve, run `check`,
  push.
- **Review comments** → fix and push, or answer why not, on the thread.
- **Blocked on something only a human can decide** → say so once on the PR,
  and stop.

**Spike PRs are the exception** ([Spikes](#spikes)): they're red by design, so
nobody watches or "fixes" them.

In an interactive session, tell the user where things stand; in a routine,
the PR's own comments are the report. How a session watches is tool-specific
— for Claude Code, see [`CLAUDE.md`](../CLAUDE.md).

## Merging

- **A human reviews and merges.** Agents open and fix PRs; they don't merge
  them.
- Merge when `gate` and `pr-title` are green on the latest commit, the branch
  is up to date with `main`, and review threads are resolved. After reviewing,
  **"Enable auto-merge"** lets GitHub merge the moment that's all true.
- Land with **"Squash and merge,"** and check the pre-filled message reads
  well as a commit.
- **Dependency updates** from Dependabot need no issue: read what changed, and
  merge when green.

## Docs-only changes

A change is **docs-only** when every changed file ends in `.md`. Anything
else in the diff — code, tests, config, a workflow, a lockfile — makes it a
code change. When in doubt, it's a code change.

- **Skip:** writing tests first, and running `check`. CI skips the gate on a
  Markdown-only diff by itself ([`ci.md`](ci.md)).
- **Issues:** a substantive change (a new doc, a rule change) gets one, using
  the Docs change template; a trivial fix (a typo, a broken link) doesn't.
- **A `SPEC.md` change** follows
  [`spec-driven-development.md`](spec-driven-development.md): anything it
  describes that `main` doesn't do yet is marked `Planned`.
- **Still required:** correct content, links that resolve, cross-references
  updated in the same PR, no process narration in doc content, and the TL;DR.

## Spikes

A spike spends cheap code to buy understanding: whether an approach works,
which of several designs to pick, what an interface feels like to use. It's
the one place code is written to be thrown away — so it's the one place the
rules above are off. What crosses into `main` is what you learned, never the
code.

1. **Start from a question, not a task:** "Can this sync offline?" "A, B, or
   C?" Branch `spike/<question>` — or, where the agent platform assigns the
   branch name, mark it with the PR title instead (step 4).
2. **Explore freely.** No issue, no tests first, no scope rules, messy commits
   welcome. Competing approaches can run as parallel spikes.
3. **Time-box it** to a session or an afternoon. A spike that keeps growing is
   answering the wrong question.
4. **Open a draft PR titled `spike: <the question>`** and write the findings
   in its description — the one required output:

   ```markdown
   ## Question
   ## What I tried
   ## What worked, and what didn't
   ## Recommendation
   ## Follow-ups   <!-- the spec edits and issues this led to -->
   ```

5. **Turn the findings into the real path:** answer the spec's open questions
   in a docs-only PR, and file issues for the work ("Explored in #N").
6. **Close the spike PR unmerged**, linking the follow-ups, and delete the
   branch. The closed PR keeps the diff and the findings on GitHub for good.

The real work then goes through the normal loop — test first, `check`, a PR.
A session may read the spike for reference, but it rewrites the code rather
than merging it.

**The guard.** The required `pr-title` check fails any PR whose branch starts
with `spike/` or whose title starts with `spike:`, so a spike can't be merged
by accident ([`ci.md`](ci.md) "PR title check"). It catches accidents, not
decisions: promoting a spike means rebuilding it through the normal loop, not
retitling it.
