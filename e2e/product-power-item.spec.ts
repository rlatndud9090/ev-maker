import { expect, test, type Page } from '@playwright/test'
import { cards, openProduct, selectTab, tabPanel, waitComplete } from './helpers'

// 방어 탭 상대 화력 도구 행(PRD R14, AC35): 기본 행은 상대 도구 없음, 점유율 기준 이상 화력 도구마다 "대도각참 [아이콘] 생명의구슬 34.4%" 별도 행.

const groupRow = (page: Page, key: readonly string[]) => cards(page).and(page.locator(`[data-group-key='${JSON.stringify(key)}']`))
const KINGAMBIT = ['ladder', 'kingambit'] as const
const LIFE_ORB = ['ladder', 'kingambit', 'lifeorb'] as const
/** 타입 강화 도구 → 기술 타입 slug */
const TYPE_ITEMS: Record<string, string> = {
  blackbelt: 'fighting',
  blackglasses: 'dark',
  charcoal: 'fire',
  dragonfang: 'dragon',
  fairyfeather: 'fairy',
  hardstone: 'rock',
  magnet: 'electric',
  metalcoat: 'steel',
  miracleseed: 'grass',
  mysticwater: 'water',
  nevermeltice: 'ice',
  poisonbarb: 'poison',
  sharpbeak: 'flying',
  twistedspoon: 'psychic',
  silverpowder: 'bug',
  silkscarf: 'normal',
  spelltag: 'ghost',
  softsand: 'ground',
}

test('방어 탭: 대도각참 기본 행 뒤에 생명의구슬 행(표지), 타입 강화 도구 행은 기술 타입이 맞을 때만, 화력 도구 최소 40%면 사라진다', async ({ page }) => {
  await openProduct(page)
  await selectTab(page, '방어')
  await waitComplete(page)

  const base = groupRow(page, KINGAMBIT)
  await expect(base).toHaveCount(1)
  await expect(base.getByTestId('berry-badge')).toHaveCount(0)
  const orb = groupRow(page, LIFE_ORB)
  await expect(orb).toHaveCount(1)
  await expect(orb).toHaveAttribute('data-berry', 'lifeorb')
  const badge = orb.getByTestId('berry-badge')
  await expect(badge).toHaveAttribute('data-item-id', 'lifeorb')
  await expect(badge.locator('img[data-item-icon="lifeorb"]')).toHaveCount(1)
  await expect(orb.getByTestId('item-variant-label')).toHaveText(/^생명의구슬 34\.\d%$/)
  await expect(base.getByTestId('item-variant-label')).toHaveCount(0)
  await expect(orb.locator('.card-toggle')).toHaveAccessibleName(/^대도각참.*생명의구슬 지닌 경우 \(사용률 34\.\d%\)/)
  // 사용률 순: 원래 행 바로 뒤(도구 행끼리는 점유율 순)
  const keys = await cards(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.groupKey))
  expect(keys.indexOf(JSON.stringify(LIFE_ORB))).toBe(keys.indexOf(JSON.stringify(KINGAMBIT)) + 1)

  // 타입 강화 도구 행: 보이는 기술(이름 칸 기술 배지) 타입이 그 도구 타입이다
  const typed = tabPanel(page).locator('[data-testid="card"][data-berry]')
  const n = await typed.count()
  let checked = 0
  for (let i = 0; i < n; i++) {
    const row = typed.nth(i)
    const item = (await row.getAttribute('data-berry')) ?? ''
    if (TYPE_ITEMS[item] === undefined) continue
    await expect(row.getByTestId('move-pick').getByTestId('move-label'), item).toHaveAttribute('data-type', TYPE_ITEMS[item])
    checked++
  }
  expect(checked).toBeGreaterThan(0)

  const field = page.getByRole('group', { name: '통계 설정', exact: true }).getByRole('spinbutton', { name: '화력 도구 최소(%)', exact: true })
  await expect(field).toHaveValue('5')
  await field.fill('40')
  await field.press('Tab')
  await waitComplete(page)
  await expect(groupRow(page, LIFE_ORB)).toHaveCount(0)
  await expect(groupRow(page, KINGAMBIT)).toHaveCount(1)
  await field.fill('5')
  await field.press('Tab')
  await waitComplete(page)
  await expect(groupRow(page, LIFE_ORB)).toHaveCount(1)
})

test('방어 탭: 대도각참 기본 행에서 배분을 바꿔도 생명의구슬 행 배분은 그대로다(도구를 가정한 배분은 따로, 사용자 결정 2026-11-14)', async ({ page }) => {
  await openProduct(page)
  await selectTab(page, '방어')
  await waitComplete(page)
  const base = groupRow(page, KINGAMBIT)
  const orb = groupRow(page, LIFE_ORB)
  const label = (row: typeof base) => row.getByTestId('card-bundle')
  const before = ((await label(base).textContent()) ?? '').trim()
  await expect(label(orb)).toHaveText(before)
  await base.locator('button.bundle-btn').click()
  const menu = base.getByRole('menu', { name: '노력치 배분', exact: true })
  const options = menu.getByRole('menuitemradio')
  expect(await options.count()).toBeGreaterThan(1)
  // 지금 배분이 아닌 첫 선택지
  await options.and(page.locator('[aria-checked="false"]')).first().click()
  await expect(label(base)).not.toHaveText(before)
  await expect(label(orb)).toHaveText(before)
})
