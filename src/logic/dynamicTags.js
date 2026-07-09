// Dynamic (`dyn,`) tag evaluation and reconciliation. A dynamic tag is a
// dependent variable: the object carries a `dyn,<address>` marker, the rules
// registry (public/config/rules.yml → logic/rulesConfig.js) carries the
// governing expression, and the app writes the computed TOTAL into the tag's
// payload (`dyn,ac=14`) — materialized state, kept current by the reconciler
// (state/reducer.js DYN_RECONCILE via hooks/useDynReconcile.js).
//
// Total = expression result + the object's effective static value at the same
// address. `getEffectiveAttributes` (logic/agents.js) folds bound-item
// `bonus,` tags into plain tags, so rule `[8+{ability:dex}]` with
// `ability:dex=3`, `ac=2`, and an equipped `bonus,ac=1` totals 14.
//
// Reference resolution (strictly scoped, always object-local):
// - `{addr}`      — the object's STATIC tag at the address (`numeric`
//   resolver); wildcards (`{class:*}`) sum matching plain tags. No dyn
//   fallback. Missing/non-numeric → default 1 + warning.
// - `{dyn,addr}`  — the DYNAMIC total at the address (the object must carry
//   the marker); wildcards sum matching markers' totals. Missing → 1 +
//   warning. Chains evaluate in dependency order; cycles collapse every
//   marker on the cycle to 1 + warning.
// - a marker with NO rule (or an unparseable rule) is INVALID: no value
//   exists, the payload is stripped, and the UI renders the invalid state.
// Warnings are always derived, never stored.

import { parseTag, buildTag } from './tags.js';
import { resolveTagValue } from './tagValues.js';
import { parsePattern, matchTagPath } from './tagMatching.js';
import { parseExpression, evaluateExpression } from './expressions.js';
import { getEffectiveAttributes } from './agents.js';

/**
 * @typedef {object} DynResult
 * @property {number|null} value - The materialized total (expression result
 *   plus effective static value at the address). `null` when invalid.
 * @property {boolean} valid - `false` when no rule exists for the address or
 *   the rule fails to parse — there is no value at all.
 * @property {string[]} warnings - Defaulted references, cycles, non-finite
 *   results, transitive flags — and the missing/broken-rule message when
 *   `valid` is false. Non-empty with `valid: true` renders the warn state.
 * @property {string|null} expression - The governing rule's expression text.
 */

/**
 * Evaluates every `dyn,` marker in an attribute list against the rules
 * registry. Entity-generic: pass any object's effective tag list (agent
 * effective attributes, item attributes, task attributes + requirements).
 *
 * @param {string[]} effectiveAttributes - The object's tag strings, with
 *   bound-item bonuses already applied for agents (`getEffectiveAttributes`)
 * @param {ReturnType<import('./rulesConfig.js').normalizeRulesConfig>} rulesConfig -
 *   Normalized rules registry (`useRulesConfig` / `normalizeRulesConfig`)
 * @param {TagRegistry} registry - Live tag registry (bounds `numeric` resolution)
 * @returns {Map<string, DynResult>} Keyed by lowercase address
 */
export function evaluateDynamicTags(effectiveAttributes, rulesConfig, registry) {
  const rules = rulesConfig?.dynamic ?? {};
  const markers = new Set();  // dyn addresses carried by the object
  const plainTags = [];       // { parsed, path } for modifier-less tags
  for (const tag of effectiveAttributes ?? []) {
    const parsed = parseTag(tag);
    const path = parsed.segments.join(':').toLowerCase();
    if (!path) continue;
    if (parsed.modifier === 'dyn') markers.add(path);
    else if (!parsed.modifier) plainTags.push({ parsed, path });
  }

  const results = new Map();
  const stack = [];          // addresses currently evaluating (cycle detection)
  const cyclic = new Set();  // addresses confirmed on a cycle

  const plainNumericAt = (path) => {
    for (const { parsed, path: tagPath } of plainTags) {
      if (tagPath !== path) continue;
      const value = resolveTagValue('numeric', parsed, registry);
      if (value !== null) return value;
    }
    return null;
  };

  const resolveStaticWildcard = (refPath, warnings) => {
    let sum = 0;
    let found = false;
    for (const { parsed } of plainTags) {
      if (!matchTagPath(refPath, parsed.segments, { mode: 'open' })) continue;
      const value = resolveTagValue('numeric', parsed, registry);
      if (value === null) continue;
      sum += value;
      found = true;
    }
    if (!found) {
      warnings.push(`no tags match "{${refPath}}" (defaulted to 1)`);
      return 1;
    }
    return sum;
  };

  // Contribution of one dyn marker to a reference: its total when it
  // evaluates, 1 (with the appropriate warning) when cyclic or invalid.
  const dynContribution = (address, label, warnings) => {
    const stackIdx = stack.indexOf(address);
    if (stackIdx >= 0) {
      // Back-edge: everything from the ref target up the stack is cyclic.
      for (const onCycle of stack.slice(stackIdx)) cyclic.add(onCycle);
      return 1;
    }
    const ref = evaluateDyn(address);
    if (!ref.valid) {
      warnings.push(`reference "${label}" is invalid (defaulted to 1)`);
      return 1;
    }
    if (ref.warnings.length) warnings.push(`references "${label}" which has warnings`);
    return ref.value;
  };

  const resolveDynWildcard = (refPath, warnings) => {
    let sum = 0;
    let found = false;
    for (const address of markers) {
      if (!matchTagPath(refPath, address.split(':'), { mode: 'open' })) continue;
      sum += dynContribution(address, `{dyn,${refPath}}`, warnings);
      found = true;
    }
    if (!found) {
      warnings.push(`no tags match "{dyn,${refPath}}" (defaulted to 1)`);
      return 1;
    }
    return sum;
  };

  const resolveReference = (refPath, scope, warnings) => {
    const isPattern = parsePattern(refPath).some(part => part.kind !== 'literal');
    if (scope === 'dyn') {
      if (isPattern) return resolveDynWildcard(refPath, warnings);
      if (!markers.has(refPath)) {
        warnings.push(`unresolved reference "{dyn,${refPath}}" (defaulted to 1)`);
        return 1;
      }
      return dynContribution(refPath, `{dyn,${refPath}}`, warnings);
    }
    if (isPattern) return resolveStaticWildcard(refPath, warnings);
    const plain = plainNumericAt(refPath);
    if (plain === null) {
      warnings.push(`unresolved reference "{${refPath}}" (defaulted to 1)`);
      return 1;
    }
    return plain;
  };

  function evaluateDyn(address) {
    const cached = results.get(address);
    if (cached) return cached;
    const rule = rules[address];
    if (!rule || rule.expression === null) {
      const result = {
        value: null,
        valid: false,
        warnings: [rule ? `broken rule — ${rule.error}` : `no rule for "${address}"`],
        expression: null,
      };
      results.set(address, result);
      return result;
    }
    // Rules are pre-validated by normalizeRulesConfig, so this parse succeeds.
    const { ast } = parseExpression(rule.expression);
    let warnings = [];
    stack.push(address);
    let exprValue = evaluateExpression(ast, (refPath, scope) => resolveReference(refPath, scope, warnings));
    stack.pop();
    if (cyclic.has(address)) {
      exprValue = 1;
      warnings = ['circular reference (defaulted to 1)'];
    } else if (!Number.isFinite(exprValue)) {
      exprValue = 1;
      warnings.push('non-finite result (defaulted to 1)');
    }
    const result = {
      value: exprValue + (plainNumericAt(address) ?? 0),
      valid: true,
      warnings,
      expression: rule.expression,
    };
    results.set(address, result);
    return result;
  }

  for (const address of markers) evaluateDyn(address);
  return results;
}

// Rewrites the dyn tags in one attribute list from an evaluation result map:
// valid → materialized total payload, invalid → payload stripped. Returns the
// original array when nothing changed (object-identity contract for React).
function reconcileList(attributes, results) {
  let changed = false;
  const next = (attributes ?? []).map(tag => {
    const parsed = parseTag(tag);
    if (parsed.modifier !== 'dyn') return tag;
    const address = parsed.segments.join(':').toLowerCase();
    const result = results.get(address);
    const rewritten = buildTag(parsed.segments, result?.valid ? result.value : null, 'dyn');
    if (rewritten !== tag) changed = true;
    return rewritten;
  });
  return changed ? next : attributes;
}

/**
 * Materializes every dyn tag payload across the whole game state: agents
 * (attributes, evaluated over their effective attributes so bound-item
 * bonuses fold in), items (attributes), and tasks (attributes +
 * requirements, evaluated together). Pure; preserves object identity for
 * untouched entities so the reducer can no-op on an unchanged state.
 *
 * @param {GameState} state
 * @param {ReturnType<import('./rulesConfig.js').normalizeRulesConfig>} rulesConfig
 * @returns {{ state: GameState, changed: boolean }}
 */
export function reconcileDynamicTags(state, rulesConfig) {
  const registry = state.tagRegistry;
  let changed = false;

  const agents = (state.agents ?? []).map(agent => {
    const effective = getEffectiveAttributes(agent.attributes ?? [], agent.activities ?? [], state.inventory ?? []);
    const attributes = reconcileList(agent.attributes, evaluateDynamicTags(effective, rulesConfig, registry));
    if (attributes === agent.attributes) return agent;
    changed = true;
    return { ...agent, attributes };
  });

  const inventory = (state.inventory ?? []).map(item => {
    const attributes = reconcileList(item.attributes, evaluateDynamicTags(item.attributes ?? [], rulesConfig, registry));
    if (attributes === item.attributes) return item;
    changed = true;
    return { ...item, attributes };
  });

  const tasks = (state.tasks ?? []).map(task => {
    const results = evaluateDynamicTags(
      [...(task.attributes ?? []), ...(task.requirements ?? [])],
      rulesConfig,
      registry,
    );
    const attributes = reconcileList(task.attributes, results);
    const requirements = reconcileList(task.requirements, results);
    if (attributes === task.attributes && requirements === task.requirements) return task;
    changed = true;
    return { ...task, attributes, requirements };
  });

  return changed ? { state: { ...state, agents, inventory, tasks }, changed } : { state, changed };
}

/**
 * Unions dyn-tag warnings per address across every object in the game state —
 * the tag registry modal's data source for warn-flagging registry rows.
 *
 * @param {GameState} state
 * @param {ReturnType<import('./rulesConfig.js').normalizeRulesConfig>} rulesConfig
 * @returns {Map<string, string[]>} Lowercase address → deduped warning messages
 */
export function collectDynTagWarnings(state, rulesConfig) {
  const out = new Map();
  const merge = (attributes) => {
    for (const [address, result] of evaluateDynamicTags(attributes, rulesConfig, state.tagRegistry)) {
      if (result.valid && !result.warnings.length) continue;
      const list = out.get(address) ?? [];
      for (const message of result.warnings) {
        if (!list.includes(message)) list.push(message);
      }
      out.set(address, list);
    }
  };
  for (const agent of state.agents ?? []) {
    merge(getEffectiveAttributes(agent.attributes ?? [], agent.activities ?? [], state.inventory ?? []));
  }
  for (const item of state.inventory ?? []) merge(item.attributes ?? []);
  for (const task of state.tasks ?? []) merge([...(task.attributes ?? []), ...(task.requirements ?? [])]);
  return out;
}
