import { expect, test, type Locator, type Page } from '@playwright/test'
import { adjustButton, adjustMenu, cards, combo, mySet, openAdjust, openProduct, tabPanel, waitComplete } from './helpers'

// 공격 탭 상대 도구(사용자 피드백 2026-11-12): 기합의띠는 고려하지 않고(기본 행 = 도구 없음), 도구 통계에 유의미한 반감열매는
// 그 열매가 가장 센 기술에 발동할 때만 별도 행 "대쓰여너 (마코)".

const groupRow = (page: Page, key: readonly string[]) => cards(page).and(page.locator(`[data-group-key='${JSON.stringify(key)}']`))
const BASCULEGION = ['ladder', 'basculegion'] as const
const COLBUR = ['ladder', 'basculegion', 'colburberry'] as const

async function chooseKingambit(page: Page) {
  const species = combo(mySet(page), '종')
  await species.fill('대도각참')
  await species.press('Enter')
  await expect(species).toHaveValue('대도각참')
  // 처음 고른 종은 대표 세트(R11: 도각참·기습·아이언헤드·안다리걸기, 도구·SP·성격도). 이 시나리오는 예시 세트의 생명의구슬·
  // 무보정·H2 A32 S32를 쓰므로 손으로 되돌린다.
  await expect(combo(mySet(page), '기술 1')).toHaveValue('도각참')
  const item = combo(mySet(page), '도구')
  await item.fill('생명의구슬')
  await item.press('Enter')
  await expect(item).toHaveValue('생명의구슬')
  const plus = mySet(page).locator('button.nat-btn.plus[aria-pressed="true"]')
  if ((await plus.count()) > 0) await plus.click()
  await expect(plus).toHaveCount(0)
  const sp = { HP: '2', 공격: '32', 방어: '0', 특공: '0', 특방: '0', 스피드: '32' }
  // 합계 상한을 넘지 않게 줄이는 칸부터
  for (const stat of ['HP', '방어', '특공', '특방', '공격', '스피드'] as const) await mySet(page).getByRole('spinbutton', { name: `SP ${stat} 숫자`, exact: true }).fill(sp[stat])
  for (const [stat, v] of Object.entries(sp)) await expect(mySet(page).getByRole('spinbutton', { name: `SP ${stat} 숫자`, exact: true })).toHaveValue(v)
  await waitComplete(page)
}

/**
 * 그 줄에 기본 조건 도각참 항목을 보이게 하고 카드 줄 판정을 읽는다: [결과 배지, 변동 목록 "결과 최소SP"…].
 * 변동 목록은 내 SP·성격 조정으로 닿는 모든 결과(카드 상세 칸 띠 대신, R20·R22). 변동 없음 카드는 배지 하나뿐이다.
 */
async function kowtowJudgement(page: Page, row: Locator): Promise<string[]> {
  const pick = row.getByTestId('move-pick')
  await pick.click()
  const items = row.getByTestId('move-menu').locator('[role="menuitemradio"]')
  const keys = await items.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.itemKey))
  const at = keys.indexOf(JSON.stringify(['kowtowcleave', JSON.stringify(['base'])]))
  expect(at, '기본 조건 도각참 항목').toBeGreaterThanOrEqual(0)
  await items.nth(at).click()
  await expect(row).toHaveAttribute('data-move', 'kowtowcleave')
  await waitComplete(page)
  const badge = ((await row.getByTestId('ko-badge').textContent()) ?? '').trim()
  if ((await adjustButton(row).count()) === 0) return [badge]
  const menu = await openAdjust(row)
  await expect(menu.getByTestId('adjust-result').first()).toHaveAttribute('data-enabled', 'true', { timeout: 15_000 })
  const results = await menu
    .getByTestId('adjust-result')
    .evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.label} ${[...e.querySelectorAll('.adjust-sp')].map((s) => s.textContent).join(' ')}`))
  await page.keyboard.press('Escape')
  await expect(adjustMenu(row)).toHaveCount(0)
  return [badge, ...results]
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
    await expect(base.locator('.item-mark')).toHaveCount(0)
    // 메가 폼 기본 행: 메가스톤은 판정에 관여하지 않으므로 이름 옆 도구 아이콘·메가진화 문양이 없다(사용자 피드백 2026-11-17)
    const megaRows = cards(page).and(page.locator('[data-opponent="charizardmegay"]:not([data-berry])'))
    await expect(megaRows.first()).toBeVisible()
    await expect(megaRows.locator('.item-mark')).toHaveCount(0)
    await expect(tabPanel(page).locator('[data-item-glyph="mega"]')).toHaveCount(0)
    // 기본 행: 기합의띠를 고려하지 않아 생명의구슬 도각참이 어느 SP에서도 확정견딤인 것은 아니다(띠면 변동 없이 확정견딤 하나)
    const baseJudge = await kowtowJudgement(page, base)
    expect(baseJudge).not.toEqual(['확정견딤'])

    // 열매 행: 이름 오른쪽 열매 아이콘(포켓몬 이미지와 겹치지 않음), data-item-id, 접근 이름 "… 마코열매 지닌 경우"
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
    // 자리: 이름 칸 안, 이름 글자 오른쪽, 포켓몬 이미지와 겹치지 않고 크기는 이름 옆 아이콘(22px)
    await expect(berry.locator('.card-name [data-testid="berry-badge"]')).toHaveCount(1)
    const geo = await berry.locator('.card-who').evaluate((who) => {
      const name = who.querySelector('.card-name')!
      const mark = name.querySelector<HTMLElement>('[data-testid="berry-badge"]')!.getBoundingClientRect()
      const mon = who.querySelector('[data-testid="mon-icon"]')!.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(name)
      range.setEndBefore(name.querySelector('[data-testid="berry-badge"]')!)
      const text = range.getBoundingClientRect()
      return { markLeft: mark.left, textRight: text.right, monRight: mon.right, size: [Math.round(mark.width), Math.round(mark.height)] }
    })
    expect(geo.markLeft).toBeGreaterThanOrEqual(geo.textRight - 0.5)
    expect(geo.markLeft).toBeGreaterThan(geo.monRight)
    expect(geo.size).toEqual([22, 22])
    // 카드 줄 이름 칸 읽기: "대쓰여너 마코열매 지닌 경우"(상세 안내 대신 이름 옆 도구 표지, R20)
    await expect(berry.locator('.card-name')).toHaveText(/^대쓰여너\s*마코열매 지닌 경우$/)
    // 사용률 순: 원래 행 바로 뒤
    const keys = await cards(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.groupKey))
    expect(keys.indexOf(JSON.stringify(COLBUR))).toBe(keys.indexOf(JSON.stringify(BASCULEGION)) + 1)
    // 열매가 도각참을 반감해 판정(결과 배지·변동으로 닿는 결과와 최소 SP)이 기본 행과 다르다
    const berryJudge = await kowtowJudgement(page, berry)
    expect(berryJudge).not.toEqual(baseJudge)

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

test('통계 설정 줄: 1280에서 형식·기준 월·최소(%) 여섯 칸이 한 줄이다(반감열매·화력 도구 칸이 혼자 다음 줄로 내려가지 않는다)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openProduct(page)
  const stats = page.getByRole('group', { name: '통계 설정', exact: true })
  const controls = stats.locator('select, input')
  await expect(controls).toHaveCount(8)
  const bottoms = await controls.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)))
  expect(new Set(bottoms).size, JSON.stringify(bottoms)).toBe(1)
  for (const name of ['SP 배분', '랭크업 기술', '구애스카프', '날씨 특성', '반감열매', '화력 도구']) {
    const box = await stats.getByRole('spinbutton', { name: `${name} 최소(%)`, exact: true }).boundingBox()
    expect(box?.width ?? 0, name).toBeLessThan(110)
  }
})
