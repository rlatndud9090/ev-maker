import { expect, test, type Page } from '@playwright/test'
import {
  TAB_ID,
  dragSlider,
  fillMySet,
  lockBadge,
  lockList,
  lockRow,
  mySet,
  openProduct,
  resultTab,
  selectTab,
  settle,
  tabPanel,
  waitComplete,
  type ProductTab,
} from './helpers'

// 반응성: 공격·방어 탭(실행기 계산)과 스피드 차트(동기 배지 모델) 각각 (a) 처음 열기 · (b) 주 능력치 SP 슬라이더 ±4 놓기, 시나리오마다 10회.
const RUNS = 10
const FIRST_CARD_MEDIAN_LIMIT_MS = 500
const COMPLETE_MEDIAN_LIMIT_MS = 5000
const LONG_TASK_LIMIT_MS = 100
const COMPUTE_START_MARK = 'cards:compute-start'

/** 예시 세트(src/app/example.ts) 기준 주 능력치: 공격 탭은 첫 기술 지진이 참조하는 A, 방어 H, 스피드 S. */
const MAIN_STAT: Record<ProductTab, string> = { 공격: 'SP 공격', 방어: 'SP HP', 스피드: 'SP 스피드' }

/** src/app/perf.ts의 스피드 차트 표식 이름(detail.generation) */
const SPEED_FIRST_MARK = 'speed-chart:first'
const SPEED_COMPLETE_MARK = 'speed-chart:complete'

interface PanelEvent {
  t: number
  tab: string
  generation: number
  first: boolean
  complete: boolean
  superseded: boolean
}
interface LongTaskEntry {
  start: number
  duration: number
}
interface Probe {
  panel: PanelEvent[]
  panelAppearedAt: number | null
  longTasks: LongTaskEntry[]
  pointerup: number[]
  /** 공격 탭 첫 카드 사건 직후 페이지 안에서 누른 탭 클릭 시각 */
  clickedAt: number | null
}
declare global {
  interface Window {
    __probe: Probe
  }
}

/**
 * 페이지 스크립트보다 먼저 계측을 건다. 시각은 모두 performance.now()(navigation start = 0).
 * clickTab이 있으면 공격 탭 첫 카드 사건을 본 MutationObserver 콜백 안에서 바로 그 탭을 누른다.
 * 테스트 쪽 대기는 CDP 왕복만큼 늦어 "직후"가 흐려지므로 페이지 안에서 누른다.
 */
/** 매 로드를 첫 방문으로 재도록 저장된 파티(ev-maker:party)를 지운다 */
function clearSavedParty() {
  try {
    localStorage.removeItem('ev-maker:party')
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}

function installProbe(clickTab: string | null) {
  const probe: Probe = { panel: [], panelAppearedAt: null, longTasks: [], pointerup: [], clickedAt: null }
  window.__probe = probe
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) probe.longTasks.push({ start: e.startTime, duration: e.duration })
  }).observe({ type: 'longtask', buffered: true })
  window.addEventListener('pointerup', () => probe.pointerup.push(performance.now()), true)
  let last = ''
  const record = () => {
    const el = document.querySelector('[data-testid="tab-panel"]')
    if (!el) return
    if (probe.panelAppearedAt === null) probe.panelAppearedAt = performance.now()
    const ev = {
      tab: el.getAttribute('data-tab') ?? '',
      generation: Number(el.getAttribute('data-generation')),
      first: el.getAttribute('data-first-card') === 'true',
      complete: el.getAttribute('data-complete') === 'true',
      superseded: el.getAttribute('data-superseded') === 'true',
    }
    const key = JSON.stringify(ev)
    if (key === last) return
    last = key
    probe.panel.push({ t: performance.now(), ...ev })
    if (clickTab !== null && probe.clickedAt === null && ev.tab === 'attack' && ev.first && !ev.superseded) {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]')].find((b) => b.textContent === clickTab)
      if (button) {
        probe.clickedAt = performance.now()
        button.click()
      }
    }
  }
  new MutationObserver(record).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-tab', 'data-generation', 'data-first-card', 'data-complete', 'data-superseded'],
  })
}

interface Run {
  firstMs: number
  completeMs: number
  /** 계산 구간(그 세대 compute-start mark ~ 그 탭 완료)과 겹친 Long Task 최대(없으면 0) */
  computeLongTaskMs: number
  /** 첫 compute-start mark 전(부트스트랩)의 Long Task 최대 */
  bootstrapLongTaskMs: number
  bootstrapStage: string
  slider?: { from: number; to: number }
}

interface Raw {
  probe: Probe
  marks: { start: number; generation: number }[]
  resources: { name: string; start: number; end: number }[]
}

async function readRaw(page: Page): Promise<Raw> {
  return page.evaluate(
    (mark) => ({
      probe: window.__probe,
      marks: performance.getEntriesByName(mark, 'mark').map((m) => ({ start: m.startTime, generation: (m as PerformanceMark).detail?.generation as number })),
      resources: (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => ({ name: r.name, start: r.startTime, end: r.responseEnd })),
    }),
    COMPUTE_START_MARK,
  )
}

/** 부트스트랩 Long Task의 단계: 엔트리 모듈 평가 → 데이터 청크 로드·평가 → 데이터 준비(메타 뷰) → 첫 렌더. */
function stageOf(raw: Raw, lt: LongTaskEntry): string {
  const end = lt.start + lt.duration
  const panelAt = raw.probe.panelAppearedAt ?? Infinity
  const dynamic = raw.resources.filter((r) => /\/assets\/.*\.js/.test(r.name) && !/\/assets\/index-/.test(r.name))
  const firstDynamic = Math.min(...dynamic.map((r) => r.start))
  const lastDynamic = Math.max(...dynamic.map((r) => r.end))
  if (lt.start <= panelAt && end >= panelAt) return '첫 렌더'
  if (end <= firstDynamic) return '엔트리 모듈 평가'
  if (lt.start <= lastDynamic) return '데이터 청크 로드·평가'
  if (end <= panelAt) return '데이터 준비(메타 뷰)'
  return '첫 렌더 이후'
}

function summarize(raw: Raw, tab: string, start: number, generationAfter: number): Omit<Run, 'slider'> {
  const ev = raw.probe.panel
  const ok = (e: PanelEvent) => e.t >= start && e.tab === tab && e.generation > generationAfter && !e.superseded
  const first = ev.find((e) => ok(e) && e.first)
  const done = ev.find((e) => ok(e) && e.complete)
  if (!first || !done) throw new Error(`${tab} 탭 사건을 찾지 못했다: ${JSON.stringify(ev.slice(-6))}`)
  const mark = raw.marks.find((m) => m.generation === done.generation)
  if (!mark) throw new Error(`세대 ${done.generation}의 ${COMPUTE_START_MARK} mark가 없다`)
  const compute = raw.probe.longTasks.filter((lt) => lt.start < done.t && lt.start + lt.duration > mark.start)
  const firstMark = Math.min(...raw.marks.map((m) => m.start))
  const worstBoot = raw.probe.longTasks
    .filter((lt) => lt.start < firstMark)
    .reduce<LongTaskEntry | undefined>((w, lt) => (w === undefined || lt.duration > w.duration ? lt : w), undefined)
  return {
    firstMs: first.t - start,
    completeMs: done.t - start,
    computeLongTaskMs: Math.max(0, ...compute.map((lt) => lt.duration)),
    bootstrapLongTaskMs: worstBoot?.duration ?? 0,
    bootstrapStage: worstBoot ? stageOf(raw, worstBoot) : '—',
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** +4가 상한·합계(잔여)를 넘으면 −4(0 아래로는 못 내려 0에서 멈춘다). */
async function sliderTarget(page: Page, name: ProductTab) {
  const slider = mySet(page).getByRole('slider', { name: MAIN_STAT[name], exact: true })
  const from = Number(await slider.inputValue())
  const remaining = Number(await mySet(page).getByTestId('sp-remaining').textContent())
  const max = Number(await slider.getAttribute('max'))
  const to = from + 4 <= Math.min(max, from + remaining) ? from + 4 : Math.max(0, from - 4)
  return { slider, from, to }
}

/** 한 번 로드해 (a) 그 탭 처음 열기, 그 탭 완료 뒤 (b) 주 능력치 슬라이더 놓기를 잰다. */
async function measureOnce(page: Page, name: DamageTabName): Promise<{ open: Run; slide: Run }> {
  const tab = TAB_ID[name]
  await page.goto('/')
  await expect(tabPanel(page)).toHaveAttribute('data-tab', tab, { timeout: 15_000 })
  await waitComplete(page)
  const raw1 = await readRaw(page)
  const openStart = tab === 'attack' ? 0 : raw1.probe.clickedAt
  if (openStart === null) throw new Error(`${name} 탭 클릭 시각이 없다`)
  const open = summarize(raw1, tab, openStart, -1)
  const genBefore = Number(await tabPanel(page).getAttribute('data-generation'))

  const { slider, from, to } = await sliderTarget(page, name)
  expect(await dragSlider(page, slider, to)).toBe(to)
  const ups = await page.evaluate(() => window.__probe.pointerup)
  const upAt = ups[ups.length - 1]
  await expect(tabPanel(page)).not.toHaveAttribute('data-generation', String(genBefore))
  await waitComplete(page)
  const slide = summarize(await readRaw(page), tab, upAt, genBefore)
  return { open, slide: { ...slide, slider: { from, to } } }
}

const fmt = (n: number) => n.toFixed(0)
const list = (runs: Run[], f: (r: Run) => number) => runs.map((r) => fmt(f(r))).join(',')

type DamageTabName = Exclude<ProductTab, '스피드'>

for (const name of ['공격', '방어'] as const) {
  test(`반응성 ${name} 탭: 처음 열기·주 능력치 슬라이더 놓기 각 ${RUNS}회`, async ({ page, browser }) => {
    test.setTimeout(240_000)
    await page.addInitScript(installProbe, name === '공격' ? null : name)
    await page.addInitScript(clearSavedParty)
    const opens: Run[] = []
    const slides: Run[] = []
    for (let i = 0; i < RUNS; i++) {
      const r = await measureOnce(page, name)
      opens.push(r.open)
      slides.push(r.slide)
    }

    // 계측 자체 확인: 페이지 작업(setTimeout)으로 만든 120ms가 Long Task로 잡혀야 위 기록을 믿을 수 있다.
    // page.evaluate 본문은 CDP 평가라 Long Task로 잡히지 않는다.
    await page.evaluate(() =>
      setTimeout(() => {
        const t = performance.now()
        while (performance.now() - t < 120);
      }, 0),
    )
    await expect.poll(() => page.evaluate(() => Math.max(0, ...window.__probe.longTasks.map((l) => l.duration)))).toBeGreaterThanOrEqual(110)

    const report = (label: string, runs: Run[], extra: string) => {
      const line =
        `${label}: 첫 카드 중앙값 ${fmt(median(runs.map((r) => r.firstMs)))}ms [${list(runs, (r) => r.firstMs)}]` +
        ` · 완료 중앙값 ${fmt(median(runs.map((r) => r.completeMs)))}ms [${list(runs, (r) => r.completeMs)}]` +
        ` · 계산 구간 Long Task 최대 ${fmt(Math.max(...runs.map((r) => r.computeLongTaskMs)))}ms [${list(runs, (r) => r.computeLongTaskMs)}]` +
        extra
      console.log(`[product-perf] chromium ${browser.version()} ${line}`)
      test.info().annotations.push({ type: 'perf', description: line })
    }
    const boot = opens.map((r) => `${fmt(r.bootstrapLongTaskMs)}${r.bootstrapStage === '—' ? '' : `(${r.bootstrapStage})`}`).join(',')
    report(`${name} 탭 처음 열기`, opens, ` · 부트스트랩 Long Task 최대 ${fmt(Math.max(...opens.map((r) => r.bootstrapLongTaskMs)))}ms [${boot}]`)
    report(`${name} 탭 슬라이더 놓기`, slides, ` · SP ${slides[0].slider!.from}→${slides[0].slider!.to}`)

    for (const runs of [opens, slides]) {
      expect.soft(median(runs.map((r) => r.firstMs))).toBeLessThanOrEqual(FIRST_CARD_MEDIAN_LIMIT_MS)
      expect.soft(median(runs.map((r) => r.completeMs))).toBeLessThanOrEqual(COMPLETE_MEDIAN_LIMIT_MS)
      expect.soft(Math.max(...runs.map((r) => r.computeLongTaskMs))).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS)
    }
  })
}

interface SpeedMark {
  name: string
  start: number
  generation: number
}

async function speedMarks(page: Page): Promise<SpeedMark[]> {
  return page.evaluate(
    (names) =>
      names.flatMap((name) =>
        performance.getEntriesByName(name, 'mark').map((m) => ({ name, start: m.startTime, generation: Number((m as PerformanceMark).detail?.generation) })),
      ),
    [SPEED_FIRST_MARK, SPEED_COMPLETE_MARK],
  )
}

/**
 * start 뒤 첫 "첫 표시" 표식과 같은 세대의 "완료" 표식. generationAfter가 있으면 그보다 큰 세대만 본다
 * (표식의 세대 값이 숫자가 아니면 세대 조건 없이 시각만 본다).
 */
function speedEvents(marks: SpeedMark[], start: number, generationAfter: number | null) {
  const newer = (m: SpeedMark) => generationAfter === null || Number.isNaN(m.generation) || m.generation > generationAfter
  const first = marks.filter((m) => m.name === SPEED_FIRST_MARK && m.start >= start && newer(m)).sort((a, b) => a.start - b.start)[0]
  if (!first) return null
  const done = marks
    .filter((m) => m.name === SPEED_COMPLETE_MARK && m.start >= first.start && (Number.isNaN(first.generation) || m.generation === first.generation))
    .sort((a, b) => a.start - b.start)[0]
  return done ? { first, done } : null
}

/** start(입력 시각) → 표식. Long Task는 start ~ 완료 표식 구간과 겹친 것 */
async function speedRun(page: Page, start: number, generationAfter: number | null): Promise<Run> {
  await expect
    .poll(async () => speedEvents(await speedMarks(page), start, generationAfter) !== null, { message: '스피드 차트 표식(첫 표시·완료)이 나오지 않았다', timeout: 15_000 })
    .toBe(true)
  const ev = speedEvents(await speedMarks(page), start, generationAfter)!
  const longTasks = await page.evaluate(() => window.__probe.longTasks)
  const inWindow = longTasks.filter((lt) => lt.start < ev.done.start && lt.start + lt.duration > start)
  return {
    firstMs: ev.first.start - start,
    completeMs: ev.done.start - start,
    computeLongTaskMs: Math.max(0, ...inWindow.map((lt) => lt.duration)),
    bootstrapLongTaskMs: 0,
    bootstrapStage: '—',
  }
}

const lastPointerUp = async (page: Page) => {
  const ups = await page.evaluate(() => window.__probe.pointerup)
  return ups[ups.length - 1]
}

const speedBadges = (page: Page) => page.getByTestId('speed-badge')
const speedChip = (page: Page, filter: string) => page.locator(`[data-testid="speed-head"] [data-filter="${filter}"]`)
const SPEED_FILTERS = ['rank', 'scarf', 'tailwind', 'field'] as const

/**
 * 한 번 로드해 스피드 차트 (a) 처음 열기(조건 필터 기본값), (b) 조건 필터를 전부 켠 뒤 공격 탭을 거쳐 다시 열기(차트를 다시 만든다),
 * (c) 전부 켠 상태에서 S SP 슬라이더 놓기를 잰다. 필터는 새로고침하면 기본값으로 돌아가 처음 열기는 기본값으로만 잴 수 있다.
 */
async function measureSpeedOnce(page: Page) {
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => window.__probe.clickedAt), { timeout: 15_000 }).not.toBeNull()
  const open = await speedRun(page, (await page.evaluate(() => window.__probe.clickedAt))!, null)
  await expect(speedBadges(page).first()).toBeVisible()
  const defaultBadges = await speedBadges(page).count()

  for (const f of SPEED_FILTERS) {
    if ((await speedChip(page, f).getAttribute('aria-pressed')) !== 'true') await speedChip(page, f).click()
    await expect(speedChip(page, f)).toHaveAttribute('aria-pressed', 'true')
  }
  await resultTab(page, '공격').click()
  await expect(tabPanel(page)).toHaveAttribute('data-tab', 'attack')
  await waitComplete(page)
  await resultTab(page, '스피드').click()
  const reopen = await speedRun(page, await lastPointerUp(page), null)
  for (const f of SPEED_FILTERS) await expect(speedChip(page, f)).toHaveAttribute('aria-pressed', 'true')
  const allBadges = await speedBadges(page).count()

  const genBefore = Math.max(-1, ...(await speedMarks(page)).map((m) => m.generation).filter((g) => !Number.isNaN(g)))
  const { slider, from, to } = await sliderTarget(page, '스피드')
  expect(await dragSlider(page, slider, to)).toBe(to)
  const slide = await speedRun(page, await lastPointerUp(page), genBefore)
  return { open, reopen, slide: { ...slide, slider: { from, to } }, defaultBadges, allBadges }
}

test(`반응성 스피드 차트: 처음 열기·조건 필터 전부 켜고 다시 열기·S SP 슬라이더 놓기 각 ${RUNS}회`, async ({ page, browser }) => {
  test.setTimeout(300_000)
  await page.addInitScript(installProbe, '스피드')
  const opens: Run[] = []
  const reopens: Run[] = []
  const slides: Run[] = []
  const counts: string[] = []
  for (let i = 0; i < RUNS; i++) {
    const r = await measureSpeedOnce(page)
    opens.push(r.open)
    reopens.push(r.reopen)
    slides.push(r.slide)
    counts.push(`${r.defaultBadges}/${r.allBadges}`)
  }
  const line = (label: string, runs: Run[], extra = '') =>
    `${label}: 첫 표시 중앙값 ${fmt(median(runs.map((r) => r.firstMs)))}ms [${list(runs, (r) => r.firstMs)}]` +
    ` · 완료 중앙값 ${fmt(median(runs.map((r) => r.completeMs)))}ms [${list(runs, (r) => r.completeMs)}]` +
    ` · 구간 Long Task 최대 ${fmt(Math.max(...runs.map((r) => r.computeLongTaskMs)))}ms [${list(runs, (r) => r.computeLongTaskMs)}]` +
    extra
  const lines = [
    line('스피드 차트 처음 열기(조건 필터 기본값)', opens, ` · 배지 수(기본값/전부 켬) [${counts.join(',')}]`),
    line('스피드 차트 다시 열기(조건 필터 전부 켬)', reopens),
    line('스피드 차트 S 슬라이더 놓기(조건 필터 전부 켬)', slides, ` · SP ${slides[0].slider!.from}→${slides[0].slider!.to}`),
  ]
  for (const l of lines) {
    console.log(`[product-perf] chromium ${browser.version()} ${l}`)
    test.info().annotations.push({ type: 'perf', description: l })
  }
  for (const runs of [opens, reopens, slides]) {
    expect.soft(median(runs.map((r) => r.firstMs))).toBeLessThanOrEqual(FIRST_CARD_MEDIAN_LIMIT_MS)
    expect.soft(median(runs.map((r) => r.completeMs))).toBeLessThanOrEqual(COMPLETE_MEDIAN_LIMIT_MS)
    expect.soft(Math.max(...runs.map((r) => r.computeLongTaskMs))).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS)
  }
})

interface InputProbe {
  clicks: { delay: number; start: number }[]
  attackCompleteAt: number | null
}

test(`반응성 보조: 공격 탭 계산 중 실제 마우스 클릭의 입력 지연 ≤ 100ms (${RUNS}회)`, async ({ page, browser }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await waitComplete(page)
  const box = (await resultTab(page, '방어').boundingBox())!
  await page.addInitScript(() => {
    const probe: InputProbe = { clicks: [], attackCompleteAt: null }
    ;(window as unknown as { __input: InputProbe }).__input = probe
    // Event Timing은 16ms 미만 이벤트를 남기지 않아 리스너에서 직접 잰다(event.timeStamp = 입력 발생 시각).
    window.addEventListener('click', (e) => probe.clicks.push({ delay: performance.now() - e.timeStamp, start: e.timeStamp }), true)
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="tab-panel"][data-tab="attack"][data-complete="true"]')
      if (el && probe.attackCompleteAt === null) probe.attackCompleteAt = performance.now()
    }).observe(document, { subtree: true, childList: true, attributes: true })
  })
  const delays: number[] = []
  for (let i = 0; i < RUNS; i++) {
    await page.goto('/', { waitUntil: 'commit' })
    // 공격 탭 첫 카드(약 0.1~0.2초)와 완료(약 0.9초) 사이를 노린다. 실제로 계산 중이었는지는 아래에서 확인한다.
    await page.waitForTimeout(400)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(tabPanel(page)).toHaveAttribute('data-tab', 'defense')
    await waitComplete(page)
    const { probe, markAt } = await page.evaluate(
      (mark) => ({ probe: (window as unknown as { __input: InputProbe }).__input, markAt: performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? Infinity }),
      COMPUTE_START_MARK,
    )
    expect(probe.clicks.length).toBeGreaterThan(0)
    const click = probe.clicks[0]
    expect(click.start).toBeGreaterThan(markAt)
    expect(probe.attackCompleteAt === null || click.start < probe.attackCompleteAt).toBe(true)
    delays.push(click.delay)
  }
  const line = `계산 중 실제 클릭 입력 지연(입력 발생 → click 처리 시작): 중앙값 ${fmt(median(delays))}ms, 최대 ${fmt(Math.max(...delays))}ms [${delays.map(fmt).join(',')}]`
  console.log(`[product-perf] chromium ${browser.version()} ${line}`)
  test.info().annotations.push({ type: 'perf', description: line })
  expect(Math.max(...delays)).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS)
})

interface FrameProbe {
  frames: number[]
  /** 0ms setTimeout을 연달아 걸어 잰 예약 → 실행 지연 */
  timers: { at: number; lag: number }[]
  attackCompleteAt: number | null
}

/** 계산 중에도 대략 30fps 이상 */
const FRAME_INTERVAL_MEDIAN_LIMIT_MS = 34

test(`반응성 보조: 공격 탭 계산 중 렌더 프레임 간격 중앙값 ≤ ${FRAME_INTERVAL_MEDIAN_LIMIT_MS}ms (${RUNS}회)`, async ({ page, browser }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    const probe: FrameProbe = { frames: [], timers: [], attackCompleteAt: null }
    ;(window as unknown as { __frames: FrameProbe }).__frames = probe
    const frame = (t: number) => {
      probe.frames.push(t)
      if (probe.attackCompleteAt === null) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    const timer = () => {
      const at = performance.now()
      setTimeout(() => {
        probe.timers.push({ at, lag: performance.now() - at })
        if (probe.attackCompleteAt === null) timer()
      }, 0)
    }
    timer()
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="tab-panel"][data-tab="attack"][data-complete="true"]')
      if (el && probe.attackCompleteAt === null) probe.attackCompleteAt = performance.now()
    }).observe(document, { subtree: true, childList: true, attributes: true })
  })
  const medians: number[] = []
  const maxima: number[] = []
  const timerMaxima: number[] = []
  for (let i = 0; i < RUNS; i++) {
    await page.goto('/')
    await waitComplete(page)
    const { probe, markAt } = await page.evaluate(
      (mark) => ({
        probe: (window as unknown as { __frames: FrameProbe }).__frames,
        markAt: performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? Infinity,
      }),
      COMPUTE_START_MARK,
    )
    const end = probe.attackCompleteAt ?? Infinity
    // rAF 시각은 프레임 시작 시각이라 mark 직전 프레임 하나를 경계로 포함한다.
    const inCompute = probe.frames.filter((t, j) => t <= end && (t >= markAt || (probe.frames[j + 1] ?? Infinity) >= markAt))
    expect(inCompute.length).toBeGreaterThanOrEqual(3)
    const gaps = inCompute.slice(1).map((t, j) => t - inCompute[j])
    medians.push(median(gaps))
    maxima.push(Math.max(...gaps))
    timerMaxima.push(Math.max(0, ...probe.timers.filter((x) => x.at <= end && x.at + x.lag >= markAt).map((x) => x.lag)))
  }
  const line =
    `계산 중 rAF 간격: 회차 중앙값 [${medians.map(fmt).join(',')}] · 회차 최대 [${maxima.map(fmt).join(',')}]` +
    ` · setTimeout(0) 지연 회차 최대 [${timerMaxima.map(fmt).join(',')}]`
  console.log(`[product-perf] chromium ${browser.version()} ${line}`)
  test.info().annotations.push({ type: 'perf', description: line })
  expect(Math.max(...medians)).toBeLessThanOrEqual(FRAME_INTERVAL_MEDIAN_LIMIT_MS)
})

interface DragProbe {
  frames: number[]
  downs: number[]
  ups: number[]
  longTasks: LongTaskEntry[]
}
declare global {
  interface Window {
    __drag: DragProbe
  }
}

/** S 슬라이더 드래그 한 번의 폭(SP). 놓기 시나리오(±4)보다 길게 끌어 드래그 중 프레임을 충분히 모은다 */
const SPEED_DRAG_SP = 12
const SPEED_DRAG_RUNS = 5

// speed-bundles-pin-disable 비기능 성능·AC15: 배지가 늘고 배지마다 핀 비활성 판정이 붙어도 S 슬라이더를 끄는 동안 프레임 간격 예산(34ms)을 지킨다.
// 핀 판정은 확정 세트로만 메모한다(ADR 결정 4). 드래그 중 표시 SP로 다시 돌면 배지 수만큼 최소 S가 프레임마다 돌아 이 예산을 넘는다.
test(`반응성 보조: 스피드 S 슬라이더 드래그 중 렌더 프레임 간격 중앙값 ≤ ${FRAME_INTERVAL_MEDIAN_LIMIT_MS}ms (조건 필터 전부 켬, ${SPEED_DRAG_RUNS}회)`, async ({ page, browser }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    const probe: DragProbe = { frames: [], downs: [], ups: [], longTasks: [] }
    window.__drag = probe
    const frame = (t: number) => {
      probe.frames.push(t)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    window.addEventListener('pointerdown', () => probe.downs.push(performance.now()), true)
    window.addEventListener('pointerup', () => probe.ups.push(performance.now()), true)
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) probe.longTasks.push({ start: e.startTime, duration: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  })
  await page.goto('/')
  await waitComplete(page)
  await resultTab(page, '스피드').click()
  for (const f of SPEED_FILTERS) {
    if ((await speedChip(page, f).getAttribute('aria-pressed')) !== 'true') await speedChip(page, f).click()
    await expect(speedChip(page, f)).toHaveAttribute('aria-pressed', 'true')
  }
  const badges = await speedBadges(page).count()
  const pins = page.locator('.speed-badge-item [data-testid="cut-pin"]')
  const disabledPins = page.locator('.speed-badge-item [data-testid="cut-pin"][aria-disabled="true"]')
  const pinCount = await pins.count()
  const disabledCount = await disabledPins.count()
  // 판정이 실제로 도는 상태에서 잰다(도달 불가 배지가 있으면 비활성 핀이 있다)
  expect(pinCount).toBe(badges)
  expect(disabledCount).toBeGreaterThan(0)

  const slider = mySet(page).getByRole('slider', { name: MAIN_STAT['스피드'], exact: true })
  const medians: number[] = []
  const maxima: number[] = []
  const longTasks: number[] = []
  const moves: string[] = []
  for (let i = 0; i < SPEED_DRAG_RUNS; i++) {
    const from = Number(await slider.inputValue())
    const remaining = Number(await mySet(page).getByTestId('sp-remaining').textContent())
    const max = Number(await slider.getAttribute('max'))
    const to = from >= SPEED_DRAG_SP ? from - SPEED_DRAG_SP : Math.min(max, from + remaining, from + SPEED_DRAG_SP)
    expect(to).not.toBe(from)
    expect(await dragSlider(page, slider, to)).toBe(to)
    moves.push(`${from}→${to}`)
    const { frames, down, up, lts } = await page.evaluate(() => {
      const p = window.__drag
      return { frames: p.frames, down: p.downs[p.downs.length - 1], up: p.ups[p.ups.length - 1], lts: p.longTasks }
    })
    // rAF 시각은 프레임 시작 시각이라 누르기 직전 프레임 하나를 경계로 포함한다
    const during = frames.filter((t, j) => t <= up && (t >= down || (frames[j + 1] ?? Infinity) >= down))
    expect(during.length).toBeGreaterThanOrEqual(3)
    const gaps = during.slice(1).map((t, j) => t - during[j])
    medians.push(median(gaps))
    maxima.push(Math.max(...gaps))
    longTasks.push(Math.max(0, ...lts.filter((l) => l.start + l.duration >= down && l.start <= up).map((l) => l.duration)))
    // 놓은 뒤 차트가 확정 세트로 다시 그려진 다음 회차로
    await expect(slider).toHaveValue(String(to))
    await expect(disabledPins.first()).toBeAttached()
  }
  const line =
    `스피드 S 슬라이더 드래그 중 rAF 간격(조건 필터 전부 켬, 배지 ${badges}, 핀 ${pinCount} 중 비활성 ${disabledCount}): ` +
    `회차 중앙값 [${medians.map((x) => x.toFixed(1)).join(',')}] · 회차 최대 [${maxima.map((x) => x.toFixed(1)).join(',')}]` +
    ` · 드래그 구간 Long Task 최대 [${longTasks.map(fmt).join(',')}] · SP [${moves.join(',')}]`
  console.log(`[product-perf] chromium ${browser.version()} ${line}`)
  test.info().annotations.push({ type: 'perf', description: line })
  expect(Math.max(...medians)).toBeLessThanOrEqual(FRAME_INTERVAL_MEDIAN_LIMIT_MS)
  expect(Math.max(...longTasks)).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS)
})

// ---------- 컷 고정(cut-lock-budget 비기능 3항) ----------

/** 고정 상태 탭별 첫 결과 중앙값 ≤ 같은 실행 무고정 첫 결과 중앙값 × 3 */
const LOCK_FIRST_RATIO_LIMIT = 3
const LOCK_RUNS = 5
const NINETALES_152 = /^나인테일 S32 성격 무보정, 실수치 152,/
/** 상위 100 → 30: 나인테일(사용률 66위)은 필터 밖, 한카리아스(7위)·짜랑고우거(23위)는 안 */
const TOP_N_AFTER = '30'
const LOCK_MOVES = ['지진', '드래곤클로', '스톤샤워', '용성군']

type TabRuns = Record<ProductTab, Run>

/** 입력 이벤트 시각(상위 N 칸 값 바꿈) */
const lastInputAt = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __inputAt: number }).__inputAt)

/** start 뒤 그 탭이 generationAfter보다 새 세대로 첫 카드·완료한 사건(공격·방어) */
const damageRun = (raw: Raw, tab: string, start: number, generationAfter: number): Run => ({
  ...summarize(raw, tab, start, generationAfter),
  bootstrapLongTaskMs: 0,
  bootstrapStage: '—',
})

/**
 * 한 번 로드해 (locked면 스피드 1·공격 1·방어 쌍(H 포함) 1 컷 고정 뒤) 상위 N을 바꾸고, 공격 탭(지금 탭) 첫 결과 → 방어 탭 클릭 첫 결과 → 스피드 탭 클릭 첫 표시를 잰다.
 * 두 조건 모두 같은 세트(예시 세트 기술 4 = 용성군)·같은 입력(상위 N 100 → 30)·같은 탭 순서다.
 */
async function measureLockOnce(page: Page, locked: boolean): Promise<TabRuns> {
  await openProduct(page)
  await waitComplete(page)
  await fillMySet(page, { moves: LOCK_MOVES })
  if (locked) {
    await lockBadge(page, NINETALES_152)
    await settle(page)
    await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    await lockRow(page, '방어', 'garchomp', 'dragonclaw')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(3)
  }
  await selectTab(page, '공격')
  await waitComplete(page)
  const genBefore = Number(await tabPanel(page).getAttribute('data-generation'))
  await page.getByRole('spinbutton', { name: '상위 N', exact: true }).fill(TOP_N_AFTER)
  await expect(tabPanel(page)).not.toHaveAttribute('data-generation', String(genBefore))
  await waitComplete(page)
  const attack = damageRun(await readRaw(page), 'attack', await lastInputAt(page), genBefore)
  if (locked) await settle(page)

  await resultTab(page, '방어').click()
  await expect(tabPanel(page)).toHaveAttribute('data-tab', 'defense')
  await waitComplete(page)
  const defense = damageRun(await readRaw(page), 'defense', await lastPointerUp(page), genBefore)

  await resultTab(page, '스피드').click()
  const speed = await speedRun(page, await lastPointerUp(page), null)
  return { 공격: attack, 방어: defense, 스피드: speed }
}

interface AdjustOpen {
  ms: number
  /** 연 카드 상대 id */
  opponent: string
  /** 누름 ~ 목록 확정 구간과 겹친 Long Task 최대(없으면 0) */
  longTaskMs: number
}

/**
 * 지금 탭에서 첫 활성 "변동" 버튼을 페이지 안에서 눌러 팝오버 목록이 확정(계산 중 항목이 사라짐)될 때까지 잰다.
 * 테스트 쪽 대기는 CDP 왕복만큼 늦어 페이지 안에서 누르고 MutationObserver로 본다.
 */
async function measureAdjustOpen(page: Page): Promise<AdjustOpen> {
  const r = await page.evaluate(
    () =>
      new Promise<{ start: number; end: number; opponent: string }>((resolve, reject) => {
        const btn = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="tab-panel"] [data-testid="adjust-button"]')].find((b) => b.getAttribute('aria-disabled') !== 'true')
        const card = btn?.closest<HTMLElement>('[data-testid="card"]')
        if (btn === undefined || card == null) return reject(new Error('활성 변동 버튼이 없다'))
        const ready = () => {
          const menu = card.querySelector('[data-testid="adjust-menu"]')
          return menu !== null && !(menu.textContent ?? '').includes('계산 중')
        }
        const start = performance.now()
        const finish = () => resolve({ start, end: performance.now(), opponent: card.dataset.opponent ?? '' })
        btn.click()
        if (ready()) return finish()
        let timer = 0
        const mo = new MutationObserver(() => {
          if (!ready()) return
          mo.disconnect()
          clearTimeout(timer)
          finish()
        })
        mo.observe(card, { subtree: true, childList: true, characterData: true, attributes: true })
        timer = window.setTimeout(() => {
          mo.disconnect()
          reject(new Error('변동 목록이 15초 안에 확정되지 않았다'))
        }, 15_000)
      }),
  )
  const longTasks = await page.evaluate(() => window.__probe.longTasks)
  const overlap = longTasks.filter((lt) => lt.start < r.end && lt.start + lt.duration > r.start)
  await page.keyboard.press('Escape')
  await expect(tabPanel(page).getByTestId('adjust-menu')).toHaveCount(0)
  return { ms: r.end - r.start, opponent: r.opponent, longTaskMs: Math.max(0, ...overlap.map((lt) => lt.duration)) }
}

test(`컷 고정 3개(스피드·공격·H 포함 방어 쌍, 필터 밖 1건) 탭별 첫 결과 ≤ 무고정 중앙값 × ${LOCK_FIRST_RATIO_LIMIT} · Long Task ≤ ${LONG_TASK_LIMIT_MS}ms (${LOCK_RUNS}회씩 교대)`, async ({ page, browser }) => {
  test.setTimeout(600_000)
  await page.addInitScript(installProbe, null)
  await page.addInitScript(clearSavedParty)
  await page.addInitScript(() => {
    const w = window as unknown as { __inputAt: number }
    w.__inputAt = 0
    window.addEventListener('input', () => (w.__inputAt = performance.now()), true)
  })
  const plain: TabRuns[] = []
  const locked: TabRuns[] = []
  for (let i = 0; i < LOCK_RUNS; i++) {
    plain.push(await measureLockOnce(page, false))
    locked.push(await measureLockOnce(page, true))
  }

  // 기준 갈래 전환: 마지막 고정 상태에서 공격 탭으로 가 고정 줄 성격 ▲(기준 갈래 선택)를 누른 뒤 첫 결과
  await selectTab(page, '공격')
  await waitComplete(page)
  const toggles = mySet(page).locator('.sp-row[data-locked="true"] .nat-btn.plus:not([disabled])')
  expect(await toggles.count()).toBeGreaterThanOrEqual(1)
  const genBefore = Number(await tabPanel(page).getAttribute('data-generation'))
  await toggles.first().click()
  await expect(tabPanel(page)).not.toHaveAttribute('data-generation', String(genBefore))
  await waitComplete(page)
  const baseSwitch = damageRun(await readRaw(page), 'attack', await lastPointerUp(page), genBefore)

  // 고정 3개 상태의 변동 팝오버 처음 열기(공격·방어 탭 첫 활성 변동 버튼)
  const adjustOpens: Partial<Record<DamageTabName, AdjustOpen>> = {}
  for (const name of ['공격', '방어'] as const) {
    await selectTab(page, name)
    await waitComplete(page)
    await settle(page)
    adjustOpens[name] = await measureAdjustOpen(page)
  }

  const lanes = await page.evaluate(async (moves) => {
    // src/app/perf.ts의 lane 훅(앱 tsconfig와 분리돼 있어 모양만 다시 적는다)
    const perf = (window as unknown as { __perf: { lane(opponentId: string, moveId: string, moves: string[], tab: 'attack' | 'defense'): Promise<{ tasks: number; judgements: number; ms: number }> } }).__perf
    return [await perf.lane('garchomp', 'dragonclaw', moves, 'attack'), await perf.lane('garchomp', 'dragonclaw', moves, 'defense')]
  }, LOCK_MOVES)

  const lines: string[] = []
  for (const tab of ['공격', '방어', '스피드'] as const) {
    const p = plain.map((r) => r[tab])
    const l = locked.map((r) => r[tab])
    const base = median(p.map((r) => r.firstMs))
    const lockedMedian = median(l.map((r) => r.firstMs))
    lines.push(
      `컷 고정 ${tab} 탭: 무고정 첫 결과 중앙값 ${fmt(base)}ms [${list(p, (r) => r.firstMs)}]` +
        ` · 고정 3개 첫 결과 중앙값 ${fmt(lockedMedian)}ms [${list(l, (r) => r.firstMs)}] · 배수 ${(lockedMedian / Math.max(base, 1)).toFixed(2)}` +
        ` · 계산 구간 Long Task 최대 무고정 ${fmt(Math.max(...p.map((r) => r.computeLongTaskMs)))}ms / 고정 ${fmt(Math.max(...l.map((r) => r.computeLongTaskMs)))}ms`,
    )
  }
  lines.push(`기준 갈래 전환(공격 탭 고정 줄 ▲ 클릭 → 첫 결과): ${fmt(baseSwitch.firstMs)}ms · 완료 ${fmt(baseSwitch.completeMs)}ms · Long Task 최대 ${fmt(baseSwitch.computeLongTaskMs)}ms`)
  for (const [name, a] of Object.entries(adjustOpens)) {
    lines.push(`변동 팝오버 처음 열기(고정 3개, ${name} 탭 ${a.opponent}): 누름 → 목록 확정 ${fmt(a.ms)}ms · Long Task 최대 ${fmt(a.longTaskMs)}ms`)
  }
  lines.push(
    `고정 레인(캐시 없음): 한카리아스 드래곤클로 공격 작업 ${lanes[0].tasks}개·판정 ${lanes[0].judgements}회·${fmt(lanes[0].ms)}ms` +
      `, 한카리아스 드래곤클로 방어 쌍(H 포함) 작업 ${lanes[1].tasks}개·계단 H 칸 ${lanes[1].judgements}개·${fmt(lanes[1].ms)}ms`,
  )
  for (const l of lines) {
    console.log(`[product-perf] chromium ${browser.version()} ${l}`)
    test.info().annotations.push({ type: 'perf', description: l })
  }
  for (const tab of ['공격', '방어', '스피드'] as const) {
    const base = median(plain.map((r) => r[tab].firstMs))
    expect.soft(median(locked.map((r) => r[tab].firstMs)), `${tab} 탭 고정 3개 첫 결과 중앙값`).toBeLessThanOrEqual(Math.max(base, 1) * LOCK_FIRST_RATIO_LIMIT)
    expect.soft(Math.max(...locked.map((r) => r[tab].computeLongTaskMs)), `${tab} 탭 고정 3개 Long Task`).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS)
  }
  expect.soft(baseSwitch.computeLongTaskMs, '기준 갈래 전환 Long Task').toBeLessThanOrEqual(LONG_TASK_LIMIT_MS)
  for (const [name, a] of Object.entries(adjustOpens)) {
    expect.soft(a.ms, `${name} 탭 변동 목록 확정`).toBeLessThanOrEqual(COMPLETE_MEDIAN_LIMIT_MS)
    expect.soft(a.longTaskMs, `${name} 탭 변동 팝오버 Long Task`).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS)
  }
  for (const lane of lanes) expect(lane.tasks).toBeGreaterThan(0)
})

// ---------- 공·방 미리 계산(speed-bundles-pin-disable R6 비기능, AC15b) ----------

/** src/app/executor.ts PRECOMPUTE_DONE_MARK(detail: generation, tab, tasks) */
const PRECOMPUTE_DONE_MARK = 'cards:precompute-done'

interface PrecomputeRun {
  /** 세대 compute-start ~ 두 탭 미리 계산 끝 표식 중 늦은 쪽 */
  doneMs: number
  /** 미리 계산 구간(보는 탭 완료 ~ 두 탭 미리 계산 끝)과 겹친 Long Task 최대 */
  longTaskMs: number
  /** 같은 구간 rAF 간격 중앙값 */
  frameMedianMs: number
  tasks: number
}

test(`컷 고정 3개 미리 계산: 세대 시작 ~ 두 공·방 탭 미리 계산 끝 중앙값 ≤ ${COMPLETE_MEDIAN_LIMIT_MS}ms · 구간 Long Task ≤ ${LONG_TASK_LIMIT_MS}ms · 프레임 간격 중앙값 ≤ ${FRAME_INTERVAL_MEDIAN_LIMIT_MS}ms (${LOCK_RUNS}회)`, async ({ page, browser }) => {
  test.setTimeout(600_000)
  await page.addInitScript(installProbe, null)
  await page.addInitScript(clearSavedParty)
  await page.addInitScript(() => {
    const w = window as unknown as { __inputAt: number; __allFrames: number[] }
    w.__inputAt = 0
    w.__allFrames = []
    window.addEventListener('input', () => (w.__inputAt = performance.now()), true)
    const frame = (t: number) => {
      w.__allFrames.push(t)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  const runs: PrecomputeRun[] = []
  for (let i = 0; i < LOCK_RUNS; i++) {
    await openProduct(page)
    await waitComplete(page)
    await fillMySet(page, { moves: LOCK_MOVES })
    await lockBadge(page, NINETALES_152)
    await settle(page)
    await lockRow(page, '공격', 'garchomp', 'dragonclaw')
    await lockRow(page, '방어', 'garchomp', 'dragonclaw')
    await expect(lockList(page).locator('.lock-item')).toHaveCount(3)
    await selectTab(page, '공격')
    await waitComplete(page)
    const genBefore = Number(await tabPanel(page).getAttribute('data-generation'))
    await page.getByRole('spinbutton', { name: '상위 N', exact: true }).fill(TOP_N_AFTER)
    await expect(tabPanel(page)).not.toHaveAttribute('data-generation', String(genBefore))
    const generation = Number(await tabPanel(page).getAttribute('data-generation'))
    await page.waitForFunction(
      ({ mark, generation }) => performance.getEntriesByName(mark, 'mark').filter((m) => (m as PerformanceMark).detail?.generation === generation).length >= 2,
      { mark: PRECOMPUTE_DONE_MARK, generation },
      { timeout: 60_000 },
    )
    const r = await page.evaluate(
      ({ start, done, generation }) => {
        const startAt = performance.getEntriesByName(start, 'mark').find((m) => (m as PerformanceMark).detail?.generation === generation)?.startTime ?? NaN
        const marks = performance.getEntriesByName(done, 'mark').filter((m) => (m as PerformanceMark).detail?.generation === generation) as PerformanceMark[]
        const completeAt = window.__probe.panel.find((e) => e.tab === 'attack' && e.generation === generation && e.complete && !e.superseded)?.t ?? NaN
        return {
          startAt,
          completeAt,
          endAt: Math.max(...marks.map((m) => m.startTime)),
          tasks: marks.reduce((n, m) => n + ((m.detail as { tasks?: number }).tasks ?? 0), 0),
          longTasks: window.__probe.longTasks,
          frames: (window as unknown as { __allFrames: number[] }).__allFrames,
        }
      },
      { start: COMPUTE_START_MARK, done: PRECOMPUTE_DONE_MARK, generation },
    )
    const overlap = r.longTasks.filter((lt) => lt.start < r.endAt && lt.start + lt.duration > r.completeAt)
    const frames = r.frames.filter((t, j) => t <= r.endAt && (t >= r.completeAt || (r.frames[j + 1] ?? Infinity) >= r.completeAt))
    const gaps = frames.slice(1).map((t, j) => t - frames[j])
    runs.push({ doneMs: r.endAt - r.startAt, longTaskMs: Math.max(0, ...overlap.map((lt) => lt.duration)), frameMedianMs: gaps.length === 0 ? 0 : median(gaps), tasks: r.tasks })
  }
  const line =
    `미리 계산(고정 3개, 상위 N 100 → 30): 세대 시작 ~ 두 탭 끝 중앙값 ${fmt(median(runs.map((r) => r.doneMs)))}ms [${runs.map((r) => fmt(r.doneMs)).join(',')}]` +
    ` · 구간 Long Task 최대 ${fmt(Math.max(...runs.map((r) => r.longTaskMs)))}ms · 구간 프레임 간격 회차 중앙값 [${runs.map((r) => fmt(r.frameMedianMs)).join(',')}]` +
    ` · 미리 계산 작업 수 [${runs.map((r) => r.tasks).join(',')}]`
  console.log(`[product-perf] chromium ${browser.version()} ${line}`)
  test.info().annotations.push({ type: 'perf', description: line })
  expect.soft(median(runs.map((r) => r.doneMs)), '미리 계산 완료 중앙값').toBeLessThanOrEqual(COMPLETE_MEDIAN_LIMIT_MS)
  expect.soft(Math.max(...runs.map((r) => r.longTaskMs)), '미리 계산 구간 Long Task').toBeLessThanOrEqual(LONG_TASK_LIMIT_MS)
  expect.soft(Math.max(...runs.map((r) => r.frameMedianMs)), '미리 계산 중 프레임 간격 중앙값').toBeLessThanOrEqual(FRAME_INTERVAL_MEDIAN_LIMIT_MS)
  for (const r of runs) expect(r.tasks).toBeGreaterThan(0)
})
