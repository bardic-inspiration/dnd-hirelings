import { useState, useRef, useMemo } from 'react';
import Modal from './Modal.jsx';
import Tooltip from '../Tooltip.jsx';
import EditableSpan from '../EditableSpan.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { useConfig } from '../../state/ConfigContext.jsx';
import { CONFIG_FILES, configFileById } from '../../logic/configRegistry.js';
import {
  flattenConfigDoc, checkConfigDoc, schemaNodeAt, schemaChild, coerceScalarInput,
  getAt, setValueAt, deleteAt, emptyValueFor, configSave, configLoad, VALUE_KINDS,
} from '../../logic/configEditor.js';

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The Configuration Modal: the single surface for browsing and editing every
 * config file registered in the CONFIG_FILES manifest — runtime YAML assets
 * (card UI) and state-bound sections (session) alike — as one schema-guided
 * folding tree in the Tag Registry Modal's idiom.
 *
 * Edits live-apply: scalar values edit inline (EditableSpan) and write straight
 * through — file sections into the ConfigContext overlay (shadowing the shipped
 * file), state sections into the game reducer via their manifest binding. The
 * schema shapes affordances only: known keys ghost-complete in the builder and
 * out-of-schema entries draw warn styling with a tooltip, but nothing is
 * blocked. SAVE / LOAD / RESET act on the active section (the one containing
 * the last-clicked row).
 *
 * Side effects: dispatches via manifest bindings (e.g. `SESSION_UPDATE`), fires
 * named binding effects resolved from props (`restartPlay` → `onRestartPlay`),
 * writes the config overlay store; closes itself via `closeConfig`.
 *
 * @param {object} props
 * @param {() => void} props.onRestartPlay - Restarts the play clock; resolved as
 *   the `restartPlay` binding effect (fires when `rateMultiplier` changes)
 */
export default function ConfigModal({ onRestartPlay }) {
  const { state, dispatch } = useGame();
  const { closeConfig } = useUI();
  const { getDoc, updateDoc, resetDoc, isOverridden } = useConfig();

  const [expanded, setExpanded] = useState(() => new Set(CONFIG_FILES.map(entry => entry.id)));
  const [activePath, setActivePath] = useState([]);
  const [draft, setDraft] = useState('');
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  // Named binding effects (see configRegistry): the manifest stays pure by
  // naming effects; the modal resolves them to live callbacks from props.
  const effectHandlers = { restartPlay: onRestartPlay };
  const context = useMemo(() => ({ tagRegistry: state.tagRegistry }), [state.tagRegistry]);

  // All manifest sections composed into ONE document + schema, so the tree,
  // line numbers, and warnings span every config surface continuously.
  const combinedSchema = useMemo(() => ({
    kind: 'map',
    closed: true,
    keys: Object.fromEntries(CONFIG_FILES.map(entry => [entry.id, entry.schema])),
  }), []);
  const combinedDoc = useMemo(() => {
    const doc = {};
    for (const entry of CONFIG_FILES) {
      doc[entry.id] = entry.kind === 'state' ? entry.binding.select(state) : getDoc(entry.id);
    }
    return doc;
  }, [state, getDoc]);

  const rows = useMemo(
    () => flattenConfigDoc(combinedDoc, combinedSchema, expanded),
    [combinedDoc, combinedSchema, expanded],
  );
  const warnings = useMemo(
    () => checkConfigDoc(combinedDoc, combinedSchema, context),
    [combinedDoc, combinedSchema, context],
  );

  // The builder's target container: the active row itself when it's a map or
  // list, otherwise its parent. `null` at the root — file sections are fixed
  // by the manifest, so there is nothing to add there.
  const target = useMemo(() => {
    if (!activePath.length) return null;
    const value = getAt(combinedDoc, activePath);
    const schemaNode = schemaNodeAt(combinedSchema, activePath);
    const isContainer = isMapping(value) || (Array.isArray(value) && schemaNode?.kind !== 'tuple');
    const path = isContainer ? activePath : activePath.slice(0, -1);
    if (!path.length) return null;
    return {
      path,
      entry: configFileById(path[0]),
      value: getAt(combinedDoc, path),
      schema: schemaNodeAt(combinedSchema, path),
    };
  }, [activePath, combinedDoc, combinedSchema]);

  // Ghost suggestion: unclaimed schema keys for map targets; value-kind
  // completions (dynamic keys, agent fields, live registry paths) for list
  // targets, applied to the segment after the last comma so tuple drafts
  // complete per entry.
  const suggestion = useMemo(() => {
    if (!target || !draft.trim()) return '';
    if (isMapping(target.value)) {
      const existing = new Set(Object.keys(target.value));
      const match = Object.keys(target.schema?.keys ?? {})
        .filter(key => !existing.has(key))
        .sort()
        .find(key => key.startsWith(draft) && key !== draft);
      return match ? match.slice(draft.length) : '';
    }
    const itemSchema = target.schema?.item?.kind === 'tuple' ? target.schema.item.item : target.schema?.item;
    if (itemSchema?.kind !== 'scalar') return '';
    const segment = draft.slice(draft.lastIndexOf(',') + 1).trimStart();
    if (!segment) return '';
    const match = (VALUE_KINDS[itemSchema.value]?.suggest(segment, itemSchema, context) ?? [])[0];
    return match ? match.slice(segment.length) : '';
  }, [target, draft, context]);

  const canAdd = Boolean(target && target.entry?.kind === 'file' && draft.trim());

  const toggle = (pathStr) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(pathStr)) next.delete(pathStr); else next.add(pathStr);
    return next;
  });

  // Clicking a key selects the row as the builder/actions context.
  const handleKeyClick = (row) => {
    setActivePath(row.path);
    inputRef.current?.focus();
  };

  // Commits one scalar edit (inline value or tuple entry) at a combined-doc
  // path. File sections write through the overlay; state sections hard-guard
  // against values their kind's check rejects (a NaN rateMultiplier would
  // corrupt the clock math — data integrity, not schema enforcement) and then
  // commit through the binding, firing its named effect.
  const commitValue = (path, schemaNode, raw) => {
    const value = coerceScalarInput(raw, schemaNode);
    const [fileId, ...innerPath] = path;
    const entry = configFileById(fileId);
    if (!entry) return;
    if (entry.kind === 'state') {
      const warning = schemaNode?.kind === 'scalar'
        ? VALUE_KINDS[schemaNode.value]?.check(value, schemaNode, context)
        : null;
      if (warning) return;
      entry.binding.commit(dispatch, innerPath[0], value);
      effectHandlers[entry.binding.effects?.[innerPath[0]]]?.();
    } else {
      updateDoc(fileId, setValueAt(getDoc(fileId), innerPath, value));
    }
  };

  const handleDelete = (row) => {
    const [fileId, ...innerPath] = row.path;
    const entry = configFileById(fileId);
    if (entry?.kind !== 'file' || !innerPath.length) return;
    updateDoc(fileId, deleteAt(getDoc(fileId), innerPath));
    setActivePath(row.path.slice(0, -1));
  };

  // ADD: a new (empty, schema-shaped) key under a map target, or a new entry
  // appended to a list target. Tuple lists split the draft on commas into one
  // tuple; scalar lists append the coerced draft.
  const handleAdd = () => {
    if (!canAdd) return;
    const [fileId, ...container] = target.path;
    const doc = getDoc(fileId);
    let next = doc;
    if (isMapping(target.value)) {
      const key = draft.trim();
      if (!(key in target.value)) {
        next = setValueAt(doc, [...container, key], emptyValueFor(schemaChild(target.schema, key)));
      }
    } else if (Array.isArray(target.value)) {
      const itemSchema = target.schema?.item;
      const item = itemSchema?.kind === 'tuple'
        ? Array.from({ length: itemSchema.size ?? 2 }, (unused, index) =>
            coerceScalarInput(draft.split(',')[index] ?? '', itemSchema.item))
        : coerceScalarInput(draft, itemSchema);
      next = setValueAt(doc, container, [...target.value, item]);
    }
    if (next !== doc) updateDoc(fileId, next);
    // Reveal the new entry by expanding the target and its ancestors.
    setExpanded(prev => {
      const nextSet = new Set(prev);
      target.path.reduce((acc, step) => {
        const pathStr = acc ? `${acc}:${step}` : String(step);
        nextSet.add(pathStr);
        return pathStr;
      }, '');
      return nextSet;
    });
    setDraft('');
  };

  // --- Active-section actions (SAVE / LOAD / RESET) ---
  const activeFileId = activePath[0] ?? CONFIG_FILES[0].id;
  const activeEntry = configFileById(activeFileId);

  const handleSave = () => configSave(activeFileId, getDoc(activeFileId));

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    configLoad(file)
      .then(doc => updateDoc(activeFileId, doc))
      .catch(err => alert(err.message)); // invalid file — leave the config untouched
    e.target.value = '';
  };

  const handleReset = () => {
    if (activeEntry.kind === 'state') {
      for (const [key, value] of Object.entries(activeEntry.binding.defaults)) {
        activeEntry.binding.commit(dispatch, key, value);
        effectHandlers[activeEntry.binding.effects?.[key]]?.();
      }
    } else {
      resetDoc(activeFileId);
    }
  };

  const onKeyDown = (e) => {
    // Tab (or Right arrow at the line end) accepts the ghost suggestion.
    const accept = e.key === 'Tab' || (e.key === 'ArrowRight' && e.target.selectionStart === draft.length);
    if (accept && suggestion) { e.preventDefault(); setDraft(draft + suggestion); return; }
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
  };

  const placeholder = !target ? 'CLICK A KEY TO SELECT A SECTION'
    : target.entry?.kind === 'state' ? 'SESSION VALUES EDIT INLINE'
    : isMapping(target.value) ? `ADD KEY UNDER ${target.path.join(':')}`
    : `ADD ENTRY TO ${target.path.join(':')}`;

  const activePathStr = activePath.join(':');

  return (
    <Modal onClose={closeConfig}>
      <div className="config-modal-panel" onClick={e => e.stopPropagation()}>
        <div className="cfg-top">
          <span className="cfg-head">
            <span className="library-heading">CONFIG</span>
            <span className="cfg-active">{activeEntry.label}</span>
            {activeEntry.kind === 'file' && isOverridden(activeFileId) && (
              <Tooltip content="Edited in-app — RESET restores the shipped file">
                <span className="cfg-modified">●</span>
              </Tooltip>
            )}
          </span>
          <div className="cfg-top-actions">
            {activeEntry.kind === 'file' && (
              <>
                <Tooltip content="Export this section as YAML">
                  <button className="ctrl" onClick={handleSave}>SAVE</button>
                </Tooltip>
                <Tooltip content="Import a YAML file into this section">
                  <button className="ctrl" onClick={() => fileInputRef.current?.click()}>LOAD</button>
                </Tooltip>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".yml,.yaml"
                  style={{ display: 'none' }}
                  onChange={handleLoad}
                />
              </>
            )}
            <Tooltip content={activeEntry.kind === 'file'
              ? 'Discard in-app edits; restore the shipped file'
              : 'Restore default values'}>
              <button className="ctrl" onClick={handleReset}>RESET</button>
            </Tooltip>
          </div>
        </div>

        <div className="cfg-tree">
          {rows.map(row => {
            const warning = warnings.get(row.pathStr);
            const isRoot = row.depth === 0;
            const rootEntry = isRoot ? configFileById(row.key) : null;
            const isListItem = typeof row.keyOrIndex === 'number';
            const keyWarn = warning && row.kind !== 'scalar';
            return (
              <div
                className={`cfg-row${row.pathStr === activePathStr ? ' cfg-row--active' : ''}`}
                key={row.pathStr}
              >
                <span className="cfg-ln">{row.lineNo}</span>
                {row.ancestorIsLast.map((isLast, i) => (
                  <span key={i} className={`cfg-guide${isLast ? '' : ' cfg-guide--line'}`} />
                ))}
                {row.hasChildren ? (
                  <button
                    className={`cfg-fold${row.isLast ? ' cfg-fold--last' : ''}`}
                    onClick={() => toggle(row.pathStr)}
                    aria-label={row.isOpen ? 'Collapse' : 'Expand'}
                  >
                    <span className="cfg-fold-box">{row.isOpen ? '−' : '+'}</span>
                  </button>
                ) : (
                  <span className={`cfg-tick${row.isLast ? ' cfg-tick--last' : ''}`} />
                )}
                <Tooltip content={warning ?? row.schemaNode?.label ?? row.pathStr}>
                  <span
                    className={`cfg-key${keyWarn ? ' cfg-key--warn' : ''}`}
                    onClick={() => handleKeyClick(row)}
                  >
                    {isListItem ? '-' : (isRoot ? rootEntry?.label ?? row.key : row.key)}
                    {!isListItem && <span className="cfg-colon">:</span>}
                  </span>
                </Tooltip>
                {isRoot && rootEntry?.kind === 'file' && isOverridden(rootEntry.id) && (
                  <Tooltip content="Edited in-app — RESET restores the shipped file">
                    <span className="cfg-modified">●</span>
                  </Tooltip>
                )}
                {row.kind === 'scalar' && !isRoot && (
                  <EditableSpan
                    className={`cfg-value${warning ? ' cfg-value--warn' : ''}`}
                    singleLine
                    value={row.value == null ? '' : String(row.value)}
                    placeholder="·"
                    onCommit={text => commitValue(row.path, row.schemaNode, text)}
                  />
                )}
                {row.kind === 'tuple' && (
                  <span className="cfg-tuple">
                    <span className="cfg-colon">[</span>
                    {row.value.map((entryValue, index) => (
                      <span key={index} className="cfg-tuple-entry">
                        {index > 0 && <span className="cfg-colon">,&nbsp;</span>}
                        <EditableSpan
                          className={`cfg-value${warnings.get(`${row.pathStr}:${index}`) ? ' cfg-value--warn' : ''}`}
                          singleLine
                          value={entryValue == null ? '' : String(entryValue)}
                          placeholder="·"
                          onCommit={text => commitValue([...row.path, index], row.schemaNode?.item, text)}
                        />
                      </span>
                    ))}
                    <span className="cfg-colon">]</span>
                  </span>
                )}
                {!isRoot && configFileById(row.path[0])?.kind === 'file' && (
                  <Tooltip content="Delete entry">
                    <span className="cfg-x" onClick={() => handleDelete(row)}>×</span>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>

        <div className="cfg-builder">
          <div className="cfg-input-wrap">
            {suggestion && (
              <div className="cfg-ghost" aria-hidden="true">
                <span className="cfg-ghost-typed">{draft}</span>{suggestion}
              </div>
            )}
            <input
              ref={inputRef}
              className="cfg-input"
              type="text"
              placeholder={placeholder}
              value={draft}
              spellCheck={false}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
            />
          </div>
          <Tooltip content="Add to the selected section">
            <button className="ctrl" onClick={handleAdd} disabled={!canAdd}>ADD</button>
          </Tooltip>
        </div>
      </div>
    </Modal>
  );
}
