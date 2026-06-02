// Shared text-rendering helpers for search lists.

// Wraps the substring of `name` matching `query` (case-insensitive) in a
// highlight span. Returns `name` unchanged when there's no query or no match.
// Used by the icon pickers and the library list rows.
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
