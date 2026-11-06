import { expect, test } from '@playwright/test'
import { openPage } from './helpers'

const SWEEP_MEDIAN_LIMIT_MS = 50

// src/dev/perf.ts의 window.__perf 모양(앱 tsconfig와 분리돼 있어 여기서 다시 선언한다).
interface PerfStats {
  median: number
  min: number
  max: number
  runs: number
}
declare global {
  interface Window {
    __perf?: { sweep(runs?: number, warmup?: number): Promise<PerfStats>; batch(runs?: number, warmup?: number): Promise<PerfStats> }
  }
}

test('브라우저 코어 성능: 33칸 스윕 중앙값 ≤ 50ms, 1×300×1 일괄 측정', async ({ page, browserName, browser }) => {
  await openPage(page)
  const sweep = await page.evaluate(() => window.__perf!.sweep(50, 5))
  const batch = await page.evaluate(() => window.__perf!.batch(10, 2))
  const env = `${browserName} ${browser.version()}`
  const fmt = (s: PerfStats) => `median ${s.median.toFixed(2)}ms (min ${s.min.toFixed(2)}, max ${s.max.toFixed(2)}, n=${s.runs})`
  console.log(`[perf] ${env} sweep33: ${fmt(sweep)}`)
  console.log(`[perf] ${env} batch1x300x1: ${fmt(batch)}`)
  test.info().annotations.push({ type: 'perf', description: `sweep33 ${fmt(sweep)}; batch ${fmt(batch)}` })
  expect(sweep.median).toBeLessThanOrEqual(SWEEP_MEDIAN_LIMIT_MS)
})
