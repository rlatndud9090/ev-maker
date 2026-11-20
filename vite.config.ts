import { execSync } from 'node:child_process'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/** 작업 브랜치 이름 → 탭 라벨("worktree-feature+cut-lock-budget"·"feature/cut-lock-budget" → "cut lock budget"). 기본 브랜치·읽기 실패면 없음. */
function branchTabLabel(branch: string): string | undefined {
  const name = branch.trim().replace(/^worktree-/, '').replace('+', '/')
  if (name === '' || name === 'HEAD' || name === 'main' || name === 'master') return undefined
  return name.replace(/^[a-z]+\//, '').replace(/[-_]+/g, ' ')
}

function currentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

/** 개발 서버에서만 탭 제목 앞에 작업 라벨을 붙인다(여러 작업 트리를 동시에 띄울 때 구분용). VITE_TAB_LABEL이 있으면 그 값을 쓴다. */
function devTabLabel(): Plugin {
  return {
    name: 'dev-tab-label',
    apply: 'serve',
    transformIndexHtml(html) {
      const label = process.env.VITE_TAB_LABEL?.trim() || branchTabLabel(currentBranch())
      return label === undefined ? html : html.replace('<title>', `<title>[${label}] `)
    },
  }
}

export default defineConfig({
  plugins: [react(), devTabLabel()],
  build: {
    // 포켓몬·도구 PNG(수백 장)는 data URI로 JS에 넣지 않고 별도 파일로 낸다(번들 크기 유지, 목록은 지연 로드). 그 밖(타입 SVG 등)은 기본 규칙.
    assetsInlineLimit: (file) => (file.endsWith('.png') ? false : undefined),
  },
  test: {
    exclude: [...configDefaults.exclude, '.claude/worktrees/**', 'e2e/**'],
    // 실데이터 전체 스윕 테스트는 단독 약 2초지만 병렬 실행 CPU 경합에서 기본 5초를 넘는다.
    testTimeout: 30_000,
  },
})
