import { describe, it, expect } from 'vitest';
import { parseTagUIConfig, resolveTagSource, getConsumedTagPaths, isTagConsumed, EMPTY_CARD_CONFIG } from './tagUI.js';
import { computeDynamicAttributes } from './dynamicAttributes.js';

const FULL_YML = `
cards:
  agentCard:
    medallion: "dynamic:level"
    boxes:
      - "skill:arcana"
    bars:
      - ["dynamic:hp", "dynamic:hp-max"]
      - "(dynamic:xp-lvl, dynamic:xp-lvl-max)"
    fields:
      - "rate"
    values:
      - "dynamic:AC"
      - "dynamic:pb"
`;

describe('parseTagUIConfig', () => {
  it('normalizes a full config, including both bar tuple forms', () => {
    const { cards } = parseTagUIConfig(FULL_YML);
    expect(cards.agentCard).toEqual({
      medallion: 'dynamic:level',
      boxes: ['skill:arcana'],
      bars: [
        ['dynamic:hp', 'dynamic:hp-max'],
        ['dynamic:xp-lvl', 'dynamic:xp-lvl-max'],
      ],
      fields: ['rate'],
      values: ['dynamic:AC', 'dynamic:pb'],
    });
  });

  it('defaults missing element sections to empty assignments', () => {
    const { cards } = parseTagUIConfig('cards:\n  agentCard:\n    fields: ["rate"]\n');
    expect(cards.agentCard.medallion).toBeNull();
    expect(cards.agentCard.boxes).toEqual([]);
    expect(cards.agentCard.bars).toEqual([]);
    expect(cards.agentCard.values).toEqual([]);
  });

  it('keeps a malformed bar entry as an (invalid) tuple instead of dropping the element', () => {
    const { cards } = parseTagUIConfig('cards:\n  agentCard:\n    bars: [42]\n');
    expect(cards.agentCard.bars).toEqual([['', '']]);
  });

  it('degrades a structurally wrong root to no cards', () => {
    expect(parseTagUIConfig('just a scalar').cards).toEqual({});
    expect(parseTagUIConfig('cards: [not, a, mapping]').cards).toEqual({});
  });

  it('throws on unparseable YAML so the caller can choose a fallback', () => {
    expect(() => parseTagUIConfig('cards: [unclosed')).toThrow();
  });
});

// A level-3 fighter: xp 3200 ⇒ level 3 (threshold 3000), DEX 14 / CON 12.
function makeAgent(overrides = {}) {
  return {
    id: 'a1',
    rate: 1.5,
    rateUnit: 'gp/day',
    xp: 3200,
    hp: 20,
    attributes: ['ability:dex=14', 'ability:con=12', 'class:fighter', 'skill:arcana=3', 'trait:brave'],
    activities: [],
    ...overrides,
  };
}

function makeContext(agentOverrides) {
  const agent = makeAgent(agentOverrides);
  return { agent, dyn: computeDynamicAttributes(agent), attributes: agent.attributes };
}

describe('resolveTagSource', () => {
  const context = makeContext();

  it('resolves dynamic sources case-insensitively', () => {
    expect(resolveTagSource('dynamic:level', context)).toMatchObject({ value: 3, valid: true, label: 'LEVEL' });
    expect(resolveTagSource('dynamic:AC', context)).toMatchObject({ value: 12, valid: true, label: 'AC' });
    expect(resolveTagSource('dynamic:pb', context)).toMatchObject({ value: 2, valid: true, label: 'PB' });
  });

  it('makes writable dynamic sources editable via AGENT_UPDATE changes', () => {
    const hp = resolveTagSource('dynamic:hp', context);
    expect(hp.set(17)).toEqual({ hp: 17 });
    expect(hp.set(-4)).toEqual({ hp: 0 });
    expect(resolveTagSource('dynamic:hp-max', context).set).toBeNull();
  });

  it('rebases per-level XP edits onto the raw total', () => {
    const xpLvl = resolveTagSource('dynamic:xp-lvl', context);
    // Level 3 starts at 1000... derived from the shared xpForLevel formula:
    // total = (xp - xpLvl) + newValue.
    const changes = xpLvl.set(100);
    expect(changes.xp).toBe(context.dyn.xp - context.dyn.xpLvl + 100);
  });

  it('resolves bare agent fields with unit metadata', () => {
    const rate = resolveTagSource('rate', context);
    expect(rate).toMatchObject({ value: 1.5, valid: true, label: 'RATE', unitField: 'rateUnit' });
    expect(rate.set(2)).toEqual({ rate: 2 });
  });

  it('resolves attribute tag paths to their numeric values', () => {
    const arcana = resolveTagSource('skill:arcana', context);
    expect(arcana).toMatchObject({ value: 3, valid: true, label: 'ARCANA' });
    expect(arcana.set(5)).toEqual({
      attributes: ['ability:dex=14', 'ability:con=12', 'class:fighter', 'trait:brave', 'skill:arcana=5'],
    });
  });

  it('flags unresolvable sources invalid with no value', () => {
    for (const source of ['dynamic:nope', 'skill:missing', 'trait:brave', 'potato:example:donut', '']) {
      expect(resolveTagSource(source, context)).toMatchObject({ value: null, valid: false, set: null });
    }
  });
});

describe('consumed tag paths', () => {
  const cardConfig = {
    ...EMPTY_CARD_CONFIG,
    medallion: 'dynamic:level',
    boxes: ['skill:arcana'],
    bars: [['dynamic:hp', 'vitals:hp-max']],
    values: ['dynamic:AC'],
  };

  it('collects every configured source path, lowercased', () => {
    expect(getConsumedTagPaths(cardConfig)).toEqual(new Set([
      'dynamic:level', 'skill:arcana', 'dynamic:hp', 'vitals:hp-max', 'dynamic:ac',
    ]));
  });

  it('consumes plain tags on configured paths but never modifier tags', () => {
    const consumed = getConsumedTagPaths(cardConfig);
    expect(isTagConsumed('skill:Arcana=3', consumed)).toBe(true);
    expect(isTagConsumed('req,skill:arcana=2', consumed)).toBe(false);
    expect(isTagConsumed('skill:stealth=1', consumed)).toBe(false);
  });
});
