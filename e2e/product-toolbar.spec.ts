import { expect, test, type Locator, type Page } from '@playwright/test'
import { cards, combo, findOverlaps, openProduct, region, selectTab, tabPanel, waitComplete, type ProductTab } from './helpers'

// 목록 위 설정 개편(사용자 요청 2026-11-12): 통계 설정 → 표시 설정 → 포켓몬 찾기 3줄, 정렬 토글(사용률/계산결과순),
// 계산결과순 그룹 라벨, "포켓몬 추가"는 진행 줄 오른쪽 끝.

const spin = (scope: Page | Locator, name: string) => scope.getByRole('spinbutton', { name, exact: true })
const rowGroup = (page: Page, name: string) => page.getByRole('group', { name, exact: true })
const sortToggle = (page: Page) => page.getByTestId('sort-toggle')
const sortButton = (page: Page, name: '사용률' | '계산결과순') => sortToggle(page).getByRole('button', { name, exact: true })
const generation = async (page: Page) => Number(await tabPanel(page).getAttribute('data-generation'))

/** 탭 관점 유리 → 불리 순서의 그룹 라벨 배지 문구(독립 기대값) */
const TIER_LABELS: Record<ProductTab, readonly string[]> = {
  공격: ['확정1타', '고난수1타', '중난수1타', '저난수1타', '확정견딤'],
  방어: ['확정견딤', '저난수1타', '중난수1타', '고난수1타', '확정1타'],
  스피드: ['선공', '동속', '후공'],
}
/** 결과 배지 색 단계(ui/format KO_BADGE·ORDER_TONE과 같은 계약) */
const TONE: Record<string, string> = {
  확정1타: 'red',
  고난수1타: 'orange',
  중난수1타: 'yellow',
  저난수1타: 'lime',
  확정견딤: 'green',
  선공: 'green',
  동속: 'yellow',
  후공: 'red',
}
const TAIL = ['no-change', 'error', 'pending']

interface Item {
  kind: 'group' | 'card'
  group?: string
  tier?: string
  label?: string
  badgeClass?: string
  count?: number
  groupKey?: string
  variable?: string
  rank?: number
  origin?: string
  current?: string
  /** 그룹 제목 id */
  headingId?: string
  /** 행 토글 버튼 aria-describedby 토큰 */
  describedBy?: string[]
}

/** 목록(ol.cards)의 자식 순서: 그룹 라벨과 행 */
async function listItems(page: Page): Promise<Item[]> {
  return tabPanel(page)
    .locator('ol.cards')
    .evaluate((ol) =>
      [...ol.children].map((el) => {
        const e = el as HTMLElement
        if (e.dataset.testid === 'sort-group') {
          const badge = e.querySelector('.ko-badge')
          return {
            kind: 'group' as const,
            group: e.dataset.group,
            tier: e.dataset.tier,
            label: badge?.textContent ?? e.querySelector('.sort-group-text')?.textContent ?? '',
            badgeClass: badge?.className,
            count: Number(e.dataset.count),
            headingId: e.querySelector('h2')?.id,
          }
        }
        return {
          kind: 'card' as const,
          groupKey: e.dataset.groupKey,
          variable: e.dataset.variable,
          rank: e.dataset.rank === undefined ? undefined : Number(e.dataset.rank),
          origin: e.dataset.origin,
          current: e.querySelector('[data-testid="ko-badge"], [data-testid="order-badge"]')?.firstChild?.textContent ?? undefined,
          describedBy: (e.querySelector('.card-toggle')?.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean),
        }
      }),
    )
}

test.describe('설정 영역 3줄', () => {
  test('통계 설정 → 표시 설정 → 포켓몬 찾기 순서, 줄마다 정해진 컨트롤 순서, 옛 컨트롤은 없다', async ({ page }) => {
    await openProduct(page)
    const stats = rowGroup(page, '통계 설정')
    const display = rowGroup(page, '표시 설정')
    const search = page.getByTestId('tool-row-search')
    await expect(stats).toBeVisible()
    await expect(display).toBeVisible()
    await expect(search).toBeVisible()
    const ys = await Promise.all([stats, display, search].map(async (l) => (await l.boundingBox())!.y))
    expect(ys[0]).toBeLessThan(ys[1])
    expect(ys[1]).toBeLessThan(ys[2])
    // 검색 줄이 툴바 맨 아래: 그 아래는 목록 박스
    const box = (await page.getByTestId('result-box').boundingBox())!
    expect(ys[2]).toBeLessThan(box.y)

    // 1행: 형식 · 기준 월 · 최소 사용률 4종(SP 배분 · 랭크업 기술 · 구애스카프 · 반감열매) 순
    const statNames = await stats.locator('select, input').evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute('aria-label') ?? e.closest('label')?.firstChild?.textContent?.trim()))
    expect(statNames).toEqual(['형식', '기준 월', 'SP 배분 최소(%)', '랭크업 기술 최소(%)', '구애스카프 최소(%)', '반감열매 최소(%)'])
    await expect(combo(stats, '형식')).toHaveValue('bo1')
    await expect(combo(stats, '기준 월')).toBeVisible()
    await expect(spin(stats, 'SP 배분 최소(%)')).toHaveValue('5')
    await expect(spin(stats, '랭크업 기술 최소(%)')).toHaveValue('10')
    await expect(spin(stats, '구애스카프 최소(%)')).toHaveValue('10')
    await expect(spin(stats, '반감열매 최소(%)')).toHaveValue('5')
    await expect(stats).toContainText('통계 설정')
    // 보이는 라벨이 그대로 접근 이름(WCAG 2.5.3), "사용률" 뜻은 설명으로
    for (const name of ['SP 배분', '랭크업 기술', '구애스카프', '반감열매']) {
      await expect(spin(stats, `${name} 최소(%)`)).toHaveAccessibleDescription(new RegExp(`^${name} 최소 사용률\\(%\\)`))
    }

    // 2행: 상위 N → 정렬(사용률/계산결과순) → 고난수 기준(공격·방어 탭). 순풍 토글은 스피드 탭에서만(고난수 기준 대신)
    const displayOrder = () =>
      display.locator('input, [data-testid="sort-toggle"], [data-testid="tailwind-toggles"]').evaluateAll((els) =>
        els.map((e) =>
          e.matches('[data-testid="sort-toggle"]')
            ? '정렬'
            : e.matches('[data-testid="tailwind-toggles"]')
              ? `순풍:${[...e.querySelectorAll('button')].map((b) => b.textContent).join('/')}`
              : e.closest('label')?.firstChild?.textContent?.trim() || e.closest('label')?.textContent?.trim(),
        ),
      )
    expect(await displayOrder()).toEqual(['상위 N', '정렬', '고난수 1타 기준'])
    await expect(display.getByRole('checkbox')).toHaveCount(0)
    await selectTab(page, '방어')
    expect(await displayOrder()).toEqual(['상위 N', '정렬', '고난수 견딤 기준'])
    await selectTab(page, '스피드')
    expect(await displayOrder()).toEqual(['상위 N', '정렬', '순풍:내 순풍/상대 순풍'])
    await selectTab(page, '공격')
    await expect(display.getByRole('group', { name: '정렬', exact: true }).getByRole('button')).toHaveText(['사용률', '계산결과순'])
    await expect(sortButton(page, '사용률')).toHaveAttribute('aria-pressed', 'true')
    await expect(sortButton(page, '계산결과순')).toHaveAttribute('aria-pressed', 'false')

    // 3행: 포켓몬 찾기 검색만(옆에 버튼 없음)
    await expect(combo(search, '포켓몬 찾기')).toBeVisible()
    await expect(search.getByRole('button')).toHaveCount(0)
    const searchBox = (await search.boundingBox())!
    const statsBox = (await stats.boundingBox())!
    expect(Math.abs(searchBox.width - statsBox.width)).toBeLessThanOrEqual(1)

    // 옛 이름·접힘 패널은 없다
    await expect(combo(page, '포켓몬 선택')).toHaveCount(0)
    await expect(combo(page, '통계 기준')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '표시 기준', exact: true })).toHaveCount(0)
    await expect(page.locator('.toolbar').getByRole('button', { name: '포켓몬 추가', exact: true })).toHaveCount(0)
  })

  test('최소 사용률 3종은 인라인으로 바로 반영(세대 +1·재계산), 범위 밖은 반영하지 않는다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const stats = rowGroup(page, '통계 설정')
    for (const name of ['SP 배분 최소(%)', '랭크업 기술 최소(%)', '구애스카프 최소(%)']) {
      const field = spin(stats, name)
      await expect(field).toBeVisible()
      const before = await generation(page)
      await field.fill('150')
      await field.blur()
      expect(await generation(page), `${name} 범위 밖`).toBe(before)
      await expect(field).not.toHaveValue('150')
      await field.fill('1')
      await field.blur()
      await expect.poll(() => generation(page), { message: name }).toBeGreaterThan(before)
      await expect(field).toHaveValue('1')
      await waitComplete(page)
    }
    // 랭크업 기술 기준을 낮추면(1%) 랭크 후 항목이 늘거나 같다: 100%로 올리면 랭크 후 항목이 사라져 기술 선택 항목 수가 준다.
    // 상대 랭크 수단은 방어·스피드 탭만 보므로(공격 탭은 내 능동 랭크업만, 2026-11-12) 방어 탭에서 센다.
    await selectTab(page, '방어')
    const rankRows = async () => {
      await waitComplete(page)
      return cards(page).evaluateAll((els) => els.reduce((n, el) => n + Number((el as HTMLElement).dataset.items ?? 0), 0))
    }
    const low = await rankRows()
    await spin(stats, '랭크업 기술 최소(%)').fill('100')
    await spin(stats, '랭크업 기술 최소(%)').blur()
    await spin(stats, '구애스카프 최소(%)').fill('100')
    await spin(stats, '구애스카프 최소(%)').blur()
    const high = await rankRows()
    expect(low).toBeGreaterThan(high)
  })
})

test.describe('정렬: 계산결과순', () => {
  test('토글은 하나만 눌리고 재계산하지 않는다(세대·완료 그대로), 사용률로 돌아가면 라벨이 없다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const before = await generation(page)
    const usageOrder = await cards(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.groupKey))
    await expect(page.getByTestId('sort-group')).toHaveCount(0)
    await sortButton(page, '계산결과순').click()
    await expect(sortButton(page, '계산결과순')).toHaveAttribute('aria-pressed', 'true')
    await expect(sortButton(page, '사용률')).toHaveAttribute('aria-pressed', 'false')
    expect(await generation(page)).toBe(before)
    await expect(tabPanel(page)).toHaveAttribute('data-complete', 'true')
    await expect(page.getByTestId('sort-group').first()).toBeVisible()
    const resultOrder = await cards(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.groupKey))
    expect([...resultOrder].sort()).toEqual([...usageOrder].sort())
    await sortButton(page, '사용률').click()
    await expect(sortButton(page, '사용률')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('sort-group')).toHaveCount(0)
    expect(await cards(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.groupKey))).toEqual(usageOrder)
    expect(await generation(page)).toBe(before)
  })

  for (const tab of ['공격', '방어', '스피드'] as const) {
    test(`${tab} 탭: 그룹은 유리 → 불리 → 변동 없음 순, 그룹 안 사용률 내림차순, 변동 가능 태그와 그룹 일치, 라벨 배지는 결과 배지 디자인`, async ({ page }) => {
      await openProduct(page)
      await selectTab(page, tab)
      await waitComplete(page)
      await sortButton(page, '계산결과순').click()
      const items = await listItems(page)
      expect(items[0].kind).toBe('group')
      const groups = items.filter((i) => i.kind === 'group')
      // 판정 그룹은 탭 관점 유리 순, 꼬리(변동 없음 → 계산 불가 → 계산 중)는 그 뒤
      const tierGroups = groups.filter((g) => g.group === 'tier')
      expect(tierGroups.length, '변동 가능 그룹').toBeGreaterThan(0)
      const order = TIER_LABELS[tab]
      const ranks = tierGroups.map((g) => order.indexOf(g.label!))
      for (const r of ranks) expect(r).toBeGreaterThanOrEqual(0)
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
      expect(new Set(ranks).size).toBe(ranks.length)
      const kinds = groups.map((g) => g.group!)
      expect(kinds.slice(0, tierGroups.length).every((k) => k === 'tier')).toBe(true)
      const tail = kinds.slice(tierGroups.length)
      expect(tail.map((k) => TAIL.indexOf(k))).toEqual([...tail.map((k) => TAIL.indexOf(k))].sort((a, b) => a - b))
      expect(tail).not.toContain('pending') // 다 계산됨
      expect(tail).toContain('no-change')

      // 라벨 배지: 결과 배지와 같은 클래스(색 단계), 같은 문구 결과 배지와 같은 배경색
      for (const g of tierGroups) expect(g.badgeClass, g.label).toBe(`ko-badge ko-${TONE[g.label!]}`)
      const labels = page.getByTestId('sort-group')
      await expect(labels.filter({ hasText: '변동 없음' })).toHaveCount(1)
      for (const g of tierGroups) {
        const label = labels.filter({ has: page.locator('.ko-badge', { hasText: g.label! }) })
        await expect(label).toContainText(`${g.label}까지 가능`)
        const sameCard = tabPanel(page).locator('[data-testid="card"] .card-result .ko-badge', { hasText: new RegExp(`^${g.label}`) }).first()
        if ((await sameCard.count()) > 0) {
          const bg = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor)
          expect(await bg(label.locator('.ko-badge'))).toBe(await bg(sameCard))
        }
      }
      // 그룹 제목: 결과 영역 첫 제목 수준(h2, h1 다음), 이름 = "<배지>까지 가능 n마리"(배지와 글자는 붙여 쓰고 개수는 띄운다)
      for (const g of tierGroups) {
        const heading = page.getByRole('heading', { level: 2, name: `${g.label}까지 가능 ${g.count}마리`, exact: true })
        await expect(heading).toBeVisible()
        const gap = await heading.evaluate((h) => h.querySelector('.sort-group-text')!.getBoundingClientRect().left - h.querySelector('.ko-badge')!.getBoundingClientRect().right)
        expect(gap, g.label).toBeLessThanOrEqual(3)
        await expect(heading.locator('.sort-group-count')).toHaveText(`${g.count}마리`)
      }
      const noChange = groups.find((g) => g.group === 'no-change')!
      await expect(page.getByRole('heading', { level: 2, name: `변동 없음 ${noChange.count}마리`, exact: true })).toBeVisible()

      // 각 그룹: 라벨 수 = 행 수, 래더 행 사용률 순위 오름차순, 변동 가능 태그 일치, 현재 판정은 그룹 최선보다 좋지 않다
      let current: Item | undefined
      const members = new Map<Item, Item[]>()
      for (const it of items) {
        if (it.kind === 'group') {
          current = it
          members.set(it, [])
        } else members.get(current!)!.push(it)
      }
      for (const [g, rows] of members) {
        // 행 토글 버튼 설명에 그 그룹 제목(소속)이 붙는다
        expect(g.headingId, g.label).toBeTruthy()
        for (const r of rows) expect(r.describedBy, `${g.label} ${r.groupKey}`).toContain(g.headingId)
        expect(rows.length, g.label).toBe(g.count)
        expect(rows.length, g.label).toBeGreaterThan(0)
        const ladderRanks = rows.filter((r) => r.origin === 'ladder').map((r) => r.rank!)
        expect(ladderRanks, g.label).toEqual([...ladderRanks].sort((a, b) => a - b))
        if (g.group === 'tier') {
          for (const r of rows) expect(r.variable, `${g.label} ${r.groupKey}`).toBe('true')
          for (const r of rows.filter((x) => x.current !== undefined && order.includes(x.current))) {
            expect(order.indexOf(r.current!), `${g.label} 현재 ${r.current}`).toBeGreaterThanOrEqual(order.indexOf(g.label!))
          }
        }
        if (g.group === 'no-change') for (const r of rows) expect(r.variable, r.groupKey).toBe('false')
      }
      // 그룹 라벨은 목록의 제목 항목(listitem > h2, ARIA list는 listitem만 갖는다)이고 Tab 순서에 들지 않는다
      expect(await labels.evaluateAll((els) => els.every((e) => e.tagName === 'LI' && !e.hasAttribute('role') && e.firstElementChild?.tagName === 'H2'))).toBe(true)
      expect(await labels.locator('button, [tabindex]').count()).toBe(0)
      const listitems = await tabPanel(page).locator('ol.cards').getByRole('listitem').count()
      expect(listitems).toBe((await cards(page).count()) + groups.length)
    })
  }

  test('정렬을 바꿔도 펼친 행·고른 배분은 그대로(같은 DOM 요소, 다시 마운트 안 함)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 배분 선택지가 둘 이상인 변동 가능 행
    const keys = await cards(page).evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLElement).dataset.variable === 'true' && Number(e.querySelector('.bundle-btn')?.getAttribute('aria-label')?.match(/\((\d+)개 중 선택\)/)?.[1] ?? 0) >= 2)
        .map((e) => (e as HTMLElement).dataset.groupKey!),
    )
    expect(keys.length, '배분이 둘 이상인 변동 가능 행').toBeGreaterThan(0)
    const key = keys[0]
    const row = cards(page).and(page.locator(`[data-group-key='${key}']`))
    const defaultId = await row.getAttribute('data-card-id')
    // 기본이 아닌 배분을 고른다
    await row.locator('.bundle-btn').click()
    const other = row.getByTestId('bundle-menu').locator('[role="menuitemradio"][aria-checked="false"]').first()
    const pickedId = (await other.getAttribute('data-card-id'))!
    expect(pickedId).not.toBe(defaultId)
    await other.click()
    await expect(row).toHaveAttribute('data-card-id', pickedId)
    await row.locator('button[aria-expanded]').first().click()
    await expect(row.locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'true')
    await row.evaluate((el) => ((el as HTMLElement & { __mark?: number }).__mark = 7))
    await sortButton(page, '계산결과순').click()
    await expect(page.getByTestId('sort-group').first()).toBeVisible()
    await expect(row.locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'true')
    await expect(row).toHaveAttribute('data-card-id', pickedId)
    await expect(row.getByTestId('bundle-menu')).toHaveCount(0)
    expect(await row.evaluate((el) => (el as HTMLElement & { __mark?: number }).__mark)).toBe(7)
    await sortButton(page, '사용률').click()
    expect(await row.evaluate((el) => (el as HTMLElement & { __mark?: number }).__mark)).toBe(7)
    await expect(row.locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'true')
    await expect(row).toHaveAttribute('data-card-id', pickedId)
  })

  test('계산결과순에서 배분을 바꿔 행이 다른 그룹으로 옮겨져도 포커스는 그 행 배분 버튼에 남고, 옮긴 그룹을 알린다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await sortButton(page, '계산결과순').click()
    await expect(page.getByTestId('sort-group').first()).toBeVisible()
    const sectionOf = (key: string) =>
      tabPanel(page)
        .locator('ol.cards')
        .evaluate((ol, k) => {
          let cur = ''
          for (const el of ol.children) {
            const e = el as HTMLElement
            if (e.dataset.testid === 'sort-group') cur = `${e.dataset.group}:${e.dataset.tier ?? ''}`
            else if (e.dataset.groupKey === k) return cur
          }
          return undefined
        }, key)
    // 변동 가능 여부가 지금과 다른 배분이 있는 행(고르면 판정 그룹 ↔ 변동 없음으로 반드시 옮겨진다)을 찾는다
    const keys = await cards(page).evaluateAll((els) =>
      els.filter((e) => Number(e.querySelector('.bundle-btn')?.getAttribute('aria-label')?.match(/\((\d+)개 중 선택\)/)?.[1] ?? 0) >= 2).map((e) => (e as HTMLElement).dataset.groupKey!),
    )
    let found: { key: string; cardId: string; index: number } | undefined
    for (const key of keys) {
      const row = cards(page).and(page.locator(`[data-group-key='${key}']`))
      const variable = await row.getAttribute('data-variable')
      await row.locator('.bundle-btn').click()
      const opt = row.getByTestId('bundle-menu').locator(`[role="menuitemradio"][aria-checked="false"]:not([data-variable="${variable}"])`).first()
      if ((await opt.count()) > 0) {
        // 메뉴 안 항목 순번(배분을 고르기 전까지 순서는 그대로)
        const index = await opt.evaluate((el) => [...el.closest('[role="menu"]')!.querySelectorAll('[role="menuitemradio"]')].indexOf(el))
        found = { key, cardId: (await opt.getAttribute('data-card-id'))!, index }
        break
      }
      await page.keyboard.press('Escape')
    }
    expect(found, '변동 가능 여부가 다른 배분이 있는 행').toBeDefined()
    const { key, cardId, index } = found!
    const row = cards(page).and(page.locator(`[data-group-key='${key}']`))
    const before = await sectionOf(key)
    await row.getByTestId('bundle-menu').locator('[role="menuitemradio"]').nth(index).click()
    await expect(row).toHaveAttribute('data-card-id', cardId)
    expect(await sectionOf(key)).not.toBe(before)
    await expect(row.locator('.bundle-btn')).toBeFocused()
    // 화면도 그 행으로 따라간다
    await expect(row.locator('.bundle-btn')).toBeInViewport()
    // 이름 칸의 포켓몬 이름(반감열매 행이면 배지를 뺀 이름)
    const name = (await row.locator('.card-name').evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement
      c.querySelector('[data-testid="berry-badge"]')?.remove()
      return c.textContent ?? ''
    })).trim()
    await expect(page.getByTestId('sort-moved')).toContainText(name)
    await expect(page.getByTestId('sort-moved')).toContainText(/(까지 가능|변동 없음) 그룹으로 옮겼습니다/)
    await expect(page.getByTestId('sort-moved')).toHaveAttribute('aria-live', 'polite')
    // 키보드로 계속 이어서 조작할 수 있다(배분 메뉴 다시 열기)
    await page.keyboard.press('Enter')
    await expect(row.getByTestId('bundle-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(row.locator('.bundle-btn')).toBeFocused()
  })

  test('계산 중에는 대표가 확정 안 된 행이 "계산 중" 그룹(맨 끝)에 있다가 완료되면 자리를 찾는다', async ({ page }) => {
    await openProduct(page)
    await sortButton(page, '계산결과순').click()
    // 입력을 바꿔 다시 계산시키고, 계산 중 상태를 한 번 이상 본다.
    const seen = new Set<string>()
    await page.exposeFunction('__seenGroups', (gs: string[]) => gs.forEach((g) => seen.add(g)))
    await page.evaluate(() => {
      const w = window as unknown as { __seenGroups: (g: string[]) => void }
      const read = () => {
        const groups = [...document.querySelectorAll('[data-testid="sort-group"]')].map((e) => (e as HTMLElement).dataset.group ?? '')
        const last = groups.at(-1)
        // 계산 중 그룹이 있으면 늘 맨 끝
        w.__seenGroups(groups.includes('pending') ? [last === 'pending' ? 'pending-last' : 'pending-not-last'] : ['settled'])
      }
      new MutationObserver(read).observe(document.querySelector('[data-testid="tab-panel"]')!, { childList: true, subtree: true })
    })
    await selectTab(page, '스피드')
    await waitComplete(page)
    const wind = rowGroup(page, '순풍').getByRole('button', { name: '상대 순풍', exact: true })
    await wind.click()
    await expect(wind).toHaveAttribute('aria-pressed', 'true')
    await waitComplete(page)
    await expect(page.getByTestId('sort-group').filter({ hasText: '계산 중' })).toHaveCount(0)
    expect(seen.has('pending-not-last')).toBe(false)
    expect(seen.has('pending-last')).toBe(true)
  })
})

test.describe('포켓몬 추가 버튼', () => {
  test('진행 줄("계산 완료 n/n")의 오른쪽 끝에 있고, 누르면 추가 패널이 열리고 닫으면 버튼으로 돌아온다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const status = page.getByTestId('panel-status')
    const button = status.getByRole('button', { name: '포켓몬 추가', exact: true })
    await expect(button).toBeVisible()
    await expect(status.getByTestId('progress')).toHaveText(/^계산 완료 \d+\/\d+$/)
    const s = (await status.boundingBox())!
    const b = (await button.boundingBox())!
    const p = (await status.getByTestId('progress').boundingBox())!
    expect(Math.abs(s.x + s.width - (b.x + b.width))).toBeLessThanOrEqual(2)
    expect(b.x).toBeGreaterThan(p.x + p.width)
    // 같은 줄(세로로 겹침)
    expect(Math.min(b.y + b.height, p.y + p.height) - Math.max(b.y, p.y)).toBeGreaterThan(0)
    // 목록 박스 오른쪽 위
    const box = (await page.getByTestId('result-box').boundingBox())!
    expect(b.y - box.y).toBeLessThan(40)
    expect(box.x + box.width - (b.x + b.width)).toBeLessThan(40)

    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await button.click()
    const panel = region(page, '목록 밖 포켓몬 추가')
    await expect(panel).toBeVisible()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(button).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!)
    await expect(combo(panel, '추가할 포켓몬')).toBeFocused()
    // 패널은 진행 줄 바로 아래(목록 위): 열린 후보 목록이 버튼을 가리지 않는다
    const panelBox = (await panel.boundingBox())!
    const statusNow = (await status.boundingBox())!
    expect(panelBox.y).toBeGreaterThanOrEqual(statusNow.y + statusNow.height - 1)
    expect(panelBox.y - (statusNow.y + statusNow.height)).toBeLessThan(24)
    // 열린 후보 목록을 Escape로 닫은 뒤 [취소]
    await page.keyboard.press('Escape')
    await panel.getByRole('button', { name: '취소', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(button).toBeFocused()
    await button.click()
    await expect(panel).toBeVisible()
    await button.click()
    await expect(panel).toHaveCount(0)
  })
})

for (const width of [400, 1280]) {
  test.describe(`설정·그룹 라벨 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    test(`${width}px: 설정 3줄·그룹 라벨·진행 줄 겹침 없음, 가로 넘침 없음`, async ({ page }) => {
      await openProduct(page)
      await waitComplete(page)
      await sortButton(page, '계산결과순').click()
      await expect(page.getByTestId('sort-group').first()).toBeVisible()
      // 고난수 기준 안내(잘못된 입력)까지 띄운 가장 넓은 상태
      const roll = spin(rowGroup(page, '표시 설정'), '고난수 1타 기준')
      await roll.fill('99')
      await expect(page.getByTestId('roll-hint')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      const sel =
        'main[data-app="product"] :is(.toolbar label, .toolbar button, .toolbar select, .toolbar input, .tool-row-label, .sort-label, .roll-unit, .field-hint, [data-testid="panel-status"] > *, .sort-group-label > *)'
      expect(await findOverlaps(page, sel)).toEqual([])
      // 컨트롤이 툴바 폭 밖으로 나가지 않는다
      const out = await page.evaluate(() => {
        const bar = document.querySelector('.toolbar-controls')!.getBoundingClientRect()
        return [...document.querySelectorAll('.toolbar-controls :is(label, button, select, input)')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && (r.left < bar.left - 1 || r.right > bar.right + 1)).length
      })
      expect(out).toBe(0)
      await page.screenshot({ path: test.info().outputPath(`toolbar-${width}.png`) })
      await roll.fill('14')
      await roll.blur()
    })

    test(`${width}px: 목록을 끝까지 스크롤한 뒤 포켓몬 추가를 열어도 패널·후보 목록이 화면 안에 잘리지 않고 보인다`, async ({ page }) => {
      await openProduct(page)
      await waitComplete(page)
      const scroller = page.getByTestId('result-scroll')
      await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      const button = page.getByTestId('panel-status').getByRole('button', { name: '포켓몬 추가', exact: true })
      await button.scrollIntoViewIfNeeded()
      await button.click()
      const panel = region(page, '목록 밖 포켓몬 추가')
      const input = combo(panel, '추가할 포켓몬')
      await expect(input).toBeFocused()
      await input.fill('로토무')
      const listbox = page.getByRole('listbox').filter({ has: page.getByRole('option') }).first()
      await expect(listbox).toBeVisible()
      await expect(panel.getByRole('heading', { name: '목록 밖 포켓몬 추가' })).toBeInViewport()
      await expect(input).toBeInViewport({ ratio: 1 })
      // 입력이 고정 진행 줄·탭 줄 밑에 숨지 않는다(가운데를 누르면 그 입력)
      const onTop = (l: Locator) =>
        l.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return top !== null && (top === el || el.contains(top))
        })
      expect(await onTop(input)).toBe(true)
      expect(await onTop(button)).toBe(true)
      // 후보 목록은 어떤 스크롤 상자에도 잘리지 않는다: 첫 후보의 가운데를 누르면 그 후보다
      const first = listbox.getByRole('option').first()
      await expect(first).toBeInViewport({ ratio: 1 })
      expect(await onTop(first)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await page.screenshot({ path: test.info().outputPath(`custom-panel-${width}.png`) })
    })
  })
}
