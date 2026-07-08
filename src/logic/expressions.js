// Arithmetic expression engine for dynamic (`dyn,`) tag payloads.
//
// Grammar (whitespace-insensitive):
//   expr    := term (('+'|'-') term)*
//   term    := unary (('*'|'/'|'%') unary)*
//   unary   := '-' unary | primary
//   primary := number | reference | function '(' expr (',' expr)* ')' | '(' expr ')'
//
// - numbers   — integer or decimal literals (`10`, `0.5`, `.5`)
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
 * @property {'number'|'ref'|'call'|'unary'|'binary'} kind
 * Shapes by kind:
 * - `{ kind:'number', value:number }`
 * - `{ kind:'ref',    scope:'static'|'dyn', path:string }` — lowercased colon
 *   path, may contain wildcards; `scope` is `'dyn'` when the brace content
 *   carried the `dyn,` prefix
 * - `{ kind:'call',   name:string, args:AstNode[] }`
 * - `{ kind:'unary',  op:'-', operand:AstNode }`
 * - `{ kind:'binary', op:'+'|'-'|'*'|'/'|'%', left:AstNode, right:AstNode }`
 */

// Callable-function registry (extension point, mirrors MODIFIER_REGISTRY).
// `arity` fixes the argument count; `variadic` accepts one or more.
export const EXPRESSION_FUNCTIONS = {
  floor: { arity: 1, apply: (a) => Math.floor(a) },
  ceil:  { arity: 1, apply: (a) => Math.ceil(a) },
  round: { arity: 1, apply: (a) => Math.round(a) },
  sqrt:  { arity: 1, apply: (a) => Math.sqrt(a) },
  min:   { variadic: true, apply: (...args) => Math.min(...args) },
  max:   { variadic: true, apply: (...args) => Math.max(...args) },
};

const NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)/;
const IDENT_RE = /^[a-z_][a-z0-9_]*/i;
const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '%', '(', ')', ',']);

// Turns source text into { type, value } tokens, or returns an error string.
// Types: 'number' (value: number), 'ref' (value: path string), 'ident'
// (value: name), 'op' (value: character).
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
    if (OPERATOR_CHARS.has(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    const rest = source.slice(i);
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

  function parseExpr() {
    let left = parseTerm();
    while (left && (isOp('+') || isOp('-'))) {
      const op = tokens[pos++].value;
      const right = parseTerm();
      left = right ? { kind: 'binary', op, left, right } : null;
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (left && (isOp('*') || isOp('/') || isOp('%'))) {
      const op = tokens[pos++].value;
      const right = parseUnary();
      left = right ? { kind: 'binary', op, left, right } : null;
    }
    return left;
  }

  function parseUnary() {
    if (isOp('-')) {
      pos += 1;
      const operand = parseUnary();
      return operand ? { kind: 'unary', op: '-', operand } : null;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return fail('unexpected end of expression');
    if (token.type === 'number') { pos += 1; return { kind: 'number', value: token.value }; }
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
    const text = token.type === 'ref'
      ? `{${token.scope === 'dyn' ? 'dyn,' : ''}${token.value}}`
      : token.value;
    return { ast: null, error: `unexpected "${text}"` };
  }
  return { ast, error: null };
}

/**
 * Evaluates a parsed AST to a number. Pure arithmetic fold; never throws on
 * a `parseExpression`-produced AST. Non-finite intermediates (division by
 * zero, sqrt of a negative) propagate — the caller decides how to handle
 * NaN/Infinity results.
 *
 * @param {AstNode} ast - Output of `parseExpression`
 * @param {(path: string, scope: 'static'|'dyn') => number} resolveReference -
 *   Maps a `ref` path + scope to a number. Defaulting/warning policy for
 *   unresolvable paths lives in the caller (see `logic/dynamicTags.js`).
 * @returns {number}
 */
export function evaluateExpression(ast, resolveReference) {
  switch (ast.kind) {
    case 'number': return ast.value;
    case 'ref':    return resolveReference(ast.path, ast.scope);
    case 'unary':  return -evaluateExpression(ast.operand, resolveReference);
    case 'call':
      return EXPRESSION_FUNCTIONS[ast.name].apply(
        ...ast.args.map(arg => evaluateExpression(arg, resolveReference)));
    case 'binary': {
      const left = evaluateExpression(ast.left, resolveReference);
      const right = evaluateExpression(ast.right, resolveReference);
      switch (ast.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
        case '%': return left % right;
        default:  return NaN;
      }
    }
    default: return NaN;
  }
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
