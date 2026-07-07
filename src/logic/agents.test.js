import { describe, it, expect } from 'vitest';
import { firstFreeSlot, getBoundItems, getEffectiveAttributes, validateAssignment } from './agents.js';

describe('validateAssignment', () => {
  const task = (requirements) => ({ requirements });
  const agent = (attributes) => ({ attributes, activities: [] });

  it('matches plain attribute tags against req values', () => {
    expect(validateAssignment(agent(['ability:str=14']), task(['req,ability:str=10']))).toBe(true);
    expect(validateAssignment(agent(['ability:str=8']), task(['req,ability:str=10']))).toBe(false);
  });

  it('never lets dyn tags satisfy requirements', () => {
    // parseFloat('10+floor(…)') would otherwise read as 10 and mis-satisfy.
    const dynOnly = agent(['dyn,ac=10+floor(({ability:dex}-10)/2)']);
    expect(validateAssignment(dynOnly, task(['req,ac=5']))).toBe(false);
    expect(validateAssignment(dynOnly, task(['req,ac']))).toBe(false);
  });

  it('never lets dyn tags trip block requirements', () => {
    const dynOnly = agent(['dyn,ac=10']);
    expect(validateAssignment(dynOnly, task(['block,ac']))).toBe(true);
    expect(validateAssignment(agent(['ac=10']), task(['block,ac']))).toBe(false);
  });
});

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

describe('getEffectiveAttributes', () => {
  const boundSword = ['bind:weapon:item:sword'];
  const swordItem = (attributes) => [{ name: 'sword', attributes }];

  it('returns the raw attributes untouched when nothing is bound', () => {
    const attrs = ['skill:arcana=3'];
    expect(getEffectiveAttributes(attrs, [], [])).toBe(attrs);
  });

  it('adds a bound item bonus to a matching valued attribute', () => {
    const result = getEffectiveAttributes(
      ['ability:str=10'], boundSword, swordItem(['bonus,ability:str=2']),
    );
    expect(result).toContain('ability:str=12');
  });

  it('injects a bonus as a new tag when the agent lacks the path', () => {
    const result = getEffectiveAttributes(
      [], boundSword, swordItem(['bonus,ability:str=2']),
    );
    expect(result).toContain('ability:str=2');
  });

  it('treats a valueless matching attribute as 0, not NaN (regression)', () => {
    const result = getEffectiveAttributes(
      ['skill:arcana'], boundSword, swordItem(['bonus,skill:arcana=1']),
    );
    expect(result).toContain('skill:arcana=1');
    expect(result.some(tag => tag.includes('NaN'))).toBe(false);
  });

  it('ignores non-bonus item tags and non-numeric bonus values', () => {
    const result = getEffectiveAttributes(
      ['ability:str=10'], boundSword, swordItem(['ability:str=99', 'bonus,ability:str=x']),
    );
    expect(result).toContain('ability:str=10');
  });
});
