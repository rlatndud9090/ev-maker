import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// dist는 webServer(npm run build)가 먼저 만든다. 제품 진입 번들에 dev 화면 코드가 섞이지 않고 지연 청크에만 있어야 한다.
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
// '스윕 대상'은 카드 모델 오류 문구("행 …에 스윕 대상이 없다")에도 있어 dev 고유가 아니다. dev 스윕 패널 제목 'SP 스윕'을 쓴다.
const DEV_ONLY = ['계산 코어 확인 페이지', 'SP 스윕']

const read = (rel: string) => readFileSync(join(DIST, rel.replace(/^\//, '')), 'utf8')

/** 엔트리 스크립트 + modulepreload 청크 + 엔트리가 정적으로 import하는 청크(동적 import("…")는 제외). */
function eagerChunks(): string[] {
  const html = read('index.html')
  const entry = [...html.matchAll(/<script type="module"[^>]*\bsrc="([^"]+\.js)"/g)].map((m) => m[1])
  const preload = [...html.matchAll(/<link rel="modulepreload"[^>]*\bhref="([^"]+\.js)"/g)].map((m) => m[1])
  const seen = new Set<string>()
  const queue = [...entry, ...preload].map((p) => p.replace(/^\//, ''))
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const code = read(file)
    for (const m of code.matchAll(/(?:\bimport|\bfrom)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(join(dirname(file), m[1]))
  }
  return [...seen]
}

test('엔트리·선로드 청크에는 dev 고유 문자열이 없고, 지연 청크에만 있다', () => {
  const eager = eagerChunks()
  expect(eager.length).toBeGreaterThan(0)
  for (const file of eager) for (const s of DEV_ONLY) expect(read(file), `${file}에 "${s}"`).not.toContain(s)

  const lazy = readdirSync(join(DIST, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `assets/${f}`)
    .filter((f) => !eager.includes(f))
  for (const s of DEV_ONLY) expect(lazy.filter((f) => read(f).includes(s)), `"${s}"가 든 지연 청크`).not.toHaveLength(0)
})
