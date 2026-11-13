import { expect, test, type Locator, type Page } from '@playwright/test'
import { cards, combo, mySet, openProduct, selectTab, tabPanel, waitComplete } from './helpers'

// 공격 탭 상대 도구(사용자 피드백 2026-11-12): 기합의띠는 고려하지 않고(기본 행 = 도구 없음), 도구 통계에 유의미한 반감열매는
// 그 열매가 가장 센 기술에 발동할 때만 별도 행 "대쓰여너 (마코)". 순풍은 스피드 탭 전용 토글 버튼.

const groupRow = (page: Page, key: readonly string[]) => cards(page).and(page.locator(`[data-group-key='${JSON.stringify(key)}']`))
const BASCULEGION = ['ladder', 'basculegion'] as const
const COLBUR = ['ladder', 'basculegion', 'colburberry'] as const

async function chooseKingambit(page: Page) {
  const species = combo(mySet(page), '종')
  await species.fill('대도각참')
  await species.press('Enter')
  await expect(species).toHaveValue('대도각참')
  // 목록 안 종으로 바꾸면 기술 사용률 상위 4개(도각참·기습·아이언헤드·안다리걸기), 도구(생명의구슬)·SP(A32)는 그대로
  await expect(combo(mySet(page), '기술 1')).toHaveValue('도각참')
  await expect(combo(mySet(page), '도구')).toHaveValue('생명의구슬')
  await waitComplete(page)
}

/** 행을 펼쳐 상세의 기본 조건 도각참 행 칸 판정 목록 */
async function kowtowCategories(row: Locator): Promise<string[]> {
  const toggle = row.locator('.card-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const detail = row.getByTestId('row').and(row.locator('[data-move="kowtowcleave"][data-condition="base"]'))
  await expect(detail).toHaveCount(1)
  // 변화 없음 행은 칸이 없고 고정 판정만, 변동 행은 33칸
  const cells = detail.getByTestId('band-cell')
  if ((await cells.count()) === 0) return [(await detail.locator('.row-fixed').textContent()) ?? '']
  return cells.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.category ?? ''))
}

test.describe('공격 탭 상대 도구: 기합의띠 없음 · 반감열매 별도 행', () => {
  test('예시 세트(드래곤·땅 기술): 대쓰여너 기본 행만, 마코열매 행 없음(열매가 발동하는 기술이 없다)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await expect(groupRow(page, BASCULEGION)).toHaveCount(1)
    await expect(groupRow(page, COLBUR)).toHaveCount(0)
    await expect(tabPanel(page).getByTestId('berry-badge')).toHaveCount(0)
  })

  test('대도각참 생명의구슬: 대쓰여너(대표 도구 기합의띠)가 전 배분 확정견딤이 아니고, 바로 뒤에 "대쓰여너 (마코)" 행', async ({ page }) => {
    await openProduct(page)
    await chooseKingambit(page)

    const base = groupRow(page, BASCULEGION)
    await expect(base).toHaveCount(1)
    await expect(base.getByTestId('berry-badge')).toHaveCount(0)
    // 기본 행: 기합의띠를 고려하지 않아 생명의구슬 도각참 칸이 모두 확정견딤은 아니다(띠면 전부 확정견딤)
    const baseCats = await kowtowCategories(base)
    expect(baseCats.length).toBeGreaterThan(0)
    expect(baseCats.every((c) => c === 'guaranteed-survive' || /확정견딤/.test(c))).toBe(false)

    // 열매 행: 이름 옆 배지 "(마코)", data-item-id, 접근 이름 "… 마코열매 지닌 경우"
    const berry = groupRow(page, COLBUR)
    await expect(berry).toHaveCount(1)
    await expect(berry).toHaveAttribute('data-berry', 'colburberry')
    const badge = berry.getByTestId('berry-badge')
    await expect(badge).toHaveAttribute('data-item-id', 'colburberry')
    // 배지는 열매 이미지(Champions 가방 스프라이트, 툴팁 "마코열매"), 이미지는 장식(alt="")이고 접근 이름은 숨김 글자가 낸다
    const icon = badge.locator('img[data-item-icon="colburberry"]')
    await expect(icon).toHaveAttribute('alt', '')
    await expect(badge).toHaveAttribute('title', '마코열매')
    await expect(badge).not.toContainText('(마코)')
    await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(48)
    await expect(berry.locator('.card-name')).toContainText('대쓰여너')
    await expect(berry.locator('.card-toggle')).toHaveAccessibleName(/^대쓰여너.*마코열매 지닌 경우/)
    // 사용률 순: 원래 행 바로 뒤
    const keys = await cards(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.groupKey))
    expect(keys.indexOf(JSON.stringify(COLBUR))).toBe(keys.indexOf(JSON.stringify(BASCULEGION)) + 1)
    // 열매가 도각참을 반감해 같은 배분의 판정이 기본 행과 다르다
    const berryCats = await kowtowCategories(berry)
    expect(berryCats).not.toEqual(baseCats)

    // 열매가 발동하는 기술이 없는 상대(고릴타 오카열매 5.0% — 불꽃 기술 없음)는 열매 행이 없다
    await expect(cards(page).and(page.locator('[data-opponent="rillaboom"]'))).toHaveCount(1)
    await expect(cards(page).and(page.locator('[data-opponent="rillaboom"][data-berry]'))).toHaveCount(0)

    // 계산결과순에서도 열매 행은 별도 행
    await page.getByTestId('sort-toggle').getByRole('button', { name: '계산결과순', exact: true }).click()
    await expect(groupRow(page, COLBUR)).toHaveCount(1)
    await expect(groupRow(page, BASCULEGION)).toHaveCount(1)
  })

  test('열매 행 고정은 기본 행과 따로, 반감열매 최소(%) 100이면 열매 행이 사라지고 5로 돌리면 다시 생긴다', async ({ page }) => {
    await openProduct(page)
    await chooseKingambit(page)
    const berry = groupRow(page, COLBUR)
    await expect(berry).toHaveCount(1)
    // 열매 행 배분 고정 → 기본 행은 고정 아님
    // (상세 배분 목록은 R9로 없어져 배지 메뉴의 핀으로 고정한다)
    await berry.locator('button.bundle-btn').click()
    const menu = berry.getByRole('menu', { name: '노력치 배분', exact: true })
    const pin = menu.getByTestId('bundle-pin').first()
    await pin.click()
    await expect(pin).toHaveAttribute('aria-checked', 'true')
    await expect(menu.locator('[role="menuitemradio"][data-pinned="true"]')).toHaveCount(1)
    await menu.press('Escape')
    await expect(groupRow(page, BASCULEGION).locator('[data-pinned="true"]')).toHaveCount(0)
    await expect(groupRow(page, BASCULEGION)).not.toHaveAttribute('data-pinned', 'true')

    const field = page.getByRole('group', { name: '통계 설정', exact: true }).getByRole('spinbutton', { name: '반감열매 최소(%)', exact: true })
    await expect(field).toHaveValue('5')
    await field.fill('100')
    await field.press('Tab')
    await waitComplete(page)
    await expect(tabPanel(page).locator('[data-testid="card"][data-berry]')).toHaveCount(0)
    await expect(groupRow(page, BASCULEGION)).toHaveCount(1)
    await field.fill('5')
    await field.press('Tab')
    await waitComplete(page)
    await expect(groupRow(page, COLBUR)).toHaveCount(1)
  })
})

test('통계 설정 줄: 1280에서 형식·기준 월·최소(%) 네 칸이 한 줄이다(반감열매 칸이 혼자 다음 줄로 내려가지 않는다)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openProduct(page)
  const stats = page.getByRole('group', { name: '통계 설정', exact: true })
  const controls = stats.locator('select, input')
  await expect(controls).toHaveCount(6)
  const bottoms = await controls.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)))
  expect(new Set(bottoms).size, JSON.stringify(bottoms)).toBe(1)
  for (const name of ['SP 배분', '랭크업 기술', '구애스카프', '반감열매']) {
    const box = await stats.getByRole('spinbutton', { name: `${name} 최소(%)`, exact: true }).boundingBox()
    expect(box?.width ?? 0, name).toBeLessThan(110)
  }
})

test.describe('순풍 토글(스피드 탭 전용)', () => {
  test('공격·방어 탭에는 없고, 스피드 탭에서 aria-pressed 토글로 다시 계산하며, 탭을 오가도 값이 남는다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const display = page.getByRole('group', { name: '표시 설정', exact: true })
    await expect(display.getByTestId('tailwind-toggles')).toHaveCount(0)
    await expect(display.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByTestId('roll-threshold')).toBeVisible()
    await selectTab(page, '방어')
    await expect(display.getByTestId('tailwind-toggles')).toHaveCount(0)
    await expect(page.getByTestId('roll-threshold')).toBeVisible()

    await selectTab(page, '스피드')
    await waitComplete(page)
    await expect(page.getByTestId('roll-threshold')).toHaveCount(0)
    const group = display.getByRole('group', { name: '순풍', exact: true })
    const mine = group.getByRole('button', { name: '내 순풍', exact: true })
    const theirs = group.getByRole('button', { name: '상대 순풍', exact: true })
    await expect(mine).toHaveAttribute('aria-pressed', 'false')
    await expect(theirs).toHaveAttribute('aria-pressed', 'false')
    // 정렬 토글과 같은 스타일 계열(segmented)
    await expect(group).toHaveClass(/segmented/)
    // 정렬 토글처럼 위에 보이는 묶음 라벨 "순풍"이 있고, 그 라벨이 묶음 이름이다
    const caption = display.locator('.sort-field').filter({ has: page.getByTestId('tailwind-toggles') }).locator('.sort-label')
    await expect(caption).toHaveText('순풍')
    await expect(caption).toBeVisible()
    expect(await group.getAttribute('aria-labelledby')).toBe(await caption.getAttribute('id'))

    const orders = () => cards(page).evaluateAll((els) => els.map((e) => e.querySelector('[data-testid="order-badge"]')?.textContent ?? ''))
    const before = await orders()
    const gen = Number(await tabPanel(page).getAttribute('data-generation'))
    await mine.click()
    await expect(mine).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => Number(await tabPanel(page).getAttribute('data-generation'))).toBeGreaterThan(gen)
    await waitComplete(page)
    const after = await orders()
    expect(after).not.toEqual(before)
    // 내 순풍이면 스피드가 2배라 후공이 줄어든다(판정이 내 쪽으로만 움직인다)
    expect(after.filter((t) => t.startsWith('후공')).length).toBeLessThan(before.filter((t) => t.startsWith('후공')).length)

    // 다른 탭에서는 숨길 뿐 값은 유지
    await selectTab(page, '공격')
    await expect(display.getByTestId('tailwind-toggles')).toHaveCount(0)
    await selectTab(page, '스피드')
    await expect(group.getByRole('button', { name: '내 순풍', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await group.getByRole('button', { name: '내 순풍', exact: true }).click()
    await expect(group.getByRole('button', { name: '내 순풍', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await waitComplete(page)
    expect(await orders()).toEqual(before)
  })
})
