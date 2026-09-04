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
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
);
