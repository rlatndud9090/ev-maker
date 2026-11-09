import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.cache', '.claude/worktrees', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // 층 경계: core ← meta ← cards(순수) ← app. ui는 제품·dev 공용, 제품 코드는 dev를 모른다.
  {
    files: ['src/cards/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/cards는 React를 쓰지 않는다.' },
            { name: 'react-dom', message: 'src/cards는 React를 쓰지 않는다.' },
          ],
          patterns: [
            { group: ['react-dom/*'], caseSensitive: true, message: 'src/cards는 React를 쓰지 않는다.' },
            { group: ['**/app', '**/app/**', '**/ui', '**/ui/**', '**/dev', '**/dev/**'], caseSensitive: true, message: 'src/cards는 app·ui·dev를 import하지 않는다.' },
            { group: ['**/data/loader', '**/data/meta-loader'], caseSensitive: true, message: 'src/cards는 데이터를 입력으로 받는다(로더 import 금지).' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/dev', '**/dev/**'], caseSensitive: true, message: '제품 코드는 src/dev를 import하지 않는다.' }] }],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/dev', '**/dev/**'], caseSensitive: true, message: '제품 코드는 src/dev를 import하지 않는다.' },
            { group: ['**/app', '**/app/**'], caseSensitive: true, message: 'src/ui는 src/app을 import하지 않는다.' },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
])
