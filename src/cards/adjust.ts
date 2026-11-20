// 카드 하나의 조정 모델(결과 목록 × 성격 선택지). 판정을 다시 하지 않고 이미 나온 행 작업 결과(변형 스윕·갈래 재스윕·쌍·계단)만 읽는다.
import { STAT_IDS, TIER_ORDER, moveStatRefs, tierRank, type RollTier, type SpTable } from '../core'
import type { StatId } from '../data/schema'
import { calcAbility } from './key'
import type { Branch } from './lock'
import { relevantStats } from './relevance'
import { branchEquivalent, filterState, lockedHp, otherBranches, rowJudgements, taskKey, type BranchVariants } from './schedule'
import { minSumWithFloors } from './stairs'
import { firstCellAt } from './target'
import type { AdjustNature, AdjustOption, AdjustResult, AdjustStat, AdjustView, CompactCell, NatureVariant, RowLockSpec, RowTask, ResultMap, SpOverride, TabPlan } from './types'

type Boostable = Exclude<StatId, 'hp'>

export interface AdjustInput {
  plan: TabPlan
  results: ResultMap
  /** 보이는 항목: 공격 스윕 행 id 또는 방어 극단 필터 id */
  shown: { target: 'row' | 'filter'; id: string }
  displaySp: SpTable
  /** 카드 대표 행의 현재 결과(없으면 "현재" 표지 없음) */
  current?: RollTier
}

/** 순위 하나의 조정 능력치 최소 SP. null = 닿지 않음, pending = 그 작업 결과 대기 */
type Need = { sp: Partial<Record<StatId, number>>; cost: number } | null | { pending: RowTask }

/** H 최대 배분(H·B/D SP). null = 없음, pending = 그 계단 작업 결과 대기 */
type HMax = { hp: number; defense: number } | null | { pending: readonly RowTask[] }

/** 성격 선택지 하나: 갈래·변형이 정해지면 순위 → 최소 SP(방어 쌍이고 H가 고정 밖이면 순위·예산 → H 최대 배분도) */
interface Choice {
  nature: AdjustNature
  need?: (rank: number) => Need
  hMax?: (rank: number, budget: number) => HMax
  branch?: Branch
}

/** 판정 대상(공격 행·방어 쌍)의 공통 문맥 */
interface Subject {
  side: 'attack' | 'defense'
  v: Boostable
  /** 조정할 능력치(STAT_ORDER) */
  adjusted: readonly StatId[]
  dependsOn: readonly StatId[]
  relevant: readonly StatId[]
  natures: { neutral: string; plus: string }
  lock?: RowLockSpec
}

const ordered = (stats: Iterable<StatId>): StatId[] => {
  const set = new Set(stats)
  return STAT_IDS.filter((s) => set.has(s))
}

const pending = (task: RowTask): Need => ({ pending: task })

/** 변형 스윕 칸(무고정·기준 갈래). 결과 대기면 그 변형 작업, 오류면 null */
function variantCells(plan: TabPlan, results: ResultMap, rowId: string, which: NatureVariant): readonly CompactCell[] | null | { pending: RowTask } {
  const cells = rowJudgements(plan, results, rowId)[which]
  if (cells !== undefined) return cells
  const task: RowTask = { kind: 'variant', rowId, nature: which }
  return results.has(taskKey(task)) ? null : { pending: task }
}

/** 공격 행: 갈래 o(기준이면 undefined)·변형 which의 칸에서 순위 이상 첫 칸 SP. 재사용 조건은 갈래 재스윕 수요와 같다 */
function attackNeed(plan: TabPlan, results: ResultMap, rowId: string, s: Subject, o: BranchVariants | undefined, which: NatureVariant): ((rank: number) => Need) | undefined {
  const nature = o === undefined ? (s.lock === undefined ? s.natures[which] : s.lock.strict[which]) : o.strict[which]
  if (nature === null) return undefined
  const baseNature = s.lock?.strict[which] ?? null
  const reuse = o === undefined || (o.sp === undefined && baseNature !== null && branchEquivalent(plan.game, baseNature, nature, s.relevant, s.v))
  let cells: readonly CompactCell[] | null | { pending: RowTask }
  if (reuse) cells = variantCells(plan, results, rowId, which)
  else {
    const task: RowTask = o.sp === undefined ? { kind: 'branch', rowId, nature } : { kind: 'branch', rowId, nature, sp: o.sp }
    const r = results.get(taskKey(task))
    cells = r === undefined ? { pending: task } : r.kind === 'branch' ? r.cells : null
  }
  return (rank) => {
    if (cells === null || 'pending' in cells) return cells
    const hit = firstCellAt('attack', cells, rank)
    return hit === undefined ? null : { sp: { [s.v]: hit.sp }, cost: hit.sp }
  }
}

const stairsTask = (filterId: string, nature: string, rank: number, hpMin: number, sp: SpOverride | undefined): RowTask =>
  sp === undefined ? { kind: 'stairs', filterId, nature, rank, hpMin } : { kind: 'stairs', filterId, nature, rank, hpMin, sp }

/**
 * 방어 쌍. sideLocked가 아니면 H·B/D 최소 합(쌍 점, 재사용 못 하면 H 0부터 계단의 최소 합), sideLocked면 H = 그 갈래 고정 H에서의 계단 값.
 * 순위 0(확정1타)은 작업 없이 SP 0이다.
 */
function defenseNeed(
  plan: TabPlan,
  results: ResultMap,
  filterId: string,
  s: Subject,
  sideLocked: boolean,
  branch: Branch | undefined,
  o: BranchVariants | undefined,
  which: NatureVariant,
): ((rank: number) => Need) | undefined {
  const nature = o === undefined ? (s.lock === undefined ? s.natures[which] : s.lock.strict[which]) : o.strict[which]
  if (nature === null) return undefined
  const v = s.v
  const baseNature = s.lock?.strict[which] ?? null
  const equivalent = o === undefined || (o.sp === undefined && baseNature !== null && branchEquivalent(plan.game, baseNature, nature, s.relevant, v))
  const zero = (): Need => (sideLocked ? { sp: { [v]: 0 }, cost: 0 } : { sp: { hp: 0, [v]: 0 }, cost: 0 })
  if (sideLocked) {
    const base = plan.lock?.mode === 'main' ? plan.lock.base : undefined
    const h0 = branch?.lockedSp.hp ?? 0
    const baseHp = base === undefined ? 0 : lockedHp(plan, base)
    const reuse = equivalent && baseNature !== null && h0 >= baseHp
    return (rank) => {
      if (rank === 0) return zero()
      const task = reuse ? stairsTask(filterId, baseNature, rank, baseHp, undefined) : stairsTask(filterId, nature, rank, h0, o?.sp)
      const r = results.get(taskKey(task))
      if (r === undefined) return pending(task)
      if (r.kind !== 'stairs' || r.stairs === 'non-monotonic') return null
      const d = r.stairs[h0]
      return d === null || d === undefined ? null : { sp: { [v]: d }, cost: d }
    }
  }
  const usePair = equivalent && s.lock?.viewLocked !== true
  return (rank) => {
    if (rank === 0) return zero()
    if (usePair) {
      const task: RowTask = { kind: 'pair', filterId, nature: which }
      const r = results.get(taskKey(task))
      if (r === undefined) return pending(task)
      const hit = r.kind === 'pair' ? r.points.find((p) => tierRank('defense', p.atLeast) === rank) : undefined
      return hit === undefined ? null : { sp: { hp: hit.hp, [v]: hit.defense }, cost: hit.hp + hit.defense }
    }
    const task = stairsTask(filterId, nature, rank, 0, o?.sp)
    const r = results.get(taskKey(task))
    if (r === undefined) return pending(task)
    if (r.kind !== 'stairs' || r.stairs === 'non-monotonic') return null
    const p = minSumWithFloors(r.stairs, { hp: 0, defense: 0 })
    return p === null ? null : { sp: { hp: p.hp, [v]: p.defense }, cost: p.hp + p.defense }
  }
}

/**
 * 방어 쌍 H 최대 배분(H 고정 밖): 그 갈래 계단(H 0부터) rank·rank+1로, 예산·능력치당 최대 안에서 rank를 정확히 내는(그 H의 최소 B/D가
 * rank+1에 닿지 않는) 가장 큰 H와 그 H의 최소 B/D. 순위 0(확정1타)은 없다(사용자 요청 2026-11-20, PRD R23).
 */
function defenseHMax(plan: TabPlan, results: ResultMap, filterId: string, s: Subject, o: BranchVariants | undefined, which: NatureVariant): ((rank: number, budget: number) => HMax) | undefined {
  const nature = o === undefined ? (s.lock === undefined ? s.natures[which] : s.lock.strict[which]) : o.strict[which]
  if (nature === null) return undefined
  const ranks = TIER_ORDER.defense.length
  return (rank, budget) => {
    if (rank === 0) return null
    const tasks = [rank, rank + 1].filter((r) => r < ranks).map((r) => stairsTask(filterId, nature, r, 0, o?.sp))
    const missing = tasks.filter((t) => !results.has(taskKey(t)))
    if (missing.length > 0) return { pending: missing }
    const [cur, next] = tasks.map((t) => {
      const r = results.get(taskKey(t))
      return r?.kind === 'stairs' && r.stairs !== 'non-monotonic' ? r.stairs : null
    })
    if (cur === null || next === null) return null
    for (let hp = Math.min(cur.length - 1, plan.spMaxPerStat, budget); hp >= 0; hp--) {
      const d = cur[hp]
      if (d === null || d === undefined || d > plan.spMaxPerStat || hp + d > budget) continue
      const up = next?.[hp]
      if (up !== null && up !== undefined && up <= d) continue
      return { hp, defense: d }
    }
    return null
  }
}

type NeedOf = (branch: Branch | undefined, o: BranchVariants | undefined, which: NatureVariant) => ((rank: number) => Need) | undefined
/** H 최대 배분 함수(방어 쌍·H 고정 밖만) */
type HMaxOf = (o: BranchVariants | undefined, which: NatureVariant) => ((rank: number, budget: number) => HMax) | undefined

/** 고정 없음: 무보정·상승 두 선택지 */
function plainChoices(s: Subject, needOf: NeedOf, hMaxOf: HMaxOf | undefined): Choice[] {
  const make = (id: 'neutral' | 'plus', which: NatureVariant): Choice => {
    const c: Choice = { nature: { id, plus: id === 'plus' ? s.v : null, nature: s.natures[which], branchId: null, lockedSp: {} } }
    const need = needOf(undefined, undefined, which)
    if (need !== undefined) c.need = need
    const hMax = hMaxOf?.(undefined, which)
    if (hMax !== undefined) c.hMax = hMax
    return c
  }
  return [make('neutral', 'neutral'), make('plus', 'plus')]
}

/**
 * 고정 계획: 무보정(기준 갈래, sideLocked이고 기준이 반대쪽 상승이면 'out'), v 상승('out'), sideLocked면 반대쪽 상승(plus:<반대쪽>, v 무보정).
 * 기준이 아닌 갈래는 otherBranches의 엄격 성격·SP 덮어쓰기를 쓰고, 목록에 없으면 갈래 없음이다.
 */
function lockedChoices(plan: TabPlan, s: Subject, lock: RowLockSpec, sideLocked: boolean, other: Boostable | undefined, needOf: NeedOf, hMaxOf: HMaxOf | undefined): Choice[] {
  if (plan.lock?.mode !== 'main') throw new Error('고정 계획이 아니다')
  const { derivation, base } = plan.lock
  const others = new Map(otherBranches(plan, derivation.branches, s.v, s.relevant, s.dependsOn).map((o) => [o.branch.id, o]))
  const byId = (id: string) => derivation.branches.find((b) => b.id === id)
  const make = (id: AdjustNature['id'], plus: Boostable | null, branch: Branch | undefined, which: NatureVariant): Choice => {
    const o = branch === undefined || branch.id === base.id ? undefined : others.get(branch.id)
    const usable = branch !== undefined && (branch.id === base.id || o !== undefined)
    const strict = usable ? (o?.strict ?? lock.strict)[which] : null
    const lockedSp: Partial<Record<StatId, number>> = {}
    if (branch !== undefined) for (const st of derivation.lockedStats) lockedSp[st] = branch.lockedSp[st] ?? 0
    const nature: AdjustNature = { id, plus, nature: strict ?? branch?.nature ?? lock.nature, branchId: branch?.id ?? null, lockedSp }
    if (!usable) return { nature: { ...nature, off: 'no-branch' } }
    const c: Choice = { nature, branch }
    const need = needOf(branch, o, which)
    if (need !== undefined) c.need = need
    const hMax = hMaxOf?.(o, which)
    if (hMax !== undefined) c.hMax = hMax
    return c
  }
  const out = byId('out')
  const choices = [make('neutral', null, sideLocked && base.plus === other ? out : base, 'neutral'), make('plus', s.v, out, 'plus')]
  if (sideLocked && other !== undefined) choices.push(make('other-plus', other, byId(`plus:${other}`), 'neutral'))
  return choices
}

/** 그 선택지 갈래에서 함께 표기하는 고정 능력치: sideLocked면 H·반대쪽, 그 밖은 기준 갈래와 고정 SP가 다른 것 */
function lockedStatsOf(plan: TabPlan, choice: Choice, sideLocked: boolean, other: Boostable | undefined): AdjustStat[] {
  if (plan.lock?.mode !== 'main' || choice.branch === undefined) return []
  const { derivation, base } = plan.lock
  const b = choice.branch
  return derivation.lockedStats
    .filter((st) => (sideLocked && (st === 'hp' || st === other)) || (b.lockedSp[st] ?? 0) !== (base.lockedSp[st] ?? 0))
    .map((st) => ({ stat: st, sp: b.lockedSp[st] ?? 0, plus: st === choice.nature.plus, locked: true }))
}

/** cost = 조정 능력치 SP 합(ok가 아니면 쓰지 않는다). ok 선택지의 H 최대 배분은 option.hMax */
type Cell = { option: AdjustOption; cost: number }

const offCell = (reason: Extract<AdjustOption, { kind: 'off' }>['reason']): Cell => ({ option: { kind: 'off', reason }, cost: Infinity })

/** 선택지가 순위 r을 정확히 낸다: ok이고, 더 좋은 ok 순위가 없거나 가장 가까운 그 순위보다 비용이 작다 */
function exact(row: readonly Cell[], r: number): boolean {
  if (row[r].option.kind !== 'ok') return false
  const better = row.slice(r + 1).find((c) => c.option.kind === 'ok')
  return better === undefined || row[r].cost < better.cost
}

function subjectOf(input: AdjustInput): { s: Subject; need: (sideLocked: boolean) => NeedOf; hMax?: HMaxOf } | undefined {
  const { plan, results, shown } = input
  if (shown.target === 'row') {
    const spec = plan.rows[shown.id]
    if (spec === undefined || spec.error !== undefined || spec.gate !== undefined || spec.sweep === undefined || spec.natures === undefined || plan.mySide !== 'attacker') return undefined
    const v = spec.natures.stat
    const rel = relevantStats(spec.refs, calcAbility(plan.game, spec.attacker)).attacker
    const s: Subject = { side: 'attack', v, adjusted: [v], dependsOn: spec.dependsOn, relevant: rel, natures: spec.natures }
    if (spec.lock !== undefined) s.lock = spec.lock
    return { s, need: () => (_b, o, which) => attackNeed(plan, results, spec.id, s, o, which) }
  }
  const filter = plan.filters[shown.id]
  if (filter === undefined || filterState(results, filter.id).kind !== 'passed') return undefined
  const v = filter.stats[1]
  const rel = relevantStats(moveStatRefs(plan.game, filter.moveId), calcAbility(plan.game, filter.attacker)).defender
  const s: Subject = { side: 'defense', v, adjusted: ['hp', v], dependsOn: filter.dependsOn, relevant: rel, natures: filter.natures }
  if (filter.lock !== undefined) s.lock = filter.lock
  return {
    s,
    need: (sideLocked) => (branch, o, which) => defenseNeed(plan, results, filter.id, s, sideLocked, branch, o, which),
    hMax: (o, which) => defenseHMax(plan, results, filter.id, s, o, which),
  }
}

/** 보이는 항목에서 내 세트(공격 탭 공격측, 방어 탭 방어측) 성격의 상승 능력치. 무보정이면 null */
function myPlusOf(input: AdjustInput, side: 'attack' | 'defense'): StatId | null {
  const spec = input.shown.target === 'row' ? input.plan.rows[input.shown.id] : input.plan.filters[input.shown.id]
  const me = spec === undefined ? undefined : side === 'attack' ? spec.attacker : spec.defender
  const nature = me === undefined ? undefined : input.plan.game.data.natures[me.nature]
  return nature === undefined || nature.plus === nature.minus ? null : (nature.plus as StatId)
}

/**
 * 보이는 항목(공격 스윕 행·통과한 방어 쌍)의 조정 모델. 그 밖이면 undefined.
 * 예산 = spTotal − 갈래 고정 합 − 판정이 의존하는 고정 밖·조정 밖 능력치의 표시 SP(고정 밖 다른 능력치는 예산을 막지 않는다).
 */
export function adjustView(input: AdjustInput): AdjustView | undefined {
  const { plan, displaySp } = input
  const subject = subjectOf(input)
  if (subject === undefined) return undefined
  const base = subject.s
  const lockedStats = plan.lock?.mode === 'main' ? plan.lock.derivation.lockedStats : []
  const other: Boostable | undefined = base.side === 'defense' ? (base.v === 'def' ? 'spd' : 'def') : undefined
  const sideLocked = other !== undefined && lockedStats.includes(other)
  const s: Subject = sideLocked ? { ...base, adjusted: [base.v] } : base
  const unlockedDeps = s.dependsOn.filter((st) => !lockedStats.includes(st))
  const keep = ordered([...s.adjusted, ...unlockedDeps])
  const relevant = ordered([...s.relevant, s.v])
  if (lockedStats.includes(s.v)) return { state: 'locked', natures: [], results: [], keep, relevant }

  const needOf = subject.need(sideLocked)
  // H 최대 배분은 H가 고정 밖일 때만(쌍 고정 중이면 H가 고정이라 합 최소 하나)
  const hMaxOf = lockedStats.includes('hp') ? undefined : subject.hMax
  const choices = plan.lock?.mode === 'main' && s.lock !== undefined ? lockedChoices(plan, s, s.lock, sideLocked, other, needOf, hMaxOf) : plainChoices(s, needOf, hMaxOf)
  const othersSp = unlockedDeps.filter((st) => !s.adjusted.includes(st)).reduce((sum, st) => sum + displaySp[st], 0)
  const ranks = TIER_ORDER[s.side].length
  const tasks = new Map<string, RowTask>()
  const grid: Cell[][] = choices.map((choice) => {
    const budget = plan.spTotal - (choice.branch?.lockedSum ?? 0) - othersSp
    const extra = lockedStatsOf(plan, choice, sideLocked, other)
    return Array.from({ length: ranks }, (_, r): Cell => {
      if (choice.nature.off !== undefined) return offCell('no-branch')
      const need = choice.need?.(r) ?? null
      if (need === null) return offCell('unreachable')
      if ('pending' in need) {
        tasks.set(taskKey(need.pending), need.pending)
        return offCell('unreachable')
      }
      const capped = s.adjusted.every((st) => (need.sp[st] ?? 0) <= plan.spMaxPerStat)
      if (!capped || need.cost > budget) return offCell('budget')
      const statsOf = (sp: Partial<Record<StatId, number>>): AdjustStat[] =>
        [...s.adjusted.map((st): AdjustStat => ({ stat: st, sp: sp[st] ?? 0, plus: st === choice.nature.plus, locked: false })), ...extra].sort(
          (a, b) => STAT_IDS.indexOf(a.stat) - STAT_IDS.indexOf(b.stat),
        )
      const option: Extract<AdjustOption, { kind: 'ok' }> = { kind: 'ok', stats: statsOf(need.sp) }
      const h = choice.hMax?.(r, budget) ?? null
      if (h !== null && 'pending' in h) {
        for (const t of h.pending) tasks.set(taskKey(t), t)
        return offCell('unreachable')
      }
      // 합 최소보다 H가 높을 때만(같으면 하나만 보인다)
      if (h !== null && h.hp > (need.sp.hp ?? 0)) option.hMax = statsOf({ hp: h.hp, [s.v]: h.defense })
      return { option, cost: need.cost }
    })
  })
  if (tasks.size > 0) return { state: 'computing', tasks: [...tasks.values()], natures: [], results: [], keep, relevant }

  // 1단 대표 선택지: 내 세트 성격이 상승을 준 능력치의 선택지, 그 밖은 무보정. 그 선택지로 닿지 않으면 가장 싼 선택지(사용자 결정 2026-11-20)
  const myPlus = myPlusOf(input, s.side)
  const preferred = Math.max(0, choices.findIndex((c) => c.nature.plus === (choices.some((x) => x.nature.plus === myPlus) ? myPlus : null)))
  const results: AdjustResult[] = []
  for (let r = ranks - 1; r >= 0; r--) {
    // 그 결과를 정확히 내지 못하는 선택지(고르면 더 좋은 결과가 나옴)는 꺼서 2단에서 고를 수 없게 한다
    const cells = grid.map((row) => (row[r].option.kind !== 'ok' || exact(row, r) ? row[r] : offCell('unreachable')))
    const lead = cells[preferred]?.option.kind === 'ok' ? preferred : cells.reduce((best, c, i) => (cells[best].option.kind !== 'ok' || (c.option.kind === 'ok' && c.cost < cells[best].cost) ? i : best), 0)
    if (cells[lead].option.kind !== 'ok') continue
    const label = TIER_ORDER[s.side][r] as RollTier
    results.push({ label, current: label === input.current, options: cells.map((c) => c.option), lead })
  }
  return { state: 'ready', natures: choices.map((c) => c.nature), results, keep, relevant }
}
