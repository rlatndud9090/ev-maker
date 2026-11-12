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
      const card = cards(page).and(page.locator('[data-variable="true"]')).first()
      await card.locator('button[aria-expanded]').first().click()
      await expect(card.getByTestId('band-cell').first()).toBeVisible()
      // 상세 오른쪽 열의 띠가 상자보다 넓으면: 처음 열 때 현재 칸이 보이고, 더 있는 쪽 가장자리 표시(data-more-*)가 붙는다.
      const bands = await card.locator('.band-scroll').evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect()
          const cur = el.querySelector('[aria-current="true"]')!.getBoundingClientRect()
          const wider = el.scrollWidth > el.clientWidth
          return { wider, curVisible: cur.left >= box.left - 0.5 && cur.right <= box.right + 0.5, marked: el.hasAttribute('data-more-left') || el.hasAttribute('data-more-right') }
        }),
      )
      expect(bands.length).toBeGreaterThan(0)
      for (const b of bands) expect(b).toEqual({ wider: b.wider, curVisible: true, marked: b.wider })
      await page.getByRole('button', { name: '표시 기준', exact: true }).click()
      await page.getByRole('button', { name: '포켓몬 추가', exact: true }).click()

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
      // 접힌 줄: 결과(배지 + 변동 가능)가 "외 n행"과 겹치지 않고, 이름(폼 꼬리 포함)은 1280px에서 한 줄.
      const lineIssues = await page.evaluate((wide) => {
        const out: string[] = []
        const lines = [...document.querySelectorAll('[data-testid="card"] .card-line')]
        for (const line of lines) {
          const name = line.querySelector('.card-name')!
          const res = line.querySelector('.card-result')?.getBoundingClientRect()
          const more = line.querySelector('.card-more')?.getBoundingClientRect()
          if (res && more && res.top < more.bottom && more.top < res.bottom && res.right > more.left + 0.5) out.push(`${name.textContent} 결과↔외 n행 ${res.right - more.left}`)
          const lh = parseFloat(getComputedStyle(name).lineHeight) || 24
          if (wide && name.getBoundingClientRect().height > lh * 1.5) out.push(`${name.textContent} 이름 두 줄`)
        }
        return { out, checked: lines.filter((l) => l.querySelector('.card-more')).length }
      }, width >= 1280)
      expect(lineIssues.checked).toBeGreaterThan(0)
      expect(lineIssues.out).toEqual([])
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

    test(`${width}px: 배분 메뉴·상세 배분 목록이 화면 안에 들어오고, 좁으면 목록이 판정 행 위로 쌓여 자체 세로 스크롤`, async ({ page }) => {
      await openProduct(page)
      await selectTab(page, '방어')
      await waitComplete(page)
      const row = cards(page).filter({ has: page.locator('button.bundle-btn') }).first()
      await row.locator('button[aria-expanded]').first().click()
      const list = row.getByTestId('bundle-list')
      await expect(list).toBeVisible()
      const m = await row.evaluate((el) => {
        const side = el.querySelector('[data-testid="bundle-list"]') as HTMLElement
        const panel = el.querySelector('[data-testid="bundle-panel"]')!.getBoundingClientRect()
        const r = side.getBoundingClientRect()
        const form = side.querySelector('[data-testid="bundle-add"]')!
        const mids = [...form.querySelectorAll('label, input, button')].map((e) => {
          const b = e.getBoundingClientRect()
          return b.top + b.height / 2
        })
        return {
          overflowY: getComputedStyle(side).overflowY,
          maxHeight: parseFloat(getComputedStyle(side).maxHeight),
          rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          panelTop: panel.top,
          panelLeft: panel.left,
          formSpread: Math.max(...mids) - Math.min(...mids),
          viewport: window.innerWidth,
        }
      })
      expect(m.overflowY).toBe('auto')
      expect(m.left).toBeGreaterThanOrEqual(0)
      expect(m.right).toBeLessThanOrEqual(m.viewport)
      expect(m.formSpread).toBeLessThanOrEqual(2)
      if (width < 700) {
        // 좁은 화면: 목록이 위(낮은 상자 13rem = 추가 폼 + 항목 5개), 판정 행이 아래
        expect(m.panelTop).toBeGreaterThanOrEqual(m.bottom - 1)
        expect(m.maxHeight).toBeLessThanOrEqual(13 * m.rem + 0.5)
        // 추가 폼 + 항목 5개(두 줄 항목 없음)는 스크롤 없이 다 들어간다(항목 수를 5로 맞춰 확인).
        const five = await list.evaluate((el) => {
          // 항목 열(radiogroup)과 핀 열은 같은 줄 수(--bundle-rows)를 공유하므로 둘 다 5개로 맞추고 줄 수도 5로 둔다.
          const rows = el.querySelector<HTMLElement>('.bundle-rows')!
          const group = rows.querySelector('[role="radiogroup"]')!
          const pinCol = rows.querySelector('.bundle-pins')!
          const fit = (col: Element, sel: string) => {
            const items = [...col.querySelectorAll(sel)]
            const added = items.length < 5 ? Array.from({ length: 5 - items.length }, () => col.appendChild(items[0].cloneNode(true)) as HTMLElement) : []
            const hidden = items.slice(5).map((r) => ((r as HTMLElement).hidden = true, r as HTMLElement))
            return () => (added.forEach((a) => a.remove()), hidden.forEach((h) => (h.hidden = false)))
          }
          const prevRows = rows.style.getPropertyValue('--bundle-rows')
          rows.style.setProperty('--bundle-rows', '5')
          const undo = [fit(group, '[role="radio"]'), fit(pinCol, '.bundle-pin')]
          const r = { count: group.querySelectorAll('[role="radio"]:not([hidden])').length, overflow: el.scrollHeight - el.clientHeight }
          undo.forEach((u) => u())
          rows.style.setProperty('--bundle-rows', prevRows)
          return r
        })
        expect(five.count).toBe(5)
        expect(five.overflow).toBeLessThanOrEqual(0)
      } else {
        expect(m.panelLeft).toBeGreaterThan(m.right)
      }
      // 항목이 많으면 목록 상자 안에서만 세로로 스크롤된다(목록 높이를 줄여 강제).
      const forced = await list.evaluate((el) => {
        el.style.maxHeight = '4rem'
        const r = { scrolls: el.scrollHeight > el.clientHeight, top: ((el.scrollTop = 30), el.scrollTop) }
        el.scrollTop = 0
        el.style.maxHeight = ''
        return r
      })
      expect(forced.scrolls).toBe(true)
      expect(forced.top).toBeGreaterThan(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

      // 배분 메뉴는 화면 가로 안에 열리고 페이지 가로 스크롤을 만들지 않는다.
      await row.locator('button.bundle-btn').click()
      const menu = row.getByRole('menu', { name: '노력치 배분', exact: true })
      await expect(menu).toBeVisible()
      const r = await menu.evaluate((el) => {
        const b = el.getBoundingClientRect()
        return { left: b.left, right: b.right, viewport: window.innerWidth }
      })
      expect(r.left).toBeGreaterThanOrEqual(0)
      expect(r.right).toBeLessThanOrEqual(r.viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await expect(menu.getByRole('menuitemradio').first()).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`product-${width}-bundle-menu.png`) })
      await page.keyboard.press('Escape')

      // 목록 맨 아래 행의 메뉴도 목록 스크롤 박스 안에 다 보인다(아래가 모자라면 위로 열린다).
      const last = cards(page).filter({ has: page.locator('button.bundle-btn') }).last()
      await last.locator('button.bundle-btn').scrollIntoViewIfNeeded()
      await last.locator('button.bundle-btn').click()
      const lastMenu = last.getByRole('menu', { name: '노력치 배분', exact: true })
      await expect(lastMenu).toBeVisible()
      const fit = await lastMenu.evaluate((el) => {
        const b = el.getBoundingClientRect()
        const box = el.closest('.result-scroll')!.getBoundingClientRect()
        return { top: b.top, bottom: b.bottom, boxTop: box.top, boxBottom: Math.min(box.bottom, window.innerHeight) }
      })
      expect(fit.bottom).toBeLessThanOrEqual(fit.boxBottom + 1)
      expect(fit.top).toBeGreaterThanOrEqual(fit.boxTop - 1)
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
