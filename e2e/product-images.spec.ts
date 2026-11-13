import { expect, test } from '@playwright/test'
import { cards, combo, mySet, openProduct, selectTab, waitComplete } from './helpers'

// 포켓몬 아이콘(PokeAPI sprites Champions 메뉴 아이콘)·반감열매 아이콘(Bulbagarden Champions 가방 스프라이트): 같은 출처 정적 파일만.

test('내 포켓몬 종 칸 왼쪽 이미지: 종을 바꾸면 그 종(메가 폼은 메가) 아이콘, 못 푼 종은 같은 크기 빈 자리', async ({ page }) => {
  await openProduct(page)
  const me = mySet(page)
  const icon = me.locator('.species-row [data-testid="mon-icon"]')
  const species = combo(me, '종')
  await expect(icon).toHaveAttribute('data-species-icon', 'garchomp')
  await expect(icon).toHaveAttribute('alt', '')
  await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(128)
  const before = await icon.getAttribute('src')
  // 이미지가 종 칸 왼쪽, 세로 가운데 맞춤으로 겹치지 않는다
  const box = async () => ({ icon: (await icon.boundingBox())!, input: (await species.boundingBox())! })
  let b = await box()
  expect(b.icon.x + b.icon.width).toBeLessThanOrEqual(b.input.x)
  expect(Math.round(b.icon.width)).toBe(56)

  await species.fill('메가한카리아스Z')
  await species.press('Enter')
  await expect(icon).toHaveAttribute('data-species-icon', 'garchompmegaz')
  expect(await icon.getAttribute('src')).not.toBe(before)
  await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(128)
  await waitComplete(page)

  await species.fill('없는포켓몬')
  await species.press('Enter')
  const empty = me.locator('.species-row .mon-icon-empty')
  await expect(empty).toHaveCount(1)
  await expect(me.locator('.species-row img')).toHaveCount(0)
  b = { icon: (await empty.boundingBox())!, input: (await species.boundingBox())! }
  expect(Math.round(b.icon.width)).toBe(56)
  expect(Math.round(b.icon.height)).toBe(56)
})

test('목록 행: 이름 왼쪽 아이콘(장식)·열 정렬 유지, 이미지 요청은 모두 같은 출처 200', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const images: { url: string; status: number }[] = []
  page.on('response', (r) => {
    if (r.request().resourceType() === 'image') images.push({ url: r.url(), status: r.status() })
  })
  await openProduct(page)
  for (const tab of ['방어', '스피드', '공격'] as const) {
    await selectTab(page, tab)
    await waitComplete(page)
    const n = await cards(page).count()
    expect(n).toBeGreaterThan(5)
    // 행마다 아이콘(또는 같은 크기 빈 자리) 하나, 이름 칸 버튼 안·이름 왼쪽
    expect(await cards(page).locator('.card-who > [data-testid="mon-icon"]').count()).toBe(n)
    const geo = await cards(page).evaluateAll((els) =>
      els.slice(0, 12).map((el) => {
        const icon = el.querySelector('.card-who > [data-testid="mon-icon"]')!.getBoundingClientRect()
        const name = el.querySelector('.card-name')!.getBoundingClientRect()
        const bundle = el.querySelector('.bundle-cell')!.getBoundingClientRect()
        return {
          id: (el as HTMLElement).dataset.opponent,
          species: el.querySelector('.card-who > [data-testid="mon-icon"]')!.getAttribute('data-species-icon'),
          iconLeft: Math.round(icon.left),
          iconSize: [Math.round(icon.width), Math.round(icon.height)],
          nameLeft: Math.round(name.left),
          gap: name.left - icon.right,
          bundleLeft: Math.round(bundle.left),
          // 이름은 아이콘 세로 가운데(출처 태그 줄이 있는 커스텀 행은 제외)
          centerDy: el.querySelector('.card-who > .card-meta') ? 0 : name.top + name.height / 2 - (icon.top + icon.height / 2),
        }
      }),
    )
    for (const g of geo) {
      expect(g.species, g.id).toBe(g.id)
      expect(g.iconSize, g.id).toEqual([32, 32])
      expect(g.gap, g.id).toBeGreaterThanOrEqual(0)
      expect(Math.abs(g.centerDy), g.id).toBeLessThanOrEqual(2)
    }
    // 열 정렬: 아이콘·이름·배분 열의 왼쪽이 모든 행에서 같다
    expect(new Set(geo.map((g) => g.iconLeft)).size).toBe(1)
    expect(new Set(geo.map((g) => g.nameLeft)).size).toBe(1)
    expect(new Set(geo.map((g) => g.bundleLeft)).size).toBe(1)
    // 처음 보이는 행 아이콘은 실제로 그려진다(목록 아이콘은 지연 로드)
    const first = cards(page).first().locator('.card-who > img')
    await expect(first).toHaveAttribute('alt', '')
    await expect(first).toHaveAttribute('loading', 'lazy')
    await expect.poll(() => first.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(128)
  }
  // 접근 이름은 이름 그대로(장식 이미지가 끼지 않음)
  await expect(cards(page).first().locator('.card-toggle')).toHaveAccessibleName(/^\S/)

  const pngs = images.filter((i) => /\.png(\?|$)/.test(i.url))
  expect(pngs.length).toBeGreaterThan(5)
  expect(images.filter((i) => !i.url.startsWith('data:') && new URL(i.url).origin !== origin)).toEqual([])
  expect(images.filter((i) => i.status !== 200 && i.status !== 304)).toEqual([])
  // 화면의 모든 로드된 이미지는 깨지지 않았다
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll('img')].filter((img) => img.complete && img.currentSrc !== '' && img.naturalWidth === 0).map((img) => img.src),
  )
  expect(broken).toEqual([])
})

test('푸터 라이선스·출처 표에 포켓몬 아이콘(PokeAPI sprites)·도구 아이콘(Bulbagarden) 출처 행', async ({ page }) => {
  await openProduct(page)
  const table = page.locator('footer table')
  await expect(table.locator('tr', { hasText: 'PokeAPI sprites' })).toContainText('ba403973fdf9d0ac59175813861e6a1f8ed5020c')
  await expect(table.locator('tr', { hasText: 'PokeAPI sprites' })).toContainText('CC0-1.0')
  const bag = table.locator('tr', { hasText: 'Bulbagarden Archives' })
  await expect(bag).toContainText('https://archives.bulbagarden.net/wiki/Category:Champions_Bag_sprites')
  await expect(bag).toContainText('NOASSERTION')
  await expect(bag).toContainText('© Nintendo/Creatures/GAME FREAK')
})

test('다크 테마: 목록·내 포켓몬 아이콘 뒤에 옅은 받침 원(어두운 아이콘 대비), 라이트는 없음', async ({ page }) => {
  const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundImage)
  await page.emulateMedia({ colorScheme: 'dark' })
  await openProduct(page)
  await waitComplete(page)
  expect(await bg('.card-who > img.mon-icon')).toContain('radial-gradient')
  expect(await bg('img.my-mon-icon')).toContain('radial-gradient')
  await page.emulateMedia({ colorScheme: 'light' })
  expect(await bg('.card-who > img.mon-icon')).toBe('none')
})
