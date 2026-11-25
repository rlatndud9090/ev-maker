import { expect, test, type Locator, type Page } from '@playwright/test'
import { addCustomTarget, combo, dragSlider, mySet, openProduct, selectTab, waitComplete } from './helpers'

// 스피드 차트 접근성: 접근성 트리(목록·기준선 구분 항목·배지 접근 이름), 알림 영역 갱신 시점, 키보드 탐색, 태그 글자 대비, 도구 아이콘 기하(포켓몬 이미지와 겹치지 않고 글자 오른쪽).

const badges = (page: Page) => page.getByTestId('speed-badge')
const chip = (page: Page, filter: string) => page.locator(`[data-testid="speed-head"] [data-filter="${filter}"]`)
const SPEED_FILTERS = ['rank', 'scarf', 'tailwind', 'field'] as const
/** 알림 영역: 확정 내 스피드만(추월·동속 개수 요약 없음) */
const LIVE = /^내 스피드 \d+$/
const BUNDLE = /S\d+ 성격 (상승|무보정|하락)/

async function openSpeed(page: Page, allFilters = true) {
  await openProduct(page)
  await waitComplete(page)
  await selectTab(page, '스피드')
  await expect(badges(page).first()).toBeVisible()
  if (!allFilters) return
  for (const f of SPEED_FILTERS) {
    if ((await chip(page, f).getAttribute('aria-pressed')) !== 'true') await chip(page, f).click()
    await expect(chip(page, f)).toHaveAttribute('aria-pressed', 'true')
  }
}

/** 스피드 탭 요약 알림 영역(상세의 "이미 존재합니다"·입력 안내는 뺀다) */
function liveRegion(page: Page): Locator {
  return page
    .getByRole('tabpanel')
    .locator('[role="status"], [aria-live]')
    .and(page.locator(':not([data-testid="speed-add-msg"])'))
}

/** 띠 라벨의 내 실수치 */
const bandSpeed = async (page: Page) => Number(await page.getByTestId('speed-baseline').getAttribute('data-speed'))

const activeBadge = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el.dataset.testid !== 'speed-badge') return null
    return { id: el.dataset.badgeId ?? '', speed: Number(el.dataset.speed), origin: el.dataset.origin ?? '', name: el.getAttribute('aria-label') ?? '' }
  })

/** 포커스가 testid 요소(사용 가능)에 닿을 때까지 Tab(키보드만으로 상세 안을 옮겨 다닌다) */
async function tabUntil(page: Page, testid: string, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const hit = await page.evaluate((id) => {
      const el = document.activeElement as HTMLButtonElement | null
      return el?.dataset.testid === id && !el.disabled
    }, testid)
    if (hit) return
  }
  throw new Error(`Tab으로 ${testid}에 닿지 못했다`)
}

test.describe('스피드 차트 접근성', () => {
  test('접근성 트리: 실수치 내림차순 목록·기준선 구분 항목·배지 이름(상대·배분·조건·실수치·상태·도구·표지)', async ({ page }) => {
    await openSpeed(page)
    // 바깥 목록 = 배지 안쪽 목록을 담은 줄 목록
    const rows = await badges(page).first().evaluate((btn) => {
      const outerItem = btn.closest('li')!.parentElement!.closest('li')!
      const outer = outerItem.parentElement!
      return {
        tag: outer.tagName,
        role: outer.getAttribute('role'),
        speeds: [...outer.children].map((li) => [...li.querySelectorAll<HTMLElement>('[data-testid="speed-badge"]')].map((b) => Number(b.dataset.speed))),
      }
    })
    expect(['UL', 'OL'].includes(rows.tag) || rows.role === 'list').toBe(true)
    const rowSpeeds = rows.speeds.filter((s) => s.length > 0)
    for (const s of rowSpeeds) expect(new Set(s).size).toBe(1)
    const order = rowSpeeds.map((s) => s[0])
    expect(order).toEqual([...order].sort((a, b) => b - a))

    const outerList = badges(page).first().locator('xpath=ancestor::li[2]/..')
    const snapshot = await outerList.ariaSnapshot()
    expect(snapshot).toMatch(/내 스피드 \d+/)

    // 배지 접근 이름
    const names = await badges(page).evaluateAll((els) =>
      els.map((el) => ({
        name: el.getAttribute('aria-label') ?? '',
        condition: (el as HTMLElement).dataset.condition ?? '',
        status: (el as HTMLElement).dataset.status ?? '',
        hasItem: el.querySelector('.item-mark') !== null,
        origin: (el as HTMLElement).dataset.origin ?? '',
      })),
    )
    expect(names.length).toBeGreaterThan(30)
    for (const b of names) {
      expect(b.name).toMatch(BUNDLE)
      expect(b.name).not.toMatch(/[↑↓]/)
      expect(b.name).toMatch(/실수치 \d+/)
      expect(b.name).toMatch(/^[^\s,]+/)
      if (b.status !== 'neutral') expect(b.name).toMatch(/추월|동속|추월당함/)
      if (b.hasItem) expect(b.name).toMatch(/지님/)
    }
    const tagged = (kind: string, re: RegExp) => {
      const hit = names.filter((b) => b.condition === kind)
      expect(hit.length, `${kind} 조건 배지`).toBeGreaterThan(0)
      for (const b of hit) expect(b.name).toMatch(re)
    }
    tagged('rank', /\+\d/)
    tagged('scarf', /스카프/)
    tagged('tailwind', /순풍/)
    // 배지에 이름 글자는 없고, 이름 첫 덩어리는 툴팁(title)의 한국어 종 이름과 같다
    const titled = await badges(page).evaluateAll((els) =>
      els.map((el) => ({ title: el.getAttribute('title') ?? '', name: el.getAttribute('aria-label') ?? '', text: el.querySelector('.speed-badge-text')?.textContent ?? '' })),
    )
    for (const b of titled) {
      expect(b.title, b.name).not.toBe('')
      expect(b.name.startsWith(`${b.title} `), b.name).toBe(true)
      expect(b.text, b.name).not.toContain(b.title)
    }
    const first = badges(page).first()

    // "추가" 표지: 상세의 다른 배분 추가
    await first.click()
    const detail = page.getByTestId('speed-detail')
    await expect(detail).toBeVisible()
    await detail.getByTestId('speed-add-toggle').click()
    await detail.getByTestId('speed-add-option').and(page.locator(':enabled')).first().click()
    const added = page.locator('[data-testid="speed-badge"][data-origin="added"]')
    await expect(added).toHaveCount(1)
    await expect(added).toHaveAccessibleName(/추가/)
  })

  test('"프리셋 n" 표지: 목록 밖 타겟 배지 이름에 프리셋 번호가 들어간다', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await addCustomTarget(page, '워시로토무', ['하이드로펌프'])
    await selectTab(page, '스피드')
    const preset = page.locator('[data-testid="speed-badge"][data-origin="preset"]')
    await expect(preset).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(preset.nth(i)).toHaveAccessibleName(/프리셋 [1-3]/)
    const marks = await preset.evaluateAll((els) => els.map((el) => /프리셋 ([1-3])/.exec(el.getAttribute('aria-label') ?? '')?.[1]).sort())
    expect(marks).toEqual(['1', '2', '3'])
  })

  test('알림 영역: 확정 내 스피드만 알린다(드래그 중에는 그대로, SP 확정·내 순풍 뒤 새 실수치, 필터 변경은 알리지 않음)', async ({ page }) => {
    await openSpeed(page, false)
    const live = liveRegion(page)
    await expect(live).toHaveCount(1)
    await live.evaluate((el) => {
      const w = window as unknown as { __live: { t: number; text: string }[]; __ups: number[] }
      w.__live = []
      w.__ups = []
      new MutationObserver(() => w.__live.push({ t: performance.now(), text: el.textContent ?? '' })).observe(el, { subtree: true, childList: true, characterData: true })
      window.addEventListener('pointerup', () => w.__ups.push(performance.now()), true)
    })
    const read = () => page.evaluate(() => (window as unknown as { __live: { t: number; text: string }[] }).__live)
    const expectLive = async () => {
      await expect(live).toHaveText(`내 스피드 ${await bandSpeed(page)}`)
      await expect(live).not.toContainText(/추월|동속/)
    }
    await expectLive()

    // SP 확정: 실수치가 바뀌는 큰 이동
    const slider = mySet(page).getByRole('slider', { name: 'SP 스피드', exact: true })
    const from = Number(await slider.inputValue())
    const to = from >= 16 ? from - 20 : from + 16
    const before = await live.textContent()
    expect(await dragSlider(page, slider, to)).toBe(to)
    const upAt = await page.evaluate(() => (window as unknown as { __ups: number[] }).__ups.at(-1)!)
    await expectLive()
    const changes = await read()
    expect(changes.length).toBeGreaterThan(0)
    // performance.now()는 100µs 단위로 거칠게 맞춰지고 지터가 있어 같은 순간의 두 기록이 0.1ms 앞뒤로 뒤집힐 수 있다.
    for (const c of changes) expect(c.t, `드래그 중 알림 갱신: ${c.text}`).toBeGreaterThanOrEqual(upAt - 1)
    await expect(live).not.toHaveText(before ?? '')

    // 필터 변경(순풍 켬 → 배지가 늘어도 내 스피드는 그대로라 알림이 바뀌지 않는다)
    const n0 = (await read()).length
    const beforeFilter = await live.textContent()
    await chip(page, 'tailwind').click()
    await expect(page.locator('[data-testid="speed-badge"][data-condition="tailwind"]').first()).toBeVisible()
    await expectLive()
    await expect(live).toHaveText(beforeFilter ?? '')
    expect((await read()).slice(n0).every((c) => c.text === beforeFilter), '필터 변경으로 알림 글자가 바뀌지 않음').toBe(true)

    // 내 순풍 칩은 기준선을 옮겨(×2) 새 실수치를 알린다
    const n1 = (await read()).length
    await chip(page, 'my-tailwind').click()
    await expectLive()
    await expect(live).not.toHaveText(beforeFilter ?? '')
    expect((await read()).length).toBeGreaterThan(n1)
  })

  test('키보드: 로빙 자리의 컷 고정 핀 → 배지로 들어가고 Tab 한 번으로 나감, 화살표·Home/End, 기준선은 건너뜀, Enter/Esc, 키보드로 추가·삭제', async ({ page }) => {
    await openSpeed(page)
    await expect(badges(page).and(page.locator('[tabindex="0"]'))).toHaveCount(1)
    await expect(page.locator('.speed-badge-item [data-testid="cut-pin"][tabindex="0"]')).toHaveCount(1)
    // 차트 머리 마지막 칩에서 Tab → 로빙 자리 배지 앞 핀 → 배지, 다시 Tab 한 번 → 배지 밖
    await chip(page, 'my-tailwind').focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('.speed-badge-item [data-testid="cut-pin"]:focus')).toHaveCount(1)
    await page.keyboard.press('Tab')
    const entered = await activeBadge(page)
    expect(entered).not.toBeNull()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    expect(await activeBadge(page)).toBeNull()
    await page.keyboard.press('Shift+Tab')
    expect((await activeBadge(page))?.id).toBe(entered!.id)

    // Home = 가장 빠른 배지, End = 가장 느린 배지
    const speeds = await badges(page).evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.speed)))
    await page.keyboard.press('Home')
    expect((await activeBadge(page))?.speed).toBe(Math.max(...speeds))
    // 위에서 아래로: ArrowDown은 늘 더 느린 줄, 배지 밖(기준선 항목 등)으로 가지 않는다
    const rowsSeen = new Set<number>()
    let prev = Math.max(...speeds)
    rowsSeen.add(prev)
    for (let i = 0; i < new Set(speeds).size + 2; i++) {
      await page.keyboard.press('ArrowDown')
      const a = await activeBadge(page)
      expect(a, '포커스가 배지 밖으로 나갔다(기준선 구분 항목 등)').not.toBeNull()
      expect(a!.speed).toBeLessThanOrEqual(prev)
      prev = a!.speed
      rowsSeen.add(a!.speed)
    }
    await page.keyboard.press('End')
    expect((await activeBadge(page))?.speed).toBe(Math.min(...speeds))
    // ArrowUp은 더 빠른 줄
    await page.keyboard.press('ArrowUp')
    expect((await activeBadge(page))!.speed).toBeGreaterThan(Math.min(...speeds))
    // 같은 줄 좌우: 배지가 둘 이상인 줄을 찾아 오른쪽 → 같은 실수치, 왼쪽 → 원래 배지
    const multi = await badges(page).evaluateAll((els) => {
      const by = new Map<number, string[]>()
      for (const e of els) {
        const s = Number((e as HTMLElement).dataset.speed)
        by.set(s, [...(by.get(s) ?? []), (e as HTMLElement).dataset.badgeId ?? ''])
      }
      return [...by.values()].find((ids) => ids.length > 1) ?? null
    })
    expect(multi, '배지가 둘 이상인 줄').not.toBeNull()
    await page.keyboard.press('Home')
    for (let i = 0; i < 200 && (await activeBadge(page))?.id !== multi![0]; i++) await page.keyboard.press(i % 2 === 0 ? 'ArrowDown' : 'ArrowRight')
    expect((await activeBadge(page))?.id).toBe(multi![0])
    await page.keyboard.press('ArrowRight')
    expect((await activeBadge(page))?.id).toBe(multi![1])
    await page.keyboard.press('ArrowLeft')
    expect((await activeBadge(page))?.id).toBe(multi![0])
    // 기준선 구분 항목은 포커스 대상이 아니다
    const baselineFocusable = await page.evaluate(() =>
      [...document.querySelectorAll('li')]
        .filter((li) => /내 스피드 \d+/.test((li.getAttribute('aria-label') ?? '') + (li.textContent ?? '')) && li.querySelector('[data-testid="speed-badge"]') === null)
        .some((li) => li.matches('[tabindex]') || li.querySelector('[tabindex]:not([tabindex="-1"]), button, a[href], input') !== null),
    )
    expect(baselineFocusable).toBe(false)

    // 포커스·화살표 이동만으로는 상세가 열리지 않는다. Enter/Space로 여닫고 Esc로 닫는다(포커스는 배지에 남는다)
    const focused = page.locator('[data-testid="speed-badge"]:focus')
    const panel = page.getByTestId('speed-detail')
    await expect(panel).toHaveCount(0)
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(focused).toHaveAttribute('aria-expanded', 'true')
    await expect(panel).toHaveAttribute('data-badge-id', (await focused.getAttribute('data-badge-id'))!)
    await page.keyboard.press('Enter')
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toHaveCount(0)
    await page.keyboard.press(' ')
    await expect(focused).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press(' ')
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press(' ')
    await expect(focused).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toHaveCount(0)
    // 열린 채 화살표로 옮겨도 상세는 그 자리(전환은 Enter/Space)
    await page.keyboard.press('Enter')
    const openedId = (await focused.getAttribute('data-badge-id'))!
    await page.keyboard.press('Home')
    await expect(panel).toHaveAttribute('data-badge-id', openedId)
    // 상세 안에서 Esc → 닫히고 포커스는 연 배지로
    await tabUntil(page, 'speed-add-toggle')
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    expect((await activeBadge(page))?.id).toBe(openedId)

    // 키보드로 추가: 래더 배지 상세 → "다른 배분 추가" → 첫 선택 가능 묶음
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('speed-detail')).toBeVisible()
    const live = liveRegion(page)
    const liveBefore = await live.textContent()
    await tabUntil(page, 'speed-add-toggle')
    await page.keyboard.press('Enter')
    // 직접 입력 성격 보정 ▲▼: Space로 켜고 끄며, 하나를 켜면 다른 하나는 꺼진다(둘 다 꺼짐 = 무보정)
    const natPlus = panel.getByTestId('speed-add-nat-plus')
    const natMinus = panel.getByTestId('speed-add-nat-minus')
    await tabUntil(page, 'speed-add-nat-plus', 80)
    await page.keyboard.press(' ')
    await expect(natPlus).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Tab')
    await expect(natMinus).toBeFocused()
    await page.keyboard.press(' ')
    await expect(natMinus).toHaveAttribute('aria-pressed', 'true')
    await expect(natPlus).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press(' ')
    await expect(natMinus).toHaveAttribute('aria-pressed', 'false')
    await panel.getByTestId('speed-add-option').and(page.locator(':enabled')).first().focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await activeBadge(page))?.origin).toBe('added')
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"]')).toHaveCount(1)
    // 추가해도 내 스피드는 그대로라 알림은 같은 글자
    await expect(live).toHaveText(LIVE)
    await expect(live).toHaveText(liveBefore ?? '')

    // 키보드로 삭제: 추가 배지 상세 → "이 배지 지우기" → 포커스는 이웃 배지
    await expect(page.getByTestId('speed-detail')).toBeVisible()
    const afterAdd = await live.textContent()
    await tabUntil(page, 'speed-remove')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"]')).toHaveCount(0)
    await expect.poll(async () => (await activeBadge(page)) !== null).toBe(true)
    await expect(live).toHaveText(afterAdd ?? '')
  })
})

// ---------- 대비 ----------

interface ContrastSample {
  kind: string
  text: string
  ratio: number
  fg: string
  bg: string
}

/** 글자 색과 그 뒤 실제 배경(조상 배경색 합성)의 대비. 그라데이션 배경은 그 요소의 배경색으로 본다 */
async function measureContrast(page: Page, selectors: { kind: string; sel: string }[]): Promise<ContrastSample[]> {
  return page.evaluate((list) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2], d[3] / 255]
    }
    const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]))
    const backdrop = (el: Element | null): number[] => {
      const layers: [number, number, number, number][] = []
      for (let p = el; p; p = p.parentElement) {
        const c = rgba(getComputedStyle(p).backgroundColor)
        if (c[3] > 0) layers.push(c)
        if (c[3] >= 1) break
      }
      const dark = matchMedia('(prefers-color-scheme: dark)').matches
      let base = dark ? [18, 18, 18] : [255, 255, 255]
      for (const l of layers.reverse()) base = over(l, base)
      return base
    }
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
    }
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
      return (x + 0.05) / (y + 0.05)
    }
    const out: ContrastSample[] = []
    for (const { kind, sel } of list) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const bg = backdrop(el)
        const fg = over(rgba(getComputedStyle(el).color), bg)
        out.push({ kind, text: (el.textContent ?? '').trim().slice(0, 12), ratio: ratio(fg, bg), fg: `${fg.map(Math.round)}`, bg: `${bg.map(Math.round)}` })
      }
    }
    return out
  }, selectors)
}

const TAG_SELECTORS = [
  { kind: '조건 태그', sel: '[data-testid="speed-badge"] .speed-tag' },
  { kind: '표지', sel: '[data-testid="speed-badge"] .speed-mark' },
  { kind: '상세 머리', sel: '[data-testid="speed-detail"] .speed-detail-title > b' },
]

interface ItemMarkSample {
  item: string
  role: string
  /** 도구 아이콘 한 변(px) */
  size: number
  /** 같은 줄 포켓몬 이미지와 겹치는 면적(px²). 0이어야 한다 */
  overlap: number
  /** 기준 글자(배지·상세 = 배분 표기, 카드 = 포켓몬 이름) 오른쪽이고 세로로 같은 줄 */
  rightOfText: boolean
  /** 받침·테두리 없음(테두리 두께 0, 배경 투명) */
  bare: boolean
  /** 뷰포트 안이면 그림이 실제로 그려짐(이미지는 로드 완료·자연 너비 > 0) */
  inView: boolean
  painted: boolean
}

/** 도구 아이콘(.item-mark) 기하: 포켓몬 이미지와 겹치지 않고 기준 글자 오른쪽에 나란히, 받침 없음, 그림 그려짐 */
async function measureItemMarks(page: Page): Promise<ItemMarkSample[]> {
  return page.evaluate(() => {
    const out: ItemMarkSample[] = []
    for (const el of document.querySelectorAll<HTMLElement>('.item-mark')) {
      // 헤더 파티 칸의 도구 아이콘은 칸 오른쪽 아래에 겹쳐 붙이는 다른 규칙(party-pokepaste R3)
      if (el.closest('[data-testid="party-bar"]')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const scope = el.closest('.speed-badge, .card-who, .detail-item, .speed-detail-head, .speed-unsupported li') ?? el.parentElement!
      const mon = scope.querySelector('[data-testid="mon-icon"]')?.getBoundingClientRect()
      const overlap = mon === undefined ? 0 : Math.max(0, Math.min(r.right, mon.right) - Math.max(r.left, mon.left)) * Math.max(0, Math.min(r.bottom, mon.bottom) - Math.max(r.top, mon.top))
      // 기준 글자: 배지·상세 머리는 배분 표기, 카드 이름 칸은 그 칸의 첫 글자 노드, 그 밖은 포켓몬 이미지
      let anchor: DOMRect | undefined
      // 구간 경계 표지(speed-reach-band)의 구애스카프 아이콘은 "S32"·"S32↑" 글자 오른쪽
      const text =
        el.closest('.speed-badge')?.querySelector('.speed-badge-text .num') ??
        el.closest('.speed-detail-bundle')?.querySelector('.bundle-mark') ??
        el.closest('[data-testid="speed-threshold-mark"]')?.querySelector('.speed-threshold-text')
      if (text) anchor = text.getBoundingClientRect()
      else if (el.closest('.card-name')) {
        const range = document.createRange()
        range.selectNodeContents(el.closest('.card-name')!)
        range.setEndBefore(el)
        anchor = range.getBoundingClientRect()
      } else anchor = mon
      const cy = r.top + r.height / 2
      const rightOfText = anchor !== undefined && r.left >= anchor.right - 0.5 && cy >= anchor.top - 2 && cy <= anchor.bottom + 2
      const cs = getComputedStyle(el)
      const face = el.querySelector('.item-mark-face')
      const fr = face?.getBoundingClientRect()
      const transparent = cs.backgroundColor === 'transparent' || /rgba\(.*,\s*0\)$/.test(cs.backgroundColor)
      const inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      const img = face instanceof HTMLImageElement ? face : null
      out.push({
        item: el.dataset.itemId ?? '',
        role: el.dataset.itemRole ?? '',
        size: r.width,
        overlap,
        rightOfText,
        bare: parseFloat(cs.borderTopWidth) === 0 && transparent && cs.backgroundImage === 'none',
        inView,
        painted: fr !== undefined && fr.width > 0 && fr.height > 0 && (img === null || (img.complete && img.naturalWidth > 0)),
      })
    }
    return out
  })
}

async function checkItemMarks(page: Page, scope: string) {
  // 지연 로드 이미지: 뷰포트 안 아이콘이 모두 그려질 때까지 기다린다
  await expect.poll(async () => (await measureItemMarks(page)).filter((o) => o.inView && !o.painted).map((o) => o.item)).toEqual([])
  const xs = await measureItemMarks(page)
  test.info().annotations.push({ type: 'item-mark', description: `${scope} 도구 아이콘 ${xs.length}개 크기 ${Math.min(...xs.map((o) => o.size))}~${Math.max(...xs.map((o) => o.size))}px` })
  expect(xs.length, `${scope} 도구 아이콘 표본`).toBeGreaterThan(0)
  expect(xs.some((o) => o.inView && o.painted), `${scope} 뷰포트 안 아이콘 그림`).toBe(true)
  await expect(page.locator('.mon-with-item, .mon-item')).toHaveCount(0)
  for (const o of xs) {
    const at = `${scope} ${o.role}:${o.item}`
    // 이름 옆 아이콘 크기 수준(22px, 펼친 상세 머리만 28px)
    expect.soft(o.size, at).toBeGreaterThanOrEqual(21)
    expect.soft(o.size, at).toBeLessThanOrEqual(29)
    expect.soft(o.overlap, `${at} 포켓몬 이미지와 겹치지 않음`).toBe(0)
    expect.soft(o.rightOfText, `${at} 기준 글자 오른쪽 같은 줄`).toBe(true)
    expect.soft(o.bare, `${at} 받침·테두리 없음`).toBe(true)
    if (o.inView) expect.soft(o.painted, `${at} 그림 그려짐`).toBe(true)
  }
}

function summarizeContrast(samples: ContrastSample[]) {
  const by = new Map<string, ContrastSample[]>()
  for (const s of samples) by.set(s.kind, [...(by.get(s.kind) ?? []), s])
  return [...by].map(([kind, xs]) => {
    const worst = xs.reduce((w, s) => (s.ratio < w.ratio ? s : w))
    return `${kind} ${xs.length}개 최저 ${worst.ratio.toFixed(2)}:1(${worst.text} fg ${worst.fg} / bg ${worst.bg})`
  })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`대비·겹침(${scheme}): 상태 면 위 상세 머리·조건 태그 글자 4.5:1 이상, 도구 아이콘은 받침 없이 포켓몬 이미지와 겹치지 않고 글자 오른쪽(스피드·공격·방어)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openSpeed(page)
    // 추가 표지와 상세 머리(상태 색 면)까지 화면에 올린다
    await badges(page).first().click()
    const detail = page.getByTestId('speed-detail')
    await detail.getByTestId('speed-add-toggle').click()
    await detail.getByTestId('speed-add-option').and(page.locator(':enabled')).first().click()
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"]')).toHaveCount(1)
    const speed = await measureContrast(page, TAG_SELECTORS)
    for (const kind of ['조건 태그', '상세 머리']) expect(speed.some((s) => s.kind === kind), `${kind} 표본`).toBe(true)
    await checkItemMarks(page, '스피드')

    // 방어 탭 화력 도구 줄(대도각참 생명의구슬), 공격 탭 반감열매 줄(대도각참 → 대쓰여너 마코열매)
    await selectTab(page, '방어')
    await waitComplete(page)
    await checkItemMarks(page, '방어')
    await selectTab(page, '공격')
    const species = combo(mySet(page), '종')
    await species.fill('대도각참')
    await species.press('Enter')
    await expect(species).toHaveValue('대도각참')
    await waitComplete(page)
    await expect(page.getByRole('tabpanel').getByTestId('berry-badge').first()).toBeVisible()
    await checkItemMarks(page, '공격')

    const lines = summarizeContrast(speed)
    for (const l of lines) {
      console.log(`[speed-chart-a11y] ${scheme} ${l}`)
      test.info().annotations.push({ type: 'contrast', description: `${scheme} ${l}` })
    }
    for (const s of speed) expect.soft(s.ratio, `${scheme} ${s.kind} "${s.text}" fg ${s.fg} bg ${s.bg}`).toBeGreaterThanOrEqual(4.5)
  })
}

// ---------- 배경색 구간·오른쪽 경계 표지 접근성(speed-reach-band PRD AC12·AC13, 2026-11-24 세 번째 개정) ----------

const outerList = (page: Page) => page.getByTestId('speed-frame').getByRole('list', { name: '스피드 실수치 내림차순' })

async function setMySpeedSp(page: Page, sp: number) {
  const box = mySet(page).getByRole('spinbutton', { name: 'SP 스피드 숫자', exact: true })
  await box.fill(String(sp))
  await expect(box).toHaveValue(String(sp))
  await expect(page.getByTestId('speed-frame').getByTestId('speed-threshold-mark')).toHaveCount(sp === 32 ? 4 : 5)
}

// 네 구간 면 위의 경계 표지 글자·실수치 글자(띠 위 표지는 보이지 않는다)
const ZONES = ['base', 'basePlus', 'scarf', 'scarfPlus'] as const
const ZONE_CONTRAST = ZONES.flatMap((z) => [
  { kind: `경계 표지(${z})`, sel: `[data-testid="speed-frame"] li.speed-zone[data-zone="${z}"] .speed-threshold-text` },
  { kind: `실수치(${z})`, sel: `[data-testid="speed-frame"] li.speed-zone[data-zone="${z}"] > .speed-row-speed` },
])

/** 읽기 문구 기대값 */
const MARK_SPOKEN: Record<string, string> = {
  floor: 'S0 성격 무보정 최소',
  max: 'S32 성격 무보정 최대',
  maxPlus: 'S32 성격 상승 최대',
  scarfMax: '구애스카프 S32 성격 무보정 최대',
  scarfMaxPlus: '구애스카프 S32 성격 상승 최대',
}
const ZONE_SPOKEN: Record<string, string> = {
  base: 'S0~S32 무보정 구간',
  basePlus: 'S32 성격 상승 구간',
  scarf: '구애스카프 S32 무보정 구간',
  scarfPlus: '구애스카프 S32 성격 상승 구간',
}

test.describe('배경색 구간·경계 표지 접근성(speed-reach-band)', () => {
  test('AC12: 경계 표지는 목록 항목 안에서 "기준: …"으로 읽히고, 구간 배지 줄만 구간 읽기 설명을 가지며, 배지 없는 경계 줄은 포커스되지 않는다', async ({ page }) => {
    await openSpeed(page)
    // 예시 세트(S32 무보정): S32 경계는 띠에 합쳐지고, 보이는 표지 없이 "S32 성격 무보정 최대와 같음"으로만 읽힌다
    const bandEl = page.getByTestId('speed-baseline')
    await expect(bandEl).toHaveAttribute('data-mark', 'max')
    expect(await outerList(page).ariaSnapshot()).toMatch(/내 스피드 \d+[^\n]*S32 성격 무보정 최대와 같음/)
    await expect(bandEl.getByTestId('speed-baseline-mark')).toHaveClass(/(^|\s)sr-only(\s|$)/)
    await expect(bandEl.getByTestId('speed-threshold-mark')).toHaveCount(0)

    await setMySpeedSp(page, 10)
    const snap = await outerList(page).ariaSnapshot()
    // 다섯 경계가 위에서 아래로(스카프 S32↑ → 스카프 S32 → S32↑ → S32 → 띠 → S0) 읽힌다. 화살표 글자는 읽기에서 숨는다
    const order = ['scarfMaxPlus', 'scarfMax', 'maxPlus', 'max'].map((k) => snap.indexOf(`기준: ${MARK_SPOKEN[k]}`))
    for (const i of order) expect(i, snap.slice(0, 400)).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1])
    const bandAt = snap.search(/내 스피드 \d+/)
    expect(order[3]).toBeLessThan(bandAt)
    expect(snap.indexOf(`기준: ${MARK_SPOKEN.floor}`)).toBeGreaterThan(bandAt)
    expect(snap).not.toMatch(/S32↑/)
    // 표지는 바깥 목록의 항목 안
    expect(
      await page
        .locator('[data-testid="speed-threshold-mark"]')
        .evaluateAll((els) => els.every((m) => m.closest('li')!.parentElement!.getAttribute('aria-label') === '스피드 실수치 내림차순')),
    ).toBe(true)

    // 구간 읽기 설명: 배지가 있는 구간 줄에만, 그 구간 문구
    const rows = await page.getByTestId('speed-frame').locator('li[data-speed]').evaluateAll((els) =>
      els.map((e) => ({
        speed: Number((e as HTMLElement).dataset.speed),
        zone: (e as HTMLElement).dataset.zone ?? null,
        badge: e.querySelector('[data-testid="speed-badge"]') !== null,
        desc: e.querySelector('[data-testid="speed-zone-desc"]')?.textContent ?? null,
      })),
    )
    const seen = new Set<string>()
    for (const r of rows) {
      if (r.zone === null || !r.badge) expect(r.desc, `${r.speed}`).toBeNull()
      else {
        expect(r.desc, `${r.speed}`).toBe(`, ${ZONE_SPOKEN[r.zone]}`)
        seen.add(r.zone)
      }
    }
    expect([...seen].sort()).toEqual([...ZONES].sort())

    // 배지 없는 경계 줄: 선택 필터로 한 종(포푸니크)만 두면 경계 실수치에 상대 줄이 없어 따로 낀다
    const pick = combo(page.getByTestId('tool-row-search'), '포켓몬 찾기')
    await pick.fill('포푸니크')
    await pick.press('Enter')
    const lone = page.locator('li.speed-threshold')
    await expect(lone).toHaveCount(5)
    const alone = await outerList(page).ariaSnapshot()
    for (const k of Object.keys(MARK_SPOKEN)) expect(alone).toMatch(new RegExp(`- listitem: "?\\d+ 기준: ${MARK_SPOKEN[k]}"?$`, 'm'))
    await expect(lone.getByTestId('speed-zone-desc')).toHaveCount(0)
    expect(await lone.evaluateAll((els) => els.some((li) => li.matches('[tabindex]') || li.querySelector('[tabindex], button, a[href], input') !== null))).toBe(false)
    const around = await page.getByTestId('speed-frame').evaluate((f) => {
      const c = f.querySelector<HTMLElement>('li.speed-threshold[data-mark="maxPlus"]')!
      let up = c.previousElementSibling as HTMLElement | null
      while (up && up.querySelector('[data-testid="speed-badge"]') === null) up = up.previousElementSibling as HTMLElement | null
      let down = c.nextElementSibling as HTMLElement | null
      while (down && down.querySelector('[data-testid="speed-badge"]') === null) down = down.nextElementSibling as HTMLElement | null
      return { up: up?.querySelector<HTMLElement>('[data-testid="speed-badge"]')?.dataset.badgeId ?? null, downSpeed: Number(down?.dataset.speed ?? NaN), at: Number(c.dataset.speed) }
    })
    expect(around.up).not.toBeNull()
    expect(around.downSpeed).toBeLessThan(around.at)
    await page.locator(`[data-testid="speed-badge"][data-badge-id='${around.up}']`).focus()
    await page.keyboard.press('ArrowDown')
    expect((await activeBadge(page))?.speed).toBe(around.downSpeed)
    await page.keyboard.press('ArrowUp')
    expect((await activeBadge(page))?.id).toBe(around.up)
    await expect(liveRegion(page)).toHaveText(LIVE)
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`AC13(${scheme}): 네 구간 면 위 경계 표지·실수치 글자 4.5:1 이상, 구간 색은 서로 다르고 기준선 띠보다 옅다, 알림 영역 "내 스피드 N" 그대로`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openSpeed(page)
      await setMySpeedSp(page, 10)
      const rows = await measureContrast(page, ZONE_CONTRAST)
      const pick = combo(page.getByTestId('tool-row-search'), '포켓몬 찾기')
      await pick.fill('포푸니크')
      await pick.press('Enter')
      await expect(page.locator('li.speed-threshold')).toHaveCount(5)
      const alone = await measureContrast(page, ZONE_CONTRAST)
      const all = [...rows, ...alone]
      for (const kind of ZONE_CONTRAST.map((c) => c.kind)) expect(all.some((s) => s.kind === kind), `${kind} 표본`).toBe(true)
      for (const l of summarizeContrast(all)) test.info().annotations.push({ type: 'contrast', description: `${scheme} ${l}` })
      for (const s of all) expect.soft(s.ratio, `${scheme} ${s.kind} "${s.text}" fg ${s.fg} bg ${s.bg}`).toBeGreaterThanOrEqual(4.5)
      // 구간 색은 서로 다르고, 카드 바탕과의 색 거리는 기준선 띠가 가장 크다(띠가 가장 진하다)
      const dist = await page.getByTestId('speed-frame').evaluate((f) => {
        const rgb = (el: Element) => getComputedStyle(el).backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number)
        let card: number[] = []
        for (let p: Element | null = f; p; p = p.parentElement) {
          const c = getComputedStyle(p).backgroundColor
          if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
            card = rgb(p)
            break
          }
        }
        const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        const zones = ['base', 'basePlus', 'scarf', 'scarfPlus'].map((z) => rgb(f.querySelector(`.speed-zone[data-zone="${z}"]`)!))
        return { band: d(rgb(f.querySelector('[data-testid="speed-baseline"]')!), card), zones: zones.map((z) => d(z, card)), keys: zones.map((z) => z.join(',')) }
      })
      expect(new Set(dist.keys).size).toBe(4)
      for (const z of dist.zones) {
        expect(z).toBeGreaterThan(0)
        expect(dist.band).toBeGreaterThan(z)
      }
      // 같은 색 계열에서 진한 쪽이 카드 바탕과 더 멀다
      expect(dist.zones[1]).toBeGreaterThan(dist.zones[0])
      expect(dist.zones[3]).toBeGreaterThan(dist.zones[2])
      await expect(liveRegion(page)).toHaveText(LIVE)
    })
  }
})
