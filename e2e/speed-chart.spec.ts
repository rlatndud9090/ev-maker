import { expect, test, type Locator, type Page } from '@playwright/test'
import { finalSpeed } from '../src/core/speed'
import type { PokemonSet } from '../src/core/types'
import type { MetaEntry } from '../src/data/meta-schema'
import { loadMetaSnapshotSync, loadSnapshotSync } from '../src/data/testing'
import { addCustomTarget, cards, combo, dragSlider, findOverlaps, mySet, openProduct, resultTab, selectTab, tabPanel, waitComplete } from './helpers'
/** 상위 N 기본값(src/cards/types.ts DEFAULT_TOP_N과 같다) */
const DEFAULT_TOP_N = 100

// 스피드 차트(PRD R1~R15·AC1~AC26): 배치·겹침·상태·상세·필터·목록 밖 타겟·차트 배분 추가.
// 기대값은 화면 코드가 아니라 스냅숏·메타 원자료와 코어 스피드 공식(finalSpeed)에서 따로 낸다.

const game = loadSnapshotSync()
const meta = loadMetaSnapshotSync({ regulation: game.manifest.regulation.id, match: 'bo1' })
const entryOf = (id: string): MetaEntry => {
  const e = meta.entries.find((x) => x.id === id)
  if (!e) throw new Error(`메타 항목 없음: ${id}`)
  return e
}
const ranking = [...meta.entries].sort((a, b) => a.rank - b.rank)

type Sign = 'plus' | 'neutral' | 'minus'
/** S 보정만 다른 대표 성격(스피드 계산은 S 보정만 본다) */
const SIGN_NATURE: Record<Sign, string> = { plus: 'timid', neutral: 'hardy', minus: 'brave' }
// 화면 표기는 공격·방어 탭과 같은 화살표만(무보정 기호 없음), 접근 이름은 성격 보정 글자
const SIGN_TEXT: Record<Sign, string> = { plus: '↑', neutral: '', minus: '↓' }
const SIGN_SPOKEN: Record<Sign, string> = { plus: '성격 상승', neutral: '성격 무보정', minus: '성격 하락' }
const bundleText = (sp: number, sign: Sign) => `S${sp}${SIGN_TEXT[sign]}`
const bundleSpoken = (sp: number, sign: Sign) => `S${sp} ${SIGN_SPOKEN[sign]}`
const STATUS_KO = { outspeeds: '추월', tie: '동속', outsped: '추월당함' } as const

function signOf(natureId: string): Sign {
  const n = game.data.natures[natureId]
  if (!n || n.plus === n.minus) return 'neutral'
  return n.plus === 'spe' ? 'plus' : n.minus === 'spe' ? 'minus' : 'neutral'
}

const ZERO_SP = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
/** 래더 기본 배지 세트 = 스카프 없는 세트: 대표 도구가 구애스카프면 도구 분포에서 스카프 밖 최다 도구(동률 id 순, 없으면 도구 없음) */
function baseSet(e: MetaEntry): PokemonSet {
  const set = { ...e.representative.set }
  if (set.item !== 'choicescarf') return set
  const other = Object.entries(e.items.shares)
    .filter(([k]) => k !== 'choicescarf')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
  if (other === undefined || other[0] === 'nothing') delete set.item
  else set.item = other[0]
  return set
}
function withSpeed(set: PokemonSet, sp: number, sign: Sign): PokemonSet {
  return { ...set, nature: SIGN_NATURE[sign], sp: { ...ZERO_SP, spe: sp } }
}

/** 메타 원자료에서 그 종 점유율 1위 S 묶음(같은 점유율이면 실수치 높은 쪽) */
function topBundle(e: MetaEntry): { sp: number; sign: Sign; share: number; speed: number; tied: boolean } {
  const by = new Map<string, { sp: number; sign: Sign; share: number }>()
  for (const [key, share] of e.spreads.kept) {
    const [nature, spread] = key.split(':')
    const sp = Number(spread.split('/')[5])
    const sign = signOf(nature)
    const k = `${sp}:${sign}`
    const cur = by.get(k) ?? { sp, sign, share: 0 }
    cur.share = Math.round((cur.share + share) * 1e4) / 1e4
    by.set(k, cur)
  }
  const list = [...by.values()].map((b) => ({ ...b, speed: finalSpeed(game, withSpeed(baseSet(e), b.sp, b.sign)) }))
  list.sort((a, b) => b.share - a.share || b.speed - a.speed)
  return { ...list[0], tied: list.length > 1 && list[1].share === list[0].share }
}

/** 메타 원자료에서 SP 배분 기준 이상 S 묶음 전부(점유율 내림, 같으면 빠른 쪽), 없으면 1위 하나 */
function defaultBundles(e: MetaEntry, min: number): { sp: number; sign: Sign; share: number; speed: number }[] {
  const by = new Map<string, { sp: number; sign: Sign; share: number }>()
  for (const [key, share] of e.spreads.kept) {
    const [nature, spread] = key.split(':')
    const sp = Number(spread.split('/')[5])
    const sign = signOf(nature)
    const k = `${sp}:${sign}`
    const cur = by.get(k) ?? { sp, sign, share: 0 }
    cur.share = Math.round((cur.share + share) * 1e4) / 1e4
    by.set(k, cur)
  }
  const list = [...by.values()].map((b) => ({ ...b, speed: finalSpeed(game, withSpeed(baseSet(e), b.sp, b.sign)) })).sort((a, b) => b.share - a.share || b.speed - a.speed)
  const passing = list.filter((b) => b.share >= min)
  return passing.length > 0 ? passing : list.slice(0, 1)
}

const speciesKo = (id: string) => game.data.species[id]?.name.ko ?? id
const idByKo = <T extends { name: { ko?: string } }>(table: Record<string, T>, ko: string): string => {
  const hit = Object.entries(table).find(([, v]) => v.name.ko === ko)
  if (!hit) throw new Error(`이름 없음: ${ko}`)
  return hit[0]
}

// ---------- 화면 조작 ----------

const badges = (page: Page) => page.getByTestId('speed-badge')
const frame = (page: Page) => page.getByTestId('speed-frame')
const band = (page: Page) => page.getByTestId('speed-baseline')
const detail = (page: Page) => page.getByTestId('speed-detail')
const chip = (page: Page, f: string) => page.locator(`[data-testid="speed-head"] [data-filter="${f}"]`)
const toolbarSpin = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true })
const spBox = (page: Page) => mySet(page).getByRole('spinbutton', { name: 'SP 스피드 숫자', exact: true })
const myStat = (page: Page) => mySet(page).getByLabel('스피드 실능치', { exact: true })
const badgeById = (page: Page, id: string) => page.locator(`[data-testid="speed-badge"][data-badge-id='${id}']`)
const FILTERS = ['rank', 'scarf', 'tailwind', 'field'] as const

interface BadgeInfo {
  id: string
  opponent: string
  sp: number
  sign: Sign
  speed: number
  status: string
  origin: string
  condition: string
  label: string
  rowSpeed: number
}

async function readBadges(page: Page): Promise<BadgeInfo[]> {
  const raw = await badges(page).evaluateAll((els) =>
    els.map((el) => {
      const d = (el as HTMLElement).dataset
      return {
        id: d.badgeId ?? '',
        speed: Number(d.speed),
        status: d.status ?? '',
        origin: d.origin ?? '',
        condition: d.condition ?? '',
        label: el.getAttribute('aria-label') ?? '',
        rowSpeed: Number((el.closest('li.speed-row, li.speed-baseline') as HTMLElement | null)?.dataset.speed ?? NaN),
      }
    }),
  )
  return raw.map((b) => {
    const [, opponent, , sp, sign] = JSON.parse(b.id) as [string, string, number | null, number, Sign, string]
    return { ...b, opponent, sp, sign }
  })
}

async function openSpeed(page: Page, allFilters = false) {
  await openProduct(page)
  await waitComplete(page)
  await selectTab(page, '스피드')
  await expect(badges(page).first()).toBeVisible()
  if (!allFilters) return
  for (const f of FILTERS) {
    if ((await chip(page, f).getAttribute('aria-pressed')) !== 'true') await chip(page, f).click()
    await expect(chip(page, f)).toHaveAttribute('aria-pressed', 'true')
  }
}

async function setTopN(page: Page, n: number) {
  const box = toolbarSpin(page, '상위 N')
  await box.fill(String(n))
  await box.press('Enter')
  await expect(box).toHaveValue(String(n))
}

/** 툴바 통계 설정 "SP 배분 최소(%)" */
async function setBundleMin(page: Page, percent: number) {
  const box = toolbarSpin(page, 'SP 배분 최소(%)')
  await box.fill(String(percent))
  await box.press('Enter')
  await expect(box).toHaveValue(String(percent))
}

async function setMySp(page: Page, sp: number) {
  await spBox(page).fill(String(sp))
  await expect(spBox(page)).toHaveValue(String(sp))
}

async function setMyItem(page: Page, ko: string) {
  const item = combo(mySet(page), '도구')
  await item.fill(ko)
  await item.press('Enter')
  await expect(item).toHaveValue(ko)
}

async function chooseMySpecies(page: Page, ko: string) {
  const species = combo(mySet(page), '종')
  await species.fill(ko)
  await species.press('Enter')
  await expect(species).toHaveValue(ko)
}

const abilitySelect = (page: Page) => mySet(page).locator('label.chip', { hasText: '특성' }).locator('select')

/** 내 포켓몬 패널 입력값으로 만든 내 세트(코어 공식 기대값용) */
async function mySetFromUi(page: Page): Promise<PokemonSet> {
  const species = idByKo(game.data.species, await combo(mySet(page), '종').inputValue())
  const ability = await abilitySelect(page).inputValue()
  const itemKo = await combo(mySet(page), '도구').inputValue()
  const plus = (await mySet(page).getByRole('button', { name: '스피드 성격 상승', exact: true }).getAttribute('aria-pressed')) === 'true'
  const minus = (await mySet(page).getByRole('button', { name: /^스피드 성격 하락/ }).getAttribute('aria-pressed')) === 'true'
  const sign: Sign = plus ? 'plus' : minus ? 'minus' : 'neutral'
  const sp = Number(await spBox(page).inputValue())
  return {
    regulation: game.manifest.regulation.id,
    species,
    ability,
    item: itemKo === '' ? undefined : idByKo(game.data.items, itemKo),
    nature: SIGN_NATURE[sign],
    sp: { ...ZERO_SP, spe: sp },
    moves: [],
  }
}

/** 내 최소 S(무보정·상승): 코어 공식으로 0~32를 직접 훑는다 */
function bruteMinSp(set: PokemonSet, target: number, tailwind: boolean): string {
  const find = (sign: Sign) => {
    for (let sp = 0; sp <= 32; sp++) if (finalSpeed(game, withSpeed(set, sp, sign), { attacker: { tailwind } }) > target) return sp
    return null
  }
  const n = find('neutral')
  const p = find('plus')
  return `추월: ${n === null ? '무보정 불가' : `최소 S${n}`} / ${p === null ? '상승 불가' : `S${p}↑`}`
}

/** 화면 배지 상태 개수(배지 id 기준) */
const countStatus = (list: BadgeInfo[]) => ({
  outspeeds: list.filter((b) => b.status === 'outspeeds').length,
  tie: list.filter((b) => b.status === 'tie').length,
  outsped: list.filter((b) => b.status === 'outsped').length,
})
/** 띠·알림 영역에 추월·동속·추월당함 개수 요약이 없다(총수가 없어 무의미, 사용자 피드백 2026-11-16) */
async function expectNoCountSummary(page: Page) {
  await expect(page.getByTestId('speed-band-summary')).toHaveCount(0)
  await expect(band(page)).not.toContainText(/추월 \d|동속 \d|추월당함 \d/)
  await expect(page.getByTestId('speed-summary')).not.toContainText(/추월|동속/)
}

/** 기준선 띠가 끝에 붙지 않은(제자리) 스크롤 위치로 프레임을 옮긴다. 띠 바로 앞·뒤 줄에 맞닿았는지 돌려준다 */
async function placeBandInPlace(page: Page): Promise<boolean> {
  return frame(page).evaluate((f) => {
    const b = f.querySelector<HTMLElement>('[data-testid="speed-baseline"]')!
    const prev = b.previousElementSibling as HTMLElement | null
    const next = b.nextElementSibling as HTMLElement | null
    const fr = f.getBoundingClientRect()
    const natural = prev ? prev.getBoundingClientRect().bottom - fr.top + f.scrollTop : next!.getBoundingClientRect().top - fr.top + f.scrollTop - b.offsetHeight
    f.scrollTop = Math.max(0, natural - (f.clientHeight - b.offsetHeight) / 2)
    const r = b.getBoundingClientRect()
    const touches = prev ? Math.abs(r.top - prev.getBoundingClientRect().bottom) <= 1 : Math.abs(r.bottom - next!.getBoundingClientRect().top) <= 1
    return touches
  })
}

const OVERLAP_SEL = [
  '[data-testid="speed-frame"] [data-testid="speed-badge"]',
  '[data-testid="speed-frame"] .speed-row-speed',
  '[data-testid="speed-frame"] .speed-baseline-label',
].join(', ')
const STUCK_OVERLAP_SEL = [
  '[data-testid="speed-frame"] li.speed-row [data-testid="speed-badge"]',
  '[data-testid="speed-frame"] .speed-row-speed',
].join(', ')

/** 요소가 프레임 사각형 안에 온전히 있는가 */
async function insideFrame(page: Page, loc: Locator): Promise<boolean> {
  const f = (await frame(page).boundingBox())!
  const r = (await loc.boundingBox())!
  return r.y >= f.y - 1 && r.y + r.height <= f.y + f.height + 1 && r.x >= f.x - 1 && r.x + r.width <= f.x + f.width + 1
}

const addWashRotom = (page: Page) => addCustomTarget(page, '워시로토무', ['하이드로펌프'])
const presetBadges = (page: Page) => page.locator('[data-testid="speed-badge"][data-origin="preset"]')

// ---------- 차트·배치 ----------

test.describe('스피드 차트 배치(AC1~AC4, AC24)', () => {
  test('AC1: 스피드 탭은 세로 차트만(카드·배분 메뉴·카드 상세 없음), 공격·방어 탭은 카드 리스트 그대로', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await expect(cards(page).first()).toBeVisible()
    await selectTab(page, '스피드')
    await expect(frame(page)).toBeVisible()
    await expect(frame(page).getByRole('list', { name: '스피드 실수치 내림차순' })).toBeVisible()
    await expect(cards(page)).toHaveCount(0)
    await expect(tabPanel(page).getByRole('menu', { name: '노력치 배분' })).toHaveCount(0)
    await expect(tabPanel(page).locator('button.bundle-btn, .card-detail, .cards')).toHaveCount(0)
    for (const t of ['공격', '방어'] as const) {
      await selectTab(page, t)
      await waitComplete(page)
      await expect(cards(page).first()).toBeVisible()
      await expect(frame(page)).toHaveCount(0)
    }
  })

  for (const width of [400, 1280]) {
    test(`AC2(${width}px): 실수치 내림차순 줄, 같은 실수치는 한 줄·라벨 한 번, 윗줄 차이 숫자 없음, 띠 제자리에서 배지·라벨·띠 겹침 없음(1 차이 이웃 줄 포함)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await openSpeed(page, true)
      const list = await readBadges(page)
      // 줄 순서: 줄(띠 포함) 실수치가 위에서 아래로 엄격히 내려간다 = 같은 실수치는 한 줄
      const rowSpeeds = await frame(page).locator('li.speed-row[data-speed], li.speed-baseline').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.speed)))
      for (let i = 1; i < rowSpeeds.length; i++) expect(rowSpeeds[i], `줄 ${i}`).toBeLessThan(rowSpeeds[i - 1])
      for (const b of list) expect(b.rowSpeed, `${b.label}`).toBe(b.speed)
      // 실수치 라벨은 실수치마다 한 번(띠 줄은 띠 라벨이 그 실수치를 보인다)
      const labels = await frame(page).locator('.speed-row-speed').allTextContents()
      expect(new Set(labels).size).toBe(labels.length)
      const bandSpeed = Number(await band(page).getAttribute('data-speed'))
      expect(labels).not.toContain(String(bandSpeed))
      await expect(band(page).locator('.speed-baseline-label')).toContainText(String(bandSpeed))
      // 같은 줄 배지는 DOM 순서(R2 순서)대로 왼→오, 넘치면 다음 줄
      const flowOk = await frame(page).locator('ul.speed-badges').evaluateAll((uls) =>
        uls.every((ul) => {
          const rs = [...ul.querySelectorAll('[data-testid="speed-badge"]')].map((b) => b.getBoundingClientRect())
          return rs.every((r, i) => i === 0 || r.top > rs[i - 1].top + 1 || (Math.abs(r.top - rs[i - 1].top) <= 1 && r.left >= rs[i - 1].right - 1))
        }),
      )
      expect(flowOk).toBe(true)
      // 윗줄과의 차이 숫자는 그리지 않는다. 1 차이 이웃 줄은 데이터에 있다(줄 실수치로 확인)
      await expect(frame(page).locator('.speed-row-diff')).toHaveCount(0)
      expect(rowSpeeds.some((s, i) => i > 0 && rowSpeeds[i - 1] - s === 1), '실수치 1 차이 이웃 줄').toBe(true)

      // 띠 제자리 위치에서 영역 교차 검사, 그다음 프레임 전체를 화면 높이씩 훑는다
      await frame(page).scrollIntoViewIfNeeded()
      expect(await placeBandInPlace(page), '띠가 제자리(이웃 줄과 맞닿음)').toBe(true)
      expect(await findOverlaps(page, OVERLAP_SEL)).toEqual([])
      const steps = await frame(page).evaluate((f) => Math.ceil(f.scrollHeight / f.clientHeight))
      for (let i = 0; i <= steps; i++) {
        await frame(page).evaluate((f, k) => (f.scrollTop = k * f.clientHeight), i)
        // 제자리 = 띠가 이웃 줄과 맞닿아 있음. 아니면 위·아래 끝에 붙은 상태
        const stuck = await frame(page).evaluate((f) => {
          const el = f.querySelector('[data-testid="speed-baseline"]')!
          const b = el.getBoundingClientRect()
          const prev = el.previousElementSibling?.getBoundingClientRect()
          const next = el.nextElementSibling?.getBoundingClientRect()
          const inPlace = prev ? Math.abs(b.top - prev.bottom) <= 1 : next ? Math.abs(b.bottom - next.top) <= 1 : true
          return !inPlace
        })
        // 띠가 끝에 붙은 동안 뒤로 지나가는 줄은 겹침이 아니다(띠와 띠 안 배지를 뺀 요소끼리만 검사)
        const sel = stuck ? STUCK_OVERLAP_SEL : OVERLAP_SEL
        expect(await findOverlaps(page, sel), `스크롤 ${i}`).toEqual([])
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('AC3: 모든 배지(스카프·랭크업 포함)가 자기 실수치 줄 안에 잘리지 않고, 기준선 띠는 내 실수치 줄 하나뿐(도달 범위 띠 없음)', async ({ page }) => {
    for (const width of [400, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      await openSpeed(page, true)
      const list = await readBadges(page)
      expect(list.some((b) => b.condition === 'scarf'), '스카프 배지').toBe(true)
      expect(list.some((b) => b.condition === 'rank' && /^\+\d$/.test(b.label.split(', ')[0].split(' ').at(-1)!)), '랭크업(+n) 배지').toBe(true)
      const clipped = await frame(page).evaluate((f) => {
        const fr = f.getBoundingClientRect()
        const out: string[] = []
        if (f.scrollWidth > f.clientWidth) out.push('프레임 가로 넘침')
        for (const el of f.querySelectorAll<HTMLElement>('[data-testid="speed-badge"]')) {
          const r = el.getBoundingClientRect()
          const row = el.closest('li.speed-row, li.speed-baseline')!.getBoundingClientRect()
          const inRow = r.top >= row.top - 0.5 && r.bottom <= row.bottom + 0.5 && r.left >= row.left - 0.5 && r.right <= row.right + 0.5
          const inFrame = r.left >= fr.left - 0.5 && r.right <= fr.right + 0.5
          if (!inRow || !inFrame || el.scrollWidth > el.clientWidth + 1) out.push(el.getAttribute('aria-label') ?? '')
        }
        return out
      })
      expect(clipped, `${width}px`).toEqual([])
      await expect(band(page)).toHaveCount(1)
      await expect(frame(page).locator('[class*="reach"]')).toHaveCount(0)
      // 기준선 = 내 포켓몬 패널의 스피드 실능치(내 도구 생명의구슬·순풍 꺼짐)
      await expect(band(page)).toHaveAttribute('data-speed', (await myStat(page).textContent())!.trim())
    }
  })

  test('AC4(speed-bundles-pin-disable R1): 래더 상대마다 기본 배지 = 메타 원자료의 SP 배분 기준(5%) 이상 S 묶음 전부(없으면 1위, 동률은 빠른 쪽), 표기 "S32↑"·"S20"·"S0↓"(접근 이름은 성격 보정 글자), 실수치 = 코어 공식', async ({ page }) => {
    await openSpeed(page)
    const list = await readBadges(page)
    const base = list.filter((b) => b.origin === 'ladder' && b.condition === 'none')
    const opponents = new Set(list.filter((b) => b.origin === 'ladder').map((b) => b.opponent))
    expect([...opponents].sort()).toEqual(ranking.slice(0, DEFAULT_TOP_N).map((e) => e.id).sort())
    let small = 0
    let tied = 0
    let multi = 0
    for (const id of opponents) {
      const mine = base.filter((b) => b.opponent === id)
      const want = defaultBundles(entryOf(id), 0.05)
      const top = topBundle(entryOf(id))
      if (top.share < 0.05) small++
      if (top.tied) tied++
      if (want.length > 1) multi++
      expect(new Set(mine.map((b) => `${b.sp}:${b.sign}`)), `${id} 기본 배지`).toEqual(new Set(want.map((b) => `${b.sp}:${b.sign}`)))
      for (const w of want) {
        const b = mine.find((x) => x.sp === w.sp && x.sign === w.sign)!
        expect(b.label, id).toContain(` ${bundleSpoken(w.sp, w.sign)}`)
        expect(b.speed, `${id} ${bundleText(w.sp, w.sign)} 실수치`).toBe(w.speed)
      }
    }
    expect(multi, '기본 배지가 여럿인 상대').toBeGreaterThan(0)
    // 표기 형식: 세 보정 모두 화면에 나온다(상위 30에 하락 묶음이 없으면 래더 전 종에서 찾는다)
    const visible = await badges(page).locator('.num').allTextContents()
    for (const v of visible) expect(v).toMatch(/^S\d{1,2}[↑↓]?$/)
    expect(visible.some((v) => v.endsWith('↑'))).toBe(true)
    expect(visible.some((v) => /\d$/.test(v)), '무보정은 기호 없음').toBe(true)
    for (const v of visible) expect(v).not.toMatch(/[=+−]/)
    test.info().annotations.push({ type: 'AC4', description: `기본 배지 ${base.length}개, 여럿인 상대 ${multi}종, 1위 점유율 5% 미만 ${small}종, 1위 동률 ${tied}종(그 밖의 경계 사례는 단위 테스트)` })
  })

  test('AC4(speed-bundles-pin-disable): 포푸니크는 기준 이상 묶음 수만큼 기본 배지, 툴바 SP 배분 100이면 하나로 줄고 5로 돌리면 다시 늘어난다', async ({ page }) => {
    await openSpeed(page)
    const want = defaultBundles(entryOf('sneasler'), 0.05)
    expect(want.length, '포푸니크 기준 이상 묶음').toBeGreaterThan(1)
    const sneaslerBases = async () => (await readBadges(page)).filter((b) => b.opponent === 'sneasler' && b.origin === 'ladder' && b.condition === 'none')
    await expect.poll(async () => (await sneaslerBases()).length).toBe(want.length)
    await setBundleMin(page, 100)
    await expect.poll(async () => (await sneaslerBases()).map((b) => `${b.sp}:${b.sign}`)).toEqual([`${topBundle(entryOf('sneasler')).sp}:${topBundle(entryOf('sneasler')).sign}`])
    await setBundleMin(page, 5)
    await expect.poll(async () => (await sneaslerBases()).length).toBe(want.length)
  })

  test('AC6(speed-bundles-pin-disable R3): 같은 실수치 줄의 래더 배지 DOM 순서(= 좌우 키 순서)는 사용률 순위 오름차순', async ({ page }) => {
    await openSpeed(page, true)
    const list = await readBadges(page)
    const rows = new Map<number, number[]>()
    for (const b of list) {
      if (b.origin === 'preset') continue
      rows.set(b.rowSpeed, [...(rows.get(b.rowSpeed) ?? []), entryOf(b.opponent).rank])
    }
    let mixed = 0
    for (const [speed, ranks] of rows) {
      expect(ranks, `실수치 ${speed} 줄`).toEqual([...ranks].sort((a, b) => a - b))
      if (new Set(ranks).size > 1) mixed++
    }
    expect(mixed, '여러 상대가 섞인 줄').toBeGreaterThan(0)
    // 좌우 키 이동 순서 = DOM 순서: 여러 상대가 섞인 줄 하나에서 → 로 끝까지 간다
    const [rowSpeed] = [...rows].find(([, r]) => new Set(r).size > 1)!
    const ids = list.filter((b) => b.rowSpeed === rowSpeed).map((b) => b.id)
    await badgeById(page, ids[0]).focus()
    for (const id of ids.slice(1)) {
      await page.keyboard.press('ArrowRight')
      await expect(badgeById(page, id)).toBeFocused()
    }
  })

  test('AC7(speed-bundles-pin-disable R4): 2위 묶음을 추가한 뒤 기준을 낮춰 기본 배지가 되면 그 배분 배지가 하나뿐이고 "추가" 표지가 없으며, 기준을 올리면 추가 배지로 돌아온다', async ({ page }) => {
    await openSpeed(page)
    const [first, second] = defaultBundles(entryOf('sneasler'), 0.05)
    await setBundleMin(page, 100)
    const sneasler = async () => (await readBadges(page)).filter((b) => b.opponent === 'sneasler' && b.condition === 'none')
    await expect.poll(async () => (await sneasler()).length).toBe(1)
    const top = (await sneasler())[0]
    expect(`${top.sp}:${top.sign}`).toBe(`${first.sp}:${first.sign}`)
    await badgeById(page, top.id).click()
    await detail(page).getByTestId('speed-add-toggle').click()
    await detail(page)
      .getByTestId('speed-add-option')
      .filter({ has: page.locator('b .bundle-mark', { hasText: new RegExp(`^${bundleText(second.sp, second.sign)}$`) }) })
      .click()
    const secondOf = async () => (await sneasler()).filter((b) => b.sp === second.sp && b.sign === second.sign)
    await expect.poll(async () => (await secondOf()).map((b) => b.origin)).toEqual(['added'])
    const addedSpeed = (await secondOf())[0].speed
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"] .speed-mark.add')).toHaveText('추가')
    // 기준을 낮추면 기본 배지가 그 자리를 대신한다(하나뿐, "추가" 없음, 실수치 같음)
    await page.keyboard.press('Escape')
    await setBundleMin(page, 5)
    await expect.poll(async () => (await secondOf()).map((b) => b.origin)).toEqual(['ladder'])
    expect((await secondOf())[0].speed).toBe(addedSpeed)
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"]')).toHaveCount(0)
    // 다시 올리면 추가 기록이 추가 배지로 돌아온다
    await setBundleMin(page, 100)
    await expect.poll(async () => (await secondOf()).map((b) => b.origin)).toEqual(['added'])
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"] .speed-mark.add')).toHaveText('추가')
  })

  for (const width of [400, 1280]) {
    test(`AC24(${width}px): 상위 30·조건 전부 켬, 열기·S0·S32·위아래 끝 스크롤에서 기준선 띠가 프레임 안(개수 요약 없음)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await openSpeed(page, true)
      await frame(page).scrollIntoViewIfNeeded()
      expect(await frame(page).evaluate((f) => f.scrollHeight > f.clientHeight), '차트가 프레임 높이를 넘는다').toBe(true)
      const check = async (when: string) => {
        await frame(page).scrollIntoViewIfNeeded()
        expect(await insideFrame(page, band(page)), `${when}: 띠`).toBe(true)
        expect(await insideFrame(page, band(page).locator('.speed-baseline-label')), `${when}: 띠 라벨`).toBe(true)
        await expectNoCountSummary(page)
      }
      await check('열기')
      await setMySp(page, 0)
      await check('S0')
      await setMySp(page, 32)
      await check('S32')
      await frame(page).evaluate((f) => (f.scrollTop = 0))
      await check('맨 위')
      await frame(page).evaluate((f) => (f.scrollTop = f.scrollHeight))
      await check('맨 아래')
    })
  }
})

// ---------- 기준선·상태 ----------

test.describe('기준선과 상태(AC5, AC5b, AC6, AC8, AC25)', () => {
  async function expectStatuses(page: Page) {
    const bandSpeed = Number(await band(page).getAttribute('data-speed'))
    const list = await readBadges(page)
    for (const b of list) {
      const want = b.speed < bandSpeed ? 'outspeeds' : b.speed === bandSpeed ? 'tie' : 'outsped'
      expect(b.status, b.label).toBe(want)
      expect(b.label.split(', '), b.label).toContain(STATUS_KO[want])
    }
    // 동속 배지: "동속" 태그 없이 상태 색(동속 면)으로만, 띠(내 실수치 줄) 안
    const ties = badges(page).and(page.locator('[data-status="tie"]'))
    const n = await ties.count()
    for (let i = 0; i < n; i++) {
      await expect(ties.nth(i).locator('.speed-mark')).toHaveCount(0)
      await expect(ties.nth(i)).not.toContainText('동속')
      await expect(ties.nth(i)).toHaveClass(/\btie\b/)
      expect(await ties.nth(i).evaluate((el) => el.closest('[data-testid="speed-baseline"]') !== null)).toBe(true)
    }
    expect(Object.values(countStatus(list)).reduce((a, b) => a + b, 0)).toBe(list.length)
    await expectNoCountSummary(page)
    return n
  }

  test('AC5: S SP를 바꾸면 띠가 새 실수치로 옮기고 추월·동속·추월당함·띠 배분 표기(화살표)가 따라 바뀐다(동속 줄 = 띠, 개수 요약 없음)', async ({ page }) => {
    await openSpeed(page, true)
    let sawTie = false
    for (const sp of [32, 20, 7, 0]) {
      await setMySp(page, sp)
      const stat = (await myStat(page).textContent())!.trim()
      await expect(band(page)).toHaveAttribute('data-speed', stat)
      await expect(band(page).locator('.speed-baseline-label')).toContainText(`내 스피드 ${stat}`)
      const sign = (await mySetFromUi(page)).nature === SIGN_NATURE.plus ? 'plus' : (await mySetFromUi(page)).nature === SIGN_NATURE.minus ? 'minus' : 'neutral'
      await expect(page.getByTestId('speed-baseline-bundle').locator('.bundle-mark')).toHaveText(bundleText(sp, sign))
      await expect(page.getByTestId('speed-baseline-bundle').locator('.sr-only')).toHaveText(bundleSpoken(sp, sign))
      await expect(page.getByTestId('speed-summary')).toHaveText(`내 스피드 ${stat}`)
      if ((await expectStatuses(page)) > 0) sawTie = true
    }
    expect(sawTie, '동속 줄이 있는 사례를 지났다').toBe(true)
  })

  test('AC5b: 내 도구 선제공격손톱(순서 변경)이면 띠·상태가 사라지고 원인 안내, 상세 최소 S 자리도 같은 안내, 되돌리면 복귀', async ({ page }) => {
    await openSpeed(page)
    const before = await band(page).getAttribute('data-speed')
    await setMyItem(page, '선제공격손톱')
    await expect(band(page)).toHaveCount(0)
    const notice = page.getByTestId('speed-reject')
    await expect(notice).toHaveText('내 행동 순서 변경 · 선제공격손톱')
    await expect(page.getByTestId('speed-summary')).toHaveText('')
    expect(new Set((await readBadges(page)).map((b) => b.status))).toEqual(new Set(['neutral']))
    for (const b of await readBadges(page)) expect(b.label).not.toMatch(/, (추월|동속|추월당함)(,|$)/)
    await expect(page.locator('.speed-mark.tie')).toHaveCount(0)
    await badges(page).first().click()
    await expect(detail(page).getByTestId('speed-detail-min-sp')).toHaveText('내 행동 순서 변경 · 선제공격손톱')
    await page.keyboard.press('Escape')
    await setMyItem(page, '생명의구슬')
    await expect(page.getByTestId('speed-reject')).toHaveCount(0)
    await expect(band(page)).toHaveCount(1)
    await expect(band(page)).toHaveAttribute('data-speed', before!)
  })

  test('AC6: 내 구애스카프 → 띠가 코어 공식(×1.5) 값, 내 특성 날씨부정(구름보기) → 날씨 배지만 사라진다', async ({ page }) => {
    await openSpeed(page)
    const plain = Number(await band(page).getAttribute('data-speed'))
    await setMyItem(page, '구애스카프')
    const want = finalSpeed(game, await mySetFromUi(page))
    expect(want).toBe(Math.floor(plain * 1.5))
    await expect(band(page)).toHaveAttribute('data-speed', String(want))

    const weatherBadges = async () => (await readBadges(page)).filter((b) => b.condition === 'field' && /(쾌청|비|모래바람|설경)(,|$)/.test(b.label.split(', ')[0]))
    await chooseMySpecies(page, '파비코리')
    // 파비코리가 배울 수 없는 기술(스톤샤워·분함의발구르기)을 비워 세트를 유효하게 둔다
    for (const i of [3, 4]) {
      await combo(mySet(page), `기술 ${i}`).fill('')
      await combo(mySet(page), `기술 ${i}`).press('Enter')
    }
    await abilitySelect(page).selectOption('naturalcure')
    await expect(band(page)).toHaveCount(1)
    await expect.poll(async () => (await weatherBadges()).length).toBeGreaterThan(0)
    const others = (await readBadges(page)).filter((b) => b.condition !== 'field').length
    await abilitySelect(page).selectOption('cloudnine')
    await expect.poll(async () => (await weatherBadges()).length).toBe(0)
    expect((await readBadges(page)).filter((b) => b.condition !== 'field').length).toBe(others)
  })

  test('AC8: 내 순풍 → 띠·상세 최소 S가 순풍 기준(코어 공식 ×2·전수 탐색), 탭을 오가도 유지', async ({ page }) => {
    await openSpeed(page)
    // 내 순풍 기준으로만 추월 가능 여부가 달라지는 느린 배지를 하나 고른다
    const list = await readBadges(page)
    const set = await mySetFromUi(page)
    const target = list.find((b) => bruteMinSp(set, b.speed, false) !== bruteMinSp(set, b.speed, true))!
    expect(target).toBeDefined()
    await badgeById(page, target.id).click()
    await expect(detail(page).getByTestId('speed-detail-min-sp')).toContainText(bruteMinSp(set, target.speed, false))
    await page.keyboard.press('Escape')

    await chip(page, 'my-tailwind').click()
    await expect(chip(page, 'my-tailwind')).toHaveAttribute('aria-pressed', 'true')
    const want = finalSpeed(game, set, { attacker: { tailwind: true } })
    await expect(band(page)).toHaveAttribute('data-speed', String(want))
    await expect(page.getByTestId('speed-baseline-bundle')).toContainText('순풍')
    await badgeById(page, target.id).click()
    const minSp = detail(page).getByTestId('speed-detail-min-sp')
    await expect(minSp).toContainText(bruteMinSp(set, target.speed, true))
    await expect(minSp.locator('small')).toContainText('순풍')
    await page.keyboard.press('Escape')

    await resultTab(page, '공격').click()
    await waitComplete(page)
    await selectTab(page, '스피드')
    await expect(chip(page, 'my-tailwind')).toHaveAttribute('aria-pressed', 'true')
    await expect(band(page)).toHaveAttribute('data-speed', String(want))
  })

  test('AC25: S 슬라이더를 연속으로 끄는 동안 매 프레임 보이는 배지가 자기 실수치 줄 높이에만 놓인다', async ({ page }) => {
    await openSpeed(page, true)
    await frame(page).scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number; __bad: string[]; __stop: boolean }
      w.__frames = 0
      w.__bad = []
      w.__stop = false
      const f = document.querySelector('[data-testid="speed-frame"]')!
      const tick = () => {
        if (w.__stop) return
        w.__frames++
        const fr = f.getBoundingClientRect()
        const rows = [...f.querySelectorAll<HTMLElement>('li.speed-row[data-speed], li.speed-baseline')].map((li) => ({ speed: Number(li.dataset.speed), r: li.getBoundingClientRect() }))
        for (const b of f.querySelectorAll<HTMLElement>('[data-testid="speed-badge"]')) {
          const r = b.getBoundingClientRect()
          if (r.bottom <= fr.top || r.top >= fr.bottom) continue
          const cy = (r.top + r.bottom) / 2
          const hits = rows.filter((x) => cy >= x.r.top && cy <= x.r.bottom)
          if (!hits.some((x) => x.speed === Number(b.dataset.speed))) w.__bad.push(`${w.__frames}:${b.getAttribute('aria-label')} @ ${hits.map((x) => x.speed).join('/')}`)
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const slider = mySet(page).getByRole('slider', { name: 'SP 스피드', exact: true })
    expect(await dragSlider(page, slider, 12)).toBe(12)
    expect(await dragSlider(page, slider, 30)).toBe(30)
    const res = await page.evaluate(() => {
      const w = window as unknown as { __frames: number; __bad: string[]; __stop: boolean }
      w.__stop = true
      return { frames: w.__frames, bad: w.__bad.slice(0, 10) }
    })
    expect(res.frames).toBeGreaterThan(10)
    expect(res.bad).toEqual([])
  })
})

test.describe('드래그 뒤 SP 확정(bugfix speed-sp-not-reflected)', () => {
  test('슬라이더를 마우스로 끌어 새 값에 놓은 뒤 숫자 입력·−/+로 바꾸면 기준선 data-speed가 따라간다', async ({ page }) => {
    await openSpeed(page)
    const slider = mySet(page).getByRole('slider', { name: 'SP 스피드', exact: true })
    const v0 = Number(await slider.inputValue())
    const t1 = v0 === 12 ? 20 : 12
    expect(await dragSlider(page, slider, t1)).toBe(t1)
    await expect(spBox(page)).toHaveValue(String(t1))
    // 드래그 확정 직후: 기준선 = 패널 실능치
    await expect.poll(async () => (await band(page).getAttribute('data-speed')) === (await myStat(page).innerText()).trim()).toBe(true)
    const atT1 = await band(page).getAttribute('data-speed')

    // 숫자 입력으로 다른 값 확정: 기준선이 드래그로 놓은 값에 멈추지 않는다(수정 전 회귀)
    const t2 = 5
    await setMySp(page, t2)
    await expect.poll(async () => (await band(page).getAttribute('data-speed')) === (await myStat(page).innerText()).trim()).toBe(true)
    const atT2 = await band(page).getAttribute('data-speed')
    expect(atT2).not.toBe(atT1)

    // −/+ 버튼(두 번째 커밋 경로)도 같다
    expect(await dragSlider(page, slider, t1)).toBe(t1)
    await expect.poll(async () => await band(page).getAttribute('data-speed')).toBe(atT1)
    await mySet(page).getByRole('button', { name: 'SP 스피드 1 올리기', exact: true }).click()
    await expect(spBox(page)).toHaveValue(String(t1 + 1))
    await expect.poll(async () => (await band(page).getAttribute('data-speed')) === (await myStat(page).innerText()).trim()).toBe(true)
    expect(await band(page).getAttribute('data-speed')).not.toBe(atT1)
  })
})

// ---------- 상세 ----------

test.describe('배지 상세(AC7, AC10)', () => {
  test('AC7: 클릭으로만 여닫음(호버로는 안 열림, 같은 배지 다시 클릭이면 닫힘), 이름·배분·실수치·상태 색·최소 S만, Esc·바깥 클릭으로 닫힘, 다른 배지 클릭이면 그 배지로', async ({ page }) => {
    await openSpeed(page)
    const list = await readBadges(page)
    const set = await mySetFromUi(page)
    const scarf = list.find((b) => b.condition === 'scarf')!
    expect(scarf).toBeDefined()
    // 호버만으로는 열리지 않는다(예전 호버 지연보다 넉넉히 기다린다)
    await badgeById(page, scarf.id).scrollIntoViewIfNeeded()
    await badgeById(page, scarf.id).hover()
    await page.waitForTimeout(600)
    await expect(detail(page)).toHaveCount(0)
    // 클릭 → 열림, 같은 배지 다시 클릭 → 닫힘, 또 클릭 → 열림
    await badgeById(page, scarf.id).click()
    await expect(detail(page)).toHaveAttribute('data-badge-id', scarf.id)
    await expect(badgeById(page, scarf.id)).toHaveAttribute('aria-expanded', 'true')
    await badgeById(page, scarf.id).click()
    await expect(detail(page)).toHaveCount(0)
    await expect(badgeById(page, scarf.id)).toHaveAttribute('aria-expanded', 'false')
    await badgeById(page, scarf.id).click()
    await expect(detail(page)).toHaveAttribute('data-badge-id', scarf.id)
    const d = detail(page)
    await expect(d.getByTestId('speed-detail-name')).toHaveText(speciesKo(scarf.opponent))
    // 상세 배분 줄: "S32↑ {스카프 아이콘} · 실수치 n"(스카프 태그 글자 없음, 도구 아이콘은 배분 표기 오른쪽)
    const bundleRow = d.locator('.speed-detail-bundle')
    await expect(bundleRow.locator('.bundle-mark')).toHaveText(bundleText(scarf.sp, scarf.sign))
    await expect(bundleRow.locator('.sr-only')).toHaveText(bundleSpoken(scarf.sp, scarf.sign))
    await expect(bundleRow).toContainText(`· 실수치 ${scarf.speed}`)
    await expect(bundleRow).not.toContainText('스카프')
    const detailMark = bundleRow.locator('.item-mark[data-item-id="choicescarf"]')
    await expect(detailMark).toHaveCount(1)
    expect((await detailMark.boundingBox())!.x).toBeGreaterThanOrEqual((await bundleRow.locator('.bundle-mark').boundingBox())!.x + (await bundleRow.locator('.bundle-mark').boundingBox())!.width - 0.5)
    // 스카프 배지 버튼: "스카프" 태그 없이 배분 표기 오른쪽 구애스카프 아이콘
    const scarfBadge = badgeById(page, scarf.id)
    await expect(scarfBadge.locator('.speed-tag')).toHaveCount(0)
    await expect(scarfBadge.locator('.speed-badge-text')).not.toContainText('스카프')
    await expect(scarfBadge.locator('.speed-badge-text > .item-mark[data-item-id="choicescarf"]')).toHaveCount(1)
    // 상태는 머리 색(배지와 같은 면)으로만: 보이는 상태 글자 없음, 접근 이름(sr-only)에만
    await expect(d).toHaveAttribute('data-status', scarf.status)
    const headBg = await d.locator('.speed-detail-head').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(headBg).toBe(await scarfBadge.evaluate((el) => getComputedStyle(el).backgroundColor))
    if (scarf.status !== 'neutral') await expect(d.locator('.speed-detail-title > .sr-only')).toHaveText(STATUS_KO[scarf.status as keyof typeof STATUS_KO])
    // 점유율·조건 점유율·도구 이름·안내 문구는 없다
    for (const gone of ['speed-detail-share', 'speed-detail-condition', 'speed-detail-item']) await expect(d.getByTestId(gone)).toHaveCount(0)
    await expect(d).not.toContainText('점유율')
    // 점유율 숫자는 접힌 "다른 배분 추가" 목록에만(머리줄·최소 S에는 없음)
    for (const part of [d.locator('.speed-detail-head'), d.getByTestId('speed-detail-min-sp')]) await expect(part).not.toContainText('%')
    await expect(d).not.toContainText('구애스카프')
    await expect(d).not.toContainText('도구 효과 없음')
    await expect(d.getByTestId('speed-detail-min-sp')).toContainText(bruteMinSp(set, scarf.speed, false))
    // 메가 배지: 메가 폼 이름
    const mega = list.find((b) => b.origin === 'ladder' && b.condition === 'none' && entryOf(b.opponent).mega !== undefined)!
    await badgeById(page, mega.id).click()
    await expect(detail(page)).toHaveAttribute('data-badge-id', mega.id)
    await expect(detail(page).getByTestId('speed-detail-name')).toHaveText(speciesKo(mega.opponent))
    // 메가 배지 버튼: 이름 글자·"메가" 태그·메가진화 문양·메가스톤 아이콘 없이 배분 표기만(메가스톤은 스피드에 관여하지 않음), 이름은 툴팁(title)과 접근 이름 첫 덩어리
    const megaBadge = badgeById(page, mega.id)
    await expect(megaBadge.locator('.speed-badge-text')).toHaveText(new RegExp(`^${bundleText(mega.sp, mega.sign)}`))
    await expect(megaBadge.locator('.speed-badge-text')).not.toContainText('메가')
    await expect(megaBadge.locator('.speed-badge-text')).not.toContainText(speciesKo(mega.opponent))
    const megaTitle = (await megaBadge.getAttribute('title')) ?? ''
    expect(megaTitle.length).toBeGreaterThan(0)
    expect(megaTitle).toContain(speciesKo(mega.opponent))
    expect(((await megaBadge.getAttribute('aria-label')) ?? '').startsWith(`${megaTitle} `)).toBe(true)
    await expect(megaBadge.locator('.item-mark')).toHaveCount(0)
    await expect(megaBadge.locator('[data-item-glyph]')).toHaveCount(0)
    await expect(detail(page).locator('.speed-detail-head .item-mark')).toHaveCount(0)
    // Esc
    await page.keyboard.press('Escape')
    await expect(detail(page)).toHaveCount(0)
    await expect(badgeById(page, mega.id)).toHaveAttribute('aria-expanded', 'false')
    // 바깥 클릭
    await badgeById(page, scarf.id).click()
    await expect(detail(page)).toBeVisible()
    await page.locator('.my-set h2').click()
    await expect(detail(page)).toHaveCount(0)
    // 열린 채 다른 배지 클릭 → 그 배지 상세
    const other = list.find((b) => b.id !== scarf.id && b.speed !== scarf.speed)!
    await badgeById(page, scarf.id).click()
    await expect(detail(page)).toHaveAttribute('data-badge-id', scarf.id)
    await badgeById(page, other.id).click()
    await expect(detail(page)).toHaveCount(1)
    await expect(detail(page)).toHaveAttribute('data-badge-id', other.id)
  })

  test('AC10: 쓱쓱 상대(대쓰여너 암컷)의 "비" 배지 = 1위 묶음에 비를 넣은 코어 공식 값, 상세 머리줄에 "비" 태그(가정 안내 문구 없음)', async ({ page }) => {
    await openSpeed(page)
    const e = entryOf('basculegionf')
    expect(e.abilities.swiftswim ?? 0, '쓱쓱 점유율이 기본 기준 10% 이상').toBeGreaterThanOrEqual(0.1)
    await setTopN(page, e.rank)
    const top = topBundle(e)
    const rain = (await readBadges(page)).find((b) => b.opponent === e.id && b.condition === 'field')
    expect(rain, '비 배지').toBeDefined()
    expect(rain!.label.split(', ')[0]).toBe(`${speciesKo(e.id)} ${bundleSpoken(top.sp, top.sign)} 비`)
    await expect(badgeById(page, rain!.id).locator('.speed-tag')).toHaveText('비')
    const want = finalSpeed(game, { ...withSpeed(baseSet(e), top.sp, top.sign), ability: 'swiftswim' }, { weather: 'Rain' })
    expect(rain!.speed).toBe(want)
    expect(rain!.rowSpeed).toBe(want)
    await badgeById(page, rain!.id).click()
    const head = detail(page).locator('.speed-detail-bundle')
    await expect(head).toContainText(`· 비 · 실수치 ${want}`)
    await expect(detail(page)).not.toContainText('파트너 날씨 가정')
    await expect(detail(page)).not.toContainText('미반영')
  })
})

test.describe('도구 표시 = 스피드에 관여한 도구만(사용자 피드백 2026-11-17)', () => {
  // 기대값: 구애스카프(×1.5)·검은철구(×0.5)만 스피드 배수를 걸고, 무딘손이면 도구 효과가 없다(게임 규칙에서 독립 도출)
  const SPEED_ITEMS = ['choicescarf', 'ironball']
  const expectedMark = (item: string | undefined, ability: string): string[] => (item !== undefined && SPEED_ITEMS.includes(item) && ability !== 'klutz' ? [item] : [])

  test('래더 기본 배지는 스카프 없는 세트 도구가 스피드 배수 도구일 때만 아이콘, 생명의구슬·메가스톤 등은 표시 없음, 스카프 배지엔 구애스카프', async ({ page }) => {
    await openSpeed(page)
    const shown = await badges(page).evaluateAll((els) =>
      els.map((el) => ({
        id: (el as HTMLElement).dataset.badgeId ?? '',
        origin: (el as HTMLElement).dataset.origin ?? '',
        condition: (el as HTMLElement).dataset.condition ?? '',
        marks: [...el.querySelectorAll<HTMLElement>('.item-mark')].map((m) => m.dataset.itemId ?? ''),
        text: el.querySelector('.speed-badge-text')?.textContent ?? '',
      })),
    )
    const base = shown.filter((b) => b.origin === 'ladder' && b.condition === 'none')
    expect(base.length).toBeGreaterThan(10)
    const stones = new Set(game.data.megas.map((m) => m.stone))
    let orbOrStone = 0
    let repScarf = 0
    for (const b of base) {
      const id = JSON.parse(b.id)[1] as string
      const set = entryOf(id).representative.set
      if (set.item === 'choicescarf') repScarf++
      const item = baseSet(entryOf(id)).item
      if (item === 'lifeorb' || (item !== undefined && stones.has(item))) orbOrStone++
      expect(b.marks, `${b.id} ${item ?? '-'}`).toEqual(expectedMark(item, set.ability))
      expect(b.marks, `${b.id} 기본 배지에 구애스카프 없음`).not.toContain('choicescarf')
    }
    expect(orbOrStone, '생명의구슬·메가스톤 대표 세트가 있는 실데이터').toBeGreaterThan(0)
    expect(repScarf, '대표 도구가 구애스카프인 실데이터').toBeGreaterThan(0)
    const scarf = shown.filter((b) => b.condition === 'scarf')
    expect(scarf.length).toBeGreaterThan(0)
    for (const b of scarf) expect(b.marks).toEqual(['choicescarf'])
    const panel = tabPanel(page)
    await expect(panel.locator('[data-item-glyph="mega"]')).toHaveCount(0)
    await expect(panel.locator('.speed-badge .item-mark[data-item-id="lifeorb"]')).toHaveCount(0)
    for (const stone of stones) await expect(panel.locator(`.speed-badge .item-mark[data-item-id="${stone}"]`)).toHaveCount(0)
    await expect(panel).not.toContainText('도구 무효')
  })
})

test.describe('AC7 터치(400px)', () => {
  test.use({ viewport: { width: 400, height: 800 }, hasTouch: true })
  test('AC7: 터치로 배지를 탭하면 상세가 열리고, 같은 배지 다시 탭이면 닫히고, 다른 배지 탭이면 전환, 바깥 탭으로 닫힌다', async ({ page }) => {
    await openSpeed(page)
    const first = badges(page).first()
    await first.scrollIntoViewIfNeeded()
    await first.tap()
    await expect(detail(page)).toBeVisible()
    await expect(detail(page).getByTestId('speed-detail-min-sp')).toBeVisible()
    // 400px에서 머리줄 글자·닫기 버튼이 서로 겹치지 않는다
    expect(await findOverlaps(page, '.speed-detail-head > *, .speed-detail-title > b, .speed-detail-bundle')).toEqual([])
    const firstId = (await first.getAttribute('data-badge-id'))!
    await first.tap()
    await expect(detail(page)).toHaveCount(0)
    await first.tap()
    await expect(detail(page)).toHaveAttribute('data-badge-id', firstId)
    const second = badges(page).nth(1)
    await second.scrollIntoViewIfNeeded()
    await second.tap()
    await expect(detail(page)).toHaveCount(1)
    await expect(detail(page)).toHaveAttribute('data-badge-id', (await second.getAttribute('data-badge-id'))!)
    await page.locator('.my-set h2').tap()
    await expect(detail(page)).toHaveCount(0)
  })
})

// ---------- 필터·범위 ----------

test.describe('필터와 범위(AC11, AC13~AC16)', () => {
  test('AC11: 기본 필터(랭크업·스카프·날씨 켬, 순풍 끔), 끄면 그 종류만 사라짐, 개수 요약 없음, 탭 왕복 유지, 새로고침이면 기본값·구애스카프 기준 5', async ({ page }) => {
    await openSpeed(page)
    const pressed = async () => Object.fromEntries(await Promise.all(FILTERS.map(async (f) => [f, await chip(page, f).getAttribute('aria-pressed')])))
    expect(await pressed()).toEqual({ rank: 'true', scarf: 'true', tailwind: 'false', field: 'true' })
    const KIND: Record<(typeof FILTERS)[number], string[]> = { rank: ['rank'], scarf: ['scarf'], tailwind: ['tailwind'], field: ['field'] }
    // 목록 밖 타겟이 없는 기본 상태: 구애스카프 장착 배지는 스카프 조건 배지뿐이다
    const scarfMarks = page.locator('[data-testid="speed-badge"]:not([data-origin="preset"]) .item-mark[data-item-id="choicescarf"]')
    const counts = async () => {
      const l = await readBadges(page)
      return { base: l.filter((b) => b.condition === 'none').length, ...Object.fromEntries(FILTERS.map((f) => [f, l.filter((b) => KIND[f].includes(b.condition)).length])) } as Record<string, number>
    }
    const c0 = await counts()
    expect(await scarfMarks.count()).toBe(c0.scarf)
    expect(c0.rank).toBeGreaterThan(0)
    expect(c0.scarf).toBeGreaterThan(0)
    expect(c0.field).toBeGreaterThan(0)
    expect(c0.tailwind).toBe(0)
    await chip(page, 'tailwind').click()
    await expect.poll(async () => (await counts()).tailwind).toBeGreaterThan(0)
    await expectNoCountSummary(page)
    const all = await counts()
    expect(all.base).toBe(c0.base)
    for (const f of FILTERS) {
      await chip(page, f).click()
      await expect(chip(page, f)).toHaveAttribute('aria-pressed', 'false')
      await expect.poll(async () => (await counts())[f]).toBe(0)
      if (f === 'scarf') await expect(scarfMarks, '스카프 필터 끔 → 구애스카프 아이콘 래더 배지 0').toHaveCount(0)
      const c = await counts()
      for (const g of [...FILTERS, 'base']) if (g !== f) expect(c[g], `${f} 끔 → ${g}`).toBe(all[g])
      await chip(page, f).click()
      await expect.poll(async () => (await counts())[f]).toBe(all[f])
    }
    // 랭크업 끔·순풍 켬 상태로 공격 탭 왕복
    await chip(page, 'rank').click()
    await resultTab(page, '공격').click()
    await waitComplete(page)
    await selectTab(page, '스피드')
    expect(await pressed()).toEqual({ rank: 'false', scarf: 'true', tailwind: 'true', field: 'true' })
    // 새로고침 → 기본값
    await page.reload()
    await expect(page.locator('main[data-app="product"]')).toBeVisible()
    await expect(toolbarSpin(page, '구애스카프 최소(%)')).toHaveValue('5')
    await selectTab(page, '스피드')
    expect(await pressed()).toEqual({ rank: 'true', scarf: 'true', tailwind: 'false', field: 'true' })
  })

  test('AC13: 목록 밖 타겟 프리셋 도구를 선제공격손톱으로 바꾸면 축에서 빠지고 "순서 비교 불가"에 이유와 함께', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addWashRotom(page)
    await selectTab(page, '스피드')
    await expect(presetBadges(page)).toHaveCount(3)
    const p1 = presetBadges(page).and(page.locator('[aria-label*="프리셋 1"]'))
    await p1.click()
    const tool = combo(detail(page), '프리셋 도구')
    await tool.fill('선제공격손톱')
    await tool.press('Enter')
    await expect(presetBadges(page)).toHaveCount(2)
    await expect(page.locator('[data-testid="speed-badge"][aria-label*="프리셋 1"]')).toHaveCount(0)
    const area = page.getByTestId('speed-unsupported')
    await expect(area.getByRole('heading', { name: '순서 비교 불가' })).toBeVisible()
    await expect(area.getByRole('listitem')).toHaveText(['워시로토무 (프리셋 1) · 행동 순서 변경 · 선제공격손톱'])
    // 도구 아이콘은 포켓몬 이미지 옆(겹치지 않음)
    const qc = area.locator('li .item-mark[data-item-id="quickclaw"]')
    await expect(qc).toHaveCount(1)
    const qcBox = (await qc.boundingBox())!
    const monBox = (await area.locator('li [data-testid="mon-icon"]').first().boundingBox())!
    expect(qcBox.x).toBeGreaterThanOrEqual(monBox.x + monBox.width - 0.5)
  })

  test('AC14: 목록 밖 타겟 프리셋 3종이 각자 실수치 줄에 다른 배경·"프리셋 n" 표지로, 삭제하면 사라진다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addWashRotom(page)
    await selectTab(page, '스피드')
    await expect(presetBadges(page)).toHaveCount(3)
    const list = (await readBadges(page)).filter((b) => b.origin === 'preset')
    expect(list.map((b) => /프리셋 ([1-3])/.exec(b.label)?.[1]).sort()).toEqual(['1', '2', '3'])
    for (const b of list) {
      expect(b.rowSpeed).toBe(b.speed)
      expect(b.label).toContain(`실수치 ${b.speed}`)
      await expect(badgeById(page, b.id).locator('.speed-mark.pre')).toHaveText(/^프리셋 [1-3]$/)
    }
    const bgOf = (loc: Locator) => loc.evaluate((el) => `${getComputedStyle(el).backgroundColor}|${getComputedStyle(el).backgroundImage}`)
    for (const b of list) {
      const ladder = (await readBadges(page)).find((x) => x.origin === 'ladder' && x.status === b.status)
      if (ladder) expect(await bgOf(badgeById(page, b.id)), '프리셋 배경 ≠ 같은 상태 래더 배경').not.toBe(await bgOf(badgeById(page, ladder.id)))
    }
    await presetBadges(page).first().click()
    await detail(page).getByRole('button', { name: '워시로토무 타겟 삭제', exact: true }).click()
    await expect(presetBadges(page)).toHaveCount(0)
  })

  test('AC15: 상위 N·포켓몬 선택이 기본·조건 배지 범위를 바꾸고 목록 밖 타겟 배지는 남는다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addWashRotom(page)
    await selectTab(page, '스피드')
    const ladderOpponents = async () => [...new Set((await readBadges(page)).filter((b) => b.origin === 'ladder').map((b) => b.opponent))].sort()
    await setTopN(page, 10)
    await expect.poll(ladderOpponents).toEqual(ranking.slice(0, 10).map((e) => e.id).sort())
    expect((await readBadges(page)).some((b) => b.condition !== 'none' && b.origin === 'ladder')).toBe(true)
    await expect(presetBadges(page)).toHaveCount(3)
    const pick = combo(page.getByTestId('tool-row-search'), '포켓몬 찾기')
    await pick.fill('한카리아스')
    await pick.press('Enter')
    await expect.poll(ladderOpponents).toEqual(['garchomp'])
    expect((await readBadges(page)).filter((b) => b.origin === 'ladder' && b.condition !== 'none').length).toBeGreaterThan(0)
    await expect(presetBadges(page)).toHaveCount(3)
  })

  test.describe('빈 상태(고정 데이터: 포푸니크 대표 도구를 선제공격손톱으로 바꾼 메타)', () => {
    test.use({ serviceWorkers: 'block' })
    test('AC15·AC13: 선택 결과의 배지가 없으면 띠와 빈 상태 안내, 래더 상대는 "순서 비교 불가"에 이유와 함께', async ({ page }) => {
      let patched = 0
      await page.route(/\/assets\/\d{4}-\d{2}-bo1-[\w-]+\.js$/, async (route) => {
        const res = await route.fetch()
        const body = await res.text()
        const next = body.replace('species:`sneasler`}', () => {
          patched++
          return 'species:`sneasler`,item:`quickclaw`}'
        })
        await route.fulfill({ response: res, body: next })
      })
      await openProduct(page)
      await waitComplete(page)
      expect(patched, '메타 묶음에서 포푸니크 대표 세트를 고쳤다').toBe(1)
      await selectTab(page, '스피드')
      const pick = combo(page.getByTestId('tool-row-search'), '포켓몬 찾기')
      await pick.fill('포푸니크')
      await pick.press('Enter')
      await expect(badges(page)).toHaveCount(0)
      await expect(page.getByTestId('speed-empty')).toContainText('표시할 상대가 없습니다')
      await expect(band(page)).toBeVisible()
      await expectNoCountSummary(page)
      await expect(page.getByTestId('speed-unsupported').getByRole('listitem')).toHaveText(['포푸니크 · 행동 순서 변경 · 선제공격손톱'])
    })
  })

  test('AC16: 공격 탭 직접 추가·고정을 만든 뒤 스피드 탭을 오가도 오류 없이 그대로, 스피드 탭 추가 배분은 공격 탭에 없다', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await openProduct(page)
    await waitComplete(page)
    const first = cards(page).and(page.locator('[data-origin="ladder"]:not([data-power-item])')).filter({ has: page.locator('button.bundle-btn') }).first()
    const key = await first.getAttribute('data-group-key')
    const row = cards(page).and(page.locator(`[data-group-key='${key}']`))
    await row.locator('button.bundle-btn').click()
    const menu = row.getByRole('menu', { name: '노력치 배분', exact: true })
    await menu.getByRole('spinbutton', { name: '직접 추가 SP HP', exact: true }).fill('31')
    await menu.getByRole('spinbutton', { name: '직접 추가 SP 방어', exact: true }).fill('3')
    await page.keyboard.press('Enter')
    await waitComplete(page)
    await expect(row.getByTestId('card-bundle')).toHaveText('H31 B3 고정됨')
    const attackCards = await cards(page).count()

    await selectTab(page, '스피드')
    await expect(frame(page)).toBeVisible()
    // 스피드 탭에서 배분 하나 추가
    const base = (await readBadges(page)).find((b) => b.origin === 'ladder' && b.condition === 'none')!
    await badgeById(page, base.id).click()
    await detail(page).getByTestId('speed-add-toggle').click()
    await detail(page).getByTestId('speed-add-option').and(page.locator(':enabled')).first().click()
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"]')).toHaveCount(1)

    await selectTab(page, '공격')
    await waitComplete(page)
    await expect(row.getByTestId('card-bundle')).toHaveText('H31 B3 고정됨')
    await expect(row).toHaveAttribute('data-pinned', 'true')
    await expect(cards(page)).toHaveCount(attackCards)
    await expect(cards(page).and(page.locator('[data-user-added="true"]'))).toHaveCount(1)
    await selectTab(page, '방어')
    await waitComplete(page)
    await expect(cards(page).and(page.locator('[data-user-added="true"]'))).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

// ---------- 차트 배분 추가 ----------

test.describe('차트에서 배분 추가(AC26)', () => {
  test('AC26: 목록·직접 입력 추가, "추가" 표지·실수치 줄·도구 아이콘·상태·최소 S·배지 수 ±1, 이미 존재합니다, 지우기, 탭 왕복, 범위·선택 필터 밖이면 추가 배지만, 새로고침', async ({ page }) => {
    await openSpeed(page)
    const set = await mySetFromUi(page)
    // 순위 2 이상인 래더 상대 기본 배지(상위 N으로 뺄 수 있게)
    const base = (await readBadges(page)).find((b) => b.origin === 'ladder' && b.condition === 'none' && entryOf(b.opponent).rank >= 2)!
    const entry = entryOf(base.opponent)
    const ofOpponent = async () => (await readBadges(page)).filter((b) => b.opponent === base.opponent)
    const total = async () => (await readBadges(page)).length
    const n0 = (await ofOpponent()).length
    const sum0 = await total()

    // (a) 묶음 목록에서
    await badgeById(page, base.id).click()
    await detail(page).getByTestId('speed-add-toggle').click()
    const options = detail(page).getByTestId('speed-add-option')
    const baseOpt = options.filter({ has: page.locator('b .bundle-mark', { hasText: new RegExp(`^${bundleText(base.sp, base.sign)}$`) }) })
    await expect(baseOpt).toBeDisabled()
    await expect(baseOpt).toContainText('이미 존재합니다')
    const pickOpt = options.and(page.locator(':enabled')).first()
    const optLabel = (await pickOpt.locator('b .bundle-mark').textContent())!
    const optSpoken = (await pickOpt.locator('b .sr-only').textContent())!
    expect(optLabel).toMatch(/^S\d{1,2}[↑↓]?$/)
    const optSpeed = Number(await pickOpt.locator('span.num').nth(1).textContent())
    await pickOpt.click()
    const added = page.locator('[data-testid="speed-badge"][data-origin="added"]')
    await expect(added).toHaveCount(1)
    const a = (await readBadges(page)).find((b) => b.origin === 'added')!
    expect(a.label.split(', ')[0]).toBe(`${speciesKo(base.opponent)} ${optSpoken}`)
    expect(optSpoken).toBe(bundleSpoken(a.sp, a.sign))
    expect(optLabel).toBe(bundleText(a.sp, a.sign))
    expect(a.speed).toBe(optSpeed)
    expect(a.speed).toBe(finalSpeed(game, withSpeed(baseSet(entry), a.sp, a.sign)))
    expect(a.rowSpeed).toBe(a.speed)
    expect(a.condition).toBe('none')
    await expect(added.locator('.speed-mark.add')).toHaveText('추가')
    expect((await ofOpponent()).length).toBe(n0 + 1)
    expect(await total()).toBe(sum0 + 1)
    const itemOf = (id: string) => badgeById(page, id).locator('.item-mark').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.itemId))
    expect(await itemOf(a.id)).toEqual(await itemOf(base.id))
    // 추가 배지 상세: 상태·최소 S, 같은 묶음은 다시 고를 수 없다
    await expect(detail(page)).toHaveAttribute('data-badge-id', a.id)
    await expect(detail(page)).toHaveAttribute('data-status', a.status)
    await expect(detail(page).getByTestId('speed-detail-min-sp')).toContainText(bruteMinSp(set, a.speed, false))
    await detail(page).getByTestId('speed-add-toggle').click()
    await expect(detail(page).getByTestId('speed-add-option').filter({ has: page.locator('b .bundle-mark', { hasText: new RegExp(`^${optLabel}$`) }) })).toBeDisabled()

    // (b) 직접 입력: 목록에 없는 SP·성격
    const listed = new Set(await detail(page).getByTestId('speed-add-option').locator('b .bundle-mark').allTextContents())
    let custom: { sp: number; sign: Sign } | undefined
    for (let sp = 0; sp <= 32 && !custom; sp++) for (const sign of ['minus', 'neutral', 'plus'] as Sign[]) if (!custom && !listed.has(bundleText(sp, sign))) custom = { sp, sign }
    const form = detail(page).locator('.speed-add-custom')
    const fillCustom = async (sp: number, sign: Sign) => {
      await form.getByRole('spinbutton', { name: 'S SP' }).fill(String(sp))
      // 성격 보정: 내 포켓몬 SP 행과 같은 ▲▼ 토글(하나만 켜짐, 둘 다 꺼짐 = 무보정)
      const up = form.getByRole('button', { name: '스피드 성격 상승', exact: true })
      const down = form.getByRole('button', { name: '스피드 성격 하락', exact: true })
      const want = { plus: up, minus: down } as const
      for (const [k, btn] of Object.entries(want)) {
        const on = (await btn.getAttribute('aria-pressed')) === 'true'
        if (on !== (sign === k)) await btn.click()
      }
      await expect(up).toHaveAttribute('aria-pressed', String(sign === 'plus'))
      await expect(down).toHaveAttribute('aria-pressed', String(sign === 'minus'))
      await form.getByRole('button', { name: '추가', exact: true }).click()
    }
    await fillCustom(custom!.sp, custom!.sign)
    await expect(added).toHaveCount(2)
    const c = (await readBadges(page)).find((b) => b.origin === 'added' && b.sp === custom!.sp && b.sign === custom!.sign)!
    expect(c.speed).toBe(finalSpeed(game, withSpeed(baseSet(entry), custom!.sp, custom!.sign)))
    expect(c.rowSpeed).toBe(c.speed)
    await expect(detail(page)).toHaveAttribute('data-badge-id', c.id)

    // 이미 존재합니다: 기본 묶음·추가한 배분과 같은 SP·성격
    const count = (await readBadges(page)).length
    await detail(page).getByTestId('speed-add-toggle').click()
    for (const dup of [{ sp: base.sp, sign: base.sign }, custom!]) {
      await fillCustom(dup.sp, dup.sign)
      await expect(detail(page).getByTestId('speed-add-msg')).toHaveText(`이미 존재합니다 — ${bundleText(dup.sp, dup.sign)}`)
      expect((await readBadges(page)).length).toBe(count)
    }

    // 지우기 → 배지 수 −1
    const sumBefore = await total()
    await detail(page).getByTestId('speed-remove').click()
    await expect(added).toHaveCount(1)
    expect(await total()).toBe(sumBefore - 1)

    // 탭 왕복 유지
    await resultTab(page, '공격').click()
    await waitComplete(page)
    await selectTab(page, '스피드')
    await expect(added).toHaveCount(1)
    // 상위 N·포켓몬 선택 필터로 그 상대를 빼도 추가 배지만 남고 기본·조건 배지는 사라진다. 되돌리면 기본 배지가 다시 보인다
    const ladderOf = async () => (await ofOpponent()).filter((b) => b.origin === 'ladder')
    const expectAddedOnly = async () => {
      await expect(added).toHaveCount(1)
      await expect.poll(async () => (await ladderOf()).length).toBe(0)
    }
    const expectRestored = async () => {
      await expect(added).toHaveCount(1)
      await expect.poll(async () => (await ladderOf()).some((b) => b.condition === 'none' && b.sp === base.sp && b.sign === base.sign)).toBe(true)
    }
    await setTopN(page, entry.rank - 1)
    await expectAddedOnly()
    await setTopN(page, DEFAULT_TOP_N)
    await expectRestored()
    const other = ranking.find((e) => e.id !== base.opponent)!
    const pick = combo(page.getByTestId('tool-row-search'), '포켓몬 찾기')
    await pick.fill(speciesKo(other.id))
    await pick.press('Enter')
    await expectAddedOnly()
    await page.getByRole('button', { name: '선택 비우기', exact: true }).click()
    await expectRestored()
    // 새로고침해도 남는다(파티 저장, party-pokepaste R22)
    const addedCount = await added.count()
    expect(addedCount).toBeGreaterThan(0)
    await page.reload()
    await expect(page.locator('main[data-app="product"]')).toBeVisible()
    await selectTab(page, '스피드')
    await expect(badges(page).first()).toBeVisible()
    await expect(added).toHaveCount(addedCount)
  })
})
