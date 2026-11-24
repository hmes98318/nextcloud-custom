// @ts-check
import eslint from '@eslint/js';
import perfectionist from 'eslint-plugin-perfectionist';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const namingConvention = [
  {
    selector: 'default',
    format: ['strictCamelCase'],
    leadingUnderscore: 'forbid',
    trailingUnderscore: 'forbid',
  },
  {
    selector: ['variable', 'parameter'],
    modifiers: ['unused'],
    format: ['strictCamelCase'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'variable',
    modifiers: ['const', 'global'],
    format: ['strictCamelCase', 'UPPER_CASE'],
  },
  {
    selector: 'classProperty',
    modifiers: ['static', 'readonly'],
    format: ['UPPER_CASE'],
  },
  { selector: 'enumMember', format: ['UPPER_CASE'] },
  { selector: 'typeLike', format: ['StrictPascalCase'] },
  {
    selector: ['objectLiteralProperty', 'typeProperty'],
    modifiers: ['requiresQuotes'],
    format: null,
  },
  { selector: 'import', format: null },
];

export default defineConfig(
  globalIgnores(['dist/', 'build/', 'coverage/']),
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { perfectionist },
    rules: {
      curly: ['error', 'all'],
      'default-case': 'error',
      'default-case-last': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'guard-for-in': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-implicit-coercion': [
        'error',
        { boolean: false, number: true, string: true },
      ],
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-object-constructor': 'error',
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'PrivateIdentifier',
          message: 'Use TypeScript `private` instead of `#private` fields.',
        },
        {
          selector: 'TSEnumDeclaration[const=true]',
          message: 'Use a plain `enum` instead of `const enum`.',
        },
        {
          selector: 'ExportNamedDeclaration > VariableDeclaration[kind="let"]',
          message: 'Do not export mutable bindings; export a getter function.',
        },
        {
          selector:
            ':matches(NewExpression, CallExpression)[callee.name="Array"]',
          message:
            'Do not use the Array constructor; use an array literal or Array.from.',
        },
        {
          selector: 'CallExpression[callee.name="parseFloat"]',
          message:
            'Do not use parseFloat; use Number and check the result for NaN.',
        },
        {
          selector:
            'CallExpression[callee.name="parseInt"]:not([arguments.length=2])',
          message:
            'Do not use parseInt without a non-decimal radix; use Number.',
        },
        {
          selector:
            'CallExpression[callee.name="parseInt"][arguments.1.value=10]',
          message:
            'Do not use parseInt for decimal input; use Number and check the result for NaN.',
        },
        {
          selector: 'VariableDeclarator > FunctionExpression[generator=false]',
          message:
            'Do not use function expressions; use a function declaration or an arrow function.',
        },
        {
          selector:
            ':matches(Program, ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator[init.type="ArrowFunctionExpression"]:not([id.typeAnnotation])',
          message:
            'Declare top-level named functions with `function`; use an arrow function only when a type annotation requires it.',
        },
      ],
      'no-var': 'error',
      'one-var': ['error', 'never'],
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'natural',
          order: 'asc',
          newlinesBetween: 1,
          internalPattern: ['^@/.+', '^~/.+', '^#.+'],
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
          ],
        },
      ],
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-check': false,
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],
      '@typescript-eslint/naming-convention': ['error', ...namingConvention],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/parameter-properties': [
        'error',
        { prefer: 'parameter-property' },
      ],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'function',
          format: ['strictCamelCase', 'StrictPascalCase'],
        },
        {
          selector: 'variable',
          types: ['function'],
          format: ['strictCamelCase', 'StrictPascalCase', 'UPPER_CASE'],
        },
        ...namingConvention,
      ],
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
    },
  },
  {
    files: ['**/*.config.{ts,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-exports': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
