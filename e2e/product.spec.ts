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
const ladderCards = (page: Page) => cards(page).and(page.locator('[data-origin="ladder"]'))
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

  test('카드 상세 행은 조건(기본·랭크 수단)마다 가장 센 기술 하나 + 선공기만, 포푸니크 최대 배분은 변화 없음(고정 판정)(사용자 피드백 2026-11-11·11-12)', async ({ page }) => {
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
          rows: [...el.querySelectorAll<HTMLElement>('[data-testid="row"]')].map((r) => ({
            move: r.dataset.move ?? '',
            condition: r.dataset.condition ?? '',
            status: r.dataset.status ?? '',
            priority: r.dataset.priorityKept === 'true',
            tag: r.querySelector('[data-testid="priority-tag"]') !== null,
          })),
        })),
      )
      for (const c of byCard) {
        const strongest = new Map<string, Set<string>>()
        for (const r of c.rows) {
          expect(r.tag, c.id).toBe(r.priority)
          if (r.priority || r.status === 'error') continue
          strongest.set(r.condition, new Set([...(strongest.get(r.condition) ?? []), r.move]))
        }
        for (const [condition, moves] of strongest) expect([...moves], `${tab} ${c.id} ${condition}`).toHaveLength(1)
      }
      // 방어 탭은 행이 H행·B/D행 쌍이라 한 조건에 행이 2개다(기술은 하나).
      if (tab === '방어') expect(byCard.some((c) => c.rows.filter((r) => r.condition === 'base' && !r.priority).length === 2)).toBe(true)
    }
    // 예시 세트 공격 탭: 포푸니크 최대 배분(H2 B0)은 분함의발구르기가 무투자 확정1타라(드래곤클로 행 없음) 변화 없음이다.
    // 기본 기준(5%)에선 다른 포푸니크 배분도 변화 없음이라 행이 목록에서 빠진다.
    await selectTab(page, '공격')
    await waitComplete(page)
    const sneasler = ladderCards(page).and(page.locator('[data-opponent="sneasler"]'))
    await expect(sneasler).toHaveCount(0)
    // 기준을 0.5%로 낮추면 판정이 바뀌는 다른 배분이 생겨 행이 남고(2026-11-12), 기본 선택(최대 배분)은 고정 판정 배지로 보인다.
    await page.getByRole('button', { name: '표시 기준', exact: true }).click()
    const min = toolbarSpin(page, '배분 최소비중(%)')
    await min.fill('0.5')
    await min.blur()
    await waitComplete(page)
    await expect(sneasler).toHaveCount(1)
    await expect(sneasler.getByTestId('card-bundle')).toHaveText(/^H2 B0 \d+\.\d%$/)
    await expect(sneasler).toHaveAttribute('data-headline', 'no-change')
    await expect(sneasler.getByTestId('ko-badge')).toHaveText('확정1타')
    await expect(sneasler.getByTestId('move-label')).toHaveCount(0)
    await bundleButton(sneasler).click()
    await expect(bundleMenu(sneasler).locator('[role="menuitemradio"]:not([data-headline="no-change"])').first()).toBeVisible()
    await bundleMenu(sneasler).press('Escape')
  })

  test('펼친 상세: 행·0~32 띠·현재값·예산 밖 칸 구분, 접힌 줄 대표 문구·외 k행(AC9·AC19)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 외 k행은 남은 행(조건당 가장 센 기술 + 선공기) 기준. 예시 세트 공격 탭은 카드마다 한 행이라 방어 탭(H행·B/D행 쌍)에서 본다.
    await selectTab(page, '방어')
    await waitComplete(page)
    const withMore = cards(page).filter({ has: page.getByTestId('card-more') }).first()
    await expect(withMore.getByTestId('card-more')).toHaveText(/^외 \d+행$/)
    await cardLine(withMore).click()
    await expect(withMore.locator('.card-detail')).toBeVisible()
    const shownRows = await withMore.locator('[data-testid="row"]').count()
    await expect(withMore.getByTestId('card-more')).toHaveText(`외 ${shownRows - 1}행`)
    await cardLine(withMore).click()
    await expect(cardLine(withMore)).toHaveAttribute('aria-expanded', 'false')
    await selectTab(page, '공격')
    await waitComplete(page)
    // 목표 문구는 간단행에 없고(사용자 피드백 2026-11-11) 펼친 상세 행에만 있다.
    await expect(tabPanel(page).getByTestId('headline-target')).toHaveCount(0)
    // 기본 선택이 변화 없음 배분인 행은 목표가 없으므로 대표 행이 있는 첫 행에서 본다.
    const withRow = cards(page).and(page.locator('[data-headline="row"]')).first()
    await cardLine(withRow).click()
    await expect(withRow.getByTestId('row-target').first()).toHaveText(new RegExp(`^ · ${targetPattern('A\\d+')}$`))

    // 방어 탭 H 행: 내 H는 2, 잔여 0이라 3 이상은 예산 밖.
    await selectTab(page, '방어')
    await waitComplete(page)
    const card = cards(page).first()
    await cardLine(card).click()
    await expect(cardLine(card)).toHaveAttribute('aria-expanded', 'true')
    const row = card.getByTestId('row').filter({ has: page.getByTestId('band-cell') }).first()
    const cells = row.getByTestId('band-cell')
    await expect(cells).toHaveCount(33)
    await expect(row.locator('[aria-current="true"]')).toHaveCount(1)
    const current = Number(await row.locator('[aria-current="true"]').getAttribute('data-sp'))
    const over = await cells.evaluateAll((els) => els.map((e) => ({ sp: Number((e as HTMLElement).dataset.sp), over: (e as HTMLElement).dataset.overBudget === 'true' })))
    expect(over.filter((c) => c.sp <= current).every((c) => !c.over)).toBe(true)
    expect(over.filter((c) => c.sp > current).every((c) => c.over)).toBe(true)
    await expect(row.locator('.band-legend')).toContainText('빗금 = 예산 밖')
    // 띠가 자체 가로 스크롤 컨테이너 안에 있다.
    await expect(row.locator('.band-scroll .band')).toHaveCount(1)
    // 판정은 색만이 아니라 텍스트 라벨로도 보인다(AC19).
    // 현재 판정은 목표 문구와 같은 5단 단계명(한 줄 한 어휘).
    await expect(row.locator('.row-judge')).toHaveText(new RegExp(`현재 H\\d+ ${TIER} · `))
    // 상세 행도 경계 문구 대신 H·B/D 함께 조정한 최소 조합 목표 — 무보정 / B·D 상승(사용자 피드백 2026-11-11 2차).
    await expect(row.getByTestId('row-target')).toHaveText(new RegExp(`^ · ${targetPattern('H\\d+ [BD]\\d+')}$`))
    await expect(row.locator('.row-judge')).not.toContainText(/까지 줄여도|부터/)
    await expect(cells.first()).toHaveAttribute('title', new RegExp(`^0: ${TIER}`))
    await expect(row.locator('.band-legend .span').first()).toHaveText(new RegExp(`\\d+(~\\d+)? ${TIER}`))
    // 띠 칸 색은 결과 배지와 같은 5색(판정 → 색 한 가지 대응).
    const tones = await cells.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.category, [...e.classList].find((c) => c.startsWith('ko-'))]))
    const toneOf = new Map(tones.map(([c, t]) => [c, t]))
    expect(toneOf.size).toBe(new Set(tones.map(([c, t]) => `${c}|${t}`)).size)
    // 다른 판정은 다른 색(두 단계가 한 색을 나눠 쓰면 실패), 모든 칸에 색 클래스가 있다.
    expect([...toneOf.values()].every((t) => t !== undefined)).toBe(true)
    expect(new Set(toneOf.values()).size).toBe(toneOf.size)
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
      const pick = combo(page, '포켓몬 선택')
      await pick.fill(name!)
      await page.getByRole('listbox', { name: '포켓몬 선택 후보' }).getByRole('option', { name: name!, exact: true }).click()
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

    // 방어 탭: 계획은 분류(특수 하이드로펌프·물리 폴터가이스트)마다 3장이지만, 가장 센 기술은 분류를 가로질러 고르므로
    // 하이드로펌프가 폴터가이스트보다 센 물리 프리셋 카드 3장은 빠지고 특수 3장만 보인다(사용자 피드백 2026-11-11).
    await selectTab(page, '방어')
    await waitComplete(page)
    await expect(customCards(page)).toHaveCount(1)
    const defense = (await bundleOptions(customCards(page))).map((o) => o.category)
    expect(defense.filter((c) => c === 'special')).toHaveLength(3)
    expect(defense.filter((c) => c === 'physical')).toHaveLength(0)

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

  test('카드 묶음은 그 탭에 관련된 SP만 보이고(AC3), 랭크 행은 수단·점유율 근거를 보인다(AC8)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 공격 탭(내 기술 전부 물리): 상대 H·B만.
    for (const text of await ladderCards(page).locator('.card-bundle').allTextContents()) expect(text).toMatch(/^(H\d+[↑↓]?)?( ?B\d+[↑↓]?)? (\d+\.\d%|소수 배분)$/)

    // 방어 탭 상대 랭크 수단(칼춤 등)의 랭크 행: 열어 보며 첫 랭크 행을 찾는다.
    await selectTab(page, '방어')
    await waitComplete(page)
    let basis: string | null = null
    const n = await cards(page).count()
    for (let i = 0; i < n && basis === null; i++) {
      const card = cards(page).nth(i)
      await cardLine(card).click()
      const rank = card.locator('[data-testid="row"][data-row-kind="rank"] .row-basis')
      if ((await rank.count()) > 0) basis = await rank.first().textContent()
    }
    expect(basis).toMatch(/^상대 \S+ \d+\.\d% · 상대 [ABCDS][+−]\d/)

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
    await expect(combo(page, '통계 기준')).toHaveValue('bo1')
    await expect(page.getByTestId('meta-source')).toHaveText(`통계 Bo1 · ${month} · 컷 1760 · ${bo1?.format}`)
  })

  test('Bo3로 바꾸면 그 스냅샷 출처로 바뀐다(AC13)', async ({ page }) => {
    await openProduct(page)
    const source = page.getByTestId('meta-source')
    await expect(source).toContainText('Bo1')
    await combo(page, '통계 기준').selectOption('bo3')
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
    const match = combo(page, '통계 기준')
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
    // 아이콘 → 랭크 → 기술명 순서.
    const order = await gambit.first().evaluate((el) => [...el.children].map((c) => c.getAttribute('data-type-icon') ?? c.className))
    expect(order.filter((c) => c !== 'sr-only')).toEqual(['dark', 'move-rank num', 'move-name'])

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
      const first = withLabel.first()
      await cardLine(first).click()
      const targets = await first.getByTestId('row-target').allTextContents()
      expect(targets.length).toBeGreaterThan(0)
      for (const t of targets) expect(t.replace(/^ · /, '')).toMatch(target)
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
    await expect(me.getByText('메가 폼 고정')).toBeVisible()
    await waitComplete(page)
    await expect(tabPanel(page).getByTestId('tab-error')).toHaveCount(0)

    // 일반 폼으로 돌아오면 스톤을 비우고 도구를 다시 고를 수 있다.
    await species.fill('한카리아스')
    await species.press('Enter')
    const item = combo(me, '도구')
    await expect(item).toBeEnabled()
    await expect(item).toHaveValue('')
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
      // 기본 선택이 변화 없음 배분인 행(기술 라벨 없음)은 열 정렬 비교에서 뺀다.
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
      // 물리/특수 분류 배지·변화 없음 요약은 없다(계약 속성 data-category는 남는다).
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

  test('같은 포켓몬은 탭마다 한 행만', async ({ page }) => {
    await openProduct(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    for (const tab of ['공격', '방어', '스피드'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      const keys = await cards(page).evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.origin}/${(e as HTMLElement).dataset.opponent}`))
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

  test('펼친 상세 맨 위 배분 탭: 사용률 순, 탭을 고르면 상세·행 배지가 바뀌고 펼침은 유지', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    const row = await multiRow(page)
    await cardLine(row).click()
    const tabs = row.getByTestId('bundle-tabs')
    await expect(tabs).toBeVisible()
    await expect(tabs).toHaveAttribute('role', 'tablist')
    await expect(tabs).toHaveAccessibleName('노력치 배분')
    // 상세 영역 맨 위
    expect(await row.locator('.card-detail').evaluate((d) => d.firstElementChild?.getAttribute('data-testid'))).toBe('bundle-tabs')
    const tab = tabs.getByRole('tab')
    const texts = await tab.allTextContents()
    expect(texts.length).toBeGreaterThan(1)
    const majors = texts.map(shareOf).filter((s) => s >= 0)
    expect(majors).toEqual([...majors].sort((a, b) => b - a))
    await expect(tab.first()).toHaveAttribute('aria-selected', 'true')
    expect(texts[0]).toBe(await row.getByTestId('card-bundle').textContent())
    expect(await tabs.evaluate((el) => ({ overflowX: getComputedStyle(el).overflowX, whiteSpace: getComputedStyle(el).whiteSpace }))).toEqual({
      overflowX: 'auto',
      whiteSpace: 'nowrap',
    })

    const detail = () => row.locator('.card-detail .rows').innerHTML()
    const detailBefore = await detail()
    const id = await tab.nth(1).getAttribute('data-card-id')
    await tab.nth(1).click()
    await expect(tab.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(tab.first()).toHaveAttribute('aria-selected', 'false')
    await expect(row).toHaveAttribute('data-card-id', id!)
    await expect(row.getByTestId('card-bundle')).toHaveText(texts[1])
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(detail).not.toBe(detailBefore)

    // ←/→로도 옮긴다.
    await tab.nth(1).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(tab.first()).toHaveAttribute('aria-selected', 'true')
    await expect(tab.first()).toBeFocused()
    await expect(cardLine(row)).toHaveAttribute('aria-expanded', 'true')

    // Home/End는 처음·마지막 배분으로.
    await page.keyboard.press('End')
    await expect(tab.last()).toHaveAttribute('aria-selected', 'true')
    await expect(tab.last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(tab.first()).toHaveAttribute('aria-selected', 'true')

    // 탭은 아래 tabpanel을 가리키고, 패널 이름은 선택 탭이다.
    const panel = row.getByRole('tabpanel')
    await expect(panel).toHaveCount(1)
    const panelId = await panel.getAttribute('id')
    for (const t of await tab.all()) await expect(t).toHaveAttribute('aria-controls', panelId!)
    await expect(panel).toHaveAttribute('aria-labelledby', (await tab.first().getAttribute('id'))!)
    await expect(panel.locator('.rows')).toHaveCount(1)
  })

  test('표시 기준: "배분 선택지 수"는 없고 "배분 최소비중(%)" 기본 5', async ({ page }) => {
    await openProduct(page)
    await page.getByRole('button', { name: '표시 기준', exact: true }).click()
    await expect(toolbarSpin(page, '배분 최소비중(%)')).toHaveValue('5')
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
    await page.getByRole('button', { name: '표시 기준', exact: true }).click()
    const minField = toolbarSpin(page, '배분 최소비중(%)')
    await minField.fill('0.5')
    await minField.blur()
    // 상한(3장)이 없으므로 기준을 0.5%로 낮추면 5행 합이 15를 넘는다(실제 스냅샷).
    expect(await menuTotal(0.5)).toBeGreaterThan(15)
  })

  test('묶음 기준 100%면 선택지가 하나라도 래더 배지는 버튼(직접 추가 폼), 상세에 배분 탭은 없다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await page.getByRole('button', { name: '표시 기준', exact: true }).click()
    const min = toolbarSpin(page, '배분 최소비중(%)')
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
    await expect(row.getByTestId('bundle-tabs')).toHaveCount(0)
  })
})

test.describe('배분 직접 추가(사용자 피드백 2026-11-12)', () => {
  const addForm = (row: Locator) => bundleMenu(row).getByTestId('bundle-add')
  const spInput = (row: Locator, stat: string) => addForm(row).getByRole('spinbutton', { name: `직접 추가 SP ${stat}`, exact: true })
  const addButton = (row: Locator) => addForm(row).getByRole('button', { name: '추가', exact: true })
  const bg = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
  /** 사용자 배분 면 토큰(--user-bundle-bg)을 계산된 rgb로: 같은 배경을 칠한 탐침 요소로 푼다 */
  const userBg = (page: Page) =>
    page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--user-bundle-bg)'
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

  test('추가 → 맨 위에 다른 배경 "직접 추가" 항목 + 자동 선택(배지도 다른 배경, 결과 갱신), × 삭제 → 기본 배분으로', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const row = await firstRow(page)
    const before = { id: await row.getAttribute('data-card-id'), text: (await row.getByTestId('card-bundle').textContent()) ?? '' }
    const tint = await userBg(page)
    expect(tint).toMatch(/^rgb/)
    // 일반(관측) 배지는 포커스 없이 사용자 면 색이 아니다
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

    await expect(row.getByTestId('card-bundle')).toHaveText('H31 B3 직접 추가')
    await expect(row).toHaveAttribute('data-user-added', 'true')
    await expect(row).not.toHaveAttribute('data-card-id', before.id!)
    await expect(bundleButton(row)).toHaveClass(/user-bundle/)
    await page.mouse.move(0, 0)
    // 포커스 없이: 사용자 면 색
    await bundleButton(row).evaluate((el) => (el as HTMLElement).blur())
    await expect(bundleButton(row)).not.toBeFocused()
    await expect.poll(() => bg(bundleButton(row))).toBe(tint)
    // 키보드 포커스(:focus-visible)여도 사용자 면 색이 유지된다(포커스는 윤곽선만)
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
    await expect(items.first().locator('.bundle-opt-label')).toHaveText('H31 B3 직접 추가')
    await expect(items.first().locator('.ko-badge')).toHaveCount(1)
    await expect(items.nth(1)).not.toHaveAttribute('data-user-added', 'true')
    await expect(items.nth(1).locator('.bundle-opt-label')).toHaveText(before.text)
    // 호버를 항목 밖(추가 폼 라벨)으로 옮긴 뒤: 선택된 사용자 항목도 사용자 면 색, 관측 항목은 아니다
    await addForm(row).locator('label').first().hover()
    await expect.poll(() => bg(items.first())).toBe(tint)
    expect(await bg(items.nth(1))).not.toBe(tint)

    // 상세 배분 탭도 같은 면 색, 맨 앞
    await bundleMenu(row).press('Escape')
    await cardLine(row).click()
    const tabs = row.getByTestId('bundle-tabs').getByRole('tab')
    await expect(tabs.first()).toHaveAttribute('data-user-added', 'true')
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.first()).toHaveClass(/user-bundle/)
    await page.mouse.move(0, 0)
    await expect.poll(() => bg(tabs.first())).toBe(tint)
    expect(await bg(tabs.nth(1))).not.toBe(tint)
    await cardLine(row).click()

    // 두 번째 추가는 첫 번째 뒤(추가 순), 둘 다 맨 위
    await bundleButton(row).click()
    await spInput(row, 'HP').fill('30')
    await spInput(row, '방어').fill('5')
    await addButton(row).click()
    await waitComplete(page)
    await expect(row.getByTestId('card-bundle')).toHaveText('H30 B5 직접 추가')
    await bundleButton(row).click()
    await expect(bundleMenu(row).locator('.bundle-opt-label').first()).toHaveText('H31 B3 직접 추가')
    await expect(bundleMenu(row).locator('.bundle-opt-label').nth(1)).toHaveText('H30 B5 직접 추가')

    // 삭제: 선택돼 있던 H30 B5를 지우면 기본(최고 비중) 배분으로 돌아간다.
    const del = bundleMenu(row).getByRole('menuitem', { name: '직접 추가 배분 삭제' })
    await expect(del).toHaveCount(2)
    await del.nth(1).click()
    await expect(bundleMenu(row)).toHaveCount(0)
    await waitComplete(page)
    await expect(row).toHaveAttribute('data-card-id', before.id!)
    await expect(row.getByTestId('card-bundle')).toHaveText(before.text)
    await expect(bundleButton(row)).not.toHaveClass(/user-bundle/)
    await bundleButton(row).click()
    await expect(bundleMenu(row).locator('[data-user-added="true"]')).toHaveCount(1)
    await expect(bundleMenu(row).locator('.bundle-opt-label').first()).toHaveText('H31 B3 직접 추가')
    // 선택돼 있지 않던 것을 지우면 선택은 그대로
    await bundleMenu(row).getByRole('menuitem', { name: '직접 추가 배분 삭제' }).click()
    await waitComplete(page)
    await expect(row).toHaveAttribute('data-card-id', before.id!)
    await bundleButton(row).click()
    await expect(bundleMenu(row).locator('[data-user-added="true"]')).toHaveCount(0)
  })

  test('관측 배분과 같은 값을 추가하면 새 항목 없이 그 배분을 고른다', async ({ page }) => {
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
    await expect(row.getByTestId('card-bundle')).toHaveText(texts[at])
    await expect(tabPanel(page)).not.toHaveAttribute('data-superseded', 'true')
    await bundleButton(row).click()
    await expect(bundleMenu(row).locator('[data-user-added="true"]')).toHaveCount(0)
    await expect(bundleMenu(row).getByRole('menuitemradio')).toHaveCount(texts.length)
  })

  test('변화 없음 배분도 선택지: 고르면 행 배지가 고정 판정(펼치면 변화 없음 행)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 메뉴 항목 data-headline="no-change" = 그 배분은 모든 행이 변화 없음
    const rows = ladderCards(page).filter({ has: page.locator('button.bundle-btn') })
    const n = await rows.count()
    let found: Locator | null = null
    for (let i = 0; i < n && found === null; i++) {
      const row = rows.nth(i)
      await bundleButton(row).click()
      const opt = bundleMenu(row).locator('[role="menuitemradio"][data-headline="no-change"]')
      if ((await opt.count()) > 0) {
        const key = await row.getAttribute('data-group-key')
        found = cards(page).and(page.locator(`[data-group-key='${key}']`))
        await expect(opt.first().locator('.ko-badge')).toHaveCount(1)
        await opt.first().click()
      } else await bundleMenu(row).press('Escape')
    }
    expect(found, '변화 없음 배분 선택지가 있는 행').not.toBeNull()
    const row = found!
    await expect(row).toHaveAttribute('data-headline', 'no-change')
    await expect(row.getByTestId('ko-badge')).toBeVisible()
    await expect(row.getByTestId('ko-badge')).toHaveText(new RegExp(`^${TIER}`))
    await cardLine(row).click()
    await expect(row.locator('.card-detail .rows li').first()).toBeVisible()
  })
})
