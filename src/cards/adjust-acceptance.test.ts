// 실데이터 조정 선택지를 그 SP·성격으로 내 세트를 직접 바꿔 다시 판정(고정 없는 계획의 단건 판정)해 확인한다.
import { describe, expect, it } from 'vitest'
import { tierRank, type PokemonSet, type SpTable } from '../core'
import { assembleTab, createTabAssembler } from './assemble'
import { resolveLaneLock } from './batch'
import { createLruCache } from './cache'
import { cardItems } from './items'
import { deriveLocks, type CutLock, type LockDerivation, type LockResolution } from './lock'
import { lockedInput } from './lockLane'
import { lockTargetKeyOf } from './lockTarget'
import { planTab } from './plan'
import { computeRowTask } from './rowTask'
import { nextStage, pendingTasks, taskKey } from './schedule'
import { cardInput, realData } from './testing'
import type { AdjustView, CardInput, CardView, DamageTab, RowTask, RowTaskResult, TabPlan, TabView } from './types'

const { game } = realData()
const cache = createLruCache()
const raichu: PokemonSet = {
  regulation: game.manifest.regulation.id,
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  mega: true,
  nature: 'hardy',
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moves: ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch'],
}
const input = (mySet: PokemonSet = raichu): CardInput => cardInput({ mySet, filters: { topN: 6, selected: [] } })
const ZERO: SpTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

/** 계획의 모든 단계 작업과 모든 카드의 조정·고정 후보 수요를 끝까지 돌린 조정 뷰 */
function settle(plan: TabPlan): { results: Map<string, RowTaskResult>; view: TabView } {
  const results = new Map<string, RowTaskResult>()
  const run = (tasks: readonly RowTask[]) => {
    for (const t of tasks) if (!results.has(taskKey(t))) results.set(taskKey(t), computeRowTask(plan, t, cache))
  }
  const ids = new Set(plan.cards.map((c) => c.id))
  for (;;) {
    for (let stage = nextStage(pendingTasks(plan, results)); stage.length > 0; stage = nextStage(pendingTasks(plan, results))) run(stage)
    const d = createTabAssembler(plan, new Map(), { adjust: true }).candidates(results, ids)
    const fresh = [...d.stage4, ...d.stage5].filter((t) => !results.has(taskKey(t)))
    if (fresh.length === 0) break
    run(fresh)
  }
  return { results, view: createTabAssembler(plan, new Map(), { adjust: true }).assemble(results) }
}

function locked(tab: DamageTab, locks: CutLock[], speed: [number, LockResolution][], baseChoice: string | null): { plan: TabPlan; derivation: LockDerivation } {
  const resolutions = new Map<number, LockResolution>(speed)
  for (const l of locks) if (l.kind !== 'speed') resolutions.set(l.seq, resolveLaneLock(input(), l, cache))
  const derivation = deriveLocks({ game, mySet: raichu, locks, resolutions, baseChoice })
  return { plan: planTab(lockedInput(input(), derivation), tab), derivation }
}

/** 보이는 항목의 행 작업 대상(공격 행 id·방어 필터 id) */
function shownTarget(plan: TabPlan, card: CardView): { target: 'row' | 'filter'; id: string } {
  const spec = plan.cards.find((c) => c.id === card.id)
  const ref = spec === undefined ? undefined : cardItems(plan, spec).find((r) => r.key === card.shownItem)
  if (ref === undefined || ref.candidate.target === 'fixed') throw new Error(`카드 ${card.id}의 보이는 항목이 없다`)
  return { target: ref.candidate.target, id: ref.candidate.id }
}

/** 내 세트를 그 SP·성격으로 바꾼 고정 없는 계획에서 보이는 항목의 단건 판정 */
function judgeAt(tab: DamageTab, shown: { target: 'row' | 'filter'; id: string }, sp: SpTable, nature: string): string {
  const plan = planTab(input({ ...raichu, sp, nature }), tab)
  expect(plan.status.kind).toBe('ok')
  const r = computeRowTask(plan, { kind: 'probe', target: shown.target, id: shown.id }, cache)
  if (r.kind !== 'probe') throw new Error(`단건 판정 실패: ${JSON.stringify(r)}`)
  return r.cell.category
}

/**
 * 모든 결과의 ok 선택지를 그 SP(고정 능력치 포함)·판정 성격으로 다시 판정한다.
 * lead 선택지는 그 결과와 정확히 같고, 나머지 ok 선택지는 그 결과 이상이다. H 최대 배분은 그 결과와 정확히 같고 예산 안이다. 확인한 배분 수를 낸다.
 */
function verify(tab: DamageTab, plan: TabPlan, card: CardView): number {
  const adjust = card.adjust as AdjustView
  const shown = shownTarget(plan, card)
  const side = tab === 'attack' ? 'attack' : 'defense'
  let checked = 0
  for (const result of adjust.results) {
    result.options.forEach((o, i) => {
      if (o.kind !== 'ok') return
      const spOf = (stats: typeof o.stats): SpTable => {
        const sp: SpTable = { ...ZERO, ...adjust.natures[i].lockedSp }
        for (const s of stats) sp[s.stat] = s.sp
        return sp
      }
      const got = judgeAt(tab, shown, spOf(o.stats), adjust.natures[i].nature)
      if (i === result.lead) expect(got, `${card.id} ${result.label} lead`).toBe(result.label)
      else expect(tierRank(side, got), `${card.id} ${result.label} ${i}`).toBeGreaterThanOrEqual(tierRank(side, result.label))
      checked++
      if (o.hMax === undefined) return
      const hMax = spOf(o.hMax)
      const minSum = spOf(o.stats)
      expect(hMax.hp, `${card.id} ${result.label} ${i} H 최대`).toBeGreaterThan(minSum.hp)
      expect(Object.values(hMax).reduce((a, b) => a + b, 0), `${card.id} ${result.label} ${i} H 최대 합`).toBeLessThanOrEqual(plan.spTotal)
      expect(judgeAt(tab, shown, hMax, adjust.natures[i].nature), `${card.id} ${result.label} ${i} H 최대`).toBe(result.label)
      checked++
    })
  }
  return checked
}

const readyCards = (view: TabView, n: (c: CardView) => boolean = () => true): CardView[] =>
  view.cards.filter((c) => c.adjust?.state === 'ready' && c.adjust.results.length >= 2 && n(c))

describe('조정 선택지 실데이터 재판정', () => {
  it('고정 없음: 공격 행·방어 쌍 카드의 모든 ok 선택지가 그 SP·성격에서 그 결과를 낸다', () => {
    for (const tab of ['attack', 'defense'] as const) {
      const plan = planTab(input(), tab)
      const { view } = settle(plan)
      const cards = readyCards(view).slice(0, 3)
      expect(cards.length, tab).toBeGreaterThan(0)
      for (const c of cards) {
        expect(c.adjust?.natures.map((x) => x.id)).toEqual(['neutral', 'plus'])
        expect(verify(tab, plan, c)).toBeGreaterThan(c.adjust?.results.length ?? 0)
      }
      // H 최대 배분은 방어 쌍에만 있다
      const hMax = cards.flatMap((c) => c.adjust?.results.flatMap((r) => r.options) ?? []).filter((o) => o.kind === 'ok' && o.hMax !== undefined)
      if (tab === 'attack') expect(hMax).toHaveLength(0)
      else expect(hMax.length).toBeGreaterThan(0)
    }
  })

  it('스피드 고정(기준 S12+): 공격 카드의 C 상승은 out 갈래(S20 자물쇠)로 표기되고 그 SP·성격에서 결과를 낸다', () => {
    const speed: CutLock = {
      seq: 1,
      kind: 'speed',
      target: { kind: 'speed', origin: 'ladder', opponentId: 'garchomp', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
      stage: 'first',
      stats: ['spe'],
    }
    const { plan, derivation } = locked('attack', [speed], [[1, { kind: 'ok', options: { shape: 'single', stat: 'spe', neutral: 20, plus: 12 } }]], 'plus:spe')
    expect(derivation.baseId).toBe('plus:spe')
    const { view } = settle(plan)
    const cards = readyCards(view).slice(0, 3)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      const adjust = c.adjust as AdjustView
      expect(adjust.natures.map((x) => [x.id, x.branchId, x.lockedSp])).toEqual([
        ['neutral', 'plus:spe', { spe: 12 }],
        ['plus', 'out', { spe: 20 }],
      ])
      const plus = adjust.results.flatMap((r) => (r.options[1].kind === 'ok' ? [r.options[1].stats] : []))
      expect(plus.length).toBeGreaterThan(0)
      for (const stats of plus) expect(stats.find((s) => s.stat === 'spe')).toEqual({ stat: 'spe', sp: 20, plus: false, locked: true })
      verify('attack', plan, c)
    }
  })

  it('방어 H+B 고정 중 D 쌍 카드: 무보정·D 상승·B 상승 세 선택지가 H·B·D를 모두 표기하고 그 SP·성격에서 결과를 낸다', () => {
    const base = planTab(input(), 'defense')
    const { view: plain } = settle(base)
    // 고정할 물리 쌍: 보이는 항목이 B 필터인 첫 카드
    const physical = plain.cards.find((c) => c.adjust?.state === 'ready' && shownTarget(base, c).target === 'filter' && base.filters[shownTarget(base, c).id].stats[1] === 'def')
    expect(physical).toBeDefined()
    if (physical === undefined) return
    const spec = base.cards.find((c) => c.id === physical.id)
    if (spec === undefined || physical.shownItem === undefined) throw new Error('카드가 없다')
    const lock: CutLock = { seq: 1, kind: 'defense', target: lockTargetKeyOf('defense', spec, physical.shownItem), stage: 'low-roll-ohko', stats: ['hp', 'def'] }
    const { plan, derivation } = locked('defense', [lock], [], null)
    expect(derivation.lockedStats).toEqual(['hp', 'def'])
    const { view } = settle(plan)
    const special = readyCards(view, (c) => c.adjust?.natures.length === 3).slice(0, 3)
    expect(special.length).toBeGreaterThan(0)
    for (const c of special) {
      const adjust = c.adjust as AdjustView
      expect(adjust.natures.map((x) => [x.id, x.plus])).toEqual([
        ['neutral', null],
        ['plus', 'spd'],
        ['other-plus', 'def'],
      ])
      for (const r of adjust.results) {
        for (const o of r.options) if (o.kind === 'ok') expect(o.stats.map((s) => [s.stat, s.locked])).toEqual([['hp', true], ['def', true], ['spd', false]])
      }
      expect(adjust.keep).toEqual(['spd'])
      verify('defense', plan, c)
    }
    // 고정한 쌍 자체(B)는 조정할 능력치가 고정이라 locked
    expect(view.cards.find((c) => c.id === physical.id)?.adjust?.state).toBe('locked')
  })
})

describe('조립 옵션 adjust', () => {
  it('옵션이 없으면 조정 모델이 없고, 있으면 변동 가능 카드에만 있다', () => {
    const plan = planTab(input(), 'attack')
    const { results } = settle(plan)
    expect(assembleTab(plan, results).cards.every((c) => c.adjust === undefined)).toBe(true)
    const view = assembleTab(plan, results, plan.mySp, new Map(), { adjust: true })
    expect(view.cards.some((c) => c.adjust !== undefined)).toBe(true)
    for (const c of view.cards) if (!c.variable) expect(c.adjust).toBeUndefined()
  })

  it.each([
    ['attack', 'guaranteed-ohko', { spa: 32 }],
    ['defense', 'guaranteed-survive', { hp: 32, def: 32 }],
  ] as const)('%s: 대표 행 현재 결과가 그 관점 최상(%s)이어도 변동 가능 카드는 더 낮은 결과까지 조정 모델에 낸다', (tab, best, sp) => {
    const plan = planTab(input({ ...raichu, sp: { ...ZERO, ...sp } }), tab)
    const { view } = settle(plan)
    const side = tab === 'attack' ? 'attack' : 'defense'
    const currentOf = (c: CardView) => (c.headline.kind === 'row' ? c.rows.find((r) => r.id === (c.headline as { rowId: string }).rowId)?.current.category : undefined)
    const top = view.cards.filter((c) => c.variable && currentOf(c) === best && c.adjust?.state === 'ready')
    expect(top.length).toBeGreaterThan(0)
    for (const c of top) {
      const results = (c.adjust as AdjustView).results
      expect(results.find((r) => r.current)?.label).toBe(best)
      expect(results.some((r) => tierRank(side, r.label) < tierRank(side, best))).toBe(true)
    }
    for (const c of view.cards) if (!c.variable) expect(c.adjust).toBeUndefined()
  })

  it('candidates는 그 카드 조정 모델이 기다리는 작업(branch stage4, stairs stage5)을 결과에 없는 것만 낸다', () => {
    const speed: CutLock = {
      seq: 1,
      kind: 'speed',
      target: { kind: 'speed', origin: 'ladder', opponentId: 'garchomp', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
      stage: 'first',
      stats: ['spe'],
    }
    const { plan } = locked('attack', [speed], [[1, { kind: 'ok', options: { shape: 'single', stat: 'spe', neutral: 20, plus: 12 } }]], 'plus:spe')
    const results = new Map<string, RowTaskResult>()
    for (let stage = nextStage(pendingTasks(plan, results)); stage.length > 0; stage = nextStage(pendingTasks(plan, results))) {
      for (const t of stage) results.set(taskKey(t), computeRowTask(plan, t, cache))
    }
    const view = createTabAssembler(plan, new Map(), { adjust: true }).assemble(results)
    const waiting = view.cards.find((c) => c.adjust?.state === 'computing')
    expect(waiting).toBeDefined()
    if (waiting === undefined) return
    const tasks = createTabAssembler(plan, new Map(), { adjust: true }).candidates(results, new Set([waiting.id]))
    const keys = [...tasks.stage4, ...tasks.stage5].map(taskKey)
    for (const t of waiting.adjust?.tasks ?? []) expect(keys).toContain(taskKey(t))
    expect(tasks.stage4.every((t) => t.kind === 'branch')).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.some((k) => results.has(k))).toBe(false)
  })
})
