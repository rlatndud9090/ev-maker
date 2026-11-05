import { expect, test } from '@playwright/test'
import { combo, openPage, region } from './helpers'

test('@layout 가로 넘침 없음, 입력 컨트롤이 서로 겹치지 않음', async ({ page }) => {
  await openPage(page)
  await region(page, 'SP 스윕').locator('tbody tr').first().waitFor()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  const overlaps = await page.evaluate(() => {
    const out: string[] = []
    const boxes = [...document.querySelectorAll('section label, section h2, section legend')].map((el) => ({
      el,
      r: el.getBoundingClientRect(),
    }))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
        if (x > 1 && y > 1) out.push(`${a.el.textContent?.slice(0, 20)} ↔ ${b.el.textContent?.slice(0, 20)}`)
      }
    }
    return out
  })
  expect(overlaps).toEqual([])

  // 넓은 표는 자기 스크롤 영역 안에서만 넘친다.
  for (const sel of ['table.sweep']) {
    const t = page.locator(sel)
    const wrapper = t.locator('xpath=..')
    await expect(wrapper).toHaveClass(/scroll/)
  }
})

test('@layout 키보드만으로 종 입력에 도달하고 값을 바꿀 수 있다', async ({ page }) => {
  await openPage(page)
  const species = combo(region(page, '공격측'), '종')
  await page.keyboard.press('Tab')
  for (let i = 0; i < 5 && !(await species.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(species).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('맘모꾸리')
  await expect(species).toHaveValue('맘모꾸리')
  // 기습은 맘모꾸리 기술이 아니라 코어가 거부한다(키보드 입력이 세트에 반영됐다는 증거).
  await expect(region(page, '공격측').getByRole('alert')).toContainText('ILLEGAL_MOVE')
})
