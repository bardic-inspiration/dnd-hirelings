# Configuration

The config files, the manifest that registers them, user overlays, the
Configuration Modal, and the agent card's element config. Part of
[`SPEC.md`](../../SPEC.md).

## Files

Two loading paths, with opposite contracts:

| | Runtime (`public/config/*.yml`) | Build time (`config/*.yml`) |
|---|---|---|
| Loaded | Fetched once per page load by `ConfigContext` | Inlined into the bundle through a Vite `?raw` import |
| Editing takes effect | On the next reload, no rebuild; or live, through the Configuration Modal | Only in a new build (a full reload under `vite dev`) |
| Invalid content | Degrades leniently, warns, never throws | Throws at module init and blanks the app |
| Audience | Users: rules, layout, pacing | The developer: display tuning |

Why the split: what the user may change ships as runtime data; developer-only
tables fail fast, because a bad value there is a bug.

| File | Holds | Spec |
|---|---|---|
| `public/config/clock.yml` | Calendar, step and rate bounds, real-time pacing. | [`clock.md`](clock.md) |
| `public/config/rollback.yml` | Rollback switchboard and event logging. | [`clock.md`](clock.md) "Rollback" |
| `public/config/rules.yml` | The rules registry (`dynamic:` expressions). | [`tags.md`](tags.md) "Dynamic tags" |
| `public/config/tags.yml` | Locked mode. | [`tags.md`](tags.md) "The tag registry" |
| `public/config/UI.yml` | Card element sources and bind slots. | [Card elements](#card-elements) |
| `config/truncation.yml` | Number shorthand, truncation placeholders, character budgets. | [`ui.md`](ui.md) "Text display" |

New build-time tables follow `truncation.yml`'s pattern: a repo-root YAML file
plus a validating loader in `src/constants/`.

## The manifest

`CONFIG_FILES` (`src/logic/configRegistry.js`) is the single registration point
for everything the Configuration Modal edits. Adding a config file is one
entry plus one schema. Entries, in display order:

| id | Kind | Source |
|---|---|---|
| `session` | `state` | `state.session`: `rateMultiplier` (min 0.1), `workRate` (min 0), `skillBonus` (min 0) |
| `clock` | `file` | `/config/clock.yml` |
| `rollback` | `file` | `/config/rollback.yml` |
| `rules` | `file` | `/config/rules.yml` |
| `tags` | `file` | `/config/tags.yml` |
| `ui` | `file` | `/config/UI.yml` |

- **`file` entries** are fetched by `ConfigContext` — once per URL,
  single-flight, degrading to `{}` on failure — and shadowed by an **overlay**:
  the user's whole edited document (not a diff), stored under
  `CONFIG_OVERLAYS` ([`persistence.md`](persistence.md)). A consumer reads
  `overlay ?? base ?? {}`. Documents live in React state, so edits apply live
  to every consumer.
- **`state` entries** bind to game state: `select(state)` reads the section,
  `commit(dispatch, key, value)` writes one value, `defaults` is the reset
  payload, and `effects` maps keys to effect *names* (`rateMultiplier:
  'restartPlay'`) that the modal resolves to callbacks. Why names: the
  manifest stays plain data. No fetch, no overlay — the reducer is the
  storage.
- **An overlay shadows the deployed file completely**, including later edits
  to the deployed file, until reset. If a deployed config change doesn't
  apply, check for an overlay first.

`Planned (#117):` a `state` entry `tasks` bound to `state.tasks`
([`task-engine.md`](task-engine.md) "Authoring").

**Schemas** are small recursive descriptors kept beside each file's logic
(`UI_SCHEMA`, `CLOCK_SCHEMA`, `ROLLBACK_SCHEMA`, `TAGS_SCHEMA`, `RULES_SCHEMA`,
`SESSION_SCHEMA`):

```js
// node := { kind: 'map', keys?, anyKey?, closed? }
//       | { kind: 'list', item } | { kind: 'tuple', size, item }
//       | { kind: 'scalar', value: 'string'|'number'|'boolean'|'slug'|'enum'|'tagSource'|'expression',
//           options?, min?, step?, nullable?, label? }
```

Scalar kinds are pluggable through `VALUE_KINDS`, each supplying
autocomplete suggestions and a soft check.

## The Configuration Modal

Opened from the top bar's CONFIG. It renders every manifest section as one
folding tree in the Tag Registry modal's idiom — line-number gutter, indent
guides, fold boxes, ghost autocomplete in the builder input. Schemas shape
the affordances but never block an edit (`INV-6`).

- **Scalars** edit inline and commit immediately.
- **Warnings are advisory.** An unknown key or failing value renders
  warn-red with a tooltip but is kept, saved, and exported. The exception:
  in a `state` section, a value its kind rejects (a non-numeric or
  sub-minimum `rateMultiplier`) is not committed. Why: that guard protects
  the running clock's math.
- A `tagSource` value naming a path missing from the registry warns. Malformed
  tag syntax (stray leading, trailing, or doubled colons) is checked on the raw
  string and warns; the text is kept verbatim, never auto-corrected.
- **Clearing a value prunes a row once it is fully empty:** a list entry
  cleared to empty is removed; a bar tuple survives with one empty cell
  (warned) and is removed when both are cleared; a nullable scalar clears to
  `null` and keeps its row.
- **Deleting a schema-named entry clears it** to its empty shape (`[]`, `{}`,
  `null`, `''`); the key stays, because it mirrors a UI component. List items
  and user-added keys (unknown keys, `anyKey` names such as card names) are
  removed.
- **SAVE** exports the **active section** (the one holding the last-clicked
  key) as `<id>.yml`, with a generated header; source comments are not
  preserved. It cannot write `public/config/` — drop the file there yourself.
  Until then, edits live only in the overlay. Keep the canonical commented
  files in git.
- **LOAD** imports into the active section, rejecting only unparseable YAML or
  a non-mapping root; a schema mismatch imports and warns.
- `state` sections have no SAVE / LOAD; their values travel in the session
  export.
- **RESET is registry-wide:** it drops every overlay and commits every
  `state` section's defaults, without firing binding effects. The play clock
  keeps its run state and time; if the rate changed mid-play, the play loop
  re-seeds its interval itself.

## Card elements

The agent card shows a set of standard elements whose values come from
`public/config/UI.yml` `cards.<card>`, instead of hard-coded attributes:

| Element | Renders | Notes |
|---|---|---|
| `medallion` | One value in a square badge beside the name | Visible while collapsed. |
| `boxes` | One value per square, four per row | Directly above the bars. |
| `bars` | `(current, max)` tuples as ratio bars | Current is editable when writable. Accepts `[current, max]` or `"(current, max)"`. |
| `fields` | Labelled editable values | Write back through the source. |
| `values` | Read-only `LABEL: value` | Label is the last path segment, uppercased. |
| `slots` | Bind slot names | Not a value source ([`inventory.md`](inventory.md) "Binding and slots"). |

The deployed file configures `agentCard`: medallion `level`; bars
`[hp, hp-max]` and `[xp-lvl, xp-lvl-max]`; field `rate`; values `ac`, `pb`;
slots `weapon armor offhand ring head feet`.

**Sources**, resolved in order (`resolveTagSource`, `src/logic/UI.js`):

1. A bare agent field (`rate`) — editable, with its unit sibling (`rateUnit`).
2. A path where the agent carries a `dyn,` tag — the computed total,
   **read-only**; edit the input tags instead.
3. Any other attribute path, matched case-insensitively against the agent's
   effective attributes and read through the `numeric` resolver — only an
   explicit numeric `=value` displays, and it writes back (`hp=12`).

- A source that can't resolve to a number renders its element with **no value**
  in the `--invalid` state: a warning-color flash on render plus warn-colored
  chrome.
- A dynamic value that evaluated with defaulted references or a cycle renders
  its value in the `--warn` state (warn chrome, no flash).
- Committing a non-numeric value to an editable element is ignored; it snaps
  back.
- Any finite number displays, not only integers.
- The file degrades leniently: missing or unparseable → bare cards and a
  `console.warn`; a malformed section → no elements of that kind. Until the
  fetch settles, cards render with no elements.
