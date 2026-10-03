# Testing

Test-driven development is **required**: write a failing test before the code
that makes it pass. This is the stack-agnostic contract; the runner, the
layout, and the commands come from the stack ([`AGENTS.md`](../AGENTS.md)
"Commands").

With an agent writing the code, the failing test is the one claim of "done"
it can't talk its way past.

## Core workflow

- **Red → Green → Refactor**, per behavior, not per module. Write the smallest
  failing test that encodes one acceptance criterion, make it pass with
  minimal code, then refactor with the test as a safety net.
- **Acceptance criteria are the pre-written failing tests.** If a criterion
  can't become a test, it isn't specific enough — raise it on the issue.
- **Bug fixes ship with a regression test** that fails before the fix.

## Organization

- **Runner:** [Vitest](https://vitest.dev), in the `node` environment,
  through Vite's own transform pipeline — so build-time imports such as `?raw`
  resolve in tests without mocking (`vite.config.js` `test`).
- **Where:** co-located — `src/logic/foo.js` is tested by
  `src/logic/foo.test.js`.
- **What:** the logic, state, and constants tiers. Components have no
  automated tests (that would need a DOM environment and new dependencies,
  [`AGENTS.md`](../AGENTS.md) "Hard rules"); they are checked by hand
  ([Checking by hand](#checking-by-hand)).
- Test names state the behavior: "returns an empty list when the input is
  empty", not "test_parse_2".
- Shared test data lives in `src/fixtures/`, created when a second test
  needs the same data. For each surface, provide a **minimal**, a
  **typical**, and a **maxed-out** case.

## Deterministic, always

- No wall-clock time, unseeded randomness, live network, or dependence on
  test order. Inject a clock, seed the random source, stub the network.
- A flaky test is a defect to fix, not a reason to re-run CI until it passes.

## Tests that guard invariants

Every invariant in [`SPEC.md`](../SPEC.md) that a machine can check has a
test or lint rule that fails when it breaks. Name the invariant's ID in it
(`INV-2`), so a failure points straight at the rule, and `grep INV-2` finds
everything that enforces it.

Lessons that carry across projects:

- **Reproducibility tests** compare two *independent* runs that share no state
  (a fresh process, or a reset module cache), and compare the **raw output
  bytes** — never a re-serialization of parsed objects, which can hide drift
  such as key order.
- **Boundary rules** (module A never imports module B) belong in lint, where
  they fail at the cheapest step.
- **Identity tests** ("these two entry points call the *same* function")
  assert the reference itself, not merely equal output.

## Checking by hand

If a change affects what users see, run the product and look at it —
automated tests don't prove an interface works. Record what you checked in
the PR's Testing section, with screenshots
([`workflow.md`](workflow.md) "Screenshots").

## Quality bar to merge

- `check` is green, which means the full suite is. No skipped tests, unless
  marked with a reason in the code and justified in the PR.
- New behavior ships with its tests, in the same PR.
