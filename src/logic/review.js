// Turn review view logic (docs/spec/multiplayer.md "Review viewer", "Mode
// sub-panel"): whether a party client has an unseen review, the notice it
// shows, and the GM's finalize prompt. Plain strings and booleans.

import { formatClockParts, DEFAULT_CALENDAR } from './time.js';

/**
 * Whether a pulled `lastReview` is newer than the one this browser acknowledged.
 *
 * @param {{ rev: number }|null} lastReview
 * @param {number|null} acknowledgedRev
 * @returns {boolean}
 */
export function hasUnseenReview(lastReview, acknowledgedRev) {
  if (!lastReview || !Number.isFinite(lastReview.rev)) return false;
  return acknowledgedRev == null || lastReview.rev > acknowledgedRev;
}

const dayLabel = (clock, calendar) => {
  const { year, day } = formatClockParts(clock, calendar);
  return `Y${year} D${day}`;
};

/**
 * The always-shown notice of what a review kept: the whole turn, or the days
 * after the cut that were dropped. A tick advances the clock one day, so the
 * dropped days are the clock readings `clockAtCut + 1 … clockAtEnd`.
 *
 * @param {{ cutIndex: number, tickCount: number, clockAtCut: number, clockAtEnd: number }} lastReview
 * @param {{ daysPerYear: number }} [calendar]
 * @returns {string}
 */
export function reviewNotice(lastReview, calendar = DEFAULT_CALENDAR) {
  const { cutIndex, tickCount, clockAtCut, clockAtEnd } = lastReview;
  if (cutIndex >= tickCount || clockAtEnd <= clockAtCut) return 'Your whole turn was kept.';
  const first = dayLabel(clockAtCut + 1, calendar);
  if (clockAtEnd === clockAtCut + 1) return `Day ${first} was not kept.`;
  return `Days ${first}–${dayLabel(clockAtEnd, calendar)} were not kept.`;
}

const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * The finalize confirmation's prompt for a cut at the playhead: what it keeps,
 * what it discards, then the request for an optional message.
 *
 * @param {number} cutIndex The playhead — the number of the turn's ticks kept.
 * @param {number} tickCount The turn's tick count.
 * @returns {string}
 */
export function finalizePrompt(cutIndex, tickCount) {
  let summary;
  if (cutIndex >= tickCount) summary = `Keep the whole turn (${tickCount} of ${days(tickCount)})?`;
  else if (cutIndex <= 0) summary = `Reject the whole turn (keep 0 of ${days(tickCount)})?`;
  else {
    const dropped = tickCount - cutIndex;
    summary = `Keep ${cutIndex} of ${days(tickCount)}? The last ${dropped === 1 ? 'day is' : `${dropped} are`} discarded.`;
  }
  return `${summary} Optional message for the party:`;
}
