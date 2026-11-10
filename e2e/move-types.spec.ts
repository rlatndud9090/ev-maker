import { expect, test, type Page } from '@playwright/test'
import { combo, mySet, openProduct } from './helpers'

const slotOf = (page: Page, n: number) => mySet(page).locator('.move-slot').nth(n - 1)

test.describe('내 포켓몬 기술 칸', () => {
  test('"기술" 시각 라벨 하나 아래 1열 4칸, 접근 이름은 기술 1~4', async ({ page }) => {
    await openProduct(page)
    const me = mySet(page)
    const group = me.getByRole('group', { name: '기술', exact: true })
    await expect(group).toBeVisible()
    await expect(me.getByText('기술', { exact: true })).toHaveCount(1)
    await expect(me.getByText(/^기술 \d$/)).toHaveCount(4)
    for (const n of [1, 2, 3, 4]) await expect(combo(group, `기술 ${n}`)).toBeVisible()
    // 시각 라벨은 숨김(sr-only)이고 칸은 세로 한 줄로 쌓인다.
    for (const n of [1, 2, 3, 4]) await expect(me.getByText(`기술 ${n}`, { exact: true })).toHaveClass(/sr-only/)
    const boxes = await group.locator('.move-slot').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, top: r.top })))
    expect(new Set(boxes.map((b) => Math.round(b.left))).size).toBe(1)
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].top).toBeGreaterThan(boxes[i - 1].top)
  })

  test('지진이면 땅 타입 아이콘(data URI, alt "")과 data-type="ground", 비우면 아이콘 없음', async ({ page }) => {
    await openProduct(page)
    const me = mySet(page)
    const input = combo(me, '기술 1')
    await expect(input).toHaveValue('지진')
    const slot = slotOf(page, 1)
    await expect(slot).toHaveAttribute('data-type', 'ground')
    const icon = slot.locator('img.type-icon')
    await expect(icon).toHaveAttribute('data-type-icon', 'ground')
    await expect(icon).toHaveAttribute('alt', '')
    expect(await icon.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    expect(await icon.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(input).toHaveAccessibleDescription('땅 타입')

    await input.fill('')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(slot).not.toHaveAttribute('data-type')
    await expect(slot.locator('img')).toHaveCount(0)
    await expect(input).toHaveAccessibleDescription('')

    // 해석되지 않는 글자도 아이콘 없이 기본 스타일.
    await input.fill('없는기술')
    await input.press('Enter')
    await expect(slot).not.toHaveAttribute('data-type')
    await expect(slot.locator('img')).toHaveCount(0)

    await input.fill('지진')
    await input.press('Enter')
    await expect(slot).toHaveAttribute('data-type', 'ground')
  })

  test('하단 라이선스 표에 partywhale 타입 아이콘 항목(MIT, 커밋 고정)이 있다', async ({ page }) => {
    await openProduct(page)
    const row = page.locator('footer').getByTestId('licenses').getByRole('row').filter({ hasText: 'Pokémon Type Icons(partywhale)' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('fcbe6978c61c359680bc07636c3f9bdc0f346b43')
    await expect(row).toContainText('MIT')
    await expect(row).toContainText('https://github.com/partywhale/pokemon-type-icons/tree/fcbe6978c61c359680bc07636c3f9bdc0f346b43')
  })
})
