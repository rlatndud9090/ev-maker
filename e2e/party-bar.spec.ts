import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { mySet, openProduct, resultTab, tabPanel } from './helpers'

const SAMPLE = readFileSync(new URL('../src/party/__fixtures__/glick-mb.txt', import.meta.url), 'utf8')
const PASTE = 'https://pokepast.es/27afa251f1c9a8b7'
const RAW = '**/pokepast.es/27afa251f1c9a8b7/raw'

const slots = (page: Page) => page.getByTestId('party-slot')
const slotButton = (page: Page, n: number) => slots(page).nth(n - 1).locator('.party-slot-btn')
const urlInput = (page: Page) => page.getByTestId('paste-url')
const importButton = (page: Page) => page.getByTestId('paste-import')

async function importSample(page: Page) {
  await page.route(RAW, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: SAMPLE, headers: { 'access-control-allow-origin': '*' } }))
  await urlInput(page).fill(PASTE)
  await importButton(page).click()
  await page.getByTestId('party-confirm-ok').click()
  await expect(slotButton(page, 6)).not.toHaveAccessibleName('6번 칸: 비어 있음')
}

test.describe('헤더 파티 줄', () => {
  test('제목·레귤레이션 안내 대신 6칸과 가져오기 입력, 기본 1번 칸 활성', async ({ page }) => {
    await openProduct(page)
    await expect(page.locator('h1')).toHaveCount(0)
    await expect(page.getByText('SP 구간 판정')).toHaveCount(0)
    await expect(slots(page)).toHaveCount(6)
    await expect(slotButton(page, 1)).toHaveAttribute('aria-current', 'true')
    await expect(slotButton(page, 1)).toHaveAccessibleName(/^1번 칸: \S+/)
    for (let n = 2; n <= 6; n++) await expect(slotButton(page, n)).toHaveAccessibleName(`${n}번 칸: 비어 있음`)
    await expect(urlInput(page)).toBeVisible()
    await expect(importButton(page)).toHaveText('가져오기')
  })

  test('빈 칸을 고르면 설정·탭에 안내, 종을 고르면 계산이 나온다', async ({ page }) => {
    await openProduct(page)
    await slotButton(page, 2).click()
    await expect(slotButton(page, 2)).toHaveAttribute('aria-current', 'true')
    await expect(page.getByTestId('empty-slot-panel')).toContainText('포켓몬을 골라 주세요')
    await expect(mySet(page).getByTestId('empty-slot-hint')).toBeVisible()
    await resultTab(page, '스피드').click()
    await expect(page.getByTestId('empty-slot-panel')).toHaveAttribute('data-tab', 'speed')
    const species = mySet(page).getByRole('combobox', { name: '종', exact: true })
    await species.fill('한카리아스')
    await species.press('Enter')
    await expect(tabPanel(page)).toBeVisible({ timeout: 15_000 })
    await expect(slotButton(page, 2)).toHaveAccessibleName(/^2번 칸: 한카리아스/)
    // 1번 칸으로 돌아가면 원래 포켓몬
    await slotButton(page, 1).press('Enter')
    await expect(slotButton(page, 1)).toHaveAttribute('aria-current', 'true')
  })

  test('형식 오류·없는 paste·네트워크 실패는 오류 안내, 파티 그대로', async ({ page }) => {
    await openProduct(page)
    const before = await slotButton(page, 1).getAttribute('aria-label')
    await urlInput(page).fill('https://example.com/abc')
    await importButton(page).click()
    await expect(page.getByTestId('paste-error')).toHaveAttribute('data-reason', 'format')

    await page.route('**/pokepast.es/00000000deadbeef/raw', (route) => route.fulfill({ status: 404, body: 'nope' }))
    await urlInput(page).fill('pokepast.es/00000000deadbeef')
    await importButton(page).click()
    await page.getByTestId('party-confirm-ok').click()
    await expect(page.getByTestId('paste-error')).toHaveAttribute('data-reason', 'not-found')

    await page.route('**/pokepast.es/000000000000cafe/raw', (route) => route.abort())
    await urlInput(page).fill('https://pokepast.es/000000000000cafe/')
    await importButton(page).click()
    await page.getByTestId('party-confirm-ok').click()
    await expect(page.getByTestId('paste-error')).toHaveAttribute('data-reason', 'network')
    await expect(slotButton(page, 1)).toHaveAttribute('aria-label', before!)
    await expect(slotButton(page, 2)).toHaveAccessibleName('2번 칸: 비어 있음')
  })

  test('가져오기: 확인 취소는 그대로, 확인하면 6칸 교체·1번 칸 활성', async ({ page }) => {
    await openProduct(page)
    await page.route(RAW, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: SAMPLE }))
    await urlInput(page).fill(PASTE)
    await importButton(page).click()
    const dialog = page.getByRole('dialog', { name: /현재 파티를 바꿉니다/ })
    await expect(dialog).toBeVisible()
    await page.getByTestId('party-confirm-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(slotButton(page, 2)).toHaveAccessibleName('2번 칸: 비어 있음')

    await importButton(page).click()
    await page.getByTestId('party-confirm-ok').click()
    await expect(slotButton(page, 1)).toHaveAccessibleName(/^1번 칸: 메가라이츄Y @ 라이츄나이트Y$/)
    for (let n = 2; n <= 6; n++) await expect(slotButton(page, n)).not.toHaveAccessibleName(`${n}번 칸: 비어 있음`)
    await expect(slotButton(page, 1)).toHaveAttribute('aria-current', 'true')
    await expect(slots(page).nth(0).getByTestId('item-mark')).toHaveCount(1)
  })

  test('칸 비우기·Alt+→ 이동·끌어 놓기·파티 비우기', async ({ page }) => {
    await openProduct(page)
    await importSample(page)
    const name2 = (await slotButton(page, 2).getAttribute('aria-label'))!.replace(/^2번 칸: /, '')
    const name3 = (await slotButton(page, 3).getAttribute('aria-label'))!.replace(/^3번 칸: /, '')

    // 키보드: 2번 칸을 오른쪽으로
    await slotButton(page, 2).focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect(slotButton(page, 3)).toHaveAccessibleName(`3번 칸: ${name2}`)
    await expect(slotButton(page, 2)).toHaveAccessibleName(`2번 칸: ${name3}`)
    await expect(slotButton(page, 3)).toBeFocused()

    // 끌어 놓기: 3번 칸을 2번 자리로 되돌린다
    await slots(page).nth(2).locator('.party-slot-frame').dragTo(slots(page).nth(1).locator('.party-slot-frame'))
    await expect(slotButton(page, 2)).toHaveAccessibleName(`2번 칸: ${name2}`)

    // 칸 비우기
    await slotButton(page, 4).hover()
    await slots(page).nth(3).getByTestId('party-slot-clear').click()
    await expect(slotButton(page, 4)).toHaveAccessibleName('4번 칸: 비어 있음')

    // 파티 비우기(확인)
    await page.getByTestId('party-clear-all').click()
    await page.getByTestId('party-confirm-ok').click()
    for (let n = 1; n <= 6; n++) await expect(slotButton(page, n)).toHaveAccessibleName(`${n}번 칸: 비어 있음`)
    await expect(page.getByTestId('empty-slot-panel')).toBeVisible()
  })

  test.describe('400px', () => {
    test.use({ viewport: { width: 400, height: 900 } })
    test('파티 줄이 가로로 넘치지 않는다 @layout', async ({ page }) => {
      await openProduct(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      const bar = await page.getByTestId('party-bar').boundingBox()
      expect(bar!.x + bar!.width).toBeLessThanOrEqual(400)
      await page.screenshot({ path: test.info().outputPath('party-400.png') })
    })
  })
})
