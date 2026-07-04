import { useRef, useEffect } from 'react';
import { truncateEnd } from '../logic/truncation.js';

/**
 * Click-to-edit inline text span (contenteditable). Selects all content on
 * focus, commits the trimmed text via `onCommit` on blur or Enter, and
 * restores the original text on Escape. The React `value` prop only syncs to
 * the DOM while the span is not focused, so in-progress edits are never
 * clobbered by re-renders or RAF writes.
 *
 * Display vs. edit text: while unfocused the span shows the value passed through
 * `format` (e.g. compact number shorthand) and truncated to `maxChars` (end
 * ellipsis); on focus it reveals the full raw value so the user always edits the
 * real string, and re-formats/re-truncates on blur.
 *
 * @param {object} props
 * @param {string} props.value - Current text content
 * @param {(value: string) => void} props.onCommit - Called with the trimmed text when it changed
 * @param {string} [props.className]
 * @param {string} [props.placeholder] - Rendered via CSS `data-placeholder` when empty
 * @param {(text: string) => string} [props.format] - Maps the raw value to its unfocused
 *   display text (e.g. `formatCount` for large numbers); editing always shows the raw value
 * @param {number} [props.maxChars=Infinity] - Character budget for the unfocused display
 *   (usually from `useCharBudget`); the full value is always shown while editing
 * @param {boolean} [props.singleLine=false] - Forbid line breaks: Enter always commits
 *   (Shift+Enter included) and pasted/committed whitespace collapses to single spaces
 * @param {(element: HTMLElement|null) => void|{current: HTMLElement|null}} [props.innerRef] -
 *   Ref forwarded onto the span (e.g. a `useCharBudget` measuring ref)
 * @param {(e: FocusEvent) => void} [props.onFocus] - Composed with (runs before) the
 *   internal select-all-on-focus; lets a `Tooltip` wrapper hook focus without clobbering it
 * @param {(e: FocusEvent) => void} [props.onBlur] - Composed with (runs before) the
 *   internal commit-on-blur
 * Remaining props (e.g. `data-*` attributes) are forwarded onto the span.
 */
export default function EditableSpan({ value, onCommit, className, placeholder, format = (text) => text, maxChars = Infinity, singleLine = false, innerRef, onFocus, onBlur, ...rest }) {
  const ref = useRef(null);
  const originalRef = useRef(value || '');

  // Merge the internal ref with a forwarded one (callback or object).
  const setRef = (element) => {
    ref.current = element;
    if (typeof innerRef === 'function') innerRef(element);
    else if (innerRef) innerRef.current = element;
  };

  // Unfocused display: raw value formatted (e.g. number shorthand) then truncated.
  const displayText = truncateEnd(format(value || ''), maxChars).text;

  // Sync the truncated display to the DOM only when not focused (an in-progress
  // edit already holds the full value and must not be clobbered).
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.textContent = displayText;
    }
  }, [displayText]);

  const handleFocus = (e) => {
    onFocus?.(e); // e.g. a Tooltip anchor's focus handler
    ref.current.textContent = value || ''; // reveal the full value for editing
    originalRef.current = ref.current.textContent;
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const handleKeyDown = (e) => {
    // Shift+Enter inserts a newline in multi-line spans; single-line spans treat
    // every Enter as commit, so no line break ever reaches the content.
    if (e.key === 'Enter' && (singleLine || !e.shiftKey)) { e.preventDefault(); ref.current.blur(); }
    if (e.key === 'Escape') { ref.current.textContent = originalRef.current; ref.current.blur(); }
  };

  // Strip line breaks (and runs of whitespace) from pasted text so single-line
  // spans never absorb multi-line clipboard content.
  const handlePaste = singleLine ? (e) => {
    e.preventDefault();
    const text = (e.clipboardData ?? window.clipboardData).getData('text').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, text);
  } : undefined;

  const handleBlur = (e) => {
    onBlur?.(e); // e.g. a Tooltip anchor's blur handler
    const raw = singleLine ? ref.current.textContent.replace(/\s+/g, ' ') : ref.current.textContent;
    const committed = raw.trim();
    if (committed !== originalRef.current.trim()) onCommit(committed);
    // Restore the formatted, truncated display; the effect won't fire when
    // `value` is unchanged, so re-derive it here explicitly. Reset the scroll
    // left by editing so the leading (identifying) characters are always shown.
    ref.current.textContent = truncateEnd(format(committed), maxChars).text;
    ref.current.scrollLeft = 0;
  };

  return (
    <span
      ref={setRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className={className}
      data-placeholder={placeholder}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onBlur={handleBlur}
      onClick={e => e.stopPropagation()}
      {...rest}
    >
      {displayText}
    </span>
  );
}
