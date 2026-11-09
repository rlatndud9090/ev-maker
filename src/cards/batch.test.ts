import { describe, expect, it } from 'vitest'
import { CoreError, CoreInputError, STAT_IDS, judgeDamage, judgeSpeed, sweepDamage } from '../core'
import type { PokemonSet } from '../core'
import type { StatId } from '../data/schema'
import { assembleTab } from './assemble'
import { buildTabView } from './batch'
import { createLruCache } from './cache'
import { calcAbility } from './key'
import { planTab } from './plan'
import { relevantStats } from './relevance'
import { computeRowTask } from './rowTask'
import { pendingTasks, taskKey } from './schedule'
import { cardInput, realData } from './testing'
import { TABS } from './types'
import type { CardInput, RowSpec, RowTask, RowTaskResult, TabPlan } from './types'

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
    const p = pendingTasks(plan, results)
    const stage = p.stage1.length > 0 ? p.stage1 : p.stage2.length > 0 ? p.stage2 : p.stage3
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
        const direct = sweepDamage(game, spec.sweep, spec.attacker, spec.defender, spec.moveId, spec.conditions, undefined, { judgeOverBudget: true })
        expect(row.cells.map((c) => c.category)).toEqual(direct.cells.map((c) => (c.kind === 'ok' ? c.category : 'over-budget')))
        expect(row.boundaries.map((b) => b.sp)).toEqual(direct.boundaries)
        checked++
      }
      expect(checked).toBeGreaterThan(0)
    }
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
    const j = judgeDamage(game, spec.sweep!.side, a, d, spec.moveId!, spec.conditions, undefined, IGNORE)
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
