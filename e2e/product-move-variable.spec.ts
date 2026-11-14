import { expect, test, type Locator, type Page } from '@playwright/test'
import { cards, openProduct, selectTab, tabPanel, waitComplete, type ProductTab } from './helpers'

// 기술 선택 목록 항목의 "변동" 배지(PRD R3, AC36, 사용자 결정 2026-11-14): 목록을 열면 그 줄 항목의 변동 판정을 먼저 계산하고,
// 변동 항목에는 배분 목록과 같은 "변동" 배지가 붙고 고정 항목에는 없다. 계산 전 항목은 배지 없이 보인다.

const menuItems = (row: Locator) => row.getByTestId('move-menu').locator('[role="menuitemradio"]')

/** 목록의 정상 항목이 모두 변동 판정(data-variable)을 받을 때까지 기다린다 */
async function waitJudged(row: Locator, timeout = 10_000) {
  await expect
    .poll(async () => menuItems(row).evaluateAll((els) => els.filter((e) => (e as HTMLElement).dataset.status === 'ok' && (e as HTMLElement).dataset.variable === undefined).length), { timeout })
    .toBe(0)
}

/** 변동·고정 정상 항목이 섞인 줄을 찾아 목록을 연 채로 돌려준다(없으면 null). ms = 열기 → 모든 정상 항목 판정까지 */
async function findMixed(page: Page): Promise<{ row: Locator; ms: number } | null> {
  const n = await cards(page).count()
  for (let i = 0; i < Math.min(n, 20); i++) {
    const row = cards(page).nth(i)
    const pick = row.getByTestId('move-pick')
    if ((await pick.count()) === 0) continue
    // 페이지 안에서 누른 순간부터 프레임마다 보아 잰다(테스트 러너 폴링 간격을 빼려고). undecided = 연 직후 판정 전 정상 항목 수
    const { ms, undecided } = await pick.evaluate(
      (btn) =>
        new Promise<{ ms: number; undecided: number }>((resolve) => {
          const li = btn.closest('[data-testid="card"]') as HTMLElement
          const left = () => [...li.querySelectorAll<HTMLElement>('[data-testid="move-menu"] [role="menuitemradio"]')].filter((e) => e.dataset.status === 'ok' && e.dataset.variable === undefined).length
          const start = performance.now()
          ;(btn as HTMLButtonElement).click()
          let first: number | undefined
          const tick = () => {
            const menu = li.querySelector('[data-testid="move-menu"]')
            if (menu !== null) {
              first ??= left()
              if (left() === 0) return resolve({ ms: Math.round(performance.now() - start), undecided: first })
            }
            if (performance.now() - start > 10_000) return resolve({ ms: -1, undecided: first ?? -1 })
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
    )
    await expect(row.getByTestId('move-menu')).toBeVisible()
    await waitJudged(row)
    if (undecided > 0) console.log(`[move-variable] 판정 전 ${undecided}항목 → 모두 판정 ${ms}ms`)
    const kinds = await menuItems(row).evaluateAll((els) => els.filter((e) => (e as HTMLElement).dataset.status === 'ok').map((e) => (e as HTMLElement).dataset.variable))
    if (kinds.includes('true') && kinds.includes('false')) return { row, ms }
    await page.keyboard.press('Escape')
  }
  return null
}

for (const tab of ['공격', '방어'] as const satisfies readonly ProductTab[]) {
  test(`${tab} 탭: 기술 선택 목록을 열면 변동 항목에 "변동" 배지가 붙고 고정 항목에는 없다(완료 상태 유지)`, async ({ page }) => {
    await openProduct(page)
    if (tab !== '공격') await selectTab(page, tab)
    await waitComplete(page)
    const found = await findMixed(page)
    expect(found, '변동·고정 항목이 섞인 줄').not.toBeNull()
    const { row, ms } = found!
    console.log(`[move-variable] ${tab} 탭 목록 열기 → 변동 배지 ${ms}ms`)
    const items = menuItems(row)
    const count = await items.count()
    for (let i = 0; i < count; i++) {
      const it = items.nth(i)
      const variable = await it.getAttribute('data-variable')
      await expect(it.getByTestId('variable-mark')).toHaveCount(variable === 'true' ? 1 : 0)
      if (variable === 'true') await expect(it.getByTestId('variable-mark')).toHaveText('변동 가능')
    }
    // 메뉴 작업은 진행률·완료에 세지 않는다
    await expect(tabPanel(page)).toHaveAttribute('data-complete', 'true')
    // 닫았다 다시 열어도 판정은 남아 있다(바로 배지가 보인다)
    await page.keyboard.press('Escape')
    await row.getByTestId('move-pick').click()
    await expect(items.filter({ has: page.getByTestId('variable-mark') }).first()).toBeVisible({ timeout: 1_000 })
  })
}
