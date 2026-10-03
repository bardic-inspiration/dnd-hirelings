# Documentation

How docs are written, named, and kept truthful. Documentation drift is a
defect.

## Source of truth

- [`SPEC.md`](../SPEC.md) is authoritative for **what to build**; code
  conforms to it ([`spec-driven-development.md`](spec-driven-development.md)).
- [`AGENTS.md`](../AGENTS.md) is authoritative for **how to work**.
- **Every fact has one home.** Other docs describe it in a line and link
  there — duplication drifts.

## Present tense; history lives in git

- Docs describe the project **as it is now**. The active future lives in
  plan issues on GitHub; the past lives in git — squash commits, PRs, and
  issues ([`spec-driven-development.md`](spec-driven-development.md)
  "Three tenses, three homes").
- A doc that has done its job is deleted, not moved to an archive folder.
  Superseded text is replaced, not struck through or annotated.
- **No process narration.** Docs don't reference chat sessions, "as
  discussed," or session links. How a change came to be belongs in its PR
  description, which becomes the commit body on `main`.

## Structure

- **Purpose line.** Every doc opens with a `# Title` and a one-line statement
  of what it's for.
- **Routing tables.** A doc that hands the reader off to others uses a table
  of link and "read when" — [`AGENTS.md`](../AGENTS.md) "Protocol docs" is the
  model. Point at another doc's table; don't copy it.
- **Stable rules apart from churn-prone detail.** Timeless rules don't embed
  what changes as the project grows (which tool enforces a rule, current
  status) — they point at where that lives.
- **Cite by name, not number.** Link docs relatively, and refer to sections
  by heading or stable ID (`INV-2`), never by a number that shifts.

## Keep in sync

- A change that alters observable behavior updates the affected docs **in the
  same PR**.
- When a shared term, identifier, or heading changes, every doc that names it
  changes in the same PR, with identical spelling.
- Where a doc can be checked against the code mechanically — a file map, a
  command list — prefer a check in `check` to good intentions
  ([`ci.md`](ci.md) "Enforcing project rules").

## Style

- Short, skimmable docs with links over long prose.
- Fenced code blocks for commands and payloads.

## Naming

- **Root meta-files** keep the open-source convention of `ALL-CAPS.md`:
  `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`, `AGENTS.md`,
  `CLAUDE.md`, `SPEC.md`.
- **Everything under `docs/`:** `kebab-case.md`. Spec areas, once the spec is
  split, are `docs/spec/<area>.md`.
- **Stable IDs** that docs cite, like invariants: a short uppercase prefix
  plus a number (`INV-3`). Never reuse or renumber one; retire it.
- **Branches, commits, and labels:** [`workflow.md`](workflow.md).

### Code

- **Identifiers are camelCase** (`camelcase` lint rule, an error);
  components are `PascalCase` in `PascalCase.jsx`; hooks are `useThing` in
  `useThing.js`; exported constant tables are `UPPER_SNAKE`
  (`MATCH_MODE_REGISTRY`).
- **Data keys are not code identifiers.** Tag paths, config keys, and rule
  addresses are lowercase and may be hyphenated (`hp-max`, `xp-lvl`), because
  they are user-facing data that must compose into tag strings and unquoted
  YAML keys. The lint rule ignores property names for this reason. This split
  is deliberate — don't "fix" it.
- **Full words.** Single-letter names are reserved for the conventional
  idioms `i v n a b e r _` (`id-length`, a warning). Index variables are
  `index` in named parameters and props, `i` only in short inline `.map()`
  callbacks, never `idx`. `_`-prefixed names mark intentionally unused values.
- **CSS classes are flat compound:** a block (`.agent-card`), its elements
  with single hyphens (`.agent-name`), states as a double-hyphen modifier
  applied as a second class (`.task-card--expanded`). No bare unnamespaced
  state classes; the only global classes are the utilities `.mono`,
  `.bright`, `.dim`, `.label`, `.value`, `.right`.
- **No formatter.** ESLint is lint-only, with no stylistic rules, because the
  code and stylesheet use deliberate column alignment.
- **Every export has a JSDoc comment** — purpose, parameters, return value,
  and side effects. JSDoc is the home for how a function works; the spec
  holds what the system does and never restates function mechanics. A gap or
  ambiguity in the code is noted in a comment where it lives, and undecided
  behavior goes in `SPEC.md` "Open questions".

## Doc audit

The docs are reconciled periodically, not continuously. An audit checks that:

- **the spec describes `main`** — no stale statements, no `Planned` marker
  whose plan issue is closed, no history (version annotations, amendment tables,
  past-tense narration);
- **only live documents exist** — nothing future-tense or finished lives as
  a file, and resolved open questions are gone from the spec;
- **status matches GitHub** — anything the docs report about what's built or
  what's next matches the actual issues, PRs, and milestones;
- **links resolve**, and cross-references use identical spelling;
- **`check` is the gate** — AGENTS.md "Commands" and `ci.yml` run the same
  command;
- **one home per fact** — no second copy of a rule that has quietly diverged;
- **no template leftovers** — no unfilled placeholders or unresolved guidance
  comments from adoption.

Any session may open a docs-only PR to fix drift it spots while working. A
broader pass is filed as its own docs issue. Doc fixes never ride along in an
unrelated code PR.
