// 기술 선택 목록 정렬(PRD R16, AC38, 사용자 결정 2026-11-14): 기술 단위 채용률 높은 순, 계산 불가 → 무효는 맨 뒤.
// 기대 순서는 기본 통계 메타 JSON의 상대 기술 사용률에서 직접 낸다(방어 탭 래더 후보 동률은 id 순).
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { cards, openProduct, selectTab, waitComplete } from './helpers'

interface Entry { id: string; moves: { shares: Record<string, number> } }
interface IndexItem { match: 'bo1' | 'bo3'; month: string; battles: number }
/** 기본 통계(최근 월에서 판수가 더 많은 매치 방식, 동률 Bo1)의 항목 */
function defaultEntries(): Map<string, Entry> {
  const items = (JSON.parse(readFileSync(new URL('../src/data/meta/index.json', import.meta.url), 'utf8')) as { regulations: Record<string, IndexItem[]> }).regulations['m-c']
  const month = items.map((i) => i.month).sort().at(-1)!
  const pick = items.filter((i) => i.month === month).reduce((a, b) => (b.battles > a.battles || (b.battles === a.battles && b.match === 'bo1') ? b : a))
  const entries = (JSON.parse(readFileSync(new URL(`../src/data/meta/m-c/${month}-${pick.match}.json`, import.meta.url), 'utf8')) as { entries: Entry[] }).entries
  return new Map(entries.map((e) => [e.id, e]))
}

test('방어 탭: 래더 상대 기술 메뉴 항목 순서 = 그 상대 기술 사용률 순(같은 기술 항목은 이어짐), 계산 불가·무효는 맨 뒤', async ({ page }) => {
  const meta = defaultEntries()
  await openProduct(page)
  await selectTab(page, '방어')
  await waitComplete(page)

  const rows = cards(page)
  const n = Math.min(await rows.count(), 6)
  let multi = 0
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const [source, id] = JSON.parse((await row.getAttribute('data-group-key')) ?? '[]') as string[]
    const pick = row.getByTestId('move-pick')
    if (source !== 'ladder' || (await pick.count()) === 0) continue
    await pick.click()
    const options = row.getByTestId('move-menu').locator('[role="menuitemradio"]')
    const entries = await options.evaluateAll((els) => els.map((e) => ({ move: (e as HTMLElement).dataset.move ?? '', status: (e as HTMLElement).dataset.status ?? '' })))
    await page.keyboard.press('Escape')
    const tail = (s: string) => (s === 'error' ? 1 : s === 'immune' ? 2 : 0)
    expect(entries.map((e) => tail(e.status)), id).toEqual([...entries.map((e) => tail(e.status))].sort((a, b) => a - b))
    const head = entries.filter((e) => tail(e.status) === 0).map((e) => e.move)
    const distinct = head.filter((m, k) => head.indexOf(m) === k)
    // 같은 기술 항목은 이어진다
    expect(head.filter((m, k) => k === 0 || head[k - 1] !== m), id).toEqual(distinct)
    const shares = meta.get(id)?.moves.shares ?? {}
    const share = (m: string) => shares[m] ?? 0
    expect(distinct, id).toEqual([...distinct].sort((a, b) => share(b) - share(a) || (a < b ? -1 : a > b ? 1 : 0)))
    if (distinct.length >= 3) multi++
  }
  expect(multi).toBeGreaterThan(0)
})
