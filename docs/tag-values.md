# Tag Values & Registry Semantics (design — issue #104)

Status: **implemented.** This document records the comparison requested in
issue #104 and the decided design; it is kept as the design record. The
durable rules live in `docs/architecture.md` → Tag-based Attribute System and
Task Conditions; the API surface (`src/logic/tagValues.js`,
`VALUE_COMPARE_REGISTRY` / `matchTagValue`, the condition `compare` term and
draft grammar) is documented in `docs/api.md`; behavioral gotchas in
`docs/gotchas.md` → Tag Grammar / Conditions.

## Problem

The tag grammar (`src/logic/tags.js`) carries values as an explicit scalar
after `=` (`ability:str=14`), and the configurable UI elements (boxes, fields,
values — `src/logic/UI.js`) read only that `parsed.value`. But much of the
game data expresses value-like endpoints as tag *segments* instead:
`class:druid`, `slot:armor`. These work like values in the ruleset (they are
endpoints, one-per-category), and code already treated them that way ad hoc —
`getTagSub()` in the since-retired `dynamicAttributes.js` (hard-coded stats,
replaced by user-authored `dyn,` tags — see `docs/architecture.md` → Dynamic
Tags) read segment 2 of `class:` as if it were a value.

Two idioms exist because two kinds of category exist:

- **Closed categories** (`class:`, `slot:`) have a preset value list defined
  by the ruleset — { druid, fighter, sorcerer, … } — which is useful to hold
  in the tag registry so authoring can offer it.
- **Open categories** (`favorite-color=FFAA00`, `ability:str=14`) accept
  arbitrary scalars that the registry could never enumerate.

The registry (`src/logic/tagRegistry.js`) is deliberately **keys-only** — its
validator rejects values and lists — so it can hold closed-category presets
only by storing them as child keys, which blurs whether a key is structure or
a value.

## Approaches considered

### A. Last-element-as-value (chosen, refined below)

A read-time rule: when a tag carries no explicit `=value`, its terminal
element is interpreted as the value. `class:fighter` reads as
`class = fighter`.

- **Pros:** no data migration; no registry format change; the keys-only YAML
  model and its validator survive untouched; closed-category presets are
  simply the registered children of the category node.
- **Cons (naive form):** ambiguous — nothing distinguishes `class:fighter`
  ("fighter is a value") from `bind:armor:item:shield` (pure structural
  path). Resolved by the registry-bounded refinement below.

### B. Registry value lists

Registry nodes gain preset value lists (`class: [druid, fighter, …]`);
stored tags migrate to `class=druid` form.

- **Pros:** cleanest formal semantics — structure and value are syntactically
  distinct everywhere.
- **Cons:** breaks the keys-only model, the security validator, and the YAML
  round-trip; requires migrating every stored tag and auditing every consumer
  (`getTagSub`, matching, usage counts, condition links); the registry stops
  being a pure structure skeleton. Highest blast radius for a distinction the
  read rule in A can express without any of it.

### C. Enum-flag metadata on registry nodes

Keep storing `class:fighter` as segments, but mark `class` as a closed
category whose children are its value set.

- **Pros:** no tag migration; matching untouched; explicit open/closed
  declaration per category.
- **Cons:** introduces node metadata into a tree that is currently pure keys,
  so the validator and YAML format still change; the flag duplicates
  information the tree shape already implies (a category's children *are*
  its presets). Superseded by A once A is registry-bounded.

### D. Typed per-node schema

Registry nodes declare a value type — `enum(list)`, `string`, `number`,
`none`. Most expressive; subsumes B and C.

- **Cons:** the most machinery to build, validate, and configure, for
  expressiveness no current feature needs. Deferred; the chosen design leaves
  room for it (a schema layer could later annotate the same keys-only tree
  from a sidecar rather than inside it).

## Decision: registry-bounded values

Approach A, made unambiguous by making the registry the boundary between
structure and value. Three rules:

1. **Every segment in a tag string is registered — by definition.** Tag
   authoring flows through the Tag Registry modal (already the single
   authoring/assignment surface), so a tag string containing an unregistered
   segment cannot exist. Authoring a new endpoint *is* a registry edit:
   presets are suggested, free-typed endpoints are accepted and registered
   ("suggest, don't block").
2. **Values are unregistered — by definition.** An explicit `=value` scalar
   is never added to the registry (`addTagToRegistry` already strips values
   today). Open categories live entirely in `=value`.
3. **A registered leaf carries an implied value, resolved per use case.** A
   tag whose terminal segment is a registry **leaf** (no children) and has no
   explicit `=value` is not valueless — it has a default, implied value whose
   meaning depends on who is asking:
   - for **matching**, the implied value is `true` (presence);
   - for **UI display**, the implied value is the leaf segment string itself
     (`class:fighter` → `fighter`, `slot:armor` → `armor`);
   - other purposes may define other defaults.

   An explicit `=value` always wins (`skill:arcana=3` → value `3`, `arcana`
   stays a segment). Implied defaults are **not** defined in the registry or
   the data schema — they live in the parsing function chosen for the
   specific use case (see "Value resolvers" below), so the registry stays a
   pure structure skeleton and new use cases add a resolver, not a schema
   field.

This resolves the bifurcation without migrating data or changing the registry
format: **closed categories are categories whose preset values are registered
as leaf children; open categories carry unregistered `=value` scalars.** The
two idioms stop being an inconsistency and become the two declared modes.

### Code shape: value resolvers, a parsing utility library

- `parseTag()` stays purely syntactic (`{ modifier, segments, value }`).
- Rule 3 is implemented as a **library of reusable parsing utilities** —
  interchangeable attachments for a multi-use tool — rather than one
  accessor. A resolver registry (working name `VALUE_RESOLVER_REGISTRY`,
  e.g. in a new `src/logic/tagValues.js`) maps a use case to a function
  `(parsedTag, registry) → value`, mirroring the codebase's established
  plug-in pattern (`MATCH_MODE_REGISTRY`, `TRACKER_REGISTRY`,
  `MODIFIER_REGISTRY`). Initial attachments:
  - `match` — explicit value if present, else `true` for a leaf-terminal
    tag (presence);
  - `display` — explicit value if present, else the leaf segment string;
  - `numeric` — explicit value coerced through `Number`, else invalid
    (the UI card-element contract; a leaf string like `fighter` is not a
    displayable number and resolves invalid exactly as a missing `=value`
    does today).

  Each resolver owns its own default; adding a use case means adding an
  attachment, never a registry or data-schema change.
- The library also hosts the shared registry-reading supports these
  attachments compose from — e.g. leaf tests and category/preset lookups
  built on `pathExists` — and may read the **config registry** as well as
  the tag registry where a use case's defaults are config-driven (e.g.
  card slots in `config/UI.yml`).
- `getTagSub()` in `dynamicAttributes.js` becomes a call site of the
  `display` resolver and is pruned. (The whole module has since been retired
  in favor of `dyn,` expression tags — `src/logic/dynamicTags.js`.)

### Value comparisons — conditions only (first pass)

Condition tag links (`tracker.tagPath`, `src/logic/conditions.js`) gain a
value term with comparison operators: `=`, `>=`, `<=`, `>`, `<`.

- Draft grammar extends `path[=target]` to `path[op value][=target]` — e.g.
  `skill:arcana>=3=30` is a condition targeting 30 progress, linked to agents
  whose Arcana is at least 3. The exact draft syntax is an implementation
  detail; the engine-level term is `{ path, op, value }`.
- Matching semantics: the pattern's path matches as today (open mode); the
  value term then compares against the tag's value as resolved by a
  value-resolver attachment. Equality is case-insensitive string comparison;
  ordered operators compare numerically and fail (contribute 0 / no match)
  when either side is non-numeric.

  **Resolved:** equality (and every comparison) reads the tag side through
  the **display** resolver, so `class==druid` equals the leaf string `druid`.
  Presence testing stays the job of plain path patterns. Ordered operators
  compare numerically and fail closed on non-numeric sides.
- The value term is a property of the pattern engine
  (`src/logic/tagMatching.js`), added alongside `MATCH_MODE_REGISTRY` so
  future consumers (Req/Block requirements) can adopt it later without a
  second grammar — but only conditions wire it up in the first pass.

### Consequences for existing behavior

- **Reducer auto-registration** (`registerTags()` in `src/state/reducer.js`)
  is already consistent with rules 1–2: it registers full segment paths and
  never values. No change needed — its meaning is simply reframed: it is the
  "free-typed endpoints get registered" half of suggest-don't-block.
- **Seed registry** (`TAG_REGISTRY` in `src/logic/tags.js`): unchanged.
  `class`, `race`, `trait` etc. are childless seeds whose leaf children
  accumulate as presets through play or ruleset YAML.
- **Matching, usage counts, YAML I/O, validator:** unchanged.

## Rejected / deferred

- **B (registry value lists)** — rejected: highest blast radius, breaks the
  keys-only invariant that the validator and the closed/config-mode YAML
  export depend on, and rule 3 achieves the same expressiveness for free.
- **C (enum flags)** — superseded: the tree shape already encodes it.
- **D (typed schema)** — deferred until a feature needs declared value types;
  compatible as a future sidecar annotation.
- **Strict enforcement** (closed categories rejecting unregistered endpoints)
  — deferred; authoring is suggest-don't-block for now. A future ruleset
  "closed mode" could flip enforcement without changing the data model.
- **Operator matching in Req/Block requirements** — deferred follow-up; the
  engine-level value term is designed to be shared when it lands.

## Open questions

> ⚠️ **Needs clarification:** rule 3 keys off *leaf* status, so a preset that
> later gains children (e.g. `class:druid` growing
> `class:druid:circle-of-the-moon`) silently stops reading as a value for
> existing `class:druid` tags. Options when it arises: read the terminal
> segment as value whenever it is the tag's last segment regardless of
> children, or warn in the registry editor when adding children under a leaf
> that is in use as a value. (Also flagged in `docs/gotchas.md` → Tag Grammar.)

**Resolved — non-leaf terminals:** a tag ending on a registered non-leaf node
(e.g. bare `skill`) is a structural reference; the display resolver returns
`null`. The rule is **strict** — no registry supplied or an unregistered
terminal also resolve `null` (no positional fallback; legacy saves whose tags
predate registration are abandoned by design). The registry walk supports
(`getRegistryNode`, `isRegisteredLeaf`) live in the parsing library and are
called by the resolvers.

**Resolved — naming:** "registry-bounded values" is the adopted term, used in
`architecture.md`.
