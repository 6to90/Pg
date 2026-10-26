import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'contracts/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^(query)$/] > TemplateLiteral[expressions.length>0]',
          message: 'Use parameterized queries ($1, $2); never interpolate into SQL.',
        },
        {
          selector: 'CallExpression[callee.property.name=/^(parseFloat)$/]',
          message: 'Floating point is forbidden for monetary values.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Floating point is forbidden for monetary values.' },
      ],
    },
  },
  { files: ['**/*.mjs', '**/*.js'], ...tseslint.configs.disableTypeChecked },
);
