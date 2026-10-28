import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'reports/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: {
      'no-restricted-globals': ['error', 'require', 'module', 'exports', '__dirname', '__filename'],
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['fixtures/**/*.js'],
    rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] },
  },
  {
    // Functions passed to page.evaluate / addInitScript execute inside Chrome.
    files: ['ui/**/*.js', 'pages/**/*.js', 'flows/**/*.js', 'support/browser/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
];
