import { describe, it, expect } from 'vitest';
import { parseExpression, evaluateExpression, collectReferences } from './expressions.js';

// Parses then evaluates in one step; fails the test on parse errors.
// Dyn-scoped refs read from `refs` under a 'dyn,'-prefixed key.
const evaluate = (source, refs = {}) => {
  const { ast, error } = parseExpression(source);
  expect(error).toBeNull();
  return evaluateExpression(ast, (path, scope) => refs[scope === 'dyn' ? `dyn,${path}` : path]);
};

describe('parseExpression + evaluateExpression', () => {
  it('applies operator precedence and parentheses', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('10-4-3')).toBe(3);       // left-associative
    expect(evaluate('20/2/5')).toBe(2);
    expect(evaluate('7%3')).toBe(1);
  });

  it('handles unary minus', () => {
    expect(evaluate('-5+3')).toBe(-2);
    expect(evaluate('2*-3')).toBe(-6);
    expect(evaluate('--4')).toBe(4);
  });

  it('keeps decimal results', () => {
    expect(evaluate('5/2')).toBe(2.5);
    expect(evaluate('0.5*3')).toBe(1.5);
    expect(evaluate('.5+.25')).toBe(0.75);
  });

  it('evaluates functions', () => {
    expect(evaluate('floor(2.9)')).toBe(2);
    expect(evaluate('ceil(2.1)')).toBe(3);
    expect(evaluate('round(2.5)')).toBe(3);
    expect(evaluate('sqrt(9)')).toBe(3);
    expect(evaluate('min(3,1,2)')).toBe(1);
    expect(evaluate('max(3,1,2)')).toBe(3);
    expect(evaluate('min(4)')).toBe(4); // variadic accepts one arg
  });

  it('resolves braced tag references', () => {
    expect(evaluate('{ability:dex}-10', { 'ability:dex': 14 })).toBe(4);
    expect(evaluate('10+floor(({ability:dex}-10)/2)', { 'ability:dex': 15 })).toBe(12);
    expect(evaluate('{hp-max}*2', { 'hp-max': 8 })).toBe(16); // hyphenated names are referenceable
    expect(evaluate('{ Ability:DEX }', { 'ability:dex': 14 })).toBe(14); // trimmed + lowercased
  });

  it('scopes dyn-prefixed references separately from static ones', () => {
    // Same address, different scope: {level} is the static tag, {dyn,level} the dynamic total.
    expect(evaluate('{level}+{dyn,level}', { level: 3, 'dyn,level': 5 })).toBe(8);
    expect(evaluate('max(2, {dyn,level})', { 'dyn,level': 4 })).toBe(4); // commas stay unambiguous
    expect(evaluate('{ DYN, Level }', { 'dyn,level': 5 })).toBe(5); // trimmed + lowercased
  });

  it('parses wildcard reference paths in both scopes', () => {
    const { ast, error } = parseExpression('{class:*}+{skill:**}+{dyn,class:*}');
    expect(error).toBeNull();
    expect(collectReferences(ast)).toEqual([
      { path: 'class:*', scope: 'static' },
      { path: 'skill:**', scope: 'static' },
      { path: 'class:*', scope: 'dyn' },
    ]);
  });

  it('propagates non-finite intermediates to the caller', () => {
    expect(evaluate('1/0')).toBe(Infinity);
    expect(Number.isNaN(evaluate('sqrt(0-1)'))).toBe(true);
  });

  it('evaluates the canonical level formula', () => {
    const level = 'max(1, floor(0.5*(1+sqrt(1+{xp}/125))))';
    expect(evaluate(level, { xp: 0 })).toBe(1);
    expect(evaluate(level, { xp: 1000 })).toBe(2);
    expect(evaluate(level, { xp: 6000 })).toBe(4);
  });
});

describe('parseExpression errors', () => {
  const errorOf = (source) => {
    const { ast, error } = parseExpression(source);
    expect(ast).toBeNull();
    return error;
  };

  it('rejects bare identifiers outside function calls', () => {
    expect(errorOf('xp+1')).toMatch(/\{braces\}/);
    expect(errorOf('floor')).toMatch(/must be called/);
  });

  it('rejects unknown functions and bad arity', () => {
    expect(errorOf('log(2)')).toMatch(/unknown function "log"/);
    expect(errorOf('floor(1,2)')).toMatch(/floor expects 1 argument/);
  });

  it('rejects unbalanced braces and parentheses', () => {
    expect(errorOf('{ability:dex')).toMatch(/unclosed/);
    expect(errorOf('1+2}')).toMatch(/unexpected "\}"/);
    expect(errorOf('(1+2')).toMatch(/unbalanced/);
    expect(errorOf('floor(1')).toMatch(/unbalanced/);
    expect(errorOf('{}')).toMatch(/empty \{\} reference/);
  });

  it('rejects dangling operators, trailing tokens, and empty input', () => {
    expect(errorOf('1+')).toMatch(/unexpected end/);
    expect(errorOf('1 2')).toMatch(/unexpected/);
    expect(errorOf('2{xp}')).toMatch(/unexpected "\{xp\}"/);
    expect(errorOf('')).toMatch(/empty expression/);
    expect(errorOf('1 & 2')).toMatch(/unexpected character "&"/);
  });
});

describe('collectReferences', () => {
  it('returns unique typed refs in first-appearance order', () => {
    const { ast } = parseExpression('{a}+{b}*({a}-floor({c:d}))');
    expect(collectReferences(ast)).toEqual([
      { path: 'a', scope: 'static' },
      { path: 'b', scope: 'static' },
      { path: 'c:d', scope: 'static' },
    ]);
  });

  it('dedupes per scope, not per path', () => {
    const { ast } = parseExpression('{a}+{dyn,a}+{a}');
    expect(collectReferences(ast)).toEqual([
      { path: 'a', scope: 'static' },
      { path: 'a', scope: 'dyn' },
    ]);
  });

  it('returns empty for reference-free expressions', () => {
    const { ast } = parseExpression('1+2');
    expect(collectReferences(ast)).toEqual([]);
  });
});
