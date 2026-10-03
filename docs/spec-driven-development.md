# Spec-Driven Development

What a spec contains, how to build from it, and how to keep it useful long
after the first build.

[`SPEC.md`](../SPEC.md) is the source of truth for **what to build**;
[`AGENTS.md`](../AGENTS.md) is the source of truth for **how to work**. Code
conforms to the spec — the spec is never reverse-engineered from code.

## Three tenses, three homes

Specs rot when one document carries three tenses: the design, the plan to
build it, and the history of how it was decided. Once the build is done, a
cold-start session can no longer tell which statements describe the system.
Keep them apart:

| Kind | Tense | Lives in | Lifespan | A session reads it |
|---|---|---|---|---|
| **Spec** | Present — what the system is and must do | `SPEC.md` | The life of the project, edited in place | Always: the sections its task cites |
| **Plan** | Future — how to get from here to there | A GitHub issue labeled `plan`, its tasks as sub-issues | Until its exit criteria hold — then closed | While it's open |
| **History** | Past — what changed, and why | Squash commits, closed PRs and issues | Forever | On demand, never by default |

**The repo holds only the present; GitHub holds the active future; git holds
the past.** Nothing future-tense or finished is ever a file in the tree — an
archive in the tree is noise in every search a session runs.

## What a spec contains

The shape varies by project: a small tool's spec may fit on one page; a
system's may be split across files. Keep the parts the project needs, in this
order, and drop the rest.

| Part | Contains | Leave out |
|---|---|---|
| **Purpose & non-goals** | What the project is, who it's for, and what it deliberately isn't. The non-goals are the scope guard. | Pitch, roadmap. |
| **Invariants** | 3–7 timeless, testable rules, each with a stable ID (`INV-1`). A change that breaks one is wrong even if CI is green. | How each is enforced — that lives in the test or lint rule that names it. |
| **Concepts** | The core nouns, each defined once. | |
| **Architecture** | Components, what each owns, and the boundaries between them. | File layout the code already shows. |
| **Interfaces** | Every surface other code or people depend on — types, APIs, file formats, CLI — precise enough to test against. | Internal helpers. |
| **Behavior** | Rules, state transitions, and error cases, at the precision a test can be written from. | Implementation choices with no observable effect. |
| **Quality bars** | Budgets as numbers: latency, size, supported platforms, security posture. | Aspirations without a number. |
| **Open questions** | What is still undecided. **Not contract** — don't build against it; resolve it first. | Anything decided. |

**Never in the spec:** build phases or task lists (a plan), status ("done",
"in progress"), amendment history or version annotations, meeting notes, and
long accounts of rejected alternatives (the PR).

## Writing it

- **Present tense, current state.** "The server rejects bodies over 1 MiB" —
  not "we decided the server will…", not "(refined in 0.9)". Superseded text
  is replaced, never struck through or annotated.
- **Testable.** Every behavioral statement can become an acceptance criterion.
  If it can't, it isn't precise enough yet.
- **Rationale in a line, deliberation in the PR.** A rule that looks arbitrary
  or easy to reverse carries a one- or two-line `Why:` — naming the obvious
  alternative, if it was rejected — so nobody undoes it by accident. Size is
  no guide: a one-line rule can rest on a large decision. The options weighed
  and the debate go in the PR description, which becomes the squash commit
  body ([`workflow.md`](workflow.md) "The PR is the record").
- **Say when something isn't built yet.** Everything in the spec is true of
  `main`, except text marked **`Planned (#N):`**, where `#N` is the plan
  issue building it. The PR that makes it true removes the marker. During a greenfield build, the header's
  `status: building` covers the whole spec instead.
- **Cite by ID, not position.** Refer to invariants and sections by ID or
  heading, not by numbers that shift when the spec is reorganized.
- **One home per fact** ([`documentation.md`](documentation.md)).
  Other docs point at the spec; the spec doesn't copy them.
- **Split when it's too long to read by section.** Past a few hundred lines,
  move areas into `docs/spec/<area>.md` and keep `SPEC.md` as the index:
  purpose, invariants, and a routing table to the areas.

## Using it

- **Issues cite the spec.** A task names the spec section it implements, and
  its acceptance criteria are derived from that section's statements
  ([`workflow.md`](workflow.md) "Issues").
- **Read before you write.** A session reads the cited sections before
  touching code ([`AGENTS.md`](../AGENTS.md) "Working loop").
- **Spec and code change together.** A PR that changes behavior updates the
  spec in the same PR, so the two never disagree on `main`.
- **Ambiguity stops work.** If the spec is silent or looks wrong, don't invent
  behavior. Add an open question, and resolve it by editing the spec before
  writing the code that depends on it.
- **Disagreement is a bug.** If code and spec disagree on `main`, one of them
  is wrong: file an issue, decide which, and fix that one.
- **History is in git.** `git log -- SPEC.md` lists every spec change — one
  squash commit per PR, with its why in the body. To find why a line says
  what it does, `git blame` it (or `git log -S '<phrase>' -- SPEC.md`): the
  commit's body gives the reasoning, and its `(#N)` leads to the PR and issue.
  There is no changelog file, amendment table, or spec version. Surfaces
  that outside code depends on are versioned individually ([`workflow.md`](workflow.md)
  "Versioned surfaces").

## Plans

A **plan** turns a spec change too big for one PR into ordered work. The first
build is a plan; so is any large feature afterwards. A plan is a GitHub issue
labeled `plan` ([template](../.github/ISSUE_TEMPLATE/plan.md)) — never a file.

1. **Propose.** Open the plan issue: goal, phases with Entry / Build / Exit
   criteria, out of scope. In a PR, write the behavior it will build into the
   spec, marked `Planned (#N):`.
2. **Open a phase.** File the phase's tasks as sub-issues of the plan — each
   citing the spec section it implements, with `Depends on #N` where order
   matters. Later phases wait until theirs opens, so the queue only ever holds
   work that's ready.
3. **Build.** Sessions work the tasks through the working loop
   ([`AGENTS.md`](../AGENTS.md) "Working loop").
4. **QA pass.** When a phase's tasks are merged, walk its Exit criteria against
   the assembled `main`, run `check`, and confirm the spec describes what
   shipped. Tick the criteria in the plan, and comment the result on it. A
   failed or partial pass isn't a close: file the gaps as sub-issues of the
   same phase.
5. **Finish.** When the last phase passes, confirm no `Planned (#N)` marker is
   left in the spec, and close the plan.

A plan holds only the *how* — order, slicing, and done-criteria. Design
deliberation happens in the tasks' issues and PRs, and its outcome goes into
the spec.

## Keeping it lean

The doc audit ([`documentation.md`](documentation.md) "Doc audit") checks that:

- the spec describes `main` — no stale statements, and no `Planned` marker
  whose plan issue is closed;
- the spec carries no history — no version annotations, amendment tables, or
  past-tense narration;
- resolved open questions are gone, and nothing future-tense or finished
  lives as a file in the tree.

Periodically, a **conformance audit** checks `main` against the whole spec,
including the seams no single issue owned. Its findings are ordinary `bug` and
`task` issues.

## Re-baselining a spec that has absorbed its history

When a spec already carries amendment markers, a finished build plan, and
resolved design records, reset it in one docs-only PR:

1. **Tag the last commit before the reset** — `git tag spec-baseline-<date>` —
   so the old doc set stays one command away: `git show <tag>:SPEC.md`.
2. **Rewrite `SPEC.md` in the present tense.** Fold each amendment and
   resolved decision into the text it changed, and strip the markers.
3. **Move anything still unbuilt into a plan issue**, marked `Planned` in the
   spec. Delete finished plans, surveys, decision records, and changelogs.
4. **Use the PR description as the map:** what was deleted, where each
   surviving idea now lives, and the tag name. It becomes the commit on
   `main`.
