module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // This codebase documents props in comments rather than PropTypes, and
    // prop-types is not a dependency. Leaving the rule on produced ~470
    // unfixable errors that buried the real ones.
    'react/prop-types': 'off',
    // The audit parser declares its DOM helpers inside processAuditFile and
    // calls parseRequirementSection ~80 lines before declaring it, which is
    // exactly the hoisting this rule exists to discourage — but the rule
    // guards ES5 semantics that don't apply to block-scoped module code, and
    // "fixing" it means either converting a hoisted call into a
    // temporal-dead-zone crash or lifting ~270 lines of the most fragile
    // parsing code in the app to module scope. Neither is worth it for a
    // style rule.
    'no-inner-declarations': 'off',
  },
  overrides: [
    {
      files: ['cypress/**/*.js'],
      env: { node: true },
      globals: {
        cy: 'readonly',
        Cypress: 'readonly',
        describe: 'readonly',
        context: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        expect: 'readonly',
        assert: 'readonly',
      },
    },
  ],
}
