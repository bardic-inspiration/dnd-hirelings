// Session persistence: save state to a JSON file (with native "Save As" dialog
// where supported), and load state from a user-selected JSON file.

const SAVE_TYPES = [{ description: 'Hireling session', accept: { 'application/json': ['.json'] } }];

/**
 * Serializes the full game state to a JSON file via the native Save As dialog
 * (File System Access API). Falls back to a programmatic `<a>.download` on
 * browsers that don't support `showSaveFilePicker`. Silently no-ops if the user
 * cancels the dialog (AbortError).
 *
 * @param {GameState} state
 * @returns {Promise<void>}
 */
export async function saveStateToFile(state) {
  const json = JSON.stringify(state, null, 2);
  const suggestedName = `hirelings-${state.session?.id || 'export'}.json`;

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: SAVE_TYPES });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Fall through to download fallback on any other failure.
    }
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
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
