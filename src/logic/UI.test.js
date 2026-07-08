import { describe, it, expect } from 'vitest';
import { parseUIConfig, resolveTagSource, getConsumedTagPaths, isTagConsumed, EMPTY_CARD_CONFIG } from './UI.js';
import { evaluateDynamicTags } from './dynamicTags.js';
import { normalizeRulesConfig } from './rulesConfig.js';

const FULL_YML = `
cards:
  agentCard:
    medallion: "level"
    boxes:
      - "skill:arcana"
    bars:
      - ["hp", "hp-max"]
      - "(xp-lvl, xp-lvl-max)"
    fields:
      - "rate"
    values:
      - "AC"
      - "pb"
    slots:
      - Weapon
      - armor
`;

describe('parseUIConfig', () => {
  it('normalizes a full config, including both bar tuple forms', () => {
    const { cards } = parseUIConfig(FULL_YML);
    expect(cards.agentCard).toEqual({
      medallion: 'level',
      boxes: ['skill:arcana'],
      bars: [
        ['hp', 'hp-max'],
        ['xp-lvl', 'xp-lvl-max'],
      ],
      fields: ['rate'],
      values: ['AC', 'pb'],
      slots: ['weapon', 'armor'],
    });
  });

  it('lowercases slot names and drops non-string / blank entries', () => {
    const { cards } = parseUIConfig('cards:\n  agentCard:\n    slots: ["Head", "", { x: 1 }, "FEET"]\n');
    expect(cards.agentCard.slots).toEqual(['head', 'feet']);
  });

  it('defaults missing element sections to empty assignments', () => {
    const { cards } = parseUIConfig('cards:\n  agentCard:\n    fields: ["rate"]\n');
    expect(cards.agentCard.medallion).toBeNull();
    expect(cards.agentCard.boxes).toEqual([]);
    expect(cards.agentCard.bars).toEqual([]);
    expect(cards.agentCard.values).toEqual([]);
    expect(cards.agentCard.slots).toEqual([]);
  });

  it('keeps a malformed bar entry as an (invalid) tuple instead of dropping the element', () => {
    const { cards } = parseUIConfig('cards:\n  agentCard:\n    bars: [42]\n');
    expect(cards.agentCard.bars).toEqual([['', '']]);
  });

  it('degrades a structurally wrong root to no cards', () => {
    expect(parseUIConfig('just a scalar').cards).toEqual({});
    expect(parseUIConfig('cards: [not, a, mapping]').cards).toEqual({});
  });

  it('throws on unparseable YAML so the caller can choose a fallback', () => {
    expect(() => parseUIConfig('cards: [unclosed')).toThrow();
  });
});

// The canonical D&D ruleset (see docs/architecture.md → Dynamic Tags).
const RULES = normalizeRulesConfig({
  dynamic: {
    level: '[max(1, floor(0.5*(1+sqrt(1+{xp}/125))))]',
    pb: '[2+floor(({dyn,level}-1)/4)]',
    ac: '[10+floor(({ability:dex}-10)/2)]',
    'hp-max': '[max(1, 10+(5+{hitdie}+floor(({ability:con}-10)/2))*{dyn,level})]',
    'xp-lvl': '[{xp}-125*((2*{dyn,level}-1)*(2*{dyn,level}-1)-1)]',
  },
});

// A level-3 fighter: xp 3200 ⇒ level 3 (threshold 3000), DEX 14 / CON 12,
// hitdie 1 ⇒ hp-max 31, current hp 20.
function makeAgent(overrides = {}) {
  return {
    id: 'a1',
    rate: 1.5,
    rateUnit: 'gp/day',
    attributes: [
      'xp=3200', 'hp=20', 'hitdie=1',
      'ability:dex=14', 'ability:con=12', 'class:fighter', 'skill:arcana=3', 'trait:brave',
      'dyn,level', 'dyn,pb', 'dyn,ac', 'dyn,hp-max', 'dyn,xp-lvl',
    ],
    activities: [],
    ...overrides,
  };
}

const registry = { class: { fighter: {} }, skill: { arcana: {} }, trait: { brave: {} } };

function makeContext(agentOverrides, rules = RULES) {
  const agent = makeAgent(agentOverrides);
  return {
    agent,
    dynamics: evaluateDynamicTags(agent.attributes, rules, registry),
    attributes: agent.attributes,
    registry,
  };
}

describe('resolveTagSource', () => {
  const context = makeContext();

  it('resolves dyn tag paths to computed values, case-insensitively', () => {
    expect(resolveTagSource('level', context)).toMatchObject({ value: 3, valid: true, label: 'LEVEL', warn: false });
    expect(resolveTagSource('AC', context)).toMatchObject({ value: 12, valid: true, label: 'AC' });
    expect(resolveTagSource('pb', context)).toMatchObject({ value: 2, valid: true, label: 'PB' });
    expect(resolveTagSource('hp-max', context)).toMatchObject({ value: 31, valid: true, label: 'HP-MAX' });
    expect(resolveTagSource('xp-lvl', context)).toMatchObject({ value: 200, valid: true });
  });

  it('keeps dyn values read-only', () => {
    for (const source of ['level', 'AC', 'hp-max', 'xp-lvl']) {
      expect(resolveTagSource(source, context).set).toBeNull();
    }
  });

  it('flags warn (still valid) when a rule defaulted a reference', () => {
    const noDex = makeContext({ attributes: ['dyn,ac'] });
    // dex defaults to 1 → 10 + floor(-9/2) = 5, value shown in warn state.
    expect(resolveTagSource('ac', noDex)).toMatchObject({ value: 5, valid: true, warn: true });
  });

  it('marks markers with a broken or missing rule invalid, not warned', () => {
    const broken = makeContext(
      { attributes: ['dyn,ac'] },
      normalizeRulesConfig({ dynamic: { ac: '[1+]' } }),
    );
    expect(resolveTagSource('ac', broken)).toMatchObject({ value: null, valid: false });
    const unruled = makeContext({ attributes: ['dyn,ac'] }, normalizeRulesConfig({}));
    expect(resolveTagSource('ac', unruled)).toMatchObject({ value: null, valid: false });
  });

  it('resolves bare agent fields with unit metadata', () => {
    const rate = resolveTagSource('rate', context);
    expect(rate).toMatchObject({ value: 1.5, valid: true, label: 'RATE', unitField: 'rateUnit' });
    expect(rate.set(2)).toEqual({ rate: 2 });
  });

  it('resolves plain attribute tag paths to editable numeric values', () => {
    const hp = resolveTagSource('hp', context);
    expect(hp).toMatchObject({ value: 20, valid: true, label: 'HP' });
    const changes = hp.set(15);
    expect(changes.attributes).toContain('hp=15');
    expect(changes.attributes).not.toContain('hp=20');

    const arcana = resolveTagSource('skill:arcana', context);
    expect(arcana).toMatchObject({ value: 3, valid: true, label: 'ARCANA' });
    expect(arcana.set(5).attributes).toContain('skill:arcana=5');
  });

  it('flags unresolvable sources invalid with no value', () => {
    for (const source of ['dynamic:level', 'skill:missing', 'trait:brave', 'potato:example:donut', '']) {
      expect(resolveTagSource(source, context)).toMatchObject({ value: null, valid: false, set: null });
    }
  });

  it('keeps leaf-string values non-displayable — the numeric contract holds', () => {
    // class:fighter resolves 'fighter' for display use cases, but a card
    // element needs a number; the leaf string stays invalid here.
    expect(resolveTagSource('class:fighter', context)).toMatchObject({ value: null, valid: false });
  });
});

describe('consumed tag paths', () => {
  const cardConfig = {
    ...EMPTY_CARD_CONFIG,
    medallion: 'level',
    boxes: ['skill:arcana'],
    bars: [['hp', 'hp-max']],
    values: ['AC'],
  };

  it('collects every configured source path, lowercased', () => {
    expect(getConsumedTagPaths(cardConfig)).toEqual(new Set([
      'level', 'skill:arcana', 'hp', 'hp-max', 'ac',
    ]));
  });

  it('consumes plain and dyn tags on configured paths but never relational modifiers', () => {
    const consumed = getConsumedTagPaths(cardConfig);
    expect(isTagConsumed('skill:Arcana=3', consumed)).toBe(true);
    expect(isTagConsumed('dyn,level=max(1, {xp}/125)', consumed)).toBe(true);
    expect(isTagConsumed('dyn,ac=10', consumed)).toBe(true);
    expect(isTagConsumed('req,skill:arcana=2', consumed)).toBe(false);
    expect(isTagConsumed('bonus,hp=2', consumed)).toBe(false);
    expect(isTagConsumed('skill:stealth=1', consumed)).toBe(false);
  });
});
