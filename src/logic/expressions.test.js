import { describe, it, expect, vi } from 'vitest';
import {
  parseExpression, evaluateExpression, collectReferences,
  evaluateCheck, evaluateDynamic, EXPRESSION_FUNCTIONS,
} from './expressions.js';

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

describe('comparisons and booleans', () => {
  it('yields 1 or 0 for every comparison', () => {
    expect(evaluate('3>2')).toBe(1);
    expect(evaluate('3<2')).toBe(0);
    expect(evaluate('2>=2')).toBe(1);
    expect(evaluate('2<=1')).toBe(0);
    expect(evaluate('2==2')).toBe(1);
    expect(evaluate('2!=2')).toBe(0);
  });

  it('yields 1 or 0 for && || !, reading any nonzero as true', () => {
    expect(evaluate('1&&0')).toBe(0);
    expect(evaluate('2&&-3')).toBe(1);
    expect(evaluate('0||0')).toBe(0);
    expect(evaluate('0||5')).toBe(1);
    expect(evaluate('!0')).toBe(1);
    expect(evaluate('!7')).toBe(0);
    expect(evaluate('!!7')).toBe(1);
  });

  it('binds loosest to tightest: || && comparison + * unary', () => {
    expect(evaluate('1||0&&0')).toBe(1);        // || looser than &&
    expect(evaluate('1+2>2&&1')).toBe(1);       // arithmetic before comparison
    expect(evaluate('2*3==6')).toBe(1);
    expect(evaluate('!0+1')).toBe(2);           // unary ! tighter than +
    expect(evaluate('-2<-1')).toBe(1);
    expect(evaluate('1<2==1')).toBe(1);         // comparisons are left-associative
  });

  it('compares reference values', () => {
    expect(evaluate('{skill:stealth}+3>=11', { 'skill:stealth': 8 })).toBe(1);
    expect(evaluate('{skill:stealth}+3>=11', { 'skill:stealth': 7 })).toBe(0);
  });

  it('propagates a non-finite operand through comparisons and booleans', () => {
    expect(Number.isNaN(evaluate('1/0>1'))).toBe(true);
    expect(Number.isNaN(evaluate('sqrt(0-1)==1'))).toBe(true);
    expect(Number.isNaN(evaluate('0&&sqrt(0-1)'))).toBe(true);
    expect(Number.isNaN(evaluate('1||1/0'))).toBe(true);
    expect(Number.isNaN(evaluate('!sqrt(0-1)'))).toBe(true);
  });

  it('rejects a lone = | or &', () => {
    const errorOf = (source) => parseExpression(source).error;
    expect(errorOf('1=1')).toMatch(/unexpected character "="/);
    expect(errorOf('1|0')).toMatch(/unexpected character "\|"/);
    expect(errorOf('1&0')).toMatch(/unexpected character "&"/);
    expect(errorOf('1>')).toMatch(/unexpected end/);
  });
});

describe('dice literals', () => {
  // A roll stub that records its calls and returns count*sides (the maximum).
  const rolling = () => {
    const calls = [];
    return { calls, roll: (count, sides) => { calls.push([count, sides]); return count * sides; } };
  };

  it('parses NdM as one dice node; dM means 1dM', () => {
    expect(parseExpression('2d6').ast).toEqual({ kind: 'dice', count: 2, sides: 6 });
    expect(parseExpression('d20').ast).toEqual({ kind: 'dice', count: 1, sides: 20 });
    expect(parseExpression('D8').ast).toEqual({ kind: 'dice', count: 1, sides: 8 });
  });

  it('calls roll(n, m) from the function table, once per dice node', () => {
    const { calls, roll } = rolling();
    const { ast } = parseExpression('d20+{skill:stealth}>=11 && 2d6>3');
    const value = evaluateExpression(ast, () => 2, { ...EXPRESSION_FUNCTIONS, roll: { arity: 2, apply: roll } });
    expect(value).toBe(1);
    expect(calls).toEqual([[1, 20], [2, 6]]);
  });

  it('evaluates to NaN when the table has no roll', () => {
    const { ast } = parseExpression('d20+5');
    expect(Number.isNaN(evaluateExpression(ast, () => 0))).toBe(true);
  });

  it('rejects zero or fractional dice', () => {
    expect(parseExpression('0d6').error).toMatch(/dice/);
    expect(parseExpression('2d0').error).toMatch(/dice/);
    expect(parseExpression('1.5d6').error).toMatch(/unexpected/);
  });

  it('keeps unknown identifiers that only start with d as errors', () => {
    expect(parseExpression('d20x').error).toMatch(/unknown function "d20x"/);
    expect(parseExpression('dex').error).toMatch(/unknown function "dex"/);
  });

  it('is not a reference: collectReferences skips it', () => {
    const { ast } = parseExpression('d20+{skill:combat}');
    expect(collectReferences(ast)).toEqual([{ path: 'skill:combat', scope: 'static' }]);
  });
});

describe('determinism (#117)', () => {
  it('EXPRESSION_FUNCTIONS never contains randomness', () => {
    expect(EXPRESSION_FUNCTIONS).not.toHaveProperty('roll');
    expect(parseExpression('roll(1,20)').error).toMatch(/unknown function "roll"/);
  });

  it('evaluateDynamic never rolls: a dice expression warns and defaults to 1', () => {
    const { ast } = parseExpression('d20+{xp}');
    const resolve = vi.fn(() => 5);
    expect(evaluateDynamic(ast, resolve)).toEqual({ value: 1, warning: expect.stringMatching(/dice/) });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('evaluateDynamic matches evaluateExpression on a dice-free expression', () => {
    const { ast } = parseExpression('max(1, floor({xp}/125))>=2');
    const resolve = () => 300;
    expect(evaluateDynamic(ast, resolve)).toEqual({ value: evaluateExpression(ast, resolve), warning: null });
  });
});

describe('evaluateCheck', () => {
  it('parses and evaluates a check with the given resolver and roll', () => {
    const roll = vi.fn(() => 9);
    const { value, error } = evaluateCheck('d20+{skill:stealth}>=11', {
      resolve: (path) => (path === 'skill:stealth' ? 2 : 0),
      roll,
    });
    expect(error).toBeNull();
    expect(value).toBe(1);
    expect(roll).toHaveBeenCalledWith(1, 20);
  });

  it('evaluates a dice expression to its rolled total', () => {
    expect(evaluateCheck('2d6+1', { resolve: () => 0, roll: (count, sides) => count * sides }).value).toBe(13);
  });

  it('returns NaN with the parse error for bad source, without rolling', () => {
    const roll = vi.fn();
    const { value, error } = evaluateCheck('d20+', { resolve: () => 0, roll });
    expect(Number.isNaN(value)).toBe(true);
    expect(error).toMatch(/unexpected end/);
    expect(roll).not.toHaveBeenCalled();
  });

  it('leaves dice NaN when no roll is given', () => {
    expect(Number.isNaN(evaluateCheck('d6', { resolve: () => 0 }).value)).toBe(true);
  });
});
