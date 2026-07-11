# Gotchas

Non-obvious behaviors, known edge cases, and things that will surprise a developer reading this code for the first time.

---

## Tag Grammar is the Core Abstraction

The entire data model for agent abilities, task requirements, item bonuses, and bound items is encoded in tag strings. If you touch anything that reads or writes attributes/activities/requirements arrays, you must go through `parseTag` / `buildTag` — never manipulate these strings with raw string operations. (Task progress is the exception: a condition's `tracker.tagPath` is a tag *path* that references the registry, not a stored tag — see Conditions below.)

The grammar:

```
[modifier,]segment[:segment...][=value]
```

- The **modifier** (`req`, `block`, `bonus`, `dyn`) is separated from the content path by a comma, not a colon. This tripped up older code that used a colon and is what the migration in `normalizeState` → `migrateTag()` fixes. `migrateTag()` also strips the legacy `#` sigil (`#skill:x` → `skill:x`); it is applied both to loaded state and to preset tags on import (`constants/libraries.jsx`), so a legacy sigil never reaches the display. A comma only splits a modifier when it precedes the first `=` — commas after `=` belong to the value.
- **Segments** form a path. The full path is the identity key for deduplication (`mergeAttribute` replaces any tag with the same modifier + path).
- The **value** is everything after the first `=` and is opaque — it may contain `:`, `,`, spaces, and operators. The path can never contain `=`.
- `bind:[<slot>:]item:<name>` and `task:<id>` tags live in `activities`, not `attributes`. Don't look for them in `attributes`.
- **A tag without `=value` is not valueless.** Under registry-bounded values (`docs/tag-values.md`, `src/logic/tagValues.js`), a tag ending on a registered leaf carries an implied value that varies by use case: `true` for matching, the terminal segment string for display (`class:fighter` → `fighter`), nothing for numeric card elements. Read values through `resolveTagValue(useCase, parsedTag, registry)` — never re-derive them ad hoc. The display read is **strict**: no registry in reach, an unregistered terminal, or a registered non-leaf all resolve `null`. Note the resolver reads the **last** segment; the retired `getTagSub` read segment 2 — identical for two-segment tags, divergent for deeper paths.

> ⚠️ **Needs clarification:** rule 3 keys off *leaf* status, so registering children under a preset in use (e.g. `class:druid` gaining `class:druid:circle`) silently flips existing `class:druid` tags from value to structure (display resolves `null`). Options when it bites: warn in the registry editor, or relax the read for a tag's terminal segment. See the same flag in `docs/tag-values.md`.

---

## Dynamic Tags (`dyn,`) — Rules and Materialization

Full design in `docs/architecture.md` → Dynamic Tags; the traps:

- **The expression is not in the tag.** An object carries a bare `dyn,<address>` marker; the governing expression lives in the rules registry (`public/config/rules.yml` → Config Modal RULES). The tag's payload is the *materialized computed total* (`dyn,ac=14`), rewritten by the reconciler — never hand-authored. Typing a payload on a `dyn,` draft is meaningless (the registry modal soft-warns); the reconciler overwrites it on the next pass.
- **Rule expressions must be brace-wrapped AND bracket-enveloped, quoted in raw YAML.** In `rules.yml` an entry is `ac: "[10+floor(({ability:dex}-10)/2)]"`. Unquoted `[…{…}…]` is a YAML flow-collection parse error (`[` opens a sequence, `{` a mapping); `normalizeRulesConfig` also rejects a missing `[…]` envelope. Inside the expression, references are brace-wrapped (`{ability:dex}`); a bare identifier is a parse error unless it is a function call (`floor(…)`).
- **Reference scope is strict.** `{addr}` reads STATIC tags only — a marker-only address (`dyn,level` with no plain `level`) makes `{level}` default to 1 + warning, it does NOT fall back to the dynamic total. Use `{dyn,addr}` to read the computed total. This is why the canonical rules reference `{dyn,level}`, not `{level}`.
- **Missing/broken rule ⇒ invalid, not defaulted.** A marker whose address has no rule (renamed, deleted, never authored) or an unparseable rule has *no value*: the payload is stripped to a bare marker, the card element renders `--invalid`, and the registry row flags. Distinct from a defaulted *reference*, which is worth 1.
- **Wildcard refs sum only numeric matches.** `{class:*}` over a valueless leaf tag (`class:fighter`) contributes nothing; zero numeric matches default the whole ref to 1 + warning. This is why the canonical HP rule reads a plain `hitdie=<n>` tag instead of switching on the class name.
- **Same-address static values add** to the rule's result (`dyn,ac` rule `[8+{ability:dex}]` + a plain `ac=2` + an equipped `bonus,ac=1` → total 14) — this is how bound-item `bonus,` tags reach computed stats. Consequence: when the address is consumed by a configured card element, the plain part is uneditable from the card (dyn elements are read-only); edit it via the registry modal or unconsume the address.
- **Materialized payloads ARE matchable.** `req,ac=12` is satisfied by `dyn,ac=14` (payloads are ordinary numeric values now). The earlier "computed values are invisible to matching" gap is closed.
- Old saves were abandoned at the `dnd-hirelings-state-v6` key bump (agent `xp`/`hp` fields became valued tags); there is no further bump for the rules revision — stale dev-save payloads (from the earlier expression-in-payload format) are simply overwritten by the reconciler on load.

---

## `activities` vs `attributes`

These are two separate arrays on every agent:

- `attributes` — authored properties: skills, abilities, class, race, traits, items the agent permanently "has" in a data sense.
- `activities` — runtime state: current task assignments (`task:<id>`), items in the bag (`item:<name>=qty`), bound items (`bind:[<slot>:]item:<name>`).

Several functions (`validateAssignment`, `isAttributeActive`) merge both arrays together when checking requirements, because a task assignment (`task:<id>`) is itself a matching tag that may satisfy a requirement like `req,task:<id>`.

---

## Assign vs Bind (and Slots)

Two distinct, deliberately separated concepts operate on items:

- **Assign** — an item is allocated *to an agent* (the give / transfer / sell / return flow via `ITEM_PLACE` and `AGENT_RETURN_ITEM`). On an agent card, **left-clicking** a bag item returns it to global inventory and re-selects it, arming the existing allocation flow (other agents become transfer targets, the bank a sell target).
- **Bind** — an item is bound *to a Slot* inside the agent (`AGENT_BIND_ITEM` / `AGENT_UNBIND_ITEM`, stored as `bind:[<slot>:]item:<name>` activity tags, read by `getBoundItems`). On an agent card, **right-clicking** a bag item binds it; right-clicking a bound chip unbinds it.

**Slot is optional.** `bind:item:<name>` has no slot; `bind:<slot>:item:<name>` is slotted. `getBoundItems` parses both, returning `slot: null` for the former.

**Slot names come from config, not the tag registry.** A card's bind slots are listed under `cards.<card>.slots` in `config/UI.yml` (issue #84); the tag registry's `bind` node is an empty structure skeleton. Binding fills the first unoccupied configured slot (`firstFreeSlot(cardConfig.slots, boundItems)`); when a card defines no slots, or all are full, the item binds without one.

> ⚠️ **Needs clarification:** slot assignment is currently **positional** — the first free slot in config order — with no notion of which item *type* a slot accepts (a shield could land in `weapon`). A per-slot **acceptance schema** (which items each slot allows) is not yet implemented; when it lands, `firstFreeSlot` should be replaced by a type-aware chooser in `AgentCard`'s bind handler.

---

## Conditions

Task progress lives in `task.conditions` — structured objects, **not** tags (the legacy `work:*` tag namespace is gone, and `normalizeState` prunes it from stored tag registries). Each condition tracks its own `progress` toward a `target`; a task completes only when *every* condition is satisfied. Conditions are keyed by `id`, and two conditions track independently — overshooting one cannot satisfy a deficit in another.

Per-tick accrual dispatches through `TRACKER_REGISTRY` in `src/logic/conditions.js` by `tracker.kind`. This is the extension point for future progress logic (event-driven, rule-based); the clock loop never special-cases a kind.

The only current kind, `'work'`, gates and modulates by `tracker.tagPath`:

- **Matching is exact unless the pattern says otherwise** (the engine's `open` mode — see Tag-Path Match Modes below). A wildcard-free `tagPath: 'skill:arcana'` matches only an agent attribute whose full segment path is `skill:arcana` — a `tagPath: 'skill'` is *not* satisfied by `skill:arcana` tags, only by a literal `skill` tag. Wildcards widen the link explicitly: `'skill:*'` matches any specific skill, `'skill:**'` the whole skill subtree. Modifier-bearing tags (`req,…`) never match.
- A tracker's optional `compare: { op, value }` term gates the match on the tag's **display-resolved value** (`resolveTagValue('display', …)`): `==` is case-insensitive string equality; `>=`/`<=`/`>`/`<` compare numerically and **fail closed** when either side is non-numeric (a leaf string like `fighter` never passes `>= 3`). The compare runs *inside* the match search, so a wildcard link selects the first *qualifying* tag among several path matches.
- **Draft spelling: bare equality is `==`, never `=`.** In the condition draft grammar `path[op value][=target]`, the **last `=` is always the completion target** — `skill:arcana>=3=30` means "Arcana ≥ 3, target 30"; `class==druid=30` means "class equals druid, target 30". Compare values are never registered (rule 2 of registry-bounded values).
- A matched tag **with** an explicit numeric value contributes `(workRate + value * skillBonus) * stepDays` — this applies to any value-bearing tag, not just skills. A matched tag **without** one contributes the base `workRate * stepDays` (leaf strings never become rate bonuses; the legacy work system treated a valueless skill as value 1 — conditions do not).
- No match → the agent contributes **0** to that condition (and flashes if it contributed to nothing on the task).
- `tagPath: null` → every assigned agent contributes the base rate.

A task with **zero conditions** carries an implied "clock advanced" condition: it completes at the end of any tick in which at least one eligible agent worked it. It never completes on its own.

Completion is evaluated once per tick inside `advanceTime` (plus the manual ✓ button) — a task that reaches its target mid-step completes on that tick and stops accruing work/wages for the rest of the step, and manually editing a condition's progress to ≥ target completes the task on the *next tick*, not instantly.

> ⚠️ **Needs clarification:** an agent can carry at most one attribute per exact path (`mergeAttribute` dedupes by path), so multi-match resolution is currently moot; if effective attributes ever stack duplicates (e.g. from bound-item bonuses), `workContribution`'s `.find` takes the first.

---

## Tag-Path Match Modes

`src/logic/tagMatching.js` is the engine for comparing a **pattern** path against a tag's segment path. Modes live in `MATCH_MODE_REGISTRY` (the extension point, like `TRACKER_REGISTRY`). Condition tag links match in `open` mode — which is behaviorally identical to `exact` for `**`-free patterns, so wildcard-free links still require full-path alignment.

The Tag Registry modal's search highlighting also runs on this engine: the builder input doubles as a pattern search with an implicit leading `**` (so `skill:*` highlights the children of any `skill` node, `**:fire` any key named `fire`). Pattern drafts never ADD — the ghost autocomplete stays quiet and Enter will not add the path, because `*` is not a valid registry key — but they can APPLY as condition tag links (condition mode, or the global open) when they match at least one registry path (`patternMatchesRegistry`).

---

## Locked Tags Gate Creation Only

`locked: true` in `public/config/tags.yml` makes the three create actions
(`AGENT_CREATE` / `TASK_CREATE` / `INVENTORY_ADD`) block entities carrying
tags the registry does not allow; unlocked (default) registers them on
creation. Nuances:

- **The flag rides on the action.** The reducer cannot read config, so
  dispatch sites attach `locked` from `useTagsConfig()`. A dispatch without
  the field behaves unlocked — the reducer gate is a backstop, not a source
  of truth for the mode.
- **The alert lives at the call site.** `LibraryModal.handleAdd` pre-checks
  the WHOLE order before dispatching anything (submitOrder dispatches per
  line — a mid-order reducer block would partially fill the cart) and alerts
  the offending tags. The reducer backstop no-ops silently.
- **Both sides call `unregisteredEntityTags`**, so pre-check and backstop
  cannot disagree. Literal tags validate on the stripped segment path
  (`req,skill:sword=1` → `skill:sword`); pattern condition links must match
  ≥1 registered path; dynamic instance tags (`task:…`, `bind:…`) are exempt
  from validation and registration.
- **Bundled presets can be blocked.** Stock preset files carry tags outside
  the seed registry (`skill:sword`, `rarity:common`), so a locked fresh
  session refuses them until the paths are registered — intended behavior
  for a locked ruleset.
- **Duplicates are exempt by design** (`AGENT_DUPLICATE` / `TASK_DUPLICATE`):
  their tags are already in play, so blocking the copy would assert the board
  itself is invalid. They also do not register — copying never launders
  legacy-unregistered tags into the registry.
- The `useTagsConfig` base fetch settles asynchronously; until then the hook
  reports the unlocked default. A user cannot realistically create an entity
  in that window, but tests driving the UI immediately after load can.

> ⚠️ **Needs clarification:** paths that bypass the gate entirely —
> task-result spawned agents (`applyResults` templates, committed via
> `APPLY_TICK`), free-form entity edits (`AGENT_UPDATE` / `TASK_UPDATE` /
> `INVENTORY_UPDATE_ITEM` can introduce new tags), and session load/import
> (`REPLACE_STATE` takes the save's registry as-is, reconciling nothing).
> Locked mode currently gates creation only; extend deliberately if the live-
> store invariant should become airtight.

---

## Tag Registry Modal: ADD Registers, APPLY Assigns

The registry modal (`TagRegistryModal.jsx`) is the only authoring surface — the old TagBuilder/ConditionBuilder modals are gone. Two distinct verbs share its input:

- **ADD** (Enter) mutates registry *structure* only: it never touches an agent, task, or item.
- **APPLY** assigns the draft to a destination and closes. Plain drafts just need a non-empty path — a path not yet in the registry is registered first (`registerDraftPath`), so a brand-new tag is defined and assigned in one action; condition mode turns the draft into a `ConditionTemplate` (`path=target`, target defaults to 1; a bare `=20` makes an "any agent" condition, registering nothing).

Destination resolution, in order: `onApply` callback (library preset drafts — the overlay gets `--elevated` z-200 to stack above the library's z-100) → `target` entity (dispatch) → **selection mode**.

Selection mode (App.jsx): `setPendingApply` arms a **capture-phase** document click listener. Capture matters — a valid hit calls `stopPropagation` + `preventDefault` *before* the card's own onClick, otherwise applying a tag to an agent would also fire task assignment. Cards are resolved via `closest('.agent-card, .task-card, .item-row')` + `data-id`; any other click (or ESC) cancels without stopping propagation, so global deselection still runs. Body carries `.tag-apply-mode` (+ `--conditions`) for hover affordances.

Routing is the entity's job, not the modal's: `TAG_APPLY` sends `req`/`block` tags to a task's `requirements` and everything else to `attributes` (`routeTaskTag`, driven by `MODIFIER_REGISTRY[modifier].taskField`); agents/items always dedupe-merge into `attributes`. Note the preserved asymmetry: task tag lists append (duplicates possible), agent/item attributes replace by path.

Because routing is by prefix, a task card carries a single `+ TAG` registry shortcut (in the attributes section, mirrored in the library's task preview); the requirements list has no add button of its own — a `req`/`block`-modified tag applied via `+ TAG` routes there.

- `exact` — same segment count, every segment matches pairwise.
- `numbered` — only the first `depth` segments are compared; the default depth is the pattern's length, which makes it prefix matching.
- `open` — glob alignment: `*` passes exactly one segment; `**` passes any run of segments. Suffix (`**:potato`) and contains (`**:vegetable:**`) matching fall out of this mode.

The asymmetry rule is the part that will surprise you: **wildcards and escapes exist only on the pattern side.** Tag segments are always literal text, so an agent tag that happens to contain an asterisk (user-derived names make this possible) is never misread as a wildcard. In a pattern, `\*` is a literal asterisk, `\:` a literal colon kept inside its segment, `\\` a literal backslash; `escapePatternSegment()` builds a safe literal segment from arbitrary text. Wildcards are recognized from the raw segment *before* unescaping, so `\*` can never be promoted to a pass.

Two deliberate semantics to know:

- `**` matches **zero or more** segments (glob convention): `tag:**:potato` also matches `tag:potato`. Require at least one segment with `tag:*:**:potato`.
- In the pairwise modes (`exact`, `numbered`) a `**` cannot expand and degrades to a single-segment pass.

`tagMatches` in `src/logic/tags.js` (requirement/assignment validation) predates this engine and stays **literal-only** on purpose: requirement tags embed arbitrary user text (item names), so they must never wildcard implicitly.

---

## Identical Inventory Items Auto-Stack (name + tags)

Two inventory rows are "the same item" when they share a case-insensitive **name** *and* the same **tag set** (order-insensitive) — same name with differing tags stays a separate row (issue #91). Whenever an item's identity could change, the reducer re-normalizes the whole inventory through `mergeInventoryByIdentity`, folding any later row into the first one it matches and summing quantities (the survivor keeps its other fields). This runs on `INVENTORY_ADD`, on `INVENTORY_UPDATE_ITEM` when `name` **or** `attributes` changed, on `INVENTORY_REMOVE_ATTRIBUTE`, and on `TAG_APPLY` to an item. Non-identity edits (quantity, value, description) skip the merge, and unnamed `NEW ITEM` placeholders never stack (so fresh blanks stay distinct until named).

> ⚠️ **The merge fires on *every* identity edit, not just when you finish.** Because it runs after each individual tag add/remove/value-edit and each rename, an item that becomes *momentarily* identical to another row merges at that instant — even if you were mid-way through editing it toward a different final state. Example: giving item A the same single tag another row already has will stack them immediately, before you add A's second, distinguishing tag. There is intentionally no debounce or explicit "merge duplicates" step; identical-means-identical is evaluated eagerly. If a workflow needs to pass through a transient duplicate, edit the distinguishing field first.

A related but separate pooling happens when `AGENT_DELETE` and `AGENT_RETURN_ITEM` return held items: those match by **name only** (bag items carry no tags), summing into an existing row rather than creating a duplicate. This predates the identity merge and is deliberately name-based, so returning a tagless "ROPE" pools into an existing "ROPE" regardless of its tags.

---

## Clock Display Uses Direct DOM Writes

Task progress bars in `ProgressSection` are updated directly via `document.querySelector` inside `updateClockDisplayDOM()`, called from the RAF loop in `usePlayClock`. React does not control these DOM mutations between ticks. The year/day clock display is **not** interpolated — one tick is one day, so it advances via React on each committed tick.

This means:
- The elements must exist in the DOM when the RAF fires (they do, because they render before play starts).
- React will overwrite these styles on the next full render. Progress bars use inline `style.width` set by both React (on tick) and the RAF loop (between ticks); the RAF interpolates toward the tick's already-applied value, so no flicker occurs in practice.
- Condition rows are addressed by `[data-task-id][data-condition-id]` selectors on `.condition-item-bar-fill` and `.condition-item-progress`.
- `updateClockDisplayDOM` guards against writing to focused elements: `if (document.activeElement !== el) el.textContent = val`. The condition progress number is a click-to-edit `EditableSpan`, so this guard is what keeps the RAF loop from clobbering an edit in progress. Do not remove it.

---

## Asset Loading Never Blocks or Interrupts the App

There is **no** global asset gate. The theme background is a decorative CSS background (`--bg-image`), applied by the `index.html` bootstrap script before React mounts and `<link rel="preload">`-ed there too, so it downloads immediately and paints over the solid `--bg` fill as it arrives. The app is fully interactive underneath the whole time.

This replaced an earlier full-screen "LOADING" overlay (an `AssetProvider` gated on the background via `useRegisterAssets`). Issue #81 had already stopped that overlay from *unmounting* the tree — but because assets register from post-mount effects, the overlay still popped up *after* first paint and covered already-rendered UI (including an open modal), reading as a spurious page refresh mid-session. Gating first paint on a purely decorative image was the wrong trade, so the gate (`AssetContext` / `useRegisterAssets`) was removed entirely (issue #90). Do not reintroduce a blocking overlay for decorative assets.

Modal pickers still preload their own thumbnails via `useAssetGroup` — purely local per-image state that reveals each thumbnail as it settles and never blocks the surrounding app. Reach for it (not a global gate) if a future surface needs to preload images.

---

## Modal Open State Persists Across Refresh (per-modal toggle)

Every modal goes through one hook — `useModal(name)` in `UIContext` — which mirrors its open state to localStorage (the shared `dnd-hirelings-open-modals-v1` map) and rehydrates it on mount, so a refresh reopens whatever was open (issue #81). Persistence is **per component**: flip the modal's entry in `MODAL_PERSISTENCE` to enable/disable it.

Two guards keep this safe:
- **Callback props are never persisted.** A modal opened with a live function — the portrait/icon pickers' `onSelect`, or the tag registry's `onApply` from a library draft — can't be restored (the callback is gone after a reload), so `isPersistableProps` treats it as ephemeral even if the modal is persistence-enabled. The pickers are also set `false` in `MODAL_PERSISTENCE` to make the intent explicit.
- **Rehydrated props may be stale/corrupt.** Restored props aren't re-validated by the generic layer, so a modal that indexes a registry by a persisted key must guard it — e.g. `LibraryModal` splits into a validating wrapper (`LIBRARY_CONFIGS[type]` → render nothing if unknown) and a body that always runs its hooks.

When adding a modal, register it in `MODAL_PERSISTENCE` and open it via `useModal`; don't hand-roll a separate `useState` + persistence effect.

---

## Preset `source` Field is Runtime-only

Presets loaded from the bundled JSON files get `source: 'standard'`; user presets get `source: 'user'`. When saving to localStorage or exporting to file, `source` is stripped (`persistUserPresets` / `exportable`). If you use the `presets` array from `usePresets` to render UI, guard against `source` being absent in externally-loaded data.

---

## Library Order Copy Count (`count`)

`AGENT_CREATE`, `TASK_CREATE`, and `INVENTORY_ADD` all accept an optional `count` (the library shopping-list order quantity — issue #92). It defaults to 1, so the dashboard's single-add buttons keep dispatching `{ type }` with no `count`. `createCount()` in `reducer.js` floors it and falls back to 1 for anything non-positive or non-finite.

The three types read `count` differently, on purpose:

- **Items** — `count` multiplies the preset's own `quantity` into **one** stacked row (`quantity × count`), so a count of 3 on a quantity-20 preset adds 60. This is O(1) and handles the large counts the editable field allows.
- **Agents / Tasks** — `count` mints that many **distinct** entities via `Array.from({ length: count })`.

> ⚠️ Because agent/task counts allocate one entity per copy, an absurd count (e.g. millions) will allocate a matching array — the item path multiplies instead and is unaffected. The UI intentionally does not cap the count; item quantities (gold, arrows) legitimately reach the large numbers `formatCount` exists to display.

> ⚠️ **Needs clarification:** Issue #92 specifies the editable quantity field "for items and agents." Tasks were given the same field for consistency with the issue's overview ("select multiple items, agents **or tasks** … all at once") and to keep the modal uniform; a task order of _N_ creates _N_ task instances. Confirm this is the intended task behavior.

---

## `timeStep` Bounds Live in `clock.yml`, Not `normalizeState`

`normalizeState` only guards that `timeStep` and `stepBack` are positive numbers (falling back to `1`); legacy string values are coerced via `parseFloat`. The old load-time `>= 30 → 1` clamp was removed when bounds became configurable — it would have silently reset legitimate large steps on every reload. Range clamps are enforced at the **edit sites** (TopBar hold-drag `adjustStep`/`adjustStepBack`/`adjustRate`) against `clock.yml`'s `timeStep`/`rateMultiplier` bounds, which the load path cannot see (config fetch is async, `normalizeState` is synchronous). Both step increments share the `timeStep` bounds. A hand-edited save can therefore carry an out-of-bounds `timeStep`/`stepBack` until the next hold-drag adjustment clamps it.

---

## `tagLibrary` → `tagRegistry` Rename

The field was renamed from `tagLibrary` to `tagRegistry` at some point. `normalizeState` reads both as a fallback:

```js
state.tagRegistry = sanitizeRegistry(raw.tagRegistry ?? raw.tagLibrary) ?? seedTagRegistry();
```

Sessions saved before the rename will load correctly. New code should only write to `tagRegistry`.

---

## Game Loop Pauses During `contenteditable` Focus

`usePlayClock` attaches global `focusin`/`focusout` listeners to pause the tick interval while any `[contenteditable]` or `.req-field` element has focus. This prevents the clock from advancing (and deducting gold) while the player is typing names or values.

After blur, a 100ms timeout restarts the interval. If you add new editable fields that should also pause the clock, ensure they match the selector in `usePlayClock.js:onFocusIn`.

---

## Vite Virtual Modules Require Restart After First Install

If `public/assets/portraits/` or `public/assets/items/` do not exist when `vite dev` starts, the `imageManifestPlugin` will return an empty file list and the pickers will show no images. Adding the directories and restarting the dev server (not just HMR) is required to pick up the change. Subsequent file additions within a running session do trigger hot-reload via the `fs.watch` in `configureServer`.

---

## Char Budgets are Estimates, Not Per-Glyph Measurement

The text display library truncates by **character count**, derived from
container width ÷ (font size × an average glyph-width ratio from
`config/truncation.yml`). Consequences:

- Budgets are approximate for proportional fonts (a string of `W`s runs wider than the estimate). The pre-existing CSS `text-overflow: ellipsis` on `.tag-content` stays as the pixel-exact backstop; `.tag` chips rely on the budget alone.
- `truncateTagParts` never drops the tag's structure: if even the all-placeholder form (`<PRE>,<TAG>:<TAGS>=<VAL>`) exceeds a pathologically small budget, it renders anyway (the `minChars` clamp makes this a non-event in practice).
- A tag whose display already fits is returned untouched — `truncated: false` — even when the budget is smaller than the placeholders would be; no tooltip shows because nothing is hidden.
- The tooltip bubble sits at `z-index: 300`, above modal overlays (100) and the elevated registry overlay (200).
- The shared `charBudget.minChars: 10` floor is tuned for prose/tag text, not a fixed 34px numeric box: `stat-box` (`CardMedallion`/`StatBox` — issue #98) sets its own per-component `minChars: 1` override in `config/truncation.yml`, since its real geometric budget (~3-4 chars) would otherwise get clamped up to 10 by the shared floor, silently defeating `formatCountFit`'s significant-figure reduction (nothing would ever be "too long" once clamped that high).

---

## `config/truncation.yml` is Build-Time Input, Not a Served File

The text display library's configuration (`config/truncation.yml`) sits at the
repo root — **outside `public/`** — and is inlined at build time through a Vite
`?raw` import in `src/constants/truncation.js`. Consequences:

- Editing it in a deployed build does nothing; the values are baked into the bundle. Editing it under `vite dev` triggers a full reload (the `?raw` import chain), not HMR.
- Validation is fail-fast: a malformed file throws at module init and blanks the app. This is deliberate — the file is developer-controlled build input, not user data.
- This is the first piece of the YAML configuration system planned for session settings (see the event-log section below); new build-time config tables should follow the same pattern (repo-root YAML + validating loader in `src/constants/`).

---

## `public/config/UI.yml` is Runtime Input (the Opposite Convention)

The UI config takes the **other** loading path: it lives in `public/`, ships
with the deployed bundle as-is, and is fetched + parsed once per page load by
`ConfigContext` (consumed through `useUIConfig`). Consequences:

- Editing it in a deployed build **does** take effect — on the next reload, no rebuild needed. This is the point: which values a card displays is user-facing configuration, not build input.
- Validation is therefore lenient, the reverse of `truncation.yml`: a missing/unparseable file degrades to bare cards with a `console.warn`; a malformed section degrades to no elements of that kind; an unresolvable *source* renders its element empty in the warning state. Nothing throws.
- Editing invalid values is silently ignored at commit time: a non-numeric entry in an editable bar label or field snaps back to the resolved value. The HP bar's current value writes the agent's plain `hp` tag (`hp=12`); a path carrying a `dyn,` tag is computed and **read-only** — edit its input tags instead.
- **A Configuration Modal overlay shadows the file completely.** Once the file is edited in-app, the whole edited document (not a diff) is stored under `CONFIG_OVERLAYS` and wins over the deployed file — including any *later* edits to the deployed file — until RESET drops the overlay. If a deployed config change doesn't seem to apply, check for an overlay first.

> ⚠️ **Needs clarification:** The spec sizes medallion and boxes as "1/4 of agent card width, square, fixed dimensions" — but card width is fluid (`minmax(160px, 1fr)` grid). Implemented as a fixed `--stat-square: 34px` side (≈¼ of the *minimum* card content width), so the squares don't grow with the card. Digit spillover past that fixed square now has a safety net (issue #98): `formatCountFit` reduces significant figures to fit the box's measured `stat-box` char budget, and `overflow: hidden` backstops the residual case where even 1 significant figure doesn't fit — but the underlying question of whether the square should ever scale with card width is still open.

> ⚠️ **Needs clarification:** "Element flashes warning color" for invalid sources is implemented as a one-shot flash on render plus persistent warn-colored chrome (border/text), not a continuous pulse.

> ⚠️ **Needs clarification:** The spec says elements display "any integer" tag value; the resolver accepts any finite number, since `rate` (a field source) is fractional (e.g. `1.5` gp/day).

---

## Configuration Modal: Warnings Never Block, SAVE Never Writes `public/`

The Configuration Modal (TopBar → CONFIG, `ConfigModal.jsx` — it replaced the
old SETTINGS number-inputs modal) edits the **raw** config documents, guided by
per-file schemas (see `docs/architecture.md` → "Runtime Configuration System").
The soft-enforcement traps to know:

- **Schema warnings are advisory.** An unknown key or a failing value renders warn-red with a tooltip but is kept, saved, and exported. The one exception is state-bound sections (SESSION): a value its kind's `check` rejects (e.g. a non-numeric or sub-minimum `rateMultiplier`) is **not committed** — that guard protects the running clock math, not the schema.
- **SAVE exports a YAML file; it cannot write `public/config/`.** The browser has no path to the served file — SAVE hands you `<fileId>.yml` to drop back into `public/config/` yourself. Until then, your edits live only in the localStorage overlay (and vanish with browser storage).
- **YAML comments are lost on SAVE.** Exports are regenerated from data via `yaml.dump` under a one-line generated header; the shipped `UI.yml` doc-comment block does not round-trip. Keep the canonical commented file in git.
- **LOAD is lenient-but-warn**, mirroring the file's runtime contract: it rejects only unparseable YAML or a non-mapping root. A document that mismatches the schema imports fine and lights up warnings in the tree.
- **Clearing a value prunes its row once it is fully empty.** A list entry (`boxes:`, `fields:`, `values:`) cleared to empty is spliced out on commit; a bar tuple survives with one cell empty (warn-flagged) and is pruned only when both cells are cleared. Nullable scalars (`medallion:`) clear to `null` and keep their row (`setValueAtPruning` in `configEditor.js`).
- **Deleting a schema-named entry clears it — the key stays.** The × on a recognized entry (`bars:`, `medallion:`) resets it to its empty schema shape (`[]` / `{}` / `null` / `''`) because those keys are structure mirroring the UI components. Only list items and user-added keys — unknown keys, and `anyKey` names like card names under `cards:` — are actually removed (`removeEntryAt` in `configEditor.js`).
- **RESET is registry-wide and never touches the clock.** One press drops every file overlay (reverting to the deployed files) AND commits every state-bound section's manifest defaults through the reducer. Binding effects deliberately do not fire on reset — the play clock keeps its run state and game time; if the rate changed mid-play, `usePlayClock`'s config/rate effect re-seeds the interval on its own (and no-ops while paused).
- Deleting a registry path that a `tagSource` value references doesn't break anything — the value just gains a "not in the registry" warning, consistent with tag-registry soft enforcement.
- **Malformed tag syntax warns, it is not normalized.** `parseTag` silently drops empty segments (`"skill:"` parses like `"skill"`), so `tagSource` values are syntax-checked on the RAW string first (`tagSyntaxWarning` in `tags.js`): stray leading/trailing/double colons draw the warn style but the text is kept verbatim — no hard stop, no auto-correction.

---

## Event Log is Per-Tick, Tick-Driven, and Capped

`advanceTime` is the only writer of `state.eventLog`. Consequences:

- **One tick group per tick.** `advanceTime` runs `count` single-tick simulations (`advanceTick`) — `count` is `session.timeStep` for the step-forward button and `1` for each play interval — each emitting its own `work_contribution` rows (one per agent/condition, `delta` = that tick's contribution) **and** its own `'tick'` boundary. So a 10-tick step logs 10 tick groups, not one — this is what keeps rollback tick-granular.
- **Only tick-driven progress is logged.** Editing a condition's `progress` by hand (the click-to-edit field) bypasses `advanceTime` and is therefore **not** recorded. Don't expect the log to explain manually-set progress.
- **Every tick appends a `'tick'` boundary row** (even a no-op tick), sealing that tick's batch in the ordering contract `work* → task_complete* → tick`. The row records that tick's exact wages (`data.wagesTotal`/`wages`); the log tail therefore always ends at a tick boundary (rollback preserves this invariant by truncating whole groups). No step size is stored — every tick advances the clock by exactly one.
- **The log is FIFO-capped** at `rollback.yml`'s `log.maxRows` (default `MAX_LOG_ROWS`). Once trimmed, the oldest rows are gone — rollback can only reach back as far as the oldest retained `'tick'` row. `seq` is **not** renumbered on trim, so it stays a stable monotonic id (don't treat it as an array index).
- **`session.logging` no longer exists.** Logging config moved to `public/config/rollback.yml` (`log.enabled`, `log.maxRows`), edited in the ConfigModal like any file config; `normalizeState` strips the legacy field from old saves.

---

## Rollback Reverses Tick Effects Only, Best-Effort

`rollbackTick` (`src/logic/rollback.js`) reverses exactly one tick (one `'tick'` group), the inverse of one `advanceTick`, driven purely by the event log. The step-back button rewinds `session.stepBack` ticks via `rollbackTime` (which loops `rollbackTick`, `usePlayClock`'s `retreat`), stopping early at the horizon. `session.stepBack` is an **independent** increment from the forward `session.timeStep` — the two buttons show and adjust separate values. Traps to know:

- **Only tick effects reverse.** Manual edits made since the tick (renames, assignments, bank spending, hand-set progress) survive: inverses subtract recorded deltas — `progress = max(0, progress − delta)` — never restore snapshots.
- **Every inverse is best-effort.** Entities deleted since the tick are skipped; bank and item quantities clamp at 0; spawned agents are deleted even if edited since (items they hold are not returned — the spawn created them, not the items). Rollback never blocks or throws.
- **Rollback requires logging.** With `log.enabled: false` no tick rows accrue, so the horizon freezes at the last logged boundary; `EVENTLOG_CLEAR` empties it entirely (step-back dims).
- **Legacy logs have no `'tick'` boundaries.** History recorded before the rollback feature is honestly unreachable — `getRollbackHorizon` reports `canStepBack: false` and the button dims. Same for pre-feature saves.
- **Each step-back rewinds exactly one tick, and the recorded `wagesTotal` is authoritative.** Step-back reverts to the previous tick boundary as logged (one tick of clock, that tick's exact wage refund), immune to later `timeStep`, rate, or calendar changes.
- **An imported CSV log is trusted verbatim.** `rollbackTick` reads `state.eventLog` as-is; a foreign log that mismatches the live state degrades to clamped skips rather than erroring.

## GM/Player Mode is Off Unless the URL Says So

Networked GM/Player sessions (spec: `docs/specs/gm-player-mode.md`) exist only when the URL carries `?session=<id>&role=gm|party`. With no `session` param there is no `NetSessionProvider`, dispatch is ungated, `useGame().mode` is `'gm'`, and the app is byte-for-byte today's offline single-player client (localStorage persistence, no polling, no mode panel). Traps to know:

- **The dispatch gate is the sole enforcement point.** `gateDispatch` (from `isActionAllowed`) wraps `useGame().dispatch` when networked, and `usePermission` hides affordances from the *same* predicate — so pre-check and backstop can never disagree. Nothing is added to the reducer. A blocked action is a **silent** no-op, mirroring the locked-tag create backstop. `REPLACE_STATE` (server HEAD pulls) uses the ungated `rawDispatch` deliberately and so is intentionally absent from every allow-set.
- **A second `GameProvider` must set `persist={false}`.** The review viewer mounts a sandboxed second provider (`initialState=<snapshot>`, `mode="spectator"`). Without `persist={false}` it would fight the live provider over `STORAGE_KEYS.STATE`. A provider seeded with an explicit `initialState` is a sandbox by definition and is never networked (never gated), so its recorded clock can dispatch `APPLY_TICK` freely while its `mode` still reads `'spectator'` for affordances.
- **Never start the RAF interpolator in `recorded`.** The interpolator writes toward an in-flight tick that does not exist in replay (D-noraf). `usePlayClock` starts the RAF loop only when the clock source's `interpolate` flag is set — `true` for `live`, `false` for `recorded`.
- **Mode is derived, never stored.** `deriveMode(role, baton, holdsWriteLock)` is recomputed per render from the polled baton; nothing about mode enters `GameState` or travels with HEAD. The write-lock token lives in memory only — a mid-turn refresh abandons the pen (recovery is GM take-back).
- **The server runs no game logic.** Under commit-shape F1-B a commit carries a full `GameState` per tick, so `server/index.js` only stores blobs and enforces the baton/write-lock at the route (snapshot-then-mutate, atomic writes). The GM client reconstructs the finalized HEAD (`stateAt(ctx, cutIndex)`); the server never simulates or runs a reducer.
