// 공격·방어 탭의 행 작업을 시간 조각으로 나눠 계산하고 탭 뷰를 외부 저장소로 내는 실행기(React 없음). 스피드 탭은 계산하지 않는다.
// 컷 고정이 있으면 탭 계획 전에 공격·방어 고정을 고정 레인에서 해석한다(스피드 고정 해석은 입력으로 받는다).
import {
  DAMAGE_TABS,
  TABS,
  computeRowTask,
  createLruCache,
  createTabAssembler,
  deriveLocks,
  findLockTarget,
  isDamageTab,
  laneInput,
  laneResolution,
  laneTasks,
  lockedInput,
  opponentKey,
  planTab,
  primaryCardIds,
  taskCardId,
  taskKey,
} from '../cards'
import type {
  CardInput,
  CutLock,
  DamageTab,
  JudgementCache,
  LockDerivation,
  LockResolution,
  LockStatus,
  LockTargetRef,
  PendingTasks,
  RowTask,
  RowTaskResult,
  Tab,
  TabAssembler,
  TabPlan,
  TabView,
} from '../cards'
import type { PokemonSet, SpTable } from '../core'
import type { Scheduler } from './scheduler'

export type TabViewState =
  | { kind: 'idle' }
  /** superseded: 새 세대의 첫 카드 사건 전까지 이전 세대 뷰를 유지 중 */
  | { kind: 'view'; view: TabView; generation: number; superseded: boolean }
  | { kind: 'fatal'; message: string; generation: number }

/** 한 실행의 컷 고정 입력. speed = 스피드 고정 seq → 해석(실행기 밖에서 구한다), baseChoice = 사용자가 고른 기준 갈래(내 세트 고정 줄 ▲) */
export interface LockRun {
  locks: readonly CutLock[]
  speed: ReadonlyMap<number, LockResolution>
  baseChoice: string | null
}

/**
 * 그 실행 세대의 고정 파생. pending = 공격·방어 고정 레인이 아직 끝나지 않음(lane = 끝난 레인 단위 / 지금 아는 전체).
 * planSet = 기준 갈래 값이 적힌 계획 세트(활성 고정이 없으면 null), resolutions = 고정 seq → 해석(레인 + 스피드)
 */
export type LockSnapshot =
  | { generation: number; pending: true; lane: { done: number; total: number } }
  | { generation: number; pending: false; derivation: LockDerivation; resolutions: ReadonlyMap<number, LockResolution>; planSet: PokemonSet | null }

export interface ExecutorSnapshot {
  generation: number
  activeTab: Tab
  /** speed는 늘 idle(스피드 차트는 실행기 밖에서 계산한다) */
  tabs: Readonly<Record<Tab, TabViewState>>
  /** 고정이 없는 실행이면 null */
  locks: LockSnapshot | null
}

export interface Executor {
  subscribe(listener: () => void): () => void
  /** 바뀔 때만 새 객체 */
  getSnapshot(): ExecutorSnapshot
  /** 세대가 바뀌면 진행 중 작업 결과를 버리고 공격·방어 탭을 다시 계획한다. 같은 세대면 무시.
   *  새 세대는 표시용 SP를 비운다(이전 세대 뷰는 다시 조립하지 않고 그대로 둔다).
   *  input은 고정 전 초안이 든 입력이다. locks에 고정이 하나 이상이면 고정 레인을 탭 계획보다 먼저 끝내고 기준 갈래 계획 입력(cards lockedInput)으로
   *  계획한다. locks가 없거나 비면 고정 없는 경로와 같다 */
  setInput(input: CardInput, generation: number, locks?: LockRun): void
  /** 우선순위만 바꾼다(재계획 없음) */
  setActiveTab(tab: Tab): void
  /** 드래그 표시용 SP. 활성 탭(공격·방어)만 다시 조립(행 작업 없음). null이면 계획 시점 SP */
  setDisplaySp(sp: SpTable | null): void
  /**
   * 사용자 기술 선택(상대 키 → 항목 키). 계산 입력이 아니다: 세대를 바꾸지 않고, 선택이 바뀐 상대의 카드만 다시 조립하며
   * 그 항목의 행 작업을 맨 앞 층(수요)에 넣는다. 세대가 바뀌어도 유지된다. speed면 무시
   */
  setSelections(tab: Tab, selections: ReadonlyMap<string, string>): void
  /**
   * 기술 선택 메뉴를 연 카드 id(그 줄 분류 기본 배분 카드들, 닫으면 빈 목록). 계산 입력이 아니다: 세대를 바꾸지 않고
   * 그 카드 모든 항목의 변동 판정 작업을 사용자 선택 바로 다음 층(수요)에 넣는다. 완료 판정에는 세지 않고(진행률 숫자는 메뉴 결과만큼 늘 수 있다), 나온 결과는 그 세대 동안 남는다. speed면 무시
   */
  setMenuCards(tab: Tab, cardIds: readonly string[]): void
  /**
   * 조정 팝오버·핀 단계 메뉴를 연 카드 id. 계산 입력이 아니다: 세대를 바꾸지 않고, 그 카드 고정 후보·조정 모델의 대기 작업(TabAssembler.candidates)을
   * 메뉴 층(완료 판정 밖)에 넣는다. 세대가 바뀌어도 유지된다. speed면 무시
   */
  setDetailCards(tab: Tab, cardIds: readonly string[]): void
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
/**
 * 0 = 사용자가 기술을 고른 상대의 카드(수요), 1 = 기술 선택 메뉴를 연 카드의 항목 변동 판정과 조정 팝오버·핀 메뉴를 연 카드의 고정 후보·조정 대기 작업(수요, 완료 판정 밖),
 * 2 = 먼저 계산할 카드(primaryCardIds: 상대·분류마다 최대 묶음·사용자 추가·커스텀), 3 = 나머지 묶음
 */
type Tier = 0 | 1 | 2 | 3
const STAGE_KEYS = ['stage1', 'stage2', 'stage3', 'stage4', 'stage5'] as const
/** 진행률·완료에 세는 층 */
const COUNTED_TIERS: readonly Tier[] = [0, 2, 3]
const MENU_TIER = 1
const STAGES: readonly Stage[] = [0, 1, 2, 3, 4]
type Pos = [number, number, number, number, number]
type Tiers<T> = [T, T, T, T]
const zeroPos = (): Tiers<Pos> => [
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
]

interface TabRun {
  plan: TabPlan | null
  /** 카드별 남은 작업·조립 캐시(결과가 바뀐 카드만 다시 계산) */
  assembler: TabAssembler | null
  primary: ReadonlySet<string>
  /** 사용자가 기술을 고른 상대 키(수요 층) */
  demand: ReadonlySet<string>
  /** 기술 선택 메뉴를 연 카드 id(메뉴 층) */
  menu: ReadonlySet<string>
  /** 조정 팝오버·핀 메뉴를 연 카드 id(메뉴 층에 고정 후보·조정 대기 작업) */
  detail: ReadonlySet<string>
  selections: ReadonlyMap<string, string>
  results: Map<string, RowTaskResult>
  /** 층별 마지막 남은 작업 목록과 단계별 소비 위치 */
  queue: Tiers<PendingTasks>
  pos: Tiers<Pos>
  /** 새 결과(기본 항목 결정·필터 통과·쌍 준비 등)나 선택 변경이 대기열을 바꿨을 수 있음 */
  dirty: boolean
  fatal: boolean
  /** 결과가 늘 때마다 +1 */
  version: number
  assembled: { version: number; sp: SpTable | null; stage12Done: boolean; complete: boolean } | null
}

/** 공격·방어 고정 하나의 레인. resolution이 정해지면 끝 */
interface LaneLock {
  lock: CutLock & { kind: DamageTab }
  plan: TabPlan | null
  target: LockTargetRef | null
  tasks: readonly RowTask[]
  next: number
  results: Map<string, RowTaskResult>
  resolution: LockResolution | null
}

interface Run {
  /** 탭 계획 입력. 레인이 끝나기 전에는 고정 전 입력이다 */
  input: CardInput
  generation: number
  marked: boolean
  tabs: Record<DamageTab, TabRun>
  lock: LockRun | null
  /** 레인(없거나 끝나 파생까지 마쳤으면 null) */
  lane: LaneLock[] | null
}

type Unit =
  | { tab: DamageTab; kind: 'plan' }
  | { tab: DamageTab; kind: 'task'; task: RowTask }
  | { kind: 'lock-plan'; seq: number }
  | { kind: 'lock-task'; seq: number; task: RowTask }
type Slot = readonly [DamageTab, Stage, Tier]

const EMPTY_QUEUE: PendingTasks = { stage1: [], stage2: [], stage3: [], stage4: [], stage5: [] }
const IDLE: TabViewState = { kind: 'idle' }

function newTabRun(): TabRun {
  return {
    plan: null,
    assembler: null,
    primary: new Set(),
    demand: new Set(),
    menu: new Set(),
    detail: new Set(),
    selections: new Map(),
    results: new Map(),
    queue: [EMPTY_QUEUE, EMPTY_QUEUE, EMPTY_QUEUE, EMPTY_QUEUE],
    pos: zeroPos(),
    dirty: false,
    fatal: false,
    version: 0,
    assembled: null,
  }
}

/**
 * 활성 탭 수요(사용자가 고른 기술의 카드, 모든 단계 → 메뉴를 연 카드의 항목 변동 판정) → 활성 탭 1·2단계(먼저 계산할 카드 → 나머지 묶음) → 나머지 탭(DAMAGE_TABS 순) 수요·1·2단계 →
 * 활성 탭 3·4·5단계(확인 스윕·성격 변형·쌍) → 나머지 탭 3·4·5단계. 3·4·5단계도 단계마다 먼저 계산할 카드가 앞선다.
 * 활성 탭이 speed면 공격·방어 탭 모두 나머지 탭이다.
 */
function priority(active: Tab): readonly Slot[] {
  const first = DAMAGE_TABS.filter((t) => t === active)
  const others = DAMAGE_TABS.filter((t) => t !== active)
  // 고정 후보·조정 대기 작업은 4·5단계다(메뉴 항목 변동 판정은 1·2단계만 낸다)
  const menu = (t: DamageTab): Slot[] => [[t, 0, 1], [t, 1, 1], [t, 3, 1], [t, 4, 1]]
  const early = (t: DamageTab): Slot[] => [...STAGES.map((s): Slot => [t, s, 0]), ...menu(t), [t, 0, 2], [t, 1, 2], [t, 0, 3], [t, 1, 3]]
  const late = (t: DamageTab): Slot[] => ([2, 3, 4] as const).flatMap((s) => ([2, 3] as const).map((tier): Slot => [t, s, tier]))
  return [...first.flatMap(early), ...others.flatMap(early), ...first.flatMap(late), ...others.flatMap(late)]
}

function mergeQueues(a: PendingTasks, b: PendingTasks): PendingTasks {
  return {
    stage1: [...a.stage1, ...b.stage1],
    stage2: [...a.stage2, ...b.stage2],
    stage3: [...a.stage3, ...b.stage3],
    stage4: [...a.stage4, ...b.stage4],
    stage5: [...a.stage5, ...b.stage5],
  }
}

/** 연 카드들의 고정 후보·조정 대기 작업. 연 카드가 없으면 null */
function lockDemandOf(t: TabRun): PendingTasks | null {
  if (t.plan === null || t.assembler === null || t.detail.size === 0) return null
  return t.assembler.candidates(t.results, t.detail)
}

function refresh(t: TabRun): void {
  if (t.plan === null || t.assembler === null) return
  const { primary, demand, plan } = t
  const demanded = new Set(plan.cards.filter((c) => demand.has(opponentKey(c.opponent))).map((c) => c.id))
  const menu = t.menu.size === 0 ? EMPTY_QUEUE : t.assembler.explore(t.results, t.menu)
  const detail = lockDemandOf(t)
  t.queue = [
    t.assembler.pending(t.results, (id) => demanded.has(id)),
    detail === null ? menu : mergeQueues(menu, detail),
    t.assembler.pending(t.results, (id) => !demanded.has(id) && primary.has(id)),
    t.assembler.pending(t.results, (id) => !demanded.has(id) && !primary.has(id)),
  ]
  t.pos = zeroPos()
  t.dirty = false
}

function remaining(t: TabRun, stage: Stage, tiers: readonly Tier[] = COUNTED_TIERS): number {
  return tiers.reduce<number>((n, tier) => n + t.queue[tier][STAGE_KEYS[stage]].length - t.pos[tier][stage], 0)
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

/** menuLeft = 메뉴 층에 남은 작업이 있음(완료와 따로: 완료 뒤에도 메뉴를 열면 계산을 이어 간다) */
function flags(t: TabRun): { stage12Done: boolean; complete: boolean; menuLeft: boolean } {
  if (t.dirty) refresh(t)
  const stage12Done = remaining(t, 0) === 0 && remaining(t, 1) === 0
  const menuLeft = STAGES.some((s) => remaining(t, s, [MENU_TIER]) > 0)
  return { stage12Done, complete: stage12Done && remaining(t, 2) === 0 && remaining(t, 3) === 0 && remaining(t, 4) === 0, menuLeft }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function markComputeStart(generation: number): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  performance.mark(COMPUTE_START_MARK, { detail: { generation } })
}

const isLaneLock = (l: CutLock): l is CutLock & { kind: DamageTab } => l.kind !== 'speed'

const unreachable = (e: unknown): LockResolution => ({ kind: 'unreachable', reason: messageOf(e) })

/** 파생 자체가 실패한 실행: 모든 고정을 계산 불가로 두고 고정 없는 계획으로 간다 */
function failedDerivation(locks: readonly CutLock[], e: unknown): LockDerivation {
  const status: LockStatus = { kind: 'unreachable', reason: messageOf(e) }
  return { locks: [...locks].sort((a, b) => a.seq - b.seq), statuses: new Map(locks.map((l) => [l.seq, status])), branches: [], baseId: null, lockedStats: [], overTotal: 0 }
}

/** 끝난 레인 단위 수 / 지금 아는 전체(고정마다 미니 계획 1 + 레인 작업) */
function laneProgress(lane: readonly LaneLock[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const l of lane) {
    const units = 1 + l.tasks.length
    total += units
    done += l.resolution !== null ? units : (l.plan === null ? 0 : 1) + l.next
  }
  return { done, total }
}

/** laneResolution의 예외(결과 누락 등)도 그 고정의 계산 불가로 흡수한다 */
function settleLane(l: LaneLock): void {
  if (l.plan === null) return
  try {
    l.resolution = laneResolution(l.plan, l.lock, l.target, l.results)
  } catch (e) {
    l.resolution = unreachable(e)
  }
}

export function createExecutor(deps: ExecutorDeps = {}): Executor {
  const scheduler: Scheduler = deps.scheduler ?? { yield: () => new Promise<void>((r) => setTimeout(r, 0)) }
  const cache = deps.cache ?? createLruCache()
  const sliceMs = deps.sliceMs ?? DEFAULT_SLICE_MS
  const now = deps.now ?? (() => performance.now())

  const listeners = new Set<() => void>()
  let snapshot: ExecutorSnapshot = { generation: 0, activeTab: TABS[0], tabs: { attack: IDLE, defense: IDLE, speed: IDLE }, locks: null }
  let emitted = snapshot
  let current: Run | null = null
  let regulation: string | null = null
  let displaySp: SpTable | null = null
  const selections: Record<DamageTab, ReadonlyMap<string, string>> = { attack: new Map(), defense: new Map() }
  const menus: Record<DamageTab, ReadonlySet<string>> = { attack: new Set(), defense: new Set() }
  const details: Record<DamageTab, ReadonlySet<string>> = { attack: new Set(), defense: new Set() }
  let running = false
  let disposed = false

  function emit(): void {
    if (snapshot === emitted) return
    emitted = snapshot
    for (const l of [...listeners]) l()
  }

  function setTabState(tab: DamageTab, state: TabViewState): void {
    snapshot = { ...snapshot, tabs: { ...snapshot.tabs, [tab]: state } }
  }

  function fail(run: Run, tab: DamageTab, e: unknown, log = true): void {
    if (log) console.error(e)
    run.tabs[tab].fatal = true
    setTabState(tab, { kind: 'fatal', message: messageOf(e), generation: run.generation })
  }

  /** 이전 세대 뷰는 새 세대의 첫 카드 사건(카드가 생기거나 1·2단계 완료) 전까지 남긴다. */
  function publish(run: Run, tab: DamageTab, view: TabView): void {
    const prev = snapshot.tabs[tab]
    const first = view.cards.length > 0 || view.stage12Done
    if (prev.kind === 'view' && prev.superseded && !first) return
    setTabState(tab, { kind: 'view', view, generation: run.generation, superseded: false })
  }

  function assemble(run: Run, tab: DamageTab, sp: SpTable | null): void {
    const t = run.tabs[tab]
    if (t.plan === null || t.assembler === null || t.fatal) return
    try {
      const { stage12Done, complete } = flags(t)
      publish(run, tab, t.assembler.assemble(t.results, sp ?? undefined))
      t.assembled = { version: t.version, sp, stage12Done, complete }
    } catch (e) {
      fail(run, tab, e)
    }
  }

  /** 활성 탭은 바뀌었으면 조립, 다른 탭은 1·2단계 완료·전체 완료 전환 때만. 남은 일이 있으면 true. */
  function assembleAll(run: Run): boolean {
    let more = false
    for (const tab of DAMAGE_TABS) {
      const t = run.tabs[tab]
      if (t.fatal) continue
      if (t.plan === null) {
        more = true
        continue
      }
      let f: ReturnType<typeof flags>
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
      if ((!f.complete || f.menuLeft) && !t.fatal) more = true
    }
    return more
  }

  /** 레인이 모두 끝났으면 파생하고 탭 계획 입력을 기준 갈래 계획 입력으로 바꾼다(활성 고정이 없으면 입력 그대로) */
  function finishLane(run: Run): void {
    const lane = run.lane
    const lock = run.lock
    if (lane === null || lock === null) return
    const byLane = new Map<number, LockResolution>()
    for (const l of lane) {
      if (l.resolution === null) return
      byLane.set(l.lock.seq, l.resolution)
    }
    const resolutions = new Map<number, LockResolution>()
    for (const l of lock.locks) {
      const r = l.kind === 'speed' ? lock.speed.get(l.seq) : byLane.get(l.seq)
      if (r !== undefined) resolutions.set(l.seq, r)
    }
    let derivation: LockDerivation
    let planned: CardInput
    try {
      derivation = deriveLocks({ game: run.input.game, mySet: run.input.mySet, locks: lock.locks, resolutions, baseChoice: lock.baseChoice })
      planned = lockedInput(run.input, derivation)
    } catch (e) {
      console.error(e)
      derivation = failedDerivation(lock.locks, e)
      for (const l of lock.locks) resolutions.set(l.seq, unreachable(e))
      planned = run.input
    }
    run.input = planned
    run.lane = null
    const planSet = planned.lock === undefined ? null : planned.mySet
    snapshot = { ...snapshot, locks: { generation: run.generation, pending: false, derivation, resolutions, planSet } }
  }

  function nextLaneUnit(lane: readonly LaneLock[]): Unit | null {
    for (const l of lane) {
      if (l.resolution !== null) continue
      if (l.plan === null) return { kind: 'lock-plan', seq: l.lock.seq }
      if (l.next < l.tasks.length) return { kind: 'lock-task', seq: l.lock.seq, task: l.tasks[l.next] }
    }
    return null
  }

  /** 코어 오류는 laneResolution이 상태로 흡수하고, 그 밖의 예외는 그 고정만 계산 불가로 둔다 */
  function executeLane(run: Run, unit: Extract<Unit, { kind: 'lock-plan' | 'lock-task' }>): void {
    const l = run.lane?.find((x) => x.lock.seq === unit.seq)
    if (l === undefined) return
    try {
      if (unit.kind === 'lock-plan') {
        const plan = planTab(laneInput(run.input, l.lock), l.lock.kind)
        l.plan = plan
        l.target = plan.status.kind === 'ok' ? findLockTarget(plan, l.lock) : null
        l.tasks = l.target === null ? [] : laneTasks(plan, l.lock, l.target)
      } else if (l.plan !== null) {
        l.next++
        l.results.set(taskKey(unit.task), computeRowTask(l.plan, unit.task, cache))
      }
      if (l.next >= l.tasks.length) settleLane(l)
    } catch (e) {
      l.resolution = unreachable(e)
    }
    finishLane(run)
  }

  function nextUnit(run: Run): Unit | null {
    if (run.lane !== null) return nextLaneUnit(run.lane)
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
    if (unit.kind === 'lock-plan' || unit.kind === 'lock-task') return executeLane(run, unit)
    const t = run.tabs[unit.tab]
    try {
      if (unit.kind === 'plan') {
        const plan = planTab(run.input, unit.tab)
        t.plan = plan
        t.assembler = createTabAssembler(plan, selections[unit.tab], { lockControls: true, adjust: true })
        t.primary = primaryCardIds(plan)
        t.demand = new Set(selections[unit.tab].keys())
        t.selections = selections[unit.tab]
        t.menu = menus[unit.tab]
        t.detail = details[unit.tab]
        refresh(t)
        return
      }
      if (t.plan === null || t.assembler === null) throw new Error(`${unit.tab} 탭 계획 없이 작업이 나왔다`)
      t.results.set(taskKey(unit.task), computeRowTask(t.plan, unit.task, cache))
      t.assembler.invalidate(taskCardId(t.plan, unit.task))
      t.version++
      // 어떤 결과든 기본 항목 결정(변동 판정)·필터 통과·쌍 준비로 그 카드의 남은 작업을 바꿀 수 있다(카드 단위 조립 캐시라 다시 내기는 싸다).
      t.dirty = true
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
    if (run.lane !== null) {
      const lane = laneProgress(run.lane)
      const prev = snapshot.locks
      if (prev === null || !prev.pending || prev.lane.done !== lane.done || prev.lane.total !== lane.total) {
        snapshot = { ...snapshot, locks: { generation: run.generation, pending: true, lane } }
      }
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
        for (const tab of DAMAGE_TABS) {
          const t = run.tabs[tab]
          if (!t.fatal && !(t.assembled?.complete ?? false)) fail(run, tab, e, false)
        }
        if (run.lock !== null && snapshot.locks?.pending === true) {
          const derivation = failedDerivation(run.lock.locks, e)
          const resolutions = new Map(run.lock.locks.map((l) => [l.seq, unreachable(e)]))
          snapshot = { ...snapshot, locks: { generation: run.generation, pending: false, derivation, resolutions, planSet: null } }
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
    if (!isDamageTab(tab)) return
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
    setInput(input, generation, locks) {
      if (disposed) return
      if (current !== null && current.generation === generation) return
      const reg = input.game.manifest.regulation.id
      if (regulation !== null && regulation !== reg) cache.clear()
      regulation = reg
      displaySp = null
      const lock = locks !== undefined && locks.locks.length > 0 ? locks : null
      const lane =
        lock === null
          ? null
          : lock.locks.filter(isLaneLock).map((l): LaneLock => ({ lock: l, plan: null, target: null, tasks: [], next: 0, results: new Map(), resolution: null }))
      const run: Run = { input, generation, marked: false, tabs: { attack: newTabRun(), defense: newTabRun() }, lock, lane }
      current = run
      const tabs = { ...snapshot.tabs }
      for (const tab of DAMAGE_TABS) {
        const s = tabs[tab]
        tabs[tab] = s.kind === 'view' ? (s.superseded ? s : { ...s, superseded: true }) : IDLE
      }
      snapshot = { ...snapshot, generation, tabs, locks: lane === null ? null : { generation, pending: true, lane: laneProgress(lane) } }
      // 스피드 고정만이면 레인이 비어 여기서 바로 파생한다
      finishLane(run)
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
    setSelections(tab, next) {
      if (disposed || !isDamageTab(tab)) return
      selections[tab] = next
      const t = current?.tabs[tab]
      if (current === null || t === undefined || t.assembler === null || t.fatal) return
      t.demand = new Set(next.keys())
      t.selections = next
      if (!t.assembler.setSelections(next)) return
      t.version++
      t.dirty = true
      if (tab === snapshot.activeTab) refreshActive()
      else assemble(current, tab, null)
      emit()
      ensureLoop()
    },
    setMenuCards(tab, cardIds) {
      if (disposed || !isDamageTab(tab)) return
      const next = new Set(cardIds)
      const prev = menus[tab]
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return
      menus[tab] = next
      const t = current?.tabs[tab]
      if (current === null || t === undefined || t.assembler === null || t.fatal) return
      t.menu = next
      t.dirty = true
      ensureLoop()
    },
    setDetailCards(tab, cardIds) {
      if (disposed || !isDamageTab(tab)) return
      const next = new Set(cardIds)
      const prev = details[tab]
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return
      details[tab] = next
      const t = current?.tabs[tab]
      if (current === null || t === undefined || t.assembler === null || t.fatal) return
      t.detail = next
      t.dirty = true
      ensureLoop()
    },
    dispose() {
      disposed = true
      current = null
      listeners.clear()
    },
  }
}
