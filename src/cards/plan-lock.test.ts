import { describe, expect, it } from 'vitest'
import { TIER_ORDER, sweepDamage, tierRank, type PokemonSet } from '../core'
import type { StatId } from '../data/schema'
import { calcAbility } from './key'
import { deriveLocks, type CutLock, type LockDerivation, type LockResolution, type LockTargetKey, type Stairs } from './lock'
import { lockedInput } from './lockLane'
import { planTab } from './plan'
import { relevantStats } from './relevance'
import { computeRowTask } from './rowTask'
import { branchEquivalent, nextStage, otherBranches, pendingTasks, taskKey } from './schedule'
import { cardInput, realData } from './testing'
import type { CardInput, DamageTab, RowTask, RowTaskResult, TabPlan } from './types'

const { game } = realData()
const reg = game.manifest.regulation.id
const sp = (patch: Partial<Record<StatId, number>>): Record<StatId, number> => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })
const raichu = (nature: string, patch: Partial<Record<StatId, number>> = {}): PokemonSet => ({
  regulation: reg,
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  mega: true,
  nature,
  sp: sp(patch),
  moves: ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch'],
})
const input = (mySet: PokemonSet, topN = 12): CardInput => cardInput({ mySet, filters: { topN, selected: [] } })

const missingTarget = (kind: 'attack' | 'defense'): LockTargetKey => ({
  kind,
  source: 'ladder',
  opponentId: 'none',
  category: 'special',
  bundle: { ladder: '[]' },
  item: null,
  itemKey: '[]',
})
const speedLock = (seq: number): CutLock => ({
  seq,
  kind: 'speed',
  target: { kind: 'speed', origin: 'ladder', opponentId: 'none', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
  stage: 'first',
  stats: ['spe'],
})
const single = (stat: StatId, neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } })
const pairRes = (defense: 'def' | 'spd', neutral: Stairs | null, plus: Stairs | null): LockResolution => ({ kind: 'ok', options: { shape: 'pair', defense, neutral, plus } })
const flat = (v: number): Stairs => new Array<number>(33).fill(v)

function derive(mySet: PokemonSet, locks: CutLock[], resolutions: [number, LockResolution][], baseChoice: string | null = null): LockDerivation {
  return deriveLocks({ game, mySet, locks, resolutions: new Map(resolutions), baseChoice })
}

function runAll(plan: TabPlan): { tasks: RowTask[]; results: Map<string, RowTaskResult> } {
  const results = new Map<string, RowTaskResult>()
  const tasks: RowTask[] = []
  for (;;) {
    const stage = nextStage(pendingTasks(plan, results))
    if (stage.length === 0) return { tasks, results }
    for (const t of stage) {
      tasks.push(t)
      results.set(taskKey(t), computeRowTask(plan, t))
    }
  }
}

const TABS: readonly DamageTab[] = ['attack', 'defense']

/** 그 필터 첫 계단 작업 위치(없으면 -1) */
const stairsTaskIndex = (tasks: readonly RowTask[], filterId: string): number => tasks.findIndex((t) => t.kind === 'stairs' && t.filterId === filterId)

describe('planTab: 고정 계획(main)', () => {
  it('계획 세트 = 기준 갈래 고정 SP·성격, 행별로 하락을 다시 둔다(명랑 −C 갈래에서 C 행 하락은 A로)', () => {
    const mySet = raichu('hardy')
    const d = derive(mySet, [speedLock(1)], [[1, single('spe', 20, 12)]])
    expect(d.baseId).toBe('out')
    const out = planTab(lockedInput(input(mySet), d), 'attack')
    expect(out.status).toEqual({ kind: 'ok' })
    expect(out.mySp.spe).toBe(20)
    expect(out.lock?.mode).toBe('main')
    for (const row of Object.values(out.rows)) {
      expect(row.attacker.sp.spe).toBe(20)
      if (row.lock !== undefined) expect(row.attacker.nature).toBe('hardy')
    }

    const plusBase = derive(mySet, [speedLock(1)], [[1, single('spe', 20, 12)]], 'plus:spe')
    const branch = plusBase.branches.find((b) => b.id === 'plus:spe')
    expect(branch?.nature).toBe('jolly')
    const p = planTab(lockedInput(input(mySet), plusBase), 'attack')
    expect(p.mySp.spe).toBe(12)
    const rows = Object.values(p.rows).filter((r) => r.lock !== undefined)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.lock?.nature).toBe('timid')
      expect(row.attacker.nature).toBe('timid')
      expect(row.lock?.strict.plus).toBeNull()
      expect(row.natures).toEqual({ stat: 'spa', neutral: 'timid', plus: 'timid' })
      expect(row.lock?.viewLocked).toBe(false)
    }
  })

  it('합계 78 세트는 고정 중 오류가 아니고 overTotal = 12, 모든 행 작업이 합계로 실패하지 않는다', () => {
    const mySet = raichu('hardy', { hp: 32, def: 2, spa: 32 })
    const d = derive(mySet, [speedLock(1)], [[1, single('spe', 12, 8)]])
    expect(d.overTotal).toBe(12)
    expect(planTab(input({ ...mySet, sp: { ...mySet.sp, spe: 12 } }), 'attack').status.kind).toBe('my-set-error')
    for (const tab of TABS) {
      const plan = planTab(lockedInput(input(mySet, 6), d), tab)
      expect(plan.status).toEqual({ kind: 'ok' })
      expect(plan.lock?.overTotal).toBe(12)
      const { tasks, results } = runAll(plan)
      expect(tasks.length).toBeGreaterThan(0)
      const errors = [...results.values()].filter((r) => r.kind === 'error')
      expect(errors.filter((r) => r.kind === 'error' && r.reason.code === 'INVALID_SP')).toEqual([])
    }
  })

  it('행 관여 능력치 밖에 하락 자리가 없으면 갈래 성격 그대로 + dropWarning', () => {
    const mySet = raichu('hardy')
    const locks: CutLock[] = [
      speedLock(1),
      { seq: 2, kind: 'attack', target: missingTarget('attack'), stage: 'high-roll-ohko', stats: ['atk'] },
      { seq: 3, kind: 'defense', target: missingTarget('defense'), stage: 'guaranteed-survive', stats: ['hp', 'def'] },
      { seq: 4, kind: 'defense', target: missingTarget('defense'), stage: 'guaranteed-survive', stats: ['hp', 'spd'] },
    ]
    const d = derive(
      mySet,
      locks,
      [
        [1, single('spe', 20, 12)],
        [2, single('atk', 10, 4)],
        [3, pairRes('def', flat(0), flat(0))],
        [4, pairRes('spd', flat(0), flat(0))],
      ],
      'plus:spe',
    )
    expect(d.baseId).toBe('plus:spe')
    const base = d.branches.find((b) => b.id === 'plus:spe')
    expect(base?.nature).toBe('jolly')
    const plan = planTab(lockedInput(input(mySet), d), 'attack')
    const rows = Object.values(plan.rows).filter((r) => r.lock !== undefined)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.lock?.dropWarning).toBe(true)
      expect(row.lock?.nature).toBe('jolly')
      expect(row.attacker.nature).toBe('jolly')
    }
  })

  it('고정 가능 판정 입력: S 의존 기술 공격 행 dependsOn은 S를 담고, 방어 필터 dependsOn은 짝 능력치를 담지 않는다', () => {
    const mySet: PokemonSet = {
      regulation: reg,
      species: 'metagross',
      ability: 'clearbody',
      item: 'leftovers',
      nature: 'brave',
      sp: sp({ hp: 32, atk: 32, def: 2 }),
      moves: ['gyroball', 'bulletpunch', 'earthquake', 'ironhead'],
    }
    const d = derive(mySet, [speedLock(1)], [[1, single('spe', 0, 0)]])
    const attack = planTab(lockedInput(input(mySet), d), 'attack')
    const rows = Object.values(attack.rows).filter((r) => r.error === undefined)
    expect(rows.filter((r) => r.moveId === 'gyroball').every((r) => r.dependsOn.includes('spe'))).toBe(true)
    expect(rows.filter((r) => r.moveId === 'ironhead').every((r) => r.dependsOn.length === 0)).toBe(true)
    const defense = planTab(lockedInput(input(mySet), d), 'defense')
    const filters = Object.values(defense.filters)
    expect(filters.length).toBeGreaterThan(0)
    expect(filters.some((f) => f.dependsOn.length === 0)).toBe(true)
    for (const f of filters) {
      expect(f.lock).toBeDefined()
      expect(f.dependsOn).not.toContain(f.stats[1])
      for (const id of defense.cards.find((c) => c.id === f.cardId)?.rowIds ?? []) {
        const row = defense.rows[id]
        if (row.gate !== f.id) continue
        expect(row.lock).toEqual(f.lock)
        expect(row.defender.nature).toBe(f.defender.nature)
      }
    }
  })

  it('H가 고정되면 방어 필터의 목표 계단은 필요한 순위(현재·한 단계 위)·고정 H 하한·엄격 성격으로, 쌍은 합계 띠용 엄격 변형만 스케줄한다', () => {
    const mySet = raichu('hardy')
    const stairs: Stairs = Array.from({ length: 33 }, (_, hp) => (hp < 8 ? null : Math.max(4, 20 - hp)))
    const lock: CutLock = { seq: 1, kind: 'defense', target: missingTarget('defense'), stage: 'guaranteed-survive', stats: ['hp', 'spd'] }
    const d = derive(mySet, [lock], [[1, pairRes('spd', stairs, flat(0))]])
    const base = d.branches.find((b) => b.id === d.baseId)
    expect(base?.lockedSp).toEqual({ hp: 16, spd: 4 })
    const plan = planTab(lockedInput(input(mySet, 8), d), 'defense')
    expect(Object.values(plan.filters).every((f) => f.lock?.viewLocked === true)).toBe(true)
    const { tasks, results } = runAll(plan)
    const pairs = tasks.filter((t): t is Extract<RowTask, { kind: 'pair' }> => t.kind === 'pair')
    for (const t of pairs) {
      expect(stairsTaskIndex(tasks, t.filterId)).toBeLessThan(tasks.indexOf(t))
      if (plan.filters[t.filterId].lock?.strict.plus === null) expect(t.nature).toBe('neutral')
    }
    const stairsTasks = tasks.filter((t): t is Extract<RowTask, { kind: 'stairs' }> => t.kind === 'stairs')
    expect(stairsTasks.length).toBeGreaterThan(0)
    const byFilter = new Map<string, Set<number>>()
    for (const t of stairsTasks) {
      const f = plan.filters[t.filterId]
      expect(t.hpMin).toBe(16)
      expect([f.lock?.strict.neutral, f.lock?.strict.plus]).toContain(t.nature)
      const probe = results.get(taskKey({ kind: 'probe', target: 'filter', id: t.filterId }))
      expect(probe?.kind).toBe('probe')
      const cur = tierRank('defense', (probe as Extract<RowTaskResult, { kind: 'probe' }>).cell.category)
      expect([cur, Math.min(cur + 1, TIER_ORDER.defense.length - 1)]).toContain(t.rank)
      const set = byFilter.get(t.filterId) ?? new Set<number>()
      set.add(t.rank)
      byFilter.set(t.filterId, set)
      const r = results.get(taskKey(t))
      expect(r?.kind).toBe('stairs')
    }
    for (const ranks of byFilter.values()) expect(ranks.size).toBeLessThanOrEqual(2)
  })

  it('고정 없음 = 기존 planTab 출력(빈 고정 파생도 고정 필드를 만들지 않는다)', () => {
    for (const mySet of [raichu('hardy'), raichu('timid', { hp: 2, spa: 32, spe: 32 })])
      for (const tab of TABS) {
        const plain = planTab(input(mySet), tab)
        const viaLock = planTab(lockedInput(input(mySet), derive(mySet, [], [])), tab)
        expect(viaLock).toEqual(plain)
        expect(JSON.stringify(viaLock)).not.toContain('"lock"')
      }
  })
})

describe('planTab: 고정 레인', () => {
  it('레인 계획은 합계 검사를 끄고 행 성격은 laneNature(+v, 하락은 관여 밖)', () => {
    const mySet = raichu('hardy', { hp: 32, def: 32, spe: 10 })
    const plan = planTab({ ...input(mySet), lock: { mode: 'lane' } }, 'attack')
    expect(plan.status).toEqual({ kind: 'ok' })
    expect(plan.lock).toEqual({ mode: 'lane', overTotal: 8 })
    for (const row of Object.values(plan.rows)) {
      if (row.lock === undefined) continue
      expect(row.lock.nature).toBe('modest')
      expect(row.lock.strict).toEqual({ neutral: 'bashful', plus: 'modest' })
    }
  })
})

describe('갈래 재스윕(otherBranches)·branchEquivalent', () => {
  it('branchEquivalent: v·H 밖 관여 능력치 배수가 같을 때만 참', () => {
    expect(branchEquivalent(game, 'timid', 'modest', ['spa'], 'spa')).toBe(true)
    expect(branchEquivalent(game, 'timid', 'modest', ['spa', 'spe'], 'spa')).toBe(false)
    expect(branchEquivalent(game, 'hardy', 'serious', ['hp', 'spa', 'spe'], 'spa')).toBe(true)
    expect(branchEquivalent(game, 'jolly', 'hardy', ['hp', 'def'], 'def')).toBe(true)
  })

  it('S 고정 중 일렉트로볼 행의 기준이 아닌 갈래(+S)는 그 갈래 S SP로 덮어쓴 재스윕이고, 10만볼트 행은 덮어쓰기가 없다', () => {
    const mySet: PokemonSet = {
      regulation: reg,
      species: 'raichu',
      ability: 'lightningrod',
      item: 'choicescarf',
      nature: 'timid',
      sp: sp({ hp: 2, spa: 32, spe: 32 }),
      moves: ['thunderbolt', 'electroball', 'grassknot', 'focusblast'],
    }
    const d = derive(mySet, [speedLock(1)], [[1, single('spe', 32, 28)]])
    expect(d.baseId).toBe('out')
    const plan = planTab(lockedInput(input(mySet, 6), d), 'attack')
    const card = plan.cards.find((c) => c.state === 'ok' && c.category === 'special')
    expect(card).toBeDefined()
    if (card === undefined) return
    const rowOf = (moveId: string) => {
      const spec = card.rowIds.map((id) => plan.rows[id]).find((r) => r.kind === 'base' && r.moveId === moveId && r.sweep !== undefined)
      if (spec === undefined) throw new Error(`${moveId} 행이 없다`)
      return spec
    }
    const others = (moveId: string) => {
      const spec = rowOf(moveId)
      return otherBranches(plan, d.branches, 'spa', relevantStats(spec.refs, calcAbility(game, spec.attacker)).attacker, spec.dependsOn)
    }
    const electro = rowOf('electroball')
    const branchTasks: Extract<RowTask, { kind: 'branch' }>[] = others('electroball').flatMap((o) =>
      o.sp === undefined ? [] : [{ kind: 'branch' as const, rowId: electro.id, nature: o.strict.neutral, sp: o.sp }],
    )
    expect(branchTasks.map((t) => [t.nature, t.sp])).toEqual([['timid', { spe: 28 }]])
    for (const t of branchTasks) {
      const r = computeRowTask(plan, t)
      expect(r.kind).toBe('branch')
      const manual = sweepDamage(
        game,
        { side: 'attacker', stat: 'spa' },
        { ...electro.attacker, nature: t.nature, sp: { ...electro.attacker.sp, spe: 28 } },
        electro.defender,
        'electroball',
        electro.conditions,
        undefined,
        { judgeOverBudget: true, rollSteps: plan.rollSteps },
      )
      expect((r as Extract<RowTaskResult, { kind: 'branch' }>).cells.map((c) => c.category)).toEqual(manual.cells.map((c) => (c.kind === 'ok' ? c.category : null)))
    }
    expect(others('thunderbolt').every((o) => o.sp === undefined)).toBe(true)
    expect(otherBranches(planTab(input(mySet, 6), 'attack'), d.branches, 'spa', ['spa'], [])).toEqual([])
  })
})
