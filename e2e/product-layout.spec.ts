import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cards, combo, findOverlaps, mySet, openProduct, selectTab, waitComplete } from './helpers'

const listBox = (page: Page) => page.getByTestId('result-box')
const listScroll = (page: Page) => page.getByTestId('result-scroll')

// AC18: 폭 400px·1280px에서 본문 가로 스크롤 없음, 라벨·컨트롤 겹침 없음. 0~32 띠는 상세 오른쪽 열 폭에 맞춰 줄어들어 스크롤이 없다
// (사용자 피드백 2026-11-12: 칸 안 숫자·기호 없이 색만, 칸 사이 틈은 유지).
// '포켓몬 추가'는 뒤 화면 위에 겹쳐 뜨는 팝오버라 그 안의 컨트롤은 따로(팝오버 안끼리) 본다
const CONTROLS = 'main[data-app="product"] :is(label, h1, h2, legend, button, [role="tab"], select, input, [data-testid="meta-source"], [data-testid="sp-remaining"]):not([role="dialog"] *)'

for (const width of [400, 1280]) {
  test.describe(`제품 화면 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test(`${width}px: 본문 가로 스크롤 0, 라벨·컨트롤 겹침 0, 띠도 가로 스크롤 없음(색 칸·틈 유지)`, async ({ page }) => {
      await openProduct(page)
      await selectTab(page, '방어')
      await waitComplete(page)
      const card = cards(page).and(page.locator('[data-variable="true"]')).first()
      await card.locator('button[aria-expanded]').first().click()
      await expect(card.getByTestId('band-cell').first()).toBeVisible()
      // 방어 탭 상세의 내구 합계 띠(R10): 65칸이 판정 영역 안에 다 들어오고(스크롤 상자 없음), 칸 안 글자 없음, 칸 사이 틈 1px 이상.
      await expect(card.locator('.band-scroll')).toHaveCount(0)
      const bands = await card.locator('.band').evaluateAll((els) =>
        els.map((el) => {
          const panel = el.closest('[data-testid="bundle-panel"]')!.getBoundingClientRect()
          const cells = [...el.querySelectorAll('[data-testid="band-cell"]')].map((c) => c.getBoundingClientRect())
          const scrollers = []
          for (let p = el.parentElement; p && !p.matches('[data-testid="bundle-panel"]'); p = p.parentElement) if (p.scrollWidth > p.clientWidth + 1) scrollers.push(p.className)
          const gaps = cells.slice(1).map((c, i) => c.left - cells[i].right)
          return {
            count: cells.length,
            inside: cells.every((c) => c.left >= panel.left - 0.5 && c.right <= panel.right + 0.5),
            bandFits: el.scrollWidth <= el.clientWidth + 1,
            scrollers,
            text: el.textContent,
            minGap: Math.min(...gaps) >= 0.9,
            sameRow: cells.every((c) => Math.abs(c.top - cells[0].top) < 0.5),
            width: cells[0].width,
          }
        }),
      )
      expect(bands.length).toBeGreaterThan(0)
      for (const b of bands) {
        expect({ ...b, width: undefined }).toEqual({ count: 65, inside: true, bandFits: true, scrollers: [], text: '', minGap: true, sameRow: true, width: undefined })
        expect(b.width).toBeGreaterThan(2)
      }
      await page.getByRole('button', { name: '포켓몬 추가', exact: true }).click()

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      // 띠는 화면 안에 있다.
      const leaks = await page.evaluate(() => [...document.querySelectorAll('.band')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length)
      expect(leaks).toBe(0)
      expect(await findOverlaps(page, CONTROLS)).toEqual([])
      expect(await findOverlaps(page, '[role="dialog"] :is(label, h2, button, input)')).toEqual([])
      // 접힌 줄: 기술 선택 버튼과 결과(배지 + 변동 가능)가 겹치지 않고, 이름(폼 꼬리 포함)은 1280px에서 한 줄.
      const lineIssues = await page.evaluate((wide) => {
        const out: string[] = []
        const lines = [...document.querySelectorAll('[data-testid="card"] .card-line')]
        for (const line of lines) {
          const name = line.querySelector('.card-name')!
          const res = line.querySelector('.card-result')?.getBoundingClientRect()
          const pick = line.querySelector('[data-testid="move-pick"]')?.getBoundingClientRect()
          if (res && pick && res.top < pick.bottom && pick.top < res.bottom && pick.right > res.left + 0.5 && res.right > pick.left + 0.5) out.push(`${name.textContent} 기술↔결과`)
          const lh = parseFloat(getComputedStyle(name).lineHeight) || 24
          if (wide && name.getBoundingClientRect().height > lh * 1.5) out.push(`${name.textContent} 이름 두 줄`)
        }
        return { out, checked: lines.filter((l) => l.querySelector('[data-testid="move-pick"]')).length }
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
      // 카드 좌우는 스크롤 박스 안쪽에서 스크롤바 폭만큼 더 떨어진다(오버레이 스크롤바가 카드 오른쪽 끝을 덮지 않게, 사용자 피드백 2026-11-13)
      const gap = await listScroll(page).evaluate((el) => {
        const box = el.getBoundingClientRect()
        const card = el.querySelector('[data-testid="card"]')!.getBoundingClientRect()
        const inner = box.left + el.clientLeft + el.clientWidth
        return { left: card.left - box.left - el.clientLeft, right: inner - card.right }
      })
      expect(gap.left).toBeGreaterThanOrEqual(16)
      expect(gap.right).toBeGreaterThanOrEqual(16)
      // 줄 오른쪽 끝 펼침 화살표: 펼친 줄은 위로(data-open), 접힌 줄은 아래로, 카드 오른쪽 끝에 붙는다
      const chev = cards(page).first().getByTestId('card-chev')
      await expect(chev).toHaveAttribute('data-open', 'true')
      await expect(cards(page).nth(1).getByTestId('card-chev')).toHaveAttribute('data-open', 'false')
      const edge = await cards(page).first().evaluate((c) => c.getBoundingClientRect().right - c.querySelector('[data-testid="card-chev"]')!.getBoundingClientRect().right)
      expect(edge).toBeGreaterThan(0)
      expect(edge).toBeLessThan(24)
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
      const pick = combo(page, '포켓몬 찾기')
      await pick.fill('윈디(히스이')
      await page.getByRole('listbox', { name: '포켓몬 찾기 후보' }).getByRole('option', { name: '윈디(히스이의 모습)', exact: true }).click()
      await expect(page.getByRole('list', { name: '선택한 포켓몬' })).toContainText('윈디(히스이의 모습)')
      await waitComplete(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      expect(await findOverlaps(page, CONTROLS)).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`product-${width}-long-names.png`), fullPage: true })
    })
  })
}

test.describe('제품 화면 400px 방어 탭', () => {
  test.use({ viewport: { width: 400, height: 900 } })

  test('400px: 방어 탭 간단행 배분 드롭다운(직접 추가 폼 포함)이 화면 가로 안에 열리고 페이지 가로 스크롤이 없다', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    const row = cards(page).filter({ has: page.locator('button.bundle-btn') }).first()
    await row.locator('button.bundle-btn').click()
    const menu = row.getByRole('menu', { name: '노력치 배분', exact: true })
    await expect(menu).toBeVisible()
    const r = await menu.evaluate((el) => {
      const b = el.getBoundingClientRect()
      const form = el.querySelector('[data-testid="bundle-add"]')?.getBoundingClientRect()
      return { left: b.left, right: b.right, formRight: form?.right ?? NaN, viewport: window.innerWidth }
    })
    expect(r.left).toBeGreaterThanOrEqual(0)
    expect(r.right).toBeLessThanOrEqual(r.viewport)
    expect(r.formRight).toBeLessThanOrEqual(r.right + 0.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await expect(menu.getByRole('menuitemradio').first()).toBeInViewport()
  })
})

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
