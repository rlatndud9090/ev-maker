import { expect, type Locator, type Page } from '@playwright/test'

export const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

/** select와 datalist 입력은 combobox다. 감싼 label의 텍스트엔 option 문구가 섞여 getByLabel 정확 일치가 안 된다. */
export const combo = (scope: Page | Locator, name: string) => scope.getByRole('combobox', { name, exact: true })

export async function openPage(page: Page) {
  await page.goto('/#/dev')
  await expect(region(page, '공격측').locator('table.stats')).toBeVisible()
}

export interface SetInput {
  species?: string
  nature?: string
  item?: string
  mega?: boolean
  sp?: Partial<Record<'HP' | '공격' | '방어' | '특공' | '특방' | '스피드', string>>
  moves?: string[]
}

export async function fillSet(page: Page, side: '공격측' | '방어측', s: SetInput) {
  const r = region(page, side)
  if (s.species !== undefined) await combo(r, '종').fill(s.species)
  if (s.item !== undefined) await combo(r, '도구').fill(s.item)
  if (s.mega !== undefined) await r.getByRole('checkbox', { name: /^메가진화/ }).setChecked(s.mega)
  if (s.nature !== undefined) await combo(r, '성격').selectOption(s.nature)
  for (const [stat, v] of Object.entries(s.sp ?? {})) await r.getByRole('spinbutton', { name: `SP ${stat}`, exact: true }).fill(v)
  for (const [i, m] of (s.moves ?? []).entries()) await combo(r, `기술 ${i + 1}`).fill(m)
}

export const ALL_SP_ZERO = { HP: '0', 공격: '0', 방어: '0', 특공: '0', 특방: '0', 스피드: '0' } as const

export const statCell = (page: Page, side: '공격측' | '방어측', stat: string) =>
  region(page, side).locator(`table.stats td[data-stat="${stat}"]`)

/** 서로 포함 관계가 아닌 보이는 요소끼리 1px 넘게 겹치는 쌍(문구 앞 20자). */
export async function findOverlaps(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = []
    // 보이는 부분만 비교한다: 스크롤 박스(overflow가 visible이 아닌 조상) 밖으로 잘린 부분은 겹침이 아니다.
    // 붙은 sticky 줄: 페이지 맨 위(창 스크롤) 또는 가장 가까운 스크롤 박스 위 변에 붙은 것(그 박스가 스크롤된 상태).
    const stuckIn = (el: Element, r: DOMRect): boolean => {
      if (window.scrollY > 0 && r.top <= 1 && r.top >= -1) return true
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (!/(auto|scroll)/.test(getComputedStyle(p).overflowY)) continue
        return p.scrollTop > 0 && Math.abs(r.top - p.getBoundingClientRect().top) <= 1
      }
      return false
    }
    const stuck = [...document.querySelectorAll('*')]
      .filter((el) => getComputedStyle(el).position === 'sticky')
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => stuckIn(el, r))
    const visibleRect = (el: Element) => {
      const r = el.getBoundingClientRect()
      let { left, top, right, bottom } = r
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
        const c = p.getBoundingClientRect()
        left = Math.max(left, c.left)
        top = Math.max(top, c.top)
        right = Math.min(right, c.right)
        bottom = Math.min(bottom, c.bottom)
      }
      // 화면 위에 붙은 sticky 줄 뒤로 스크롤되어 가려진 부분도 보이지 않는다.
      for (const st of stuck) if (!st.el.contains(el) && st.r.left < right && st.r.right > left) top = Math.max(top, st.r.bottom)
      return { left, top, right, bottom, width: right - left, height: bottom - top }
    }
    const boxes = [...document.querySelectorAll(sel)]
      .map((el) => ({ el, r: visibleRect(el) }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
        if (x > 1 && y > 1) out.push(`${a.el.textContent?.slice(0, 20)} ↔ ${b.el.textContent?.slice(0, 20)}`)
      }
    }
    return out
  }, selector)
}

// ---------- 제품 화면 ----------

export type ProductTab = '공격' | '방어' | '스피드'
export const TAB_ID: Record<ProductTab, 'attack' | 'defense' | 'speed'> = { 공격: 'attack', 방어: 'defense', 스피드: 'speed' }

export const mySet = (page: Page) => region(page, '내 포켓몬')
export const tabPanel = (page: Page) => page.locator('[role="tabpanel"][data-testid="tab-panel"]')
export const resultTab = (page: Page, name: ProductTab) =>
  page.getByRole('tablist', { name: '결과 탭' }).getByRole('tab', { name, exact: true })
export const cards = (page: Page) => tabPanel(page).getByTestId('card')

export async function openProduct(page: Page) {
  await page.goto('/')
  await expect(page.locator('main[data-app="product"]')).toBeVisible()
  await expect(tabPanel(page)).toHaveAttribute('data-first-card', 'true', { timeout: 15_000 })
}

/** 지금 탭이 현재 세대로 끝날 때까지(이전 세대 뷰 표시 중이 아님). */
export async function waitComplete(page: Page, timeout = 20_000) {
  await expect(tabPanel(page)).toHaveAttribute('data-complete', 'true', { timeout })
  await expect(tabPanel(page)).not.toHaveAttribute('data-superseded', 'true')
}

export async function selectTab(page: Page, name: ProductTab) {
  await resultTab(page, name).click()
  await expect(tabPanel(page)).toHaveAttribute('data-tab', TAB_ID[name])
}

export type StatLabel = 'HP' | '공격' | '방어' | '특공' | '특방' | '스피드'
export const NATURE_STATS = ['공격', '방어', '특공', '특방', '스피드'] as const

export interface MySetInput {
  species?: string
  item?: string
  moves?: readonly string[]
  sp?: Partial<Record<StatLabel, number>>
  /** null = 무보정(눌린 상승 버튼을 끈다) */
  plus?: (typeof NATURE_STATS)[number] | null
}

/** 내 포켓몬 패널에 세트를 넣는다(종 → 도구 → 기술 → SP → 성격 순). 끝나면 새 세대가 다 계산될 때까지 기다린다. */
export async function fillMySet(page: Page, s: MySetInput) {
  const me = mySet(page)
  const enter = async (name: string, text: string) => {
    const box = combo(me, name)
    await box.fill(text)
    await box.press('Enter')
    await expect(box).toHaveValue(text)
  }
  if (s.species !== undefined) await enter('종', s.species)
  if (s.item !== undefined) await enter('도구', s.item)
  for (const [i, m] of (s.moves ?? []).entries()) await enter(`기술 ${i + 1}`, m)
  // SP 입력은 남은 합계까지만 받으므로 바꿀 칸을 먼저 비우고 채운다.
  const spBoxes = Object.entries(s.sp ?? {}).map(([stat, v]) => [me.getByRole('spinbutton', { name: `SP ${stat} 숫자`, exact: true }), String(v)] as const)
  for (const [box] of spBoxes) await box.fill('0')
  for (const [box, v] of spBoxes) {
    await box.fill(v)
    await expect(box).toHaveValue(v)
  }
  if (s.plus !== undefined) {
    for (const stat of NATURE_STATS) {
      const b = me.getByRole('button', { name: `${stat} 성격 상승`, exact: true })
      if (((await b.getAttribute('aria-pressed')) === 'true') !== (s.plus === stat)) await b.click()
      await expect(b).toHaveAttribute('aria-pressed', String(s.plus === stat))
    }
  }
  await waitComplete(page)
}

/** 내 포켓몬 패널의 컷 고정 목록(SP 블록 아래). 계산 중에는 머리에 "계산 중…"이 붙어 이름이 "컷 고정 계산 중…"이다 */
export const lockList = (page: Page) => mySet(page).getByRole('region', { name: /^컷 고정( 계산 중…)?$/ })

/** 슬라이더를 마우스로 끌어 값이 target이 된 것을 확인한 뒤 놓는다. 놓기 직전 값을 돌려준다. */
export async function dragSlider(page: Page, slider: Locator, target: number): Promise<number> {
  await slider.scrollIntoViewIfNeeded()
  const box = (await slider.boundingBox())!
  const { min, max, value } = await slider.evaluate((el: HTMLInputElement) => ({ min: Number(el.min), max: Number(el.max), value: Number(el.value) }))
  // 썸 폭을 모르므로 트랙 비율로 시작점을 잡고 값이 맞을 때까지 1px씩 옮긴다.
  let x = Math.min(box.x + box.width - 3, Math.max(box.x + 3, box.x + ((value - min) / (max - min)) * box.width))
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  let cur = Number(await slider.inputValue())
  for (let i = 0; i < box.width * 2 && cur !== target; i++) {
    x += cur < target ? 1 : -1
    await page.mouse.move(x, y)
    cur = Number(await slider.inputValue())
  }
  await page.mouse.up()
  return cur
}

// ---------- 컷 고정 ----------

/** 래더 배지 읽기 이름 "메가눈여아 S32 성격 상승, 실수치 189, …" */
export const badge = (page: Page, name: RegExp) => page.getByTestId('speed-badge').and(page.getByRole('button', { name })).first()
export const speedDetail = (page: Page) => page.getByTestId('speed-detail')
/** 그 배지 앞 컷 고정 핀 */
export const badgePin = (page: Page, name: RegExp) => page.locator('.speed-badge-item').filter({ has: badge(page, name) }).first().getByTestId('cut-pin')
export const lockedSp = (page: Page, stat: string) => mySet(page).getByTestId(`sp-locked-${stat}`)

export async function openBadge(page: Page, name: RegExp) {
  if ((await tabPanel(page).getAttribute('data-tab')) !== 'speed') await selectTab(page, '스피드')
  const b = badge(page, name)
  await b.scrollIntoViewIfNeeded()
  if ((await speedDetail(page).count()) === 0 || (await speedDetail(page).getAttribute('data-badge-id')) !== (await b.getAttribute('data-badge-id'))) await b.click()
  await expect(speedDetail(page)).toBeVisible()
}

/** 배지 상세를 열고 그 배지 핀을 눌러 바로 고정한다(스피드는 단계가 추월 하나라 메뉴가 없다) */
export async function lockBadge(page: Page, name: RegExp) {
  await openBadge(page, name)
  const pin = badgePin(page, name)
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await expect(pin.locator('xpath=..').getByTestId('cut-pin-menu')).toHaveCount(0)
}

/** 고정 중 계산이 끝날 때까지(목록 "계산 중…"이 사라지고 탭이 완료) */
export async function settle(page: Page) {
  await expect(lockList(page).getByRole('status')).toHaveCount(0, { timeout: 20_000 })
  if ((await tabPanel(page).getAttribute('data-tab')) !== 'speed') await waitComplete(page)
}

/** 공격·방어 탭 기본 고정 단계(핀 메뉴 항목 글자) */
const DEFAULT_STAGE: Readonly<Record<Exclude<ProductTab, '스피드'>, string>> = { 공격: '확정1타', 방어: '확정견딤' }

/** 카드 줄 핀 메뉴의 그 단계 항목 */
export const pinItem = (card: Locator, stage: string) => card.getByTestId('cut-pin-item').filter({ has: card.page().locator('.cut-pin-stage', { hasText: new RegExp(`^${stage}$`) }) })

/** 그 상대·기술이 보이는 카드(카드 줄 data-move = 보이는 판정 행 기술) */
export const moveCard = (page: Page, opponent: string, move: string) => cards(page).and(page.locator(`[data-opponent="${opponent}"][data-move="${move}"]`)).first()

/** 공격·방어 탭에서 그 상대·기술이 보이는 카드의 줄 핀을 누르고 단계 메뉴에서 stage를 고른다. 고정한 카드를 돌려준다 */
export async function lockRow(page: Page, tab: Exclude<ProductTab, '스피드'>, opponent: string, move: string, stage = DEFAULT_STAGE[tab]): Promise<Locator> {
  if ((await tabPanel(page).getAttribute('data-tab')) !== (tab === '공격' ? 'attack' : 'defense')) await selectTab(page, tab)
  await waitComplete(page)
  const card = moveCard(page, opponent, move)
  const pin = card.getByTestId('cut-pin')
  await expect(pin, `${opponent} ${move} 컷 고정 핀`).toHaveAttribute('aria-pressed', 'false')
  await pin.click()
  const item = pinItem(card, stage)
  await expect(item, `${opponent} ${move} ${stage} 고정 가능`).toHaveAttribute('data-enabled', 'true', { timeout: 15_000 })
  await item.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByTestId('cut-pin-menu')).toHaveCount(0)
  await settle(page)
  return card
}

// ---------- 변동 팝오버 ----------

/** 카드 줄 "변동 ▾" 버튼 */
export const adjustButton = (card: Locator) => card.getByTestId('adjust-button')

/** 변동 팝오버(1단 결과 목록·2단 성격 선택이 같은 자리) */
export const adjustMenu = (card: Locator) => card.getByTestId('adjust-menu')

/** 변동 버튼을 눌러 팝오버를 연다(이미 열려 있으면 그대로). 팝오버를 돌려준다 */
export async function openAdjust(card: Locator): Promise<Locator> {
  const btn = adjustButton(card)
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click()
  await expect(btn).toHaveAttribute('aria-expanded', 'true')
  const menu = adjustMenu(card)
  await expect(menu).toHaveAttribute('role', 'menu')
  await expect(menu).toBeVisible()
  return menu
}

/** 1단 결과 항목(배지 글자 "확정1타" 등) */
export const adjustResult = (card: Locator, label: string) =>
  card.getByTestId('adjust-result').filter({ has: card.page().locator('.ko-badge', { hasText: new RegExp(`^${label}$`) }) })

/** 2단 성격 선택지(이름 "무보정" · "C 상승" · "B 보정" 등) */
export const adjustNature = (card: Locator, name: string) =>
  card.getByTestId('adjust-nature').filter({ has: card.page().locator('.adjust-nature-name', { hasText: new RegExp(`^${name}$`) }) })
