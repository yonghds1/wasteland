import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', '*.js', '*.cjs', '*.mjs', '**/__tests__/**/*.mjs']
  },
  // Base ESLint recommended rules
  eslint.configs.recommended,
  // TypeScript strict rules
  ...tseslint.configs.strict,
  // Prettier config (disables conflicting rules)
  eslintConfigPrettier,
  // Custom rules
  {
    rules: {
      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Allow empty functions
      '@typescript-eslint/no-empty-function': 'off',
      // Allow explicit any (can be tightened later)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Prefer const
      'prefer-const': 'error',
      // No var
      'no-var': 'error',
    }
  },
  // Test files: fixtures are constructed and asserted immediately, non-null
  // assertions on them are idiomatic; keep source strict.
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // 测试断言终端控制序列（\x1b[..）属正常输入
      'no-control-regex': 'off',
    }
  }
);
