import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['backend/{src,test}/**/*.ts', 'backend/*.config.ts', 'frontend/src/**/*.{ts,tsx}', 'frontend/vite.config.ts'],
  extends: [js.configs.recommended, tseslint.configs.recommended],
  linterOptions: { noInlineConfig: true },
  rules: {
    'no-irregular-whitespace': ['error', { skipJSXText: true }],
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    }],
  },
}, {
  files: ['frontend/src/sessionRouting.ts'],
  // Rejecting control characters in navigation targets is intentional.
  rules: { 'no-control-regex': 'off' },
}, {
  files: ['backend/src/database/migration.service.ts', 'backend/src/jobs/crypto-provider.service.ts'],
  // These boundaries replace database and provider errors with fixed safe codes.
  rules: { 'preserve-caught-error': 'off' },
});
