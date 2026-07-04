import { describe, it, expect } from 'vitest';
import { computeDynamicAttributes, xpForLevel } from './dynamicAttributes.js';

const agent = (overrides = {}) => ({
  xp: 0, hp: null, attributes: [], activities: [], ...overrides,
});

describe('xpForLevel', () => {
  it('inverts the level formula', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(1000); // 125 * (3² - 1)
  });
});

describe('computeDynamicAttributes', () => {
  it('computes baseline stats for a level-1 agent with no abilities', () => {
    const stats = computeDynamicAttributes(agent());
    expect(stats).toMatchObject({
      level: 1, proficiency: 2, ac: 10, hpMax: 15, hp: 15, xpLvl: 0, xpLvlMax: 1000, xpProgress: 0,
    });
  });

  it('derives level and proficiency from XP', () => {
    const stats = computeDynamicAttributes(agent({ xp: 1000 }));
    expect(stats.level).toBe(2);
    expect(stats.proficiency).toBe(2);
  });

  it('applies the DEX modifier to AC and CON/class to HP', () => {
    expect(computeDynamicAttributes(agent({ attributes: ['ability:dex=14'] })).ac).toBe(12);
    expect(computeDynamicAttributes(agent({ attributes: ['ability:con=14'] })).hpMax).toBe(17);
    expect(computeDynamicAttributes(agent({ attributes: ['class:fighter'] })).hpMax).toBe(16);
  });

  it('treats hp === null as full health but keeps an explicit hp', () => {
    expect(computeDynamicAttributes(agent({ hp: null })).hp).toBe(15);
    expect(computeDynamicAttributes(agent({ hp: 5 })).hp).toBe(5);
  });

  it('reflects bound-item ability bonuses in derived stats', () => {
    const armed = agent({
      attributes: ['ability:dex=10'],
      activities: ['bind:weapon:item:boots'],
    });
    const inventory = [{ name: 'boots', attributes: ['bonus,ability:dex=4'] }];
    expect(computeDynamicAttributes(armed, inventory).ac).toBe(12); // dex 10 + 4 → +1 mod
  });
});
