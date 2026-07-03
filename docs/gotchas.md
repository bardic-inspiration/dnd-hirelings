# Gotchas

Non-obvious behaviors, known edge cases, and things that will surprise a developer reading this code for the first time.

---

## Tag Grammar is the Core Abstraction

The entire data model for agent abilities, task requirements, item bonuses, and bound items is encoded in tag strings. If you touch anything that reads or writes attributes/activities/requirements arrays, you must go through `parseTag` / `buildTag` — never manipulate these strings with raw string operations. (Task progress is the exception: a condition's `tracker.tagPath` is a tag *path* that references the registry, not a stored tag — see Conditions below.)

The grammar:

```
[modifier,]segment[:segment...][=value]
```

- The **modifier** (`req`, `block`, `bonus`) is separated from the content path by a comma, not a colon. This tripped up older code that used a colon and is what the migration in `normalizeState` → `migrateTag()` fixes.
- **Segments** form a path. The full path is the identity key for deduplication (`mergeAttribute` replaces any tag with the same modifier + path).
- `bind:[<slot>:]item:<name>` and `task:<id>` tags live in `activities`, not `attributes`. Don't look for them in `attributes`.

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

> ⚠️ **Needs clarification:** the per-agent **slot schema** that would constrain binding (which slots exist, what each accepts) is **not implemented**. `hasSlotSchema(agent)` is a stub that always returns `false`, so the bind flow currently always takes the no-slot branch (`bind:item:<name>`). When slot schemas land, the `if (hasSlotSchema(agent))` branch in `AgentCard`'s bind handler should prompt for a slot.

---

## Conditions

Task progress lives in `task.conditions` — structured objects, **not** tags (the legacy `work:*` tag namespace is gone, and `normalizeState` prunes it from stored tag registries). Each condition tracks its own `progress` toward a `target`; a task completes only when *every* condition is satisfied. Conditions are keyed by `id`, and two conditions track independently — overshooting one cannot satisfy a deficit in another.

Per-tick accrual dispatches through `TRACKER_REGISTRY` in `src/logic/conditions.js` by `tracker.kind`. This is the extension point for future progress logic (event-driven, rule-based); the clock loop never special-cases a kind.

The only current kind, `'work'`, gates and modulates by `tracker.tagPath`:

- **Matching is exact unless the pattern says otherwise** (the engine's `open` mode — see Tag-Path Match Modes below). A wildcard-free `tagPath: 'skill:arcana'` matches only an agent attribute whose full segment path is `skill:arcana` — a `tagPath: 'skill'` is *not* satisfied by `skill:arcana` tags, only by a literal `skill` tag. Wildcards widen the link explicitly: `'skill:*'` matches any specific skill, `'skill:**'` the whole skill subtree. Modifier-bearing tags (`req,…`) never match.
- A matched tag **with** a numeric value contributes `(workRate + value * skillBonus) * stepDays` — this applies to any value-bearing tag, not just skills. A matched tag **without** a value contributes the base `workRate * stepDays` (the legacy work system treated a valueless skill as value 1; conditions do not).
- No match → the agent contributes **0** to that condition (and flashes if it contributed to nothing on the task).
- `tagPath: null` → every assigned agent contributes the base rate.

A task with **zero conditions** carries an implied "clock advanced" condition: it completes at the end of any tick in which at least one eligible agent worked it. It never completes on its own.

Completion is evaluated only inside `advanceTime` (plus the manual ✓ button) — manually editing a condition's progress to ≥ target completes the task on the *next tick*, not instantly.

> ⚠️ **Needs clarification:** an agent can carry at most one attribute per exact path (`mergeAttribute` dedupes by path), so multi-match resolution is currently moot; if effective attributes ever stack duplicates (e.g. from bound-item bonuses), `workContribution`'s `.find` takes the first.

---

## Tag-Path Match Modes

`src/logic/tagMatching.js` is the engine for comparing a **pattern** path against a tag's segment path. Modes live in `MATCH_MODE_REGISTRY` (the extension point, like `TRACKER_REGISTRY`). Condition tag links match in `open` mode — which is behaviorally identical to `exact` for `**`-free patterns, so wildcard-free links still require full-path alignment.

The Tag Registry modal's search highlighting also runs on this engine: the builder input doubles as a pattern search with an implicit leading `**` (so `skill:*` highlights the children of any `skill` node, `**:fire` any key named `fire`). Pattern drafts never ADD — the ghost autocomplete stays quiet and Enter will not add the path, because `*` is not a valid registry key — but they can APPLY as condition tag links (condition mode, or the global open) when they match at least one registry path (`patternMatchesRegistry`).

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

## Item Quantity Merge on Rename

When an inventory item is renamed via `INVENTORY_UPDATE_ITEM`, the reducer calls `mergeInventoryByName` to pool quantities if another item with the same (case-insensitive) name already exists. This is intentional but can surprise users — renaming "SWORD" to "DAGGER" when a "DAGGER" already exists will silently combine the two stacks.

The same merge happens when `AGENT_DELETE` returns held items: if the agent was carrying an item already in inventory, the quantities are summed rather than creating a duplicate row.

---

## Clock Display Uses Direct DOM Writes

The year/day clock display and task progress bars in `ProgressSection` are updated directly via `document.getElementById` / `document.querySelector` inside `updateClockDisplayDOM()`, called from the RAF loop in `usePlayClock`. React does not control these DOM mutations between ticks.

This means:
- The elements must exist in the DOM when the RAF fires (they do, because they render before play starts).
- React will overwrite these styles on the next full render. Progress bars use inline `style.width` set by both React (on tick) and the RAF loop (between ticks); the RAF interpolates toward the tick's already-applied value, so no flicker occurs in practice.
- Condition rows are addressed by `[data-task-id][data-condition-id]` selectors on `.condition-item-bar-fill` and `.condition-item-progress`.
- `updateClockDisplayDOM` guards against writing to focused elements: `if (document.activeElement !== el) el.textContent = val`. The condition progress number is a click-to-edit `EditableSpan`, so this guard is what keeps the RAF loop from clobbering an edit in progress. Do not remove it.

---

## Asset Loading Gate Blocks First Paint

`AssetProvider` renders a full-screen "LOADING" placeholder until every URL registered via `useRegisterAssets` has resolved. `usePalette` registers the background image for the active theme on mount, which means first paint is gated on that image loading. On a slow connection or a missing image, the app will stay on the loading screen until the image 404s (which still resolves the gate via `onerror`).

Adding more `useRegisterAssets` calls elsewhere will add to this blocking set. Use `useAssetGroup` (local, modal-scoped) for images that can load lazily.

On repeat visits the background is already in the HTTP cache (via the `<link rel="preload">` injected by `index.html`), so `AssetContext` checks `img.complete` synchronously after setting `src` and resolves the gate immediately — no LOADING flash. `settle` guards against double-resolution (the cached path and the async `onload` can both fire), so this is safe for the uncached first-load case too.

---

## Preset `source` Field is Runtime-only

Presets loaded from the bundled JSON files get `source: 'standard'`; user presets get `source: 'user'`. When saving to localStorage or exporting to file, `source` is stripped (`persistUserPresets` / `exportable`). If you use the `presets` array from `usePresets` to render UI, guard against `source` being absent in externally-loaded data.

---

## `timeStep` Clamped to < 30 Days

`normalizeState` resets `timeStep` to `1` if the stored value is `>= 30` (or non-numeric / non-positive). This prevents accidentally-large steps from causing severe game-clock jumps on load. `timeStep` is stored as a `number`; legacy string values are coerced via `parseFloat`. If you need larger step sizes, this guard in `storage.js:normalizeState` must be changed:

```js
timeStep: (isNaN(tsNum) || tsNum <= 0 || tsNum >= 30) ? 1 : tsNum,
```

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

## HP `null` Means "Full Health"

`agent.hp` is stored as `null` (not `hpMax`) when the agent is at full health. `computeDynamicAttributes` returns `hpMax` when `agent.hp` is null. This means saving and reloading a fully-healed agent correctly reflects the current max HP even if the agent leveled up since creation.

Setting `hp` to `0` explicitly means the agent is at zero HP, not "use max". Don't conflate null and zero.

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

---

## `config/truncation.yml` is Build-Time Input, Not a Served File

The text display library's configuration (`config/truncation.yml`) sits at the
repo root — **outside `public/`** — and is inlined at build time through a Vite
`?raw` import in `src/constants/truncation.js`. Consequences:

- Editing it in a deployed build does nothing; the values are baked into the bundle. Editing it under `vite dev` triggers a full reload (the `?raw` import chain), not HMR.
- Validation is fail-fast: a malformed file throws at module init and blanks the app. This is deliberate — the file is developer-controlled build input, not user data.
- This is the first piece of the YAML configuration system planned for session settings (see the event-log section below); new build-time config tables should follow the same pattern (repo-root YAML + validating loader in `src/constants/`).

---

## Event Log is Per-Day, Tick-Driven, and Capped

`advanceTime` is the only writer of `state.eventLog`. Consequences:

- **Per-day rows even when `timeStep > 1`.** A multi-day tick is split into `dayCount = round(stepDays)` rows per (agent, condition), each carrying `delta = rate / dayCount`. The per-day deltas sum to the tick's full contribution; the per-row `progress` is the running snapshot, so each row is self-describing.
- **Only tick-driven progress is logged.** Editing a condition's `progress` by hand (the click-to-edit field) bypasses `advanceTime` and is therefore **not** recorded. Don't expect the log to explain manually-set progress.
- **The log is FIFO-capped** at `session.logging.maxRows` (default `MAX_LOG_ROWS`). Once trimmed, the oldest rows are gone — any future rollback can only reach back as far as the oldest retained row. `seq` is **not** renumbered on trim, so it stays a stable monotonic id (don't treat it as an array index).
- **`session.logging` is a minimal stub.** Only `enabled` (master gate — when false, `advanceTime` emits no rows but progress still advances identically) and `maxRows` are wired today. The richer knobs discussed for it (logging interval, entity/temporal granularity, per-category filters) are intentionally deferred to the planned time-system refactor and the YAML configuration system — don't assume they exist yet. There is currently no UI for it (not in `ConfigModal`); it's edited via state/import only.

> ⚠️ **Needs clarification:** Clock **rollback** (restoring prior task-progress state from the log) is intentionally **not** implemented yet — this pass is the logging foundation only. `task_complete` rows capture the task's `attributes` and `results` in `data` as a breadcrumb, but a future rollback must still decide how to reverse completion side effects (bank gold, reward items, spawned agents, agent unassignment) that the log does not currently undo.
