import globals from 'globals';
import pluginJs from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  {
    rules: {
      'require-atomic-updates': 0,
      'no-useless-escape': 0,
      'no-console': 0,
      'linebreak-style': ['error', 'unix'],
      semi: ['error', 'always'],
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  pluginJs.configs.recommended,
  eslintPluginPrettierRecommended,
];
