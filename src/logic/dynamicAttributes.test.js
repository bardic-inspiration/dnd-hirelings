import { describe, it, expect } from 'vitest';
import { computeDynamicAttributes, xpForLevel } from './dynamicAttributes.js';

const agent = (overrides = {}) => ({
  xp: 0, hp: null, attributes: [], activities: [], ...overrides,
});

// Class names resolve as registry-bounded display values: a class tag only
// carries its name when the terminal segment is a registered leaf.
const registry = { class: { fighter: {}, druid: { circle: {} } } };

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
    expect(computeDynamicAttributes(agent({ attributes: ['class:fighter'] }), [], registry).hpMax).toBe(16);
  });

  it('resolves the class name as a registry-bounded display value', () => {
    const fighter = agent({ attributes: ['class:fighter'] });
    // Registered leaf → class bonus applies; explicit =value wins registry-free.
    expect(computeDynamicAttributes(fighter, [], registry).hpMax).toBe(16);
    expect(computeDynamicAttributes(agent({ attributes: ['class=fighter'] })).hpMax).toBe(16);
    // No registry, or a registered non-leaf terminal → no class name, bonus 0.
    expect(computeDynamicAttributes(fighter).hpMax).toBe(15);
    expect(computeDynamicAttributes(agent({ attributes: ['class:druid'] }), [], registry).hpMax).toBe(15);
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
