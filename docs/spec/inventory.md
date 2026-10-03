# Inventory

Items, how identical rows stack, giving and selling, agents' bags, and
binding items into slots. Part of [`SPEC.md`](../../SPEC.md).

## Items

An inventory row has a name, quantity, icon, description, unit `value` in
gold, and attribute tags. A `bonus,` tag grants its value to the agent who
binds the item ([Binding](#binding-and-slots)).

**Identical rows stack.** Two rows are the same item when they share a
case-insensitive **name** and the same **tag set** (order-insensitive); same
name with different tags stays a separate row. The reducer re-normalizes the
whole inventory (`mergeInventoryByIdentity`) whenever identity could change —
`INVENTORY_ADD`, `INVENTORY_UPDATE_ITEM` changing `name` or `attributes`,
`INVENTORY_REMOVE_ATTRIBUTE`, and `TAG_APPLY` to an item — folding each later
row into the first match and summing quantities.

- Non-identity edits (quantity, value, description) don't merge.
- Unnamed `NEW ITEM` placeholders never stack, so fresh blanks stay distinct.
- **The merge is eager.** It runs after every individual rename and tag edit,
  so an item that becomes momentarily identical to another row merges at once,
  even mid-way through editing toward a different final state. To pass
  through a transient duplicate, edit the distinguishing field first. Why:
  identical means identical, with no debounce or separate merge step.

## Giving and selling

Selecting an inventory row arms the **place-item** flow (`ITEM_PLACE`):

- Agent cards become give targets: **left-click gives 1**; **right-click**
  opens an inline quantity input.
- The bank panel becomes a sell target: a click sells 1 for the item's
  `value`.
- The quantity drawn clamps to the stock. A depleted row stays in the list,
  grayed.
- The selection persists for repeated gives and sells. It clears on a click
  outside agent cards, item rows, and the bank panel, or when the stack runs
  out.
- Give-target highlighting takes priority over task-assignment highlighting;
  the two selections are mutually exclusive.

## Bags

An agent's bag is its `item:<name>=<qty>` activity tags; bag items carry no
tags of their own. On an agent card, **left-clicking** a bag item returns the
whole stack to inventory (`AGENT_RETURN_ITEM`) and selects it, so it can be
given or sold straight away.

Items returning to inventory — from `AGENT_RETURN_ITEM` or `AGENT_DELETE`
(which returns everything the agent held) — pool into an existing row by
**name only**, regardless of that row's tags; with no match, a blank row is
created. Why: bag items have no tags to compare.

## Binding and slots

**Assign** and **bind** are separate. Assigning moves an item to an agent
(giving, above). Binding equips an item from the agent's bag:

- **Right-click** a bag item to bind one unit; right-click a bound chip to
  unbind it back into the bag (`AGENT_BIND_ITEM` / `AGENT_UNBIND_ITEM`).
- A bound item is a `bind:<slot>:item:<name>` activity, or
  `bind:item:<name>` with no slot.
- **Slot names come only from config:** `public/config/UI.yml`
  `cards.<card>.slots` ([`config.md`](config.md)). Binding fills the first
  unoccupied configured slot in config order; with no slots configured, or all
  full, the item binds without a slot. Slot names are lowercased so they
  compose cleanly into tag paths. The registry's `bind` node is structure
  only.
- **Bonuses.** An agent's **effective attributes** are its attributes plus
  the `bonus,<path>=<n>` values of every bound item, summed by path — added to
  the matching plain attribute, or added as a new tag when the agent has none.
  The bonus tags are read from the inventory row with the bound item's name.
  Effective attributes drive condition matching and dynamic-tag totals.
