import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 400;
const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_GAP_PX = 6;

/**
 * App-standard tooltip. Wraps a single child element via `cloneElement` — no
 * extra DOM node, so flex/inline layouts are unaffected. Shows on hover and
 * keyboard focus after `delayMs`; hides on leave, blur, and Escape. The
 * bubble portals to `document.body` (`position: fixed`), centered above the
 * anchor, clamped to the viewport, and flips below the anchor when there is
 * no room above (`.tooltip--below`). Width is capped by `--tooltip-max-width`
 * with word wrap so unbroken tag strings break. Sets `role="tooltip"` and
 * wires `aria-describedby` onto the child while visible.
 *
 * Designed to replace the app's native `title=` attributes over time; the
 * child's own event handlers are merged, never clobbered.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.content - Tooltip body (string or node); empty hides
 * @param {import('react').ReactElement} props.children - Single anchor element
 * @param {boolean} [props.disabled=false] - Render the child untouched
 * @param {number} [props.delayMs=400] - Hover/focus delay before showing
 * @returns {JSX.Element}
 */
export default function Tooltip({ content, children, disabled = false, delayMs = SHOW_DELAY_MS }) {
  const [anchorRect, setAnchorRect] = useState(null);
  const bubbleRef = useRef(null);
  const timerRef = useRef(null);
  const bubbleId = useId();
  const visible = anchorRect !== null;

  const cancelShow = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleShow = (event) => {
    const anchor = event.currentTarget;
    cancelShow();
    timerRef.current = setTimeout(() => setAnchorRect(anchor.getBoundingClientRect()), delayMs);
  };

  const hide = () => {
    cancelShow();
    setAnchorRect(null);
  };

  useEffect(() => cancelShow, []);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible]);

  // Position after render, once the bubble's size is measurable: centered
  // above the anchor, clamped to the viewport, flipped below when cramped.
  useLayoutEffect(() => {
    if (!visible || !bubbleRef.current) return;
    const bubble = bubbleRef.current;
    const { width, height } = bubble.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(
        anchorRect.left + anchorRect.width / 2 - width / 2,
        window.innerWidth - width - VIEWPORT_MARGIN_PX,
      ),
    );
    let top = anchorRect.top - ANCHOR_GAP_PX - height;
    const below = top < VIEWPORT_MARGIN_PX;
    if (below) top = anchorRect.bottom + ANCHOR_GAP_PX;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.classList.toggle('tooltip--below', below);
  }, [visible, anchorRect, content]);

  if (disabled || content == null || content === '') return children;

  const merge = (own, theirs) => (event) => { theirs?.(event); own(event); };
  const anchor = cloneElement(children, {
    onMouseEnter: merge(scheduleShow, children.props.onMouseEnter),
    onMouseLeave: merge(hide, children.props.onMouseLeave),
    onFocus: merge(scheduleShow, children.props.onFocus),
    onBlur: merge(hide, children.props.onBlur),
    'aria-describedby': visible ? bubbleId : children.props['aria-describedby'],
  });

  return (
    <>
      {anchor}
      {visible && createPortal(
        <div ref={bubbleRef} id={bubbleId} role="tooltip" className="tooltip">
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
