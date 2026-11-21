import { expect, test, type Locator, type Page } from '@playwright/test'
import { addPanel, addPanelButton, cards, openProduct, pickAddTarget, selectTab, waitComplete } from './helpers'

// '포켓몬 추가'와 스피드 배지 상세는 트리거에 붙는 비모달 팝오버: 뒤 화면을 밀지 않고, 폭 약 360px,
// Esc·바깥 클릭으로 닫히면 포커스는 트리거로, 좁은 화면(400px)에서는 하단 시트.

const POPOVER_W = 360
const badges = (page: Page) => page.getByTestId('speed-badge')
const detailPopover = (page: Page) => page.getByRole('dialog').filter({ has: page.getByTestId('speed-detail') })
const box = async (l: Locator) => {
  const b = await l.boundingBox()
  if (b === null) throw new Error('보이지 않는 요소')
  return b
}
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/** 팝오버(자신 포함) 안에서 실제로 스크롤되는 영역 수 */
const scrollerCount = (pop: Locator) =>
  pop.evaluate((root) => [root, ...root.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).length)

/** 버튼이 화면 안이면서 팝오버의 보이는 상자 안에 있다 */
async function expectInPopover(page: Page, pop: Locator, button: Locator) {
  const vp = page.viewportSize()!
  const p = await box(pop)
  const b = await box(button)
  expect(b.y).toBeGreaterThanOrEqual(Math.max(0, p.y) - 1)
  expect(b.y + b.height).toBeLessThanOrEqual(Math.min(vp.height, p.y + p.height) + 1)
}

async function openSearchList(page: Page) {
  await openProduct(page)
  await waitComplete(page)
  await addPanelButton(page).scrollIntoViewIfNeeded()
  await addPanelButton(page).click()
  const panel = addPanel(page)
  await expect(panel).toBeVisible()
  // 빈 검색어로 후보 목록을 연다(후보가 많은 상태)
  await expect(panel.getByRole('listbox')).toBeVisible()
  expect(await panel.getByRole('option').count()).toBeGreaterThanOrEqual(8)
  return panel
}

test.describe('팝오버 안 스크롤 영역은 하나', () => {
  test.describe('1280x800', () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test('포켓몬 추가: 후보 목록이 열려도 스크롤 영역 하나, 취소·추가 버튼은 스크롤 없이 보인다', async ({ page }) => {
      const panel = await openSearchList(page)
      await expect.poll(() => scrollerCount(panel)).toBeLessThanOrEqual(1)
      await expectInPopover(page, panel, panel.getByRole('button', { name: '취소', exact: true }))
      await expectInPopover(page, panel, panel.getByRole('button', { name: '추가', exact: true }))

      // 메타 목록 포켓몬(관측 배분 목록)과 새 포켓몬(기술 칩)도 같다
      await pickAddTarget(page, '한카리아스', '메타 목록')
      await expect.poll(() => scrollerCount(panel)).toBeLessThanOrEqual(1)
      await expectInPopover(page, panel, panel.getByRole('button', { name: '추가', exact: true }))
      await panel.getByTestId('add-reset').click()
      await pickAddTarget(page, '워시로토무', null)
      await expect.poll(() => scrollerCount(panel)).toBeLessThanOrEqual(1)
      await expectInPopover(page, panel, panel.getByRole('button', { name: '취소', exact: true }))
      await expectInPopover(page, panel, panel.getByRole('button', { name: '추가', exact: true }))
    })

    test('스피드 배지 상세: 다른 배분 추가를 펼쳐도 스크롤 영역 하나', async ({ page }) => {
      await openSpeed(page)
      const { badge } = await badgeWithRowBelow(page)
      await badge.click()
      const pop = detailPopover(page)
      await expect(pop).toBeVisible()
      await pop.getByTestId('speed-add-toggle').click()
      await expect(pop.getByTestId('speed-add-option').first()).toBeVisible()
      await expect.poll(() => scrollerCount(pop)).toBeLessThanOrEqual(1)
    })
  })

  test.describe('1280x560(낮은 화면)', () => {
    test.use({ viewport: { width: 1280, height: 560 } })

    test('포켓몬 추가: 목록을 줄여도 안 들어가면 팝오버 하나만 스크롤', async ({ page }) => {
      const panel = await openSearchList(page)
      await expect.poll(() => scrollerCount(panel)).toBeLessThanOrEqual(1)
    })
  })

  test.describe('400px 하단 시트', () => {
    test.use({ viewport: { width: 400, height: 800 } })

    test('포켓몬 추가·스피드 배지 상세 모두 스크롤 영역 하나', async ({ page }) => {
      const panel = await openSearchList(page)
      await expect.poll(() => scrollerCount(panel)).toBeLessThanOrEqual(1)
      await expectInPopover(page, panel, panel.getByRole('button', { name: '추가', exact: true }))
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)

      await selectTab(page, '스피드')
      const { badge } = await badgeWithRowBelow(page)
      await badge.scrollIntoViewIfNeeded()
      await badge.click()
      const pop = detailPopover(page)
      await expect(pop).toBeVisible()
      await pop.getByTestId('speed-add-toggle').click()
      await expect.poll(() => scrollerCount(pop)).toBeLessThanOrEqual(1)
    })
  })
})

async function openSpeed(page: Page) {
  await openProduct(page)
  await waitComplete(page)
  await selectTab(page, '스피드')
  await expect(badges(page).first()).toBeVisible()
}

/** 프레임 위쪽 줄의 배지(아래에 다른 줄이 있는 것)와 그 바로 아래 줄 */
async function badgeWithRowBelow(page: Page) {
  const rows = page.locator('.speed-row')
  await expect(rows.nth(2)).toBeVisible()
  const badge = rows.nth(1).getByTestId('speed-badge').first()
  return { badge, below: rows.nth(2) }
}

test.describe('팝오버 1280px', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('포켓몬 추가: 아래 카드 위치 그대로·폭 약 360px·비모달, 후보 클릭은 바깥이 아님, 버튼 다시 누르면 닫힘, Esc·바깥 클릭이면 버튼으로 포커스', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const button = addPanelButton(page)
    const firstCard = cards(page).first()
    const secondCard = cards(page).nth(1)
    const before = [await box(firstCard), await box(secondCard)]

    await button.click()
    const panel = addPanel(page)
    await expect(panel).toBeVisible()
    expect([await box(firstCard), await box(secondCard)]).toEqual(before)
    expect(Math.abs((await box(panel)).width - POPOVER_W)).toBeLessThanOrEqual(24)
    await expect(panel).toHaveCSS('position', 'fixed')
    // 열면 팝오버 안(검색창)으로 포커스
    await expect(panel.getByRole('combobox', { name: '추가할 포켓몬', exact: true })).toBeFocused()

    // 검색 후보(팝오버 안 목록)를 눌러도 닫히지 않는다
    await pickAddTarget(page, '한카리아스', '메타 목록')
    await expect(panel).toBeVisible()
    expect([await box(firstCard), await box(secondCard)]).toEqual(before)

    // 버튼을 다시 누르면 닫힌다(닫고 다시 열리지 않음)
    await button.click()
    await expect(panel).toHaveCount(0)
    await expect(button).toHaveAttribute('aria-expanded', 'false')

    // Esc → 닫히고 버튼으로
    await button.click()
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape') // 열린 후보 목록 먼저
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(button).toBeFocused()

    // 바깥 빈 곳 클릭 → 닫히고 버튼으로
    await button.click()
    await expect(panel).toBeVisible()
    await page.locator('.my-set h2').click()
    await expect(panel).toHaveCount(0)
    await expect(button).toBeFocused()
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('스피드 배지 상세: 아래 줄 위치 그대로·폭 약 360px·배지에 붙음, Esc·바깥 클릭이면 배지로 포커스, 프레임 스크롤을 따라가고 배지가 가려지면 닫힘', async ({ page }) => {
    await openSpeed(page)
    const { badge, below } = await badgeWithRowBelow(page)
    const id = (await badge.getAttribute('data-badge-id'))!
    const beforeBelow = await box(below)
    const beforeBadge = await box(badge)

    await badge.click()
    const pop = detailPopover(page)
    await expect(pop).toBeVisible()
    await expect(page.getByTestId('speed-detail')).toHaveAttribute('data-badge-id', id)
    await expect(badge).toHaveAttribute('aria-controls', (await pop.getAttribute('id'))!)
    expect(await box(below)).toEqual(beforeBelow)
    expect(await box(badge)).toEqual(beforeBadge)
    const p = await box(pop)
    expect(Math.abs(p.width - POPOVER_W)).toBeLessThanOrEqual(24)
    // 배지 바로 아래에 붙는다
    expect(p.y).toBeGreaterThanOrEqual(beforeBadge.y + beforeBadge.height - 1)
    expect(p.y - (beforeBadge.y + beforeBadge.height)).toBeLessThan(16)

    // Esc → 닫히고 배지로
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(badge).toBeFocused()

    // 상세 안에서 Esc → 배지로
    await badge.click()
    await expect(pop).toBeVisible()
    await pop.getByTestId('speed-add-toggle').focus()
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(badge).toBeFocused()

    // 바깥 빈 곳 클릭 → 닫히고 배지로
    await badge.click()
    await expect(pop).toBeVisible()
    await page.locator('.my-set h2').click()
    await expect(pop).toHaveCount(0)
    await expect(badge).toBeFocused()

    // 프레임을 조금 스크롤하면 팝오버가 배지를 따라간다
    await badge.click()
    await expect(pop).toBeVisible()
    const frame = page.getByTestId('speed-frame')
    const top0 = (await box(pop)).y
    const badge0 = (await box(badge)).y
    await frame.evaluate((f) => f.scrollBy(0, 20))
    await expect.poll(async () => (await box(badge)).y).toBeLessThan(badge0)
    const moved = badge0 - (await box(badge)).y
    await expect.poll(async () => Math.round(top0 - (await box(pop)).y)).toBe(Math.round(moved))
    // 배지가 프레임 밖으로 완전히 나가면 닫힌다
    await frame.evaluate((f) => f.scrollTo(0, f.scrollHeight))
    await expect(pop).toHaveCount(0)
    await expect(badge).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('팝오버 400px(하단 시트)', () => {
  test.use({ viewport: { width: 400, height: 800 } })

  const expectSheet = async (page: Page, pop: Locator) => {
    const b = await box(pop)
    expect(Math.abs(b.y + b.height - 800)).toBeLessThanOrEqual(1)
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(400)
    expect(b.width).toBeGreaterThan(400 - 40)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
  }

  test('포켓몬 추가는 하단 시트, 가로 스크롤 없음, 아래 카드 위치 그대로', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addPanelButton(page).scrollIntoViewIfNeeded()
    const firstCard = cards(page).first()
    const before = await box(firstCard)
    await addPanelButton(page).click()
    const panel = addPanel(page)
    await expect(panel).toBeVisible()
    await expectSheet(page, panel)
    expect(await box(firstCard)).toEqual(before)
    await pickAddTarget(page, '한카리아스', '메타 목록')
    await expectSheet(page, panel)
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(addPanelButton(page)).toBeFocused()
  })

  test('스피드 배지 상세는 하단 시트, 가로 스크롤 없음, 아래 줄 위치 그대로', async ({ page }) => {
    await openSpeed(page)
    const { badge, below } = await badgeWithRowBelow(page)
    await badge.scrollIntoViewIfNeeded()
    const before = await box(below)
    await badge.click()
    const pop = detailPopover(page)
    await expect(pop).toBeVisible()
    await expectSheet(page, pop)
    expect(await box(below)).toEqual(before)
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(badge).toBeFocused()
  })
})
