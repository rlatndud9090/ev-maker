import { describe, expect, it } from 'vitest'
import { CoreError, CoreInputError, STAT_IDS, judgeDamage, judgeSpeed, sweepDamage } from '../core'
import type { PokemonSet } from '../core'
import type { StatId } from '../data/schema'
import { assembleTab } from './assemble'
import { buildTabView } from './batch'
import { createLruCache } from './cache'
import { calcAbility, judgementKey } from './key'
import { planTab } from './plan'
import { relevantStats } from './relevance'
import { computeRowTask } from './rowTask'
import { nextStage, pendingTasks, taskKey } from './schedule'
import { cardInput, realData } from './testing'
import { TABS } from './types'
import type { CardInput, RowSpec, RowTask, RowTaskResult, TabPlan } from './types'
import { DEFAULT_ROLL_STEPS } from './types'
/** 카드 입력과 같은 제품 고난수 기준(cardInput 기본값). 코어 직접 호출 기대값도 이 기준의 5단 판정으로 낸다 */
const N = DEFAULT_ROLL_STEPS

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
const delphox: PokemonSet = {
  regulation: reg,
  species: 'delphox',
  ability: 'blaze',
  item: 'delphoxite',
  mega: true,
  nature: 'timid',
  sp: { hp: 10, atk: 0, def: 8, spa: 32, spd: 0, spe: 16 },
  moves: ['psyshock', 'flamethrower', 'protect'],
}
const inputs: CardInput[] = [garchomp, delphox].map((mySet) => cardInput({ mySet, filters: { topN: 12, selected: [] } }))

function runAll(plan: TabPlan, results: Map<string, RowTaskResult>): void {
  for (;;) {
    const stage = nextStage(pendingTasks(plan, results))
    if (stage.length === 0) return
    for (const t of stage) results.set(taskKey(t), computeRowTask(plan, t))
  }
}

describe('buildTabView: 실제 데이터', () => {
  it.each(TABS)('%s: 두 번 같고, 캐시 경유(냉·온) = 무캐시', (tab) => {
    for (const input of inputs) {
      const plain = buildTabView(input, tab)
      expect(plain.status).toEqual({ kind: 'ok' })
      expect(plain.complete).toBe(true)
      expect(plain.cards.length).toBeGreaterThan(0)
      expect(buildTabView(input, tab)).toEqual(plain)
      const cache = createLruCache()
      expect(buildTabView(input, tab, cache)).toEqual(plain)
      expect(cache.size).toBeGreaterThan(0)
      expect(buildTabView(input, tab, cache)).toEqual(plain)
    }
  })

  it.each(TABS)('%s: 점진 조립(1단계 일부 → 나머지)의 최종 뷰 = 일괄, 진행은 단조 증가', (tab) => {
    const input = inputs[0]
    const plan = planTab(input, tab)
    const results = new Map<string, RowTaskResult>()
    const first = pendingTasks(plan, results).stage1
    const half = first.filter((_, i) => i % 2 === 1)
    for (const t of half) results.set(taskKey(t), computeRowTask(plan, t))
    const mid = assembleTab(plan, results)
    expect(mid.progress.done).toBe(half.length)
    expect(mid.complete).toBe(false)
    runAll(plan, results)
    const done = assembleTab(plan, results)
    expect(done.progress.done).toBe(done.progress.total)
    expect(done.progress.total).toBeGreaterThanOrEqual(mid.progress.total)
    expect(done).toEqual(buildTabView(input, tab))
  })

  it('공격 탭 행 칸 = 같은 입력의 sweepDamage(judgeOverBudget) 직접 호출', () => {
    for (const input of inputs) {
      const plan = planTab(input, 'attack')
      const view = buildTabView(input, 'attack')
      let checked = 0
      for (const row of view.cards.flatMap((c) => c.rows)) {
        const spec = plan.rows[row.id]
        if (row.cells.length === 0 || spec?.sweep === undefined || spec.moveId === undefined) continue
        const direct = sweepDamage(game, spec.sweep, spec.attacker, spec.defender, spec.moveId, spec.conditions, undefined, { judgeOverBudget: true, rollSteps: N })
        expect(row.cells.map((c) => c.category)).toEqual(direct.cells.map((c) => (c.kind === 'ok' ? c.category : 'over-budget')))
        expect(row.boundaries.map((b) => b.sp)).toEqual(direct.boundaries)
        checked++
      }
      expect(checked).toBeGreaterThan(0)
    }
  })
})

describe('고난수 기준(rollSteps): 계산 전체에 전달되고 캐시 키가 구분한다', () => {
  const base = inputs[0]
  const loose: CardInput = { ...base, rollSteps: 12 }
  const countingCache = () => {
    const cache = createLruCache()
    const c = {
      gets: 0,
      hits: 0,
      get(key: string) {
        c.gets++
        const v = cache.get(key)
        if (v !== undefined) c.hits++
        return v
      },
      set: cache.set,
      clear: cache.clear,
      get size() {
        return cache.size
      },
    }
    return c
  }

  it('기준을 바꾸면 같은 입력의 띠 범주·판정 키가 달라지고, 되돌리면 같아진다', () => {
    const a = buildTabView(base, 'attack')
    const b = buildTabView(loose, 'attack')
    expect(a.rollSteps).toBe(N)
    expect(b.rollSteps).toBe(12)
    const cats = (v: typeof a) => v.cards.flatMap((c) => c.rows.map((r) => [r.id, r.cells.map((x) => x.category).join(',')]))
    expect(cats(b)).not.toEqual(cats(a))
    expect(buildTabView({ ...loose, rollSteps: N }, 'attack')).toEqual(a)

    const pa = planTab(base, 'attack')
    const pb = planTab(loose, 'attack')
    const task = pendingTasks(pa, new Map()).stage1[0]
    expect(judgementKey(pb, task)).not.toBe(judgementKey(pa, task))
    expect(judgementKey(planTab({ ...loose, rollSteps: N }, 'attack'), task)).toBe(judgementKey(pa, task))
  })

  it('기준 변경은 대미지 판정 캐시를 맞히지 않고 재계산하며, 되돌리면 전부 캐시 적중', () => {
    const c = countingCache()
    const first = buildTabView(base, 'defense', c)
    const size = c.size
    c.gets = c.hits = 0
    buildTabView({ ...base, rollSteps: 10 }, 'defense', c)
    expect(c.hits).toBe(0)
    expect(c.size).toBeGreaterThan(size)
    c.gets = c.hits = 0
    expect(buildTabView(base, 'defense', c)).toEqual(first)
    expect(c.hits).toBe(c.gets)
  })

  it('스피드 판정은 기준을 읽지 않아 키가 같고 전부 캐시 적중한다', () => {
    const c = countingCache()
    const speed = buildTabView(base, 'speed', c)
    c.gets = c.hits = 0
    expect(buildTabView(loose, 'speed', c).cards).toEqual(speed.cards)
    expect(c.gets).toBeGreaterThan(0)
    expect(c.hits).toBe(c.gets)
  })

  it('무효 기준은 계획 단계에서 코어 입력 오류', () => {
    for (const rollSteps of [0, 16, 2.5, NaN]) expect(() => planTab({ ...base, rollSteps }, 'attack')).toThrow(CoreInputError)
  })
})

describe('관여 능력치 속성: 키에서 뺀 능력치를 바꿔도 단건 판정이 같다', () => {
  const perturb = (set: PokemonSet, keep: readonly StatId[]): PokemonSet[] =>
    STAT_IDS.filter((s) => !keep.includes(s)).map((s) => ({ ...set, sp: { ...set.sp, [s]: set.sp[s] >= 16 ? 0 : 32 } }))
  const IGNORE = { ignoreSpTotal: true }

  function judged(spec: RowSpec, a: PokemonSet, d: PokemonSet): unknown {
    if (spec.judge === 'speed') {
      const j = judgeSpeed(game, a, d, spec.conditions, IGNORE)
      return [j.category, j.value.attackerSpeed, j.value.defenderSpeed]
    }
    const j = judgeDamage(game, spec.sweep!.side, a, d, spec.moveId!, spec.conditions, undefined, { ...IGNORE, rollSteps: N })
    return [j.category, j.value]
  }

  it.each(TABS)('%s 탭의 계획 행 전부', (tab) => {
    let checked = 0
    for (const input of inputs) {
      const plan = planTab(input, tab)
      for (const card of plan.cards) {
        for (const rowId of card.rowIds) {
          const spec = plan.rows[rowId]
          if (spec.error !== undefined || spec.sweep === undefined) continue
          const rel = relevantStats(spec.judge, spec.refs, calcAbility(game, spec.attacker))
          let expected: unknown
          try {
            expected = judged(spec, spec.attacker, spec.defender)
          } catch (e) {
            if (e instanceof CoreError || e instanceof CoreInputError) continue
            throw e
          }
          for (const a of perturb(spec.attacker, rel.attacker)) expect(judged(spec, a, spec.defender)).toEqual(expected)
          for (const d of perturb(spec.defender, rel.defender)) expect(judged(spec, spec.attacker, d)).toEqual(expected)
          // 성격 변형: 상승 대상은 관여 능력치이고, 상승 성격의 하락(현재 성격 재사용이 아니면)은 관여하지 않는 능력치다
          const natures = spec.natures
          if (natures === undefined) throw new Error(`스윕 행 ${rowId}에 성격 변형이 없다`)
          const mine = plan.mySide === 'attacker' ? spec.attacker : spec.defender
          const mineRel = plan.mySide === 'attacker' ? rel.attacker : rel.defender
          expect(mineRel).toContain(natures.stat)
          const plus = game.data.natures[natures.plus]
          expect(plus.plus).toBe(natures.stat)
          if (natures.plus !== mine.nature) expect(mineRel).not.toContain(plus.minus)
          const neutral = game.data.natures[natures.neutral]
          expect(neutral.plus !== natures.stat && neutral.minus !== natures.stat || neutral.plus === neutral.minus).toBe(true)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(10)
  })
})

describe('computeRowTask 오류 경로(실제 계획)', () => {
  it('계획에 없는 작업 id는 버그로 던진다', () => {
    const plan = planTab(inputs[0], 'attack')
    const bogus: RowTask[] = [
      { kind: 'ends', rowId: 'x' },
      { kind: 'extreme', filterId: 'x' },
      { kind: 'fixed', fixedId: 'x' },
    ]
    for (const t of bogus) expect(() => computeRowTask(plan, t)).toThrow(Error)
  })
})
