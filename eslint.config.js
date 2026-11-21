import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts', '**/dist/**', '.data/**', 'data/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
