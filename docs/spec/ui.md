# Interface

The dashboard's layout, the agent card, selection, the Tag Registry modal,
text display, modals, and theming. Part of [`SPEC.md`](../../SPEC.md).

## Principles

- **No page scroll** (`INV-4`); panels scroll inside themselves.
- **Text never spills** (`INV-5`) — see [Text display](#text-display).
- **Transparent:** structure mirrors data. Sections, labels, and controls
  follow the schema they show: a card shows its object's fields, the registry
  modal the registry's tree, the Configuration Modal the config documents.
- **Versatile and modular:** one component serves many surfaces and plugs in
  anywhere (tag display, click-to-edit, confirmation, tooltips).
- **Consistent:** a shared behavior is one standard component or process,
  never a local variant.
- **Configurable:** what a surface shows comes from config where practical
  ([`config.md`](config.md)).
- **Editable in place:** values edit where they are shown — click-to-edit
  spans, hold-and-drag numbers.

## Layout

- **Top bar:** the guild title; the clock panel (editable YEAR / DAY, earliest
  reachable time); play, step-back, and step-forward controls
  ([`clock.md`](clock.md)); the palette switch; the session panel — session
  id, NEW, SAVE, LOAD, LOG, TAG REGISTRY, CONFIG.
  - NEW prompts for a session id, stops the clock, and resets the state.
  - SAVE / LOAD write and read the session JSON; LOG exports the event log as
    CSV ([`persistence.md`](persistence.md) "Files").
- **Dashboard:** the agent list, the task list, and the inventory with the
  bank panel, each with its `+` button ([`library.md`](library.md)).

`Planned (#116):` a mode sub-panel in the top bar when networked
([`multiplayer.md`](multiplayer.md) "Mode sub-panel").

## Cards

Agents, tasks, and items render as cards that expand and collapse. Agents
start expanded; tasks and items start collapsed. A card's state persists only
when the user toggles it away from its type's default
([`persistence.md`](persistence.md) "Storage keys").

**Agent card order.** Elements render in one fixed sequence:

`Name (+ Medallion) · Portrait · Fields · Boxes · Bars · Values ·
Description · Attributes · Bag · Bound · Tasks · Copy | Delete`

Collapsed, a card shows only Name, Medallion, and Bars. Elements before and
after the bars hide as two contiguous runs, so the card is one flat sequence
with two collapse guards. New elements slot into this order with their group.
Element values come from config ([`config.md`](config.md) "Card elements").

**ATTRIBUTES** is a per-card collapsible list (collapsed by default,
persisted) of **every** attribute tag, including tags that also drive a card
element — such a tag shows in both places and edits stay in sync. Tags sort
by modifier (plain first), then path, case-insensitively. Each is removable
and value-editable, and the list has an add button.

**Task cards** carry one `+ TAG` button in their attributes section (mirrored
in the library's task preview). A `req,` or `block,` tag added through it
routes to requirements; the requirements list has no add button of its own.
Task tag lists append (duplicates possible); agent and item attributes
replace by identity.

## Selection

Two persistent selections drive "pick a source, then click a target":

- **A selected task** highlights agent cards as assignable or not; clicking a
  card assigns it ([`tasks.md`](tasks.md) "Assignment").
- **A selected inventory item** turns agent cards and the bank panel into
  give and sell targets ([`inventory.md`](inventory.md) "Giving and
  selling").

A click outside agent cards, item rows, and the bank panel clears them.

## The Tag Registry modal

The single surface for authoring tags and assigning them. Opened from the top
bar, from a card's `+ TAG` or `+ CONDITION`, or from a library preview.

- **Tree view:** a code-editor-style outline with `+` / `−` folds and `×` to
  delete a node; SAVE / LOAD exchange the registry as YAML
  ([`tags.md`](tags.md) "The tag registry").
- **Two verbs share one input.** **ADD** (Enter) changes registry structure
  only and never touches an entity. **APPLY** assigns the draft and closes; a
  path not yet registered is registered first, so a new tag is defined and
  assigned in one action.
- **Condition mode** turns the draft into a condition template
  ([`tasks.md`](tasks.md) "Conditions").
- **Search.** The input doubles as a pattern search with an implicit leading
  `**` (`skill:*` highlights any skill node; `**:fire` any key named `fire`).
  Pattern drafts never ADD — `*` is not a valid key — but can APPLY as
  condition links when they match at least one registered path.
- **Rules awareness.** Rows flag dynamic markers with missing rules or warnings,
  and a payload typed on a `dyn,` draft warns.
- **Destination**, in order: an `onApply` callback (library preview drafts;
  the overlay rises above the library's), then a `target` entity, then
  **selection mode**: with no target, APPLY arms a capture-phase click listener
  hosted by `App.jsx`, and the next agent card, task card, or item row clicked
  receives the tag. The capture phase stops the card's own click (so applying
  a tag doesn't also assign a task). Any other click, or Escape, cancels.
- **Routing is the entity's job:** `TAG_APPLY` sends a task's `req,` and
  `block,` tags to its requirements and the rest to its attributes.

## Text display

A cross-tier library keeps long strings and large numbers inside their
containers, on by default:

- **Config:** `config/truncation.yml` — the number-shorthand table, the
  placeholders `<PRE>` `<TAG>` `<TAGS>` `<VAL>`, and character-budget
  parameters per font and component. Extending it (a `T` tier, a new
  component) is a config-only change.
- **Numbers:** three significant figures with tier suffixes (`1.42K`,
  `56.5K`, `1.25M`, `6.00B`); below the first tier, verbatim; a mantissa that
  rounds to 1000 promotes a tier (`999950` → `1.00M`); past the last tier,
  exponent notation (`7.80e12`); the `overflow` string (`NaN`) for anything no
  notation can represent. Gold keeps one decimal below the first tier. Every
  count or stat display goes through `formatCount`; an empty or non-numeric
  string passes through unchanged.
- **Fixed slots** (the 34 px medallion and boxes) use `formatCountFit`, which
  drops significant figures (`1.42K` → `1.4K` → `1K`) until the text fits,
  never cutting with an ellipsis; `overflow: hidden` backstops the residual
  case.
- **Tags** truncate structurally (`truncateTagParts`): full form, then
  trailing middle segments collapse to `<TAG>` / `<TAGS>`, then an overlong
  value, first segment, or modifier becomes `<VAL>` / `<TAG>` / `<PRE>`.
  **The modifier, first segment, and value always survive in some form**, and
  a tag that already fits is untouched. `TAG_LABEL_VARIANTS` holds the
  display styles: `chip` (the literal string) and `row` (uppercase block
  style, `_` / `-` as spaces).
- **Plain text** uses a middle ellipsis (`truncateMiddle`), or an end
  ellipsis where the prefix identifies the string (agent names,
  `truncateEnd`).
- **Budgets are estimates:** characters = (container width − allowance) ÷
  (font size × average glyph ratio), floored at `minChars` (10; the stat
  box overrides it to 1 so its real ~3-character budget isn't inflated).
  `useCharBudget(component)` measures the container through one shared
  `ResizeObserver`. CSS `text-overflow: ellipsis` backstops proportional-font
  overruns in rows.
- **Components:** `<TagLabel>` renders every tag; `<TruncatedText>` every
  other truncatable string; both wrap the result in a `<Tooltip>` carrying the
  full value whenever the display differs from the data. `truncate`,
  `tooltip`, and `shorthand` props opt out per use.
- **Tag editing:** a tag's string is never edited directly, only its value.
  With `onValueCommit`, clicking the value opens an inline input (Enter or
  blur commits, Escape cancels, an empty value is discarded); with
  `onReplace`, double-clicking the string opens the registry to pick a
  replacement. Dynamic tags never get value editing.
- **`<EditableSpan>`** is the click-to-edit primitive: formatted and
  end-truncated while unfocused, the raw value while focused. `singleLine`
  makes Enter commit and collapses pasted whitespace.

## Tooltips

All hover hints go through `<Tooltip>`: shown on hover or keyboard focus after
400 ms, hidden on leave, blur, or Escape; portaled to `document.body`,
centered above the anchor, clamped to the viewport, flipping below when
cramped; width capped by `--tooltip-max-width`. The one exception is `title`
on `<option>` elements, which render in the OS-native dropdown.

## Modals

- **One hook:** every modal opens through `useModal(name)` in `UIContext`.
  Its `*Props` value is `null` when closed and an object when open, paired with
  `open*` / `close*`.
- **Open state persists across refresh** per modal (`MODAL_PERSISTENCE`):
  config, library, and tag registry persist; the portrait and icon pickers
  don't. Props carrying a function (a picker's `onSelect`, a library draft's
  `onApply`) are never persisted. A modal that indexes data by a persisted key
  validates it on rehydrate and renders nothing when it's unknown.
- **`ConfirmModal`** stands in for native `confirm`, `alert`, and `prompt`:
  `onConfirm` fires only on OK; Cancel, Escape, or an overlay click closes
  without it.
- **Stacking:** modal overlays at z-index 100, the elevated registry overlay at
  200, tooltips at 300.
- The portrait and item-icon pickers reveal each thumbnail as it loads
  ([`assets.md`](assets.md) "Loading").

## Theming

Two palettes, `light` and `dark`, switched from the top bar and remembered per
browser. All colors are CSS custom properties applied to `:root`; structural
values (radius, spacing, fonts) are fixed in the stylesheet. Each palette has
a decorative background image ([`assets.md`](assets.md)). Class names follow
the flat-compound convention in [`CLAUDE.md`](../../CLAUDE.md).
