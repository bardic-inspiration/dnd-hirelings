# CI

What CI does for this repo, whatever the language.
[`ci.yml`](../.github/workflows/ci.yml) runs the gate,
[`pr-title.yml`](../.github/workflows/pr-title.yml) guards the commit record,
[`pages.yml`](../.github/workflows/pages.yml) deploys for remote testing,
and [`dependabot.yml`](../.github/dependabot.yml) keeps the Actions they use
up to date.

## The gate is one command

`check` ([`AGENTS.md`](../AGENTS.md) "Commands") runs everything a change must
pass — lint, format check, typecheck, tests, build, whatever the stack has —
and never modifies files. You, agents, and CI all run the same command, so
there is one definition of green and nothing to keep in sync.

The stack defines `check` in its native task runner — an npm script, a
Makefile target, a `just` recipe — and prints each stage's name as it runs,
so a failure points at one stage. Adding a check means adding it to `check`,
not to the workflow.

## What CI must do

1. **Run on every PR and every push to `main`**, plus on manual dispatch.
2. **Run `check`, and nothing the local `check` doesn't.** No CI-only checks
   on code — the PR title check is about metadata, not code.
3. **Be the merge gate.** `gate` and `pr-title` are required status checks;
   red is never merged, and no test is skipped, disabled, or marked
   `continue-on-error` to get green.
4. **Take the docs-only fast path.** A Markdown-only diff skips setup and
   `check`, but the job still runs and reports green. It's detected inside
   the job rather than with GitHub's `paths-ignore`, because a workflow
   skipped by a path filter never reports, and a required check waits for it
   forever. If `check` includes doc checks (links, a doc that must match the
   code), or is fast anyway, delete the detection step and run `check` on
   every change.
5. **Be reproducible.** Pin the toolchain version, install from the lockfile,
   and keep tests deterministic ([`testing.md`](testing.md)).
6. **Use least privilege.** `permissions: contents: read`; the gate needs no
   secrets; PR-controlled text (titles, branch names) reaches a script only
   through `env`, never interpolated into it.
7. **Stay fast and bounded.** Every job has a timeout, superseded runs on the
   same branch are cancelled, and dependencies are cached. If the gate gets
   slow, parallelize inside `check` or split jobs — don't drop checks.

## PR title check

PRs land by squash merge, so a PR's title becomes a commit subject on `main`
([`workflow.md`](workflow.md) "Commits"). `pr-title.yml` fails a title that
isn't a Conventional Commits subject, ends with a period, or would make a
subject over 72 characters once GitHub appends ` (#N)`. GitHub's own
`Revert "…"` titles pass as they are. It re-runs when the title is edited, and
its type list mirrors `workflow.md` — change both together.

The same check **blocks spikes**: it fails any PR whose branch starts with
`spike/` or whose title starts with `spike:` ([`workflow.md`](workflow.md)
"Spikes"). The title marker exists because agent platforms often assign the
branch name. `gate` still runs on a spike, which is useful to see — but
`pr-title` is what keeps it from merging.

## Enforcing project rules

An invariant ([`SPEC.md`](../SPEC.md)) that a machine can check belongs in
`check` — as a lint rule or a test — not in reviewers' memories. Patterns that
have worked:

- A **boundary lint rule**: "the client never imports the engine," failing at
  the cheapest stage.
- A **doc-sync check**: a developer doc that maps the code is verified against
  it, so drift fails CI instead of waiting for an audit.
- A **forbidden-capability scan**: "no network calls," "no unseeded
  randomness in core logic."

Each names the invariant ID it enforces, so `grep INV-n` finds every check for
a rule ([`testing.md`](testing.md)).

## Runtime matrix

If the project supports more than one runtime version, test each — typically
the current and previous long-term-support releases — with
`fail-fast: false`. A matrix renames the check (`gate (22)`), so update the
required checks to match.

## Changing CI

- A change to `.github/workflows/` or to `check` is a code change, never
  docs-only.
- **Weakening a check** — removing a stage, loosening a threshold, adding
  `continue-on-error`, excluding files — needs its own issue saying why. It
  never rides along in an unrelated PR.

## Deploys

`pages.yml` publishes the app to GitHub Pages so it can be tried from any
browser — the maintainer's table, a phone, a reviewer — without a local
checkout:

| Source | Served at |
|---|---|
| `main` (every push) | `https://bardic-inspiration.github.io/dnd-hirelings/` |
| An open PR from this repo (every push) | `https://bardic-inspiration.github.io/dnd-hirelings/pr-preview/pr-<N>/` |

- **How:** the workflow builds with `BASE_PATH` set to the target's path
  ([`spec/assets.md`](spec/assets.md) "App paths") and
  [`pages-publish.sh`](../.github/scripts/pages-publish.sh) commits the build
  into the `gh-pages` branch, which Pages serves (repo Settings → Pages →
  "Deploy from a branch", `gh-pages`, `/`). A `main` deploy replaces
  everything but `pr-preview/`; a PR deploy replaces only its folder; closing
  the PR deletes it. Concurrent pushes to `gh-pages` retry from a fresh fetch.
- **Finding a preview:** the PR's "View deployment" button (the `preview`
  environment), or the run's notice. It goes live about a minute after the
  run, once GitHub's own pages build finishes.
- **Not a gate.** A failed deploy is worth fixing but never blocks a merge;
  `gate` and `pr-title` stay the only required checks.
- **Permissions:** `contents: write`, the least that can push `gh-pages`.
  The workflow runs on `pull_request`, never `pull_request_target`, so it only
  ever builds code that already has write access: PRs from forks, and
  Dependabot's, get a read-only token and are skipped rather than failed.
- **Shared browser storage.** Every deploy is the same origin
  (`bardic-inspiration.github.io`), so `main` and all previews read and write
  the same `localStorage`. A preview that changes a stored format changes it
  for the others too; export a session first if it matters.
- **Limits:** Pages builds from a branch are soft-limited to 10 an hour, and
  the site to 1 GB. Unchanged files cost nothing in `gh-pages`, since git
  stores identical content once.

## Not covered yet

Candidates for later modules: release workflows, code and secret scanning,
and coverage thresholds.
