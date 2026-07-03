import { useRef, useEffect } from 'react';

/**
 * Click-to-edit inline text span (contenteditable). Selects all content on
 * focus, commits the trimmed text via `onCommit` on blur or Enter, and
 * restores the original text on Escape. The React `value` prop only syncs to
 * the DOM while the span is not focused, so in-progress edits are never
 * clobbered by re-renders or RAF writes.
 *
 * @param {object} props
 * @param {string} props.value - Current text content
 * @param {(value: string) => void} props.onCommit - Called with the trimmed text when it changed
 * @param {string} [props.className]
 * @param {string} [props.placeholder] - Rendered via CSS `data-placeholder` when empty
 * @param {(e: FocusEvent) => void} [props.onFocus] - Composed with (runs before) the
 *   internal select-all-on-focus; lets a `Tooltip` wrapper hook focus without clobbering it
 * @param {(e: FocusEvent) => void} [props.onBlur] - Composed with (runs before) the
 *   internal commit-on-blur
 * Remaining props (e.g. `data-*` attributes) are forwarded onto the span.
 */
export default function EditableSpan({ value, onCommit, className, placeholder, onFocus, onBlur, ...rest }) {
  const ref = useRef(null);
  const originalRef = useRef(value || '');

  // Sync value to DOM only when not focused
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.textContent = value || '';
    }
  }, [value]);

  const handleFocus = (e) => {
    onFocus?.(e); // e.g. a Tooltip anchor's focus handler
    originalRef.current = ref.current.textContent;
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ref.current.blur(); }
    if (e.key === 'Escape') { ref.current.textContent = originalRef.current; ref.current.blur(); }
  };

  const handleBlur = (e) => {
    onBlur?.(e); // e.g. a Tooltip anchor's blur handler
    const v = ref.current.textContent.trim();
    if (v !== originalRef.current) onCommit(v);
  };

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className={className}
      data-placeholder={placeholder}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={e => e.stopPropagation()}
      {...rest}
    >
      {value || ''}
    </span>
  );
}
