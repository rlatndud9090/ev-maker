import { afterEach, describe, expect, it, vi } from 'vitest'
import { TABS, assembleTab, buildTabView, computeRowTask, createLruCache, nextStage, pendingTasks, planTab, taskKey } from '../cards'
import type { CardInput, JudgementCache, RowTaskResult, Tab, TabView } from '../cards'
import { cardInput, realData } from '../cards/testing'
import type { PokemonSet, SpTable } from '../core'
import { createExecutor } from './executor'
import type { Executor, ExecutorSnapshot, TabViewState } from './executor'
import type { Scheduler } from './scheduler'

const { game } = realData()
const reg = game.manifest.regulation.id
const garchomp: PokemonSet = {
  regulation: reg,
  species: 'garchomp',
  ability: 'roughskin',
  nature: 'jolly',
  sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  moves: ['earthquake', 'dragonclaw', 'rockslide', 'protect'],
}
const inputA = cardInput({ mySet: garchomp, filters: { topN: 2, selected: [] } })
const inputB = cardInput({ mySet: { ...garchomp, sp: { hp: 32, atk: 2, def: 0, spa: 0, spd: 32, spe: 0 } }, filters: { topN: 3, selected: [] } })

/** yield마다 테스트가 step()으로 한 조각씩 진행시킨다. */
function manualScheduler() {
  const waiters: Array<() => void> = []
  const scheduler: Scheduler = { yield: () => new Promise<void>((r) => waiters.push(r)) }
  return {
    scheduler,
    waiting: () => waiters.length,
    async step(): Promise<boolean> {
      const w = waiters.shift()
      if (w === undefined) return false
      w()
      await new Promise((r) => setTimeout(r, 0))
      return true
    },
  }
}

/** get 호출 수 = 캐시를 거친 computeRowTask 호출 수. */
function countingCache(): JudgementCache & { gets: number; clears: number } {
  const inner = createLruCache()
  const c = {
    gets: 0,
    clears: 0,
    get(key: string) {
      c.gets++
      return inner.get(key)
    },
    set: inner.set.bind(inner),
    clear() {
      c.clears++
      inner.clear()
    },
    get size() {
      return inner.size
    },
  }
  return c
}

/** 매 호출마다 1씩 흐르는 시계. sliceMs 1이면 조각마다 작업 단위 1개. */
function tickingClock(step = 1) {
  let t = 0
  return () => (t += step) - step
}

function viewOf(s: TabViewState): TabView {
  if (s.kind !== 'view') throw new Error(`뷰가 아니다: ${s.kind}`)
  return s.view
}

async function runToEnd(m: ReturnType<typeof manualScheduler>, onStep?: (n: number) => void): Promise<number> {
  let n = 0
  while (await m.step()) onStep?.(++n)
  return n
}

function runAll(input: CardInput, tab: Tab): { plan: ReturnType<typeof planTab>; results: Map<string, RowTaskResult> } {
  const plan = planTab(input, tab)
  const results = new Map<string, RowTaskResult>()
  for (;;) {
    const stage = nextStage(pendingTasks(plan, results))
    if (stage.length === 0) return { plan, results }
    for (const t of stage) results.set(taskKey(t), computeRowTask(plan, t))
  }
}

/** 1·2단계를 다 끝낸 뒤에도 3단계 작업이 남는지. */
function hasStage3(input: CardInput, tab: Tab): boolean {
  const plan = planTab(input, tab)
  const results = new Map<string, RowTaskResult>()
  for (;;) {
    const p = pendingTasks(plan, results)
    const stage = p.stage1.length > 0 ? p.stage1 : p.stage2
    if (stage.length === 0) return p.stage3.length > 0
    for (const t of stage) results.set(taskKey(t), computeRowTask(plan, t))
  }
}

let executor: Executor | undefined
afterEach(() => {
  executor?.dispose()
  executor = undefined
  vi.restoreAllMocks()
})

describe('createExecutor', () => {
  it('최종 뷰는 탭마다 buildTabView와 같고, 끝나면 더 양보하지 않는다', async () => {
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setInput(inputA, 1)
    await runToEnd(m)
    const snap = executor.getSnapshot()
    expect(snap.generation).toBe(1)
    for (const tab of TABS) {
      const s = snap.tabs[tab]
      expect(s).toMatchObject({ kind: 'view', generation: 1, superseded: false })
      expect(viewOf(s)).toEqual(buildTabView(inputA, tab))
    }
    expect(m.waiting()).toBe(0)
  })

  it('입력 이벤트 동기 경로에서는 계획하지 않는다(첫 조각에서 시작)', () => {
    const m = manualScheduler()
    const cache = countingCache()
    executor = createExecutor({ scheduler: m.scheduler, cache })
    executor.setInput(inputA, 1)
    expect(cache.gets).toBe(0)
    expect(m.waiting()).toBe(1)
    expect(executor.getSnapshot().tabs.attack).toEqual({ kind: 'idle' })
  })

  it('우선순위: 활성 탭 1·2단계 → 나머지 탭 1·2단계 → 3단계', async () => {
    const active: Tab = 'attack'
    const others = TABS.filter((t) => t !== active)
    expect(hasStage3(inputA, active)).toBe(true)
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 1, now: tickingClock() })
    executor.setActiveTab(active)
    executor.setInput(inputA, 1)
    const firstStep = new Map<string, number>()
    const note = (key: string, n: number) => {
      if (!firstStep.has(key)) firstStep.set(key, n)
    }
    await runToEnd(m, (n) => {
      const snap = executor!.getSnapshot()
      for (const tab of TABS) {
        const s = snap.tabs[tab]
        if (s.kind !== 'view') continue
        note(`${tab}:view`, n)
        if (s.view.stage12Done) note(`${tab}:12`, n)
        if (s.view.complete) note(`${tab}:done`, n)
      }
    })
    const at = (k: string) => {
      const v = firstStep.get(k)
      if (v === undefined) throw new Error(`${k} 사건이 없다`)
      return v
    }
    for (const t of others) {
      expect(at(`${active}:12`)).toBeLessThan(at(`${t}:view`))
      expect(at(`${t}:12`)).toBeLessThan(at(`${active}:done`))
    }
  })

  it('활성 탭을 바꾸면 그 탭의 1·2단계가 먼저 끝난다', async () => {
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 1, now: tickingClock() })
    executor.setInput(inputA, 1)
    await m.step()
    await m.step()
    executor.setActiveTab('speed')
    expect(executor.getSnapshot().activeTab).toBe('speed')
    let speedFirst = false
    let decided = false
    await runToEnd(m, () => {
      if (decided) return
      const tabs = executor!.getSnapshot().tabs
      const done = (t: Tab) => tabs[t].kind === 'view' && viewOf(tabs[t]).stage12Done
      if (done('speed') || done('attack')) {
        decided = true
        speedFirst = done('speed') && !done('attack')
      }
    })
    expect(speedFirst).toBe(true)
  })

  it('시간 예산을 넘기면 조각을 끝내고 양보한다', async () => {
    const m = manualScheduler()
    const cache = countingCache()
    // 시계가 호출마다 5ms 흐르고 예산 12ms → 조각당 작업 단위 최대 3개
    executor = createExecutor({ scheduler: m.scheduler, cache, sliceMs: 12, now: tickingClock(5) })
    executor.setInput(inputA, 1)
    const perSlice: number[] = []
    let last = 0
    const steps = await runToEnd(m, () => {
      perSlice.push(cache.gets - last)
      last = cache.gets
    })
    expect(Math.max(...perSlice)).toBeLessThanOrEqual(3)
    expect(cache.gets).toBeGreaterThan(3)
    expect(steps).toBeGreaterThanOrEqual(Math.ceil(cache.gets / 3))
  })

  it('세대 변경: 이전 뷰는 superseded로 남고 첫 카드 사건 뒤 교체, 이전 결과는 섞이지 않는다', async () => {
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 1, now: tickingClock() })
    executor.setInput(inputA, 1)
    await runToEnd(m)
    executor.setInput(inputB, 2)
    const snap = executor.getSnapshot()
    expect(snap.generation).toBe(2)
    for (const tab of TABS) expect(snap.tabs[tab]).toMatchObject({ kind: 'view', generation: 1, superseded: true })

    const check = (s: ExecutorSnapshot) => {
      for (const tab of TABS) {
        const t = s.tabs[tab]
        if (t.kind !== 'view') throw new Error(`${tab}: ${t.kind}`)
        if (t.generation === 1) expect(t.superseded).toBe(true)
        else {
          expect(t.generation).toBe(2)
          expect(t.superseded).toBe(false)
          expect(t.view.cards.length > 0 || t.view.stage12Done).toBe(true)
        }
      }
    }
    await runToEnd(m, () => check(executor!.getSnapshot()))
    for (const tab of TABS) {
      const s = executor.getSnapshot().tabs[tab]
      expect(s).toMatchObject({ generation: 2, superseded: false })
      expect(viewOf(s)).toEqual(buildTabView(inputB, tab))
    }
  })

  it('진행 중 세대 변경: 낡은 결과 없이 새 입력 결과로 끝난다', async () => {
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 1, now: tickingClock() })
    executor.setInput(inputA, 1)
    for (let i = 0; i < 6; i++) await m.step()
    executor.setInput(inputB, 2)
    await runToEnd(m)
    for (const tab of TABS) expect(viewOf(executor.getSnapshot().tabs[tab])).toEqual(buildTabView(inputB, tab))
  })

  it('같은 세대 setInput은 무시한다', async () => {
    const m = manualScheduler()
    const cache = countingCache()
    executor = createExecutor({ scheduler: m.scheduler, cache })
    executor.setInput(inputA, 1)
    await runToEnd(m)
    const before = executor.getSnapshot()
    const gets = cache.gets
    executor.setInput(inputB, 1)
    expect(executor.getSnapshot()).toBe(before)
    expect(m.waiting()).toBe(0)
    expect(cache.gets).toBe(gets)
  })

  it('레귤레이션이 바뀌면 캐시를 비운다', () => {
    const m = manualScheduler()
    const cache = countingCache()
    executor = createExecutor({ scheduler: m.scheduler, cache })
    executor.setInput(inputA, 1)
    executor.setInput(inputB, 2)
    expect(cache.clears).toBe(0)
    const other = { ...game, manifest: { ...game.manifest, regulation: { ...game.manifest.regulation, id: `${reg}-other` } } }
    executor.setInput({ ...inputA, game: other }, 3)
    expect(cache.clears).toBe(1)
  })

  it('setDisplaySp는 행 작업 없이 활성 탭만 다시 조립한다', async () => {
    const m = manualScheduler()
    const cache = countingCache()
    executor = createExecutor({ scheduler: m.scheduler, cache })
    executor.setInput(inputA, 1)
    await runToEnd(m)
    const before = executor.getSnapshot()
    const gets = cache.gets
    const sp: SpTable = { ...garchomp.sp, atk: 20 }
    executor.setDisplaySp(sp)
    const after = executor.getSnapshot()
    expect(after).not.toBe(before)
    expect(cache.gets).toBe(gets)
    expect(m.waiting()).toBe(0)
    const { plan, results } = runAll(inputA, 'attack')
    expect(viewOf(after.tabs.attack)).toEqual(assembleTab(plan, results, sp))
    expect(after.tabs.defense).toBe(before.tabs.defense)
    expect(after.tabs.speed).toBe(before.tabs.speed)

    executor.setDisplaySp(null)
    expect(viewOf(executor.getSnapshot().tabs.attack)).toEqual(buildTabView(inputA, 'attack'))
    expect(cache.gets).toBe(gets)
  })

  it('새 세대 setInput은 표시용 SP를 비우되, 이전 세대 뷰를 계획 시점 SP로 되돌려 조립하지 않는다', async () => {
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler, sliceMs: 5, now: tickingClock() })
    executor.setInput(inputA, 1)
    await runToEnd(m)
    const sp: SpTable = { ...garchomp.sp, atk: 20 }
    executor.setDisplaySp(sp)
    const dragged = viewOf(executor.getSnapshot().tabs.attack)
    executor.setInput(inputB, 2)
    const held = executor.getSnapshot().tabs.attack
    expect(held).toMatchObject({ kind: 'view', generation: 1, superseded: true })
    expect(viewOf(held)).toBe(dragged)
    await runToEnd(m)
    expect(viewOf(executor.getSnapshot().tabs.attack)).toEqual(buildTabView(inputB, 'attack'))
  })

  it('getSnapshot은 바뀔 때만 새 객체이고, 바뀔 때만 알린다', async () => {
    const m = manualScheduler()
    executor = createExecutor({ scheduler: m.scheduler })
    const listener = vi.fn()
    const unsubscribe = executor.subscribe(listener)
    const s0 = executor.getSnapshot()
    expect(executor.getSnapshot()).toBe(s0)
    executor.setActiveTab('attack')
    expect(executor.getSnapshot()).toBe(s0)
    expect(listener).not.toHaveBeenCalled()
    executor.setInput(inputA, 1)
    expect(listener).toHaveBeenCalledTimes(1)
    await runToEnd(m)
    const done = executor.getSnapshot()
    const calls = listener.mock.calls.length
    executor.setDisplaySp(null)
    executor.setActiveTab('attack')
    expect(executor.getSnapshot()).toBe(done)
    expect(listener).toHaveBeenCalledTimes(calls)
    unsubscribe()
    executor.setActiveTab('speed')
    expect(listener).toHaveBeenCalledTimes(calls)
  })

  it('예상 밖 예외는 그 탭만 fatal로 끝내고 나머지 탭은 계속한다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = manualScheduler()
    const inner = createLruCache()
    let thrown = false
    const cache: JudgementCache = {
      get(key) {
        if (!thrown) {
          thrown = true
          throw new Error('boom')
        }
        return inner.get(key)
      },
      set: inner.set.bind(inner),
      clear: inner.clear.bind(inner),
      get size() {
        return inner.size
      },
    }
    executor = createExecutor({ scheduler: m.scheduler, cache, sliceMs: 1, now: tickingClock() })
    executor.setInput(inputA, 1)
    await runToEnd(m)
    const snap = executor.getSnapshot()
    expect(snap.tabs.attack).toEqual({ kind: 'fatal', message: 'boom', generation: 1 })
    for (const tab of ['defense', 'speed'] as const) expect(viewOf(snap.tabs[tab])).toEqual(buildTabView(inputA, tab))
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('양보 수단이 실패하면 남은 탭을 fatal로 끝내 "계산 중"에 고착되지 않는다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const scheduler: Scheduler = { yield: () => (++calls === 1 ? Promise.resolve() : Promise.reject(new Error('yield 실패'))) }
    executor = createExecutor({ scheduler, sliceMs: 1, now: tickingClock() })
    executor.setInput(inputA, 1)
    await new Promise((r) => setTimeout(r, 0))
    const snap = executor.getSnapshot()
    expect(TABS.map((t) => snap.tabs[t].kind)).toEqual(['fatal', 'fatal', 'fatal'])
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('dispose 뒤에는 계산·알림이 없다', async () => {
    const m = manualScheduler()
    const cache = countingCache()
    executor = createExecutor({ scheduler: m.scheduler, cache })
    const listener = vi.fn()
    executor.subscribe(listener)
    executor.setInput(inputA, 1)
    listener.mockClear()
    executor.dispose()
    await runToEnd(m)
    expect(cache.gets).toBe(0)
    expect(listener).not.toHaveBeenCalled()
    executor.setInput(inputB, 2)
    expect(m.waiting()).toBe(0)
  })
})
