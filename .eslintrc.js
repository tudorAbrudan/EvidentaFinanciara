module.exports = {
  root: true,
  extends: ['expo', 'prettier'],
  plugins: ['prettier', 'import', 'security', 'jest'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  rules: {
    'prettier/prettier': 'warn',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'react-hooks/exhaustive-deps': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'import/order': [
      'warn',
      { 'newlines-between': 'always', alphabetize: { order: 'asc', caseInsensitive: true } },
    ],
    'import/no-cycle': 'error',
    'security/detect-unsafe-regex': 'warn',
    'security/detect-eval-with-expression': 'error',
  },
  overrides: [
    {
      files: ['__tests__/**/*.{ts,tsx}'],
      env: { 'jest/globals': true },
      rules: {
        'security/detect-non-literal-fs-filename': 'off',
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },
    {
      files: ['.eslintrc.js', '*.config.js', '*.config.cjs'],
      parserOptions: { project: null },
      rules: {
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/no-misused-promises': 'off',
        '@typescript-eslint/await-thenable': 'off',
      },
    },
    {
      files: ['scripts/**/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    '.expo/',
    'dist/',
    'build/',
    'coverage/',
    'ios/',
    'android/',
  ],
};
