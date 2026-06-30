// Session persistence: save state to a JSON file (with native "Save As" dialog
// where supported), and load state from a user-selected JSON file.

import { downloadFile } from './download.js';

const SAVE_TYPES = [{ description: 'Hireling session', accept: { 'application/json': ['.json'] } }];

/**
 * Serializes the full game state to a JSON file via the shared `downloadFile`
 * helper (native Save As dialog where supported, `<a>.download` fallback
 * otherwise).
 *
 * @param {GameState} state
 * @returns {Promise<void>}
 */
export async function saveStateToFile(state) {
  const json = JSON.stringify(state, null, 2);
  const suggestedName = `hirelings-${state.session?.id || 'export'}.json`;
  await downloadFile(json, suggestedName, { mime: 'application/json', pickerTypes: SAVE_TYPES });
}

/**
 * Reads and validates a JSON session file. Rejects if the JSON is malformed or
 * if the root object lacks `session`, `agents`, or `tasks` fields.
 * The caller must pass the result through `normalizeState` before dispatching.
 *
 * @param {File} file
 * @returns {Promise<object>} Raw (un-normalized) game state object
 */
export function loadStateFromFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data.session || !Array.isArray(data.agents) || !Array.isArray(data.tasks)) {
          reject(new Error('File does not contain valid hireling data.'));
          return;
        }
        resolve(data);
      } catch (err) {
        reject(new Error('Invalid JSON: ' + err.message));
      }
    };
    r.onerror = () => reject(new Error('Failed to read file.'));
    r.readAsText(file);
  });
}
