// Preset file I/O for the library/builder modals. Mirrors the session save/load
// pattern in session.js, but operates on preset objects/arrays rather than full
// game state. Loading is deliberately lenient: callers normalize and skip
// invalid entries, so a malformed file degrades gracefully instead of failing.

const SAVE_TYPES = [{ description: 'Hireling presets', accept: { 'application/json': ['.json'] } }];

// Strip library bookkeeping (id, source) before export so files stay portable.
function exportable(preset) {
  const { id, source, ...rest } = preset;
  return rest;
}

async function writeJson(data, suggestedName) {
  const json = JSON.stringify(data, null, 2);

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

// Save a single preset as a one-entry .json file.
export function savePresetToFile(preset, type = 'preset') {
  const name = (preset?.name || type).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return writeJson(exportable(preset), `${type}-${name}.json`);
}

// Save the currently filtered list of presets as a .json array.
export function savePresetListToFile(presets, type = 'preset') {
  return writeJson(presets.map(exportable), `${type}-presets.json`);
}

// Read presets from a user-selected file. Always resolves to an array (possibly
// empty); never rejects on bad content. A lone object is wrapped as a single
// entry; anything unparseable yields [].
export function loadPresetsFromFile(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (Array.isArray(data)) resolve(data);
        else if (data && typeof data === 'object') resolve([data]);
        else resolve([]);
      } catch {
        resolve([]);
      }
    };
    r.onerror = () => resolve([]);
    r.readAsText(file);
  });
}
