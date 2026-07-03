import { useState, useRef, useMemo } from 'react';
import Modal from './Modal.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { parseTag, buildTag, MODIFIER_REGISTRY } from '../../logic/tags.js';
import { parsePattern, matchTagPath } from '../../logic/tagMatching.js';
import { conditionTemplateFromDraft } from '../../logic/conditions.js';
import {
  tagRegistrySave, tagRegistryLoad, flattenRegistry, tagsInUse, countTagsInUse,
  pathExists, patternMatchesRegistry,
} from '../../logic/tagRegistry.js';

// Walks a count tree (from countTagsInUse) down a segment path to its node, or
// undefined if the path isn't present.
function nodeAt(counts, segments) {
  let cur = counts;
  for (const seg of segments) {
    cur = cur.children?.[seg];
    if (!cur) return undefined;
  }
  return cur;
}

// Splits a draft tag into lowercased path parts (modifier + value stripped). Keeps
// a trailing '' when the draft ends on a ':' delimiter, so the last element is
// always the in-progress segment (what the user is currently typing).
function draftParts(draft) {
  let s = draft;
  const comma = s.indexOf(',');
  if (comma >= 0) s = s.slice(comma + 1);      // drop modifier prefix
  const eq = s.indexOf('=');
  if (eq >= 0) s = s.slice(0, eq);             // drop value
  return s.split(':').map(p => p.trim().toLowerCase());
}

// Splits a draft on its LAST '=' into { path, value }. Unlike parseTag this
// never re-joins segments, so escaped pattern colons ('\:') survive intact.
function splitDraftValue(draft) {
  const match = String(draft).trim().match(/^(.*?)(?:=([^=]*))?$/s);
  return { path: match[1], value: match[2] ?? null };
}

/**
 * The Tag Registry modal: the single surface for browsing, defining, assigning,
 * and pattern-linking tags. Reads its open-call props from `useUI().tagRegistryProps`
 * (see UIContext): `target` routes APPLY to a board entity, `mode: 'condition'`
 * makes APPLY build a condition template, `onApply` redirects the applied value
 * to a callback (library preset drafts) and elevates the overlay above the
 * library panel.
 *
 * ADD registers a structure path; APPLY assigns the draft to its destination,
 * registering the path first if it's new (plain drafts only — patterns are
 * never registry keys). With no target/onApply (TopBar open), APPLY arms
 * selection mode via `setPendingApply` and the next board-entity click
 * receives the tag/condition.
 *
 * Side effects: dispatches `TAGREG_ADD_PATH` / `TAG_APPLY` / `TASK_CONDITION_ADD`;
 * closes itself via `closeTagRegistry`.
 */
export default function TagRegistryModal() {
  const { tagRegistryProps, closeTagRegistry, setPendingApply } = useUI();
  const { state, dispatch } = useGame();
  const registry = state.tagRegistry;

  const { target = null, mode = 'tag', onApply = null } = tagRegistryProps ?? {};
  const isConditionMode = mode === 'condition';
  const isGlobal = !target && !onApply;

  const [expanded, setExpanded] = useState(new Set());
  const [draft, setDraft] = useState('');
  const [modifier, setModifier] = useState('');
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  // Flatten to ordered visible rows; line numbers reflect full-document position
  // (they skip over collapsed subtrees), matching a code editor's folding gutter.
  const rows = useMemo(() => flattenRegistry(registry, expanded), [registry, expanded]);

  // Live usage counts mirroring the registry; recomputes on any tag-bearing change.
  const counts = useMemo(
    () => countTagsInUse(registry, tagsInUse(state)),
    [registry, state.agents, state.tasks, state.inventory]
  );

  // True when the draft carries pattern syntax (wildcards or escapes). Pattern
  // drafts never ADD ('*' is not a valid registry key — a pattern names a match,
  // not a structure node) and APPLY only as condition links.
  const isPattern = /[\\*]/.test(draft);

  // Ghost suggestion: an existing key from the CURRENT tier (the node at the path
  // before the last delimiter) that starts with the in-progress segment. Returns
  // only the remaining suffix to render after the typed text.
  const suggestion = useMemo(() => {
    if (draft.includes('=') || isPattern) return '';
    const parts = draftParts(draft);
    const inProgress = parts[parts.length - 1];
    if (!inProgress) return '';
    let node = registry;
    for (const seg of parts.slice(0, -1)) {
      node = node && typeof node === 'object' ? node[seg] : undefined;
      if (!node) return '';
    }
    const match = Object.keys(node).sort().find(k => k.startsWith(inProgress) && k !== inProgress);
    return match ? match.slice(inProgress.length) : '';
  }, [draft, registry, isPattern]);

  // Wildcard-aware, path-aware search highlighting. The draft (modifier and
  // value stripped) is read as a pattern through the tagMatching engine, with
  // an implicit leading '**' so the search starts anywhere in the tree:
  // - completed segments must align with the row's path (`*` and `**` work,
  //   `\*` is a literal asterisk) — a row whose path ends on any leading slice
  //   of them is a confirmed step of the search and highlights fully;
  // - the in-progress segment highlights keys it prefixes at the next tier
  //   (or whole keys, when it is itself a wildcard).
  // Returns the number of leading characters of the row's key to highlight; 0 = no match.
  const matchLen = useMemo(() => {
    const parts = draftParts(draft);
    const inProgressRaw = parts[parts.length - 1];
    const complete = parts.slice(0, -1).filter(Boolean);
    if (!complete.length && !inProgressRaw) return () => 0;

    // Parsed alone so escapes are honored: '\*' stays a literal, not a wildcard.
    const inProgress = inProgressRaw ? parsePattern([inProgressRaw])[0] : null;
    // Leading slices with no literal segment anchor to nothing under the
    // implicit '**' and would match every row; the shortest useful slice is
    // the one that reaches the first literal.
    const firstLiteral = parsePattern(complete).findIndex(part => part.kind === 'literal');
    const anywhere = (patternSegments, segments) =>
      matchTagPath(['**', ...patternSegments], segments, { mode: 'open' });

    return (row) => {
      if (firstLiteral >= 0) {
        for (let used = complete.length; used > firstLiteral; used--) {
          if (anywhere(complete.slice(0, used), row.segments)) return row.key.length;
        }
      }
      if (!inProgress) return 0;
      if (inProgress.kind !== 'literal') {
        return anywhere([...complete, inProgressRaw], row.segments) ? row.key.length : 0;
      }
      const ancestors = row.segments.slice(0, -1);
      if (anywhere(complete, ancestors) && row.key.toLowerCase().startsWith(inProgress.value)) {
        return inProgress.value.length;
      }
      return 0;
    };
  }, [draft]);

  // APPLY validity: a plain draft names a path — new paths are registered on
  // APPLY (see registerDraftPath), so it need not already exist. A pattern must
  // match at least one registry path AND have a condition destination (condition
  // mode, or the global open where it arms condition selection). Condition-mode
  // special case: a bare '=target' draft (empty path) is a valid "any agent"
  // link (tagPath null).
  const canApply = useMemo(() => {
    const { path } = splitDraftValue(draft);
    if (!draft.trim()) return false;
    if (isPattern) return (isConditionMode || isGlobal) && patternMatchesRegistry(registry, path);
    if (isConditionMode && !path) return true; // '=20' → general condition
    return parseTag(draft).segments.length > 0;
  }, [draft, isPattern, isConditionMode, isGlobal, registry]);

  const toggle = (pathStr) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(pathStr)) next.delete(pathStr); else next.add(pathStr);
    return next;
  });

  const handleDelete = (segments) => dispatch({ type: 'TAGREG_DELETE_NODE', segments });

  // Clicking a tree key loads its full path into the builder input.
  const handleKeyClick = (row) => {
    setDraft(row.pathStr);
    inputRef.current?.focus();
  };

  // Typing 'req,' (any registered modifier + comma) lifts the modifier out of
  // the draft into the dropdown, keeping the input a pure path[=value].
  const handleDraftChange = (value) => {
    if (!isConditionMode) {
      const comma = value.indexOf(',');
      const prefix = comma >= 0 ? value.slice(0, comma).trim().toLowerCase() : null;
      if (prefix && MODIFIER_REGISTRY[prefix]) {
        setModifier(prefix);
        setDraft(value.slice(comma + 1));
        return;
      }
    }
    setDraft(value);
  };

  const handleAdd = () => {
    if (isPattern) return; // search-only draft; wildcards are not registry keys
    const segments = parseTag(draft.trim()).segments; // modifier + value dropped
    if (!segments.length) return;
    dispatch({ type: 'TAGREG_ADD_PATH', segments });
    // Reveal the new path by expanding its ancestors.
    setExpanded(prev => {
      const next = new Set(prev);
      for (let i = 1; i < segments.length; i++) {
        next.add(segments.slice(0, i).map(s => s.toLowerCase()).join(':'));
      }
      return next;
    });
    setDraft('');
  };

  // Registers a not-yet-registered segment path before APPLY hands the draft to
  // its destination, so a brand-new tag is defined and assigned in one action.
  // No-ops for paths already in the registry ('' included — a pattern's segments
  // or a bare '=target' condition draft never reach here with content).
  const registerDraftPath = (segments) => {
    if (segments.length && !pathExists(registry, segments)) {
      dispatch({ type: 'TAGREG_ADD_PATH', segments });
    }
  };

  // Assigns the draft to its destination and closes. Condition drafts become
  // templates; pattern drafts (global only) arm condition selection mode; plain
  // drafts compose modifier + path + value into a tag for onApply / TAG_APPLY /
  // tag selection mode.
  const handleApply = () => {
    if (!canApply) return;
    if (isConditionMode || isPattern) {
      const template = conditionTemplateFromDraft(draft);
      if (!isPattern && template.tracker.tagPath) registerDraftPath(parseTag(template.tracker.tagPath).segments);
      if (onApply) onApply(template);
      else if (target) dispatch({ type: 'TASK_CONDITION_ADD', id: target.id, template });
      else setPendingApply({ kind: 'condition', template });
    } else {
      const parsed = parseTag(draft.trim());
      registerDraftPath(parsed.segments);
      const tag = buildTag(parsed.segments, parsed.value, modifier || null);
      if (onApply) onApply(tag);
      else if (target) dispatch({ type: 'TAG_APPLY', target, tag });
      else setPendingApply({ kind: 'tag', tag });
    }
    closeTagRegistry();
  };

  const handleSave = () => tagRegistrySave(registry, state.session.id);

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    tagRegistryLoad(file)
      .then(reg => dispatch({ type: 'TAGREG_REPLACE', registry: reg }))
      .catch(err => alert(err.message)); // invalid file: check failed — leave registry untouched
    e.target.value = '';
  };

  const onKeyDown = (e) => {
    // Tab (or Right arrow at the line end) accepts the ghost suggestion.
    const accept = e.key === 'Tab' || (e.key === 'ArrowRight' && e.target.selectionStart === draft.length);
    if (accept && suggestion) { e.preventDefault(); setDraft(draft + suggestion); return; }
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
  };

  const placeholder = isConditionMode
    ? 'PATH=TARGET · PATTERNS OK (SKILL:*)'
    : 'CLICK A KEY · TYPE TO SEARCH OR ADD';

  return (
    <Modal onClose={closeTagRegistry} overlayClass={`tag-registry-overlay${onApply ? ' tag-registry-overlay--elevated' : ''}`}>
      <div className="tag-registry-panel" onClick={e => e.stopPropagation()}>
        <div className="tagreg-top">
          <span className="tagreg-head">
            <span className="library-heading">TAG REGISTRY</span>
            {counts.total > 0 && <span className="tagreg-total">{counts.total}</span>}
          </span>
          <div className="tagreg-top-actions">
            <button className="ctrl" onClick={handleSave}>SAVE</button>
            <button className="ctrl" onClick={() => fileInputRef.current?.click()}>LOAD</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".yml,.yaml"
              style={{ display: 'none' }}
              onChange={handleLoad}
            />
          </div>
        </div>

        <div className="tagreg-tree">
          {rows.length === 0
            ? <div className="empty">REGISTRY EMPTY</div>
            : rows.map(row => {
              const n = matchLen(row);
              const cnode = nodeAt(counts, row.segments);
              const count = cnode ? (row.hasChildren && !row.isOpen ? cnode.total : cnode.count) : 0;
              return (
              <div className="tagreg-row" key={row.pathStr}>
                <span className="tagreg-ln">{row.lineNo}</span>
                {row.ancestorIsLast.map((isLast, index) => (
                  <span key={index} className={`tagreg-guide${isLast ? '' : ' tagreg-guide--line'}`} />
                ))}
                {row.hasChildren ? (
                  <button
                    className={`tagreg-fold${row.isLast ? ' tagreg-fold--last' : ''}`}
                    onClick={() => toggle(row.pathStr)}
                    aria-label={row.isOpen ? 'Collapse' : 'Expand'}
                  >
                    <span className="tagreg-fold-box">{row.isOpen ? '−' : '+'}</span>
                  </button>
                ) : (
                  <span className={`tagreg-tick${row.isLast ? ' tagreg-tick--last' : ''}`} />
                )}
                <span className="tagreg-key" onClick={() => handleKeyClick(row)} title={row.pathStr}>
                  {n > 0 && <span className="tagreg-match">{row.key.slice(0, n)}</span>}
                  {row.key.slice(n)}
                  <span className="tagreg-colon">:</span>
                </span>
                {count > 0 && <span className="tagreg-count">{count}</span>}
                <span className="tagreg-x" title="Delete from registry" onClick={() => handleDelete(row.segments)}>×</span>
              </div>
              );
            })}
        </div>

        <div className="tagreg-builder">
          {!isConditionMode && (
            <select
              className="tagreg-prefix"
              value={modifier}
              onChange={e => setModifier(e.target.value)}
              title={modifier ? MODIFIER_REGISTRY[modifier]?.description : 'Modifier prefix'}
            >
              <option value="">—</option>
              {Object.entries(MODIFIER_REGISTRY).map(([key, def]) => (
                <option key={key} value={key} title={def.description}>{key.toUpperCase()}</option>
              ))}
            </select>
          )}
          <div className="tagreg-input-wrap">
            {suggestion && (
              <div className="tagreg-ghost" aria-hidden="true"><span className="tagreg-ghost-typed">{draft}</span>{suggestion}</div>
            )}
            <input
              ref={inputRef}
              className="tagreg-input"
              type="text"
              placeholder={placeholder}
              value={draft}
              spellCheck={false}
              onChange={e => handleDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
            />
          </div>
          <button className="ctrl" onClick={handleAdd} disabled={!draft.trim() || isPattern} title="Register this path">ADD</button>
          <button className="ctrl" onClick={handleApply} disabled={!canApply} title="Assign to a target">APPLY</button>
        </div>
      </div>
    </Modal>
  );
}
