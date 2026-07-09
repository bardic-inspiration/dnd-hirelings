// Rules registry runtime configuration (public/config/rules.yml): the
// configurable ruleset. The `dynamic:` section maps tag addresses to the
// expressions governing dynamic (`dyn,`) tag values; future rule kinds become
// sibling sections. The deployed file ships the reference D&D ruleset — this
// is the first fully config-driven slice of the game rules (see
// docs/architecture.md → Dynamic Tags).
//
// Expression format: the whole expression is wrapped in a square-bracket
// envelope — `"[10+floor(({ability:dex}-10)/2)]"` — isolating it from pattern
// strings and other special-character grammars. In the raw YAML file the
// envelope MUST be quoted (`[…{…}…]` unquoted is a YAML flow-collection parse
// error); the Config Modal's text inputs quote on serialize automatically.

import { parseExpression } from './expressions.js';

/**
 * Shipped defaults for `public/config/rules.yml`: no rules. The deployed file
 * carries the reference ruleset; this default only backs a missing or
 * unparseable file.
 *
 * @type {{ dynamic: {} }}
 */
export const DEFAULT_RULES_CONFIG = Object.freeze({ dynamic: Object.freeze({}) });

/**
 * Config-editor schema for `public/config/rules.yml` (see logic/configEditor.js
 * for the descriptor grammar). `dynamic:` accepts any address key, so the
 * Config Modal's ADD-key affordance authors new rules directly.
 */
export const RULES_SCHEMA = {
  kind: 'map',
  closed: true,
  keys: {
    dynamic: {
      kind: 'map',
      anyKey: { kind: 'scalar', value: 'expression' },
    },
  },
};

// Strips the square-bracket envelope from a raw rule entry. Returns the inner
// expression text, or null when the envelope is absent/malformed.
function stripEnvelope(raw) {
  const text = String(raw ?? '').trim();
  if (!text.startsWith('[') || !text.endsWith(']') || text.length < 2) return null;
  return text.slice(1, -1);
}

/**
 * Guards a raw rules-config document into the normalized shape. Every entry
 * under `dynamic:` becomes `{ expression, error }`: `expression` is the
 * envelope-stripped text (or `null` when unusable), `error` a human-readable
 * problem (missing envelope, expression parse failure) or `null`. Lenient —
 * malformed sections degrade to no rules, never throws. Parsing here is
 * validation only; evaluation re-parses per use (logic/dynamicTags.js).
 *
 * @param {object} doc - Raw document from `yaml.load` (may be `null`/partial)
 * @returns {{ dynamic: { [address: string]: { expression: string|null, error: string|null } } }}
 */
export function normalizeRulesConfig(doc) {
  const source = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  const dynamicIn = source.dynamic && typeof source.dynamic === 'object' && !Array.isArray(source.dynamic)
    ? source.dynamic
    : {};
  const dynamic = {};
  for (const [address, raw] of Object.entries(dynamicIn)) {
    const key = String(address).toLowerCase().trim();
    if (!key) continue;
    if (raw === null || typeof raw === 'object') {
      dynamic[key] = { expression: null, error: 'expected a "[…]"-wrapped expression string' };
      continue;
    }
    const expression = stripEnvelope(raw);
    if (expression === null) {
      dynamic[key] = { expression: null, error: 'expression must be wrapped in [brackets]' };
      continue;
    }
    const { error } = parseExpression(expression);
    dynamic[key] = error
      ? { expression: null, error }
      : { expression, error: null };
  }
  return { dynamic };
}
