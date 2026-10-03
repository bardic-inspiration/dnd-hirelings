# Tags

The tag grammar, the tag registry, how tags carry values, how patterns match
them, and dynamic tags computed from the rules registry. Part of
[`SPEC.md`](../../SPEC.md).

## Grammar

Every property of an agent, task, or item is a tag string:

```
[modifier,]segment[:segment...][=value]

skill:arcana=3            plain tag — Arcana 3
req,skill:arcana=2        task requires Arcana ≥ 2
block,trait:undead        task refuses undead agents
bonus,ability:str=2       item grants +2 STR while bound
dyn,ac=14                 computed armor class (see Dynamic tags)
bind:weapon:item:sword    activity — Sword bound in the weapon slot
task:abc1234              activity — assigned to task abc1234
```

- **Value:** everything after the **first** `=`, opaque — it may contain `:`,
  `,`, spaces, and operators. A path never contains `=`.
- **Modifier:** the token before a comma, recognized only when the comma
  precedes the first `=`. It is always `mod,path`, never `mod:path` (a colon
  would make it a segment).
- **Segments:** the `:`-separated path. `parseTag` drops empty segments, so
  `skill:` parses like `skill`.
- **Identity** is modifier + path. Merging a tag into a list
  (`mergeAttribute`) replaces any tag with the same identity; the incoming
  value wins.
- **One codec** (`INV-2`): `parseTag` / `buildTag` in `src/logic/tags.js`.
- **Legacy forms normalize on load and on preset import:** a colon-joined
  modifier becomes a comma, and a leading `#` sigil is stripped
  (`#skill:x` → `skill:x`).

### Modifiers

| Modifier | Meaning | On a task, routes to |
|---|---|---|
| `req` | The counterpart must carry this (value compared ≥). | `requirements` |
| `block` | The counterpart must not carry this. | `requirements` |
| `bonus` | Adds its value to the matching agent tag while the item is bound. | `attributes` |
| `dyn` | Value computed from a rule ([Dynamic tags](#dynamic-tags)). | `attributes` |

Modifiers live in `MODIFIER_REGISTRY`; a modifier's `taskField` decides where
a tag applied to a task goes. Unmodified tags go to `attributes`.

### Attributes and activities

Agents carry two tag lists:

- **`attributes`** — authored properties: abilities, skills, class, traits,
  stat values (`xp=3200`, `hp=12`, `hitdie=5`), dynamic markers.
- **`activities`** — runtime state: `task:<id>` (assignment),
  `item:<name>=<qty>` (bag contents), `bind:[<slot>:]item:<name>` (bound items).

Requirement checks read both lists together, so an assignment tag
`task:<id>` can satisfy `req,task:<id>`.

## The tag registry

`state.tagRegistry` is a keys-only tree (`{ [key]: TagRegistry }`, a leaf is
`{}`) — the live store of every tag path in play and every path the ruleset
allows. A fresh session is seeded with:

| Namespace | Children |
|---|---|
| `ability` | `str dex con int wis cha` |
| `skill` | the 18 skills, lowercase, no spaces (`animalhandling`, `sleightofhand`, …) |
| `task`, `tool`, `trait`, `class`, `race`, `level`, `item`, `bind` | none (structure only) |
| stat addresses | `ac pb hitdie hp hp-max xp xp-lvl xp-lvl-max` (flat, hyphenated, so they double as rule keys) |

**Registration.** Paths enter the registry when tags are authored
(`TAG_APPLY`, `TASK_CONDITION_ADD`) and when entities are created from presets
(`AGENT_CREATE`, `TASK_CREATE`, `INVENTORY_ADD`). Values are never registered.
Dynamic instance tags (`task:…`, `bind:…`) are never registered or validated.
Duplicating an entity registers nothing.

**Locked mode.** `public/config/tags.yml` `locked: true` makes the three
create actions refuse any entity carrying a tag the registry doesn't allow;
`locked: false` (the default) registers such tags instead.

- Literal tags validate on their path with the modifier and value stripped
  (`req,skill:sword=1` → `skill:sword`); a condition's pattern link must match
  at least one registered path.
- The library checks a whole order before dispatching any of it and alerts
  the offending tags; the reducer repeats the check as a silent backstop. Both
  call `unregisteredEntityTags`, so they cannot disagree. Why: the order
  dispatches per line, so a mid-order reducer refusal would half-fill the cart.
- The reducer can't read config, so each create action carries `locked` from
  `useTagsConfig()`. An action without the field is treated as unlocked. Until
  the tags config has loaded, the hook reports unlocked.
- Duplicates (`AGENT_DUPLICATE`, `TASK_DUPLICATE`) are exempt. Why: their tags
  are already in play; blocking the copy would declare the board invalid.
- Bundled presets carry tags outside the seed registry (`skill:sword`,
  `rarity:common`), so a locked fresh session refuses them until those paths
  are registered.
- `Planned (#117):` tag-writing task actions pass through the same check
  ([`task-engine.md`](task-engine.md) "Actions").

**File I/O.** The registry exports to and imports from YAML (Tag Registry
modal SAVE / LOAD). Import validates before replacing: it rejects non-map
values, invalid key characters, and duplicate keys.

## Implied values

The registry is the boundary between structure and value:

1. **Every segment of a tag is a registered path.** Authoring goes through the
   Tag Registry modal, and a free-typed path is registered when applied.
2. **Explicit `=value` scalars are never registered.** Open categories
   (`ability:str=14`, `favorite-color=FFAA00`) live entirely in `=value`.
3. **A tag ending on a registered leaf carries an implied value**, whose
   meaning depends on the reader. Closed categories (`class:fighter`) are
   categories whose preset values are registered leaf children.

Readers resolve values through `resolveTagValue(useCase, parsedTag, registry)`
(`VALUE_RESOLVER_REGISTRY`), never ad hoc:

| Use case | Explicit `=value` | Ends on a registered leaf, no `=` | Otherwise |
|---|---|---|---|
| `match` | the value | `true` | `true` |
| `display` | the value | the last segment (`class:fighter` → `fighter`) | `null` |
| `numeric` | `Number(value)` if finite, else `null` | `null` | `null` |

The `display` read is strict: no registry, an unregistered terminal, or a
registered non-leaf all resolve `null`. Why: putting value lists in the
registry would break its keys-only YAML format and validator; implied values
give closed categories for free. A new use case adds a resolver, never a
registry or schema change.

## Pattern matching

Condition links and the Tag Registry modal's search match a **pattern** path
against a tag's segments (`matchTagPath`, `src/logic/tagMatching.js`):

| Mode | Rule |
|---|---|
| `exact` (default) | Same segment count; every segment matches pairwise. |
| `numbered` | Only the first `depth` segments compare; default depth is the pattern's length (prefix match). |
| `open` | Glob alignment: `*` passes exactly one segment, `**` passes zero or more. |

- **Wildcards and escapes exist only in patterns.** Tag segments are always
  literal, so a tag containing `*` is never read as a wildcard. In a pattern,
  `\*`, `\:`, and `\\` are a literal asterisk, colon, and backslash;
  `escapePatternSegment()` builds a literal segment from arbitrary text.
  Wildcards are recognized before unescaping, so `\*` never becomes a pass.
- `**` matches zero segments too: `tag:**:potato` matches `tag:potato`. To
  require one, write `tag:*:**:potato`.
- In `exact` and `numbered`, `**` degrades to a single-segment pass.
- Condition links use `open`, which equals `exact` for wildcard-free patterns:
  `skill` does not match `skill:arcana`; `skill:*` matches any one skill;
  `skill:**` the whole subtree. Modifier-bearing tags never match a link.
- Requirement checks (`tagMatches` in `tags.js`) are literal-only. Why:
  requirement tags embed user text such as item names, which must never
  wildcard.

**Value comparison.** A link may carry a `compare: { op, value }` term
(`VALUE_COMPARE_REGISTRY`, `matchTagValue`), tested against each
path-matched tag's `display`-resolved value inside the match search — so a
wildcard link selects the first tag that qualifies.

| Operator | Test |
|---|---|
| `==` | Case-insensitive string equality. |
| `>=` `<=` `>` `<` | Numeric; **fails closed** when either side is non-numeric (`fighter` never passes `>= 3`). |

There is no `!=`. Compare values are never registered.

## Dynamic tags

A dynamic tag is a dependent variable. The object carries a `dyn,<address>`
**marker**; the **rules registry** holds the expression for that address; the
app **materializes** the computed total into the tag's value
(`dyn,ac=14`), in state and in saves.

- **Rules** live in `public/config/rules.yml` under `dynamic:`, mapping a flat
  address to an expression wrapped in a `"[…]"` envelope. The envelope is
  required and the string must be quoted in raw YAML. Why: unquoted `[` and
  `{` are YAML flow syntax and fail to parse. Future rule kinds become sibling
  sections of `dynamic:`.
- **Expression grammar** (`src/logic/expressions.js`): numbers;
  `+ - * / %`; parentheses; `floor ceil round sqrt min max`; brace-wrapped
  references. A bare identifier is a parse error unless it is a function call.
  Results keep decimals; round explicitly. Parsing never throws (it returns
  `{ ast, error }`).
- **References:** `{addr}` reads the object's **static** tag value at the
  address — never the dynamic total. `{dyn,addr}` reads the dynamic total.
  Wildcards (`{class:*}`, `{dyn,class:*}`) sum the numeric matches in their
  scope; a valueless leaf like `class:fighter` contributes nothing.
- **Total** = expression result + the object's **effective** static value at
  the same address. Bound items' `bonus,` tags fold into plain tags first, so
  a `dyn,ac` rule, a plain `ac=2`, and an equipped `bonus,ac=1` all add.
- **Failure modes.** A marker whose address has no rule, or a rule that fails
  to parse, is **invalid**: its payload is stripped to the bare marker and the
  UI shows the invalid state. A missing or non-numeric reference, a
  `{dyn,…}` cycle, zero numeric wildcard matches, or a non-finite result each
  default to `1` with a warning. Warnings are derived on read, never stored.
- **Reconciliation.** `DYN_RECONCILE` (dispatched by `useDynReconcile` after
  any state or rules change) rewrites every stale payload across agents,
  items, and tasks. It returns the same state reference when nothing changed.
  Why: the hook re-runs on every state change, so a fresh object each time
  would loop forever.
- **Matching and editing.** Payloads are ordinary numeric values, so
  `req,ac=12` is satisfied by `dyn,ac=14`. Computed values are read-only in
  the UI; edit the input tags or the rule. A payload typed on a `dyn,` draft is
  meaningless (the registry modal warns) and is overwritten on the next pass.
- `xp`, `hp`, and `hitdie` are plain valued tags. A class's hit-die bonus is
  authored per agent as `hitdie=<n>`. Why: wildcard references sum only numeric
  values, so a rule can't switch on a class name.

The reference ruleset shipped in `public/config/rules.yml`:

```yaml
dynamic:
  level: "[max(1, floor(0.5*(1+sqrt(1+{xp}/125))))]"
  pb: "[2+floor(({dyn,level}-1)/4)]"
  ac: "[10+floor(({ability:dex}-10)/2)]"
  hp-max: "[max(1, 10+(5+{hitdie}+floor(({ability:con}-10)/2))*{dyn,level})]"
  xp-lvl: "[{xp}-125*((2*{dyn,level}-1)*(2*{dyn,level}-1)-1)]"
  xp-lvl-max: "[125*((2*{dyn,level}+1)*(2*{dyn,level}+1)-1)-125*((2*{dyn,level}-1)*(2*{dyn,level}-1)-1)]"
```

`Planned (#117):` the expression grammar gains comparisons, booleans, and
dice; the dynamic-tag path never rolls dice
([`task-engine.md`](task-engine.md) "Expressions").
