import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { cards, combo, mySet, openProduct, region, resultTab, selectTab, tabPanel, waitComplete } from './helpers'

/** 5단 판정 단계명(결과 배지·상세 공용) */
const TIER = '(확정1타|고난수1타|중난수1타|저난수1타|확정견딤)'
const NEED = '( \\(다른 능력치에서 \\d+ 필요\\))?'
/** 상세 목표 "<판정>: 최소 A32 / A15+"(무보정 / 상승), 한쪽 불가면 "무보정 불가"·"상승 불가". sps는 SP 묶음 패턴, label은 판정 이름 패턴(스피드는 행동 순서). */
// 두 선택지가 모두 불가인 문구는 계약(TargetView: 하나 이상 non-null) 밖이라 앞쪽 부정 전방탐색으로 막는다.
const targetPattern = (sps: string, label = TIER): string => `${label}: (?!무보정 불가 / 상승 불가)(최소 ${sps}${NEED}|무보정 불가) / (${sps}\\+${NEED}|상승 불가)`

const toolbarSpin = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true })
const customPanel = (page: Page) => region(page, '목록 밖 포켓몬 추가')
// 래더 상대 행. 방어 탭 화력 도구 행(PRD R14)만 뺀다(공격 탭 반감열매 행은 이전처럼 포함)
const ladderCards = (page: Page) => cards(page).and(page.locator('[data-origin="ladder"]:not([data-power-item])'))
const customCards = (page: Page) => cards(page).and(page.locator('[data-origin="custom"]'))
const cardLine = (card: Locator) => card.locator('button[aria-expanded]').first()
const bundleButton = (card: Locator) => card.locator('button.bundle-btn')
const bundleMenu = (card: Locator) => card.getByRole('menu', { name: '노력치 배분', exact: true })

/** 행의 배분 메뉴를 열어 항목 정보(카드 id·분류·문구)를 읽고 Escape로 닫는다. 선택지가 하나면 그 행 카드 하나. */
async function bundleOptions(card: Locator): Promise<{ id: string; category: string; text: string }[]> {
  if ((await bundleButton(card).count()) === 0) {
    const el = card.first()
    return [{ id: (await el.getAttribute('data-card-id')) ?? '', category: (await el.getAttribute('data-category')) ?? '', text: (await el.getByTestId('card-bundle').textContent()) ?? '' }]
  }
  await bundleButton(card).click()
  const items = bundleMenu(card).getByRole('menuitemradio')
  await expect(items.first()).toBeVisible()
  const out = await items.evaluateAll((els) =>
    els.map((e) => ({ id: (e as HTMLElement).dataset.cardId ?? '', category: (e as HTMLElement).dataset.category ?? '', text: e.querySelector('.bundle-opt-label')?.textContent ?? '' })),
  )
  await bundleMenu(card).press('Escape')
  await expect(bundleMenu(card)).toHaveCount(0)
  return out
}

/** 행의 배분 메뉴에서 text에 맞는 첫 배분을 고른다(이미 그 배분이거나 선택지가 하나면 확인만). */
async function chooseBundle(card: Locator, text: RegExp) {
  if ((await bundleButton(card).count()) > 0 && !text.test((await card.getByTestId('card-bundle').textContent()) ?? '')) {
    await bundleButton(card).click()
    await bundleMenu(card).getByRole('menuitemradio').filter({ has: card.page().locator('.bundle-opt-label', { hasText: text }) }).first().click()
  }
  await expect(card.getByTestId('card-bundle')).toHaveText(text)
}

/** 커밋된 메타 인덱스(기본 레귤레이션 m-c) 항목 */
interface IndexItem { match: 'bo1' | 'bo3'; month: string; format: string; url: string; battles: number }
const metaIndexItems = (): IndexItem[] =>
  (JSON.parse(readFileSync(new URL('../src/data/meta/index.json', import.meta.url), 'utf8')) as { regulations: Record<string, IndexItem[]> }).regulations['m-c']

/** 래더 카드의 사용률 순위 목록(화면에는 보이지 않고 카드 data-rank로만 싣는다). */
async function ladderRanks(page: Page): Promise<{ opponent: string; rank: number }[]> {
  return ladderCards(page).evaluateAll((els) =>
    els.map((el) => ({ opponent: (el as HTMLElement).dataset.opponent ?? '', rank: Number((el as HTMLElement).dataset.rank) })),
  )
}

/** 목록 밖 타겟 추가 패널에서 종·기술을 고르고 [추가]. */
async function addCustomTarget(page: Page, species: string, moves: string[]) {
  await page.getByRole('button', { name: '포켓몬 추가', exact: true }).click()
  const panel = customPanel(page)
  await expect(panel).toBeVisible()
  await combo(panel, '추가할 포켓몬').fill(species)
  await combo(panel, '추가할 포켓몬').press('Enter')
  const group = panel.getByRole('group', { name: /^기술/ })
  for (const m of moves) {
    await combo(group, '기술 검색').fill(m)
    await group.getByRole('checkbox', { name: m, exact: true }).check()
  }
  await panel.getByRole('button', { name: '추가', exact: true }).click()
  await expect(panel).toHaveCount(0)
}

test.describe('제품 화면', () => {
  test('처음 열면 예시 세트와 세 탭, 하단 라이선스 고지, /#/dev는 개발 화면(AC1)', async ({ page }) => {
    await openProduct(page)
    const me = mySet(page)
    await expect(combo(me, '종')).toHaveValue('한카리아스')
    await expect(combo(me, '도구')).toHaveValue('생명의구슬')
    await expect(combo(me, '기술 1')).toHaveValue('지진')
    await expect(me.getByRole('slider', { name: 'SP 공격', exact: true })).toHaveValue('32')
    await expect(me.getByTestId('sp-remaining')).toHaveText('0')
    const tabs = page.getByRole('tablist', { name: '결과 탭' }).getByRole('tab')
    await expect(tabs).toHaveText(['공격', '방어', '스피드'])
    await expect(resultTab(page, '공격')).toHaveAttribute('aria-selected', 'true')
    await expect(cards(page).first()).toBeVisible()
    await expect(page.locator('footer').getByTestId('licenses')).toContainText('Smogon University')
    await expect(page.locator('footer').getByTestId('licenses')).toContainText('@smogon/calc')
    // 라이선스 고지는 footer 하나 안에 있다(footer 중첩 없음).
    await expect(page.locator('footer')).toHaveCount(1)

    await page.goto('/#/dev')
    await expect(region(page, '공격측').locator('table.stats')).toBeVisible()
    await expect(page.locator('footer')).toHaveCount(1)
    await expect(page.locator('footer')).toContainText('@smogon/calc')
    await expect(page.locator('main[data-app="product"]')).toHaveCount(0)
  })

  test('카드 상세 행은 보이는 항목 하나의 행만(공격 1행, 방어 H행·B/D행 쌍 = 합계 판정 1개 또는 고정 1행): 모든 행이 같은 기술·같은 조건, 랭크·선공기 행은 따로 없다(PRD R7·AC15)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    for (const tab of ['공격', '방어'] as const) {
      if (tab !== '공격') {
        await selectTab(page, tab)
        await waitComplete(page)
      }
      const all = await cards(page).all()
      expect(all.length, tab).toBeGreaterThan(3)
      for (const card of all) {
        await cardLine(card).click()
        await expect(card.locator('.card-detail')).toBeVisible()
      }
      const byCard = await cards(page).evaluateAll((els) =>
        els.map((el) => ({
          id: (el as HTMLElement).dataset.cardId ?? '',
          rows: [...el.querySelectorAll<HTMLElement>('[data-testid="row"]')].map((r) => ({ move: r.dataset.move ?? '', condition: r.dataset.condition ?? '', pair: r.dataset.pair === 'true' })),
        })),
      )
      for (const c of byCard) {
        expect(c.rows.length, c.id).toBeGreaterThan(0)
        // 방어 탭 H 행·B/D 행 쌍은 상세에서 내구 합계 판정 하나로 보인다(R10)
        expect(c.rows.length, c.id).toBe(1)
        expect(new Set(c.rows.map((r) => JSON.stringify([r.move, r.condition]))).size, c.id).toBe(1)
      }
      if (tab === '방어') expect(byCard.some((c) => c.rows[0].pair)).toBe(true)
      await expect(page.getByTestId('card-more')).toHaveCount(0)
    }
  })
  test('상위 N 래더 상대는 판정 변화와 무관하게 탭마다 전부 한 행, 변동 가능 태그는 변화 있는 행에만, 기술 라벨은 모든 행(사용자 피드백 2026-11-12)', async ({ page }) => {
    await openProduct(page)
    const topN = Number(await toolbarSpin(page, '상위 N').inputValue())
    expect(topN).toBe(30)
    for (const tab of ['공격', '방어', '스피드'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      // 예시 세트는 모든 상위 30마리에 계산할 기술이 있다(계산 대상 = 상위 N).
      const ranks = await ladderRanks(page)
      expect(ranks.map((r) => r.rank).sort((a, b) => a - b), tab).toEqual(Array.from({ length: topN }, (_, i) => i + 1))
      const lines = await ladderCards(page).evaluateAll((els) =>
        els.map((el) => ({
          variable: (el as HTMLElement).dataset.variable,
          headline: (el as HTMLElement).dataset.headline,
          tag: el.querySelector('.card-line [data-testid="variable-tag"]')?.textContent ?? null,
          label: el.querySelector('.card-line [data-testid="move-label"]') !== null,
        })),
      )
      expect(lines.filter((l) => l.variable === 'true').length, tab).toBeGreaterThan(0)
      expect(lines.filter((l) => l.variable === 'false').length, tab).toBeGreaterThan(0)
      for (const l of lines) {
        expect(l.headline, tab).toBe('row')
        expect(l.tag, tab).toBe(l.variable === 'true' ? '변동 가능' : null)
        expect(l.label, tab).toBe(true)
      }
      // 변동 가능 행은 상세 대표 행 판정 줄에도 표시(변화 없음 행에는 없다)
      const v = ladderCards(page).and(page.locator('[data-variable="true"]')).first()
      await cardLine(v).click()
      await expect(v.locator('[data-testid="row"][data-variable="true"] [data-testid="row-variable"]').first()).toHaveText('변동 가능')
      await expect(v.locator('[data-testid="row"][data-variable="false"] [data-testid="row-variable"]')).toHaveCount(0)
      await cardLine(v).click()
      const fixed = ladderCards(page).and(page.locator('[data-variable="false"]')).first()
      await cardLine(fixed).click()
      await expect(fixed.locator('[data-testid="row"]').first()).toBeVisible()
      await expect(fixed.getByTestId('row-variable')).toHaveCount(0)
      await cardLine(fixed).click()
    }
  })

  test('기술 배지 메뉴: 대도각참 기본 +2 도각참, 기습도 항목(표지 없음), 직접 고름·되돌리기, 배지를 눌러도 카드는 펼쳐지지 않는다(PRD R1·R5·AC10·AC11)', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    const card = ladderCards(page).and(page.locator('[data-opponent="kingambit"]'))
    await expect(card).toHaveCount(1)
    const pick = card.getByTestId('move-pick')
    await expect(pick).toHaveAccessibleName(/기술 선택/)
    await pick.click()
    await expect(cardLine(card)).toHaveAttribute('aria-expanded', 'false')
    const menu = card.getByTestId('move-menu')
    await expect(menu).toBeVisible()
    const sd = JSON.stringify(['rank', 'opponent', 'move', 'swordsdance'])
    await expect(menu.locator(`[role="menuitemradio"][aria-checked="true"]`)).toHaveAttribute('data-item-key', JSON.stringify(['kowtowcleave', sd]))
    // 선공기도 목록 항목이다. 기본·선공·분산·직접 표지는 없다(사용자 피드백 2026-11-13: 거추장스러움)
    await expect(menu.locator('[data-move="suckerpunch"]').first()).toBeVisible()
    await expect(menu.locator('.priority-tag, .spread-tag, .default-tag, .chosen-tag')).toHaveCount(0)
    // 펼침 화살표는 기술 칩 테두리 안에 있다
    await expect(pick.getByTestId('move-label').locator('.bundle-caret')).toHaveCount(1)
    // 키보드: ↓ 이동, Esc 닫힘
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(pick).toBeFocused()
    // 칼춤 전 도각참을 직접 고른다
    await pick.click()
    await menu.getByRole('menuitemradio', { name: /^악 타입 도각참/ }).click()
    const chosen = card.getByTestId('move-pick')
    await expect(chosen).toHaveAttribute('data-selected', 'true')
    await expect(chosen).toHaveAccessibleName(/직접 고름/)
    await expect(chosen.locator('.chosen-tag')).toHaveCount(0)
    await expect(cardLine(card)).toHaveAttribute('aria-expanded', 'false')
    // SP를 바꿔도 유지된다
    const gen = async () => Number(await tabPanel(page).getAttribute('data-generation'))
    const before = await gen()
    await page.getByLabel('SP HP', { exact: true }).fill('0')
    await page.getByLabel('SP HP', { exact: true }).blur()
    await expect.poll(gen).toBeGreaterThan(before)
    await waitComplete(page)
    await expect(card.getByTestId('move-pick')).toHaveAttribute('data-selected', 'true')
    // 되돌리기
    await card.getByTestId('move-pick').click()
    await card.getByTestId('move-reset').click()
    await expect(card.getByTestId('move-pick')).not.toHaveAttribute('data-selected', 'true')
  })

  test('방어 탭 기술 추가: 배우는 공격기만 검색 → 추가·선택·판정 행, × 삭제, 내 포켓몬을 바꿔도 남는다(PRD R8·AC26)', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    // 예시 세트(한카리아스, 드래곤/땅)에 바위는 반감이라 포푸니크 암석봉인(6.6%)은 기본 후보가 아니다
    const card = ladderCards(page).and(page.locator('[data-opponent="sneasler"]')).first()
    const pick = card.getByTestId('move-pick')
    const menu = card.getByTestId('move-menu')
    await pick.click()
    await expect(menu.locator('[data-move="rocktomb"]')).toHaveCount(0)
    await expect(menu.locator('[data-move="closecombat"]').first()).toBeVisible()
    await expect(card.getByTestId('move-remove')).toHaveCount(0)
    const search = combo(menu, '기술 추가')
    const options = menu.getByRole('listbox', { name: '기술 추가 후보' }).getByRole('option')
    // 배우지 않는 기술·변화기·이미 있는 기술은 후보에 없다
    for (const text of ['10만볼트', '칼춤', '인파이트']) {
      await search.fill(text)
      await expect(options.filter({ hasText: new RegExp(`^${text}$`) })).toHaveCount(0)
    }
    await search.fill('암석')
    await expect(options.filter({ hasText: /^암석봉인$/ })).toHaveCount(1)
    const gen = async () => Number(await tabPanel(page).getAttribute('data-generation'))
    const before = await gen()
    await options.filter({ hasText: /^암석봉인$/ }).click()
    await expect(menu).toHaveCount(0)
    await expect.poll(gen).toBeGreaterThan(before)
    await waitComplete(page)
    // 추가한 기술이 직접 선택되고 판정 행이 그 기술 기준이다
    await expect(pick).toBeFocused()
    await expect(pick).toHaveAttribute('data-selected', 'true')
    await expect(pick).toHaveAccessibleName(/암석봉인 기술 선택 \(직접 고름\)/)
    await expect(cardLine(card)).toHaveAttribute('aria-expanded', 'false')
    await cardLine(card).click()
    await expect(card.getByTestId('row').first()).toHaveAttribute('data-move', 'rocktomb')
    await expect(card.getByTestId('row').first()).toBeVisible()
    await cardLine(card).click()

    // 내 포켓몬을 대도각참(악/강철, 바위 반감)으로 바꾸면 직접 선택은 풀리지만 추가한 기술은 남는다
    const species = combo(mySet(page), '종')
    await species.fill('대도각참')
    await species.press('Enter')
    await expect(species).toHaveValue('대도각참')
    await waitComplete(page)
    await expect(pick).not.toHaveAttribute('data-selected', 'true')
    await pick.click()
    const added = menu.locator('[data-move="rocktomb"]')
    await expect(added.first()).toBeVisible()
    const remove = card.getByRole('menuitem', { name: '추가한 기술 삭제: 암석봉인' })
    await expect(remove.first()).toBeVisible()

    // 키보드: → 로 ×, ← 로 그 항목
    await added.first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(remove.first()).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(added.first()).toBeFocused()

    // 고른 뒤 × 로 지우면 목록에서 빠지고 기본값으로 돌아간다
    await added.first().click()
    await waitComplete(page)
    await expect(pick).toHaveAttribute('data-selected', 'true')
    await pick.click()
    const mid = await gen()
    await remove.first().click()
    await expect(menu).toHaveCount(0)
    await expect.poll(gen).toBeGreaterThan(mid)
    await waitComplete(page)
    await expect(pick).not.toHaveAttribute('data-selected', 'true')
    await pick.click()
    await expect(menu.locator('[data-move="rocktomb"]')).toHaveCount(0)
    await expect(card.getByTestId('move-remove')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // 공격 탭·목록 밖 타겟에는 검색 칸이 없다
    await selectTab(page, '공격')
    await waitComplete(page)
    await ladderCards(page).first().getByTestId('move-pick').click()
    await expect(ladderCards(page).first().getByTestId('move-menu')).toBeVisible()
    await expect(tabPanel(page).getByTestId('move-add')).toHaveCount(0)
  })

  test('기술 추가 검색 칸·× 는 400px·1280px에서 메뉴·화면 안에 들고 가로 넘침이 없다(PRD R8)', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    const card = ladderCards(page).and(page.locator('[data-opponent="sneasler"]')).first()
    const pick = card.getByTestId('move-pick')
    const menu = card.getByTestId('move-menu')
    await pick.click()
    const search = combo(menu, '기술 추가')
    await search.fill('암석')
    await menu.getByRole('option', { name: '암석봉인', exact: true }).click()
    await waitComplete(page)
    for (const width of [1280, 400]) {
      await page.setViewportSize({ width, height: 900 })
      await pick.click()
      await combo(menu, '기술 추가').fill('스')
      const box = await menu.evaluate((m) => {
        const r = m.getBoundingClientRect()
        const inside = (e: Element | null) => {
          const b = e?.getBoundingClientRect()
          return b !== undefined && b.left >= r.left - 0.5 && b.right <= r.right + 0.5
        }
        return {
          left: r.left,
          right: r.right,
          hScroll: m.scrollWidth - m.clientWidth,
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          parts: [m.querySelector('[data-testid="move-add"] input'), m.querySelector('[role="listbox"]'), m.querySelector('[data-testid="move-remove"]')].map(inside),
        }
      })
      expect(box.hScroll, `${width}`).toBeLessThanOrEqual(0)
      expect(box.page, `${width}`).toBeLessThanOrEqual(0)
      expect(box.parts, `${width}`).toEqual([true, true, true])
      expect([box.left >= 0, box.right <= width], `${width}`).toEqual([true, true])
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
    }
  })

  test('방어 탭 목록 기준 화면: 내 세트가 1배 이상이면 포푸니크 목록에 지옥찌르기·암석봉인(PRD AC25)', async ({ page }) => {
    await openProduct(page)
    // 고릴타(풀)는 악·바위 모두 1배다(예시 세트 한카리아스는 바위 반감이라 암석봉인이 빠진다)
    const species = combo(mySet(page), '종')
    await species.fill('고릴타')
    await species.press('Enter')
    await expect(species).toHaveValue('고릴타')
    await selectTab(page, '방어')
    await waitComplete(page)
    const card = ladderCards(page).and(page.locator('[data-opponent="sneasler"]')).first()
    await card.getByTestId('move-pick').click()
    const menu = card.getByTestId('move-menu')
    await expect(menu.locator('[data-move="throatchop"]').first()).toBeVisible()
    await expect(menu.locator('[data-move="rocktomb"]').first()).toBeVisible()
    // 5% 미만(더스트슈트 3.8%)은 없다
    await expect(menu.locator('[data-move="gunkshot"]')).toHaveCount(0)
  })
  test('펼친 상세: 공격 탭 행 0~32 띠·현재값(빗금 없음), 방어 탭 내구 합계 띠 0~64 하나(AC19·AC27~AC30)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 목표 문구는 간단행에 없고(사용자 피드백 2026-11-11) 펼친 상세 행에만 있다.
    await expect(tabPanel(page).getByTestId('headline-target')).toHaveCount(0)
    const withRow = cards(page).and(page.locator('[data-variable="true"]')).first()
    await cardLine(withRow).click()
    // AC27: 상세에 배분 목록·직접 추가 폼·기술 선택 버튼이 없다(간단행 배지에서만 고른다)
    const detail = withRow.locator('.card-detail')
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId('bundle-list')).toHaveCount(0)
    await expect(detail.getByTestId('bundle-add')).toHaveCount(0)
    await expect(detail.getByTestId('detail-move-pick')).toHaveCount(0)
    await expect(detail.getByRole('button')).toHaveCount(0)
    await expect(withRow.getByTestId('row-target').first()).toHaveText(new RegExp(`^ · ${targetPattern('A\\d+')}$`))
    const row = withRow.getByTestId('row').filter({ has: page.getByTestId('band-cell') }).first()
    // AC28: 제목은 기술 라벨뿐(행 종류 배지·근거·능력치 접두 없음)
    await expect(row.locator('.row-head .row-title [data-testid="move-label"]')).toHaveCount(1)
    await expect(row.locator('.row-kind, .row-basis')).toHaveCount(0)
    await expect(row.locator('.row-head')).not.toContainText(' · ')
    const cells = row.getByTestId('band-cell')
    await expect(cells).toHaveCount(33)
    await expect(row.locator('[aria-current="true"]')).toHaveCount(1)
    // AC29: 빗금 칸·빗금 범례·"다른 능력치에서" 없음
    await expect(row.locator('.cell.over, .over-key, [data-over-budget]')).toHaveCount(0)
    await expect(detail).not.toContainText('다른 능력치에서')
    await expect(detail).not.toContainText('빗금')
    // 띠는 색 칸만(칸 안 숫자·기호 없음), 스크롤 상자 없이 한 줄. 아래 0·16·32 눈금.
    await expect(row.locator('.band')).toHaveCount(1)
    await expect(row.locator('.band-scroll')).toHaveCount(0)
    expect(await cells.evaluateAll((els) => els.map((e) => e.textContent).join(''))).toBe('')
    await expect(row.locator('.band-ticks')).toHaveText('01632')
    // 칸 title = 그 칸 SP와 판정(칸 순서 = SP 0~32, title SP = data-sp)
    const titles = await cells.evaluateAll((els) => els.map((e) => [Number((e as HTMLElement).dataset.sp), e.getAttribute('title') ?? '', (e as HTMLElement).dataset.category ?? '']))
    expect(titles.map(([sp]) => sp)).toEqual(Array.from({ length: 33 }, (_, i) => i))
    for (const [sp, title] of titles) expect(title).toMatch(new RegExp(`^SP ${sp}: ${TIER}$`))
    // 같은 판정 칸은 같은 title 판정, 범례 범위와 칸 판정이 맞는다.
    const spans = await row.locator('.band-legend .span').allTextContents()
    for (const text of spans) {
      const m = /^\s*(\d+)(?:~(\d+))? (.+)$/.exec(text)!
      const from = Number(m[1])
      const to = m[2] === undefined ? from : Number(m[2])
      const labels = new Set(titles.filter(([sp]) => (sp as number) >= from && (sp as number) <= to).map(([, t]) => (t as string).replace(/^SP \d+: /, '')))
      expect(labels.size, text).toBe(1)
    }
    // 판정은 색만이 아니라 텍스트 라벨로도 보인다(AC19). 현재 판정은 목표 문구와 같은 5단 단계명.
    await expect(row.locator('.row-judge')).toHaveText(new RegExp(`현재 A\\d+ ${TIER} 변동 가능 · `))
    // 띠 칸 색은 결과 배지와 같은 5색(판정 → 색 한 가지 대응, 다른 판정은 다른 색).
    const tones = await cells.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.category, [...e.classList].find((c) => c.startsWith('ko-'))]))
    const toneOf = new Map(tones.map(([c, t]) => [c, t]))
    expect(toneOf.size).toBe(new Set(tones.map(([c, t]) => `${c}|${t}`)).size)
    expect([...toneOf.values()].every((t) => t !== undefined)).toBe(true)
    expect(new Set(toneOf.values()).size).toBe(toneOf.size)

    // 방어 탭(AC30): 변동 카드 상세 = 내구 합계 띠 하나(0~64, 65칸), 현재 합계 칸, 현재 문구, 범례 "최소 H… B…"
    await selectTab(page, '방어')
    await waitComplete(page)
    for (const width of [1280, 400]) {
      await page.setViewportSize({ width, height: 900 })
      const card = cards(page).and(page.locator('[data-variable="true"]')).first()
      if ((await cardLine(card).getAttribute('aria-expanded')) !== 'true') await cardLine(card).click()
      const d = card.locator('.card-detail')
      await expect(d.getByTestId('bundle-list')).toHaveCount(0)
      await expect(d.getByTestId('detail-move-pick')).toHaveCount(0)
      await expect(d.getByTestId('row')).toHaveCount(1)
      const pair = d.getByTestId('row')
      await expect(pair).toHaveAttribute('data-pair', 'true')
      await expect(pair.locator('.row-head')).not.toContainText(/H · |랭크|기본|%/)
      await expect(d.locator('.band')).toHaveCount(1)
      const sum = d.getByTestId('sum-band').getByTestId('band-cell')
      await expect(sum).toHaveCount(65)
      await expect(d.getByTestId('sum-band').locator('ol.band')).toHaveAttribute('aria-label', /^H\+[BD] 합계 0~64 판정$/)
      expect(await sum.evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.sp)))).toEqual(Array.from({ length: 65 }, (_, i) => i))
      await expect(d.locator('.band-ticks')).toHaveText('03264')
      const current = d.getByTestId('sum-current')
      await expect(current).toHaveText(new RegExp(`^. 현재 H(\\d+) [BD](\\d+)\\+? \\(합 (\\d+)\\) · ${TIER}( · 같은 합 최적 H\\d+ [BD]\\d+\\+? ${TIER})? 변동 가능$`))
      const [, h, b, s] = /현재 H(\d+) [BD](\d+)\+? \(합 (\d+)\)/.exec((await current.textContent()) ?? '')!
      expect(Number(s)).toBe(Number(h) + Number(b))
      await expect(d.getByTestId('sum-band').locator('[aria-current="true"]')).toHaveAttribute('data-sp', s)
      // 범례: 구간이 0부터 64까지 빈틈없이 이어지고, 구간 칸 판정과 맞으며, 0이 아닌 구간은 최소 분배를 보인다
      const legend = await d.getByTestId('sum-legend').locator('.span').allTextContents()
      expect(legend.length).toBeGreaterThan(1)
      const cats = await sum.evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''))
      let next = 0
      for (const text of legend) {
        const m = new RegExp(`^\\s*(\\d+)(?:~(\\d+))? ${TIER}( → 최소 H\\d+ [BD]\\d+\\+? / (H\\d+ [BD]\\d+\\+|무보정 H\\d+ [BD]\\d+|상승 불가|무보정 불가))?$`).exec(text)
        expect(m, text).not.toBeNull()
        const from = Number(m![1])
        const to = m![2] === undefined ? from : Number(m![2])
        expect(from).toBe(next)
        if (from > 0) expect(m![4], text).toBeDefined()
        for (let t = from; t <= to; t++) expect(cats[t]).toBe(`합계 ${t}: ${m![3]}`)
        next = to + 1
      }
      expect(next).toBe(65)
      await expect(d).not.toContainText('다른 능력치에서')
      await expect(d.locator('.cell.over, .over-key')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    }
  })

  test('펼친 상세: 간단행 배분 배지로 배분을 바꾸면 펼친 채로 상세 판정이 그 배분 기준으로 바뀐다(AC27)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    for (const tab of ['공격', '방어'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      // 결과 배지 색(= 판정 단계)이 현재 배분과 다른 배분이 있는 첫 행
      const rows = cards(page).filter({ has: page.locator('button.bundle-btn') })
      const n = await rows.count()
      let found: { row: Locator; id: string; tone: string; before: string } | undefined
      for (let i = 0; i < n && found === undefined; i++) {
        const row = rows.nth(i)
        await bundleButton(row).click()
        const tones = await bundleMenu(row)
          .getByRole('menuitemradio')
          .evaluateAll((els) =>
            els.map((e) => ({
              id: (e as HTMLElement).dataset.cardId ?? '',
              checked: e.getAttribute('aria-checked') === 'true',
              tone: [...(e.querySelector('.ko-badge')?.classList ?? [])].find((c) => /^ko-(red|orange|yellow|lime|green)$/.test(c)) ?? '',
            })),
          )
        await bundleMenu(row).press('Escape')
        const cur = tones.find((t) => t.checked)
        const other = tones.find((t) => !t.checked && t.tone !== '' && cur !== undefined && t.tone !== cur.tone)
        if (cur !== undefined && other !== undefined) {
          const key = await row.getAttribute('data-group-key')
          found = { row: cards(page).and(page.locator(`[data-group-key='${key}']`)), id: other.id, tone: other.tone, before: cur.tone }
        }
      }
      expect(found, `${tab}: 판정 단계가 다른 배분이 있는 행`).toBeDefined()
      const { row, id, tone, before } = found!
      await cardLine(row).click()
      const detail = row.locator('.card-detail')
      // 상세 현재 판정 칩(판정 줄·고정 판정 줄) = 선택 배분의 결과 배지 단계
      const chip = detail.locator('.row-judge .tier-chip, .row-fixed .tier-chip').first()
      await expect(chip).toHaveClass(new RegExp(`\\b${before}\\b`))
      await bundleButton(row).click()
      await bundleMenu(row).locator(`[role="menuitemradio"][data-card-id='${id.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`).click()
      await expect(row).toHaveAttribute('data-card-id', id)
      await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'true')
      await expect(detail).toBeVisible()
      await expect(chip).toHaveClass(new RegExp(`\\b${tone}\\b`))
      await cardLine(row).click()
    }
  })

  test('상위 N 10 + 포켓몬 2마리 선택: 래더 카드는 그 집합만, 커스텀 카드는 유지(AC10)', async ({ page }) => {
    await openProduct(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    await waitComplete(page)
    const before = await ladderRanks(page)
    const outside = [...new Map(before.filter((c) => c.rank > 10).map((c) => [c.opponent, c])).values()].slice(0, 2)
    expect(outside.length).toBe(2)
    const outsideNames = await Promise.all(outside.map((o) => cards(page).and(page.locator(`[data-opponent="${o.opponent}"]`)).first().locator('.card-name').textContent()))

    await toolbarSpin(page, '상위 N').fill('10')
    await waitComplete(page)
    const top10 = await ladderRanks(page)
    expect(top10.length).toBeGreaterThan(0)
    expect(top10.every((c) => c.rank <= 10)).toBe(true)
    for (const name of outsideNames) {
      const pick = combo(page, '포켓몬 찾기')
      await pick.fill(name!)
      await page.getByRole('listbox', { name: '포켓몬 찾기 후보' }).getByRole('option', { name: name!, exact: true }).click()
    }
    await expect(page.getByRole('list', { name: '선택한 포켓몬' })).toContainText(outsideNames[0]!)
    await waitComplete(page)
    const after = await ladderRanks(page)
    const allowed = new Set(outside.map((o) => o.opponent))
    expect(after.length).toBeGreaterThan(0)
    expect(after.filter((c) => !allowed.has(c.opponent))).toEqual([])
    for (const o of outside) expect(after.some((c) => c.opponent === o.opponent)).toBe(true)
    await expect(customCards(page).first()).toBeVisible()
  })

  test('목록 밖 추가: 기술 0개면 [추가] 비활성·[취소]로 닫힘, 워시로토무 사용자 지정 카드·편집·마지막 기술 유지(AC11)', async ({ page }) => {
    await openProduct(page)
    const open = page.getByRole('button', { name: '포켓몬 추가', exact: true })
    await open.click()
    const panel = customPanel(page)
    const add = panel.getByRole('button', { name: '추가', exact: true })
    await expect(add).toBeDisabled()
    await combo(panel, '추가할 포켓몬').fill('워시로토무')
    await combo(panel, '추가할 포켓몬').press('Enter')
    await expect(panel.getByRole('group', { name: /^기술/ })).toBeVisible()
    await expect(add).toBeDisabled()
    await panel.getByRole('button', { name: '취소', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(open).toBeFocused()

    await addCustomTarget(page, '워시로토무', ['하이드로펌프', '폴터가이스트'])

    // 공격 탭: 내 기술은 전부 물리라 물리 분류 프리셋 3개가 한 행의 배분 선택지(프리셋 순).
    await waitComplete(page)
    await expect(customCards(page)).toHaveCount(1)
    const attackOptions = await bundleOptions(customCards(page))
    expect(attackOptions).toHaveLength(3)
    for (const [i, o] of attackOptions.entries()) {
      expect(o.text).toMatch(new RegExp(`프리셋 ${i + 1}$`))
      expect(o.category).toBe('physical')
    }
    await expect(customCards(page).first()).toContainText('출처: 사용자 지정')
    for (const text of await customCards(page).locator('.card-line').allTextContents()) expect(text).not.toMatch(/%/)

    // 방어 탭: 분류(특수 하이드로펌프·물리 폴터가이스트)마다 프리셋 3장이 모두 선택지이고, 하이드로펌프가 더 세서 처음 보이는 배분은 특수(PRD R7).
    await selectTab(page, '방어')
    await waitComplete(page)
    await expect(customCards(page)).toHaveCount(1)
    const defense = (await bundleOptions(customCards(page))).map((o) => o.category)
    expect(defense.filter((c) => c === 'special')).toHaveLength(3)
    expect(defense.filter((c) => c === 'physical')).toHaveLength(3)
    await expect(customCards(page)).toHaveAttribute('data-category', 'special')

    await selectTab(page, '스피드')
    await waitComplete(page)
    await expect(customCards(page)).toHaveCount(1)
    expect(await bundleOptions(customCards(page))).toHaveLength(3)

    // 스피드 탭 커스텀 카드: 프리셋 스피드 SP를 바꾸면 행동 순서 판정이 다시 계산된다.
    await selectTab(page, '스피드')
    await waitComplete(page)
    const card = customCards(page).first()
    const id = await card.getAttribute('data-card-id')
    const sameCard = cards(page).and(page.locator(`[data-card-id='${id}']`))
    await cardLine(sameCard).click()
    const spe = sameCard.getByRole('spinbutton', { name: '프리셋 SP 스피드', exact: true })
    const speBefore = await spe.inputValue()
    const judge = () => sameCard.getByTestId('row').locator('.row-judge, .row-fixed, .band-legend').allTextContents()
    const judgeBefore = await judge()
    await spe.fill(speBefore === '0' ? '32' : '0')
    await spe.blur()
    await waitComplete(page)
    await expect.poll(judge).not.toEqual(judgeBefore)

    // 타겟 기술: 지우다 보면 마지막 1개의 해제 컨트롤은 비활성.
    const targetMoves = sameCard.getByRole('group', { name: '타겟 기술', exact: true })
    await targetMoves.getByRole('button', { name: '폴터가이스트 해제', exact: true }).click()
    await waitComplete(page)
    const last = cards(page).and(page.locator(`[data-card-id='${id}']`)).getByRole('group', { name: '타겟 기술', exact: true })
    await expect(last.getByRole('button', { name: /해제$/ })).toHaveCount(1)
    await expect(last.getByRole('button', { name: '하이드로펌프 해제', exact: true })).toBeDisabled()

    // 타겟 기술은 모든 탭의 기술이다: 방어 탭에서 물리(폴터가이스트) 프리셋 카드가 사라진다.
    await selectTab(page, '방어')
    await waitComplete(page)
    const defenseAfter = (await bundleOptions(customCards(page))).map((o) => o.category)
    expect(defenseAfter.filter((c) => c === 'special')).toHaveLength(3)
    expect(defenseAfter.filter((c) => c === 'physical')).toHaveLength(0)
  })

  test('카드 묶음은 그 탭에 관련된 SP만 보이고(AC3), 랭크 후 항목 판정 행 제목은 기술 라벨 "+n 기술"뿐(AC28)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 공격 탭(내 기술 전부 물리): 상대 H·B만.
    for (const text of await ladderCards(page).locator('.card-bundle').allTextContents()) expect(text).toMatch(/^(H\d+[↑↓]?)?( ?B\d+[↑↓]?)? (\d+\.\d%|소수 배분)$/)

    // 방어 탭 상대 랭크 수단(칼춤 등) 항목의 판정 행: 열어 보며 첫 랭크 행을 찾는다. 근거 문구·종류 배지·점유율 없이 "+2 기술" 라벨만.
    await selectTab(page, '방어')
    await waitComplete(page)
    let title: Locator | null = null
    const n = await cards(page).count()
    for (let i = 0; i < n && title === null; i++) {
      const card = cards(page).nth(i)
      await cardLine(card).click()
      const rank = card.locator('[data-testid="row"][data-row-kind="rank"] .row-head')
      if ((await rank.count()) > 0) title = rank.first()
    }
    expect(title).not.toBeNull()
    await expect(title!.getByTestId('move-rank')).toHaveText(/^[+−]\d$/)
    await expect(title!.locator('.row-basis, .row-kind')).toHaveCount(0)
    await expect(title!).not.toContainText(/%|상대 |내 세트|H · /)

    await selectTab(page, '스피드')
    await waitComplete(page)
    for (const text of await ladderCards(page).locator('.card-bundle').allTextContents()) expect(text).toMatch(/^S\d+[↑↓]? (\d+\.\d%|소수 배분)$/)
  })

  test('세대 교체 중 이전 뷰는 data-superseded·"갱신 중"으로 표시된다(ADR 결정 3)', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __superseded: string[] }
      w.__superseded = []
      new MutationObserver(() => {
        const el = document.querySelector('[data-testid="tab-panel"][data-superseded="true"]')
        if (el) w.__superseded.push(el.querySelector('.updating-badge')?.textContent ?? '')
      }).observe(document, { subtree: true, childList: true, attributes: true })
    })
    await openProduct(page)
    await waitComplete(page)
    await mySet(page).getByRole('button', { name: 'SP 공격 1 내리기', exact: true }).click()
    await waitComplete(page)
    const seen = await page.evaluate(() => (window as unknown as { __superseded: string[] }).__superseded)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen).toContain('갱신 중')
  })

  test('처음 열면 통계 기준은 최근 월에서 판수가 더 많은 쪽(현재 데이터는 Bo1)이고 출처가 그 스냅샷이다(사용자 피드백 2026-11-11)', async ({ page }) => {
    const items = metaIndexItems()
    const month = items.map((it) => it.month).sort().at(-1)
    const inMonth = items.filter((it) => it.month === month)
    const bo1 = inMonth.find((it) => it.match === 'bo1')
    const bo3 = inMonth.find((it) => it.match === 'bo3')
    expect(bo1 && bo3 && bo1.battles > bo3.battles, '현재 데이터: 최근 월 Bo1 판수가 Bo3보다 많다').toBe(true)
    await openProduct(page)
    await waitComplete(page)
    await expect(combo(page, '형식')).toHaveValue('bo1')
    await expect(page.getByTestId('meta-source')).toHaveText(`통계 Bo1 · ${month} · 컷 1760 · ${bo1?.format}`)
  })

  test('Bo3로 바꾸면 그 스냅샷 출처로 바뀐다(AC13)', async ({ page }) => {
    await openProduct(page)
    const source = page.getByTestId('meta-source')
    await expect(source).toContainText('Bo1')
    await combo(page, '형식').selectOption('bo3')
    await expect(source).toContainText('Bo3')
    await waitComplete(page)
    await expect(cards(page).first()).toBeVisible()
  })

  test('메타 스냅샷 로드가 실패하면 선택을 되돌리고 오류를 알리며, 입력은 계속 반영된다', async ({ page }) => {
    let fail = true
    await page.route(/bo3[^/]*\.js(\?|$)/, (route) => (fail ? route.abort() : route.continue()))
    await openProduct(page)
    await waitComplete(page)
    const source = page.getByTestId('meta-source')
    const match = combo(page, '형식')
    await match.selectOption('bo3')
    await expect(page.getByRole('alert').filter({ hasText: '메타 통계를 불러오지 못했습니다' })).toBeVisible()
    await expect(match).toHaveValue('bo1')
    await expect(source).toContainText('Bo1')
    const before = Number(await tabPanel(page).getAttribute('data-generation'))
    await mySet(page).getByRole('button', { name: 'SP 공격 1 내리기', exact: true }).click()
    await waitComplete(page)
    expect(Number(await tabPanel(page).getAttribute('data-generation'))).toBeGreaterThan(before)

    fail = false
    await match.selectOption('bo3')
    await expect(source).toContainText('Bo3')
    await waitComplete(page)
    await expect(page.getByText('메타 통계를 불러오지 못했습니다')).toHaveCount(0)
  })

  test('간단행의 대표 행이 랭크 행이면 기술 라벨에 랭크를 합친다(대도각참 칼춤 → "+2 도각참")', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    // 랭크 행 대표면 근거는 기술 라벨 안의 랭크로 보이고, 별도 근거 태그는 스카프 행에만 남는다.
    await expect(tabPanel(page).getByTestId('headline-basis').and(page.locator('[data-row-kind="rank"]'))).toHaveCount(0)
    // 칼춤 조건에서 대도각참의 가장 센 기술은 도각참이다(아이언헤드는 더 약해 행 없음, 사용자 피드백 2026-11-11).
    const gambit = cards(page).filter({ hasText: '대도각참' }).getByTestId('move-label').filter({ hasText: '도각참' }).filter({ has: page.getByTestId('move-rank') })
    await expect(gambit.first()).toContainText('+2 도각참')
    await expect(gambit.first().getByTestId('move-rank')).toHaveText('+2')
    await expect(gambit.first()).toHaveAttribute('data-type', 'dark')
    await expect(gambit.first().locator('img[data-type-icon="dark"]')).toHaveCount(1)
    await expect(cards(page).filter({ hasText: '대도각참' }).getByTestId('move-label').filter({ hasText: '아이언헤드' })).toHaveCount(0)
    // 아이콘 → 랭크 → 기술명 → 펼침 화살표(칩 테두리 안 끝) 순서.
    const order = await gambit.first().evaluate((el) => [...el.children].map((c) => c.getAttribute('data-type-icon') ?? c.getAttribute('class')))
    expect(order.filter((c) => c !== 'sr-only')).toEqual(['dark', 'move-rank num', 'move-name', 'bundle-caret'])

    // 스카프·비스카프(도구) 행 대표 카드는 기술 라벨 앞에 도구 태그를 유지한다(결정 C: "구애스카프" 등).
    // 예시 세트 스피드 탭에는 비스카프 행 대표(생명의구슬)가 있다. 같은 분기라 태그가 사라지면 여기서 잡힌다.
    await selectTab(page, '스피드')
    await waitComplete(page)
    const tags = tabPanel(page).getByTestId('headline-basis')
    expect(await tags.count()).toBeGreaterThan(0)
    for (const el of await tags.all()) {
      const kind = await el.getAttribute('data-row-kind')
      expect(['scarf', 'non-scarf']).toContain(kind)
      const text = (await el.textContent()) ?? ''
      if (kind === 'scarf') expect(text).toBe('구애스카프')
      else expect(text).not.toMatch(/^(구애스카프)?$/)
      // 태그 → 기술 라벨 순서(같은 간단행 안에서 태그가 라벨보다 앞).
      const before = await el.evaluate((tag) => {
        const label = tag.parentElement?.querySelector('[data-testid="move-label"]')
        return label !== null && label !== undefined && (tag.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      })
      expect(before).toBe(true)
    }
    await expect(tabPanel(page).locator('[data-testid="headline-basis"][data-row-kind="rank"]')).toHaveCount(0)
  })

  test('간단행: 순위·사용률·보존·판정 기호·목표 문구 없음, 배분 라벨 + 비중, 타입 기술 라벨, 상세에 "최소 … / …+" 목표(사용자 피드백 2026-11-10·11-11)', async ({ page }) => {
    await openProduct(page)
    for (const [tab, target] of [
      ['공격', new RegExp(`^${targetPattern('A\\d+')}$`)],
      ['방어', new RegExp(`^${targetPattern('H\\d+ [BD]\\d+')}$`)],
      ['스피드', new RegExp(`^${targetPattern('S\\d+', '(선공|동속|후공)')}$`)],
    ] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      const lines = await ladderCards(page).locator('.card-line').allTextContents()
      expect(lines.length).toBeGreaterThan(0)
      for (const text of lines) {
        expect(text).not.toMatch(/#\d|\d+\.\d\d%|보존|[◎○△▽×]|까지 줄여도|부터 /)
      }
      for (const text of await ladderCards(page).getByTestId('card-bundle').allTextContents()) expect(text).toMatch(/^[HABCDS]\d+[↑↓]?( [HABCDS]\d+[↑↓]?)* (\d+\.\d%|소수 배분)$/)
      // 비중은 묶음보다 작은 회색(muted) 글씨.
      const look = await ladderCards(page).first().getByTestId('card-bundle').evaluate((el) => {
        const [stats, share] = [el.querySelector('.bundle-stats')!, el.querySelector('.bundle-share')!].map((e) => getComputedStyle(e))
        const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()
        return { smaller: parseFloat(share.fontSize) < parseFloat(stats.fontSize), differs: share.color !== stats.color, muted: muted !== '' }
      })
      expect(look).toEqual({ smaller: true, differs: true, muted: true })
      // 간단행에는 목표 문구가 없다(사용자 피드백 2026-11-11). 행 대표 카드의 상세 대표 행에 그대로 있다.
      await expect(tabPanel(page).getByTestId('headline-target')).toHaveCount(0)
      for (const text of lines) expect(text).not.toMatch(/최소 |무보정 불가/)
      const withLabel = ladderCards(page).filter({ has: page.getByTestId('move-label') })
      expect(await withLabel.count()).toBeGreaterThan(0)
      const first = withLabel.and(page.locator('[data-variable="true"]')).first()
      await cardLine(first).click()
      if (tab === '방어') {
        // 방어 탭은 목표 문구 대신 합계 띠 범례가 단계별 최소 분배를 보인다(R10)
        await expect(first.getByTestId('sum-legend')).toContainText(/최소 H\d+ [BD]\d+\+? \/ /)
        await expect(first.getByTestId('row-target')).toHaveCount(0)
      } else {
        const targets = await first.getByTestId('row-target').allTextContents()
        expect(targets.length).toBeGreaterThan(0)
        for (const t of targets) expect(t.replace(/^ · /, '')).toMatch(target)
      }
      await cardLine(first).click()
      if (tab !== '스피드') {
        const labels = tabPanel(page).getByTestId('move-label')
        await expect(labels.first()).toBeVisible()
        for (const el of await labels.all()) {
          const type = await el.getAttribute('data-type')
          expect(type).toMatch(/^[a-z]+$/)
          await expect(el.locator(`img[data-type-icon="${type}"]`)).toHaveCount(1)
        }
      }
    }
  })

  test('성격은 능력치 줄의 +/− 토글: +·− 각각 한 줄만, −는 고르지 않으면 자동', async ({ page }) => {
    await openProduct(page)
    const me = mySet(page)
    await expect(me.getByRole('combobox', { name: /성격/ })).toHaveCount(0)
    const plus = (stat: string) => me.getByRole('button', { name: `${stat} 성격 상승`, exact: true })
    const minus = (stat: string) => me.getByRole('button', { name: new RegExp(`^${stat} 성격 하락`) })
    const value = (stat: string) => me.getByLabel(`${stat} 실능치`, { exact: true })
    const pressed = (name: RegExp) => me.getByRole('button', { name, pressed: true })
    await expect(value('공격')).toHaveText('182')
    // SP 증감(+/−)과 헷갈리지 않게 성격 버튼은 ▲/▼
    await expect(plus('공격')).toHaveText('▲')
    await expect(minus('공격')).toHaveText('▼')

    await plus('공격').click()
    await expect(value('공격')).toHaveText('200')
    await expect(minus('특공')).toHaveAttribute('aria-pressed', 'true')
    await expect(minus('특공')).toHaveAttribute('data-auto', 'true')
    await expect(value('특공')).toHaveText('90')
    await expect(minus('공격')).toBeDisabled()

    await plus('스피드').click()
    await expect(pressed(/성격 상승$/)).toHaveCount(1)
    await expect(value('스피드')).toHaveText('169')
    await expect(value('공격')).toHaveText('182')

    await minus('방어').click()
    await expect(minus('방어')).toHaveAttribute('aria-pressed', 'true')
    await expect(minus('방어')).not.toHaveAttribute('data-auto', 'true')
    await expect(pressed(/성격 하락/)).toHaveCount(1)

    await plus('스피드').click()
    await expect(pressed(/성격 (상승|하락)/)).toHaveCount(0)
    await expect(value('스피드')).toHaveText('154')
    await expect(minus('방어')).toBeDisabled()
  })

  test('메가는 종 검색에서 메가 폼으로 고르고 도구는 메가스톤으로 고정, 수동 도구 후보에 메가스톤 없음', async ({ page }) => {
    await openProduct(page)
    const me = mySet(page)
    await expect(me.getByRole('checkbox', { name: /메가진화/ })).toHaveCount(0)
    // '종' 라벨은 화면에 보이지 않는다(접근성 이름은 유지).
    await expect(me.locator('.combo-label > span.sr-only', { hasText: /^종$/ })).toHaveCount(1)

    const species = combo(me, '종')
    await species.fill('메가한카리아스Z')
    await expect(page.getByRole('listbox', { name: '종 후보' }).getByRole('option', { name: '메가한카리아스Z', exact: true })).toBeVisible()
    await species.press('Enter')
    await expect(species).toHaveValue('메가한카리아스Z')
    const lockedItem = me.getByRole('textbox', { name: /^도구/ })
    await expect(lockedItem).toBeDisabled()
    await expect(lockedItem).toHaveValue(/나이트/)
    // 도구 칸 안내(특성 칸에도 같은 안내가 있다)
    await expect(me.locator('[id$="-mega-item"]', { hasText: '메가 폼 고정' })).toBeVisible()
    await waitComplete(page)
    await expect(tabPanel(page).getByTestId('tab-error')).toHaveCount(0)

    // 일반 폼으로 돌아오면 그 종 마지막 세트(R11: 예시 세트 생명의구슬)로 돌아와 스톤이 남지 않고 도구를 다시 고를 수 있다.
    await species.fill('한카리아스')
    await species.press('Enter')
    const item = combo(me, '도구')
    await expect(item).toBeEnabled()
    await expect(item).toHaveValue('생명의구슬')
    await item.fill('나이트')
    const options = page.getByRole('listbox', { name: '도구 후보' }).getByRole('option')
    await expect(options.filter({ hasText: /나이트$/ })).toHaveCount(0)
    await item.press('Escape')
  })

  test('한국어 부분 검색과 한국어 규칙 위반 안내(AC14), 내 세트 오류는 탭 안내(AC12)', async ({ page }) => {
    await openProduct(page)
    const species = combo(mySet(page), '종')
    await species.fill('카리아')
    await expect(page.getByRole('listbox', { name: '종 후보' }).getByRole('option', { name: '한카리아스', exact: true })).toBeVisible()
    await species.press('Escape')

    // 한카리아스가 배울 수 없는 기술 → 원인 칸 옆 한국어 안내, 탭은 내 세트 오류.
    const move = combo(mySet(page), '기술 1')
    await move.fill('10만볼트')
    await move.press('Enter')
    const alert = mySet(page).getByRole('alert').first()
    await expect(alert).toContainText('10만볼트')
    await expect(alert).not.toContainText(/[A-Z_]{6,}/)
    await expect(tabPanel(page).getByTestId('tab-error')).toContainText('내 세트 계산 불가')

    // SP 숫자 입력은 클램프하지 않고 초과를 알린다.
    await move.fill('지진')
    await move.press('Enter')
    await mySet(page).getByRole('spinbutton', { name: 'SP 방어 숫자', exact: true }).fill('10')
    await expect(mySet(page).getByRole('alert').first()).toContainText('SP 합계 76')
    await selectTab(page, '스피드')
    await expect(tabPanel(page).getByTestId('tab-error')).toContainText('SP 합계 76')
  })

  test('카드 줄은 분류 라벨 대신 대표 행 현재 칸의 결과 배지, 변화 없음은 표시하지 않는다(사용자 피드백 2026-11-10)', async ({ page }) => {
    // 배지 문구는 5단 단계명, 난수 단계는 뒤에 작은 글씨 1타 확률(사용자 피드백 2026-11-11 2차). 색 5종 + 무효 회색.
    const BADGE = /^(확정1타|확정견딤|(고난수|중난수|저난수)1타 \d+\.\d%|무효)$/
    const TONES = ['red', 'orange', 'yellow', 'lime', 'green', 'gray']
    await openProduct(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    await waitComplete(page)

    for (const tab of ['공격', '방어'] as const) {
      if (tab !== '공격') {
        await selectTab(page, tab)
        await waitComplete(page)
      }
      const badges = tabPanel(page).locator('.card-line [data-testid="ko-badge"]')
      // 표처럼 열 정렬: 포켓몬 | 배분 | 기술 | 결과 | 외 n행 — 래더 카드끼리 같은 열은 같은 x에서 시작한다.
      // 변화 없음 행도 기술 라벨이 있어 모든 래더 행이 같은 열에 맞는다. 결과 열은 배지(+변동 가능 태그).
      const cols = await tabPanel(page)
        .locator('[data-origin="ladder"][data-headline="row"] .card-line')
        .evaluateAll((lines) =>
          lines.slice(0, 8).map((line) => {
            const x = (sel: string) => line.querySelector(sel)?.getBoundingClientRect().left ?? NaN
            const more = line.querySelector('[data-testid="card-more"]')
            return {
              name: x('.card-name'),
              bundle: x('.bundle-cell'),
              move: x('[data-testid="move-label"]'),
              badge: x('[data-testid="ko-badge"]'),
              moreRightGap: more ? line.getBoundingClientRect().right - more.getBoundingClientRect().right : 0,
            }
          }),
        )
      expect(cols.length).toBeGreaterThan(2)
      for (const key of ['name', 'bundle', 'move', 'badge'] as const) {
        const xs = cols.map((c) => c[key]).filter((v) => !Number.isNaN(v))
        expect(xs.length, key).toBeGreaterThan(2)
        expect(Math.max(...xs) - Math.min(...xs), key).toBeLessThanOrEqual(1)
      }
      expect(cols[0].name).toBeLessThan(cols[0].bundle)
      expect(cols[0].bundle).toBeLessThan(cols[0].move)
      expect(cols[0].move).toBeLessThan(cols[0].badge)
      for (const c of cols) expect(c.moreRightGap).toBeLessThan(24)
      expect(await badges.count()).toBeGreaterThan(0)
      for (const text of await badges.allTextContents()) expect(text).toMatch(BADGE)
      for (const el of await badges.all()) expect(TONES).toContain(await el.getAttribute('data-tone'))
      const texts = await badges.allTextContents()
      expect(texts.some((t) => /난수1타 \d/.test(t)), tab).toBe(true)
      // 확률은 단계명보다 작은 글씨.
      const chance = badges.filter({ has: page.locator('.ko-chance') }).first()
      const sizes = await chance.evaluate((el) => [parseFloat(getComputedStyle(el).fontSize), parseFloat(getComputedStyle(el.querySelector('.ko-chance')!).fontSize)])
      expect(sizes[1], tab).toBeLessThan(sizes[0])
      // 물리/특수 분류 배지·변화 없음 요약 줄은 없다(계약 속성 data-category는 남는다).
      await expect(tabPanel(page).locator('.card-line .cat')).toHaveCount(0)
      for (const text of await tabPanel(page).locator('.card-line').allTextContents()) expect(text).not.toMatch(/물리|특수/)
      await expect(tabPanel(page).getByTestId('no-change-summary')).toHaveCount(0)
      // 커스텀 카드 상세까지 펼쳐도 "변화 없음" 문구가 없다.
      await cardLine(customCards(page).first()).click()
      await expect(customCards(page).first().locator('.card-detail')).toBeVisible()
      await expect(tabPanel(page)).not.toContainText('변화 없음')
    }

    // F9 공격: 메가리자몽Y quiet:32/0/2/32/0/0 스톤샤워는 A17부터 확정 1타 → 예시 세트 A32는 확정1타(빨강).
    await selectTab(page, '공격')
    await waitComplete(page)
    const charizard = ladderCards(page).and(page.locator('[data-opponent="charizardmegay"]')).filter({ has: page.getByTestId('card-headline').filter({ hasText: '스톤샤워' }) })
    await expect(charizard.getByTestId('ko-badge')).toHaveText('확정1타')
    await expect(charizard.getByTestId('ko-badge')).toHaveAttribute('data-tone', 'red')
    await expect(cardLine(charizard)).toHaveAccessibleName('메가리자몽Y')
    await expect(cardLine(charizard)).toHaveAccessibleDescription(/스톤샤워.*확정1타/)

    // F3 통과: 한카리아스 adamant(A32↑) 드래곤클로는 내 H2·B0에서 1타 확률 2/16(B3부터 확정견딤) → 고난수 견딤 기준 14(저난수 (16−14)/16 이하)라 저난수1타(연두).
    await selectTab(page, '방어')
    await waitComplete(page)
    await chooseBundle(ladderCards(page).and(page.locator('[data-opponent="garchomp"]')), /^A32↑/)
    const garchomp = ladderCards(page)
      .and(page.locator('[data-opponent="garchomp"]'))
      .filter({ has: page.locator('.card-bundle', { hasText: /^A32↑/ }) })
      .filter({ has: page.getByTestId('card-headline').filter({ hasText: '드래곤클로' }) })
    await expect(garchomp.getByTestId('ko-badge')).toHaveText('저난수1타 12.5%')
    await expect(garchomp.getByTestId('ko-badge')).toHaveAttribute('data-tone', 'lime')

    // 스피드 탭은 1타 확률이 없어 결과 배지 대신 행동 순서 배지(선공·동속·후공)를 글자로 보인다(AC19, 판정 기호 제거 뒤).
    await selectTab(page, '스피드')
    await waitComplete(page)
    await expect(tabPanel(page).getByTestId('ko-badge')).toHaveCount(0)
    const rowCards = ladderCards(page).filter({ has: page.getByTestId('move-label') })
    const rowCount = await rowCards.count()
    expect(rowCount).toBeGreaterThan(0)
    await expect(rowCards.getByTestId('order-badge')).toHaveCount(rowCount)
    for (const text of await rowCards.getByTestId('order-badge').allTextContents()) expect(['선공', '동속', '후공']).toContain(text)
  })

  test('툴바 판정 기준 하나: 공격 "고난수 1타 기준"·방어 "고난수 견딤 기준"이 같은 n(기본 14/16), 바꾸면 배지 단계가 바뀌고 1~15 밖은 반영하지 않는다(사용자 피드백 2026-11-11 2차)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const field = page.getByTestId('roll-threshold')
    const high = page.getByRole('spinbutton', { name: '고난수 1타 기준', exact: true })
    await expect(field).toHaveCount(1)
    await expect(high).toHaveValue('14')
    await expect(field.getByTestId('roll-percent')).toHaveText('(87.5%)')
    await expect(field).toContainText('/16')
    // 스크린 리더가 단위·반영 백분율을 함께 읽는다(접근 가능한 설명, 뜻 설명 문구는 없음)
    await expect(high).toHaveAccessibleDescription('/16 (87.5%)')
    await expect(field.getByTestId('roll-note')).toHaveCount(0)

    await selectTab(page, '스피드')
    await expect(page.getByTestId('roll-threshold')).toHaveCount(0)

    await selectTab(page, '방어')
    await waitComplete(page)
    await expect(field).toHaveCount(1)
    await expect(page.getByRole('spinbutton', { name: '고난수 1타 기준', exact: true })).toHaveCount(0)
    const survive = page.getByRole('spinbutton', { name: '고난수 견딤 기준', exact: true })
    await expect(survive).toHaveValue('14')
    await expect(field.getByTestId('roll-percent')).toHaveText('(87.5%)')
    // F3 통과 카드: 1타 확률 2/16 — n=14(저난수 2/16 이하)에서 저난수1타, n=15(저난수 1/16 이하)로 올리면 중난수1타. 확률 문구는 그대로.
    await chooseBundle(ladderCards(page).and(page.locator('[data-opponent="garchomp"]')), /^A32↑/)
    const garchomp = ladderCards(page)
      .and(page.locator('[data-opponent="garchomp"]'))
      .filter({ has: page.locator('.card-bundle', { hasText: /^A32↑/ }) })
      .filter({ has: page.getByTestId('card-headline').filter({ hasText: '드래곤클로' }) })
    const badge = garchomp.getByTestId('ko-badge')
    await expect(badge).toHaveText('저난수1타 12.5%')
    await expect(badge).toHaveAttribute('data-tone', 'lime')
    await survive.fill('15')
    await expect(field.getByTestId('roll-percent')).toHaveText('(93.8%)')
    await waitComplete(page)
    await expect(badge).toHaveText('중난수1타 12.5%')
    await expect(badge).toHaveAttribute('data-tone', 'yellow')

    // 범위 밖·비정수는 반영하지 않고 입력 칸 옆에 안내한다(적용 값·배지는 그대로).
    for (const bad of ['16', '0', '2.5']) {
      await survive.fill(bad)
      await expect(field.getByTestId('roll-hint')).toHaveText('1~15 정수만 반영됩니다')
      await expect(survive).toHaveAttribute('aria-invalid', 'true')
      await expect(survive).toHaveAccessibleDescription('/16 (93.8%) 1~15 정수만 반영됩니다')
      await expect(field.getByTestId('roll-percent')).toHaveText('(93.8%)')
      await expect(badge).toHaveAttribute('data-tone', 'yellow')
    }
    await survive.blur()
    await expect(survive).toHaveValue('15')

    // 같은 값을 공유한다: 공격 탭 기준도 15.
    await selectTab(page, '공격')
    await expect(page.getByRole('spinbutton', { name: '고난수 1타 기준', exact: true })).toHaveValue('15')
    await selectTab(page, '방어')
    // n ≤ 8이면 두 경계가 겹쳐 고난수1타가 우선한다(2/16은 5/16 미만이라 그대로 저난수1타).
    await survive.fill('5')
    await expect(field.getByTestId('roll-percent')).toHaveText('(31.3%)')
    await waitComplete(page)
    await expect(badge).toHaveText('저난수1타 12.5%')
    await survive.fill('14')
    await expect(field.getByTestId('roll-hint')).toHaveCount(0)
    await waitComplete(page)
    await expect(badge).toHaveText('저난수1타 12.5%')
    await expect(badge).toHaveAttribute('data-tone', 'lime')
  })

  test('키보드만으로 탭 전환·필터·카드 펼치기(AC18)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const attack = resultTab(page, '공격')
    await attack.focus()
    await page.keyboard.press('ArrowRight')
    await expect(resultTab(page, '방어')).toBeFocused()
    await expect(resultTab(page, '방어')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(resultTab(page, '스피드')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Home')
    await expect(attack).toHaveAttribute('aria-selected', 'true')
    await waitComplete(page)

    // Tab 키로 상위 N에 닿아 값을 바꾼다.
    const topN = toolbarSpin(page, '상위 N')
    for (let i = 0; i < 10 && !(await topN.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(topN).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('5')
    await waitComplete(page)
    const ranks = await ladderRanks(page)
    expect(ranks.length).toBeGreaterThan(0)
    expect(ranks.every((r) => r.rank <= 5)).toBe(true)

    // 카드 펼치기: Enter와 Space.
    const line = cardLine(cards(page).first())
    await line.focus()
    await page.keyboard.press('Enter')
    await expect(line).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Space')
    await expect(line).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('포켓몬마다 한 행 + 노력치 배분 선택(사용자 피드백 2026-11-12)', () => {
  /** 비중 문구 "56.3%"의 숫자, 소수 배분은 -1 */
  const shareOf = (text: string) => {
    const m = /(\d+\.\d)%$/.exec(text)
    return m ? Number(m[1]) : -1
  }
  /** 배분 선택지가 둘 이상인 첫 래더 행(그룹 키로 고정한 locator) */
  async function multiRow(page: Page): Promise<Locator> {
    const first = ladderCards(page).filter({ has: page.locator('button.bundle-btn') }).first()
    await expect(first).toBeVisible()
    const key = await first.getAttribute('data-group-key')
    return cards(page).and(page.locator(`[data-group-key='${key}']`))
  }

  test('같은 포켓몬은 탭마다 한 행만(도구 변형 행은 도구마다 따로)', async ({ page }) => {
    await openProduct(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    for (const tab of ['공격', '방어', '스피드'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      const keys = await cards(page).evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.origin}/${(e as HTMLElement).dataset.opponent}/${(e as HTMLElement).dataset.berry ?? ''}`))
      expect(keys.length, tab).toBeGreaterThan(0)
      expect(new Set(keys).size, tab).toBe(keys.length)
    }
  })

  test('배분 배지 클릭 → 사용률 순 메뉴, 다른 배분을 고르면 행이 그 배분으로 바뀌고 펼침은 토글되지 않는다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const row = await multiRow(page)
    const button = bundleButton(row)
    await expect(button).toHaveAttribute('aria-haspopup', 'menu')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    // 고를 수 있는 배지는 손가락 커서, 호버하면 면 색이 바뀐다.
    const look = () => button.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, cursor: getComputedStyle(el).cursor }))
    const rest = await look()
    expect(rest.cursor).toBe('pointer')
    await button.hover()
    await expect.poll(async () => (await look()).bg).not.toBe(rest.bg)

    const before = { id: await row.getAttribute('data-card-id'), bundle: await row.getByTestId('card-bundle').textContent() }
    await button.click()
    const menu = bundleMenu(row)
    await expect(menu).toBeVisible()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    const items = menu.getByRole('menuitemradio')
    const texts = await items.locator('.bundle-opt-label').allTextContents()
    expect(texts.length).toBeGreaterThan(1)
    const shares = texts.map(shareOf)
    const majors = shares.filter((s) => s >= 0)
    expect(majors).toEqual([...majors].sort((a, b) => b - a))
    // 소수 배분은 맨 뒤
    expect(shares.slice(majors.length).every((s) => s === -1)).toBe(true)
    await expect(items.first()).toHaveAttribute('aria-checked', 'true')
    await expect(items.first()).toBeFocused()
    expect(texts[0]).toBe(before.bundle)
    // 항목마다 그 배분의 결과 배지
    await expect(items.locator('.ko-badge')).toHaveCount(texts.length)

    const nextId = await items.nth(1).getAttribute('data-card-id')
    expect(nextId).not.toBe(before.id)
    await items.nth(1).click()
    await expect(menu).toHaveCount(0)
    await expect(row).toHaveAttribute('data-card-id', nextId!)
    await expect(row.getByTestId('card-bundle')).toHaveText(texts[1])
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'false')
    await expect(row.locator('.card-detail')).toBeHidden()
    await expect(button).toBeFocused()

    // 펼친 채로 배지를 눌러도 접히지 않는다.
    await cardLine(row).click()
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'true')
    await button.click()
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitemradio').first().click()
    await expect(row).toHaveAttribute('data-card-id', before.id!)
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'true')
  })

  test('메뉴: ↑/↓ 이동, Escape는 닫고 배지로 포커스, 바깥 클릭도 닫는다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const row = await multiRow(page)
    const button = bundleButton(row)
    const menu = bundleMenu(row)
    await button.click()
    const items = menu.getByRole('menuitemradio')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()

    // 키보드로 열고 고르기
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    const id = await items.nth(1).getAttribute('data-card-id')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    await expect(row).toHaveAttribute('data-card-id', id!)
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'false')

    await button.click()
    await expect(menu).toBeVisible()
    await page.getByTestId('progress').click()
    await expect(menu).toHaveCount(0)
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'false')
  })

  test('스피드 탭 펼친 상세: 왼쪽에 드롭다운과 같은 배분 목록(결과 배지·변동 표시)을 세로로, 고르면 오른쪽 판정·간단행이 바뀌고 펼침은 유지', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '스피드')
    await waitComplete(page)
    const row = await multiRow(page)
    // 드롭다운 항목(배분·결과 배지·변동 표시)을 읽어 둔다
    await bundleButton(row).click()
    const menuItems = await bundleMenu(row)
      .getByRole('menuitemradio')
      .evaluateAll((els) => els.map((e) => ({ id: (e as HTMLElement).dataset.cardId, text: e.textContent, variable: (e as HTMLElement).dataset.variable })))
    await bundleMenu(row).press('Escape')
    await cardLine(row).click()
    const list = row.getByTestId('bundle-list')
    await expect(list).toBeVisible()
    await expect(row.getByTestId('bundle-tabs')).toHaveCount(0)
    const group = list.getByRole('radiogroup', { name: '노력치 배분', exact: true })
    const radios = group.getByRole('radio')
    // 래더 행은 맨 위에 직접 추가 폼, 그 아래 같은 순서·같은 내용의 항목
    expect(await list.evaluate((el) => el.firstElementChild?.getAttribute('data-testid'))).toBe('bundle-add')
    const listItems = await radios.evaluateAll((els) => els.map((e) => ({ id: (e as HTMLElement).dataset.cardId, text: e.textContent, variable: (e as HTMLElement).dataset.variable })))
    expect(listItems).toEqual(menuItems)
    expect(listItems.length).toBeGreaterThan(1)
    await expect(radios.locator('.ko-badge')).toHaveCount(listItems.length)
    for (const [i, it] of listItems.entries()) await expect(radios.nth(i).getByTestId('variable-mark')).toHaveCount(it.variable === 'true' ? 1 : 0)
    await expect(radios.first()).toHaveAttribute('aria-checked', 'true')
    // 왼쪽 목록은 세로로 쌓이고(항목 left 같음, top 증가) 판정 영역은 오른쪽
    const geo = await row.evaluate((el) => {
      const items = [...el.querySelectorAll('[role="radio"]')].map((r) => r.getBoundingClientRect())
      const side = el.querySelector('[data-testid="bundle-list"]')!.getBoundingClientRect()
      const panel = el.querySelector('[data-testid="bundle-panel"]')!.getBoundingClientRect()
      return { lefts: items.map((r) => Math.round(r.left)), tops: items.map((r) => r.top), sideRight: side.right, panelLeft: panel.left, sideTop: side.top, panelTop: panel.top }
    })
    expect(new Set(geo.lefts).size).toBe(1)
    expect(geo.tops).toEqual([...geo.tops].sort((a, b) => a - b))
    expect(geo.panelLeft).toBeGreaterThan(geo.sideRight)
    expect(Math.abs(geo.panelTop - geo.sideTop)).toBeLessThan(4)

    // 변동 여부가 첫 배분과 다른 배분이 있으면 그걸 골라 오른쪽 판정 행이 그 배분으로 바뀌는 것을 본다(없으면 두 번째).
    const k = Math.max(1, listItems.findIndex((it) => it.variable !== listItems[0].variable))
    const next = listItems[k]
    const panel = row.getByTestId('bundle-panel')
    await radios.nth(k).click()
    await expect(radios.nth(k)).toHaveAttribute('aria-checked', 'true')
    await expect(radios.first()).toHaveAttribute('aria-checked', 'false')
    await expect(row).toHaveAttribute('data-card-id', next.id!)
    await expect(row).toHaveAttribute('data-variable', next.variable!)
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'true')
    await expect(panel).toHaveAttribute('aria-labelledby', (await radios.nth(k).getAttribute('id'))!)
    // 오른쪽 판정 행 = 고른 배분: 변동 가능 배분이면 판정 줄에 변동 표시가 있고, 아니면 없다.
    if (next.variable === 'true') await expect(panel.getByTestId('row-variable').first()).toBeVisible()
    else await expect(panel.getByTestId('row-variable')).toHaveCount(0)
    // 간단행 배분 배지·결과 배지·변동 태그도 그 배분
    await expect(row.getByTestId('card-bundle')).toHaveText((await radios.nth(k).locator('.bundle-opt-label').textContent())!)
    await expect(row.locator('.card-line [data-testid="variable-tag"]')).toHaveCount(next.variable === 'true' ? 1 : 0)

    // 키보드: ↑/↓로 옮기며 바로 고르고, Home/End는 처음·마지막. 선택 항목만 Tab 순서(roving tabindex).
    await radios.nth(1).focus()
    await page.keyboard.press('ArrowUp')
    await expect(radios.first()).toHaveAttribute('aria-checked', 'true')
    await expect(radios.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true')
    await expect(radios.nth(1)).toBeFocused()
    await page.keyboard.press('End')
    await expect(radios.last()).toHaveAttribute('aria-checked', 'true')
    await expect(radios.last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(radios.first()).toHaveAttribute('aria-checked', 'true')
    expect(await radios.evaluateAll((els) => els.map((e) => (e as HTMLElement).tabIndex))).toEqual(listItems.map((_, i) => (i === 0 ? 0 : -1)))
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'true')

    // 오른쪽 판정 영역의 이름은 선택 항목이다.
    await expect(panel).toHaveAttribute('role', 'region')
    await expect(panel).toHaveAttribute('aria-labelledby', (await radios.first().getAttribute('id'))!)
    await expect(panel.locator('.rows')).toHaveCount(1)
  })

  test('직접 추가 폼 "H [ ] B [ ] [추가]"는 드롭다운에서 한 줄(상세 목록은 없음, R9)(사용자 피드백 2026-11-12)', async ({ page }) => {
    await openProduct(page)
    for (const tab of ['공격', '방어'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      const row = await multiRow(page)
      const oneLine = (form: Locator) =>
        form.evaluate((el) => {
          const parts = [...el.querySelectorAll('label, input, button')].map((e) => e.getBoundingClientRect())
          const mid = parts.map((r) => r.top + r.height / 2)
          const box = el.getBoundingClientRect()
          return { spread: Math.max(...mid) - Math.min(...mid), count: parts.length, right: Math.max(...parts.map((r) => r.right)), boxRight: box.right }
        })
      await bundleButton(row).click()
      const inMenu = await oneLine(bundleMenu(row).getByTestId('bundle-add'))
      expect(inMenu.count, tab).toBeGreaterThanOrEqual(3)
      expect(inMenu.spread, tab).toBeLessThanOrEqual(2)
      expect(inMenu.right, tab).toBeLessThanOrEqual(inMenu.boxRight + 0.5)
      await bundleMenu(row).press('Escape')
      // 공격·방어 탭 상세에는 배분 목록·직접 추가 폼이 없다(R9, AC27)
      await cardLine(row).click()
      await expect(row.locator('.card-detail')).toBeVisible()
      await expect(row.locator('.card-detail').getByTestId('bundle-add')).toHaveCount(0)
      await cardLine(row).click()
    }
    // 드롭다운도 관여 능력치 3개 이상(칸 복제로 강제)이면 한 줄이고 메뉴·화면 안에 든다 — 1280px·400px.
    for (const width of [1280, 400]) {
      await page.setViewportSize({ width, height: 900 })
      const row = await multiRow(page)
      await bundleButton(row).click()
      const wide = await bundleMenu(row).evaluate((menu) => {
        const form = menu.querySelector('[data-testid="bundle-add"]')!
        const fields = form.querySelector('.bundle-add-fields')!
        const label = fields.querySelector('label')!
        for (let i = 0; i < 2; i++) fields.insertBefore(label.cloneNode(true), label)
        const parts = [...form.querySelectorAll('label, input, button')].map((e) => e.getBoundingClientRect())
        const mid = parts.map((r) => r.top + r.height / 2)
        const button = form.querySelector('button')!.getBoundingClientRect()
        const box = menu.getBoundingClientRect()
        return {
          labels: fields.querySelectorAll('label').length,
          spread: Math.max(...mid) - Math.min(...mid),
          right: Math.max(...parts.map((r) => r.right)),
          menuRight: box.right,
          menuLeft: box.left,
          hScroll: menu.scrollWidth - menu.clientWidth,
          // "추가" 두 글자가 두 줄로 갈라지면 버튼 높이가 입력칸보다 훨씬 크다
          buttonTall: button.height > form.querySelector('input')!.getBoundingClientRect().height * 1.6,
        }
      })
      expect(wide.labels, `${width}`).toBeGreaterThanOrEqual(3)
      expect(wide.spread, `${width}`).toBeLessThanOrEqual(2)
      expect(wide.right, `${width}`).toBeLessThanOrEqual(wide.menuRight + 0.5)
      expect(wide.hScroll, `${width}`).toBeLessThanOrEqual(0)
      expect(wide.buttonTall, `${width}`).toBe(false)
      expect([wide.menuLeft >= 0, wide.menuRight <= width], `${width}`).toEqual([true, true])
      await bundleMenu(row).press('Escape')
    }
  })

  test('통계 설정: "배분 선택지 수"는 없고 "SP 배분 최소(%)" 기본 5', async ({ page }) => {
    await openProduct(page)
    await expect(toolbarSpin(page, 'SP 배분 최소(%)')).toHaveValue('5')
    await expect(toolbarSpin(page, '배분 선택지 수')).toHaveCount(0)
  })

  test('모든 래더 행의 배분 배지는 고를 수 있는 버튼이고, 메뉴 선택지 비중은 모두 0.5% 이상(또는 소수 배분)', async ({ page }) => {
    await openProduct(page)
    for (const tab of ['공격', '방어', '스피드'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      const rows = ladderCards(page)
      const n = await rows.count()
      expect(n, tab).toBeGreaterThan(0)
      // 관련 SP가 없는 묶음(추가할 능력치 없음)만 버튼이 아닐 수 있다.
      const plain = await rows.filter({ hasNot: page.locator('button.bundle-btn') }).getByTestId('card-bundle').allTextContents()
      for (const text of plain) expect(text, tab).toMatch(/^관련 SP 없음/)
      expect(await rows.filter({ has: page.locator('button.bundle-btn') }).count(), tab).toBe(n - plain.length)
      expect(n - plain.length, tab).toBeGreaterThan(0)
    }
    // 공격 탭 앞 5행의 메뉴: 모든 관측 배분 비중 ≥ 기준(기본 5%, 낮춘 뒤 0.5%), 소수 배분은 기준 이상이 하나도 없을 때만(그때 한 개).
    await selectTab(page, '공격')
    const menuTotal = async (min: number) => {
      await waitComplete(page)
      const btnRows = ladderCards(page).filter({ has: page.locator('button.bundle-btn') })
      let total = 0
      for (let i = 0; i < 5; i++) {
        const row = btnRows.nth(i)
        const options = await bundleOptions(row)
        const shares = options.map((o) => shareOf(o.text))
        const majors = shares.filter((x) => x >= 0)
        for (const x of majors) expect(x).toBeGreaterThanOrEqual(min)
        if (majors.length < shares.length) expect(majors).toEqual([])
        total += options.length
      }
      return total
    }
    await menuTotal(5)
    const minField = toolbarSpin(page, 'SP 배분 최소(%)')
    await minField.fill('0.5')
    await minField.blur()
    // 상한(3장)이 없으므로 기준을 0.5%로 낮추면 5행 합이 15를 넘는다(실제 스냅샷).
    expect(await menuTotal(0.5)).toBeGreaterThan(15)
  })

  test('묶음 기준 100%면 선택지가 하나라도 래더 배지는 버튼(직접 추가 폼), 상세에는 배분 목록 없음(R9)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const min = toolbarSpin(page, 'SP 배분 최소(%)')
    await min.fill('100')
    await min.blur()
    await waitComplete(page)
    // 공격 탭(내 기술 전부 물리)은 포켓몬마다 분류 하나 × 소수 배분 1장이라 선택지 하나.
    const row = ladderCards(page).first()
    await expect(row).toBeVisible()
    const button = bundleButton(row)
    await expect(button).toBeVisible()
    await button.click()
    const menu = bundleMenu(row)
    await expect(menu.getByRole('menuitemradio')).toHaveCount(1)
    await expect(menu.getByTestId('bundle-add')).toBeVisible()
    await menu.press('Escape')
    await cardLine(row).click()
    await expect(row.locator('.card-detail')).toBeVisible()
    // 공격 탭 상세에는 배분 목록이 없다(R9) — 고르기·추가는 위 배지 메뉴에서만
    await expect(row.getByTestId('bundle-list')).toHaveCount(0)
  })
})

test.describe('배분 직접 추가·고정(사용자 피드백 2026-11-12)', () => {
  const addForm = (row: Locator) => bundleMenu(row).getByTestId('bundle-add')
  const spInput = (row: Locator, stat: string) => addForm(row).getByRole('spinbutton', { name: `직접 추가 SP ${stat}`, exact: true })
  const addButton = (row: Locator) => addForm(row).getByRole('button', { name: '추가', exact: true })
  const bg = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
  /** 고정 배분 면 토큰(--pinned-bundle-bg)을 계산된 rgb로: 같은 배경을 칠한 탐침 요소로 푼다 */
  const pinnedBg = (page: Page) =>
    page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--pinned-bundle-bg)'
      document.body.appendChild(probe)
      const v = getComputedStyle(probe).backgroundColor
      probe.remove()
      return v
    })

  /** 공격 탭 첫 래더 행(그룹 키로 고정) */
  async function firstRow(page: Page): Promise<Locator> {
    const first = ladderCards(page).filter({ has: page.locator('button.bundle-btn') }).first()
    await expect(first).toBeVisible()
    const key = await first.getAttribute('data-group-key')
    return cards(page).and(page.locator(`[data-group-key='${key}']`))
  }

  test('메뉴 최상단 "H [ ] B [ ] [추가]": 기본값은 현재 배분 SP, 0~32 정수만(범위 밖·빈칸·소수면 추가 막힘 + 안내), 클릭이 행을 토글하지 않는다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const row = await firstRow(page)
    const badge = (await row.getByTestId('card-bundle').textContent()) ?? ''
    const m = /^H(\d+)[↑↓]? B(\d+)[↑↓]?/.exec(badge)
    expect(m, badge).not.toBeNull()
    await bundleButton(row).click()
    const menu = bundleMenu(row)
    await expect(menu).toBeVisible()
    // 폼이 메뉴 맨 위, 라벨은 묶음 능력치 순 H → B
    expect(await menu.evaluate((el) => el.firstElementChild?.getAttribute('data-testid'))).toBe('bundle-add')
    expect(await addForm(row).locator('label').allTextContents()).toEqual(['H', 'B'])
    await expect(spInput(row, 'HP')).toHaveValue(m![1])
    await expect(spInput(row, '방어')).toHaveValue(m![2])
    for (const attr of [['min', '0'], ['max', '32'], ['step', '1']]) await expect(spInput(row, 'HP')).toHaveAttribute(attr[0], attr[1])
    await expect(addButton(row)).toBeEnabled()

    const hint = addForm(row).locator('.bundle-add-hint')
    for (const bad of ['33', '-1', '1.5', '']) {
      await spInput(row, 'HP').fill(bad)
      await expect(addButton(row), bad).toBeDisabled()
      await expect(hint, bad).toHaveText('SP는 0~32 정수만 넣을 수 있습니다')
      await expect(spInput(row, 'HP')).toHaveAttribute('aria-invalid', 'true')
    }
    await spInput(row, 'HP').fill('32')
    await expect(addButton(row)).toBeEnabled()
    await expect(hint).toHaveCount(0)
    await spInput(row, 'HP').fill('0')
    await expect(addButton(row)).toBeEnabled()

    // 폼 안 클릭·키 입력은 메뉴를 닫거나 행을 펼치지 않는다(↑↓는 숫자 칸 값만 바꾼다).
    await spInput(row, '방어').click()
    await spInput(row, '방어').fill('10')
    await page.keyboard.press('ArrowUp')
    await expect(spInput(row, '방어')).toHaveValue('11')
    await expect(spInput(row, '방어')).toBeFocused()
    await expect(menu).toBeVisible()
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'false')
    await addForm(row).click({ position: { x: 2, y: 2 } })
    await expect(menu).toBeVisible()
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'false')
  })

  /** 카드 id(JSON: 따옴표·역슬래시 포함)를 CSS 속성 선택자 문자열로 */
  const pinFor = (cardId: string) => `[data-pin-for='${cardId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
  const menuPin = (row: Locator, cardId: string) => bundleMenu(row).locator(pinFor(cardId))

  /**
   * 항목들의 결과 배지 오른쪽 끝·핀 칸 왼쪽 끝 x(배지가 없는 항목은 결과 칸 오른쪽 끝). 항목(radio·menuitemradio)과 핀 칸은
   * 문서 순서로 짝짓는다(드롭다운은 항목 줄 안, 상세 목록은 radiogroup 밖 형제 핀 열). 핀 칸 수가 항목 수와 다르면 NaN.
   */
  const columns = (container: Locator) =>
    container.evaluate((root) => {
      const items = [...root.querySelectorAll('[role="menuitemradio"], [role="radio"]')]
      const pins = [...root.querySelectorAll('.bundle-pin')]
      return items.map((el, i) => {
        const badge = el.querySelector('.bundle-opt-result .ko-badge') ?? el.querySelector('.bundle-opt-result')
        const pin = pins.length === items.length ? pins[i] : undefined
        const p = pin?.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return {
          badgeRight: badge?.getBoundingClientRect().right ?? NaN,
          pinLeft: p?.left ?? NaN,
          // 핀 칸이 그 항목과 같은 줄(세로 가운데가 항목 안)
          sameRow: p !== undefined && p.top + p.height / 2 > r.top && p.top + p.height / 2 < r.bottom,
          hasBadge: el.querySelector('.ko-badge') !== null,
        }
      })
    })
  /** 모든 항목이 같은 줄에 핀 칸을 갖고, 결과 배지 오른쪽 끝·핀 칸 x가 세로로 맞는다(직접 추가·고정 항목이 섞여도) */
  async function expectAligned(container: Locator, what: string) {
    const cols = await columns(container)
    expect(cols.length, what).toBeGreaterThan(1)
    expect(cols.filter((c) => c.hasBadge).length, what).toBeGreaterThan(1)
    for (const c of cols) {
      expect(c.pinLeft, `${what} 핀 칸`).toBeCloseTo(cols[0].pinLeft, 0)
      expect(c.sameRow, `${what} 핀 칸 줄`).toBe(true)
      if (c.hasBadge) expect(c.badgeRight, `${what} 결과 배지`).toBeCloseTo(cols.find((x) => x.hasBadge)!.badgeRight, 0)
    }
  }

  test('추가 → 맨 위에 다른 배경 "고정됨" 항목 + 자동 선택(배지도 다른 배경, 결과 갱신), 핀 해제 → 삭제되고 기본 배분으로', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const row = await firstRow(page)
    const before = { id: await row.getAttribute('data-card-id'), text: (await row.getByTestId('card-bundle').textContent()) ?? '' }
    const tint = await pinnedBg(page)
    expect(tint).toMatch(/^rgb/)
    // 일반(관측) 배지는 포커스 없이 고정 면 색이 아니다
    expect(await bg(bundleButton(row))).not.toBe(tint)
    await bundleButton(row).click()
    // 관측 배분과 겹치지 않을 값(H31 B3, 무보정)
    await spInput(row, 'HP').fill('31')
    await spInput(row, '방어').fill('3')
    await page.keyboard.press('Enter')
    await expect(bundleMenu(row)).toHaveCount(0)
    // 재계산 중 행이 잠깐 빠졌다 다시 붙어도 포커스는 그 행의 배분 버튼으로 돌아온다.
    await expect(bundleButton(row)).toBeFocused()
    await waitComplete(page)

    await expect(row.getByTestId('card-bundle')).toHaveText('H31 B3 고정됨')
    await expect(row).toHaveAttribute('data-user-added', 'true')
    await expect(row).toHaveAttribute('data-pinned', 'true')
    await expect(row).not.toHaveAttribute('data-card-id', before.id!)
    await expect(bundleButton(row)).toHaveClass(/pinned-bundle/)
    await page.mouse.move(0, 0)
    // 포커스 없이: 고정 면 색
    await bundleButton(row).evaluate((el) => (el as HTMLElement).blur())
    await expect(bundleButton(row)).not.toBeFocused()
    await expect.poll(() => bg(bundleButton(row))).toBe(tint)
    // 키보드 포커스(:focus-visible)여도 고정 면 색이 유지된다(포커스는 윤곽선만)
    await page.keyboard.press('Shift')
    await bundleButton(row).focus()
    expect(await bundleButton(row).evaluate((el) => el.matches(':focus-visible'))).toBe(true)
    await expect.poll(() => bg(bundleButton(row))).toBe(tint)
    await bundleButton(row).evaluate((el) => (el as HTMLElement).blur())
    // 결과 배지(가장 센 기술의 현재 판정)가 그 배분으로 다시 계산돼 보인다.
    await expect(row.getByTestId('ko-badge')).toBeVisible()
    await expect(row).not.toHaveAttribute('data-headline', 'updating')

    await bundleButton(row).click()
    const items = bundleMenu(row).getByRole('menuitemradio')
    await expect(items.first()).toHaveAttribute('data-user-added', 'true')
    await expect(items.first()).toHaveAttribute('aria-checked', 'true')
    await expect(items.first().locator('.bundle-opt-label')).toHaveText('H31 B3 고정됨')
    await expect(items.first().locator('.ko-badge')).toHaveCount(1)
    await expect(items.nth(1)).not.toHaveAttribute('data-user-added', 'true')
    await expect(items.nth(1).locator('.bundle-opt-label')).toHaveText(before.text)
    // 모든 항목에 핀(같은 이름, 상태는 체크), 고정 항목만 체크
    const pins = bundleMenu(row).getByRole('menuitemcheckbox', { name: '배분 고정', exact: true })
    await expect(pins).toHaveCount(await items.count())
    await expect(pins.first()).toHaveAttribute('aria-checked', 'true')
    await expect(pins.nth(1)).toHaveAttribute('aria-checked', 'false')
    await expect(bundleMenu(row).getByRole('menuitem')).toHaveCount(0)
    // 결과 배지가 직접 추가 항목에서도 세로로 맞는다(× 칸이 없다)
    await expectAligned(bundleMenu(row), '드롭다운')
    // 호버를 항목 밖(추가 폼 라벨)으로 옮긴 뒤: 선택된 고정 항목도 고정 면 색, 관측 항목은 아니다
    await addForm(row).locator('label').first().hover()
    await expect.poll(() => bg(items.first())).toBe(tint)
    expect(await bg(items.nth(1))).not.toBe(tint)

    // (상세 왼쪽 목록은 공격·방어 탭에서 없어졌다 — R9. 같은 면 색·맨 앞·핀은 위 드롭다운에서 확인)
    await bundleMenu(row).press('Escape')

    // 두 번째 추가는 첫 번째 뒤(추가 순), 둘 다 맨 위
    await bundleButton(row).click()
    await spInput(row, 'HP').fill('30')
    await spInput(row, '방어').fill('5')
    await addButton(row).click()
    await waitComplete(page)
    await expect(row.getByTestId('card-bundle')).toHaveText('H30 B5 고정됨')
    await bundleButton(row).click()
    await expect(bundleMenu(row).locator('.bundle-opt-label').first()).toHaveText('H31 B3 고정됨')
    await expect(bundleMenu(row).locator('.bundle-opt-label').nth(1)).toHaveText('H30 B5 고정됨')

    // 선택돼 있지 않던 것(H31 B3)을 풀면 선택(H30 B5)은 그대로
    const first = await items.first().getAttribute('data-card-id')
    const second = await items.nth(1).getAttribute('data-card-id')
    await menuPin(row, first!).click()
    // 삭제는 재계산이라 메뉴를 닫고 배분 버튼으로 돌아간다
    await expect(bundleMenu(row)).toHaveCount(0)
    await expect(bundleButton(row)).toBeFocused()
    await waitComplete(page)
    await expect(row).toHaveAttribute('data-card-id', second!)
    await expect(row.getByTestId('card-bundle')).toHaveText('H30 B5 고정됨')
    await bundleButton(row).click()
    await expect(bundleMenu(row).locator('[data-user-added="true"]')).toHaveCount(1)
    await expect(bundleMenu(row).locator('.bundle-opt-label').first()).toHaveText('H30 B5 고정됨')
    // 핀 해제 = 직접 추가 배분 삭제: 선택돼 있던 H30 B5를 풀면 남은 고정이 없어 기본(최고 비중) 배분으로 돌아간다.
    // (고정이 남아 있으면 그 고정 배분이 기본이다 — 분류 기본 배분 = 고정 배분 우선, 사용자 결정 2026-11-13)
    await menuPin(row, second!).click()
    await expect(bundleMenu(row)).toHaveCount(0)
    await waitComplete(page)
    await expect(row).toHaveAttribute('data-card-id', before.id!)
    await expect(row.getByTestId('card-bundle')).toHaveText(before.text)
    await expect(bundleButton(row)).not.toHaveClass(/pinned-bundle/)
    await bundleButton(row).click()
    await expect(bundleMenu(row).locator('[data-user-added="true"]')).toHaveCount(0)
    await expect(bundleMenu(row).locator('[data-pinned="true"]')).toHaveCount(0)
  })

  test('관측 배분 핀: 메뉴를 연 채 맨 위로 "고정됨"·고정 면 색(재계산 없음), 해제하면 원래 자리·비중으로. (상세 목록은 R9로 없음)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const row = await firstRow(page)
    const tint = await pinnedBg(page)
    const generation = await tabPanel(page).getAttribute('data-generation')
    await bundleButton(row).click()
    const items = bundleMenu(row).getByRole('menuitemradio')
    const original = await items.evaluateAll((els) => els.map((e) => ({ id: (e as HTMLElement).dataset.cardId!, text: e.querySelector('.bundle-opt-label')?.textContent ?? '' })))
    expect(original.length, '선택지 2개 이상').toBeGreaterThan(2)
    const selected = await row.getAttribute('data-card-id')
    // 3위 이하 첫 비중 표시 관측 배분을 고정
    const targetAt = original.findIndex((o, i) => i >= 2 && /%$/.test(o.text))
    expect(targetAt, original.map((o) => o.text).join(' | ')).toBeGreaterThanOrEqual(2)
    const target = original[targetAt]
    const badgeRights = async () => (await columns(bundleMenu(row))).filter((c) => c.hasBadge).map((c) => c.badgeRight)
    const rightsBefore = await badgeRights()
    expect(rightsBefore.length).toBeGreaterThan(1)
    await menuPin(row, target.id).click()
    await expect(bundleMenu(row)).toBeVisible()
    await expect(menuPin(row, target.id)).toBeFocused()
    await expect(menuPin(row, target.id)).toHaveAttribute('aria-checked', 'true')
    await expect(items.first()).toHaveAttribute('data-card-id', target.id)
    await expect(items.first()).toHaveAttribute('data-pinned', 'true')
    await expect(items.first()).not.toHaveAttribute('data-user-added', 'true')
    await expect(items.first().locator('.bundle-opt-label')).toHaveText(target.text.replace(/\s\S+$/, ' 고정됨'))
    await page.mouse.move(0, 0)
    await expect.poll(() => bg(items.first())).toBe(tint)
    // 직접 고르지 않았으면 고정 배분이 기본이 돼 그 배분으로 바뀐다(분류 기본 배분 = 고정 배분 우선, 사용자 결정 2026-11-13). 재계산하지 않는다
    expect(selected).not.toBe(target.id)
    await expect(row).toHaveAttribute('data-card-id', target.id)
    await expect(tabPanel(page)).toHaveAttribute('data-generation', generation!)
    await expect(tabPanel(page)).not.toHaveAttribute('data-superseded', 'true')
    // 나머지는 원래 사용률 순
    expect(await items.evaluateAll((els) => els.slice(1).map((e) => (e as HTMLElement).dataset.cardId))).toEqual(original.filter((o) => o.id !== target.id).map((o) => o.id))
    await expectAligned(bundleMenu(row), '관측 고정 드롭다운')
    // 비중이 "고정됨"으로 바뀌어도 메뉴 폭이 그대로라 결과 배지 열이 움직이지 않는다
    for (const x of await badgeRights()) expect(x).toBeCloseTo(rightsBefore[0], 0)
    // 메뉴 키보드: ←로 그 항목, →로 다시 핀, ↓는 다음 항목(핀이 아니다)
    await page.keyboard.press('ArrowLeft')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(menuPin(row, target.id)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()

    // 고정 항목을 고르면 배지도 "고정됨"·고정 면 색
    await items.first().click()
    await expect(row).toHaveAttribute('data-card-id', target.id)
    await expect(row.getByTestId('card-bundle')).toHaveText(target.text.replace(/\s\S+$/, ' 고정됨'))
    await expect(bundleButton(row)).toHaveClass(/pinned-bundle/)

    // 드롭다운 핀 해제 → 원래 자리·비중, 선택은 유지, 재계산 없음(이전에는 상세 왼쪽 목록에서 확인 — 목록은 R9로 없어짐)
    await bundleButton(row).click()
    await expect(items.first()).toHaveAttribute('data-card-id', target.id)
    await menuPin(row, target.id).click()
    await expect(menuPin(row, target.id)).toHaveAttribute('aria-checked', 'false')
    await expect(menuPin(row, target.id)).toBeFocused()
    expect(await items.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cardId))).toEqual(original.map((o) => o.id))
    await expect(items.nth(targetAt).locator('.bundle-opt-label')).toHaveText(target.text)
    await expect(row).toHaveAttribute('data-card-id', target.id)
    await expect(bundleButton(row)).not.toHaveClass(/pinned-bundle/)
    await expect(tabPanel(page)).toHaveAttribute('data-generation', generation!)
    // 공격·방어 탭 상세에는 배분 목록(핀·Delete 키)이 없다
    await bundleMenu(row).press('Escape')
    await cardLine(row).click()
    await expect(row.getByTestId('bundle-list')).toHaveCount(0)
  })

  test('스피드 탭 상세 왼쪽 목록: 맨 위 직접 추가 폼으로 추가 → 맨 위 "고정됨" 항목 선택, 직접 추가 radio에서 Delete 키 또는 핀 클릭 = 삭제', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '스피드')
    await waitComplete(page)
    const row = await firstRow(page)
    const before = await row.getAttribute('data-card-id')
    const listPin = (cardId: string) => row.getByTestId('bundle-list').locator(pinFor(cardId))
    const open = async () => {
      if ((await cardLine(row).getAttribute('aria-expanded')) !== 'true') await cardLine(row).click()
      await expect(row.getByTestId('bundle-list')).toBeVisible()
    }
    await open()
    const list = row.getByTestId('bundle-list')
    const radios = list.getByRole('radio')
    // 관측 배분과 겹치지 않을 첫 능력치 값(직접 추가 폼 첫 칸)
    const form = list.getByTestId('bundle-add')
    const first = form.getByRole('spinbutton').first()
    const stat = ((await form.locator('label').first().textContent()) ?? '').trim()
    const observed = await radios.locator('.bundle-opt-label').allTextContents()
    const free = [31, 29, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1].filter((v) => !observed.some((t) => new RegExp(`(^|\\s)${stat}${v}(\\D|$)`).test(t)))
    expect(free.length, observed.join(' | ')).toBeGreaterThan(1)
    const addVia = async (v: number) => {
      await open()
      await first.fill(String(v))
      await form.getByRole('button', { name: '추가', exact: true }).click()
      await waitComplete(page)
      await expect(row).toHaveAttribute('data-user-added', 'true')
      await open()
    }
    // 맨 위 폼으로 추가: 맨 위에 고정 항목, 자동 선택, 그 radio만 Delete 단축
    await addVia(free[0])
    const user = radios.and(page.locator('[data-user-added="true"]'))
    await expect(user).toHaveCount(1)
    await expect(radios.first()).toHaveAttribute('data-user-added', 'true')
    await expect(radios.first()).toHaveAttribute('aria-checked', 'true')
    await expect(radios.first()).toHaveClass(/pinned-bundle/)
    await expect(radios.first()).toHaveAttribute('aria-keyshortcuts', 'Delete')
    await expect(radios.first().locator('.bundle-share')).toHaveText('고정됨')
    await expect(radios.nth(1)).not.toHaveAttribute('aria-keyshortcuts', 'Delete')
    // radiogroup 안에는 radio만(핀은 형제 열 group "배분 고정"), 핀 수 = 항목 수
    await expect(list.getByRole('radiogroup').getByRole('button')).toHaveCount(0)
    await expect(list.getByRole('group', { name: '배분 고정', exact: true }).getByRole('button')).toHaveCount(await radios.count())
    await expect(listPin((await row.getAttribute('data-card-id'))!)).toHaveAttribute('aria-pressed', 'true')
    // 고정 안 된 관측 배분 radio에서 Delete: 변화 없음
    await radios.and(page.locator(':not([data-pinned])')).first().focus()
    await page.keyboard.press('Delete')
    await expect(user).toHaveCount(1)
    // 직접 추가 radio에서 Delete: 삭제되고 기본 배분으로 돌아간다
    await user.focus()
    await page.keyboard.press('Delete')
    await waitComplete(page)
    await expect(row).toHaveAttribute('data-card-id', before!)
    await expect(row.locator('[data-testid="bundle-list"] [data-user-added="true"]')).toHaveCount(0)
    // 핀 클릭(마우스)으로도 삭제
    await addVia(free[1])
    const added = await row.getAttribute('data-card-id')
    await expect(listPin(added!)).toHaveAttribute('aria-pressed', 'true')
    await listPin(added!).click()
    await waitComplete(page)
    await expect(row).toHaveAttribute('data-card-id', before!)
    await expect(row.locator('[data-testid="bundle-list"] [data-user-added="true"]')).toHaveCount(0)
  })

  test('스피드 탭 상세 왼쪽 목록: 선택 항목의 핀만 Tab 순서(radio 다음), Enter로 고정 → 맨 위, 그 radio에서 Delete로 해제(재계산 없음)', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '스피드')
    await waitComplete(page)
    const row = await firstRow(page)
    const generation = await tabPanel(page).getAttribute('data-generation')
    await cardLine(row).click()
    const list = row.getByTestId('bundle-list')
    const radios = list.getByRole('radio')
    const listPin = (cardId: string) => list.locator(pinFor(cardId))
    const original = await radios.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cardId!))
    expect(original.length).toBeGreaterThan(1)
    const at = Math.min(2, original.length - 1)
    const target = original[at]
    await radios.nth(at).click()
    await expect(radios.nth(at)).toHaveAttribute('aria-checked', 'true')
    // 핀은 선택 항목 것만 tabindex 0
    expect(await list.locator('.bundle-pin').evaluateAll((els) => els.map((e) => (e as HTMLElement).tabIndex))).toEqual(original.map((_, i) => (i === at ? 0 : -1)))
    await radios.nth(at).focus()
    await page.keyboard.press('Tab')
    await expect(listPin(target)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(listPin(target)).toHaveAttribute('aria-pressed', 'true')
    await expect(radios.first()).toHaveAttribute('data-card-id', target)
    await expect(radios.first()).toHaveAttribute('aria-keyshortcuts', 'Delete')
    // 옮겨진 항목의 핀에 포커스가 남는다
    await expect(listPin(target)).toBeFocused()
    await expect(row).toHaveAttribute('data-card-id', target)
    // 그 radio에서 Delete → 해제, 원래 자리, 선택 유지
    await radios.first().focus()
    await page.keyboard.press('Delete')
    await expect(list.locator('[role="radio"][data-pinned="true"]')).toHaveCount(0)
    expect(await radios.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cardId))).toEqual(original)
    await expect(row).toHaveAttribute('data-card-id', target)
    await expect(tabPanel(page)).toHaveAttribute('data-generation', generation!)
  })

  test('관측 배분과 같은 값을 추가하면 새 항목 없이 그 배분을 고르고 고정한다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const row = await firstRow(page)
    await bundleButton(row).click()
    const items = bundleMenu(row).getByRole('menuitemradio')
    const texts = await items.locator('.bundle-opt-label').allTextContents()
    // 성격 보정 없는 두 번째 이후 관측 배분(직접 추가는 늘 무보정)
    const at = texts.findIndex((t, i) => i > 0 && /^H\d+ B\d+ /.test(t))
    expect(at, texts.join(' | ')).toBeGreaterThan(0)
    const [, h, b] = /^H(\d+) B(\d+) /.exec(texts[at])!
    const target = await items.nth(at).getAttribute('data-card-id')
    await spInput(row, 'HP').fill(h)
    await spInput(row, '방어').fill(b)
    await addButton(row).click()
    await expect(row).toHaveAttribute('data-card-id', target!)
    await expect(row.getByTestId('card-bundle')).toHaveText(`H${h} B${b} 고정됨`)
    await expect(row).toHaveAttribute('data-pinned', 'true')
    await expect(row).not.toHaveAttribute('data-user-added', 'true')
    await expect(tabPanel(page)).not.toHaveAttribute('data-superseded', 'true')
    await bundleButton(row).click()
    await expect(bundleMenu(row).locator('[data-user-added="true"]')).toHaveCount(0)
    await expect(bundleMenu(row).getByRole('menuitemradio')).toHaveCount(texts.length)
    await expect(items.first()).toHaveAttribute('data-card-id', target!)
    // 핀 해제 → 관측 배분이라 삭제되지 않고 원래 자리·비중으로
    await menuPin(row, target!).click()
    await expect(items.nth(at)).toHaveAttribute('data-card-id', target!)
    await expect(items.nth(at).locator('.bundle-opt-label')).toHaveText(texts[at])
    await expect(bundleMenu(row).getByRole('menuitemradio')).toHaveCount(texts.length)
  })

  test('목록 밖 타겟 행: 프리셋 항목에는 핀이 없고 같은 폭 빈 칸으로 결과 배지가 맞는다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    await waitComplete(page)
    const row = customCards(page).first()
    await expect(row).toBeVisible()
    await bundleButton(row).click()
    await expect(bundleMenu(row).getByRole('menuitemcheckbox')).toHaveCount(0)
    const slots = bundleMenu(row).locator('.bundle-opt-row .pin-slot')
    await expect(slots).toHaveCount(await bundleMenu(row).getByRole('menuitemradio').count())
    await expectAligned(bundleMenu(row), '프리셋 드롭다운')
  })

  test('변동 가능이 아닌 배분도 선택지: 고르면 행 배지가 고정 판정·기술 라벨 유지·변동 태그 없음(펼치면 변화 없음 행)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 메뉴 항목 data-variable="false" = 그 배분은 내 SP·성격으로 판정이 바뀌지 않는다
    const rows = ladderCards(page).filter({ has: page.locator('button.bundle-btn') }).and(page.locator('[data-variable="true"]'))
    const n = await rows.count()
    let found: Locator | null = null
    for (let i = 0; i < n && found === null; i++) {
      const row = rows.nth(i)
      await bundleButton(row).click()
      const opt = bundleMenu(row).locator('[role="menuitemradio"][data-variable="false"]')
      if ((await opt.count()) > 0) {
        const key = await row.getAttribute('data-group-key')
        found = cards(page).and(page.locator(`[data-group-key='${key}']`))
        await expect(opt.first().locator('.ko-badge')).toHaveCount(1)
        await expect(opt.first().getByTestId('variable-mark')).toHaveCount(0)
        await opt.first().click()
      } else await bundleMenu(row).press('Escape')
    }
    expect(found, '변동 가능이 아닌 배분 선택지가 있는 변동 가능 행').not.toBeNull()
    const row = found!
    await expect(row).toHaveAttribute('data-variable', 'false')
    await expect(row).toHaveAttribute('data-headline', 'row')
    await expect(row.getByTestId('variable-tag')).toHaveCount(0)
    await expect(row.getByTestId('move-label')).toBeVisible()
    await expect(row.getByTestId('ko-badge')).toHaveText(new RegExp(`^${TIER}`))
    await cardLine(row).click()
    await expect(row.locator('.card-detail .rows li').first()).toBeVisible()
    await expect(row.locator('.card-detail .rows li .row-fixed').first()).toBeVisible()
  })
})


test.describe('내 포켓몬 종 변경 → 대표 세트 기술 미리 채우기(사용자 피드백 2026-11-12, R11)', () => {
  interface Named { name: { ko: string; koLabel?: string } }
  const data = JSON.parse(readFileSync(new URL('../src/data/regulations/m-c/data.json', import.meta.url), 'utf8')) as {
    species: Record<string, Named & { isMega?: boolean }>
    moves: Record<string, Named>
    megas: { forme: string; base: string }[]
  }
  const label = (n: Named) => (n.name.koLabel ? `${n.name.ko}(${n.name.koLabel})` : n.name.ko)
  interface Entry { id: string; representative: { set: { moves: string[] } } }
  /** 기본 통계(최근 월에서 판수가 더 많은 매치 방식, 동률 Bo1)의 항목 */
  function defaultEntries(): Entry[] {
    const items = metaIndexItems()
    const month = items.map((i) => i.month).sort().at(-1)!
    const inMonth = items.filter((i) => i.month === month)
    const pick = inMonth.reduce((a, b) => (b.battles > a.battles || (b.battles === a.battles && b.match === 'bo1') ? b : a))
    return (JSON.parse(readFileSync(new URL(`../src/data/meta/m-c/${month}-${pick.match}.json`, import.meta.url), 'utf8')) as { entries: Entry[] }).entries
  }
  /** 처음 고른 종은 대표 세트로 채운다(R11): 그 항목 대표 세트 기술(게임 데이터에 없는 id 건너뜀)의 한국어 이름, 모자라면 빈칸 */
  function expectedMoves(id: string): string[] {
    const entry = defaultEntries().find((e) => e.id === id)!
    const top = entry.representative.set.moves.filter((m) => m in data.moves).slice(0, 4).map((m) => label(data.moves[m]))
    return [0, 1, 2, 3].map((i) => top[i] ?? '')
  }
  const moveBoxes = (page: Page) => [1, 2, 3, 4].map((i) => combo(mySet(page), `기술 ${i}`))
  const movesNow = (page: Page) => Promise.all(moveBoxes(page).map((m) => m.inputValue()))
  async function chooseSpecies(page: Page, text: string) {
    const species = combo(mySet(page), '종')
    await species.fill(text)
    await species.press('Enter')
    await expect(species).toHaveValue(text)
  }

  test('목록 안 종(메가 폼 포함)으로 바꾸면 그 종 대표 세트 기술, 목록 밖 종·같은 종 재확정이면 기술 그대로', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const entries = defaultEntries()
    const ids = new Set(entries.map((e) => e.id))
    const before = await movesNow(page)
    expect(before.every((m) => m !== '')).toBe(true)

    // 1위 종(예시 세트와 다른 종)
    const top = entries.find((e) => e.id !== 'garchomp')!
    await chooseSpecies(page, label(data.species[top.id]))
    const want = expectedMoves(top.id)
    expect(want).not.toEqual(before)
    for (const [i, box] of moveBoxes(page).entries()) await expect(box).toHaveValue(want[i])
    await waitComplete(page)
    await expect(tabPanel(page).getByTestId('tab-error')).toHaveCount(0)

    // 메가 폼: 메가 폼 항목의 기술
    const mega = entries.find((e) => data.species[e.id]?.isMega)!
    expect(mega, '메가 항목').toBeDefined()
    await chooseSpecies(page, label(data.species[mega.id]))
    const megaWant = expectedMoves(mega.id)
    for (const [i, box] of moveBoxes(page).entries()) await expect(box).toHaveValue(megaWant[i])

    // 같은 종을 다른 표기(id)로 다시 확정: 손으로 바꾼 기술 유지
    await moveBoxes(page)[3].fill('')
    await moveBoxes(page)[3].press('Enter')
    await expect(moveBoxes(page)[3]).toHaveValue('')
    await chooseSpecies(page, mega.id)
    await expect(moveBoxes(page)[3]).toHaveValue('')
    expect((await movesNow(page)).slice(0, 3)).toEqual(megaWant.slice(0, 3))

    // 목록 밖 종: 기술 그대로
    // 목록에 메가 항목만 있는 원종(리자몽 등)이 있으면 그것: 원종 항목 대신 메가 항목을 쓰지 않는다
    const outside = !ids.has('charizard') && data.species.charizard ? 'charizard' : Object.keys(data.species).find((id) => !ids.has(id) && !data.species[id].isMega)!
    expect(ids.has(outside)).toBe(false)
    const kept = await movesNow(page)
    await chooseSpecies(page, label(data.species[outside]))
    // 종 확정이 반영된 뒤에도(도구 잠금 풀림) 기술은 그대로
    await expect(mySet(page).getByText('메가 폼 고정')).toHaveCount(0)
    expect(await movesNow(page)).toEqual(kept)
  })

  test('메가 항목이 없는 메가 폼은 원종 항목 대표 세트 기술, 오타를 거쳐 같은 종으로 돌아오면 손으로 고친 기술 유지', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const ids = new Set(defaultEntries().map((e) => e.id))
    // 기본 통계에 메가 항목은 없고 원종 항목만 있는 메가(예: venusaurmega·excadrillmega)
    const lone = data.megas.find((m) => !ids.has(m.forme) && ids.has(m.base) && data.species[m.forme])
    expect(lone, '원종 항목만 있는 메가').toBeDefined()
    await chooseSpecies(page, label(data.species[lone!.forme]))
    const want = expectedMoves(lone!.base)
    for (const [i, box] of moveBoxes(page).entries()) await expect(box).toHaveValue(want[i])

    // 손으로 기술 4를 비운 뒤 종 칸에 풀리지 않는 이름을 확정했다가 같은 종으로 돌아온다
    await moveBoxes(page)[3].fill('')
    await moveBoxes(page)[3].press('Enter')
    await expect(moveBoxes(page)[3]).toHaveValue('')
    await chooseSpecies(page, '없는포켓몬')
    await chooseSpecies(page, label(data.species[lone!.forme]))
    await expect(moveBoxes(page)[3]).toHaveValue('')
    expect((await movesNow(page)).slice(0, 3)).toEqual(want.slice(0, 3))
  })
})
