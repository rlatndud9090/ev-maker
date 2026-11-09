import { expect, test } from '@playwright/test'
import { cards, combo, findOverlaps, mySet, openProduct, selectTab, tabPanel, waitComplete } from './helpers'

// AC18: 폭 400px·1280px에서 본문 가로 스크롤 없음(0~32 띠 .band-scroll만 자체 스크롤), 라벨·컨트롤 겹침 없음.
const CONTROLS = 'main[data-app="product"] :is(label, h1, h2, legend, button, [role="tab"], select, input, [data-testid="meta-source"], [data-testid="sp-remaining"])'

for (const width of [400, 1280]) {
  test.describe(`제품 화면 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test(`${width}px: 본문 가로 스크롤 0, 라벨·컨트롤 겹침 0, 띠만 자체 가로 스크롤`, async ({ page }) => {
      await openProduct(page)
      await selectTab(page, '방어')
      await waitComplete(page)
      const card = cards(page).first()
      await card.locator('button[aria-expanded]').first().click()
      await expect(card.getByTestId('band-cell').first()).toBeVisible()
      await page.getByRole('button', { name: '표시 기준', exact: true }).click()
      await page.getByRole('button', { name: '목록 밖 포켓몬 추가', exact: true }).click()

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      // 띠 칸의 넘침은 .band-scroll 안에 갇힌다.
      const leaks = await page.evaluate(() =>
        [...document.querySelectorAll('.band-scroll')].filter((el) => {
          const r = el.getBoundingClientRect()
          return r.right > window.innerWidth + 1 || getComputedStyle(el).overflowX === 'visible'
        }).length,
      )
      expect(leaks).toBe(0)
      expect(await findOverlaps(page, CONTROLS)).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`product-${width}.png`), fullPage: true })

      // 결과 영역을 스크롤해도 겹침이 생기지 않는다(sticky 툴바는 패널 위에 고정).
      await tabPanel(page).evaluate((el) => el.scrollIntoView({ block: 'center' }))
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await page.screenshot({ path: test.info().outputPath(`product-${width}-scrolled.png`) })

      // sticky 탭 줄 위쪽(화면 맨 위 ~ 탭 줄 아래 변)에는 결과 카드가 보이지 않는다(틈으로 비침 없음).
      const leak = await page.evaluate(() => {
        // 탭 패널 머리를 화면 맨 위로 올려 sticky 줄이 카드 위에 고정된 상태를 만든다.
        const panel = document.querySelector('[data-testid="tab-panel"]')!
        window.scrollBy(0, panel.getBoundingClientRect().top + 120)
        let sticky = document.querySelector('[role="tablist"]')
        while (sticky && getComputedStyle(sticky).position !== 'sticky') sticky = sticky.parentElement
        if (!sticky) return '탭 목록을 감싼 sticky 요소 없음'
        const r = sticky.getBoundingClientRect()
        if (r.top < 0 || r.top > 1) return `sticky가 화면 위에 붙지 않았다: top ${r.top}`
        for (let y = 0; y < r.bottom; y++) {
          for (let x = 0; x < window.innerWidth; x += 8) {
            const el = document.elementFromPoint(x, y)
            if (el && panel.contains(el)) return `(${x}, ${y})에 ${el.tagName}.${el.className}`
          }
        }
        const bg = getComputedStyle(sticky).backgroundColor
        if (bg.startsWith('rgba(')) return `배경이 반투명: ${bg}`
        return null
      })
      expect(leak).toBeNull()
    })

    test(`${width}px: 긴 한국어 이름(폼 이름)을 내 종·선택 칩에 넣어도 겹침·가로 스크롤 없음`, async ({ page }) => {
      await openProduct(page)
      const species = combo(mySet(page), '종')
      await species.fill('야도란(가라르의 모습)')
      await species.press('Enter')
      await expect(species).toHaveValue('야도란(가라르의 모습)')
      const pick = combo(page, '포켓몬 선택')
      await pick.fill('윈디(히스이')
      await page.getByRole('listbox', { name: '포켓몬 선택 후보' }).getByRole('option', { name: '윈디(히스이의 모습)', exact: true }).click()
      await expect(page.getByRole('list', { name: '선택한 포켓몬' })).toContainText('윈디(히스이의 모습)')
      await waitComplete(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      expect(await findOverlaps(page, CONTROLS)).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`product-${width}-long-names.png`), fullPage: true })
    })
  })
}
