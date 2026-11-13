// 세 탭의 행 작업을 시간 조각으로 나눠 계산하고 탭 뷰를 외부 저장소로 내는 실행기(React 없음).
import { TABS, computeRowTask, createLruCache, createTabAssembler, mayUnlockPair, planTab, primaryCardIds, taskCardId, taskKey } from '../cards'
import type { CardInput, JudgementCache, PendingTasks, RowTask, RowTaskResult, Tab, TabAssembler, TabPlan, TabView } from '../cards'
import type { SpTable } from '../core'
import type { Scheduler } from './scheduler'

export type TabViewState =
  | { kind: 'idle' }
  /** superseded: 새 세대의 첫 카드 사건 전까지 이전 세대 뷰를 유지 중 */
  | { kind: 'view'; view: TabView; generation: number; superseded: boolean }
  | { kind: 'fatal'; message: string; generation: number }

export interface ExecutorSnapshot {
  generation: number
  activeTab: Tab
  tabs: Readonly<Record<Tab, TabViewState>>
}

export interface Executor {
  subscribe(listener: () => void): () => void
  /** 바뀔 때만 새 객체 */
  getSnapshot(): ExecutorSnapshot
  /** 세대가 바뀌면 진행 중 작업 결과를 버리고 세 탭을 다시 계획한다. 같은 세대면 무시.
   *  새 세대는 표시용 SP를 비운다(이전 세대 뷰는 다시 조립하지 않고 그대로 둔다) */
  setInput(input: CardInput, generation: number): void
  /** 우선순위만 바꾼다(재계획 없음) */
  setActiveTab(tab: Tab): void
  /** 드래그 표시용 SP. 활성 탭만 다시 조립(행 작업 없음). null이면 계획 시점 SP */
  setDisplaySp(sp: SpTable | null): void
  dispose(): void
}

export interface ExecutorDeps {
  scheduler?: Scheduler
  cache?: JudgementCache
  /** 한 조각 작업 시간 예산(ms), 기본 12 */
  sliceMs?: number
  now?: () => number
}

export const DEFAULT_SLICE_MS = 12
export const COMPUTE_START_MARK = 'cards:compute-start'

type Stage = 0 | 1 | 2 | 3 | 4
/** 0 = 먼저 계산할 카드(primaryCardIds: 상대·분류마다 최대 묶음·사용자 추가·커스텀), 1 = 나머지 묶음 */
type Tier = 0 | 1
const STAGE_KEYS = ['stage1', 'stage2', 'stage3', 'stage4', 'stage5'] as const
const TIERS: readonly Tier[] = [0, 1]

interface TabRun {
  plan: TabPlan | null
  /** 카드별 남은 작업·조립 캐시(결과가 바뀐 카드만 다시 계산) */
  assembler: TabAssembler | null
  primary: ReadonlySet<string>
  results: Map<string, RowTaskResult>
  /** 층별 마지막 남은 작업 목록과 단계별 소비 위치 */
  queue: [PendingTasks, PendingTasks]
  pos: [[number, number, number, number, number], [number, number, number, number, number]]
  /** probe·fixed(가장 센 기술 고르기)·extreme·ends 결과나 쌍의 마지막 행 sweep·variant 결과가 대기열을 바꿨을 수 있음 */
  dirty: boolean
  fatal: boolean
  /** 결과가 늘 때마다 +1 */
  version: number
  assembled: { version: number; sp: SpTable | null; stage12Done: boolean; complete: boolean } | null
}

interface Run {
  input: CardInput
  generation: number
  marked: boolean
  tabs: Record<Tab, TabRun>
}

type Unit = { tab: Tab; kind: 'plan' } | { tab: Tab; kind: 'task'; task: RowTask }
type Slot = readonly [Tab, Stage, Tier]

const EMPTY_QUEUE: PendingTasks = { stage1: [], stage2: [], stage3: [], stage4: [], stage5: [] }
const IDLE: TabViewState = { kind: 'idle' }

function newTabRun(): TabRun {
  return {
    plan: null,
    assembler: null,
    primary: new Set(),
    results: new Map(),
    queue: [EMPTY_QUEUE, EMPTY_QUEUE],
    pos: [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
    dirty: false,
    fatal: false,
    version: 0,
    assembled: null,
  }
}

/**
 * 활성 탭 1·2단계(먼저 계산할 카드 → 나머지 묶음) → 나머지 탭(TABS 순) 1·2단계 → 활성 탭 3·4·5단계(확인 스윕·성격 변형·쌍) → 나머지 탭 3·4·5단계.
 * 3·4·5단계도 단계마다 먼저 계산할 카드가 앞선다.
 */
function priority(active: Tab): readonly Slot[] {
  const others = TABS.filter((t) => t !== active)
  const early = (t: Tab): Slot[] => [[t, 0, 0], [t, 1, 0], [t, 0, 1], [t, 1, 1]]
  const late = (t: Tab): Slot[] => ([2, 3, 4] as const).flatMap((s) => TIERS.map((tier): Slot => [t, s, tier]))
  return [...early(active), ...others.flatMap(early), ...late(active), ...others.flatMap(late)]
}

function refresh(t: TabRun): void {
  if (t.plan === null || t.assembler === null) return
  const primary = t.primary
  t.queue = [t.assembler.pending(t.results, (id) => primary.has(id)), t.assembler.pending(t.results, (id) => !primary.has(id))]
  t.pos = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]
  t.dirty = false
}

function remaining(t: TabRun, stage: Stage): number {
  return TIERS.reduce<number>((n, tier) => n + t.queue[tier][STAGE_KEYS[stage]].length - t.pos[tier][stage], 0)
}

/** 그 단계·층의 다음 작업을 소비한다. 목록을 다 쓰면 낡은 대기열만 다시 만든다. */
function take(t: TabRun, stage: Stage, tier: Tier): RowTask | null {
  for (;;) {
    const list = t.queue[tier][STAGE_KEYS[stage]]
    while (t.pos[tier][stage] < list.length) {
      const task = list[t.pos[tier][stage]++]
      if (!t.results.has(taskKey(task))) return task
    }
    if (!t.dirty) return null
    refresh(t)
  }
}

function flags(t: TabRun): { stage12Done: boolean; complete: boolean } {
  if (t.dirty) refresh(t)
  const stage12Done = remaining(t, 0) === 0 && remaining(t, 1) === 0
  return { stage12Done, complete: stage12Done && remaining(t, 2) === 0 && remaining(t, 3) === 0 && remaining(t, 4) === 0 }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function markComputeStart(generation: number): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  performance.mark(COMPUTE_START_MARK, { detail: { generation } })
}

export function createExecutor(deps: ExecutorDeps = {}): Executor {
  const scheduler: Scheduler = deps.scheduler ?? { yield: () => new Promise<void>((r) => setTimeout(r, 0)) }
  const cache = deps.cache ?? createLruCache()
  const sliceMs = deps.sliceMs ?? DEFAULT_SLICE_MS
  const now = deps.now ?? (() => performance.now())

  const listeners = new Set<() => void>()
  let snapshot: ExecutorSnapshot = { generation: 0, activeTab: TABS[0], tabs: { attack: IDLE, defense: IDLE, speed: IDLE } }
  let emitted = snapshot
  let current: Run | null = null
  let regulation: string | null = null
  let displaySp: SpTable | null = null
  let running = false
  let disposed = false

  function emit(): void {
    if (snapshot === emitted) return
    emitted = snapshot
    for (const l of [...listeners]) l()
  }

  function setTabState(tab: Tab, state: TabViewState): void {
    snapshot = { ...snapshot, tabs: { ...snapshot.tabs, [tab]: state } }
  }

  function fail(run: Run, tab: Tab, e: unknown, log = true): void {
    if (log) console.error(e)
    run.tabs[tab].fatal = true
    setTabState(tab, { kind: 'fatal', message: messageOf(e), generation: run.generation })
  }

  /** 이전 세대 뷰는 새 세대의 첫 카드 사건(카드가 생기거나 1·2단계 완료) 전까지 남긴다. */
  function publish(run: Run, tab: Tab, view: TabView): void {
    const prev = snapshot.tabs[tab]
    const first = view.cards.length > 0 || view.stage12Done
    if (prev.kind === 'view' && prev.superseded && !first) return
    setTabState(tab, { kind: 'view', view, generation: run.generation, superseded: false })
  }

  function assemble(run: Run, tab: Tab, sp: SpTable | null): void {
    const t = run.tabs[tab]
    if (t.plan === null || t.assembler === null || t.fatal) return
    try {
      const f = flags(t)
      publish(run, tab, t.assembler.assemble(t.results, sp ?? undefined))
      t.assembled = { version: t.version, sp, ...f }
    } catch (e) {
      fail(run, tab, e)
    }
  }

  /** 활성 탭은 바뀌었으면 조립, 다른 탭은 1·2단계 완료·전체 완료 전환 때만. 남은 일이 있으면 true. */
  function assembleAll(run: Run): boolean {
    let more = false
    for (const tab of TABS) {
      const t = run.tabs[tab]
      if (t.fatal) continue
      if (t.plan === null) {
        more = true
        continue
      }
      let f: { stage12Done: boolean; complete: boolean }
      try {
        f = flags(t)
      } catch (e) {
        fail(run, tab, e)
        continue
      }
      const a = t.assembled
      if (tab === snapshot.activeTab) {
        if (a === null || a.version !== t.version || a.sp !== displaySp) assemble(run, tab, displaySp)
      } else if ((a?.stage12Done ?? false) !== f.stage12Done || (a?.complete ?? false) !== f.complete) {
        assemble(run, tab, null)
      }
      if (!f.complete && !t.fatal) more = true
    }
    return more
  }

  function nextUnit(run: Run): Unit | null {
    for (const [tab, stage, tier] of priority(snapshot.activeTab)) {
      const t = run.tabs[tab]
      if (t.fatal) continue
      if (t.plan === null) return { tab, kind: 'plan' }
      try {
        const task = take(t, stage, tier)
        if (task !== null) return { tab, kind: 'task', task }
      } catch (e) {
        fail(run, tab, e)
      }
    }
    return null
  }

  function execute(run: Run, unit: Unit): void {
    const t = run.tabs[unit.tab]
    try {
      if (unit.kind === 'plan') {
        const plan = planTab(run.input, unit.tab)
        t.plan = plan
        t.assembler = createTabAssembler(plan)
        t.primary = primaryCardIds(plan)
        refresh(t)
        return
      }
      if (t.plan === null || t.assembler === null) throw new Error(`${unit.tab} 탭 계획 없이 작업이 나왔다`)
      t.results.set(taskKey(unit.task), computeRowTask(t.plan, unit.task, cache))
      t.assembler.invalidate(taskCardId(t.plan, unit.task))
      t.version++
      const k = unit.task.kind
      if (k === 'probe' || k === 'fixed' || k === 'ends' || k === 'extreme' || mayUnlockPair(t.plan, t.results, unit.task)) t.dirty = true
    } catch (e) {
      fail(run, unit.tab, e)
    }
  }

  /** 첫 단위는 예산과 무관하게 실행한다(조각마다 진전 보장). */
  function slice(run: Run): boolean {
    const start = now()
    if (!run.marked) {
      run.marked = true
      markComputeStart(run.generation)
    }
    let worked = false
    while (!worked || now() - start < sliceMs) {
      const unit = nextUnit(run)
      if (unit === null) break
      execute(run, unit)
      worked = true
    }
    return assembleAll(run)
  }

  async function loop(): Promise<void> {
    try {
      for (;;) {
        await scheduler.yield()
        const run = current
        if (disposed || run === null) return
        const more = slice(run)
        emit()
        if (!more) return
      }
    } catch (e) {
      console.error(e)
      const run = current
      if (run !== null && !disposed) {
        for (const tab of TABS) {
          const t = run.tabs[tab]
          if (!t.fatal && !(t.assembled?.complete ?? false)) fail(run, tab, e, false)
        }
        emit()
      }
    } finally {
      running = false
    }
  }

  function ensureLoop(): void {
    if (running || disposed) return
    running = true
    void loop()
  }

  function refreshActive(): void {
    const run = current
    if (run === null) return
    const tab = snapshot.activeTab
    const a = run.tabs[tab].assembled
    if (a !== null && a.version === run.tabs[tab].version && a.sp === displaySp) return
    assemble(run, tab, displaySp)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return snapshot
    },
    setInput(input, generation) {
      if (disposed) return
      if (current !== null && current.generation === generation) return
      const reg = input.game.manifest.regulation.id
      if (regulation !== null && regulation !== reg) cache.clear()
      regulation = reg
      displaySp = null
      current = { input, generation, marked: false, tabs: { attack: newTabRun(), defense: newTabRun(), speed: newTabRun() } }
      const tabs = { ...snapshot.tabs }
      for (const tab of TABS) {
        const s = tabs[tab]
        tabs[tab] = s.kind === 'view' ? (s.superseded ? s : { ...s, superseded: true }) : IDLE
      }
      snapshot = { ...snapshot, generation, tabs }
      emit()
      ensureLoop()
    },
    setActiveTab(tab) {
      if (disposed || tab === snapshot.activeTab) return
      snapshot = { ...snapshot, activeTab: tab }
      refreshActive()
      emit()
    },
    setDisplaySp(sp) {
      if (disposed || sp === displaySp) return
      displaySp = sp
      refreshActive()
      emit()
    },
    dispose() {
      disposed = true
      current = null
      listeners.clear()
    },
  }
}
