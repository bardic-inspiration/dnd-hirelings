import { describe, it, expect, vi } from 'vitest';
import { buildOrder, submitOrder } from './order.js';

describe('buildOrder (issue #92)', () => {
  const line = (name, quantity, extra = {}) => ({ preset: { id: 'x', source: 'user', name, ...extra }, quantity });

  it('keeps only rows with a positive count', () => {
    const order = buildOrder('item', [line('Rope', 2), line('Torch', 0), line('Oil', 3)]);
    expect(order.type).toBe('item');
    expect(order.lines.map(entry => entry.preset.name)).toEqual(['Rope', 'Oil']);
  });

  it('strips runtime bookkeeping (id, source) from each line preset', () => {
    const [only] = buildOrder('agent', [line('Guard', 1, { rate: 5 })]).lines;
    expect(only.preset).toEqual({ name: 'Guard', rate: 5 });
    expect(only.preset).not.toHaveProperty('id');
    expect(only.preset).not.toHaveProperty('source');
  });

  it('floors fractional counts and drops those that floor to zero', () => {
    const order = buildOrder('item', [line('Rope', 2.9), line('Torch', 0.4)]);
    expect(order.lines).toEqual([{ preset: { name: 'Rope' }, quantity: 2 }]);
  });

  it('returns an empty line list when nothing is ordered', () => {
    expect(buildOrder('task', [line('Escort', 0)]).lines).toEqual([]);
  });
});

describe('submitOrder (issue #92)', () => {
  const config = { toCreateAction: (preset, count) => ({ type: 'ADD', preset, count }) };

  it('dispatches one create action per line, carrying the count', () => {
    const dispatch = vi.fn();
    const order = buildOrder('item', [
      { preset: { id: 'a', name: 'Rope' }, quantity: 3 },
      { preset: { id: 'b', name: 'Oil' }, quantity: 1 },
    ]);
    const submitted = submitOrder(order, dispatch, config);
    expect(submitted).toBe(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'ADD', preset: { name: 'Rope' }, count: 3 });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'ADD', preset: { name: 'Oil' }, count: 1 });
  });

  it('dispatches nothing for an empty order', () => {
    const dispatch = vi.fn();
    submitOrder(buildOrder('agent', []), dispatch, config);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('spreads dispatch-time options onto every create action', () => {
    const dispatch = vi.fn();
    const order = buildOrder('item', [
      { preset: { id: 'a', name: 'Rope' }, quantity: 1 },
      { preset: { id: 'b', name: 'Oil' }, quantity: 2 },
    ]);
    submitOrder(order, dispatch, config, { locked: true });
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'ADD', preset: { name: 'Rope' }, count: 1, locked: true });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'ADD', preset: { name: 'Oil' }, count: 2, locked: true });
  });
});
