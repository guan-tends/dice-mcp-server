import js from '@eslint/js'

export default [
  js.configs.recommended,
  {
    ignores: ['node_modules/', 'coverage/'],
  },
  {
    files: ['src/**/*.js', '__tests__/**/*.js', 'bin/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
]
