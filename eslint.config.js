// ESLint 9 flat config (same rules as the former .eslintrc.json).
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(
  { ignores: ['dist/', 'dist-firefox/', 'node_modules/'] },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      // src/*.ts are classic scripts sharing one global scope: declarations
      // used only by other files would be reported as unused.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
