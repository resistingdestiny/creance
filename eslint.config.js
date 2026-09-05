import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Minimal: the recommended sets and nothing else. Rules get added when a real
// problem justifies one, not up front.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'contracts/artifacts/**',
      'contracts/cache/**',
      'contracts/types/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        // Node 22 has it globally. Only plain JavaScript files need it declared:
        // typescript-eslint turns no-undef off for TypeScript, where the
        // compiler already knows.
        fetch: 'readonly',
      },
    },
  },
);
