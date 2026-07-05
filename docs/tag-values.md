# Tag Values & Registry Semantics (design — issue #104)

Status: **agreed direction, not yet implemented.** This document records the
comparison requested in issue #104 and the decided design. Implementation
work should update `docs/architecture.md` and `docs/api.md` and then fold the
durable parts of this document into them.

## Problem

The tag grammar (`src/logic/tags.js`) carries values as an explicit scalar
after `=` (`ability:str=14`), and the configurable UI elements (boxes, fields,
values — `src/logic/UI.js`) read only that `parsed.value`. But much of the
game data expresses value-like endpoints as tag *segments* instead:
`class:druid`, `slot:armor`. These work like values in the ruleset (they are
endpoints, one-per-category), and code already treats them that way ad hoc —
`getTagSub()` in `src/logic/dynamicAttributes.js` reads segment 2 of `class:`
as if it were a value.

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
3. **A registered leaf reads as the value.** A tag whose terminal segment is
   a registry **leaf** (no children) exposes that segment as its value when no
   explicit `=value` is present: `class:fighter` → value `fighter`,
   `slot:armor` → value `armor`. An explicit `=value` always wins
   (`skill:arcana=3` → value `3`, `arcana` stays a segment).

This resolves the bifurcation without migrating data or changing the registry
format: **closed categories are categories whose preset values are registered
as leaf children; open categories carry unregistered `=value` scalars.** The
two idioms stop being an inconsistency and become the two declared modes.

### Code shape

- `parseTag()` stays purely syntactic (`{ modifier, segments, value }`).
- A new accessor — e.g. `getTagValue(tagString, registry)` in
  `src/logic/tags.js` — applies rule 3: explicit value if present, else the
  terminal segment when it is a registered leaf, else `null`. Consumers opt
  in (UI value readers, `dynamicAttributes.js`), so registry insertion,
  matching, serialization, and usage counts are untouched by default.
- `getTagSub()` in `dynamicAttributes.js` becomes a call site of the shared
  accessor and is pruned.
- UI tag-value sources (`src/logic/UI.js`) keep their numeric contract:
  a non-numeric derived value (e.g. `fighter`) is not a displayable number
  and resolves invalid exactly as a missing `=value` does today. Non-numeric
  values matter to matching (below), not to numeric card elements.

### Value comparisons — conditions only (first pass)

Condition tag links (`tracker.tagPath`, `src/logic/conditions.js`) gain a
value term with comparison operators: `=`, `>=`, `<=`, `>`, `<`.

- Draft grammar extends `path[=target]` to `path[op value][=target]` — e.g.
  `skill:arcana>=3=30` is a condition targeting 30 progress, linked to agents
  whose Arcana is at least 3. The exact draft syntax is an implementation
  detail; the engine-level term is `{ path, op, value }`.
- Matching semantics: the pattern's path matches as today (open mode); the
  value term then compares against the tag's **derived value** (rule 3), so
  `class=druid` matches `class:druid` (registered leaf) and a hypothetical
  `class=druid` alike. Equality is case-insensitive string comparison;
  ordered operators compare numerically and fail (contribute 0 / no match)
  when either side is non-numeric.
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
> that is in use as a value.

> ⚠️ **Needs clarification:** whether a tag may end on a *non-leaf* registry
> node (e.g. bare `skill`) and what `getTagValue` returns there — current
> assumption: `null` (structural reference, no value).

> ⚠️ **Naming:** "registry-bounded values" is this document's working name
> for the rule set; pick a final term when folding into `architecture.md`.
