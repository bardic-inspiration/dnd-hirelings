// Dynamic (`dyn,`) tag evaluation. A dynamic tag's payload is an arithmetic
// expression (logic/expressions.js) computed at the object level: references
// resolve only against tags carried by the same object. This module owns the
// resolution policy the expression engine delegates:
//
// - literal ref `{ability:dex}` — the object's tag at that exact path. A dyn
//   tag at the path contributes its combined value (see below); otherwise the
//   first plain tag with a numeric value. Missing/non-numeric → default 1 +
//   warning.
// - wildcard ref `{class:*}` — SUM of numeric values over all matching plain
//   tags (open-mode glob, logic/tagMatching.js). Zero numeric matches →
//   default 1 + warning.
// - dyn→dyn chaining — evaluated in dependency order, each tag once per call.
//   Cycles (including self-reference) collapse every tag on the cycle to
//   default 1 + warning; tags outside the cycle that reference one inherit a
//   transitive warning.
// - a plain tag sharing a dyn tag's path ADDS to the expression result
//   (`dyn,ac=<expr>` + `ac=2` → expr+2). Bound-item `bonus,` tags inject
//   plain tags (logic/agents.js getEffectiveAttributes), so bonuses stack
//   onto computed stats through the same rule.

import { parseTag } from './tags.js';
import { resolveTagValue } from './tagValues.js';
import { parsePattern, matchTagPath } from './tagMatching.js';
import { parseExpression, evaluateExpression } from './expressions.js';
import { getEffectiveAttributes } from './agents.js';

/**
 * @typedef {object} DynResult
 * @property {number|null} value - Combined stat: `exprValue` plus the numeric
 *   value of a plain tag at the same path (0 when absent). `null` when invalid.
 * @property {number|null} exprValue - The expression result alone (chip display).
 * @property {string} expression - Raw expression text (hover/edit surface).
 * @property {boolean} valid - `false` only when the expression fails to parse.
 * @property {string[]} warnings - Defaulted references, cycles, non-finite
 *   results, transitive flags — and the parse error when `valid` is false.
 *   A non-empty list with `valid: true` renders the warn (not invalid) state.
 */

/**
 * Evaluates every `dyn,` tag in an attribute list. Entity-generic: pass any
 * object's effective tag list (agent effective attributes, item attributes,
 * task attributes + requirements).
 *
 * @param {string[]} effectiveAttributes - The object's tag strings, with
 *   bound-item bonuses already applied for agents (`getEffectiveAttributes`)
 * @param {TagRegistry} registry - Live tag registry (bounds `numeric` resolution)
 * @returns {Map<string, DynResult>} Keyed by lowercase colon path
 */
export function evaluateDynamicTags(effectiveAttributes, registry) {
  const dynByPath = new Map();  // path → expression text
  const plainTags = [];         // { parsed, path } for modifier-less tags
  for (const tag of effectiveAttributes ?? []) {
    const parsed = parseTag(tag);
    const path = parsed.segments.join(':').toLowerCase();
    if (!path) continue;
    if (parsed.modifier === 'dyn') dynByPath.set(path, parsed.value ?? '');
    else if (!parsed.modifier) plainTags.push({ parsed, path });
  }

  const results = new Map();
  const stack = [];          // dyn paths currently evaluating (cycle detection)
  const cyclic = new Set();  // dyn paths confirmed on a cycle

  const plainNumericAt = (path) => {
    for (const { parsed, path: tagPath } of plainTags) {
      if (tagPath !== path) continue;
      const value = resolveTagValue('numeric', parsed, registry);
      if (value !== null) return value;
    }
    return null;
  };

  const resolveWildcard = (refPath, warnings) => {
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

  const resolveReference = (refPath, warnings) => {
    if (parsePattern(refPath).some(part => part.kind !== 'literal')) {
      return resolveWildcard(refPath, warnings);
    }
    if (dynByPath.has(refPath)) {
      const stackIdx = stack.indexOf(refPath);
      if (stackIdx >= 0) {
        // Back-edge: everything from the ref target up the stack is cyclic.
        for (const onCycle of stack.slice(stackIdx)) cyclic.add(onCycle);
        return 1;
      }
      const ref = evaluateDyn(refPath);
      if (!ref.valid) {
        warnings.push(`reference "{${refPath}}" is invalid (defaulted to 1)`);
        return 1;
      }
      if (ref.warnings.length) warnings.push(`references "{${refPath}}" which has warnings`);
      return ref.value;
    }
    const plain = plainNumericAt(refPath);
    if (plain === null) {
      warnings.push(`unresolved reference "{${refPath}}" (defaulted to 1)`);
      return 1;
    }
    return plain;
  };

  function evaluateDyn(path) {
    const cached = results.get(path);
    if (cached) return cached;
    const expression = dynByPath.get(path);
    const { ast, error } = parseExpression(expression);
    if (error) {
      const result = { value: null, exprValue: null, expression, valid: false, warnings: [`invalid expression — ${error}`] };
      results.set(path, result);
      return result;
    }
    let warnings = [];
    stack.push(path);
    let exprValue = evaluateExpression(ast, (refPath) => resolveReference(refPath, warnings));
    stack.pop();
    if (cyclic.has(path)) {
      exprValue = 1;
      warnings = ['circular reference (defaulted to 1)'];
    } else if (!Number.isFinite(exprValue)) {
      exprValue = 1;
      warnings.push('non-finite result (defaulted to 1)');
    }
    const result = {
      value: exprValue + (plainNumericAt(path) ?? 0),
      exprValue,
      expression,
      valid: true,
      warnings,
    };
    results.set(path, result);
    return result;
  }

  for (const path of dynByPath.keys()) evaluateDyn(path);
  return results;
}

/**
 * Unions dyn-tag warnings per path across every object in the game state —
 * the tag registry modal's data source for warn-flagging registry rows.
 * Agents evaluate over their effective attributes (bound-item bonuses
 * applied); items over their attributes; tasks over attributes + requirements.
 *
 * @param {GameState} state
 * @returns {Map<string, string[]>} Lowercase path → deduped warning messages
 */
export function collectDynTagWarnings(state) {
  const out = new Map();
  const merge = (attributes) => {
    for (const [path, result] of evaluateDynamicTags(attributes, state.tagRegistry)) {
      if (result.valid && !result.warnings.length) continue;
      const list = out.get(path) ?? [];
      for (const message of result.warnings) {
        if (!list.includes(message)) list.push(message);
      }
      out.set(path, list);
    }
  };
  for (const agent of state.agents ?? []) {
    merge(getEffectiveAttributes(agent.attributes ?? [], agent.activities ?? [], state.inventory ?? []));
  }
  for (const item of state.inventory ?? []) merge(item.attributes ?? []);
  for (const task of state.tasks ?? []) merge([...(task.attributes ?? []), ...(task.requirements ?? [])]);
  return out;
}
