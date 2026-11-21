import { describe, expect, it } from 'vitest';
import { hasUnseenReview, reviewNotice, finalizePrompt } from './review.js';

const calendar = { daysPerYear: 10 };
const review = (overrides = {}) => ({
  rev: 3, message: '', cutIndex: 4, tickCount: 4, clockAtCut: 4, clockAtEnd: 4, ...overrides,
});

describe('hasUnseenReview', () => {
  it('is true for a review newer than the acknowledged rev', () => {
    expect(hasUnseenReview(review({ rev: 3 }), 2)).toBe(true);
    expect(hasUnseenReview(review({ rev: 3 }), null)).toBe(true);
  });

  it('is false with no review, or one already acknowledged', () => {
    expect(hasUnseenReview(null, null)).toBe(false);
    expect(hasUnseenReview(review({ rev: 3 }), 3)).toBe(false);
    expect(hasUnseenReview(review({ rev: 3 }), 5)).toBe(false);
  });
});

describe('reviewNotice', () => {
  it('says the whole turn was kept when the cut is at the end', () => {
    expect(reviewNotice(review(), calendar)).toBe('Your whole turn was kept.');
  });

  it('says the whole turn was kept for a turn with no ticks', () => {
    expect(reviewNotice(review({ cutIndex: 0, tickCount: 0, clockAtCut: 4, clockAtEnd: 4 }), calendar))
      .toBe('Your whole turn was kept.');
  });

  it('names the range of days that were not kept', () => {
    // Clock 2 → 6: the days the party reached after the cut were D4 … D7.
    expect(reviewNotice(review({ cutIndex: 1, tickCount: 5, clockAtCut: 2, clockAtEnd: 6 }), calendar))
      .toBe('Days Y1 D4–Y1 D7 were not kept.');
  });

  it('names a single dropped day, across a year boundary', () => {
    expect(reviewNotice(review({ cutIndex: 3, tickCount: 4, clockAtCut: 9, clockAtEnd: 10 }), calendar))
      .toBe('Day Y2 D1 was not kept.');
  });
});

describe('finalizePrompt', () => {
  it('describes a cut that keeps the whole turn', () => {
    expect(finalizePrompt(3, 3)).toMatch(/^Keep the whole turn \(3 of 3 days\)\?/);
  });

  it('describes a partial cut and a full rejection', () => {
    expect(finalizePrompt(1, 3)).toMatch(/^Keep 1 of 3 days\? The last 2 are discarded\./);
    expect(finalizePrompt(0, 3)).toMatch(/^Reject the whole turn \(keep 0 of 3 days\)\?/);
  });

  it('asks for an optional message', () => {
    expect(finalizePrompt(1, 3)).toMatch(/Optional message for the party:$/);
  });
});
