// Conditions: the authoring shape for task progress — a `target`, a
// `progress`, and a `tracker` linking it to agent tags through an abstract
// path (`tracker.tagPath`). A condition is NOT a tag. Tasks no longer store
// conditions: presets and the condition controls author them, and
// logic/taskModel.js lowers each one into a gate + contribute pair and a
// vessel (docs/spec/task-engine.md "Migration"). This module owns the
// template guards, the draft grammar, the display labels, and legacy `work`
// tag migration.

import { parseTag } from './tags.js';
import { formatPatternLabel, parsePattern, VALUE_COMPARE_REGISTRY } from './tagMatching.js';
import { uid } from '../utils.js';

/**
 * @typedef {object} ConditionTracker
 * @property {string} kind - Tracker kind: `'work'` (lowered to gate + contribute); any
 *   other kind lowers to an inert `write` operator carrying the tracker
 * @property {string|null} tagPath - Pattern path matched (open mode) against agent
 *   attribute tags via `logic/tagMatching.js` (e.g. `'skill:arcana'`, `'skill:*'`,
 *   `'skill:**'`), or `null` to accept any assigned agent
 * @property {{ op: string, value: string }|null} compare - Comparison applied to
 *   the display-resolved value of the path-matched tag (`logic/tagValues.js`),
 *   with `op` a key of `VALUE_COMPARE_REGISTRY`; `null` means no constraint
 */

// Guards a raw comparison term: requires a non-null path to compare against,
// a known operator, and a non-empty value (stored trimmed/lowercased, matching
// tagPath normalization). Anything malformed collapses to null.
function normalizeCompare(raw, path) {
  if (!path || !raw || typeof raw !== 'object') return null;
  const op = typeof raw.op === 'string' ? raw.op : '';
  const value = String(raw.value ?? '').trim().toLowerCase();
  if (!VALUE_COMPARE_REGISTRY[op] || !value) return null;
  return { op, value };
}

/**
 * @typedef {object} ConditionTemplate
 * @property {string} name - Display label (uppercase by convention)
 * @property {number} target - Required progress total; always > 0
 * @property {ConditionTracker} tracker
 */

/** @typedef {ConditionTemplate & { id: string, progress: number }} Condition */

// Display glyphs for comparison operators; unmapped operators render as-is.
const COMPARE_SYMBOLS = { '==': '=', '>=': '≥', '<=': '≤' };

/**
 * Derives a display name from a tag-link pattern, wildcard-aware:
 * - ends in a literal segment → that segment (`'skill:arcana'` → `'ARCANA'`,
 *   `'skill:**:fire'` → `'FIRE'`)
 * - ends in a wildcard → `'ANY '` + last literal (`'skill:*'` → `'ANY SKILL'`)
 * - no literal segments (`'*'`, `'**'`) → `'ANY'`
 * - null/empty path → `'WORK'`
 * A comparison term appends as `' ≥ 3'` (`'skill:arcana'` + `>=3` →
 * `'ARCANA ≥ 3'`). Underscores/hyphens render as spaces; output is uppercase.
 *
 * @param {string|null} tagPath
 * @param {{ op: string, value: string }|null} [compare]
 * @returns {string}
 */
export function defaultConditionName(tagPath, compare = null) {
  const suffix = compare ? ` ${COMPARE_SYMBOLS[compare.op] ?? compare.op} ${String(compare.value).toUpperCase()}` : '';
  if (!tagPath) return 'WORK';
  const parts = parsePattern(tagPath);
  if (!parts.length) return 'WORK';
  const pretty = (text) => text.replace(/[_-]/g, ' ').toUpperCase();
  const literals = parts.filter(part => part.kind === 'literal' && part.value);
  if (!literals.length) return `ANY${suffix}`;
  const lastLiteral = pretty(literals[literals.length - 1].value);
  return (parts[parts.length - 1].kind === 'literal' ? lastLiteral : `ANY ${lastLiteral}`) + suffix;
}

/**
 * Renders a condition's tag link for display: `'any agent'` for a null path,
 * else the pattern interpretation from `formatPatternLabel` plus the
 * comparison term when present (`'skill:*' + >=3` → `'skill:‹any› ≥ 3'`).
 *
 * @param {ConditionTracker|null|undefined} tracker
 * @returns {string}
 */
export function formatConditionLink(tracker) {
  const tagPath = tracker?.tagPath;
  if (!tagPath) return 'any agent';
  const label = formatPatternLabel(tagPath);
  const compare = tracker.compare;
  return compare ? `${label} ${COMPARE_SYMBOLS[compare.op] ?? compare.op} ${compare.value}` : label;
}

/**
 * Builds a sanitized condition template from loose input.
 * `tagPath` is trimmed and lowercased (empty → null); a non-positive or
 * non-numeric `target` falls back to 1; a blank `name` falls back to
 * `defaultConditionName(tagPath)`; a malformed `compare` (unknown operator,
 * empty value, or no path to compare against) collapses to null — which is
 * also how stored conditions predating the field normalize on load.
 *
 * @param {{ name?: string, target?: number|string, tagPath?: string|null, kind?: string, compare?: { op: string, value: string }|null }} input
 * @returns {ConditionTemplate}
 */
export function createConditionTemplate({ name, target, tagPath, kind = 'work', compare = null } = {}) {
  const path = typeof tagPath === 'string' && tagPath.trim() ? tagPath.trim().toLowerCase() : null;
  const compareTerm = normalizeCompare(compare, path);
  const targetNumber = Number(target);
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : defaultConditionName(path, compareTerm),
    target: Number.isFinite(targetNumber) && targetNumber > 0 ? targetNumber : 1,
    tracker: {
      kind: typeof kind === 'string' && kind ? kind : 'work',
      tagPath: path,
      compare: compareTerm,
    },
  };
}

// Splits a draft at the first unescaped comparison operator. The path group
// consumes escaped pairs first, so `\:`, `\*`, and even `\=` stay inside the
// path; it stops at the first unescaped `<`, `>`, or `=`. A single `=` is not
// an operator (it is the target delimiter), so `path=target` drafts fail this
// regex and fall through to the plain target split.
const OPERATOR_DRAFT_RE = /^((?:\\.|[^<>=])*)(==|>=|<=|>|<)(.*)$/s;

// Last-`=` target split: the suffix group cannot contain `=`, so it anchors to
// the final one; everything before it is the head.
const TARGET_DRAFT_RE = /^(.*?)(?:=([^=]*))?$/s;

/**
 * Splits a registry-modal condition draft into its three terms.
 *
 * Grammar: `path[op value][=target]` with operators `==`, `>=`, `<=`, `>`, `<`
 * — e.g. `'skill:arcana>=3=30'`, `'class==druid'`, `'skill:arcana=30'`,
 * `'=20'`. Bare equality is spelled `==` because a single `=` is the target
 * delimiter. Escape-safe: the path may carry pattern escapes (`\:`, `\*`) and
 * never round-trips through `parseTag`.
 *
 * @param {string} draft
 * @returns {{ path: string, compare: { op: string, value: string }|null, target: string|null }}
 *   Raw (unvalidated) terms; `createConditionTemplate` applies the guards
 */
export function splitConditionDraft(draft) {
  const text = String(draft ?? '').trim();
  const operatorMatch = text.match(OPERATOR_DRAFT_RE);
  if (!operatorMatch) {
    const plain = text.match(TARGET_DRAFT_RE);
    return { path: plain[1], compare: null, target: plain[2] ?? null };
  }
  const remainder = operatorMatch[3].match(TARGET_DRAFT_RE);
  return {
    path: operatorMatch[1],
    compare: { op: operatorMatch[2], value: remainder[1] },
    target: remainder[2] ?? null,
  };
}

/**
 * Builds a condition template from a registry-modal draft string of the form
 * `path[op value][=target]` (see `splitConditionDraft`). Name, target, and
 * compare defaults/guards come from `createConditionTemplate` (target 1, name
 * via `defaultConditionName`, malformed compare → null).
 *
 * @param {string} draft
 * @returns {ConditionTemplate}
 */
export function conditionTemplateFromDraft(draft) {
  const { path, compare, target } = splitConditionDraft(draft);
  return createConditionTemplate({ tagPath: path, target, compare });
}

/**
 * Guards a raw condition template from storage or a preset file.
 * Any malformed field falls back to its `createConditionTemplate` default.
 *
 * @param {object} raw
 * @returns {ConditionTemplate}
 */
export function normalizeConditionTemplate(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return createConditionTemplate({
    name:    source.name,
    target:  source.target,
    tagPath: source.tracker?.tagPath,
    kind:    source.tracker?.kind,
    compare: source.tracker?.compare,
  });
}

/**
 * Stamps a template into a live condition instance with a fresh `id` and zero
 * `progress`. Also re-stamps existing conditions (id/progress are discarded),
 * which is how duplication resets them.
 *
 * @param {ConditionTemplate|Condition} template
 * @returns {Condition}
 */
export function conditionFromTemplate(template) {
  return { id: uid(), progress: 0, ...normalizeConditionTemplate(template) };
}

/**
 * Guards a raw condition instance from storage: template fields are sanitized
 * and `id`/`progress` are preserved when valid.
 *
 * @param {object} raw
 * @returns {Condition}
 */
export function normalizeCondition(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const progress = Number(source.progress);
  return {
    id: typeof source.id === 'string' && source.id ? source.id : uid(),
    progress: Number.isFinite(progress) && progress > 0 ? progress : 0,
    ...normalizeConditionTemplate(source),
  };
}

/**
 * Migrates legacy `work:*` tag strings to condition templates:
 * `work=5` → tagPath null, `work:skill=8` → `'skill'`,
 * `work:skill:arcana=10` → `'skill:arcana'`. Names derive from the tag path.
 * Tags with a non-positive or missing target, and non-`work` tags, are skipped.
 * A leading legacy `#` sigil is tolerated.
 *
 * @param {string[]} workTags - Legacy `task.work` tag strings
 * @returns {ConditionTemplate[]}
 */
export function migrateLegacyWorkTemplates(workTags) {
  const templates = [];
  for (const tag of workTags || []) {
    if (typeof tag !== 'string') continue;
    const parsed = parseTag(tag.startsWith('#') ? tag.slice(1) : tag);
    if (parsed.segments[0]?.toLowerCase() !== 'work') continue;
    const target = parseFloat(parsed.value);
    if (!(target > 0)) continue;
    templates.push(createConditionTemplate({ target, tagPath: parsed.segments.slice(1).join(':') || null }));
  }
  return templates;
}

/**
 * Migrates legacy `task.work` tags plus their `task.workProgress` map to live
 * condition instances. Progress is looked up by the legacy bucket key (the
 * sub-path after `work`, `''` for a bare `work` tag).
 *
 * @param {string[]} workTags - Legacy `task.work` tag strings
 * @param {{ [key: string]: number }} [workProgress] - Legacy progress buckets
 * @returns {Condition[]}
 */
export function migrateLegacyWork(workTags, workProgress = {}) {
  return migrateLegacyWorkTemplates(workTags).map(template => {
    const stored = parseFloat(workProgress?.[template.tracker.tagPath ?? '']);
    return { ...conditionFromTemplate(template), progress: stored > 0 ? stored : 0 };
  });
}
