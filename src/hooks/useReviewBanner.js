import { useEffect, useRef } from 'react';
import { useNetSession } from '../state/NetSessionContext.jsx';
import { useUI } from '../state/UIContext.jsx';
import { loadReviewAck, saveReviewAck } from '../state/storage.js';

/**
 * Review-result banner (D-disclosure). When a party client's poll-triggered pull
 * returns a `lastReview` with a `rev` newer than the last acknowledged one
 * (per-browser, per-session), shows a one-time alert carrying the GM's optional
 * message and the always-shown, non-skippable kept/cut notice computed from
 * `lastReview`. Acknowledgment is recorded when the banner is raised, so it never
 * re-fires for the same rev. GM-only sessions never see it.
 *
 * No-op offline (no net session). Mount once, near the app root.
 */
export function useReviewBanner() {
  const net = useNetSession();
  const { openConfirm } = useUI();
  const shownRef = useRef(0);

  const lastReview = net?.lastReview;
  useEffect(() => {
    if (!net?.enabled || net.role !== 'party' || !lastReview) return;
    const { rev, cutIndex, tickCount, clockAtCut, clockAtEnd, message } = lastReview;
    if (rev <= loadReviewAck(net.sessionId) || rev <= shownRef.current) return;
    shownRef.current = rev;
    saveReviewAck(net.sessionId, rev);

    const kept = cutIndex >= tickCount
      ? 'Your whole turn was kept.'
      : `Days ${clockAtCut + 1}–${clockAtEnd} were not kept.`;
    const body = [message?.trim(), kept].filter(Boolean).join('\n\n');
    openConfirm({ message: body, type: 'alert' });
  }, [net?.enabled, net?.role, net?.sessionId, lastReview, openConfirm]);
}
