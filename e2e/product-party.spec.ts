// 파티 6칸·PokePaste 가져오기(party-pokepaste PRD) 화면 수용 기준 A1~A4·A6~A9·A11. pokepast.es 요청은 전부 route로 대체한다.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  addCustomTarget,
  badge,
  cards,
  combo,
  lockBadge,
  lockList,
  lockRow,
  lockedSp,
  mySet,
  openBadge,
  openProduct,
  resultTab,
  selectTab,
  settle,
  tabPanel,
  waitComplete,
} from './helpers'

const SAMPLE = readFileSync(new URL('../src/party/__fixtures__/glick-mb.txt', import.meta.url), 'utf8')
const PASTE_ID = '27afa251f1c9a8b7'
const PASTE = `https://pokepast.es/${PASTE_ID}`
const STORAGE_KEY = 'ev-maker:party'

/** 예시 세트(한카리아스 S32 무보정 154)로 고정할 수 있는 스피드 배지(갈래 S19 / S7+) */
const MOLDURYU_140 = /^몰드류 S32 성격 무보정, 실수치 140,/
const CUSTOM = '워시로토무'
const CUSTOM_BADGE = new RegExp(`^${CUSTOM} `)

const slots = (page: Page) => page.getByTestId('party-slot')
const slotButton = (page: Page, n: number) => slots(page).nth(n - 1).locator('.party-slot-btn')
const urlInput = (page: Page) => page.getByTestId('paste-url')
const importButton = (page: Page) => page.getByTestId('paste-import')
const pasteError = (page: Page) => page.getByTestId('paste-error')
const confirmOk = (page: Page) => page.getByTestId('party-confirm-ok')
const confirmCancel = (page: Page) => page.getByTestId('party-confirm-cancel')
const customCards = (page: Page) => cards(page).and(page.locator('[data-origin="custom"]'))
const spBox = (page: Page, stat: string) => mySet(page).getByRole('spinbutton', { name: `SP ${stat} 숫자`, exact: true })
const lockItems = (page: Page) => lockList(page).locator('.lock-item')

/** 그 paste의 raw 주소 요청을 body로 응답한다. 요청 수를 돌려주는 함수 */
async function routePaste(page: Page, id: string, reply: { status?: number; body?: string; abort?: boolean }) {
  let hits = 0
  await page.route(`**/pokepast.es/${id}/raw`, (route) => {
    hits++
    if (reply.abort) return route.abort('internetdisconnected')
    return route.fulfill({ status: reply.status ?? 200, contentType: 'text/plain', body: reply.body ?? '', headers: { 'access-control-allow-origin': '*' } })
  })
  return () => hits
}

/** 칸 이름 6개(읽기 이름) */
const slotNames = (page: Page) => slots(page).locator('.party-slot-btn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))

/** 표본 paste를 가져온다(파티에 포켓몬이 있으면 확인을 거친다) */
async function importSample(page: Page) {
  await routePaste(page, PASTE_ID, { body: SAMPLE })
  await urlInput(page).fill(PASTE)
  await importButton(page).click()
  if ((await confirmOk(page).count()) > 0) await confirmOk(page).click()
  await expect(slotButton(page, 6)).toHaveAccessibleName(/^6번 칸: 타부자고/)
}

async function selectSlot(page: Page, n: number) {
  await slotButton(page, n).click()
  await expect(slotButton(page, n)).toHaveAttribute('aria-current', 'true')
}

/** 빈 칸에서 종을 고른다 */
async function pickSpecies(page: Page, label: string) {
  const species = combo(mySet(page), '종')
  await species.fill(label)
  await species.press('Enter')
  await expect(species).toHaveValue(label)
  await waitComplete(page)
}

/** 내 포켓몬 패널의 입력값·눌림 상태·고정 목록·고정 표시를 한 덩어리 글자로(칸 상태 비교용) */
async function mySetFingerprint(page: Page): Promise<string> {
  await expect(lockList(page).getByRole('status')).toHaveCount(0, { timeout: 20_000 })
  return mySet(page).evaluate((root) => {
    const out: string[] = []
    const nameOf = (el: Element) => el.getAttribute('aria-label') ?? el.closest('label')?.firstChild?.textContent?.trim() ?? el.tagName
    for (const el of root.querySelectorAll('input, select')) {
      const f = el as HTMLInputElement | HTMLSelectElement
      if (f.type === 'range') continue
      out.push(`${nameOf(f)}=${f.value}${f.disabled ? '(x)' : ''}`)
    }
    for (const b of root.querySelectorAll('button[aria-pressed]')) out.push(`${b.getAttribute('aria-label')}:${b.getAttribute('aria-pressed')}`)
    for (const li of root.querySelectorAll('.lock-item')) out.push(`lock:${li.getAttribute('data-lock-kind')}:${(li as HTMLElement).innerText.replace(/\s+/g, ' ')}`)
    for (const s of root.querySelectorAll('[data-testid^="sp-locked-"]')) out.push(`${s.getAttribute('data-testid')}:${s.textContent}`)
    return out.join('\n')
  })
}

const savedParty = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)

test.describe('파티 6칸 · PokePaste', () => {
  test('A1: 헤더에 제목·레귤레이션 안내 대신 6칸과 링크 입력·가져오기 버튼', async ({ page }) => {
    await openProduct(page)
    const header = page.locator('.product-header')
    await expect(page.getByText('SP 구간 판정')).toHaveCount(0)
    await expect(header).not.toContainText(/레벨 \d+|SP 능력치당|합계 66/)
    await expect(page.locator('h1')).toHaveCount(0)
    await expect(header.getByRole('list', { name: '파티' })).toBeVisible()
    await expect(slots(page)).toHaveCount(6)
    for (let n = 1; n <= 6; n++) await expect(slotButton(page, n)).toBeVisible()
    await expect(header.getByRole('textbox', { name: 'PokePaste 링크' })).toBeVisible()
    await expect(header.getByRole('button', { name: '가져오기', exact: true })).toBeEnabled()
    // 기본 상태(R23): 1번 칸 예시 세트, 나머지 빈 칸
    expect(await slotNames(page)).toEqual(['1번 칸: 한카리아스 @ 생명의구슬', '2번 칸: 비어 있음', '3번 칸: 비어 있음', '4번 칸: 비어 있음', '5번 칸: 비어 있음', '6번 칸: 비어 있음'])
    await expect(slotButton(page, 1)).toHaveAttribute('aria-current', 'true')
    await expect(slots(page).nth(0).getByTestId('item-mark')).toHaveCount(1)
  })

  test('A2: 1번 칸 컷 고정·기준 갈래가 2번 칸 왕복 뒤 그대로, 보던 탭 유지', async ({ page }) => {
    await openProduct(page)
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await expect(spBox(page, '스피드')).toHaveValue('19')
    // 기준 갈래를 "S 상승(S7+)"으로
    const spePlus = mySet(page).getByRole('button', { name: '스피드 성격 상승', exact: true })
    await spePlus.click()
    await expect(spePlus).toHaveAttribute('aria-pressed', 'true')
    await expect(spBox(page, '스피드')).toHaveValue('7')
    await settle(page)
    const before = await mySetFingerprint(page)
    expect(before).toContain('lock:')

    await selectSlot(page, 2)
    await expect(page.getByTestId('empty-slot-panel')).toHaveAttribute('data-tab', 'speed')
    await expect(lockList(page)).toHaveCount(0)
    await pickSpecies(page, '엘풍')
    await expect(lockList(page)).toHaveCount(0)

    await selectSlot(page, 1)
    await expect(tabPanel(page)).toHaveAttribute('data-tab', 'speed')
    expect(await mySetFingerprint(page)).toBe(before)
    await expect(lockItems(page)).toHaveCount(1)
    await expect(lockedSp(page, 'spe')).toHaveText(/S7\+ \/ S19/)
    await openBadge(page, MOLDURYU_140)
    await expect(page.locator('.speed-badge-item').filter({ has: badge(page, MOLDURYU_140) }).first().getByTestId('cut-pin')).toHaveAttribute('aria-pressed', 'true')
  })

  test('A3: 2번 칸에서 더한 커스텀 상대가 1번 칸 공·방·스피드에 보이고, 지우면 모든 칸의 그 상대 고정이 풀린다', async ({ page }) => {
    await openProduct(page)
    // 1번 칸: 래더 상대 고정 하나(지워지면 안 된다). 같은 능력치 고정은 하나(교체)라 뒤의 커스텀 스피드 고정과 겹치지 않게 공격 고정으로 건다
    await lockRow(page, '공격', 'garchomp', 'dragonclaw')

    await selectSlot(page, 2)
    await pickSpecies(page, '한카리아스')
    await addCustomTarget(page, CUSTOM, ['하이드로펌프'])
    // 2번 칸: 커스텀 상대(스피드 배지)에 고정
    await lockBadge(page, CUSTOM_BADGE)
    await settle(page)
    await expect(lockItems(page)).toHaveCount(1)

    await selectSlot(page, 1)
    for (const tab of ['공격', '방어'] as const) {
      await selectTab(page, tab)
      await waitComplete(page)
      await expect(customCards(page).first(), `${tab} 탭 커스텀 상대`).toBeVisible()
      await expect(customCards(page).first()).toContainText(CUSTOM)
    }
    // 1번 칸에서도 그 상대에 고정(스피드 탭)
    await lockBadge(page, CUSTOM_BADGE)
    await settle(page)
    await expect(lockItems(page)).toHaveCount(2)
    await selectTab(page, '공격')
    await waitComplete(page)

    // 지우기: 공격 탭 커스텀 카드의 프리셋 편집 → 타겟 삭제
    const card = customCards(page).first()
    await card.getByTestId('preset-edit').click()
    await page.getByRole('button', { name: `${CUSTOM} 타겟 삭제`, exact: true }).click()
    await expect(customCards(page)).toHaveCount(0)
    await settle(page)
    await expect(lockItems(page)).toHaveCount(1)
    await expect(lockItems(page).first().getByRole('button', { name: /보기$/ })).toHaveAccessibleName(/한카리아스/)
    await expect(lockList(page)).not.toContainText('대상 없음')

    await selectSlot(page, 2)
    await expect(lockList(page)).toHaveCount(0)
    await selectTab(page, '스피드')
    await expect(page.getByTestId('speed-badge').and(page.getByRole('button', { name: CUSTOM_BADGE }))).toHaveCount(0)
  })

  test('A4: 표본 paste로 6칸이 순서대로 채워지고 종·도구·특성·성격·기술·SP가 paste와 같다, 메가스톤은 메가 폼', async ({ page }) => {
    await openProduct(page)
    const hits = await routePaste(page, PASTE_ID, { body: SAMPLE })
    // 변형 주소(https 없음·끝의 /raw)도 같은 paste
    await urlInput(page).fill(`pokepast.es/${PASTE_ID}/raw`)
    await importButton(page).click()
    await expect(page.getByRole('dialog', { name: /현재 파티를 바꿉니다/ })).toBeVisible()
    await confirmOk(page).click()
    await expect(slotButton(page, 6)).toHaveAccessibleName(/^6번 칸: /)
    expect(hits()).toBe(1)
    expect(await slotNames(page)).toEqual([
      '1번 칸: 메가라이츄Y @ 라이츄나이트Y',
      '2번 칸: 대쓰여너 @ 신비의물방울',
      '3번 칸: 엘풍 @ 기합의띠',
      '4번 칸: 한카리아스 @ 자뭉열매',
      '5번 칸: 메가플라엣테 @ 플라베베나이트',
      '6번 칸: 타부자고 @ 생명의구슬',
    ])
    await expect(slotButton(page, 1)).toHaveAttribute('aria-current', 'true')
    await expect(page.getByTestId('paste-report')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: '6마리를 가져왔습니다.' })).toHaveCount(1)

    const STATS = ['HP', '공격', '방어', '특공', '특방', '스피드'] as const
    const expected = [
      { species: '메가라이츄Y', mega: true, item: '라이츄나이트Y', plus: '특공', moves: ['방어', '전자포', '기합구슬', '속이기'], sp: [16, 0, 2, 24, 0, 24] },
      { species: '대쓰여너', ability: 'adaptability', item: '신비의물방울', plus: '공격', moves: ['방어', '웨이브태클', '성묘', '아쿠아제트'], sp: [12, 32, 7, 0, 0, 15] },
      { species: '엘풍', ability: 'prankster', item: '기합의띠', plus: '스피드', moves: ['방어', '문포스', '순풍', '앙코르'], sp: [2, 0, 0, 32, 0, 32] },
      { species: '한카리아스', ability: 'roughskin', item: '자뭉열매', plus: '공격', moves: ['스톤샤워', '분함의발구르기', '드래곤클로', '방어'], sp: [22, 10, 0, 0, 2, 32] },
      { species: '메가플라엣테', mega: true, item: '플라베베나이트', plus: '특공', moves: ['방어', '문포스', '파멸의빛', '매지컬샤인'], sp: [2, 0, 0, 32, 0, 32] },
      { species: '타부자고', ability: 'goodasgold', item: '생명의구슬', plus: '특공', moves: ['방어', '골드러시', '나쁜음모', '섀도볼'], sp: [32, 0, 2, 10, 3, 19] },
    ]
    for (const [i, e] of expected.entries()) {
      await selectSlot(page, i + 1)
      const me = mySet(page)
      await expect(combo(me, '종'), `${i + 1}번 칸 종`).toHaveValue(e.species)
      if (e.mega) {
        await expect(me.getByTestId('mega-ability'), `${i + 1}번 칸 메가 특성 고정`).toBeVisible()
        await expect(me.locator('label.chip', { hasText: /^도구/ }).locator('input')).toHaveValue(e.item)
      } else {
        await expect(me.locator('label.chip', { hasText: /^특성/ }).locator('select'), `${i + 1}번 칸 특성`).toHaveValue(e.ability!)
        await expect(combo(me, '도구'), `${i + 1}번 칸 도구`).toHaveValue(e.item)
      }
      for (const [k, m] of e.moves.entries()) await expect(combo(me, `기술 ${k + 1}`), `${i + 1}번 칸 기술 ${k + 1}`).toHaveValue(m)
      for (const [k, stat] of STATS.entries()) await expect(spBox(page, stat), `${i + 1}번 칸 SP ${stat}`).toHaveValue(String(e.sp[k]))
      for (const stat of STATS.slice(1)) {
        await expect(me.getByRole('button', { name: `${stat} 성격 상승`, exact: true }), `${i + 1}번 칸 ${stat} 상승`).toHaveAttribute('aria-pressed', String(stat === e.plus))
      }
    }
  })

  test('A6: 형식 오류·없는 paste·네트워크 실패·포켓몬 없는 paste는 원인별 오류, 파티 불변', async ({ page }) => {
    await openProduct(page)
    await importSample(page)
    await selectSlot(page, 3)
    const names = await slotNames(page)
    const fp = await mySetFingerprint(page)

    await urlInput(page).fill('https://example.com/27afa251f1c9a8b7')
    await importButton(page).click()
    await expect(pasteError(page)).toHaveAttribute('data-reason', 'format')
    await expect(pasteError(page)).toHaveAttribute('role', 'alert')
    await expect(urlInput(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(confirmOk(page)).toHaveCount(0)

    const cases = [
      { id: '00000000deadbeef', reply: { status: 404, body: 'Not Found' }, reason: 'not-found' },
      { id: '000000000000cafe', reply: { abort: true }, reason: 'network' },
      { id: '00000000000000e0', reply: { body: '\n  \n' }, reason: 'empty' },
    ] as const
    for (const c of cases) {
      const hits = await routePaste(page, c.id, c.reply)
      await urlInput(page).fill(`https://pokepast.es/${c.id}/`)
      await importButton(page).click()
      await confirmOk(page).click()
      await expect(pasteError(page), c.reason).toHaveAttribute('data-reason', c.reason)
      await expect(pasteError(page)).toContainText('파티는 그대로입니다')
      await expect(importButton(page)).toBeEnabled()
      expect(hits()).toBe(1)
      expect(await slotNames(page)).toEqual(names)
      await expect(slotButton(page, 3)).toHaveAttribute('aria-current', 'true')
    }
    expect(await mySetFingerprint(page)).toBe(fp)
  })

  test('R21: 가져오는 동안 버튼이 "가져오는 중…"으로 막힌다', async ({ page }) => {
    await openProduct(page)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await page.route(`**/pokepast.es/${PASTE_ID}/raw`, async (route) => {
      await gate
      await route.fulfill({ status: 200, contentType: 'text/plain', body: SAMPLE, headers: { 'access-control-allow-origin': '*' } })
    })
    await urlInput(page).fill(PASTE)
    await importButton(page).click()
    await confirmOk(page).click()
    await expect(importButton(page)).toBeDisabled()
    await expect(importButton(page)).toHaveText('가져오는 중…')
    await expect(page.getByTestId('party-clear-all')).toBeDisabled()
    release()
    await expect(importButton(page)).toHaveText('가져오기')
    await expect(slotButton(page, 1)).toHaveAccessibleName(/^1번 칸: 메가라이츄Y/)
  })

  test('A7: 기존 파티가 있을 때 가져오기는 확인을 거치고, 취소하면 요청도 변화도 없다', async ({ page }) => {
    await openProduct(page)
    const hits = await routePaste(page, PASTE_ID, { body: SAMPLE })
    const names = await slotNames(page)
    const fp = await mySetFingerprint(page)
    await urlInput(page).fill(PASTE)
    await importButton(page).click()
    const dialog = page.getByRole('dialog', { name: /현재 파티를 바꿉니다/ })
    await expect(dialog).toBeVisible()
    await expect(confirmOk(page)).toBeFocused()
    await confirmCancel(page).click()
    await expect(dialog).toHaveCount(0)
    await expect(importButton(page)).toBeFocused()
    // Esc로도 닫힌다
    await importButton(page).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(hits()).toBe(0)
    expect(await slotNames(page)).toEqual(names)
    expect(await mySetFingerprint(page)).toBe(fp)
    await expect(urlInput(page)).toHaveValue(PASTE)
  })

  test('A8: 칸 비우기·끌어서/Alt+화살표로 순서 바꾸기·파티 비우기, 순서를 바꿔도 칸 상태가 섞이지 않는다', async ({ page }) => {
    await openProduct(page)
    await importSample(page)
    // 2번 칸(대쓰여너) SP를 바꿔 두고 상태를 적어 둔다
    await selectSlot(page, 2)
    await spBox(page, '방어').fill('0')
    await expect(spBox(page, '방어')).toHaveValue('0')
    await waitComplete(page)
    const basculegion = await mySetFingerprint(page)
    await selectSlot(page, 3)
    const whimsicott = await mySetFingerprint(page)

    // 끌어서: 2번 → 4번 자리(활성 칸 3번 엘풍은 따라 2번으로)
    await slots(page).nth(1).locator('.party-slot-frame').dragTo(slots(page).nth(3).locator('.party-slot-frame'))
    await expect(slotButton(page, 4)).toHaveAccessibleName(/^4번 칸: 대쓰여너/)
    const afterDrag = await slotNames(page)
    expect(afterDrag.map((n) => n.replace(/^\d번 칸: /, ''))).toEqual(['메가라이츄Y @ 라이츄나이트Y', '엘풍 @ 기합의띠', '한카리아스 @ 자뭉열매', '대쓰여너 @ 신비의물방울', '메가플라엣테 @ 플라베베나이트', '타부자고 @ 생명의구슬'])
    const activeIdx = await slots(page).evaluateAll((els) => els.findIndex((e) => e.getAttribute('data-active') === 'true'))
    await expect(slotButton(page, activeIdx + 1)).toHaveAccessibleName(/엘풍/)
    expect(await mySetFingerprint(page)).toBe(whimsicott)
    await selectSlot(page, 4)
    expect(await mySetFingerprint(page)).toBe(basculegion)

    // 키보드 대체: 4번(대쓰여너, 활성)을 Alt+← 로 3번으로
    await slotButton(page, 4).focus()
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(slotButton(page, 3)).toHaveAccessibleName(/^3번 칸: 대쓰여너/)
    await expect(slotButton(page, 4)).toHaveAccessibleName(/^4번 칸: 한카리아스/)
    await expect(slotButton(page, 3)).toBeFocused()
    await expect(slotButton(page, 3)).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('status').filter({ hasText: '3번 칸으로 옮겼습니다.' })).toHaveCount(1)
    expect(await mySetFingerprint(page)).toBe(basculegion)
    // 양 끝에서는 움직이지 않는다
    await slotButton(page, 1).focus()
    const beforeEdge = await slotNames(page)
    await page.keyboard.press('Alt+ArrowLeft')
    expect(await slotNames(page)).toEqual(beforeEdge)

    // 칸 비우기(활성 칸 3번 대쓰여너): 상태가 사라지고 빈 칸 안내
    await slotButton(page, 3).hover()
    await slots(page).nth(2).getByTestId('party-slot-clear').click()
    await expect(slotButton(page, 3)).toHaveAccessibleName('3번 칸: 비어 있음')
    await selectSlot(page, 3)
    await expect(page.getByTestId('empty-slot-panel')).toBeVisible()
    await expect(combo(mySet(page), '종')).toHaveValue('')
    // 다른 칸은 그대로
    await selectSlot(page, 2)
    expect(await mySetFingerprint(page)).toBe(whimsicott)

    // 파티 비우기: 취소하면 그대로, 확인하면 6칸 모두 빈 칸
    const clearAll = page.getByTestId('party-clear-all')
    await clearAll.click()
    await expect(page.getByRole('dialog', { name: /파티 6칸을 모두 비웁니다/ })).toBeVisible()
    await confirmCancel(page).click()
    await expect(slotButton(page, 1)).toHaveAccessibleName(/^1번 칸: 메가라이츄Y/)
    await clearAll.click()
    await confirmOk(page).click()
    for (let n = 1; n <= 6; n++) await expect(slotButton(page, n)).toHaveAccessibleName(`${n}번 칸: 비어 있음`)
    await expect(page.getByTestId('empty-slot-panel')).toBeVisible()
    await expect(clearAll).toBeDisabled()
    // 빈 파티에서는 확인 없이 바로 가져온다
    await urlInput(page).fill(PASTE)
    await importButton(page).click()
    await expect(confirmOk(page)).toHaveCount(0)
    await expect(slotButton(page, 1)).toHaveAccessibleName(/^1번 칸: 메가라이츄Y/)
  })

  test('A9: 새로고침하면 칸 순서·활성 칸·칸 상태·컷 고정·전역 상대 목록이 그대로', async ({ page }) => {
    await openProduct(page)
    await lockBadge(page, MOLDURYU_140)
    await settle(page)
    await selectSlot(page, 2)
    await pickSpecies(page, '엘풍')
    await addCustomTarget(page, CUSTOM, ['하이드로펌프'])
    // 2번(엘풍) ↔ 1번 자리 바꾸기: 엘풍이 1번·활성
    await slotButton(page, 2).focus()
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(slotButton(page, 1)).toHaveAccessibleName(/^1번 칸: 엘풍/)
    await selectTab(page, '방어')
    await waitComplete(page)
    const names = await slotNames(page)
    const fpActive = await mySetFingerprint(page)
    await selectSlot(page, 2)
    const fpChomp = await mySetFingerprint(page)
    await selectSlot(page, 1)
    // 저장(지연 저장)이 끝날 때까지
    await expect.poll(async () => JSON.parse((await savedParty(page)) ?? 'null')?.active).toBe(0)

    await page.reload()
    await expect(page.locator('main[data-app="product"]')).toBeVisible()
    await expect(slotButton(page, 1)).toHaveAttribute('aria-current', 'true')
    expect(await slotNames(page)).toEqual(names)
    await expect(tabPanel(page)).toHaveAttribute('data-first-card', 'true', { timeout: 15_000 })
    await waitComplete(page)
    expect(await mySetFingerprint(page)).toBe(fpActive)
    await expect(customCards(page).first()).toContainText(CUSTOM)
    await selectSlot(page, 2)
    expect(await mySetFingerprint(page)).toBe(fpChomp)
    await expect(lockItems(page)).toHaveCount(1)
  })

  for (const [label, raw] of [
    ['JSON이 아님', '{not json'],
    ['모르는 형식 버전', JSON.stringify({ version: 999, slots: [] })],
    ['모양이 틀림', JSON.stringify({ version: 1, regulation: 'x', slots: 'nope', active: 9, globals: null })],
  ] as const) {
    test(`A9/R24: 깨진 저장 데이터(${label})는 무시하고 기본 상태로 뜬다`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.addInitScript(
        ([key, value]) => {
          if (!sessionStorage.getItem('seeded')) {
            localStorage.setItem(key, value)
            sessionStorage.setItem('seeded', '1')
          }
        },
        [STORAGE_KEY, raw],
      )
      await openProduct(page)
      expect(await slotNames(page)).toEqual(['1번 칸: 한카리아스 @ 생명의구슬', '2번 칸: 비어 있음', '3번 칸: 비어 있음', '4번 칸: 비어 있음', '5번 칸: 비어 있음', '6번 칸: 비어 있음'])
      await expect(slotButton(page, 1)).toHaveAttribute('aria-current', 'true')
      await waitComplete(page)
      expect(errors).toEqual([])
    })
  }

  test('A11 키보드: Tab으로 칸에 가서 Enter/Space로 고른다, 칸 이름에 포켓몬·도구', async ({ page }) => {
    await openProduct(page)
    await importSample(page)
    await slotButton(page, 1).focus()
    // 1번 칸 다음은 그 칸의 비우기 버튼, 그다음이 2번 칸
    await page.keyboard.press('Tab')
    await expect(slots(page).nth(0).getByTestId('party-slot-clear')).toBeFocused()
    await expect(page.locator(':focus')).toHaveAccessibleName('1번 칸 비우기')
    await page.keyboard.press('Tab')
    await expect(slotButton(page, 2)).toBeFocused()
    await expect(slotButton(page, 2)).toHaveAccessibleName('2번 칸: 대쓰여너 @ 신비의물방울')
    await page.keyboard.press('Enter')
    await expect(slotButton(page, 2)).toHaveAttribute('aria-current', 'true')
    await expect(combo(mySet(page), '종')).toHaveValue('대쓰여너')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(slotButton(page, 3)).toBeFocused()
    await page.keyboard.press('Space')
    await expect(slotButton(page, 3)).toHaveAttribute('aria-current', 'true')
    await expect(combo(mySet(page), '종')).toHaveValue('엘풍')
    await expect(resultTab(page, '공격')).toHaveAttribute('aria-selected', 'true')
  })

  test.describe('400px', () => {
    test.use({ viewport: { width: 400, height: 900 } })
    test('A11: 파티 6칸·가져오기 입력이 가로로 넘치지 않는다(가득 찬 파티·오류 안내 포함) @layout', async ({ page }) => {
      await openProduct(page)
      const noOverflow = async (what: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${what} 페이지 가로 넘침`).toBeLessThanOrEqual(0)
        const vw = page.viewportSize()!.width
        for (const loc of [page.getByTestId('party-bar'), ...[0, 1, 2, 3, 4, 5].map((i) => slots(page).nth(i)), urlInput(page), importButton(page)]) {
          const box = (await loc.boundingBox())!
          expect(box.x, what).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width, what).toBeLessThanOrEqual(vw)
        }
      }
      await noOverflow('기본')
      await importSample(page)
      await noOverflow('가득 찬 파티')
      await urlInput(page).fill('nope')
      await importButton(page).click()
      await expect(pasteError(page)).toBeVisible()
      await noOverflow('오류 안내')
      await page.screenshot({ path: test.info().outputPath('party-400.png'), fullPage: false })
    })
  })
})
