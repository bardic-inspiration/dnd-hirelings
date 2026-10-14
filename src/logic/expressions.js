// Expression engine for the dynamic-tag rules registry
// (public/config/rules.yml → logic/rulesConfig.js) and the task engine's
// checks (docs/spec/task-engine.md "Expressions").
//
// Grammar (whitespace-insensitive), loosest to tightest:
//   expr       := and ('||' and)*
//   and        := comparison ('&&' comparison)*
//   comparison := sum (('=='|'!='|'>='|'<='|'>'|'<') sum)*
//   sum        := term (('+'|'-') term)*
//   term       := unary (('*'|'/'|'%') unary)*
//   unary      := ('-'|'!') unary | primary
//   primary    := number | dice | reference
//               | function '(' expr (',' expr)* ')' | '(' expr ')'
//
// - numbers   — integer or decimal literals (`10`, `0.5`, `.5`)
// - booleans  — comparisons and `&& || !` yield 1 or 0; any nonzero operand
//   reads as true. Both sides always evaluate (no short-circuit), so how many
//   dice an expression rolls never depends on its values.
// - dice      — `NdM` (`d20` = `1d20`), N and M positive integers: one node
//   that calls `roll(N, M)` from the evaluation's function table. Without a
//   `roll` it evaluates to NaN; `EXPRESSION_FUNCTIONS` never has one.
// - reference — a tag address wrapped in braces. `{ability:dex}` reads the
//   STATIC tag at the address; `{dyn,ability:dex}` (the `dyn,` prefix inside
//   the braces) reads the DYNAMIC tag's total instead. Braces isolate tag
//   keys from operators, so any registered name (hyphens, digits) is
//   referenceable. The path may contain wildcard segments (`*`/`**`) —
//   resolution semantics are the caller's concern.
// - functions — bare identifiers are valid only as registered function names
//   followed by `(` (see EXPRESSION_FUNCTIONS); anything else is a parse error.
//
// Parsing and evaluation are split so callers can validate expressions
// without a resolution context (registry modal draft check) and extract the
// dependency graph (`collectReferences`) before evaluating.

/**
 * @typedef {object} AstNode
 * @property {'number'|'dice'|'ref'|'call'|'unary'|'binary'} kind
 * Shapes by kind:
 * - `{ kind:'number', value:number }`
 * - `{ kind:'dice',   count:number, sides:number }` — `NdM`
 * - `{ kind:'ref',    scope:'static'|'dyn', path:string }` — lowercased colon
 *   path, may contain wildcards; `scope` is `'dyn'` when the brace content
 *   carried the `dyn,` prefix
 * - `{ kind:'call',   name:string, args:AstNode[] }`
 * - `{ kind:'unary',  op:'-'|'!', operand:AstNode }`
 * - `{ kind:'binary', op:'+'|'-'|'*'|'/'|'%'|'=='|'!='|'>='|'<='|'>'|'<'|'&&'|'||',
 *     left:AstNode, right:AstNode }`
 */

// Callable-function registry (extension point, mirrors MODIFIER_REGISTRY).
// `arity` fixes the argument count; `variadic` accepts one or more. Never add
// randomness here: dynamic-tag payloads are stored, so a random value would
// churn saves and loop reconciliation. Dice reach a check only through the
// per-call table `evaluateCheck` builds.
export const EXPRESSION_FUNCTIONS = {
  floor: { arity: 1, apply: (a) => Math.floor(a) },
  ceil:  { arity: 1, apply: (a) => Math.ceil(a) },
  round: { arity: 1, apply: (a) => Math.round(a) },
  sqrt:  { arity: 1, apply: (a) => Math.sqrt(a) },
  min:   { variadic: true, apply: (...args) => Math.min(...args) },
  max:   { variadic: true, apply: (...args) => Math.max(...args) },
};

const NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)/;
const DICE_RE = /^(\d*)d(\d+)(?![a-z0-9_])/i;
const IDENT_RE = /^[a-z_][a-z0-9_]*/i;
const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '%', '(', ')', ',', '>', '<', '!']);
const TWO_CHAR_OPERATORS = new Set(['==', '!=', '>=', '<=', '&&', '||']);
const COMPARISON_OPERATORS = ['==', '!=', '>=', '<=', '>', '<'];

// Turns source text into { type, value } tokens, or returns an error string.
// Types: 'number' (value: number), 'dice' (count, sides), 'ref' (value: path
// string), 'ident' (value: name), 'op' (value: one- or two-character operator).
function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '{') {
      const end = source.indexOf('}', i + 1);
      if (end < 0) return { tokens: null, error: 'unclosed { reference' };
      const content = source.slice(i + 1, end).trim().toLowerCase();
      const scoped = content.startsWith('dyn,');
      const path = (scoped ? content.slice('dyn,'.length) : content).trim();
      if (path === '') return { tokens: null, error: 'empty {} reference' };
      tokens.push({ type: 'ref', scope: scoped ? 'dyn' : 'static', value: path });
      i = end + 1;
      continue;
    }
    if (ch === '}') return { tokens: null, error: 'unexpected "}"' };
    const pair = source.slice(i, i + 2);
    if (TWO_CHAR_OPERATORS.has(pair)) {
      tokens.push({ type: 'op', value: pair });
      i += 2;
      continue;
    }
    if (OPERATOR_CHARS.has(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    const rest = source.slice(i);
    const diceMatch = rest.match(DICE_RE);
    if (diceMatch) {
      const count = diceMatch[1] === '' ? 1 : parseInt(diceMatch[1], 10);
      const sides = parseInt(diceMatch[2], 10);
      if (count < 1 || sides < 1) {
        return { tokens: null, error: `invalid dice "${diceMatch[0]}" — N and M in NdM must be at least 1` };
      }
      tokens.push({ type: 'dice', count, sides });
      i += diceMatch[0].length;
      continue;
    }
    const numberMatch = rest.match(NUMBER_RE);
    if (numberMatch) {
      tokens.push({ type: 'number', value: parseFloat(numberMatch[0]) });
      i += numberMatch[0].length;
      continue;
    }
    const identMatch = rest.match(IDENT_RE);
    if (identMatch) {
      tokens.push({ type: 'ident', value: identMatch[0].toLowerCase() });
      i += identMatch[0].length;
      continue;
    }
    return { tokens: null, error: `unexpected character "${ch}" at ${i}` };
  }
  return { tokens, error: null };
}

/**
 * Parses an expression string into an AST. Never throws.
 *
 * @param {string} source - Expression text (a `dyn,` tag's payload)
 * @returns {{ ast: AstNode|null, error: string|null }} `error` is a
 *   human-readable parse failure (unknown function, bad arity, unbalanced
 *   parens/braces, bare identifier outside a call, unexpected end); exactly
 *   one of `ast`/`error` is non-null.
 */
export function parseExpression(source) {
  const { tokens, error } = tokenize(String(source ?? ''));
  if (error) return { ast: null, error };
  if (!tokens.length) return { ast: null, error: 'empty expression' };

  let pos = 0;
  const peek = () => tokens[pos] ?? null;
  const isOp = (value) => peek()?.type === 'op' && peek().value === value;
  let failure = null;
  const fail = (message) => { failure = failure ?? message; return null; };

  // One left-associative binary level: `next (op next)*` for any op in `ops`.
  function parseLevel(ops, next) {
    let left = next();
    while (left && ops.some(isOp)) {
      const op = tokens[pos++].value;
      const right = next();
      left = right ? { kind: 'binary', op, left, right } : null;
    }
    return left;
  }

  function parseExpr() { return parseLevel(['||'], parseAnd); }
  function parseAnd() { return parseLevel(['&&'], parseComparison); }
  function parseComparison() { return parseLevel(COMPARISON_OPERATORS, parseSum); }
  function parseSum() { return parseLevel(['+', '-'], parseTerm); }
  function parseTerm() { return parseLevel(['*', '/', '%'], parseUnary); }

  function parseUnary() {
    if (isOp('-') || isOp('!')) {
      const op = tokens[pos++].value;
      const operand = parseUnary();
      return operand ? { kind: 'unary', op, operand } : null;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return fail('unexpected end of expression');
    if (token.type === 'number') { pos += 1; return { kind: 'number', value: token.value }; }
    if (token.type === 'dice') { pos += 1; return { kind: 'dice', count: token.count, sides: token.sides }; }
    if (token.type === 'ref') { pos += 1; return { kind: 'ref', scope: token.scope, path: token.value }; }
    if (token.type === 'ident') return parseCall();
    if (token.type === 'op' && token.value === '(') {
      pos += 1;
      const inner = parseExpr();
      if (!inner) return null;
      if (!isOp(')')) return fail('unbalanced parenthesis');
      pos += 1;
      return inner;
    }
    return fail(`unexpected "${token.value}"`);
  }

  function parseCall() {
    const name = tokens[pos].value;
    const fn = EXPRESSION_FUNCTIONS[name];
    if (!fn) return fail(`unknown function "${name}" — tag references must be wrapped in {braces}`);
    pos += 1;
    if (!isOp('(')) return fail(`function "${name}" must be called with (…)`);
    pos += 1;
    const args = [];
    const first = parseExpr();
    if (!first) return null;
    args.push(first);
    while (isOp(',')) {
      pos += 1;
      const arg = parseExpr();
      if (!arg) return null;
      args.push(arg);
    }
    if (!isOp(')')) return fail('unbalanced parenthesis');
    pos += 1;
    if (!fn.variadic && args.length !== fn.arity) {
      return fail(`${name} expects ${fn.arity} argument${fn.arity === 1 ? '' : 's'}`);
    }
    return { kind: 'call', name, args };
  }

  const ast = parseExpr();
  if (!ast) return { ast: null, error: failure ?? 'invalid expression' };
  if (pos < tokens.length) {
    const token = tokens[pos];
    const text = token.type === 'ref' ? `{${token.scope === 'dyn' ? 'dyn,' : ''}${token.value}}`
      : token.type === 'dice' ? `${token.count}d${token.sides}`
      : token.value;
    return { ast: null, error: `unexpected "${text}"` };
  }
  return { ast, error: null };
}

// Booleans and comparisons yield 1/0; a non-finite operand yields NaN.
const truth = (value) => (value !== 0 ? 1 : 0);
const LOGIC_OPERATIONS = {
  '==': (a, b) => (a === b ? 1 : 0),
  '!=': (a, b) => (a !== b ? 1 : 0),
  '>=': (a, b) => (a >= b ? 1 : 0),
  '<=': (a, b) => (a <= b ? 1 : 0),
  '>':  (a, b) => (a > b ? 1 : 0),
  '<':  (a, b) => (a < b ? 1 : 0),
  '&&': (a, b) => truth(a) && truth(b),
  '||': (a, b) => truth(a) || truth(b),
};

const ARITHMETIC_OPERATIONS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
};

/**
 * Evaluates a parsed AST to a number. Pure fold; never throws on a
 * `parseExpression`-produced AST. Non-finite intermediates (division by
 * zero, sqrt of a negative) propagate — the caller decides how to handle
 * NaN/Infinity results.
 *
 * @param {AstNode} ast - Output of `parseExpression`
 * @param {(path: string, scope: 'static'|'dyn') => number} resolveReference -
 *   Maps a `ref` path + scope to a number. Defaulting/warning policy for
 *   unresolvable paths lives in the caller (see `logic/dynamicTags.js`).
 * @param {object} [functions=EXPRESSION_FUNCTIONS] - This call's function
 *   table. A `dice` node calls its `roll` entry (`apply(count, sides)`) and is
 *   NaN without one.
 * @returns {number}
 */
export function evaluateExpression(ast, resolveReference, functions = EXPRESSION_FUNCTIONS) {
  const evaluate = (node) => evaluateExpression(node, resolveReference, functions);
  switch (ast.kind) {
    case 'number': return ast.value;
    case 'dice':   return functions.roll ? functions.roll.apply(ast.count, ast.sides) : NaN;
    case 'ref':    return resolveReference(ast.path, ast.scope);
    case 'unary': {
      const operand = evaluate(ast.operand);
      if (ast.op === '-') return -operand;
      return Number.isFinite(operand) ? 1 - truth(operand) : NaN;
    }
    case 'call': {
      const fn = functions[ast.name];
      return fn ? fn.apply(...ast.args.map(evaluate)) : NaN;
    }
    case 'binary': {
      const left = evaluate(ast.left);
      const right = evaluate(ast.right);
      const arithmetic = ARITHMETIC_OPERATIONS[ast.op];
      if (arithmetic) return arithmetic(left, right);
      const logic = LOGIC_OPERATIONS[ast.op];
      if (!logic || !Number.isFinite(left) || !Number.isFinite(right)) return NaN;
      return logic(left, right);
    }
    default: return NaN;
  }
}

// True when any node in the AST is a dice literal.
function containsDice(node) {
  switch (node.kind) {
    case 'dice':   return true;
    case 'unary':  return containsDice(node.operand);
    case 'call':   return node.args.some(containsDice);
    case 'binary': return containsDice(node.left) || containsDice(node.right);
    default:       return false;
  }
}

/**
 * Evaluates a dynamic-tag rule. Never rolls: a rule containing dice is not
 * evaluated, and defaults to 1 with a warning.
 *
 * @param {AstNode} ast - Output of `parseExpression`
 * @param {(path: string, scope: 'static'|'dyn') => number} resolveReference
 * @returns {{ value: number, warning: string|null }}
 */
export function evaluateDynamic(ast, resolveReference) {
  if (containsDice(ast)) return { value: 1, warning: 'dice are not allowed in dynamic rules (defaulted to 1)' };
  return { value: evaluateExpression(ast, resolveReference, EXPRESSION_FUNCTIONS), warning: null };
}

/**
 * Parses and evaluates a task-engine check, rolling its dice through `roll`.
 *
 * @param {string} source - Expression text
 * @param {{ resolve: (path: string, scope: 'static'|'dyn') => number,
 *   roll?: (count: number, sides: number) => number }} context
 * @returns {{ value: number, error: string|null }} `value` is NaN when
 *   `error` (the parse failure) is set; nothing is rolled then.
 */
export function evaluateCheck(source, { resolve, roll }) {
  const { ast, error } = parseExpression(source);
  if (error) return { value: NaN, error };
  const functions = roll ? { ...EXPRESSION_FUNCTIONS, roll: { arity: 2, apply: roll } } : EXPRESSION_FUNCTIONS;
  return { value: evaluateExpression(ast, resolve, functions), error: null };
}

/**
 * Collects the unique references in an AST, in first-appearance order.
 * Feeds the dependency graph for dyn-tag evaluation ordering (only
 * `scope: 'dyn'` entries create evaluation-order edges).
 *
 * @param {AstNode} ast - Output of `parseExpression`
 * @returns {{ path: string, scope: 'static'|'dyn' }[]} Deduped references
 */
export function collectReferences(ast) {
  const refs = [];
  const seen = new Set();
  const walk = (node) => {
    if (node.kind === 'ref') {
      const key = `${node.scope}:${node.path}`;
      if (!seen.has(key)) { seen.add(key); refs.push({ path: node.path, scope: node.scope }); }
    }
    if (node.kind === 'unary') walk(node.operand);
    if (node.kind === 'call') node.args.forEach(walk);
    if (node.kind === 'binary') { walk(node.left); walk(node.right); }
  };
  walk(ast);
  return refs;
}
