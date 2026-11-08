// The stored task shape of the task engine (docs/spec/task-engine.md
// "Shapes", "Migration"): lowering legacy conditions and results into
// operators, vessels, completion effects, and the blackboard; the derived
// condition and results views the task card renders; and the sugar edits the
// condition and results controls dispatch.

import { normalizeCondition, conditionFromTemplate } from './conditions.js';
import { matchTagValue } from './tagMatching.js';

/** The contribute expression every lowered `work` condition uses. */
export const WORK_EXPRESSION = '{session:workRate} + {value} * {session:skillBonus}';

/** Action kinds the results view reads from, and `setResults` rewrites. */
const RESULT_KINDS = new Set(['bank.adjust', 'inventory.add', 'agent.spawn']);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Guards a raw `results` struct (legacy saves, sugar edits): gold a finite
 * number, items `{ name, quantity }` with a name, agents `{ template, quantity }`.
 *
 * @param {object} raw
 * @returns {{ gold: number, items: { name: string, quantity: number }[],
 *   agents: { template: object, quantity: number }[] }}
 */
export function normalizeResults(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const gold = Number(source.gold);
  return {
    gold: Number.isFinite(gold) ? gold : 0,
    items: Array.isArray(source.items)
      ? source.items.map(item => ({
          name: String(item?.name ?? ''),
          quantity: Number(item?.quantity ?? item?.qty) || 0,
        })).filter(item => item.name)
      : [],
    agents: Array.isArray(source.agents)
      ? source.agents.map(spawn => ({
          template: {
            name:        spawn?.template?.name        ?? 'NEW HIRELING',
            icon:        spawn?.template?.icon        ?? '',
            rate:        spawn?.template?.rate        ?? 1,
            rateUnit:    spawn?.template?.rateUnit    ?? 'GP/DAY',
            description: spawn?.template?.description ?? '',
            attributes:  Array.isArray(spawn?.template?.attributes) ? spawn.template.attributes : [],
          },
          quantity: Number(spawn?.quantity ?? spawn?.qty) || 1,
        }))
      : [],
  };
}

/**
 * Lowers one normalized condition: a `gate` on its tag link (when it has
 * one) and a `contribute` into a vessel keyed by the condition id, whose fill
 * starts at the condition's progress. An unknown tracker kind lowers to an
 * inert `write` operator carrying its tracker, so nothing is dropped.
 *
 * @param {Condition} condition
 * @returns {{ operators: object[], vessel: { name: string, fullWhen: string }, fill: number }}
 */
export function lowerCondition(condition) {
  const { id, name, target, progress, tracker } = condition;
  const operators = [];
  if (tracker.kind === 'work') {
    if (tracker.tagPath) {
      operators.push({ id: `${id}-gate`, kind: 'gate', read: tracker.tagPath, ...(tracker.compare ? { compare: tracker.compare } : {}) });
    }
    operators.push({ id, kind: 'contribute', target: id, expr: WORK_EXPRESSION });
  } else {
    operators.push({ id, kind: 'write', payload: tracker });
  }
  return { operators, vessel: { name, fullWhen: `>= ${target}` }, fill: progress };
}

/**
 * Lowers a results struct to completion actions, in payout order. Values are
 * taken as given, so `resultsView` reads them back unchanged.
 *
 * @param {{ gold?: number, items?: object[], agents?: object[] }} results
 * @returns {{ kind: string, params: object }[]}
 */
export function lowerResults(results) {
  const actions = [];
  const gold = Number(results.gold) || 0;
  if (gold !== 0) actions.push({ kind: 'bank.adjust', params: { amount: gold } });
  for (const item of results.items ?? []) {
    actions.push({ kind: 'inventory.add', params: { name: item.name, quantity: item.quantity } });
  }
  for (const spawn of results.agents ?? []) {
    actions.push({ kind: 'agent.spawn', params: { template: spawn.template, quantity: spawn.quantity } });
  }
  return actions;
}

function normalizeOperators(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((op, index) => {
    if (!isPlainObject(op) || typeof op.kind !== 'string' || !op.kind) return [];
    return [{ ...op, id: typeof op.id === 'string' && op.id ? op.id : `op-${index}` }];
  });
}

function normalizeVessels(raw) {
  if (!isPlainObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).map(([key, vessel]) => {
    const source = isPlainObject(vessel) ? vessel : {};
    return [key, {
      ...source,
      fullWhen: typeof source.fullWhen === 'string' && source.fullWhen ? source.fullWhen : '>= 1',
    }];
  }));
}

function normalizeActions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(action => (isPlainObject(action) && typeof action.kind === 'string' && action.kind
    ? [{ kind: action.kind, params: isPlainObject(action.params) ? action.params : {} }]
    : []));
}

function normalizeEffects(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(effect => (isPlainObject(effect) && typeof effect.on === 'string'
    ? [{ on: effect.on, actions: normalizeActions(effect.actions) }]
    : []));
}

const BLACKBOARD_TYPES = new Set(['number', 'string', 'boolean']);

function normalizeBlackboard(raw) {
  if (!isPlainObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => BLACKBOARD_TYPES.has(typeof value)));
}

/**
 * Brings a task to the stored engine shape. Guards `operators`, `vessels`,
 * `effects`, `blackboard`, and `duration`; lowers any legacy `conditions`
 * (skipping one whose vessel already exists) and `results`; and drops both
 * fields. Idempotent. Other task fields pass through untouched.
 *
 * @param {object} raw - A task in either shape
 * @returns {Task}
 */
export function lowerTask(raw) {
  const { conditions, results, ...rest } = raw;
  const operators = normalizeOperators(rest.operators);
  const vessels = normalizeVessels(rest.vessels);
  const effects = normalizeEffects(rest.effects);
  const blackboard = normalizeBlackboard(rest.blackboard);
  for (const condition of Array.isArray(conditions) ? conditions.map(normalizeCondition) : []) {
    if (vessels[condition.id]) continue;
    const lowered = lowerCondition(condition);
    operators.push(...lowered.operators);
    vessels[condition.id] = lowered.vessel;
    blackboard[condition.id] = lowered.fill;
  }
  if (results !== undefined) {
    const actions = lowerResults(normalizeResults(results));
    if (actions.length) effects.push({ on: 'completion', actions });
  }
  return {
    ...rest,
    operators,
    vessels,
    effects,
    blackboard,
    duration: isPlainObject(rest.duration) ? rest.duration : null,
  };
}

const FULL_WHEN_RE = /^\s*(==|>=|<=|>|<)\s*(\S.*?)\s*$/;

/**
 * Parses a vessel's `fullWhen` (`'op value'`) into a comparison term.
 *
 * @param {string} fullWhen
 * @returns {{ op: string, value: string }|null} `null` when malformed
 */
export function parseFullWhen(fullWhen) {
  const match = String(fullWhen ?? '').match(FULL_WHEN_RE);
  return match ? { op: match[1], value: match[2] } : null;
}

/**
 * A vessel's fill: `task.blackboard[key]` as a number, 0 when absent.
 *
 * @param {Task} task
 * @param {string} key
 * @returns {number}
 */
export function vesselFill(task, key) {
  return Number(task.blackboard?.[key]) || 0;
}

/**
 * True when the vessel's `fullWhen` passes against its fill. A malformed
 * `fullWhen` is never full.
 *
 * @param {Task} task
 * @param {string} key
 * @returns {boolean}
 */
export function isVesselFull(task, key) {
  const term = parseFullWhen(task.vessels?.[key]?.fullWhen);
  return term !== null && matchTagValue(term, vesselFill(task, key));
}

/**
 * The keys of the vessels that count toward completion (`success` not false).
 *
 * @param {Task} task
 * @returns {string[]}
 */
export function successVesselKeys(task) {
  return Object.entries(task.vessels ?? {})
    .filter(([, vessel]) => vessel.success !== false)
    .map(([key]) => key);
}

/**
 * The numeric bound of a vessel's `fullWhen` — the bar's target. 0 when the
 * bound isn't numeric.
 *
 * @param {Task} task
 * @param {string} key
 * @returns {number}
 */
export function vesselTarget(task, key) {
  return Number(parseFullWhen(task.vessels?.[key]?.fullWhen)?.value) || 0;
}

/**
 * The task's vessels as the condition rows the card renders: id (the vessel
 * key), name, progress (the fill), target (the `fullWhen` bound), and the
 * tag link read back from the lowered `<key>-gate` operator.
 *
 * @param {Task} task
 * @returns {Condition[]}
 */
export function conditionsView(task) {
  const operators = task.operators ?? [];
  return Object.entries(task.vessels ?? {}).map(([key, vessel]) => {
    const gate = operators.find(op => op.id === `${key}-gate` && op.kind === 'gate');
    const write = operators.find(op => op.id === key && op.kind === 'write');
    const tracker = write?.payload ?? { kind: 'work', tagPath: gate?.read ?? null, compare: gate?.compare ?? null };
    return {
      id: key,
      name: vessel.name ?? key,
      progress: vesselFill(task, key),
      target: vesselTarget(task, key),
      tracker,
    };
  });
}

const completionEffects = (task) => (task.effects ?? []).filter(effect => effect.on === 'completion');

/**
 * The task's completion effects mapped back to `{ gold, items, agents }`:
 * every `bank.adjust` summed, every `inventory.add` and `agent.spawn` in
 * order. Other actions are not part of the view.
 *
 * @param {Task} task
 * @returns {{ gold: number, items: object[], agents: object[] }}
 */
export function resultsView(task) {
  const view = { gold: 0, items: [], agents: [] };
  for (const effect of completionEffects(task)) {
    for (const { kind, params } of effect.actions) {
      if (kind === 'bank.adjust') view.gold += Number(params.amount) || 0;
      if (kind === 'inventory.add') view.items.push({ name: params.name, quantity: params.quantity });
      if (kind === 'agent.spawn') view.agents.push({ template: params.template, quantity: params.quantity });
    }
  }
  return view;
}

/**
 * Applies a results-view edit (`TASK_UPDATE_RESULTS`): merges `changes` into
 * the view and rewrites the result kinds in the completion effects. The new
 * result actions lead the first completion effect; other actions keep their
 * place; a completion effect left empty is dropped.
 *
 * @param {Task} task
 * @param {{ gold?: number, items?: object[], agents?: object[] }} changes
 * @returns {Task}
 */
export function setResults(task, changes) {
  const resultActions = lowerResults({ ...resultsView(task), ...changes });
  let placed = false;
  const effects = (task.effects ?? []).flatMap(effect => {
    if (effect.on !== 'completion') return [effect];
    const kept = effect.actions.filter(action => !RESULT_KINDS.has(action.kind));
    const actions = placed ? kept : [...resultActions, ...kept];
    placed = true;
    return actions.length ? [{ ...effect, actions }] : [];
  });
  if (!placed && resultActions.length) effects.push({ on: 'completion', actions: resultActions });
  return { ...task, effects };
}

/**
 * Adds a condition from a template (`TASK_CONDITION_ADD`), lowered under a
 * fresh key with zero fill.
 *
 * @param {Task} task
 * @param {ConditionTemplate} template
 * @returns {Task}
 */
export function addCondition(task, template) {
  const condition = conditionFromTemplate(template);
  const lowered = lowerCondition(condition);
  return {
    ...task,
    operators: [...(task.operators ?? []), ...lowered.operators],
    vessels: { ...task.vessels, [condition.id]: lowered.vessel },
    blackboard: { ...task.blackboard, [condition.id]: 0 },
  };
}

/**
 * Edits a condition row (`TASK_CONDITION_UPDATE`): `name` renames the vessel,
 * `target` replaces the `fullWhen` bound (keeping its operator), `progress`
 * sets the fill.
 *
 * @param {Task} task
 * @param {string} key - The vessel key (condition id)
 * @param {{ name?: string, target?: number, progress?: number }} changes
 * @returns {Task}
 */
export function updateCondition(task, key, changes) {
  const vessel = task.vessels?.[key];
  if (!vessel) return task;
  const next = { ...vessel };
  if ('name' in changes) next.name = changes.name;
  if ('target' in changes) next.fullWhen = `${parseFullWhen(vessel.fullWhen)?.op ?? '>='} ${changes.target}`;
  const blackboard = 'progress' in changes ? { ...task.blackboard, [key]: changes.progress } : task.blackboard;
  return { ...task, vessels: { ...task.vessels, [key]: next }, blackboard };
}

/**
 * Removes a condition row (`TASK_CONDITION_REMOVE`): the vessel, its fill,
 * its lowered operators (`<key>`, `<key>-gate`), and any contribute into it.
 *
 * @param {Task} task
 * @param {string} key
 * @returns {Task}
 */
export function removeCondition(task, key) {
  const { [key]: _vessel, ...vessels } = task.vessels ?? {};
  const { [key]: _fill, ...blackboard } = task.blackboard ?? {};
  const operators = (task.operators ?? []).filter(op =>
    op.id !== key && op.id !== `${key}-gate` && !(op.kind === 'contribute' && op.target === key));
  return { ...task, operators, vessels, blackboard };
}

/**
 * The blackboard with every vessel's fill zeroed — how unchecking ✓ resets a
 * task. Other entries are kept.
 *
 * @param {Task} task
 * @returns {object}
 */
export function resetVessels(task) {
  const blackboard = { ...task.blackboard };
  for (const key of Object.keys(task.vessels ?? {})) blackboard[key] = 0;
  return blackboard;
}
