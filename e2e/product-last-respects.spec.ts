import { expect, test } from '@playwright/test'
import { cards, combo, mySet, openProduct, selectTab, waitComplete } from './helpers'

// 성묘 위력 항목(PRD R15, AC37, 사용자 결정 2026-11-14): 성묘는 "성묘(100)"·"성묘(150)"·"성묘(200)" 세 항목이고 위력 50 항목은 없다.
// 타부자고 방어 탭 대쓰여너 카드의 기본 기술은 고스트다이브가 아니라 성묘 계열이다.

test('방어 탭 타부자고: 대쓰여너 기술 목록에 성묘(100)·(150)·(200), 위력 50 성묘 없음, 기본 기술 성묘 계열', async ({ page }) => {
  await openProduct(page)
  const species = combo(mySet(page), '종')
  await species.fill('타부자고')
  await species.press('Enter')
  await expect(species).toHaveValue('타부자고')
  await selectTab(page, '방어')
  await waitComplete(page)

  const row = cards(page).and(page.locator(`[data-group-key='${JSON.stringify(['ladder', 'basculegion'])}']`))
  await expect(row).toHaveCount(1)
  const pick = row.getByTestId('move-pick')
  await expect(pick.locator('.move-name')).toHaveText(/^성묘\((100|150|200)\)$/)
  await expect(pick).toHaveAccessibleName(/성묘\((100|150|200)\) 기술 선택/)

  await pick.click()
  const options = row.getByTestId('move-menu').locator('[role="menuitemradio"]')
  const entries = await options.evaluateAll((els) =>
    els.map((e) => ({ key: JSON.parse((e as HTMLElement).dataset.itemKey ?? '[]') as [string, string], name: e.querySelector('.move-name')?.textContent ?? '' })),
  )
  const lastRespects = entries.filter((e) => e.key[0] === 'lastrespects')
  expect(lastRespects.map((e) => e.key[1]).sort()).toEqual([1, 2, 3].map((n) => JSON.stringify(['faint', n])).sort())
  expect(lastRespects.map((e) => e.name).sort()).toEqual(['성묘(100)', '성묘(150)', '성묘(200)'])
  expect(entries.some((e) => e.name === '성묘')).toBe(false)
  expect(entries.some((e) => e.key[0] === 'phantomforce')).toBe(true)
  await page.keyboard.press('Escape')
})
