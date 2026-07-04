import { describe, it, expect } from 'vitest';
import {
  schemaNodeAt, flattenConfigDoc, checkConfigDoc, coerceScalarInput,
  getAt, setValueAt, deleteAt, appendItemAt, emptyValueFor,
  serializeConfigDoc, VALUE_KINDS,
} from './configEditor.js';
import { CARD_UI_SCHEMA } from './cardUI.js';

const DOC = {
  cards: {
    agentCard: {
      medallion: 'dynamic:level',
      boxes: [],
      bars: [
        ['dynamic:hp', 'dynamic:hp-max'],
        ['dynamic:xp-lvl', 'dynamic:xp-lvl-max'],
      ],
      fields: ['rate'],
      slots: ['weapon', 'armor'],
    },
  },
};

const REGISTRY = { skill: { arcana: {}, stealth: {} }, ability: { str: {} } };

describe('schemaNodeAt', () => {
  it('walks map keys, anyKey cards, and list/tuple items', () => {
    expect(schemaNodeAt(CARD_UI_SCHEMA, ['cards', 'agentCard'])).toBe(CARD_UI_SCHEMA.keys.cards.anyKey);
    expect(schemaNodeAt(CARD_UI_SCHEMA, ['cards', 'taskCard', 'bars']).kind).toBe('list');
    expect(schemaNodeAt(CARD_UI_SCHEMA, ['cards', 'agentCard', 'bars', 0]).kind).toBe('tuple');
    expect(schemaNodeAt(CARD_UI_SCHEMA, ['cards', 'agentCard', 'bars', 0, 1]).value).toBe('tagSource');
  });

  it('returns null once a path leaves the schema', () => {
    expect(schemaNodeAt(CARD_UI_SCHEMA, ['cards', 'agentCard', 'bogus'])).toBeNull();
    expect(schemaNodeAt(CARD_UI_SCHEMA, ['cards', 'agentCard', 'bogus', 'deeper'])).toBeNull();
  });
});

describe('flattenConfigDoc', () => {
  it('preserves insertion order and numbers every node, collapsed or not', () => {
    const rows = flattenConfigDoc(DOC, CARD_UI_SCHEMA, new Set());
    // Only the root row is visible while everything is collapsed…
    expect(rows.map(row => row.key)).toEqual(['cards']);
    // …but the full expansion shows document-position line numbers.
    const all = flattenConfigDoc(DOC, CARD_UI_SCHEMA, new Set([
      'cards', 'cards:agentCard', 'cards:agentCard:bars',
    ]));
    expect(all.map(row => [row.lineNo, row.pathStr])).toEqual([
      [1, 'cards'],
      [2, 'cards:agentCard'],
      [3, 'cards:agentCard:medallion'],
      [4, 'cards:agentCard:boxes'],
      [5, 'cards:agentCard:bars'],
      [6, 'cards:agentCard:bars:0'],
      [7, 'cards:agentCard:bars:1'],
      [8, 'cards:agentCard:fields'],
      [10, 'cards:agentCard:slots'],   // 9 is the collapsed fields item
    ]);
  });

  it('classifies rows: containers, schema-typed tuples, scalars', () => {
    const rows = flattenConfigDoc(DOC, CARD_UI_SCHEMA, new Set(['cards', 'cards:agentCard', 'cards:agentCard:bars']));
    const byPath = Object.fromEntries(rows.map(row => [row.pathStr, row]));
    expect(byPath['cards'].kind).toBe('map');
    expect(byPath['cards:agentCard:bars'].kind).toBe('list');
    expect(byPath['cards:agentCard:bars:0']).toMatchObject({
      kind: 'tuple', value: ['dynamic:hp', 'dynamic:hp-max'], hasChildren: false,
    });
    expect(byPath['cards:agentCard:medallion']).toMatchObject({ kind: 'scalar', value: 'dynamic:level' });
    expect(byPath['cards:agentCard:boxes']).toMatchObject({ kind: 'list', hasChildren: false });
  });

  it('carries guide bookkeeping: isLast and ancestorIsLast', () => {
    const rows = flattenConfigDoc(DOC, CARD_UI_SCHEMA, new Set(['cards', 'cards:agentCard']));
    const slots = rows.find(row => row.pathStr === 'cards:agentCard:slots');
    expect(slots.isLast).toBe(true);
    expect(slots.ancestorIsLast).toEqual([true, true]);
    const medallion = rows.find(row => row.pathStr === 'cards:agentCard:medallion');
    expect(medallion.isLast).toBe(false);
  });
});

describe('checkConfigDoc', () => {
  const context = { tagRegistry: REGISTRY };

  it('accepts a well-formed document', () => {
    expect(checkConfigDoc(DOC, CARD_UI_SCHEMA, context).size).toBe(0);
  });

  it('warns on unknown keys under closed maps only', () => {
    const doc = { cards: { agentCard: { sparkles: 1 } }, extra: true };
    const warnings = checkConfigDoc(doc, CARD_UI_SCHEMA, context);
    expect(warnings.get('cards:agentCard:sparkles')).toBe('unknown key');
    expect(warnings.get('extra')).toBe('unknown key');
    // `cards` accepts any card name — no warning for a new card key.
    expect(checkConfigDoc({ cards: { anything: {} } }, CARD_UI_SCHEMA, context).size).toBe(0);
  });

  it('warns on shape mismatches and wrong tuple sizes', () => {
    const doc = { cards: { agentCard: { bars: [['a', 'b', 'c']], boxes: 'nope' } } };
    const warnings = checkConfigDoc(doc, CARD_UI_SCHEMA, context);
    expect(warnings.get('cards:agentCard:bars:0')).toBe('expected 2 entries');
    expect(warnings.get('cards:agentCard:boxes')).toBe('expected a list');
  });

  it('soft-checks tag sources against dynamic keys, fields, and the registry', () => {
    const doc = {
      cards: {
        agentCard: {
          medallion: 'dynamic:bogus',
          boxes: ['skill:arcana', 'skill:missing', 'rate'],
        },
      },
    };
    const warnings = checkConfigDoc(doc, CARD_UI_SCHEMA, context);
    expect(warnings.get('cards:agentCard:medallion')).toMatch(/unknown dynamic source/);
    expect(warnings.has('cards:agentCard:boxes:0')).toBe(false);
    expect(warnings.get('cards:agentCard:boxes:1')).toBe('tag path not in the registry');
    expect(warnings.has('cards:agentCard:boxes:2')).toBe(false);
  });

  it('lets a nullable scalar hold null without warning', () => {
    const warnings = checkConfigDoc({ cards: { agentCard: { medallion: null } } }, CARD_UI_SCHEMA, context);
    expect(warnings.size).toBe(0);
  });
});

describe('value kinds', () => {
  it('suggests tag sources from dynamic keys, fields, and the live registry', () => {
    const node = { kind: 'scalar', value: 'tagSource' };
    const suggest = (prefix) => VALUE_KINDS.tagSource.suggest(prefix, node, { tagRegistry: REGISTRY });
    expect(suggest('dynamic:h')).toEqual(['dynamic:hp', 'dynamic:hp-max']);
    // The exact match ('skill' itself) is excluded — a ghost has nothing to add.
    expect(suggest('skill')).toEqual(['skill:arcana', 'skill:stealth']);
    expect(suggest('ra')).toEqual(['rate']);
  });

  it('checks numbers against schema minimums', () => {
    const node = { kind: 'scalar', value: 'number', min: 0.1 };
    expect(VALUE_KINDS.number.check(0.5, node)).toBeNull();
    expect(VALUE_KINDS.number.check(0, node)).toBe('minimum 0.1');
    expect(VALUE_KINDS.number.check('nope', node)).toBe('not a number');
  });
});

describe('coerceScalarInput', () => {
  const numberNode = { kind: 'scalar', value: 'number' };
  const sourceNode = { kind: 'scalar', value: 'tagSource', nullable: true };

  it('parses numbers for number kinds, keeping raw text when unparseable', () => {
    expect(coerceScalarInput('2.5', numberNode)).toBe(2.5);
    expect(coerceScalarInput('abc', numberNode)).toBe('abc');
  });

  it('keeps typed kinds as strings and returns null for empty nullables', () => {
    expect(coerceScalarInput('dynamic:ac', sourceNode)).toBe('dynamic:ac');
    expect(coerceScalarInput('  ', sourceNode)).toBeNull();
    expect(coerceScalarInput('WeAPon', { kind: 'scalar', value: 'slug' })).toBe('weapon');
  });

  it('auto-types numeric-looking text when there is no schema', () => {
    expect(coerceScalarInput('42', null)).toBe(42);
    expect(coerceScalarInput('hello', null)).toBe('hello');
  });
});

describe('document mutations', () => {
  it('setValueAt returns a new root and leaves the original untouched', () => {
    const next = setValueAt(DOC, ['cards', 'agentCard', 'medallion'], 'dynamic:ac');
    expect(getAt(next, ['cards', 'agentCard', 'medallion'])).toBe('dynamic:ac');
    expect(getAt(DOC, ['cards', 'agentCard', 'medallion'])).toBe('dynamic:level');
    expect(next.cards.agentCard.bars).toBe(DOC.cards.agentCard.bars); // untouched branch shared
  });

  it('setValueAt writes inside tuples via list indices', () => {
    const next = setValueAt(DOC, ['cards', 'agentCard', 'bars', 0, 1], 'ability:str');
    expect(getAt(next, ['cards', 'agentCard', 'bars', 0])).toEqual(['dynamic:hp', 'ability:str']);
  });

  it('deleteAt splices list entries and removes map keys', () => {
    const withoutBar = deleteAt(DOC, ['cards', 'agentCard', 'bars', 0]);
    expect(getAt(withoutBar, ['cards', 'agentCard', 'bars'])).toEqual([
      ['dynamic:xp-lvl', 'dynamic:xp-lvl-max'],
    ]);
    const withoutCard = deleteAt(DOC, ['cards', 'agentCard']);
    expect(getAt(withoutCard, ['cards'])).toEqual({});
    expect(deleteAt(DOC, ['cards', 'nope'])).toBe(DOC); // absent key no-ops
  });

  it('appendItemAt appends to lists and no-ops elsewhere', () => {
    const next = appendItemAt(DOC, ['cards', 'agentCard', 'fields'], 'dynamic:ac');
    expect(getAt(next, ['cards', 'agentCard', 'fields'])).toEqual(['rate', 'dynamic:ac']);
    expect(appendItemAt(DOC, ['cards', 'agentCard'], 'x')).toBe(DOC);
  });

  it('emptyValueFor matches the schema shape', () => {
    expect(emptyValueFor({ kind: 'map' })).toEqual({});
    expect(emptyValueFor({ kind: 'list' })).toEqual([]);
    expect(emptyValueFor({ kind: 'tuple', size: 2 })).toEqual(['', '']);
    expect(emptyValueFor({ kind: 'scalar', value: 'tagSource', nullable: true })).toBeNull();
    expect(emptyValueFor(null)).toBe('');
  });
});

describe('serializeConfigDoc', () => {
  it('round-trips through YAML under a generated header', () => {
    const yml = serializeConfigDoc(DOC);
    expect(yml.startsWith('# Guild Manager config')).toBe(true);
    expect(yml).toContain('medallion: dynamic:level');
    expect(yml).toContain('- - dynamic:hp');
  });
});
