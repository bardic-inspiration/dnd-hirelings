import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { loadCardExpansion, saveCardExpansion, loadOpenModal, saveOpenModal } from './storage.js';

const UIContext = createContext(null);

/**
 * Whether each card type is expanded by default. The persisted expansion store
 * records only IDs whose state deviates from these defaults, so both
 * default-expanded (agents) and default-collapsed (tasks, items) types share one
 * mechanism. Add a card type here to extend the store. `agentTags` is not a card
 * type but a per-agent sub-section (the agent card's ATTRIBUTES list), keyed by
 * agent id and reusing the same store — default collapsed.
 */
const CARD_DEFAULT_EXPANDED = { agent: true, task: false, item: false, agentTags: false };

/**
 * Per-modal persistence toggle (issue #81). `true` = the modal's open state is
 * saved to localStorage and restored after a refresh; `false` = it stays
 * ephemeral. Flip a component's entry here to enable/disable its persistence.
 *
 * The picker modals default OFF: they open with a live `onSelect` callback that
 * can't survive a reload, so restoring them would resurrect a picker whose
 * "apply" does nothing. (`isPersistableProps` enforces the same rule at runtime,
 * so a persistence-enabled modal that happens to carry a callback — e.g. the tag
 * registry opened from a library draft — is also skipped rather than restored
 * half-alive.)
 */
const MODAL_PERSISTENCE = {
  config: true,
  library: true,
  tagRegistry: true,
  portraits: false,
  itemIcons: false,
  // The review viewer carries live net callbacks and a large sandbox seed; never
  // persist it (a restored review whose finalize does nothing would mislead).
  review: false,
};

// Props round-trip through localStorage only when they're plain data; a modal
// carrying a live function (picker `onSelect`, tag-registry `onApply`) is treated
// as ephemeral even when its modal is persistence-enabled.
const isPersistableProps = (props) =>
  props == null || Object.values(props).every(value => typeof value !== 'function');

/**
 * Modal open-state hook with opt-in refresh persistence (issue #81). Returns
 * `[props, open, close]`: `props` is the open payload (`null` when closed),
 * `open(value)` opens with `value ?? {}`, `close()` closes. When the modal is
 * persistence-enabled (`MODAL_PERSISTENCE[name]`) and its props are plain data,
 * the open state is mirrored to localStorage and rehydrated on mount.
 *
 * @param {string} name - Modal key in `MODAL_PERSISTENCE`
 * @returns {[object|null, (value?: object) => void, () => void]}
 */
function useModal(name) {
  const persist = MODAL_PERSISTENCE[name] ?? false;
  const [props, setProps] = useState(() => (persist ? loadOpenModal(name) : null));
  useEffect(() => {
    if (persist) saveOpenModal(name, isPersistableProps(props) ? props : null);
  }, [persist, name, props]);
  const open = useCallback((value) => setProps(value ?? {}), []);
  const close = useCallback(() => setProps(null), []);
  return [props, open, close];
}

/**
 * Provides UI state to the component tree: modal open/close state, selection
 * state, and the playing flag. Slices persisted to localStorage (survive a
 * refresh): the card expand/collapse store, and every persistence-enabled
 * modal's open state (issue #81 — standardized via `useModal` /
 * `MODAL_PERSISTENCE`; picker modals opt out because they carry callbacks).
 *
 * Tag registry modal props (`openTagRegistry(props)` — all fields optional):
 * - `target`: `{ type: 'agent'|'task'|'item', id }` board entity APPLY assigns to
 * - `mode`: `'tag'` (default) or `'condition'` (APPLY builds a condition template)
 * - `onApply`: `(tagString|template) => void` — library preset drafts take the
 *   applied value instead of a dispatch; also elevates the modal above the library
 *
 * `pendingApply` holds a tag/condition awaiting a board-entity click (selection
 * mode, hosted by App.jsx): `null | { kind: 'tag', tag } | { kind: 'condition', template }`.
 *
 * Confirm modal props (`openConfirm(props)` — stands in for native
 * confirm/alert/prompt dialogs):
 * - `message`: string shown in the dialog body
 * - `type`: `'confirm'` (default, OK/Cancel), `'alert'` (OK only), or
 *   `'prompt'` (text input + OK/Cancel)
 * - `defaultValue`: initial text for `'prompt'` dialogs
 * - `danger`: styles OK as a destructive action
 * - `onConfirm`: `(value?: string) => void` — called on OK only, `value` is
 *   the entered text for `'prompt'` dialogs. Cancel/Escape/overlay-click is a
 *   silent no-op, matching native dialog cancel semantics.
 *
 * Card expansion: `isExpanded(type, id)` / `toggleExpanded(type, id)` drive every
 * card type (`'agent' | 'task' | 'item'`) plus the `'agentTags'` sub-section.
 * State is a per-type Set of IDs toggled away from `CARD_DEFAULT_EXPANDED`,
 * persisted via `saveCardExpansion`.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function UIProvider({ children }) {
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [cardExpansion, setCardExpansion]   = useState(loadCardExpansion);
  const [playing, setPlaying]               = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [pendingApply, setPendingApply]     = useState(null);

  // Every modal goes through the same open-state hook; persistence is per-modal
  // via MODAL_PERSISTENCE (issue #81). The raw `open` takes a props object, so
  // handlers with their own argument shape are wrapped below.
  const [configProps, openConfigModal, closeConfig]        = useModal('config');
  const [portraitsProps, openPortraitsModal, closePortraits] = useModal('portraits');
  const [itemIconsProps, openItemIconsModal, closeItemIcons] = useModal('itemIcons');
  const [libraryProps, openLibraryModal, closeLibrary]     = useModal('library');
  const [tagRegistryProps, openTagRegistry, closeTagRegistry] = useModal('tagRegistry');
  const [confirmProps, openConfirmModal, closeConfirm]     = useModal('confirm');
  const [reviewProps, openReviewModal, closeReview]        = useModal('review');

  // Persist card expansion on every change (mirrors GameProvider's saveState effect).
  useEffect(() => {
    saveCardExpansion(cardExpansion);
  }, [cardExpansion]);

  /**
   * Whether a card is currently expanded, resolving its type's default against
   * the persisted deviation Set.
   *
   * @param {'agent'|'task'|'item'|'agentTags'} type
   * @param {string} id - Entity ID
   * @returns {boolean}
   */
  const isExpanded = useCallback((type, id) => {
    const deviates = cardExpansion[type]?.has(id) ?? false;
    return CARD_DEFAULT_EXPANDED[type] ? !deviates : deviates;
  }, [cardExpansion]);

  /**
   * Toggles a card's expand/collapse state by flipping its ID's membership in the
   * type's deviation Set. Side effect: triggers persistence via the effect above.
   *
   * @param {'agent'|'task'|'item'|'agentTags'} type
   * @param {string} id - Entity ID
   */
  const toggleExpanded = useCallback((type, id) => {
    setCardExpansion(prev => {
      const nextSet = new Set(prev[type]);
      if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
      return { ...prev, [type]: nextSet };
    });
  }, []);

  // Wrap the raw openers to keep each modal's existing call signature.
  const openConfig    = useCallback(() => openConfigModal({}), [openConfigModal]);
  const openPortraits = useCallback((onSelect) => openPortraitsModal({ onSelect }), [openPortraitsModal]);
  const openItemIcons = useCallback((onSelect) => openItemIconsModal({ onSelect }), [openItemIconsModal]);
  const openLibrary   = useCallback((type) => openLibraryModal({ type }), [openLibraryModal]);
  const openConfirm   = useCallback((opts) => openConfirmModal(opts), [openConfirmModal]);
  const openReview    = useCallback(() => openReviewModal({}), [openReviewModal]);

  return (
    <UIContext.Provider value={{
      selectedTaskId, setSelectedTaskId,
      isExpanded, toggleExpanded,
      playing, setPlaying,
      selectedItemId, setSelectedItemId,
      configProps, openConfig, closeConfig,
      portraitsProps, openPortraits, closePortraits,
      itemIconsProps, openItemIcons, closeItemIcons,
      libraryProps, openLibrary, closeLibrary,
      tagRegistryProps, openTagRegistry, closeTagRegistry,
      confirmProps, openConfirm, closeConfirm,
      reviewProps, openReview, closeReview,
      pendingApply, setPendingApply,
    }}>
      {children}
    </UIContext.Provider>
  );
}

/**
 * Returns the full UI context value from the nearest `UIProvider`.
 *
 * @returns {UIContextValue}
 */
export function useUI() {
  return useContext(UIContext);
}
