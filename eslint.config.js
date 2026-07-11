import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// The single-letter names CLAUDE.md blesses as conventional idioms, plus `_` for
// throwaway params. `id-length` flags any other single-letter identifier
// (advisory only — see note below).
const NAMING_IDIOMS = ['i', 'v', 'n', 'a', 'b', 'e', 'r', '_'];

export default [
  { ignores: ['dist/**', 'dev/**', '.vite/**'] },

  js.configs.recommended,

  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The two classic, universally-valuable hook rules. The rest of v7's
      // recommended set is React-Compiler-oriented and flags idiomatic patterns
      // this codebase uses deliberately (latest-value refs, ref-forwarding
      // callbacks, mutual RAF references), so it is intentionally not enabled.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Correctness first; unused vars are an error, `_`-prefixed and the omit
      // siblings of a rest destructure (`const { id, ...rest }`) are opt-out.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true,
      }],
      // camelCase is enforced (catches snake_case regressions); property names
      // are left alone because tag/config data uses non-camel keys.
      camelcase: ['error', { properties: 'never' }],
      // Encode the relaxed naming rule (CLAUDE.md): full words, minus a small
      // set of blessed single-letter idioms. Advisory (warn) so it guides new
      // code without failing CI or forcing a churn of existing callback params.
      'id-length': ['warn', { min: 2, exceptions: NAMING_IDIOMS, properties: 'never' }],
    },
  },

  // Build/tooling configs and the standalone session server run in Node.
  {
    files: ['vite.config.js', 'eslint.config.js', 'server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
