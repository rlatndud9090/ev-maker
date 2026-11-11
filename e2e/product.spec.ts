import { expect, test, type Locator, type Page } from '@playwright/test'
import { cards, combo, mySet, openProduct, region, resultTab, selectTab, tabPanel, waitComplete } from './helpers'

const toolbarSpin = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true })
const customPanel = (page: Page) => region(page, '목록 밖 포켓몬 추가')
const ladderCards = (page: Page) => cards(page).and(page.locator('[data-origin="ladder"]'))
const customCards = (page: Page) => cards(page).and(page.locator('[data-origin="custom"]'))
const cardLine = (card: Locator) => card.locator('button[aria-expanded]').first()

/** 래더 카드의 사용률 순위 목록(화면에는 보이지 않고 카드 data-rank로만 싣는다). */
async function ladderRanks(page: Page): Promise<{ opponent: string; rank: number }[]> {
  return ladderCards(page).evaluateAll((els) =>
    els.map((el) => ({ opponent: (el as HTMLElement).dataset.opponent ?? '', rank: Number((el as HTMLElement).dataset.rank) })),
  )
}

/** 목록 밖 타겟 추가 패널에서 종·기술을 고르고 [추가]. */
async function addCustomTarget(page: Page, species: string, moves: string[]) {
  await page.getByRole('button', { name: '목록 밖 포켓몬 추가', exact: true }).click()
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

  test('펼친 상세: 행·0~32 띠·현재값·예산 밖 칸 구분, 접힌 줄 대표 문구·외 k행(AC9·AC19)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const withMore = cards(page).filter({ has: page.getByTestId('card-more') }).first()
    await expect(withMore.getByTestId('card-more')).toHaveText(/^외 \d+행$/)
    // 목표 문구는 간단행에 없고(사용자 피드백 2026-11-11) 펼친 상세 행에만 있다.
    await expect(tabPanel(page).getByTestId('headline-target')).toHaveCount(0)
    await cardLine(cards(page).first()).click()
    await expect(cards(page).first().getByTestId('row-target').first()).toHaveText(/^ · \S+: 최소 A\d+ 필요( \(다른 능력치에서 \d+ 필요\))?$/)

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
    // 현재 판정은 목표 문구와 같은 4단 라벨(한 줄 한 어휘).
    await expect(row.locator('.row-judge')).toHaveText(/현재 H\d+ (확정1타|중고난수1타|저난수1타|확정견딤) · /)
    // 상세 행도 경계 문구 대신 H·B/D 함께 조정한 최소 조합 목표.
    await expect(row.getByTestId('row-target')).toHaveText(/^ · \S+: 최소 H\d+ [BD]\d+ 필요( \(다른 능력치에서 \d+ 필요\))?$/)
    await expect(row.locator('.row-judge')).not.toContainText(/까지 줄여도|부터/)
    await expect(cells.first()).toHaveAttribute('title', /^0: (확정 버팀|저난수 1타|중난수 이상)/)
    await expect(row.locator('.band-legend .span').first()).toHaveText(/\d+(~\d+)? (확정 버팀|저난수 1타|중난수 이상)/)
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
    const open = page.getByRole('button', { name: '목록 밖 포켓몬 추가', exact: true })
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

    // 공격 탭: 내 기술은 전부 물리라 물리 분류 프리셋 3장.
    await waitComplete(page)
    await expect(customCards(page)).toHaveCount(3)
    await expect(customCards(page).first()).toContainText('출처: 사용자 지정')
    for (const text of await customCards(page).locator('.card-line').allTextContents()) expect(text).not.toMatch(/%/)

    // 방어 탭: 고른 기술 분류(특수 하이드로펌프·물리 폴터가이스트)마다 3장.
    await selectTab(page, '방어')
    await waitComplete(page)
    const defense = await customCards(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.category))
    expect(defense.filter((c) => c === 'special')).toHaveLength(3)
    expect(defense.filter((c) => c === 'physical')).toHaveLength(3)

    await selectTab(page, '스피드')
    await waitComplete(page)
    await expect(customCards(page)).toHaveCount(3)

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
    const defenseAfter = await customCards(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.category))
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

  test('Bo3로 바꾸면 그 스냅샷 출처로 바뀐다(AC13)', async ({ page }) => {
    await openProduct(page)
    const source = page.getByTestId('meta-source')
    await expect(source).toContainText('Bo1')
    await combo(page, '매치 방식').selectOption('bo3')
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
    const match = combo(page, '매치 방식')
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

  test('간단행의 대표 행이 랭크 행이면 기술 라벨에 랭크를 합친다(대도각참 칼춤 → "+2 아이언헤드")', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    // 랭크 행 대표면 근거는 기술 라벨 안의 랭크로 보이고, 별도 근거 태그는 스카프 행에만 남는다.
    await expect(tabPanel(page).getByTestId('headline-basis').and(page.locator('[data-row-kind="rank"]'))).toHaveCount(0)
    const gambit = cards(page).filter({ hasText: '대도각참' }).getByTestId('move-label').filter({ hasText: '아이언헤드' }).filter({ has: page.getByTestId('move-rank') })
    await expect(gambit.first()).toContainText('+2 아이언헤드')
    await expect(gambit.first().getByTestId('move-rank')).toHaveText('+2')
    await expect(gambit.first()).toHaveAttribute('data-type', 'steel')
    await expect(gambit.first().locator('img[data-type-icon="steel"]')).toHaveCount(1)
    // 아이콘 → 랭크 → 기술명 순서.
    const order = await gambit.first().evaluate((el) => [...el.children].map((c) => c.getAttribute('data-type-icon') ?? c.className))
    expect(order.filter((c) => c !== 'sr-only')).toEqual(['steel', 'move-rank num', 'move-name'])

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

  test('간단행: 순위·사용률·보존·판정 기호·목표 문구 없음, 배분 라벨 + 비중, 타입 기술 라벨, 상세에 "최소 … 필요" 목표(사용자 피드백 2026-11-10·11-11)', async ({ page }) => {
    await openProduct(page)
    for (const [tab, target] of [
      ['공격', /^\S+: 최소 A\d+ 필요( \(다른 능력치에서 \d+ 필요\))?$/],
      ['방어', /^\S+: 최소 H\d+ [BD]\d+ 필요( \(다른 능력치에서 \d+ 필요\))?$/],
      ['스피드', /^\S+: 최소 S\d+ 필요( \(다른 능력치에서 \d+ 필요\))?$/],
    ] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      const lines = await ladderCards(page).locator('.card-line').allTextContents()
      expect(lines.length).toBeGreaterThan(0)
      for (const text of lines) {
        expect(text).not.toMatch(/#\d|\d+\.\d\d%|보존|[◎△×]|까지 줄여도|부터 /)
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
      for (const text of lines) expect(text).not.toMatch(/최소 .*필요/)
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
    // 배지 문구는 확정·무효만 글자, 그 사이는 1타 확률 백분율(사용자 피드백 2026-11-11). 색은 기준 단계.
    const BADGE = /^(확정1타|확정견딤|난수1타: \d+\.\d%|무효)$/
    const TONES = ['red', 'orange', 'yellow', 'green', 'gray']
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
      const cols = await tabPanel(page)
        .locator('[data-origin="ladder"] .card-line')
        .evaluateAll((lines) =>
          lines.slice(0, 8).map((line) => {
            const x = (sel: string) => line.querySelector(sel)?.getBoundingClientRect().left ?? NaN
            const more = line.querySelector('[data-testid="card-more"]')
            return {
              name: x('.card-name'),
              bundle: x('[data-testid="card-bundle"]'),
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
      expect(texts.some((t) => t.startsWith('난수1타: ')), tab).toBe(true)
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
    await expect(cardLine(charizard)).toHaveAccessibleName(/확정1타/)

    // F3 통과: 한카리아스 adamant(A32↑) 드래곤클로는 내 H2·B0에서 1타 확률 2/16(B3부터 확정 버팀) → 저난수 기준 2/16 이하라 노랑.
    await selectTab(page, '방어')
    await waitComplete(page)
    const garchomp = ladderCards(page)
      .and(page.locator('[data-opponent="garchomp"]'))
      .filter({ has: page.locator('.card-bundle', { hasText: /^A32↑/ }) })
      .filter({ has: page.getByTestId('card-headline').filter({ hasText: '드래곤클로' }) })
    await expect(garchomp.getByTestId('ko-badge')).toHaveText('난수1타: 12.5%')
    await expect(garchomp.getByTestId('ko-badge')).toHaveAttribute('data-tone', 'yellow')

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

  test('툴바 판정 기준: 공격 고난수 14/16(87.5%)·방어 저난수 2/16(12.5%), 바꾸면 배지 색 단계가 바뀌고 1~15 밖은 반영하지 않는다(사용자 피드백 2026-11-11)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const field = page.getByTestId('roll-threshold')
    const high = page.getByRole('spinbutton', { name: '고난수 기준', exact: true })
    await expect(field).toHaveCount(1)
    await expect(high).toHaveValue('14')
    await expect(field.getByTestId('roll-percent')).toHaveText('(87.5%)')
    await expect(field).toContainText('/16')
    // 스크린 리더가 단위와 반영 백분율을 함께 읽는다(접근 가능한 설명)
    await expect(high).toHaveAccessibleDescription('/16 (87.5%)')

    await selectTab(page, '스피드')
    await expect(page.getByTestId('roll-threshold')).toHaveCount(0)

    await selectTab(page, '방어')
    await waitComplete(page)
    const low = page.getByRole('spinbutton', { name: '저난수 기준', exact: true })
    await expect(low).toHaveValue('2')
    await expect(field.getByTestId('roll-percent')).toHaveText('(12.5%)')
    // F3 통과 카드: 1타 확률 2/16 — 저난수 기준 2/16에서는 노랑, 1/16로 내리면 중고난수(주황). 문구는 확률 그대로.
    const garchomp = ladderCards(page)
      .and(page.locator('[data-opponent="garchomp"]'))
      .filter({ has: page.locator('.card-bundle', { hasText: /^A32↑/ }) })
      .filter({ has: page.getByTestId('card-headline').filter({ hasText: '드래곤클로' }) })
    const badge = garchomp.getByTestId('ko-badge')
    await expect(badge).toHaveText('난수1타: 12.5%')
    await expect(badge).toHaveAttribute('data-tone', 'yellow')
    await low.fill('1')
    await expect(field.getByTestId('roll-percent')).toHaveText('(6.3%)')
    await waitComplete(page)
    await expect(badge).toHaveText('난수1타: 12.5%')
    await expect(badge).toHaveAttribute('data-tone', 'orange')

    // 범위 밖·비정수는 반영하지 않고 입력 칸 옆에 안내한다(적용 값·배지는 그대로).
    for (const bad of ['16', '0', '2.5']) {
      await low.fill(bad)
      await expect(field.getByTestId('roll-hint')).toHaveText('1~15 정수만 반영됩니다')
      await expect(low).toHaveAttribute('aria-invalid', 'true')
      await expect(low).toHaveAccessibleDescription('/16 (6.3%) 1~15 정수만 반영됩니다')
      await expect(field.getByTestId('roll-percent')).toHaveText('(6.3%)')
      await expect(badge).toHaveAttribute('data-tone', 'orange')
    }
    await low.fill('2')
    await expect(field.getByTestId('roll-hint')).toHaveCount(0)
    await waitComplete(page)
    await expect(badge).toHaveAttribute('data-tone', 'yellow')
    await low.blur()
    await expect(low).toHaveValue('2')
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
