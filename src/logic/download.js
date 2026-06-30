// Shared file-download helper. Browsers can't stream-append to disk, so every
// "save to file" feature writes a whole blob at once. This centralizes the
// native "Save As" dialog (File System Access API) with a programmatic
// `<a>.download` fallback so callers (session export, event-log export, …) don't
// each re-implement it.

/**
 * Writes `contents` to a file the user chooses (or downloads it directly on
 * browsers without the File System Access API). Tries the native Save As dialog
 * first; falls back to a programmatic `<a>.download`. Silently no-ops if the
 * user cancels the dialog (AbortError).
 *
 * @param {string|Blob} contents - File body
 * @param {string} suggestedName - Default filename (with extension)
 * @param {{ mime?: string, pickerTypes?: Array<object> }} [options]
 *   `mime` is the blob/MIME type for the download fallback (default
 *   `'application/octet-stream'`); `pickerTypes` is the `types` array passed to
 *   `showSaveFilePicker` (file-kind descriptions/accept maps).
 * @returns {Promise<void>}
 */
export async function downloadFile(contents, suggestedName, { mime = 'application/octet-stream', pickerTypes } = {}) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: pickerTypes });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Fall through to the download fallback on any other failure.
    }
  }

  const blob = contents instanceof Blob ? contents : new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
