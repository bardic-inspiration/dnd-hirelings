import { describe, it, expect } from 'vitest';
import { hashSeed, createRng, rollDice, rollSeedKey } from './rng.js';

const draw = (key, n) => {
  const next = createRng(key);
  return Array.from({ length: n }, () => next());
};

describe('hashSeed', () => {
  it('maps a string to an unsigned 32-bit integer, the same every time', () => {
    const seed = hashSeed('3|t1|op|a1|0');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
    expect(hashSeed('3|t1|op|a1|0')).toBe(seed);
  });

  it('separates keys that differ in one character', () => {
    expect(hashSeed('3|t1|op|a1|0')).not.toBe(hashSeed('3|t1|op|a1|1'));
  });
});

describe('createRng', () => {
  it('yields the same stream for the same key, from independent generators', () => {
    expect(draw('key', 20)).toEqual(draw('key', 20));
  });

  it('yields different streams for different keys', () => {
    expect(draw('key-a', 5)).not.toEqual(draw('key-b', 5));
  });

  it('stays in [0, 1)', () => {
    for (const value of draw('range', 5000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  // A changed algorithm silently changes every replayed roll, so the stream is
  // pinned to golden values.
  it('keeps its algorithm: golden values for a fixed key', () => {
    expect(draw('0|t1|op|a1|0', 3))
      .toEqual([0.8113421550951898, 0.5252901366911829, 0.6772139333188534]);
  });
});

describe('rollDice', () => {
  it('draws N values from one key, each in 1..M, summed', () => {
    const { result, values } = rollDice('dice', 4, 6);
    expect(values).toHaveLength(4);
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
    expect(result).toBe(values.reduce((sum, value) => sum + value, 0));
  });

  it('draws its values from the key\'s stream in order', () => {
    const stream = draw('dice', 3);
    expect(rollDice('dice', 3, 20).values).toEqual(stream.map(unit => 1 + Math.floor(unit * 20)));
  });

  it('repeats for the same key and covers every face across keys', () => {
    expect(rollDice('same', 2, 20)).toEqual(rollDice('same', 2, 20));
    const faces = new Set();
    for (let i = 0; i < 500; i++) faces.add(rollDice(`face|${i}`, 1, 6).result);
    expect([...faces].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('rollSeedKey', () => {
  it('joins clock, task, operator, agent, and roll index with pipes', () => {
    expect(rollSeedKey({ clock: 12, taskId: 't1', operatorId: 'stealth', agentId: 'a1', rollIndex: 0 }))
      .toBe('12|t1|stealth|a1|0');
  });
});
