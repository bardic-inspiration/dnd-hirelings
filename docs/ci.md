# CI

What CI does for this repo, whatever the language.
[`ci.yml`](../.github/workflows/ci.yml) runs the gate,
[`pr-title.yml`](../.github/workflows/pr-title.yml) guards the commit record,
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

## Not covered yet

Candidates for later modules: release and deploy workflows, code and secret
scanning, and coverage thresholds.
