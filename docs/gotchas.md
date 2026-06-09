# Gotchas

Non-obvious behaviors, known edge cases, and things that will surprise a developer reading this code for the first time.

---

## Naming Conventions

---

### `p` as the Parsed-Tag Variable

Throughout `src/logic/` — particularly `tags.js`, `agents.js`, `tasks.js`, and `clock.js` — the result of `parseTag()` is almost always stored in a single-letter variable `p`:

```js
const p = parseTag(tag);
if (p.segments[0] === 'task') { ... }
```

When a second parsed value is needed in the same scope the pattern produces compound abbreviations: `attrP`, `reqP`, `actP`. These are opaque outside their immediate line.

> ⚠️ **Naming:** Standardize to `parsed` for the primary variable and `parsedAttr` / `parsedReq` / `parsedAct` for secondary ones. The single-letter `p` gives no signal about the type; `parsed` does.

---

### `t` Means Both Tag and Task

In different files `t` is used as the loop variable for both tag strings and task objects. Within `agents.js` the same function sometimes iterates `for (const t of attributes)` (tag) and elsewhere uses `tasks.find(t => ...)` (task). The ambiguity is scoped tightly but still requires reading context to resolve.

> ⚠️ **Naming:** Use `tag` for tag string iterators and `task` for task object iterators. The brevity saving is not worth the ambiguity given how central both concepts are to the codebase.

---

### Index Variable: `i` vs `idx` vs `index`

Three spellings for the same concept appear across components:

- `i` — loop counter in `.map()` callbacks (AgentCard.jsx, ItemRow.jsx, TaskCard.jsx)
- `idx` — abbreviation used in ProgressSection.jsx and TagBuilderModal.jsx
- `index` — full word used in TagRow.jsx, ResultsSection.jsx, RequirementsSection.jsx

> ⚠️ **Naming:** Pick one and use it everywhere. `index` in named parameters (component props, function signatures); `i` acceptable only in short anonymous `.map()` callbacks where the semantics are obvious from context.

---

### Abbreviated DOM References in `clock.js`

`updateClockDisplayDOM` uses terse variable names for queried elements:

```js
const hFill = document.querySelector(`.task-progress-fill[data-task-id="${task.id}"]`);
const bFill = document.querySelector(`.work-item-bar-fill${sel}`);
const valEl = document.querySelector(`.work-item-value${sel}`);
```

`hFill` (header fill), `bFill` (bucket fill), and `valEl` (value element) all require knowledge of the abbreviation scheme to decode.

> ⚠️ **Naming:** `headerFill`, `bucketFill`, `valueEl` (or `valueDisplay`) would be readable without a legend. The same applies to `el` used as a generic element reference in BankPanel.jsx and EditableSpan.jsx — prefer `inputEl`, `spanEl`, etc.

---

## Tag Grammar is the Core Abstraction

The entire data model for agent abilities, task requirements, item bonuses, work types, and equipment is encoded in tag strings. If you touch anything that reads or writes attributes/activities/requirements/work arrays, you must go through `parseTag` / `buildTag` — never manipulate these strings with raw string operations.

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

## Work Progress Keys

Task work progress is stored in `task.workProgress` as `{ [key]: number }` where `key` is the second segment of the work tag (`req.segments[1]`). For a `work:skill:arcana=10` tag, the key is `'skill'`, not `'skill:arcana'`. Multiple distinct skill requirements share a key and accumulate together.

> ⚠️ **Needs clarification:** This means two work requirements like `work:skill:arcana=5` and `work:skill:stealth=5` would both write to `workProgress['skill']`, effectively combining their progress into one bar. This appears to be a known limitation of the current schema — each task can effectively only have one `work:skill` bucket, not one per skill name.

---

## `computeBlockedTaskIds` References Undefined `pool`

In `src/logic/tasks.js`, the `computeBlockedTaskIds` function has a reference to a `pool` variable that is never declared. The `consumable` case in the second pass (`kind === 'consumable'`) reads `pool[name.toLowerCase()]`, which will throw a `ReferenceError` at runtime if any task has a `req,consumable` requirement.

```js
} else if (kind === 'consumable') {
  if ((pool[name.toLowerCase()] ?? 0) < (parseFloat(p.value) || 1)) { pass = false; break; }
}
```

The `consumable` handling in the second pass (lines 110–116) does work correctly because it re-queries the inventory directly. The first-pass `pool` lookup is the broken path.

> ⚠️ **Needs clarification:** The `consumable` resource type appears half-implemented. Items tagged as consumables are deducted on task completion (`applyResults`) but the blocked-task detection in the first pass will crash if triggered.

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
- `updateClockDisplayDOM` guards against writing to focused inputs: `if (document.activeElement !== el) el.textContent = val`. Do not remove this guard.

---

## Asset Loading Gate Blocks First Paint

`AssetProvider` renders a full-screen "LOADING" placeholder until every URL registered via `useRegisterAssets` has resolved. `usePalette` registers the background image for the active theme on mount, which means first paint is gated on that image loading. On a slow connection or a missing image, the app will stay on the loading screen until the image 404s (which still resolves the gate via `onerror`).

Adding more `useRegisterAssets` calls elsewhere will add to this blocking set. Use `useAssetGroup` (local, modal-scoped) for images that can load lazily.

---

## Preset `source` Field is Runtime-only

Presets loaded from the bundled JSON files get `source: 'standard'`; user presets get `source: 'user'`. When saving to localStorage or exporting to file, `source` is stripped (`persistUserPresets` / `exportable`). If you use the `presets` array from `usePresets` to render UI, guard against `source` being absent in externally-loaded data.

---

## `timeStep` Clamped to < 30 Days

`normalizeState` resets `timeStep` to `'1'` if the stored value is `>= 30`. This prevents accidentally-large steps from causing severe game-clock jumps on load. If you need larger step sizes, this guard in `storage.js:normalizeState` must be changed:

```js
timeStep: (isNaN(tsNum) || tsNum >= 30) ? '1' : (s.timeStep ?? '1'),
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

`agent.hp` is stored as `null` (not `hp_max`) when the agent is at full health. `computeDynamicAttributes` returns `hp_max` when `agent.hp` is null. This means saving and reloading a fully-healed agent correctly reflects the current max HP even if the agent leveled up since creation.

Setting `hp` to `0` explicitly means the agent is at zero HP, not "use max". Don't conflate null and zero.

---

## Vite Virtual Modules Require Restart After First Install

If `public/assets/portraits/` or `public/assets/items/` do not exist when `vite dev` starts, the `imageManifestPlugin` will return an empty file list and the pickers will show no images. Adding the directories and restarting the dev server (not just HMR) is required to pick up the change. Subsequent file additions within a running session do trigger hot-reload via the `fs.watch` in `configureServer`.
