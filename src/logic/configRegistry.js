// Config file manifest — the single registration point for every config
// surface the Configuration Modal edits. Two kinds:
//
//   kind: 'file'   a runtime YAML asset under public/config/, fetched by
//                  ConfigContext and shadowed by a localStorage overlay
//   kind: 'state'  a virtual section bound to live game state via `binding`
//                  (no fetch, no overlay — the reducer is its storage)
//
// Adding a config file = one entry here + a schema (see logic/configEditor.js
// for the descriptor grammar). Bindings keep the manifest pure: `effects` maps
// keys to effect NAMES, which the modal host resolves to callbacks.

import { CARD_UI_SCHEMA } from './cardUI.js';

/**
 * Schema for the SESSION section (state-bound): the game-speed numbers the old
 * SETTINGS modal edited. `min` keeps the clock math sane (a zero or negative
 * rateMultiplier would stall or reverse time); workRate/skillBonus may be 0.
 */
export const SESSION_SCHEMA = {
  kind: 'map',
  closed: true,
  keys: {
    rateMultiplier: { kind: 'scalar', value: 'number', min: 0.1, step: 0.1, label: 'TIME RATE' },
    workRate:       { kind: 'scalar', value: 'number', min: 0,   step: 0.1, label: 'WORK RATE' },
    skillBonus:     { kind: 'scalar', value: 'number', min: 0,   step: 0.1, label: 'SKILL BONUS' },
  },
};

/**
 * Every config surface the Configuration Modal edits, in display order.
 *
 * Entry shape:
 * - `id` — stable key (overlay storage, SAVE filename)
 * - `label` — section heading in the modal tree
 * - `kind` — `'file'` (fetched YAML + overlay) or `'state'` (game-state binding)
 * - `url` — fetch path for `kind: 'file'` entries
 * - `schema` — descriptor driving autocomplete and soft warnings
 * - `binding` — for `kind: 'state'`: `select(state)` reads the section's doc,
 *   `commit(dispatch, key, value)` writes one value back, `effects` maps keys
 *   to effect names the modal host resolves (e.g. `'restartPlay'`), `defaults`
 *   is the RESET payload (mirrors DEFAULT_STATE.session).
 */
export const CONFIG_FILES = [
  {
    id: 'session',
    label: 'SESSION',
    kind: 'state',
    schema: SESSION_SCHEMA,
    binding: {
      select: (state) => ({
        rateMultiplier: state.session.rateMultiplier,
        workRate: state.session.workRate,
        skillBonus: state.session.skillBonus,
      }),
      commit: (dispatch, key, value) => dispatch({ type: 'SESSION_UPDATE', payload: { [key]: value } }),
      effects: { rateMultiplier: 'restartPlay' },
      defaults: { rateMultiplier: 1, workRate: 1, skillBonus: 1 },
    },
  },
  {
    id: 'cardUI',
    label: 'CARD UI',
    kind: 'file',
    url: '/config/cardUI.yml',
    schema: CARD_UI_SCHEMA,
  },
];

/**
 * Looks up a manifest entry by id.
 *
 * @param {string} id - Config file id (e.g. `'cardUI'`)
 * @returns {object|null}
 */
export function configFileById(id) {
  return CONFIG_FILES.find(entry => entry.id === id) ?? null;
}
