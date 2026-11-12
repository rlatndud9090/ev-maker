import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // 포켓몬·도구 PNG(수백 장)는 data URI로 JS에 넣지 않고 별도 파일로 낸다(번들 크기 유지, 목록은 지연 로드). 그 밖(타입 SVG 등)은 기본 규칙.
    assetsInlineLimit: (file) => (file.endsWith('.png') ? false : undefined),
  },
  test: {
    exclude: [...configDefaults.exclude, '.claude/worktrees/**', 'e2e/**'],
  },
})
