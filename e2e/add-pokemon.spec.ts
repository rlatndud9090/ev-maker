import { expect, test, type Locator, type Page } from '@playwright/test'
import { loadMetaSnapshotSync, loadSnapshotSync } from '../src/data/testing'
import {
  addCustomTarget,
  addOption,
  addPanel,
  addPanelButton,
  cards,
  combo,
  mySet,
  openAddPanel,
  openProduct,
  pickAddTarget,
  selectTab,
  tabPanel,
  waitComplete,
} from './helpers'

// '포켓몬 추가' 패널(PRD R3·R4·R6·R7·R9·R10): 이미 있는 포켓몬의 새 배분, 중복·잘못된 SP 문구, 목록 밖 추가 배분, 표시 범위 밖 노출.

const game = loadSnapshotSync()
const meta = loadMetaSnapshotSync({ regulation: game.manifest.regulation.id, match: 'bo1' })
const ranking = [...meta.entries].sort((a, b) => a.rank - b.rank)
const SP_MAX = game.manifest.rules.spMaxPerStat
const INVALID = `SP는 0~${SP_MAX} 정수로 입력해 주세요.`
const BAD_SP = [String(SP_MAX + 1), '-1', '1.5']

const speciesLabel = (id: string) => {
  const n = game.data.species[id]?.name
  if (n === undefined) throw new Error(`종 없음: ${id}`)
  return n.koLabel ? `${n.ko}(${n.koLabel})` : n.ko
}
/** 메가 폼이 아닌(검색 이름이 그대로인) 메타 항목, 사용률 순 */
const plainEntries = ranking.filter((e) => game.data.species[e.id] !== undefined && game.data.species[e.id].isMega !== true)

type Sign = 'plus' | 'neutral' | 'minus'
const SIGN_TEXT: Record<Sign, string> = { plus: '↑', neutral: '', minus: '↓' }
const speedText = (sp: number, sign: Sign) => `S${sp}${SIGN_TEXT[sign]}`
const isSign = (v: unknown): v is Sign => v === 'plus' || v === 'neutral' || v === 'minus'

// ---------- 화면 조작 ----------

const badges = (page: Page) => page.getByTestId('speed-badge')
const addedBadges = (page: Page) => page.locator('[data-testid="speed-badge"][data-origin="added"]')
const presetBadges = (page: Page) => page.locator('[data-testid="speed-badge"][data-origin="preset"]')
const detail = (page: Page) => page.getByTestId('speed-detail')
const badgeById = (page: Page, id: string) => page.locator(`[data-testid="speed-badge"][data-badge-id='${id}']`)
const toolbarSpin = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true })
const bundleButton = (card: Locator) => card.locator('button.bundle-btn')
const bundleMenu = (card: Locator) => card.getByRole('menu', { name: '노력치 배분', exact: true })
const opponentCards = (page: Page, id: string) => cards(page).and(page.locator(`[data-opponent="${id}"]`))
const customCards = (page: Page) => cards(page).and(page.locator('[data-origin="custom"]'))

interface BadgeInfo {
  id: string
  origin: string
  opponent: string
  sp: number
  sign: Sign
  condition: string
}

async function readBadges(page: Page): Promise<BadgeInfo[]> {
  const raw = await badges(page).evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-badge-id') ?? '', condition: el.getAttribute('data-condition') ?? '' })))
  return raw.map((b) => {
    const parsed: unknown = JSON.parse(b.id)
    if (!Array.isArray(parsed)) throw new Error(`배지 id 형식: ${b.id}`)
    const [origin, opponent, , sp, sign] = parsed
    if (typeof origin !== 'string' || typeof opponent !== 'string' || typeof sp !== 'number' || !isSign(sign)) throw new Error(`배지 id 형식: ${b.id}`)
    return { ...b, origin, opponent, sp, sign }
  })
}
const badgesOf = async (page: Page, opponent: string) => (await readBadges(page)).filter((b) => b.opponent === opponent)

async function openSpeed(page: Page) {
  await openProduct(page)
  await waitComplete(page)
  await selectTab(page, '스피드')
  await expect(badges(page).first()).toBeVisible()
}

async function setTopN(page: Page, n: number) {
  const box = toolbarSpin(page, '상위 N')
  await box.fill(String(n))
  await box.press('Enter')
  await expect(box).toHaveValue(String(n))
}

/** 패널 스피드 입력의 현재 값(S SP·▲▼ 눌림) */
async function panelSpeedValue(panel: Locator): Promise<{ sp: number; sign: Sign }> {
  const sp = Number(await panel.getByTestId('add-sp-spe').inputValue())
  const plus = (await panel.getByTestId('add-nat-plus').getAttribute('aria-pressed')) === 'true'
  const minus = (await panel.getByTestId('add-nat-minus').getAttribute('aria-pressed')) === 'true'
  return { sp, sign: plus ? 'plus' : minus ? 'minus' : 'neutral' }
}

/** ▲▼ 토글을 sign에 맞춘다(scope 안의 '스피드 성격 상승'·'스피드 성격 하락') */
async function setSign(scope: Locator, sign: Sign) {
  const up = scope.getByRole('button', { name: '스피드 성격 상승', exact: true })
  const down = scope.getByRole('button', { name: '스피드 성격 하락', exact: true })
  for (const [k, btn] of [['plus', up], ['minus', down]] as const) {
    const on = (await btn.getAttribute('aria-pressed')) === 'true'
    if (on !== (sign === k)) await btn.click()
  }
  await expect(up).toHaveAttribute('aria-pressed', String(sign === 'plus'))
  await expect(down).toHaveAttribute('aria-pressed', String(sign === 'minus'))
}

const STAT_OF: Record<string, string> = { H: 'hp', A: 'atk', B: 'def', C: 'spa', D: 'spd', S: 'spe' }
const signOfMark = (mark: string): Sign => (mark === '↑' ? 'plus' : mark === '↓' ? 'minus' : 'neutral')
/** 배분 표기 "H32 B4↑" → 능력치별 SP·부호 */
const parseBundle = (text: string) => [...text.matchAll(/([HABCDS])(\d+)([↑↓]?)/g)].map((m) => ({ stat: STAT_OF[m[1]], sp: m[2], sign: signOfMark(m[3]) }))

/** 키 능력치 ▲▼(testid `${prefix}-${stat}-plus|minus`)를 sign에 맞춘다. H에는 토글이 없다 */
async function setStatSign(scope: Locator, prefix: string, stat: string, sign: Sign) {
  if (stat === 'hp') {
    await expect(scope.locator(`[data-testid^="${prefix}-hp-"]`)).toHaveCount(0)
    return
  }
  for (const k of ['plus', 'minus'] as const) {
    const btn = scope.getByTestId(`${prefix}-${stat}-${k}`)
    if (((await btn.getAttribute('aria-pressed')) === 'true') !== (sign === k)) await btn.click()
  }
  for (const k of ['plus', 'minus'] as const) await expect(scope.getByTestId(`${prefix}-${stat}-${k}`)).toHaveAttribute('aria-pressed', String(sign === k))
}

/** 패널 공·방 직접 입력을 배분 표기 text(SP·부호)로 채운다 */
async function fillDamage(panel: Locator, text: string) {
  const parts = parseBundle(text)
  await expect(damageFields(panel)).toHaveCount(parts.length)
  for (const p of parts) {
    await panel.getByTestId(`add-sp-${p.stat}`).fill(p.sp)
    await setStatSign(panel, 'add-nat', p.stat, p.sign)
  }
}

/** 공·방 직접 입력 칸(키 능력치 순) */
const damageFields = (panel: Locator) => panel.locator('.add-direct input[data-testid^="add-sp-"]')

/** 공·방 직접 입력 값 "H32 B4"(무보정 표기) */
async function damageInputText(panel: Locator): Promise<string> {
  const fields = await damageFields(panel).evaluateAll((els) => els.map((el) => ({ stat: el.getAttribute('data-testid')?.slice('add-sp-'.length) ?? '', sp: el instanceof HTMLInputElement ? el.value : '' })))
  const SHORT: Record<string, string> = { hp: 'H', atk: 'A', def: 'B', spa: 'C', spd: 'D', spe: 'S' }
  return fields.map((f) => `${SHORT[f.stat]}${f.sp}`).join(' ')
}

/** 행의 배분 메뉴 항목(카드 id·라벨·사용자 추가 여부·핀 칸)을 읽고 Escape로 닫는다. */
async function menuOptions(card: Locator) {
  await bundleButton(card).click()
  const items = bundleMenu(card).locator('.bundle-opt-row')
  await expect(items.first()).toBeVisible()
  const out = await items.evaluateAll((rows) =>
    rows.map((r) => {
      const item = r.querySelector<HTMLElement>('[role="menuitemradio"]')
      return {
        id: item?.dataset.cardId ?? '',
        text: item?.querySelector('.bundle-opt-label')?.textContent ?? '',
        user: item?.dataset.userAdded === 'true',
        pin: r.querySelector('[role="menuitemcheckbox"]') !== null,
        slot: r.querySelector('.pin-slot') !== null,
      }
    }),
  )
  await bundleMenu(card).press('Escape')
  await expect(bundleMenu(card)).toHaveCount(0)
  return out
}

/** 지금 포커스가 opponent 카드 줄의 배분 버튼인가 */
const focusedCardOf = (page: Page) =>
  page.evaluate(() => {
    const li = document.activeElement?.closest<HTMLElement>('[data-testid="card"]')
    return li ? { opponent: li.dataset.opponent ?? '', cardId: li.dataset.cardId ?? '', userAdded: li.dataset.userAdded === 'true', bundleBtn: document.activeElement?.classList.contains('bundle-btn') ?? false } : null
  })
const focusedBadgeId = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    return el?.getAttribute('data-testid') === 'speed-badge' ? el.getAttribute('data-badge-id') : null
  })

// ---------- 시나리오 ----------

test.describe("'포켓몬 추가' 패널", () => {
  test('검색 후보 상태: 범위 안 "메타 목록", 범위 밖 "표시 범위 밖", 추가한 목록 밖 "추가됨", 새 포켓몬은 태그 없음(셋 다 고를 수 있다)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    await waitComplete(page)
    await setTopN(page, 1)
    const inRange = plainEntries[0]
    expect(inRange.rank).toBe(1)
    const outside = plainEntries[1]
    const panel = await openAddPanel(page)
    const cases: [string, string | null][] = [
      [speciesLabel(inRange.id), '메타 목록'],
      [speciesLabel(outside.id), '표시 범위 밖'],
      ['워시로토무', '추가됨'],
      ['히트로토무', null],
    ]
    for (const [label, tag] of cases) {
      await pickAddTarget(page, label, tag)
      const chip = panel.getByTestId('add-chip')
      if (tag === null) {
        await expect(chip.locator('.combo-tag')).toHaveCount(0)
        await expect(panel.getByRole('group', { name: /^기술/ })).toBeVisible()
      } else {
        await expect(chip.locator('.combo-tag')).toHaveText(tag)
        await expect(panel.getByRole('group', { name: /^기술/ })).toHaveCount(0)
      }
      await panel.getByTestId('add-reset').click()
      await expect(panel.getByRole('combobox', { name: '추가할 포켓몬', exact: true })).toBeFocused()
    }
    // 상태 태그는 후보 접근 이름에 함께 읽힌다
    await panel.getByRole('combobox', { name: '추가할 포켓몬', exact: true }).fill(speciesLabel(outside.id))
    await expect(addOption(page, speciesLabel(outside.id), '표시 범위 밖')).toHaveAccessibleName(`${speciesLabel(outside.id)} 표시 범위 밖`)
  })

  test('범위 밖 메타 포켓몬(상위 N=1): 스피드 기본값(1위 배분)으로 추가하면 그 추가 배지만 생겨 포커스, 상위 N 그대로·공격 탭엔 없음, 지우면 사라진다', async ({ page }) => {
    await openSpeed(page)
    await setTopN(page, 1)
    const entry = plainEntries[1]
    expect(await badgesOf(page, entry.id)).toEqual([])
    const panel = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '표시 범위 밖')
    const value = await panelSpeedValue(panel)
    // 범위 밖 1위 배분은 차트에 없으니 추가할 수 있다
    await expect(panel.getByTestId('add-observed-option').and(page.locator('[data-state="shown"]'))).toHaveCount(0)
    await panel.getByTestId('add-submit').click()
    await expect(addPanel(page)).toHaveCount(0)
    await expect(addedBadges(page)).toHaveCount(1)
    const list = await badgesOf(page, entry.id)
    // 추가 배지만: 기본(스카프 없음)·조건 래더 배지는 없다
    expect(list.filter((b) => b.origin === 'ladder')).toEqual([])
    expect(list.filter((b) => b.origin === 'added' && b.condition === 'none').map((b) => [b.sp, b.sign])).toEqual([[value.sp, value.sign]])
    const added = list.find((b) => b.origin === 'added' && b.condition === 'none')!
    await expect.poll(() => focusedBadgeId(page)).toBe(added.id)
    await expect(detail(page)).toHaveAttribute('data-badge-id', added.id)
    await expect(toolbarSpin(page, '상위 N')).toHaveValue('1')

    await selectTab(page, '공격')
    await waitComplete(page)
    await expect(opponentCards(page, entry.id)).toHaveCount(0)
    await selectTab(page, '스피드')
    await expect(addedBadges(page)).toHaveCount(1)
    await badgeById(page, added.id).click()
    await detail(page).getByTestId('speed-remove').click()
    await expect(addedBadges(page)).toHaveCount(0)
    expect(await badgesOf(page, entry.id)).toEqual([])
    await expect(toolbarSpin(page, '상위 N')).toHaveValue('1')
  })

  test('목록 밖 포켓몬 공격 배분: 다시 고르면 SP 입력(기본 첫 프리셋), 프리셋과 같으면 이미 존재합니다, 새 SP는 선택·고정·포커스, 메뉴 핀으로 지우면 프리셋 3개만', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    await waitComplete(page)
    const row = customCards(page).first()
    const presets = await menuOptions(row)
    expect(presets.map((o) => o.text)).toEqual([expect.stringMatching(/ 프리셋 1$/), expect.stringMatching(/ 프리셋 2$/), expect.stringMatching(/ 프리셋 3$/)])
    expect(presets.every((o) => !o.pin && o.slot)).toBe(true)
    const presetText = (o: { text: string }) => o.text.replace(/ 프리셋 \d$/, '')

    const panel = await openAddPanel(page)
    await pickAddTarget(page, '워시로토무', '추가됨')
    await expect(panel.getByRole('group', { name: /^기술/ })).toHaveCount(0)
    // 내 기술이 모두 물리라 공격 탭 분류는 물리 하나: 분류 선택 없이 H·B 입력, B에만 ▲▼(H·스피드 토글 없음)
    await expect(panel.getByTestId('add-category')).toHaveCount(0)
    await expect(panel.getByTestId('add-sp-hp')).toBeVisible()
    await expect(panel.getByTestId('add-sp-def')).toBeVisible()
    await expect(panel.getByTestId('add-nat-plus')).toHaveCount(0)
    await expect(panel.locator('[data-testid^="add-nat-hp-"]')).toHaveCount(0)
    await expect(panel.getByTestId('add-nat-def-plus')).toHaveAttribute('aria-pressed', 'false')
    await expect(panel.getByTestId('add-nat-def-minus')).toHaveAttribute('aria-pressed', 'false')
    await expect(panel.getByTestId('add-observed-option')).toHaveCount(0)
    const first = presetText(presets[0])
    expect(await damageInputText(panel)).toBe(first)
    const generation = await tabPanel(page).getAttribute('data-generation')
    await panel.getByTestId('add-submit').click()
    await expect(panel.getByTestId('add-msg')).toHaveText(`이미 존재합니다 — ${first}`)
    await expect(panel.getByTestId('add-sp-hp')).toHaveAttribute('aria-describedby', (await panel.getByTestId('add-msg').getAttribute('id'))!)
    await expect(tabPanel(page)).toHaveAttribute('data-generation', generation!)
    // 입력을 바꾸면 안내가 지워진다
    const taken = new Set(presets.map(presetText))
    let b = 0
    while (taken.has(`H${await panel.getByTestId('add-sp-hp').inputValue()} B${b}`)) b++
    await panel.getByTestId('add-sp-def').fill(String(b))
    await expect(panel.getByTestId('add-msg')).toHaveText('')
    const text = await damageInputText(panel)
    await panel.getByTestId('add-submit').click()
    await expect(addPanel(page)).toHaveCount(0)
    await waitComplete(page)
    await expect(row).toHaveAttribute('data-user-added', 'true')
    await expect(row).toHaveAttribute('data-pinned', 'true')
    await expect(row.getByTestId('card-bundle')).toHaveText(`${text} 고정됨`)
    await expect.poll(() => focusedCardOf(page)).toEqual({ opponent: 'rotomwash', cardId: (await row.getAttribute('data-card-id'))!, userAdded: true, bundleBtn: true })

    // 메뉴: 추가 배분 줄만 핀(고정 해제 = 삭제), 프리셋 줄은 빈 핀 칸
    const withAdded = await menuOptions(row)
    expect(withAdded).toHaveLength(4)
    expect(withAdded.filter((o) => o.user).map((o) => [o.pin, o.slot])).toEqual([[true, false]])
    expect(withAdded.filter((o) => !o.user).map((o) => [o.text, o.pin, o.slot])).toEqual(presets.map((o) => [o.text, false, true]))
    const addedId = withAdded.find((o) => o.user)!.id
    await bundleButton(row).click()
    await bundleMenu(row).locator(`[data-pin-for='${addedId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`).click()
    await waitComplete(page)
    if ((await bundleMenu(row).count()) > 0) await bundleMenu(row).press('Escape')
    const after = await menuOptions(row)
    expect(after.map((o) => o.text)).toEqual(presets.map((o) => o.text))
    expect(after.some((o) => o.user)).toBe(false)
  })

  test('목록 밖 포켓몬 스피드 배분: 프리셋과 같으면 이미 존재합니다, 다른 S는 새 배지로 포커스, "이 배지 지우기"로 지우면 프리셋 배지 3개만 남는다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    await selectTab(page, '스피드')
    await expect(presetBadges(page)).toHaveCount(3)
    const presets = (await badgesOf(page, 'rotomwash')).filter((b) => b.origin === 'preset' && b.condition === 'none')
    const panel = await openAddPanel(page)
    await pickAddTarget(page, '워시로토무', '추가됨')
    const value = await panelSpeedValue(panel)
    expect(presets.some((b) => b.sp === value.sp && b.sign === value.sign)).toBe(true)
    await panel.getByTestId('add-submit').click()
    await expect(panel.getByTestId('add-msg')).toHaveText(`이미 존재합니다 — ${speedText(value.sp, value.sign)}`)
    await expect(addedBadges(page)).toHaveCount(0)

    let sp = 0
    while (presets.some((b) => b.sp === sp && b.sign === 'neutral')) sp++
    await panel.getByTestId('add-sp-spe').fill(String(sp))
    await setSign(panel, 'neutral')
    await expect(panel.getByTestId('add-msg')).toHaveText('')
    await panel.getByTestId('add-submit').click()
    await expect(addPanel(page)).toHaveCount(0)
    await expect(addedBadges(page)).toHaveCount(1)
    const added = (await badgesOf(page, 'rotomwash')).find((b) => b.origin === 'added')!
    expect([added.sp, added.sign]).toEqual([sp, 'neutral'])
    await expect.poll(() => focusedBadgeId(page)).toBe(added.id)
    await expect(detail(page)).toHaveAttribute('data-badge-id', added.id)
    await detail(page).getByTestId('speed-remove').click()
    await expect(addedBadges(page)).toHaveCount(0)
    await expect(presetBadges(page)).toHaveCount(3)
  })

  test('중복 문구: 패널(1위 값)·배지 상세 직접 입력·카드 메뉴 직접 추가 모두 "이미 존재합니다 — [배분 표기]", 배지·선택지 수는 그대로', async ({ page }) => {
    await openSpeed(page)
    const entry = plainEntries[0]
    const base = (await badgesOf(page, entry.id)).find((b) => b.origin === 'ladder' && b.condition === 'none')!
    const count = (await readBadges(page)).length
    // 패널: 기본값 = 1위 배분 = 차트 위 기본 배지
    const panel = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    const value = await panelSpeedValue(panel)
    expect(value).toEqual({ sp: base.sp, sign: base.sign })
    const shown = panel.getByTestId('add-observed-option').and(page.locator('[data-state="shown"]'))
    await expect(shown).toHaveCount(1)
    await expect(shown).toBeDisabled()
    await expect(shown).toContainText('이미 존재합니다')
    await expect(shown.locator('b')).toContainText(speedText(base.sp, base.sign))
    const msg = `이미 존재합니다 — ${speedText(base.sp, base.sign)}`
    await panel.getByTestId('add-submit').click()
    await expect(panel.getByTestId('add-msg')).toHaveText(msg)
    expect((await readBadges(page)).length).toBe(count)
    await panel.getByRole('button', { name: '취소', exact: true }).click()
    await expect(addPanel(page)).toHaveCount(0)
    await expect(addPanelButton(page)).toBeFocused()

    // 배지 상세 직접 입력
    await badgeById(page, base.id).click()
    await detail(page).getByTestId('speed-add-toggle').click()
    const form = detail(page).locator('.speed-add-custom')
    await form.getByRole('spinbutton', { name: 'S SP' }).fill(String(base.sp))
    await setSign(form, base.sign)
    await form.getByRole('button', { name: '추가', exact: true }).click()
    await expect(detail(page).getByTestId('speed-add-msg')).toHaveText(msg)
    expect((await readBadges(page)).length).toBe(count)
    // 값을 바꾸면 중복 문구가 지워진다
    await form.getByRole('spinbutton', { name: 'S SP' }).fill(String(base.sp === 0 ? 1 : base.sp - 1))
    await expect(detail(page).getByTestId('speed-add-msg')).toHaveText('')

    // 공격 탭: 패널과 카드 메뉴 '직접 추가'가 같은 문구
    await selectTab(page, '공격')
    await waitComplete(page)
    const row = opponentCards(page, entry.id).first()
    const options = await menuOptions(row)
    const neutral = options.find((o) => /^H\d+ B\d+ /.test(o.text))
    expect(neutral, options.map((o) => o.text).join(' | ')).toBeDefined()
    const [, h, b] = /^H(\d+) B(\d+) /.exec(neutral!.text)!
    const damageMsg = `이미 존재합니다 — H${h} B${b}`
    const p2 = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    await p2.getByTestId('add-sp-hp').fill(h)
    await p2.getByTestId('add-sp-def').fill(b)
    await p2.getByTestId('add-submit').click()
    await expect(p2.getByTestId('add-msg')).toHaveText(damageMsg)
    await p2.getByRole('button', { name: '취소', exact: true }).click()

    await bundleButton(row).click()
    const form2 = bundleMenu(row).getByTestId('bundle-add')
    await form2.getByRole('spinbutton', { name: '직접 추가 SP HP', exact: true }).fill(h)
    await form2.getByRole('spinbutton', { name: '직접 추가 SP 방어', exact: true }).fill(b)
    await setStatSign(form2, 'bundle-add-nat', 'def', 'neutral')
    await form2.getByRole('button', { name: '추가', exact: true }).click()
    await expect(form2.locator('.bundle-add-hint')).toHaveText(damageMsg)
    await expect(bundleMenu(row).getByRole('menuitemradio')).toHaveCount(options.length)
    // 값을 바꾸면 중복 문구가 지워진다
    await form2.getByRole('spinbutton', { name: '직접 추가 SP HP', exact: true }).fill(h === '0' ? '1' : '0')
    await expect(form2.locator('.bundle-add-hint')).toHaveText('')
  })

  test('잘못된 SP(최대+1·-1·1.5): 패널(스피드·공격)·배지 상세·카드 메뉴 모두 "SP는 0~최대 정수로 입력해 주세요."이고 추가되지 않는다', async ({ page }) => {
    await openSpeed(page)
    const entry = plainEntries[0]
    const count = (await readBadges(page)).length
    const panel = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    for (const bad of BAD_SP) {
      await panel.getByTestId('add-sp-spe').fill(bad)
      await panel.getByTestId('add-submit').click()
      await expect(panel.getByTestId('add-msg'), bad).toHaveText(INVALID)
    }
    expect((await readBadges(page)).length).toBe(count)
    await panel.getByRole('button', { name: '취소', exact: true }).click()

    const base = (await badgesOf(page, entry.id)).find((b) => b.origin === 'ladder' && b.condition === 'none')!
    await badgeById(page, base.id).click()
    await detail(page).getByTestId('speed-add-toggle').click()
    const form = detail(page).locator('.speed-add-custom')
    for (const bad of BAD_SP) {
      await form.getByRole('spinbutton', { name: 'S SP' }).fill(bad)
      await form.getByRole('button', { name: '추가', exact: true }).click()
      await expect(detail(page).getByTestId('speed-add-msg'), bad).toHaveText(INVALID)
    }
    expect((await readBadges(page)).length).toBe(count)

    await selectTab(page, '공격')
    await waitComplete(page)
    const p2 = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    for (const bad of BAD_SP) {
      await p2.getByTestId('add-sp-hp').fill(bad)
      await p2.getByTestId('add-submit').click()
      await expect(p2.getByTestId('add-msg'), bad).toHaveText(INVALID)
    }
    await p2.getByRole('button', { name: '취소', exact: true }).click()
    await expect(addPanel(page)).toHaveCount(0)

    const row = opponentCards(page, entry.id).first()
    const options = (await menuOptions(row)).length
    await bundleButton(row).click()
    const form2 = bundleMenu(row).getByTestId('bundle-add')
    for (const bad of BAD_SP) {
      await form2.getByRole('spinbutton', { name: '직접 추가 SP HP', exact: true }).fill(bad)
      await expect(form2.getByRole('button', { name: '추가', exact: true }), bad).toBeDisabled()
      await expect(form2.locator('.bundle-add-hint'), bad).toHaveText(INVALID)
    }
    await expect(bundleMenu(row).getByRole('menuitemradio')).toHaveCount(options)
  })

  test('탭 전환: 스피드 탭에서 고른 메타 포켓몬은 공격·방어 탭으로 바꿔도 칩이 남고 그 탭 기준 입력(공·방은 키 능력치별 ▲▼, H엔 없음)으로 다시 그린다', async ({ page }) => {
    await openSpeed(page)
    const entry = plainEntries[0]
    const panel = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    await expect(panel.getByTestId('add-sp-spe')).toBeVisible()
    for (const tab of ['공격', '방어'] as const) {
      await selectTab(page, tab)
      await expect(addPanel(page)).toBeVisible()
      await expect(addPanel(page).getByTestId('add-chip').locator('b')).toHaveText(speciesLabel(entry.id))
      await expect(addPanel(page).getByTestId('add-chip').locator('.combo-tag')).toHaveText('메타 목록')
      await expect(addPanel(page).getByTestId('add-sp-spe')).toHaveCount(0)
      await expect(addPanel(page).getByTestId('add-nat-plus')).toHaveCount(0)
      await expect(damageFields(addPanel(page)).first()).toBeVisible()
      await expect(addPanel(page).locator('[data-testid^="add-nat-hp-"]')).toHaveCount(0)
      const toggled = await damageFields(addPanel(page)).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')?.slice('add-sp-'.length) ?? '').filter((st) => st !== 'hp'))
      expect(toggled.length, tab).toBeGreaterThan(0)
      for (const st of toggled) await expect(addPanel(page).getByTestId(`add-nat-${st}-plus`)).toBeVisible()
    }
  })

  test('공격 탭 메타 포켓몬: 분류 하나면 바로 H·B 입력, 새 SP로 추가하면 그 카드 줄 선택지에 생겨 선택·포커스', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const entry = plainEntries[0]
    const row = opponentCards(page, entry.id).first()
    const before = await menuOptions(row)
    const taken = new Set(before.map((o) => o.text.replace(/ \S+$/, '')))
    const panel = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    await expect(panel.getByTestId('add-category')).toHaveCount(0)
    await expect(panel.getByTestId('add-nat-plus')).toHaveCount(0)
    await expect(panel.getByTestId('add-observed-option').first()).toBeVisible()
    const h = await panel.getByTestId('add-sp-hp').inputValue()
    let b = 0
    while (taken.has(`H${h} B${b}`)) b++
    await panel.getByTestId('add-sp-def').fill(String(b))
    await panel.getByTestId('add-submit').click()
    await expect(addPanel(page)).toHaveCount(0)
    await waitComplete(page)
    await expect.poll(async () => (await focusedCardOf(page))?.userAdded).toBe(true)
    const focused = (await focusedCardOf(page))!
    expect(focused.opponent).toBe(entry.id)
    expect(focused.bundleBtn).toBe(true)
    const line = cards(page).and(page.locator(`[data-card-id='${focused.cardId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`))
    await expect(line.getByTestId('card-bundle')).toHaveText(`H${h} B${b} 고정됨`)
    expect((await menuOptions(line)).filter((o) => o.user).map((o) => o.text)).toEqual([`H${h} B${b} 고정됨`])
  })

  test('공격 탭 메타 포켓몬 직접 입력 ▲▼: B에 ▲를 걸면 보정 배분(B..↑)으로 추가돼 선택지에 생기고, 같은 SP·부호를 다시 넣으면 "이미 존재합니다 — H.. B..↑"', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const entry = plainEntries[0]
    const row = opponentCards(page, entry.id).first()
    const taken = new Set((await menuOptions(row)).map((o) => o.text.replace(/ \S+$/, '')))
    const panel = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    await expect(panel.locator('[data-testid^="add-nat-hp-"]')).toHaveCount(0)
    const up = panel.getByTestId('add-nat-def-plus')
    const down = panel.getByTestId('add-nat-def-minus')
    await expect(up).toHaveAccessibleName('방어 성격 상승')
    // 한 능력치에는 ▲·▼ 중 하나: ▼를 누르면 ▲가 풀리고, 다시 ▲를 누르면 ▼가 풀린다
    await up.click()
    await down.click()
    await expect(up).toHaveAttribute('aria-pressed', 'false')
    await expect(down).toHaveAttribute('aria-pressed', 'true')
    await up.click()
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    await expect(down).toHaveAttribute('aria-pressed', 'false')
    const h = await panel.getByTestId('add-sp-hp').inputValue()
    let b = 0
    while (taken.has(`H${h} B${b}↑`)) b++
    await panel.getByTestId('add-sp-def').fill(String(b))
    await panel.getByTestId('add-submit').click()
    await expect(addPanel(page)).toHaveCount(0)
    await waitComplete(page)
    await expect.poll(async () => (await focusedCardOf(page))?.userAdded).toBe(true)
    const focused = (await focusedCardOf(page))!
    expect(focused.opponent).toBe(entry.id)
    const line = cards(page).and(page.locator(`[data-card-id='${focused.cardId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`))
    await expect(line.getByTestId('card-bundle')).toHaveText(`H${h} B${b}↑ 고정됨`)
    expect((await menuOptions(line)).filter((o) => o.user).map((o) => o.text)).toEqual([`H${h} B${b}↑ 고정됨`])

    const again = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    await fillDamage(again, `H${h} B${b}↑`)
    const generation = await tabPanel(page).getAttribute('data-generation')
    await again.getByTestId('add-submit').click()
    await expect(again.getByTestId('add-msg')).toHaveText(`이미 존재합니다 — H${h} B${b}↑`)
    await expect(tabPanel(page)).toHaveAttribute('data-generation', generation!)
    // 부호를 바꾸면 안내가 지워진다
    await again.getByTestId('add-nat-def-minus').click()
    await expect(again.getByTestId('add-msg')).toHaveText('')
  })

  test('공격 탭 패널을 연 채 내 기술을 바꾸면: 고른 분류가 남으면 입력 유지, 분류가 사라지면 남은 첫 분류의 대표 배분으로 되돌리고 알림을 비운다, 공격기가 없으면 사유를 알린다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    const moveBox = (i: number) => combo(mySet(page), `기술 ${i}`)
    const setMove = async (i: number, name: string) => {
      await moveBox(i).fill(name)
      await moveBox(i).press('Enter')
      await expect(moveBox(i)).toHaveValue(name)
    }
    const species = combo(mySet(page), '종')
    await species.fill('대도각참')
    await species.press('Enter')
    await expect(species).toHaveValue('대도각참')
    // 대표 세트는 물리기 넷(도각참·기습·아이언헤드·안다리걸기)이라 분류는 물리 H+B 하나
    await expect(moveBox(1)).toHaveValue('도각참')
    const entry = plainEntries.find((e) => e.id !== 'kingambit')!
    const panel = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    await expect(panel.getByTestId('add-category')).toHaveCount(0)
    await expect(panel.getByTestId('add-sp-def')).toBeVisible()
    const edited = (Number(await panel.getByTestId('add-sp-def').inputValue()) + 1) % (SP_MAX + 1)
    await panel.getByTestId('add-sp-def').fill(String(edited))

    // 특수기를 하나 넣으면 분류가 둘이 되지만 고른 물리 분류와 입력은 그대로
    await setMove(1, '악의파동')
    await expect(panel.getByTestId('add-category')).toHaveCount(2)
    await expect(panel.getByTestId('add-category').and(page.locator(':checked'))).toHaveValue('physical')
    await expect(panel.getByTestId('add-sp-def')).toHaveValue(String(edited))

    // 잘못된 SP 알림을 띄운 뒤 물리기를 모두 비우면 특수 H+D 대표 배분으로 되돌리고 알림을 비운다
    await panel.getByTestId('add-sp-def').fill(String(SP_MAX + 1))
    await panel.getByTestId('add-submit').click()
    await expect(panel.getByTestId('add-msg')).toHaveText(INVALID)
    for (const i of [2, 3, 4]) await setMove(i, '')
    await expect(panel.getByTestId('add-category')).toHaveCount(0)
    await expect(panel.getByTestId('add-sp-def')).toHaveCount(0)
    await expect(panel.getByTestId('add-sp-spd')).toBeVisible()
    await expect(panel.getByTestId('add-msg')).toHaveText('')
    const reset = await damageInputText(panel)
    expect(reset).toMatch(/^H\d+ D\d+$/)
    // 새로 열어 같은 포켓몬을 고른 기본값과 같다
    await panel.getByRole('button', { name: '취소', exact: true }).click()
    await expect(addPanel(page)).toHaveCount(0)
    await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    await expect.poll(() => damageInputText(addPanel(page))).toBe(reset)

    // 공격기를 모두 비우면 추가 버튼은 비활성이고 사유 알림을 가리킨다
    await setMove(1, '')
    const msg = addPanel(page).getByTestId('add-msg')
    await expect(msg).toHaveText(/^이 탭에서 더할 배분이 없습니다: /)
    await expect(addPanel(page).getByTestId('add-submit')).toBeDisabled()
    await expect(addPanel(page).getByTestId('add-submit')).toHaveAttribute('aria-describedby', (await msg.getAttribute('id'))!)
    await setMove(1, '악의파동')
    await expect.poll(() => damageInputText(addPanel(page))).toBe(reset)
  })

  test('방어 탭 범위 안 메타 포켓몬: 새 배분을 추가하면 그 분류 카드 선택지에 생겨 선택되고 포커스가 그 줄로 간다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    const entry = plainEntries[0]
    const panel = await openAddPanel(page)
    await pickAddTarget(page, speciesLabel(entry.id), '메타 목록')
    const field = damageFields(panel).first()
    await expect(field).toBeVisible()
    await expect(panel.getByTestId('add-nat-plus')).toHaveCount(0)
    // 화면에 없는 값이 나올 때까지 첫 키 능력치를 바꾼다
    let added = false
    for (let v = 0; v <= SP_MAX && !added; v++) {
      await field.fill(String(v))
      await panel.getByTestId('add-submit').click()
      added = await expect(addPanel(page))
        .toHaveCount(0, { timeout: 1_000 })
        .then(() => true)
        .catch(() => false)
      if (!added) await expect(panel.getByTestId('add-msg')).toContainText('이미 존재합니다')
    }
    expect(added).toBe(true)
    await waitComplete(page)
    await expect.poll(async () => (await focusedCardOf(page))?.userAdded).toBe(true)
    const focused = (await focusedCardOf(page))!
    expect(focused.opponent).toBe(entry.id)
    const line = cards(page).and(page.locator(`[data-card-id='${focused.cardId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`))
    await expect(line).toHaveAttribute('data-pinned', 'true')
    await expect(line.getByTestId('card-bundle')).toHaveText(/ 고정됨$/)
    expect((await menuOptions(line)).filter((o) => o.user)).toHaveLength(1)
  })

  test('방어 탭 범위 밖 메타 포켓몬: 보정 붙은 관측 줄도 "+ 추가"로 그 부호 그대로 그 카드만 생기고, 같은 SP·부호 직접 입력은 "이미 존재합니다 — …", 부호만 바꾸면 따로 추가된다(공격 탭엔 없음)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    await setTopN(page, 1)
    await waitComplete(page)
    const panel = await openAddPanel(page)
    // 보정 붙은 관측 줄이 있는 범위 밖 포켓몬·분류를 찾는다
    let found: { id: string; category: number; boosted: string } | null = null
    for (const entry of plainEntries.slice(1, 15)) {
      await pickAddTarget(page, speciesLabel(entry.id), '표시 범위 밖')
      const categories = Math.max(1, await panel.getByTestId('add-category').count())
      for (let i = 0; i < categories && found === null; i++) {
        if ((await panel.getByTestId('add-category').count()) > 0) await panel.getByTestId('add-category').nth(i).check()
        await expect(panel.getByTestId('add-observed-option').and(page.locator(':not([data-state="addable"])'))).toHaveCount(0)
        const boosted = panel.getByTestId('add-observed-option').filter({ has: page.locator('b', { hasText: /[↑↓]/ }) })
        if ((await boosted.count()) > 0) {
          found = { id: entry.id, category: i, boosted: (await boosted.first().locator('b').textContent()) ?? '' }
          await expect(boosted.first()).toBeEnabled()
          await expect(boosted.first()).toContainText('+ 추가')
          await boosted.first().click()
        }
      }
      if (found !== null) break
      await panel.getByTestId('add-reset').click()
    }
    expect(found, '보정 붙은 관측 줄이 있는 범위 밖 포켓몬').not.toBeNull()
    const { id, category, boosted } = found!
    await expect(addPanel(page)).toHaveCount(0)
    await waitComplete(page)
    // 화력 도구 행(같은 배분의 도구 변형)을 뺀 그 포켓몬 줄은 하나, 도구 행까지 모두 추가 배분 노출 줄이다
    expect(new Set(await opponentCards(page, id).evaluateAll((els) => els.map((el) => el.getAttribute('data-added-only'))))).toEqual(new Set(['true']))
    const own = opponentCards(page, id).and(page.locator(':not([data-power-item])'))
    await expect(own).toHaveCount(1)
    await expect(own).toHaveAttribute('data-added-only', 'true')
    await expect(own).toHaveAttribute('data-user-added', 'true')
    await expect(own.getByTestId('card-bundle')).toHaveText(`${boosted} 고정됨`)
    await expect.poll(async () => (await focusedCardOf(page))?.opponent).toBe(id)
    // 추가한 배분만: 그 포켓몬의 선택지는 보정 그대로의 추가 배분 하나
    expect((await menuOptions(own)).map((o) => [o.user, o.text])).toEqual([[true, `${boosted} 고정됨`]])
    await expect(toolbarSpin(page, '상위 N')).toHaveValue('1')

    const reopen = async () => {
      const p = await openAddPanel(page)
      await pickAddTarget(page, speciesLabel(id), '표시 범위 밖')
      if ((await p.getByTestId('add-category').count()) > 0) await p.getByTestId('add-category').nth(category).check()
      return p
    }
    // 같은 SP·부호 직접 입력은 이미 존재(관측 줄도 이제 표시 중)
    let p = await reopen()
    await expect(p.getByTestId('add-observed-option').filter({ has: page.locator('b', { hasText: boosted }) }).first()).toHaveAttribute('data-state', 'shown')
    await fillDamage(p, boosted)
    await p.getByTestId('add-submit').click()
    await expect(p.getByTestId('add-msg')).toHaveText(`이미 존재합니다 — ${boosted}`)
    await p.getByRole('button', { name: '취소', exact: true }).click()

    // 같은 SP라도 부호가 다르면(무보정) 따로 추가된다
    const neutral = boosted.replace(/[↑↓]/g, '')
    p = await reopen()
    await fillDamage(p, neutral)
    await p.getByTestId('add-submit').click()
    await expect(addPanel(page)).toHaveCount(0)
    await waitComplete(page)
    const texts = (await menuOptions(own)).map((o) => o.text.replace(/ 고정됨$/, ''))
    expect(texts).toEqual(expect.arrayContaining([boosted, neutral]))

    await selectTab(page, '공격')
    await waitComplete(page)
    await expect(opponentCards(page, id)).toHaveCount(0)
  })
})

test.describe("'포켓몬 추가' 400px", () => {
  test.use({ viewport: { width: 400, height: 900 } })

  test('400px 키보드만: 열기→이름→Enter→Tab으로 S SP→값→Enter 추가, ▲▼ aria-pressed, 관측 목록이 보여도 가로 넘침 없음, Esc로 닫으면 버튼 포커스', async ({ page }) => {
    await openSpeed(page)
    const entry = plainEntries[0]
    const label = speciesLabel(entry.id)
    const base = (await badgesOf(page, entry.id)).find((b) => b.origin === 'ladder' && b.condition === 'none')!
    await addPanelButton(page).focus()
    await page.keyboard.press('Enter')
    const panel = addPanel(page)
    const search = panel.getByRole('combobox', { name: '추가할 포켓몬', exact: true })
    await expect(search).toBeFocused()
    await page.keyboard.type(label)
    // 정확한 이름이 첫 후보
    await expect(panel.getByRole('option').first()).toHaveAccessibleName(new RegExp(`^${label}( |$)`))
    await page.keyboard.press('Enter')
    await expect(panel.getByTestId('add-chip').locator('b')).toHaveText(label)
    await expect(panel.getByTestId('add-observed-option').first()).toBeVisible()
    for (const k of ['plus', 'minus']) await expect(panel.getByTestId(`add-nat-${k}`)).toHaveAttribute('aria-pressed', /^(true|false)$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    // 패널 안 요소는 패널 폭 밖으로 나가지 않는다
    const outside = await panel.evaluate((root) => {
      const r = root.getBoundingClientRect()
      return [...root.querySelectorAll('button, input, li')].map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0 && (b.left < r.left - 1 || b.right > r.right + 1)).length
    })
    expect(outside).toBe(0)

    for (let i = 0; i < 30; i++) {
      if ((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'add-sp-spe') break
      await page.keyboard.press('Tab')
    }
    await expect(panel.getByTestId('add-sp-spe')).toBeFocused()
    const sp = (base.sp + 1) % (SP_MAX + 1)
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(String(sp))
    await page.keyboard.press('Enter')
    await expect(panel).toHaveCount(0)
    await expect(addedBadges(page)).toHaveCount(1)
    const added = (await badgesOf(page, entry.id)).find((b) => b.origin === 'added')!
    expect(added.sp).toBe(sp)
    await expect.poll(() => focusedBadgeId(page)).toBe(added.id)

    await addPanelButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(search).toBeFocused()
    // 첫 Esc는 열린 후보 목록만 닫고, 다음 Esc가 패널을 닫는다
    await page.keyboard.type(label)
    const listbox = panel.getByRole('listbox')
    await expect(listbox).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(addPanelButton(page)).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})
