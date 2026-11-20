import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DAMAGE_TABS,
  buildLockedTabView,
  buildTabView,
  cardItems,
  computeRowTask,
  createLruCache,
  deriveLocks,
  lockTargetKeyOf,
  lockedInput,
  planTab,
  resolveLaneLock,
  taskCardId,
  type CardInput,
  type CardSpec,
  type CutLock,
  type DamageTab,
  type JudgementCache,
  type LockResolution,
  type TabPlan,
  type TabView,
} from '../cards'
import { cardInput, realData } from '../cards/testing'
import { tierRank, type PokemonSet } from '../core'
import { createExecutor } from './executor'
import type { Executor, ExecutorSnapshot, LockRun, TabViewState } from './executor'
import type { Scheduler } from './scheduler'

// 실행기가 부르는 계획·행 작업을 보기 위해 원래 구현을 감싼 스파이(동작은 같다).
vi.mock('../cards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../cards')>()
  return { ...mod, computeRowTask: vi.fn(mod.computeRowTask), planTab: vi.fn(mod.planTab), deriveLocks: vi.fn(mod.deriveLocks) }
})

/** 실행기는 고정이 없어도 고정 조작과 조정 모델을 낸다(AssembleOptions.lockControls·adjust) */
const CONTROLS = { lockControls: true, adjust: true } as const
const { game, bo1, bo3 } = realData()
const reg = game.manifest.regulation.id
const raichu = (moves: string[] = ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch']): PokemonSet => ({
  regulation: reg,
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  mega: true,
  nature: 'hardy',
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moves,
})
const input = (topN: number, mySet: PokemonSet = raichu(), view = bo1): CardInput => cardInput({ mySet, view, filters: { topN, selected: [] } })

const speedTarget: CutLock['target'] = { kind: 'speed', origin: 'ladder', opponentId: 'garchomp', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null }
const speedLock = (seq: number): CutLock => ({ seq, kind: 'speed', target: speedTarget, stage: 'first', stats: ['spe'] })
const speedOk: LockResolution = { kind: 'ok', options: { shape: 'single', stat: 'spe', neutral: 20, plus: 12 } }

function manualScheduler() {
  const waiters: Array<() => void> = []
  const scheduler: Scheduler = { yield: () => new Promise<void>((r) => waiters.push(r)) }
  return {
    scheduler,
    async step(): Promise<boolean> {
      const w = waiters.shift()
      if (w === undefined) return false
      w()
      await new Promise((r) => setTimeout(r, 0))
      return true
    },
  }
}

async function runToEnd(m: ReturnType<typeof manualScheduler>, onStep?: () => void): Promise<void> {
  while (await m.step()) onStep?.()
}

function tickingClock(step = 1) {
  let t = 0
  return () => (t += step) - step
}

function countingCache(): JudgementCache & { hits: number; misses: number } {
  const inner = createLruCache()
  const c = {
    hits: 0,
    misses: 0,
    get(key: string) {
      const v = inner.get(key)
      if (v === undefined) c.misses++
      else c.hits++
      return v
    },
    set: inner.set.bind(inner),
    clear: inner.clear.bind(inner),
    get size() {
      return inner.size
    },
  }
  return c
}

function viewOf(s: TabViewState): TabView {
  if (s.kind !== 'view') throw new Error(`뷰가 아니다: ${s.kind}`)
  return s.view
}

function derived(s: ExecutorSnapshot) {
  const l = s.locks
  if (l === null || l.pending) throw new Error('파생이 없다')
  return l
}

/** 카드마다 랭크 전 첫 스윕 행·필터 항목 */
function shownRefs(plan: TabPlan, limit: number): { card: CardSpec; key: string; id: string }[] {
  const out: { card: CardSpec; key: string; id: string }[] = []
  for (const card of plan.cards) {
    if (card.state !== 'ok' || card.berry !== undefined) continue
    const ref = cardItems(plan, card).find((r) => r.rankBefore && (r.candidate.target === 'filter' || (r.candidate.target === 'row' && plan.rows[r.candidate.id].error === undefined)))
    if (ref !== undefined) out.push({ card, key: ref.key, id: ref.candidate.id })
    if (out.length >= limit) break
  }
  return out
}

const attackPlan = planTab(input(8), 'attack')
const defensePlan = planTab(input(8), 'defense')
const [attackRef] = shownRefs(attackPlan, 1)
const [defenseRef] = shownRefs(defensePlan, 1)
const attackLock = (seq: number): CutLock => ({
  seq,
  kind: 'attack',
  target: lockTargetKeyOf('attack', attackRef.card, attackRef.key),
  stage: 'high-roll-ohko',
  stats: [attackPlan.rows[attackRef.id].sweep?.stat ?? 'spa'],
})
const defenseLock = (seq: number): CutLock => ({
  seq,
  kind: 'defense',
  target: lockTargetKeyOf('defense', defenseRef.card, defenseRef.key),
  stage: 'guaranteed-survive',
  stats: ['hp', defensePlan.filters[defenseRef.id].stats[1]],
})

const run = (locks: CutLock[], speed: [number, LockResolution][] = [], baseChoice: string | null = null): LockRun => ({ locks, speed: new Map(speed), baseChoice })

/**
 * 진행률과 보이지 않는 항목의 변동 여부를 뺀 뷰. 조각 경계에서 대기열을 다시 만들면 이미 정해진 기본 항목 밖 항목의 결정용 작업을 건너뛸 수 있어
 * 그 두 값만 batch와 달라질 수 있다(판정·표시는 같다).
 */
function comparable(v: TabView) {
  return {
    ...v,
    progress: null,
    cards: v.cards.map((c) => ({ ...c, items: c.items.map((i) => (i.key === c.shownItem ? i : { ...i, variable: undefined })) })),
  }
}

function expectSameAsLocked(s: TabViewState, inp: CardInput, tab: DamageTab, lockRun: LockRun): void {
  const got = viewOf(s)
  const { derivation } = buildLockedTabView(inp, tab, lockRun.locks, lockRun.speed, lockRun.baseChoice)
  const want = buildTabView(lockedInput(inp, derivation), tab, undefined, undefined, CONTROLS)
  expect(comparable(got)).toEqual(comparable(want))
  expect(got.progress.done).toBe(got.progress.total)
}

const computeSpy = vi.mocked(computeRowTask)
const planSpy = vi.mocked(planTab)

let executor: Executor | undefined
beforeEach(() => {
  computeSpy.mockClear()
  planSpy.mockClear()
})
afterEach(() => {
  executor?.dispose()
  executor = undefined
})

describe('실행기: 고정이 없으면 기존 경로', () => {
  it('locks 없음과 빈 locks의 스냅샷 사건 열·행 작업 열이 같고 locks는 null', async () => {
    const record = async (locks: LockRun | undefined) => {
      computeSpy.mockClear()
      const m = manualScheduler()
      const ex = createExecutor({ scheduler: m.scheduler, cache: createLruCache(), sliceMs: 3, now: tickingClock() })
      const snaps: ExecutorSnapshot[] = []
      ex.subscribe(() => snaps.push(ex.getSnapshot()))
      ex.setInput(input(3), 1, locks)
      await runToEnd(m)
      ex.dispose()
      return { snaps, tasks: computeSpy.mock.calls.map(([, t]) => t) }
    }
    const none = await record(undefined)
    const empty = await record(run([]))
    expect(empty.snaps).toEqual(none.snaps)
    expect(empty.tasks).toEqual(none.tasks)
    expect(none.snaps.every((s) => s.locks === null)).toBe(true)
    for (const tab of DAMAGE_TABS) expect(comparable(viewOf(none.snaps[none.snaps.length - 1].tabs[tab]))).toEqual(comparable(buildTabView(input(3), tab, undefined, undefined, CONTROLS)))
  })
})

describe('실행기: 고정 레인', () => {
  it('레인이 탭 계획보다 먼저 끝나고, 그동안 탭 뷰는 없고 남은 작업으로 센다. 최종 뷰 = buildLockedTabView', async () => {
    const lockRun = run([attackLock(1), defenseLock(2), speedLock(3)], [[3, speedOk]])
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 1, now: tickingClock() })
    executor.setInput(input(8), 1, lockRun)
    expect(executor.getSnapshot().locks).toEqual({ generation: 1, pending: true, lane: { done: 0, total: 2 } })
    const seen: ExecutorSnapshot[] = []
    await runToEnd(m, () => seen.push(executor!.getSnapshot()))
    const pending = seen.filter((s) => s.locks?.pending === true)
    expect(pending.length).toBeGreaterThan(0)
    for (const s of pending) {
      for (const tab of DAMAGE_TABS) expect(s.tabs[tab].kind).toBe('idle')
      if (s.locks?.pending === true) expect(s.locks.lane.done).toBeLessThan(s.locks.lane.total)
    }

    const plans = planSpy.mock.calls.map(([inp]) => inp.lock?.mode ?? 'none')
    expect(plans.slice(0, 2)).toEqual(['lane', 'lane'])
    expect(plans.slice(2).every((mode) => mode === 'main')).toBe(true)
    const calls = computeSpy.mock.calls.map(([plan, task]) => ({ mode: plan.lock?.mode, task }))
    const laneCalls = calls.filter((c) => c.mode === 'lane')
    expect(calls.slice(0, laneCalls.length).every((c) => c.mode === 'lane')).toBe(true)
    // 공격 = 엄격 두 변형 재스윕, 방어 = 고정 단계 순위 하나의 계단(성격 2개)
    expect(laneCalls.filter((c) => c.task.kind === 'branch')).toHaveLength(2)
    const stairs = laneCalls.flatMap((c) => (c.task.kind === 'stairs' ? [c.task] : []))
    expect(stairs).toHaveLength(2)
    expect(new Set(stairs.map((t) => t.rank))).toEqual(new Set([tierRank('defense', 'guaranteed-survive')]))
    expect(laneCalls).toHaveLength(4)

    const snap = executor.getSnapshot()
    const d = derived(snap)
    expect(d.generation).toBe(1)
    expect(d.resolutions.get(1)).toEqual(resolveLaneLock(input(8), attackLock(1)))
    expect(d.resolutions.get(2)).toEqual(resolveLaneLock(input(8), defenseLock(2)))
    expect(d.resolutions.get(3)).toEqual(speedOk)
    expect(d.planSet?.sp.spe).toBe(20)
    for (const tab of DAMAGE_TABS) expectSameAsLocked(snap.tabs[tab], input(8), tab, lockRun)
  })

  it('스피드 고정만이면 레인 작업 없이 setInput에서 바로 파생한다', async () => {
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setInput(input(3), 1, run([speedLock(1)], [[1, speedOk]]))
    const d = derived(executor.getSnapshot())
    expect(d.derivation.baseId).toBe('out')
    expect(d.derivation.branches.map((b) => b.id)).toEqual(['plus:spe', 'out'])
    await runToEnd(m)
    expect(planSpy.mock.calls.every(([inp]) => inp.lock?.mode === 'main')).toBe(true)
  })

  it('레인 예외는 그 고정만 계산 불가로 흡수하고 탭은 계속한다', async () => {
    computeSpy.mockImplementationOnce(() => {
      throw new Error('레인 실패')
    })
    const lockRun = run([attackLock(1), speedLock(2)], [[2, speedOk]])
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setInput(input(4), 1, lockRun)
    await runToEnd(m)
    const snap = executor.getSnapshot()
    const d = derived(snap)
    expect(d.resolutions.get(1)).toEqual({ kind: 'unreachable', reason: '레인 실패' })
    expect(d.derivation.statuses.get(1)).toEqual({ kind: 'unreachable', reason: '레인 실패' })
    expect(d.derivation.statuses.get(2)).toEqual({ kind: 'active' })
    for (const tab of DAMAGE_TABS) expect(viewOf(snap.tabs[tab]).complete).toBe(true)
  })

  it('파생이 예외를 내면 모든 고정을 계산 불가로 두고(계산 중으로 남지 않음) 고정 없는 계획으로 간다', async () => {
    vi.mocked(deriveLocks).mockImplementationOnce(() => {
      throw new Error('파생 실패')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    const inp = input(3)
    executor.setInput(inp, 1, run([attackLock(1)]))
    await runToEnd(m)
    error.mockRestore()
    const d = derived(executor.getSnapshot())
    expect(d.derivation.statuses.get(1)).toEqual({ kind: 'unreachable', reason: '파생 실패' })
    expect(d.resolutions.get(1)).toEqual({ kind: 'unreachable', reason: '파생 실패' })
    expect(d.planSet).toBeNull()
    for (const tab of DAMAGE_TABS) expect(viewOf(executor.getSnapshot().tabs[tab]).complete).toBe(true)
  })

  it('표시 필터(상위 N) 밖 대상도 레인에서 해석한다', async () => {
    const wide = planTab(input(20), 'attack')
    const far = shownRefs(wide, 40).find((r) => (r.card.opponent.rank ?? 0) > 3)
    expect(far).toBeDefined()
    if (far === undefined) return
    const lock: CutLock = { seq: 1, kind: 'attack', target: lockTargetKeyOf('attack', far.card, far.key), stage: 'high-roll-ohko', stats: [wide.rows[far.id].sweep?.stat ?? 'spa'] }
    expect(planTab(input(1), 'attack').cards.some((c) => c.opponent.id === far.card.opponent.id)).toBe(false)
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setInput(input(1), 1, run([lock]))
    await runToEnd(m)
    const d = derived(executor.getSnapshot())
    expect(d.resolutions.get(1)).toEqual(resolveLaneLock(input(20), lock))
    expect(d.resolutions.get(1)?.kind).not.toBe('missing')
    const lanePlans = planSpy.mock.results.flatMap((r) => (r.type === 'return' && r.value.lock?.mode === 'lane' ? [r.value] : []))
    expect(lanePlans.map((p) => [...new Set(p.cards.map((c) => c.opponent.id))])).toEqual([[far.card.opponent.id]])
  })

  it('기준 갈래를 바꾼 새 세대: 레인 판정은 모두 캐시 적중(레인 성격은 계획 성격과 무관)', async () => {
    const cache = countingCache()
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, cache, sliceMs: 1, now: tickingClock() })
    executor.setInput(input(4), 1, run([speedLock(1), attackLock(2)], [[1, speedOk]]))
    await runToEnd(m)
    const first = derived(executor.getSnapshot())
    const other = first.derivation.branches.find((b) => b.id !== first.derivation.baseId)
    expect(other).toBeDefined()
    if (other === undefined) return

    cache.hits = 0
    cache.misses = 0
    executor.setInput(input(4), 2, run([speedLock(1), attackLock(2)], [[1, speedOk]], other.id))
    while (executor.getSnapshot().locks?.pending !== false) expect(await m.step()).toBe(true)
    const lane = { hits: cache.hits, misses: cache.misses }
    expect(lane).toEqual({ hits: 2, misses: 0 })
    await runToEnd(m)
    const second = derived(executor.getSnapshot())
    expect(second.generation).toBe(2)
    expect(second.derivation.baseId).toBe(other.id)
    expect(second.planSet?.nature).toBe(other.nature)
  })

  it('AC5 경로: 스피드 해석이 도달 불가가 되면 고정은 남고 계산에서 빠지며(무고정 뷰), 돌아오면 다시 들어간다', async () => {
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    const inp = input(3)
    executor.setInput(inp, 1, run([speedLock(1)], [[1, speedOk]]))
    await runToEnd(m)
    expect(derived(executor.getSnapshot()).derivation.statuses.get(1)).toEqual({ kind: 'active' })

    executor.setInput(inp, 2, run([speedLock(1)], [[1, { kind: 'unreachable' }]]))
    await runToEnd(m)
    const off = executor.getSnapshot()
    const d = derived(off)
    expect(d.derivation.locks.map((l) => l.seq)).toEqual([1])
    expect(d.derivation.statuses.get(1)).toEqual({ kind: 'unreachable' })
    expect(d.derivation.branches).toEqual([])
    expect(d.planSet).toBeNull()
    for (const tab of DAMAGE_TABS) expect(comparable(viewOf(off.tabs[tab]))).toEqual(comparable(buildTabView(inp, tab, undefined, undefined, CONTROLS)))

    executor.setInput(inp, 3, run([speedLock(1)], [[1, speedOk]]))
    await runToEnd(m)
    expect(derived(executor.getSnapshot()).derivation.statuses.get(1)).toEqual({ kind: 'active' })
  })

  it('AC10 경로: 통계(매치 방식)를 바꿔 대상 배분이 사라지면 대상 없음, 되돌리면 다시 활성', async () => {
    const bo3Plan = planTab(input(20, raichu(), bo3), 'attack')
    const bo3Bundles = new Set(bo3Plan.cards.map((c) => JSON.stringify([c.opponent.id, c.category, c.bundle.key])))
    const gone = shownRefs(planTab(input(20), 'attack'), 60).find((r) => !bo3Bundles.has(JSON.stringify([r.card.opponent.id, r.card.category, r.card.bundle.key])))
    expect(gone).toBeDefined()
    if (gone === undefined) return
    const lock: CutLock = { seq: 1, kind: 'attack', target: lockTargetKeyOf('attack', gone.card, gone.key), stage: 'high-roll-ohko', stats: ['spa'] }
    const statusAt = async (view: typeof bo1, generation: number) => {
      const m = manualScheduler()
      executor?.dispose()
      executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
      executor.setInput(input(3, raichu(), view), generation, run([lock]))
      await runToEnd(m)
      return derived(executor.getSnapshot()).derivation.statuses.get(1)?.kind
    }
    const first = await statusAt(bo1, 1)
    expect(first === 'active' || first === 'unreachable').toBe(true)
    expect(await statusAt(bo3, 2)).toBe('missing')
    expect(await statusAt(bo1, 3)).toBe(first)
  })
})

describe('실행기: setDetailCards', () => {
  it('조정을 연 카드의 갈래 재스윕(branch, 고정 밖 갈래 S20 덮어쓰기)을 돌리고 세대·완료는 그대로', async () => {
    const inp = input(4, raichu(['electroball']))
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setActiveTab('attack')
    executor.setInput(inp, 1, run([speedLock(1)], [[1, speedOk]], 'plus:spe'))
    await runToEnd(m)
    const before = viewOf(executor.getSnapshot().tabs.attack)
    expect(before.complete).toBe(true)
    computeSpy.mockClear()

    executor.setDetailCards('attack', before.cards.map((c) => c.id))
    await runToEnd(m)
    const snap = executor.getSnapshot()
    expect(snap.generation).toBe(1)
    const branch = computeSpy.mock.calls.filter(([plan, task]) => plan.lock?.mode === 'main' && task.kind === 'branch')
    expect(branch.length).toBeGreaterThan(0)
    for (const [, task] of branch) if (task.kind === 'branch') expect(task.sp?.spe).toBe(20)
    expect(computeSpy.mock.calls.length).toBe(branch.length)
    const after = snap.tabs.attack
    expect(after).toMatchObject({ kind: 'view', generation: 1, superseded: false })
    expect(viewOf(after).complete).toBe(true)
  })

  type Control = NonNullable<NonNullable<TabView['cards'][number]['pair']>['lock']>['control']
  const candidateKinds = (v: TabView, ids: ReadonlySet<string>): string[] =>
    v.cards
      .filter((c) => ids.has(c.id))
      .flatMap((c): Control[] => [...c.rows.map((r) => r.lock?.control), c.pair?.lock?.control])
      .flatMap((ctl) => (ctl?.kind === 'lockable' ? ctl.stages.map((s) => s.candidate.kind) : []))

  it('고정이 없어도 공격·방어 카드에 고정 조작이 나오고, 알린 방어 카드의 쌍 후보 계단이 계산돼 ready가 된다', async () => {
    const inp = input(4)
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setActiveTab('defense')
    executor.setInput(inp, 1)
    await runToEnd(m)
    const attack = viewOf(executor.getSnapshot().tabs.attack)
    expect(candidateKinds(attack, new Set(attack.cards.map((c) => c.id)))).toContain('ready')
    const before = viewOf(executor.getSnapshot().tabs.defense)
    const ids = new Set(before.cards.filter((c) => c.pair?.lock?.control?.kind === 'lockable').map((c) => c.id))
    expect(ids.size).toBeGreaterThan(0)
    expect(candidateKinds(before, ids)).toContain('computing')
    computeSpy.mockClear()

    executor.setDetailCards('defense', [...ids])
    await runToEnd(m)
    const stairs = computeSpy.mock.calls.filter(([, task]) => task.kind === 'stairs')
    expect(stairs.length).toBeGreaterThan(0)
    for (const [, task] of stairs) if (task.kind === 'stairs') expect(task.hpMin).toBe(0)
    const after = viewOf(executor.getSnapshot().tabs.defense)
    expect(after.complete).toBe(true)
    expect(candidateKinds(after, ids).length).toBeGreaterThan(0)
    expect(candidateKinds(after, ids).every((k) => k === 'ready')).toBe(true)
  })

  it('기준 갈래가 보는 능력치 상승을 막는(S 상승 갈래) 공격 후보도 카드를 알리면 갈래 재스윕으로 ready가 된다', async () => {
    const inp = input(4)
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setActiveTab('attack')
    const plusOnly: LockResolution = { kind: 'ok', options: { shape: 'single', stat: 'spe', neutral: null, plus: 12 } }
    executor.setInput(inp, 1, run([speedLock(1)], [[1, plusOnly]]))
    await runToEnd(m)
    expect(derived(executor.getSnapshot()).derivation.baseId).toBe('plus:spe')
    const before = viewOf(executor.getSnapshot().tabs.attack)
    const ids = new Set(before.cards.filter((c) => c.rows.some((r) => r.lock?.control?.kind === 'lockable')).map((c) => c.id))
    expect(candidateKinds(before, ids)).toContain('computing')

    executor.setDetailCards('attack', [...ids])
    await runToEnd(m)
    const after = viewOf(executor.getSnapshot().tabs.attack)
    expect(candidateKinds(after, ids).length).toBeGreaterThan(0)
    expect(candidateKinds(after, ids).every((k) => k === 'ready')).toBe(true)
  })

  it('조정 모델이 기다리는 작업은 setDetailCards로 알린 카드 것만 돌리고, 그 카드 조정이 ready가 된다', async () => {
    const inp = input(4)
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setActiveTab('attack')
    executor.setInput(inp, 1, run([speedLock(1)], [[1, speedOk]], 'plus:spe'))
    await runToEnd(m)
    const before = viewOf(executor.getSnapshot().tabs.attack)
    const waiting = before.cards.filter((c) => c.adjust?.state === 'computing')
    expect(waiting.length).toBeGreaterThan(1)
    const [target, ...rest] = waiting
    computeSpy.mockClear()

    executor.setDetailCards('attack', [target.id])
    await runToEnd(m)
    const calls = computeSpy.mock.calls.filter(([plan]) => plan.lock?.mode === 'main')
    expect(calls.length).toBeGreaterThan(0)
    for (const [plan, task] of calls) expect(taskCardId(plan, task)).toBe(target.id)
    const after = viewOf(executor.getSnapshot().tabs.attack)
    expect(after.cards.find((c) => c.id === target.id)?.adjust?.state).toBe('ready')
    for (const c of rest) expect(after.cards.find((x) => x.id === c.id)?.adjust?.state).toBe('computing')
  })

  it('고정이 없으면 상세 카드를 알려도 작업이 없다', async () => {
    const inp = input(4, raichu(['electroball']))
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setInput(inp, 1)
    await runToEnd(m)
    computeSpy.mockClear()
    executor.setDetailCards('attack', viewOf(executor.getSnapshot().tabs.attack).cards.map((c) => c.id))
    await runToEnd(m)
    expect(computeSpy).not.toHaveBeenCalled()
  })
})
