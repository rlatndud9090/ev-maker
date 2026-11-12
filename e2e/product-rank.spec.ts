import { expect, test, type Locator, type Page } from '@playwright/test'
import { cards, combo, mySet, openProduct, selectTab, tabPanel, waitComplete } from './helpers'

// 랭크 행은 능동 랭크업만(사용자 피드백 2026-11-12): 상대가 거는 하락·그 반응(오기 등)은 행이 아니고,
// 방어 탭 상대 랭크업은 첫 턴 전용 기술(만나자마자)과 묶지 않으며 동시채용 하한 미달 조합(명상 × 파멸의빛)은 만들지 않는다.

const groupRow = (page: Page, id: string) => cards(page).and(page.locator(`[data-group-key='${JSON.stringify(['ladder', id])}']`))
const detailRows = (row: Locator) => row.getByTestId('row')

async function expand(row: Locator) {
  await expect(row).toHaveCount(1)
  const toggle = row.locator('.card-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(detailRows(row).first()).toBeVisible()
}

test.describe('랭크 행: 능동 랭크업만', () => {
  test('공격 탭 대도각참(오기): 어흥염 위협·막말내뱉기로 인한 "+1" 랭크 행이 없다', async ({ page }) => {
    await openProduct(page)
    const species = combo(mySet(page), '종')
    await species.fill('대도각참')
    await species.press('Enter')
    await expect(species).toHaveValue('대도각참')
    await expect(mySet(page).getByLabel('특성')).toHaveValue('defiant')
    await expect(combo(mySet(page), '기술 4')).toHaveValue('안다리걸기')
    await waitComplete(page)

    // 내 세트에 능동 랭크업이 없으니 공격 탭 어디에도 랭크 라벨이 없다.
    await expect(tabPanel(page).getByTestId('move-rank')).toHaveCount(0)
    const incineroar = groupRow(page, 'incineroar')
    await expand(incineroar)
    expect(await detailRows(incineroar).count()).toBeGreaterThan(0)
    await expect(incineroar.locator('[data-testid="row"][data-row-kind="rank"]')).toHaveCount(0)
    await expect(incineroar.getByTestId('move-label').filter({ hasText: '+1 안다리걸기' })).toHaveCount(0)
  })

  test('방어 탭 예시 세트: 갑주무사 칼춤 조건에 만나자마자 없음, 플라엣테 명상 조건에 파멸의빛 없음(기본 조건엔 있음)', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)

    const golisopod = groupRow(page, 'golisopodmega')
    await expand(golisopod)
    const sd = golisopod.locator(`[data-testid="row"][data-row-kind="rank"][data-condition='${JSON.stringify(['opponent', 'move', 'swordsdance'])}']`)
    expect(await sd.count()).toBeGreaterThan(0)
    for (const move of await sd.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.move))) expect(['leechlife', 'ironhead']).toContain(move)
    await expect(golisopod.locator('[data-testid="row"][data-row-kind="rank"][data-move="firstimpression"]')).toHaveCount(0)
    await expect(golisopod.getByTestId('move-label').filter({ hasText: '+2 만나자마자' })).toHaveCount(0)

    const floette = groupRow(page, 'floettemega')
    await expand(floette)
    await expect(floette.locator('[data-testid="row"][data-condition="base"][data-move="lightofruin"]').first()).toBeAttached()
    const cm = floette.locator(`[data-testid="row"][data-row-kind="rank"][data-condition='${JSON.stringify(['opponent', 'move', 'calmmind'])}']`)
    expect(await cm.count()).toBeGreaterThan(0)
    await expect(cm.and(page.locator('[data-move="lightofruin"]'))).toHaveCount(0)
    await expect(floette.getByTestId('move-label').filter({ hasText: '+1 파멸의빛' })).toHaveCount(0)
  })
})
