import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cards, combo, findOverlaps, mySet, openProduct, selectTab, waitComplete } from './helpers'

const listBox = (page: Page) => page.getByTestId('result-box')
const listScroll = (page: Page) => page.getByTestId('result-scroll')

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

      // 목록 박스 안을 스크롤해도 겹침·가로 스크롤이 생기지 않는다.
      await listScroll(page).evaluate((el) => (el.scrollTop = 400))
      await listBox(page).evaluate((el) => el.scrollIntoView({ block: 'end' }))
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      expect(await findOverlaps(page, CONTROLS)).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`product-${width}-scrolled.png`) })

      // 목록 박스 밖(탭 줄·툴바 포함, 화면 맨 위 ~ 박스 위 변)에는 결과 카드가 보이지 않는다(목록 위로 비침 없음).
      const leak = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="tab-panel"]')!
        const box = document.querySelector('[data-testid="result-box"]')!.getBoundingClientRect()
        const tabs = document.querySelector('[role="tablist"]')!.getBoundingClientRect()
        if (tabs.bottom > box.top + 1) return `탭 줄(${tabs.bottom})이 목록 박스(${box.top}) 위에 있지 않다`
        for (let y = 0; y < box.top; y++) {
          for (let x = 0; x < window.innerWidth; x += 8) {
            const el = document.elementFromPoint(x, y)
            if (el && panel.contains(el)) return `박스 밖 (${x}, ${y})에 ${el.tagName}.${el.className}`
          }
        }
        // 박스 아래(화면 끝까지)도 마찬가지.
        for (let y = Math.ceil(box.bottom) + 1; y < window.innerHeight; y++) {
          for (let x = 0; x < window.innerWidth; x += 8) {
            const el = document.elementFromPoint(x, y)
            if (el && panel.contains(el)) return `박스 아래 (${x}, ${y})에 ${el.tagName}.${el.className}`
          }
        }
        // 좁은 화면은 페이지 스크롤 중 탭 줄이 sticky로 붙는다: 화면 위에 붙고 배경이 불투명해야 한다.
        let sticky = document.querySelector('[role="tablist"]') as Element | null
        while (sticky && getComputedStyle(sticky).position !== 'sticky') sticky = sticky.parentElement
        if (sticky) {
          const r = sticky.getBoundingClientRect()
          if (window.scrollY > 0 && (r.top < 0 || r.top > 1)) return `sticky가 화면 위에 붙지 않았다: top ${r.top}`
          const bg = getComputedStyle(sticky).backgroundColor
          if (bg.startsWith('rgba(')) return `배경이 반투명: ${bg}`
        }
        return null
      })
      expect(leak).toBeNull()
    })

    test(`${width}px: 상대 목록은 뷰포트 높이에 맞춘 자체 스크롤 박스`, async ({ page }) => {
      await openProduct(page)
      await selectTab(page, '방어')
      await waitComplete(page)
      await cards(page).first().locator('button[aria-expanded]').first().click()
      const m = await listScroll(page).evaluate((el) => ({
        overflowY: getComputedStyle(el).overflowY,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        boxHeight: el.parentElement!.getBoundingClientRect().height,
        mainBottom: document.querySelector('main[data-app="product"]')!.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
      }))
      expect(m.overflowY).toBe('auto')
      expect(m.scrollHeight).toBeGreaterThan(m.clientHeight)
      // 넓은 화면: 작업 영역(main)이 첫 화면에 꼭 맞는다(페이지 스크롤은 푸터에 닿을 때만).
      if (width >= 1280) expect(m.mainBottom).toBeLessThanOrEqual(m.viewport)
      else expect(m.boxHeight).toBeGreaterThanOrEqual(m.viewport * 0.6)
      // 라이선스 고지는 목록 박스 밖, 작업 영역 아래의 페이지 푸터다.
      await expect(listScroll(page).locator('footer')).toHaveCount(0)
      const footer = page.locator('body footer.product-footer')
      await expect(footer.getByTestId('licenses')).toHaveCount(1)
      const order = await page.evaluate(() => {
        const main = document.querySelector('main[data-app="product"]')!
        const f = document.querySelector('footer.product-footer')!
        return {
          outside: !main.contains(f),
          below: f.getBoundingClientRect().top >= main.getBoundingClientRect().bottom,
        }
      })
      expect(order).toEqual({ outside: true, below: true })
      await footer.locator('tbody tr').last().scrollIntoViewIfNeeded()
      await expect(footer.locator('tbody tr').last()).toBeInViewport()
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

test('넓은 모니터(1920px): 작업 영역·푸터 폭을 76rem 이하로 제한하고 가운데 정렬', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await openProduct(page)
  const m = await page.evaluate(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
    const main = box('main[data-app="product"]')
    const footer = box('footer.product-footer')
    return {
      max: 76 * rem,
      main: main.width,
      footer: footer.width,
      leftGap: main.left,
      rightGap: window.innerWidth - main.right,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
  expect(m.main).toBeLessThanOrEqual(m.max)
  expect(m.footer).toBeLessThanOrEqual(m.max)
  expect(Math.abs(m.leftGap - m.rightGap)).toBeLessThanOrEqual(1)
  expect(m.overflow).toBeLessThanOrEqual(0)
})
