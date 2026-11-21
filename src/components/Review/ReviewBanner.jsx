import { useState } from 'react';
import { useNetSession } from '../../state/NetSessionContext.jsx';
import { useClockConfig } from '../../hooks/useClockConfig.js';
import { loadReviewAck, saveReviewAck } from '../../state/storage.js';
import { hasUnseenReview, reviewNotice } from '../../logic/review.js';

/**
 * The party's review-result alert (docs/spec/multiplayer.md "Mode
 * sub-panel"): shown when a pull brings a `lastReview` newer than the one
 * this browser acknowledged. It carries the GM's message, if any, and an
 * always-shown notice of what was kept. Dismissing stores the acknowledgment.
 * Renders nothing offline or for the GM.
 */
export default function ReviewBanner() {
  const net = useNetSession();
  const { calendar } = useClockConfig();
  const [acknowledged, setAcknowledged] = useState(() => (net.sessionId ? loadReviewAck(net.sessionId) : null));

  if (!net.enabled || net.role !== 'party' || !hasUnseenReview(net.lastReview, acknowledged)) return null;

  const dismiss = () => {
    saveReviewAck(net.sessionId, net.lastReview.rev);
    setAcknowledged(net.lastReview.rev);
  };

  return (
    <div className="review-banner" role="alert">
      <span className="review-banner-title">THE GM REVIEWED YOUR TURN</span>
      <span className="review-banner-notice">{reviewNotice(net.lastReview, calendar)}</span>
      {net.lastReview.message && <span className="review-banner-message">“{net.lastReview.message}”</span>}
      <button className="ctrl right" onClick={dismiss}>DISMISS</button>
    </div>
  );
}
