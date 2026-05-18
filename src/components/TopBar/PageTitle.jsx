import { useRef, useState, useCallback } from 'react';
import { useGame } from '../../state/GameContext.jsx';

// Interval (ms) between each character reveal/hide step in the marquee sweep
const CHAR_STEP_MS = 38;
// Duration (ms) for the global opacity fade in/out
const FADE_MS = 160;

export default function PageTitle() {
  const { state, dispatch } = useGame();
  const title = state.session.title ?? 'GUILD MANAGER';

  const spanRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const animatingRef = useRef(false);

  const runMagicEffect = useCallback((newTitle) => {
    if (!spanRef.current || animatingRef.current) return;
    animatingRef.current = true;

    const el = spanRef.current;
    // Phase 1 starts from whatever is currently rendered (the newly typed text in highlight color)
    const chars = newTitle.split('');
    const len = chars.length;

    // Phase 1: wipe out left-to-right (each char → invisible span) + fade out
    el.style.transition = `opacity ${FADE_MS}ms ease`;
    el.style.opacity = '0.15';

    const hiddenChars = [...chars];
    let step = 0;
    const wipeOut = setInterval(() => {
      hiddenChars[step] = `<span style="visibility:hidden">${hiddenChars[step]}</span>`;
      el.innerHTML = hiddenChars.join('');
      step++;
      if (step >= len) {
        clearInterval(wipeOut);
        // Brief pause then transition to new title
        setTimeout(() => {
          const newChars = newTitle.split('');
          const visChars = newChars.map(c => `<span style="visibility:hidden">${c}</span>`);
          // Switch to normal color before revealing
          setEditing(false);
          el.innerHTML = visChars.join('');
          el.style.opacity = '0.15';

          // Phase 2: reveal left-to-right + fade in
          el.style.transition = `opacity ${FADE_MS}ms ease`;
          el.style.opacity = '1';

          let revealStep = 0;
          const wipeIn = setInterval(() => {
            visChars[revealStep] = newChars[revealStep];
            el.innerHTML = visChars.join('');
            revealStep++;
            if (revealStep >= newChars.length) {
              clearInterval(wipeIn);
              el.textContent = newTitle;
              el.style.transition = '';
              el.style.opacity = '';
              dispatch({ type: 'SESSION_UPDATE', payload: { title: newTitle } });
              animatingRef.current = false;
            }
          }, CHAR_STEP_MS);
        }, FADE_MS + 40);
      }
    }, CHAR_STEP_MS);
  }, [dispatch]);

  const handleFocus = () => {
    setEditing(true);
    requestAnimationFrame(() => {
      const range = document.createRange();
      range.selectNodeContents(spanRef.current);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); spanRef.current.blur(); }
    if (e.key === 'Escape') {
      spanRef.current.textContent = title;
      setEditing(false);
      spanRef.current.blur();
    }
  };

  const handleBlur = () => {
    const newVal = (spanRef.current.textContent || '').trim();
    if (newVal && newVal !== title) {
      // Keep highlight color on the new text through phase 1 — setEditing(false) happens at animation end
      runMagicEffect(newVal);
    } else {
      spanRef.current.textContent = title;
      setEditing(false);
    }
  };

  return (
    <div id="page-title">
      <span
        ref={spanRef}
        id="page-title-text"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        className={editing ? 'editing' : ''}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onClick={e => e.stopPropagation()}
      >
        {title}
      </span>
    </div>
  );
}
