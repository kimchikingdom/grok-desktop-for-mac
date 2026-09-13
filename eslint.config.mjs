import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', 'tests/.tmp/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', importNames: ['remote'], message: 'remote module is disabled.' },
          ],
        },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    // The renderer must never reach Node APIs directly (spec 5.1).
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['electron', 'node:*', 'fs', 'path', 'child_process', 'os'], message: 'Renderer code may only use the preload bridge.' },
            { group: ['@grok-desktop/security', '@grok-desktop/acp-client'], message: 'Main-process-only packages are not allowed in the renderer.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // electron-builder loads its hooks as CommonJS from the packaging process.
    files: ['apps/desktop/build/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly', console: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Plain Node ESM helpers that are not part of the TypeScript program.
    files: ['tests/fixtures/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        setTimeout: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
