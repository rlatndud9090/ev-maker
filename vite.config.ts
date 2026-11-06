import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, '.claude/worktrees/**', 'e2e/**'],
  },
})
