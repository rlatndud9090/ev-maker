import { describe, expect, it } from 'vitest'
import { judgeDamage, sweepDamage, tierRank, type PokemonSet, type RollTier } from '../core'
import { buildLockedTabView, buildTabView, resolveLaneLock } from './batch'
import { cardItems } from './items'
import type { CutLock, LockResolution, LockStage } from './lock'
import { laneInput, laneResolution, laneTasks } from './lockLane'
import { lockTargetKeyOf } from './lockTarget'
import { planTab } from './plan'
import { taskKey } from './schedule'
import { cardInput, realData } from './testing'
import type { CardInput, CardSpec, TabPlan } from './types'

const { game } = realData()
const reg = game.manifest.regulation.id
const MAX = game.manifest.rules.spMaxPerStat
const mySet: PokemonSet = {
  regulation: reg,
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  mega: true,
  nature: 'hardy',
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moves: ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch'],
}
const input = (topN: number, set: PokemonSet = mySet): CardInput => cardInput({ mySet: set, filters: { topN, selected: [] } })

function shownRefs(plan: TabPlan, limit: number) {
  const out: { card: CardSpec; key: string; id: string }[] = []
  for (const card of plan.cards) {
    if (card.state !== 'ok' || card.berry !== undefined) continue
    const ref = cardItems(plan, card).find((r) => r.rankBefore && (r.candidate.target === 'filter' || (r.candidate.target === 'row' && plan.rows[r.candidate.id].error === undefined)))
    if (ref !== undefined) out.push({ card, key: ref.key, id: ref.candidate.id })
    if (out.length >= limit) break
  }
  return out
}

function attackManual(plan: TabPlan, rowId: string, stage: LockStage): LockResolution {
  const row = plan.rows[rowId]
  const rank = tierRank('attack', stage)
  const minSp = (nature: string) => {
    const r = sweepDamage(game, { side: 'attacker', stat: 'spa' }, { ...row.attacker, nature }, row.defender, row.moveId as string, row.conditions, undefined, {
      judgeOverBudget: true,
      rollSteps: plan.rollSteps,
    })
    return r.cells.find((c) => c.kind === 'ok' && tierRank('attack', c.category) >= rank)?.sp ?? null
  }
  const neutral = minSp('hardy')
  const plus = minSp('modest')
  return neutral === null && plus === null ? { kind: 'unreachable' } : { kind: 'ok', options: { shape: 'single', stat: 'spa', neutral, plus } }
}

function defenseManual(plan: TabPlan, filterId: string, stage: LockStage, nature: string): (number | null)[] | null {
  const f = plan.filters[filterId]
  const rank = tierRank('defense', stage)
  const out: (number | null)[] = []
  for (let hp = 0; hp <= MAX; hp++) {
    let found: number | null = null
    for (let d = 0; d <= MAX && found === null; d++) {
      const defender = { ...f.defender, nature, sp: { ...f.defender.sp, hp, [f.stats[1]]: d } }
      const tier = judgeDamage(game, 'defender', f.attacker, defender, f.moveId, f.conditions, undefined, { ignoreSpTotal: true, rollSteps: plan.rollSteps }).category as RollTier
      if (tierRank('defense', tier) >= rank) found = d
    }
    out.push(found)
  }
  return out.some((v) => v !== null) ? out : null
}

describe('고정 레인 해석', () => {
  it('공격: 레인 해석 = 수동 세트에서 고정 능력치만 스윕한 최소 SP(32 안에 닿지 않으면 null, 둘 다면 도달 불가)', () => {
    const plain = planTab(input(20), 'attack')
    let sawNull = false
    let sawUnreachable = false
    for (const { card, key, id } of shownRefs(plain, 20)) {
      for (const stage of ['high-roll-ohko', 'guaranteed-ohko'] as const) {
        const lock: CutLock = { seq: 1, kind: 'attack', target: lockTargetKeyOf('attack', card, key), stage, stats: ['spa'] }
        const want = attackManual(plain, id, stage)
        const got = resolveLaneLock(input(20), lock)
        expect(got, `${card.id} ${stage}`).toEqual(want)
        if (got.kind === 'ok' && (got.options.neutral === null || got.options.plus === null)) sawNull = true
        if (got.kind === 'unreachable') sawUnreachable = true
      }
    }
    expect(sawNull).toBe(true)
    expect(sawUnreachable).toBe(true)
  })

  it('방어: 두 계단(H 0부터) = 수동 세트 완전 탐색', () => {
    const plain = planTab(input(6), 'defense')
    const refs = shownRefs(plain, 3)
    expect(refs.length).toBeGreaterThan(0)
    for (const { card, key, id } of refs) {
      const def = plain.filters[id].stats[1]
      for (const stage of ['guaranteed-survive', 'low-roll-ohko'] as const) {
        const lock: CutLock = { seq: 1, kind: 'defense', target: lockTargetKeyOf('defense', card, key), stage, stats: ['hp', def] }
        const lane = planTab(laneInput(input(6), lock), 'defense')
        const strict = lane.filters[id].lock?.strict
        expect(strict?.plus).not.toBeNull()
        const neutral = defenseManual(plain, id, stage, 'hardy')
        const plus = defenseManual(plain, id, stage, strict?.plus as string)
        const want: LockResolution = neutral === null && plus === null ? { kind: 'unreachable' } : { kind: 'ok', options: { shape: 'pair', defense: def, neutral, plus } }
        expect(resolveLaneLock(input(6), lock), `${card.id} ${stage}`).toEqual(want)
      }
    }
  })

  it('표시 필터(상위 N) 밖 래더 상대도 해석한다', () => {
    const wide = planTab(input(20), 'attack')
    const far = shownRefs(wide, 40).find((r) => (r.card.opponent.rank ?? 0) > 3)
    expect(far).toBeDefined()
    if (far === undefined) return
    const lock: CutLock = { seq: 1, kind: 'attack', target: lockTargetKeyOf('attack', far.card, far.key), stage: 'high-roll-ohko', stats: ['spa'] }
    expect(planTab(input(1), 'attack').cards.some((c) => c.opponent.id === far.card.opponent.id)).toBe(false)
    const got = resolveLaneLock(input(1), lock)
    expect(got).toEqual(resolveLaneLock(input(20), lock))
    expect(got).toEqual(attackManual(wide, far.id, 'high-roll-ohko'))
    const lane = planTab(laneInput(input(1), lock), 'attack')
    expect(new Set(lane.cards.map((c) => c.opponent.id))).toEqual(new Set([far.card.opponent.id]))
    expect(lane.lock?.mode).toBe('lane')
  })

  it('set-error·missing·unreachable 상태', () => {
    const plain = planTab(input(8), 'attack')
    const [{ card, key, id }] = shownRefs(plain, 1)
    const lock: CutLock = { seq: 1, kind: 'attack', target: lockTargetKeyOf('attack', card, key), stage: 'high-roll-ohko', stats: ['spa'] }
    expect(resolveLaneLock(input(8, { ...mySet, sp: { ...mySet.sp, spa: 40 } }), lock)).toEqual({ kind: 'set-error' })
    expect(resolveLaneLock(input(8), { ...lock, target: { ...lockTargetKeyOf('attack', card, key), bundle: { ladder: '[]' } } })).toEqual({ kind: 'missing' })
    const lane = planTab(laneInput(input(8), lock), 'attack')
    expect(laneResolution(lane, lock, null, new Map())).toEqual({ kind: 'missing' })
    const tasks = laneTasks(lane, lock, { rowId: id })
    expect(tasks.map((t) => t.kind)).toEqual(['branch', 'branch'])
    const results = new Map(tasks.map((t) => [taskKey(t), { kind: 'error' as const, task: t, reason: { code: 'INPUT' as const, message: '실패' } }]))
    expect(laneResolution(lane, lock, { rowId: id }, results)).toEqual({ kind: 'unreachable', reason: '실패' })
    expect(() => laneResolution(lane, lock, { rowId: id }, new Map())).toThrow()
  })
})

describe('buildLockedTabView', () => {
  it.each(['attack', 'defense'] as const)('%s: 고정이 없으면 buildTabView와 같다', (tab) => {
    const resolved = buildLockedTabView(input(8), tab, [], new Map(), null)
    expect(resolved.view).toEqual(buildTabView(input(8), tab))
    expect(resolved.derivation.branches).toEqual([])
    expect(resolved.resolutions.size).toBe(0)
  })

  it('공격 고정 + 스피드 해석: 레인 → 파생 → 기준 갈래 계획으로 탭 뷰를 끝까지 낸다', () => {
    const plain = planTab(input(8), 'attack')
    const [{ card, key, id }] = shownRefs(plain, 1)
    const attack: CutLock = { seq: 1, kind: 'attack', target: lockTargetKeyOf('attack', card, key), stage: 'guaranteed-survive', stats: ['spa'] }
    const speed: CutLock = {
      seq: 2,
      kind: 'speed',
      target: { kind: 'speed', origin: 'ladder', opponentId: card.opponent.id, bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
      stage: 'first',
      stats: ['spe'],
    }
    const speedRes: LockResolution = { kind: 'ok', options: { shape: 'single', stat: 'spe', neutral: 20, plus: 12 } }
    for (const tab of ['attack', 'defense'] as const) {
      const r = buildLockedTabView(input(8), tab, [attack, speed], new Map([[2, speedRes]]), null)
      expect(r.resolutions.get(1)).toEqual(attackManual(plain, id, 'guaranteed-survive'))
      expect(r.derivation.statuses.get(1)).toEqual({ kind: 'active' })
      expect(r.derivation.statuses.get(2)).toEqual({ kind: 'active' })
      expect(r.derivation.baseId).toBe('out')
      expect(r.view.status).toEqual({ kind: 'ok' })
      expect(r.view.complete).toBe(true)
    }
  })
})
