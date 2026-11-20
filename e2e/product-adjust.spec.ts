import { expect, test, type Locator, type Page } from '@playwright/test'
import { adjustButton, adjustMenu, adjustNature, adjustResult, cards, lockRow, moveCard, mySet, openAdjust, openProduct, selectTab, tabPanel, waitComplete, type StatLabel } from './helpers'

// 변동 팝오버(PRD R21~R24·R26, ADR 결정 19 대안 A "2단 교체 팝오버") — 고정이 없을 때. 고정 중 동작은 product-cut-lock.spec.ts.

/** 결과 순위(공격 탭 관점 좋은 것부터). 방어 탭 목록은 이 역순이다 */
const ATTACK_ORDER = ['guaranteed-ohko', 'high-roll-ohko', 'mid-roll-ohko', 'low-roll-ohko', 'guaranteed-survive'] as const
const LABEL_TEXT: Readonly<Record<(typeof ATTACK_ORDER)[number], string>> = {
  'guaranteed-ohko': '확정1타',
  'high-roll-ohko': '고난수1타',
  'mid-roll-ohko': '중난수1타',
  'low-roll-ohko': '저난수1타',
  'guaranteed-survive': '확정견딤',
}
const STAT_OF: Readonly<Record<string, StatLabel>> = { H: 'HP', A: '공격', B: '방어', C: '특공', D: '특방', S: '스피드' }
const STATS: readonly StatLabel[] = ['HP', '공격', '방어', '특공', '특방', '스피드']
const SP_TOTAL = 66

const spBox = (page: Page, stat: StatLabel) => mySet(page).getByRole('spinbutton', { name: `SP ${stat} 숫자`, exact: true })
const plusButton = (page: Page, stat: Exclude<StatLabel, 'HP'>) => mySet(page).getByRole('button', { name: `${stat} 성격 상승`, exact: true })
/** 그 카드(그룹 키로 고정: 재계산 뒤에도 같은 줄) */
const groupCard = async (page: Page, card: Locator) => cards(page).and(page.locator(`[data-group-key='${await card.getAttribute('data-group-key')}']`))
/** 변동 버튼이 있는 카드 */
const adjustable = (page: Page) => cards(page).filter({ has: page.getByTestId('adjust-button') })

async function allSp(page: Page): Promise<Record<StatLabel, number>> {
  const out = {} as Record<StatLabel, number>
  for (const s of STATS) out[s] = Number(await spBox(page, s).inputValue())
  return out
}

interface ResultItem {
  label: string
  badge: string
  tone: string
  sps: string
  current: boolean
  enabled: boolean
}

/** 1단 목록 항목(계산이 끝나 고를 수 있는 항목이 나올 때까지 기다린다) */
async function resultItems(menu: Locator): Promise<ResultItem[]> {
  await expect(menu).toHaveAttribute('data-stage', 'result')
  await expect(menu.getByTestId('adjust-result').first()).toHaveAttribute('data-enabled', 'true', { timeout: 15_000 })
  return menu.getByTestId('adjust-result').evaluateAll((els) =>
    els.map((e) => {
      const badge = e.querySelector('.ko-badge')
      return {
        label: (e as HTMLElement).dataset.label ?? '',
        badge: badge?.textContent ?? '',
        tone: [...(badge?.classList ?? [])].find((c) => /^ko-(red|orange|yellow|lime|green|gray)$/.test(c)) ?? '',
        sps: [...e.querySelectorAll('.adjust-sp')].map((s) => s.textContent).join(' '),
        current: (e as HTMLElement).dataset.current === 'true',
        enabled: (e as HTMLElement).dataset.enabled === 'true',
      }
    }),
  )
}

interface NatureItem {
  nature: string
  name: string
  sps: string
  enabled: boolean
  why: string
}

async function natureItems(menu: Locator): Promise<NatureItem[]> {
  await expect(menu).toHaveAttribute('data-stage', 'nature')
  return menu.getByTestId('adjust-nature').evaluateAll((els) =>
    els.map((e) => ({
      nature: (e as HTMLElement).dataset.nature ?? '',
      name: e.querySelector('.adjust-nature-name')?.textContent ?? '',
      sps: [...e.querySelectorAll('.adjust-sp')].map((s) => s.textContent).join(' '),
      enabled: (e as HTMLElement).dataset.enabled === 'true' && e.getAttribute('aria-disabled') !== 'true',
      why: e.querySelector('.adjust-why')?.textContent ?? '',
    })),
  )
}

/** "H2 B11" · "A20+" → 능력치별 SP */
function parseSps(text: string): Partial<Record<StatLabel, number>> {
  const out: Partial<Record<StatLabel, number>> = {}
  for (const m of text.matchAll(/([HABCDS])(\d+)\+?/g)) out[STAT_OF[m[1]]] = Number(m[2])
  return out
}

/** "H2 B11+" → 13(고정 표지 포함 모든 능력치 SP 합) */
const spSum = (text: string): number => [...text.matchAll(/[HABCDS](\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0)

/**
 * 변동 버튼이 있는 카드를 위에서부터 열어, 1단 결과(result)를 고르고 2단에서 option을 만족하는 고를 수 있는 선택지를 찾는다.
 * 찾으면 그 2단을 연 채로 카드(그룹 키 고정)·결과·선택지를 돌려준다.
 */
async function findNature(
  page: Page,
  result: (it: ResultItem) => boolean,
  option: (o: NatureItem) => boolean,
): Promise<{ card: Locator; item: ResultItem; option: NatureItem } | undefined> {
  const n = await adjustable(page).count()
  for (let i = 0; i < n; i++) {
    const card = await groupCard(page, adjustable(page).nth(i))
    const menu = await openAdjust(card)
    for (const item of (await resultItems(menu)).filter(result)) {
      await adjustResult(card, item.badge).click()
      const found = (await natureItems(menu)).find((o) => o.enabled && option(o))
      if (found !== undefined) return { card, item, option: found }
      await menu.getByTestId('adjust-back').click()
    }
    await closeMenu(page, card)
  }
  return undefined
}

/** 카드 결과 배지의 단계명(뒤 1타 확률 빼고) */
const badgeLabel = async (card: Locator) => ((await card.getByTestId('ko-badge').textContent()) ?? '').replace(/ \d+\.\d%$/, '')

async function closeMenu(page: Page, card: Locator) {
  await page.keyboard.press('Escape')
  await expect(adjustMenu(card)).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
  await openProduct(page)
  await waitComplete(page)
})

test.describe('변동 버튼(R21)', () => {
  test('변동 가능한 카드에만(그 탭 최선 결과여도) "변동 ▾" 버튼이 있다. "변동 가능" 배지는 카드 줄에서 사라졌다', async ({ page }) => {
    for (const tab of ['공격', '방어'] as const) {
      const best = tab === '공격' ? '확정1타' : '확정견딤'
      await selectTab(page, tab)
      await waitComplete(page)
      const lines = await cards(page).evaluateAll((els) =>
        els.map((el) => ({
          id: (el as HTMLElement).dataset.cardId ?? '',
          variable: (el as HTMLElement).dataset.variable === 'true',
          buttons: el.querySelectorAll('.card-line [data-testid="adjust-button"]').length,
          tag: el.querySelector('.card-line [data-testid="variable-tag"]') !== null,
          badge: el.querySelector('.card-line [data-testid="ko-badge"]')?.textContent ?? null,
        })),
      )
      expect(lines.filter((l) => l.variable).length, tab).toBeGreaterThan(0)
      expect(lines.filter((l) => !l.variable).length, tab).toBeGreaterThan(0)
      expect(lines.filter((l) => l.buttons === 1).length, tab).toBeGreaterThan(0)
      for (const l of lines) {
        expect(l.buttons, `${tab} ${l.id}`).toBe(l.variable ? 1 : 0)
        expect(l.tag, `${tab} ${l.id}`).toBe(false)
      }
      // 이미 그 탭 최선 결과인 변동 가능 카드도 버튼이 있다(더 낮은 결과로 SP를 줄일 수 있게)
      expect(lines.filter((l) => l.variable && l.badge?.startsWith(best)).length, `${tab} 최선 결과 변동 가능 카드`).toBeGreaterThan(0)
      // 버튼: 글자 "변동" + 펼침 화살표(▾ 아이콘), 읽기 이름 "변동: <상대>", 메뉴를 여는 버튼(닫힘), 읽기 설명에 결과 배지
      const card = adjustable(page).first()
      const button = adjustButton(card)
      const name = (await card.locator('.card-name').evaluate((el) => [...el.childNodes].filter((n) => !(n instanceof Element && n.matches('.item-mark'))).map((n) => n.textContent).join(''))).trim()
      await expect(button).toHaveText('변동')
      await expect(button.locator('svg.bundle-caret')).toBeVisible()
      await expect(button.locator('svg.bundle-caret')).toHaveAttribute('aria-hidden', 'true')
      await expect(button).toHaveAccessibleName(`변동: ${name}`)
      await expect(button).toHaveAttribute('aria-haspopup', 'menu')
      await expect(button).toHaveAttribute('aria-expanded', 'false')
      await expect(button).toHaveAccessibleDescription(new RegExp(await badgeLabel(card)))
    }
  })
})

test.describe('1단 결과 목록(R22)', () => {
  for (const [tab, order, spPattern] of [
    ['공격', ATTACK_ORDER, /^A\d+\+?$/],
    ['방어', [...ATTACK_ORDER].reverse(), /^H\d+ [BD]\d+\+?$/],
  ] as const) {
    test(`${tab} 탭: ${order[0] === 'guaranteed-ohko' ? '확정1타 → 확정견딤' : '확정견딤 → 확정1타'} 순서, 항목 = 결과 배지 + 최소 SP, 현재 결과 표시, 현재보다 낮은 결과도 목록에 있다`, async ({ page }) => {
      await selectTab(page, tab)
      await waitComplete(page)
      const n = Math.min(8, await adjustable(page).count())
      expect(n).toBeGreaterThan(2)
      let lower = 0
      for (let i = 0; i < n; i++) {
        const card = adjustable(page).nth(i)
        const id = await card.getAttribute('data-card-id')
        const menu = await openAdjust(card)
        await expect(menu).toHaveAccessibleName(/^변동할 결과: /)
        const items = await resultItems(menu)
        expect(items.length, id!).toBeGreaterThan(0)
        // 순서: 그 탭 관점 좋은 결과부터, 같은 결과는 한 번만
        const ranks = items.map((it) => order.indexOf(it.label as (typeof order)[number]))
        expect(ranks.every((r) => r >= 0), id!).toBe(true)
        expect(ranks, id!).toEqual([...new Set(ranks)].sort((a, b) => a - b))
        for (const it of items) {
          // 결과 배지(카드 결과 배지 디자인) + 그 결과의 최소 SP("A28" · "H20 B10", 상승안은 "+")
          expect(it.badge, id!).toBe(LABEL_TEXT[it.label as (typeof order)[number]])
          expect(it.tone, id!).not.toBe('')
          expect(it.sps, id!).toMatch(spPattern)
          expect(it.enabled, id!).toBe(true)
        }
        // 현재 결과는 하나만 표시(왼쪽 강조), 카드 결과 배지와 같은 결과
        const current = items.filter((it) => it.current)
        expect(current, id!).toHaveLength(1)
        expect(current[0].badge, id!).toBe(await badgeLabel(card))
        // "현재" 글자 배지는 없고(사용자 결정 2026-11-20) 왼쪽 강조·aria-current로만 표시한다
        await expect(menu.locator('[data-testid="adjust-result"][aria-current="true"]')).toHaveCount(1)
        await expect(menu.getByText('현재', { exact: true })).toHaveCount(0)
        if (items.indexOf(current[0]) < items.length - 1) lower++
        await closeMenu(page, card)
        await expect(adjustButton(card)).toBeFocused()
      }
      // 현재보다 낮은 결과(그 최소 SP로 줄여 다른 곳에 돌릴 수 있게)도 목록에 든다
      expect(lower, tab).toBeGreaterThan(0)
    })
  }
})

test.describe('2단 성격 선택(R23)', () => {
  test('결과를 고르면 같은 자리가 성격 선택으로 바뀌고(무보정 / 상승 두 선택지), ‹ 뒤로는 1단으로', async ({ page }) => {
    const card = adjustable(page).first()
    const menu = await openAdjust(card)
    const items = await resultItems(menu)
    const first = items[0]
    await adjustResult(card, first.badge).click()
    // 같은 팝오버 자리(한 개)가 2단으로: 머리줄에 고른 결과 배지·SP, 제목 "성격 선택"
    await expect(adjustMenu(card)).toHaveCount(1)
    await expect(menu).toHaveAttribute('data-stage', 'nature')
    await expect(menu).toHaveAttribute('data-label', first.label)
    await expect(menu).toHaveAccessibleName(new RegExp(`^성격 선택: ${first.badge} `))
    await expect(menu.locator('.adjust-head-result .ko-badge')).toHaveText(first.badge)
    await expect(menu.locator('.adjust-head-title')).toHaveText('성격 선택')
    const natures = await natureItems(menu)
    expect(natures.map((n) => [n.nature, n.name])).toEqual([
      ['neutral', '무보정'],
      ['plus', 'A 상승'],
    ])
    for (const n of natures) {
      if (n.enabled) expect(n.sps).toMatch(n.nature === 'plus' ? /^A\d+\+$/ : /^A\d+$/)
      else expect(n.why).toMatch(/^(닿지 않음|SP 부족)$/)
    }
    // 1단 SP 표기는 내 세트 성격 기준 선택지(예시 세트 hardy = 무보정)의 SP, 무보정으로 닿지 않으면 고를 수 있는 선택지 중 SP 합이 가장 작은 것(사용자 결정 2026-11-20)
    const enabled = natures.filter((n) => n.enabled)
    expect(enabled.map((n) => n.sps)).toContain(first.sps)
    const neutral = enabled.find((n) => n.nature === 'neutral')
    if (neutral !== undefined) expect(first.sps).toBe(neutral.sps)
    else expect(spSum(first.sps)).toBe(Math.min(...enabled.map((n) => spSum(n.sps))))
    await menu.getByTestId('adjust-back').click()
    await expect(menu).toHaveAttribute('data-stage', 'result')
    await expect(await resultItems(menu)).toEqual(items)
  })

  test('닿지 않는 선택지는 비활성 + 짧은 사유이고, 눌러도 적용되지 않는다', async ({ page }) => {
    // 1단 SP가 상승안("A23+")인 결과는 무보정으로 닿지 않는다 — 그런 결과가 있는 첫 카드를 찾는다
    const n = await adjustable(page).count()
    let found: { card: Locator; badge: string } | undefined
    for (let i = 0; i < n && found === undefined; i++) {
      const card = adjustable(page).nth(i)
      const items = await resultItems(await openAdjust(card))
      for (const it of items.filter((x) => x.sps.endsWith('+'))) {
        await adjustResult(card, it.badge).click()
        const neutral = (await natureItems(adjustMenu(card))).find((x) => x.nature === 'neutral')!
        if (!neutral.enabled) {
          found = { card: await groupCard(page, card), badge: it.badge }
          break
        }
        await adjustMenu(card).getByTestId('adjust-back').click()
      }
      if (found === undefined) await closeMenu(page, card)
    }
    expect(found, '무보정으로 닿지 않는 결과가 있는 카드').toBeDefined()
    const { card } = found!
    const option = adjustNature(card, '무보정')
    await expect(option).toHaveAttribute('aria-disabled', 'true')
    await expect(option).toHaveAttribute('data-enabled', 'false')
    await expect(option.locator('.adjust-why')).toHaveText('닿지 않음')
    await expect(option.getByTestId('adjust-sps')).toHaveCount(0)
    const before = await allSp(page)
    const gen = await tabPanel(page).getAttribute('data-generation')
    await expect(option).toBeDisabled()
    // 비활성(aria-disabled) 항목을 실제로 눌러 본다(actionability 대기를 건너뛴다)
    await option.click({ force: true })
    await expect(adjustMenu(card)).toHaveAttribute('data-stage', 'nature')
    expect(await allSp(page)).toEqual(before)
    await expect(tabPanel(page)).toHaveAttribute('data-generation', gen!)
    await closeMenu(page, card)
  })
})

test.describe('2단 선택지는 그 결과를 정확히 낸다(R22·R23)', () => {
  // 상승 바닥(A0+·B0+)이 이미 더 좋은 결과인 카드: 낮은 결과에서 상승은 고르면 다른 결과가 나므로 비활성이어야 한다.
  for (const [tab, opponent, move] of [
    ['공격', 'absolmegaz', 'dragonclaw'],
    ['방어', 'kingambit', 'kowtowcleave'],
  ] as const) {
    test(`${tab} 탭 ${opponent}: 고를 수 있는 모든 결과 × 성격을 적용하면 카드 결과가 고른 결과다`, async ({ page }) => {
      test.slow()
      await selectTab(page, tab)
      await waitComplete(page)
      const card = moveCard(page, opponent, move)
      const menu = await openAdjust(card)
      const pairs: { badge: string; name: string }[] = []
      let unreachable = 0
      for (const item of await resultItems(menu)) {
        await adjustResult(card, item.badge).click()
        for (const o of await natureItems(menu)) {
          if (o.enabled) pairs.push({ badge: item.badge, name: o.name })
          else if (o.why === '닿지 않음') unreachable++
        }
        await menu.getByTestId('adjust-back').click()
      }
      expect(pairs.length).toBeGreaterThan(2)
      expect(unreachable, '더 좋은 결과가 먼저 나는 선택지는 비활성').toBeGreaterThan(0)
      for (const { badge, name } of pairs) {
        await openProduct(page)
        await waitComplete(page)
        await selectTab(page, tab)
        await waitComplete(page)
        await openAdjust(card)
        await expect(adjustResult(card, badge).first()).toHaveAttribute('data-enabled', 'true', { timeout: 15_000 })
        await adjustResult(card, badge).click()
        await adjustNature(card, name).click()
        await waitComplete(page)
        expect(await badgeLabel(card), `${badge} / ${name}`).toBe(badge)
      }
    })
  }
})

test.describe('적용(R24)', () => {
  test('공격 탭: 무보정을 고르면 그 능력치 SP만 바뀌고 카드 결과가 고른 결과가 된다(1 적으면 그 결과가 아니다), 상승을 고르면 성격 ▲도 바뀐다', async ({ page }) => {
    const before = await allSp(page)
    // 현재가 아닌 결과 중 2단 무보정 SP가 0보다 큰 것을 고른다
    const pick = await findNature(page, (it) => !it.current, (o) => o.nature === 'neutral' && parseSps(o.sps).공격! > 0)
    expect(pick, '무보정 SP > 0인 다른 결과가 있는 카드').toBeDefined()
    const { card, item } = pick!
    const sp = parseSps(pick!.option.sps).공격!
    await adjustNature(card, '무보정').click()
    await expect(adjustMenu(card)).toHaveCount(0)
    await waitComplete(page)
    await expect(spBox(page, '공격')).toHaveValue(String(sp))
    expect(await allSp(page)).toEqual({ ...before, 공격: sp })
    await expect(plusButton(page, '공격')).toHaveAttribute('aria-pressed', 'false')
    expect(await badgeLabel(card)).toBe(item.badge)
    await expect(mySet(page).getByTestId('lock-trim')).toHaveCount(0)
    // 적용하면 팝오버가 닫히고 같은 카드의 변동 버튼에 포커스
    await expect(adjustButton(card)).toBeFocused()
    // 최소 SP: 1 적으면 그 결과에 닿지 않는다
    await spBox(page, '공격').fill(String(sp - 1))
    await waitComplete(page)
    expect(await badgeLabel(card)).not.toBe(item.badge)

    // 상승: 같은 카드에서 상승안이 있는 결과를 고르면 공격 ▲가 켜지고 SP가 그 값
    const menu = await openAdjust(card)
    const items = await resultItems(menu)
    let plus: { badge: string; sp: number } | undefined
    for (const it of items) {
      await adjustResult(card, it.badge).click()
      const o = (await natureItems(menu)).find((x) => x.nature === 'plus' && x.enabled)
      if (o !== undefined) {
        plus = { badge: it.badge, sp: parseSps(o.sps).공격! }
        break
      }
      await menu.getByTestId('adjust-back').click()
    }
    expect(plus, '상승안이 있는 결과').toBeDefined()
    await adjustNature(card, 'A 상승').click()
    await waitComplete(page)
    await expect(spBox(page, '공격')).toHaveValue(String(plus!.sp))
    await expect(plusButton(page, '공격')).toHaveAttribute('aria-pressed', 'true')
    expect(await badgeLabel(card)).toBe(plus!.badge)
    // 하락은 기존 자동 규칙: 공격이 아닌 한 능력치에 "(자동)" 하락
    const minus = mySet(page).locator('button.nat-btn.minus[aria-pressed="true"]')
    await expect(minus).toHaveCount(1)
    await expect(minus).toHaveAccessibleName(/^(방어|특공|특방|스피드) 성격 하락 \(자동\)$/)
  })

  test('방어 탭: 고른 H·B/D가 들어가고, 합계 66을 넘으면 변동 밖 능력치를 H→A→B→C→D→S 순서로 줄여 알린다', async ({ page }) => {
    await selectTab(page, '방어')
    await waitComplete(page)
    const before = await allSp(page)
    expect(Object.values(before).reduce((a, b) => a + b, 0)).toBe(SP_TOTAL)
    // 2단 무보정 H·B/D가 지금보다 큰(합계를 넘기는) 결과
    const pick = await findNature(
      page,
      (it) => !it.current,
      (o) => {
        if (o.nature !== 'neutral') return false
        const s = parseSps(o.sps)
        return (s.HP ?? 0) + (s.방어 ?? 0) + (s.특방 ?? 0) > before.HP + before.방어 + before.특방
      },
    )
    expect(pick, '합계를 넘기는 무보정 결과가 있는 방어 카드').toBeDefined()
    const { card, item } = pick!
    const sps = parseSps(pick!.option.sps)
    const natures = await natureItems(adjustMenu(card))
    expect(natures.map((x) => x.name)).toEqual(['무보정', `${sps.방어 === undefined ? 'D' : 'B'} 상승`])
    await adjustNature(card, '무보정').click()
    await waitComplete(page)

    // 기대값: 바꾼 능력치는 그 값, 나머지를 H→A→B→C→D→S 순서로 줄여 66에 맞춘다
    const want: Record<StatLabel, number> = { ...before, ...sps }
    let over = Object.values(want).reduce((a, b) => a + b, 0) - SP_TOTAL
    expect(over).toBeGreaterThan(0)
    const trims: string[] = []
    for (const s of STATS) {
      if (over <= 0 || s in sps || want[s] === 0) continue
      const cut = Math.min(want[s], over)
      const short = Object.entries(STAT_OF).find(([, v]) => v === s)![0]
      trims.push(`${short} ${want[s]} → ${want[s] - cut}(합계 66 초과로 줄임)`)
      want[s] -= cut
      over -= cut
    }
    expect(await allSp(page)).toEqual(want)
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText('0')
    const trim = mySet(page).getByTestId('lock-trim')
    await expect(trim).toHaveAttribute('role', 'status')
    await expect(trim).toContainText(trims.join(', '))
    expect(await badgeLabel(card)).toBe(item.badge)
    await trim.getByRole('button', { name: 'SP 줄임 알림 닫기' }).click()
    await expect(trim).toHaveCount(0)
  })
})

test.describe('방어 쌍 두 배분(R23 합 최소 / H 최대)', () => {
  test('@layout 2단 성격마다 "합 최소"·"H 최대"(다르면 둘, 같으면 하나), H 최대를 고르면 그 H·B/D가 들어가고 고른 결과가 그대로다', async ({ page }) => {
    await selectTab(page, '방어')
    await waitComplete(page)
    // H 최대 항목이 있는 2단(결과 · 성격)을 찾는다
    let found: { card: Locator; badge: string } | undefined
    const n = await adjustable(page).count()
    for (let i = 0; i < n && found === undefined; i++) {
      const card = await groupCard(page, adjustable(page).nth(i))
      await adjustButton(card).scrollIntoViewIfNeeded()
      const menu = await openAdjust(card)
      for (const item of await resultItems(menu)) {
        await adjustResult(card, item.badge).click()
        await expect(menu).toHaveAttribute('data-stage', 'nature')
        if ((await menu.getByTestId('adjust-hmax').count()) > 0) {
          found = { card, badge: item.badge }
          break
        }
        await menu.getByTestId('adjust-back').click()
      }
      if (found === undefined) await closeMenu(page, card)
    }
    expect(found, 'H 최대 배분이 있는 방어 카드').toBeDefined()
    const { card, badge } = found!
    const menu = adjustMenu(card)
    const hMax = menu.getByTestId('adjust-hmax').first()
    const nature = (await hMax.getAttribute('data-nature'))!
    const minSum = menu.locator(`[data-testid="adjust-nature"][data-nature="${nature}"]`)
    // 합 최소 항목(성격 이름 + "합 최소") 바로 아래 H 최대 항목(읽기 이름에 성격 이름), 둘 다 H·B/D
    await expect(minSum).toHaveAttribute('data-alloc', 'min-sum')
    await expect(minSum.locator('.adjust-alloc')).toHaveText('합 최소')
    await expect(hMax.locator('.adjust-alloc')).toHaveText('H 최대')
    const name = (await minSum.locator('.adjust-nature-name').textContent())!
    await expect(hMax).toHaveAccessibleName(new RegExp(`^${name}\\s*H 최대\\s*H\\d+\\s*[BD]\\d+\\+?$`))
    const low = parseSps((await minSum.locator('.adjust-sps').textContent())!)
    const high = parseSps((await hMax.locator('.adjust-sps').textContent())!)
    expect(high.HP!).toBeGreaterThan(low.HP ?? 0)
    expect(high.HP!).toBeLessThanOrEqual(32)
    // H 최대가 없는 성격 선택지는 배분 이름 없이 하나
    for (const el of await menu.locator('[data-testid="adjust-nature"]:not([data-alloc])').all()) await expect(el.locator('.adjust-alloc')).toHaveCount(0)
    // 키보드: 합 최소 → ↓ → H 최대
    await minSum.focus()
    await page.keyboard.press('ArrowDown')
    await expect(hMax).toBeFocused()
    // 좁은 화면에서도 항목 글자가 넘치지 않고 팝오버가 화면 안이다
    const box = (await menu.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    const wide = await menu.evaluate((el) => [...el.querySelectorAll('[role="menuitem"]')].filter((m) => m.scrollWidth > m.clientWidth + 1).length)
    expect(wide, '항목 글자 넘침').toBe(0)

    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    await waitComplete(page)
    for (const [stat, sp] of Object.entries(high) as [StatLabel, number][]) await expect(spBox(page, stat)).toHaveValue(String(sp))
    expect(await badgeLabel(card)).toBe(badge)
  })
})

test.describe('키보드·좁은 화면(R26)', () => {
  test('Enter로 열고 ↑↓·Home/End로 옮기고, Enter로 2단, ←로 1단(고른 결과에 포커스), Esc로 닫으면 변동 버튼에 포커스, Tab은 닫는다', async ({ page }) => {
    // 결과가 둘 이상인 카드
    const n = await adjustable(page).count()
    let card: Locator | undefined
    for (let i = 0; i < n && card === undefined; i++) {
      const c = adjustable(page).nth(i)
      if ((await resultItems(await openAdjust(c))).length > 1) card = await groupCard(page, c)
      await closeMenu(page, c)
    }
    expect(card, '결과가 둘 이상인 카드').toBeDefined()
    const button = adjustButton(card!)
    const menu = adjustMenu(card!)
    const results = menu.getByTestId('adjust-result')
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(menu).toHaveAttribute('role', 'menu')
    await expect(results.first()).toBeFocused()
    const count = await results.count()
    await page.keyboard.press('ArrowDown')
    await expect(results.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(results.first()).toBeFocused()
    await page.keyboard.press('End')
    await expect(results.nth(count - 1)).toBeFocused()
    await page.keyboard.press('Home')
    await expect(results.first()).toBeFocused()
    // 둘째 결과를 Enter로 고르면 2단, 첫 고를 수 있는 선택지에 포커스
    await page.keyboard.press('ArrowDown')
    const chosen = await results.nth(1).getAttribute('data-label')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveAttribute('data-stage', 'nature')
    await expect(menu.locator('[data-testid="adjust-nature"][data-enabled="true"]').first()).toBeFocused()
    // ← = 뒤로: 1단, 고른 결과에 포커스
    await page.keyboard.press('ArrowLeft')
    await expect(menu).toHaveAttribute('data-stage', 'result')
    await expect(menu.locator(`[data-testid="adjust-result"][data-label="${chosen}"]`)).toBeFocused()
    // Esc = 닫고 변동 버튼으로
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toBeFocused()
    // Space로도 열리고, Tab은 닫는다
    await page.keyboard.press('Space')
    await expect(results.first()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(menu).toHaveCount(0)
    // 바깥 누름도 닫는다
    await button.click()
    await expect(menu).toBeVisible()
    await page.getByTestId('progress').click()
    await expect(menu).toHaveCount(0)
  })

  test('키보드만으로 결과·성격을 골라 적용한다(Enter → Enter), 적용 뒤 변동 버튼에 포커스', async ({ page }) => {
    const card = await groupCard(page, adjustable(page).first())
    const button = adjustButton(card)
    await button.focus()
    await page.keyboard.press('Enter')
    const items = await resultItems(adjustMenu(card))
    const target = items.find((it) => !it.current) ?? items[0]
    const at = items.indexOf(target)
    for (let i = 0; i < at; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    const natures = await natureItems(adjustMenu(card))
    const option = natures.find((x) => x.enabled)!
    await page.keyboard.press('Enter')
    await expect(adjustMenu(card)).toHaveCount(0)
    await waitComplete(page)
    await expect(spBox(page, '공격')).toHaveValue(String(parseSps(option.sps).공격))
    expect(await badgeLabel(card)).toBe(target.badge)
    await expect(button).toBeFocused()
  })

  test('@layout 팝오버 1단·2단이 화면·목록 스크롤 박스에 잘리지 않고 페이지 가로 스크롤이 없다', async ({ page }) => {
    for (const tab of ['공격', '방어'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      // 목록 위쪽 카드(아래로 연다)와 스크롤 박스 맨 아래 카드(위로 연다)
      const all = adjustable(page)
      for (const card of [all.first(), all.last()]) {
        const fixed = await groupCard(page, card)
        await adjustButton(fixed).scrollIntoViewIfNeeded()
        const menu = await openAdjust(fixed)
        const items = await resultItems(menu)
        for (const stage of ['result', 'nature'] as const) {
          if (stage === 'nature') await adjustResult(fixed, items[0].badge).click()
          await expect(menu).toHaveAttribute('data-stage', stage)
          const clip = await menu.evaluate((el) => {
            const r = el.getBoundingClientRect()
            let { left, top, right, bottom } = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
            for (let p = el.parentElement; p; p = p.parentElement) {
              const cs = getComputedStyle(p)
              if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
              const c = p.getBoundingClientRect()
              left = Math.max(left, c.left)
              top = Math.max(top, c.top)
              right = Math.min(right, c.right)
              bottom = Math.min(bottom, c.bottom)
            }
            const wide = [...el.querySelectorAll('[role="menuitem"]')].filter((m) => m.scrollWidth > m.clientWidth + 1).length
            return { inside: r.left >= left - 0.5 && r.right <= right + 0.5 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5, rect: [r.left, r.top, r.right, r.bottom], box: [left, top, right, bottom], wide }
          })
          expect(clip.inside, `${tab} ${stage} ${JSON.stringify(clip)}`).toBe(true)
          expect(clip.wide, `${tab} ${stage} 항목 글자 넘침`).toBe(0)
          expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
        }
        await closeMenu(page, fixed)
      }
    }
  })

  test('@layout 쌍 고정 중 세 성격(H·B·D·고정 표지) 2단도 왼쪽 화면 여백 밖으로 나가지 않는다', async ({ page }) => {
    await lockRow(page, '방어', 'floettemega', 'dazzlinggleam')
    const card = cards(page).and(page.locator('[data-opponent="garchomp"][data-move="dragonclaw"]:not([data-power-item])'))
    await adjustButton(card).scrollIntoViewIfNeeded()
    const menu = await openAdjust(card)
    await resultItems(menu)
    await adjustResult(card, '확정견딤').click()
    await expect(card.getByTestId('adjust-nature')).toHaveCount(3)
    const box = (await menu.boundingBox())!
    const scroll = (await card.locator('xpath=ancestor::*[contains(@class, "result-scroll")]').boundingBox())!
    expect(box.x, JSON.stringify({ box, scroll })).toBeGreaterThanOrEqual(Math.max(0, scroll.x) - 0.5)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    for (const el of [menu.getByTestId('adjust-back'), ...(await card.locator('.adjust-nature-name').all())]) {
      const r = (await el.boundingBox())!
      expect(r.x).toBeGreaterThanOrEqual(box.x - 0.5)
      expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
    }
    const wide = await menu.evaluate((el) => [...el.querySelectorAll('[role="menuitem"]')].filter((m) => m.scrollWidth > m.clientWidth + 1).length)
    expect(wide, '항목 글자 넘침').toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  })
})
