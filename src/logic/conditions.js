// Conditions: structured progress subcategories attached to tasks. A condition
// is NOT a tag — it references the tag registry through an abstract path
// (`tracker.tagPath`) and tracks its own `progress` toward a numeric `target`.
// Trackers are modular: each `tracker.kind` maps to a contribution function in
// TRACKER_REGISTRY, so future event- or rule-driven trackers plug in here
// without touching the clock loop.

import { parseTag } from './tags.js';
import { matchTagPath } from './tagMatching.js';
import { uid } from '../utils.js';

/**
 * @typedef {object} ConditionTracker
 * @property {string} kind - Tracker kind; key into `TRACKER_REGISTRY` (currently only `'work'`)
 * @property {string|null} tagPath - Pattern path matched (exact mode) against agent
 *   attribute tags via `logic/tagMatching.js` (e.g. `'skill:arcana'`, `'skill:*'`),
 *   or `null` to accept any assigned agent
 */

/**
 * @typedef {object} ConditionTemplate
 * @property {string} name - Display label (uppercase by convention)
 * @property {number} target - Required progress total; always > 0
 * @property {ConditionTracker} tracker
 */

/** @typedef {ConditionTemplate & { id: string, progress: number }} Condition */

/**
 * `'work'` tracker: per-tick contribution of one assigned agent to a condition.
 *
 * The tag link is matched in the engine's `'exact'` mode (`logic/tagMatching.js`):
 * the pattern must align with an agent attribute's full segment path, pairwise
 * (modifier tags excluded). `tagPath: 'skill'` matches only a literal
 * `skill=value` tag — `skill:arcana=3` does NOT satisfy it. As a pattern, the
 * link may use `*` segment passes (`'skill:*'` matches any specific skill);
 * other match modes are wired in the engine for future tracker options.
 *
 * Rates:
 * - `tagPath: null` → base rate `workRate * stepDays` (any agent contributes)
 * - matched tag with numeric value → `(workRate + value * skillBonus) * stepDays`
 * - matched tag without a value → base rate
 * - no matching tag → 0 (the agent does not contribute to this condition)
 *
 * @param {Condition} condition
 * @param {{ effectiveAttributes: string[], session: Session, stepDays: number }} context
 * @returns {number} Progress units contributed this tick
 */
function workContribution(condition, { effectiveAttributes, session, stepDays }) {
  const workRate   = session.workRate   ?? 1;
  const skillBonus = session.skillBonus ?? 1;
  const tagPath = condition.tracker.tagPath;
  if (!tagPath) return workRate * stepDays;

  const match = effectiveAttributes
    .map(tag => parseTag(tag))
    .find(parsed => !parsed.modifier && matchTagPath(tagPath, parsed.segments, { mode: 'exact' }));
  if (!match) return 0;

  const value = parseFloat(match.value);
  if (!Number.isFinite(value)) return workRate * stepDays;
  return (workRate + value * skillBonus) * stepDays;
}

/**
 * Maps `tracker.kind` to its contribution function — the extension point for
 * future progress trackers (event counters, rule evaluators, …). Each function
 * receives `(condition, context)` and returns the progress units one agent
 * contributes in one tick.
 *
 * @type {{ [kind: string]: (condition: Condition, context: object) => number }}
 */
export const TRACKER_REGISTRY = {
  work: workContribution,
};

/**
 * Computes one agent's per-tick contribution to a condition by dispatching to
 * the tracker registered for `condition.tracker.kind`. Unknown kinds contribute 0.
 *
 * @param {Condition} condition
 * @param {{ effectiveAttributes: string[], session: Session, stepDays: number }} context
 * @returns {number} Progress units contributed this tick
 */
export function computeConditionContribution(condition, context) {
  const tracker = TRACKER_REGISTRY[condition.tracker?.kind];
  return tracker ? tracker(condition, context) : 0;
}

/**
 * Derives a display name from a tag path: the last segment, uppercased, with
 * underscores/hyphens rendered as spaces. A null path falls back to `'WORK'`.
 *
 * @param {string|null} tagPath
 * @returns {string}
 */
export function defaultConditionName(tagPath) {
  if (!tagPath) return 'WORK';
  const segments = tagPath.split(':').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return (last.replace(/[_-]/g, ' ') || 'WORK').toUpperCase();
}

/**
 * Builds a sanitized condition template from loose input.
 * `tagPath` is trimmed and lowercased (empty → null); a non-positive or
 * non-numeric `target` falls back to 1; a blank `name` falls back to
 * `defaultConditionName(tagPath)`.
 *
 * @param {{ name?: string, target?: number|string, tagPath?: string|null, kind?: string }} input
 * @returns {ConditionTemplate}
 */
export function createConditionTemplate({ name, target, tagPath, kind = 'work' } = {}) {
  const path = typeof tagPath === 'string' && tagPath.trim() ? tagPath.trim().toLowerCase() : null;
  const targetNumber = Number(target);
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : defaultConditionName(path),
    target: Number.isFinite(targetNumber) && targetNumber > 0 ? targetNumber : 1,
    tracker: { kind: typeof kind === 'string' && kind ? kind : 'work', tagPath: path },
  };
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

/**
 * Returns a copy of `conditions` with all progress reset to 0 (ids preserved).
 * Used when a completed task is reset.
 *
 * @param {Condition[]} conditions
 * @returns {Condition[]}
 */
export function resetConditions(conditions) {
  return (conditions || []).map(condition => ({ ...condition, progress: 0 }));
}
