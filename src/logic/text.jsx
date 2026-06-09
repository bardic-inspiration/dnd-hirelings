/**
 * Wraps the first occurrence of `query` within `name` in a highlight-colored span.
 * Matching is case-insensitive. Returns `name` as-is when `query` is empty or not found.
 * Used by icon pickers and library list rows to highlight search matches.
 *
 * @param {string} name - Display string to search within
 * @param {string} query - Search term
 * @returns {string | JSX.Element}
 */
export function highlight(name, query) {
  if (!query) return name;
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <span style={{ color: 'var(--highlight)' }}>{name.slice(idx, idx + query.length)}</span>
      {name.slice(idx + query.length)}
    </>
  );
}
