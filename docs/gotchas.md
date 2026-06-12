# Gotchas

Non-obvious behaviors, known edge cases, and things that will surprise a developer reading this code for the first time.

---

## Tag Grammar is the Core Abstraction

The entire data model for agent abilities, task requirements, item bonuses, and equipment is encoded in tag strings. If you touch anything that reads or writes attributes/activities/requirements arrays, you must go through `parseTag` / `buildTag` — never manipulate these strings with raw string operations. (Task progress is the exception: a condition's `tracker.tagPath` is a tag *path* that references the registry, not a stored tag — see Conditions below.)

The grammar:

```
[modifier,]segment[:segment...][=value]
```

- The **modifier** (`req`, `block`, `bonus`) is separated from the content path by a comma, not a colon. This tripped up older code that used a colon and is what the migration in `normalizeState` → `migrateTag()` fixes.
- **Segments** form a path. The full path is the identity key for deduplication (`mergeAttribute` replaces any tag with the same modifier + path).
- `equip:<slot>:item:<name>` and `task:<id>` tags live in `activities`, not `attributes`. Don't look for them in `attributes`.

---

## `activities` vs `attributes`

These are two separate arrays on every agent:

- `attributes` — authored properties: skills, abilities, class, race, traits, items the agent permanently "has" in a data sense.
- `activities` — runtime state: current task assignments (`task:<id>`), items in the bag (`item:<name>=qty`), equipped items (`equip:<slot>:item:<name>`).

Several functions (`validateAssignment`, `isAttributeActive`) merge both arrays together when checking requirements, because a task assignment (`task:<id>`) is itself a matching tag that may satisfy a requirement like `req,task:<id>`.

---

## Conditions

Task progress lives in `task.conditions` — structured objects, **not** tags (the legacy `work:*` tag namespace is gone, and `normalizeState` prunes it from stored tag registries). Each condition tracks its own `progress` toward a `target`; a task completes only when *every* condition is satisfied. Conditions are keyed by `id`, and two conditions track independently — overshooting one cannot satisfy a deficit in another.

Per-tick accrual dispatches through `TRACKER_REGISTRY` in `src/logic/conditions.js` by `tracker.kind`. This is the extension point for future progress logic (event-driven, rule-based); the clock loop never special-cases a kind.

The only current kind, `'work'`, gates and modulates by `tracker.tagPath`:

- **Matching is exact.** `tagPath: 'skill:arcana'` matches only an agent attribute whose full segment path is `skill:arcana` — a `tagPath: 'skill'` is *not* satisfied by `skill:arcana` tags, only by a literal `skill` tag. Modifier-bearing tags (`req,…`) never match.
- A matched tag **with** a numeric value contributes `(workRate + value * skillBonus) * stepDays` — this applies to any value-bearing tag, not just skills. A matched tag **without** a value contributes the base `workRate * stepDays` (the legacy work system treated a valueless skill as value 1; conditions do not).
- No match → the agent contributes **0** to that condition (and flashes if it contributed to nothing on the task).
- `tagPath: null` → every assigned agent contributes the base rate.

A task with **zero conditions** carries an implied "clock advanced" condition: it completes at the end of any tick in which at least one eligible agent worked it. It never completes on its own.

Completion is evaluated only inside `advanceTime` (plus the manual ✓ button) — manually editing a condition's progress to ≥ target completes the task on the *next tick*, not instantly.

> ⚠️ **Needs clarification:** an agent can carry at most one attribute per exact path (`mergeAttribute` dedupes by path), so multi-match resolution is currently moot; if effective attributes ever stack duplicates (e.g. from equipment bonuses), `workContribution`'s `.find` takes the first.

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
