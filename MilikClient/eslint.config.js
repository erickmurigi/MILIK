import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Capitalized bindings are exempt because that's the convention for a destructured
      // JSX component reference (e.g. `({ icon: Icon }) => <Icon />`) — varsIgnorePattern
      // alone only covers plain variable declarations, not destructured function params,
      // so that exact pattern was still flagged as unused despite being rendered right below.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
      // Checked every flagged instance (48, all catch{}) before adding this — all of them are
      // the established, deliberate pattern of silently falling back on a non-critical,
      // best-effort operation (reading/writing a draft from localStorage/sessionStorage, etc.),
      // not accidental missing logic. This is ESLint's own documented escape hatch for exactly
      // that case; a genuinely empty `if`/`for`/`while` block is still flagged as before.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
