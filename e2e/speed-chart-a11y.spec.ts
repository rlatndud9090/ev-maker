import { expect, test, type Locator, type Page } from '@playwright/test'
import { combo, dragSlider, mySet, openProduct, region, selectTab, waitComplete } from './helpers'

// 스피드 차트 접근성: 접근성 트리(목록·기준선 구분 항목·배지 접근 이름), 알림 영역 갱신 시점, 키보드 탐색, 태그 글자·겹침 받침 대비.

const badges = (page: Page) => page.getByTestId('speed-badge')
const chip = (page: Page, filter: string) => page.locator(`[data-testid="speed-head"] [data-filter="${filter}"]`)
const SPEED_FILTERS = ['rank', 'scarf', 'tailwind', 'field'] as const
const SUMMARY = /추월 (\d+) · 동속 (\d+) · 추월당함 (\d+)/
const BUNDLE = /S\d+(\+| =| −)/

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

/** 스피드 탭 요약 알림 영역(상세의 "이미 있음" 안내는 뺀다) */
function liveRegion(page: Page): Locator {
  return page
    .getByRole('tabpanel')
    .locator('[role="status"], [aria-live]')
    .and(page.locator(':not([data-testid="speed-add-msg"])'))
}

/** 화면에 보이는 배지의 상태 개수(배지 id 기준 중복 없이) */
async function statusCounts(page: Page) {
  return badges(page).evaluateAll((els) => {
    const seen = new Map<string, string>()
    for (const el of els) seen.set((el as HTMLElement).dataset.badgeId ?? '', (el as HTMLElement).dataset.status ?? '')
    const n = (s: string) => [...seen.values()].filter((v) => v === s).length
    return { outspeeds: n('outspeeds'), tie: n('tie'), outsped: n('outsped') }
  })
}

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
        hasItem: el.querySelector('.mon-item') !== null,
        origin: (el as HTMLElement).dataset.origin ?? '',
      })),
    )
    expect(names.length).toBeGreaterThan(30)
    for (const b of names) {
      expect(b.name).toMatch(BUNDLE)
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
    // 이름 첫 덩어리는 화면의 한국어 종 이름과 같다
    const first = badges(page).first()
    const shown = await first.locator('.speed-badge-name').textContent()
    if (shown) await expect(first).toHaveAccessibleName(new RegExp(`^${shown}`))

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
    await page.getByRole('button', { name: '포켓몬 추가', exact: true }).click()
    const panel = region(page, '목록 밖 포켓몬 추가')
    await combo(panel, '추가할 포켓몬').fill('워시로토무')
    await combo(panel, '추가할 포켓몬').press('Enter')
    const group = panel.getByRole('group', { name: /^기술/ })
    await combo(group, '기술 검색').fill('하이드로펌프')
    await group.getByRole('checkbox', { name: '하이드로펌프', exact: true }).check()
    await panel.getByRole('button', { name: '추가', exact: true }).click()
    await selectTab(page, '스피드')
    const preset = page.locator('[data-testid="speed-badge"][data-origin="preset"]')
    await expect(preset).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(preset.nth(i)).toHaveAccessibleName(/프리셋 [1-3]/)
    const marks = await preset.evaluateAll((els) => els.map((el) => /프리셋 ([1-3])/.exec(el.getAttribute('aria-label') ?? '')?.[1]).sort())
    expect(marks).toEqual(['1', '2', '3'])
  })

  test('알림 영역: 드래그 중에는 그대로, SP 확정·필터 변경·추가·삭제 뒤에 요약으로 갱신', async ({ page }) => {
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
    const expectSummary = async () => {
      const c = await statusCounts(page)
      await expect(live).toHaveText(new RegExp(`추월 ${c.outspeeds} · 동속 ${c.tie} · 추월당함 ${c.outsped}`))
    }

    // SP 확정: S 32 → 12(요약이 바뀌는 큰 이동)
    const slider = mySet(page).getByRole('slider', { name: 'SP 스피드', exact: true })
    const from = Number(await slider.inputValue())
    const to = from >= 16 ? from - 20 : from + 16
    const before = await statusCounts(page)
    expect(await dragSlider(page, slider, to)).toBe(to)
    const upAt = await page.evaluate(() => (window as unknown as { __ups: number[] }).__ups.at(-1)!)
    await expectSummary()
    const changes = await read()
    expect(changes.length).toBeGreaterThan(0)
    for (const c of changes) expect(c.t, `드래그 중 알림 갱신: ${c.text}`).toBeGreaterThanOrEqual(upAt)
    expect(await statusCounts(page)).not.toEqual(before)

    // 필터 변경(순풍 켬 → 배지가 늘어 요약이 바뀐다)
    const n0 = (await read()).length
    await chip(page, 'tailwind').click()
    await expectSummary()
    expect((await read()).length).toBeGreaterThan(n0)

    // 내 순풍 칩도 기준선을 옮긴다
    const n1 = (await read()).length
    await chip(page, 'my-tailwind').click()
    await expectSummary()
    expect((await read()).length).toBeGreaterThan(n1)
  })

  test('키보드: Tab 한 번으로 들어가고 나감, 화살표·Home/End, 기준선은 건너뜀, Enter/Esc, 키보드로 추가·삭제', async ({ page }) => {
    await openSpeed(page)
    await expect(badges(page).and(page.locator('[tabindex="0"]'))).toHaveCount(1)
    // 차트 머리 마지막 칩에서 Tab 한 번 → 배지, 다시 Tab 한 번 → 배지 밖
    await chip(page, 'my-tailwind').focus()
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

    // Enter 열기 · Esc 닫기 (포커스는 배지에 남는다)
    const focused = page.locator('[data-testid="speed-badge"]:focus')
    await page.keyboard.press('Escape')
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(focused).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press(' ')
    await expect(focused).toHaveAttribute('aria-expanded', 'true')

    // 키보드로 추가: 래더 배지 상세 → "다른 배분 추가" → 첫 선택 가능 묶음
    await page.keyboard.press('Home')
    await expect(page.getByTestId('speed-detail')).toBeVisible()
    const live = liveRegion(page)
    const liveBefore = await live.textContent()
    await tabUntil(page, 'speed-add-toggle')
    await page.keyboard.press('Enter')
    await tabUntil(page, 'speed-add-option')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await activeBadge(page))?.origin).toBe('added')
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"]')).toHaveCount(1)
    await expect(live).toHaveText(SUMMARY)
    await expect(live).not.toHaveText(liveBefore ?? '')

    // 키보드로 삭제: 추가 배지 상세 → "이 배지 지우기" → 포커스는 이웃 배지
    await expect(page.getByTestId('speed-detail')).toBeVisible()
    const afterAdd = await live.textContent()
    await tabUntil(page, 'speed-remove')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"]')).toHaveCount(0)
    await expect.poll(async () => (await activeBadge(page)) !== null).toBe(true)
    await expect(live).not.toHaveText(afterAdd ?? '')
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

/** 글자·받침 테두리 색과 그 뒤 실제 배경(조상 배경색 합성)의 대비. 그라데이션 배경은 그 요소의 배경색으로 본다 */
async function measureContrast(page: Page, selectors: { kind: string; sel: string; prop: 'color' | 'border' }[]): Promise<ContrastSample[]> {
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
    for (const { kind, sel, prop } of list) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const cs = getComputedStyle(el)
        if (prop === 'color') {
          const bg = backdrop(el)
          const fg = over(rgba(cs.color), bg)
          out.push({ kind, text: (el.textContent ?? '').trim().slice(0, 12), ratio: ratio(fg, bg), fg: `${fg.map(Math.round)}`, bg: `${bg.map(Math.round)}` })
        } else {
          // 받침 테두리 vs 상자 바깥 배경(겹침 상자의 부모 배경)
          const bg = backdrop(el.parentElement?.parentElement ?? null)
          const ring = over(rgba(cs.borderTopColor), bg)
          out.push({ kind, text: el.getAttribute('data-item-id') ?? '', ratio: ratio(ring, bg), fg: `${ring.map(Math.round)}`, bg: `${bg.map(Math.round)}` })
        }
      }
    }
    return out
  }, selectors)
}

const TAG_SELECTORS = [
  { kind: '조건 태그', sel: '[data-testid="speed-badge"] .speed-tag', prop: 'color' as const },
  { kind: '표지', sel: '[data-testid="speed-badge"] .speed-mark', prop: 'color' as const },
  { kind: '상태 알약', sel: '[data-testid="speed-detail"] .speed-pill', prop: 'color' as const },
]
const PLATE = (scope: string) => ({ kind: `겹침 받침(${scope})`, sel: '.mon-item', prop: 'border' as const })

function summarizeContrast(samples: ContrastSample[]) {
  const by = new Map<string, ContrastSample[]>()
  for (const s of samples) by.set(s.kind, [...(by.get(s.kind) ?? []), s])
  return [...by].map(([kind, xs]) => {
    const worst = xs.reduce((w, s) => (s.ratio < w.ratio ? s : w))
    return `${kind} ${xs.length}개 최저 ${worst.ratio.toFixed(2)}:1(${worst.text} fg ${worst.fg} / bg ${worst.bg})`
  })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`대비(${scheme}): 상태·조건 태그 글자 4.5:1 이상, 도구 겹침 받침 3:1 이상(스피드·공격·방어)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openSpeed(page)
    // 동속·추가 표지와 상세 상태 알약까지 화면에 올린다
    await badges(page).first().click()
    const detail = page.getByTestId('speed-detail')
    await detail.getByTestId('speed-add-toggle').click()
    await detail.getByTestId('speed-add-option').and(page.locator(':enabled')).first().click()
    await expect(page.locator('[data-testid="speed-badge"][data-origin="added"]')).toHaveCount(1)
    const speed = await measureContrast(page, [...TAG_SELECTORS, PLATE('스피드')])
    for (const kind of ['조건 태그', '상태 알약', '겹침 받침(스피드)']) expect(speed.some((s) => s.kind === kind), `${kind} 표본`).toBe(true)

    // 방어 탭 화력 도구 줄(대도각참 생명의구슬), 공격 탭 반감열매 줄(대도각참 → 대쓰여너 마코열매)
    await selectTab(page, '방어')
    await waitComplete(page)
    const defense = await measureContrast(page, [PLATE('방어')])
    expect(defense.length).toBeGreaterThan(0)
    await selectTab(page, '공격')
    const species = combo(mySet(page), '종')
    await species.fill('대도각참')
    await species.press('Enter')
    await expect(species).toHaveValue('대도각참')
    await waitComplete(page)
    await expect(page.getByRole('tabpanel').getByTestId('berry-badge').first()).toBeVisible()
    const attack = await measureContrast(page, [PLATE('공격')])

    const all = [...speed, ...defense, ...attack]
    const lines = summarizeContrast(all)
    for (const l of lines) {
      console.log(`[speed-chart-a11y] ${scheme} ${l}`)
      test.info().annotations.push({ type: 'contrast', description: `${scheme} ${l}` })
    }
    for (const s of all) {
      const limit = s.kind.startsWith('겹침') ? 3 : 4.5
      expect.soft(s.ratio, `${scheme} ${s.kind} "${s.text}" fg ${s.fg} bg ${s.bg}`).toBeGreaterThanOrEqual(limit)
    }
  })
}
