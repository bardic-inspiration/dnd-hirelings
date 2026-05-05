import { useRef, useEffect } from 'react';

export default function EditableSpan({ value, onCommit, className, placeholder }) {
  const ref = useRef(null);
  const originalRef = useRef(value || '');

  // Sync value to DOM only when not focused
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.textContent = value || '';
    }
  }, [value]);

  const handleFocus = () => {
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

  const handleBlur = () => {
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
    >
      {value || ''}
    </span>
  );
}
