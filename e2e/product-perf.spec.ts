import { expect, test, type Page } from '@playwright/test'
import { TAB_ID, dragSlider, mySet, resultTab, tabPanel, waitComplete, type ProductTab } from './helpers'

// PRD 비기능 "반응성"(AC17): 세 탭 × (a) 처음 열기 · (b) 주 능력치 SP 슬라이더 ±4 놓기, 시나리오마다 10회.
const RUNS = 10
const FIRST_CARD_MEDIAN_LIMIT_MS = 500
const COMPLETE_MEDIAN_LIMIT_MS = 3000
const LONG_TASK_LIMIT_MS = 100
const COMPUTE_START_MARK = 'cards:compute-start'

/** 예시 세트(src/app/example.ts) 기준 주 능력치: 공격 탭은 첫 기술 지진이 참조하는 A, 방어 H, 스피드 S. */
const MAIN_STAT: Record<ProductTab, string> = { 공격: 'SP 공격', 방어: 'SP HP', 스피드: 'SP 스피드' }

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

/** 한 번 로드해 (a) 그 탭 처음 열기, 그 탭 완료 뒤 (b) 주 능력치 슬라이더 놓기를 잰다. */
async function measureOnce(page: Page, name: ProductTab): Promise<{ open: Run; slide: Run }> {
  const tab = TAB_ID[name]
  await page.goto('/')
  await expect(tabPanel(page)).toHaveAttribute('data-tab', tab, { timeout: 15_000 })
  await waitComplete(page)
  const raw1 = await readRaw(page)
  const openStart = tab === 'attack' ? 0 : raw1.probe.clickedAt
  if (openStart === null) throw new Error(`${name} 탭 클릭 시각이 없다`)
  const open = summarize(raw1, tab, openStart, -1)
  const genBefore = Number(await tabPanel(page).getAttribute('data-generation'))

  const slider = mySet(page).getByRole('slider', { name: MAIN_STAT[name], exact: true })
  const from = Number(await slider.inputValue())
  const remaining = Number(await mySet(page).getByTestId('sp-remaining').textContent())
  const max = Number(await slider.getAttribute('max'))
  // +4가 상한·합계(잔여)를 넘으면 −4(0 아래로는 못 내려 0에서 멈춘다).
  const to = from + 4 <= Math.min(max, from + remaining) ? from + 4 : Math.max(0, from - 4)
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

for (const name of ['공격', '방어', '스피드'] as const) {
  test(`반응성 ${name} 탭: 처음 열기·주 능력치 슬라이더 놓기 각 ${RUNS}회`, async ({ page, browser }) => {
    test.setTimeout(240_000)
    await page.addInitScript(installProbe, name === '공격' ? null : name)
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
