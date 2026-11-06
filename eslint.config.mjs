/** Shared quality rules; third-party code and local databases are excluded. */
export default [
  {
    ignores: [
      'node_modules/**',
      '.tools/**',
      '.cache/**',
      'data/**',
      'coverage/**',
      'dist/vendor/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: 'error',
      curly: ['error', 'all'],
      'prefer-const': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'no-duplicate-imports': 'error',
    },
  },
  {
    files: ['dist/*.js'],
    languageOptions: {
      globals: { document: 'readonly', window: 'readonly', localStorage: 'readonly' },
    },
  },
];
