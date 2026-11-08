// App paths — how the app names files it serves from `public/`.
//
// Data and constants write these as root-relative paths (`/assets/…`,
// `/config/…`, `/presets/…`), the same form saves and presets store. The site
// may be deployed under a sub-path (GitHub Pages serves it at
// `/dnd-hirelings/`, previews deeper still), so a path is resolved against the
// build's base only where it is handed to the browser — a fetch, a CSS url(),
// an <img>. Stored data never carries the base, so a save loads anywhere.

/**
 * Resolves a root-relative app path against a base path.
 *
 * Inputs: `path` — an app path such as `/assets/a.webp`, or any other URL;
 * `base` — the deploy base, with leading and trailing slash (`/`, `/x/`).
 * Returns: `base` joined to `path` when `path` starts with a single `/`;
 * anything else (data:, blob:, absolute or protocol-relative URLs, relative
 * paths, empty values) is returned unchanged.
 * Side effects: none.
 */
export function withBase(path, base) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return path;
  return base.replace(/\/$/, '') + path;
}

/**
 * Resolves a root-relative app path against this build's base
 * (`import.meta.env.BASE_URL`, set by Vite's `base` option).
 *
 * Inputs: `path` — as for `withBase`.
 * Returns: the URL the browser should request.
 * Side effects: none.
 */
export function publicUrl(path) {
  return withBase(path, import.meta.env.BASE_URL);
}
