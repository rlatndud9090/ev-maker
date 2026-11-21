// 컷 고정(cut-lock-budget PRD) 화면 수용 기준: AC1(스피드)·AC4~AC9·AC11·AC14·AC16, 키보드·읽기 이름, 합계 78 강등, R18·R19, 고정 중 변동 팝오버 R21~R24.
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  NATURE_STATS,
  adjustButton,
  adjustMenu,
  adjustNature,
  adjustResult,
  badge,
  badgePin,
  cards,
  fillMySet,
  lockBadge,
  lockList,
  lockRow,
  lockedSp,
  moveCard,
  mySet,
  openAdjust,
  openBadge,
  openProduct,
  pinItem,
  pinMenu,
  pinNature,
  selectTab,
  settle,
  speedDetail,
  tabPanel,
  waitComplete,
  type ProductTab,
} from './helpers'

/** AC1 세트: 메가라이츄Y, 무보정, SP 전부 0, 메가스톤 외 도구 없음 */
const RAICHU_Y = {
  species: '메가라이츄Y',
  moves: ['10만볼트', '기합구슬', '풀묶기', '볼트체인지'],
  sp: { HP: 0, 공격: 0, 방어: 0, 특공: 0, 특방: 0, 스피드: 0 },
  plus: null,
} as const

/** 최속 120족(실수치 189, 사용률 1위 120족 S32 상승)·준속 120족(172, S32 무보정) */
const FASTEST_120 = /^메가눈여아 S32 성격 상승, 실수치 189/
const NEUTRAL_120 = /^포푸니크 S32 성격 무보정, 실수치 172/

/** 스피드 배지 상세의 갈래 줄 */
const branchLines = (scope: Locator) => scope.getByTestId('lock-branch')
/** 변동 항목의 능력치별 SP 글자(고정 능력치는 "H0 고정"처럼 읽기 표지가 붙는다) */
const adjustSps = (item: Locator) => item.locator('.adjust-sp')
const spBox = (page: Page, stat: string) => mySet(page).getByRole('spinbutton', { name: `SP ${stat} 숫자`, exact: true })
/** 내 세트 성격 ▲·▼(고정 줄의 ▲는 기준 갈래 선택) */
const natureBtn = (page: Page, stat: (typeof NATURE_STATS)[number], dir: '상승' | '하락') => mySet(page).getByRole('button', { name: `${stat} 성격 ${dir}`, exact: true })

/** 예시 세트(한카리아스 S32 무보정 154)용 배지: 몰드류 140(S19 / S7+), 메가라이츄Y S23+ 190(스카프로만) */
const MOLDURYU_140 = /^몰드류 S32 성격 무보정, 실수치 140,/
/** 몰드류 280(모래헤치기, 예시 세트로 도달 불가) */
const MOLDURYU_280 = /^몰드류 .*실수치 280,/
const RAICHU_Y_190 = /^메가라이츄Y S23 성격 상승, 실수치 190,/

const EXAMPLE_MOVES = ['지진', '드래곤클로', '스톤샤워', '분함의발구르기'] as const
/** 나인테일 152(S31 / S18+), 비비용 155(S20+로만), 짜랑고우거 +1 168(S32+로만) */
const NINETALES_152 = /^나인테일 S32 성격 무보정, 실수치 152,/
const VIVILLON_155 = /^비비용 S32 성격 상승, 실수치 155,/
const KOMMOO_RANK_168 = /^짜랑고우거 S7 성격 무보정 \+1, 실수치 168,/

/** 계산이 끝난 핀 메뉴의 포커스는 첫 고를 수 있는 항목(없으면 첫 항목)에 있다. 그 자리를 돌려준다 */
async function expectFocusOnFirstSelectable(items: Locator): Promise<number> {
  const enabled = await items.evaluateAll((els) => els.map((e) => e.getAttribute('aria-disabled') !== 'true'))
  const at = Math.max(0, enabled.indexOf(true))
  await expect(items.nth(at)).toBeFocused()
  return at
}

/** 핀 메뉴 항목의 조정 능력치 SP 글자 "H32 B0+"(고정 표지 능력치 제외) */
const spsText = async (item: Locator): Promise<string> => (await item.locator('.adjust-sp:not(.adjust-sp-locked)').allTextContents()).map((t) => t.trim()).join(' ')

/** 카드가 펼쳐지지 않았다(상세·펼침 버튼이 없고 열린 팝업도 없다) */
async function expectNotExpanded(card: Locator) {
  await expect(card.locator('.card-detail, .card-toggle, [aria-expanded="true"]')).toHaveCount(0)
}

async function removeAllLocks(page: Page) {
  const rm = lockList(page).getByRole('button', { name: /고정 해제$/ })
  while ((await rm.count()) > 0) await rm.first().click()
  await expect(lockList(page)).toHaveCount(0)
}

/** 대표 판정 텍스트: 공격·방어 탭 앞 카드 줄 글자, 스피드 탭 배지 읽기 이름 */
async function snapshotTabs(page: Page): Promise<Record<ProductTab, string[]>> {
  const out = {} as Record<ProductTab, string[]>
  for (const t of ['공격', '방어'] as const) {
    await selectTab(page, t)
    await waitComplete(page)
    out[t] = (await cards(page).locator('.card-line').allInnerTexts()).slice(0, 12)
  }
  await selectTab(page, '스피드')
  out['스피드'] = (await page.getByTestId('speed-badge').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))).slice(0, 40)
  return out
}

test.describe('컷 고정', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000)
    await openProduct(page)
    await waitComplete(page)
  })

  test('AC1: 메가라이츄Y 스피드 컷 고정 → S 입력 고정 표시·스피드 갈래 줄 "+" 표기, 해제 후 "↑" 유지', async ({ page }) => {
    await fillMySet(page, RAICHU_Y)
    // 최속 120족은 상승안(S23+)만 닿아 갈래가 하나다(무보정 S는 32로도 189에 못 닿는다)
    await openBadge(page, FASTEST_120)
    await expect(speedDetail(page).getByTestId('speed-detail-min-sp')).toHaveText(/추월: 무보정 불가 \/ S23↑/)
    await lockBadge(page, FASTEST_120)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S23+')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockList(page).locator('.lock-sp')).toHaveText('S23+')

    // 준속 120족(172)으로 바꾸면 두 선택지 S8+ / S23
    await lockList(page).getByRole('button', { name: /고정 해제$/ }).click()
    await expect(lockList(page)).toHaveCount(0)
    await lockBadge(page, NEUTRAL_120)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S8+ / S23')

    // 스피드 탭 다른 배지 갈래 줄은 "+"
    await openBadge(page, FASTEST_120)
    const speedLines = branchLines(speedDetail(page))
    await expect(speedLines).toHaveCount(2)
    // 보는 능력치(S)가 고정이라 상승 갈래는 상승 선택지만, 고정 밖 갈래는 무보정 선택지만(189는 무보정으로 못 닿는다)
    await expect(speedLines.nth(0)).toContainText(/^S8\+일 때: 선공 S23\+/)
    await expect(speedLines.nth(1)).toContainText(/^S23일 때: 선공 무보정 불가 \/ 상승은 고정 밖/)
    for (const t of await speedLines.allInnerTexts()) expect(t).not.toContain('↑')

    // 해제하면 무고정 문구 "↑" 그대로
    await lockList(page).getByRole('button', { name: /고정 해제$/ }).click()
    await expect(lockList(page)).toHaveCount(0)
    await openBadge(page, FASTEST_120)
    await expect(speedDetail(page).getByTestId('speed-detail-min-sp')).toHaveText(/추월: 무보정 불가 \/ S23↑/)
    await expect(branchLines(speedDetail(page))).toHaveCount(0)
  })

  test('AC6: 전부 해제하면 S·성격·세 탭 결과가 고정 전과 같고, H2 A32 S32 → S 고정 → B12 → S 해제는 S를 줄여 알린다', async ({ page }) => {
    // 예시 세트(한카리아스 노력 H2 A32 S32, 합계 66)
    const before = await snapshotTabs(page)
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText(/^SP 스피드 고정됨: S\d+\+ \/ S\d+$/)
    // 고정 줄은 슬라이더·숫자 칸 모양 그대로 조작만 막고 기준 갈래(고정 밖) 값을 보인다
    await expect(spBox(page, '스피드')).toBeDisabled()
    await expect(spBox(page, '스피드')).toHaveValue('19')
    await expect(mySet(page).getByRole('slider', { name: 'SP 스피드', exact: true })).toBeDisabled()
    await expect(natureBtn(page, '스피드', '하락')).toBeDisabled()
    await removeAllLocks(page)
    await expect(spBox(page, '스피드')).toHaveValue('32')
    for (const stat of NATURE_STATS) await expect(mySet(page).getByRole('button', { name: `${stat} 성격 상승`, exact: true })).toHaveAttribute('aria-pressed', 'false')
    expect(await snapshotTabs(page)).toEqual(before)

    // 고정 S(무보정 기준 갈래 S19) 뒤 남은 예산 13에 B12를 넣고 S를 풀면 2+32+12+32 = 78 → S를 20으로 줄인다
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText(/ S19$/)
    await spBox(page, '방어').fill('12')
    await settle(page)
    await removeAllLocks(page)
    await expect(spBox(page, '스피드')).toHaveValue('20')
    const trim = mySet(page).getByTestId('lock-trim')
    await expect(trim).toHaveAttribute('role', 'status')
    await expect(trim).toContainText('S 32 → 20(합계 66 초과로 줄임)')
    await trim.getByRole('button', { name: 'SP 줄임 알림 닫기' }).click()
    await expect(trim).toHaveCount(0)
  })

  test('AC5: 구애스카프를 끼면 고정 SP가 줄고, 스카프로만 닿는 컷은 스카프를 빼면 도달 불가로 남았다가 다시 끼면 돌아온다', async ({ page }) => {
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S7+ / S19')
    await fillMySet(page, { item: '구애스카프' })
    await settle(page)
    // 122 × 1.5 = 183 > 140: SP 0으로 닿는다
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S0+ / S0')
    await removeAllLocks(page)

    // 메가라이츄Y S23+ 190: 스카프 없이는 S32+(169)로도 못 닿고, 스카프면 닿는다
    await lockBadge(page, RAICHU_Y_190)
    await settle(page)
    await expect(lockList(page).getByTestId('lock-status')).toHaveCount(0)
    await fillMySet(page, { item: '생명의구슬' })
    await settle(page)
    const item = lockList(page).locator('.lock-item')
    await expect(item).toHaveCount(1)
    await expect(item.locator('.lock-chip')).toHaveText('도달 불가')
    await expect(item.getByRole('button', { name: /보기$/ })).toHaveAccessibleDescription('도달 불가')
    // 갈래 계산에서 빠져 S 입력은 고정 표시에 상태만
    await expect(lockedSp(page, 'spe')).toContainText('도달 불가')
    await fillMySet(page, { item: '구애스카프' })
    await settle(page)
    await expect(item.locator('.lock-chip')).toHaveCount(0)
    await expect(lockedSp(page, 'spe')).toHaveText(/^SP 스피드 고정됨: S\d+\+ \/ S\d+$/)
  })

  test('AC8: 내 포켓몬 종을 바꾸면 고정 목록이 비고, 이전 종으로 돌아와도 비어 있다', async ({ page }) => {
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockList(page)).toBeVisible()
    await fillMySet(page, { species: '메가라이츄Y' })
    await expect(lockList(page)).toHaveCount(0)
    await fillMySet(page, { species: '한카리아스' })
    await expect(lockList(page)).toHaveCount(0)
    await expect(spBox(page, '스피드')).toHaveValue('32')
  })

  test('AC4: SP 합 66을 넘기는 컷은 "SP 부족(n)"·성격 충돌 컷은 "성격 충돌"로 비활성(aria-disabled, 사유는 읽기 설명)', async ({ page }) => {
    await fillMySet(page, { moves: [...EXAMPLE_MOVES.slice(0, 3), '용성군'] })
    // S31 / S18+ → 드래곤클로 A30 / A14+ → 용성군 C12 / C2+(고정 밖 갈래는 73이라 사라지고 S18+ 갈래 60이 기준)
    await lockBadge(page, NINETALES_152)
    await settle(page)
    await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    await lockRow(page, '공격', 'kommoo', 'dracometeor', '고난수1타')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(3)
    await expect(lockList(page).getByTestId('lock-status')).toHaveCount(0)
    // 짜랑고우거 +1 168은 S32+로만 닿는다: S32 + C12 + A30 = 74 → 8 초과, 상승을 S 밖에 두는 갈래는 S 무보정으로 못 닿는다
    // 걸 수 없는 배지 핀은 바로 고정하지 않고 그 한 단계 메뉴에 이유를 보인다(aria-disabled라 포커스는 남고 눌러도 고정되지 않는다)
    await openBadge(page, KOMMOO_RANK_168)
    const pin = badgePin(page, KOMMOO_RANK_168)
    await pin.click()
    const short = pin.locator('xpath=..').getByTestId('cut-pin-item')
    await expect(short).toHaveCount(1)
    await expect(short).toHaveAttribute('aria-disabled', 'true')
    await expect(short).toHaveText(/^선공\s*SP 부족\(8\)$/)
    await expect(short).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(short).toBeFocused()
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(short).toHaveCount(0)
    await expect(pin).toBeFocused()

    await removeAllLocks(page)
    // S31 / S18+ → 메가앱솔Z 드래곤클로 A20+(상승으로만) → 비비용 155(S20+로만): 상승 자리가 겹친다
    await lockBadge(page, NINETALES_152)
    await settle(page)
    await lockRow(page, '공격', 'absolmegaz', 'dragonclaw', '확정1타', 'plus')
    await openBadge(page, VIVILLON_155)
    const vivillon = badgePin(page, VIVILLON_155)
    await vivillon.click()
    const conflict = vivillon.locator('xpath=..').getByTestId('cut-pin-item')
    await expect(conflict).toHaveAttribute('aria-disabled', 'true')
    await expect(conflict.locator('.cut-pin-detail')).toHaveText('성격 충돌')
    await expect(vivillon).toHaveAttribute('aria-pressed', 'false')
  })

  test('AC9·R25: 고정 배지·고정 카드 핀 구분, 공격·방어 탭에는 갈래 줄·고정 미달·n 문구가 고정 중에도 해제 뒤에도 없다', async ({ page }) => {
    await fillMySet(page, { moves: [...EXAMPLE_MOVES.slice(0, 3), '용성군'] })
    await lockBadge(page, NINETALES_152)
    await settle(page)
    const locked = badge(page, NINETALES_152)
    await expect(locked).toHaveAttribute('data-locked', 'true')
    await expect(locked).toHaveAccessibleName(/고정됨$/)
    await expect(locked.locator('.speed-mark.locked')).toHaveText('고정됨')

    const row = await lockRow(page, '공격', 'kommoo', 'dracometeor', '고난수1타')
    await expect(row.getByTestId('cut-pin')).toHaveAttribute('data-locked', 'true')

    const noBranchUi = async () => {
      for (const t of ['공격', '방어'] as const) {
        await selectTab(page, t)
        await waitComplete(page)
        await expect(tabPanel(page).getByText(/다른 능력치에서 \d+ 필요|SP 부족\(|고정 미달/)).toHaveCount(0)
        await expect(tabPanel(page).locator('[data-testid="lock-branch"], [data-testid="below-lock"], .card-detail')).toHaveCount(0)
      }
    }
    await noBranchUi()
    await removeAllLocks(page)
    await noBranchUi()
  })

  test('AC11: 내 S에도 의존하는 기술(일렉트릭볼)이 보이는 카드의 핀은 비활성이고 이유를 툴팁·읽기 설명으로 보인다', async ({ page }) => {
    await fillMySet(page, { ...RAICHU_Y, moves: ['일렉트릭볼', '10만볼트', '기합구슬', '풀묶기'] })
    await lockBadge(page, NEUTRAL_120)
    await settle(page)
    await selectTab(page, '공격')
    await waitComplete(page)
    const electro = cards(page).and(page.locator('[data-move="electroball"]'))
    await expect(electro.first()).toBeVisible()
    const pin = electro.first().getByTestId('cut-pin')
    await expect(pin).toHaveAttribute('aria-disabled', 'true')
    await expect(pin).toHaveAttribute('title', '다른 능력치에도 의존해 고정 불가')
    await expect(pin).toHaveAccessibleDescription('다른 능력치에도 의존해 고정 불가')
    await pin.focus()
    await page.keyboard.press('Enter')
    await expect(pin).toBeFocused()
    await expect(electro.first().getByTestId('cut-pin-menu')).toHaveCount(0)
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
  })

  test('AC7: 고정 목록 컷 설명을 누르면 그 탭으로 가서 대상 카드로 스크롤해 핀에 포커스하고(펼치지 않는다), 필터 밖이면 필터는 그대로 안내만, 해제는 그 고정만', async ({ page }) => {
    await lockBadge(page, NINETALES_152)
    await settle(page)
    const row = await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(2)

    await selectTab(page, '방어')
    await waitComplete(page)
    await lockList(page).getByRole('button', { name: /^컷 고정: 한카리아스 · 드래곤클로 · 확정1타 보기$/ }).click()
    await expect(tabPanel(page)).toHaveAttribute('data-tab', 'attack')
    await waitComplete(page)
    await expect(row).toBeInViewport()
    await expect(row.getByTestId('cut-pin')).toHaveAttribute('data-locked', 'true')
    await expect(row.getByTestId('cut-pin')).toBeFocused()
    await expectNotExpanded(row)

    await lockList(page).getByRole('button', { name: /^컷 고정: 나인테일 S32 성격 무보정 보기$/ }).click()
    await expect(tabPanel(page)).toHaveAttribute('data-tab', 'speed')
    await expect(speedDetail(page).getByTestId('speed-detail-name')).toHaveText('나인테일')
    await expect(badge(page, NINETALES_152)).toBeFocused()

    // 상위 1이면 나인테일·한카리아스는 표시 필터 밖: 필터는 그대로 두고 안내만
    const topN = page.getByRole('spinbutton', { name: '상위 N', exact: true })
    await topN.fill('1')
    await expect(badge(page, NINETALES_152)).toHaveCount(0)
    await lockList(page).getByRole('button', { name: /^컷 고정: 한카리아스 · 드래곤클로 .* 보기$/ }).click()
    await expect(tabPanel(page)).toHaveAttribute('data-tab', 'attack')
    await waitComplete(page)
    await expect(page.getByTestId('lock-outside')).toHaveText('이 컷의 상대는 지금 표시 필터 밖입니다')
    await expect(topN).toHaveValue('1')
    await lockList(page).getByRole('button', { name: /^컷 고정: 나인테일 .* 보기$/ }).click()
    await expect(tabPanel(page)).toHaveAttribute('data-tab', 'speed')
    await expect(page.getByTestId('lock-outside')).toHaveText('이 컷의 상대는 지금 표시 필터 밖입니다')
    await expect(topN).toHaveValue('1')
    await expect(badge(page, NINETALES_152)).toHaveCount(0)

    await lockList(page).getByRole('button', { name: /한카리아스 · 드래곤클로 · 확정1타 고정 해제$/ }).click()
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockList(page).locator('.lock-desc')).toHaveAttribute('title', /^나인테일 /)
    await expect(lockList(page).locator('.lock-desc img[data-species-icon]')).toHaveCount(1)
  })

  test('AC16: 꺼진 스피드 조건 칩의 배지 컷으로 이동하면 그 칩이 켜진다', async ({ page }) => {
    await lockBadge(page, KOMMOO_RANK_168)
    await settle(page)
    const rank = page.locator('[data-testid="speed-head"] [data-filter="rank"]')
    await expect(rank).toHaveAttribute('aria-pressed', 'true')
    await rank.click()
    await expect(rank).toHaveAttribute('aria-pressed', 'false')
    await expect(badge(page, KOMMOO_RANK_168)).toHaveCount(0)
    await selectTab(page, '공격')
    await lockList(page).locator('.lock-desc').click()
    await expect(tabPanel(page)).toHaveAttribute('data-tab', 'speed')
    await expect(rank).toHaveAttribute('aria-pressed', 'true')
    await expect(badge(page, KOMMOO_RANK_168)).toBeFocused()
    await expect(speedDetail(page).getByTestId('speed-detail-name')).toHaveText('짜랑고우거')
    await expect(page.getByTestId('lock-outside')).toHaveText('')
  })

  test('AC14·키보드: 고정 줄 ▲가 기준 갈래 선택(켜면 상승이 S, 고정 밖 ▲는 상승이 고정 밖), 고정·해제·▲를 키보드로 조작한다', async ({ page }) => {
    const atkPlusBefore = await natureBtn(page, '공격', '상승').getAttribute('aria-pressed')
    await selectTab(page, '스피드')
    const b = badge(page, MOLDURYU_140)
    await b.focus()
    await page.keyboard.press('Enter')
    await expect(speedDetail(page)).toBeVisible()
    // 로빙 탭 자리의 배지는 핀이 그 앞 탭 정지점이다
    await page.keyboard.press('Shift+Tab')
    await expect(badgePin(page, MOLDURYU_140)).toBeFocused()
    await page.keyboard.press('Space')
    await expect(badgePin(page, MOLDURYU_140)).toHaveAttribute('aria-pressed', 'true')
    await settle(page)

    // "표 기준" 라디오·성격 안내 문구는 없다
    await expect(mySet(page).getByRole('radio')).toHaveCount(0)
    await expect(mySet(page)).not.toContainText('상승은 갈래별')
    const sPlus = natureBtn(page, '스피드', '상승')
    // 자동 규칙: 상승이 고정 밖인 갈래(S19). S ▲는 꺼져 있고 누를 수 있다
    await expect(sPlus).toHaveAttribute('aria-pressed', 'false')
    await expect(sPlus).toBeEnabled()
    await expect(spBox(page, '스피드')).toHaveValue('19')

    await sPlus.focus()
    await page.keyboard.press('Space')
    await expect(sPlus).toHaveAttribute('aria-pressed', 'true')
    await settle(page)
    await expect(sPlus).toHaveAttribute('aria-pressed', 'true')
    await expect(spBox(page, '스피드')).toHaveValue('7')
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S7+ / S19')

    // 고정 밖 ▲(공격)를 켜면 상승이 고정 밖인 갈래로 돌아간다
    const aPlus = natureBtn(page, '공격', '상승')
    await aPlus.click()
    await settle(page)
    await expect(aPlus).toHaveAttribute('aria-pressed', 'true')
    await expect(sPlus).toHaveAttribute('aria-pressed', 'false')
    await expect(spBox(page, '스피드')).toHaveValue('19')

    // 상승으로만 닿는 S 고정으로 바꾸면(같은 S라 몰드류 고정을 교체, 2026-11-21) 고정 밖 갈래가 사라져 S ▲는 켜진 채 비활성, 고정 밖 ▲도 켤 수 없다
    await lockBadge(page, VIVILLON_155)
    await settle(page)
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(badgePin(page, MOLDURYU_140)).toHaveAttribute('aria-pressed', 'false')
    await expect(sPlus).toHaveAttribute('aria-pressed', 'true')
    await expect(sPlus).toBeDisabled()
    await expect(natureBtn(page, '특공', '상승')).toBeDisabled()
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S20+')

    // 해제 버튼("×", 읽기 이름 "…고정 해제")도 키보드로: 마지막 항목을 지우면 목록 머리·패널로 포커스가 간다
    const removeVivillon = lockList(page).getByRole('button', { name: /비비용 .* 고정 해제$/ })
    await expect(removeVivillon).toHaveText('×')
    await removeVivillon.focus()
    await page.keyboard.press('Enter')
    await expect(lockList(page)).toHaveCount(0)
    await expect(spBox(page, '스피드')).toHaveValue('32')
    await expect(spBox(page, '스피드')).toBeEnabled()
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
    // 고정 중 고친 성격은 전부 해제하면 첫 고정 직전 값으로 돌아간다(R13)
    await expect(aPlus).toHaveAttribute('aria-pressed', atkPlusBefore ?? 'false')
  })

  test('합계 78: 재계산으로 남은 예산을 넘은 세트로 세 탭이 오류 없이 열리고 패널에만 초과량을 알린다(자동으로 줄이지 않는다)', async ({ page }) => {
    // 스카프로 S0인 고정 뒤 B13 D12를 채우고 스카프를 빼면 고정 SP가 S19로 늘어 계획 세트 H2 A32 B13 D12 S19 = 78
    await fillMySet(page, { item: '구애스카프' })
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText(/ S0$/)
    await spBox(page, '방어').fill('13')
    await spBox(page, '특방').fill('12')
    await settle(page)
    await fillMySet(page, { item: '생명의구슬' })
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText(/ S19$/)
    await expect(mySet(page).getByTestId('lock-over-total')).toHaveText('SP 합계 66을 12 넘음')
    await expect(mySet(page).getByTestId('lock-trim')).toHaveCount(0)
    await expect(spBox(page, '방어')).toHaveValue('13')
    await expect(spBox(page, '특방')).toHaveValue('12')
    for (const t of ['공격', '방어'] as const) {
      await selectTab(page, t)
      await waitComplete(page)
      await expect(cards(page).first()).toBeVisible()
      await expect(tabPanel(page).getByText(/내 세트|계산 불가/)).toHaveCount(0)
    }
    await selectTab(page, '스피드')
    await expect(page.getByTestId('speed-badge').first()).toBeVisible()
    await openBadge(page, NINETALES_152)
    await expect(branchLines(speedDetail(page)).first()).toBeVisible()
    await expect(speedDetail(page)).not.toContainText('내 세트를 확인해 주세요')
    await expect(speedDetail(page)).not.toContainText('남은 SP -')
    // 고정한 배지 자신: 갈래 줄이 없고 코어 예산 문구(예산 초과 · 남은 SP)도 없다
    await openBadge(page, MOLDURYU_140)
    await expect(branchLines(speedDetail(page))).toHaveCount(0)
    await expect(speedDetail(page).getByTestId('speed-detail-min-sp')).toHaveText(/^추월: 최소 S19 \/ S7↑/)
    await expect(speedDetail(page)).not.toContainText('예산 초과')
    await expect(speedDetail(page)).not.toContainText('남은 SP')
  })

  test('R2: 모든 카드 줄에 포켓몬 이미지 앞 핀, 빈 핀은 변동과 같은 2단 메뉴(키보드·현재 판정 무관), 고르면 찬 핀, 찬 핀은 해제, 카드를 펼치지 않는다', async ({ page }) => {
    await selectTab(page, '공격')
    await waitComplete(page)
    const n = await cards(page).count()
    expect(n).toBeGreaterThan(0)
    await expect(cards(page).locator('.card-line > .cut-pin-wrap > [data-testid="cut-pin"]')).toHaveCount(n)
    // 고정 뒤 재계산 중에는 다른 카드 핀도 잠시 대기 상태라, "첫 활성 핀 카드"를 다시 찾지 않도록 카드 id로 묶는다
    const cardId = await cards(page)
      .filter({ has: page.locator('[data-testid="cut-pin"]:not([aria-disabled])') })
      .first()
      .getAttribute('data-card-id')
    if (cardId === null) throw new Error('고정 가능한 카드 없음')
    const card = cards(page).and(page.locator(`[data-card-id="${cardId.replace(/["\\]/g, '\\$&')}"]`))
    const pin = card.getByTestId('cut-pin')
    // 핀은 이름 칸(포켓몬 이미지) 앞
    const [pinBox, iconBox] = [await pin.boundingBox(), await card.locator('.card-who [data-testid="mon-icon"]').boundingBox()]
    expect(pinBox!.x + pinBox!.width).toBeLessThanOrEqual(iconBox!.x)
    await expect(pin).toHaveAccessibleName(/^컷 고정: /)
    await expect(pin).toHaveAttribute('aria-haspopup', 'menu')

    await pin.focus()
    await page.keyboard.press('Enter')
    const menu = pinMenu(card)
    await expect(menu).toBeVisible()
    await expect(menu).toHaveAttribute('role', 'menu')
    await expect(menu).toHaveAttribute('aria-label', /^컷 고정할 결과: /)
    await expect(pin).toHaveAttribute('aria-expanded', 'true')
    await expect(card.locator('.card-detail')).toHaveCount(0)
    // 1단: 고정 가능 단계 중 고를 수 있는 결과만(좋은 단계부터), 결과 배지 + SP + ›
    await expect(menu.getByText('계산 중…')).toHaveCount(0, { timeout: 15_000 })
    const results = menu.getByTestId('adjust-result')
    const labels = await results.evaluateAll((els) => els.map((e) => e.getAttribute('data-label')))
    expect(labels.length).toBeGreaterThan(0)
    expect(['guaranteed-ohko', 'high-roll-ohko'].filter((l) => labels.includes(l))).toEqual(labels)
    for (const r of await results.all()) expect(await spsText(r)).toMatch(/^[ABC]\d+\+?$/)
    await expect(results.first()).toBeFocused()
    if (labels.length > 1) {
      await page.keyboard.press('ArrowDown')
      await expect(results.nth(1)).toBeFocused()
      await page.keyboard.press('ArrowUp')
      await expect(results.first()).toBeFocused()
    }
    // → 로 2단(성격 선택), ← 로 뒤로(고른 결과로 포커스)
    await page.keyboard.press('ArrowRight')
    await expect(menu).toHaveAttribute('data-stage', 'nature')
    const natures = menu.getByTestId('adjust-nature')
    await expect(natures).toHaveCount(2)
    await expect(natures.locator('.adjust-nature-name')).toHaveText(['무보정', /^[ABC] 상승$/])
    await expectFocusOnFirstSelectable(menu.getByRole('menuitem').and(page.locator(':not([data-testid="adjust-back"])')))
    await page.keyboard.press('ArrowLeft')
    await expect(menu).toHaveAttribute('data-stage', 'result')
    await expect(results.first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(pin).toBeFocused()
    await expectNotExpanded(card)

    await pin.click()
    const first = results.first()
    await expect(first).toBeVisible({ timeout: 15_000 })
    const stage = (await first.locator('.ko-badge').innerText()).trim()
    await first.click()
    const ok = menu.locator('[data-testid="adjust-nature"][data-enabled="true"]').first()
    const shown = await spsText(ok)
    // 키보드로 고른다: 재계산으로 카드가 다시 붙어도 포커스는 핀으로 돌아온다(변동 버튼과 같다)
    await ok.focus()
    await page.keyboard.press('Enter')
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await expect(pin).toHaveAccessibleName(/^컷 고정 해제: /)
    await expect(pin).toHaveAttribute('title', new RegExp(`^컷 고정 고정됨: ${stage}`))
    await expect(menu).toHaveCount(0)
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockList(page).locator('.lock-desc')).toContainText(stage)
    await expectNotExpanded(card)
    await settle(page)
    // 메뉴에 보인 고정 능력치 SP가 고정 목록 SP 중 하나다(그 선택을 건 파생 값)
    await expect(lockList(page).locator('.lock-sp')).toContainText(shown)
    await expect(pin).toBeFocused()

    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    await expect(lockList(page)).toHaveCount(0)
    await expectNotExpanded(card)
  })

  test('R2: 방어 카드 핀 메뉴는 확정견딤·저난수1타(고난수견딤) 중 고를 수 있는 결과이고, 계단이 없던 단계도 메뉴를 열면 계산돼 풀린다', async ({ page }) => {
    await selectTab(page, '방어')
    await waitComplete(page)
    const n = await cards(page).count()
    await expect(cards(page).getByTestId('cut-pin')).toHaveCount(n)
    const card = cards(page).and(page.locator('[data-opponent="garchomp"]')).filter({ has: page.locator('[data-testid="cut-pin"]:not([aria-disabled])') }).first()
    await card.getByTestId('cut-pin').click()
    const menu = pinMenu(card)
    await expect(menu.getByText('계산 중…')).toHaveCount(0, { timeout: 15_000 })
    const results = menu.getByTestId('adjust-result')
    const labels = await results.evaluateAll((els) => els.map((e) => e.getAttribute('data-label')))
    expect(labels.length).toBeGreaterThan(0)
    expect(['guaranteed-survive', 'low-roll-ohko'].filter((l) => labels.includes(l))).toEqual(labels)
    for (const r of await results.all()) expect(await spsText(r)).toMatch(/^H\d+ [BD]\d+\+?$/)
    // 계산 중에 연 메뉴도 풀린 뒤 첫 고를 수 있는 결과에 포커스가 닿는다
    await expect(results.first()).toBeFocused()
    await expect(pinItem(card, '확정견딤')).toBeVisible()
    await pinItem(card, '확정견딤').click()
    // 2단: 무보정/B·D 상승, 고를 수 있는 선택지에 H 최대가 있으면 합 최소·H 최대 두 항목
    await expect(menu.getByTestId('adjust-nature').locator('.adjust-nature-name')).toHaveText(['무보정', /^[BD] 상승$/])
    for (const h of await menu.getByTestId('adjust-hmax').all()) {
      await expect(h).toContainText('H 최대')
      await expect(menu.locator(`[data-testid="adjust-nature"][data-nature="${await h.getAttribute('data-nature')}"]`)).toContainText('합 최소')
    }
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('R2: 현재 판정이 고난수1타인 방어 카드(대도각참 생명의구슬 +2 기습)도 이미지 앞 핀 메뉴로 고를 수 있는 결과마다 고정·해제한다', async ({ page }) => {
    await selectTab(page, '방어')
    await waitComplete(page)
    const card = cards(page).and(page.locator('[data-opponent="kingambit"][data-power-item="lifeorb"]'))
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId('ko-badge')).toHaveText(/^고난수1타/)
    const pin = card.getByTestId('cut-pin')
    await expect(card.locator('.card-line > .cut-pin-wrap > [data-testid="cut-pin"]')).toHaveCount(1)
    const [pinBox, iconBox] = [await pin.boundingBox(), await card.locator('.card-who [data-testid="mon-icon"]').boundingBox()]
    expect(pinBox!.x + pinBox!.width).toBeLessThanOrEqual(iconBox!.x)
    await expect(pin).not.toHaveAttribute('aria-disabled', /.*/)

    await pin.click()
    await expect(pinMenu(card).getByText('계산 중…')).toHaveCount(0, { timeout: 15_000 })
    const labels = await pinMenu(card)
      .getByTestId('adjust-result')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-label')))
    expect(labels).toContain('guaranteed-survive')
    await page.keyboard.press('Escape')
    const STAGE_TEXT: Record<string, string> = { 'guaranteed-survive': '확정견딤', 'low-roll-ohko': '저난수1타' }
    for (const label of labels) {
      const stage = STAGE_TEXT[label as string]
      await pin.click()
      const item = pinItem(card, stage)
      await expect(item).toBeVisible({ timeout: 15_000 })
      expect(await spsText(item)).toMatch(/^H\d+ B\d+\+?$/)
      await item.click()
      await pinMenu(card).locator('[data-testid="adjust-nature"][data-enabled="true"]').first().click()
      await expect(pin).toHaveAttribute('aria-pressed', 'true')
      await expect(pin).toHaveAttribute('title', new RegExp(`^컷 고정 고정됨: ${stage}`))
      await expect(pinMenu(card)).toHaveCount(0)
      await expect(lockList(page).locator('.lock-desc')).toContainText(stage)
      await expectNotExpanded(card)
      await settle(page)
      await pin.click()
      await expect(pin).toHaveAttribute('aria-pressed', 'false')
      await expect(lockList(page)).toHaveCount(0)
      await settle(page)
    }
  })

  test('R2: 스피드 배지 앞 핀은 메뉴·상세 없이 바로 고정하고, 찬 핀을 누르면 해제한다', async ({ page }) => {
    await selectTab(page, '스피드')
    const pin = badgePin(page, MOLDURYU_140)
    await pin.scrollIntoViewIfNeeded()
    const [pinBox, badgeBox] = [await pin.boundingBox(), await badge(page, MOLDURYU_140).boundingBox()]
    expect(pinBox!.x + pinBox!.width).toBeLessThanOrEqual(badgeBox!.x + 0.5)
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    // 바로 고정하는 핀은 메뉴를 알리지 않는다
    await expect(pin).not.toHaveAttribute('aria-haspopup', /.*/)
    await expect(pin).not.toHaveAttribute('aria-expanded', /.*/)
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('cut-pin-menu')).toHaveCount(0)
    await expect(speedDetail(page)).toHaveCount(0)
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await settle(page)
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    await expect(lockList(page)).toHaveCount(0)
    await expect(speedDetail(page)).toHaveCount(0)

    // 걸 수 없는 배지는 이유 메뉴를 열고, 열린 동안만 메뉴 버튼으로 알린다
    const far = badgePin(page, MOLDURYU_280)
    await far.scrollIntoViewIfNeeded()
    await far.click()
    const menu = far.locator('xpath=..').getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([/^선공\s*도달 불가$/])
    await expect(far).toHaveAttribute('aria-haspopup', 'menu')
    await expect(far).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(far).toBeFocused()
    await expect(far).not.toHaveAttribute('aria-haspopup', /.*/)
    await expect(lockList(page)).toHaveCount(0)
  })

  test('@layout 카드 줄·사다리 배지에 핀이 있어도 가로로 넘치지 않고 핀이 이름·배지와 겹치지 않는다', async ({ page }) => {
    for (const t of ['공격', '방어'] as const) {
      await selectTab(page, t)
      await waitComplete(page)
      const bad = await cards(page)
        .locator('.card-line')
        .evaluateAll((els) =>
          els.slice(0, 30).flatMap((el, i) => {
            const line = el.getBoundingClientRect()
            const pin = el.querySelector('[data-testid="cut-pin"]')?.getBoundingClientRect()
            const who = el.querySelector('.card-who')?.getBoundingClientRect()
            const out = [...el.children].some((c) => {
              const b = c.getBoundingClientRect()
              return b.width > 0 && (b.right > line.right + 1 || b.left < line.left - 1)
            })
            const overlap = pin === undefined || who === undefined || pin.right > who.left + 0.5
            return out || overlap || el.scrollWidth > el.clientWidth + 1 ? [i] : []
          }),
        )
      expect(bad, `${t} 탭 넘치거나 겹친 카드 줄`).toEqual([])
      expect(await tabPanel(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    }
    await selectTab(page, '스피드')
    const badBadges = await page.locator('.speed-badge-item').evaluateAll((els) =>
      els.slice(0, 40).flatMap((el, i) => {
        const pin = el.querySelector('[data-testid="cut-pin"]')?.getBoundingClientRect()
        const btn = el.querySelector('[data-testid="speed-badge"]')?.getBoundingClientRect()
        const row = el.closest('.speed-badges')?.getBoundingClientRect()
        if (pin === undefined || btn === undefined || row === undefined) return [i]
        return pin.right > btn.left + 0.5 || btn.right > row.right + 1 ? [i] : []
      }),
    )
    expect(badBadges).toEqual([])
    expect(await tabPanel(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  })

  test('R2·R25: 공격·방어 카드 줄은 펼치지 않고(상세 없음), 스피드 배지 상세에는 컷 고정 버튼이 없다', async ({ page }) => {
    for (const t of ['공격', '방어'] as const) {
      await selectTab(page, t)
      await waitComplete(page)
      await expect(tabPanel(page).locator('.card-toggle, .card-chev, .card-detail')).toHaveCount(0)
    }
    await openBadge(page, MOLDURYU_140)
    await expect(speedDetail(page).getByRole('button', { name: /컷 고정/ })).toHaveCount(0)
    await expect(speedDetail(page).getByTestId('cut-pin')).toHaveCount(0)
  })

  test('R1·R2·R21: 고정이 하나도 없을 때 공격 행·방어 쌍(H 포함)에서 첫 고정을 걸고, 변동할 능력치가 고정된 카드의 변동 버튼은 사유와 함께 비활성', async ({ page }) => {
    const atk = await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockedSp(page, 'atk')).toHaveText(/^SP 공격 고정됨: A\d+(\+)?( \/ A\d+\+?)?$/)
    // 고정한 행(확정1타, 탭 최선이어도 변동 버튼이 있다)과 A로 변동하는 다른 카드(메가보만다 드래곤클로)의 버튼이 비활성이다.
    await expect(atk.getByTestId('ko-badge')).toHaveText(/^확정1타/)
    await expect(adjustButton(atk)).toHaveAttribute('aria-disabled', 'true')
    const atkOther = moveCard(page, 'salamencemega', 'dragonclaw')
    const locked = adjustButton(atkOther)
    await expect(locked).toHaveAttribute('aria-disabled', 'true')
    await expect(locked).toHaveAttribute('title', '고정된 능력치라 변동할 수 없음')
    await expect(locked).toHaveAccessibleDescription(/고정된 능력치라 변동할 수 없음$/)
    await expect(locked).not.toHaveAttribute('aria-haspopup', /.*/)
    await locked.focus()
    await page.keyboard.press('Enter')
    await expect(locked).toBeFocused()
    await expect(adjustMenu(atkOther)).toHaveCount(0)
    await removeAllLocks(page)
    await expect(adjustButton(atkOther)).not.toHaveAttribute('aria-disabled', /.*/)

    const row = await lockRow(page, '방어', 'garchomp', 'dragonclaw')
    await expect(row.getByTestId('cut-pin')).toHaveAttribute('data-locked', 'true')
    // 고정한 행(확정견딤, 탭 최선이어도 변동 버튼이 있다)과 H·B로 변동하는 다른 물리 카드(도도도각참)의 버튼이 비활성이다.
    await expect(row.getByTestId('ko-badge')).toHaveText(/^확정견딤/)
    await expect(adjustButton(row)).toHaveAttribute('aria-disabled', 'true')
    await expect(adjustButton(moveCard(page, 'kingambit', 'kowtowcleave'))).toHaveAttribute('aria-disabled', 'true')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockList(page).getByTestId('lock-status')).toHaveCount(0)
    await expect(lockedSp(page, 'hp')).toHaveText(/^SP HP 고정됨: H\d+$/)
    await expect(lockedSp(page, 'def')).toHaveText(/^SP 방어 고정됨: B\d+(\+)?( \/ B\d+\+?)?$/)
  })

  test('AC12·AC17: H를 공유하는 방어 쌍(H+B·H+D) 고정 두 개가 함께 활성이고, 같은 B의 다른 H+B를 걸면 H+B만 교체한다', async ({ page }) => {
    await lockRow(page, '방어', 'garchomp', 'dragonclaw')
    await lockRow(page, '방어', 'floettemega', 'dazzlinggleam')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(2)
    await expect(lockList(page).getByTestId('lock-status')).toHaveCount(0)
    await expect(lockedSp(page, 'hp')).toHaveText(/^SP HP 고정됨: H\d+( \/ H\d+)*$/)
    await expect(lockedSp(page, 'def')).toBeVisible()
    await expect(lockedSp(page, 'spd')).toBeVisible()
    // 같은 B를 쓰는 다른 H+B(대도각참 엎드려베기)를 걸면 한카리아스 H+B를 풀고, H+D는 남는다(2026-11-21 사용자 결정)
    await lockRow(page, '방어', 'kingambit', 'kowtowcleave')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(2)
    await expect(moveCard(page, 'garchomp', 'dragonclaw').getByTestId('cut-pin')).toHaveAttribute('aria-pressed', 'false')
    await expect(moveCard(page, 'floettemega', 'dazzlinggleam').getByTestId('cut-pin')).toHaveAttribute('aria-pressed', 'true')
    await expect(lockList(page).locator('.lock-item[data-lock-kind="defense"]')).toHaveCount(2)
    await expect(lockList(page).getByTestId('lock-status')).toHaveCount(0)
  })

  test('AC16: 하락 자리가 없는 카드는 결과 배지 툴팁·읽기 설명으로 경고한다', async ({ page }) => {
    await fillMySet(page, { moves: [...EXAMPLE_MOVES.slice(0, 3), '용성군'] })
    // S·A·C·H+B를 모두 고정하면 S 상승 갈래의 하락은 D뿐이라, 특수기를 맞는 H+D 행은 하락 자리가 없다
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    await lockRow(page, '공격', 'kommoo', 'dracometeor', '고난수1타')
    await lockRow(page, '방어', 'garchomp', 'dragonclaw')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(4)
    await expect(lockList(page).getByTestId('lock-status')).toHaveCount(0)
    // 기준 갈래를 S 상승으로(고정 밖 갈래는 성격 무보정이라 하락이 없다)
    const sPlus = natureBtn(page, '스피드', '상승')
    if ((await sPlus.getAttribute('aria-pressed')) !== 'true') await sPlus.click()
    await settle(page)
    await expect(sPlus).toHaveAttribute('aria-pressed', 'true')

    await selectTab(page, '방어')
    await waitComplete(page)
    const warned = tabPanel(page).getByTestId('ko-badge').and(page.locator('[title="하락 위치에 따라 달라질 수 있음"]'))
    await expect(warned.first()).toBeVisible({ timeout: 15_000 })
    await expect(warned.first()).toContainText('하락 위치에 따라 달라질 수 있음')
  })

  test('AC8: 메가 전환(한카리아스 ↔ 메가한카리아스)은 고정을 지우지 않고 다시 계산한다', async ({ page }) => {
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await fillMySet(page, { species: '메가한카리아스' })
    await settle(page)
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockedSp(page, 'spe')).toHaveText(/^SP 스피드 고정됨: S\d+\+ \/ S\d+$/)
    await fillMySet(page, { species: '한카리아스' })
    await settle(page)
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S7+ / S19')
  })

  test('AC7: 같은 탭에 머문 채 컷 설명을 두 번 눌러도 매번 대상으로 이동한다', async ({ page }) => {
    await lockBadge(page, NINETALES_152)
    await settle(page)
    const row = await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    const reveal = lockList(page).getByRole('button', { name: /^컷 고정: 한카리아스 · 드래곤클로 · 확정1타 보기$/ })
    await reveal.click()
    await expect(row).toBeInViewport()
    await expect(row.getByTestId('cut-pin')).toBeFocused()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await reveal.click()
    await expect(tabPanel(page)).toHaveAttribute('data-tab', 'attack')
    await expect(row).toBeInViewport()
    await expect(row.getByTestId('cut-pin')).toBeFocused()

    const speed = lockList(page).getByRole('button', { name: /^컷 고정: 나인테일 S32 성격 무보정 보기$/ })
    await speed.click()
    await expect(badge(page, NINETALES_152)).toBeFocused()
    await openBadge(page, MOLDURYU_140)
    await expect(speedDetail(page).getByTestId('speed-detail-name')).toHaveText('몰드류')
    await speed.click()
    await expect(speedDetail(page).getByTestId('speed-detail-name')).toHaveText('나인테일')
    await expect(badge(page, NINETALES_152)).toBeFocused()
  })

  test('AC14: S ▲로 S 상승 갈래를 기준으로 골라도 공격 컷을 고정할 수 있고, 고른 갈래가 사라지면 자동 규칙(고정 밖 우선)으로 돌아간다', async ({ page }) => {
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    const sPlus = natureBtn(page, '스피드', '상승')
    await sPlus.click()
    await settle(page)
    await expect(sPlus).toHaveAttribute('aria-pressed', 'true')
    // 기준 갈래가 A 상승을 막아도 공격 후보의 상승 선택지는 갈래 재스윕으로 판정된다(계산 중에 머물지 않는다)
    await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    await expect(lockList(page).locator('.lock-chip')).toHaveCount(0)
    await expect(lockedSp(page, 'atk')).toHaveText('SP 공격 고정됨: A14+ / A30')
    await expect(sPlus).toHaveAttribute('aria-pressed', 'true')
    await expect(natureBtn(page, '공격', '상승')).toHaveAttribute('aria-pressed', 'false')
    await expect(spBox(page, '공격')).toHaveValue('30')
    // 공·방 고정 항목은 단계를 카드 결과 배지 모양으로, 스피드 고정 항목은 단계 라벨 없이 보인다
    await expect(lockList(page).locator('.lock-item[data-lock-kind="attack"] [data-testid="lock-stage"]')).toHaveText('확정1타')
    await expect(lockList(page).locator('.lock-item[data-lock-kind="speed"] [data-testid="lock-stage"]')).toHaveCount(0)

    // 스피드 고정을 풀면 고른 S 상승 갈래가 사라진다: 자동 규칙으로 상승이 고정 밖인 갈래가 기준
    await lockList(page).getByRole('button', { name: /^몰드류 .* 고정 해제$/ }).click()
    await settle(page)
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    const aPlus = natureBtn(page, '공격', '상승')
    await expect(aPlus).toHaveAttribute('aria-pressed', 'false')
    await expect(spBox(page, '공격')).toHaveValue('30')
    // A ▲를 켜면 A 상승 갈래(A14+), 끄면 다시 고정 밖(A30)
    await aPlus.click()
    await settle(page)
    await expect(aPlus).toHaveAttribute('aria-pressed', 'true')
    await expect(spBox(page, '공격')).toHaveValue('14')
    await expect(natureBtn(page, '공격', '하락')).toBeDisabled()
    await aPlus.click()
    await settle(page)
    await expect(aPlus).toHaveAttribute('aria-pressed', 'false')
    await expect(spBox(page, '공격')).toHaveValue('30')
  })

  test('R18: 숫자 입력·−/+·↑ 키도 슬라이더처럼 남은 합계까지만 받는다(고정이 없을 때와 고정 중 기준 갈래 고정 SP로 셀 때)', async ({ page }) => {
    // 예시 세트 H2 A32 S32 = 66 → A20이면 방어는 12까지
    await spBox(page, '공격').fill('20')
    await expect(spBox(page, '공격')).toHaveValue('20')
    const def = spBox(page, '방어')
    await def.fill('40')
    await expect(def).toHaveValue('12')
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText('0')
    const up = mySet(page).getByRole('button', { name: 'SP 방어 1 올리기', exact: true })
    await expect(up).toBeDisabled()
    await def.press('ArrowUp')
    await expect(def).toHaveValue('12')
    await mySet(page).getByRole('button', { name: 'SP 방어 1 내리기', exact: true }).click()
    await expect(def).toHaveValue('11')
    await expect(up).toBeEnabled()
    await up.click()
    await expect(def).toHaveValue('12')
    await expect(up).toBeDisabled()
    await expect(mySet(page).getByRole('alert')).toHaveCount(0)
    // 빈 칸은 0으로 센다: H를 비워도 특공은 A20 B12 S32 = 64를 뺀 2까지, 다시 채운 H는 0까지
    const hp = spBox(page, 'HP')
    const spa = spBox(page, '특공')
    await hp.fill('')
    await spa.fill('40')
    await expect(spa).toHaveValue('2')
    await hp.fill('5')
    await expect(hp).toHaveValue('0')
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText('0')
    await spa.fill('0')
    await hp.fill('2')
    await expect(hp).toHaveValue('2')

    // 고정 중: S 고정(기준 갈래 S19)은 초안 S32가 아니라 19로 센다 → H2 A20 B12 S19 = 53이라 특방은 13까지
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText(/ S19$/)
    const spd = spBox(page, '특방')
    await spd.fill('40')
    await expect(spd).toHaveValue('13')
    await expect(mySet(page).getByRole('button', { name: 'SP 특방 1 올리기', exact: true })).toBeDisabled()
    await expect(mySet(page).getByTestId('lock-over-total')).toHaveCount(0)
    // 고정 중에도 빈 칸을 거쳐 66을 넘길 수 없다: 특공은 A20 B12 D13 S19 = 64를 뺀 2 이하
    // (빈 칸은 세트 오류라 파생이 없는 동안 S는 고정 전 값 32로 세어 더 엄격할 수 있다), 다시 채운 H도 남은 값까지만
    await hp.fill('')
    await spa.fill('40')
    await settle(page)
    expect(Number(await spa.inputValue())).toBeLessThanOrEqual(2)
    await hp.fill('32')
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText(/ S19$/)
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText(/^\d+$/)
    await expect(mySet(page).getByTestId('lock-over-total')).toHaveCount(0)
  })

  test('R19: 핀 고정으로 66을 넘으면 고정 밖을 H→A 순으로 줄여 66에 맞추고 알린다, 성격 ▲로 기준 갈래를 바꿔 넘어도 같다', async ({ page }) => {
    // H2 A32 B32 S0 = 66에서 S19(기준 갈래: 상승이 고정 밖)를 고정하면 85 → H 2→0, A 32→15
    await fillMySet(page, { sp: { 스피드: 0, 방어: 32 } })
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText('0')
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S7+ / S19')
    const trim = mySet(page).getByTestId('lock-trim')
    await expect(trim).toContainText('H 2 → 0(합계 66 초과로 줄임), A 32 → 15(합계 66 초과로 줄임)')
    for (const [stat, v] of [['HP', '0'], ['공격', '15'], ['방어', '32'], ['스피드', '19']] as const) await expect(spBox(page, stat)).toHaveValue(v)
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText('0')
    await expect(mySet(page).getByTestId('lock-over-total')).toHaveCount(0)
    await trim.getByRole('button', { name: 'SP 줄임 알림 닫기' }).click()
    await expect(trim).toHaveCount(0)

    // S ▲(상승이 S 갈래, S7)로 남은 12를 A에 채운 뒤 S ▲를 끄면(고정 밖 갈래 S19) 78 → H는 0이라 A 27→15
    const sPlus = natureBtn(page, '스피드', '상승')
    await sPlus.click()
    await settle(page)
    await expect(spBox(page, '스피드')).toHaveValue('7')
    await expect(trim).toHaveCount(0)
    await spBox(page, '공격').fill('40')
    await expect(spBox(page, '공격')).toHaveValue('27')
    await settle(page)
    await sPlus.click()
    await settle(page)
    await expect(sPlus).toHaveAttribute('aria-pressed', 'false')
    await expect(spBox(page, '스피드')).toHaveValue('19')
    await expect(trim).toHaveText(/^A 27 → 15\(합계 66 초과로 줄임\)/)
    await expect(spBox(page, '공격')).toHaveValue('15')
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText('0')

    // 해제 복원(R13)은 줄인 능력치를 되돌리지 않는다: S만 고정 전 값 0으로. 잘림 없는 해제라 이전 줄임 알림은 지운다
    await removeAllLocks(page)
    await expect(trim).toHaveCount(0)
    for (const [stat, v] of [['HP', '0'], ['공격', '15'], ['방어', '32'], ['스피드', '0']] as const) await expect(spBox(page, stat)).toHaveValue(v)
  })

  test('R22: 고정 중 변동 목록은 66 − 고정 SP 안에서 닿는 결과만 보이고, 고정 밖 현재 SP는 예산을 막지 않는다', async ({ page }) => {
    await selectTab(page, '방어')
    await waitComplete(page)
    const card = cards(page).and(page.locator('[data-opponent="basculegion"]:not([data-power-item])'))
    await expect(card).toHaveCount(1)
    // 무고정: 예시 세트가 A32 S32로 66을 다 써도 H+B 62가 드는 결과까지 보인다. 방어 1단은 H 최대 배분(합 최소 H22 B28+ 대신 H32 B22+)
    await openAdjust(card)
    await expect(adjustSps(adjustResult(card, '확정견딤'))).toHaveText(['H32', 'B22+'])
    // 1단 SP는 내 세트 성격(hardy = 무보정) 기준: 저난수1타는 B 상승이 더 싸도 무보정, 그중 H 최대 H32 B31(합 최소는 H30 B32)
    await expect(adjustSps(adjustResult(card, '저난수1타'))).toHaveText(['H32', 'B31'])
    await page.keyboard.press('Escape')
    await expect(adjustMenu(card)).toHaveCount(0)

    // S19(기준 갈래) 고정 → 예산 47: 확정견딤(최소 H22 B28+ = 50)은 목록에 없고, 남은 결과는 모두 47 안
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S7+ / S19')
    await selectTab(page, '방어')
    await waitComplete(page)
    const menu = await openAdjust(card)
    await expect(menu.getByTestId('adjust-result').first()).toHaveAttribute('data-enabled', 'true', { timeout: 15_000 })
    await expect(adjustResult(card, '확정견딤')).toHaveCount(0)
    // 무보정 H30 B32(62)는 예산 47 밖이라 B 상승안, 그중 H 최대는 예산 47에 막혀 H24 B23+(합 최소는 H16 B28+)
    await expect(adjustSps(adjustResult(card, '저난수1타'))).toHaveText(['H24', 'B23+'])
    const sums = await menu.getByTestId('adjust-result').evaluateAll((els) =>
      els.map((e) => [...e.querySelectorAll('.adjust-sp')].reduce((sum, s) => sum + Number(/\d+/.exec(s.textContent ?? '')?.[0] ?? NaN), 0)),
    )
    expect(sums.length).toBeGreaterThan(0)
    for (const s of sums) expect(s).toBeLessThanOrEqual(66 - 19)
    await page.keyboard.press('Escape')

    await removeAllLocks(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    await openAdjust(card)
    await expect(adjustSps(adjustResult(card, '확정견딤'))).toHaveText(['H32', 'B22+'])
  })

  test('R23·R24: 방어 D쪽 쌍 고정 중 물리 카드 변동은 무보정/B 보정/D 보정에 H·B·D를 모두 보이고 H·D에 고정 표지, 고르면 고정은 그대로 SP·성격만 바뀐다', async ({ page }) => {
    const floette = await lockRow(page, '방어', 'floettemega', 'dazzlinggleam')
    await expect(lockedSp(page, 'hp')).toHaveText('SP HP 고정됨: H0')
    await expect(lockedSp(page, 'spd')).toHaveText('SP 특방 고정됨: D5+ / D16')
    const card = cards(page).and(page.locator('[data-opponent="garchomp"][data-move="dragonclaw"]:not([data-power-item])'))
    await expect(card).toHaveCount(1)
    await openAdjust(card)
    const top = adjustResult(card, '확정견딤')
    // 1단 SP = 내 세트 성격(hardy, 기준 갈래 D16) 기준 무보정(B3). B 보정(B0+)이 더 싸도 무보정
    await expect(adjustSps(top)).toHaveText(['H0 고정', 'B3', 'D16 고정'])
    await expect(top.locator('.adjust-sp[data-locked="true"]')).toHaveText(['H0 고정', 'D16 고정'])
    await top.click()
    const menu = adjustMenu(card)
    await expect(menu).toHaveAttribute('data-stage', 'nature')
    const natures = card.getByTestId('adjust-nature')
    await expect(natures.locator('.adjust-nature-name')).toHaveText(['무보정', 'B 보정', 'D 보정'])
    const expected = [
      ['무보정', ['H0 고정', 'B3', 'D16 고정'], ['H0 고정', 'D16 고정']],
      ['B 보정', ['H0 고정', 'B0+', 'D16 고정'], ['H0 고정', 'D16 고정']],
      ['D 보정', ['H0 고정', 'B3', 'D5+ 고정'], ['H0 고정', 'D5+ 고정']],
    ] as const
    for (const [name, all, locked] of expected) {
      const item = adjustNature(card, name)
      await expect(item).toHaveAttribute('data-enabled', 'true')
      await expect(adjustSps(item)).toHaveText([...all])
      await expect(item.locator('.adjust-sp[data-locked="true"]')).toHaveText([...locked])
    }
    // ← = 1단으로(고른 결과에 포커스), Esc = 닫고 변동 버튼으로
    await page.keyboard.press('ArrowLeft')
    await expect(menu).toHaveAttribute('data-stage', 'result')
    await expect(top).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(adjustButton(card)).toBeFocused()

    // D 보정: 기준 갈래가 D 상승(D5+)으로 바뀌고 B3만 내 세트에 들어간다. 고정 둘(H·D)은 그대로
    await openAdjust(card)
    await top.click()
    await adjustNature(card, 'D 보정').click()
    await settle(page)
    await expect(adjustMenu(card)).toHaveCount(0)
    await expect(spBox(page, '방어')).toHaveValue('3')
    await expect(spBox(page, '특방')).toHaveValue('5')
    await expect(spBox(page, '특방')).toBeDisabled()
    await expect(natureBtn(page, '특방', '상승')).toHaveAttribute('aria-pressed', 'true')
    await expect(lockedSp(page, 'hp')).toHaveText('SP HP 고정됨: H0')
    await expect(lockedSp(page, 'spd')).toHaveText('SP 특방 고정됨: D5+ / D16')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(floette.getByTestId('cut-pin')).toHaveAttribute('aria-pressed', 'true')
    await expect(card.getByTestId('ko-badge')).toHaveText(/^확정견딤/)
  })

  test('R23 자동 전환: S 고정이 상승안(S7+)을 쓰는 중 A 상승을 고르면 S 고정을 무보정안(S19)으로 바꿔 적용하고, 무보정안이 없는 S 고정(S20+)이면 A 상승은 사유와 함께 비활성', async ({ page }) => {
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    const sPlus = natureBtn(page, '스피드', '상승')
    await sPlus.click()
    await settle(page)
    await expect(sPlus).toHaveAttribute('aria-pressed', 'true')
    await expect(spBox(page, '스피드')).toHaveValue('7')
    // 예시 세트 A32는 한카리아스 드래곤클로가 이미 확정1타라, 확정1타로 올리는 선택을 보려고 A20(무보정 A30 미만)으로 낮춘다.
    await spBox(page, '공격').fill('20')
    await settle(page)

    await selectTab(page, '공격')
    await waitComplete(page)
    const card = moveCard(page, 'garchomp', 'dragonclaw')
    await expect(card.getByTestId('ko-badge')).not.toHaveText(/^확정1타/)
    await openAdjust(card)
    await adjustResult(card, '확정1타').click()
    await expect(adjustSps(adjustNature(card, '무보정'))).toHaveText(['A30'])
    const aUp = adjustNature(card, 'A 상승')
    await expect(aUp).toHaveAttribute('data-enabled', 'true')
    // 바뀌는 다른 고정 값도 고정 표지로 보인다
    await expect(adjustSps(aUp)).toHaveText(['A14+', 'S19 고정'])
    await aUp.click()
    await settle(page)
    await expect(adjustMenu(card)).toHaveCount(0)
    // 확정1타(탭 최선)가 되어도 변동 가능 카드라 변동 버튼은 남고 포커스가 돌아온다
    await expect(adjustButton(card)).toBeFocused()
    await expect(sPlus).toHaveAttribute('aria-pressed', 'false')
    await expect(natureBtn(page, '공격', '상승')).toHaveAttribute('aria-pressed', 'true')
    await expect(spBox(page, '스피드')).toHaveValue('19')
    await expect(spBox(page, '공격')).toHaveValue('14')
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S7+ / S19')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(card.getByTestId('ko-badge')).toHaveText(/^확정1타/)

    // 비비용 155는 S20+로만 닿는다: 무보정안이 없어 A 상승은 고를 수 없고 짧은 사유를 보인다
    await removeAllLocks(page)
    await lockBadge(page, VIVILLON_155)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S20+')
    await selectTab(page, '공격')
    await waitComplete(page)
    await openAdjust(card)
    await adjustResult(card, '확정1타').click()
    await expect(adjustNature(card, '무보정')).toHaveAttribute('data-enabled', 'true')
    const blocked = adjustNature(card, 'A 상승')
    await expect(blocked).toHaveAttribute('aria-disabled', 'true')
    await expect(blocked.locator('.adjust-why')).toHaveText('고정과 겹침')
    await expect(adjustSps(blocked)).toHaveCount(0)
    await blocked.focus()
    await page.keyboard.press('Enter')
    await expect(adjustMenu(card)).toHaveAttribute('data-stage', 'nature')
    await expect(blocked).toBeFocused()
    await expect(sPlus).toHaveAttribute('aria-pressed', 'true')
    await expect(spBox(page, '스피드')).toHaveValue('20')
  })

  test('R24: 고정 중 변동을 적용하면 고정은 그대로 두고, 66을 넘는 만큼 고정·변동 밖 능력치를 H→A→B→C→D→S 순으로 줄여 알린다', async ({ page }) => {
    await fillMySet(page, { sp: { HP: 10, 공격: 4, 방어: 10, 특방: 10, 스피드: 32 } })
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S7+ / S19')
    // H10 A4 B10 C13 D10 S19 = 66
    await spBox(page, '특공').fill('13')
    await settle(page)
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText('0')
    const trim = mySet(page).getByTestId('lock-trim')
    await expect(trim).toHaveCount(0)

    await selectTab(page, '공격')
    await waitComplete(page)
    const card = moveCard(page, 'garchomp', 'dragonclaw')
    await expect(card.getByTestId('ko-badge')).toHaveText(/^중난수1타/)
    await openAdjust(card)
    await adjustResult(card, '확정1타').click()
    await adjustNature(card, '무보정').click()
    await settle(page)
    // A 4 → 30이라 26 초과: H 10 → 0, B 10 → 0, C 13 → 7(바꾼 A·고정한 S는 줄이지 않는다)
    await expect(trim).toHaveAttribute('role', 'status')
    await expect(trim).toContainText('H 10 → 0(합계 66 초과로 줄임), B 10 → 0(합계 66 초과로 줄임), C 13 → 7(합계 66 초과로 줄임)')
    for (const [stat, v] of [['HP', '0'], ['공격', '30'], ['방어', '0'], ['특공', '7'], ['특방', '10'], ['스피드', '19']] as const) await expect(spBox(page, stat)).toHaveValue(v)
    await expect(mySet(page).getByTestId('sp-remaining')).toHaveText('0')
    await expect(mySet(page).getByTestId('lock-over-total')).toHaveCount(0)
    await expect(card.getByTestId('ko-badge')).toHaveText(/^확정1타/)
    // 고정은 그대로: 고정 SP 줄·목록·배지 핀
    await expect(lockedSp(page, 'spe')).toHaveText('SP 스피드 고정됨: S7+ / S19')
    await expect(spBox(page, '스피드')).toBeDisabled()
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await selectTab(page, '스피드')
    await expect(badgePin(page, MOLDURYU_140)).toHaveAttribute('aria-pressed', 'true')
  })
  test('AC17: 스피드 배지를 차례로 고정하면 나중 것 하나만 남고(교체), 공격도 같은 능력치 다른 카드를 고정하면 교체한다', async ({ page }) => {
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await lockBadge(page, NINETALES_152)
    await settle(page)
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockList(page).locator('.lock-desc')).toHaveAttribute('title', /^나인테일 /)
    await expect(badgePin(page, MOLDURYU_140)).toHaveAttribute('aria-pressed', 'false')
    await expect(badgePin(page, NINETALES_152)).toHaveAttribute('aria-pressed', 'true')
    await removeAllLocks(page)
    await expect(spBox(page, '스피드')).toHaveValue('32')

    // 공격: 한카리아스 드래곤클로(A) 뒤 다른 A 카드
    await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    // 같은 A를 쓰는 메가앱솔Z 드래곤클로(상승으로만 닿는다)를 고정하면 한카리아스 고정을 교체한다
    const card = await lockRow(page, '공격', 'absolmegaz', 'dragonclaw', '확정1타', 'plus')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(1)
    await expect(lockList(page).locator('.lock-desc')).toHaveAttribute('title', /^메가앱솔Z /)
    await expect(moveCard(page, 'garchomp', 'dragonclaw').getByTestId('cut-pin')).toHaveAttribute('aria-pressed', 'false')
    await expect(card.getByTestId('cut-pin')).toHaveAttribute('aria-pressed', 'true')
  })

  test('AC18: 방어 핀 2단 D 상승·H 최대를 고르면 고정 줄·고정 목록 SP가 메뉴 값이고 D ▲가 눌린다, 공격 상승·무보정도 메뉴 값 그대로', async ({ page }) => {
    await selectTab(page, '방어')
    await waitComplete(page)
    const card = moveCard(page, 'floettemega', 'dazzlinggleam')
    await card.getByTestId('cut-pin').click()
    await pinItem(card, '저난수1타').click()
    const hMax = pinNature(card, 'plus', 'h-max')
    await expect(hMax).toHaveAttribute('data-enabled', 'true')
    const shown = await spsText(hMax)
    const [h, d] = shown.split(' ')
    expect(h).toMatch(/^H\d+$/)
    expect(d).toMatch(/^D\d+\+$/)
    // H 최대가 합 최소보다 H가 크다
    const minSum = await spsText(pinNature(card, 'plus'))
    expect(Number(h.slice(1))).toBeGreaterThan(Number(minSum.split(' ')[0].slice(1)))
    await hMax.click()
    await expect(card.getByTestId('cut-pin')).toHaveAttribute('aria-pressed', 'true')
    await settle(page)
    await expect(spBox(page, 'HP')).toHaveValue(h.slice(1))
    await expect(spBox(page, '특방')).toHaveValue(d.slice(1, -1))
    await expect(natureBtn(page, '특방', '상승')).toHaveAttribute('aria-pressed', 'true')
    await expect(lockList(page).getByTestId('lock-alloc')).toHaveText('H 최대')
    await expect(lockList(page).locator('.lock-sp')).toContainText(`${h} ${d}`)
    await removeAllLocks(page)

    // 공격 상승: 고정 줄 A = 메뉴 값, A ▲ 눌림. 무보정: 메뉴 값, 기준 갈래는 고정 밖(A ▲ 꺼짐)
    await selectTab(page, '공격')
    await waitComplete(page)
    const atk = moveCard(page, 'garchomp', 'dragonclaw')
    for (const nature of ['plus', 'neutral'] as const) {
      await atk.getByTestId('cut-pin').click()
      await pinItem(atk, '확정1타').click()
      const option = pinNature(atk, nature)
      await expect(option).toHaveAttribute('data-enabled', 'true')
      const sp = await spsText(option)
      await option.click()
      await settle(page)
      await expect(spBox(page, '공격')).toHaveValue(sp.replace(/^A/, '').replace('+', ''))
      await expect(natureBtn(page, '공격', '상승')).toHaveAttribute('aria-pressed', nature === 'plus' ? 'true' : 'false')
      await removeAllLocks(page)
    }
  })

  test('@layout 공·방 핀 메뉴 1단·2단이 화면·목록 스크롤 박스에 잘리지 않고 페이지 가로 스크롤이 없다', async ({ page }) => {
    for (const tab of ['공격', '방어'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      const card = cards(page).filter({ has: page.locator('[data-testid="cut-pin"]:not([aria-disabled])') }).first()
      const id = await card.getAttribute('data-card-id')
      const fixed = cards(page).and(page.locator(`[data-card-id="${id!.replace(/["\\]/g, '\\$&')}"]`))
      await fixed.getByTestId('cut-pin').scrollIntoViewIfNeeded()
      await fixed.getByTestId('cut-pin').click()
      const menu = pinMenu(fixed)
      await expect(menu.getByText('계산 중…')).toHaveCount(0, { timeout: 15_000 })
      for (const stage of ['result', 'nature'] as const) {
        if (stage === 'nature') await menu.getByTestId('adjust-result').first().click()
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
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(fixed.getByTestId('cut-pin')).toBeFocused()
    }
  })
})
