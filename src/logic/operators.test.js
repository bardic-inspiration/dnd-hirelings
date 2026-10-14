import { describe, it, expect } from 'vitest';
import { createFlow } from './operators.js';

describe('createFlow', () => {
  it('starts admitted, at zero, with no matched value and no rolls', () => {
    expect(createFlow()).toEqual({ admitted: true, value: 0, matchedValue: 0, rolls: [] });
  });

  it('returns a fresh object each call, so one agent\'s fold never leaks into another\'s', () => {
    const first = createFlow();
    first.rolls.push({});
    expect(createFlow().rolls).toEqual([]);
    expect(createFlow()).not.toBe(createFlow());
  });
});
