import { describe, it, expect } from 'vitest';
import { getRegistryNode, isRegisteredLeaf, resolveTagValue, VALUE_RESOLVER_REGISTRY } from './tagValues.js';
import { parseTag } from './tags.js';

const registry = {
  class: { fighter: {}, druid: { circle: {} } },
  skill: { arcana: {} },
};

describe('getRegistryNode', () => {
  it('returns the node at a registered path', () => {
    expect(getRegistryNode(registry, ['class', 'fighter'])).toEqual({});
    expect(getRegistryNode(registry, ['class', 'druid'])).toEqual({ circle: {} });
  });

  it('normalizes case and whitespace', () => {
    expect(getRegistryNode(registry, ['Class', ' FIGHTER '])).toEqual({});
  });

  it('returns undefined for missing paths, empty paths, and missing registry', () => {
    expect(getRegistryNode(registry, ['class', 'paladin'])).toBeUndefined();
    expect(getRegistryNode(registry, [])).toBeUndefined();
    expect(getRegistryNode(undefined, ['class'])).toBeUndefined();
  });
});

describe('isRegisteredLeaf', () => {
  it('is true only for registered childless nodes', () => {
    expect(isRegisteredLeaf(registry, ['class', 'fighter'])).toBe(true);
    expect(isRegisteredLeaf(registry, ['class', 'druid'])).toBe(false); // has children
    expect(isRegisteredLeaf(registry, ['class', 'paladin'])).toBe(false); // unregistered
    expect(isRegisteredLeaf(undefined, ['class', 'fighter'])).toBe(false);
  });
});

describe('resolveTagValue', () => {
  it('lets an explicit =value win for every resolver', () => {
    const parsed = parseTag('skill:arcana=3');
    expect(resolveTagValue('match', parsed, registry)).toBe('3');
    expect(resolveTagValue('display', parsed, registry)).toBe('3');
    expect(resolveTagValue('numeric', parsed, registry)).toBe(3);
  });

  it('match: resolves presence (true) without an explicit value', () => {
    expect(resolveTagValue('match', parseTag('class:fighter'), registry)).toBe(true);
  });

  it('display: resolves a registered leaf terminal to its segment string', () => {
    expect(resolveTagValue('display', parseTag('class:fighter'), registry)).toBe('fighter');
    expect(resolveTagValue('display', parseTag('skill:arcana'), registry)).toBe('arcana');
  });

  it('display: is strict — non-leaf, unregistered, missing registry, empty all resolve null', () => {
    expect(resolveTagValue('display', parseTag('class:druid'), registry)).toBe(null); // registered non-leaf
    expect(resolveTagValue('display', parseTag('class:paladin'), registry)).toBe(null); // unregistered
    expect(resolveTagValue('display', parseTag('class:fighter'), undefined)).toBe(null); // no registry
    expect(resolveTagValue('display', { segments: [], value: null }, registry)).toBe(null);
  });

  it('numeric: coerces only explicit finite values; leaf strings never coerce', () => {
    expect(resolveTagValue('numeric', parseTag('ability:str=14'), registry)).toBe(14);
    expect(resolveTagValue('numeric', parseTag('ability:str=abc'), registry)).toBe(null);
    expect(resolveTagValue('numeric', parseTag('class:fighter'), registry)).toBe(null);
  });

  it('returns null for unknown use cases', () => {
    expect(resolveTagValue('unknown', parseTag('class:fighter'), registry)).toBe(null);
  });

  it('exposes the resolvers as a registry for pluggable use cases', () => {
    expect(Object.keys(VALUE_RESOLVER_REGISTRY).sort()).toEqual(['display', 'match', 'numeric']);
  });
});
