import { describe, it, expect } from 'vitest';
import { firstFreeSlot, getBoundItems } from './agents.js';

describe('firstFreeSlot (issue #84)', () => {
  const slots = ['weapon', 'armor', 'offhand'];

  it('returns the first configured slot not already occupied', () => {
    const bound = getBoundItems(['bind:weapon:item:sword']);
    expect(firstFreeSlot(slots, bound)).toBe('armor');
  });

  it('returns null when every configured slot is full', () => {
    const bound = getBoundItems([
      'bind:weapon:item:sword', 'bind:armor:item:mail', 'bind:offhand:item:shield',
    ]);
    expect(firstFreeSlot(slots, bound)).toBeNull();
  });

  it('returns null when no slots are configured (slotless bind)', () => {
    expect(firstFreeSlot([], [])).toBeNull();
    expect(firstFreeSlot(undefined, [])).toBeNull();
  });

  it('ignores slotless bound items when computing occupancy', () => {
    const bound = getBoundItems(['bind:item:potion']);
    expect(firstFreeSlot(slots, bound)).toBe('weapon');
  });
});
